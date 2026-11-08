import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,report} from './helpers.mjs';
import {sourceNeedRequests,validateCase,deriveNeeds} from '../src/schema.mjs';
import {SupervisorStore,available} from '../src/store.mjs';
import {SupervisorCore} from '../src/core.mjs';
import {NemotronPlanner} from '../src/planner.mjs';
import {SimulatedDispatchAdapter} from '../src/dispatch.mjs';

function typed(id,flags=240,category=5,people=2){
  const request={category,severity:2,people,note:'ECSW',flags,supplies:Object.entries({food:16,water:32,medicine:64,power:128}).filter(([,bit])=>flags&bit).map(([name])=>name)};
  const needs=sourceNeedRequests(request);
  return report(id,{request,summary:{text:'Reported selections',resource:needs[0].resource,quantity:needs[0].quantity,needRequests:needs}});
}
test('all transmitted supply selections reserve and acknowledge independently without duplicating a resource',async()=>{
  const f=await fixture();try{
    const input=typed('all');await f.core.receive(input);await f.core.idle();const item=f.store.state.cases[0];
    assert.equal(item.status,'simulated-dispatched');assert.equal(item.allocations.length,4);
    assert.deepEqual(item.allocations.map(a=>a.resource),['food','water','medicine','power']);
    assert.equal(new Set(item.allocations.map(a=>a.dispatchId)).size,4);assert.ok(item.allocations.every(a=>a.acknowledgedAt&&a.quantity===2&&a.quantityBasis==='policy-per-person'));
    assert.deepEqual(item.allocation,item.allocations[0]);assert.deepEqual(item.unmetNeeds,[]);
    await f.core.receive(input);await f.core.resolve(item.caseId,{action:'retry'});await f.core.idle();assert.equal(f.store.state.allocations.length,4);
    const update=f.core.updates('ecsw').updates.at(-1);assert.equal(update.allocations.length,4);assert.deepEqual(update.allocation,update.allocations[0]);
  }finally{await f.cleanup();}
});
test('partial stock keeps completed reservations and later fulfills only the missing resource',async()=>{
  const f=await fixture();try{
    await f.store.transact(s=>{for(const town of Object.keys(s.resources))s.resources[town].water=0;});
    await f.core.receive(typed('partial',48));await f.core.idle();const item=f.store.state.cases[0],foodId=item.allocations[0].id;
    assert.equal(item.status,'partial');assert.deepEqual(item.unmetNeeds.map(n=>n.resource),['water']);assert.equal(item.allocations[0].resource,'food');assert.ok(item.allocations[0].acknowledgedAt);
    await f.core.resolve(item.caseId,{action:'retry'});await f.core.idle();assert.equal(f.store.state.allocations.length,1);
    await f.store.transact(s=>{s.resources.garland.water=2;});await f.core.resolve(item.caseId,{action:'retry'});await f.core.idle();
    const after=f.store.state.cases[0];assert.equal(after.status,'simulated-dispatched');assert.equal(after.allocations.length,2);assert.equal(after.allocations[0].id,foodId);assert.equal(available(f.store.state,'garland','water'),0);
  }finally{await f.cleanup();}
});
test('one failed multi-resource acknowledgment survives restart and never re-reserves acknowledged siblings',async()=>{
  const adapter=new SimulatedDispatchAdapter();let failed=false;
  const f=await fixture({dispatcher:{send:async(a,i)=>{if(a.resource==='water'&&!failed){failed=true;throw new Error('synthetic outage');}return adapter.send(a,i);}}});let restarted;
  try{
    await f.core.receive(typed('restart',48));await f.core.idle();const first=f.store.state.cases[0];assert.equal(first.status,'allocated');assert.ok(first.allocations[0].acknowledgedAt);assert.equal(first.allocations[1].acknowledgedAt,undefined);
    const ids=first.allocations.map(a=>a.id);const store=await new SupervisorStore(f.directory).load();restarted=new SupervisorCore({store,planner:new NemotronPlanner({enabled:false}),dispatcher:adapter});restarted.retryPending();await restarted.idle();
    assert.equal(store.state.cases[0].status,'simulated-dispatched');assert.deepEqual(store.state.cases[0].allocations.map(a=>a.id),ids);assert.equal(store.state.allocations.length,2);
  }finally{await restarted?.close();await f.cleanup();}
});
test('typed categories and flags are source facts; forged supply lists or planning quantities cannot reserve stock',async()=>{
  const input=typed('flood',64,6);assert.deepEqual(sourceNeedRequests(input.request).map(n=>n.resource),['rescue','medicine']);
  assert.throws(()=>validateCase({...input,request:{...input.request,supplies:['water']}}),/transmitted flags/);
  assert.throws(()=>validateCase({...input,request:{...input.request,flags:256}}),/flags/);
  const forged=validateCase({...input,summary:{...input.summary,needRequests:input.summary.needRequests.map(n=>({...n,quantity:3}))}});assert.ok(deriveNeeds(forged).issues.length);
  const f=await fixture();try{await f.core.receive(forged);await f.core.idle();assert.equal(f.store.state.allocations.length,0);assert.equal(f.store.state.cases[0].status,'needs-review');}finally{await f.cleanup();}
});
test('saved catalog upgrade adds new resources without resetting existing stock, sessions or legacy reservations',async()=>{
  const f=await fixture();try{
    await f.core.receive(report('legacy'));await f.core.idle();const original=structuredClone(f.store.state.allocations[0]);
    const saved=JSON.parse(await readFile(join(f.directory,'state.json'),'utf8'));saved.resources.plano.water=0;saved.sessions.push({idHash:'synthetic-session-hash'});
    for(const resources of Object.values(saved.resources))for(const resource of ['food','medicine','power'])delete resources[resource];
    for(const item of saved.cases)delete item.allocations;await writeFile(join(f.directory,'state.json'),JSON.stringify(saved));
    const store=await new SupervisorStore(f.directory).load();assert.equal(store.state.resources.plano.water,0);assert.equal(store.state.resources.plano.food,12);assert.deepEqual(store.state.sessions,saved.sessions);assert.deepEqual(store.state.allocations[0],original);assert.deepEqual(store.state.cases[0].allocations,[saved.cases[0].allocation]);
  }finally{await f.cleanup();}
});
test('source processing attribution is explicit and does not turn a configured model into executed inference',()=>{
  const input=typed('attribution',32);input.sourceAgent={hosting:'local',source:'signal',model:null,configuredModel:'nemotron-3-nano:4b'};
  const canonical=validateCase(input);assert.deepEqual(canonical.sourceAgent,input.sourceAgent);
  assert.throws(()=>validateCase({...input,sourceAgent:{...input.sourceAgent,model:'nemotron-3-nano:4b'}}),/cannot claim a model/);
  assert.throws(()=>validateCase({...input,sourceAgent:{...input.sourceAgent,hosting:'brev'}}),/source agent/);
});
test('an operator alternate follows the same allocation array and dispatch identity contract',async()=>{
  const f=await fixture({planner:{model:'synthetic',status:()=>({mode:'synthetic'}),plan:async()=>null}});
  try{await f.core.receive(report('alternate'));await f.core.idle();const item=f.store.state.cases[0];assert.equal(item.status,'needs-review');
    await f.core.resolve(item.caseId,{action:'alternate',townId:'garland'});await f.core.idle();const after=f.store.state.cases[0];assert.equal(after.status,'simulated-dispatched');assert.equal(after.allocations.length,1);assert.deepEqual(after.allocation,after.allocations[0]);assert.equal(after.allocation.townId,'garland');assert.equal(after.allocation.agent.source,'operator');assert.equal(f.store.state.allocations.length,1);
  }finally{await f.cleanup();}
});
