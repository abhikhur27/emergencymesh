import test from 'node:test';
import assert from 'node:assert/strict';
import {MongoMirror} from '../src/mongo.mjs';

test('Mongo retention removes only absent owned generated SIM documents and prunes cache',async()=>{
 const operations=[];
 const collection={updateOne:async()=>{},deleteMany:async filter=>operations.push({action:'delete',filter}),updateMany:async(filter,update)=>operations.push({action:'archive',filter,update}),bulkWrite:async()=>{}};
 const mirror=new MongoMirror({uri:'mongodb://127.0.0.1:1'});mirror.db={collection:name=>name==='cases'?collection:{...collection,deleteMany:async()=>{}}};
 mirror.caseHashes.set('old-sim','old');mirror.caseHashes.set('ecsw:physical','physical');
 mirror.latest={users:[],sessions:[],cases:[{caseId:'ecsw:physical',internalSimulation:false},{caseId:'kept-sim',internalSimulation:true,archived:true}],events:[],resources:{},simulation:{},automationPaused:false};
 await mirror.sync();assert.equal(mirror.status.connected,true);
 assert.equal(mirror.caseHashes.has('old-sim'),false);assert.equal(mirror.caseHashes.has('ecsw:physical'),true);
 const deletion=operations.find(item=>item.action==='delete').filter;
 assert.equal(deletion.owner,'rescuemesh-supervisor');assert.equal(deletion.internalSimulation,true);assert.equal(deletion.archived,true);assert.deepEqual(deletion.caseId,{$nin:['kept-sim']});
 const archive=operations.find(item=>item.action==='archive');assert.equal(archive.filter.internalSimulation,true);assert.equal(archive.update.$set.archived,true);
});
