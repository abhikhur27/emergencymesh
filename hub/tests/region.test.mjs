import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REGION, LANDMARK_CATALOG_VERSION, incidentLocation, loadRegionProfile, readOfficialBuildingCatalog, upgradeRegionCatalog } from '../src/region.mjs';

const report = note => ({ request: { flags: 0, latitude: 0, longitude: 0, accuracy: 65535, note } });
async function fixture(t) { const directory = await mkdtemp(join(tmpdir(), 'rescuemesh-catalog-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
function oldProfile() {
  const value = structuredClone(DEFAULT_REGION); delete value.landmarkCatalog; delete value.landmarkCatalogVersion;
  value.landmarks = value.landmarks.filter(l => ['ecsw', 'hh', 'ecsn', 'ecss', 'fo', 'mc', 'su', 'ps4'].includes(l.id));
  value.id = 'saved-private-profile-identity'; value.privateMetadata = { retained: true, customOperatorSetting: 'unchanged' };
  value.landmarks.find(l => l.id === 'ecsw').privateField = 'keep this metadata'; return value;
}
test('public region has 24 official building aliases without projecting building geo into phone GPS', async () => {
  assert.equal(DEFAULT_REGION.landmarks.length, 24); assert.equal(DEFAULT_REGION.region, 1); assert.equal(DEFAULT_REGION.keyId, 1); assert.equal(DEFAULT_REGION.frequencyMHz, 915); assert.equal(DEFAULT_REGION.landmarkCatalogVersion, LANDMARK_CATALOG_VERSION);
  const catalog = await readOfficialBuildingCatalog(); assert.equal(catalog.landmarks.length, 24); assert.equal(catalog.metadata.phoneGpsTransformAvailable, false);
  assert.doesNotMatch(JSON.stringify(catalog), /"(?:geo|latitude|longitude|path|bounds)"\s*:/);
  const source = JSON.parse(await readFile(fileURLToPath(new URL('../../regions/utd-campus-map.json', import.meta.url)), 'utf8'));
  const be = source.features.find(f => f.id === 'be'); const projected = catalog.landmarks.find(f => f.id === 'be');
  assert.equal(projected.x, Number(((be.anchor[0] - source.viewBox[0]) / source.viewBox[2] * 100).toFixed(4)));
  assert.equal(projected.y, Number(((be.anchor[1] - source.viewBox[1]) / source.viewBox[3] * 100).toFixed(4)));
  assert.ok(catalog.landmarks.every(l => l.x >= 0 && l.x <= 100 && l.y >= 0 && l.y <= 100));
});
test('Berkner, explicit BE, HH, SCI and full official building names resolve to unverified landmarks', () => {
  for (const [note, expected] of [['Need assistance near Berkner', 'be'], ['Need assistance near BE', 'be'], ['BE', 'be'], ['Water outside Lloyd V. Berkner Hall', 'be'], ['Need supplies near SCI', 'sci'], ['Outside Sciences Building', 'sci'], ['Water near HH', 'hh'], ['Near Hoblitzelle Hall', 'hh']]) {
    const location = incidentLocation(report(note)); assert.equal(location.kind, 'landmark', note); assert.equal(location.landmarkId, expected, note); assert.equal(location.verified, false); assert.equal('latitude' in location, false); assert.equal('longitude' in location, false);
  }
});
test('ordinary English be, unknown parking references and multiple buildings do not invent a position', () => {
  const location = incidentLocation(report('Please be careful near ECSW')); assert.equal(location.kind, 'landmark'); assert.equal(location.landmarkId, 'ecsw');
  for (const note of ['Please be careful', 'please be near me', 'near be', 'Need help in parking lot C', 'Near an unknown parking lot']) assert.equal(incidentLocation(report(note)).kind, 'unknown', note);
  for (const note of ['Walking from ECSW to HH', 'Between Berkner and SCI', 'Berkner and Sciences Building']) { const ambiguous = incidentLocation(report(note)); assert.equal(ambiguous.kind, 'unknown', note); assert.equal(ambiguous.provenance, 'ambiguous-landmarks'); assert.equal('latitude' in ambiguous, false); }
});
test('recorded phone GPS remains authoritative over building names and explicit case annotations preserve the source', () => {
  const item = report('Between Berkner and SCI'); item.request = Object.freeze({ ...item.request, flags: 1, latitude: 32.99123, longitude: -96.74123, accuracy: 9 });
  const location = incidentLocation(item); assert.equal(location.kind, 'gps'); assert.equal(location.latitude, item.request.latitude); assert.equal(location.longitude, item.request.longitude); assert.equal(location.accuracy, 9); assert.equal(location.provenance, 'phone-gps');
  const annotated = incidentLocation({ ...item, annotations: { location: { label: 'Near SCI east entrance' } } }); assert.equal(annotated.kind, 'landmark'); assert.equal(annotated.provenance, 'operator-corrected'); assert.equal(annotated.landmarkId, 'sci'); assert.equal('latitude' in annotated, false); assert.equal(item.request.flags, 1); assert.equal(item.request.latitude, 32.99123);
});
test('controlled migration is dry-run by default, preserves private identity and other files, and is idempotent', async t => {
  const directory = await fixture(t); const file = join(directory, 'region-profile.json'); const legacy = oldProfile(); await writeFile(file, JSON.stringify(legacy));
  const sentinels = { 'config.json': '{"keys":"unchanged-fixture"}', 'operator-token.txt': 'fixture-credential-do-not-touch', 'identity-store.json': '{"sessions":["preserved-fixture"]}', 'incidents.json': '{"historical":[19],"allocations":"do not replay"}' };
  for (const [name, contents] of Object.entries(sentinels)) await writeFile(join(directory, name), contents);
  const before = await readFile(file, 'utf8'); const dry = await upgradeRegionCatalog(directory); assert.equal(dry.changed, true); assert.equal(dry.applied, false); assert.equal(await readFile(file, 'utf8'), before);
  const result = await upgradeRegionCatalog(directory, { apply: true }); assert.equal(result.applied, true); assert.equal(result.officialLandmarks, 24); assert.equal(result.landmarksBefore, 8); assert.equal(result.landmarksAfter, 24);
  const migrated = JSON.parse(await readFile(file, 'utf8')); const { landmarks: oldLandmarks, landmarkCatalog: oldCatalog, landmarkCatalogVersion: oldVersion, ...oldPrivateFields } = legacy; const { landmarks, landmarkCatalog, landmarkCatalogVersion, ...newPrivateFields } = migrated;
  assert.deepEqual(newPrivateFields, oldPrivateFields); assert.equal(landmarks.find(l => l.id === 'ecsw').privateField, 'keep this metadata'); assert.equal(landmarkCatalogVersion, 2); assert.equal(landmarkCatalog.featureCount, 24);
  for (const [name, contents] of Object.entries(sentinels)) assert.equal(await readFile(join(directory, name), 'utf8'), contents);
  const first = await readFile(file, 'utf8'); const again = await upgradeRegionCatalog(directory, { apply: true }); assert.equal(again.changed, false); assert.equal(again.applied, false); assert.equal(await readFile(file, 'utf8'), first);
  const loaded = await loadRegionProfile(directory); assert.equal(loaded.id, legacy.id); assert.equal(incidentLocation(report('Water near Berkner'), loaded).landmarkId, 'be');
});
test('normal loading does not silently migrate an old profile, and migration retains custom landmarks and aliases', async t => {
  const directory = await fixture(t); const legacy = oldProfile(); legacy.landmarks.find(l => l.id === 'ecsw').aliases.push('west demo doorway'); legacy.landmarks.push({ id: 'private-courtyard', name: 'Private courtyard', aliases: ['private courtyard'], x: 5, y: 5, privateField: true });
  const file = join(directory, 'region-profile.json'); await writeFile(file, JSON.stringify(legacy)); const before = await readFile(file, 'utf8'); const loaded = await loadRegionProfile(directory); assert.equal(loaded.landmarks.length, 9); assert.equal(await readFile(file, 'utf8'), before);
  await upgradeRegionCatalog(directory, { apply: true }); const current = await loadRegionProfile(directory); assert.equal(current.landmarks.length, 25); assert.ok(current.landmarks.find(l => l.id === 'ecsw').aliases.includes('west demo doorway')); assert.equal(current.landmarks.find(l => l.id === 'private-courtyard').privateField, true);
});
test('missing, foreign-region, future-version and malformed source profiles fail closed without replacement', async t => {
  const directory = await fixture(t); const file = join(directory, 'region-profile.json'); await assert.rejects(upgradeRegionCatalog(directory, { apply: true }), /never provisions/);
  for (const legacy of [{ ...oldProfile(), region: 2 }, { ...oldProfile(), landmarkCatalogVersion: 99 }]) { await writeFile(file, JSON.stringify(legacy)); const before = await readFile(file, 'utf8'); await assert.rejects(upgradeRegionCatalog(directory, { apply: true }), /refused|downgrade/); assert.equal(await readFile(file, 'utf8'), before); }
  const legacy = oldProfile(); await writeFile(file, JSON.stringify(legacy)); const sourceFile = join(directory, 'malformed-source.json'); await writeFile(sourceFile, '{"schema":"wrong"}'); const before = await readFile(file, 'utf8'); await assert.rejects(upgradeRegionCatalog(directory, { apply: true, catalogFile: sourceFile }), /source/); assert.equal(await readFile(file, 'utf8'), before);
});

test('new supply resource IDs require explicit migration and preserve every other saved profile field',async t=>{
  const directory=await fixture(t),file=join(directory,'region-profile.json');await writeFile(file,JSON.stringify(oldProfile()));
  await upgradeRegionCatalog(directory,{apply:true});const current=JSON.parse(await readFile(file,'utf8'));
  current.resources=['water','supplies','medical','fire','rescue','safety'];await writeFile(file,JSON.stringify(current));const before=await readFile(file,'utf8');
  assert.equal((await loadRegionProfile(directory)).resources.length,6);assert.equal(await readFile(file,'utf8'),before);
  const dry=await upgradeRegionCatalog(directory);assert.equal(dry.changed,true);assert.equal(await readFile(file,'utf8'),before);
  await upgradeRegionCatalog(directory,{apply:true});const migrated=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(migrated.resources,[...current.resources,'food','medicine','power']);
  const {resources:oldResources,...oldFields}=current,{resources:newResources,...newFields}=migrated;assert.deepEqual(newFields,oldFields);
});
