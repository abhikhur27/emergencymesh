import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeRequest, encodeReceipt, decodeFrame, frameDigest } from '../src/codec.mjs';
import { initializeDeviceKeyring, registerDeviceProfile, createDeviceProfile, resolveDeviceKey,
  revokeDevice, publicDevices, deviceFingerprint, hasDeviceKeyring } from '../src/device-keyring.mjs';

// Public synthetic test identities/keys, never provisioning material.
const fixedTime = Date.UTC(2026, 10, 8, 7);
const profileA = { region: 7, keyId: 1, origin: 0x11111111, keyHex: '11'.repeat(32) };
const profileB = { region: 7, keyId: 1, origin: 0x22222222, keyHex: '22'.repeat(32) };
const request = { category: 5, severity: 3, people: 2, flags: 0, createdAt: fixedTime / 1000,
  latitude: 0, longitude: 0, accuracy: 65535, battery: 255, note: 'Synthetic supplies request' };
const envelope = (profile, sequence = 1) => ({ region: profile.region, origin: profile.origin, keyId: profile.keyId, sequence, hops: 3 });
const frameFor = (profile, value = request) => encodeRequest(value, envelope(profile), Buffer.from(profile.keyHex, 'hex'));

function enrolled() {
  const config = { version: 1, region: 7, keyId: 1, hubOrigin: 0x99999999, keyHex: '44'.repeat(32) };
  initializeDeviceKeyring(config);
  registerDeviceProfile(config, profileA, { label: 'Companion A', now: fixedTime });
  registerDeviceProfile(config, profileB, { label: 'Companion B', now: fixedTime });
  return config;
}

test('independent device keys preserve compact wire frames and isolate sibling devices', () => {
  const config = enrolled();
  const a = frameFor(profileA), b = frameFor(profileB);
  assert.deepEqual(decodeFrame(a, config).request, request);
  assert.deepEqual(decodeFrame(b, config).request, request);
  assert.throws(() => decodeFrame(a, profileB), { code: 'AUTH_FAILED' });
  assert.throws(() => decodeFrame(b, profileA), { code: 'AUTH_FAILED' });
  const maximum = frameFor(profileA, { ...request, note: 'x'.repeat(120) });
  assert.equal(maximum.length, 184);
  assert.equal(decodeFrame(maximum, config).request.note.length, 120);
  assert.ok(maximum.length <= 220);
});

test('relays can change only the hop count without owning a key', () => {
  const config = enrolled(), a = frameFor(profileA);
  const forwarded = Buffer.from(a); forwarded[14] = 0;
  assert.equal(frameDigest(forwarded), frameDigest(a));
  assert.deepEqual(decodeFrame(forwarded, config).request, request);
  assert.throws(() => decodeFrame(forwarded, { region: 7, keyId: 1, key: Buffer.alloc(32) }), { code: 'AUTH_FAILED' });
});

test('changing a visible origin or key slot cannot switch an authenticated identity', () => {
  const config = enrolled(), a = frameFor(profileA);
  const spoof = Buffer.from(a); spoof.writeUInt32LE(profileB.origin, 6);
  assert.throws(() => decodeFrame(spoof, config), { code: 'AUTH_FAILED' });
  const unknown = Buffer.from(a); unknown.writeUInt32LE(0x33333333, 6);
  assert.throws(() => decodeFrame(unknown, config), { code: 'UNKNOWN_DEVICE' });
  const otherSlot = Buffer.from(a); otherSlot[15] = 2;
  assert.throws(() => decodeFrame(otherSlot, config), { code: 'UNKNOWN_DEVICE' });
  registerDeviceProfile(config, { ...profileA, keyId: 2, keyHex: '55'.repeat(32) }, { now: fixedTime });
  assert.throws(() => decodeFrame(otherSlot, config), { code: 'AUTH_FAILED' });
});

test('a hub receipt uses the requesting device key, not the regional or sibling key', () => {
  const config = enrolled();
  const receipt = { requestOrigin: profileA.origin, requestSequence: 1, status: 1, text: 'Received by RescueMesh hub.' };
  const header = { region: 7, keyId: 1, origin: config.hubOrigin, sequence: 10, hops: 3 };
  const a = encodeReceipt(receipt, header, resolveDeviceKey(config, receipt.requestOrigin, header.keyId));
  assert.deepEqual(decodeFrame(a, profileA).receipt, receipt);
  assert.throws(() => decodeFrame(a, profileB), { code: 'AUTH_FAILED' });
  assert.throws(() => decodeFrame(a, { region: 7, keyId: 1, key: Buffer.from(config.keyHex, 'hex') }), { code: 'AUTH_FAILED' });
  assert.throws(() => decodeFrame(a, config), { code: 'UNKNOWN_PROFILE' });
});

