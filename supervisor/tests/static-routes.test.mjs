import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupervisorServer } from '../src/server.mjs';
import { SupervisorStore } from '../src/store.mjs';
import { SupervisorCore } from '../src/core.mjs';
import { NemotronPlanner } from '../src/planner.mjs';

async function fixture() {
  const root = fileURLToPath(new URL('../../../.validation/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'regional-static-test-'));
  const core = new SupervisorCore({ store: await new SupervisorStore(directory).load(), planner: new NemotronPlanner({ enabled: false }) });
  return { core, cleanup: async () => { await core.close(); assert.ok(directory.startsWith(join(root, 'regional-static-test-'))); await rm(directory, { recursive: true, force: true }); } };
}

test('regional entrypoint modules and locally vendored Leaflet dependencies are served before sign-in', async t => {
  const f = await fixture();
  const app = await createSupervisorServer({ core: f.core, operatorToken: 'static-route-test-only' });
  const { origin } = await app.listen(0);
  t.after(async () => { await app.close(); await f.cleanup(); });
  const home = await fetch(origin);
  const html = await home.text();
  assert.equal(home.status, 200);
  assert.match(html, /src="\/ui-kit\.js"/);
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /href="\/assets\/leaflet-1\.9\.4\/leaflet\.css"/);
  assert.match(html, /src="\/assets\/leaflet-1\.9\.4\/leaflet\.js"/);
  for (const path of ['/app.js', '/interface.js', '/ui-kit.js', '/agent-conversation.js', '/assets/leaflet-1.9.4/leaflet.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /javascript/, path);
    assert.ok((await response.text()).length > 50, path);
  }
  const entrypoint = await (await fetch(origin + '/app.js')).text();
  assert.match(entrypoint, /import\(['"]\.\/interface\.js['"]\)/);
  const stylesheet = await fetch(origin + '/assets/leaflet-1.9.4/leaflet.css');
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  for (const name of ['layers-2x.png', 'layers.png', 'marker-icon-2x.png', 'marker-icon.png', 'marker-shadow.png']) {
    const response = await fetch(origin + '/assets/leaflet-1.9.4/images/' + name);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  const provenance = await fetch(origin + '/assets/leaflet-1.9.4/SOURCE.json');
  assert.equal(provenance.status, 200); assert.match(provenance.headers.get('content-type'), /json/);
  assert.equal((await fetch(origin + '/assets/leaflet-1.9.4/LICENSE.txt')).status, 200);
  assert.equal((await fetch(origin + '/api/state')).status, 401, 'Public assets do not bypass operator authentication');
});

test('regional map policy permits only the selected OSM image host and keeps strict origin and referrer boundaries', async t => {
  const f = await fixture();
  const app = await createSupervisorServer({ core: f.core, operatorToken: 'static-policy-test-only' });
  const { origin } = await app.listen(0);
  t.after(async () => { await app.close(); await f.cleanup(); });
  const response = await fetch(origin);
  const directives = Object.fromEntries(response.headers.get('content-security-policy').split(';').map(value => value.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'https://tile.openstreetmap.org']);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal((await fetch(origin + '/interface.js', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  const wrongHost = await new Promise(resolve => { const request = httpRequest(origin + '/assets/leaflet-1.9.4/leaflet.js', { headers: { Host: 'attacker.invalid' } }, incoming => { incoming.resume(); resolve(incoming.statusCode); }); request.end(); });
  assert.equal(wrongHost, 403);
});
