import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import publicRegion from '../../regions/utd-ecsw.json' with { type: 'json' };
import { readJson, writeJsonAtomic } from './atomic-json.mjs';
import { sourceNeedRequests } from './signal-fields.mjs';

export const LANDMARK_CATALOG_VERSION = 2;
const PUBLIC_REGION_FILE = fileURLToPath(new URL('../../regions/utd-ecsw.json', import.meta.url));
const OFFICIAL_CATALOG_FILE = fileURLToPath(new URL('../../regions/utd-campus-map.json', import.meta.url));
const RESOURCE_TYPES = ['water', 'supplies', 'medical', 'fire', 'rescue', 'safety', 'food', 'medicine', 'power'];
const MAP_NOTICE = 'Building names and approximate label anchors come from the official campus PDF. Building points are not phone GPS, radio coverage, or relay routes. The UI uses the original PDF paths; normalized anchors exist only for compatibility.';
function normalizeProfile(value) {
  if (value?.schema !== 'rescuemesh.region.v1') return value;
  return { ...value, id: value.id || 'utd-ecsw', notice: value.notice || value.mapNotice, resources: value.resources || value.resourceTypes,
    landmarks: value.landmarks?.map(l => ({ ...l, id: l.id.toLowerCase(), name: l.shortName || l.name, fullName: l.fullName || l.name, x: l.x ?? l.mapX, y: l.y ?? l.mapY, provenance: l.provenance || 'schematic' })) };
}
function validateProfile(value) {
  if (!value || value.version !== 1 || typeof value.name !== 'string' || typeof value.hubName !== 'string' || !Array.isArray(value.landmarks) || value.landmarks.length > 100) throw new Error('Invalid saved region profile; refusing replacement');
  for (const landmark of value.landmarks) if (typeof landmark.id !== 'string' || typeof landmark.name !== 'string' || !Array.isArray(landmark.aliases) || landmark.aliases.some(a => typeof a !== 'string') || !Number.isFinite(landmark.x) || landmark.x < 0 || landmark.x > 100 || !Number.isFinite(landmark.y) || landmark.y < 0 || landmark.y > 100) throw new Error('Invalid saved region landmark');
  if (!Array.isArray(value.resources) || value.resources.some(resource => !RESOURCE_TYPES.includes(resource))) throw new Error('Invalid saved resource catalog');
  return value;
}
export const DEFAULT_REGION = validateProfile(normalizeProfile(publicRegion));
export async function loadRegionProfile(directory) {
  const file = join(directory, 'region-profile.json'); let value = await readJson(file, null); const missing = value === null;
  if (missing) value = await readJson(PUBLIC_REGION_FILE, null);
  if (!value) throw new Error('Stable public region profile is missing; explicit region configuration required');
  value = validateProfile(normalizeProfile(value));
  // Saved private profiles remain stable. Catalog upgrades require the explicit migration below.
  if (missing) await writeJsonAtomic(file, value);
  return value;
}
function text(value, maximum = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid official building catalog text');
  return value.trim();
}
function aliases(values) { const unique = new Map(); for (const value of values) { const label = text(value); if (!unique.has(label.toLowerCase())) unique.set(label.toLowerCase(), label); } return [...unique.values()]; }

