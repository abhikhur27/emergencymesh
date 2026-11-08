import {mkdir, writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {dirname, resolve} from 'node:path';

const api=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434';
const model='nemotron-3-nano:4b';
const output=resolve(process.argv[2]||`nemotron-${hostname()}.json`);
async function request(path,body,timeout=120000){
  const response=await fetch(`${api}${path}`,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`Ollama HTTP ${response.status}`);
  return response.json();
}
const options={num_ctx:4096,num_predict:180,temperature:0,seed:42};
const startedAt=new Date().toISOString();
const version=await request('/api/version');
const tags=await request('/api/tags');
const tag=tags.models.find(item=>item.name===model||item.model===model);
if(!tag)throw new Error('Required local model is not installed');
const start=performance.now();
const schema={type:'object',additionalProperties:false,properties:{people:{type:'integer',minimum:1,maximum:255},category:{type:'string',enum:['medical','fire','rescue','safety','supplies','shelter','other']},need:{type:'string'},locationKind:{type:'string',enum:['gps','landmark','unknown']}},required:['people','category','need','locationKind']};
const structured=await request('/api/chat',{model,stream:false,think:false,keep_alive:'60s',format:schema,options,messages:[{role:'system',content:'Extract a report as JSON matching the schema. people is the count. Do not invent facts. category is supplies for drinking water. locationKind is landmark for a named building.'},{role:'user',content:'Synthetic test: Two people need drinking water near HH. Assistance category: supplies.'}]});
const structuredElapsedMs=Math.round(performance.now()-start);
const fields=JSON.parse(structured.message.content);
if(fields.people!==2||fields.category!=='supplies'||fields.need!=='drinking water'||fields.locationKind!=='landmark')throw new Error('Structured extraction validation failed');
const loaded=await request('/api/ps');
const memory=loaded.models.find(item=>item.name===model||item.model===model);
const toolStart=performance.now();
const tools=await request('/api/chat',{model,stream:false,think:false,keep_alive:0,options,messages:[{role:'system',content:'Use lookup_resources to find available resources. You may only request a lookup. Do not claim dispatch or availability.'},{role:'user',content:'Synthetic test: Two people need drinking water near HH. Assistance category: supplies.'}],tools:[{type:'function',function:{name:'lookup_resources',description:'Look up local resources for a request.',parameters:{type:'object',properties:{resource:{type:'string',enum:['water','shelter','medical','fire','rescue','safety','general_supplies']},people:{type:'integer',minimum:1,maximum:255}},required:['resource','people']}}}]});
const toolElapsedMs=Math.round(performance.now()-toolStart);
const calls=tools.message?.tool_calls||[];
const call=calls.find(item=>item.function?.name==='lookup_resources');
if(!call||call.function.arguments.resource!=='water'||call.function.arguments.people!==2)throw new Error('Native tool calling validation failed');
const receipt={schema:1,host:hostname(),startedAt,checkedAt:new Date().toISOString(),provider:'Ollama',providerVersion:version.version,model,local:true,cloud:false,digest:tag.digest,modelBytes:tag.size,contextLength:4096,thinking:false,structured:{elapsedMs:structuredElapsedMs,fields,done:structured.done,loadDurationNs:structured.load_duration,promptEvalCount:structured.prompt_eval_count,evalCount:structured.eval_count,evalDurationNs:structured.eval_duration},nativeToolCall:{elapsedMs:toolElapsedMs,name:call.function.name,arguments:call.function.arguments,done:tools.done,evalCount:tools.eval_count,evalDurationNs:tools.eval_duration},memory:memory?{loadedBytes:memory.size,vramBytes:memory.size_vram,contextLength:memory.context_length}:null,unloadRequestedAfterTest:true,input:'synthetic-water-report-only',scope:'Validates native tool-call generation and JSON extraction; does not prove resource availability or external dispatch.'};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
