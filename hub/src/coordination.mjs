import { runLocalAgent, boundedJson } from './local-agent.mjs';
import { incidentLocation } from './region.mjs';
import { reportedSupplies, sourceNeedRequests } from './signal-fields.mjs';
import { checkedCommands, messageSnapshot, messageDigest } from './message-bridge.mjs';

const STATUSES = new Set(['received', 'planning', 'allocated', 'partial', 'simulated-dispatched', 'needs-review', 'paused']);
const LABELS = { queued: 'Coordination queued', processing: 'Preparing request', shared: 'Shared with regional agent', received: 'Regional agent received', planning: 'Finding regional resources', allocated: 'Resources allocated', partial:'Some needs await resources', 'simulated-dispatched': 'Dispatch simulated', 'needs-review': 'Human attention needed', paused: 'Automation paused' };
const safeText = (value, maximum = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maximum) : '';
function remoteAgent(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.model!=='string'||typeof value.hosting!=='string'||typeof value.mode!=='string')return null;
  return {model:safeText(value.model,100),hosting:safeText(value.hosting,40),mode:safeText(value.mode,40),lastSuccessAt:Number.isFinite(value.lastSuccessAt)&&value.lastSuccessAt>=0?value.lastSuccessAt:null};
}
function requestedNeeds(summary){return Array.isArray(summary?.needRequests)?summary.needRequests:[{resource:summary?.resource,quantity:summary?.quantity}];}
function checkedAllocations(update,item,region,hubId){
  const c=item.coordination,needs=requestedNeeds(c.summary),input=update.allocations!==undefined?update.allocations:update.allocation?[update.allocation]:null;
  if(input===null)return null;
  if(!Array.isArray(input)||input.length>needs.length)throw new Error('Invalid simulated allocations');
  const resources=new Set();
  return input.map(a=>{
    const need=needs.find(n=>n.resource===a?.resource);
    if(!a||a.simulation!==true||a.released===true||!region.resources.includes(a.resource)||!need||resources.has(a.resource)||!Number.isInteger(a.quantity)||a.quantity<1||a.quantity>20||a.quantity!==need.quantity||typeof a.townId!=='string'||!a.townId.trim()||a.townId.length>60||a.townId===hubId||a.caseId!==undefined&&a.caseId!==c.caseId||a.revision!==undefined&&(!Number.isSafeInteger(a.revision)||a.revision<1||a.revision>c.revision))throw new Error('Invalid simulated allocation');
    resources.add(a.resource);
    const agent=a.agent&&['nemotron-tools','rules-fallback','operator'].includes(a.agent.source)?{source:a.agent.source,model:typeof a.agent.model==='string'?safeText(a.agent.model,100):null,at:Number.isFinite(a.agent.at)&&a.agent.at>=0?a.agent.at:null}:null;
    return {townId:safeText(a.townId,60),resource:a.resource,quantity:a.quantity,quantityBasis:need.quantityBasis||'legacy-policy',simulation:true,service:safeText(a.service,100),dispatchId:safeText(a.dispatchId,100),acknowledgedAt:Number.isFinite(a.acknowledgedAt)&&a.acknowledgedAt>=0?a.acknowledgedAt:null,agent};
  });
}
function checkedUnmetNeeds(update,item){
  if(update.unmetNeeds===undefined)return null;
  const needs=requestedNeeds(item.coordination.summary),resources=new Set();
  if(!Array.isArray(update.unmetNeeds)||update.unmetNeeds.length>needs.length)throw new Error('Invalid unmet needs');
  return update.unmetNeeds.map(n=>{
    const expected=needs.find(p=>p.resource===n?.resource);
    if(!expected||resources.has(n.resource)||n.quantity!==expected.quantity)throw new Error('Invalid unmet need');
    resources.add(n.resource);return {...expected,reason:safeText(n.reason,200)};
  });
}

