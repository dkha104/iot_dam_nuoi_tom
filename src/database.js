import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, METRICS, measurement } from './domain.js';

// Collections thường: unique index chống trùng được cả khi worker khởi động lại.
export async function initializeDatabase(db) {
  const specs = {
    ponds: [[{ slug:1 }, {unique:true}]], devices: [[{ pondId:1, externalId:1 }, {unique:true}]],
    sensors: [[{ deviceId:1, metric:1 }, {unique:true}]],
    measurements: [[{deviceId:1, metric:1, observedAt:1},{unique:true}], [{pondId:1, metric:1, observedAt:-1},{}]],
    ingestion_state: [[{deviceId:1, metric:1},{unique:true}]],
    commands: [[{idempotencyKey:1},{unique:true}], [{deviceId:1, createdAt:-1},{}]],
    alerts: [[{pondId:1, createdAt:-1},{}], [{pondId:1, key:1, active:1},{}]],
    settings: [], weather_runs: [[{pondId:1, fetchedAt:-1},{}]],
    media_assets: [[{cameraId:1, capturedAt:-1},{}]],
    detections: [[{mediaId:1, modelVersionId:1},{}]],
    datasets: [[{name:1, version:1},{unique:true}]],
    training_jobs: [[{status:1, createdAt:1},{}]],
    model_versions: [[{pondId:1, metric:1, trainedAt:-1},{}]],
    predictions: [[{pondId:1, metric:1, targetAt:1},{}]],
    annotations: [[{mediaId:1, createdAt:-1},{}]],
    audit_logs: [[{createdAt:-1},{}]],
    users: [[{email:1},{unique:true}]], memberships: [[{userId:1, pondId:1},{unique:true}]]
  };
  for(const [name,indexes] of Object.entries(specs)) {
    if(!(await db.listCollections({name}).toArray()).length) await db.createCollection(name);
    for(const [keys,opts] of indexes) await db.collection(name).createIndex(keys,opts);
  }
  await db.command({collMod:'measurements',validator:{$jsonSchema:{bsonType:'object',required:['deviceId','pondId','metric','observedAt','receivedAt','quality','source','schemaVersion'],properties:{deviceId:{bsonType:'string'},pondId:{bsonType:'string'},metric:{bsonType:'string'},observedAt:{bsonType:'date'},receivedAt:{bsonType:'date'},quality:{enum:['valid','missing','invalid']},source:{enum:['thingsboard','demo']},value:{bsonType:['double','int','long','decimal','string','null']}}}},validationLevel:'strict',validationAction:'error'});
  await db.collection('ponds').updateOne({_id:'pond-01'},{$setOnInsert:{name:'Ao nuôi 01',slug:'ao-01',createdAt:new Date()}},{upsert:true});
  await db.collection('devices').updateOne({_id:'esp32-01'},{$setOnInsert:{pondId:'pond-01',name:'ESP32 DevKit V1',type:'controller',externalId:process.env.TB_DEVICE_ID || null,provider:'thingsboard',createdAt:new Date()}},{upsert:true});
  for(const [metric,unit,gpio] of [['temp','°C',4],['ph','pH',34],['turb','%',35],['laser',null,27]]) await db.collection('sensors').updateOne({deviceId:'esp32-01',metric},{$setOnInsert:{pondId:'pond-01',unit,gpio,calibrationVersion:null,createdAt:new Date()}},{upsert:true});
  await db.collection('settings').updateOne({_id:'pond-01'},{$setOnInsert:structuredClone(DEFAULT_SETTINGS)},{upsert:true});
}
export class Store {
  constructor(db=null) { this.db=db; this.mem={measurements:[],commands:[],alerts:[],media_assets:[],model_versions:[],predictions:[],audit_logs:[],weather_runs:[]}; this.settings=structuredClone(DEFAULT_SETTINGS); this.cursors={}; }
  async insert(collection, doc) { const row={...doc,_id:doc._id||randomUUID()}; if(this.db) await this.db.collection(collection).insertOne(row); else this.mem[collection].push(row); return row; }
  async list(collection,limit=100) { if(this.db) return this.db.collection(collection).find({}).sort({createdAt:-1}).limit(limit).toArray(); return this.mem[collection].slice(-limit).reverse(); }
  async getSettings() { if(this.db) {const s=await this.db.collection('settings').findOne({_id:'pond-01'}); delete s._id; return s;} return structuredClone(this.settings); }
  async setSettings(s) { if(this.db) await this.db.collection('settings').updateOne({_id:'pond-01'},{$set:s}); else this.settings=structuredClone(s); await this.insert('audit_logs',{action:'settings.updated',actorId:'local-operator',createdAt:new Date(),changes:s}); }
  async ingest(rows) {
    const valid=rows.filter(Boolean); if(!valid.length)return;
    if(this.db) await this.db.collection('measurements').bulkWrite(valid.map(row=>({updateOne:{filter:{deviceId:row.deviceId,metric:row.metric,observedAt:row.observedAt},update:{$setOnInsert:row},upsert:true}})),{ordered:false});
    else { for(const row of valid) if(!this.mem.measurements.some(x=>x.metric===row.metric && +x.observedAt===+row.observedAt)) this.mem.measurements.push(row); if(this.mem.measurements.length>100000) this.mem.measurements=this.mem.measurements.slice(-90000); }
  }
  async latest() {
    const rows=this.db ? (await Promise.all(Object.keys(METRICS).map(async metric=>({row:await this.db.collection('measurements').findOne({deviceId:'esp32-01',metric},{sort:{observedAt:-1}})})))).filter(x=>x.row) : Object.values(this.mem.measurements.reduce((a,r)=>{if(!a[r.metric] || +a[r.metric].row.observedAt<+r.observedAt)a[r.metric]={row:r};return a;},{}));
    return Object.fromEntries(rows.map(x=>[x.row.metric,x.row]));
  }
  async history(metric,start,end,limit=2000) {
    if(this.db)return (await this.db.collection('measurements').find({deviceId:'esp32-01',metric,observedAt:{$gte:new Date(start),$lte:new Date(end)}}).sort({observedAt:-1}).limit(limit).toArray()).reverse();
    return this.mem.measurements.filter(x=>x.metric===metric && +x.observedAt>=start && +x.observedAt<=end).sort((a,b)=>a.observedAt-b.observedAt).slice(-limit);
  }
  async cursor(metric) { if(this.db)return (await this.db.collection('ingestion_state').findOne({deviceId:'esp32-01',metric}))?.throughTs; return this.cursors[metric]; }
  async setCursor(metric,ts) { if(this.db) await this.db.collection('ingestion_state').updateOne({deviceId:'esp32-01',metric},{$set:{throughTs:ts,updatedAt:new Date()}},{upsert:true}); else this.cursors[metric]=ts; }
  async command(key) { return this.db ? this.db.collection('commands').findOne({idempotencyKey:key}) : this.mem.commands.find(x=>x.idempotencyKey===key); }
  async update(collection,id,patch) { if(this.db)await this.db.collection(collection).updateOne({_id:id},{$set:patch}); else Object.assign(this.mem[collection].find(x=>x._id===id),patch); }
  async reconcileAlerts(candidates) {
    const active=this.db ? await this.db.collection('alerts').find({active:true,kind:{$in:['threshold','sensor','security','connection']}}).toArray() : this.mem.alerts.filter(x=>x.active && ['threshold','sensor','security','connection'].includes(x.kind));
    for(const old of active)if(!candidates.some(c=>c.key===old.key))await this.update('alerts',old._id,{active:false,resolvedAt:new Date()});
    for(const c of candidates)if(!active.some(a=>a.key===c.key))await this.insert('alerts',{...c,pondId:'pond-01',active:true,acknowledgedAt:null,createdAt:new Date(),source:this.db?'live':'demo'});
  }
}
export async function openStore() {
  if(process.env.APP_MODE!=='live')return new Store();
  if(!process.env.MONGODB_URI)throw new Error('Live cần MONGODB_URI.');
  const {MongoClient}=await import('mongodb');
  const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:6000});
  await client.connect();const db=client.db(process.env.MONGODB_DB||'aotom');await initializeDatabase(db);
  await db.collection('commands').updateMany({status:'pending'},{$set:{status:'unknown',error:'Backend khởi động lại khi lệnh đang chờ. Cần đọc lại trạng thái; không tự gửi lại.',completedAt:new Date()}});
  const s=new Store(db);s.client=client;return s;
}
export async function seedDemo(store) {
  const now=Date.now(),rows=[];
  for(let i=288;i>=0;i--) {
    const ts=now-i*300000;
    const values={temp:29.1+Math.sin(i/35)*1.2+Math.sin(i/6)*.17,ph:7.98+Math.sin(i/43)*.16,turb:27.8+Math.sin(i/24)*5.2,laser:0,pump:0,fan:1,auto:1,alert_level:0,alerts:'',ph_calibrated:1};
    for(const [k,v]of Object.entries(values))rows.push(measurement(k,typeof v==='number'?Math.round(v*100)/100:v,ts,'demo'));
  }
  await store.ingest(rows);
  await store.insert('alerts',{pondId:'pond-01',key:'demo:resolved',kind:'threshold',severity:'warning',title:'Nhiệt độ nước đã trở về ngưỡng',detail:'Sự kiện minh họa: 32.4 °C → 30.8 °C.',createdAt:new Date(now-1800000),resolvedAt:new Date(now-1500000),active:false,acknowledgedAt:null,source:'demo'});
}
