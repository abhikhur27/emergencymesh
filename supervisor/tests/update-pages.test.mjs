import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
test('reconnecting source drains large update history within the source count and byte budgets',async()=>{
 const f=await fixture();try{
  f.store.state.updates=Array.from({length:251},(_,i)=>({seq:i+1,hubId:'ecsw',caseId:'ecsw:synthetic-'+i,revision:1,status:'received',allocation:null,events:Array.from({length:30},()=>({action:'lookup_resources',detail:'地域'.repeat(200)})),updatedAt:Date.now(),simulation:true}));
  f.store.state.sequence=251;let cursor=0,pages=0;const seen=[];
  do{const page=f.core.updates('ecsw',cursor);assert.ok(page.updates.length>0&&page.updates.length<=100);assert.ok(Buffer.byteLength(JSON.stringify(page))<65536);assert.ok(page.cursor>cursor);assert.ok(page.updates.every(u=>u.events.length<=12));seen.push(...page.updates.map(u=>u.seq));cursor=page.cursor;pages++;if(!page.more)break;assert.ok(pages<252);}while(true);
  assert.deepEqual(seen,Array.from({length:251},(_,i)=>i+1));assert.ok(pages>1);assert.equal(f.store.state.updates[0].events.length,30);assert.deepEqual(f.core.updates('ecsw',cursor).updates,[]);
 }finally{await f.cleanup();}
});
