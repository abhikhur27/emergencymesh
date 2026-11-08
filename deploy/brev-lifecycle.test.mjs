import test from 'node:test';import assert from 'node:assert/strict';
import {validatePlan,parseWorkspaces,deleteOwned,runProcess} from './brev-lifecycle.mjs';
test('noninteractive CLI processes receive EOF rather than hanging on inherited batch input',async()=>{
 const result=await runProcess(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('input-closed'))"],{timeout:2000,windowsHide:true});assert.equal(result.stdout,'input-closed');
});
const plan={schema:1,deleteApproved:true,orgId:'org-3LopzuIu7SGwsNHFYGk5ipxB4Ru',orgName:'RescueMesh',instanceId:'synthetic01',instanceName:'rescuemesh-nemotron-30b-mc',hourlyRateUsd:0.68,creditCapUsd:30,createdAt:'2026-11-08T10:00:00Z',deadline:'2026-11-10T05:00:00Z'};
test('compute lifetime is bounded by both approved credit spend and deadline',()=>{
 const actual=validatePlan(plan);assert.equal(Date.parse(actual.deleteAt),Date.parse(plan.deadline));assert.ok(actual.estimatedMaximumUsd<30);
 const early=validatePlan({...plan,creditCapUsd:10});assert.ok(Date.parse(early.deleteAt)<Date.parse(plan.deadline));assert.ok(early.estimatedMaximumUsd<=9.8);
 const prior=validatePlan({...plan,priorProjectSpendUsd:2});assert.ok(prior.estimatedMaximumProjectUsd<=29.8);assert.ok(Date.parse(prior.deleteAt)<Date.parse(plan.deadline));
 for(const change of [{hourlyRateUsd:2},{creditCapUsd:60},{orgName:'Other'},{deleteApproved:false},{instanceId:'--all'},{deadline:'2026-11-11T05:00:00Z'}])assert.throws(()=>validatePlan({...plan,...change}));
});
test('inventory parse cannot mistake an authentication error for a deleted VM',()=>{assert.throws(()=>parseWorkspaces({error:'unauthorized'}));assert.deepEqual(parseWorkspaces({workspaces:null}),[]);});
test('cleanup targets only exact approved ID and authenticated organization',async()=>{
 const calls=[];const run=async args=>{calls.push(args);if(args[0]==='delete')return '';if(args[1]==='orgs')return JSON.stringify([{id:plan.orgId,name:plan.orgName}]);return JSON.stringify({workspaces:[{id:plan.instanceId,name:plan.instanceName,status:'Running'}]});};
 const result=await deleteOwned(plan,{run,now:()=>Date.parse(plan.deadline)});assert.equal(result.deleteRequested,true);assert.deepEqual(calls.at(-1),['delete','synthetic01','--org','RescueMesh','--no-check-latest']);assert.ok(calls.every(args=>!args.includes('--all')));
 await assert.rejects(deleteOwned(plan,{run,now:()=>Date.parse(plan.createdAt)}),/not due/);
});
test('organization API-key cleanup verifies saved org identity and never requests an org override',async()=>{
 const calls=[],keyPlan={...plan,authMode:'api-key'};
 const run=async args=>{calls.push(args);if(args[0]==='__auth_metadata')return JSON.stringify({apiKeyPresent:true,apiKeyOrganizationId:plan.orgId});if(args[0]==='delete')return '';return JSON.stringify({workspaces:[{id:plan.instanceId,name:plan.instanceName,status:'Running'}]});};
 assert.equal((await deleteOwned(keyPlan,{run,now:()=>Date.parse(plan.deadline)})).deleteRequested,true);
 assert.ok(calls.every(args=>!args.includes('--org')));assert.deepEqual(calls.at(-1),['delete',plan.instanceId,'--no-check-latest']);
 const wrong=async args=>args[0]==='__auth_metadata'?JSON.stringify({apiKeyPresent:true,apiKeyOrganizationId:'org-other'}):run(args);
 await assert.rejects(deleteOwned(keyPlan,{run:wrong,now:()=>Date.parse(plan.deadline)}),/exact approved organization/);
});