/** Safe projection: source building geo coordinates and SVG paths never become report locations. */
export async function readOfficialBuildingCatalog(file = OFFICIAL_CATALOG_FILE) {
  const value = await readJson(file, null);
  if (value?.schema !== 'rescuemesh.campus-map.v1' || value.version !== 1 || !Array.isArray(value.features) || value.features.length !== 24 || !Array.isArray(value.viewBox) || value.viewBox.length !== 4 || value.viewBox.some(n => !Number.isFinite(n)) || value.viewBox[2] <= 0 || value.viewBox[3] <= 0 || value.source?.url !== 'https://services.utdallas.edu/download/Parking_Map.pdf' || !/^[a-f0-9]{64}$/.test(value.source.sha256)) throw new Error('Invalid official campus source; catalog upgrade refused');
  const [left, top, width, height] = value.viewBox; const seen = new Set();
  const landmarks = value.features.map(feature => {
    if (!/^[a-z0-9_-]{1,40}$/.test(feature.id) || seen.has(feature.id) || !Array.isArray(feature.aliases) || feature.aliases.length > 30 || !Array.isArray(feature.anchor) || feature.anchor.length !== 2 || feature.anchor.some(n => !Number.isFinite(n)) || feature.sourcePage !== 1) throw new Error('Invalid official building feature');
    seen.add(feature.id); const name = text(feature.name); const shortName = text(feature.shortName, 80);
    const x = (feature.anchor[0] - left) / width * 100; const y = (feature.anchor[1] - top) / height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) throw new Error('Official building anchor outside campus drawing');
    const mapX = Number(x.toFixed(4)); const mapY = Number(y.toFixed(4));
    return { id: feature.id, name: shortName, shortName, fullName: name, aliases: aliases([...feature.aliases, feature.id, shortName, name]), x: mapX, y: mapY, mapX, mapY, provenance: 'official-pdf-label-anchor' };
  });
  return { landmarks, metadata: { id: 'utd-main-campus-buildings', version: LANDMARK_CATALOG_VERSION, featureCount: landmarks.length, sourceSchema: value.schema, sourceUrl: value.source.url, sourcePdfSha256: value.source.sha256, projectionSha256: createHash('sha256').update(JSON.stringify(landmarks)).digest('hex'), coordinateSystem: 'Normalized official PDF label anchors; compatibility only', phoneGpsTransformAvailable: false } };
}
export function publicRegionWithCatalog(base, catalog) {
  if (base.region !== 1 || base.keyId !== 1 || base.frequencyMHz !== 915 || base.hubId !== 'ecsw') throw new Error('Public region identity mismatch');
  return { ...base, mapKind: 'official-pdf', mapNotice: MAP_NOTICE, landmarkCatalogVersion: LANDMARK_CATALOG_VERSION, landmarkCatalog: catalog.metadata,
    landmarks: catalog.landmarks.map(l => ({ id: l.id.toUpperCase(), name: l.fullName, shortName: l.shortName, aliases: l.aliases, mapX: l.mapX, mapY: l.mapY, provenance: l.provenance })) };
}
/** Explicit, versioned region-profile-only migration; never loads keys, credentials or incidents. */
export async function upgradeRegionCatalog(directory, { apply = false, catalogFile = OFFICIAL_CATALOG_FILE } = {}) {
  const file = join(directory, 'region-profile.json'); const saved = await readJson(file, null);
  if (!saved) throw new Error('A saved region profile is required; catalog migration never provisions a hub');
  const current = validateProfile(normalizeProfile(saved)); const fromVersion = saved.landmarkCatalogVersion || 0;
  if (!Number.isInteger(fromVersion) || fromVersion < 0 || fromVersion > LANDMARK_CATALOG_VERSION) throw new Error('Unsupported saved catalog version; refusing downgrade');
  for (const [field, expected] of Object.entries({ region: 1, regionId: 1, keyId: 1, frequencyMHz: 915, hubId: 'ecsw' })) if (saved[field] !== undefined && saved[field] !== expected) throw new Error('Saved region identity mismatch; catalog upgrade refused');
  const catalog = await readOfficialBuildingCatalog(catalogFile); const existing = new Map(current.landmarks.map(l => [l.id.toLowerCase(), l])); const officialIds = new Set(catalog.landmarks.map(l => l.id));
  const landmarks = catalog.landmarks.map(l => { const previous = existing.get(l.id); return { ...previous, ...l, aliases: aliases([...(previous?.aliases || []), ...l.aliases]) }; });
  // Preserve private custom landmarks and unknown per-landmark fields alongside the sourced catalog.
  landmarks.push(...current.landmarks.filter(l => !officialIds.has(l.id.toLowerCase())));
  const next = { ...saved, landmarks, resources:[...new Set([...current.resources,...RESOURCE_TYPES])], landmarkCatalogVersion: LANDMARK_CATALOG_VERSION, landmarkCatalog: { ...saved.landmarkCatalog, ...catalog.metadata } };
  validateProfile(normalizeProfile(next)); const changed = JSON.stringify(saved) !== JSON.stringify(next);
  if (apply && changed) await writeJsonAtomic(file, next);
  return { changed, applied: Boolean(apply && changed), fromVersion, toVersion: LANDMARK_CATALOG_VERSION, landmarksBefore: current.landmarks.length, officialLandmarks: catalog.landmarks.length, landmarksAfter: landmarks.length, privateIdentityPreserved: true, incidentsTouched: false, credentialsTouched: false, keysTouched: false };
}
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mentions(text, alias) {
  if (!alias) return false;
  // Match the pure UI helper: BE is an official code and also an ordinary English word.
  if (alias.toLowerCase() === 'be') return text.trim() === 'BE' || /(?:\b(?:at|near|by|outside|inside|building)\s+)BE\b/.test(text);
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(alias)}(?:$|[^a-z0-9])`, 'i').test(text);
}
export function incidentLocation(item, region = DEFAULT_REGION) {
  const annotation = item.annotations?.location;
  const request = item.request;
  const hasGps = (request.flags & 1) && Number.isFinite(request.latitude) && Number.isFinite(request.longitude) && Math.abs(request.latitude) <= 90 && Math.abs(request.longitude) <= 180;
  if (!annotation && hasGps) return { kind: 'gps', label: `${request.latitude.toFixed(5)}, ${request.longitude.toFixed(5)}`, latitude: request.latitude, longitude: request.longitude, accuracy: request.accuracy, provenance: 'phone-gps', verified: false };
  const text = annotation?.label || request.note || '';
  const matches = region.landmarks.filter(l => [l.name, l.id, ...l.aliases].some(a => mentions(text, a)));
  const landmark = matches.length === 1 ? matches[0] : null;
  if (!annotation && matches.length > 1) return { kind: 'unknown', label: 'Multiple landmarks mentioned; location needs clarification', provenance: 'ambiguous-landmarks', verified: false };
  if (annotation || landmark) return { kind: 'landmark', label: annotation?.label || `Near ${landmark.name}`, landmarkId: landmark?.id || null, provenance: annotation ? 'operator-corrected' : 'user-entered-landmark', verified: false };
  return { kind: 'unknown', label: 'Location not provided', provenance: 'unknown', verified: false };
}
export function sourceResource(request) {
  return sourceNeedRequests(request)[0]?.resource;
}
