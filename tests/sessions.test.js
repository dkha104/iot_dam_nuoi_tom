import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMeasurementSessions,SESSION_GAP_MS} from '../src/sessions.js';
import {Store} from '../src/database.js';
import {measurement} from '../src/domain.js';

const ts=s=>new Date(s).getTime();
test('three measurement runs on different days are separate; latest excludes yesterday',()=>{
 const stamps=['2026-11-16T03:15:00Z','2026-11-16T03:16:00Z','2026-11-16T16:50:00Z','2026-11-16T16:51:00Z','2026-11-17T03:15:00Z','2026-11-17T03:15:05Z'];
 const groups=groupMeasurementSessions(stamps);assert.equal(groups.length,3);
 assert.equal(groups.at(-1).startTs,ts('2026-11-17T03:15:00Z'));assert.equal(groups.at(-1).count,2);
 assert.ok(groups[0].endTs<groups.at(-1).startTs);
});
test('exactly five minutes stays in one run; a larger gap starts a new run',()=>{
 const start=ts('2026-11-16T23:00:00Z');
 const groups=groupMeasurementSessions([start,start+SESSION_GAP_MS,start+2*SESSION_GAP_MS+1]);
 assert.equal(groups.length,2);assert.equal(groups[0].count,2);assert.equal(groups[1].count,1);
});
test('a continuous run crossing midnight is not split by the calendar date',()=>{
 const groups=groupMeasurementSessions(['2026-11-16T16:59:55Z','2026-11-16T17:00:00Z']);assert.equal(groups.length,1);
});
test('run identifier remains stable when new measurements arrive in the same run',()=>{
 const now=Date.now(),before=groupMeasurementSessions([now-10000,now-5000]),after=groupMeasurementSessions([now-10000,now-5000,now]);
 assert.equal(before[0].id,after[0].id);assert.equal(after[0].endTs,now);
 assert.equal(before[0].endTs,now-5000);
});
test('empty data, isolated readings, repeated timestamps and invalid timestamps',()=>{
 assert.deepEqual(groupMeasurementSessions([]),[]);
 const groups=groupMeasurementSessions(['invalid',10000,10000,0]);assert.equal(groups.length,1);assert.equal(groups[0].count,2);
 assert.equal(groupMeasurementSessions([10000])[0].startTs,10000);
 assert.throws(()=>groupMeasurementSessions([1],0));
});
test('store returns bounded original timestamps including null sensor values',async()=>{
 const store=new Store(),now=Date.now();
 await store.ingest([measurement('ph',null,now-600000),measurement('ph',8,now),measurement('temp',29,now)]);
 const times=await store.historyTimes('ph',now-86400000,now);assert.equal(times.length,2);
 assert.equal(groupMeasurementSessions(times).length,2);
 assert.deepEqual(await store.historyTimes('ph',0,now,1),[new Date(now)]);
});
