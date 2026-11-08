import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { hasDeviceKeyring, resolveDeviceKey } from './device-keyring.mjs';

export const MAX_FRAME_BYTES = 220;
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message, code = 'INVALID_FRAME') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`Invalid ${name}`, 'VALIDATION_ERROR');
  return value;
}

function bytes(value, length, name) {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail(`Invalid ${name}`, 'VALIDATION_ERROR');
  return Buffer.from(value);
}

function textBytes(value, max, name) {
  if (typeof value !== 'string') fail(`Invalid ${name}`, 'VALIDATION_ERROR');
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > max || decoder.decode(encoded) !== value) fail(`Invalid ${name}`, 'VALIDATION_ERROR');
  return encoded;
}

function readText(value) {
  try { return decoder.decode(value); } catch { fail('Invalid UTF-8'); }
}

function associatedData(header) {
  return Buffer.concat([header.subarray(0, 14), header.subarray(15, 16)]);
}

function makeHeader(type, envelope) {
  if (!envelope || typeof envelope !== 'object') fail('Invalid envelope', 'VALIDATION_ERROR');
  const header = Buffer.alloc(16);
  header.write('EM', 0, 'ascii');
  header[2] = 1;
  header[3] = type;
  header.writeUInt16LE(integer(envelope.region, 0, 65535, 'region'), 4);
  header.writeUInt32LE(integer(envelope.origin, 0, 0xffffffff, 'origin'), 6);
  header.writeUInt32LE(integer(envelope.sequence, 0, 0xffffffff, 'sequence'), 10);
  header[14] = integer(envelope.hops ?? 3, 0, 4, 'hops');
  header[15] = integer(envelope.keyId ?? 1, 0, 255, 'key ID');
  return header;
}

function seal(type, plaintext, envelope, key, nonce) {
  const header = makeHeader(type, envelope);
  const iv = nonce === undefined ? randomBytes(12) : bytes(nonce, 12, 'nonce');
  const cipher = createCipheriv('aes-256-gcm', bytes(key, 32, 'key'), iv);
  cipher.setAAD(associatedData(header));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const frame = Buffer.concat([header, iv, ciphertext, cipher.getAuthTag()]);
  if (frame.length > MAX_FRAME_BYTES) fail('Frame too large', 'VALIDATION_ERROR');
  return frame;
}

/** Encode degrees into the compact request payload. Optional nonce is for fixed test vectors only. */
export function encodeRequest(request, envelope, key, nonce) {
  if (!request || typeof request !== 'object') fail('Invalid request', 'VALIDATION_ERROR');
  const note = textBytes(request.note, 120, 'note');
  const payload = Buffer.alloc(20 + note.length);
  payload[0] = integer(request.category, 1, 8, 'category');
  payload[1] = integer(request.severity, 1, 3, 'severity');
  payload[2] = integer(request.people, 1, 255, 'people');
  payload[3] = integer(request.flags, 0, 255, 'flags');
  payload.writeUInt32LE(integer(request.createdAt, 0, 0xffffffff, 'created timestamp'), 4);
  const known = (request.flags & 1) !== 0;
  if (known) {
    if (typeof request.latitude !== 'number' || !Number.isFinite(request.latitude) || Math.abs(request.latitude) > 90
      || typeof request.longitude !== 'number' || !Number.isFinite(request.longitude) || Math.abs(request.longitude) > 180) {
      fail('Invalid coordinates', 'VALIDATION_ERROR');
    }
    payload.writeInt32LE(Math.round(request.latitude * 1e5), 8);
    payload.writeInt32LE(Math.round(request.longitude * 1e5), 12);
    payload.writeUInt16LE(integer(request.accuracy, 0, 65535, 'accuracy'), 16);
  } else {
    if (request.latitude !== 0 || request.longitude !== 0 || request.accuracy !== 65535) {
      fail('Unknown location must use zero coordinates and unknown accuracy', 'VALIDATION_ERROR');
    }
    payload.writeUInt16LE(65535, 16);
  }
  payload[18] = integer(request.battery, 0, 255, 'battery');
  if (request.battery > 100 && request.battery !== 255) fail('Invalid battery', 'VALIDATION_ERROR');
  payload[19] = note.length;
  note.copy(payload, 20);
  return seal(1, payload, envelope, key, nonce);
}

/** Encode a hub receipt; status 1/2 never means services were dispatched. */
export function encodeReceipt(receipt, envelope, key, nonce) {
  if (!receipt || typeof receipt !== 'object') fail('Invalid receipt', 'VALIDATION_ERROR');
  const text = textBytes(receipt.text, 80, 'receipt text');
  const payload = Buffer.alloc(10 + text.length);
  payload.writeUInt32LE(integer(receipt.requestOrigin, 0, 0xffffffff, 'request origin'), 0);
  payload.writeUInt32LE(integer(receipt.requestSequence, 0, 0xffffffff, 'request sequence'), 4);
  payload[8] = integer(receipt.status, 1, 2, 'receipt status');
  payload[9] = text.length;
  text.copy(payload, 10);
  return seal(2, payload, envelope, key, nonce);
}

