import { runLocalAgent, boundedJson } from './local-agent.mjs';
import { incidentLocation } from './region.mjs';

const STATUSES = new Set(['received', 'planning', 'allocated', 'simulated-dispatched', 'needs-review', 'paused']);
const LABELS = { queued: 'Coordination queued', processing: 'Preparing request', shared: 'Shared with supervisor', received: 'Supervisor received', planning: 'Finding regional resources', allocated: 'Resources allocated', 'simulated-dispatched': 'Dispatch simulated', 'needs-review': 'Human attention needed', paused: 'Automation paused' };
const safeText = (value, maximum = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maximum) : '';

/** The incident file is the local transactional outbox. No radio ACK waits for a remote service. */
export class CoordinationPipeline {
  constructor({ core, runtime = {}, region, enabled = true, fetchImpl = fetch, agent = runLocalAgent, now = () => Date.now() } = {}) {
    this.core = core; this.runtime = runtime; this.region = region; this.enabled = enabled; this.fetch = fetchImpl; this.agent = agent; this.now = now;
    this.hubId = runtime.hubId || 'ecsw'; this.model = runtime.model || 'nemotron-3-nano:4b'; this.running = false; this.polling = false; this.closed = false; this.timer = null; this.runPromise = null; this.abort = new AbortController();
    this.modelState = { enabled, name: this.model, lastSource: null, lastSuccessAt: null, error: null };
    this.supervisorState = { configured: Boolean(runtime.supervisorUrl && runtime.supervisorToken), connected: false, publicUrl: this.publicUrl(runtime.supervisorPublicUrl), lastSyncAt: null, error: null };
    core.store.state.automation ||= { paused: false, cursor: 0 }; core.pipeline = this;
    if (core.store.state.automation.modelState?.name === this.model) this.modelState = { ...core.store.state.automation.modelState, enabled };
  }
  publicUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : ''; } catch { return ''; } }
  initialize(item) {
    if (item.coordination) return;
    item.coordination = { caseId: `${this.hubId}:${item.id}`, revision: 1, sharedRevision: 0, stage: 'queued', statusLabel: LABELS.queued, location: incidentLocation(item, this.region), summary: null, events: [], attempts: 0, nextAttemptAt: 0, error: null };
    this.event(item, 'ECSW hub', 'persist_intake', 'Authenticated report stored; encrypted acknowledgement submitted independently of coordination.');
  }
  event(item, actor, action, result) {
    const events = item.coordination.events; events.push({ id: `${this.now()}-${events.length}-${item.coordination.revision}`, at: this.now(), actor: safeText(actor, 60), action: safeText(action, 80), result: safeText(result, 400) });
    if (events.length > 100) events.splice(0, events.length - 100);
  }
  stage(item, value) { item.coordination.stage = value; item.coordination.statusLabel = LABELS[value] || 'Coordination pending'; }
  async transaction(action) { return this.core.exclusive(async () => { const before = structuredClone(this.core.store.state); try { const result = await action(); await this.core.store.persist(); this.core.emit('update'); return result; } catch (error) { this.core.store.state = before; throw error; } }); }
  async start({ intervalMs = 3000 } = {}) {
    // Historical receptions without an outbox entry remain historical. Resume only previously queued work.
    await this.transaction(() => { for (const item of this.core.store.state.incidents) if (item.coordination?.stage === 'processing') this.stage(item, 'queued'); });
    this.timer = setInterval(() => { this.wake(); void this.pollUpdates(); }, intervalMs); this.timer.unref(); this.wake(); void this.pollUpdates();
  }
  status() {
    return { paused: Boolean(this.core.store.state.automation.paused), hubId: this.hubId, model: structuredClone(this.modelState), supervisor: { ...this.supervisorState, pending: this.core.store.state.incidents.filter(i => i.coordination && i.coordination.sharedRevision < i.coordination.revision).length } };
  }
  async setPaused(paused) {
    await this.transaction(() => { this.core.store.state.automation.paused = paused; for (const item of this.core.store.state.incidents) if (item.coordination && item.coordination.sharedRevision < item.coordination.revision) { this.event(item, 'Operator', paused ? 'pause_automation' : 'resume_automation', paused ? 'Automatic regional coordination paused by the operator.' : 'Automatic regional coordination resumed by the operator.'); } });
    if (!paused) { this.wake(); void this.pollUpdates(); }
  }
  async correctLocation(id, label) {
    if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error('Invalid location label');
    await this.transaction(() => {
      const item = this.core.store.get(id); if (!item) throw new Error('Incident not found');
      // A historical reception remains historical; annotations do not silently replay old cases.
      item.annotations ||= {}; item.annotations.location = { label: label.trim(), at: this.now(), by: 'operator' };
      if (item.coordination) { const c = item.coordination; c.location = incidentLocation(item, this.region); c.revision++; c.nextAttemptAt = 0; c.error = null; this.stage(item, 'queued'); this.event(item, 'Operator', 'correct_location', 'Annotated location corrected. Original transmitted report is unchanged; a new revision will be shared automatically.'); }
    }); this.wake();
  }
  wake() {
    if (this.closed || this.running || this.core.store.state.automation.paused) return;
    this.running = true; this.runPromise = this.drain().catch(() => { /* Durable entries remain pending after a local storage failure. */ }).finally(() => { this.running = false; });
  }
  async drain() {
    while (!this.closed && !this.core.store.state.automation.paused) {
      const item = this.core.store.state.incidents.find(i => i.coordination && i.coordination.sharedRevision < i.coordination.revision && i.coordination.nextAttemptAt <= this.now() && (!i.coordination.summary || this.supervisorState.configured));
      if (!item) return;
      if (!item.coordination.summary) await this.prepare(item.id);
      if (this.closed || this.core.store.state.automation.paused) return;
      if (!this.supervisorState.configured) continue;
      await this.share(item.id);
    }
  }
  async prepare(id) {
    let snapshot; await this.transaction(() => { const item = this.core.store.get(id); this.stage(item, 'processing'); snapshot = structuredClone(item); });
    const backlog = this.core.store.state.incidents.filter(i => i.coordination && !i.coordination.summary).length;
    let result;
    try {
      result = await this.agent(snapshot.request, { caseId: snapshot.coordination.caseId, region: this.region, enabled: this.enabled && backlog <= 8, model: this.model, fetchImpl: this.fetch, signal: this.abort.signal, onTool: event => this.transaction(() => { const item = this.core.store.get(id); if (item) this.event(item, event.actor, event.action, event.result); }) });
    } catch {
      result = await runLocalAgent(snapshot.request, { caseId: snapshot.coordination.caseId, region: this.region, enabled: false }); result.error = 'Local model workflow unavailable; source policy remains active.'; result.source = 'local-rules-fallback';
    }
    await this.transaction(() => {
      const item = this.core.store.get(id); if (!item) return;
      item.summary = structuredClone(result); item.coordination.summary = { text: result.text.slice(0, 400), headline: result.headline, resource: result.resource, quantity: result.quantity, needType: result.needType, source: result.source, model: result.model };
      item.coordination.error = this.supervisorState.configured ? null : 'Supervisor connection is not configured; request remains in the durable local queue.'; this.stage(item, 'queued');
      this.modelState.lastSource = result.source; this.modelState.error = result.error || (this.enabled && backlog > 8 ? 'Local model backlog exceeded; source policy used for this report.' : null);
      if (result.source === 'local-model') this.modelState.lastSuccessAt = this.now();
      this.core.store.state.automation.modelState = structuredClone(this.modelState);
    });
  }
  envelope(item) {
    const c = item.coordination;
    return { schema: 'rescuemesh.case.v1', eventId: `${c.caseId}:r${c.revision}`, hubId: this.hubId, caseId: c.caseId, revision: c.revision, source: { kind: item.simulated ? 'simulated' : 'radio', requestId: item.id, receivedAt: item.receivedAt }, request: { category: item.request.category, severity: item.request.severity, people: item.request.people, note: item.request.note }, summary: { text: c.summary.text, needType: c.summary.needType, resource: c.summary.resource, quantity: c.summary.quantity }, location: structuredClone(c.location) };
  }
  async share(id) {
    let body;
    await this.transaction(() => { const item = this.core.store.get(id); body = this.envelope(item); item.coordination.attempts++; });
    try {
      const response = await this.fetch(`${this.runtime.supervisorUrl}/api/hub/cases`, { method: 'POST', headers: { Authorization: `Bearer ${this.runtime.supervisorToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(7000)]) });
      const result = await boundedJson(response);
      if (response.status !== 202 || result.accepted !== true || result.eventId !== body.eventId || result.caseId !== body.caseId || result.revision !== body.revision) throw new Error('Supervisor acknowledgement invalid');
      await this.transaction(() => {
        const item = this.core.store.get(id); const c = item.coordination; c.sharedRevision = Math.max(c.sharedRevision, body.revision); c.sharedCase = body; c.nextAttemptAt = 0; c.error = null;
        if (c.revision === body.revision) this.stage(item, 'shared'); this.event(item, 'ECSW agent', 'share_case', `Revision ${body.revision} accepted by the supervisor. Dispatch remains simulated.`);
      });
      this.supervisorState.connected = true; this.supervisorState.lastSyncAt = this.now(); this.supervisorState.error = null;
    } catch {
      await this.transaction(() => { const item = this.core.store.get(id); const c = item.coordination; c.nextAttemptAt = this.now() + Math.min(60000, 3000 * 2 ** Math.min(c.attempts - 1, 4)); c.error = 'Supervisor unavailable; durable request will retry automatically.'; this.stage(item, 'queued'); this.event(item, 'ECSW agent', 'share_retry', 'No valid supervisor acknowledgement. This same event will be retried without creating a second dispatch.'); });
      this.supervisorState.connected = false; this.supervisorState.error = 'Supervisor connection unavailable; local queue retained.';
    }
  }
  async pollUpdates() {
    if (this.closed || this.polling || !this.supervisorState.configured || this.core.store.state.automation.paused) return;
    this.polling = true;
    try {
      const cursor = this.core.store.state.automation.cursor || 0;
      const response = await this.fetch(`${this.runtime.supervisorUrl}/api/hub/updates?after=${cursor}&hubId=${encodeURIComponent(this.hubId)}`, { headers: { Authorization: `Bearer ${this.runtime.supervisorToken}` }, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(7000)]) });
      const result = await boundedJson(response);
      if (!Array.isArray(result.updates) || result.updates.length > 100 || !Number.isSafeInteger(result.cursor) || result.cursor < cursor) throw new Error('Invalid supervisor updates');
      for (const update of result.updates) if (!Number.isSafeInteger(update.seq) || update.seq <= cursor || update.seq > result.cursor || update.hubId !== this.hubId || !Number.isSafeInteger(update.revision) || update.revision < 1 || !STATUSES.has(update.status)) throw new Error('Invalid supervisor event');
      // A poll may race the POST acknowledgement. Keep the cursor until that outbox receipt is durable.
      for (const update of result.updates) { const item = this.core.store.state.incidents.find(i => i.coordination?.caseId === update.caseId); if (item && update.revision === item.coordination.revision && update.revision > item.coordination.sharedRevision) throw new Error('Outbox acknowledgement pending'); }
      await this.transaction(() => {
        for (const update of result.updates) {
          const item = this.core.store.state.incidents.find(i => i.coordination?.caseId === update.caseId); if (!item) continue; const c = item.coordination;
          if (update.revision !== c.sharedRevision || update.revision !== c.revision || (c.supervisorSeq || 0) >= update.seq) continue;
          this.stage(item, update.status); c.supervisorStatus = update.status; c.supervisorSeq = update.seq; c.error = null;
          if (update.allocation) {
            const a = update.allocation;
            if (a.simulation !== true || !this.region.resources.includes(a.resource) || a.resource !== c.summary.resource || !Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > Math.min(20, item.request.people)) throw new Error('Invalid simulated allocation');
            c.allocation = { townId: safeText(a.townId, 60), resource: a.resource, quantity: a.quantity, simulation: true, service: safeText(a.service, 100), dispatchId: safeText(a.dispatchId, 100), acknowledgedAt: Number.isFinite(a.acknowledgedAt) ? a.acknowledgedAt : null };
          }
          if (Array.isArray(update.events)) for (const event of update.events.slice(-12)) this.event(item, event.actor || 'Supervisor', event.action || event.tool || 'supervisor_update', event.result || event.detail || event.message || update.status);
          this.event(item, 'Supervisor', 'status_update', `${LABELS[update.status]}. No real emergency service has been contacted.`);
        }
        this.core.store.state.automation.cursor = result.cursor;
      });
      this.supervisorState.connected = true; this.supervisorState.lastSyncAt = this.now(); this.supervisorState.error = null;
    } catch { this.supervisorState.connected = false; this.supervisorState.error = 'Supervisor updates unavailable; last acknowledged state retained.'; }
    finally { this.polling = false; }
  }
  async idle() { await this.runPromise; await this.core.pending; }
  async close() { this.closed = true; clearInterval(this.timer); this.abort.abort(); await this.idle(); }
}
