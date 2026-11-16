import test from 'node:test';
import assert from 'node:assert/strict';
import {measurement,trainBaseline,validateSettings,DEFAULT_SETTINGS,candidates} from '../src/domain.js';
import {Store,seedDemo} from '../src/database.js';
test('null pH is missing, not zero; invalid range is rejected',()=>{
 assert.equal(measurement('ph','null',Date.now()).value,null);
 assert.equal(measurement('ph',null,Date.now()).quality,'missing');
 assert.equal(measurement('ph',15,Date.now()).quality,'invalid');
 assert.equal(measurement('temp',0,Date.now()).value,0);
 assert.equal(measurement('ph',true,Date.now()+900000),null);
});
test('replayed readings are deduplicated with original event time',async()=>{
 const s=new Store(),ts=Date.now()-60000,r=measurement('ph','7.81',ts);
 await s.ingest([r,r]);await s.ingest([measurement('ph','7.81',ts)]);
 assert.equal(s.mem.measurements.length,1);assert.equal(+s.mem.measurements[0].observedAt,ts);
 await s.ingest([measurement('temp',29,ts)]);assert.equal(s.mem.measurements.length,2);
});
test('settings reject inverted thresholds and incomplete coordinates',()=>{
 const s=structuredClone(DEFAULT_SETTINGS);s.thresholds.phMin=9;
 assert.throws(()=>validateSettings(s));const a=structuredClone(DEFAULT_SETTINGS);a.latitude=10;assert.throws(()=>validateSettings(a));
 assert.deepEqual(validateSettings(DEFAULT_SETTINGS),DEFAULT_SETTINGS);
});
test('old readings do not produce active threshold or intrusion alerts',()=>{
 const latest={temp:measurement('temp',40,Date.now()-60000),laser:measurement('laser',1,Date.now()-60000)};
 assert.equal(candidates(latest,DEFAULT_SETTINGS).length,0);
 latest.temp=measurement('temp',40,Date.now());assert.equal(candidates(latest,DEFAULT_SETTINGS)[0].severity,'critical');
});
test('alerts are deduplicated, resolved, and can recur as a new event',async()=>{
 const s=new Store(),a={key:'threshold:temp',kind:'threshold',title:'test'};
 await s.reconcileAlerts([a]);await s.reconcileAlerts([a]);assert.equal(s.mem.alerts.length,1);
 await s.reconcileAlerts([]);assert.equal(s.mem.alerts[0].active,false);
 await s.reconcileAlerts([a]);assert.equal(s.mem.alerts.length,2);
});
test('baseline uses chronological holdout, returns a versionable prediction',async()=>{
 const s=new Store();await seedDemo(s);const rows=await s.history('temp',0,Date.now());
 const m=trainBaseline(rows,'temp');assert.equal(m.split,'chronological-80-20');assert.ok(m.validation.mae>=0);assert.equal(m.forecasts.length,6);
 assert.ok(+m.forecasts[0].targetAt>+m.dataEnd);assert.equal(m.validation.trainCount+m.validation.testCount,m.sampleCount);
});
test('baseline refuses missing, sparse, or stale datasets',()=>{
 assert.throws(()=>trainBaseline([],'ph'),/60/);
 const end=Date.now()-3600000,p=Array.from({length:100},(_,i)=>measurement('ph',8,end-(100-i)*300000));
 assert.throws(()=>trainBaseline(p,'ph'),/30 phút/);
 assert.throws(()=>trainBaseline(p,'laser'),/không hỗ trợ/);
});
