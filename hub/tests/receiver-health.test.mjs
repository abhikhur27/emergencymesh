import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { receiverHealth } from '../src/receiver-health.mjs';
import { provision, loadConfig, createOperatorToken } from '../src/config.mjs';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { encodeRequest } from '../src/codec.mjs';

const healthy = { simulation: false, region: 1, keyId: 1, ai: { model: 'nemotron-3-nano:4b' }, incidents: [{ id: 'saved' }], link: { mode: 'serial', path: 'COM10', portOpen: false, connected: false, readiness: 'port-unavailable', board: null } };
test('owner dashboard health remains healthy with unplugged or unverified radio and reports RF readiness separately', () => {
  assert.deepEqual(receiverHealth(healthy, { serialPort: 'COM10' }), { radioReady: false, radioReadiness: 'port-unavailable', savedReports: 1 });
  for (const readiness of ['opening', 'awaiting-status', 'status-unavailable', 'profile-mismatch', 'radio-failed', 'port-closed', 'port-error']) {
    assert.equal(receiverHealth({ ...healthy, link: { ...healthy.link, readiness } }, { serialPort: 'COM10' }).radioReady, false);
  }
  const ready = { ...healthy, link: { ...healthy.link, portOpen: true, connected: true, readiness: 'ready', board: { node: 123, role: 'hub', region: 1, keyId: 1, frequency: 915, protocol: 1, radioReady: true } } };
  assert.equal(receiverHealth(ready, { serialPort: 'COM10' }).radioReady, true);
  assert.equal(receiverHealth({ ...ready, link: { ...ready.link, board: { ...ready.link.board, role: 'companion' } } }, { serialPort: 'COM10' }).radioReady, false);
  for (const change of [{ simulation: true }, { ai: { model: 'wrong' } }, { incidents: null }, { link: { ...healthy.link, path: 'COM11' } }, { link: { ...healthy.link, mode: 'simulation' } }]) assert.throws(() => receiverHealth({ ...healthy, ...change }, { serialPort: 'COM10' }), /dashboard check failed/);
});

test('normal CLI serves authenticated saved incidents while its exact configured USB port is missing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'em-unplugged-')); let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      if (child.connected) child.send({ type: 'shutdown' });
      const force = setTimeout(() => child.kill(), 5000); await exited; clearTimeout(force);
    }
    await rm(directory, { recursive: true, force: true });
  });
  const receipt = await provision(directory); const profile = JSON.parse(await readFile(receipt.phoneFile, 'utf8'));
  const config = await loadConfig(directory); const store = await new IncidentStore(directory).load();
  const core = new HubCore({ config, store, transmit: async () => {} });
  const request = { category: 8, severity: 3, people: 2, flags: 0, createdAt: Math.floor(Date.now() / 1000), latitude: 0, longitude: 0, accuracy: 65535, battery: 255, note: 'Saved report before USB disconnection.' };
  await core.ingest(encodeRequest(request, { region: profile.region, keyId: profile.keyId, origin: profile.origin, sequence: 1 }, Buffer.from(profile.keyHex, 'hex')));
  const { token } = await createOperatorToken(directory);
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const path = process.platform === 'win32' ? 'COM9999' : '/dev/rescuemesh-test-missing';
  const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
  child = fork(join(root, 'src', 'cli.mjs'), ['start', '--data', directory, '--serial', path, '--port', String(port), '--minutes', '0.1'], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const origin = `http://127.0.0.1:${port}`;
  let reachable = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) assert.fail('Normal hub exited while its USB port was absent');
    try { reachable = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(250) })).ok; } catch {}
    if (reachable) break; await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(reachable, true, 'dashboard starts without waiting for USB');
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: token }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } }); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.simulation, false); assert.equal(value.incidents.length, 1); assert.equal(value.incidents[0].request.note, request.note);
  assert.equal(value.link.path, path); assert.equal(value.link.mode, 'serial'); assert.equal(value.link.connected, false); assert.equal(value.link.portOpen, false); assert.equal(value.link.board, null); assert.ok(value.link.nextReconnectAt);
  assert.equal(child.exitCode, null); assert.equal(receiverHealth(value, { serialPort: path }).radioReady, false);
});
