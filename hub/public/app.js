import { selectVisibleReport } from './view-selection.js';

const $ = id => document.getElementById(id);
const categories = { 1: 'Medical', 2: 'Fire', 3: 'Rescue', 4: 'Safety', 5: 'Supplies' };
const priorities = { 1: 'Urgent', 2: 'Serious', 3: 'Assistance' };
let state = null; let selected = null; let csrf = ''; let lastRendered = ''; let busy = false;
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function time(value) { return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Pending'; }
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) };
  const response = await fetch(path, options); const data = await response.json();
  if (!response.ok) { if (response.status === 401) signedOut(); throw new Error(data.error || 'Request failed'); }
  return data;
}
function signedOut() { state = null; $('workspace').hidden = true; $('login-panel').hidden = false; $('logout').hidden = true; }
async function refresh() {
  if (busy) return;
  try {
    const data = await api('/api/state'); state = data; csrf = data.csrf;
    $('workspace').hidden = false; $('login-panel').hidden = true; $('logout').hidden = false;
    const readinessLabels = { 'awaiting-status': 'USB port open · radio unverified', 'status-unavailable': 'USB port open · board status unavailable', 'invalid-status': 'USB port open · invalid board status', 'profile-mismatch': 'USB port open · board profile mismatch; transmission blocked', 'radio-failed': 'USB port open · board reports radio failure', 'port-error': 'USB port error · radio unverified', 'port-closed': 'USB radio disconnected' };
    $('link').textContent = data.link.mode === 'simulation' ? 'Software simulation · no radio connected' : data.link.readiness === 'ready' && data.link.connected ? `Board reports radio ready · ${data.link.board.frequency} MHz` : readinessLabels[data.link.readiness] || 'Radio disconnected';
    $('region').textContent = `Region ${data.region} · key ${data.keyId}`;
    $('model').textContent = data.ai.enabled ? `Local model: ${data.ai.model}` : 'Extractive summaries · local model off';
    $('simulate').hidden = !data.simulation;
    const rendering = JSON.stringify({ incidents: data.incidents, filter: $('filter').value, selected });
    if (rendering !== lastRendered) { render(); lastRendered = rendering; }
  } catch (error) { if (state) showError(`Connection lost: ${error.message}`); }
}
function render() {
  if (!state) return;
  const list = $('incident-list'); list.replaceChildren();
  const view = selectVisibleReport(state.incidents, $('filter').value, selected);
  const { reports, selectedReport: item } = view; selected = view.selectedId;
  $('count').textContent = String(reports.length);
  if (!reports.length) list.append(element('p', 'No reports in this view.', 'queue-empty'));
  for (const item of reports) {
    const button = element('button', undefined, `report${selected === item.id ? ' selected' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(selected === item.id));
    const title = element('div', undefined, 'report-title'); title.append(element('span', categories[item.request.category]), element('span', priorities[item.request.severity], `priority p${item.request.severity}`));
    button.append(title, element('div', `${time(item.receivedAt)} · ${item.request.people} ${item.request.people === 1 ? 'person' : 'people'} · ${item.status === 'operator-reviewed' ? 'Reviewed' : 'Awaiting review'}`, 'report-meta'), element('div', item.request.note || 'No additional note.', 'report-note'));
    button.onclick = () => { selected = item.id; render(); }; list.append(button);
  }
  const root = $('detail'); root.replaceChildren();
  if (!item) {
    const empty = element('div', undefined, 'empty');
    empty.append(element('span', '+', 'cross'), element('h2', state.incidents.length ? 'No reports in this view' : 'Waiting for a report'), element('p', state.incidents.length ? 'Change the filter to see other reports.' : 'Authenticated requests appear here when the hub receives them.'), element('p', 'A received report does not mean emergency services were contacted.', 'muted'));
    empty.firstElementChild.setAttribute('aria-hidden', 'true'); root.append(empty); return;
  }
  const top = element('div', undefined, 'detail-top'); top.append(element('span', item.id, 'id'), element('span', `USER-REPORTED ${priorities[item.request.severity].toUpperCase()}`, `priority p${item.request.severity}`)); root.append(top);
  const heading = element('h2', `${categories[item.request.category]} request`); if (item.simulated) heading.append(element('span', 'TEST REPORT', 'simulated')); root.append(heading, element('p', `${item.status === 'operator-reviewed' ? 'Reviewed by demo operator' : 'Received by hub · awaiting operator review'}. No services dispatched.`, 'detail-sub'));
  const original = section('Original report'); original.append(element('p', item.request.note || 'No additional note supplied.', 'original')); root.append(original);
  const details = section('Reported details'); const facts = element('dl', undefined, 'facts');
  const fact = (label, value, className) => { const group = element('div'); group.append(element('dt', label), element('dd', value, className)); facts.append(group); };
  fact('People', String(item.request.people));
  fact('Concerns', [item.request.flags & 2 ? 'Breathing concern' : '', item.request.flags & 4 ? 'Trapped' : '', item.request.flags & 8 ? 'Severe bleeding' : ''].filter(Boolean).join(' · ') || 'None selected');
  fact('Location', item.request.flags & 1 ? `${item.request.latitude.toFixed(5)}, ${item.request.longitude.toFixed(5)}` : 'Unknown', 'location');
  fact('Location accuracy', item.request.accuracy === 65535 ? 'Unknown' : `${item.request.accuracy} m`);
  fact('Report created', new Date(item.request.createdAt * 1000).toLocaleString());
  fact('Phone battery', item.request.battery === 255 ? 'Unknown' : `${item.request.battery}%`);
  fact('Radio reception', item.radio.rssi === null ? 'Unknown' : `${item.radio.rssi} dBm · SNR ${item.radio.snr ?? '?'} dB`);
  fact('Receptions', `${item.receptions} · last ${time(item.lastReceivedAt)}`); details.append(facts); root.append(details);
  const summary = section(item.summary.source === 'local-model' ? 'Local AI selection · original report authoritative' : 'Extractive summary'); summary.append(element('p', item.summary.text, 'summary-text'), element('p', item.summary.source === 'local-model' ? `${item.summary.model} selected verified note spans. Structured fields come directly from the report. Selection may omit useful detail; review the full original.` : item.summary.error || 'Assembled directly from the reported fields. No model inference.', 'summary-source')); root.append(summary);
  const receipt = section('Receipt trail'); const timeline = element('div', undefined, 'timeline');
  for (const [name, value] of [['Hub received', item.receivedAt], ['Operator reviewed', item.reviewedAt]]) { const step = element('div'); step.append(element('strong', name), element('time', time(value))); timeline.append(step); }
  receipt.append(timeline, element('p', item.lastTransmission?.state === 'submitted-to-radio' ? 'Receipt submitted to the transport. Phone delivery is unconfirmed.' : 'Receipt transmission failed or is unavailable. The report remains saved.', 'receipt-state'));
  const actions = element('div', undefined, 'actions');
  const review = element('button', item.status === 'operator-reviewed' ? 'Resend reviewed receipt' : 'Mark reviewed', 'primary'); review.type = 'button'; review.onclick = () => act(async () => { await api(`/api/incidents/${item.id}/review`, {}); $('notice').textContent = 'Operator review saved. No services dispatched.'; });
  const download = element('button', 'Export demo handoff'); download.type = 'button'; download.disabled = item.status !== 'operator-reviewed'; download.onclick = () => act(async () => { const payload = await api(`/api/incidents/${item.id}/export`, {}); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })); link.download = `SIMULATION-${item.id.replaceAll(':', '-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); });
  actions.append(review, download); receipt.append(actions); root.append(receipt);
}
function section(title) { const node = element('section', undefined, 'section'); node.append(element('h3', title)); return node; }
async function act(action) { if (busy) return; busy = true; showError(''); try { await action(); } catch (error) { showError(error.message); } finally { busy = false; lastRendered = ''; await refresh(); } }
$('login-form').onsubmit = event => { event.preventDefault(); act(async () => { await api('/api/login', { token: $('token').value.trim() }); $('token').value = ''; }); };
$('logout').onclick = () => act(async () => { await api('/api/logout', {}); signedOut(); });
$('simulate').onclick = () => act(async () => { const value = await api('/api/simulate', {}); selected = value.id; $('notice').textContent = 'Synthetic test report received through the encrypted hub pipeline.'; });
$('filter').onchange = () => render();
await refresh(); setInterval(refresh, 2500);
