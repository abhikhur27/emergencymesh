import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { createHubServer } from '../src/server.mjs';

test('local entrypoint dependencies load before sign-in while API state remains protected', async t => {
  const root = fileURLToPath(new URL('../../../.validation/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'local-static-test-'));
  const config = { region: 4207, keyId: 1, key: Buffer.alloc(32, 0x53), hubOrigin: 9000 };
  const core = new HubCore({ config, store: await new IncidentStore(directory).load(), standaloneSummary: false });
  const app = createHubServer({ core, config, operatorToken: 'static-route-test-only' });
  const { origin } = await app.listen(0);
  t.after(async () => { await app.close(); assert.ok(directory.startsWith(join(root, 'local-static-test-'))); await rm(directory, { recursive: true, force: true }); });
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /src="\/app\.js"/);
  assert.match(html, /href="\/style\.css"/);
  assert.match(html, /href="\/assets\/leaflet-1\.9\.4\/leaflet\.css"/);
  assert.match(html, /src="\/assets\/leaflet-1\.9\.4\/leaflet\.js"/);
  for (const path of ['/app.js', '/location-map.js', '/campus-map.js', '/map-geometry.js', '/ops-metrics.js', '/reception-data.js', '/view-selection.js', '/assets/leaflet-1.9.4/leaflet.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /javascript/, path);
    assert.ok((await response.text()).length > 50, path);
  }
  const campus = await fetch(origin + '/assets/campus-map.svg');
  assert.equal(campus.status, 200); assert.match(campus.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await campus.text(), /<svg/);
  const geometry = await fetch(origin + '/assets/campus-map.json');
  assert.equal(geometry.status, 200); assert.match(geometry.headers.get('content-type'), /json/);
  assert.equal(typeof await geometry.json(), 'object');
  assert.equal(home.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  const csp = Object.fromEntries(home.headers.get('content-security-policy').split(';').map(value => value.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]));
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['connect-src'], ["'self'"]);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'https://tile.openstreetmap.org']);
  const css = await fetch(origin + '/assets/leaflet-1.9.4/leaflet.css'); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  for (const name of ['layers-2x.png', 'layers.png', 'marker-icon-2x.png', 'marker-icon.png', 'marker-shadow.png']) {
    const response = await fetch(origin + '/assets/leaflet-1.9.4/images/' + name); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.equal((await fetch(origin + '/assets/leaflet-1.9.4/LICENSE.txt')).status, 200);
  assert.equal((await fetch(origin + '/assets/leaflet-1.9.4/SOURCE.json')).status, 200);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(origin + '/api/state')).status, 401);
  assert.equal((await fetch(origin + '/app.js', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
});
