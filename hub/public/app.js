import { selectVisibleReport } from './view-selection.js';
import { landmarksFor, reportedLocation, caseLocation, receptionSummary } from './reception-data.js';

const $ = id => document.getElementById(id);
const categories = { 1: 'Medical', 2: 'Fire', 3: 'Rescue', 4: 'Safety', 5: 'Supplies' };
const priorities = { 1: 'Urgent', 2: 'Serious', 3: 'Assistance' };
const views = ['requests', 'handoffs', 'reception', 'settings'];
let state = null, selected = null, handoffSelected = null, csrf = '', busy = false, refreshing = false;
let currentView = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'requests';
let lastRendering = '', connectionError = '', actionError = '', noticeTimer, correctionId = null, includeTests = false;
const clip = (value, length = 400) => String(value ?? '').slice(0, length);
function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function button(label, action, className = 'text-action') { const n = el('button', label, className); n.type = 'button'; n.onclick = action; return n; }
function when(value, date = false) { if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded'; return new Date(value).toLocaleString([], { timeZone: state?.regionProfile?.timeZone || state?.regionProfile?.timezone || 'America/Chicago', ...(date ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' }) }); }
const numeric = (value, unit = '') => typeof value === 'number' && Number.isFinite(value) ? `${value}${unit}` : 'Not recorded';
function facts(entries, className = 'facts') { const dl = el('dl', undefined, className); for (const [label, value] of entries) { const group = el('div'); group.append(el('dt', label), el('dd', value)); dl.append(group); } return dl; }
function section(title, className = 'section') { const n = el('section', undefined, className); n.append(el('h3', title)); return n; }
function disclosure(label, key) { const n = el('details', undefined, 'disclosure'); n.dataset.disclosure = key; n.append(el('summary', label)); return n; }
function errors() { $('error').textContent = actionError || connectionError; $('error').hidden = !($('error').textContent); if (!$('error').hidden) $('notice').hidden = true; }
function notice(message) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7500); }
async function api(path, body) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) }) });
  let data; try { data = await response.json(); } catch { throw new Error('The hub returned an unreadable response.'); }
  if (!response.ok) { if (response.status === 401) signedOut(); throw new Error(clip(data.error || 'The request could not be completed.', 180)); }
  return data;
}
function signedOut() { state = null; csrf = ''; lastRendering = ''; $('workspace').hidden = true; $('login-panel').hidden = false; $('navigation').hidden = true; $('pause').hidden = true; if ($('location-dialog').open) $('location-dialog').close(); }
async function act(action) {
  if (busy) return; busy = true; actionError = ''; errors(); $('login-form').setAttribute('aria-busy', 'true'); document.querySelectorAll('[data-mutation]').forEach(n => { n.disabled = true; });
  try { await action(); } catch (error) { actionError = error.message; errors(); }
  finally { busy = false; $('login-form').removeAttribute('aria-busy'); lastRendering = ''; await refresh(); document.querySelectorAll('[data-mutation]').forEach(n => { n.disabled = n.dataset.unavailable === 'true'; }); }
}
function reports() { return [...(state?.incidents || [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)); }
function setView(view, focus = false) { if (!views.includes(view)) return; currentView = view; history.replaceState(null, '', `#${view}`); render(); if (focus) $('content').focus(); }
function openRequest(item) { selected = item.id; if (($('source').value === 'radio' && item.simulated) || ($('source').value === 'test' && !item.simulated)) $('source').value = 'all'; $('filter').value = 'all'; setView('requests', true); }
function radioLabel(link = {}) {
  if (link.mode === 'simulation') return 'Software simulation · no radio connected';
  if (link.connected && link.readiness === 'ready') return `Radio ready · ${link.board?.frequency || state?.regionProfile?.frequencyMHz || 'frequency not recorded'} MHz`;
  return ({ 'awaiting-status': 'USB open · waiting for board status', 'status-unavailable': 'USB open · board status unavailable', 'invalid-status': 'USB open · invalid board status', 'profile-mismatch': 'Board profile mismatch · transmission blocked', 'radio-failed': 'Board reports a radio fault', 'port-error': 'USB port error', 'port-closed': 'USB radio disconnected' })[link.readiness] || 'Radio connection unverified';
}
function renderShell() {
  $('workspace').hidden = false; $('login-panel').hidden = true; $('navigation').hidden = false;
  $('hub-context').textContent = `${state.regionProfile?.hubName || 'ECSW'} · ${state.regionProfile?.name || 'UT Dallas'}`;
  $('link').textContent = radioLabel(state.link); $('connection-note').textContent = connectionError ? 'Last saved state shown' : state.automation?.paused ? 'Automatic coordination paused' : state.automation?.supervisor?.connected ? 'Regional coordination connected' : 'Regional coordination pending';
  $('simulate').hidden = !state.simulation; $('pause').hidden = !state.automation;
  $('pause').textContent = state.automation?.paused ? 'Resume automation' : 'Pause automation'; $('pause').disabled = busy;
  for (const n of document.querySelectorAll('[data-view]')) { if (n.dataset.view === currentView) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); }
  for (const view of views) $(`${view}-view`).hidden = currentView !== view;
}
async function refresh() {
  if (busy || refreshing) return; refreshing = true;
  try {
    const data = await api('/api/state'); state = data; csrf = data.csrf; connectionError = ''; errors(); renderShell();
    const signature = JSON.stringify({ incidents: state.incidents, automation: state.automation, database: state.database, profile: state.regionProfile, view: currentView });
    if (signature !== lastRendering && !$('location-dialog').open) { render(); lastRendering = signature; }
  } catch (error) { if (state) { connectionError = `Connection lost. ${error.message}`; errors(); renderShell(); } }
  finally { refreshing = false; }
}
function render() {
  if (!state) return;
  const opened = new Set([...document.querySelectorAll('details[data-disclosure][open]')].map(n => n.dataset.disclosure));
  const active = document.activeElement?.dataset.focus;
  renderShell(); ({ requests: renderRequests, handoffs: renderHandoffs, reception: renderReception, settings: renderSettings })[currentView]();
  document.querySelectorAll('details[data-disclosure]').forEach(n => { n.open = opened.has(n.dataset.disclosure); });
  if (active) [...document.querySelectorAll('[data-focus]')].find(n => n.dataset.focus === active)?.focus({ preventScroll: true });
}

