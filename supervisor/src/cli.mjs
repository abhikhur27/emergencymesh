import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { provision,readEnvFile,dataPath } from './config.mjs';
import { MongoMirror } from './mongo.mjs';
import { SupervisorStore } from './store.mjs';
import { NemotronPlanner } from './planner.mjs';
import { SupervisorCore } from './core.mjs';
import { createSupervisorServer } from './server.mjs';

function args(input){const result={command:input.shift()||'start'};while(input.length){const key=input.shift();if(['--no-model','--simulate-towns'].includes(key))result[key.slice(2)]=true;else if(['--data','--port','--until','--model'].includes(key)&&input.length)result[key.slice(2)]=input.shift();else throw new Error('Unknown or incomplete supervisor argument');}return result;}
async function main(){
  await readEnvFile();const options=args(process.argv.slice(2)),directory=dataPath(options.data),settings=await provision(directory);
  if(options.command==='provision'){console.log(JSON.stringify({product:'RescueMesh',configuration:settings.configFile,operatorCredentialFile:settings.operatorFile,ecswMachineCredentialFile:settings.machineFile}));return;}
  const modelTimeout=options.command==='model-check'?Math.min(180000,Math.max(1000,Number(process.env.RESCUEMESH_MODEL_CHECK_TIMEOUT_MS)||150000)):Math.min(60000,Math.max(1000,Number(process.env.RESCUEMESH_MODEL_TIMEOUT_MS)||20000));
  const planner=new NemotronPlanner({enabled:!options['no-model'],model:options.model||settings.model,baseUrl:settings.modelBase,timeoutMs:modelTimeout});
  if(options.command==='model-check'){
    const tools=[];const item={caseId:'model-check-synthetic',hubId:'ecsw',request:{category:5,severity:3,people:2},location:{kind:'landmark'}};const plan=await planner.plan(item,{resource:'water',quantity:2},[{townId:'plano',available:8},{townId:'garland',available:4},{townId:'addison',available:6}],async(action,arguments_,result)=>{tools.push({action,arguments:arguments_,result});});
    const receipt={at:new Date().toISOString(),synthetic:true,model:planner.status(),tools,plan,realServicesContacted:false};await writeFile(join(directory,'model-check.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));if(plan?.source!=='nemotron-tools')process.exitCode=2;return;
  }
  if(options.command!=='start')throw new Error('Use start, provision, or model-check');
  const port=Number(options.port||process.env.RESCUEMESH_SUPERVISOR_PORT||4782);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid supervisor port');
  const until=options.until?Date.parse(options.until):null;if(options.until&&(!Number.isFinite(until)||until<=Date.now()))throw new Error('Supervisor deadline must be in the future');
  const mirror=new MongoMirror({uri:settings.mongoUri,database:settings.mongoDatabase});await mirror.connect();
  const store=await new SupervisorStore(directory,{seed:settings.config.simulation?.seed||4207,mirror}).load();
  const core=new SupervisorCore({store,planner});const app=await createSupervisorServer({core,operatorToken:settings.operatorToken,username:settings.config.operatorUsername,hubTokens:settings.hubTokens,publicOrigin:settings.publicOrigin});
  const bound=await app.listen(port);core.start();if(options['simulate-towns'])await core.simulationCommand({action:'start'});
  console.log(JSON.stringify({product:'RescueMesh',role:'regional-supervisor',url:settings.publicOrigin||bound.origin,localOrigin:bound.origin,model:settings.model,operatorCredentialFile:settings.operatorFile,machineCredentialFile:settings.machineFile,simulationOnlyDispatch:true,until:until?new Date(until).toISOString():null}));
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();await core.close();await mirror.close();};
  process.once('SIGINT',()=>stop().finally(()=>process.exit(0)));process.once('SIGTERM',()=>stop().finally(()=>process.exit(0)));
  if(until)setTimeout(()=>stop().finally(()=>process.exit(0)),Math.min(2147483647,until-Date.now())).unref();
}
main().catch(()=>{console.error('Supervisor startup failed. Check private configuration and local dependencies. No secrets or report content were logged.');process.exitCode=1;});
