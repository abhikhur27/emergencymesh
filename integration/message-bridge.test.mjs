import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { IncidentStore } from '../hub/src/store.mjs';
import { HubCore } from '../hub/src/core.mjs';
import { CoordinationPipeline } from '../hub/src/coordination.mjs';
import { DEFAULT_REGION } from '../hub/src/region.mjs';
import { encodeRequest,decodeFrame } from '../hub/src/codec.mjs';
import { encodeReplyNote,CAPABILITY_NOTE } from '../hub/src/followup.mjs';
import { checkedCommands } from '../hub/src/message-bridge.mjs';
import { SupervisorStore } from '../supervisor/src/store.mjs';
import { SupervisorCore } from '../supervisor/src/core.mjs';
import { NemotronPlanner } from '../supervisor/src/planner.mjs';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function fixture(t,{capability=true,loseMessageAck=false}={}){
  const directory=await mkdtemp(join(tmpdir(),'rescuemesh-message-bridge-')),config={region:1,keyId:1,key:randomBytes(32),hubOrigin:456},store=await new IncidentStore(join(directory,'local')).load();
  const regionalStore=await new SupervisorStore(join(directory,'regional')).load(),regional=new SupervisorCore({store:regionalStore,planner:new NemotronPlanner({enabled:false})});await regional.setPaused(true);
  const frames=[],core=new HubCore({config,store,standaloneSummary:false,transmit:async frame=>frames.push(Buffer.from(frame))});store.state.automation={paused:true,cursor:0};
  let lost=false;const posted=[];
  const fetchImpl=async(url,options)=>{
    const path=new URL(url).pathname;
    if(path==='/api/hub/cases'){const accepted=await regional.receive(JSON.parse(options.body),{allowedHubId:'ecsw'});return json(accepted,202);}
    if(path==='/api/hub/messages'){const body=JSON.parse(options.body);posted.push(body);const accepted=await regional.receiveMessages(body,{allowedHubId:'ecsw'});if(loseMessageAck&&body.followups.length&&!lost){lost=true;throw new Error('Synthetic lost message acknowledgment');}return json(accepted);}
    if(path==='/api/hub/updates')return json(regional.updates('ecsw',Number(new URL(url).searchParams.get('after'))));
    throw new Error('Unexpected test transport path '+path);
  };
  const options={core,region:DEFAULT_REGION,enabled:false,runtime:{hubId:'ecsw',supervisorUrl:'https://regional.test',supervisorToken:'synthetic-bridge-machine'},fetchImpl};
  const pipeline=new CoordinationPipeline(options);
  const request={category:5,severity:2,people:3,flags:0,createdAt:Math.floor(Date.now()/1000),latitude:0,longitude:0,accuracy:65535,battery:71,note:'Need drinking water near ECSW'};
  const frame=(sequence,body=request,origin=123)=>encodeRequest(body,{region:1,keyId:1,origin,sequence,hops:3},config.key);
  if(capability)await core.ingest(frame(1,{...request,category:8,severity:3,people:1,battery:255,note:CAPABILITY_NOTE}));
  const{id}=await core.ingest(frame(2));await pipeline.prepare(id);await pipeline.share(id);await regional.idle();await pipeline.pollUpdates();
  t.after(async()=>{await pipeline.close();await regional.close();await rm(directory,{recursive:true,force:true});});
  return{directory,config,core,store,regional,regionalStore,frames,posted,pipeline,options,request,frame,id,caseId:store.get(id).coordination.caseId};
}

