import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function waterBounds'),source.indexOf('function overviewStatus'));
test('water ranges and chart envelope preserve spikes and missing values',()=>{
 const ctx=vm.createContext({});vm.runInContext(helpers,ctx);
 assert.deepEqual(Array.from(ctx.waterBounds('ph',{phMin:7.5,phMax:8.5})),[7.5,8.5]);
 const points=Array.from({length:2000},(_,i)=>[i,i===111?999:10]);
 assert.ok(ctx.envelope(points).some(p=>p[1]===999));
 assert.equal(ctx.envelope([[0,5]]).length,1);
});
