import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { IdentityStore } from '../src/identity-store.mjs';
import { createOperatorToken, provision, loadConfig, prepareDeviceRegistry, saveConfig } from '../src/config.mjs';
import { resolveDeviceKey, revokeDevice, publicDevices } from '../src/device-keyring.mjs';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { createHubServer } from '../src/server.mjs';
import { loadRegionProfile } from '../src/region.mjs';

async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'rescuemesh-identity-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('saved operator credential remains constant and malformed saved credentials are never silently replaced', async t => {
  const dir = await directory(t); const first = await createOperatorToken(dir); const second = await createOperatorToken(dir);
  assert.equal(first.token, second.token); await writeFile(first.tokenFile, 'invalid\n');
  await assert.rejects(createOperatorToken(dir), /explicit rotation required/); assert.equal(await readFile(first.tokenFile, 'utf8'), 'invalid\n');
});
test('stable region profile boots from the public gazetteer and never overwrites a saved private profile', async t => {
  const dir = await directory(t); const profile = await loadRegionProfile(dir);
  assert.equal(profile.name, 'UT Dallas'); assert.equal(profile.frequencyMHz, 915); assert.equal(profile.timeZone, 'America/Chicago'); assert.ok(profile.landmarks.some(l => l.id === 'hh' && l.x >= 0 && l.x <= 100));
  assert.equal(profile.landmarks.some(l => 'latitude' in l || 'longitude' in l), false);
  const file = join(dir, 'region-profile.json'); const custom = { ...profile, name: 'Saved campus profile' }; await writeFile(file, JSON.stringify(custom));
  assert.equal((await loadRegionProfile(dir)).name, 'Saved campus profile'); await writeFile(file, '{"version":9}');
  await assert.rejects(loadRegionProfile(dir), /refusing replacement/); assert.equal(await readFile(file, 'utf8'), '{"version":9}');
});
test('remembered sessions survive reload, persist only hashed IDs, and revocation survives another reload', async t => {
  const dir = await directory(t); const { token } = await createOperatorToken(dir);
  let identity = await new IdentityStore(dir, { operatorToken: token }).load();
  assert.equal(identity.authenticate({ username: 'operator', password: token }), true);
  assert.equal(identity.authenticate({ username: 'other', password: token }), false);
  const session = await identity.createSession(); assert.equal(session.maxAge, 365 * 86400);
  const raw = await readFile(join(dir, 'identity-store.json'), 'utf8'); assert.equal(raw.includes(token), false); assert.equal(raw.includes(session.id), false);
  await identity.close(); identity = await new IdentityStore(dir, { operatorToken: token }).load();
  assert.equal(identity.getSession(session.id).csrf, session.csrf); await identity.revoke(session.id); await identity.close();
  identity = await new IdentityStore(dir, { operatorToken: token }).load(); assert.equal(identity.getSession(session.id), null); await identity.close();
});
test('HTTP browser cookie remains signed in after server replacement and logout stays revoked', async t => {
  const dir = await directory(t); const { token } = await createOperatorToken(dir);
  const config = { region: 1, keyId: 1, key: randomBytes(32), hubOrigin: 456 }; const store = await new IncidentStore(dir).load(); const core = new HubCore({ config, store });
  let app = createHubServer({ core, config, operatorToken: token }); let { origin } = await app.listen(0);
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: token, remember: true }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0]; const { csrf } = await login.json(); await app.close();
  app = createHubServer({ core, config, operatorToken: token }); ({ origin } = await app.listen(0));
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${origin}/api/logout`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}' })).status, 200); await app.close();
  app = createHubServer({ core, config, operatorToken: token }); ({ origin } = await app.listen(0));
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 401); await app.close();
});
test('provisioned profiles are distinct, legacy migration is explicit, and revoked private files cannot reactivate a phone', async t => {
  const dir = await directory(t); const first = await provision(dir); const p1 = JSON.parse(await readFile(first.phoneFile, 'utf8')); const second = await provision(dir); const p2 = JSON.parse(await readFile(second.phoneFile, 'utf8'));
  assert.notEqual(p1.origin, p2.origin); assert.notEqual(p1.keyHex, p2.keyHex); assert.equal(p1.keyId, p2.keyId);
  let config = await loadConfig(dir); const legacy = { region: config.region, keyId: config.keyId, origin: 918, keyHex: config.keyHex }; await writeFile(join(dir, 'phone-profile-legacy.json'), JSON.stringify(legacy));
  await prepareDeviceRegistry(dir, config); assert.equal(resolveDeviceKey(config, legacy.origin, legacy.keyId).toString('hex'), config.keyHex);
  assert.equal(publicDevices(config).find(d => d.origin === legacy.origin).legacy, true);
  revokeDevice(config, p1.origin, p1.keyId); await saveConfig(dir, config); config = await loadConfig(dir); await prepareDeviceRegistry(dir, config);
  assert.throws(() => resolveDeviceKey(config, p1.origin, p1.keyId), /revoked/); assert.equal(resolveDeviceKey(config, p2.origin, p2.keyId).toString('hex'), p2.keyHex);
});
test('Mongo adapter stores users, session hashes and public device metadata; offline failure keeps local auth usable', async t => {
  const dir = await directory(t); const { token } = await createOperatorToken(dir); const writes = [];
  const db = { collection: name => ({ createIndex: async () => {}, deleteMany: async () => {}, replaceOne: async (query, value) => { writes.push({ name, value }); } }) };
  const client = { connect: async () => {}, db: () => db, close: async () => {} };
  const identity = await new IdentityStore(dir, { operatorToken: token, mongoUri: 'mongodb://private-unprinted', mongoFactory: async () => client }).load();
  // Let the initial nonblocking mirror settle, then force an exact current-state sync.
  while (identity.mongoBusy) await new Promise(resolve => setTimeout(resolve, 5));
  const session = await identity.createSession(); await identity.setDevices([{ origin: 17, keyId: 1, fingerprint: 'f'.repeat(64), status: 'active' }]); await identity.syncMongo({ force: true });
  assert.equal(identity.status().mode, 'mongodb'); assert.ok(writes.some(w => w.name === 'users')); assert.ok(writes.some(w => w.name === 'sessions')); assert.ok(writes.some(w => w.name === 'devices'));
  assert.equal(JSON.stringify(writes).includes(token), false); assert.equal(JSON.stringify(writes).includes(session.id), false); assert.equal(JSON.stringify(writes).includes('wrappedKey'), false); await identity.close();
  const offline = await new IdentityStore(dir, { operatorToken: token, mongoUri: 'mongodb://unavailable', mongoFactory: async () => { throw new Error('private URI must not surface'); } }).load();
  while (offline.mongoBusy) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(offline.authenticate({ token }), true); assert.equal(offline.getSession(session.id).csrf, session.csrf); assert.equal(offline.status().connected, false); assert.doesNotMatch(offline.status().error, /URI/); await offline.close();
});