test('regional question crosses the paused source hub and authenticated answer returns without another incident or reservation',async t=>{
  const f=await fixture(t),original=structuredClone(f.store.get(f.id).request),q=await f.regional.askQuestion(f.caseId,'Which entrance?');
  await f.pipeline.pollUpdates();const local=f.core.publicIncident(f.store.get(f.id));assert.equal(local.followups.length,1);assert.equal(local.followups[0].source,'regional');assert.equal(local.followups[0].status,'submitted-to-radio');assert.equal(f.regional.pendingQuestions('ecsw').length,0);assert.equal(f.store.state.automation.paused,true);
  const questionFrame=decodeFrame(f.frames.at(-1),f.config);assert.equal(questionFrame.receipt.text,'RMQ1|'+q.id+'|Which entrance?');assert.equal(questionFrame.receipt.requestSequence,2);
  const reply=f.frame(3,{...f.request,note:encodeReplyNote(2,q.id,'West entrance.')});await f.core.ingest(reply);const receipt=Buffer.from(f.frames.at(-1));await f.pipeline.pollUpdates();
  const source=f.store.get(f.id),saved=f.regionalStore.state.cases.find(c=>c.caseId===f.caseId);assert.equal(source.followups.length,1);assert.equal(saved.followups[0].status,'answered');assert.equal(saved.followups[0].answer.text,'West entrance.');assert.equal(f.store.state.incidents.length,1);assert.equal(f.regionalStore.state.cases.length,1);assert.equal(f.regionalStore.state.allocations.length,0);assert.deepEqual(source.request,original);
  await f.core.ingest(reply);assert.deepEqual(f.frames.at(-1),receipt);await f.pipeline.pollUpdates();assert.equal(saved.followups.length,1);
});

test('a lost regional message acknowledgment is retried from durable question state after source pipeline restart',async t=>{
  const f=await fixture(t,{loseMessageAck:true}),q=await f.regional.askQuestion(f.caseId,'Which building?');await f.pipeline.pollUpdates();
  const question=f.store.get(f.id).followups[0];assert.equal(question.id,q.id);const encrypted=question.frame||question.encryptedFrame;const sent=f.frames.length;await f.pipeline.close();
  const reopened=new CoordinationPipeline(f.options);t.after(()=>reopened.close());await reopened.pollUpdates();
  assert.equal(f.store.get(f.id).followups.length,1);assert.equal(f.frames.length,sent);if(encrypted)assert.equal(f.store.get(f.id).followups[0].frame||f.store.get(f.id).followups[0].encryptedFrame,encrypted);assert.equal(f.regional.pendingQuestions('ecsw').length,0);assert.equal(f.regionalStore.state.cases[0].followups[0].id,q.id);
});

test('a concurrent local question blocks the regional command visibly instead of retrying forever',async t=>{
  const f=await fixture(t),regionalQuestion=await f.regional.askQuestion(f.caseId,'Which entrance?');
  await f.core.askQuestion(f.id,'Are you near a building?',{questionId:'1234abcd',source:'local'});await f.pipeline.pollUpdates();
  const questions=f.regionalStore.state.cases[0].followups;assert.equal(questions.find(q=>q.id===regionalQuestion.id).status,'blocked');assert.equal(questions.find(q=>q.id==='1234abcd').source,'local');assert.equal(f.regional.pendingQuestions('ecsw').length,0);assert.equal(f.store.get(f.id).followups.length,1);
});

test('closing a regional question reaches the local hub and permits a later question',async t=>{
  const f=await fixture(t),q=await f.regional.askQuestion(f.caseId,'Which entrance?');await f.pipeline.pollUpdates();await f.regional.closeQuestion(f.caseId,q.id);await f.pipeline.pollUpdates();
  assert.equal(f.core.publicIncident(f.store.get(f.id)).followups[0].status,'closed');assert.equal(f.regionalStore.state.cases[0].followups[0].status,'closed');assert.equal(f.regional.pendingQuestions('ecsw').length,0);
  await f.regional.askQuestion(f.caseId,'Any nearby landmark?');
});

test('a legacy phone does not advertise readiness and malformed commands are rejected before radio submission',async t=>{
  const f=await fixture(t,{capability:false});assert.equal(f.posted.length,0);assert.equal(f.regional.publicCase(f.regionalStore.state.cases[0]).canContactUser,false);await assert.rejects(f.regional.askQuestion(f.caseId,'Which entrance?'),/updated phone/);
  const base={id:'1234abcd',caseId:f.caseId,text:'Which building?',createdAt:Date.now(),action:'ask'};
  assert.throws(()=>checkedCommands([{...base,caseId:'plano:foreign'}],'ecsw'),/command/);assert.throws(()=>checkedCommands([{...base,text:'💧'.repeat(17)}],'ecsw'),/66/);assert.throws(()=>checkedCommands([base,base],'ecsw'),/Duplicate/);
});
