import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { writeJsonAtomic } from './atomic-json.mjs';
import { initializeDeviceKeyring, registerDeviceProfile, createDeviceProfile } from './device-keyring.mjs';

export const uint32 = () => randomBytes(4).readUInt32LE();
export const dataPath = (value = '.emergency') => resolve(value);
export function validateConfig(value) {
  if (!value || value.version !== 1 || !Number.isInteger(value.region) || value.region < 1 || value.region > 65535 ||
      !Number.isInteger(value.keyId) || value.keyId < 1 || value.keyId > 255 || !/^[0-9a-f]{64}$/i.test(value.keyHex) ||
      !Number.isInteger(value.hubOrigin) || value.hubOrigin < 1 || value.hubOrigin > 0xffffffff) {
    throw new Error('Invalid hub configuration');
  }
  return { ...value, key: Buffer.from(value.keyHex, 'hex') };
}
export async function loadConfig(directory) {
  return validateConfig(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8')));
}
export async function saveConfig(directory, config) { const { key, ...saved } = config; await writeJsonAtomic(join(directory, 'config.json'), saved); }
export async function prepareDeviceRegistry(directory, config) {
  const before = JSON.stringify(config); initializeDeviceKeyring(config);
  for (const file of await readdir(directory)) {
    if (!/^phone-profile-[A-Za-z0-9-]+\.json$/.test(file)) continue;
    const profile = JSON.parse(await readFile(join(directory, file), 'utf8'));
    if (profile.region !== config.region) continue;
    // A retained private enrollment file cannot reactivate a deliberately revoked tuple.
    if (config.devices.some(device => device.origin === profile.origin && device.keyId === profile.keyId && device.revokedAt)) continue;
    registerDeviceProfile(config, profile, { label: 'Enrolled phone', legacy: profile.keyHex === config.keyHex });
  }
  if (JSON.stringify(config) !== before) await saveConfig(directory, config);
  return config;
}
export async function provision(directory, { region = 1, keyId = 1 } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configFile = join(directory, 'config.json');
  let config;
  try { config = await loadConfig(directory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = validateConfig({ version: 1, region, keyId, keyHex: randomBytes(32).toString('hex'), hubOrigin: uint32() || 1 });
    const { key, ...saved } = config;
    await writeFile(configFile, `${JSON.stringify(saved, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  await prepareDeviceRegistry(directory, config);
  const { profile } = createDeviceProfile(config, { keyId: config.keyId, label: 'RescueMesh phone' });
  await saveConfig(directory, config);
  const phoneFile = join(directory, `phone-profile-${Date.now()}-${randomBytes(3).toString('hex')}.json`);
  await writeFile(phoneFile, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { configFile, phoneFile };
}
export async function createOperatorToken(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tokenFile = join(directory, 'operator-token.txt');
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) throw new Error('Invalid saved operator credential; explicit rotation required');
    return { token, tokenFile };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const token = randomBytes(24).toString('base64url');
  try { await writeFile(tokenFile, `${token}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return createOperatorToken(directory); throw error; }
  return { token, tokenFile };
}
export async function loadRuntime(directory) {
  let value = {};
  try { value = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const runtime = { ...value, mongoUri: process.env.MONGODB_URI || value.mongoUri || '', mongoDatabase: process.env.MONGODB_DATABASE || value.mongoDatabase || 'rescuemesh', supervisorUrl: process.env.SUPERVISOR_URL || value.supervisorUrl || '', supervisorToken: process.env.SUPERVISOR_TOKEN || value.supervisorToken || '', model: process.env.OLLAMA_MODEL || value.model || 'nemotron-3-nano:4b', hubId: value.hubId || 'ecsw', hubName: value.hubName || 'ECSW', supervisorPublicUrl: value.supervisorPublicUrl || '' };
  if (!/^[a-z0-9_-]{1,40}$/.test(runtime.hubId) || !/^[A-Za-z0-9_-]{1,64}$/.test(runtime.mongoDatabase)) throw new Error('Invalid private runtime configuration');
  if (value.supervisorTokenFile && !runtime.supervisorToken) runtime.supervisorToken = (await readFile(resolve(directory, value.supervisorTokenFile), 'utf8')).trim();
  if (runtime.supervisorUrl) { const u = new URL(runtime.supervisorUrl); if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))) throw new Error('Supervisor URL requires HTTPS or a private loopback forward'); runtime.supervisorUrl = u.href.replace(/\/$/, ''); }
  return runtime;
}
