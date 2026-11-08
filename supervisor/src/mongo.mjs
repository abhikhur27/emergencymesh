import { createHash } from 'node:crypto';
export class MongoMirror {
  constructor({uri='',database='rescuemesh_supervisor'}={}) {this.uri=uri;this.database=database;this.client=null;this.db=null;this.latest=null;this.syncing=false;this.pending=Promise.resolve();this.caseHashes=new Map();this.lastEventSeq=0;this.status={configured:Boolean(uri),connected:false,lastSyncedAt:null,lastError:null,backend:uri?'mongodb':'local-durable-spool'};}
  async connect(){
    if(!this.uri)return;
    try{const {MongoClient}=await import('mongodb');this.client=new MongoClient(this.uri,{serverSelectionTimeoutMS:2500,connectTimeoutMS:2500,maxPoolSize:3});await this.client.connect();this.db=this.client.db(this.database);await this.db.command({ping:1});await Promise.all([this.db.collection('users').createIndex({username:1},{unique:true}),this.db.collection('sessions').createIndex({expiresAt:1},{expireAfterSeconds:0}),this.db.collection('cases').createIndex({caseId:1},{unique:true}),this.db.collection('coordination_events').createIndex({seq:1},{unique:true})]);this.status.connected=true;this.status.lastError=null;}
    catch{this.status.connected=false;this.status.lastError='MongoDB unavailable; durable local spool remains active';}
  }
  enqueue(state){this.latest=structuredClone(state);this.pending=this.pending.then(()=>this.sync()).catch(()=>{});}
  sync(){if(this.activeSync)return this.activeSync;this.activeSync=this.syncOnce().finally(()=>{this.activeSync=null;});return this.activeSync;}
  async syncOnce(){
    if(!this.uri||!this.latest)return;
    this.syncing=true;const state=this.latest;this.latest=null;
    try{
      if(!this.db)await this.connect();if(!this.db)throw new Error('offline');
      for(const user of state.users)await this.db.collection('users').updateOne({username:user.username},{$set:{...user,owner:'rescuemesh-supervisor'}},{upsert:true});
      const ids=[];for(const session of state.sessions){ids.push(session.idHash);await this.db.collection('sessions').updateOne({idHash:session.idHash},{$set:{...session,expiresAt:new Date(session.expires),owner:'rescuemesh-supervisor'}},{upsert:true});}
      await this.db.collection('sessions').deleteMany({owner:'rescuemesh-supervisor',idHash:{$nin:ids}});
      const changed=state.cases.map(item=>({item,hash:createHash('sha256').update(JSON.stringify(item)).digest('hex')})).filter(({item,hash})=>this.caseHashes.get(item.caseId)!==hash);
      if(changed.length)await this.db.collection('cases').bulkWrite(changed.map(({item})=>({updateOne:{filter:{caseId:item.caseId},update:{$set:{...item,owner:'rescuemesh-supervisor'}},upsert:true}})),{ordered:false});
      const retainedSimIds=state.cases.filter(item=>item.internalSimulation).map(item=>item.caseId);
      const expiredSim={owner:'rescuemesh-supervisor',internalSimulation:true,caseId:{$nin:retainedSimIds}};
      await this.db.collection('cases').updateMany(expiredSim,{$set:{archived:true,archivedByRetention:true}});
      await this.db.collection('cases').deleteMany({...expiredSim,archived:true});
      const events=state.events.filter(item=>item.seq>this.lastEventSeq);if(events.length)await this.db.collection('coordination_events').bulkWrite(events.map(item=>({updateOne:{filter:{seq:item.seq},update:{$set:{...item,owner:'rescuemesh-supervisor'}},upsert:true}})),{ordered:false});
      await this.db.collection('runtime').updateOne({_id:'supervisor'},{$set:{resources:state.resources,simulation:state.simulation,automationPaused:state.automationPaused,at:Date.now()}},{upsert:true});
      for(const {item,hash}of changed)this.caseHashes.set(item.caseId,hash);if(events.length)this.lastEventSeq=events.at(-1).seq;
      const retainedIds=new Set(state.cases.map(item=>item.caseId));for(const id of this.caseHashes.keys())if(!retainedIds.has(id))this.caseHashes.delete(id);
      this.status.connected=true;this.status.lastSyncedAt=Date.now();this.status.lastError=null;
    }catch{this.status.connected=false;this.status.lastError='MongoDB unavailable; durable local spool remains active';if(!this.latest)this.latest=state;}
    finally{this.syncing=false;}
  }
  safeStatus(){return {...this.status};}
  async flush(){await this.pending;await this.sync();}
  async close(){await this.flush();await this.client?.close();}
}
