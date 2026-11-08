import { loadCampusMap } from './campus-map.js';
import { caseLocation, hasGps } from './reception-data.js';

const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const validPoint = point => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
const featurePoint = feature => validPoint(feature?.geo) ? [feature.geo.latitude, feature.geo.longitude] : null;

// Phone GPS and campus building points already use WGS84. Neither depends on
// the unreferenced PDF drawing, and a receiving hub is never a report position.
export function locationMapModel(item, profile, data) {
  const features = Array.isArray(data?.features) ? data.features : [];
  const hub = features.find(feature => feature.id?.toLowerCase() === 'ecsw');
  const location = item ? caseLocation(item, profile) : null;
  const building = location?.landmark && features.find(feature => feature.id.toLowerCase() === location.landmark.id.toLowerCase());
  const landmark = featurePoint(building) ? { point: featurePoint(building), label: building.shortName || building.name, corrected: location.provenance.startsWith('Operator-corrected') } : null;
  const request = item?.request;
  const gps = hasGps(request) ? {
    point: [request.latitude, request.longitude],
    accuracy: Number.isFinite(request.accuracy) && request.accuracy >= 0 && request.accuracy < 65535 ? request.accuracy : null
  } : null;
  const primary = gps ? { kind: 'gps', ...gps } : landmark ? { kind: 'landmark', ...landmark } : null;
  return { gps, landmark, primary, hub: featurePoint(hub) ? { point: featurePoint(hub), label: 'ECSW receiving hub' } : null };
}

export function locationMapView(model) {
  if (model.primary) return { center: [...model.primary.point], zoom: model.primary.kind === 'gps' ? 17 : 16 };
  // This is context framing only. The unknown report has no marker.
  return { center: model.hub ? [...model.hub.point] : [32.98632, -96.751701], zoom: 14 };
}

