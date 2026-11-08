import {readFile,writeFile,rename,mkdir,open} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
export async function runProcess(file,args,options={}){
  const pending=execute(file,args,options);
  // Brev's batch commands scan piped stdin even when an explicit ID is supplied.
  // Close this owner's unused input so they receive EOF instead of waiting forever.
  pending.child?.stdin?.end();
  return pending;
}
const CLI='/home/abhim/.local/share/rescuemesh-tools/brev/0.6.337/bin/brev';
const ROOT='C:/Users/abhim/Documents/rescuemesh-runtime';
const HARD_DEADLINE=Date.parse('2026-11-10T05:00:00Z');
export function validatePlan(plan){
  if(plan.schema!==1||plan.deleteApproved!==true||plan.orgId!=='org-3LopzuIu7SGwsNHFYGk5ipxB4Ru'||plan.orgName!=='RescueMesh')throw new Error('Owned organization and explicit deletion approval are required');
  if(plan.authMode&&!['user','api-key'].includes(plan.authMode))throw new Error('Unsupported approved authentication mode');
  if(!/^[a-z0-9]{6,64}$/.test(plan.instanceId)||!/^rescuemesh-nemotron-30b(?:-mc)?$/.test(plan.instanceName))throw new Error('Exact approved instance identity is required');
  if(!(typeof plan.hourlyRateUsd==='number'&&plan.hourlyRateUsd>0&&plan.hourlyRateUsd<=0.68&&typeof plan.creditCapUsd==='number'&&plan.creditCapUsd>0&&plan.creditCapUsd<=30))throw new Error('Approved credit-only budget exceeded');
  const created=Date.parse(plan.createdAt),deadline=Date.parse(plan.deadline);
  if(!Number.isFinite(created)||!Number.isFinite(deadline)||deadline>HARD_DEADLINE||deadline<=created)throw new Error('Invalid bounded instance dates');
  const reserved=Math.max(0.2,Number(plan.cleanupReserveUsd)||0.2);
  const prior=plan.priorProjectSpendUsd??0;
  if(typeof prior!=='number'||!Number.isFinite(prior)||prior<0||reserved+prior>=plan.creditCapUsd)throw new Error('Invalid prior project spend or cleanup reserve');
  const creditDeadline=created+(plan.creditCapUsd-reserved-prior)/plan.hourlyRateUsd*3600000;
  const maximum=Number(((Math.min(deadline,creditDeadline)-created)/3600000*plan.hourlyRateUsd).toFixed(4));
  return {...plan,priorProjectSpendUsd:prior,deleteAt:new Date(Math.min(deadline,creditDeadline)).toISOString(),estimatedMaximumUsd:maximum,estimatedMaximumProjectUsd:Number((prior+maximum).toFixed(4))};
}
export function parseWorkspaces(value){
  if(!value||typeof value!=='object'||!Object.hasOwn(value,'workspaces')||value.workspaces!==null&&!Array.isArray(value.workspaces))throw new Error('Unexpected authenticated Brev inventory format');
  return value.workspaces||[];
}
async function atomic(file,value){await mkdir(dirname(file),{recursive:true});const temporary=file+'.new-'+randomUUID();await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,file);}
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function brev(args){const command=args[0]==='__auth_metadata'?['bash','/mnt/c/Users/abhim/Documents/rescuemesh-runtime/check-brev-auth.sh']:['timeout','-k','5','90',CLI,...args];const {stdout}=await runProcess('wsl.exe',['-d','Ubuntu','--exec',...command],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});return stdout;}
export async function inventory(plan,run=brev){
  if(plan.authMode==='api-key'){
    const credential=JSON.parse(await run(['__auth_metadata']));if(!credential.apiKeyPresent||credential.apiKeyOrganizationId!==plan.orgId)throw new Error('API key does not authenticate the exact approved organization');
  }else{
    const orgs=JSON.parse(await run(['ls','orgs','--json','--no-check-latest']));
    if(!Array.isArray(orgs)||orgs.filter(item=>item.id===plan.orgId&&item.name===plan.orgName).length!==1)throw new Error('Owned organization was not authenticated');
  }
  const items=parseWorkspaces(JSON.parse(await run(['ls','--json',...(plan.authMode==='api-key'?[]:['--org',plan.orgName]),'--no-check-latest'])));
  const matches=items.filter(item=>item.id===plan.instanceId);
  if(matches.length>1||matches[0]&&matches[0].name!==plan.instanceName)throw new Error('Instance identity mismatch');
  return matches[0]?{id:matches[0].id,name:matches[0].name,status:matches[0].status,instanceType:matches[0].instance_type,gpu:matches[0].gpu}:null;
}
export async function deleteOwned(plan,{run=brev,now=()=>Date.now(),allowEarly=false}={}){
  plan=validatePlan(plan);
  if(!allowEarly&&now()<Date.parse(plan.deleteAt))throw new Error('Cleanup is not due');
  const before=await inventory(plan,run);if(!before)return {alreadyAbsent:true,deleteRequested:false,absenceVerified:true};
  await run(['delete',plan.instanceId,...(plan.authMode==='api-key'?[]:['--org',plan.orgName]),'--no-check-latest']);
  return {alreadyAbsent:false,deleteRequested:true,absenceVerified:false};
}
async function main(){
  if(process.env.COMPUTERNAME!=='ABHIONEMILLION')throw new Error('Desktop only');
  const action=process.argv[2]||'status',file=resolve(process.argv[3]||join(ROOT,'.private/brev-instance.json'));
  const plan=validatePlan(JSON.parse(await readFile(file,'utf8'))),receiptFile=join(ROOT,action==='status'?'brev-inventory-verification.json':['delete-now','cleanup'].includes(action)?`brev-cleanup-${plan.instanceId}.json`:'brev-state.json');
  const state={host:process.env.COMPUTERNAME,instanceId:plan.instanceId,instanceName:plan.instanceName,orgName:plan.orgName,hourlyRateUsd:plan.hourlyRateUsd,creditCapUsd:plan.creditCapUsd,priorProjectSpendUsd:plan.priorProjectSpendUsd,createdAt:plan.createdAt,deleteAt:plan.deleteAt,estimatedMaximumUsd:plan.estimatedMaximumUsd,estimatedMaximumProjectUsd:plan.estimatedMaximumProjectUsd,provider:'Brev',model:'nemotron-3-nano:30b',forward:'127.0.0.1:11435',ownerPid:process.pid,sshProcessPid:null,state:'starting',updatedAt:null,deleteRequested:false,absenceVerified:false,lastError:null};
  const save=async()=>{state.updatedAt=new Date().toISOString();await atomic(receiptFile,state);};
  if(action==='plan'){console.log(JSON.stringify({deleteAt:plan.deleteAt,estimatedMaximumUsd:plan.estimatedMaximumUsd,instanceId:plan.instanceId,creditCapUsd:plan.creditCapUsd}));return;}
  if(action==='status'){state.instance=await inventory(plan);state.state=state.instance?'present':'absent';await save();console.log(JSON.stringify(state));return;}
  if(!['watch','cleanup','delete-now'].includes(action))throw new Error('Unsupported bounded lifecycle action');
  if(action==='delete-now'||action==='cleanup'){
    const result=await deleteOwned(plan,{allowEarly:action==='delete-now'});Object.assign(state,result);state.state=result.absenceVerified?'deleted':'deletion-pending';await save();
    for(let attempt=0;attempt<20&&!state.absenceVerified;attempt++){await delay(10000);const found=await inventory(plan);if(!found){state.absenceVerified=true;state.state='deleted';}else{state.instance=found;}await save();}
    console.log(JSON.stringify(state));if(!state.absenceVerified)process.exitCode=1;return;
  }
  const lockFile=join(ROOT,'.private/brev-watch.lock');let lock;
  try{lock=await open(lockFile,'wx');await lock.writeFile(String(process.pid));}catch{
    const oldPid=Number((await readFile(lockFile,'utf8')).trim());let alive=false;if(Number.isInteger(oldPid)&&oldPid>0){try{process.kill(oldPid,0);alive=true;}catch(error){if(error.code!=='ESRCH')alive=true;}}
    if(alive)throw new Error('Brev lifecycle owner lock exists; inspect current ownership before restarting');
    await import('node:fs/promises').then(fs=>fs.unlink(lockFile));lock=await open(lockFile,'wx');await lock.writeFile(String(process.pid));
  }
  let ssh=null,closing=false;
  const stop=()=>{closing=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const found=await inventory(plan);if(!found)throw new Error('Approved instance absent before controller startup');
    state.instance=found;state.state='guarding';await save();let lastCheck=Date.now();
    while(!closing&&Date.now()<Date.parse(plan.deleteAt)){
      if(plan.sshAlias&&(!ssh||ssh.exitCode!==null||ssh.signalCode!==null)){
        if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(plan.sshAlias))throw new Error('Invalid managed SSH alias');
        const remainingSeconds=Math.max(1,Math.floor((Date.parse(plan.deleteAt)-Date.now())/1000));
        ssh=spawn('wsl.exe',['-d','Ubuntu','--exec','timeout','--signal=TERM',String(remainingSeconds),'ssh','-F','/home/abhim/.brev/ssh_config','-N','-T','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-L','127.0.0.1:11435:127.0.0.1:11434',plan.sshAlias],{windowsHide:true,stdio:'ignore'});
        ssh.on('error',()=>{});state.sshProcessPid=ssh.pid||null;await save();
      }
      if(Date.now()-lastCheck>=300000){try{state.instance=await inventory(plan);state.lastError=null;if(!state.instance){state.absenceVerified=true;state.state='deleted-externally';await save();return;}}catch{state.lastError='Authenticated inventory unavailable; deadline cleanup remains scheduled';}lastCheck=Date.now();await save();}
      await delay(5000);
    }
    if(closing&&Date.now()<Date.parse(plan.deleteAt)){state.state='controller-stopped-before-deadline';await save();return;}
    state.state='deleting';await save();
    for(let attempt=0;attempt<20;attempt++){
      try{
        if(!state.deleteRequested){const result=await deleteOwned(plan);Object.assign(state,result);}
        const found=await inventory(plan);if(!found){state.absenceVerified=true;state.state='deleted';await save();return;}
        state.instance=found;state.state='deletion-pending';state.lastError=null;
      }catch{state.state='cleanup-retry-required';state.lastError='Authenticated deletion or verification unavailable';}
      await save();await delay(15000);
    }
    throw new Error('Deletion absence is not yet verified');
  }finally{if(ssh&&ssh.exitCode===null)ssh.kill();await lock.close();await import('node:fs/promises').then(fs=>fs.unlink(lockFile)).catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Brev lifecycle operation failed; inspect owned private configuration and safe runtime state.');process.exitCode=1;});