/** Validate visible framing only. This does not authenticate the sender or ciphertext. */
export function inspectEnvelope(value) {
  if (!(value instanceof Uint8Array)) fail('Frame must be bytes');
  const frame = Buffer.from(value);
  if (frame.length < 44 || frame.length > MAX_FRAME_BYTES) fail('Invalid frame length');
  if (frame[0] !== 0x45 || frame[1] !== 0x4d || frame[2] !== 1) fail('Invalid protocol header');
  if (frame[3] !== 1 && frame[3] !== 2) fail('Invalid frame type');
  if (frame[14] > 4) fail('Invalid hop limit');
  if ((frame[3] === 1 && (frame.length < 64 || frame.length > 184))
    || (frame[3] === 2 && (frame.length < 54 || frame.length > 134))) fail('Invalid payload size');
  return {
    type: frame[3], region: frame.readUInt16LE(4), origin: frame.readUInt32LE(6),
    sequence: frame.readUInt32LE(10), hops: frame[14], keyId: frame[15],
  };
}

function parseRequest(payload) {
  if (payload.length < 20 || payload.length > 140 || payload.length !== 20 + payload[19]) fail('Invalid request length');
  const request = {
    category: payload[0], severity: payload[1], people: payload[2], flags: payload[3],
    createdAt: payload.readUInt32LE(4), latitude: payload.readInt32LE(8) / 1e5,
    longitude: payload.readInt32LE(12) / 1e5, accuracy: payload.readUInt16LE(16),
    battery: payload[18], note: readText(payload.subarray(20)),
  };
  // Reuse canonical domain validation, without generating ciphertext or a fresh nonce.
  integer(request.category, 1, 8, 'category');
  integer(request.severity, 1, 3, 'severity');
  integer(request.people, 1, 255, 'people');
  integer(request.flags, 0, 255, 'flags');
  if (payload[19] > 120) fail('Invalid note length');
  if (request.battery > 100 && request.battery !== 255) fail('Invalid battery');
  if (request.flags & 1) {
    if (Math.abs(request.latitude) > 90 || Math.abs(request.longitude) > 180) fail('Invalid coordinates');
  } else if (request.latitude !== 0 || request.longitude !== 0 || request.accuracy !== 65535) {
    fail('Invalid unknown-location encoding');
  }
  return request;
}

function parseReceipt(payload) {
  if (payload.length < 10 || payload.length > 90 || payload.length !== 10 + payload[9] || payload[9] > 80) fail('Invalid receipt length');
  if (payload[8] !== 1 && payload[8] !== 2) fail('Invalid receipt status');
  return {
    requestOrigin: payload.readUInt32LE(0), requestSequence: payload.readUInt32LE(4),
    status: payload[8], text: readText(payload.subarray(10)),
  };
}

/** Authenticate first, then return validated semantic content. Never use inspectEnvelope as authentication. */
export function decodeFrame(value, profile) {
  const header = inspectEnvelope(value);
  if (!profile || header.region !== profile.region) fail('Unknown region or key ID', 'UNKNOWN_PROFILE');
  let key;
  if (hasDeviceKeyring(profile)) {
    // A receipt's visible origin is the hub, not its recipient. Decode receipts using the recipient's explicit profile.
    if (header.type !== 1) fail('Receipt decoding requires an explicit recipient profile', 'UNKNOWN_PROFILE');
    key = resolveDeviceKey(profile, header.origin, header.keyId);
  } else {
    if (header.keyId !== profile.keyId) fail('Unknown region or key ID', 'UNKNOWN_PROFILE');
    key = bytes(profile.key ?? (typeof profile.keyHex === 'string' && /^[0-9a-f]{64}$/i.test(profile.keyHex) ? Buffer.from(profile.keyHex, 'hex') : undefined), 32, 'key');
  }
  const frame = Buffer.from(value);
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, frame.subarray(16, 28));
    decipher.setAAD(associatedData(frame.subarray(0, 16)));
    decipher.setAuthTag(frame.subarray(-16));
    plaintext = Buffer.concat([decipher.update(frame.subarray(28, -16)), decipher.final()]);
  } catch { fail('Authentication failed', 'AUTH_FAILED'); }
  return header.type === 1 ? { header, request: parseRequest(plaintext) } : { header, receipt: parseReceipt(plaintext) };
}

/** Stable identity digest across forwarding hops; ciphertext/nonce/header remain covered. */
export function frameDigest(value) {
  inspectEnvelope(value);
  const normalized = Buffer.from(value);
  normalized[14] = 0;
  return createHash('sha256').update(normalized).digest('hex');
}

export function decodeBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 296 || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('Invalid base64');
  const frame = Buffer.from(value, 'base64');
  if (frame.toString('base64') !== value || frame.length > MAX_FRAME_BYTES) fail('Invalid base64');
  return frame;
}
