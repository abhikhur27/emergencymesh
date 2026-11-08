import { RESOURCE_LABELS, CATEGORY_LABELS, resourceUnit, timestamp } from './ops-metrics.js';

export const AGENT_NAMES = Object.freeze({ supervisor: 'Regional supervisor', ecsw: 'ECSW hub', plano: 'Plano hub', garland: 'Garland hub', addison: 'Addison hub', operator: 'Operator', policy: 'Resource policy' });
export const AGENT_CHANNELS = Object.freeze(['all', 'ecsw', 'plano', 'garland', 'addison', 'supervisor']);
const hubIds = new Set(['ecsw', 'plano', 'garland', 'addison']);
const clean = (value, maximum = 280) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, maximum) : '';
const resourceName = resource => Object.hasOwn(RESOURCE_LABELS, resource || '') ? RESOURCE_LABELS[resource] : null;
const quantity = value => Number.isInteger(value) && value >= 0 && value <= 1000000;
const allocationList = item => Array.isArray(item.allocations) ? item.allocations : item.allocation ? [item.allocation] : [];
const savedSequence = record => Number.isSafeInteger(record.seq) && record.seq >= 0 ? record.seq : Number.MAX_SAFE_INTEGER;

export function intakeAttribution(item) {
  if (item.source?.kind !== 'radio') return item.generation?.source === 'nemotron' ? `${clean(item.generation.model, 64) || 'Regional model'} · exercise wording` : 'Town exercise · seeded intake';
  if (item.sourceAgent?.source === 'local-model') return `${clean(item.sourceAgent.model, 64) || 'Local model'} · source preparation`;
  if (item.sourceAgent?.source === 'signal') return 'Original phone signal';
  if (['local-rules', 'local-rules-fallback'].includes(item.sourceAgent?.source)) return 'Source-preserving local rules';
  return 'Saved source request';
}

