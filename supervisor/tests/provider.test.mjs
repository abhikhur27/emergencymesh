import test from 'node:test';
import assert from 'node:assert/strict';
import {inferenceSettings} from '../src/config.mjs';
import {NemotronPlanner} from '../src/planner.mjs';

test('verified dedicated Brev configuration overrides legacy local runner environment',()=>{
 const actual=inferenceSettings({inference:{provider:'brev',model:'nemotron-3-nano:30b',baseUrl:'http://127.0.0.1:11435',verifiedAt:'2026-11-08T12:00:00Z'}},{OLLAMA_HOST:'http://127.0.0.1:11434',OLLAMA_MODEL:'nemotron-3-nano:4b'});
 assert.equal(actual.modelProvider,'brev');assert.equal(actual.model,'nemotron-3-nano:30b');assert.equal(actual.modelBase,'http://127.0.0.1:11435');
 const planner=new NemotronPlanner({model:actual.model,baseUrl:actual.modelBase,provider:actual.modelProvider,verifiedAt:actual.modelVerifiedAt});
 assert.equal(planner.status().hosting,'brev');assert.equal(planner.status().transport,'private-ssh-forward');
});
test('Brev provider cannot silently use a desktop or public model endpoint',()=>{
 for(const baseUrl of ['http://127.0.0.1:11434','http://gpu.example:11434','https://secret:password@gpu.example'])assert.throws(()=>inferenceSettings({inference:{provider:'brev',model:'nemotron-3-nano:30b',baseUrl}},{}));
 assert.throws(()=>inferenceSettings({inference:{provider:'brev',model:'nemotron-3-nano:4b',baseUrl:'http://127.0.0.1:11435'}},{}));
 assert.equal(inferenceSettings({},{}).modelProvider,'local');
});
test('unavailable Brev inference stays labeled Brev and uses policy rather than another LLM',async()=>{
 const endpoints=[];const planner=new NemotronPlanner({provider:'brev',model:'nemotron-3-nano:30b',baseUrl:'http://127.0.0.1:11435',fetchImpl:async endpoint=>{endpoints.push(endpoint);throw new Error('synthetic disconnected SSH');}});
 const result=await planner.plan({caseId:'synthetic',hubId:'ecsw',request:{category:5,severity:3,people:2},location:{kind:'landmark'}},{resource:'water',quantity:2},[{townId:'plano',available:8}]);
 assert.equal(result.source,'rules-fallback');assert.equal(planner.status().hosting,'brev');assert.deepEqual(endpoints,['http://127.0.0.1:11435/api/chat']);assert.equal(planner.status().lastSuccessAt,null);
});
