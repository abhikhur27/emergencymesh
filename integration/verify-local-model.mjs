// Explicit bounded local inference check. Requires an already installed/running loopback Ollama.
// Only synthetic data is used. No model download, service startup, key or incident data is persisted.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HubCore } from '../hub/src/core.mjs';
import { IncidentStore } from '../hub/src/store.mjs';
import { encodeRequest, decodeFrame } from '../hub/src/codec.mjs';
const root = await mkdtemp(join(tmpdir(), 'emergency-model-check-'));
try {
  const config = { region: 1, keyId: 1, key: randomBytes(32), hubOrigin: 1234 };
  const request = { category: 3, severity: 2, people: 2, flags: 4, createdAt: Math.floor(Date.now()/1000), latitude: 0, longitude: 0, accuracy: 65535, battery: 70, note: 'Synthetic demo: two people near a blocked trail exit.' };
  const started = Date.now(); let receiptAt;
  const core = new HubCore({ config, store: await new IncidentStore(root).load(), ai: true, model: 'llama3.2:latest', transmit: async frame => {
    assert.equal(decodeFrame(frame, config).receipt.status, 1); receiptAt = Date.now();
  }});
  await core.ingest(encodeRequest(request, { region: 1, keyId: 1, origin: 5678, sequence: 1, hops: 3 }, config.key), { simulated: true });
  assert.ok(receiptAt, 'Hub receipt must precede waiting for model');
  await core.summaryQueue.idle();
  const summary = core.list()[0].summary;
  assert.equal(summary.source, 'local-model', 'Fallback is not live inference evidence');
  assert.equal(summary.method, 'validated-extractive-selection');
  assert.ok(summary.text.includes('2 people') && summary.text.includes('serious priority') && summary.text.includes('Location unknown'));
  const receipt = { checkedAt: new Date().toISOString(), host: process.env.COMPUTERNAME || 'unknown', synthetic: true, radioVerified: false, servicesContacted: false, model: summary.model, method: summary.method, acknowledgmentMs: receiptAt-started, totalMs: Date.now()-started, summary: summary.text, selectedNoteIndices: summary.selectedNoteIndices, passed: true };
  const output = process.argv[2];
  if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(receipt, null, 2)+'\n'); }
  console.log(JSON.stringify(receipt));
} finally {
  const safe = resolve(root);
  if (!safe.startsWith(resolve(tmpdir())+sep) || !safe.includes('emergency-model-check-')) throw new Error('Refusing unsafe cleanup');
  await rm(safe, { recursive: true, force: true });
}
