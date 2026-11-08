import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OperatorAuth } from './auth.mjs';

const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const staticFiles=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const hash=value=>createHash('sha256').update(value).digest();
function secretEqual(a,b){return typeof a==='string'&&typeof b==='string'&&timingSafeEqual(hash(a),hash(b));}
const fail=(message,status)=>Object.assign(new Error(message),{status});
function send(response,status,value,extra={}){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...extra});response.end(JSON.stringify(value));}
async function body(request){
  if(request.headers['content-type']?.split(';')[0]!=='application/json')throw fail('JSON required',415);
  let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>32768)throw fail('Request too large',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('Invalid JSON',400);}
}
export async function createSupervisorServer({core,operatorToken,username='operator',hubTokens={},publicOrigin=null}={}){
  const auth=new OperatorAuth(core.store,{operatorToken,username});await auth.initialize();
  let localHost=null,localOrigin=null;
  const publicUrl=publicOrigin?new URL(publicOrigin):null;
  if(publicUrl&&!['https:','http:'].includes(publicUrl.protocol))throw new Error('Invalid public origin');
  const machineHub=request=>{
    const header=request.headers.authorization||'';
    if(!header.startsWith('Bearer ')||header.length>256)return null;
    const token=header.slice(7);let result=null;
    for(const [hubId,expected]of Object.entries(hubTokens))if(secretEqual(token,expected))result=hubId;
    return result;
  };
  const server=createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('X-Frame-Options','DENY');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const host=request.headers.host;
      const origin=host===localHost?localOrigin:publicUrl&&host===publicUrl.host?publicUrl.origin:null;
      if(!origin||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress))return send(response,403,{error:'Configured host required'});
      if(request.headers.origin&&request.headers.origin!==origin)return send(response,403,{error:'Origin rejected'});
      const url=new URL(request.url,origin),now=Date.now();
      if(request.method==='GET'&&['/health','/api/health'].includes(url.pathname))return send(response,200,{ok:true,product:'RescueMesh',role:'regional-supervisor',realDispatch:false});
      if(request.method==='GET'&&staticFiles.has(url.pathname)){const[file,type]=staticFiles.get(url.pathname);response.writeHead(200,{'Content-Type':type});return response.end(await readFile(publicRoot+file));}
      if(url.pathname.startsWith('/api/hub/')){
        const hubId=machineHub(request);if(!hubId)return send(response,401,{error:'Hub authentication required'});
        if(request.method==='POST'&&url.pathname==='/api/hub/cases'){const accepted=await core.receive(await body(request),{allowedHubId:hubId});return send(response,202,accepted);}
        if(request.method==='GET'&&url.pathname==='/api/hub/updates'){
          if(url.searchParams.get('hubId')&&url.searchParams.get('hubId')!==hubId)return send(response,403,{error:'Hub scope rejected'});
          const afterText=url.searchParams.get('after')||'0';if(!/^\d{1,16}$/.test(afterText))return send(response,400,{error:'Invalid update cursor'});
          const after=Number(afterText);if(!Number.isSafeInteger(after))return send(response,400,{error:'Invalid update cursor'});
          await core.contact(hubId);return send(response,200,core.updates(hubId,after));
        }
        return send(response,404,{error:'Not found'});
      }
      if(request.method!=='GET'&&request.headers.origin!==origin)return send(response,403,{error:'Same-origin request required'});
      const secure=origin.startsWith('https:')?'; Secure':'';
      if(request.method==='POST'&&url.pathname==='/api/login'){
        const result=await auth.login(await body(request));
        return send(response,200,{ok:true,csrf:result.csrf,user:result.user},{'Set-Cookie':'rm_supervisor='+result.id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+result.seconds+secure});
      }
      const session=auth.session(request.headers.cookie);if(!session)return send(response,401,{error:'Operator sign-in required'});
      if(request.method!=='GET'&&!auth.csrf(request.headers['x-csrf-token'],session.csrf))return send(response,403,{error:'Session token required'});
      if(request.method==='GET'&&url.pathname==='/api/state')return send(response,200,{...core.state(),csrf:session.csrf,user:{username,role:'operator'}});
      if(request.method==='POST'&&url.pathname==='/api/logout'){await body(request);await auth.revoke(session);return send(response,200,{ok:true},{'Set-Cookie':'rm_supervisor=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+secure});}
      if(request.method==='POST'&&url.pathname==='/api/automation'){const input=await body(request);await core.setPaused(input.paused);return send(response,200,{ok:true});}
      if(request.method==='POST'&&url.pathname==='/api/simulation'){const result=await core.simulationCommand(await body(request));return send(response,200,{ok:true,result});}
      const match=/^\/api\/cases\/([^/]+)\/resolve$/.exec(url.pathname);
      if(request.method==='POST'&&match){await core.resolve(decodeURIComponent(match[1]),await body(request));return send(response,200,{ok:true});}
      return send(response,404,{error:'Not found'});
    }catch(error){return send(response,error.status||500,{error:error.status?error.message:'Operation failed; saved cases are preserved'});}
  });
  server.headersTimeout=10000;server.requestTimeout=30000;server.maxRequestsPerSocket=200;
  return {server,listen:(port=4782)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{localHost='127.0.0.1:'+server.address().port;localOrigin='http://'+localHost;resolve({origin:localOrigin,port:server.address().port});});}),close:()=>new Promise(resolve=>{server.closeIdleConnections();server.close(resolve);})};
}
