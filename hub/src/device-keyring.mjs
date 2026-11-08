import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_DEVICES = 4096;
const HEX_KEY = /^[0-9a-f]{64}$/i;

function fail(message, code = 'INVALID_KEYRING') {
  const error = new Error(message); error.code = code; throw error;
}

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`Invalid ${name}`);
  return value;
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function keyBytes(value, name = 'device key') {
  if (typeof value === 'string' && HEX_KEY.test(value)) return Buffer.from(value, 'hex');
  if (value instanceof Uint8Array && value.byteLength === 32) return Buffer.from(value);
  fail(`Invalid ${name}`);
}

function timestamp(value = Date.now()) {
  const supplied = typeof value === 'function' ? value() : value;
  const date = supplied instanceof Date ? supplied : new Date(supplied);
  if (!Number.isFinite(date.getTime())) fail('Invalid enrollment time');
  return date.toISOString();
}

function labelText(value, origin) {
  const label = value === undefined ? `Device ${origin.toString(16).padStart(8, '0')}` : value;
  if (typeof label !== 'string' || !label.trim() || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)
    || Buffer.from(label, 'utf8').toString('utf8') !== label) fail('Invalid device label');
  return label.trim().normalize('NFC');
}

function identity(region, origin, keyId) { return `${region}:${origin}:${keyId}`; }

/** A recognition fingerprint is public metadata, never an encryption key or proof of hardware possession. */
export function deviceFingerprint(value) {
  return createHash('sha256').update(keyBytes(value)).digest('hex');
}

function validateRecord(record, region) {
  if (!object(record) || record.version !== 1 || record.region !== region) fail('Invalid device record');
  integer(record.origin, 1, 0xffffffff, 'device origin');
  integer(record.keyId, 1, 255, 'device key ID');
  if (record.deviceId !== identity(region, record.origin, record.keyId)
    || typeof record.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(record.fingerprint)
    || typeof record.legacy !== 'boolean' || labelText(record.label, record.origin) !== record.label
    || timestamp(record.createdAt) !== record.createdAt
    || (record.revokedAt !== null && timestamp(record.revokedAt) !== record.revokedAt)) fail('Invalid device metadata');
  const wrapped = record.wrappedKey;
  if (!object(wrapped) || wrapped.algorithm !== 'aes-256-gcm'
    || typeof wrapped.nonceHex !== 'string' || !/^[0-9a-f]{24}$/.test(wrapped.nonceHex)
    || typeof wrapped.ciphertextHex !== 'string' || !/^[0-9a-f]{64}$/.test(wrapped.ciphertextHex)
    || typeof wrapped.tagHex !== 'string' || !/^[0-9a-f]{32}$/.test(wrapped.tagHex)) fail('Invalid wrapped device key');
  return record;
}

function metadata(record) {
  const { version, region, origin, keyId, deviceId, label, fingerprint, legacy, createdAt, revokedAt } = record;
  return { version, region, origin, keyId, deviceId, label, fingerprint, legacy, createdAt, revokedAt,
    status: revokedAt === null ? 'active' : 'revoked' };
}

function aad(record) {
  // Every field that affects identity, revocation or displayed enrollment provenance is authenticated.
  return Buffer.from(JSON.stringify(['RescueMesh device key', 1, record.region, record.origin, record.keyId,
    record.deviceId, record.label, record.fingerprint, record.legacy, record.createdAt, record.revokedAt]), 'utf8');
}

function wrappingKey(config) { return keyBytes(config.deviceWrappingKeyHex, 'hub device-wrapping key'); }

function wrap(config, record, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey(config), nonce, { authTagLength: 16 });
  cipher.setAAD(aad(record));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return { algorithm: 'aes-256-gcm', nonceHex: nonce.toString('hex'), ciphertextHex: ciphertext.toString('hex'),
    tagHex: cipher.getAuthTag().toString('hex') };
}

function unwrap(config, record) {
  validateRecord(record, config.region);
  let key;
  try {
    const cipher = createDecipheriv('aes-256-gcm', wrappingKey(config), Buffer.from(record.wrappedKey.nonceHex, 'hex'), { authTagLength: 16 });
    cipher.setAAD(aad(record)); cipher.setAuthTag(Buffer.from(record.wrappedKey.tagHex, 'hex'));
    key = Buffer.concat([cipher.update(Buffer.from(record.wrappedKey.ciphertextHex, 'hex')), cipher.final()]);
  } catch { fail('Device key record authentication failed', 'KEY_RECORD_AUTH_FAILED'); }
  const expected = Buffer.from(record.fingerprint, 'hex');
  const actual = createHash('sha256').update(key).digest();
  if (key.length !== 32 || !timingSafeEqual(expected, actual)) fail('Device key fingerprint mismatch', 'KEY_RECORD_AUTH_FAILED');
  return key;
}

function registry(config) {
  if (!object(config) || config.deviceKeyringVersion !== 1 || !Array.isArray(config.devices)
    || config.devices.length > MAX_DEVICES) fail('Device registry is not initialized');
  integer(config.region, 1, 65535, 'registry region');
  const master = wrappingKey(config);
  if (typeof config.keyHex === 'string' && HEX_KEY.test(config.keyHex)
    && timingSafeEqual(master, Buffer.from(config.keyHex, 'hex'))) fail('Wrapping master must be separate from the legacy regional key');
  const seen = new Set();
  for (const record of config.devices) {
    validateRecord(record, config.region);
    if (seen.has(record.deviceId)) fail('Duplicate device identity');
    seen.add(record.deviceId);
  }
  return config.devices;
}

