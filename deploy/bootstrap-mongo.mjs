import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';

const root=process.env.RESCUEMESH_RUNTIME_ROOT || 'C:/Users/abhim/Documents/rescuemesh-runtime';
const privateRoot=resolve(root,'.private');
const secretFile=resolve(privateRoot,'mongodb-secrets.json');
const port=27018;
let phase='read-secrets';
try {
  await mkdir(privateRoot,{recursive:true});
  let secrets;
  try {secrets=JSON.parse(await readFile(secretFile,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;secrets={schema:1,adminUser:'rescuemesh_bootstrap',adminPassword:randomBytes(32).toString('base64url'),appUser:'rescuemesh_app',appPassword:randomBytes(32).toString('base64url'),database:'rescuemesh',createdAt:new Date().toISOString()};await writeFile(secretFile,JSON.stringify(secrets,null,2)+'\n',{mode:0o600});}
  if(!secrets.supervisorUser){secrets.supervisorUser='rescuemesh_supervisor_app';secrets.supervisorPassword=randomBytes(32).toString('base64url');secrets.supervisorDatabase='rescuemesh_supervisor';await writeFile(secretFile,JSON.stringify(secrets,null,2)+'\n',{mode:0o600});}
  const adminUri=`mongodb://${encodeURIComponent(secrets.adminUser)}:${encodeURIComponent(secrets.adminPassword)}@127.0.0.1:${port}/admin?authSource=admin&directConnection=true`;
  let admin=new MongoClient(adminUri,{serverSelectionTimeoutMS:5000});
  try {await admin.connect();await admin.db('admin').command({ping:1});}
  catch(error){
    await admin.close().catch(()=>{});
    phase='localhost-bootstrap';
    const first=new MongoClient(`mongodb://127.0.0.1:${port}/admin?directConnection=true`,{serverSelectionTimeoutMS:5000});
    try {await first.connect();await first.db('admin').command({createUser:secrets.adminUser,pwd:secrets.adminPassword,roles:[{role:'userAdminAnyDatabase',db:'admin'},{role:'hostManager',db:'admin'}]});}
    finally{await first.close().catch(()=>{});}
    admin=new MongoClient(adminUri,{serverSelectionTimeoutMS:5000});await admin.connect();
  }
  phase='application-user';
  try {await admin.db(secrets.database).command({createUser:secrets.appUser,pwd:secrets.appPassword,roles:[{role:'readWrite',db:secrets.database}]});}
  catch(error){if(error.code!==51003)throw error;}
  try {await admin.db(secrets.supervisorDatabase).command({createUser:secrets.supervisorUser,pwd:secrets.supervisorPassword,roles:[{role:'readWrite',db:secrets.supervisorDatabase}]});}
  catch(error){if(error.code!==51003)throw error;}
  await admin.close();
  const mongoUri=`mongodb://${encodeURIComponent(secrets.appUser)}:${encodeURIComponent(secrets.appPassword)}@127.0.0.1:${port}/${secrets.database}?authSource=${secrets.database}&directConnection=true`;
  phase='authenticated-verification';
  const app=new MongoClient(mongoUri,{serverSelectionTimeoutMS:5000});await app.connect();
  const checks=app.db(secrets.database).collection('runtime_checks');
  await checks.updateOne({_id:'rescuemesh-provider-check'},{$set:{kind:'synthetic-runtime-check',checkedAt:new Date()}},{upsert:true});
  const found=await checks.findOne({_id:'rescuemesh-provider-check'},{projection:{_id:1,kind:1}});
  await app.close();
  phase='unauthenticated-denial';
  let unauthenticatedDenied=false;
  const unauthed=new MongoClient(`mongodb://127.0.0.1:${port}/${secrets.database}?directConnection=true`,{serverSelectionTimeoutMS:5000});
  try{await unauthed.connect();await unauthed.db(secrets.database).collection('runtime_checks').findOne({});}
  catch(error){unauthenticatedDenied=error.code===13 || error.code===18;}
  finally{await unauthed.close().catch(()=>{});}
  if(!unauthenticatedDenied||!found)throw new Error('verification-failed');
  await writeFile(resolve(privateRoot,'mongo-app-uri.txt'),mongoUri+'\n',{mode:0o600});
  await writeFile(resolve(privateRoot,'mongo-app.json'),JSON.stringify({mongoUri,mongoDatabase:secrets.database},null,2)+'\n',{mode:0o600});
  phase='supervisor-database';
  const supervisorUri=`mongodb://${encodeURIComponent(secrets.supervisorUser)}:${encodeURIComponent(secrets.supervisorPassword)}@127.0.0.1:${port}/${secrets.supervisorDatabase}?authSource=${secrets.supervisorDatabase}&directConnection=true`;
  const supervisor=new MongoClient(supervisorUri,{serverSelectionTimeoutMS:5000});
  try{await supervisor.connect();await supervisor.db(secrets.supervisorDatabase).collection('runtime_checks').updateOne({_id:'rescuemesh-provider-check'},{$set:{kind:'synthetic-runtime-check',checkedAt:new Date()}},{upsert:true});if(!await supervisor.db(secrets.supervisorDatabase).collection('runtime_checks').findOne({_id:'rescuemesh-provider-check'}))throw new Error('supervisor-verification-failed');}
  finally{await supervisor.close();}
  await writeFile(resolve(privateRoot,'mongo-supervisor.json'),JSON.stringify({mongoUri:supervisorUri,mongoDatabase:secrets.supervisorDatabase},null,2)+'\n',{mode:0o600});
  const receipt={host:process.env.COMPUTERNAME,checkedAt:new Date().toISOString(),community:true,atlas:false,port,database:secrets.database,supervisorDatabase:secrets.supervisorDatabase,supervisorAuthenticatedReadWrite:true,authenticatedReadWrite:true,unauthenticatedDenied:true,secretFile,applicationConfig:resolve(privateRoot,'mongo-app.json')};
  await writeFile(resolve(root,'mongo-verification.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} catch(error){console.error(JSON.stringify({ok:false,phase,errorCode:error.code||error.name}));process.exitCode=1;}
