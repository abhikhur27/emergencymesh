import { createHash } from 'node:crypto';
import { validateCase, bodyDigest, deriveNeed, deriveNeeds, immutableSource, TOWN_IDS } from './schema.mjs';
import { event, publish, available } from './store.mjs';
import { NemotronPlanner } from './planner.mjs';
import { SimulatedDispatchAdapter } from './dispatch.mjs';

const nowDefault=()=>Date.now();
const allocationsOf=item=>Array.isArray(item.allocations)?item.allocations:item.allocation?[item.allocation]:[];
function syncPrimary(item){item.allocations=allocationsOf(item);item.allocation=item.allocations[0]?structuredClone(item.allocations[0]):null;}
function updateFulfillment(item,needs,now){
  syncPrimary(item);const active=item.allocations.filter(a=>!a.released),unmet=needs.filter(n=>!active.some(a=>a.resource===n.resource));
  item.unmetNeeds=unmet.map(n=>({...n,reason:'No eligible resource is currently available.'}));
  if(unmet.length){item.status=active.length?'partial':'needs-review';item.reason='Waiting for '+unmet.map(n=>n.resource).join(', ')+'. Existing reservations are preserved.';item.nextRetryAt=now+30000;}
  else if(active.every(a=>a.acknowledgedAt)){item.status='simulated-dispatched';item.reason=null;item.nextRetryAt=0;}
  else{item.status='allocated';item.reason=active.some(a=>a.dispatchError)?'Service acknowledgment pending; reservations preserved.':null;item.nextRetryAt=0;}
}
function allocationFor(item,need,townId,at,agent){
  // Keep legacy single-request dispatch identities stable across the upgrade.
  const key=item.summary.needRequests?.length>1?item.caseId+'|'+need.resource:item.caseId;
  const dispatchId='dispatch-'+createHash('sha256').update(key).digest('hex').slice(0,24);
  return {id:'allocation-'+dispatchId.slice(9),caseId:item.caseId,townId,resource:need.resource,quantity:need.quantity,quantityBasis:need.quantityBasis||'policy-one-team',simulation:true,service:townId[0].toUpperCase()+townId.slice(1)+' simulated '+need.resource+' service',dispatchId,reservedAt:at,released:false,agent};
}
export class SupervisorCore {
  constructor({store,planner=new NemotronPlanner(),dispatcher=new SimulatedDispatchAdapter(),now=nowDefault}={}){
    this.store=store;this.planner=planner;this.dispatcher=dispatcher;this.now=now;this.jobs=new Set();this.running=null;this.closed=false;this.timer=null;
  }
  async receive(input,{allowedHubId=null,internalSimulation=false,runId=null}={}){
    const incoming=validateCase(input,{allowedHubId,simulated:internalSimulation}),digest=bodyDigest(incoming);
    const result=await this.store.transact(state=>{
      if(internalSimulation&&runId!==state.simulation.runId)return {accepted:true,discarded:true,eventId:incoming.eventId,caseId:incoming.caseId,revision:incoming.revision,status:'archived'};
      const existing=state.cases.find(c=>c.caseId===incoming.caseId);
      const replay=state.cases.find(c=>c.seenEvents?.some(e=>e.eventId===incoming.eventId));
      if(replay){const seen=replay.seenEvents.find(e=>e.eventId===incoming.eventId);if(seen.digest!==digest)throw Object.assign(new Error('Conflicting event identity'),{status:409});return {accepted:true,duplicate:true,eventId:incoming.eventId,caseId:replay.caseId,revision:replay.revision,status:replay.status};}
      const hub=state.hubs.find(h=>h.id===incoming.hubId);if(!hub)throw Object.assign(new Error('Unknown hub identity'),{status:403});hub.lastContactAt=this.now();
      if(existing){
        if(immutableSource(existing)!==immutableSource(incoming))throw Object.assign(new Error('Original source cannot change'),{status:409});
        if(incoming.revision<existing.revision)return {accepted:true,stale:true,eventId:incoming.eventId,caseId:existing.caseId,revision:existing.revision,status:existing.status};
        if(incoming.revision===existing.revision)throw Object.assign(new Error('Conflicting case revision'),{status:409});
        existing.seenEvents.push({eventId:incoming.eventId,digest});if(existing.seenEvents.length>1000)throw Object.assign(new Error('Case revision limit reached'),{status:409});
        Object.assign(existing,{eventId:incoming.eventId,revision:incoming.revision,summary:incoming.summary,location:incoming.location});
        if(incoming.sourceAgent)existing.sourceAgent=incoming.sourceAgent;
        existing.updatedAt=this.now();
        event(state,existing,'case_updated',{actor:'local-hub',detail:'A newer source-preserving case revision arrived.'},this.now());
        if(!existing.allocation){existing.status=state.automationPaused?'paused':'received';existing.reason=null;}
        publish(state,existing,this.now());
        return {accepted:true,eventId:incoming.eventId,caseId:existing.caseId,revision:existing.revision,status:existing.status};
      }
      if(!internalSimulation&&state.cases.filter(c=>!c.internalSimulation).length>=2000)throw Object.assign(new Error('Supervisor live case capacity reached'),{status:409});
      const item={...incoming,createdAt:this.now(),updatedAt:this.now(),status:state.automationPaused?'paused':'received',reason:null,events:[],seenEvents:[{eventId:incoming.eventId,digest}],allocation:null,allocations:[],unmetNeeds:[],agent:null,internalSimulation,runId,archived:false};
      state.cases.push(item);event(state,item,'case_received',{actor:'supervisor',detail:'Structured source fields saved before planning.'},this.now());publish(state,item,this.now());
      return {accepted:true,eventId:incoming.eventId,caseId:item.caseId,revision:item.revision,status:item.status};
    });
    if(!result.duplicate&&!result.stale&&!result.discarded)this.enqueue(incoming.caseId);
    return result;
  }
  enqueue(caseId){if(this.closed)return;this.jobs.add(caseId);if(!this.running){this.running=this.drain().finally(()=>{this.running=null;if(this.jobs.size&&!this.closed)this.enqueue(this.jobs.values().next().value);});}}
  async drain(){while(this.jobs.size&&!this.closed){const id=this.jobs.values().next().value;this.jobs.delete(id);try{await this.process(id);}catch{await this.store.transact(state=>{const item=state.cases.find(c=>c.caseId===id);if(!item)return;item.status='needs-review';item.reason='Automatic processing failed; the saved case is preserved.';event(state,item,'processing_failed',{actor:'supervisor',detail:item.reason},this.now());publish(state,item,this.now());}).catch(()=>{});}}}
  async idle(){while(this.running)await this.running;await this.store.flush();}
  catalog(item,need){
    return TOWN_IDS.filter(id=>id!==item.hubId&&this.store.state.hubs.find(h=>h.id===id)?.enabled!==false)
      .map(townId=>({townId,resource:need.resource,available:available(this.store.state,townId,need.resource),simulation:true}));
  }
  async process(caseId){
    let snapshot=this.store.state.cases.find(c=>c.caseId===caseId);
    if(!snapshot||snapshot.archived)return;
    if(this.store.state.automationPaused){await this.store.transact(state=>{const item=state.cases.find(c=>c.caseId===caseId);if(item){item.status='paused';item.reason='Automatic coordination is paused.';publish(state,item,this.now());}});return;}
    snapshot=structuredClone(snapshot);const revision=snapshot.revision,derived=deriveNeeds(snapshot),needs=derived.needs;
    const existing=allocationsOf(snapshot).filter(a=>!a.released);
    if(needs.every(n=>existing.some(a=>a.resource===n.resource))){await this.dispatch(caseId);return;}
    if(snapshot.source.receivedAt>this.now()+300000)derived.issues.push('The source timestamp is in the future; confirm the local hub clock.');
    if(this.now()-snapshot.source.receivedAt>3600000)derived.issues.push('The source request is older than one hour; confirm that help is still needed.');
    await this.store.transact(state=>{const item=state.cases.find(c=>c.caseId===caseId);if(!item||item.revision!==revision)return;event(state,item,'validate_case',{actor:'supervisor',detail:derived.issues.length?'Required evidence needs attention.':'Source fields and planning quantity policy validated.'},this.now());if(derived.issues.length){item.status=existing.length?'partial':'needs-review';item.reason=derived.issues.join(' ');}else{item.status='planning';item.reason=null;}publish(state,item,this.now());});
    if(derived.issues.length){if(existing.length)await this.dispatch(caseId);return;}
    for(const need of needs){
      const current=this.store.state.cases.find(c=>c.caseId===caseId);
      if(!current||current.archived||current.revision!==revision){if(current&&!current.archived)this.jobs.add(caseId);return;}
      if(allocationsOf(current).some(a=>a.resource===need.resource&&!a.released))continue;
      const catalog=this.catalog(current,need);
      await this.store.transact(state=>{const item=state.cases.find(c=>c.caseId===caseId);if(item?.revision===revision)event(state,item,'resource_catalog',{actor:'resource-tool',resource:need.resource,quantityBasis:need.quantityBasis,options:catalog,detail:'Read simulated town inventory for this planning need.'},this.now());});
      const proposal=catalog.some(t=>t.available>=need.quantity)?await this.planner.plan(structuredClone(current),need,catalog,async(action,args,result)=>{
        await this.store.transact(state=>{const item=state.cases.find(c=>c.caseId===caseId);if(item?.revision===revision)event(state,item,action,{actor:'nemotron-tool',resource:need.resource,arguments:args,result,detail:action==='lookup_resources'?'Model queried the resource catalog.':'Model proposed a policy-gated allocation.'},this.now());});
      }):null;
      let stop=false;
      await this.store.transact(state=>{
        const item=state.cases.find(c=>c.caseId===caseId);if(!item||item.archived){stop=true;return;}
        if(item.revision!==revision){this.jobs.add(caseId);stop=true;return;}
        if(state.automationPaused){item.status='paused';item.reason='Paused before the next reservation; existing stock reservations preserved.';publish(state,item,this.now());stop=true;return;}
        syncPrimary(item);if(item.allocations.some(a=>a.resource===need.resource&&!a.released))return;
        const agent={source:proposal?.source||'rules-fallback',model:proposal?.source==='nemotron-tools'?this.planner.model:null,at:this.now()};
        if(!proposal||proposal.resource!==need.resource||proposal.quantity!==need.quantity||!TOWN_IDS.includes(proposal.townId)||proposal.townId===item.hubId||state.hubs.find(h=>h.id===proposal.townId)?.enabled===false||available(state,proposal.townId,need.resource)<need.quantity){
          event(state,item,'allocation_exception',{actor:'policy',resource:need.resource,detail:'No eligible simulated stock can fulfill this planning need.'},this.now());updateFulfillment(item,needs,this.now());publish(state,item,this.now());return;
        }
        const allocation=allocationFor(item,need,proposal.townId,this.now(),agent);
        state.allocations.push(allocation);item.allocations.push(structuredClone(allocation));item.agent ||= agent;syncPrimary(item);updateFulfillment(item,needs,this.now());
        event(state,item,'resource_allocated',{actor:'policy',townId:proposal.townId,resource:need.resource,quantity:need.quantity,quantityBasis:need.quantityBasis,remaining:available(state,proposal.townId,need.resource),detail:'Eligible simulated stock reserved once for this resource.'},this.now());publish(state,item,this.now());
      });
      if(stop)return;
    }
    await this.dispatch(caseId);
  }
  async dispatch(caseId){
    let item=this.store.state.cases.find(c=>c.caseId===caseId);if(!item||item.archived||this.store.state.automationPaused)return;
    const needs=deriveNeeds(item).needs;
    for(const allocation of allocationsOf(item).filter(a=>!a.released&&!a.acknowledgedAt)){
      if(this.store.state.automationPaused)return;
      let ack;try{
        ack=await this.dispatcher.send(structuredClone(allocation),structuredClone(item));
        if(ack.simulation!==true||ack.realServicesContacted!==false||ack.dispatchId!==allocation.dispatchId||ack.quantity!==allocation.quantity||ack.townId!==allocation.townId||ack.resource!==allocation.resource||!Number.isFinite(ack.acceptedAt)||typeof ack.acknowledgment!=='string'||ack.acknowledgment.length>160)throw new Error('Invalid simulated acknowledgment');
      }catch{
        await this.store.transact(state=>{const current=state.cases.find(c=>c.caseId===caseId),saved=allocationsOf(current||{}).find(a=>a.id===allocation.id);if(!current||current.archived||!saved||saved.released||saved.acknowledgedAt)return;saved.dispatchError='Service acknowledgment pending';updateFulfillment(current,needs,this.now());event(state,current,'dispatch_pending',{actor:'simulated-service',resource:allocation.resource,dispatchId:allocation.dispatchId,detail:'Service acknowledgment pending; this reservation is preserved.'},this.now());publish(state,current,this.now());});continue;
      }
      await this.store.transact(state=>{
        const current=state.cases.find(c=>c.caseId===caseId),saved=allocationsOf(current||{}).find(a=>a.id===allocation.id);if(!current||current.archived||!saved||saved.released||saved.acknowledgedAt)return;
        Object.assign(saved,{acknowledgment:ack.acknowledgment,acknowledgedAt:ack.acceptedAt});delete saved.dispatchError;
        const global=state.allocations.find(a=>a.id===saved.id);if(global)Object.assign(global,{acknowledgment:ack.acknowledgment,acknowledgedAt:ack.acceptedAt});
        updateFulfillment(current,needs,this.now());event(state,current,'simulated_dispatch',{actor:'simulated-service',townId:ack.townId,service:ack.service,resource:ack.resource,dispatchId:ack.dispatchId,detail:'Simulation endpoint acknowledged. No emergency services contacted.'},this.now());publish(state,current,this.now());
      });
      item=this.store.state.cases.find(c=>c.caseId===caseId);
    }
  }
  async setPaused(paused){
    if(typeof paused!=='boolean')throw Object.assign(new Error('Paused must be boolean'),{status:400});
    await this.store.transact(state=>{state.automationPaused=paused;event(state,null,paused?'automation_paused':'automation_resumed',{actor:'operator',detail:'Supervisor automation '+(paused?'paused.':'resumed.')},this.now());});
    if(!paused)this.retryPending();
  }
  retryPending(){for(const item of this.store.state.cases)if(!item.archived&&(['received','planning','paused','allocated'].includes(item.status)||item.status==='partial'&&(!item.nextRetryAt||this.now()>=item.nextRetryAt)))this.enqueue(item.caseId);}
  async resolve(caseId,{action,townId}={}){
    if(!['alternate','pending','retry'].includes(action))throw Object.assign(new Error('Unsupported exception action'),{status:400});
    const current=this.store.state.cases.find(c=>c.caseId===caseId);if(!current)throw Object.assign(new Error('Case not found'),{status:404});
    if(action==='pending'){await this.store.transact(state=>{const item=state.cases.find(c=>c.caseId===caseId);if(allocationsOf(item).some(a=>!a.released))throw Object.assign(new Error('A reserved handoff cannot be put back into pending'),{status:409});item.status='needs-review';item.reason='Kept pending by an operator.';event(state,item,'operator_pending',{actor:'operator',detail:item.reason},this.now());publish(state,item,this.now());});return;}
    if(action==='retry'){this.enqueue(caseId);return;}
    const derived=deriveNeeds(current),need=derived.needs.find(n=>!allocationsOf(current).some(a=>a.resource===n.resource&&!a.released));
    if(derived.issues.length||!need||!TOWN_IDS.includes(townId))throw Object.assign(new Error('An alternate cannot be reserved for this case'),{status:409});
    await this.store.transact(state=>{
      const item=state.cases.find(c=>c.caseId===caseId);syncPrimary(item);
      if(state.automationPaused||item.allocations.some(a=>a.resource===need.resource&&!a.released)||townId===item.hubId||state.hubs.find(h=>h.id===townId)?.enabled===false||available(state,townId,need.resource)<need.quantity)throw Object.assign(new Error('Alternate unavailable or automation paused'),{status:409});
      const allocation=allocationFor(item,need,townId,this.now(),{source:'operator',model:null,at:this.now()});state.allocations.push(allocation);item.allocations.push(structuredClone(allocation));item.agent ||= allocation.agent;updateFulfillment(item,derived.needs,this.now());
      event(state,item,'operator_alternate',{actor:'operator',townId,resource:need.resource,quantity:need.quantity,quantityBasis:need.quantityBasis,remaining:available(state,townId,need.resource),detail:'An operator selected an eligible simulated alternative for one unfulfilled resource.'},this.now());publish(state,item,this.now());
    });
    this.enqueue(caseId);
  }
  async contact(hubId){const previous=this.store.state.hubs.find(h=>h.id===hubId)?.lastContactAt;if(previous&&this.now()-previous<30000)return;await this.store.transact(state=>{const hub=state.hubs.find(h=>h.id===hubId);if(hub)hub.lastContactAt=this.now();});}
  updates(hubId,after=0){
    const all=this.store.state.updates.filter(u=>u.hubId===hubId&&u.seq>after),updates=[];
    // Match the source hub's count and64KiB response bounds, including event history.
    for(const raw of all){
      const update={...structuredClone(raw),events:structuredClone((raw.events||[]).slice(-12))};
      if(Buffer.byteLength(JSON.stringify(update))>48000){update.events=[];update.eventsTruncated=true;}
      if(updates.length>=100)break;
      if(Buffer.byteLength(JSON.stringify({updates:[...updates,update],cursor:update.seq,more:true}))>48*1024){if(!updates.length)throw new Error('Update exceeds synchronization budget');break;}
      updates.push(update);
    }
    return {updates,cursor:updates.length?updates.at(-1).seq:this.store.state.sequence,more:all.length>updates.length};
  }
  publicCase(item){const {seenEvents,...safe}=item;return structuredClone(safe);}
  state(){
    const s=this.store.state;return {product:'RescueMesh',serverTime:this.now(),automationPaused:s.automationPaused,cases:s.cases.filter(c=>!c.archived).map(c=>this.publicCase(c)).sort((a,b)=>(a.status==='needs-review'?-1:0)-(b.status==='needs-review'?-1:0)||a.request.severity-b.request.severity||b.updatedAt-a.updatedAt),events:structuredClone(s.events.slice(-300)),hubs:s.hubs.map(h=>({...h,resources:h.simulated?Object.fromEntries(Object.keys(s.resources[h.id]).map(resource=>[resource,available(s,h.id,resource)])):null})),simulation:structuredClone(s.simulation),model:this.planner.status(),database:this.store.mirror?.safeStatus()||{configured:false,connected:false,backend:'local-durable-spool'},realDispatch:false};
  }
  random(state){let x=state.simulation.randomState||4207;x^=x<<13;x^=x>>>17;x^=x<<5;state.simulation.randomState=x>>>0;return (x>>>0)/4294967296;}
  cycleSimulation(state,{reason='scheduled-cycle',running=state.simulation.running,seed=null}={}){
    const sim=state.simulation,simulated=state.cases.filter(c=>c.internalSimulation),archivedCases=simulated.filter(c=>!c.archived).length,ids=new Set(simulated.map(c=>c.caseId));
    for(const item of simulated){item.archived=true;item.archivedAt=this.now();for(const allocation of allocationsOf(item)){allocation.released=true;allocation.releasedAt=this.now();}syncPrimary(item);}
    for(const allocation of state.allocations)if(ids.has(allocation.caseId)){allocation.released=true;allocation.releasedAt=this.now();}
    const retained=new Set(simulated.slice(-24).map(c=>c.caseId));
    state.cases=state.cases.filter(c=>!c.internalSimulation||retained.has(c.caseId));
    state.allocations=state.allocations.filter(a=>!ids.has(a.caseId)||retained.has(a.caseId));
    if(seed!==null){sim.seed=seed;sim.randomState=seed>>>0;}
    sim.cycle=(sim.cycle||0)+1;sim.runId='run-'+this.now()+'-'+state.sequence+'-'+sim.cycle;sim.emitted=0;sim.running=running;sim.lastTickAt=null;sim.lastInventoryWait=null;
    event(state,null,'simulation_cycle',{actor:'simulator',reason,cycle:sim.cycle,archivedCases,retainedSimHistory:retained.size,detail:'SIM cycle renewed. Only generated SIM cases were archived and their simulated reservations released; ECSW source cases and reservations are preserved.'},this.now());
  }
  async simulationStep(){
    let input,runId;
    await this.store.transact(state=>{
      const sim=state.simulation;if(sim.emitted>=Math.min(12,sim.maxCases||150))this.cycleSimulation(state,{reason:'bounded-intake-cycle'});
      const town=TOWN_IDS[Math.floor(this.random(state)*3)],category=[5,5,5,1,2,3,4][Math.floor(this.random(state)*7)],people=1+Math.floor(this.random(state)*3),water=category===5&&this.random(state)<0.7;
      const resource=category===5?(water?'water':'supplies'):['','medical','fire','rescue','safety'][category],quantity=category===5?people:1;
      const canFulfill=()=>TOWN_IDS.some(id=>id!==town&&state.hubs.find(h=>h.id===id)?.enabled!==false&&available(state,id,resource)>=quantity);
      if(!canFulfill()&&state.cases.some(c=>c.internalSimulation&&!c.archived))this.cycleSimulation(state,{reason:'simulated-inventory-cycle'});
      if(!canFulfill()){
        sim.lastTickAt=this.now();sim.skipped=(sim.skipped||0)+1;
        if(sim.lastInventoryWait!==resource)event(state,null,'simulation_inventory_wait',{actor:'simulator',resource,detail:'SIM intake skipped because eligible simulated stock is reserved. ECSW reservations remain unchanged.'},this.now());
        sim.lastInventoryWait=resource;return;
      }
      const note=category===5?(water?'Drinking water requested at the demo check-in.':'Supply kits requested at the demo check-in.'):['','Medical assistance requested at demo check-in.','Fire assistance requested at demo check-in.','Rescue assistance requested at demo check-in.','Safety assistance requested at demo check-in.'][category];
      sim.emitted++;sim.totalEmitted=(sim.totalEmitted||0)+1;sim.lastTickAt=this.now();sim.lastInventoryWait=null;runId=sim.runId;
      const caseId=town+':'+sim.runId+':'+sim.emitted;
      input={schema:'rescuemesh.case.v1',eventId:caseId+':r1',hubId:town,caseId,revision:1,source:{kind:'simulated',requestId:caseId,receivedAt:this.now()},request:{category,severity:3,people,note},summary:{text:people+' people request '+(water?'drinking water':'assistance')+'.',resource:category===5?(water?'water':'supplies'):['','medical','fire','rescue','safety'][category],quantity:category===5?people:1},location:{kind:'landmark',label:town[0].toUpperCase()+town.slice(1)+' demo check-in',verified:false}};
      for(const hub of state.hubs)if(hub.simulated&&hub.enabled)hub.lastContactAt=this.now();
    });
    if(input){
      let description={note:input.request.note,generation:{source:'seeded-policy',model:null,at:this.now()}};
      if(this.planner.describeExercise)description=await this.planner.describeExercise(input).catch(()=>description);
      input.request.note=description.note;input.generation=description.generation;
      await this.receive(input,{internalSimulation:true,runId});
    }
    return input?{caseId:input.caseId}:null;
  }
  async simulationCommand(body={}){
    const {action}=body;if(!['start','pause','step','reset'].includes(action))throw Object.assign(new Error('Unsupported simulation action'),{status:400});
    if(action==='step')return this.simulationStep();
    await this.store.transact(state=>{const sim=state.simulation;
      if(action==='pause')sim.running=false;
      if(action==='start'){if(sim.emitted>=Math.min(12,sim.maxCases||150))this.cycleSimulation(state,{reason:'resumed-completed-cycle',running:true});sim.running=true;if(body.intervalMs!==undefined){if(!Number.isInteger(body.intervalMs)||body.intervalMs<10000||body.intervalMs>120000)throw Object.assign(new Error('Interval must be10000..120000ms'),{status:400});sim.intervalMs=body.intervalMs;}}
      if(action==='reset'){if(body.seed!==undefined&&(!Number.isInteger(body.seed)||body.seed<1||body.seed>2147483647))throw Object.assign(new Error('Invalid seed'),{status:400});this.cycleSimulation(state,{reason:'operator-reset',running:false,seed:body.seed||sim.seed});}
      event(state,null,'simulation_'+action,{actor:'operator',detail:'Only internally generated simulated intake is affected.'},this.now());
    });
  }
  start(){if(this.timer)return;this.retryPending();this.timer=setInterval(()=>{const sim=this.store.state.simulation;if(sim.running&&(!sim.lastTickAt||this.now()-sim.lastTickAt>=sim.intervalMs))this.simulationStep().catch(()=>{});this.retryPending();this.store.mirror?.sync().catch(()=>{});},5000);this.timer.unref?.();}
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);await this.idle();}
}
