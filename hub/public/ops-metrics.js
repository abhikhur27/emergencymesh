// Source-only aggregates. A reception is not a new request or a delivered receipt.
export const SUPPLY_FLAGS = Object.freeze({ food: 16, water: 32, medicine: 64, power: 128 });
export const RESOURCE_LABELS = Object.freeze({ food: 'Food', water: 'Drinking water', medicine: 'Medical supplies', power: 'Power support', supplies: 'Supply kits', medical: 'Medical response', fire: 'Fire response', rescue: 'Rescue response', safety: 'Safety support' });
export const CATEGORY_LABELS = Object.freeze({ 1: 'Medical', 2: 'Fire', 3: 'Rescue', 4: 'Safety', 5: 'Supplies', 6: 'Flood', 7: 'Earthquake', 8: 'Other' });
export function timestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
export function distinct(items = [], key = 'id') {
  const map = new Map();
  for (const item of items) if (item && typeof item[key] === 'string' && item[key]) {
    const old = map.get(item[key]);
    if (!old || (timestamp(item.updatedAt || item.lastReceivedAt || item.receivedAt) || 0) >= (timestamp(old.updatedAt || old.lastReceivedAt || old.receivedAt) || 0)) map.set(item[key], item);
  }
  return [...map.values()];
}
export function supplySelections(request = {}) {
  return Object.entries(SUPPLY_FLAGS).filter(([, bit]) => Number.isInteger(request.flags) && request.flags >= 0 && request.flags <= 255 && (request.flags & bit) !== 0).map(([name]) => name);
}
export function validGps(request = {}) { return Number.isInteger(request.flags) && request.flags >= 0 && request.flags <= 255 && Boolean(request.flags & 1) && Number.isFinite(request.latitude) && Number.isFinite(request.longitude) && Math.abs(request.latitude) <= 90 && Math.abs(request.longitude) <= 180; }
export function intakeHistogram(items, { now = Date.now(), at = 'receivedAt', bins = 12, binMs = 300000 } = {}) {
  const end = timestamp(now) || Date.now(), start = end - bins * binMs;
  const result = Array.from({ length: bins }, (_, i) => ({ start: start + i * binMs, end: start + (i + 1) * binMs, count: 0 }));
  for (const item of items) { const value = timestamp(item[at]); if (value === null || value < start || value > end) continue; const index = Math.min(bins - 1, Math.floor((value - start) / binMs)); result[index].count++; }
  return { start, end, bins: result, total: result.reduce((n, bin) => n + bin.count, 0) };
}
export function allocationsFor(item, { embedded = false } = {}) {
  const values = Array.isArray(item?.allocations) && item.allocations.length ? item.allocations : item?.allocation ? [item.allocation] : [];
  const unique = new Map();
  for (const allocation of values) if (allocation && !allocation.released && typeof allocation.resource === 'string' && Number.isInteger(allocation.quantity) && allocation.quantity > 0 && (!item.caseId || allocation.caseId === item.caseId || embedded && allocation.caseId === undefined)) {
    const key = allocation.id || `${allocation.caseId || ''}:${allocation.resource}:${allocation.townId}`; unique.set(key, allocation);
  }
  return [...unique.values()];
}
export function needsFor(item) {
  const list = item?.summary?.needRequests || item?.coordination?.summary?.needRequests;
  if (Array.isArray(list) && list.length) return list.filter(n => n && typeof n.resource === 'string' && Number.isInteger(n.quantity) && n.quantity > 0);
  const summary = item?.coordination?.summary || item?.summary;
  return summary?.resource && Number.isInteger(summary.quantity) ? [{ resource: summary.resource, quantity: summary.quantity, quantityBasis: 'legacy-policy' }] : [];
}
export function resourceUnit(resource, count) { return `${count} ${['medical', 'fire', 'rescue', 'safety'].includes(resource) ? count === 1 ? 'team' : 'teams' : count === 1 ? 'unit' : 'units'}`; }
export function hubMetrics(state = {}, now = state.serverTime || Date.now()) {
  const radio = distinct((state.incidents || []).filter(i => !i.simulated));
  const coordinated = radio.filter(i => i.coordination);
  const priorities = [1, 2, 3].map(value => radio.filter(i => i.request?.severity === value).length);
  const acknowledged = coordinated.filter(i => (i.coordination.sharedRevision || 0) >= i.coordination.revision && i.coordination.revision > 0);
  const lastAck = acknowledged.map(i => timestamp(i.coordination.acknowledgedAt)).filter(v => v !== null).sort((a, b) => b - a)[0] || null;
  return { requests: radio.length, receptions: radio.reduce((n, i) => n + (Number.isInteger(i.receptions) && i.receptions > 0 ? i.receptions : 1), 0), gps: radio.filter(i => validGps(i.request)).length, withoutGps: radio.filter(i => !validGps(i.request)).length, priorities, sourceOnly: coordinated.filter(i => i.coordination.summary?.source === 'signal').length, modelAssisted: coordinated.filter(i => i.coordination.summary?.source === 'local-model').length, waitingReview: radio.filter(i => i.status !== 'operator-reviewed').length, needsAttention: coordinated.filter(i => ['needs-review', 'partial'].includes(i.coordination.stage)).length, pending: coordinated.filter(i => (i.coordination.sharedRevision || 0) < i.coordination.revision).length, acknowledged: acknowledged.length, returned: coordinated.filter(i => i.coordination.supervisorSeq > 0 || timestamp(i.coordination.lastUpdateAt) !== null || i.coordination.allocations?.length || i.coordination.allocation).length, lastAck, histogram: intakeHistogram(radio, { now }) };
}
export function regionalMetrics(state = {}, now = state.serverTime || Date.now()) {
  const cases = distinct((state.cases || []).filter(c => !c.archived), 'caseId');
  const allocations = cases.flatMap(allocationsFor);
  const acknowledged = allocations.filter(a => Boolean(a.acknowledgment) || timestamp(a.acknowledgedAt) !== null);
  const byTown = Object.fromEntries((state.hubs || []).map(h => [h.id, cases.filter(c => c.hubId === h.id).length]));
  const available = (state.hubs || []).filter(h => h.resources).reduce((totals, hub) => { for (const [resource, count] of Object.entries(hub.resources)) if (Number.isFinite(count) && count >= 0) totals[resource] = (totals[resource] || 0) + count; return totals; }, {});
  return { requests: cases.length, physical: cases.filter(c => c.source?.kind === 'radio').length, generated: cases.filter(c => c.source?.kind === 'simulated' || c.internalSimulation).length, gps: cases.filter(c => c.location?.kind === 'gps').length, missingLocation: cases.filter(c => c.location?.kind === 'unknown').length, acknowledged: acknowledged.length, allocations: allocations.length, needsAttention: cases.filter(c => ['needs-review', 'partial'].includes(c.status)).length, inProgress: cases.filter(c => !['simulated-dispatched', 'needs-review', 'partial'].includes(c.status)).length, priorities: [1, 2, 3].map(value => cases.filter(c => c.request?.severity === value).length), byTown, available, histogram: intakeHistogram(cases, { now, at: 'createdAt' }) };
}
