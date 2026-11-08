import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNeed } from '../src/schema.mjs';
test('regional policy accepts the same water wording as the source hub', () => {
  for (const note of ['Need water near HH', 'Need a drink near HH', 'Drinking assistance near HH', 'Hydration near HH']) {
    const need = deriveNeed({ request: { category: 5, people: 2, note }, summary: { resource: 'water', quantity: 2 }, location: { kind: 'landmark' } });
    assert.equal(need.resource, 'water'); assert.deepEqual(need.issues, []);
  }
  const kits = deriveNeed({ request: { category: 5, people: 2, note: 'Need two supply kits' }, summary: { resource: 'supplies', quantity: 2 }, location: { kind: 'landmark' } });
  assert.equal(kits.resource, 'supplies'); assert.deepEqual(kits.issues, []);
});