test('revocation blocks new packets, including a retry, and cannot be undone by reimport', () => {
  const config = enrolled(), a = frameFor(profileA);
  assert.equal(decodeFrame(a, config).header.origin, profileA.origin);
  const revoked = revokeDevice(config, profileA.origin, 1, { now: fixedTime + 1000 });
  assert.equal(revoked.status, 'revoked');
  assert.throws(() => decodeFrame(a, config), { code: 'DEVICE_REVOKED' });
  assert.throws(() => resolveDeviceKey(config, profileA.origin, 1), { code: 'DEVICE_REVOKED' });
  assert.throws(() => registerDeviceProfile(config, profileA), { code: 'DEVICE_REVOKED' });
  assert.deepEqual(decodeFrame(frameFor(profileB), config).request, request);
});

test('key records serialize without plaintext device keys and survive a JSON restart', () => {
  const config = enrolled(), stored = JSON.stringify(config.devices);
  assert.equal(stored.includes(profileA.keyHex), false);
  assert.equal(stored.includes(profileB.keyHex), false);
  assert.equal(stored.includes('keyHex'), false);
  const restarted = JSON.parse(JSON.stringify(config));
  assert.deepEqual(decodeFrame(frameFor(profileA), restarted).request, request);
  assert.deepEqual(decodeFrame(frameFor(profileB), restarted).request, request);
});

test('key wrapping authenticates identity, label, provenance, fingerprint and revocation', () => {
  const original = enrolled();
  for (const change of [
    r => { r.label = 'Changed label'; },
    r => { r.fingerprint = '00'.repeat(32); },
    r => { r.legacy = true; },
    r => { r.createdAt = new Date(fixedTime + 1).toISOString(); },
    r => { r.wrappedKey.tagHex = '00'.repeat(16); },
    r => { r.origin += 1; r.deviceId = `${r.region}:${r.origin}:${r.keyId}`; },
  ]) {
    const corrupt = JSON.parse(JSON.stringify(original)); change(corrupt.devices[0]);
    assert.throws(() => resolveDeviceKey(corrupt, corrupt.devices[0].origin, 1), { code: 'KEY_RECORD_AUTH_FAILED' });
  }
  const revoked = JSON.parse(JSON.stringify(original));
  revokeDevice(revoked, profileA.origin, 1, { now: fixedTime + 1 });
  revoked.devices[0].revokedAt = null;
  assert.throws(() => resolveDeviceKey(revoked, profileA.origin, 1), { code: 'KEY_RECORD_AUTH_FAILED' });
});

test('wrong or absent wrapping master fails closed without regional fallback', () => {
  const original = enrolled();
  const corrupt = JSON.parse(JSON.stringify(original)); corrupt.deviceWrappingKeyHex = 'ee'.repeat(32);
  assert.throws(() => decodeFrame(frameFor(profileA), corrupt), { code: 'KEY_RECORD_AUTH_FAILED' });
  const missing = JSON.parse(JSON.stringify(original)); delete missing.deviceWrappingKeyHex;
  assert.throws(() => initializeDeviceKeyring(missing));
  assert.throws(() => decodeFrame(frameFor(profileA), missing));
  assert.throws(() => decodeFrame(frameFor(profileA), { region: 7, keyId: 1, key: Buffer.from(profileA.keyHex, 'hex'), devices: [] }));
});

test('only explicitly registered legacy identities can use the old regional key', () => {
  const config = { region: 7, hubOrigin: 0x99999999, keyId: 1, keyHex: '66'.repeat(32) };
  initializeDeviceKeyring(config);
  const known = { ...profileA, keyHex: config.keyHex }, stranger = { ...profileB, keyHex: config.keyHex };
  registerDeviceProfile(config, known, { legacy: true, label: 'Migrated existing phone', now: fixedTime });
  assert.deepEqual(decodeFrame(frameFor(known), config).request, request);
  assert.throws(() => decodeFrame(frameFor(stranger), config), { code: 'UNKNOWN_DEVICE' });
  const modern = createDeviceProfile(config, { keyId: 1, now: fixedTime });
  assert.notEqual(modern.profile.keyHex, known.keyHex);
  assert.throws(() => decodeFrame(frameFor(modern.profile), known), { code: 'AUTH_FAILED' });
  assert.deepEqual(decodeFrame(frameFor(modern.profile), config).request, request);
});

