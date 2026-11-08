import test from 'node:test';
import assert from 'node:assert/strict';
import { receptionSummary, reportedLocation, caseLocation, sortReports } from '../public/reception-data.js';
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

test('mixed timestamp reports sort chronologically without mutating intake or stealing a selection',()=>{
 const source=[{id:'old',receivedAt:1000},{id:'new',receivedAt:'2026-11-08T04:00:00Z'},{id:'mid',receivedAt:2000}];
 assert.deepEqual(sortReports(source).map(r=>r.id),['new','mid','old']);assert.equal(source[0].id,'old');
});
test('ambiguous landmarks stay unlocated and an operator correction preserves original evidence',()=>{
 const item={request:{flags:0,note:'ECSW to Hoblitzelle'},annotations:{location:{label:'ECSW'}}};
 assert.equal(reportedLocation(item).kind,'unknown');assert.equal(caseLocation(item).landmark.id,'ecsw');assert.equal(item.request.note,'ECSW to Hoblitzelle');
});
test('unknown GPS accuracy and absent signal are not presented as known measurements',()=>{
 const item={id:'a',request:{flags:1,latitude:32.986,longitude:-96.752,accuracy:65535},radio:{rssi:null,snr:null}};
 assert.equal(reportedLocation(item).accuracy,null);assert.equal(receptionSummary([item]).rssi.n,0);assert.equal(reportedLocation(item).landmark,null);
});
