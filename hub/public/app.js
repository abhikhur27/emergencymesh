import { selectVisibleReport } from './view-selection.js';
import { landmarksFor, reportedLocation, caseLocation, receptionSummary, sortReports } from './reception-data.js';
import { createCampusMap, profileWithCampus } from './campus-map.js';
import { hubMetrics, supplySelections, needsFor, allocationsFor, RESOURCE_LABELS, CATEGORY_LABELS, resourceUnit } from './ops-metrics.js';

const $ = id => document.getElementById(id);
const categories = CATEGORY_LABELS;
const priorities = { 1: 'Urgent', 2: 'Serious', 3: 'Assistance' };
const views = ['requests', 'handoffs', 'reception', 'settings'];
let state = null, selected = null, handoffSelected = null, csrf = '', busy = false, refreshing = false;
let currentView = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'requests';
let lastRendering = '', connectionError = '', actionError = '', noticeTimer, correctionId = null, includeTests = false;
let campusData = null, requestMap = null, receptionMap = null;
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
function reports() { return sortReports(state?.incidents || []); }
function campusProfile() { return profileWithCampus(state?.regionProfile, campusData); }
function acceptMap(data) { if (campusData !== data) { campusData = data; render(); } }
function coordinationLabel(item) { return item.coordination?.stage === 'simulated-dispatched' ? 'Service handoff complete' : item.coordination?.stage === 'partial' ? 'Some resources still needed' : item.coordination?.statusLabel || 'Saved at ECSW'; }
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
  $('link').textContent = state.link?.connected && state.link?.readiness === 'ready' ? 'Radio ready' : radioLabel(state.link);
  $('link').classList.toggle('radio-ready', Boolean(state.link?.connected && state.link?.readiness === 'ready'));
  $('region-context').textContent = `${state.regionProfile?.name || 'UT Dallas'} · ${state.regionProfile?.hubName || 'ECSW'} · ${state.regionProfile?.frequencyMHz || 915} MHz`;
  $('connection-note').textContent = connectionError ? 'Last saved state shown' : state.automation?.paused ? 'Coordination paused' : state.automation?.supervisor?.connected ? 'Regional coordination connected' : 'Regional coordination pending';
  $('simulate').hidden = !state.simulation; $('pause').hidden = !state.automation;
  $('pause').textContent = state.automation?.paused ? 'Resume automation' : 'Pause automation'; $('pause').disabled = busy;
  for (const n of document.querySelectorAll('[data-view]')) { if (n.dataset.view === currentView) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); }
  for (const view of views) $(`${view}-view`).hidden = currentView !== view;
  renderOperations();
}

