import test from 'node:test';
import assert from 'node:assert/strict';
import { agentMessages, filterAgentMessages, intakeAttribution } from '../public/agent-conversation.js';

const at = 1794156000000;
const record = (id, action, values = {}) => ({ id, seq: Number(id.replace('event-', '')) || 1, caseId: 'ecsw:report-1', hubId: 'ecsw', at: at + 100, action, ...values });
function fixture() {
  const catalog = record('event-2', 'resource_catalog', { resource: 'water', options: [{ townId: 'plano', resource: 'water', available: 4 }, { townId: 'garland', resource: 'water', available: 7 }, { townId: 'addison', resource: 'water', available: 2 }] });
  const proposal = record('event-3', 'propose_allocation', { at: at + 200, resource: 'water', arguments: { resource: 'water', townId: 'plano', quantity: 3 }, result: { valid: true } });
  const reservation = record('event-4', 'resource_allocated', { at: at + 300, townId: 'plano', resource: 'water', quantity: 3, remaining: 1 });
  const receipt = record('event-5', 'simulated_dispatch', { at: at + 400, townId: 'plano', resource: 'water', dispatchId: 'dispatch-1' });
  const item = { caseId: 'ecsw:report-1', hubId: 'ecsw', createdAt: at, source: { kind: 'radio' }, sourceAgent: { source: 'signal', configuredModel: 'nemotron-configured-only' }, request: { category: 5, people: 3, note: 'Need water by the west entrance.' }, events: [catalog, proposal, reservation, receipt], allocations: [{ dispatchId: 'dispatch-1', townId: 'plano', resource: 'water', quantity: 3, agent: { source: 'nemotron-tools', model: 'historical-model' } }] };
  return { cases: [item], events: [catalog, proposal, reservation, receipt], model: { model: 'current-model-not-proof' }, hubs: [{ id: 'plano', resources: { water: 999 } }] };
}

test('conversation shows source, distinct town snapshots, proposal, reservation and saved acknowledgment without modifying state', () => {
  const state = fixture(), before = structuredClone(state), messages = agentMessages(state);
  assert.deepEqual(state, before);
  assert.equal(messages.find(message => message.kind === 'Request').actor, 'ecsw');
  assert.equal(messages.find(message => message.kind === 'Request').source, 'Original phone signal');
  assert.deepEqual(messages.filter(message => message.kind === 'Inventory reply').map(message => message.actor).sort(), ['addison', 'garland', 'plano']);
  const plano = messages.find(message => message.actor === 'plano' && message.kind === 'Inventory reply');
  assert.match(plano.text, /4 units/); assert.doesNotMatch(plano.text, /999/); assert.match(plano.source, /inventory tool/);
  const proposal = messages.find(message => message.kind === 'Proposal'); assert.equal(proposal.actor, 'supervisor'); assert.deepEqual(proposal.recipients, ['policy']); assert.match(proposal.text, /stock and quantity checks passed/);
  const reservation = messages.find(message => message.kind === 'Reservation'); assert.match(reservation.text, /3 units/); assert.match(reservation.text, /1 unit remain/);
  const acknowledgment = messages.find(message => message.kind === 'Handoff receipt'); assert.equal(acknowledgment.actor, 'plano'); assert.deepEqual(acknowledgment.recipients, ['supervisor', 'ecsw']); assert.match(acknowledgment.text, /exercise handoff/);
  assert.equal(messages.filter(message => message.kind === 'Reservation').length, 1, 'Shared top-level and case events are deduplicated');
});

