import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { createHubServer } from '../src/server.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'em-http-')); const config = { region: 1, keyId: 1, key: randomBytes(32), hubOrigin: 456 }; const store = await new IncidentStore(directory).load();
  const core = new HubCore({ config, store, transmit: async () => {} }); const app = createHubServer({ core, config, operatorToken: 'test-only-local-code', simulation: true, ...options }); const { origin } = await app.listen(0);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { core, origin, app };
}
async function login(origin) {
  const result = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'test-only-local-code' }) });
  assert.equal(result.status, 200); const cookie = result.headers.get('set-cookie').split(';')[0]; const { csrf } = await result.json(); return { cookie, csrf };
}
test('local API requires auth, strict Host/Origin and CSRF; export is human-review gated', async t => {
  const { core, origin } = await fixture(t);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const rebinding = await new Promise(resolve => { const req = httpRequest(`${origin}/health`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.end(); }); assert.equal(rebinding, 403);
  const { cookie, csrf } = await login(origin);
  const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
  assert.equal((await fetch(`${origin}/api/simulate`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': '' }, body: '{}' })).status, 403);
  const simulated = await fetch(`${origin}/api/simulate`, { method: 'POST', headers, body: '{}' }); assert.equal(simulated.status, 201); const { id } = await simulated.json();
  assert.equal(core.list().length, 1); assert.equal(core.list()[0].simulated, true);
  assert.equal((await fetch(`${origin}/api/incidents/${id}/export`, { method: 'POST', headers, body: '{}' })).status, 409);
  assert.equal((await fetch(`${origin}/api/incidents/${id}/review`, { method: 'POST', headers, body: '{}' })).status, 200);
  const exported = await (await fetch(`${origin}/api/incidents/${id}/export`, { method: 'POST', headers, body: '{}' })).json(); assert.equal(exported.servicesContacted, false); assert.equal(exported.simulation, true); assert.ok(exported.incident.request.note);
  const state = await (await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).json(); assert.equal(state.incidents.length, 1); assert.equal(JSON.stringify(state).includes('keyHex'), false); assert.equal('receipt' in state.incidents[0], false);
  const index = await fetch(origin); assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(index.headers.get('referrer-policy'), 'no-referrer');
  const selectionModule = await fetch(`${origin}/view-selection.js`); assert.equal(selectionModule.status, 200); assert.match(await selectionModule.text(), /export function selectVisibleReport/);
});
test('login rate limiting and oversized input are bounded', async t => {
  const { origin } = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }) })).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 429);
});