const svgNS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attributes = {}, text) { const n = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, String(value)); if (text !== undefined) n.textContent = text; return n; }
function point(place, index) { const fallback = [{ x: 66, y: 74 }, { x: 36, y: 34 }, { x: 61, y: 26 }, { x: 84, y: 39 }, { x: 51, y: 10 }][index % 5]; return { x: Math.max(8, Math.min(92, Number.isFinite(place.x) ? place.x : fallback.x)) * 10, y: Math.max(12, Math.min(82, Number.isFinite(place.y) ? place.y : fallback.y)) * 6 }; }
function campusMap(item, study = false) {
  const wrap = el('div', undefined, 'map'); const head = el('div', undefined, 'map-head'); head.append(el('span', 'UT Dallas'), el('span', 'Campus schematic · not to scale')); wrap.append(head);
  const svg = svgNode('svg', { viewBox: '0 0 1000 600', role: 'img', 'aria-label': study ? 'Schematic campus landmarks referenced by received radio reports' : 'Schematic campus landmarks, with the selected case landmark when known' });
  svg.append(svgNode('rect', { width: 1000, height: 600, fill: '#eeefef' }));
  // Illustrative campus geometry. These paths are neither roads for dispatch nor radio links.
  for (const path of ['M-50 480 L1030 480', 'M-20 185 L1000 185', 'M215 -10 L215 610', 'M470 -10 L470 610', 'M775 -10 L775 610']) svg.append(svgNode('path', { d: path, fill: 'none', stroke: '#fafafa', 'stroke-width': 22 }));
  const places = landmarksFor(state.regionProfile); const located = item ? caseLocation(item, state.regionProfile) : null;
  places.forEach((place, index) => {
    const p = point(place, index); const isHub = place.id.toLowerCase() === 'ecsw'; const chosen = located?.landmark?.id === place.id;
    svg.append(svgNode('rect', { x: p.x - 50, y: p.y - 30, width: 100, height: 60, rx: 2, fill: '#dadcdd', stroke: '#cfd1d2', 'stroke-width': 1 }));
    if (chosen) svg.append(svgNode('circle', { cx: p.x, cy: p.y, r: 65, fill: '#e20074', 'fill-opacity': .045, stroke: '#e20074', 'stroke-width': 2, 'stroke-dasharray': '5 7' }));
    if (isHub) svg.append(svgNode('circle', { cx: p.x, cy: p.y, r: 7, fill: '#e20074' }));
    const count = study ? reports().filter(r => !r.simulated && reportedLocation(r, state.regionProfile).landmark?.id === place.id).length : 0;
    if (count) { svg.append(svgNode('circle', { cx: p.x + 39, cy: p.y - 29, r: 15, fill: '#e20074' })); svg.append(svgNode('text', { x: p.x + 39, y: p.y - 23, 'text-anchor': 'middle', 'font-size': 17, fill: '#fff', 'font-weight': 600 }, String(count))); }
    const label = place.name === 'Engineering and Computer Science West' ? 'ECSW' : place.name;
    svg.append(svgNode('text', { x: p.x > 800 ? p.x + 46 : p.x - 46, y: p.y + 57, 'text-anchor': p.x > 800 ? 'end' : 'start', fill: chosen || isHub ? '#a50055' : '#535860', 'font-size': 21, 'font-weight': chosen || isHub ? 600 : 400 }, label));
    if (isHub) svg.append(svgNode('text', { x: p.x - 46, y: p.y + 80, fill: '#6a6e73', 'font-size': 16 }, 'Receiving hub'));
  });
  wrap.append(svg);
  let caption = study ? 'Counts show distinct radio requests mentioning one recognized landmark. They do not establish the sender’s position or radio coverage.' : located?.kind === 'landmark' && located.landmark ? `Selected case: ${located.label}. Approximate landmark; exact sender position is not established.` : located?.kind === 'gps' ? 'Phone GPS is available in the source details. This schematic is not georeferenced, so that fix is not plotted.' : 'Reports without a recognized single landmark remain in Incoming. No coverage or relay paths are inferred.';
  wrap.append(el('p', caption, 'map-foot')); return wrap;
}

