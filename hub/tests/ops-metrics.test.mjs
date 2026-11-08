import test from 'node:test';
import assert from 'node:assert/strict';
import { hubMetrics, intakeHistogram, supplySelections, validGps, needsFor, allocationsFor } from '../public/ops-metrics.js';

const now = Date.parse('2026-11-08T06:00:00Z');
test('hub analytics count distinct radio requests separately from repeat receptions and tests', () => {
  const a = { id: 'a', receivedAt: now - 3600000, lastReceivedAt: now - 120000, receptions: 4, request: { severity: 1, flags: 33, latitude: 32.98, longitude: -96.75 }, coordination: { revision: 2, sharedRevision: 1, stage: 'partial', summary: { source: 'signal' } } };
  const b = { id: 'b', receivedAt: now - 60000, receptions: 1, request: { severity: 3, flags: 0 }, coordination: { revision: 1, sharedRevision: 1, acknowledgedAt: now - 50000, lastUpdateAt: now - 40000, summary: { source: 'local-model' } } };
  const state = { incidents: [{ ...a, lastReceivedAt: now - 180000, receptions: 2 }, a, b, { id: 'fixture', simulated: true, request: { severity: 1, flags: 1 }, receivedAt: now }] };
  const m = hubMetrics(state, now);
  assert.equal(m.requests, 2); assert.equal(m.receptions, 5); assert.equal(m.gps, 1); assert.equal(m.withoutGps, 1);
  assert.deepEqual(m.priorities, [1, 0, 1]); assert.equal(m.pending, 1); assert.equal(m.acknowledged, 1); assert.equal(m.needsAttention, 1);
  assert.equal(m.lastAck, now - 50000); assert.equal(m.returned, 1); assert.equal(m.sourceOnly, 1); assert.equal(m.modelAssisted, 1);
  assert.equal(m.histogram.total, 2); assert.equal(m.histogram.bins[0].count, 1); assert.equal(m.histogram.bins[11].count, 1);
});
test('intake bins preserve real timestamps, include the window boundary and exclude future or missing samples', () => {
  const sample = intakeHistogram([{ receivedAt: now - 3600000 }, { receivedAt: new Date(now - 1).toISOString() }, { receivedAt: now + 1 }, { receivedAt: now - 3600001 }, { receivedAt: null }], { now });
  assert.equal(sample.total, 2); assert.equal(sample.bins.length, 12); assert.equal(sample.bins[0].count, 1); assert.equal(sample.bins[11].count, 1);
});
test('selected supplies use authenticated signal bits and never infer GPS from a landmark or invalid flag', () => {
  assert.deepEqual(supplySelections({ flags: 0xff }), ['food', 'water', 'medicine', 'power']);
  assert.deepEqual(supplySelections({ flags: 15 }), []); assert.deepEqual(supplySelections({ flags: -1 }), []); assert.deepEqual(supplySelections({ flags: 256 }), []);
  assert.equal(validGps({ flags: 1, latitude: 0, longitude: 0 }), true);
  assert.equal(validGps({ flags: 0, latitude: 32.98, longitude: -96.75 }), false);
  assert.equal(validGps({ flags: 1, latitude: NaN, longitude: -96.75 }), false);
});
test('planning quantities and resource allocations remain separate from original report fields', () => {
  const item = { caseId: 'a', request: { people: 2, flags: 32 }, summary: { text: 'original source' }, coordination: { summary: { needRequests: [{ resource: 'water', quantity: 2, quantityBasis: 'policy-per-person' }] } }, allocations: [{ id: 'water', caseId: 'a', resource: 'water', quantity: 2, townId: 'plano' }, { id: 'water', caseId: 'a', resource: 'water', quantity: 2, townId: 'plano' }, { id: 'released', caseId: 'a', resource: 'food', quantity: 2, released: true }, { id: 'wrong', caseId: 'another', resource: 'power', quantity: 1 }] };
  const before = structuredClone(item); assert.equal(needsFor(item)[0].quantityBasis, 'policy-per-person'); assert.equal(allocationsFor(item).length, 1); assert.deepEqual(item, before);
  const embedded = { caseId: 'a', allocation: { townId: 'plano', resource: 'water', quantity: 2 } }; assert.equal(allocationsFor(embedded).length, 0); assert.equal(allocationsFor(embedded, { embedded: true }).length, 1); assert.equal(allocationsFor({ ...embedded, allocation: { ...embedded.allocation, caseId: 'wrong' } }, { embedded: true }).length, 0);
});
