export const DEFAULT_LANDMARKS = [
  { id: 'ecsw', name: 'ECSW', aliases: ['ECSW', 'Engineering and Computer Science West'], x: 66, y: 74 },
  { id: 'hh', name: 'Hoblitzelle', aliases: ['Hoblitzelle', 'Karl Hoblitzelle Hall', 'HH'], x: 36, y: 34 },
  { id: 'fo', name: 'Founders', aliases: ['Founders', 'Founders Building'], x: 61, y: 26 },
  { id: 'mc', name: 'McDermott Library', aliases: ['McDermott', 'McDermott Library', 'library'], x: 84, y: 39 },
  { id: 'ps4', name: 'Parking Structure 4', aliases: ['Parking Structure 4', 'PS4'], x: 51, y: 10 }
];
export function landmarksFor(profile) {
  if (!Array.isArray(profile?.landmarks) || !profile.landmarks.length) return DEFAULT_LANDMARKS;
  return profile.landmarks.filter(p => p && typeof p.name === 'string').map(p => ({
    ...p, id: String(p.id || p.name), aliases: Array.isArray(p.aliases) ? p.aliases.filter(a => typeof a === 'string') : []
  }));
}
function mentions(text, alias) {
  if (!alias) return false;
  // BE is the official Berkner code, but also an ordinary English word.
  // Accept the code as a standalone label or an explicit uppercase place phrase.
  if (alias.toLowerCase() === 'be') return text.trim() === 'BE' || /(?:\b(?:at|near|by|outside|inside|building)\s+)BE\b/.test(text);
  const escaped = alias.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^a-z0-9])' + escaped + '(?:$|[^a-z0-9])', 'i').test(text);
}
export function matchingLandmark(text, profile) {
  const matches = landmarksFor(profile).filter(p => [p.name, p.id, ...p.aliases].some(a => mentions(String(text || ''), a)));
  return matches.length === 1 ? matches[0] : null;
}
export function hasGps(request) {
  return Boolean(request && (request.flags & 1) && Number.isFinite(request.latitude) &&
    Number.isFinite(request.longitude) && Math.abs(request.latitude) <= 90 && Math.abs(request.longitude) <= 180);
}
export function reportedLocation(item, profile) {
  const request = item.request || {};
  if (hasGps(request)) return {
    kind: 'gps', label: request.latitude.toFixed(5) + ', ' + request.longitude.toFixed(5),
    provenance: 'Phone GPS', verified: false, landmark: null,
    accuracy: Number.isFinite(request.accuracy) && request.accuracy !== 65535 ? request.accuracy : null
  };
  const text = String(request.note || '');
  const matches = landmarksFor(profile).filter(p => [p.name, p.id, ...p.aliases].some(a => mentions(text, a)));
  if (matches.length === 1) return {
    kind: 'landmark', label: matches[0].name, provenance: 'Landmark mentioned in the original note',
    verified: false, landmark: matches[0], accuracy: null
  };
  if (matches.length > 1) return {
    kind: 'unknown', label: 'Multiple landmarks mentioned', provenance: 'Exact place not established',
    verified: false, landmark: null, accuracy: null
  };
  return { kind: 'unknown', label: 'Location not provided', provenance: 'No GPS or recognized landmark', verified: false, landmark: null, accuracy: null };
}
export function caseLocation(item, profile) {
  const correction = item.annotations?.location;
  const annotated = correction?.label ? { ...correction, kind: 'landmark', provenance: 'operator-corrected' } : item.coordination?.location;
  if (!annotated || typeof annotated.label !== 'string' || !annotated.label.trim() || annotated.kind === 'unknown') return reportedLocation(item, profile);
  if (annotated.kind === 'gps') return reportedLocation(item, profile);
  if (annotated.provenance === 'user-entered-landmark') return reportedLocation(item, profile);
  return {
    kind: 'landmark', label: annotated.label, provenance: annotated.provenance === 'operator-corrected' ? 'Operator-corrected landmark · approximate' : 'Case landmark · approximate',
    verified: false, landmark: matchingLandmark(annotated.label, profile), accuracy: null
  };
}
function numeric(values) { return values.filter(value => typeof value === 'number' && Number.isFinite(value)); }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
}
function signal(values) {
  const sample = numeric(values);
  return { n: sample.length, min: sample.length ? Math.min(...sample) : null, max: sample.length ? Math.max(...sample) : null, median: median(sample) };
}
export function receptionSummary(incidents, profile) {
  const unique = new Map();
  incidents.filter(item => !item.simulated).forEach((item, index) => unique.set(item.id || ('missing-' + index), item));
  const reports = [...unique.values()];
  const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
  const times = reports.map(item => timestamp(item.receivedAt)).filter(Number.isFinite);
  const latest = reports.map(item => timestamp(item.lastReceivedAt ?? item.receivedAt)).filter(Number.isFinite);
  const gps = reports.filter(item => hasGps(item.request)).length;
  return {
    requests: reports.length, receptions: reports.reduce((n, item) => n + (Number.isInteger(item.receptions) && item.receptions > 0 ? item.receptions : 1), 0),
    gps, withoutGps: reports.length - gps,
    namedLandmarks: reports.filter(item => reportedLocation(item, profile).kind === 'landmark').length,
    first: times.length ? new Date(Math.min(...times)).toISOString() : null,
    last: latest.length ? new Date(Math.max(...latest)).toISOString() : null,
    rssi: signal(reports.map(item => item.radio?.rssi)), snr: signal(reports.map(item => item.radio?.snr))
  };
}
export function sortReports(incidents) {
  const timestamp = value => typeof value === 'number' && Number.isFinite(value) ? value : Date.parse(value);
  return [...incidents].sort((a, b) => (timestamp(b.receivedAt) || 0) - (timestamp(a.receivedAt) || 0));
}