function renderRequests() {
  const source = $('source').value; const subset = reports().filter(item => source === 'all' || (source === 'test') === Boolean(item.simulated));
  const visible = selectVisibleReport(subset, $('filter').value, selected); selected = visible.selectedId; const item = visible.selectedReport;
  $('count').textContent = `${visible.reports.length} ${visible.reports.length === 1 ? 'report' : 'reports'}`;
  const list = $('incident-list'); const scroll = list.scrollTop; list.replaceChildren();
  if (!visible.reports.length) list.append(el('p', source === 'radio' ? 'No radio reports in this view.' : 'No reports in this view.', 'queue-empty'));
  for (const report of visible.reports) {
    const b = button('', () => { selected = report.id; render(); }, `report${report.id === selected ? ' selected' : ''}`); b.dataset.focus = `request-${report.id}`; b.setAttribute('aria-pressed', String(report.id === selected));
    const title = el('div', undefined, 'report-title'); title.append(el('span', `${categories[report.request.category] || 'Emergency'} · ${caseLocation(report, state.regionProfile).label}`), el('span', priorities[report.request.severity] || 'Priority not recorded', `priority p${report.request.severity}`));
    b.append(title, el('div', `${when(report.receivedAt)} · ${report.request.people} ${report.request.people === 1 ? 'person' : 'people'} · ${report.simulated ? 'Test' : 'Radio'}`, 'report-meta'), el('div', clip(report.request.note || 'No additional note supplied.', 140), 'report-note')); list.append(b);
  }
  list.scrollTop = scroll; $('map').replaceChildren(campusMap(item));
  const root = $('detail'); root.replaceChildren();
  if (!item) { const empty = el('div', undefined, 'empty'); empty.append(el('h2', 'Ready to receive'), el('p', 'Authenticated reports appear here with their original message. Choose another source or review filter to see saved reports.')); root.append(empty); return; }
  renderReport(root, item);
}
function renderReport(root, item) {
  const c = item.coordination; const location = caseLocation(item, state.regionProfile);
  const top = el('div', undefined, 'detail-head'); top.append(el('span', `${item.simulated ? 'Test report' : 'Radio report'} · ${when(item.receivedAt, true)}`), el('span', priorities[item.request.severity] || 'Priority not recorded', `priority p${item.request.severity}`)); root.append(top);
  root.append(el('h2', c?.summary?.headline || `${categories[item.request.category] || 'Emergency'} request`), el('p', `${item.request.people} ${item.request.people === 1 ? 'person' : 'people'} reported · ${categories[item.request.category] || 'Category not recorded'}`, 'detail-sub'));
  const original = section('Original message'); original.append(el('p', item.request.note || 'No additional note supplied.', 'original original-block'), el('p', `${location.label} · ${location.provenance}${location.accuracy !== null ? ` · accuracy ${location.accuracy} m` : ''}`, 'location-note')); root.append(original, coordinationPanel(item), summaryDisclosure(item), sourceDisclosure(item));
}
function coordinationPanel(item) {
  const c = item.coordination; const n = section(state.automation?.paused ? 'Automation paused' : c?.statusLabel || 'Saved at ECSW', 'section coordination-state');
  let text = !c ? 'This is a saved reception from before automatic regional coordination. It has not been sent as a new case.' : c.error || (c.stage === 'simulated-dispatched' ? 'The supervisor recorded a simulated service dispatch. No real emergency service was contacted.' : c.sharedRevision >= c.revision ? 'The supervisor has this revision. Updates return here automatically.' : 'ECSW prepares the source information and shares it with the supervisor automatically.');
  if (state.automation?.paused && c) text = 'New regional work is paused. Radio intake and saved reports remain available.';
  n.append(el('p', text)); const actions = el('div', undefined, 'actions');
  actions.append(button('Inspect summary', () => openDisclosure('summary-' + item.id)), button('Correct location', () => beginCorrection(item)));
  if (c) actions.append(button('View regional handoff', () => { handoffSelected = item.id; setView('handoffs', true); }));
  n.append(actions); return n;
}
function openDisclosure(key) { const n = [...document.querySelectorAll('[data-disclosure]')].find(d => d.dataset.disclosure === key); if (n) { n.open = true; n.scrollIntoView({ block: 'nearest', behavior: 'auto' }); n.querySelector('summary').focus(); } }
function summaryDisclosure(item) {
  const d = disclosure('Summary and agent activity', 'summary-' + item.id); const s = item.coordination?.summary || item.summary;
  d.append(el('p', s?.text || 'A source summary has not been prepared for this report.', 'small'));
  if (s?.resource) d.append(facts([['Requested resource', s.resource], ['Quantity', String(s.quantity ?? 'Not selected')]]));
  const source = s?.source === 'local-model' ? `Prepared with the local model${s.model ? ': ' + s.model : ''}.` : s?.source ? 'Prepared using source rules or verified source spans.' : 'Summary source not yet available.';
  d.append(el('p', `${source} The original message and reported fields remain authoritative.`, 'fine'));
  if (item.coordination?.events?.length) d.append(eventList(item.coordination.events)); return d;
}
function eventList(events) {
  const list = el('ol', undefined, 'event-list'); for (const event of events.slice(-12)) { const li = el('li'); li.append(el('time', when(event.at, true)), el('span', `${clip(event.actor, 60)} · ${clip(event.action || event.tool, 100).replaceAll('_', ' ')}`)); if (event.result) li.append(el('span', clip(event.result, 400), 'event-result')); list.append(li); } return list;
}
function sourceDisclosure(item) {
  const d = disclosure('Source details and receipt', 'source-' + item.id); const r = item.request; const loc = reportedLocation(item, state.regionProfile);
  d.append(facts([['Original category', categories[r.category] || String(r.category)], ['Reported priority', priorities[r.severity] || String(r.severity)], ['People reported', String(r.people)], ['Source', item.simulated ? 'Synthetic test report' : 'Authenticated radio report'], ['Original location', loc.label], ['Location provenance', `${loc.provenance}${loc.accuracy !== null ? ' · accuracy ' + loc.accuracy + ' m' : ''}`], ['Phone report time', r.createdAt ? when(r.createdAt * 1000, true) : 'Not recorded'], ['Phone battery', r.battery === 255 ? 'Not recorded' : numeric(r.battery, '%')], ['RSSI', numeric(item.radio?.rssi, ' dBm')], ['SNR', numeric(item.radio?.snr, ' dB')], ['Radio receptions', String(item.receptions || 1)], ['Last received', when(item.lastReceivedAt, true)]]));
  const concerns = [r.flags & 2 ? 'Breathing concern' : '', r.flags & 4 ? 'Trapped' : '', r.flags & 8 ? 'Severe bleeding' : ''].filter(Boolean).join(' · ');
  d.append(el('p', concerns ? `Phone-selected concerns: ${concerns}.` : 'No additional phone concern selected.', 'small'));
  const receipt = el('ul', undefined, 'receipt-list'); for (const [label, at] of [['Hub received', item.receivedAt], ['Human reviewed', item.reviewedAt]]) receipt.append(el('li', `${label}: ${at ? when(at, true) : 'Not recorded'}`)); d.append(receipt);
  d.append(el('p', item.lastTransmission?.state === 'submitted-to-radio' ? 'Receipt submitted to the radio. Phone delivery is not confirmed.' : 'A phone receipt has not been confirmed.', 'fine'));
  const review = button(item.status === 'operator-reviewed' ? 'Resend human-review receipt' : 'Record human review', () => act(async () => { await api(`/api/incidents/${encodeURIComponent(item.id)}/review`, {}); notice('Human review recorded. No real services dispatched.'); })); review.dataset.mutation = 'true'; review.disabled = busy; d.append(review, el('p', 'Optional: records your explicit review and sends a separate review receipt. Automatic coordination does not mark a request human-reviewed.', 'fine')); return d;
}
function beginCorrection(item) {
  if (!state.automation) { actionError = 'Location corrections need the updated hub service.'; errors(); return; }
  correctionId = item.id; $('location-label').value = caseLocation(item, state.regionProfile).kind === 'landmark' ? caseLocation(item, state.regionProfile).label : '';
  $('landmark-names').replaceChildren(...landmarksFor(state.regionProfile).map(place => { const n = el('option'); n.value = place.name; return n; })); $('location-dialog').showModal(); $('location-label').focus();
}

