import test from 'node:test';
import assert from 'node:assert/strict';
import { NemotronPlanner } from '../src/planner.mjs';
const item={caseId:'synthetic',hubId:'ecsw',request:{category:5,severity:1,people:2},location:{kind:'landmark'}};
const need={resource:'water',quantity:2};
const catalog=[{townId:'plano',available:8},{townId:'garland',available:0},{townId:'addison',available:6}];
test('model must query real catalog before an exactly matching policy proposal',async()=>{
 const received=[],tools=[];const replies=[{action:'lookup_resources',resource:'water'},{action:'propose_allocation',resource:'water',townId:'addison',quantity:2}];
 const planner=new NemotronPlanner({fetchImpl:async(url,options)=>{received.push(JSON.parse(options.body));const {action,...arguments_}=replies.shift();return {ok:true,json:async()=>({message:{content:'',tool_calls:[{function:{name:action,arguments:arguments_}}]}})};}});
 const result=await planner.plan(item,need,catalog,async(action,args,value)=>tools.push({action,args,value}));assert.equal(result.source,'nemotron-tools');assert.equal(result.townId,'addison');assert.equal(tools.length,2);assert.match(received[1].messages.at(-1).content,/"available":8/);assert.equal(planner.status().successfulToolCalls,2);assert.equal(item.request.severity,1);
});
test('unavailable model and invalid tool attempts use truthful bounded fallback',async()=>{
 for(const message of [{content:'not a tool call'},{content:'',tool_calls:[{function:{name:'propose_allocation',arguments:{resource:'water',quantity:2,townId:'plano'}}}]}]){
  let calls=0;const planner=new NemotronPlanner({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({message})};}});const result=await planner.plan(item,need,catalog);assert.equal(result.source,'rules-fallback');assert.equal(result.townId,'plano');assert.equal(planner.status().mode,'rules-fallback');assert.ok(calls<=3);
 }
 const offline=new NemotronPlanner({fetchImpl:async()=>{throw new Error('synthetic offline');}});assert.equal((await offline.plan(item,need,catalog)).source,'rules-fallback');assert.equal(offline.status().lastSuccessAt,null);assert.equal(await offline.plan(item,{resource:'water',quantity:20},catalog),null);
});
test('an Addison request limits model suppliers to other towns with enough stock',async()=>{
 const request={...item,hubId:'addison',request:{category:1,severity:3,people:3}};
 const required={resource:'medical',quantity:2};
 const inventory=[{townId:'addison',available:8},{townId:'plano',available:2},{townId:'garland',available:1}];
 const received=[],replies=[{name:'lookup_resources',arguments:{resource:'medical'}},{name:'propose_allocation',arguments:{resource:'medical',townId:'plano',quantity:2}}];
 const planner=new NemotronPlanner({fetchImpl:async(url,options)=>{received.push(JSON.parse(options.body));return {ok:true,json:async()=>({message:{content:'',tool_calls:[{function:replies.shift()}]}})};}});
 const result=await planner.plan(request,required,inventory);
 assert.equal(result.source,'nemotron-tools');assert.equal(result.townId,'plano');
 for(const body of received){
  assert.match(body.messages[0].content,/sourceHub is the requesting hub/);
  assert.match(body.messages[0].content,/never supply its own request/);
  const proposal=body.tools.find(t=>t.function.name==='propose_allocation');
  assert.deepEqual(proposal.function.parameters.properties.townId.enum,['plano']);
  assert.deepEqual(JSON.parse(body.messages[1].content).eligibleSupplierTownIds,['plano']);
 }
 const lookup=JSON.parse(received[1].messages.at(-1).content);
 assert.ok(lookup.options.every(t=>t.townId!=='addison'));
});
test('self-supply remains rejected when model output ignores its supplier schema',async()=>{
 const request={...item,hubId:'addison'},inventory=[{townId:'addison',available:8},{townId:'plano',available:3}];
 const actions=[],replies=[{name:'lookup_resources',arguments:{resource:'water'}},{name:'propose_allocation',arguments:{resource:'water',townId:'addison',quantity:2}},{name:'lookup_resources',arguments:{resource:'water'}}];
 const planner=new NemotronPlanner({fetchImpl:async()=>({ok:true,json:async()=>({message:{content:'',tool_calls:[{function:replies.shift()}]}})})});
 const result=await planner.plan(request,need,inventory,async(action,args,value)=>actions.push({action,value}));
 assert.equal(result.source,'rules-fallback');assert.equal(result.townId,'plano');
 assert.equal(actions.find(a=>a.action==='propose_allocation').value.valid,false);
 assert.equal(planner.status().successfulToolCalls,0);
 assert.equal((await new NemotronPlanner({enabled:false}).plan(request,need,inventory)).townId,'plano');
});