test('legacy reuse is labeled and explicit; new identities cannot reuse another device key', () => {
  const config = enrolled();
  assert.throws(() => registerDeviceProfile(config, { ...profileA, origin: 0x33333333 }), { code: 'DEVICE_KEY_REUSE' });
  assert.throws(() => registerDeviceProfile(config, { ...profileA, origin: 0x33333333 }, { legacy: true }), { code: 'DEVICE_KEY_REUSE' });
  const legacy = { region: 7, hubOrigin: 0x99999999, keyId: 1 };
  registerDeviceProfile(legacy, profileA, { legacy: true, now: fixedTime });
  registerDeviceProfile(legacy, { ...profileA, origin: profileB.origin }, { legacy: true, now: fixedTime });
  assert.equal(publicDevices(legacy).every(device => device.legacy), true);
  assert.throws(() => registerDeviceProfile(legacy, { ...profileA, origin: 0x33333333 }), { code: 'DEVICE_KEY_REUSE' });
});

test('enrollment is idempotent, rejects identity replacement and never exposes wrapping material', () => {
  const config = enrolled(), before = JSON.stringify(config.devices);
  const safe = registerDeviceProfile(config, profileA, { label: 'Ignored reimport rename', now: fixedTime + 1000 });
  assert.equal(JSON.stringify(config.devices), before);
  assert.equal(safe.label, 'Companion A');
  assert.throws(() => registerDeviceProfile(config, { ...profileA, keyHex: '77'.repeat(32) }), { code: 'DEVICE_KEY_CONFLICT' });
  for (const device of publicDevices(config)) {
    assert.equal(device.status, 'active'); assert.equal(Object.hasOwn(device, 'wrappedKey'), false);
    assert.equal(Object.hasOwn(device, 'keyHex'), false); assert.equal(Object.hasOwn(device, 'deviceWrappingKeyHex'), false);
  }
});

test('fresh profiles have unique keys and identities while retaining the firmware key slot', () => {
  const config = { region: 7, keyId: 1, hubOrigin: 0x99999999, keyHex: '44'.repeat(32) };
  const a = createDeviceProfile(config, { label: 'A', now: fixedTime });
  const b = createDeviceProfile(config, { label: 'B', now: fixedTime });
  assert.equal(a.profile.keyId, 1); assert.equal(b.profile.keyId, 1);
  assert.notEqual(a.profile.origin, b.profile.origin); assert.notEqual(a.profile.keyHex, b.profile.keyHex);
  assert.notEqual(config.deviceWrappingKeyHex, config.keyHex);
  assert.notEqual(config.deviceWrappingKeyHex, a.profile.keyHex);
  assert.equal(a.device.fingerprint, deviceFingerprint(a.profile.keyHex));
  const digestAsKey = createHash('sha256').update(Buffer.from(a.profile.keyHex, 'hex')).digest();
  assert.throws(() => decodeFrame(frameFor(a.profile), { region: 7, keyId: 1, key: digestAsKey }), { code: 'AUTH_FAILED' });
});

test('invalid enrollment and partial/corrupt registry shapes reject rather than downgrade', () => {
  const config = enrolled();
  for (const profile of [{ ...profileA, region: 8 }, { ...profileA, origin: 0 }, { ...profileA, keyId: 0 },
    { ...profileA, keyHex: 'bad' }, { ...profileA, key: Buffer.alloc(32) }]) assert.throws(() => registerDeviceProfile(config, profile));
  assert.throws(() => registerDeviceProfile(config, { ...profileA, origin: 123 }, { label: 'bad\nlabel' }));
  assert.throws(() => registerDeviceProfile(config, { ...profileA, origin: 123 }, { label: '\ud800' }));
  const duplicate = JSON.parse(JSON.stringify(config)); duplicate.devices.push(duplicate.devices[0]);
  assert.throws(() => resolveDeviceKey(duplicate, profileA.origin, 1));
  const reRegion = JSON.parse(JSON.stringify(config)); reRegion.region = 8;
  assert.throws(() => resolveDeviceKey(reRegion, profileA.origin, 1));
  assert.equal(hasDeviceKeyring({ region: 7, devices: [] }), true);
  assert.equal(hasDeviceKeyring({ region: 7, keyId: 1, key: Buffer.alloc(32) }), false);
  assert.throws(() => initializeDeviceKeyring({ region: 7, keyHex: '11'.repeat(32), deviceWrappingKeyHex: '11'.repeat(32) }));
});