function pageHeading(title, subtitle) { const n = el('div', undefined, 'page-heading'); const text = el('div'); text.append(el('h1', title), el('p', subtitle, 'muted')); n.append(text); return n; }
function renderReception() {
  const root = $('reception-view'); root.replaceChildren(); const radio = reports().filter(item => !item.simulated); const sample = receptionSummary(radio, state.regionProfile);
  const heading = pageHeading('Campus reception study', sample.first ? `${when(sample.first, true)} – ${when(sample.last, true)} · America/Chicago` : 'No hardware receptions recorded yet');
  const filter = el('label', undefined, 'study-filter'); filter.append(el('span', 'Table sources')); const select = el('select'); select.setAttribute('aria-label', 'Reception table sources');
  for (const [value, label] of [['radio', 'Radio only'], ['all', 'Include tests']]) { const option = el('option', label); option.value = value; select.append(option); } select.value = includeTests ? 'all' : 'radio'; select.onchange = () => { includeTests = select.value === 'all'; renderReception(); }; filter.append(select); heading.append(filter); root.append(heading);
  root.append(el('p', `${sample.requests} distinct radio ${sample.requests === 1 ? 'request' : 'requests'}, received ${sample.receptions} times. ${sample.gps} ${sample.gps === 1 ? 'has' : 'have'} phone GPS; ${sample.withoutGps} ${sample.withoutGps === 1 ? 'does' : 'do'} not. Repeat receptions do not add people or new requests.`, 'study-summary'));
  const layout = el('div', undefined, 'study-layout'); const map = el('div', undefined, 'study-map'); map.append(campusMap(null, true));
  const data = el('div'); data.append(el('p', 'Historical evidence from this hub. A landmark mentioned in a note is approximate. These samples do not prove campus-wide coverage, range, or the path a message took.', 'page-intro'));
  const items = reports().filter(item => includeTests || !item.simulated); const table = el('table', undefined, 'data-table');
  const caption = el('caption', 'Received reports and signal measurements'); caption.className = 'sr-only'; table.append(caption);
  const head = el('thead'); const hr = el('tr'); for (const title of ['Received', 'Reported place', 'RSSI', 'SNR', 'Receptions']) { const th = el('th', title); th.scope = 'col'; hr.append(th); } head.append(hr); table.append(head); const body = el('tbody');
  for (const item of items) {
    const row = el('tr'); const loc = reportedLocation(item, state.regionProfile); const at = el('td'); at.append(button(when(item.receivedAt, true), () => openRequest(item)), el('small', item.simulated ? 'Test report' : 'Radio report'));
    const place = el('td'); place.append(el('span', loc.label), el('small', loc.provenance));
    row.append(at, place, el('td', numeric(item.radio?.rssi, ' dBm')), el('td', numeric(item.radio?.snr, ' dB')), el('td', String(item.receptions || 1))); body.append(row);
  }
  if (!items.length) { const row = el('tr'); const td = el('td', 'No reports recorded for this source.'); td.colSpan = 5; row.append(td); body.append(row); } table.append(body); const tableWrap = el('div', undefined, 'table-wrap'); tableWrap.append(table); data.append(tableWrap);
  const signals = name => { const s = sample[name]; return s.n ? `${name.toUpperCase()}: ${s.min} to ${s.max}, median ${s.median} (${s.n} latest-per-request measurements)` : `${name.toUpperCase()}: no measurements`; };
  data.append(el('p', `${signals('rssi')}. ${signals('snr')}. These are receiver-side observations. Missing values remain missing; no latency or delivery-rate estimate is inferred.`, 'signal-note')); layout.append(map, data); root.append(layout);
}
function renderHandoffs() {
  const root = $('handoffs-view'); root.replaceChildren(); const items = reports().filter(item => item.coordination); const selectedItem = items.find(item => item.id === handoffSelected) || items[0]; handoffSelected = selectedItem?.id || null;
  root.append(pageHeading('Regional handoffs', state.automation?.paused ? 'Automation paused · saved cases remain visible' : 'ECSW shares case revisions automatically'));
  const link = supervisorLink(); if (link) { const p = el('p', undefined, 'page-intro'); p.append(link); root.append(p); }
  if (!items.length) { root.append(el('p', 'No automatic case handoffs recorded yet. Historical receptions remain in Local requests and the reception study.', 'page-intro')); return; }
  const layout = el('div', undefined, 'handoff-layout'); const list = el('div', undefined, 'handoff-list'); list.setAttribute('aria-label', 'Coordinated requests');
  for (const item of items) { const b = button('', () => { handoffSelected = item.id; render(); }, `handoff-row${item.id === handoffSelected ? ' selected' : ''}`); b.setAttribute('aria-pressed', String(item.id === handoffSelected)); b.dataset.focus = `handoff-${item.id}`; b.append(el('strong', `${categories[item.request.category] || 'Emergency'} · ${caseLocation(item, state.regionProfile).label}`), el('span', `${item.simulated ? 'Test' : 'Radio'} · ${when(item.receivedAt)} · ${item.coordination.statusLabel || 'Pending'}`)); list.append(b); }
  const pane = el('article', undefined, 'handoff-detail'); const c = selectedItem.coordination; pane.append(el('h2', c.summary?.headline || `${categories[selectedItem.request.category] || 'Emergency'} request`), el('p', `${c.statusLabel || 'Pending'} · ${selectedItem.simulated ? 'Test intake' : 'Radio intake'}`, 'status-line'), el('p', selectedItem.request.note || 'No additional note supplied.', 'original original-block'));
  const information = section('Current handoff'); information.append(facts([['Case', c.caseId], ['Local revision', String(c.revision)], ['Supervisor revision', c.sharedRevision ? String(c.sharedRevision) : 'Not acknowledged'], ['Case location', caseLocation(selectedItem, state.regionProfile).label]]));
  if (c.summary?.text) information.append(el('p', c.summary.text, 'small')); if (c.error) information.append(el('p', c.error, 'small')); pane.append(information);
  if (c.allocation) {
    const a = c.allocation; const allocation = section(a.simulation === true ? 'Simulated service allocation' : 'Allocation received');
    allocation.append(facts([['Town', a.townId || 'Not recorded'], ['Service', a.service || 'Not recorded'], ['Resource', a.resource || 'Not recorded'], ['Quantity', String(a.quantity ?? 'Not recorded')]]), el('p', a.simulation === true ? 'Simulation only. No real emergency service has been contacted.' : 'Dispatch status has not been verified.', 'fine')); pane.append(allocation);
  }
  const activity = disclosure('Agent activity', 'handoff-activity-' + selectedItem.id); activity.append(c.events?.length ? eventList(c.events) : el('p', 'No agent activity recorded.', 'small')); pane.append(activity, button('Open original request', () => openRequest(selectedItem))); layout.append(list, pane); root.append(layout);
}
function supervisorLink() {
  const value = state.automation?.supervisor?.publicUrl; if (!value) return null;
  try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null; const a = el('a', 'Open regional supervisor'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; } catch { return null; }
}
function renderSettings() {
  const root = $('settings-view'); root.replaceChildren(); root.append(pageHeading('Hub settings', 'ECSW · UT Dallas'));
  const grid = el('div', undefined, 'system-grid');
  function settingsSection(title, entries) { const n = el('section', undefined, 'system-section'); n.append(el('h2', title)); const dl = el('dl'); for (const [name, value] of entries) dl.append(el('dt', name), el('dd', value)); n.append(dl); grid.append(n); return n; }
  settingsSection('Region and radio', [['Region', state.regionProfile?.id || String(state.region)], ['Hub', state.regionProfile?.hubName || 'ECSW'], ['Frequency', numeric(state.regionProfile?.frequencyMHz || state.link?.board?.frequency, ' MHz')], ['Radio', radioLabel(state.link)], ['Location context', 'Fixed campus landmark schematic. Not a coverage map.']]);
  const model = state.automation?.model; settingsSection('Local agent', [['Model', model?.name || state.ai?.model || 'Not configured'], ['Configured', model ? model.enabled ? 'Enabled' : 'Off' : state.ai?.enabled ? 'Enabled' : 'Off'], ['Last model result', model?.lastSuccessAt ? when(model.lastSuccessAt, true) : 'No successful local-model run recorded'], ['Latest source', model?.lastSource || 'Not recorded'], ['Current issue', model?.error || 'No issue reported']]);
  const db = state.database; settingsSection('User database', [['Storage', db?.mode === 'mongodb' ? 'MongoDB' : 'Local incident spool'], ['MongoDB', db?.connected ? 'Connected' : db?.configured ? 'Configured · connection unavailable' : 'Not configured'], ['Current issue', db?.error || 'No issue reported']]);
  const supervisor = state.automation?.supervisor; const regional = settingsSection('Regional coordination', [['Automation', state.automation ? state.automation.paused ? 'Paused' : 'Automatic' : 'Not available in this service version'], ['Supervisor', supervisor?.connected ? 'Connected' : supervisor?.configured ? 'Configured · not currently connected' : 'Not configured'], ['Last synchronization', supervisor?.lastSyncAt ? when(supervisor.lastSyncAt, true) : 'Not recorded'], ['Pending revisions', supervisor ? String(supervisor.pending ?? 0) : 'Not recorded'], ['Current issue', supervisor?.error || 'No issue reported']]); const link = supervisorLink(); if (link) { const p = el('p', undefined, 'small'); p.append(link); regional.append(p); }
  const session = settingsSection('Operator session', [['Operator', 'operator'], ['Browser access', 'Remembered sessions remain signed in until revoked or expired. Sign out revokes this browser.'], ['Human review', 'Recorded only after the explicit review action. Automatic agent work does not impersonate an operator.']]); session.append(button('Sign out of this browser', () => $('logout').click())); root.append(grid);
}

