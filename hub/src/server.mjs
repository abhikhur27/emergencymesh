import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { injectSimulation } from './simulation.mjs';
import { IdentityStore } from './identity-store.mjs';
import { DEFAULT_REGION } from './region.mjs';

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/view-selection.js', ['view-selection.js', 'text/javascript; charset=utf-8']],
  ['/reception-data.js', ['reception-data.js', 'text/javascript; charset=utf-8']],
  ['/campus-map.js', ['campus-map.js', 'text/javascript; charset=utf-8']],
  ['/map-geometry.js', ['map-geometry.js', 'text/javascript; charset=utf-8']],
  ['/assets/campus-map.json', ['assets/campus-map.json', 'application/json; charset=utf-8']],
  ['/assets/campus-map.svg', ['assets/campus-map.svg', 'image/svg+xml']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
function sameSecret(a, b) { return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function send(response, status, value, extra = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); response.end(JSON.stringify(value));
}
async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw Object.assign(new Error('JSON required'), { status: 415 });
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw Object.assign(new Error('Request too large'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export function createHubServer({ core, config, operatorToken, identities = new IdentityStore(core.store.directory, { operatorToken }), regionProfile = DEFAULT_REGION, pipeline = null, simulation = false, getLink = () => ({ mode: 'disconnected', connected: false }), ai = false, model = null } = {}) {
  let loginAttempts = []; let mutations = []; let expectedHost = null; let expectedOrigin = null;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (!expectedHost || request.headers.host !== expectedHost || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) return send(response, 403, { error: 'Local host required' });
      const url = new URL(request.url, expectedOrigin);
      if (request.headers.origin && request.headers.origin !== expectedOrigin) return send(response, 403, { error: 'Origin rejected' });
      if (request.method !== 'GET' && request.headers.origin !== expectedOrigin) return send(response, 403, { error: 'Same-origin request required' });
      if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true, product: 'RescueMesh', simulation, realDispatch: false });
      if (request.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        response.writeHead(200, { 'Content-Type': type }); response.end(await readFile(`${publicDirectory}${file}`)); return;
      }
      const now = Date.now();
      if (request.method === 'POST' && url.pathname === '/api/login') {
        loginAttempts = loginAttempts.filter(time => time > now - 60000);
        if (loginAttempts.length >= 10) return send(response, 429, { error: 'Wait one minute before trying again' });
        loginAttempts.push(now);
        const body = await jsonBody(request);
        if (!identities.authenticate(body)) return send(response, 401, { error: 'Sign-in details rejected' });
        const { id, csrf, maxAge } = await identities.createSession({ remember: body.remember !== false });
        return send(response, 200, { ok: true, csrf, username: 'operator' }, { 'Set-Cookie': `em_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}` });
      }
      const cookie = /(?:^|;\s*)em_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
      const session = identities.getSession(cookie);
      if (!session) return send(response, 401, { error: 'Operator sign-in required' });
      if (request.method !== 'GET') {
        if (!sameSecret(request.headers['x-csrf-token'], session.csrf)) return send(response, 403, { error: 'Session token required' });
        mutations = mutations.filter(time => time > now - 60000);
        if (mutations.length >= 120) return send(response, 429, { error: 'Operator request limit reached' });
        mutations.push(now);
      }
      if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, { csrf: session.csrf, operator: { username: session.username }, region: config.region, keyId: config.keyId, regionProfile, database: identities.status(), automation: pipeline?.status() || { paused: false, hubId: 'ecsw', model: { enabled: ai, name: model, lastSource: null, lastSuccessAt: null, error: null }, supervisor: { configured: false, connected: false, publicUrl: '', pending: 0, error: null } }, incidents: core.list(), link: getLink(), simulation, ai: { enabled: ai, model }, realDispatch: false, serverTime: now });
      if (request.method === 'POST' && url.pathname === '/api/logout') { await identities.revoke(cookie); return send(response, 200, { ok: true }, { 'Set-Cookie': 'em_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
      if (request.method === 'POST' && url.pathname === '/api/automation' && pipeline) {
        const body = await jsonBody(request);
        if (typeof body?.paused !== 'boolean') return send(response, 400, { error: 'Paused must be true or false' });
        await pipeline.setPaused(body.paused); return send(response, 200, { ok: true, automation: pipeline.status() });
      }
      if (request.method === 'POST' && url.pathname === '/api/simulate' && simulation) { await jsonBody(request); return send(response, 201, await injectSimulation(core, config)); }
      let decodedPath; try { decodedPath = decodeURIComponent(url.pathname); } catch { return send(response, 400, { error: 'Invalid request path' }); }
      const match = /^\/api\/incidents\/([0-9]+:[0-9]+:[0-9]+)\/(review|export|location)$/.exec(decodedPath);
      if (request.method === 'POST' && match) {
        const body = await jsonBody(request);
        if (match[2] === 'location' && pipeline) {
          if (typeof body?.label !== 'string' || !body.label.trim() || body.label.length > 120 || Buffer.byteLength(body.label) > 240 || /[\u0000-\u001f\u007f]/.test(body.label)) return send(response, 400, { error: 'Enter a location label of 1 to 120 characters' });
          await pipeline.correctLocation(match[1], body.label.trim()); return send(response, 200, core.publicIncident(core.store.get(match[1])));
        }
        if (match[2] === 'location') return send(response, 409, { error: 'Coordination pipeline unavailable' });
        if (match[2] === 'review') return send(response, 200, await core.review(match[1]));
        return send(response, 200, core.export(match[1]));
      }
      return send(response, 404, { error: 'Not found' });
    } catch (error) {
      const known = error.message === 'Incident not found' || error.message === 'Operator review required before export';
      send(response, error.status || (known ? 409 : 500), { error: known || error.status ? error.message : 'Operation failed; original report preserved' });
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 10000; server.maxRequestsPerSocket = 200;
  return {
    server,
    listen: async (port = 4781) => { await identities.load(); return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { const address = server.address(); expectedHost = `127.0.0.1:${address.port}`; expectedOrigin = `http://${expectedHost}`; resolve({ origin: expectedOrigin, port: address.port }); });
    }); },
    close: async () => { await new Promise(resolve => { server.closeIdleConnections(); server.close(() => resolve()); }); await identities.close(); },
  };
}
