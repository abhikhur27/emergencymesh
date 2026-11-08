import { worldBounds, campusContextCamera, scaleFor, project, panCamera, zoomCamera, placeLabels, projectGps } from './map-geometry.js';
import { caseLocation, reportedLocation } from './reception-data.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attributes = {}, text) => { const n = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, String(value)); if (text !== undefined) n.textContent = text; return n; };
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
let dataPromise;
export function loadCampusMap() {
  dataPromise ||= fetch('/assets/campus-map.json', { credentials: 'same-origin', cache: 'force-cache' }).then(async response => {
    if (!response.ok) throw new Error('Campus map could not be loaded.');
    const data = await response.json(); worldBounds(data);
    if (!Array.isArray(data.features) || !data.features.length || data.features.length > 1000) throw new Error('Campus map buildings are unavailable.');
    data.features = data.features.filter(f => typeof f.id === 'string' && typeof f.name === 'string' && Array.isArray(f.anchor) && f.anchor.length === 2 && f.anchor.every(Number.isFinite));
    return data;
  }).catch(error => { dataPromise = null; throw error; });
  return dataPromise;
}
export function profileWithCampus(profile, data) {
  if (!data) return profile;
  const original = new Map((profile?.landmarks || []).map(p => [p.id.toLowerCase(), p]));
  const landmarks = data.features.map(f => { const prior = original.get(f.id.toLowerCase()); return { id: f.id, name: f.shortName || f.name, aliases: [...new Set([f.name, f.shortName, ...(f.aliases || []), ...(prior?.aliases || [])].filter(Boolean))], provenance: 'official-campus-map' }; });
  return { ...profile, landmarks };
}
function iconButton(label, path, action) {
  const b = el('button', 'map-icon'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.append(svg('svg', { viewBox: '0 0 20 20', 'aria-hidden': true }, undefined)); b.firstChild.append(svg('path', { d: path })); b.onclick = action; return b;
}
const validPath = path => typeof path === 'string' && path.length < 250000 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+\-]+$/.test(path);

