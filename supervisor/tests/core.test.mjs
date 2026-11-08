import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture,report } from './helpers.mjs';
import { SupervisorStore, available } from '../src/store.mjs';
import { SupervisorCore } from '../src/core.mjs';
import { NemotronPlanner } from '../src/planner.mjs';
import { SimulatedDispatchAdapter } from '../src/dispatch.mjs';

test('source requests automatically reserve and acknowledge simulation, with a causal event history',async()=>{
  const f=await fixture();try{
    const input=report();await f.core.receive(input,{allowedHubId:'ecsw'});await f.core.idle();
    const item=f.store.state.cases[0];assert.equal(item.status,'simulated-dispatched');assert.equal(item.source.kind,'radio');assert.equal(item.request.severity,2);assert.equal(item.allocation.simulation,true);assert.equal(f.store.state.allocations.length,1);assert.equal(available(f.store.state,'plano','water'),6);
    assert.deepEqual(item.events.map(e=>e.action),['case_received','validate_case','resource_catalog','resource_allocated','simulated_dispatch']);
    const acknowledgment=await f.core.receive(input,{allowedHubId:'ecsw'});assert.equal(acknowledgment.duplicate,true);await f.core.idle();assert.equal(f.store.state.allocations.length,1);assert.equal(item.events.at(-1).action,'simulated_dispatch');
    const spool=JSON.parse(await readFile(join(f.directory,'state.json'),'utf8'));assert.equal(spool.cases[0].status,'simulated-dispatched');assert.equal(f.core.state().realDispatch,false);
  }finally{await f.cleanup();}
});

test('location revisions keep the original source and reservation; conflicting replays and stale revisions are bounded',async()=>{
 const f=await fixture();try{
  const input=report();await f.core.receive(input);await f.core.idle();const allocation=f.store.state.cases[0].allocation.id;
  const changed={...input,eventId:input.caseId+':r3',revision:3,location:{kind:'gps',latitude:32.986,longitude:-96.750,label:'ECSW entrance',accuracy:10}};
  await f.core.receive(changed);await f.core.idle();assert.equal(f.store.state.cases[0].allocation.id,allocation);assert.equal(f.store.state.allocations.length,1);assert.equal(f.store.state.cases[0].revision,3);assert.equal(f.store.state.cases[0].location.verified,false);
  const stale=await f.core.receive({...input,eventId:input.caseId+':r2',revision:2});assert.equal(stale.stale,true);assert.equal(stale.revision,3);
  await assert.rejects(f.core.receive({...changed,summary:{text:'Different content'}}),{status:409});
  await assert.rejects(f.core.receive({...changed,eventId:input.caseId+':r4',revision:4,request:{...input.request,people:3}}),{status:409});
  assert.equal(f.core.updates('ecsw',0).updates.at(-1).revision,3);
 }finally{await f.cleanup();}
});

test('unknown location and source mismatch remain exceptions without stock consumption',async()=>{
 const f=await fixture();try{
  const a=report('unknown',{location:{kind:'unknown'}}),b=report('mismatch',{summary:{text:'A proposed fire response.',resource:'fire',quantity:1}});
  await f.core.receive(a);await f.core.receive(b);await f.core.idle();assert.equal(f.store.state.allocations.length,0);assert.ok(f.store.state.cases.every(c=>c.status==='needs-review'));
  const revised={...a,eventId:a.caseId+':r2',revision:2,location:{kind:'landmark',label:'UTD ECSW'}};await f.core.receive(revised);await f.core.idle();assert.equal(f.store.state.cases.find(c=>c.caseId===a.caseId).status,'simulated-dispatched');
 }finally{await f.cleanup();}
});

test('concurrent requests cannot oversubscribe resources, and pause resumes saved work',async()=>{
 const f=await fixture();try{
  await f.core.setPaused(true);await Promise.all(Array.from({length:5},(_,i)=>f.core.receive(report('stock'+i,{request:{category:5,severity:3,people:5,note:'Water needed'},summary:{text:'Five people request water.',resource:'water',quantity:5}}))));await f.core.idle();assert.equal(f.store.state.allocations.length,0);assert.ok(f.store.state.cases.every(c=>c.status==='paused'));
  await f.core.setPaused(false);await f.core.idle();assert.equal(f.store.state.allocations.length,2);assert.equal(f.store.state.cases.filter(c=>c.status==='needs-review').length,3);for(const town of ['plano','garland','addison'])assert.ok(available(f.store.state,town,'water')>=0);
 }finally{await f.cleanup();}
});

test('an allocation survives adapter failure and process restart without reserving again',async()=>{
 let attempts=0;const adapter=new SimulatedDispatchAdapter();const f=await fixture({dispatcher:{send:async(...args)=>{if(++attempts===1)throw new Error('synthetic offline');return adapter.send(...args);}}});let restarted;
 try{
  await f.core.receive(report());await f.core.idle();assert.equal(f.store.state.cases[0].status,'allocated');assert.equal(f.store.state.allocations.length,1);
  const store=await new SupervisorStore(f.directory).load();restarted=new SupervisorCore({store,planner:new NemotronPlanner({enabled:false}),dispatcher:adapter});restarted.retryPending();await restarted.idle();assert.equal(store.cases?.length,undefined);assert.equal(store.state.cases[0].status,'simulated-dispatched');assert.equal(store.state.allocations.length,1);assert.equal(available(store.state,'plano','water'),6);
 }finally{await restarted?.close();await f.cleanup();}
});

