import test from 'node:test';
import assert from 'node:assert/strict';
import { regionalMetrics, resourceUnit } from '../public/ops-metrics.js';

test('regional analytics describe current cases and per-resource acknowledgments without counting archived exercise history', () => {
  const now = Date.parse('2026-11-08T06:00:00Z');
  const a = { caseId: 'a', hubId: 'ecsw', createdAt: now - 60000, updatedAt: now - 1000, request: { severity: 1 }, source: { kind: 'radio' }, location: { kind: 'gps' }, status: 'partial', allocations: [{ id: 'a-water', caseId: 'a', townId: 'plano', resource: 'water', quantity: 2, acknowledgedAt: now - 1000 }, { id: 'a-medicine', caseId: 'a', townId: 'garland', resource: 'medicine', quantity: 1 }] };
  const b = { caseId: 'b', hubId: 'addison', createdAt: now - 300000, request: { severity: 3 }, source: { kind: 'simulated' }, location: { kind: 'landmark' }, status: 'simulated-dispatched', allocation: { id: 'b-food', caseId: 'b', townId: 'plano', resource: 'food', quantity: 3, acknowledgment: 'recorded' } };
  const state = { cases: [a, { ...a, updatedAt: now - 2000, allocations: [] }, b, { ...b, caseId: 'old', archived: true }], hubs: [{ id: 'ecsw', resources: null }, { id: 'plano', resources: { water: 5, food: 3 } }, { id: 'garland', resources: { water: 2, medicine: 1 } }, { id: 'addison', resources: { power: 4 } }] };
  const m = regionalMetrics(state, now);
  assert.equal(m.requests, 2); assert.equal(m.physical, 1); assert.equal(m.generated, 1); assert.equal(m.allocations, 3); assert.equal(m.acknowledged, 2); assert.equal(m.needsAttention, 1); assert.equal(m.gps, 1);
  assert.deepEqual(m.byTown, { ecsw: 1, plano: 0, garland: 0, addison: 1 }); assert.deepEqual(m.available, { water: 7, food: 3, medicine: 1, power: 4 }); assert.equal(m.histogram.total, 2);
  assert.deepEqual(m.priorities, [1, 0, 1]);
});
test('supply quantities use units while response services use teams', () => {
  assert.equal(resourceUnit('medicine', 2), '2 units'); assert.equal(resourceUnit('power', 1), '1 unit'); assert.equal(resourceUnit('food', 3), '3 units'); assert.equal(resourceUnit('medical', 1), '1 team');
});
