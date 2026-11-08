import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from './atomic-json.mjs';

export const DEFAULT_REGION = {
  version: 1, id: 'utd-ecsw', name: 'UT Dallas', hubName: 'ECSW', timeZone: 'America/Chicago', frequencyMHz: 915,
  notice: 'Offline schematic. Landmarks do not establish GPS, radio routes or measured coverage.',
  landmarks: [
    { id: 'ecsw', name: 'ECSW', fullName: 'Engineering and Computer Science West', aliases: ['ECSW', 'Engineering and Computer Science West'], x: 62, y: 78, provenance: 'schematic' },
    { id: 'hh', name: 'Hoblitzelle', fullName: 'Karl Hoblitzelle Hall', aliases: ['Hoblitzelle', 'Hoblitzelle Hall', 'Karl Hoblitzelle Hall', 'HH'], x: 30, y: 28, provenance: 'schematic' },
    { id: 'ecss', name: 'ECSS', fullName: 'Engineering and Computer Science South', aliases: ['ECSS'], x: 64, y: 58, provenance: 'schematic' },
    { id: 'mc', name: 'McDermott Library', fullName: 'Eugene McDermott Library', aliases: ['McDermott', 'McDermott Library'], x: 82, y: 49, provenance: 'schematic' },
  ],
  resources: ['water', 'supplies', 'medical', 'fire', 'rescue', 'safety'],
};
export async function loadRegionProfile(directory) {
  const file = join(directory, 'region-profile.json'); let value = await readJson(file, null); const missing = value === null;
  if (missing) value = await readJson(fileURLToPath(new URL('../../regions/utd-ecsw.json', import.meta.url)), null);
  if (value?.schema === 'rescuemesh.region.v1') value = { ...value, id: 'utd-ecsw', notice: value.mapNotice, resources: value.resourceTypes, landmarks: value.landmarks?.map(l => ({ ...l, id: l.id.toLowerCase(), name: l.shortName || l.name, fullName: l.name, x: l.mapX, y: l.mapY, provenance: 'schematic' })) };
  if (!value) throw new Error('Stable public region profile is missing; explicit region configuration required');
  if (value.version !== 1 || typeof value.name !== 'string' || typeof value.hubName !== 'string' || !Array.isArray(value.landmarks) || value.landmarks.length > 100) throw new Error('Invalid saved region profile; refusing replacement');
  for (const landmark of value.landmarks) if (typeof landmark.id !== 'string' || typeof landmark.name !== 'string' || !Array.isArray(landmark.aliases) || !Number.isFinite(landmark.x) || landmark.x < 0 || landmark.x > 100 || !Number.isFinite(landmark.y) || landmark.y < 0 || landmark.y > 100) throw new Error('Invalid saved region landmark');
  if (!Array.isArray(value.resources) || value.resources.some(resource => !DEFAULT_REGION.resources.includes(resource))) throw new Error('Invalid saved resource catalog');
  if (missing) await writeJsonAtomic(file, value);
  return value;
}
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function incidentLocation(item, region = DEFAULT_REGION) {
  const annotation = item.annotations?.location;
  const request = item.request;
  if (!annotation && (request.flags & 1)) return { kind: 'gps', label: `${request.latitude.toFixed(5)}, ${request.longitude.toFixed(5)}`, latitude: request.latitude, longitude: request.longitude, accuracy: request.accuracy, provenance: 'phone-gps', verified: false };
  const text = annotation?.label || request.note || '';
  const matches = region.landmarks.filter(l => l.aliases.some(a => new RegExp(`(?:^|\\b)${escapeRegex(a)}(?:\\b|$)`, 'i').test(text)));
  const landmark = matches.length === 1 ? matches[0] : null;
  if (!annotation && matches.length > 1) return { kind: 'unknown', label: 'Multiple landmarks mentioned; location needs clarification', provenance: 'ambiguous-landmarks', verified: false };
  if (annotation || landmark) return { kind: 'landmark', label: annotation?.label || `Near ${landmark.name}`, landmarkId: landmark?.id || null, provenance: annotation ? 'operator-corrected' : 'user-entered-landmark', verified: false };
  return { kind: 'unknown', label: 'Location not provided', provenance: 'unknown', verified: false };
}
export function sourceResource(request) {
  if (request.category === 5 && /\b(water|drink(?:ing)?|hydration)\b/i.test(request.note || '')) return 'water';
  return ({ 1: 'medical', 2: 'fire', 3: 'rescue', 4: 'safety', 5: 'supplies' })[request.category];
}