test('simulation is seeded and renewing a capped run preserves physical hub cases and reservations',async()=>{
 const f=await fixture();try{
  await f.core.receive(report());await f.core.idle();const radioId=f.store.state.allocations[0].id;
  await f.core.simulationCommand({action:'step'});await f.core.idle();assert.equal(f.store.state.simulation.emitted,1);const sim=f.store.state.cases.find(c=>c.internalSimulation);assert.equal(sim.source.kind,'simulated');
  await assert.rejects(f.core.simulationCommand({action:'start',intervalMs:1}),{status:400});
  await f.core.simulationCommand({action:'reset',seed:42});assert.equal(f.store.state.cases.find(c=>c.internalSimulation).archived,true);assert.equal(f.store.state.cases.find(c=>c.source.kind==='radio').archived,false);assert.equal(f.store.state.allocations.find(a=>a.id===radioId).released,false);assert.equal(f.core.state().cases.length,1);
  await f.store.transact(s=>{s.simulation.emitted=s.simulation.maxCases;});await f.core.simulationCommand({action:'start'});assert.equal(f.store.state.simulation.running,true);assert.equal(f.store.state.simulation.emitted,0);assert.ok(await f.core.simulationStep());await f.core.idle();assert.equal(f.store.state.allocations.find(a=>a.id===radioId).released,false);
 }finally{await f.cleanup();}
});

test('continuous SIM intake stays bounded across cycles and preserves real case and resource counters',async()=>{
 const f=await fixture();try{
  await f.core.receive(report('physical'));await f.core.idle();
  const physical=structuredClone(f.store.state.cases[0]),allocation=structuredClone(f.store.state.allocations[0]);
  for(let index=0;index<80;index++){assert.ok(await f.core.simulationStep());await f.core.idle();}
  const state=f.store.state;
  assert.equal(state.simulation.totalEmitted,80);assert.ok(state.simulation.cycle>=6);
  assert.ok(state.cases.filter(c=>c.internalSimulation&&!c.archived).length<=12);
  assert.ok(state.cases.filter(c=>c.internalSimulation&&c.archived).length<=24);
  assert.ok(state.allocations.length<=37);assert.deepEqual(state.cases.find(c=>c.caseId===physical.caseId),physical);
  assert.deepEqual(state.allocations.find(a=>a.id===allocation.id),allocation);
  assert.ok(state.events.some(e=>e.action==='simulation_cycle'&&e.simulation===true));
  for(const town of ['plano','garland','addison'])for(const resource of Object.keys(state.resources[town]))assert.ok(available(state,town,resource)>=0);
 }finally{await f.cleanup();}
});

test('SIM stock pressure skips intake instead of changing real reservations or creating review noise',async()=>{
 const f=await fixture();try{
  await f.core.receive(report('physical'));await f.core.idle();const allocation=structuredClone(f.store.state.allocations[0]);
  await f.store.transact(state=>{for(const town of Object.keys(state.resources))for(const resource of Object.keys(state.resources[town]))state.resources[town][resource]=0;});
  for(let index=0;index<5;index++)assert.equal(await f.core.simulationStep(),null);
  assert.equal(f.store.state.cases.length,1);assert.equal(f.store.state.simulation.skipped,5);
  assert.deepEqual(f.store.state.allocations[0],allocation);assert.equal(f.store.state.cases[0].archived,false);
 }finally{await f.cleanup();}
});

test('source scope and arbitrary category validation reject malformed inputs',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.core.receive(report(),{allowedHubId:'plano'}),{status:403});
  await assert.rejects(f.core.receive(report('bad',{request:{category:0,severity:4,people:-1,note:''}})),{status:400});
  const input=report('medical',{request:{category:1,severity:1,people:1,note:'Person needs assistance.'},summary:{text:'Medical assistance requested.',resource:'medical',quantity:1}});await f.core.receive(input);await f.core.idle();assert.equal(f.store.state.cases[0].allocation.resource,'medical');assert.equal(f.store.state.cases[0].request.severity,1);
 }finally{await f.cleanup();}
});

test('spool write failure does not acknowledge or lose the preceding durable state',async()=>{
 const f=await fixture();try{
  const persist=f.store.persist.bind(f.store);f.store.persist=async()=>{throw new Error('synthetic disk full');};await assert.rejects(f.core.receive(report()));assert.equal(f.store.state.cases.length,0);
  f.store.persist=persist;await f.core.receive(report());await f.core.idle();assert.equal(f.store.state.cases.length,1);
 }finally{await f.cleanup();}
});

test('stale source requests wait for an operator, and reset during inference cannot reserve archived SIM cases',async()=>{
 let release,entered;const started=new Promise(r=>{entered=r;});const wait=new Promise(r=>{release=r;});const f=await fixture({planner:{model:'synthetic-model',status:()=>({mode:'synthetic'}),plan:async(item,need,catalog)=>{entered();await wait;return {townId:catalog[0].townId,resource:need.resource,quantity:need.quantity,source:'rules-fallback'};}}});
 try{
  const old=report('stale');old.source.receivedAt=Date.now()-3600001;await f.core.receive(old);await f.core.idle();assert.equal(f.store.state.cases[0].status,'needs-review');assert.match(f.store.state.cases[0].reason,/older than one hour/);
  await f.core.simulationStep();await started;await f.core.simulationCommand({action:'reset'});release();await f.core.idle();assert.equal(f.store.state.allocations.length,0);assert.ok(f.store.state.cases.find(c=>c.internalSimulation).archived);
 }finally{release?.();await f.cleanup();}
});
