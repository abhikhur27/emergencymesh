import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicSummary, summarizeLocal, SummaryQueue } from '../src/summary.mjs';
import { simulatedRequest } from '../src/simulation.mjs';

const request = { ...simulatedRequest(), note: 'Two people near east entrance. Ramp blocked.' };
const fake = content => async (_url, options) => { const sent = JSON.parse(options.body); assert.equal(sent.stream, false); assert.equal(sent.messages[0].role, 'system'); assert.ok(sent.format.properties.selected); return new Response(JSON.stringify({ message: { content } })); };
test('local model only selects exact note spans and structured facts remain software-owned', async () => {
  const result = await summarizeLocal(request, { fetchImpl: fake('{"selected":[1]}') });
  assert.equal(result.method, 'validated-extractive-selection'); assert.match(result.text, /2 people/); assert.match(result.text, /serious priority/); assert.match(result.text, /Ramp blocked\./); assert.doesNotMatch(result.text, /Two people near/);
});
test('invalid, hallucinated, out-of-range, duplicate and oversized model content fail closed', async () => {
  for (const value of ['One person needs help', '{"selected":[12]}', '{"selected":[0,0]}', '{"selected":[0],"advice":"go"}', '{"selected":[0.5]}', '{"selected":"all"}']) await assert.rejects(summarizeLocal(request, { fetchImpl: fake(value) }));
  await assert.rejects(summarizeLocal(request, { fetchImpl: async () => new Response('x'.repeat(33000)) }), /too large/);
});
test('unknown location and all user selected concern flags are preserved', () => {
  const text = deterministicSummary({ ...request, flags: 14, latitude: 0, longitude: 0, accuracy: 65535 });
  assert.match(text, /Location unknown/); assert.match(text, /breathing concern reported/); assert.match(text, /trapped reported/); assert.match(text, /severe bleeding reported/);
});
test('queue is bounded and model outage visibly falls back to extraction', async () => {
  const output = []; const queue = new SummaryQueue({ enabled: true, maxQueued: 1, summarize: async () => { throw new Error('offline'); }, onResult: async (id, result) => output.push({ id, result }) });
  assert.equal(queue.enqueue('a', request), true); assert.equal(queue.enqueue('b', request), true); assert.equal(queue.enqueue('c', request), false); await queue.idle();
  assert.equal(output.length, 2); assert.equal(output[0].result.source, 'extractive-fallback'); assert.match(output[0].result.error, /unavailable/);
});