export function createCampusMap({ study = false, onSelectRequest = () => {}, onData = () => {} } = {}) {
  const element = el('div', 'campus-map');
  const top = el('div', 'map-heading'); const title = el('div', 'map-title'); title.append(el('h2', '', 'UT Dallas'), el('span', '', study ? 'Received requests by landmark' : 'Campus context'));
  const findLabel = el('label', 'map-find'); findLabel.append(el('span', 'sr-only', 'Find a campus building')); const finder = el('select'); const defaultOption = el('option', '', 'Find a building'); defaultOption.value = ''; finder.append(defaultOption); finder.disabled = true; findLabel.append(finder); top.append(title, findLabel);
  const viewport = el('div', 'map-viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Interactive UT Dallas campus map. Drag to pan. Arrow keys pan; plus and minus zoom; zero resets.');
  const canvas = svg('svg', { role: 'group', 'aria-label': 'Campus buildings and reported landmarks', preserveAspectRatio: 'none' }); const geometry = svg('g', { class: 'campus-geometry' }); const marks = svg('g', { class: 'campus-markers' }); canvas.append(geometry, marks); viewport.append(canvas);
  const tools = el('div', 'map-tools'); tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Map view controls');
  const zoomIn = iconButton('Zoom in', 'M10 4V16 M4 10H16', () => changeZoom(1.4)); const zoomOut = iconButton('Zoom out', 'M4 10H16', () => changeZoom(1 / 1.4)); const reset = iconButton('Reset campus view', 'M4 8A6 6 0 1 1 4 13 M4 3V8H9', () => resetCamera()); tools.append(zoomIn, zoomOut, reset); viewport.append(tools);
  const loading = el('p', 'map-loading', 'Loading campus map…'); viewport.append(loading);
  const footer = el('div', 'map-footer'); const selectedLabel = el('p', 'map-selection'); const source = el('a', 'map-attribution', 'UT Dallas campus map'); source.target = '_blank'; source.rel = 'noopener noreferrer'; footer.append(selectedLabel, source); element.append(top, viewport, footer);
  let data = null, bounds = null, camera = null, size = { width: 640, height: 400 }, disposed = false, snapshot = {}, selectedBuilding = '', lastRequest = null, suppressClick = false, frame = 0;
  const pointers = new Map(); let gesture = null;

  function initialCamera() {
    return campusContextCamera(data, size);
  }
  function resetCamera() { if (!data) return; camera = initialCamera(); paint(); }
  function changeZoom(factor, anchor = { x: size.width / 2, y: size.height / 2 }) { if (!data) return; camera = zoomCamera(camera, factor, anchor, bounds, size); paint(); }
  function local(event) { const rect = viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); }
  function chooseBuilding(id) {
    selectedBuilding = id; finder.value = id;
    const items = (snapshot.incidents || []).filter(item => caseLocation(item, snapshot.profile).landmark?.id.toLowerCase() === id.toLowerCase());
    const request = items.find(item => item.id === snapshot.selected?.id) || items[0];
    if (request) onSelectRequest(request.id); else paint();
  }
  function ensureVisible(point) {
    const at = project(point, bounds, size, camera); const gap = 58;
    if (at.x < gap || at.x > size.width - gap || at.y < gap || at.y > size.height - gap) { camera = { ...camera, x: point.x, y: point.y }; }
  }
  function paint() {
    if (!data || disposed || !camera) return;
    const focusId = document.activeElement?.getAttribute('data-building');
    canvas.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    const scale = scaleFor(bounds, size, camera); geometry.setAttribute('transform', `translate(${size.width / 2 - camera.x * scale} ${size.height / 2 - camera.y * scale}) scale(${scale})`);
    const loc = snapshot.selected ? caseLocation(snapshot.selected, snapshot.profile) : null;
    const selectedId = selectedBuilding || loc?.landmark?.id || ''; const chosen = data.features.find(f => f.id.toLowerCase() === selectedId.toLowerCase());
    if (document.activeElement !== finder) finder.value = chosen?.id || '';
    geometry.querySelectorAll('[data-footprint]').forEach(path => { path.classList.toggle('selected', path.dataset.footprint.toLowerCase() === selectedId.toLowerCase()); });
    const counts = new Map(); for (const item of snapshot.incidents || []) { const place = (study ? reportedLocation : caseLocation)(item, snapshot.profile).landmark; if (place) counts.set(place.id.toLowerCase(), (counts.get(place.id.toLowerCase()) || 0) + 1); }
    const points = data.features.map(f => ({ id: f.id, label: f.shortName || f.name, ...project({ x: f.anchor[0], y: f.anchor[1] }, bounds, size, camera), feature: f, count: counts.get(f.id.toLowerCase()) || 0, priority: f.id.toLowerCase() === selectedId.toLowerCase() ? 100 : f.id.toLowerCase() === 'ecsw' ? 90 : counts.has(f.id.toLowerCase()) ? 60 : ['ecss', 'hh', 'mc', 'su', 'fo', 'ps4'].includes(f.id.toLowerCase()) ? 40 : 0 }));
    const visiblePoints = points.filter(p => p.x > 10 && p.y > 10 && p.x < size.width - 10 && p.y < size.height - 10 && (camera.zoom >= 4 || p.priority > 0));
    const reserved = [{ x: size.width - 60, y: 8, width: 52, height: 144 }, ...visiblePoints.map(p => ({ id: p.id, kind: 'marker', x: p.x - 7, y: p.y - 7, width: 14, height: 14 }))];
    const labels = placeLabels(visiblePoints.map(p => ({ ...p, required: p.id.toLowerCase() === selectedId.toLowerCase() })), size, reserved); marks.replaceChildren();
    // Keep the active label above nearby transparent marker hit areas as well.
    const drawingOrder = [...visiblePoints].sort((a, b) => Number(a.id.toLowerCase() === selectedId.toLowerCase()) - Number(b.id.toLowerCase() === selectedId.toLowerCase()));
    for (const point of drawingOrder) {
      const active = point.id.toLowerCase() === selectedId.toLowerCase(); const hub = point.id.toLowerCase() === 'ecsw';
      const g = svg('g', { class: `map-landmark${active ? ' selected' : ''}${hub ? ' receiving-hub' : ''}`, 'data-building': point.id, role: 'button', tabindex: point.priority > 0 ? 0 : -1, 'aria-label': `${point.feature.name}${hub ? ', receiving hub' : ''}${point.count ? ', ' + point.count + (point.count === 1 ? ' request' : ' requests') : ''}`, 'aria-pressed': active });
      g.append(svg('rect', { x: point.x - 22, y: point.y - 22, width: 44, height: 44, fill: 'transparent', class: 'marker-hit' }), svg('circle', { cx: point.x, cy: point.y, r: active ? 7 : hub ? 5 : 3.5, class: 'landmark-dot' }));
      if (point.count && study) { g.append(svg('circle', { cx: point.x, cy: point.y, r: 11, class: 'request-count' }), svg('text', { x: point.x, y: point.y + 4, 'text-anchor': 'middle', class: 'count-text' }, String(point.count))); }
      const label = labels.find(l => l.id === point.id);
      if (label) { if (label.leader) g.insertBefore(svg('line', { ...label.leader, class: 'label-leader' }), g.firstChild); g.append(svg('rect', { x: label.box.x, y: label.box.y, width: label.box.width, height: label.box.height, rx: 4, class: 'label-surface' }), svg('text', { x: label.box.x + 9, y: label.box.y + 17, class: 'landmark-label' }, point.label)); }
      g.addEventListener('click', () => { if (!suppressClick) chooseBuilding(point.id); }); g.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseBuilding(point.id); } }); marks.append(g);
    }
    const gps = snapshot.selected && projectGps(snapshot.selected.request, data);
    if (gps) { const p = project(gps, bounds, size, camera); marks.append(svg('circle', { cx: p.x, cy: p.y, r: 7, class: 'gps-point' })); }
    selectedLabel.replaceChildren();
    if (chosen) { selectedLabel.append(el('strong', '', chosen.shortName || chosen.name), el('span', '', chosen.id.toLowerCase() === 'ecsw' ? 'Receiving hub' : 'Campus building')); if (counts.get(chosen.id.toLowerCase())) selectedLabel.append(el('span', '', `${counts.get(chosen.id.toLowerCase())} ${study ? 'received ' : ''}request${counts.get(chosen.id.toLowerCase()) === 1 ? '' : 's'}`)); }
    else selectedLabel.append(el('span', '', loc?.kind === 'gps' && !gps ? 'Phone GPS in source details · map has no surveyed GPS transform' : 'Choose a building to see its requests'));
    if (chosen && loc?.kind === 'landmark' && chosen.id.toLowerCase() === loc.landmark?.id.toLowerCase()) selectedLabel.append(el('span', 'map-provenance', 'Reported landmark · approximate'));
    zoomOut.disabled = camera.zoom <= 1.001; zoomIn.disabled = camera.zoom >= 7.999;
    if (focusId) { const target = [...marks.querySelectorAll('[data-building]')].find(n => n.getAttribute('data-building') === focusId); (target || viewport).focus({ preventScroll: true }); }
  }
  finder.onchange = () => { const feature = data?.features.find(f => f.id === finder.value); if (feature) { ensureVisible({ x: feature.anchor[0], y: feature.anchor[1] }); chooseBuilding(feature.id); paint(); } };
  viewport.addEventListener('keydown', event => {
    if (event.target.closest('button,select')) return;
    const step = event.shiftKey ? 100 : 40; const movement = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (movement && data) { event.preventDefault(); camera = panCamera(camera, ...movement, bounds, size); paint(); }
    else if (['+', '='].includes(event.key)) { event.preventDefault(); changeZoom(1.4); } else if (event.key === '-') { event.preventDefault(); changeZoom(1 / 1.4); } else if (event.key === '0') { event.preventDefault(); resetCamera(); }
  });
  viewport.addEventListener('wheel', event => { if (!data || (!viewport.contains(document.activeElement) && !event.ctrlKey)) return; event.preventDefault(); changeZoom(Math.exp(-event.deltaY * .002), local(event)); }, { passive: false });
  viewport.addEventListener('pointerdown', event => { if (!data || event.target.closest('button,select') || event.button > 0) return; pointers.set(event.pointerId, local(event)); gesture = { last: local(event), start: local(event), distance: null }; if (!event.target.closest('[data-building]')) viewport.focus({ preventScroll: true }); });
  viewport.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !data) return; const now = local(event); pointers.set(event.pointerId, now);
    if (pointers.size >= 2) { const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y); if (gesture.distance) camera = zoomCamera(camera, distance / gesture.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, bounds, size); gesture.distance = distance; suppressClick = true; }
    else { if (Math.hypot(now.x - gesture.start.x, now.y - gesture.start.y) > 4) suppressClick = true; if (suppressClick) camera = panCamera(camera, now.x - gesture.last.x, now.y - gesture.last.y, bounds, size); gesture.last = now; }
    if (suppressClick && !viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
    viewport.classList.toggle('dragging', suppressClick); schedule();
  });
  const endPointer = event => { if (!pointers.has(event.pointerId)) return; pointers.delete(event.pointerId); if (!pointers.size) { viewport.classList.remove('dragging'); gesture = null; setTimeout(() => { suppressClick = false; }, 0); } else if (pointers.size === 1) { const remaining = [...pointers.values()][0]; gesture = { last: remaining, start: remaining, distance: null }; } };
  window.addEventListener('pointerup', endPointer); window.addEventListener('pointercancel', endPointer);
  const observer = new ResizeObserver(entries => { const r = entries[0].contentRect; if (r.width < 1 || r.height < 1) return; size = { width: r.width, height: r.height }; schedule(); }); observer.observe(viewport);
  function update(value) {
    snapshot = value;
    const next = snapshot.selected?.id;
    if (next !== lastRequest) { selectedBuilding = ''; lastRequest = next; if (data) { const loc = snapshot.selected && caseLocation(snapshot.selected, snapshot.profile); const feature = data.features.find(f => f.id.toLowerCase() === loc?.landmark?.id.toLowerCase()); if (feature) ensureVisible({ x: feature.anchor[0], y: feature.anchor[1] }); } }
    paint();
  }
  function initialize() {
    loadCampusMap().then(value => {
      if (disposed) return; data = value; bounds = worldBounds(data); camera = initialCamera(); loading.remove(); finder.disabled = false;
      for (const feature of [...data.features].sort((a, b) => a.name.localeCompare(b.name))) { const option = el('option', '', `${feature.shortName || feature.id.toUpperCase()} · ${feature.name}`); option.value = feature.id; finder.append(option); }
      for (const path of data.backgroundPaths || []) if (validPath(path.path)) geometry.append(svg('path', { d: path.path, class: path.kind === 'road' ? 'campus-road' : 'campus-context', 'fill-rule': path.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', 'vector-effect': 'non-scaling-stroke' }));
      for (const feature of data.features) if (validPath(feature.path)) geometry.append(svg('path', { d: feature.path, class: 'campus-building', 'data-footprint': feature.id, 'fill-rule': feature.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', 'vector-effect': 'non-scaling-stroke' }));
      try { const url = new URL(data.source?.url); if (url.protocol === 'https:') source.href = url.href; } catch { source.removeAttribute('href'); }
      source.textContent = 'Map: UT Dallas'; source.title = data.source?.attribution || 'UT Dallas campus map'; source.setAttribute('aria-label', source.title); paint(); onData(data);
    }).catch(() => { if (disposed) return; loading.textContent = 'Campus map unavailable. Requests remain available.'; const retry = el('button', 'text-action', 'Retry map'); retry.type = 'button'; retry.onclick = () => { retry.remove(); loading.textContent = 'Loading campus map…'; initialize(); }; loading.append(retry); });
  }
  initialize();
  return { element, update, dispose() { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('pointerup', endPointer); window.removeEventListener('pointercancel', endPointer); } };
}
