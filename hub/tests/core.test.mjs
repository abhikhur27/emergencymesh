import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { IncidentStore } from '../src/store.mjs';
import { HubCore } from '../src/core.mjs';
import { encodeRequest, decodeFrame } from '../src/codec.mjs';
import { simulatedRequest } from '../src/simulation.mjs';

const now = 1794000000000;
async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'em-core-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { region: 1, keyId: 1, key: randomBytes(32), hubOrigin: 456 }; const store = await new IncidentStore(directory).load(); const sent = [];
  const core = new HubCore({ config, store, now: () => now, transmit: async frame => sent.push(Buffer.from(frame)), ...extra });
  const frame = encodeRequest(simulatedRequest(now), { region: 1, keyId: 1, origin: 123, sequence: 1, hops: 3 }, config.key);
  return { directory, config, store, core, sent, frame };
}
test('encrypted request is durable before authenticated ACK; duplicate/hop changes reuse ACK and incident', async t => {
  const f = await fixture(t);
  f.core.transmit = async frame => { const saved = JSON.parse(await readFile(join(f.directory, 'incidents.json'), 'utf8')); assert.equal(saved.incidents.length, 1); f.sent.push(Buffer.from(frame)); };
  const result = await f.core.ingest(f.frame, { rssi: -83, snr: 7.5, simulated: true });
  assert.equal(result.duplicate, false); assert.equal(result.incident.status, 'hub-received'); assert.equal(f.core.list().length, 1);
  const ack = decodeFrame(f.sent[0], f.config); assert.equal(ack.receipt.status, 1); assert.equal(ack.receipt.requestOrigin, 123); assert.equal(ack.receipt.requestSequence, 1);
  const hopped = Buffer.from(f.frame); hopped[14] = 0;
  assert.equal((await f.core.ingest(hopped)).duplicate, true); assert.equal(f.core.list()[0].receptions, 2); assert.deepEqual(f.sent[0], f.sent[1]);
  assert.throws(() => f.core.export(result.id), /review required/);
  await f.core.review(result.id); const review = decodeFrame(f.sent[2], f.config); assert.equal(review.receipt.status, 2); assert.equal(f.core.export(result.id).servicesContacted, false);
  assert.equal(f.core.export(result.id).simulation, true); assert.equal(f.core.export(result.id).incident.request.people, 2);
  await f.core.ingest(f.frame); assert.deepEqual(f.sent[2], f.sent[3]);
  const reopened = await new IncidentStore(f.directory).load(); const restarted = new HubCore({ config: f.config, store: reopened, now: () => now, transmit: async frame => f.sent.push(frame) });
  assert.equal((await restarted.ingest(f.frame)).duplicate, true); assert.deepEqual(f.sent[2], f.sent[4]); assert.equal(reopened.state.incidents.length, 1);
});
test('tamper, conflicting identity, unknown profile and stale/future request do not create incidents', async t => {
  const f = await fixture(t); const tampered = Buffer.from(f.frame); tampered[35] ^= 1;
  await assert.rejects(f.core.ingest(tampered), /Authentication failed/); assert.equal(f.core.list().length, 0); assert.equal(f.sent.length, 0);
  const unknown = Buffer.from(f.frame); unknown[15] = 2; await assert.rejects(f.core.ingest(unknown), /Unknown region/);
  for (const age of [-86401, 301]) {
    const request = { ...simulatedRequest(now), createdAt: Math.floor(now / 1000) + age };
    const frame = encodeRequest(request, { region: 1, origin: 123, sequence: age < 0 ? 10 : 11, keyId: 1 }, f.config.key);
    await assert.rejects(f.core.ingest(frame), /timestamp/);
  }
  await f.core.ingest(f.frame);
  const changed = encodeRequest({ ...simulatedRequest(now), people: 3 }, { region: 1, origin: 123, sequence: 1, keyId: 1 }, f.config.key);
  await assert.rejects(f.core.ingest(changed), /Conflicting replay/); assert.equal(f.core.list().length, 1); assert.equal(f.core.list()[0].request.people, 2);
});
test('transport failure preserves report and same receipt for recovery', async t => {
  const f = await fixture(t, { transmit: async () => { throw new Error('unplugged'); } });
  const result = await f.core.ingest(f.frame); assert.equal(result.incident.lastTransmission.state, 'failed');
  f.core.transmit = async frame => f.sent.push(frame); await f.core.ingest(f.frame);
  assert.equal(f.core.list()[0].lastTransmission.state, 'submitted-to-radio'); assert.equal(f.sent.length, 1);
});
test('ACK precedes optional inference; model cannot change original reported facts', async t => {
  const events = []; const f = await fixture(t, { ai: true, summarize: async request => { events.push('model'); assert.equal(request.people, 2); return { text: 'Validated source selection', source: 'local-model', model: 'test', needsReview: true }; }, transmit: async () => events.push('ack') });
  await f.core.ingest(f.frame); await f.core.summaryQueue.idle();
  assert.deepEqual(events, ['ack', 'model']); assert.equal(f.core.list()[0].request.people, 2); assert.equal(f.core.list()[0].request.severity, 2);
});
test('storage failure does not acknowledge unsaved incident or consume identity', async t => {
  const f = await fixture(t); const persist = f.store.persist.bind(f.store); f.store.persist = async () => { throw new Error('disk full'); };
  await assert.rejects(f.core.ingest(f.frame), /disk full/); assert.equal(f.sent.length, 0); assert.equal(f.core.list().length, 0); assert.equal(f.store.state.nextSequence, 1);
  f.store.persist = persist; await f.core.ingest(f.frame); assert.equal(f.sent.length, 1);
});
test('new-request rate limit is bounded while valid duplicate still receives receipt', async t => {
  const f = await fixture(t);
  for (let sequence = 1; sequence <= 30; sequence++) await f.core.ingest(encodeRequest(simulatedRequest(now), { region: 1, keyId: 1, origin: 123, sequence }, f.config.key));
  await assert.rejects(f.core.ingest(encodeRequest(simulatedRequest(now), { region: 1, keyId: 1, origin: 123, sequence: 31 }, f.config.key)), /rate limit/);
  // Use exact first encrypted bytes; a newly encrypted body with the same ID would be a conflicting replay.
  const first = encodeRequest(simulatedRequest(now), { region: 1, keyId: 1, origin: 124, sequence: 1 }, f.config.key); await f.core.ingest(first); assert.equal((await f.core.ingest(first)).duplicate, true);
});
test('authenticated duplicate floods are rate limited and ordinary retries recover after cooldown', async t => {
  const f = await fixture(t); let clock = now; f.core.now = () => clock;
  for (let i = 0; i < 30; i++) await f.core.ingest(f.frame);
  assert.equal(f.sent.length, 30); assert.equal(f.core.list().length, 1);
  await assert.rejects(f.core.ingest(f.frame), /rate limit/); assert.equal(f.sent.length, 30);
  clock += 60001; assert.equal((await f.core.ingest(f.frame)).duplicate, true); assert.equal(f.sent.length, 31); assert.deepEqual(f.sent[0], f.sent[30]);
});