function miniHistogram(sample, label) {
  const NS = 'http://www.w3.org/2000/svg', chart = document.createElementNS(NS, 'svg'); chart.setAttribute('viewBox', '0 0 240 42'); chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `${label}. ${sample.total} requests in twelve five-minute bins.`);
  const max = Math.max(1, ...sample.bins.map(b => b.count));
  sample.bins.forEach((bin, i) => { const bar = document.createElementNS(NS, 'rect'); bar.setAttribute('x', String(i * 20 + 2)); bar.setAttribute('y', String(39 - bin.count / max * 35)); bar.setAttribute('width', '14'); bar.setAttribute('height', String(bin.count / max * 35)); bar.setAttribute('rx', '1'); const title = document.createElementNS(NS, 'title'); title.textContent = `${when(bin.start)}–${when(bin.end)}: ${bin.count}`; bar.append(title); chart.append(bar); });
  const baseline = document.createElementNS(NS, 'path'); baseline.setAttribute('d', 'M0 40H240'); baseline.setAttribute('class', 'histogram-baseline'); chart.append(baseline); return chart;
}
function renderOperations() {
  const root = $('operations-overview'); if (!root || !state) return; root.replaceChildren();
  const m = hubMetrics(state), supervisor = state.automation?.supervisor || {}, local = state.automation?.model, remote = supervisor.agent;
  const route = el('div', undefined, 'agent-route'); const from = el('div', undefined, 'agent-end'); from.append(el('strong', 'Local hub agent'), el('span', `${state.regionProfile?.hubName || 'ECSW'} · ${local?.name || state.ai?.model || 'Source rules'}`));
  const exchange = el('div', undefined, 'agent-exchange'); exchange.append(el('span', `${m.acknowledged} acknowledged · ${m.pending} waiting`, 'exchange-count'));
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); arrow.setAttribute('viewBox', '0 0 120 16'); arrow.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M2 5H117L111 1M117 11H2L8 15'); arrow.append(path); exchange.append(arrow);
  exchange.append(el('span', m.lastAck ? `Last ACK ${when(m.lastAck)}` : m.acknowledged > 0 ? 'ACK time unavailable' : 'No case ACK recorded', 'exchange-time'));
  const to = el('div', undefined, 'agent-end'); to.append(el('strong', 'Regional agent'), el('span', remote?.model ? `${remote.model} · ${remote.hosting === 'brev' ? 'Brev GPU' : remote.hosting || 'Configured provider'}` : supervisor.connected ? 'Connected · provider details pending' : supervisor.configured ? 'Waiting for connection' : 'Not configured'));
  to.append(el('span', `${m.returned} updates returned`, 'agent-note')); route.dataset.connected = String(Boolean(supervisor.connected));
  route.append(from, exchange, to);
  const stats = el('div', undefined, 'intake-measures'); const numbers = el('dl', undefined, 'measure-line'); for (const [label, value] of [['Radio requests', m.requests], ['Receptions', m.receptions], ['With GPS', m.gps], ['Needs attention', m.needsAttention]]) { const pair = el('div'); pair.append(el('dt', label), el('dd', String(value))); numbers.append(pair); }
  const plot = el('div', undefined, 'intake-plot'); plot.append(miniHistogram(m.histogram, 'New radio requests in the last sixty minutes'), el('p', `${m.histogram.total} new in 60 min · 5 min bins`, 'plot-caption'));
  stats.append(numbers, plot); root.append(route, stats, el('p', `Saved radio requests · Priority: ${m.priorities[0]} urgent, ${m.priorities[1]} serious, ${m.priorities[2]} assistance. Coordinated cases: ${m.sourceOnly} source-only · ${m.modelAssisted} model-assisted.`, 'operations-scope'));
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

