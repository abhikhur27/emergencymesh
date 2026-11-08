import { createHash } from 'node:crypto';
import { messageText, parseHex } from './followup.mjs';

export function checkedCommands(input,hubId){
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>8)throw new Error('Invalid regional questions');
  const seen=new Set();return input.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.caseId!=='string'||value.caseId.length>180||!value.caseId.startsWith(hubId+':')||!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value.caseId)||!['ask','close'].includes(value.action??'ask')||!Number.isFinite(value.createdAt)||value.createdAt<0||value.createdAt>1e15)throw new Error('Invalid regional question command');
    parseHex(value.id,'question ID');messageText(value.text,66,'Question');const key=value.caseId+':'+value.id;if(seen.has(key))throw new Error('Duplicate regional question command');seen.add(key);
    return {id:value.id,caseId:value.caseId,text:value.text,action:value.action??'ask',createdAt:value.createdAt};
  });
}
export function messageSnapshot(core,item,commandErrors=[]){
  const safe=core.publicIncident(item),followups=(safe.followups||[]).map(q=>{
    const value={id:q.id,text:q.text,source:q.source,createdAt:q.createdAt,status:q.status,attemptCount:q.attemptCount,lastAttemptAt:q.lastAttemptAt??null,nextAttemptAt:q.nextAttemptAt??null};
    if(q.lastTransmission)value.lastTransmission={state:q.lastTransmission.state,at:q.lastTransmission.at};
    if(q.answer)value.answer={text:q.answer.text,receivedAt:q.answer.receivedAt,createdAt:q.answer.createdAt,sequence:q.answer.sequence,location:q.answer.location?{latitude:q.answer.location.latitude,longitude:q.answer.location.longitude,accuracy:q.answer.location.accuracy,capturedAt:q.answer.location.capturedAt}:null};
    return value;
  });
  if(followups.length>12)throw new Error('Conversation synchronization capacity exceeded');
  return {caseId:item.coordination.caseId,canContactUser:safe.canContactUser===true,followups,...(commandErrors.length?{commandErrors}: {})};
}
export const messageDigest=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
