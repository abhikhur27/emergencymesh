// Explicit, bounded capability check. It never starts the hub, opens serial, or contacts emergency services.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { IdentityStore } from '../src/identity-store.mjs';
import { loadRuntime, dataPath } from '../src/config.mjs';
import { runLocalAgent } from '../src/local-agent.mjs';
import { DEFAULT_REGION } from '../src/region.mjs';

const args = process.argv.slice(2); const at = args.indexOf('--data'); const runtime = await loadRuntime(dataPath(at >= 0 ? args[at + 1] : undefined));
const receipt = { checkedAt: new Date().toISOString(), realRadio: false, realDispatch: false };
if (args.includes('--mongo')) {
  if (!runtime.mongoUri) throw new Error('Private MongoDB configuration is required');
  const directory = await mkdtemp(join(tmpdir(), 'rescuemesh-runtime-check-')); const namespace = `verification-${randomBytes(8).toString('hex')}`; const token = randomBytes(24).toString('base64url');
  const identity = new IdentityStore(directory, { operatorToken: token, mongoUri: runtime.mongoUri, mongoDatabase: runtime.mongoDatabase, namespace }); const client = new MongoClient(runtime.mongoUri, { serverSelectionTimeoutMS: 2500 });
  try {
    await identity.load(); while (identity.mongoBusy) await new Promise(resolve => setTimeout(resolve, 10));
    const session = await identity.createSession(); await identity.setDevices([{ origin: 17, keyId: 1, label: 'Synthetic verification device', fingerprint: 'f'.repeat(64), status: 'active' }]); await identity.syncMongo({ force: true });
    if (!identity.status().connected) throw new Error('MongoDB adapter did not connect');
    await client.connect(); const db = client.db(runtime.mongoDatabase); const counts = {}; let plaintextStored = false;
    for (const collection of ['users', 'sessions', 'devices']) { const documents = await db.collection(collection).find({ namespace }).toArray(); counts[collection] = documents.length; const encoded = JSON.stringify(documents); plaintextStored ||= encoded.includes(token) || encoded.includes(session.id) || encoded.includes('wrappedKey'); }
    if (Object.values(counts).some(n => n !== 1) || plaintextStored) throw new Error('MongoDB adapter verification failed');
    receipt.mongodb = { connected: true, collections: counts, cleartextCredentialsStored: false, keyMaterialStored: false };
  } catch { throw new Error('MongoDB runtime verification failed; inspect the private service connection'); }
  finally { await identity.close(); try { const db = client.db(runtime.mongoDatabase); for (const name of ['users', 'sessions', 'devices']) await db.collection(name).deleteMany({ namespace }); } catch { /* A failed connection cannot authorize broader cleanup. */ } await client.close(); await rm(directory, { recursive: true, force: true }); }
}
if (args.includes('--model')) {
  const tools = []; const started = Date.now();
  const result = await runLocalAgent({ category: 5, severity: 3, people: 2, flags: 0, note: 'SYNTHETIC TEST: Two people request drinking water near HH.' }, { caseId: 'verification:synthetic:no-dispatch', region: DEFAULT_REGION, model: runtime.model, onTool: async event => tools.push(event.action) });
  receipt.localAgent = { configuredModel: runtime.model, source: result.source, usedModel: result.model, durationMs: Date.now() - started, method: result.method, tools, authoritativePeople: result.quantity, resource: result.resource, realDispatch: false };
}
console.log(JSON.stringify(receipt, null, 2));