function renderRequests() {
  const source = $('source').value; const subset = reports().filter(item => source === 'all' || (source === 'test') === Boolean(item.simulated));
  const visible = selectVisibleReport(subset, $('filter').value, selected); selected = visible.selectedId; const item = visible.selectedReport;
  $('count').textContent = `${visible.reports.length} ${visible.reports.length === 1 ? 'report' : 'reports'}`;
  const list = $('incident-list'); const scroll = list.scrollTop; list.replaceChildren();
  if (!visible.reports.length) list.append(el('p', source === 'radio' ? 'No radio reports in this view.' : 'No reports in this view.', 'queue-empty'));
  for (const report of visible.reports) {
    const b = button('', () => { selected = report.id; render(); }, `report${report.id === selected ? ' selected' : ''}`); b.dataset.focus = `request-${report.id}`; b.setAttribute('aria-pressed', String(report.id === selected));
    const location = caseLocation(report, campusProfile());
    const marker = el('span', ''); marker.className = 'report-marker'; marker.setAttribute('aria-hidden', 'true');
    const copy = el('div', undefined, 'report-copy'); const title = el('div', undefined, 'report-title'); title.append(el('strong', location.kind === 'unknown' ? 'Location needed' : location.label), el('span', when(report.receivedAt), 'report-time'));
    const meta = el('div', undefined, 'report-meta'); meta.append(el('span', categories[report.request.category] || 'Emergency'), el('span', priorities[report.request.severity] || 'Priority not recorded', `priority p${report.request.severity}`), el('span', `${report.request.people} ${report.request.people === 1 ? 'person' : 'people'}`)); const needs = supplySelections(report.request); if (needs.length) meta.append(el('span', `${needs.length} supply ${needs.length === 1 ? 'need' : 'needs'}`)); if (report.simulated) meta.append(el('span', 'Test', 'source-test'));
    copy.append(title, meta, el('div', clip(report.request.note || 'No additional note supplied.', 140), 'report-note')); b.append(marker, copy); list.append(b);
  }
  list.scrollTop = scroll;
  if (!requestMap) { requestMap = createCampusMap({ onSelectRequest: id => { selected = id; render(); }, onData: acceptMap }); $('map').replaceChildren(requestMap.element); }
  requestMap.update({ selected: item, incidents: visible.reports, profile: campusProfile() });
  const root = $('detail'); root.replaceChildren();
  if (!item) { const empty = el('div', undefined, 'empty'); empty.append(el('h2', 'Ready to receive'), el('p', 'Authenticated reports appear here with their original message. Choose another source or review filter to see saved reports.')); root.append(empty); return; }
  renderReport(root, item);
}
function renderReport(root, item) {
  const c = item.coordination; const location = caseLocation(item, campusProfile());
  const top = el('div', undefined, 'detail-head'); top.append(el('span', `${item.simulated ? 'Test report · ' : ''}Received ${when(item.receivedAt, true)}`), el('span', priorities[item.request.severity] || 'Priority not recorded', `priority p${item.request.severity}`)); root.append(top);
  root.append(el('h2', `${categories[item.request.category] || 'Emergency'} request`), el('p', `${item.request.people} ${item.request.people === 1 ? 'person' : 'people'} reported · ${priorities[item.request.severity] || 'Priority not recorded'}`, 'detail-sub'));
  const signal = section('Reported by the phone', 'section reported-signal');
  const selectedSupplies = supplySelections(item.request); signal.append(facts([['Danger', categories[item.request.category] || 'Not recorded'], ['Supplies selected', selectedSupplies.length ? selectedSupplies.map(name => RESOURCE_LABELS[name]).join(' · ') : 'None selected'], ['Location', location.label], ['Location source', location.provenance]]));
  const concerns = [item.request.flags & 2 ? 'Breathing concern' : '', item.request.flags & 4 ? 'Trapped' : '', item.request.flags & 8 ? 'Severe bleeding' : ''].filter(Boolean);
  if (concerns.length) signal.append(el('p', concerns.join(' · '), 'reported-concerns'));
  const original = section('Additional note'); original.append(el('p', item.request.note || 'No additional note supplied.', item.request.note ? 'original original-block' : 'small muted'), el('p', location.accuracy !== null ? `Phone-reported GPS accuracy ${location.accuracy} m.` : 'GPS accuracy is not recorded.', 'location-note'));
  root.append(signal, original, coordinationPanel(item), summaryDisclosure(item), sourceDisclosure(item));
}
function coordinationPanel(item) {
  const c = item.coordination; const n = section(state.automation?.paused ? 'Automation paused' : coordinationLabel(item), 'section coordination-state');
  let text = !c ? 'This is a saved reception from before automatic regional coordination. It has not been sent as a new case.' : c.error || (c.stage === 'simulated-dispatched' ? 'The supervisor completed the service handoff and returned its outcome.' : c.sharedRevision >= c.revision ? 'The supervisor has this revision. Updates return here automatically.' : 'ECSW prepares the source information and shares it with the supervisor automatically.');
  if (state.automation?.paused && c) text = 'New regional work is paused. Radio intake and saved reports remain available.';
  n.append(el('p', text));
  if (c) n.append(facts([['Local hub → regional agent', c.sentAt ? `Sent ${when(c.sentAt)}` : c.sharedRevision ? 'Source revision sent' : 'Waiting in the durable queue'], ['Regional acknowledgment', c.acknowledgedAt ? when(c.acknowledgedAt) : c.sharedRevision >= c.revision ? 'Current revision saved by regional agent' : 'Not yet recorded'], ['Returned update', c.lastUpdateAt ? when(c.lastUpdateAt) : c.supervisorSeq > 0 ? 'Received · time unavailable' : 'Not yet recorded']]));
  if (c?.unmetNeeds?.length) n.append(el('p', `Still needed: ${c.unmetNeeds.map(need => `${RESOURCE_LABELS[need.resource] || need.resource} · ${resourceUnit(need.resource, need.quantity)}`).join('; ')}.`, 'unmet-needs'));
  const actions = el('div', undefined, 'actions');
  actions.append(button('Inspect agent activity', () => openDisclosure('summary-' + item.id)), button('Correct location', () => beginCorrection(item)));
  if (c) actions.append(button('View regional handoff', () => { handoffSelected = item.id; setView('handoffs', true); }));
  n.append(actions); return n;
}
function openDisclosure(key) { const n = [...document.querySelectorAll('[data-disclosure]')].find(d => d.dataset.disclosure === key); if (n) { n.open = true; n.scrollIntoView({ block: 'nearest', behavior: 'auto' }); n.querySelector('summary').focus(); } }
function summaryDisclosure(item) {
  const d = disclosure('Local processing and agent activity', 'summary-' + item.id); const s = item.coordination?.summary || item.summary;
  d.append(el('p', s?.source === 'signal' ? 'Read directly from the encrypted report. No model summary was needed.' : s?.text || 'Local processing is waiting for this report.', 'small'));
  const needs = needsFor(item); if (needs.length) { const list = el('ul', undefined, 'planning-needs'); for (const need of needs) list.append(el('li', `${RESOURCE_LABELS[need.resource] || need.resource}: ${resourceUnit(need.resource, need.quantity)}`)); d.append(el('h3', 'Planning needs'), list, el('p', 'Quantities are derived by resource policy from the reported situation; they are not quantities entered on the phone.', 'fine')); }
  const source = s?.source === 'signal' ? 'Direct signal fields.' : s?.source === 'local-model' ? `Local Nemotron assistance${s.model ? ': ' + s.model : ''}.` : s?.source ? 'Source rules or verified source spans.' : 'Processing source not yet available.';
  d.append(el('p', `${source} The original message and reported fields remain authoritative.`, 'fine'));
  if (item.coordination?.events?.length) d.append(eventList(item.coordination.events)); return d;
}
function eventList(events) {
  const list = el('ol', undefined, 'event-list'); for (const event of events.slice(-12)) { const li = el('li'); li.append(el('time', when(event.at, true)), el('span', `${clip(event.actor, 60)} · ${clip(event.action || event.tool, 100).replaceAll('_', ' ')}`)); if (event.result) li.append(el('span', clip(event.result, 400), 'event-result')); list.append(li); } return list;
}
function sourceDisclosure(item) {
  const d = disclosure('Source details and receipt', 'source-' + item.id); const r = item.request; const loc = reportedLocation(item, campusProfile());
  d.append(facts([['Original category', categories[r.category] || String(r.category)], ['Reported priority', priorities[r.severity] || String(r.severity)], ['People reported', String(r.people)], ['Source', item.simulated ? 'Synthetic test report' : 'Authenticated radio report'], ['Phone-selected supplies', supplySelections(r).map(name => RESOURCE_LABELS[name]).join(' · ') || 'None selected'], ['Original location', loc.label], ['Location provenance', `${loc.provenance}${loc.accuracy !== null ? ' · accuracy ' + loc.accuracy + ' m' : ''}`], ['Phone report time', r.createdAt ? when(r.createdAt * 1000, true) : 'Not recorded'], ['Phone battery', r.battery === 255 ? 'Not recorded' : numeric(r.battery, '%')], ['RSSI', numeric(item.radio?.rssi, ' dBm')], ['SNR', numeric(item.radio?.snr, ' dB')], ['Radio receptions', String(item.receptions || 1)], ['Last received', when(item.lastReceivedAt, true)]]));
  const concerns = [r.flags & 2 ? 'Breathing concern' : '', r.flags & 4 ? 'Trapped' : '', r.flags & 8 ? 'Severe bleeding' : ''].filter(Boolean).join(' · ');
  d.append(el('p', concerns ? `Phone-selected concerns: ${concerns}.` : 'No additional phone concern selected.', 'small'));
  const receipt = el('ul', undefined, 'receipt-list'); for (const [label, at] of [['Hub received', item.receivedAt], ['Human reviewed', item.reviewedAt]]) receipt.append(el('li', `${label}: ${at ? when(at, true) : 'Not recorded'}`)); d.append(receipt);
  d.append(el('p', item.lastTransmission?.state === 'submitted-to-radio' ? 'Receipt submitted to the radio. Phone delivery is not confirmed.' : 'A phone receipt has not been confirmed.', 'fine'));
  const review = button(item.status === 'operator-reviewed' ? 'Resend human-review receipt' : 'Record human review', () => act(async () => { await api(`/api/incidents/${encodeURIComponent(item.id)}/review`, {}); notice('Human review recorded.'); })); review.dataset.mutation = 'true'; review.disabled = busy; d.append(review, el('p', 'Optional: records your explicit review and sends a separate review receipt. Automatic coordination does not mark a request human-reviewed.', 'fine')); return d;
}
function beginCorrection(item) {
  if (!state.automation) { actionError = 'Location corrections need the updated hub service.'; errors(); return; }
  correctionId = item.id; $('location-label').value = caseLocation(item, campusProfile()).kind === 'landmark' ? caseLocation(item, campusProfile()).label : '';
  $('landmark-names').replaceChildren(...landmarksFor(campusProfile()).map(place => { const n = el('option'); n.value = place.name; return n; })); $('location-dialog').showModal(); $('location-label').focus();
}