// These are readable summaries of persisted exchanges, never model scratchpad.
// Inventory messages come from saved tool snapshots, not a separate town LLM.
export function agentMessages(state = {}) {
  const cases = (Array.isArray(state.cases) ? state.cases : []).filter(item => item && !item.archived && hubIds.has(item.hubId) && clean(item.caseId, 160));
  const byCase = new Map(cases.map(item => [item.caseId, item]));
  const events = new Map(), messages = new Map(), ordering = new Map(), sourceSequences = new Map();
  for (const record of [...(Array.isArray(state.events) ? state.events : []), ...cases.flatMap(item => Array.isArray(item.events) ? item.events : [])]) {
    if (!record || !byCase.has(record.caseId) || timestamp(record.at) === null) continue;
    const identity = clean(record.id, 120) || (Number.isInteger(record.seq) ? `seq-${record.seq}` : '');
    if (identity) events.set(`${record.caseId}:${identity}`, record);
  }
  for (const record of events.values()) if (record.action === 'case_received' && savedSequence(record) !== Number.MAX_SAFE_INTEGER) sourceSequences.set(record.caseId, Math.min(sourceSequences.get(record.caseId) ?? Number.MAX_SAFE_INTEGER, record.seq));
  const add = (item, id, at, actor, recipients, kind, text, source, eventId = null, sequence = Number.MAX_SAFE_INTEGER, part = 0) => {
    if (timestamp(at) === null || !AGENT_NAMES[actor] || !text) return;
    const to = [...new Set(recipients)].filter(value => AGENT_NAMES[value]);
    messages.set(id, { id, caseId: item.caseId, hubId: item.hubId, at: timestamp(at), actor, recipients: to, kind, text: clean(text, 560), source: clean(source, 100), eventId });
    ordering.set(id, { sequence, part, ordinal: ordering.get(id)?.ordinal ?? ordering.size });
  };
  const recentEvents = [...events.entries()].sort(([, a], [, b]) => timestamp(a.at) - timestamp(b.at) || savedSequence(a) - savedSequence(b)).slice(-600);
  for (const item of cases) {
    const people = Number.isInteger(item.request?.people) && item.request.people > 0 ? `${item.request.people} ${item.request.people === 1 ? 'person' : 'people'}` : 'People count not recorded';
    const category = CATEGORY_LABELS[item.request?.category] || 'Emergency';
    const note = clean(item.request?.note);
    add(item, `${item.caseId}:source`, timestamp(item.createdAt) || item.source?.receivedAt, item.hubId, ['supervisor'], 'Request', `${category} request · ${people}.${note ? ` ${note}` : ''}`, intakeAttribution(item), null, sourceSequences.get(item.caseId) ?? -1);
    for (const question of Array.isArray(item.followups) ? item.followups : []) {
      if (!question || question.source !== 'regional' || !clean(question.id, 80)) continue;
      add(item, `${item.caseId}:question:${question.id}`, question.createdAt, 'supervisor', [item.hubId], 'Information request', `Question for the phone user: ${clean(question.text)}`, 'Saved question · delivery tracked in request');
      if (question.answer && clean(question.answer.text)) add(item, `${item.caseId}:answer:${question.id}`, question.answer.receivedAt, item.hubId, ['supervisor'], 'User reply', `The phone user replied: ${clean(question.answer.text)}`, 'Authenticated answer through the source hub');
    }
  }
  for (const [identity, record] of recentEvents) {
    const item = byCase.get(record.caseId), resource = resourceName(record.resource || record.arguments?.resource);
    let part = 0;
    const addEvent = (suffix, actor, recipients, kind, text, source) => add(item, `${identity}:${suffix}`, record.at, actor, recipients, kind, text, source, record.id || null, savedSequence(record), part++);
    if (record.action === 'case_updated') addEvent('revision', item.hubId, ['supervisor'], 'Source update', `Source-preserving revision ${Number.isInteger(record.revision) ? record.revision : 'update'} saved.`, intakeAttribution(item));
    if (record.action === 'resource_catalog' && resource) {
      const options = (Array.isArray(record.options) ? record.options : []).filter(option => option && hubIds.has(option.townId) && option.townId !== item.hubId && quantity(option.available) && option.resource === record.resource);
      if (options.length) addEvent('query', 'supervisor', options.map(option => option.townId), 'Inventory request', `Checking ${resource.toLowerCase()} availability for ${AGENT_NAMES[item.hubId]}.`, 'Recorded inventory lookup');
      for (const option of options) addEvent(`inventory-${option.townId}`, option.townId, ['supervisor'], 'Inventory reply', `${resourceUnit(record.resource, option.available)} of ${resource.toLowerCase()} available in the saved inventory snapshot.`, 'Town inventory tool · exercise resources');
    }
    if (record.action === 'lookup_resources' && resource) {
      addEvent('lookup', 'supervisor', [], 'Decision step', `Checked the ${resource.toLowerCase()} inventory before proposing an allocation.`, 'Recorded regional model tool call');
      const hasCatalog = recentEvents.some(([, value]) => value.caseId === item.caseId && value.action === 'resource_catalog' && value.resource === record.resource && Math.abs(value.at - record.at) <= 30000);
      if (!hasCatalog) for (const option of Array.isArray(record.result?.options) ? record.result.options : []) {
        if (option && hubIds.has(option.townId) && option.townId !== item.hubId && quantity(option.available) && option.resource === record.resource) addEvent(`lookup-inventory-${option.townId}`, option.townId, ['supervisor'], 'Inventory reply', `${resourceUnit(record.resource, option.available)} of ${resource.toLowerCase()} available in the saved inventory snapshot.`, 'Town inventory tool · exercise resources');
      }
    }
    if (record.action === 'propose_allocation' && hubIds.has(record.arguments?.townId) && quantity(record.arguments?.quantity) && record.arguments.quantity > 0) {
      const proposal = record.arguments, proposedResource = resourceName(proposal.resource);
      const text = proposedResource ? `Proposed ${resourceUnit(proposal.resource, proposal.quantity)} of ${proposedResource.toLowerCase()} from ${AGENT_NAMES[proposal.townId]} for ${AGENT_NAMES[item.hubId]}.${record.result?.valid === false ? ' The proposal did not pass resource policy.' : record.result?.valid === true ? ' The recorded stock and quantity checks passed.' : ''}` : 'Proposed an unrecognized resource. The proposal did not pass resource policy.';
      addEvent('proposal', 'supervisor', ['policy'], record.result?.valid === false || !proposedResource ? 'Proposal rejected' : 'Proposal', text, 'Recorded regional model tool call');
    }
    if (['resource_allocated', 'operator_alternate'].includes(record.action) && resource && hubIds.has(record.townId) && quantity(record.quantity) && record.quantity > 0) {
      addEvent('reservation', record.action === 'operator_alternate' ? 'operator' : 'supervisor', [record.townId, item.hubId], 'Reservation', `Reserved ${resourceUnit(record.resource, record.quantity)} of ${resource.toLowerCase()} from ${AGENT_NAMES[record.townId]} for ${AGENT_NAMES[item.hubId]}.${quantity(record.remaining) ? ` ${resourceUnit(record.resource, record.remaining)} ${record.remaining === 1 ? 'remains' : 'remain'} there.` : ''}`, record.action === 'operator_alternate' ? 'Operator-selected alternative' : 'Validated resource policy');
    }
    if (record.action === 'simulated_dispatch' && hubIds.has(record.townId)) {
      const allocation = allocationList(item).find(value => value.dispatchId === record.dispatchId);
      const detail = resource && quantity(allocation?.quantity) ? `${resourceUnit(record.resource, allocation.quantity)} of ${resource.toLowerCase()}` : resource?.toLowerCase() || 'the reserved resource';
      addEvent('acknowledgment', record.townId, ['supervisor', item.hubId], 'Handoff receipt', `Acknowledged the exercise handoff of ${detail} to ${AGENT_NAMES[item.hubId]}.`, 'Saved service acknowledgment · no real dispatch');
    }
    if (record.action === 'allocation_exception') addEvent('exception', 'supervisor', [item.hubId], 'Needs attention', `No eligible ${resource?.toLowerCase() || 'resource'} allocation was recorded. Existing reservations are preserved.`, 'Resource policy');
    if (record.action === 'dispatch_pending') addEvent('pending', 'supervisor', [item.hubId], 'Awaiting receipt', 'The reservation is saved; the service acknowledgment is still pending.', 'Saved handoff state');
    if (record.action === 'validate_case' && record.detail !== 'Source fields and planning quantity policy validated.') addEvent('validation', 'supervisor', [item.hubId], 'Needs attention', 'Required source evidence needs attention before planning can continue.', 'Source validation');
    if (record.action === 'processing_failed') addEvent('failure', 'supervisor', [item.hubId], 'Needs attention', 'Automatic processing could not finish. The original request remains saved.', 'Saved processing status');
    if (record.action === 'operator_pending') addEvent('held', 'operator', ['supervisor', item.hubId], 'Decision', 'Kept this request pending for an operator.', 'Recorded operator action');
  }
  // Preserve recorded time. Saved sequence resolves equal-time events; the
  // emitted parts keep a lookup ahead of its replies within one saved event.
  return [...messages.values()].sort((a, b) => {
    const left = ordering.get(a.id), right = ordering.get(b.id);
    return a.at - b.at || left.sequence - right.sequence || left.part - right.part || left.ordinal - right.ordinal;
  }).slice(-1200);
}

export function filterAgentMessages(messages, { channel = 'all', caseId = null } = {}) {
  const selected = AGENT_CHANNELS.includes(channel) ? channel : 'all';
  return messages.filter(message => (!caseId || message.caseId === caseId) && (selected === 'all' || message.actor === selected || message.recipients.includes(selected) || message.hubId === selected));
}
