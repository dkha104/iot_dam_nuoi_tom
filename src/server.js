import http from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,extname} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {openStore,seedDemo} from './database.js';
import {METRICS,measurement,candidates,validateSettings,trainBaseline} from './domain.js';
import {ThingsBoard} from './thingsboard.js';
import {groupMeasurementSessions, SESSION_GAP_MS, SESSION_LOOKBACK_MS, SESSION_POINT_LIMIT} from './sessions.js';

const root=fileURLToPath(new URL('..',import.meta.url)), mode=process.env.APP_MODE||'demo';
if(!['demo','live'].includes(mode))throw new Error('APP_MODE phải là demo hoặc live.');
const store=await openStore();
const tb=mode==='live'?new ThingsBoard(store):null;
if(mode==='demo')await seedDemo(store);
const token=randomBytes(32).toString('hex');
let syncing=false,commandBusy=false,weatherBusy=false,rpcStates={},lastDemo=Date.now();
const demoState={pump:0,fan:1,auto:1};
async function tick() {
  if(syncing)return;syncing=true;
  try {
    if(tb)await tb.sync();
    else {
      const t=(Date.now()-lastDemo)/60000;
      const v={temp:29.1+Math.sin(t/3)*.25,ph:7.98+Math.sin(t/5)*.03,turb:27.8+Math.sin(t/4)*1.2,laser:0,...demoState,alert_level:0,ph_calibrated:1};
      await store.ingest(Object.entries(v).map(([k,val])=>measurement(k,Math.round(val*100)/100,Date.now(),'demo')));
    }
    const latest=await store.latest(), list=candidates(latest,await store.getSettings());
    if(mode==='live' && (!latest.temp || Date.now()-new Date(latest.temp.observedAt)>30000))list.push({key:'connection:stale',kind:'connection',severity:'warning',title:'Dữ liệu ESP32 chưa có hoặc đã cũ',detail:'Kiểm tra nguồn, Wi-Fi, ThingsBoard và cấu hình đồng bộ. Không coi dữ liệu cũ là trạng thái hiện tại.'});
    await store.reconcileAlerts(list);
  } catch { if(tb)tb.status.error='Không thể ghi hoặc đọc MongoDB. Kiểm tra dịch vụ cục bộ.'; }
  finally{syncing=false;}
}
const interval=setInterval(tick,Math.max(2000,Number(process.env.TB_POLL_MS)||5000));

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>32768)throw Object.assign(new Error('Yêu cầu quá lớn.'),{status:413});}try{const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw Object.assign(new Error('JSON phải là một object hợp lệ.'),{status:400});}}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function range(url){const end=Number(url.searchParams.get('end')||Date.now()),start=Number(url.searchParams.get('start')||end-86400000);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end-start>31*86400000)fail('Khoảng thời gian tối đa 31 ngày.');return{start,end};}
function boolReply(x){if(typeof x==='boolean')return x;if(x===0||x===1)return Boolean(x);fail('Phản hồi RPC không đúng kiểu boolean của firmware.',502);}
function cameraURL(kind){const raw=process.env[kind==='stream'?'CAMERA_STREAM_URL':'CAMERA_CAPTURE_URL'];if(!raw)fail('Chưa cấu hình URL ESP32-CAM trong .env.',409);const u=new URL(raw);if(!['http:','https:'].includes(u.protocol))fail('Camera URL không hợp lệ.');return u;}
async function fetchImage(){const r=await fetch(cameraURL('capture'),{signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)fail('Camera không trả ảnh.',502);const type=r.headers.get('content-type')?.split(';')[0];if(!['image/jpeg','image/png'].includes(type))fail('Camera phải trả JPEG hoặc PNG.',502);const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>5*1024*1024)fail('Ảnh vượt quá 5 MB.',413);chunks.push(c);}return{bytes:Buffer.concat(chunks),type};}
async function weatherFetch() {
  const s=await store.getSettings();if(s.latitude===null || s.longitude===null)fail('Nhập tọa độ ao trong Cài đặt trước.',409);
  const u=new URL('https://api.open-meteo.com/v1/forecast');
  u.search=new URLSearchParams({latitude:s.latitude,longitude:s.longitude,hourly:'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m',forecast_days:'2',timezone:'UTC',timeformat:'unixtime'});
  const r=await fetch(u,{signal:AbortSignal.timeout(15000)});if(!r.ok)fail(`API thời tiết HTTP ${r.status}.`,502);
  const d=await r.json(),now=Date.now();
  const hours=d.hourly.time.map((t,i)=>({targetAt:new Date(t*1000),airTemp:d.hourly.temperature_2m[i],humidity:d.hourly.relative_humidity_2m[i],rain:d.hourly.precipitation[i],rainProbability:d.hourly.precipitation_probability[i],wind:d.hourly.wind_speed_10m[i]})).filter(x=>+x.targetAt>=now-3600000).slice(0,24);
  const risks=hours.filter(x=>(Number.isFinite(x.rain)&&x.rain>=s.weather.rainMm)||(Number.isFinite(x.wind)&&x.wind>=s.weather.windKmh)||(Number.isFinite(x.airTemp)&&x.airTemp>=s.weather.hotC)).map(x=>({...x,title:x.rain>=s.weather.rainMm?'Dự báo mưa lớn':x.wind>=s.weather.windKmh?'Dự báo gió mạnh':'Dự báo nắng nóng'}));
  const row=await store.insert('weather_runs',{pondId:'pond-01',provider:'open-meteo',fetchedAt:new Date(),latitude:s.latitude,longitude:s.longitude,hours,risks,createdAt:new Date()});
  for(const risk of risks.slice(0,3))await store.insert('alerts',{pondId:'pond-01',key:`weather:${+risk.targetAt}`,kind:'weather',severity:'warning',title:risk.title,detail:`${risk.targetAt.toISOString()}: mưa ${risk.rain} mm/h, gió ${risk.wind} km/h, không khí ${risk.airTemp} °C. Đây là dự báo thời tiết, chưa dự báo trực tiếp pH/nhiệt độ nước.`,active:false,createdAt:new Date(),source:'open-meteo'});
  return row;
}
async function state(){
  const latest=await store.latest(),settings=await store.getSettings();
  const activeTs=['temp','ph','turb'].map(k=>latest[k]?+new Date(latest[k].observedAt):0);
  const fresh=activeTs.some(t=>Date.now()-t<30000);
  const weather=(await store.list('weather_runs',1))[0]||null;
  return{mode,token,settings,latest,rpcStates,metrics:METRICS,now:new Date(),connection:{...(tb?.status||{connected:true,lastSyncAt:new Date(),error:null}),deviceFresh:fresh,database:store.db?'MongoDB':'RAM · mô phỏng',camera:!!process.env.CAMERA_STREAM_URL,cameraCapture:!!process.env.CAMERA_CAPTURE_URL},alerts:await store.list('alerts',100),commands:await store.list('commands',30),media:await store.list('media_assets',30),models:await store.list('model_versions',20),weather:weather&&weather.latitude===settings.latitude&&weather.longitude===settings.longitude?weather:null};
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  try {
    const host=req.headers.host||'';
    // DNS rebinding / CSRF: chỉ phục vụ host cục bộ và host preview được cấu hình.
    const allowed=['localhost','127.0.0.1','[::1]',...(process.env.PREVIEW_HOSTS||'').split(',').filter(Boolean)];
    if(!allowed.some(h=>host===h||host.startsWith(h+':')))fail('Host không được cho phép.',403);
    const url=new URL(req.url,'http://'+host),path=url.pathname;
    if(req.headers['sec-fetch-site']==='cross-site')fail('Yêu cầu khác nguồn bị từ chối.',403);
    if(req.method!=='GET' && (req.headers['x-app-token']!==token || (req.headers.origin && req.headers.origin!==url.origin)))fail('Phiên thao tác không hợp lệ. Tải lại trang.',403);
    if(path==='/api/state'&&req.method==='GET')return json(res,200,await state());
    if(path==='/api/sessions'&&req.method==='GET'){
      const metric=url.searchParams.get('metric')||'temp';
      if(!Object.hasOwn(METRICS,metric)||!METRICS[metric].forecast)fail('Chỉ số không hỗ trợ xem đợt đo.');
      const end=Date.now(),start=end-SESSION_LOOKBACK_MS;
      const times=await store.historyTimes(metric,start,end,SESSION_POINT_LIMIT);
      return json(res,200,{metric,sessions:groupMeasurementSessions(times),gapMs:SESSION_GAP_MS,
        lookbackDays:7,limit:SESSION_POINT_LIMIT,truncated:times.length===SESSION_POINT_LIMIT,now:new Date(end)});
    }
    if(path==='/api/history'&&req.method==='GET'){
      const metric=url.searchParams.get('metric')||'temp';if(!Object.hasOwn(METRICS,metric))fail('Chỉ số không hợp lệ.');const{start,end}=range(url);
      const limit=Math.min(50000,Math.max(1,Number(url.searchParams.get('limit'))||2000));
      const rows=await store.history(metric,start,end,limit);return json(res,200,{rows,limit,truncated:rows.length===limit});
    }
    if(path==='/api/export'&&req.method==='GET'){
      const metric=url.searchParams.get('metric')||'temp';if(!Object.hasOwn(METRICS,metric))fail('Chỉ số không hợp lệ.');const{start,end}=range(url);const rows=await store.history(metric,start,end,50000);
      // Chỉ xuất metric số: tránh formula injection từ chuỗi alerts không tin cậy.
      if(!METRICS[metric].forecast)fail('Chỉ xuất chỉ số cảm biến dạng số.');
      const csv='observed_at,device_id,pond_id,metric,value,unit,quality,source\r\n'+rows.map(p=>[new Date(p.observedAt).toISOString(),p.deviceId,p.pondId,p.metric,p.value??'',p.unit,p.quality,p.source].join(',')).join('\r\n');
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="aotom-${metric}.csv"`,'X-Export-Limit':'50000'});return res.end('\uFEFF'+csv);
    }
    if(path==='/api/settings'&&req.method==='POST'){const b=await body(req);let s;try{s=validateSettings(b);}catch(e){fail(e.message);}await store.setSettings(s);return json(res,200,{ok:true,settings:s});}
    if(path==='/api/sync'&&req.method==='POST'){if(syncing)fail('Đang đồng bộ. Vui lòng đợi.',409);await tick();return json(res,200,{ok:!tb||tb.status.connected,status:tb?.status});}
    if(path==='/api/commands'&&req.method==='POST'){
      const b=await body(req);if(!['setPump','setFan','setAuto'].includes(b.method)||typeof b.value!=='boolean'||typeof b.idempotencyKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(b.idempotencyKey))fail('Lệnh không hợp lệ.');
      const prior=await store.command(b.idempotencyKey);if(prior)return json(res,200,prior);
      if(commandBusy)fail('Đang có lệnh chờ phản hồi. Vui lòng đợi.',409);
      commandBusy=true;
      try{
        const c=await store.insert('commands',{pondId:'pond-01',deviceId:'esp32-01',method:b.method,requestedValue:b.value,idempotencyKey:b.idempotencyKey,status:'pending',createdAt:new Date(),actorId:'local-operator',source:mode});
        try{
          let ack;
          if(mode==='demo'){const k={setPump:'pump',setFan:'fan',setAuto:'auto'}[b.method];demoState[k]=+b.value;if(k!=='auto')demoState.auto=0;ack=b.value;await tick();}
          else ack=boolReply(await tb.rpc(b.method,b.value));
          const patch={status:ack===b.value?'acknowledged':'rejected',acknowledgedValue:ack,completedAt:new Date()};
          await store.update('commands',c._id,patch);Object.assign(c,patch);
          if(tb){for(const [key,method]of [['pump','getPump'],['fan','getFan'],['auto','getAuto']]){try{rpcStates[key]={value:+boolReply(await tb.rpc(method,{})),observedAt:new Date(),source:'rpc'};}catch{ /* Không đoán trạng thái khi RPC đọc thất bại. */ }}}
          return json(res,200,c);
        }catch(e){const patch={status:e.status===403||e.status===404?'failed':'unknown',error:e.message,completedAt:new Date()};await store.update('commands',c._id,patch);return json(res,502,{...c,...patch});}
      }finally{commandBusy=false;}
    }
    if(path.startsWith('/api/alerts/')&&req.method==='POST'){
      const id=path.slice('/api/alerts/'.length);const a=(await store.list('alerts',100)).find(x=>String(x._id)===id);if(!a)fail('Không tìm thấy cảnh báo.',404);
      await store.update('alerts',a._id,{acknowledgedAt:new Date(),acknowledgedBy:'local-operator'});return json(res,200,{ok:true});
    }
    if(path==='/api/weather/refresh'&&req.method==='POST'){
      if(weatherBusy)fail('Đang lấy thời tiết.',409);const last=(await store.list('weather_runs',1))[0],s=await store.getSettings();
      if(last&&Date.now()-new Date(last.fetchedAt)<600000&&last.latitude===s.latitude&&last.longitude===s.longitude)return json(res,200,last);
      weatherBusy=true;try{return json(res,200,await weatherFetch());}finally{weatherBusy=false;}
    }
    if(path==='/api/camera/stream'&&req.method==='GET'){
      const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),600000);res.on('close',()=>{clearTimeout(timer);abort.abort();});
      try{const r=await fetch(cameraURL('stream'),{signal:abort.signal,redirect:'error'});if(!r.ok)fail('Không kết nối được camera.',502);const type=r.headers.get('content-type')||'';if(!type.startsWith('multipart/x-mixed-replace')&&!type.startsWith('image/'))fail('Stream không đúng định dạng MJPEG.',502);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});await pipeline(Readable.fromWeb(r.body),res);return;}finally{clearTimeout(timer);}
    }
    if(path==='/api/camera/capture'&&req.method==='POST'){
      const {bytes,type}=await fetchImage(),id=randomUUID(),ext=type==='image/png'?'png':'jpg';
      await mkdir(join(root,'data','images'),{recursive:true});await writeFile(join(root,'data','images',`${id}.${ext}`),bytes);
      const m=await store.insert('media_assets',{_id:id,pondId:'pond-01',cameraId:'esp32cam-01',capturedAt:new Date(),createdAt:new Date(),mimeType:type,sizeBytes:bytes.length,storageKey:`${id}.${ext}`,labelStatus:'unlabeled',inferenceStatus:'not_run'});return json(res,201,m);
    }
    if(path.startsWith('/api/media/')&&req.method==='GET'){
      const id=path.slice('/api/media/'.length),m=(await store.list('media_assets',100)).find(x=>x._id===id);if(!m)fail('Không tìm thấy ảnh.',404);const bytes=await readFile(join(root,'data','images',m.storageKey));res.writeHead(200,{'Content-Type':m.mimeType,'Cache-Control':'no-store'});return res.end(bytes);
    }
    if(path==='/api/models/train'&&req.method==='POST'){
      const b=await body(req);if(!METRICS[b.metric]?.forecast)fail('Chỉ số không hợp lệ.');
      const points=await store.history(b.metric,Date.now()-7*86400000,Date.now(),50000);let model;try{model=trainBaseline(points,b.metric);}catch(e){fail(e.message,409);}
      const saved=await store.insert('model_versions',{...model,pondId:'pond-01',source:mode,createdAt:new Date()});
      for(const p of model.forecasts)await store.insert('predictions',{...p,pondId:'pond-01',metric:b.metric,modelVersionId:saved._id,issuedAt:new Date(),source:mode,createdAt:new Date()});
      return json(res,201,saved);
    }
    if(path==='/api/schema'&&req.method==='GET')return json(res,200,{collections:[{name:'ponds',purpose:'Ao nuôi, vị trí và metadata'},{name:'devices',purpose:'ESP32, ESP32-CAM và định danh ThingsBoard'},{name:'sensors',purpose:'Đơn vị, GPIO, phiên bản hiệu chuẩn'},{name:'measurements',purpose:'Dữ liệu gốc theo từng chỉ số và thời điểm đo'},{name:'ingestion_state',purpose:'Cursor đồng bộ riêng từng key, khôi phục sau gián đoạn'},{name:'commands',purpose:'Lệnh RPC, phản hồi, trạng thái và chống gửi lặp'},{name:'alerts',purpose:'Cảnh báo, xác nhận và thời điểm kết thúc'},{name:'settings',purpose:'Ngưỡng trên web và tọa độ ao'},{name:'weather_runs',purpose:'Thời điểm lấy dự báo và các giờ dự báo'},{name:'media_assets',purpose:'Metadata ảnh, đường dẫn, thời điểm chụp'},{name:'annotations',purpose:'Nhãn người gán, bounding box và lịch sử'},{name:'detections',purpose:'Kết quả nhận diện và phiên bản mô hình'},{name:'datasets',purpose:'Phiên bản tập dữ liệu và phân chia thời gian'},{name:'training_jobs',purpose:'Hàng đợi tác vụ huấn luyện mở rộng'},{name:'model_versions',purpose:'Tham số, nguồn dữ liệu, MAE và phiên bản mô hình'},{name:'predictions',purpose:'Thời điểm phát hành, thời điểm dự báo và model'},{name:'audit_logs',purpose:'Lịch sử thay đổi cấu hình'},{name:'users',purpose:'Dự phòng tài khoản; bản localhost chưa dùng đăng nhập'},{name:'memberships',purpose:'Dự phòng quyền người dùng trên từng ao'}]});
    if(path.startsWith('/api/'))fail('API không tồn tại.',404);
    if(req.method!=='GET')fail('Phương thức không được hỗ trợ.',405);
    const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};if(!files[path])fail('Không tìm thấy trang.',404);
    const file=files[path],content=await readFile(join(root,'public',file));res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[extname(file)],'Cache-Control':'no-cache'});res.end(content);
  }catch(e){if(res.headersSent){res.destroy();return;}const safe=e.status?e.message:e.name==='TimeoutError'?'Kết nối hết thời gian chờ.':'Không thể hoàn tất yêu cầu. Kiểm tra kết nối và cấu hình trên máy chủ.';json(res,e.status||502,{error:safe});}
});
const portArg=process.argv.indexOf('--port');
const port=Number(portArg>=0?process.argv[portArg+1]:process.env.PORT)||3000;
server.listen(port,'127.0.0.1',()=>{console.log(`AoTom Nexus · ${mode} · http://localhost:${server.address().port}`);void tick();});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(interval);server.close(async()=>{await store.client?.close();process.exit(0);});});
