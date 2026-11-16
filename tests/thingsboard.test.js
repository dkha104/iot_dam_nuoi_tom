import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {ThingsBoard} from '../src/thingsboard.js';
import {Store} from '../src/database.js';
test('ThingsBoard adapter preserves null/timestamps, paginates and replays without duplicates',async()=>{
 const base=Date.now()-100000,values=Array.from({length:1003},(_,i)=>({ts:base+i,value:i===2?'null':'7.8'}));let login=0,phCalls=0;
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');const u=new URL(req.url,'http://localhost');if(u.pathname==='/api/auth/login'){login++;res.end(JSON.stringify({token:'test-jwt'}));return;}
 if(req.headers['x-authorization']!=='Bearer test-jwt'){res.writeHead(401);res.end('{}');return;}
 if(u.pathname.includes('/rpc/')){res.end('true');return;}
 const key=u.searchParams.get('keys'),start=+u.searchParams.get('startTs'),end=+u.searchParams.get('endTs');if(key==='ph')phCalls++;res.end(JSON.stringify({[key]:key==='ph'?values.filter(x=>x.ts>=start&&x.ts<=end).slice(0,1000):[]}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const original={...process.env};Object.assign(process.env,{TB_URL:`http://127.0.0.1:${server.address().port}`,TB_DEVICE_ID:'test-device',TB_USERNAME:'test',TB_PASSWORD:'local-test',TB_JWT:'expired'});
 try{const s=new Store(),tb=new ThingsBoard(s);await tb.sync();assert.equal(tb.status.connected,true);assert.equal(s.mem.measurements.length,1003);assert.equal(s.mem.measurements[2].value,null);assert.equal(+s.mem.measurements[0].observedAt,base);assert.equal(phCalls,2);assert.equal(login,1);await tb.sync();assert.equal(s.mem.measurements.length,1003);assert.equal(await tb.rpc('setPump',true),true);}
 finally{process.env=original;await new Promise(r=>server.close(r));}
});