/** Mutates only the caller's in-memory config. The caller must persist it atomically before issuing profiles. */
export function initializeDeviceKeyring(config) {
  if (!object(config)) fail('Invalid hub configuration');
  integer(config.region, 1, 65535, 'registry region');
  if (config.deviceKeyringVersion !== undefined && config.deviceKeyringVersion !== 1) fail('Unsupported device registry');
  const devices = config.devices ?? [];
  if (!Array.isArray(devices) || devices.length > MAX_DEVICES) fail('Invalid device registry');
  if (devices.length && config.deviceWrappingKeyHex === undefined) fail('Existing device registry has no wrapping key');
  const master = config.deviceWrappingKeyHex === undefined ? randomBytes(32).toString('hex') : keyBytes(config.deviceWrappingKeyHex).toString('hex');
  const candidate = { ...config, deviceKeyringVersion: 1, deviceWrappingKeyHex: master, devices };
  registry(candidate);
  Object.assign(config, { deviceKeyringVersion: 1, deviceWrappingKeyHex: master, devices });
  return config;
}

/** Register one explicitly supplied profile. No packet or untrusted origin can enroll itself. */
export function registerDeviceProfile(config, profile, { label, legacy = false, now = Date.now() } = {}) {
  if (!object(config) || !object(profile)) fail('Invalid enrollment profile');
  integer(config.region, 1, 65535, 'registry region');
  if (profile.region !== config.region) fail('Enrollment region does not match hub', 'UNKNOWN_PROFILE');
  const origin = integer(profile.origin, 1, 0xffffffff, 'device origin');
  const keyId = integer(profile.keyId, 1, 255, 'device key ID');
  if (origin === config.hubOrigin && !legacy) fail('Device origin conflicts with hub identity');
  if (typeof legacy !== 'boolean') fail('Invalid enrollment provenance');
  const key = keyBytes(profile.keyHex ?? profile.key);
  if (profile.keyHex !== undefined && profile.key !== undefined && !timingSafeEqual(key, keyBytes(profile.key))) fail('Conflicting profile keys');
  const fingerprint = deviceFingerprint(key);
  const record = { version: 1, region: config.region, origin, keyId, deviceId: identity(config.region, origin, keyId),
    label: labelText(label, origin), fingerprint, legacy, createdAt: timestamp(now), revokedAt: null };
  initializeDeviceKeyring(config);
  if (timingSafeEqual(key, wrappingKey(config))) fail('A phone cannot hold the hub wrapping master', 'DEVICE_KEY_REUSE');
  const existing = config.devices.find(device => device.deviceId === record.deviceId);
  if (existing) {
    if (existing.revokedAt !== null) fail('Device enrollment was revoked', 'DEVICE_REVOKED');
    if (!timingSafeEqual(unwrap(config, existing), key)) fail('Device key ID already belongs to a different key', 'DEVICE_KEY_CONFLICT');
    if (existing.legacy !== legacy) fail('Existing enrollment provenance cannot change');
    return metadata(existing);
  }
  if (config.devices.length >= MAX_DEVICES) fail('Device registry is full');
  const reused = config.devices.filter(device => device.fingerprint === fingerprint);
  if (reused.some(device => !legacy || !device.legacy)) fail('Each non-legacy device needs a unique key', 'DEVICE_KEY_REUSE');
  record.wrappedKey = wrap(config, record, key);
  config.devices.push(record);
  return metadata(record);
}

/** Create a private, one-device phone profile using the unchanged iOS provisioning schema. */
export function createDeviceProfile(config, { origin, keyId = config?.keyId ?? 1, label, now = Date.now() } = {}) {
  initializeDeviceKeyring(config);
  if (origin === undefined) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = randomBytes(4).readUInt32LE();
      if (candidate && candidate !== config.hubOrigin && !config.devices.some(device => device.origin === candidate)) { origin = candidate; break; }
    }
    if (origin === undefined) fail('Could not reserve a device origin');
  }
  const profile = { region: config.region, keyId, keyHex: randomBytes(32).toString('hex'), origin };
  const device = registerDeviceProfile(config, profile, { label, legacy: false, now });
  return { profile, device };
}

/** A strict lookup: registered device tuple only; never falls back to the regional shared key. */
export function resolveDeviceKey(config, origin, keyId) {
  const records = registry(config);
  integer(origin, 1, 0xffffffff, 'device origin'); integer(keyId, 1, 255, 'device key ID');
  const record = records.find(device => device.origin === origin && device.keyId === keyId);
  if (!record) fail('Device identity is not enrolled', 'UNKNOWN_DEVICE');
  if (record.revokedAt !== null) fail('Device enrollment was revoked', 'DEVICE_REVOKED');
  return unwrap(config, record);
}

/** Revocation is authenticated along with the wrapped key, so editing the timestamp cannot reactivate a record. */
export function revokeDevice(config, origin, keyId, { now = Date.now() } = {}) {
  const records = registry(config);
  integer(origin, 1, 0xffffffff, 'device origin'); integer(keyId, 1, 255, 'device key ID');
  const record = records.find(device => device.origin === origin && device.keyId === keyId);
  if (!record) fail('Device identity is not enrolled', 'UNKNOWN_DEVICE');
  if (record.revokedAt !== null) return metadata(record);
  const key = unwrap(config, record);
  const updated = { ...record, revokedAt: timestamp(now) };
  updated.wrappedKey = wrap(config, updated, key);
  records[records.indexOf(record)] = updated;
  return metadata(updated);
}

/** Only this safe projection belongs in UI/API/MongoDB device metadata; the wrapping master stays hub-private. */
export function publicDevices(config) { return registry(config).map(record => metadata(record)); }

/** Presence of any registry field enables fail-closed lookup, including malformed/partial migrations. */
export function hasDeviceKeyring(config) {
  return object(config) && ['deviceKeyringVersion', 'deviceWrappingKeyHex', 'devices'].some(key => Object.hasOwn(config, key));
}
