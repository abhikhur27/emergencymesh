import test from 'node:test';
import assert from 'node:assert/strict';
import { receptionSummary } from '../public/reception-data.js';
test('reception study accepts stored millisecond timestamps and includes actual repeat reception time',()=>{
 const at=Date.parse('2026-11-08T04:00:00Z');
 const summary=receptionSummary([
  {id:'a',receivedAt:at,lastReceivedAt:at+60000,receptions:3,request:{flags:0},radio:{rssi:-120,snr:-3}},
  {id:'b',receivedAt:'2026-11-08T04:00:30Z',request:{flags:0},radio:{rssi:-100,snr:2}},
  {id:'c',simulated:true,receivedAt:at+999999,request:{flags:0}}
 ]);
 assert.equal(summary.requests,2);assert.equal(summary.receptions,4);assert.equal(summary.first,'2026-11-08T04:00:00.000Z');assert.equal(summary.last,'2026-11-08T04:01:00.000Z');assert.equal(summary.rssi.median,-110);
 assert.equal(receptionSummary([{id:'x',receivedAt:'invalid',request:{flags:0}}]).first,null);
 assert.equal(receptionSummary([]).last,null);
});
