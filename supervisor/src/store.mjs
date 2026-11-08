import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const RESOURCE_SEEDS = {
  plano: { water: 8, supplies: 12, medical: 3, fire: 2, rescue: 3, safety: 4, food:12, medicine:8, power:6 },
  garland: { water: 4, supplies: 10, medical: 2, fire: 2, rescue: 2, safety: 3, food:10, medicine:6, power:5 },
  addison: { water: 6, supplies: 8, medical: 2, fire: 1, rescue: 2, safety: 3, food:8, medicine:5, power:4 },
};
export function initialState(seed = 4207) {
  return { schema: 1, sequence: 0, automationPaused: false, cases: [], events: [], updates: [], allocations: [], users: [], sessions: [],
    resources: structuredClone(RESOURCE_SEEDS), hubs: [{ id:'ecsw', name:'ECSW', simulated:false, lastContactAt:null }, ...['plano','garland','addison'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),simulated:true,enabled:true,lastContactAt:null}))],
    simulation:{ seed, randomState:seed>>>0, runId:'run-'+Date.now(), running:false, emitted:0, maxCases:150, intervalMs:25000, lastTickAt:null } };
}
export class SupervisorStore {
  constructor(directory, { seed = 4207, mirror = null } = {}) { this.directory=directory; this.file=join(directory,'state.json'); this.state=initialState(seed); this.pending=Promise.resolve(); this.mirror=mirror; }
  async load() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try { const state=JSON.parse(await readFile(this.file,'utf8')); if(state.schema!==1||!Array.isArray(state.cases)||!Array.isArray(state.sessions)||!Array.isArray(state.allocations)) throw new Error('Unsupported supervisor state');
      // Add only newly introduced catalog fields; existing counts/reservations remain authoritative.
      let changed=false;
      for(const [town,resources] of Object.entries(RESOURCE_SEEDS)){if(!state.resources?.[town]||typeof state.resources[town]!=='object')throw new Error('Invalid saved resource catalog');for(const resource of ['food','medicine','power'])if(!Object.hasOwn(state.resources[town],resource)){state.resources[town][resource]=resources[resource];changed=true;}}
      for(const item of state.cases)if(!Array.isArray(item.allocations)){item.allocations=item.allocation?[structuredClone(item.allocation)]:[];changed=true;}
      this.state=state;if(changed)await this.persist(state);
    }
    catch(error){if(error.code!=='ENOENT')throw error; await this.persist(this.state);}
    return this;
  }
  async persist(state) { const temporary=this.file+'.tmp-'+randomBytes(6).toString('hex'); await writeFile(temporary,JSON.stringify(state)+'\n',{mode:0o600}); await rename(temporary,this.file); }
  transact(action) {
    const next=this.pending.then(async()=>{const draft=structuredClone(this.state);const result=await action(draft);await this.persist(draft);this.state=draft;this.mirror?.enqueue(draft);return result;});
    this.pending=next.catch(()=>{});return next;
  }
  async flush(){await this.pending;await this.mirror?.flush();}
}
export function event(state, item, action, detail = {}, at = Date.now()) {
  const record={seq:++state.sequence,id:'event-'+state.sequence,at,hubId:item?.hubId||'supervisor',caseId:item?.caseId||null,revision:item?.revision||null,action,...detail,simulation:true};
  state.events.push(record);if(state.events.length>10000)state.events.splice(0,state.events.length-10000);
  if(item){item.events.push(record);if(item.events.length>80)item.events.splice(0,item.events.length-80);item.updatedAt=at;}
  return record;
}
export function publish(state,item,at=Date.now()){
  const active=(Array.isArray(item.allocations)?item.allocations:item.allocation?[item.allocation]:[]).filter(a=>!a.released);
  const update={seq:++state.sequence,caseId:item.caseId,hubId:item.hubId,revision:item.revision,status:item.status,allocation:active[0]?structuredClone(active[0]):null,allocations:structuredClone(active),unmetNeeds:structuredClone(item.unmetNeeds||[]),events:structuredClone(item.events.slice(-30)),updatedAt:at,simulation:true};
  state.updates.push(update);if(state.updates.length>10000)state.updates.splice(0,state.updates.length-10000);
  return update;
}
export function available(state,town,resource){return Math.max(0,(state.resources[town]?.[resource]||0)-state.allocations.filter(a=>a.townId===town&&a.resource===resource&&!a.released).reduce((n,a)=>n+a.quantity,0));}
