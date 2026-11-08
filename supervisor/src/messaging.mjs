import { randomBytes } from 'node:crypto';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const timestamp=(value,name)=>{if(!Number.isFinite(value)||value<0||value>1e15)throw fail('Invalid '+name);return value;};
const hex=/^[0-9a-f]{8}$/;
export const QUESTION_STATUSES=new Set(['queued','submitted-to-radio','unconfirmed','closed','answered']);
export function questionId(value){if(typeof value!=='string'||!hex.test(value)||value==='00000000')throw fail('Invalid question ID');return value;}
export function questionText(value){return messageText(value,66,'question');}
function messageText(value,maximum,name){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||/[\u0000-\u001f\u007f]/u.test(value)||Buffer.byteLength(value,'utf8')>maximum||new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value,'utf8'))!==value)throw fail('Invalid '+name);
  return value;
}
export function newQuestionId(existing){let id;do{id=randomBytes(4).toString('hex');}while(id==='00000000'||existing.has(id));return id;}
export function checkCaseId(value){if(typeof value!=='string'||value.length>180||!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value))throw fail('Invalid case ID');return value;}
function location(value){
  if(value===undefined||value===null)return null;
  if(!object(value)||!Number.isFinite(value.latitude)||Math.abs(value.latitude)>90||!Number.isFinite(value.longitude)||Math.abs(value.longitude)>180||!Number.isFinite(value.accuracy)||value.accuracy<0||value.accuracy>=65535)throw fail('Invalid answer location');
  return {latitude:value.latitude,longitude:value.longitude,accuracy:value.accuracy,capturedAt:timestamp(value.capturedAt,'location timestamp')};
}
export function safeQuestion(value){
  if(!object(value)||!QUESTION_STATUSES.has(value.status)||!['local','regional'].includes(value.source)||!Number.isInteger(value.attemptCount)||value.attemptCount<0||value.attemptCount>4)throw fail('Invalid question state');
  const result={id:questionId(value.id),text:questionText(value.text),source:value.source,createdAt:timestamp(value.createdAt,'question timestamp'),status:value.status,attemptCount:value.attemptCount,lastAttemptAt:value.lastAttemptAt===null||value.lastAttemptAt===undefined?null:timestamp(value.lastAttemptAt,'attempt timestamp'),nextAttemptAt:value.nextAttemptAt===null||value.nextAttemptAt===undefined?null:timestamp(value.nextAttemptAt,'retry timestamp')};
  if(value.lastTransmission!==undefined){if(!object(value.lastTransmission)||!['submitted-to-radio','failed'].includes(value.lastTransmission.state))throw fail('Invalid transmission state');result.lastTransmission={state:value.lastTransmission.state,at:timestamp(value.lastTransmission.at,'transmission timestamp')};}
  if(value.answer!==undefined&&value.answer!==null){if(!object(value.answer)||!Number.isInteger(value.answer.sequence)||value.answer.sequence<1||value.answer.sequence>0xffffffff)throw fail('Invalid answer state');result.answer={text:messageText(value.answer.text,97,'answer'),receivedAt:timestamp(value.answer.receivedAt,'answer receipt'),createdAt:timestamp(value.answer.createdAt,'answer timestamp'),sequence:value.answer.sequence,location:location(value.answer.location)};if(value.status!=='answered')throw fail('Answer status mismatch');}
  else if(value.status==='answered')throw fail('Answered question lacks answer');
  return result;
}
export function validateMessageSnapshot(input){
  if(!object(input)||typeof input.canContactUser!=='boolean'||!Array.isArray(input.followups)||input.followups.length>12||Object.keys(input).some(k=>!['caseId','canContactUser','followups','commandErrors'].includes(k)))throw fail('Invalid message snapshot');
  const seen=new Set(),followups=input.followups.map(value=>{const q=safeQuestion(value);if(seen.has(q.id))throw fail('Duplicate question ID');seen.add(q.id);return q;});
  const commandErrors=input.commandErrors??[];
  if(!Array.isArray(commandErrors)||commandErrors.length>8)throw fail('Invalid command results');
  const errors=commandErrors.map(value=>{if(!object(value)||!['blocked','unknown-case','invalid-question','phone-not-ready','closed'].includes(value.code))throw fail('Invalid command error');return{id:questionId(value.id),code:value.code};});
  if(new Set(errors.map(e=>e.id)).size!==errors.length)throw fail('Duplicate command result');
  return {caseId:checkCaseId(input.caseId),canContactUser:input.canContactUser,followups,commandErrors:errors};
}
const rank={queued:0,'submitted-to-radio':1,unconfirmed:2,closed:3,answered:4};
export function mergeSourceQuestion(previous,incoming){
  if(!previous)return structuredClone(incoming);
  if(previous.text!==incoming.text||previous.source!==incoming.source)throw fail('Conflicting question identity',409);
  if(previous.answer&&incoming.answer&&(previous.answer.sequence!==incoming.answer.sequence||previous.answer.text!==incoming.answer.text||JSON.stringify(previous.answer.location)!==JSON.stringify(incoming.answer.location)))throw fail('Conflicting answer identity',409);
  if(previous.status==='blocked')return {...structuredClone(incoming),createdAt:previous.createdAt};
  if(previous.status==='closing'&&incoming.status!=='closed'&&incoming.status!=='answered')return {...structuredClone(previous),attemptCount:Math.max(previous.attemptCount||0,incoming.attemptCount)};
  const previousRank=rank[previous.status]??-1;
  if(previousRank>rank[incoming.status])return structuredClone(previous);
  return {...structuredClone(incoming),createdAt:previous.createdAt,sourceCreatedAt:incoming.createdAt,attemptCount:Math.max(previous.attemptCount||0,incoming.attemptCount)};
}
export const openQuestion=q=>!['answered','closed','blocked'].includes(q.status);
export const messagingError=fail;