for (const n of document.querySelectorAll('[data-view]')) n.onclick = () => setView(n.dataset.view, true);
window.addEventListener('hashchange', () => { if (views.includes(location.hash.slice(1))) { currentView = location.hash.slice(1); render(); } });
$('source').onchange = $('filter').onchange = () => render();
$('login-form').onsubmit = event => { event.preventDefault(); act(async () => { const password = $('token').value.trim(); await api('/api/login', { token: password, username: $('username').value.trim(), password, remember: $('remember').checked }); $('token').value = ''; }); };
$('logout').onclick = () => act(async () => { await api('/api/logout', {}); signedOut(); notice('This browser has been signed out.'); });
$('pause').onclick = () => act(async () => { const paused = !state.automation.paused; await api('/api/automation', { paused }); notice(paused ? 'Automatic regional coordination paused. Radio intake continues.' : 'Automatic regional coordination resumed.'); });
$('simulate').onclick = () => act(async () => { const value = await api('/api/simulate', {}); selected = value.id; $('source').value = 'test'; $('filter').value = 'all'; currentView = 'requests'; notice('Synthetic test report received. Dispatch remains simulated.'); });
$('close-location').onclick = () => $('location-dialog').close();
$('location-form').onsubmit = event => { event.preventDefault(); const id = correctionId; const label = $('location-label').value.trim(); if (!id || !label) return; act(async () => { await api(`/api/incidents/${encodeURIComponent(id)}/location`, { label }); $('location-dialog').close(); correctionId = null; notice('Case location corrected. The original phone report is unchanged.'); }); };
await refresh(); setInterval(refresh, 2500);
