// These facts come from authenticated bytes, never model interpretation.
export const CATEGORY_LABELS=Object.freeze({1:'Medical',2:'Fire',3:'Rescue',4:'Safety',5:'Supplies',6:'Flood',7:'Earthquake',8:'Other'});
export const SUPPLY_BITS=Object.freeze({food:16,water:32,medicine:64,power:128});
const SERVICE_RESOURCE=Object.freeze({1:'medical',2:'fire',3:'rescue',4:'safety',6:'rescue',7:'rescue',8:'safety'});
const planningQuantity=people=>Math.max(1,Math.min(20,people));

export function reportedSupplies(request){return Object.entries(SUPPLY_BITS).filter(([,bit])=>(request.flags&bit)!==0).map(([name])=>name);}
export function sourceNeedRequests(request){
  const needs=[],supplies=reportedSupplies(request),service=SERVICE_RESOURCE[request.category];
  if(service)needs.push({resource:service,quantity:1,quantityBasis:'policy-one-team',source:'category-policy'});
  for(const resource of supplies)needs.push({resource,quantity:planningQuantity(request.people),quantityBasis:'policy-per-person',source:'signal'});
  if(request.category===5&&!supplies.length){
    const water=/\b(water|drink(?:ing)?|hydration)\b/i.test(request.note||'');
    needs.push({resource:water?'water':'supplies',quantity:planningQuantity(request.people),quantityBasis:'policy-per-person',source:water?'note-policy':'category-policy'});
  }
  return needs;
}
export function signalFacts(request){
  return {category:request.category,categoryLabel:CATEGORY_LABELS[request.category]||'Unknown',severity:request.severity,people:request.people,supplies:reportedSupplies(request),concerns:[request.flags&2?'breathing':null,request.flags&4?'trapped':null,request.flags&8?'bleeding':null].filter(Boolean),hasGps:Boolean(request.flags&1),note:request.note};
}
export function needsLocalInterpretation(request,region){
  if(reportedSupplies(request).length)return false;
  const note=(request.note||'').trim();if(!note)return false;
  const normalized=note.replace(/^(?:test|exercise)\s*(?:request)?\s*(?:at|near|by)?\s*/i,'').replace(/^(?:at|near|by|outside|inside)\s+/i,'').replace(/[.!?]+$/,'').trim().toLowerCase();
  return !(region?.landmarks||[]).some(l=>[l.id,l.name,l.fullName,...(l.aliases||[])].some(a=>typeof a==='string'&&a.toLowerCase()===normalized));
}
