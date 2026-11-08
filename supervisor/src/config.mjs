import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_MODEL = 'nemotron-3-nano:4b';
export const dataPath = value => resolve(value || process.env.RESCUEMESH_SUPERVISOR_DATA || '.supervisor');
export async function readEnvFile(file = '.env') {
  let text; try { text = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
async function stableSecret(file) {
  try { const value = (await readFile(file, 'utf8')).trim(); if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error('Invalid private credential file'); return value; }
  catch (error) { if (error.code !== 'ENOENT') throw error; const value = randomBytes(32).toString('base64url'); await writeFile(file, value + '\n', { flag: 'wx', mode: 0o600 }); return value; }
}
export async function provision(directory = dataPath()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const operatorFile = join(directory, 'operator-token.txt');
  const machineFile = join(directory, 'ecsw-hub-token.txt');
  const operatorToken = await stableSecret(operatorFile);
  const machineToken = await stableSecret(machineFile);
  const configFile = join(directory, 'config.json');
  let config;
  try { config = JSON.parse(await readFile(configFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = { schema: 1, product: 'RescueMesh', operatorUsername: 'operator', hubId: 'supervisor', regionName: 'UT Dallas and regional simulation', simulation: { seed: 4207, intervalMs: 25000, maxCases: 150 }, model: DEFAULT_MODEL };
    await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (config.schema !== 1 || config.product !== 'RescueMesh') throw new Error('Unsupported supervisor configuration');
  const publicOrigin = process.env.RESCUEMESH_SUPERVISOR_PUBLIC_ORIGIN || config.publicOrigin || null;
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) throw new Error('Public origin must be an exact URL origin');
  const model = process.env.OLLAMA_MODEL || config.model || DEFAULT_MODEL;
  if (/cloud/i.test(model)) throw new Error('Cloud-tagged models are not local supervisor inference');
  return { directory, config, operatorToken, hubTokens: { ecsw: machineToken }, operatorFile, machineFile, configFile, publicOrigin, model,
    modelBase: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434', mongoUri: process.env.MONGODB_URI || '', mongoDatabase: process.env.MONGODB_DATABASE || 'rescuemesh_supervisor' };
}
