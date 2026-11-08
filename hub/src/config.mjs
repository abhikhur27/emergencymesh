import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

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
  const profile = { region: config.region, keyId: config.keyId, keyHex: config.keyHex, origin: uint32() || 1 };
  const phoneFile = join(directory, `phone-profile-${Date.now()}-${randomBytes(3).toString('hex')}.json`);
  await writeFile(phoneFile, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { configFile, phoneFile };
}
export async function createOperatorToken(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString('base64url');
  const tokenFile = join(directory, 'operator-token.txt');
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  return { token, tokenFile };
}
