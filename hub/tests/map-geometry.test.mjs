import test from 'node:test';
import assert from 'node:assert/strict';
import { worldBounds, fitCamera, campusContextCamera, project, unproject, panCamera, zoomCamera, placeLabels, overlaps, projectGps } from '../public/map-geometry.js';
import { profileWithCampus } from '../public/campus-map.js';
import { reportedLocation } from '../public/reception-data.js';
import { readFileSync } from 'node:fs';
const bounds = worldBounds({ viewBox: [35.69, 90.02, 540.21, 666.29] });
const viewport = { width: 680, height: 420 };
test('zoom keeps the map point under the cursor and pan moves in screen pixels', () => {
  const camera = { ...fitCamera(bounds), zoom: 3 }; const anchor = { x: 210, y: 240 };
  const before = unproject(anchor, bounds, viewport, camera); const zoomed = zoomCamera(camera, 1.4, anchor, bounds, viewport); const after = project(before, bounds, viewport, zoomed);
  assert(Math.abs(after.x - anchor.x) < 1e-8); assert(Math.abs(after.y - anchor.y) < 1e-8);
  const moved = project(before, bounds, viewport, panCamera(camera, 40, -20, bounds, viewport));
  assert(Math.abs(moved.x - anchor.x - 40) < 1e-8); assert(Math.abs(moved.y - anchor.y + 20) < 1e-8);
});
test('zoom and panning remain bounded and reset preserves actual world coordinates', () => {
  const camera = fitCamera(bounds); assert.equal(zoomCamera(camera, 100, { x: 340, y: 210 }, bounds, viewport).zoom, 8);
  assert.equal(zoomCamera(camera, .001, { x: 340, y: 210 }, bounds, viewport).zoom, 1);
  const reset = project({ x: 237, y: 482 }, bounds, viewport, camera); const restored = unproject(reset, bounds, viewport, camera);
  assert(Math.abs(restored.x - 237) < 1e-8); assert(Math.abs(restored.y - 482) < 1e-8);
});
test('nearby ECSW and ECSS labels cannot collide or cover map controls', () => {
  const reserved = [{ x: 300, y: 10, width: 44, height: 136 }];
  const result = placeLabels([{ id: 'ecsw', label: 'ECSW', x: 150, y: 200, priority: 100 }, { id: 'ecss', label: 'ECSS', x: 190, y: 186, priority: 40 }, { id: 'hh', label: 'HH', x: 150, y: 160, priority: 30 }], { width: 360, height: 300 }, reserved);
  assert(result.some(p => p.id === 'ecsw')); assert(result.some(p => p.id === 'ecss'));
  for (let i = 0; i < result.length; i++) { assert(!reserved.some(r => overlaps(result[i].box, r))); for (let j = i + 1; j < result.length; j++) assert(!overlaps(result[i].box, result[j].box)); }
});
test('PDF geometry never plots GPS merely because building WGS84 coordinates exist', () => {
  const data = { viewBox: [0, 0, 612, 792], georeference: { available: false }, features: [{ geo: { latitude: 32.98632, longitude: -96.751701 } }] };
  assert.equal(projectGps({ flags: 1, latitude: 32.98632, longitude: -96.751701 }, data), null);
});
test('campus alias enrichment keeps enrollment metadata independent and never copies stale region XY', () => {
  const profile = { landmarks: [{ id: 'ecsw', aliases: ['old campus label'], x: 66, y: 74 }] };
  const result = profileWithCampus(profile, { features: [{ id: 'ecsw', name: 'Engineering and Computer Science West', shortName: 'ECSW', aliases: ['ECSW'], anchor: [237, 482] }] });
  assert(result.landmarks[0].aliases.includes('old campus label')); assert.equal(result.landmarks[0].x, undefined); assert.equal(profile.landmarks[0].x, 66);
});
test('Berkner building code does not turn ordinary English be into a false landmark', () => {
  const profile = profileWithCampus({}, { features: [{ id: 'be', shortName: 'BE', name: 'Berkner Hall', aliases: ['Berkner'] }, { id: 'ecsw', shortName: 'ECSW', name: 'Engineering and Computer Science West', aliases: [] }] });
  assert.equal(reportedLocation({ request: { flags: 0, note: 'Please be careful near ECSW' } }, profile).landmark.id, 'ecsw');
  assert.equal(reportedLocation({ request: { flags: 0, note: 'Please be careful' } }, profile).kind, 'unknown');
  assert.equal(reportedLocation({ request: { flags: 0, note: 'near BE' } }, profile).landmark.id, 'be');
});
test('selected ECSS remains labeled after zoom on the actual crowded wide campus viewport', () => {
  const data = JSON.parse(readFileSync(new URL('../public/assets/campus-map.json', import.meta.url)));
  const wide = { width: 980, height: 260 }; const world = worldBounds(data); const camera = { x: 295, y: 455, zoom: 4.44 };
  const points = data.features.map(f => ({ id: f.id, label: f.shortName || f.name, ...project({ x: f.anchor[0], y: f.anchor[1] }, world, wide, camera), required: f.id === 'ecss', priority: f.id === 'ecss' ? 100 : f.id === 'ecsw' ? 90 : 40 })).filter(p => p.x > 10 && p.x < 970 && p.y > 10 && p.y < 250);
  const reserved = [{ x: 928, y: 10, width: 44, height: 136 }, ...points.map(p => ({ id: p.id, kind: 'marker', x: p.x - 7, y: p.y - 7, width: 14, height: 14 }))];
  const labels = placeLabels(points, wide, reserved); const selected = labels.find(l => l.id === 'ecss');
  assert(selected, 'the selected ECSS label must not be dropped');
  assert(!reserved.some(r => overlaps(selected.box, r))); assert(selected.leader, 'distant labels need a visible connection to their exact building');
  for (const other of labels) if (other.id !== selected.id) assert(!overlaps(selected.box, other.box));
});
test('default wide framing keeps the real hub neighborhood legible instead of fitting distant campus space', () => {
  const data = JSON.parse(readFileSync(new URL('../public/assets/campus-map.json', import.meta.url)));
  const wide = { width: 980, height: 298 }; const world = worldBounds(data); const camera = campusContextCamera(data, wide);
  const core = ['ecsw', 'ecss', 'ecsn', 'hh', 'mc', 'fo', 'su', 'ps4'];
  for (const id of core) { const f = data.features.find(f => f.id === id); const point = project({ x: f.anchor[0], y: f.anchor[1] }, world, wide, camera); assert(point.x > 30 && point.x < wide.width - 30); assert(point.y > 30 && point.y < wide.height - 30); }
  const ecsw = project({ x: 237, y: 482 }, world, wide, camera), ecss = project({ x: 274, y: 471 }, world, wide, camera);
  assert(Math.hypot(ecsw.x - ecss.x, ecsw.y - ecss.y) > 65, 'distinct west and south buildings need room for readable selection');
});
