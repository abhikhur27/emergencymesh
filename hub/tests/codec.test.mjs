import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCipheriv } from 'node:crypto';
import { encodeRequest, encodeReceipt, decodeFrame, inspectEnvelope, frameDigest, decodeBase64 } from '../src/codec.mjs';

const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const nonce = Buffer.from(Array.from({ length: 12 }, (_, index) => index));
const envelope = { region: 1, keyId: 1, origin: 0x01020304, sequence: 42, hops: 3 };
const profile = { region: 1, keyId: 1, key };
const request = { category: 1, severity: 1, people: 2, flags: 1, createdAt: 1794000000,
  latitude: 32.9858, longitude: -96.7501, accuracy: 12, battery: 77, note: 'Test request' };

function mutatePlaintext(frame, fn) {
  const { request: decoded } = decodeFrame(frame, profile);
  const raw = Buffer.alloc(20 + Buffer.byteLength(decoded.note));
  raw[0] = decoded.category; raw[1] = decoded.severity; raw[2] = decoded.people; raw[3] = decoded.flags;
  raw.writeUInt32LE(decoded.createdAt, 4); raw.writeInt32LE(Math.round(decoded.latitude * 1e5), 8);
  raw.writeInt32LE(Math.round(decoded.longitude * 1e5), 12); raw.writeUInt16LE(decoded.accuracy, 16);
  raw[18] = decoded.battery; raw[19] = Buffer.byteLength(decoded.note); raw.write(decoded.note, 20);
  fn(raw);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.concat([frame.subarray(0, 14), frame.subarray(15, 16)]));
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return Buffer.concat([frame.subarray(0, 16), nonce, ciphertext, cipher.getAuthTag()]);
}

test('request and receipt round trip exactly using compact wire contract', () => {
  const frame = encodeRequest(request, envelope, key, nonce);
  assert.equal(frame.length, 76);
  assert.deepEqual(decodeFrame(frame, profile), { header: { type: 1, ...envelope }, request });
  const receipt = { requestOrigin: envelope.origin, requestSequence: 42, status: 1, text: 'Hub received' };
  const ackEnvelope = { ...envelope, origin: 0x05060708, sequence: 7 };
  assert.deepEqual(decodeFrame(encodeReceipt(receipt, ackEnvelope, key, nonce), profile), {
    header: { type: 2, ...ackEnvelope }, receipt,
  });
});

test('only hop byte is mutable; changes to ciphertext, nonce and authenticated header fail', () => {
  const frame = encodeRequest(request, envelope, key, nonce);
  const forwarded = Buffer.from(frame); forwarded[14] = 0;
  assert.deepEqual(decodeFrame(forwarded, profile).request, request);
  assert.equal(frameDigest(frame), frameDigest(forwarded));
  for (const index of [6, 10, 16, 28, frame.length - 1]) {
    const bad = Buffer.from(frame); bad[index] ^= 1;
    assert.throws(() => decodeFrame(bad, profile), { code: 'AUTH_FAILED' });
  }
  const badHops = Buffer.from(frame); badHops[14] = 5;
  assert.throws(() => inspectEnvelope(badHops));
});

test('envelope/profile rejection happens for invalid versions, type, region, key and sizes', () => {
  const frame = encodeRequest(request, envelope, key, nonce);
  for (const [index, value] of [[0, 0], [2, 2], [3, 3]]) {
    const bad = Buffer.from(frame); bad[index] = value; assert.throws(() => inspectEnvelope(bad));
  }
  assert.throws(() => decodeFrame(frame, { ...profile, region: 2 }), { code: 'UNKNOWN_PROFILE' });
  assert.throws(() => decodeFrame(frame, { ...profile, keyId: 2 }), { code: 'UNKNOWN_PROFILE' });
  assert.throws(() => decodeFrame(frame, { ...profile, key: Buffer.alloc(32, 7) }), { code: 'AUTH_FAILED' });
  assert.throws(() => inspectEnvelope(Buffer.alloc(221)));
  assert.throws(() => inspectEnvelope(frame.subarray(0, 50)));
  assert.throws(() => encodeRequest(request, { ...envelope, origin: -1 }, key));
  assert.throws(() => encodeRequest(request, { ...envelope, sequence: 1.5 }, key));
  assert.throws(() => encodeRequest(request, envelope, Buffer.alloc(16)));
  assert.throws(() => encodeRequest(request, envelope, key, Buffer.alloc(8)));
});

