import { createHash } from 'node:crypto';

export const SCHEMA = 'rescuemesh.case.v1';
export const RESOURCES = ['water', 'supplies', 'medical', 'fire', 'rescue', 'safety'];
export const TOWN_IDS = ['plano', 'garland', 'addison'];
const string = (value, name, max, required = true) => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw Object.assign(new Error('Invalid ' + name), { status: 400 });
  return value.trim();
};
const id = (value, name, max = 180) => { value = string(value, name, max); if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value)) throw Object.assign(new Error('Invalid ' + name), { status: 400 }); return value; };
const integer = (value, min, max, name) => { if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error('Invalid ' + name), { status: 400 }); return value; };
function finite(value, min, max, name) { if (!Number.isFinite(value) || value < min || value > max) throw Object.assign(new Error('Invalid ' + name), { status: 400 }); return value; }
export function validateCase(input, { allowedHubId = null, simulated = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schema !== SCHEMA) throw Object.assign(new Error('Unsupported case schema'), { status: 400 });
  const hubId = id(input.hubId, 'hubId', 40);
  if (allowedHubId && hubId !== allowedHubId) throw Object.assign(new Error('Hub scope rejected'), { status: 403 });
  const source = input.source;
  if (!source || !['radio', 'simulated'].includes(source.kind) || (simulated && source.kind !== 'simulated')) throw Object.assign(new Error('Invalid source'), { status: 400 });
  const request = input.request;
  if (!request || typeof request !== 'object') throw Object.assign(new Error('Invalid request'), { status: 400 });
  const note = request.note === undefined ? '' : String(request.note);
  if (typeof request.note !== 'string' && request.note !== undefined) throw Object.assign(new Error('Invalid note'), { status: 400 });
  if (Buffer.byteLength(note, 'utf8') > 120 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(note)) throw Object.assign(new Error('Invalid note'), { status: 400 });
  const canonicalRequest = { category: integer(request.category, 1, 5, 'category'), severity: integer(request.severity, 1, 3, 'severity'), people: integer(request.people, 1, 255, 'people'), note };
  const summary = input.summary || {};
  const canonicalSummary = { text: summary.text === undefined ? '' : string(summary.text, 'summary', 400), resource: summary.resource === undefined ? null : string(summary.resource, 'resource', 24), quantity: summary.quantity === undefined ? null : integer(summary.quantity, 1, 20, 'quantity') };
  if (canonicalSummary.resource !== null && !RESOURCES.includes(canonicalSummary.resource)) throw Object.assign(new Error('Unsupported resource'), { status: 400 });
  if (summary.needType !== undefined) canonicalSummary.needType = string(summary.needType, 'needType', 80);
  const place = input.location || { kind: 'unknown' };
  if (!['gps', 'landmark', 'unknown'].includes(place.kind)) throw Object.assign(new Error('Invalid location kind'), { status: 400 });
  const location = { kind: place.kind, label: place.label ? string(place.label, 'location label', 160) : '', verified: false };
  if (place.kind === 'gps') {
    location.latitude = finite(place.latitude ?? place.lat, -90, 90, 'latitude');
    location.longitude = finite(place.longitude ?? place.lon, -180, 180, 'longitude');
    location.accuracy = finite(place.accuracy ?? place.accuracyMeters ?? 65535, 0, 65535, 'accuracy');
    // Valid coordinates are sender evidence, not independent verification.
    location.verified = false;
  }
  if (place.kind === 'landmark' && !location.label) throw Object.assign(new Error('Landmark label required'), { status: 400 });
  return { schema: SCHEMA, eventId: id(input.eventId, 'eventId', 220), hubId, caseId: id(input.caseId, 'caseId'), revision: integer(input.revision, 1, 1000000, 'revision'),
    source: { kind: source.kind, requestId: id(source.requestId, 'requestId'), receivedAt: finite(source.receivedAt, 0, 1e15, 'receivedAt') }, request: canonicalRequest, summary: canonicalSummary, location };
}
export function bodyDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function deriveNeed(item) {
  const resource = item.request.category === 5 ? (/\b(water|drink(?:ing)?|hydration)\b/i.test(item.request.note) ? 'water' : 'supplies') : ['','medical','fire','rescue','safety'][item.request.category];
  const proposed = item.summary.resource || resource;
  const quantity = item.summary.quantity ?? (['water','supplies'].includes(resource) ? item.request.people : 1);
  const issues = [];
  if (proposed !== resource) issues.push('The proposed resource does not match the source category or note.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || quantity > item.request.people) issues.push('Resource quantity needs review.');
  if (item.request.people > 20 && ['water','supplies'].includes(resource)) issues.push('This request exceeds the automatic simulation limit.');
  if (item.location.kind === 'unknown') issues.push('The request needs a usable location or landmark.');
  return { resource, quantity, issues };
}
export const immutableSource = item => JSON.stringify({ hubId: item.hubId, source: item.source, request: item.request });
