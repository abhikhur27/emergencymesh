import { createHash } from 'node:crypto';

export const SCHEMA = 'rescuemesh.case.v1';
export const RESOURCES = ['water', 'supplies', 'medical', 'fire', 'rescue', 'safety', 'food', 'medicine', 'power'];
export const TOWN_IDS = ['plano', 'garland', 'addison'];
export const SUPPLY_FLAGS = Object.freeze({food:16,water:32,medicine:64,power:128});
export const suppliesFromFlags = flags => Object.entries(SUPPLY_FLAGS).filter(([,bit]) => (flags & bit)!==0).map(([resource]) => resource);
const string = (value, name, max, required = true) => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw Object.assign(new Error('Invalid ' + name), { status: 400 });
  return value.trim();
};
const id = (value, name, max = 180) => { value = string(value, name, max); if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value)) throw Object.assign(new Error('Invalid ' + name), { status: 400 }); return value; };
const integer = (value, min, max, name) => { if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error('Invalid ' + name), { status: 400 }); return value; };
function finite(value, min, max, name) { if (!Number.isFinite(value) || value < min || value > max) throw Object.assign(new Error('Invalid ' + name), { status: 400 }); return value; }
export function validateCase(input, { allowedHubId = null, simulated = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schema !== SCHEMA) throw Object.assign(new Error('Unsupported case schema'), { status: 400 });
  const hubId = id(input.hubId, 'hubId', 40);
  if (allowedHubId && hubId !== allowedHubId) throw Object.assign(new Error('Hub scope rejected'), { status: 403 });
  const source = input.source;
  if (!source || !['radio', 'simulated'].includes(source.kind) || (simulated && source.kind !== 'simulated')) throw Object.assign(new Error('Invalid source'), { status: 400 });
  const request = input.request;
  if (!request || typeof request !== 'object') throw Object.assign(new Error('Invalid request'), { status: 400 });
  const note = request.note === undefined ? '' : String(request.note);
  if (typeof request.note !== 'string' && request.note !== undefined) throw Object.assign(new Error('Invalid note'), { status: 400 });
  if (Buffer.byteLength(note, 'utf8') > 120 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(note)) throw Object.assign(new Error('Invalid note'), { status: 400 });
  const canonicalRequest = { category: integer(request.category, 1, 8, 'category'), severity: integer(request.severity, 1, 3, 'severity'), people: integer(request.people, 1, 255, 'people'), note };
  if(request.flags!==undefined||request.supplies!==undefined){
    canonicalRequest.flags=integer(request.flags??0,0,255,'flags');
    canonicalRequest.supplies=suppliesFromFlags(canonicalRequest.flags);
    if(request.supplies!==undefined&&(!Array.isArray(request.supplies)||JSON.stringify(request.supplies)!==JSON.stringify(canonicalRequest.supplies)))throw Object.assign(new Error('Supply selections do not match transmitted flags'),{status:400});
  }
  const summary = input.summary || {};
  const canonicalSummary = { text: summary.text === undefined ? '' : string(summary.text, 'summary', 400), resource: summary.resource === undefined ? null : string(summary.resource, 'resource', 24), quantity: summary.quantity === undefined ? null : integer(summary.quantity, 1, 20, 'quantity') };
  if (canonicalSummary.resource !== null && !RESOURCES.includes(canonicalSummary.resource)) throw Object.assign(new Error('Unsupported resource'), { status: 400 });
  if (summary.needType !== undefined) canonicalSummary.needType = string(summary.needType, 'needType', 80);
  if(summary.needRequests!==undefined){
    if(!Array.isArray(summary.needRequests)||!summary.needRequests.length||summary.needRequests.length>5)throw Object.assign(new Error('Invalid planning needs'),{status:400});
    const seen=new Set();canonicalSummary.needRequests=summary.needRequests.map(need=>{
      if(!need||!RESOURCES.includes(need.resource)||seen.has(need.resource)||!['policy-per-person','policy-one-team'].includes(need.quantityBasis)||!['signal','category-policy','note-policy'].includes(need.source))throw Object.assign(new Error('Invalid planning need'),{status:400});
      seen.add(need.resource);return {resource:need.resource,quantity:integer(need.quantity,1,20,'planning quantity'),quantityBasis:need.quantityBasis,source:need.source};
    });
  }
  const place = input.location || { kind: 'unknown' };
  if (!['gps', 'landmark', 'unknown'].includes(place.kind)) throw Object.assign(new Error('Invalid location kind'), { status: 400 });
  const location = { kind: place.kind, label: place.label ? string(place.label, 'location label', 160) : '', verified: false };
  if (place.kind === 'gps') {
    location.latitude = finite(place.latitude ?? place.lat, -90, 90, 'latitude');
    location.longitude = finite(place.longitude ?? place.lon, -180, 180, 'longitude');
    location.accuracy = finite(place.accuracy ?? place.accuracyMeters ?? 65535, 0, 65535, 'accuracy');
    // Valid coordinates are sender evidence, not independent verification.
    location.verified = false;
  }
  if (place.kind === 'landmark' && !location.label) throw Object.assign(new Error('Landmark label required'), { status: 400 });
  const result={ schema: SCHEMA, eventId: id(input.eventId, 'eventId', 220), hubId, caseId: id(input.caseId, 'caseId'), revision: integer(input.revision, 1, 1000000, 'revision'),
    source: { kind: source.kind, requestId: id(source.requestId, 'requestId'), receivedAt: finite(source.receivedAt, 0, 1e15, 'receivedAt') }, request: canonicalRequest, summary: canonicalSummary, location };
  if(input.sourceAgent!==undefined){
    const agent=input.sourceAgent;if(!agent||agent.hosting!=='local'||!['signal','local-model','local-rules','local-rules-fallback'].includes(agent.source))throw Object.assign(new Error('Invalid source agent attribution'),{status:400});
    if(agent.source!=='local-model'&&agent.model!==null&&agent.model!==undefined)throw Object.assign(new Error('Rule or signal processing cannot claim a model'),{status:400});
    result.sourceAgent={hosting:'local',source:agent.source,model:agent.source==='local-model'?string(agent.model,'source model',80):null};
    if(agent.configuredModel!==undefined)result.sourceAgent.configuredModel=agent.configuredModel===null?null:string(agent.configuredModel,'configured source model',80);
  }
  if(simulated&&input.generation&&['nemotron','seeded-policy'].includes(input.generation.source))result.generation={source:input.generation.source,model:typeof input.generation.model==='string'?string(input.generation.model,'generation model',80):null,at:finite(input.generation.at,0,1e15,'generation timestamp')};
  return result;
}
export function bodyDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function deriveNeed(item) {
  if(item.summary.needRequests||item.request.category>5||((item.request.flags??0)&240)){const result=deriveNeeds(item);return {...result.needs[0],issues:result.issues};}
  const resource = item.request.category === 5 ? (/\b(water|drink(?:ing)?|hydration)\b/i.test(item.request.note) ? 'water' : 'supplies') : ['','medical','fire','rescue','safety'][item.request.category];
  const proposed = item.summary.resource || resource;
  const quantity = item.summary.quantity ?? (['water','supplies'].includes(resource) ? item.request.people : 1);
  const issues = [];
  if (proposed !== resource) issues.push('The proposed resource does not match the source category or note.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || quantity > item.request.people) issues.push('Resource quantity needs review.');
  if (item.request.people > 20 && ['water','supplies'].includes(resource)) issues.push('This request exceeds the automatic simulation limit.');
  if (item.location.kind === 'unknown') issues.push('The request needs a usable location or landmark.');
  return { resource, quantity, issues };
}
/** Quantities are planning policy, never a claim that the sender selected an amount. */
export function sourceNeedRequests(request){
  const needs=[],team={1:'medical',2:'fire',3:'rescue',4:'safety',6:'rescue',7:'rescue',8:'safety'}[request.category];
  const quantity=Math.max(1,Math.min(20,request.people));
  if(team)needs.push({resource:team,quantity:1,quantityBasis:'policy-one-team',source:'category-policy'});
  const supplies=suppliesFromFlags(request.flags??0);
  for(const resource of supplies)needs.push({resource,quantity,quantityBasis:'policy-per-person',source:'signal'});
  if(request.category===5&&!supplies.length){const water=/\b(water|drink(?:ing)?|hydration)\b/i.test(request.note||'');needs.push({resource:water?'water':'supplies',quantity,quantityBasis:'policy-per-person',source:water?'note-policy':'category-policy'});}
  return needs;
}
export function deriveNeeds(item){
  // Older saved cases retain their original single-resource contract and limits.
  if(!item.summary.needRequests&&item.request.category<=5&&!((item.request.flags??0)&240)){const need=deriveNeed(item);return {needs:[{resource:need.resource,quantity:need.quantity,quantityBasis:['water','supplies'].includes(need.resource)?'policy-per-person':'policy-one-team',source:'category-policy'}],issues:need.issues};}
  const needs=sourceNeedRequests(item.request),issues=[];
  if(item.summary.needRequests&&JSON.stringify(needs)!==JSON.stringify(item.summary.needRequests))issues.push('Planning needs do not match the transmitted selections and quantity policy.');
  if(item.summary.resource&&item.summary.resource!==needs[0]?.resource||item.summary.quantity!==null&&item.summary.quantity!==undefined&&item.summary.quantity!==needs[0]?.quantity)issues.push('The primary planning need does not match the transmitted selections.');
  if(item.location.kind==='unknown')issues.push('The request needs a usable location or landmark.');
  return {needs,issues};
}
export const immutableSource = item => JSON.stringify({ hubId: item.hubId, source: item.source, request: item.request });
