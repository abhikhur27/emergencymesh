import { regionalMetrics, allocationsFor, needsFor, supplySelections, RESOURCE_LABELS, CATEGORY_LABELS, resourceUnit, timestamp } from './ops-metrics.js';
import { agentMessages, filterAgentMessages, AGENT_NAMES, AGENT_CHANNELS } from './agent-conversation.js';

export async function startInterface({ HUB_LOCATIONS, selectedFlow, selectedFlows }) {
  const R = window.RM, e = R.el, $ = selector => document.querySelector(selector);
  const append = (node, ...children) => { children.filter(Boolean).forEach(child => node.append(child)); return node; };
  const names = Object.fromEntries(Object.entries(HUB_LOCATIONS).map(([id, place]) => [id, place.name]));
  const priorities = ['', 'Urgent', 'Serious', 'Assistance'];
  const statusNames = { received: 'Request saved', planning: 'Finding resources', allocated: 'Awaiting acknowledgment', 'simulated-dispatched': 'Handoff recorded', 'needs-review': 'Needs attention', partial: 'Partially allocated', paused: 'Coordination paused' };
  const actionNames = { case_received: 'Request received', case_updated: 'Source updated', validate_case: 'Source fields checked', resource_catalog: 'Resource catalog read', lookup_resources: 'Agent queried resources', propose_allocation: 'Agent proposed an allocation', resource_allocated: 'Resources reserved', simulated_dispatch: 'Handoff recorded', dispatch_pending: 'Acknowledgment pending', allocation_exception: 'Allocation needs attention', processing_failed: 'Processing needs attention', operator_alternate: 'Alternate selected', operator_pending: 'Kept pending', automation_paused: 'Coordination paused', automation_resumed: 'Coordination resumed', simulation_start: 'Town intake started', simulation_pause: 'Town intake paused', simulation_step: 'Town request added', simulation_reset: 'Town exercise reset', simulation_cycle: 'New exercise cycle' };
  const actionDescriptions = { case_received: 'Source request saved before coordination.', case_updated: 'A source-preserving revision arrived.', validate_case: 'Checked required fields and source information.', resource_catalog: 'Read the current resource catalog.', lookup_resources: 'Retrieved inventory for the requested resource.', propose_allocation: 'Checked the proposal against quantity and stock.', resource_allocated: 'Reserved eligible resources once.', simulated_dispatch: 'The exercise service adapter acknowledged this handoff.', dispatch_pending: 'The reservation is saved while acknowledgment is pending.', allocation_exception: 'No eligible allocation is available.', processing_failed: 'The saved request needs an operator.', operator_alternate: 'An operator selected an eligible alternative.', operator_pending: 'The request remains in the attention queue.', simulation_cycle: 'Started a fresh town intake cycle.' };
  const questionStatus = { 'queued-to-local-hub': 'Queued for ECSW', queued: 'Queued at ECSW', 'submitted-to-radio': 'Submitted to radio · delivery unconfirmed', answered: 'Answer received', unconfirmed: 'Delivery unconfirmed', closing: 'Closing through ECSW', closed: 'Closed', blocked: 'Blocked at source hub' };
  const iconFor = resource => ({ medicine: 'medicine', medical: 'medical', water: 'water', food: 'food', power: 'power', fire: 'fire', rescue: 'shield', safety: 'shield', supplies: 'food' })[resource] || 'shield';
  const categoryIcon = category => ({ 1: 'medical', 2: 'fire', 3: 'shield', 4: 'shield', 5: 'food', 6: 'water', 7: 'activity', 8: 'shield' })[category] || 'shield';
  const attention = item => ['needs-review', 'partial'].includes(item.status);
  const recorded = item => item.status === 'simulated-dispatched';
  const clock = at => timestamp(at) === null ? 'Time not recorded' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const resourceName = resource => RESOURCE_LABELS[resource] || resource;
  const shortId = item => String(item.source?.requestId || item.caseId || '').slice(-16);
  const location = item => item.location?.label || (item.location?.kind === 'gps' && Number.isFinite(item.location.latitude) && Number.isFinite(item.location.longitude) ? `${item.location.latitude.toFixed(5)}, ${item.location.longitude.toFixed(5)}` : 'Location not supplied');
  let state = null, csrf = '', selectedId = null, selectedResource = null, source = 'all', statusFilter = 'all', severity = 'all', query = '', activeTab = 'handoffs', pageSize = 30, fetching = false, mutating = false, signature = '', detailSignature = '', noticeTimer;
  const alternateChoices = new Map(), questionDrafts = new Map();
  let conversationChannel = 'all', conversationCaseId = null, conversationLimit = 60, conversationSignature = '', conversationShown = new Set(), conversationCases = new Set();

  function announce(text, error = false) {
    const node = $('#notice'); node.textContent = text; node.className = `notice${error ? ' error' : ''}`; node.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { node.hidden = true; }, 5500);
  }
  function showLogin() { state = null; csrf = ''; signature = ''; detailSignature = ''; $('#application').hidden = true; $('#login').hidden = false; }
  async function request(path, { method = 'GET', body } = {}) {
    let response;
    try { response = await fetch(path, { method, credentials: 'same-origin', headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new Error('The regional workspace is unavailable. Check the connection and try again.'); }
    let data; try { data = await response.json(); } catch { throw new Error('The regional workspace returned an unreadable response.'); }
    if (!response.ok) { if (response.status === 401) showLogin(); const error = new Error(data.error || 'The request could not be completed.'); error.status = response.status; throw error; }
    return data;
  }
  async function refresh(force = false) {
    if (fetching) return; fetching = true;
    try {
      const next = await request('/api/state'); state = next; csrf = next.csrf;
      $('#login').hidden = true; $('#application').hidden = false; $('#connection').textContent = 'Connected'; $('#connection').classList.remove('stale');
      const nextSignature = JSON.stringify([next.cases, next.events.at(-1)?.seq, next.automationPaused, next.simulation, next.hubs, next.model, next.database]);
      if (force || nextSignature !== signature) { signature = nextSignature; render(); }
    } catch (error) {
      if (state) { $('#connection').textContent = 'Reconnecting'; $('#connection').classList.add('stale'); }
      else { showLogin(); if (error.status !== 401) $('#login-error').textContent = error.message; }
    } finally { fetching = false; }
  }
  async function change(path, body, message, button) {
    if (mutating) return null; mutating = true; if (button) button.disabled = true;
    try { const result = await request(path, { method: 'POST', body }); if (message) announce(message); await refresh(true); return result; }
    catch (error) { announce(error.message, true); return null; }
    finally { mutating = false; if (button?.isConnected) button.disabled = false; if (state) { renderExercise(); updateQuestionButton(); } }
  }
  function preserveFocus(action) {
    const active = document.activeElement, key = active?.dataset?.focusKey;
    const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    action();
    if (!key) return;
    const next = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`); next?.focus({ preventScroll: true });
    if (selection && typeof next?.setSelectionRange === 'function') next.setSelectionRange(...selection);
  }
  function setTab(tab) {
    activeTab = tab;
    for (const button of document.querySelectorAll('[data-tab]')) { if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
    for (const panel of document.querySelectorAll('.view-panel')) panel.hidden = panel.id !== `${tab}-panel`;
    if (tab === 'conversation' && state) renderAgentConversation(true);
  }
  function visibleCases() {
    const needle = query.trim().toLowerCase();
    return state.cases.filter(item => !item.archived && (source === 'all' || item.hubId === source) && (severity === 'all' || item.request.severity === severity) && (statusFilter === 'all' || statusFilter === 'attention' && attention(item) || statusFilter === 'recorded' && recorded(item) || statusFilter === 'open' && !recorded(item)) && (!needle || `${item.caseId} ${shortId(item)} ${CATEGORY_LABELS[item.request.category]} ${names[item.hubId] || item.hubId} ${location(item)} ${item.request.note || ''}`.toLowerCase().includes(needle)));
  }
  function setSource(value) { source = value; $('#source-filter').value = value; pageSize = 30; render(); }
  function clearFilters() { source = 'all'; statusFilter = 'all'; severity = 'all'; query = ''; pageSize = 30; $('#source-filter').value = 'all'; $('#status-filter').value = 'all'; $('#case-search').value = ''; render(); }
  function selectCase(id, keyboard = false) {
    if (selectedId !== id) selectedResource = null; selectedId = id; detailSignature = '';
    setTab('handoffs'); renderCases(); renderDetail();
    if (keyboard) document.querySelector(`[data-focus-key="case-${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    else if (window.innerWidth < 720) $('#case-detail').scrollIntoView({ block: 'start' });
  }
  function render() {
    const list = visibleCases(); if (!list.some(item => item.caseId === selectedId)) { selectedId = list.find(attention)?.caseId || list[0]?.caseId || null; selectedResource = null; detailSignature = ''; }
    $('#pause').textContent = state.automationPaused ? 'Resume coordination' : 'Pause coordination'; $('#automation-status').textContent = state.automationPaused ? 'Coordination paused' : 'Coordination active'; $('.automation').classList.toggle('paused', state.automationPaused);
    $('#display-scope').textContent = severity === 'all' ? 'North Texas' : `${priorities[severity]} reports`;
    $('#clear-filters').hidden = source === 'all' && statusFilter === 'all' && severity === 'all' && !query;
    renderOperations(); renderCases(); renderDetail(); renderHubs(); renderHistory(); renderExercise(); renderSystem(); if (activeTab === 'conversation') renderAgentConversation();
  }
  function renderOperations() {
    const metrics = regionalMetrics(state), retained = state.cases.filter(item => !item.archived), node = $('#operations-overview');
    preserveFocus(() => {
      node.replaceChildren(R.dispatchSummary({ priorities: [1, 2, 3].map(value => ({ label: priorities[value], count: metrics.priorities[value - 1] })), people: retained.reduce((sum, item) => sum + item.request.people, 0), attention: metrics.needsAttention, selectedPriority: severity === 'all' ? 'all' : priorities[severity], scope: `${metrics.requests} retained requests`, onPriority: (value, label) => { severity = value === 'all' ? 'all' : priorities.indexOf(value); source = 'all'; statusFilter = 'all'; query = ''; $('#source-filter').value = 'all'; $('#status-filter').value = 'all'; $('#case-search').value = ''; render(); node.querySelector(`[data-priority="${CSS.escape(label)}"]`)?.focus({ preventScroll: true }); }, onAttention: () => { severity = 'all'; source = 'all'; statusFilter = 'attention'; query = ''; $('#source-filter').value = 'all'; $('#status-filter').value = 'attention'; $('#case-search').value = ''; render(); node.querySelector('.dispatch-attention')?.focus({ preventScroll: true }); } }));
      node.append(e('p', 'production-metric-scope', `${metrics.physical} radio-source · ${metrics.generated} town exercise requests · people are summed across reports, not unique individuals`));
    });
  }
  function renderCases() {
    const list = visibleCases(), node = $('#case-list'); $('#request-count').textContent = `${list.length} ${list.length === 1 ? 'request' : 'requests'}`; $('#more-requests').hidden = list.length <= pageSize;
    preserveFocus(() => {
      node.replaceChildren();
      if (!list.length) { node.append(append(e('div', 'empty-state regional-queue-empty'), R.icon('search'), e('h2', '', state.cases.length ? 'No matching requests' : 'No requests yet'), e('p', 'muted', state.cases.length ? 'Choose another hub, status or priority.' : 'Saved ECSW reports and town intake will appear here.'))); return; }
      for (const item of list.slice(0, pageSize)) {
        const button = e('button', `regional-case-row${item.caseId === selectedId ? ' is-selected' : ''}`); button.type = 'button'; button.dataset.focusKey = `case-${item.caseId}`; button.setAttribute('aria-pressed', String(item.caseId === selectedId));
        button.setAttribute('aria-label', `${names[item.hubId] || item.hubId}, ${CATEGORY_LABELS[item.request.category]} request, ${priorities[item.request.severity]}, ${statusNames[item.status] || item.status}`);
        append(button, append(e('div', 'regional-row-head'), e('span', 'regional-row-hub', names[item.hubId] || item.hubId), e('time', 'caption', clock(item.createdAt))), append(e('div', 'regional-row-title'), R.icon(categoryIcon(item.request.category)), e('strong', '', `${CATEGORY_LABELS[item.request.category] || 'Emergency'} · ${location(item)}`)), e('div', `regional-row-foot regional-priority ${item.request.severity === 1 ? 'is-urgent' : ''}`, `${priorities[item.request.severity]} · ${item.request.people} ${item.request.people === 1 ? 'person' : 'people'}`), e('span', `regional-row-status${attention(item) ? ' is-attention' : ''}`, statusNames[item.status] || item.status));
        button.addEventListener('click', event => selectCase(item.caseId, event.detail === 0)); node.append(button);
      }
    });
  }
  function sourceFact(icon, label, value) { return append(e('div', 'regional-source-fact'), R.icon(icon), append(e('div'), e('span', 'caption', label), e('strong', '', value))); }
  function safeReason(item) { return item.reason || statusNames[item.status] || 'Request saved'; }
  function sourceAttribution(item) {
    const agent = item.sourceAgent;
    if (item.source?.kind !== 'radio') return item.generation?.source === 'nemotron' ? `Town exercise wording generated by ${item.generation.model || 'the regional model'}.` : 'Town exercise source · generation attribution is not recorded.';
    if (agent?.source === 'signal') return 'Typed fields read directly from the phone signal. No summary was needed.';
    if (agent?.source === 'local-model') return `Prepared with ${agent.model || 'the recorded local model'}. Original fields stay authoritative.`;
    if (agent?.source === 'local-rules' || agent?.source === 'local-rules-fallback') return 'Prepared with source-preserving local rules.';
    return 'Original source fields retained. Processing attribution was not recorded for this case.';
  }
  function renderDetail() {
    const area = $('#case-detail'), item = state.cases.find(value => value.caseId === selectedId), nextSignature = item ? JSON.stringify([item, selectedResource]) : `empty-${source}-${statusFilter}-${severity}-${query}`;
    if (nextSignature === detailSignature) return; detailSignature = nextSignature;
    const open = item?.caseId === area.dataset.caseId ? new Set([...area.querySelectorAll('details[open]')].map(node => node.dataset.section)) : new Set();
    area.dataset.caseId = item?.caseId || '';
    preserveFocus(() => {
      area.replaceChildren();
      if (!item) { area.append(append(e('section', 'panel empty-state'), e('h2', '', 'Select a request'), e('p', 'muted', 'Its original fields, handoff and source exchange will appear here.'))); return; }
      const layout = e('div', 'regional-detail-layout'), content = e('div', 'regional-case-content'), aside = e('aside', 'regional-context');
      const sourcePanel = e('article', 'panel regional-source-panel');
      append(sourcePanel, append(e('div', 'regional-detail-heading'), append(e('div'), e('h2', '', `${CATEGORY_LABELS[item.request.category] || 'Emergency'} request`), e('p', 'caption', `${names[item.hubId] || item.hubId} · ${shortId(item)} · ${clock(item.createdAt)}`)), R.pill(statusNames[item.status] || item.status, attention(item) ? 'warning' : recorded(item) ? 'green' : 'neutral')));
      append(sourcePanel, append(e('div', 'regional-source-grid'), sourceFact(categoryIcon(item.request.category), 'Danger reported', CATEGORY_LABELS[item.request.category] || 'Unknown'), sourceFact('people', 'People reported', String(item.request.people)), sourceFact('activity', 'Priority reported', priorities[item.request.severity]), sourceFact('pin', 'Location', location(item))));
      const selections = supplySelections(item.request);
      if (selections.length) { const supplies = append(e('div', 'regional-reported-supplies'), e('span', 'caption', 'Supplies requested')), values = e('div', 'regional-supply-values'); for (const resource of selections) values.append(append(e('span'), R.icon(iconFor(resource)), e('span', '', resourceName(resource)))); supplies.append(values); sourcePanel.append(supplies); }
      sourcePanel.append(e('p', 'regional-source-note', item.request.note || 'No additional note was supplied.'));
      const provenance = e('details', 'regional-source-provenance'); provenance.dataset.section = 'source'; provenance.open = open.has('source'); provenance.append(e('summary', '', 'Source details'), e('p', '', sourceAttribution(item)), e('p', '', `Revision ${item.revision} · ${item.location?.kind === 'gps' ? `Phone GPS${item.location.accuracy < 65535 ? ` · ±${Math.round(item.location.accuracy)} m` : ''} · not independently verified` : item.location?.kind === 'landmark' ? 'Landmark from the source hub · approximate' : 'No GPS or usable landmark'}`)); sourcePanel.append(provenance); content.append(sourcePanel);
      if (attention(item)) content.append(renderAttention(item));
      content.append(renderPlan(item, open));
      if (item.source?.kind === 'radio') content.append(renderConversation(item));
      aside.append(renderExchange(item, open), renderMap(item));
      append(layout, content, aside); area.append(layout);
      // The first resource is chosen while constructing the plan. Keep that
      // selection in the render signature so a background poll doesn't rebuild
      // an unchanged street map merely to select the same resource again.
      detailSignature = JSON.stringify([item, selectedResource]);
    });
  }
  function renderAttention(item) {
    return append(e('section', 'panel regional-attention-panel'), R.icon(item.location?.kind === 'unknown' ? 'pin' : 'activity'), append(e('div'), e('h3', '', item.location?.kind === 'unknown' ? 'A location is needed' : 'A resource needs attention'), e('p', 'muted', safeReason(item))));
  }
  function renderPlan(item, open) {
    const panel = e('section', 'panel regional-plan'), allocations = allocationsFor(item), plan = needsFor(item);
    const rows = e('div', 'regional-needs');
    if (!plan.some(need => need.resource === selectedResource)) selectedResource = plan[0]?.resource || selectedFlow(item)?.resource || null;
    append(panel, append(e('div', 'panel-heading'), e('h3', '', 'Resource handoff'), e('span', 'caption', `${allocations.length} of ${Math.max(allocations.length, plan.length)} reserved`)));
    for (const need of plan) {
      const allocation = allocations.find(value => value.resource === need.resource), acknowledged = allocation && (allocation.acknowledgment || timestamp(allocation.acknowledgedAt) !== null), row = e('button', `regional-need-row${need.resource === selectedResource ? ' is-selected' : ''}`); row.type = 'button'; row.dataset.focusKey = `resource-${need.resource}`; row.setAttribute('aria-pressed', String(need.resource === selectedResource)); row.setAttribute('aria-label', `Show ${resourceName(need.resource)} handoff on map`);
      append(row, append(e('span', 'regional-resource-icon'), R.icon(iconFor(need.resource))), append(e('span', 'regional-need-description'), e('strong', '', resourceName(need.resource)), e('span', 'caption', `${resourceUnit(need.resource, need.quantity)} · policy quantity`)), append(e('span', 'regional-need-outcome'), e('strong', '', allocation ? names[allocation.townId] || allocation.townId : 'Still needed'), e('span', 'caption', allocation ? acknowledged ? 'Acknowledged' : 'Awaiting acknowledgment' : 'No reservation')), R.icon('chevron'));
      row.addEventListener('click', event => { const keyboard = event.detail === 0; selectedResource = need.resource; detailSignature = ''; renderDetail(); if (keyboard) document.querySelector(`[data-focus-key="resource-${CSS.escape(need.resource)}"]`)?.focus({ preventScroll: true }); }); rows.append(row);
    }
    panel.append(rows);
    if (!plan.length) panel.append(e('p', 'muted', 'The resource plan has not been recorded yet. The source request remains saved.'));
    if (attention(item)) renderException(panel, item, plan, allocations);
    const note = e('details', 'regional-plan-footnote'); note.dataset.section = 'quantity'; note.open = open.has('quantity'); note.append(e('summary', '', 'About planning quantities'), e('p', '', 'Quantities come from validated resource policy, not an amount reported by the phone. A reservation is not confirmation that responders are en route.')); panel.append(note); return panel;
  }
  function renderException(panel, item, plan, allocations) {
    const needed = plan.find(value => !allocations.some(allocation => allocation.resource === value.resource));
    const controls = e('div', 'regional-alternate');
    if (needed && item.location?.kind !== 'unknown') {
      const field = e('label', 'caption', `Alternate for ${resourceName(needed.resource).toLowerCase()}`), select = e('select'); select.dataset.focusKey = `alternate-${item.caseId}`; select.setAttribute('aria-label', `Choose an alternate hub for ${resourceName(needed.resource).toLowerCase()}`); select.append(new Option('Choose an alternate hub', ''));
      const eligible = state.hubs.filter(hub => hub.simulated && hub.id !== item.hubId && (hub.resources?.[needed.resource] ?? 0) >= needed.quantity);
      for (const hub of eligible) select.append(new Option(`${hub.name} · ${hub.resources[needed.resource]} available`, hub.id)); select.value = alternateChoices.get(item.caseId) || ''; select.addEventListener('change', () => { alternateChoices.set(item.caseId, select.value); submit.disabled = !select.value || mutating; }); field.append(select); controls.append(field);
      const submit = R.button('Use alternate', 'secondary', () => { if (!select.value) return announce('Choose an eligible hub first.', true); change(`/api/cases/${encodeURIComponent(item.caseId)}/resolve`, { action: 'alternate', townId: select.value }, 'Alternate saved. Coordination will continue.', submit); }); submit.disabled = !select.value || mutating;
      if (eligible.length) controls.append(submit); else controls.append(e('p', 'muted', 'No other town currently has enough available stock.'));
    }
    const retry = R.button('Retry coordination', 'secondary', () => change(`/api/cases/${encodeURIComponent(item.caseId)}/resolve`, { action: 'retry' }, 'Coordination retried.', retry)); retry.disabled = mutating; controls.append(retry); panel.append(controls);
  }
  function regionalModelLabel(item) {
    const agents = allocationsFor(item).map(value => value.agent).filter(Boolean); if (!agents.length && item.agent) agents.push(item.agent);
    const native = agents.find(agent => agent.source === 'nemotron-tools');
    if (native) return `${native.model || 'Recorded model'} · used`;
    if (agents.some(agent => agent.source === 'rules-fallback')) return 'Resource policy fallback used';
    return state.model?.model ? `${state.model.model} · configured` : 'Resource policy';
  }
  function renderExchange(item, open) {
    const panel = e('section', 'panel regional-exchange-panel'), sourceAgent = item.sourceAgent;
    const localLabel = item.source?.kind !== 'radio' ? item.generation?.source === 'nemotron' ? `${item.generation.model || 'Regional model'} · generated` : 'Seeded exercise intake' : sourceAgent?.source === 'local-model' ? `${sourceAgent.model || 'Local model'} · used` : sourceAgent?.configuredModel ? `${sourceAgent.configuredModel} · configured` : 'Local model not recorded';
    panel.append(e('h3', '', 'Agent exchange'));
    panel.append(append(e('div', 'regional-agent-route'), append(e('div'), e('strong', '', `${names[item.hubId] || item.hubId} hub`), e('span', 'caption', localLabel)), append(e('div', 'regional-agent-bridge'), R.icon('arrow')), append(e('div'), e('strong', '', 'Regional agent'), e('span', 'caption', regionalModelLabel(item)))));
    const received = item.events?.find(event => event.action === 'case_received');
    panel.append(append(e('p', 'regional-delivery-state'), R.icon('check'), e('span', '', received ? `Source saved by regional desk · ${clock(received.at)}` : 'Source saved by regional desk')));
    if (item.sourceAgent?.source === 'signal') panel.append(e('p', 'caption production-signal-mode', 'Typed signal used directly · no local inference needed'));
    const conversation = R.button('Open agent conversation', 'secondary regional-conversation-link', () => openAgentConversation(item.caseId)); conversation.dataset.focusKey = `conversation-${item.caseId}`; panel.append(conversation);
    const details = e('details', 'regional-agent-log'); details.dataset.section = 'activity'; details.open = open.has('activity'); const summary = e('summary', '', `See ${item.events?.length || 0} saved agent steps`); summary.dataset.focusKey = `activity-${item.caseId}`; details.append(summary, timeline(item.events || []));
    panel.append(details); return panel;
  }
  function openAgentConversation(caseId = null) {
    conversationCaseId = caseId; conversationChannel = 'all'; conversationLimit = 60; conversationSignature = ''; setTab('conversation');
  }
  function renderAgentConversation(force = false) {
    const channels = $('#conversation-channels'), viewport = $('#agent-conversation-scroll'), list = $('#agent-conversation-list');
    if (conversationCaseId && !state.cases.some(item => item.caseId === conversationCaseId)) { conversationCaseId = null; force = true; }
    const selectedCase = state.cases.find(item => item.caseId === conversationCaseId), scope = conversationCaseId ? { ...state, cases: selectedCase ? [selectedCase] : [] } : state;
    const all = agentMessages(scope), messages = filterAgentMessages(all, { channel: conversationChannel, caseId: conversationCaseId });
    const visible = messages.slice(-conversationLimit), nextSignature = JSON.stringify(visible), currentCases = new Set(state.cases.map(item => item.caseId));
    const removed = [...conversationCases].some(id => !currentCases.has(id));
    const nearEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
    const pending = messages.filter(message => !conversationShown.has(message.id)).length;
    $('#conversation-title').textContent = conversationChannel === 'all' ? 'All hub exchanges' : AGENT_NAMES[conversationChannel];
    $('#conversation-scope').textContent = selectedCase ? `${names[selectedCase.hubId]} · ${CATEGORY_LABELS[selectedCase.request.category] || 'Emergency'} · ${shortId(selectedCase)}` : 'Recent saved exchanges across requests';
    $('#conversation-clear-case').hidden = !conversationCaseId;
    $('#conversation-older').hidden = messages.length <= conversationLimit;
    preserveFocus(() => {
      channels.replaceChildren();
      for (const channel of AGENT_CHANNELS) {
        const count = filterAgentMessages(all, { channel }).length;
        const button = R.button('', 'agent-channel' + (conversationChannel === channel ? ' is-selected' : ''), () => { conversationChannel = channel; conversationLimit = 60; conversationSignature = ''; renderAgentConversation(true); });
        button.dataset.focusKey = `agent-channel-${channel}`; button.setAttribute('aria-pressed', String(conversationChannel === channel));
        button.append(e('strong', '', channel === 'all' ? 'All hubs' : AGENT_NAMES[channel]), e('span', '', channel === 'all' ? `${count} saved messages` : channel === 'supervisor' ? 'Regional model and resource policy' : channel === 'ecsw' ? 'Physical radio hub' : 'Town exercise hub'));
        channels.append(button);
      }
    });
    if (nextSignature === conversationSignature) return;
    if (!force && !removed && conversationSignature && !nearEnd) {
      $('#conversation-latest').hidden = false; $('#conversation-latest').textContent = pending ? `Show ${pending} new ${pending === 1 ? 'message' : 'messages'}` : 'Refresh conversation'; return;
    }
    const previousTop = viewport.scrollTop;
    preserveFocus(() => {
      list.replaceChildren();
      if (!visible.length) list.append(append(e('li', 'agent-empty'), e('h2', '', 'No saved exchanges yet'), e('p', 'muted', 'Requests and resource replies involving this hub will appear here.')));
      for (const message of visible) {
        const row = e('li', `agent-message-row${message.actor === 'supervisor' ? ' is-supervisor' : ''}`), bubble = e('article', 'agent-message'); bubble.dataset.messageId = message.id;
        const actor = e('div', 'agent-message-actor'); actor.append(e('strong', '', AGENT_NAMES[message.actor]), e('span', '', message.recipients.length ? `to ${message.recipients.map(id => AGENT_NAMES[id]).join(', ')}` : ''));
        const stamp = e('time', 'agent-message-time', clock(message.at)); stamp.dateTime = new Date(message.at).toISOString();
        const head = append(e('header'), actor, stamp); bubble.append(head, e('div', 'agent-message-kind', message.kind), e('p', 'agent-message-text', message.text));
        const foot = e('footer'); foot.append(e('span', 'agent-message-source', message.source));
        const requestLink = R.button('Open request', 'quiet agent-request-link', () => { clearFilters(); selectCase(message.caseId, true); }); requestLink.dataset.focusKey = `message-request-${message.id}`; requestLink.setAttribute('aria-label', `Open request ${message.caseId}`); foot.append(requestLink); bubble.append(foot); row.append(bubble); list.append(row);
      }
    });
    conversationSignature = nextSignature; conversationShown = new Set(messages.map(message => message.id)); conversationCases = new Set(visible.map(message => message.caseId)); $('#conversation-latest').hidden = true;
    if (force || nearEnd) requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; }); else viewport.scrollTop = previousTop;
  }
  function renderMap(item) {
    const panel = e('section', 'panel regional-map-panel'), flow = selectedResource ? selectedFlows(item).find(value => value.resource === selectedResource) || null : selectedFlow(item);
    append(panel, append(e('div', 'panel-heading'), e('h3', '', 'Between hubs'), R.icon('globe')));
    panel.append(R.regionalMap({ requestTown: item.hubId, supplierTown: flow?.source || null, resource: selectedResource ? resourceName(selectedResource) : 'Resource handoff', recorded: flow?.phase === 'recorded', onSelect: town => setSource(source === town ? 'all' : town) }));
    panel.append(e('strong', 'regional-map-relation', flow ? `${names[flow.source]} to ${names[flow.target]}` : `Request at ${names[item.hubId] || item.hubId}`));
    panel.append(e('p', 'caption', flow ? `${resourceUnit(flow.resource, flow.quantity)} · ${flow.phase === 'recorded' ? 'handoff acknowledged' : 'acknowledgment pending'}` : 'No saved allocation for this selection')); return panel;
  }
  function isOpenQuestion(question) { return !['answered', 'closed', 'blocked'].includes(question.status); }
  function canAsk(item) { return item.source?.kind === 'radio' && item.hubId === 'ecsw' && item.canContactUser === true && !(item.followups || []).some(isOpenQuestion) && (item.followups || []).length < 12; }
  function questionBytes(text) { return new TextEncoder().encode(text.trim()).length; }
  function updateQuestionButton() {
    const item = state?.cases.find(value => value.caseId === selectedId), field = $('#followup-text'), button = $('#ask-user'); if (!item || !field || !button) return;
    const text = field.value.trim(), bytes = questionBytes(text); button.disabled = mutating || !canAsk(item) || !text || bytes > 66 || /[\u0000-\u001f\u007f]/u.test(text); $('#question-bytes').textContent = `${bytes} of 66 bytes`; $('#question-bytes').classList.toggle('is-over-limit', bytes > 66);
  }
  function renderConversation(item) {
    const panel = e('section', 'panel production-conversation'); panel.append(append(e('div', 'panel-heading'), e('h3', '', 'Contact the person'), e('span', 'caption', 'Through ECSW radio')));
    const messages = item.followups || [];
    for (const question of messages) {
      const message = e('article', 'production-message');
      message.tabIndex = -1; message.dataset.focusKey = `message-${question.id}`;
      message.append(append(e('div', 'production-message-meta'), e('strong', '', question.source === 'regional' ? 'Regional operator' : 'ECSW operator'), e('time', '', clock(question.createdAt))), e('p', '', question.text), e('span', 'caption', questionStatus[question.status] || 'Status not recorded'));
      if (question.reason) message.append(e('p', 'caption', question.reason));
      if (question.answer) {
        const answer = e('div', 'production-answer'); answer.append(append(e('div', 'production-message-meta'), e('strong', '', 'Phone reply'), e('time', '', clock(question.answer.receivedAt))), e('p', '', question.answer.text));
        const gps = question.answer.location;
        if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) answer.append(e('p', 'caption', `Reply GPS: ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} · ±${Math.round(gps.accuracy)} m · original report unchanged`)); message.append(answer);
      }
      panel.append(message);
    }
    if (!canAsk(item)) {
      const reason = messages.some(isOpenQuestion) ? 'One question is already waiting for a reply. Its status updates here automatically.' : item.canContactUser !== true ? 'This phone has not advertised support for replies yet. The updated app must connect to ECSW before a question can be sent.' : 'This conversation has reached its message limit.';
      panel.append(e('p', 'production-contact-help muted', reason)); return panel;
    }
    const form = e('form', 'production-question-form'), label = e('label', 'field'); label.htmlFor = 'followup-text'; label.append(e('span', '', 'Ask a short question'));
    const input = e('textarea'); input.id = 'followup-text'; input.dataset.focusKey = `question-${item.caseId}`; input.rows = 2; input.maxLength = 66; input.placeholder = 'Which entrance are you near?'; input.value = questionDrafts.get(item.caseId) || ''; input.autocomplete = 'off'; label.append(input);
    const foot = e('div', 'production-question-actions'), counter = e('span', 'caption'); counter.id = 'question-bytes'; counter.textContent = `${questionBytes(input.value)} of 66 bytes`;
    const submit = R.button('Send through ECSW', 'primary', () => {}, 'radio'); submit.id = 'ask-user'; submit.type = 'submit'; submit.disabled = mutating || !input.value.trim() || questionBytes(input.value) > 66; foot.append(counter, submit);
    input.addEventListener('input', () => { questionDrafts.set(item.caseId, input.value); updateQuestionButton(); });
    form.addEventListener('submit', async event => { event.preventDefault(); const current = state.cases.find(value => value.caseId === item.caseId), text = input.value.trim(); if (!current || !canAsk(current) || !text || questionBytes(text) > 66 || /[\u0000-\u001f\u007f]/u.test(text)) return;
      const result = await change(`/api/cases/${encodeURIComponent(item.caseId)}/questions`, { text }, 'Question queued through ECSW. Radio submission does not confirm phone delivery.', submit);
      if (result) {
        // A state poll can already be in flight. Reflect the server's canonical
        // accepted question immediately instead of briefly offering a second ask.
        const saved = state?.cases.find(value => value.caseId === item.caseId);
        if (saved && result.question && !(saved.followups || []).some(question => question.id === result.question.id)) {
          saved.followups = [...(saved.followups || []), result.question];
        }
        questionDrafts.delete(item.caseId); detailSignature = ''; renderDetail();
        if (result.question) document.querySelector(`[data-focus-key="message-${CSS.escape(result.question.id)}"]`)?.focus({ preventScroll: true });
      }
    });
    form.append(label, foot, e('p', 'caption', 'Only this question is sent. Delivery may be delayed; the phone reply returns through the mesh.')); panel.append(form); return panel;
  }
  function timeline(events) {
    const list = e('ol', 'regional-timeline');
    if (!events.length) return append(list, append(e('li'), e('span', 'caption', 'No saved steps yet.')));
    for (const event of events) list.append(append(e('li'), e('time', 'caption', clock(event.at)), append(e('div'), e('strong', '', `${actionNames[event.action] || String(event.action || 'Update').replaceAll('_', ' ')}${event.resource ? ` · ${resourceName(event.resource)}` : ''}`), e('p', 'caption', actionDescriptions[event.action] || 'Coordination state updated.')))); return list;
  }
  function sourceAge(at) { if (!at) return 'No contact recorded'; const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000)); return minutes < 1 ? 'Contact just now' : `${minutes} min since last contact`; }
  function renderHubs() {
    const area = $('#hub-list'); preserveFocus(() => { area.replaceChildren();
      const resources = [...new Set(state.hubs.flatMap(hub => Object.keys(hub.resources || {})))];
      const panel = e('div', 'panel regional-hub-table'), table = e('table'), head = e('thead'), row = e('tr'); row.append(e('th', '', 'Hub'), e('th', '', 'Source')); for (const resource of resources) row.append(e('th', '', resourceName(resource))); head.append(row); table.append(head); const body = e('tbody');
      for (const hub of state.hubs) { const line = e('tr'), identity = e('th'); identity.scope = 'row'; const jump = R.button(hub.name || names[hub.id] || hub.id, 'quiet', () => { setSource(hub.id); setTab('handoffs'); }); jump.dataset.focusKey = `hub-${hub.id}`; identity.append(jump, e('p', 'caption', sourceAge(hub.lastContactAt))); line.append(identity, e('td', '', hub.simulated ? 'Town exercise' : 'Physical radio')); for (const resource of resources) line.append(e('td', '', Number.isFinite(hub.resources?.[resource]) ? String(hub.resources[resource]) : '—')); body.append(line); }
      table.append(body); panel.append(table); area.append(panel, e('p', 'production-inventory-note muted', 'Counts are remaining available units or teams. A dash means this hub does not publish an inventory for that resource.'));
    });
  }
  function renderHistory() {
    const area = $('#history-list'); preserveFocus(() => { area.replaceChildren(); if (!state.events.length) return area.append(e('p', 'muted', 'No coordination events yet.'));
      const list = e('ol', 'regional-timeline'); for (const event of [...state.events].reverse().slice(0, 150)) {
        const line = e('li'), content = e('div'), heading = `${actionNames[event.action] || String(event.action || 'Update').replaceAll('_', ' ')}${event.resource ? ` · ${resourceName(event.resource)}` : ''}`;
        if (event.caseId && state.cases.some(item => item.caseId === event.caseId)) { const jump = R.button(heading, 'quiet production-event-jump', () => { clearFilters(); selectCase(event.caseId); }); jump.dataset.focusKey = `event-${event.seq}`; content.append(jump); } else content.append(e('strong', '', heading)); content.append(e('p', 'caption', `${names[event.hubId] || 'Regional desk'} · ${actionDescriptions[event.action] || 'Coordination state updated.'}`)); line.append(e('time', 'caption', clock(event.at)), content); list.append(line);
      } area.append(list);
    });
  }
  function renderExercise() {
    const simulation = state.simulation, generation = state.model.exerciseGeneration;
    $('#simulation-status').textContent = `${simulation.running ? 'Town intake running' : 'Town intake paused'} · ${simulation.emitted} requests this cycle · ${Math.round(simulation.intervalMs / 1000)} seconds between requests`;
    $('#simulation-toggle').textContent = simulation.running ? 'Pause town intake' : 'Start town intake'; for (const id of ['simulation-step', 'simulation-toggle', 'simulation-reset']) $('#' + id).disabled = mutating;
    $('#generation-provenance').textContent = generation ? generation.mode === 'nemotron' ? `Town wording: regional Nemotron · ${generation.generatedScenarios} validated scenarios generated.` : `Town wording: seeded policy${generation.lastError ? ' · regional generation unavailable.' : '.'}` : 'Town generation attribution is not recorded.';
  }
  function renderSystem() {
    const area = $('#system-status'); area.replaceChildren();
    const model = append(e('div'), e('h3', '', 'Regional inference'), e('p', '', state.model.model || 'No model configured'), e('p', '', state.model.mode === 'nemotron-tools' ? 'Native tool calls recorded' : state.model.mode === 'awaiting-inference' ? 'Awaiting first inference' : state.model.mode === 'rules' ? 'Resource policy enabled' : 'Resource policy fallback'), e('p', '', state.model.hosting === 'brev' ? 'Brev GPU · private SSH connection' : state.model.hosting === 'local' ? 'Local model host' : 'Configured inference endpoint'));
    if (state.model.providerVerifiedAt) model.append(e('p', '', `Provider verified ${new Date(state.model.providerVerifiedAt).toLocaleString()}`));
    const storage = append(e('div'), e('h3', '', 'Storage'), e('p', '', state.database.connected ? 'MongoDB connected' : 'Durable local storage active'), e('p', '', state.database.lastSyncedAt ? `Database sync ${clock(state.database.lastSyncedAt)}` : 'Database sync not recorded'));
    const map = append(e('div'), e('h3', '', 'Map meaning'), e('p', '', 'Street tiles: OpenStreetMap. Pins are published hub landmarks. Lines show selected saved resource allocations, not travel routes or radio coverage. Missing tiles do not remove saved case details.'));
    area.append(append(e('div', 'system-grid'), model, storage, map));
  }

  $('#search-icon').append(R.icon('search'));
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true; $('#login-error').textContent = '';
    try { const data = new FormData(form), result = await request('/api/login', { method: 'POST', body: { username: data.get('username'), password: data.get('password'), remember: data.has('remember') } }); csrf = result.csrf; $('#password').value = ''; await refresh(true); }
    catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
  });
  $('#signout').addEventListener('click', async () => { try { await request('/api/logout', { method: 'POST', body: {} }); questionDrafts.clear(); showLogin(); $('#password').focus(); } catch (error) { announce(error.message, true); } });
  $('#pause').addEventListener('click', event => change('/api/automation', { paused: !state.automationPaused }, state.automationPaused ? 'Automatic coordination resumed.' : 'Coordination paused. Requests remain saved.', event.currentTarget));
  for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => setTab(button.dataset.tab));
  $('#conversation-clear-case').addEventListener('click', () => { conversationCaseId = null; conversationLimit = 60; conversationSignature = ''; renderAgentConversation(true); });
  $('#conversation-latest').addEventListener('click', () => renderAgentConversation(true));
  $('#conversation-older').addEventListener('click', () => {
    const viewport = $('#agent-conversation-scroll'), oldHeight = viewport.scrollHeight, oldTop = viewport.scrollTop;
    conversationLimit = Math.min(1200, conversationLimit + 60); conversationSignature = ''; renderAgentConversation(true);
    requestAnimationFrame(() => { viewport.scrollTop = oldTop + viewport.scrollHeight - oldHeight; });
  });
  $('#case-search').addEventListener('input', event => { query = event.target.value; pageSize = 30; render(); });
  $('#source-filter').addEventListener('change', event => setSource(event.target.value));
  $('#status-filter').addEventListener('change', event => { statusFilter = event.target.value; pageSize = 30; render(); });
  $('#clear-filters').addEventListener('click', clearFilters); $('#more-requests').addEventListener('click', () => { pageSize += 30; renderCases(); });
  $('#simulation-toggle').addEventListener('click', event => change('/api/simulation', { action: state.simulation.running ? 'pause' : 'start' }, state.simulation.running ? 'Town intake paused.' : 'Town intake started.', event.currentTarget));
  $('#simulation-step').addEventListener('click', event => change('/api/simulation', { action: 'step' }, 'One town request added.', event.currentTarget));
  $('#simulation-reset').addEventListener('click', event => change('/api/simulation', { action: 'reset' }, 'Town exercise reset. ECSW records remain saved.', event.currentTarget));
  setTab(activeTab); await refresh(true);
  setInterval(() => { if (state && !document.hidden) refresh(); }, 2500);
  document.addEventListener('visibilitychange', () => { if (state && !document.hidden) refresh(true); });
}
