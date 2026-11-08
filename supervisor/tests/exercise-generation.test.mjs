import test from 'node:test';
import assert from 'node:assert/strict';
import {NemotronPlanner} from '../src/planner.mjs';
import {fixture} from './helpers.mjs';
const scenario={hubId:'plano',source:{kind:'simulated'},request:{category:5,severity:3,people:2,note:'Drinking water requested at the demo check-in.'},summary:{resource:'water'}};
test('Brev generates only bounded fictional wording and keeps selected facts and resource policy immutable',async()=>{
  const bodies=[];const planner=new NemotronPlanner({model:'nemotron-3-nano:30b',baseUrl:'http://127.0.0.1:11435',provider:'brev',fetchImpl:async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({message:{content:JSON.stringify({note:'Two people request drinking water at the exercise check-in.'})}})};}});
  const original=structuredClone(scenario),result=await planner.describeExercise(scenario);assert.equal(result.generation.source,'nemotron');assert.equal(result.generation.model,'nemotron-3-nano:30b');assert.deepEqual(scenario,original);
  assert.equal(planner.status().exerciseGeneration.generatedScenarios,1);assert.equal(bodies[0].format.additionalProperties,false);assert.equal(bodies[0].messages[1].content.includes(scenario.request.note),false);
  const count=bodies.length;assert.equal((await planner.describeExercise({...scenario,source:{kind:'radio'}})).generation.source,'seeded-policy');assert.equal(bodies.length,count);
});
test('invalid generated text, changed source policy or absent cloud provider uses visibly seeded wording',async()=>{
  for(const content of ['not json',JSON.stringify({note:'Supply kits only.'}),JSON.stringify({note:'a'.repeat(121)}),JSON.stringify({note:'Drinking water.',priority:1})]){
    const planner=new NemotronPlanner({model:'nemotron-3-nano:30b',baseUrl:'http://127.0.0.1:11435',provider:'brev',fetchImpl:async()=>({ok:true,json:async()=>({message:{content}})})});
    const result=await planner.describeExercise(scenario);assert.equal(result.generation.source,'seeded-policy');assert.equal(result.note,scenario.request.note);assert.match(planner.status().exerciseGeneration.lastError,/seeded scenario retained/);
  }
  const local=new NemotronPlanner({fetchImpl:async()=>{throw new Error('Must not call a desktop model');}});assert.equal((await local.describeExercise(scenario)).generation.source,'seeded-policy');
});
test('generated town provenance is durable and does not replace fixed source priority or headcount',async()=>{
  const planner={enabled:true,status:()=>({mode:'synthetic'}),describeExercise:async input=>({note:input.request.note,generation:{source:'nemotron',model:'synthetic-model',at:Date.now()}}),plan:async(item,need,catalog)=>({townId:catalog.find(t=>t.available>=need.quantity).townId,resource:need.resource,quantity:need.quantity,source:'rules-fallback'})};
  const f=await fixture({planner});try{await f.core.simulationStep();await f.core.idle();const item=f.store.state.cases[0];assert.equal(item.generation.source,'nemotron');assert.equal(item.source.kind,'simulated');assert.equal(item.request.severity,3);assert.ok(item.request.people>=1&&item.request.people<=3);assert.equal(item.internalSimulation,true);}finally{await f.cleanup();}
});