/** The incident file is the local transactional outbox. No radio ACK waits for a remote service. */
export class CoordinationPipeline {
  constructor({ core, runtime = {}, region, enabled = true, fetchImpl = fetch, agent = runLocalAgent, now = () => Date.now() } = {}) {
    this.core = core; this.runtime = runtime; this.region = region; this.enabled = enabled; this.fetch = fetchImpl; this.agent = agent; this.now = now;
    this.hubId = runtime.hubId || 'ecsw'; this.model = runtime.model || 'nemotron-3-nano:4b'; this.running = false; this.polling = false; this.closed = false; this.timer = null; this.runPromise = null; this.abort = new AbortController();
    this.modelState = { enabled, name: this.model, lastSource: null, lastSuccessAt: null, error: null };
    this.supervisorState = { configured: Boolean(runtime.supervisorUrl && runtime.supervisorToken), connected: false, publicUrl: this.publicUrl(runtime.supervisorPublicUrl), lastSyncAt: null, agent:null, error: null };
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
    const entries=this.core.store.state.incidents.filter(i=>i.coordination),cases=entries.map(i=>i.coordination);
    const counts={total:cases.length,attempted:cases.filter(c=>c.attempts>0).length,sendAttempts:cases.reduce((n,c)=>n+(c.attempts||0),0),sent:cases.filter(c=>Number.isFinite(c.sentAt)).length,acknowledged:cases.filter(c=>c.sharedRevision>0).length,currentAcknowledged:cases.filter(c=>c.sharedRevision>=c.revision).length,returned:cases.filter(c=>c.supervisorSeq>0).length,signalCases:entries.filter(i=>i.coordination.summary?.source==='signal').length,modelCases:entries.filter(i=>i.coordination.summary?.source==='local-model').length};
    return { paused: Boolean(this.core.store.state.automation.paused), hubId: this.hubId, model: structuredClone(this.modelState), supervisor: { ...structuredClone(this.supervisorState), ...counts, pending: cases.filter(c=>c.sharedRevision<c.revision).length } };
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
      item.summary = structuredClone(result); item.coordination.summary = { text: result.text.slice(0, 400), headline: result.headline, resource: result.resource, quantity: result.quantity, needType: result.needType, source: result.source, model: result.model, needRequests:structuredClone(result.needRequests||sourceNeedRequests(item.request)), reportedSupplies:reportedSupplies(item.request), signalFacts:structuredClone(result.signalFacts) };
      item.coordination.error = this.supervisorState.configured ? null : 'Supervisor connection is not configured; request remains in the durable local queue.'; this.stage(item, 'queued');
      this.modelState.lastSource = result.source; this.modelState.error = result.error || (result.source!=='signal'&&this.enabled && backlog > 8 ? 'Local model backlog exceeded; source policy used for this report.' : null);
      if (result.source === 'local-model') this.modelState.lastSuccessAt = this.now();
      this.core.store.state.automation.modelState = structuredClone(this.modelState);
    });
  }
  envelope(item) {
    const c = item.coordination;
    const request={category:item.request.category,severity:item.request.severity,people:item.request.people,note:item.request.note};
    const summary={text:c.summary.text,needType:c.summary.needType,resource:c.summary.resource,quantity:c.summary.quantity};
    // Prepared legacy outbox entries keep their exact envelope on retry; adding fields
    // after a lost HTTP acknowledgement must not create a conflicting event identity.
    if(Array.isArray(c.summary.needRequests)){request.flags=item.request.flags;request.supplies=reportedSupplies(item.request);summary.needRequests=structuredClone(c.summary.needRequests);}
    const envelope={ schema: 'rescuemesh.case.v1', eventId: `${c.caseId}:r${c.revision}`, hubId: this.hubId, caseId: c.caseId, revision: c.revision, source: { kind: item.simulated ? 'simulated' : 'radio', requestId: item.id, receivedAt: item.receivedAt }, request, summary, location: structuredClone(c.location) };
    if(Array.isArray(c.summary.needRequests))envelope.sourceAgent={hosting:'local',source:c.summary.source,model:c.summary.source==='local-model'?c.summary.model:null,configuredModel:this.enabled?this.model:null};
    return envelope;
  }
  async share(id) {
    let body;
    let attemptAt;
    await this.transaction(() => { const item = this.core.store.get(id); body = this.envelope(item); item.coordination.attempts++;attemptAt=this.now();item.coordination.lastAttemptAt=attemptAt; });
    try {
      const response = await this.fetch(`${this.runtime.supervisorUrl}/api/hub/cases`, { method: 'POST', headers: { Authorization: `Bearer ${this.runtime.supervisorToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(7000)]) });
      const result = await boundedJson(response);
      if (response.status !== 202 || result.accepted !== true || result.eventId !== body.eventId || result.caseId !== body.caseId || result.revision !== body.revision) throw new Error('Supervisor acknowledgement invalid');
      await this.transaction(() => {
        const item = this.core.store.get(id); const c = item.coordination; c.sharedRevision = Math.max(c.sharedRevision, body.revision); c.sharedCase = body; c.nextAttemptAt = 0; c.error = null;c.sentAt ??=attemptAt;c.acknowledgedAt=this.now();
        if (c.revision === body.revision) this.stage(item, 'shared'); this.event(item, 'ECSW agent', 'share_case', `Revision ${body.revision} accepted by the supervisor. Dispatch remains simulated.`);
      });
      this.supervisorState.connected = true; this.supervisorState.lastSyncAt = this.now(); this.supervisorState.error = null;if(result.agent!==undefined)this.supervisorState.agent=remoteAgent(result.agent);
    } catch {
      await this.transaction(() => { const item = this.core.store.get(id); const c = item.coordination; c.nextAttemptAt = this.now() + Math.min(60000, 3000 * 2 ** Math.min(c.attempts - 1, 4)); c.error = 'Supervisor unavailable; durable request will retry automatically.'; this.stage(item, 'queued'); this.event(item, 'ECSW agent', 'share_retry', 'No valid supervisor acknowledgement. This same event will be retried without creating a second dispatch.'); });
      this.supervisorState.connected = false; this.supervisorState.error = 'Supervisor connection unavailable; local queue retained.';
    }
  }
  async pollUpdates() {
    if (this.closed || this.polling || !this.supervisorState.configured) return;
    this.polling = true;
    try {
      // Human follow-ups keep flowing when model/resource automation is paused.
      try { await this.syncMessages(); this.supervisorState.messagingError=null; }
      catch { this.supervisorState.messagingError='User messages are waiting for regional synchronization.'; }
      const cursor = this.core.store.state.automation.cursor || 0;
      const response = await this.fetch(`${this.runtime.supervisorUrl}/api/hub/updates?after=${cursor}&hubId=${encodeURIComponent(this.hubId)}`, { headers: { Authorization: `Bearer ${this.runtime.supervisorToken}` }, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(7000)]) });
      const result = await boundedJson(response);
      const questions=checkedCommands(result.questions,this.hubId);
      if (!Array.isArray(result.updates) || result.updates.length > 100 || !Number.isSafeInteger(result.cursor) || result.cursor < cursor) throw new Error('Invalid supervisor updates');
      for (const update of result.updates) if (!Number.isSafeInteger(update.seq) || update.seq <= cursor || update.seq > result.cursor || update.hubId !== this.hubId || !Number.isSafeInteger(update.revision) || update.revision < 1 || !STATUSES.has(update.status)) throw new Error('Invalid supervisor event');
      // A poll may race the POST acknowledgement. Keep the cursor until that outbox receipt is durable.
      for (const update of result.updates) { const item = this.core.store.state.incidents.find(i => i.coordination?.caseId === update.caseId); if (item && update.revision === item.coordination.revision && update.revision > item.coordination.sharedRevision) throw new Error('Outbox acknowledgement pending'); }
      await this.transaction(() => {
        for (const update of result.updates) {
          const item = this.core.store.state.incidents.find(i => i.coordination?.caseId === update.caseId); if (!item) continue; const c = item.coordination;
          if (update.revision !== c.sharedRevision || update.revision !== c.revision || (c.supervisorSeq || 0) >= update.seq) continue;
          const allocations=checkedAllocations(update,item,this.region,this.hubId),unmetNeeds=checkedUnmetNeeds(update,item);
          if(allocations&&unmetNeeds&&unmetNeeds.some(n=>allocations.some(a=>a.resource===n.resource)))throw new Error('Allocated need cannot also be unmet');
          this.stage(item, update.status); c.supervisorStatus = update.status; c.supervisorSeq = update.seq; c.error = null;c.lastUpdateAt=this.now();
          if(allocations){c.allocations=allocations;if(allocations.length)c.allocation=allocations[0];else delete c.allocation;}
          if(unmetNeeds)c.unmetNeeds=unmetNeeds;
          if (Array.isArray(update.events)) for (const event of update.events.slice(-12)) this.event(item, event.actor || 'Supervisor', event.action || event.tool || 'supervisor_update', event.result || event.detail || event.message || update.status);
          this.event(item, 'Supervisor', 'status_update', `${LABELS[update.status]}. No real emergency service has been contacted.`);
        }
        this.core.store.state.automation.cursor = result.cursor;
      });
      for(const command of questions)await this.applyQuestionCommand(command);
      this.supervisorState.connected = true; this.supervisorState.lastSyncAt = this.now(); this.supervisorState.error = null;if(result.agent!==undefined)this.supervisorState.agent=remoteAgent(result.agent);
    } catch { this.supervisorState.connected = false; this.supervisorState.error = 'Supervisor updates unavailable; last acknowledged state retained.'; }
    finally { this.polling = false; }
  }
  async postMessages(body){
    const response=await this.fetch(`${this.runtime.supervisorUrl}/api/hub/messages`,{method:'POST',headers:{Authorization:`Bearer ${this.runtime.supervisorToken}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(7000)])});
    const result=await boundedJson(response);
    if(result.accepted!==true||result.caseId!==body.caseId)throw new Error('Message synchronization acknowledgment invalid');
  }
  async syncOneMessage(id,{force=false,commandErrors=[]}={}){
    const item=this.core.store.get(id);if(!item?.coordination||item.coordination.sharedRevision<1||item.simulated)return;
    const body=messageSnapshot(this.core,item,commandErrors),digest=messageDigest(body);
    if(!force&&digest===item.coordination.messageSyncDigest)return;
    if(!force&&!body.canContactUser&&!body.followups.length&&!item.coordination.messageSyncDigest)return;
    await this.postMessages(body);
    if(commandErrors.length)return;
    await this.transaction(()=>{const current=this.core.store.get(id);if(current?.coordination)current.coordination.messageSyncDigest=digest;});
  }
  async syncMessages(){
    let count=0;
    for(const item of this.core.store.state.incidents){
      if(!item.coordination||item.coordination.sharedRevision<1||item.simulated)continue;
      const body=messageSnapshot(this.core,item),digest=messageDigest(body);
      if(digest===item.coordination.messageSyncDigest||!body.canContactUser&&!body.followups.length&&!item.coordination.messageSyncDigest)continue;
      await this.syncOneMessage(item.id);if(++count>=8)break;
    }
  }
  async applyQuestionCommand(command){
    const item=this.core.store.state.incidents.find(i=>i.coordination?.caseId===command.caseId&&!i.simulated);
    if(!item){await this.postMessages({caseId:command.caseId,canContactUser:false,followups:[],commandErrors:[{id:command.id,code:'unknown-case'}]});return;}
    let errorCode=null;
    try {
      if(command.action==='close'){
        const question=this.core.publicIncident(item).followups?.find(q=>q.id===command.id);
        if(!question)errorCode='closed';
        else await this.core.closeQuestion(item.id,command.id);
      }else await this.core.askQuestion(item.id,command.text,{questionId:command.id,source:'regional'});
    }catch(error){
      if(![400,404,409].includes(error.status))throw error;
      errorCode=error.status===404?'unknown-case':error.status===400?'invalid-question':this.core.publicIncident(this.core.store.get(item.id)).canContactUser!==true?'phone-not-ready':'blocked';
    }
    // askQuestion/closeQuestion own core.exclusive; never invoke them inside transaction.
    await this.syncOneMessage(item.id,{force:true,commandErrors:errorCode?[{id:command.id,code:errorCode}]:[]});
  }
  async idle() { await this.runPromise; await this.core.pending; }
  async close() { this.closed = true; clearInterval(this.timer); this.abort.abort(); await this.idle(); }
}
