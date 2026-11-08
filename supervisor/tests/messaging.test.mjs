import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,report } from './helpers.mjs';
import { SupervisorStore } from '../src/store.mjs';
import { SupervisorCore } from '../src/core.mjs';
import { NemotronPlanner } from '../src/planner.mjs';
import { createSupervisorServer } from '../src/server.mjs';

async function source(f,id='messaging'){
  await f.core.setPaused(true);const body=report(id);await f.core.receive(body,{allowedHubId:'ecsw'});await f.core.idle();
  await f.core.receiveMessages({caseId:body.caseId,canContactUser:true,followups:[]},{allowedHubId:'ecsw'});return body;
}
const snapshot=(caseId,followups,extra={})=>({caseId,canContactUser:true,followups,...extra});
const incoming=(q,changes={})=>({...q,status:'submitted-to-radio',attemptCount:1,lastAttemptAt:Date.now(),nextAttemptAt:Date.now()+10000,...changes});

test('regional questions are durable and gated while original source, automation and stock stay independent',async()=>{
  const f=await fixture();let replacement;try{
    await f.core.setPaused(true);const body=report('durable');await f.core.receive(body,{allowedHubId:'ecsw'});await f.core.idle();
    await assert.rejects(f.core.askQuestion(body.caseId,'Which entrance?'),/updated phone/);
    await f.core.receiveMessages(snapshot(body.caseId,[]),{allowedHubId:'ecsw'});
    const before=structuredClone(f.store.state.cases[0]),stock=structuredClone(f.store.state.allocations);
    const q=await f.core.askQuestion(body.caseId,'Which entrance?');assert.match(q.id,/^[0-9a-f]{8}$/);assert.equal(q.status,'queued-to-local-hub');
    const saved=f.store.state.cases[0];assert.deepEqual(saved.request,before.request);assert.deepEqual(saved.location,before.location);assert.equal(saved.revision,before.revision);assert.equal(saved.status,before.status);assert.deepEqual(f.store.state.allocations,stock);assert.equal(f.store.state.automationPaused,true);
    const store=await new SupervisorStore(f.directory).load();replacement=new SupervisorCore({store,planner:new NemotronPlanner({enabled:false})});
    assert.deepEqual(replacement.updates('ecsw',store.state.sequence).questions,[{id:q.id,caseId:body.caseId,text:q.text,action:'ask',createdAt:q.createdAt}]);
    assert.equal(replacement.publicCase(store.state.cases[0]).followupCommands,undefined);
    assert.equal(replacement.publicCase(store.state.cases[0]).canContactUser,true);
  }finally{await replacement?.close();await f.cleanup();}
});

test('source snapshot confirms a command once and preserves answered state through delayed retries',async()=>{
  const f=await fixture();try{
    const body=await source(f),q=await f.core.askQuestion(body.caseId,'Which entrance?');
    await f.core.receiveMessages(snapshot(body.caseId,[incoming(q)]),{allowedHubId:'ecsw'});
    assert.equal(f.core.pendingQuestions('ecsw').length,0);assert.equal(f.store.state.cases[0].followups.length,1);
    const answer={text:'West entrance.',receivedAt:Date.now(),createdAt:Date.now()-1000,sequence:22,location:{latitude:32.9861,longitude:-96.7513,accuracy:12,capturedAt:Date.now()-1000}};
    const answered=incoming(q,{status:'answered',answer});
    await f.core.receiveMessages(snapshot(body.caseId,[answered]),{allowedHubId:'ecsw'});
    await f.core.receiveMessages(snapshot(body.caseId,[answered]),{allowedHubId:'ecsw'});
    await f.core.receiveMessages(snapshot(body.caseId,[incoming(q)]),{allowedHubId:'ecsw'});
    const saved=f.store.state.cases[0];assert.equal(saved.followups.length,1);assert.equal(saved.followups[0].status,'answered');assert.deepEqual(saved.followups[0].answer,answer);assert.equal(f.store.state.cases.length,1);assert.deepEqual(saved.request,body.request);assert.equal(f.store.state.allocations.length,0);
    const before=structuredClone(f.store.state);await assert.rejects(f.core.receiveMessages(snapshot(body.caseId,[incoming(q,{status:'answered',answer:{...answer,text:'Different answer'}})]),{allowedHubId:'ecsw'}),/Conflicting answer/);assert.deepEqual(f.store.state,before);
  }finally{await f.cleanup();}
});

