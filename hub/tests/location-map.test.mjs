import test from 'node:test';
import assert from 'node:assert/strict';
import { locationMapModel, locationMapView, createVisibleMapView } from '../public/location-map.js';
import { profileWithCampus } from '../public/campus-map.js';

const campus = { features: [
  { id: 'ecsw', name: 'Engineering and Computer Science West', shortName: 'ECSW', geo: { latitude: 32.98632, longitude: -96.751701 } },
  { id: 'ecss', name: 'Engineering and Computer Science South', shortName: 'ECSS', geo: { latitude: 32.986374, longitude: -96.750458 } }
] };
const profile = profileWithCampus({}, campus);

test('a phone outside campus is plotted and centered at its original GPS rather than the receiving hub', () => {
  const report = { id: '1:100:1', request: { flags: 1, latitude: 32.7767, longitude: -96.797, accuracy: 3, note: 'Near an unlisted downtown building' } };
  const model = locationMapModel(report, profile, campus);
  assert.equal(model.primary.kind, 'gps');
  assert.deepEqual(model.gps.point, [32.7767, -96.797]);
  assert.deepEqual(locationMapView(model).center, model.gps.point);
  assert.equal(locationMapView(model).zoom, 17);
  assert.deepEqual(model.hub.point, [32.98632, -96.751701]);
  assert.notDeepEqual(model.primary.point, model.hub.point);
  assert.equal(model.gps.accuracy, 3);
  assert.equal(model.landmark, null);
});

test('operator landmark correction is separate from an unchanged original GPS point and accuracy', () => {
  const report = { id: '1:100:2', request: { flags: 1, latitude: 32.98751, longitude: -96.75206, accuracy: 7, note: 'Outside' }, annotations: { location: { label: 'ECSS' } } };
  const original = structuredClone(report);
  const model = locationMapModel(report, profile, campus);
  assert.deepEqual(model.primary.point, [32.98751, -96.75206]);
  assert.equal(model.primary.kind, 'gps');
  assert.equal(model.gps.accuracy, 7);
  assert.deepEqual(model.landmark.point, [32.986374, -96.750458]);
  assert.equal(model.landmark.corrected, true);
  assert.deepEqual(report, original);
});

test('an unrecognized place without GPS has no report marker even when the hub is known', () => {
  const model = locationMapModel({ id: '1:100:3', request: { flags: 0, latitude: 0, longitude: 0, accuracy: 65535, note: 'Unknown roadside building' } }, profile, campus);
  assert.equal(model.gps, null);
  assert.equal(model.landmark, null);
  assert.equal(model.primary, null);
  assert.ok(model.hub);
  assert.deepEqual(locationMapView(model), { center: model.hub.point, zoom: 14 });
});

test('a recognized landmark uses its independently sourced building coordinates only as an approximate landmark', () => {
  const model = locationMapModel({ id: '1:100:4', request: { flags: 0, note: 'Outside ECSS' } }, profile, campus);
  assert.equal(model.primary.kind, 'landmark');
  assert.equal(model.primary.label, 'ECSS');
  assert.deepEqual(model.primary.point, [32.986374, -96.750458]);
  assert.equal(model.gps, null);
  assert.equal(locationMapView(model).zoom, 16);
  const missingPoint = locationMapModel({ request: { flags: 0, note: 'Outside ECSS' } }, profile, { features: [campus.features[0], { ...campus.features[1], geo: { latitude: 91, longitude: -96.75 } }] });
  assert.equal(missingPoint.primary, null, 'Missing or invalid building coordinates cannot fall back to ECSW as a report point');
});

test('invalid GPS and unknown accuracy are rejected without discarding legitimate zero coordinates', () => {
  for (const request of [
    { flags: 0, latitude: 32.9, longitude: -96.7 },
    { flags: 1, latitude: NaN, longitude: -96.7 },
    { flags: 1, latitude: 91, longitude: -96.7 },
    { flags: 1, latitude: 32.9, longitude: -181 }
  ]) assert.equal(locationMapModel({ request }, profile, campus).gps, null);
  for (const accuracy of [65535, -1, Infinity, NaN]) {
    const model = locationMapModel({ request: { flags: 1, latitude: 0, longitude: 0, accuracy } }, profile, campus);
    assert.deepEqual(model.gps.point, [0, 0]);
    assert.equal(model.gps.accuracy, null);
    assert.deepEqual(locationMapView(model).center, [0, 0]);
  }
});

function viewportHarness() {
  const viewport = { isConnected: false, clientWidth: 0, clientHeight: 0 };
  const frames = new Map(); let frameId = 0, width = 0, height = 0, origin = [0, 0], zoom = 14;
  // This adapter models Leaflet's cached viewport and pixel origin. An origin
  // calculated at zero size puts the source point at [0,0] after attachment.
  const map = {
    setCalls: 0,
    invalidateSize() { width = viewport.clientWidth; height = viewport.clientHeight; },
    setView(center, nextZoom) { this.setCalls++; zoom = nextZoom; origin = [center[0] - width / 2, center[1] - height / 2]; },
    getCenter() { return { lat: origin[0] + width / 2, lng: origin[1] + height / 2 }; },
    getZoom() { return zoom; },
    point(point) { return [point[0] - origin[0], point[1] - origin[1]]; }
  };
  const controller = createVisibleMapView({ viewport, getMap: () => map, fallbackView: () => ({ center: [0, 0], zoom: 14 }), scheduleFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelFrame: id => frames.delete(id) });
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const show = (nextWidth = 440, nextHeight = 300) => { viewport.isConnected = true; viewport.clientWidth = nextWidth; viewport.clientHeight = nextHeight; };
  const hide = () => { viewport.isConnected = false; viewport.clientWidth = 0; viewport.clientHeight = 0; };
  return { viewport, map, controller, flush, show, hide };
}

test('a map created under a hidden parent centers GPS after attachment instead of leaving it at the top-left', () => {
  const f = viewportHarness(), gps = [32.98633, -96.75196];
  f.controller.request({ center: gps, zoom: 17 }); f.flush();
  assert.equal(f.map.setCalls, 0, 'No pixel origin is computed for a detached or hidden viewport');
  f.show(); f.controller.request(); f.flush();
  assert.deepEqual(f.map.point(gps), [220, 150]);
  assert.equal(f.map.getZoom(), 17);
  f.hide(); f.map.invalidateSize(); f.map.setView(gps, 17);
  f.show(); f.controller.request(); f.flush();
  assert.deepEqual(f.map.point(gps), [220, 150], 'An existing zero-sized Leaflet cache is repaired after the panel returns');
  f.controller.dispose();
});

test('detail reattachment and regular resize preserve the user-panned view without resetting unchanged polls', () => {
  const f = viewportHarness(); f.show();
  f.controller.request({ center: [32.98633, -96.75196], zoom: 17 }); f.flush();
  const panned = [32.9875, -96.7504]; f.map.setView(panned, 18); f.controller.capture();
  f.hide(); f.map.invalidateSize(); f.map.setView(panned, 18); f.controller.capture();
  f.show(500, 320); f.controller.request(); f.flush();
  assert.deepEqual(f.map.point(panned), [250, 160]); assert.equal(f.map.getZoom(), 18);
  f.show(600, 400); f.controller.request(); f.flush();
  assert.deepEqual(f.map.point(panned), [300, 200]);
  const calls = f.map.setCalls; f.controller.request(); f.flush();
  assert.equal(f.map.setCalls, calls, 'An unchanged visible poll does not rebuild the map view or flash its tiles');
  f.controller.dispose();
});
