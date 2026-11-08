import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SupervisorStore } from '../src/store.mjs';
import { SupervisorCore } from '../src/core.mjs';
import { NemotronPlanner } from '../src/planner.mjs';
export function report(id='one',changes={}){
  const caseId='ecsw:'+id;
  return {schema:'rescuemesh.case.v1',eventId:caseId+':r1',hubId:'ecsw',caseId,revision:1,source:{kind:'radio',requestId:id,receivedAt:Date.now()},request:{category:5,severity:2,people:2,note:'Need drinking water.'},summary:{text:'Two people request drinking water.',resource:'water',quantity:2},location:{kind:'landmark',label:'UT Dallas ECSW',verified:false},...changes};
}
export async function fixture(options={}){
  const directory=await mkdtemp(join(tmpdir(),'rescuemesh-supervisor-test-'));
  const store=await new SupervisorStore(directory).load();
  const core=new SupervisorCore({store,planner:new NemotronPlanner({enabled:false}),...options});
  return {directory,store,core,cleanup:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