test('failed proposals and operator choices keep their recorded attribution', () => {
  const state = fixture(); state.cases[0].events = [record('event-6', 'propose_allocation', { resource: 'water', arguments: { resource: 'water', townId: 'plano', quantity: 3 }, result: { valid: false } }), record('event-7', 'operator_alternate', { resource: 'water', townId: 'garland', quantity: 3, remaining: 4 })]; state.events = [];
  const messages = agentMessages(state), rejected = messages.find(message => message.kind === 'Proposal rejected'), manual = messages.find(message => message.kind === 'Reservation');
  assert.match(rejected.text, /did not pass resource policy/); assert.doesNotMatch(rejected.text, /Reserved/);
  assert.equal(manual.actor, 'operator'); assert.equal(manual.source, 'Operator-selected alternative');
  assert.doesNotMatch(JSON.stringify(messages), /current-model-not-proof|nemotron-configured-only|historical-model/);
});

test('historical lookup result supplies replies when its earlier catalog event is no longer retained', () => {
  const state = fixture(); state.events = []; state.cases[0].events = [record('event-8', 'lookup_resources', { resource: 'water', arguments: { resource: 'water' }, result: { options: [{ townId: 'garland', resource: 'water', available: 7 }, { townId: 'ecsw', resource: 'water', available: 3 }, { townId: 'plano', resource: 'food', available: 4 }] } })];
  const messages = agentMessages(state); assert.equal(messages.filter(message => message.kind === 'Inventory reply').length, 1); assert.equal(messages.find(message => message.kind === 'Inventory reply').actor, 'garland');
  assert.match(messages.find(message => message.kind === 'Decision step').source, /recorded regional model tool call/i);
});

test('a rejected wrong-resource proposal describes its actual arguments rather than the required resource', () => {
  const state = fixture(); state.events = []; state.cases[0].events = [record('event-8', 'propose_allocation', { resource: 'medical', arguments: { resource: 'water', townId: 'plano', quantity: 2 }, result: { valid: false } })];
  const proposal = agentMessages(state).find(message => message.kind === 'Proposal rejected');
  assert.match(proposal.text, /2 units of drinking water/); assert.doesNotMatch(proposal.text, /medical response/);
});

test('channel and request filters include actual participating hubs and exclude unrelated requests', () => {
  const state = fixture(), other = { ...structuredClone(state.cases[0]), caseId: 'addison:report-2', hubId: 'addison', events: [], request: { category: 1, people: 1, note: 'Exercise check-in.' } }; state.cases.push(other);
  const messages = agentMessages(state), plano = filterAgentMessages(messages, { channel: 'plano' });
  assert.ok(plano.length); assert.ok(plano.every(message => message.actor === 'plano' || message.recipients.includes('plano') || message.hubId === 'plano'));
  assert.equal(filterAgentMessages(messages, { caseId: other.caseId }).length, 1);
  assert.ok(filterAgentMessages(messages, { channel: 'supervisor' }).every(message => message.actor === 'supervisor' || message.recipients.includes('supervisor')));
  assert.deepEqual(filterAgentMessages(messages, { channel: 'unknown' }), messages);
});

test('archived cases, malformed snapshots and hidden model content cannot produce conversation messages', () => {
  const state = fixture(); state.cases[0].request.note = '<img src=x onerror=alert(1)>';
  state.cases[0].events.push(record('event-9', 'unknown_action', { thinking: 'PRIVATE_MODEL_SCRATCHPAD', content: 'PRIVATE_MODEL_SCRATCHPAD' }), record('event-10', 'resource_catalog', { resource: 'water', options: [{ townId: 'unknown', resource: 'water', available: 5 }, { townId: 'garland', resource: 'water', available: -1 }] }));
  state.events.push({ id: 'missing-case', caseId: 'not-retained', at, action: 'case_received' });
  const messages = agentMessages(state); assert.ok(messages.find(message => message.kind === 'Request').text.includes('<img'), 'Untrusted source remains literal text for textContent rendering'); assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_MODEL_SCRATCHPAD/);
  assert.equal(messages.filter(message => message.kind === 'Inventory reply').length, 3);
  state.cases[0].archived = true; assert.deepEqual(agentMessages(state), []); assert.deepEqual(agentMessages({ cases: 'invalid', events: null }), []);
});

