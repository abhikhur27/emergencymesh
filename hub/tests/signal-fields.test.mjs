import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encodeRequest, decodeFrame } from '../src/codec.mjs';
import { reportedSupplies, sourceNeedRequests, signalFacts, needsLocalInterpretation } from '../src/signal-fields.mjs';
import { runLocalAgent } from '../src/local-agent.mjs';
import { DEFAULT_REGION } from '../src/region.mjs';

const request={category:6,severity:2,people:3,flags:1|16|32|64|128,createdAt:1794000000,latitude:32.9861,longitude:-96.7514,accuracy:12,battery:80,note:'ECSW'};

test('typed supplies and expanded disaster category survive the unchanged encrypted v1 envelope',()=>{
  const key=randomBytes(32),config={region:1,keyId:1,key};
  const frame=encodeRequest(request,{region:1,keyId:1,origin:123,sequence:1,hops:3},key);
  const decoded=decodeFrame(frame,config);
  assert.equal(frame[2],1);assert.equal(frame[3],1);assert.equal(frame.length,64+Buffer.byteLength(request.note));
  assert.deepEqual(decoded.request,request);
  assert.deepEqual(reportedSupplies(decoded.request),['food','water','medicine','power']);
  assert.equal(signalFacts(decoded.request).categoryLabel,'Flood');
  for(const category of [0,9])assert.throws(()=>encodeRequest({...request,category},{region:1,keyId:1,origin:123,sequence:1},key));
  for(const flags of [-1,256,1.5])assert.throws(()=>encodeRequest({...request,flags},{region:1,keyId:1,origin:123,sequence:1},key));
});

test('reported needs remain explicit facts and planning quantities identify their policy origin',()=>{
  const needs=sourceNeedRequests(request);
  assert.deepEqual(needs.map(n=>n.resource),['rescue','food','water','medicine','power']);
  assert.deepEqual(needs[0],{resource:'rescue',quantity:1,quantityBasis:'policy-one-team',source:'category-policy'});
  for(const n of needs.slice(1)){assert.equal(n.quantity,3);assert.equal(n.quantityBasis,'policy-per-person');assert.equal(n.source,'signal');}
  assert.equal(signalFacts(request).note,'ECSW');
  assert.deepEqual(sourceNeedRequests({...request,category:5,flags:32}).map(n=>n.resource),['water']);
  assert.equal(sourceNeedRequests({...request,category:5,flags:0,note:'Need drinking water'})[0].resource,'water');
  assert.equal(sourceNeedRequests({...request,category:1,flags:0,note:''})[0].quantity,1);
});

test('complete signal requests and landmark-only notes bypass inference while preserving source and catalog contact',async()=>{
  let fetches=0;const events=[];
  const result=await runLocalAgent(request,{caseId:'signal-synthetic',region:DEFAULT_REGION,enabled:true,fetchImpl:async()=>{fetches++;throw Error('Must not call model');},onTool:async e=>events.push(e)});
  assert.equal(fetches,0);assert.equal(result.source,'signal');assert.equal(result.model,null);
  assert.deepEqual(result.reportedSupplies,['food','water','medicine','power']);assert.deepEqual(result.needRequests,sourceNeedRequests(request));
  assert.ok(events.some(e=>e.action==='signal_fields'));assert.ok(events.some(e=>e.action==='lookup_resources'));
  assert.equal(needsLocalInterpretation({...request,flags:0,note:'near ECSW'},DEFAULT_REGION),false);
  assert.equal(needsLocalInterpretation({...request,flags:0,note:''},DEFAULT_REGION),false);
  assert.equal(needsLocalInterpretation({...request,flags:0,note:'Water is rising inside the building.'},DEFAULT_REGION),true);
  assert.deepEqual(request,{category:6,severity:2,people:3,flags:241,createdAt:1794000000,latitude:32.9861,longitude:-96.7514,accuracy:12,battery:80,note:'ECSW'});
});
