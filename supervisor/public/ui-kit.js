/* Shared interface primitives. Only public hub landmarks reach the map provider. */
(() => {
'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const svg = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text !== undefined) n.textContent = text; return n; };
  const paths = {
    medical: 'M8 3h8v5h5v8h-5v5H8v-5H3V8h5Z',
    fire: 'M13 2c1 5-5 6-3 10 2-1 3-2 3-4 4 3 7 6 6 10-1 3-4 4-7 4s-7-2-7-6c0-4 3-7 4-9-1 4 0 5 1 5',
    water: 'M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13ZM8 15a4 4 0 0 0 4 4',
    food: 'M5 3v6m3-6v6M2 3v6c0 2 3 2 3 2v10M17 3c-4 1-4 9 0 9h3V3h-3Zm3 9v9',
    medicine: 'm9 4-5 5a6 6 0 0 0 8 8l5-5a6 6 0 0 0-8-8Zm-2 3 10 10',
    power: 'm13 2-9 12h7l-1 8 10-13h-8Z',
    people: 'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M13 3a4 4 0 0 1 0 8m5 3a4 4 0 0 1 4 4v3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    check: 'm5 12 4 4L19 6', chevron: 'm9 5 7 7-7 7', arrow: 'M4 12h16m-6-6 6 6-6 6',
    radio: 'M12 12v10m-5-4a8 8 0 0 1 0-12m10 0a8 8 0 0 1 0 12M4 21a13 13 0 0 1 0-18m16 0a13 13 0 0 1 0 18M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2c6 5 6 15 0 20-6-5-6-15 0-20Z',
    search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    close: 'm6 6 12 12M6 18 18 6', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    shield: 'm12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6Zm-5 10 3 3 7-7',
    activity: 'M2 12h5l3-8 4 16 3-8h5', settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'
  };
  function icon(name) { const n = svg('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' }); n.append(svg('path', { d: paths[name] || paths.chevron })); return n; }
  function button(label, cls = '', handler, iconName) { const n = el('button', 'button ' + cls); n.type = 'button'; if (iconName) n.append(icon(iconName)); if (label) n.append(document.createTextNode(label)); n.addEventListener('click', handler || (() => {})); return n; }
  function pill(label, tone = 'neutral') { return el('span', 'pill ' + tone, label); }
  let toastTimer;
  function toast(text) { let n = document.querySelector('.toast'); if (!n) { n = el('div', 'toast'); n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite'); document.body.append(n); } n.textContent = text; n.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { n.hidden = true; }, 4500); }
  function regionalMap({ requestTown = 'ecsw', supplierTown = null, resource = 'Resource handoff', recorded = false, onSelect = () => {} } = {}) {
    // Public hub landmarks only: these are not report locations or travel routes.
    const positions = { ecsw: { name: 'ECSW', lat: 32.986102, lon: -96.751378 }, plano: { name: 'Plano', lat: 33.050769, lon: -96.747944 }, garland: { name: 'Garland', lat: 32.909826, lon: -96.630334 }, addison: { name: 'Addison', lat: 32.963744, lon: -96.833805 } };
    const outer = el('div', 'study-map regional-map-figure');
    const canvas = el('div', 'regional-basemap');
    canvas.setAttribute('role', 'region');
    canvas.setAttribute('aria-label', 'North Texas public hub map. Use arrow keys to pan and plus or minus to zoom. Select a hub to filter requests.');
    const status = el('p', 'regional-map-status', 'Loading OpenStreetMap street map…');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const hasAllocation = supplierTown && positions[requestTown] && positions[supplierTown] && requestTown !== supplierTown;
    const handoffLabel = hasAllocation ? `${resource}: ${positions[supplierTown].name} to ${positions[requestTown].name} · ${recorded ? 'handoff recorded' : 'awaiting acknowledgment'}` : 'Select a saved allocation to see its handoff';
    const caption = el('div', 'map-caption');
    caption.append(el('span', '', handoffLabel), el('span', '', 'Public hub locations · not a travel route'));
    const fallback = el('div', 'regional-map-fallback');
    for (const [id, p] of Object.entries(positions)) fallback.append(button(p.name, 'secondary', () => onSelect(id)));
    canvas.append(fallback);
    outer.append(canvas, status, caption);
    const unavailable = message => { status.textContent = message; status.classList.add('is-unavailable'); };
    if (!window.L || window.L.version !== '1.9.4') {
      unavailable('Street map unavailable: the bundled map library did not load. Select a public hub above or reload this workspace.');
      return outer;
    }
    // The helper returns a DOM node, so initialize only once its caller attaches it.
    requestAnimationFrame(() => {
      if (!outer.isConnected) return;
      const L = window.L;
      let map, resize, removal, slowTimer;
      const release = () => { clearTimeout(slowTimer); resize?.disconnect(); removal?.disconnect(); map?.remove(); };
      try {
        fallback.remove();
        map = L.map(canvas, { scrollWheelZoom: false, zoomControl: false, attributionControl: true, minZoom: 8, maxZoom: 19, zoomAnimation: false, fadeAnimation: false });
        L.control.zoom({ position: 'topright' }).addTo(map);
        map.attributionControl.setPrefix('<a href="https://leafletjs.com" title="Leaflet 1.9.4">Leaflet</a>');
        // Normal browser cache headers apply. No proxy, offline cache or prefetch.
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, noWrap: true, keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });
        let tileErrors = 0, tileLoads = 0;
        const noteTiles = () => {
          status.classList.toggle('is-unavailable', tileErrors > 0);
          status.textContent = tileErrors ? (tileLoads ? 'Some street tiles are unavailable. Public hub markers and the saved allocation remain visible.' : 'Street tiles unavailable. Public hub markers and the saved allocation remain visible; no offline street map is stored.') : 'OpenStreetMap streets · public hub landmarks';
        };
        tiles.on('loading', () => { tileErrors = 0; tileLoads = 0; clearTimeout(slowTimer); slowTimer = setTimeout(() => unavailable('Street map is taking longer to load. Public hub markers and the saved allocation remain visible.'), 10000); });
        tiles.on('tileload', () => { tileLoads++; });
        tiles.on('tileerror', () => { tileErrors++; noteTiles(); });
        tiles.on('load', () => { clearTimeout(slowTimer); noteTiles(); });
        tiles.addTo(map);
        if (hasAllocation) {
          const from = positions[supplierTown], to = positions[requestTown];
          const allocation = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], { color: '#e20074', weight: 3, opacity: 1, dashArray: recorded ? null : '6 6', interactive: false, className: 'regional-allocation-line' }).addTo(map);
          const path = allocation.getElement();
          if (path) { path.setAttribute('role', 'img'); path.setAttribute('aria-label', handoffLabel + '. Selected saved allocation, not a travel route.'); }
        }
        for (const [id, p] of Object.entries(positions)) {
          const role = id === requestTown ? 'Requesting hub' : id === supplierTown ? 'Supplying hub' : 'Source hub';
          const node = el('div', `regional-hub-node ${id === requestTown ? 'is-request' : id === supplierTown ? 'is-supplier' : 'is-source'}`);
          const dot = el('span', 'regional-hub-dot'); dot.setAttribute('aria-hidden', 'true');
          const label = el('span', 'regional-hub-label'); label.append(el('strong', '', p.name), el('span', 'regional-hub-role', role)); node.append(dot, label);
          const marker = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'regional-hub-marker', html: node, iconSize: [28, 28], iconAnchor: [14, 14] }), title: `${p.name} · ${role}`, alt: p.name, keyboard: true, riseOnHover: true }).addTo(map);
          marker.on('click', () => onSelect(id));
          const target = marker.getElement();
          if (target) { target.setAttribute('aria-label', `${p.name}, ${role}. Filter requests from this hub.`); target.addEventListener('keydown', event => { if (event.key === ' ') { event.preventDefault(); onSelect(id); } }); }
        }
        const bounds = L.latLngBounds(Object.values(positions).map(p => [p.lat, p.lon]));
        const fit = () => map.fitBounds(bounds, { paddingTopLeft: [38, 38], paddingBottomRight: [Math.min(122, Math.max(80, canvas.clientWidth * 0.24)), 40], maxZoom: 12, animate: false });
        fit();
        resize = new ResizeObserver(() => { if (!outer.isConnected) { release(); return; } map.invalidateSize({ pan: false, animate: false }); fit(); }); resize.observe(canvas);
        removal = new MutationObserver(() => { if (!outer.isConnected) release(); }); removal.observe(document.body, { childList: true, subtree: true });
      } catch {
        release();
        canvas.replaceChildren(fallback);
        unavailable('Street map could not start. Select a public hub above or reload this workspace.');
      }
    });
    return outer;
  }
  function dispatchSummary({ priorities, people, attention, selectedPriority = 'all', onPriority = () => {}, onAttention = () => {}, scope = 'Current reports' }) {
    const section = el('section', 'dispatch-summary'); section.setAttribute('aria-label', 'Dispatcher summary');
    const priority = el('div', 'dispatch-priority');
    const heading = el('div', 'dispatch-priority-heading'); heading.append(el('h2', '', 'Reported priority'), el('span', '', scope)); priority.append(heading);
    const total = priorities.reduce((sum, p) => sum + p.count, 0);
    const bar = el('div', 'dispatch-severity-bar' + (total ? '' : ' is-empty')); bar.setAttribute('aria-hidden', 'true');
    for (const p of priorities) { const part = el('span', 'severity-' + p.label.toLowerCase()); part.style.flexGrow = String(p.count); part.style.flexBasis = total ? '0' : '33.333%'; if (!p.count && total) part.hidden = true; bar.append(part); }
    priority.append(bar);
    const legend = el('div', 'dispatch-severity-legend');
    for (const p of priorities) {
      const control = button('', 'dispatch-priority-button severity-' + p.label.toLowerCase(), () => onPriority(selectedPriority === p.label ? 'all' : p.label, p.label));
      control.setAttribute('aria-label', `${p.count} ${p.label.toLowerCase()} reports. Filter by ${p.label.toLowerCase()} priority.`);
      control.setAttribute('aria-pressed', String(selectedPriority === p.label)); control.dataset.priority = p.label;
      control.append(el('strong', '', p.count), el('span', '', p.label)); legend.append(control);
    }
    priority.append(legend); section.append(priority);
    const persons = el('div', 'dispatch-total'); persons.append(el('strong', '', people), el('span', '', 'People reported')); section.append(persons);
    const action = button('', 'dispatch-total dispatch-attention', onAttention); action.setAttribute('aria-label', `${attention} reports need attention. Show exceptions.`); action.append(el('strong', '', attention), el('span', '', 'Need attention')); section.append(action);
    return section;
  }

window.RM = {el,icon,button,pill,toast,regionalMap,dispatchSummary};
})();
