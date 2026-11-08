import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,report } from './helpers.mjs';
import { createSupervisorServer } from '../src/server.mjs';
import { SupervisorStore } from '../src/store.mjs';
import { SupervisorCore } from '../src/core.mjs';
import { NemotronPlanner } from '../src/planner.mjs';
const operatorToken='synthetic-operator-credential-for-tests-only';
const machineToken='synthetic-ecsw-machine-credential-for-tests-only';
async function server(core){const app=await createSupervisorServer({core,operatorToken,hubTokens:{ecsw:machineToken}});const {origin}=await app.listen(0);return {app,origin};}
test('operator session persists across server restart and logout revokes it; machine auth stays separate',async()=>{
 const f=await fixture();let app,restarted,core2;try{
  ({app,...restarted}=await server(f.core));let origin=restarted.origin;
  assert.equal((await fetch(origin+'/api/state')).status,401);
  assert.equal((await fetch(origin+'/api/hub/updates',{headers:{Authorization:'Bearer '+operatorToken}})).status,401);
  assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:operatorToken})})).status,403);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({username:'operator',password:operatorToken,remember:true})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/Max-Age=31536000/);const {csrf}=await login.json();
  assert.equal((await fetch(origin+'/api/automation',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{"paused":true}'})).status,403);
  assert.equal((await fetch(origin+'/api/automation',{method:'POST',headers:{Origin:'https://attacker.invalid',Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{"paused":true}'})).status,403);
  assert.equal((await fetch(origin+'/api/automation',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{"paused":true}'})).status,200);
  await app.close();app=null;const store=await new SupervisorStore(f.directory).load();core2=new SupervisorCore({store,planner:new NemotronPlanner({enabled:false})});({app,origin}=await server(core2));
  const state=await fetch(origin+'/api/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);assert.equal((await state.json()).automationPaused,true);
  const logout=await fetch(origin+'/api/logout',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);assert.equal((await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).status,401);
 }finally{await app?.close();await core2?.close();await f.cleanup();}
});
test('machine events are scoped, durable and idempotent; cursor updates are canonical',async()=>{
 const f=await fixture();const {app,origin}=await server(f.core);try{
  const headers={'Content-Type':'application/json',Authorization:'Bearer '+machineToken};const input=report();
  const first=await fetch(origin+'/api/hub/cases',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(first.status,202);await f.core.idle();
  const replay=await fetch(origin+'/api/hub/cases',{method:'POST',headers,body:JSON.stringify(input)});assert.equal((await replay.json()).duplicate,true);
  const updates=await fetch(origin+'/api/hub/updates?after=0&hubId=ecsw',{headers});const result=await updates.json();assert.equal(result.updates.at(-1).status,'simulated-dispatched');assert.equal(result.updates.at(-1).allocation.simulation,true);assert.ok(result.cursor>0);
  assert.equal((await fetch(origin+'/api/hub/updates?hubId=plano',{headers})).status,403);
  assert.equal((await fetch(origin+'/api/hub/cases',{method:'POST',headers,body:JSON.stringify({...input,hubId:'plano'})})).status,403);
  assert.equal((await fetch(origin+'/api/hub/updates?after=-1',{headers})).status,400);
  const health=await (await fetch(origin+'/api/health')).json();assert.deepEqual(Object.keys(health).sort(),['ok','product','realDispatch','role']);
  const home=await fetch(origin+'/');assert.equal(home.status,200);assert.match(await home.text(),/id="workspace"/);assert.match(home.headers.get('content-security-policy'),/object-src 'none'/);
 }finally{await app.close();await f.cleanup();}
});