function pageHeading(title, subtitle) { const n = el('div', undefined, 'page-heading'); const text = el('div'); text.append(el('h1', title), el('p', subtitle, 'muted')); n.append(text); return n; }
function renderReception() {
  const root = $('reception-view'); root.replaceChildren(); const radio = reports().filter(item => !item.simulated); const sample = receptionSummary(radio, campusProfile());
  const heading = pageHeading('Campus reception study', sample.first ? `${when(sample.first, true)} – ${when(sample.last, true)} · America/Chicago` : 'No hardware receptions recorded yet');
  const filter = el('label', undefined, 'study-filter'); filter.append(el('span', 'Table sources')); const select = el('select'); select.setAttribute('aria-label', 'Reception table sources');
  for (const [value, label] of [['radio', 'Radio only'], ['all', 'Include tests']]) { const option = el('option', label); option.value = value; select.append(option); } select.value = includeTests ? 'all' : 'radio'; select.onchange = () => { includeTests = select.value === 'all'; renderReception(); }; filter.append(select); heading.append(filter); root.append(heading);
  root.append(el('p', `${sample.requests} distinct radio ${sample.requests === 1 ? 'request' : 'requests'}, received ${sample.receptions} times. ${sample.gps} ${sample.gps === 1 ? 'has' : 'have'} phone GPS; ${sample.withoutGps} ${sample.withoutGps === 1 ? 'does' : 'do'} not. Repeat receptions do not add people or new requests.`, 'study-summary'));
  const layout = el('div', undefined, 'study-layout'); const map = el('div', undefined, 'study-map');
  if (!receptionMap) receptionMap = createCampusMap({ study: true, onSelectRequest: id => { const found = reports().find(item => item.id === id); if (found) openRequest(found); }, onData: acceptMap });
  receptionMap.update({ selected: null, incidents: radio, profile: campusProfile() }); map.append(receptionMap.element);
  const data = el('div'); data.append(el('p', 'Historical evidence from this hub. A landmark mentioned in a note is approximate. These samples do not prove campus-wide coverage, range, or the path a message took.', 'page-intro'));
  const items = reports().filter(item => includeTests || !item.simulated); const table = el('table', undefined, 'data-table');
  const caption = el('caption', 'Received reports and signal measurements'); caption.className = 'sr-only'; table.append(caption);
  const head = el('thead'); const hr = el('tr'); for (const title of ['Received', 'Reported place', 'RSSI', 'SNR', 'Receptions']) { const th = el('th', title); th.scope = 'col'; hr.append(th); } head.append(hr); table.append(head); const body = el('tbody');
  for (const item of items) {
    const row = el('tr'); const loc = reportedLocation(item, campusProfile()); const at = el('td'); at.append(button(when(item.receivedAt, true), () => openRequest(item)), el('small', item.simulated ? 'Test report' : 'Radio report'));
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
  for (const item of items) { const b = button('', () => { handoffSelected = item.id; render(); }, `handoff-row${item.id === handoffSelected ? ' selected' : ''}`); b.setAttribute('aria-pressed', String(item.id === handoffSelected)); b.dataset.focus = `handoff-${item.id}`; b.append(el('strong', `${categories[item.request.category] || 'Emergency'} · ${caseLocation(item, campusProfile()).label}`), el('span', `${item.simulated ? 'Test' : 'Radio'} · ${when(item.receivedAt)} · ${coordinationLabel(item)}`)); list.append(b); }
  const pane = el('article', undefined, 'handoff-detail'); const c = selectedItem.coordination; pane.append(el('h2', c.summary?.headline || `${categories[selectedItem.request.category] || 'Emergency'} request`), el('p', `${coordinationLabel(selectedItem)}${selectedItem.simulated ? ' · Test intake' : ''}`, 'status-line'), el('p', selectedItem.request.note || 'No additional note supplied.', 'original original-block'));
  const information = section('Current handoff'); information.append(facts([['Case', c.caseId], ['Local revision', String(c.revision)], ['Supervisor revision', c.sharedRevision ? String(c.sharedRevision) : 'Not acknowledged'], ['Case location', caseLocation(selectedItem, campusProfile()).label]]));
  if (c.summary?.text) information.append(el('p', c.summary.text, 'small')); if (c.error) information.append(el('p', c.error, 'small')); pane.append(information);
  const allocations = allocationsFor(c, { embedded: true }); if (allocations.length) {
    const allocation = section(allocations.length === 1 ? 'Resource allocation' : 'Resource allocations');
    for (const a of allocations) allocation.append(facts([['Supplying town', a.townId || 'Not recorded'], ['Resource', RESOURCE_LABELS[a.resource] || a.resource || 'Not recorded'], ['Planning quantity', resourceUnit(a.resource, a.quantity)], ['Acknowledgment', a.acknowledgedAt ? when(a.acknowledgedAt) : 'Pending']]));
    allocation.append(el('p', 'Reservations are recorded by the regional agent. Planning quantities are separate from the phone’s original selections.', 'fine')); pane.append(allocation);
  }
  if (c.unmetNeeds?.length) pane.append(el('p', `Still needed: ${c.unmetNeeds.map(n => `${RESOURCE_LABELS[n.resource] || n.resource} · ${resourceUnit(n.resource, n.quantity)}`).join('; ')}.`, 'unmet-needs'));
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
  settingsSection('Region and radio', [['Region', state.regionProfile?.id || String(state.region)], ['Hub', state.regionProfile?.hubName || 'ECSW'], ['Frequency', numeric(state.regionProfile?.frequencyMHz || state.link?.board?.frequency, ' MHz')], ['Radio', radioLabel(state.link)], ['Location context', 'Official UT Dallas building geometry. Landmark reports remain approximate.']]);
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
$('simulate').onclick = () => act(async () => { const value = await api('/api/simulate', {}); selected = value.id; $('source').value = 'test'; $('filter').value = 'all'; currentView = 'requests'; notice('Test report received.'); });
$('close-location').onclick = () => $('location-dialog').close();
$('location-form').onsubmit = event => { event.preventDefault(); const id = correctionId; const label = $('location-label').value.trim(); if (!id || !label) return; act(async () => { await api(`/api/incidents/${encodeURIComponent(id)}/location`, { label }); $('location-dialog').close(); correctionId = null; notice('Case location corrected. The original phone report is unchanged.'); }); };
await refresh(); setInterval(refresh, 2500);