test('message scope, question ownership and text boundaries reject forged source changes without mutation',async()=>{
  const f=await fixture();try{
    const body=await source(f,'first'),other=report('second');await f.core.receive(other,{allowedHubId:'ecsw'});await f.core.idle();
    const q=await f.core.askQuestion(body.caseId,'Which building?');const before=structuredClone(f.store.state);
    await assert.rejects(f.core.receiveMessages(snapshot(body.caseId,[incoming(q)]),{allowedHubId:'plano'}),/scope/);
    await assert.rejects(f.core.receiveMessages(snapshot(other.caseId,[incoming(q)]),{allowedHubId:'ecsw'}),/Unknown regional/);
    await assert.rejects(f.core.receiveMessages(snapshot(body.caseId,[incoming(q,{text:'Replaced question'})]),{allowedHubId:'ecsw'}),/Conflicting question/);
    await assert.rejects(f.core.receiveMessages({...snapshot(body.caseId,[]),keyHex:'not-accepted'},{allowedHubId:'ecsw'}),/snapshot/);
    await assert.rejects(f.core.askQuestion(other.caseId,'💧'.repeat(17)),/question/);await assert.rejects(f.core.askQuestion(other.caseId,'Line\nbreak'),/question/);
    assert.deepEqual(f.store.state,before);
    const local=incoming({id:'1234abcd',text:'Any nearby landmark?',source:'local',createdAt:Date.now()}, {frame:'must-not-be-exposed',digest:'private-internal'});
    await f.core.receiveMessages(snapshot(body.caseId,[local]),{allowedHubId:'ecsw'});
    const exposed=f.core.publicCase(f.store.state.cases[0]).followups.find(x=>x.id===local.id);assert.equal(exposed.frame,undefined);assert.equal(exposed.digest,undefined);
  }finally{await f.cleanup();}
});

test('blocked source commands stop retrying and closing releases the single-open-question limit',async()=>{
  const f=await fixture();try{
    const body=await source(f),q=await f.core.askQuestion(body.caseId,'Which entrance?');
    await assert.rejects(f.core.askQuestion(body.caseId,'Any other detail?'),/already waiting/);
    await f.core.receiveMessages(snapshot(body.caseId,[],{commandErrors:[{id:q.id,code:'blocked'}]}),{allowedHubId:'ecsw'});
    assert.equal(f.core.pendingQuestions('ecsw').length,0);assert.equal(f.store.state.cases[0].followups[0].status,'blocked');
    const next=await f.core.askQuestion(body.caseId,'Any nearby landmark?');await f.core.closeQuestion(body.caseId,next.id);
    assert.equal(f.core.pendingQuestions('ecsw')[0].action,'close');
    await f.core.receiveMessages(snapshot(body.caseId,[],{commandErrors:[{id:next.id,code:'closed'}]}),{allowedHubId:'ecsw'});
    assert.equal(f.store.state.cases[0].followups.find(x=>x.id===next.id).status,'closed');assert.equal(f.core.pendingQuestions('ecsw').length,0);
    await f.core.askQuestion(body.caseId,'Can you describe the doorway?');
  }finally{await f.cleanup();}
});

test('pending regional radio commands are bounded and exercise sources cannot impersonate phones',async()=>{
  const f=await fixture();try{
    await f.core.setPaused(true);
    for(let i=0;i<9;i++){const body=report('cap-'+i);await f.core.receive(body,{allowedHubId:'ecsw'});await f.core.receiveMessages(snapshot(body.caseId,[]),{allowedHubId:'ecsw'});if(i<8)await f.core.askQuestion(body.caseId,'Which building?');else await assert.rejects(f.core.askQuestion(body.caseId,'Which building?'),/queue is full/);}
    assert.equal(f.core.pendingQuestions('ecsw').length,8);assert.equal(f.core.pendingQuestions('plano').length,0);
    const item=f.store.state.cases[8];item.internalSimulation=true;await assert.rejects(f.core.askQuestion(item.caseId,'Which building?'),/physical/);
  }finally{await f.cleanup();}
});

test('message API separates scoped machine messages from CSRF-protected human questions',async()=>{
  const f=await fixture();let app;try{
    const body=await source(f),operatorToken='synthetic-messaging-operator',machineToken='synthetic-messaging-machine';
    app=await createSupervisorServer({core:f.core,operatorToken,hubTokens:{ecsw:machineToken,plano:'synthetic-other-machine'}});const{origin}=await app.listen(0);
    const endpoint=origin+'/api/cases/'+encodeURIComponent(body.caseId)+'/questions';
    const headers={'Content-Type':'application/json',Origin:origin};
    assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({text:'Which entrance?'})})).status,401);
    const login=await fetch(origin+'/api/login',{method:'POST',headers,body:JSON.stringify({username:'operator',password:operatorToken})});const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
    assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({text:'Which entrance?'})})).status,403);
    const accepted=await fetch(endpoint,{method:'POST',headers:{...headers,Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({text:'Which entrance?'})});assert.equal(accepted.status,202);const{question:q}=await accepted.json();
    const input=snapshot(body.caseId,[incoming(q)]);
    assert.equal((await fetch(origin+'/api/hub/messages',{method:'POST',headers:{...headers,Authorization:'Bearer synthetic-other-machine'},body:JSON.stringify(input)})).status,403);
    const synced=await fetch(origin+'/api/hub/messages',{method:'POST',headers:{...headers,Authorization:'Bearer '+machineToken},body:JSON.stringify(input)});assert.equal(synced.status,200);assert.deepEqual(await synced.json(),{accepted:true,caseId:body.caseId});
    const state=await(await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.cases[0].followups[0].status,'submitted-to-radio');assert.equal(state.cases[0].followupCommands,undefined);
  }finally{await app?.close();await f.cleanup();}
});