// Leaflet caches its viewport size. A reused map can briefly be detached or in
// a hidden tab; applying a view then would calculate its pixel origin at 0×0.
export function createVisibleMapView({ viewport, getMap, fallbackView, scheduleFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let frame = null, desired = null, stable = null, applying = false, running = false, disposed = false;
  const visible = () => viewport.isConnected && viewport.clientWidth > 0 && viewport.clientHeight > 0;
  const copy = view => ({ center: [...view.center], zoom: view.zoom });
  function schedule() { if (!disposed && frame === null && !running) frame = scheduleFrame(flush); }
  function request(view) { if (view) desired = copy(view); schedule(); }
  function flush() {
    frame = null;
    if (disposed || !visible()) return;
    running = true;
    try {
      const map = getMap(); if (!map) return;
      const view = desired || stable || fallbackView();
      applying = true;
      // Refresh cached geometry BEFORE computing a new pixel origin. Explicit
      // reset also repairs an unchanged lat/lng view created while hidden.
      map.invalidateSize({ pan: false, animate: false });
      const current = map.getCenter();
      const shifted = Math.abs(current.lat - view.center[0]) > 1e-9 || Math.abs(current.lng - view.center[1]) > 1e-9 || map.getZoom() !== view.zoom;
      if (desired || !stable || shifted) map.setView(view.center, view.zoom, { animate: false, reset: true });
      stable = copy(view); desired = null;
    } finally { applying = false; running = false; }
  }
  function capture() {
    if (disposed || applying || !visible()) return;
    const map = getMap(); if (!map) return;
    const point = map.getCenter(); stable = { center: [point.lat, point.lng], zoom: map.getZoom() };
  }
  return { request, capture, dispose() { disposed = true; if (frame !== null) cancelFrame(frame); frame = null; } };
}

export function createLocationMap({ onData = () => {} } = {}) {
  const container = element('div', 'location-map');
  const controls = element('div', 'location-map-controls');
  const finderLabel = element('label', 'map-find'); finderLabel.append(element('span', 'sr-only', 'Find a campus building'));
  const finder = element('select'); finder.setAttribute('aria-label', 'Find a campus building'); finder.append(new Option('Find a building', '')); finder.disabled = true; finderLabel.append(finder);
  const reset = element('button', 'location-map-reset', 'Recenter'); reset.type = 'button'; reset.setAttribute('aria-label', 'Return map to reported location');
  controls.append(finderLabel, reset);
  const viewport = element('div', 'location-map-viewport'); viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Interactive street map. Phone GPS is pink; the receiving hub is gray. Drag to pan and use plus or minus to zoom.');
  const message = element('p', 'location-map-loading', 'Loading street map…'); viewport.append(message);
  const footer = element('div', 'location-map-key');
  const reportLegend = element('span', 'location-map-report');
  const hubLegend = element('span', 'location-map-hub', 'ECSW hub');
  footer.append(reportLegend, hubLegend); container.append(controls, viewport, footer);
  let map = null, data = null, layers = null, browsing = null, snapshot = {}, model = null, signature = '', disposed = false, viewController;

  function resetView() { if (!model) return; finder.value = ''; if (browsing) { map.removeLayer(browsing); browsing = null; } viewController.request(locationMapView(model)); }
  reset.addEventListener('click', resetView);
  function pathLabel(layer, text, kind, point) { const path = layer.getElement?.(); if (path) { path.setAttribute('role', 'img'); path.setAttribute('aria-label', text); path.dataset.markerRole = kind; path.dataset.latitude = String(point[0]); path.dataset.longitude = String(point[1]); } }
  function paint() {
    if (!map || disposed) return;
    const next = locationMapModel(snapshot.selected, snapshot.profile, data);
    const nextSignature = JSON.stringify([snapshot.selected?.id, next]);
    if (nextSignature === signature) return;
    signature = nextSignature; model = next; container.dataset.locationState = model.primary?.kind || 'unknown'; layers.clearLayers();
    const L = window.L;
    if (model.hub) {
      const hub = L.circleMarker(model.hub.point, { radius: 5, color: '#ffffff', weight: 2, fillColor: '#626875', fillOpacity: 1, className: 'receiving-hub-point' }).addTo(layers);
      hub.bindTooltip(model.hub.label, { permanent: true, direction: 'bottom', offset: [0, 8], className: 'receiving-hub-label' }); pathLabel(hub, model.hub.label, 'receiving-hub', model.hub.point);
    }
    if (model.gps) {
      const { point, accuracy } = model.gps;
      if (accuracy !== null && accuracy > 0) {
        const circle = L.circle(point, { radius: accuracy, color: '#e20074', weight: 1.5, opacity: .65, fillColor: '#e20074', fillOpacity: .1, interactive: false, className: 'reported-gps-accuracy' }).addTo(layers);
        pathLabel(circle, `Reported GPS accuracy ${accuracy} meters`, 'gps-accuracy', point);
      }
      const dot = L.circleMarker(point, { radius: 7, color: '#ffffff', weight: 2.5, fillColor: '#e20074', fillOpacity: 1, className: 'reported-gps-point' }).addTo(layers);
      dot.bindTooltip('Phone GPS', { permanent: true, direction: 'top', offset: [0, -10], className: 'reported-gps-label' });
      pathLabel(dot, `Phone GPS ${point[0].toFixed(5)}, ${point[1].toFixed(5)}${accuracy === null ? '' : `, accuracy ${accuracy} meters`}`, 'reported-gps', point);
      reportLegend.textContent = accuracy === null ? 'Phone GPS' : `Phone GPS · ±${accuracy} m`; reportLegend.classList.remove('is-unknown', 'is-landmark');
    } else if (model.landmark) {
      reportLegend.textContent = 'Landmark · approximate'; reportLegend.classList.remove('is-unknown'); reportLegend.classList.add('is-landmark');
    } else {
      reportLegend.textContent = 'No reported location'; reportLegend.classList.add('is-unknown'); reportLegend.classList.remove('is-landmark');
    }
    if (model.landmark) {
      const landmark = L.circleMarker(model.landmark.point, { radius: 8, color: '#8a651b', weight: 2, fillOpacity: .08, className: 'reported-landmark-point' }).addTo(layers);
      const label = `${model.landmark.label}${model.landmark.corrected ? ' · corrected landmark' : ' · landmark'}`;
      landmark.bindTooltip(label, { permanent: !model.gps, direction: model.gps ? 'left' : 'top', offset: model.gps ? [-10, 0] : [0, -10], className: 'reported-landmark-label' });
      landmark.bringToBack(); pathLabel(landmark, label + ', approximate', 'landmark', model.landmark.point);
    }
    hubLegend.hidden = !model.hub; resetView();
  }

  function initialize() {
    if (disposed || map || !viewport.isConnected || viewport.clientWidth < 1 || viewport.clientHeight < 1) return;
    if (!window.L) { message.textContent = 'Street map unavailable. GPS coordinates remain above.'; reset.disabled = true; return; }
    const L = window.L; message.remove();
    map = L.map(viewport, { center: [32.98632, -96.751701], zoom: 14, minZoom: 2, maxZoom: 19, scrollWheelZoom: false, keyboard: true, worldCopyJump: true, zoomControl: true });
    map.on('moveend', () => viewController.capture());
    layers = L.layerGroup().addTo(map);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { minZoom: 2, maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    let tileError = false;
    tiles.on('tileerror', () => { if (disposed || tileError) return; tileError = true; message.textContent = 'Street tiles unavailable. GPS point and coordinates are retained.'; message.classList.add('tile-error'); container.append(message); });
    tiles.on('tileload', () => { if (tileError) { tileError = false; message.remove(); } });
    paint();
    loadCampusMap().then(value => {
      if (disposed) return; data = value; finder.disabled = false;
      for (const feature of [...data.features].filter(feature => featurePoint(feature)).sort((a, b) => a.name.localeCompare(b.name))) { const option = new Option(`${feature.shortName || feature.id.toUpperCase()} · ${feature.name}`, feature.id); finder.append(option); }
      paint(); onData(value);
    }).catch(() => { if (disposed) return; finder.disabled = true; });
  }
  finder.addEventListener('change', () => {
    const feature = data?.features.find(item => item.id === finder.value); const point = featurePoint(feature);
    if (!point || !map) { resetView(); return; }
    if (browsing) map.removeLayer(browsing);
    browsing = window.L.circleMarker(point, { radius: 9, color: '#626875', weight: 2, fillOpacity: 0, dashArray: '3 3' }).addTo(map);
    browsing.bindTooltip(`${feature.shortName || feature.name} · building reference`, { permanent: true, direction: 'top', offset: [0, -12] });
    viewController.request({ center: point, zoom: 17 });
  });
  viewController = createVisibleMapView({ viewport, getMap: () => { initialize(); return map; }, fallbackView: () => locationMapView(model || locationMapModel(snapshot.selected, snapshot.profile, data)) });
  const observer = new ResizeObserver(() => viewController.request()); observer.observe(viewport);
  viewController.request();
  return {
    element: container,
    update(value) { snapshot = value; paint(); viewController.request(); },
    dispose() { disposed = true; observer.disconnect(); viewController.dispose(); map?.remove(); }
  };
}