test('note limits count UTF-8 bytes and reject broken Unicode instead of truncating', () => {
  const allowed = { ...request, note: '🛰️'.repeat(17) };
  assert.deepEqual(decodeFrame(encodeRequest(allowed, envelope, key), profile).request, allowed);
  assert.equal(encodeRequest({ ...request, note: 'x'.repeat(120) }, envelope, key).length, 184);
  for (const note of ['x'.repeat(121), '🛰️'.repeat(18), '\ud800']) {
    assert.throws(() => encodeRequest({ ...request, note }, envelope, key));
  }
  const frame = encodeRequest(request, envelope, key, nonce);
  assert.throws(() => decodeFrame(mutatePlaintext(frame, raw => { raw[20] = 0xff; }), profile));
  assert.throws(() => decodeFrame(mutatePlaintext(frame, raw => { raw[19] -= 1; }), profile));
});

test('valid encryption cannot hide invalid semantic field values', () => {
  const frame = encodeRequest(request, envelope, key, nonce);
  for (const [index, value] of [[0, 0], [0, 6], [1, 4], [2, 0], [3, 16], [18, 101]]) {
    assert.throws(() => decodeFrame(mutatePlaintext(frame, raw => { raw[index] = value; }), profile));
  }
  assert.throws(() => decodeFrame(mutatePlaintext(frame, raw => { raw.writeInt32LE(9000001, 8); }), profile));
  assert.throws(() => decodeFrame(mutatePlaintext(frame, raw => { raw[3] = 0; }), profile));
});

test('unknown-location sentinel and coordinate boundaries are exact', () => {
  const unknown = { ...request, flags: 0, latitude: 0, longitude: 0, accuracy: 65535, battery: 255 };
  assert.deepEqual(decodeFrame(encodeRequest(unknown, envelope, key), profile).request, unknown);
  assert.throws(() => encodeRequest({ ...unknown, accuracy: 0 }, envelope, key));
  assert.throws(() => encodeRequest({ ...unknown, latitude: 1 }, envelope, key));
  for (const invalid of [{ latitude: NaN }, { longitude: Infinity }, { latitude: 90.00001 }, { longitude: -180.00001 },
    { battery: 101 }, { createdAt: -1 }, { flags: 16 }, { people: 0 }, { accuracy: -1 }]) {
    assert.throws(() => encodeRequest({ ...request, ...invalid }, envelope, key));
  }
  const poles = { ...request, latitude: -90, longitude: 180, accuracy: 65535 };
  assert.deepEqual(decodeFrame(encodeRequest(poles, envelope, key), profile).request, poles);
});

test('receipt max text, valid statuses and canonical base64 checks', () => {
  const receipt = { requestOrigin: 42, requestSequence: 12, status: 2, text: 'r'.repeat(80) };
  const frame = encodeReceipt(receipt, envelope, key);
  assert.equal(frame.length, 134);
  assert.deepEqual(decodeFrame(frame, profile).receipt, receipt);
  assert.deepEqual(decodeBase64(frame.toString('base64')), frame);
  for (const value of [null, '', 'YQ', 'YQ===', ' YQ==', 'YQ==\n', 'YR==', 'a'.repeat(300)]) assert.throws(() => decodeBase64(value));
  assert.throws(() => encodeReceipt({ ...receipt, status: 3 }, envelope, key));
  assert.throws(() => encodeReceipt({ ...receipt, text: 'r'.repeat(81) }, envelope, key));
});

test('fresh encodings get random nonces; retransmit uses the existing frame', () => {
  const a = encodeRequest(request, envelope, key); const b = encodeRequest(request, envelope, key);
  assert.notDeepEqual(a.subarray(16, 28), b.subarray(16, 28));
  assert.notEqual(frameDigest(a), frameDigest(b));
});

test('public golden vectors remain byte-exact for cross-language verification', () => {
  const golden = JSON.parse(readFileSync(new URL('../fixtures/golden-v1.json', import.meta.url), 'utf8'));
  assert.equal(encodeRequest(golden.request, golden.requestEnvelope, Buffer.from(golden.keyHex, 'hex'), Buffer.from(golden.nonceHex, 'hex')).toString('hex'), golden.requestFrameHex);
  assert.equal(encodeReceipt(golden.receipt, golden.receiptEnvelope, Buffer.from(golden.keyHex, 'hex'), Buffer.from(golden.receiptNonceHex, 'hex')).toString('hex'), golden.receiptFrameHex);
  assert.deepEqual(decodeFrame(Buffer.from(golden.requestFrameHex, 'hex'), profile).request, golden.request);
});