test('intake labels distinguish local inference, direct signal and shared exercise generation', () => {
  assert.equal(intakeAttribution({ source: { kind: 'radio' }, sourceAgent: { source: 'signal', configuredModel: 'configured' } }), 'Original phone signal');
  assert.equal(intakeAttribution({ source: { kind: 'radio' }, sourceAgent: { source: 'local-model', model: 'local-4b' } }), 'local-4b · source preparation');
  assert.equal(intakeAttribution({ source: { kind: 'simulated' }, generation: { source: 'nemotron', model: 'cloud-30b' } }), 'cloud-30b · exercise wording');
  assert.equal(intakeAttribution({ source: { kind: 'simulated' }, generation: { source: 'seeded-policy' } }), 'Town exercise · seeded intake');
});

test('regional questions and authenticated replies retain identity and source-hub routing', () => {
  const state = fixture(); state.cases[0].followups = [{ id: '1234abcd', source: 'regional', text: 'Which entrance?', createdAt: at + 500, answer: { text: 'West entrance.', receivedAt: at + 600 } }, { id: 'ignored-local', source: 'local', text: 'Local phone question', createdAt: at + 700 }];
  const messages = agentMessages(state), question = messages.find(message => message.kind === 'Information request'), answer = messages.find(message => message.kind === 'User reply');
  assert.equal(question.actor, 'supervisor'); assert.deepEqual(question.recipients, ['ecsw']); assert.match(question.text, /Which entrance/);
  assert.equal(answer.actor, 'ecsw'); assert.match(answer.text, /West entrance/); assert.equal(messages.filter(message => message.kind === 'Information request').length, 1);
});

test('recent conversation is bounded while retaining stable message identities', () => {
  const cases = Array.from({ length: 1300 }, (_, index) => ({ caseId: `plano:case-${index}`, hubId: 'plano', createdAt: at + index, request: { category: 5, people: 1 }, events: [] }));
  const messages = agentMessages({ cases }); assert.equal(messages.length, 1200); assert.equal(new Set(messages.map(message => message.id)).size, 1200); assert.equal(messages.at(-1).caseId, 'plano:case-1299');
});

test('same-time inventory requests precede replies and preserve the saved event time', () => {
  const state = fixture(), catalog = { ...state.cases[0].events[0], at };
  state.cases[0].events = [catalog]; state.events = [catalog];
  const messages = agentMessages(state);
  assert.deepEqual(messages.map(message => message.kind), ['Request', 'Inventory request', 'Inventory reply', 'Inventory reply', 'Inventory reply']);
  assert.ok(messages.every(message => message.at === at), 'Logical order must not fabricate later reply timestamps');
  assert.deepEqual(messages.filter(message => message.kind === 'Inventory reply').map(message => message.actor), ['plano', 'garland', 'addison']);
});

test('equal-time process steps follow numeric saved sequence instead of event IDs or input order', () => {
  const state = fixture(), item = state.cases[0];
  const events = [record('event-source', 'case_received', { seq: 9, at }),
    { ...item.events[0], id: 'event-z', seq: 10, at },
    record('event-a', 'lookup_resources', { seq: 11, at, resource: 'water', arguments: { resource: 'water' }, result: { options: [] } }),
    { ...item.events[1], id: 'event-2', seq: 12, at },
    { ...item.events[2], id: 'event-01', seq: 13, at },
    { ...item.events[3], id: 'event-000', seq: 14, at }];
  item.events = [...events].reverse(); state.events = [...events].reverse();
  const messages = agentMessages(state);
  assert.deepEqual(messages.map(message => message.kind), ['Request', 'Inventory request', 'Inventory reply', 'Inventory reply', 'Inventory reply', 'Decision step', 'Proposal', 'Reservation', 'Handoff receipt']);
  assert.ok(messages.every(message => message.at === at));
});
