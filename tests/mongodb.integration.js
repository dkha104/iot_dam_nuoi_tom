// Dùng DB ngẫu nhiên dành riêng cho kiểm thử; không ghi vào MONGODB_DB của người dùng.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {initializeDatabase,Store} from '../src/database.js';
import {measurement} from '../src/domain.js';
if(!process.env.MONGO_TEST_URI)throw new Error('Cần MONGO_TEST_URI trỏ tới MongoDB dành cho kiểm thử.');
const client=new MongoClient(process.env.MONGO_TEST_URI),name='aotom_test_'+randomUUID().replaceAll('-','');
try{
 await client.connect();const db=client.db(name);await initializeDatabase(db);const s=new Store(db);
 assert.equal((await db.listCollections().toArray()).length,19);
 const ts=Date.now(),a=measurement('ph','7.9',ts),b=measurement('ph',null,ts-10000);
 await s.ingest([a,b]);await s.ingest([a,b]);assert.equal(await db.collection('measurements').countDocuments(),2);
 assert.equal((await s.latest()).ph.value,7.9);assert.equal((await s.history('ph',ts-20000,ts))[0].value,null);
 await assert.rejects(db.collection('measurements').insertOne({...a,observedAt:new Date(ts+1),quality:'invented'}));
 await assert.rejects(db.collection('measurements').insertOne({...a}));
 const c=await s.insert('commands',{idempotencyKey:'mongo-test-key',status:'pending',createdAt:new Date()});
 await s.update('commands',c._id,{status:'acknowledged'});assert.equal((await s.command('mongo-test-key')).status,'acknowledged');
 await assert.rejects(s.insert('commands',{idempotencyKey:'mongo-test-key',createdAt:new Date()}));
 const set=await s.getSettings();await s.setSettings({...set,pondName:'Test Pond'});assert.equal((await s.getSettings()).pondName,'Test Pond');
 await s.reconcileAlerts([{key:'threshold:ph',kind:'threshold',title:'Test'}]);await s.reconcileAlerts([{key:'threshold:ph',kind:'threshold',title:'Test'}]);assert.equal(await db.collection('alerts').countDocuments(),1);
 await s.reconcileAlerts([]);assert.equal((await s.list('alerts'))[0].active,false);
 const info=await db.admin().serverInfo();console.log(`MongoDB ${info.version}: 19 collections, validator, unique indexes, null/dedup, commands, settings, alert lifecycle passed.`);
}finally{await client.db(name).dropDatabase();await client.close();}
