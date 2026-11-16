export const METRICS = {
  temp: { label: 'Nhiệt độ nước', unit: '°C', min: -10, max: 80, forecast: true },
  ph: { label: 'Độ pH', unit: 'pH', min: 0, max: 14, forecast: true },
  turb: { label: 'Độ đục tương đối', unit: '%', min: 0, max: 100, forecast: true },
  humidity: { label: 'Độ ẩm tại ao', unit: '%', min: 0, max: 100, forecast: true },
  laser: { min: 0, max: 1 }, pump: { min: 0, max: 1 }, fan: { min: 0, max: 1 },
  auto: { min: 0, max: 1 }, alert_level: { min: 0, max: 3 }, alerts: {}, ph_calibrated: { min: 0, max: 1 }
};
export const DEFAULT_SETTINGS = {
  pondName: 'Ao nuôi 01', latitude: null, longitude: null,
  thresholds: { tempMin: 26, tempMax: 32, phMin: 7.5, phMax: 8.5, turbMax: 60 },
  weather: { rainMm: 15, windKmh: 40, hotC: 35 }
};
export function measurement(key, raw, ts, source = 'thingsboard') {
  if (!Object.hasOwn(METRICS, key) || !Number.isFinite(ts) || ts < 0 || ts > Date.now()+300000) return null;
  const missing = raw === null || raw === undefined || raw === '' || String(raw).toLowerCase() === 'null';
  let value = key === 'alerts' ? (missing ? null : String(raw).slice(0,1000)) : missing ? null : raw === true || raw === 'true' ? 1 : raw === false || raw === 'false' ? 0 : Number(raw);
  let quality = missing ? 'missing' : 'valid';
  if (key !== 'alerts' && !missing && (!Number.isFinite(value) || value < METRICS[key].min || value > METRICS[key].max)) { quality = 'invalid'; value = null; }
  if (quality === 'valid' && ['laser','pump','fan','auto','ph_calibrated'].includes(key) && ![0,1].includes(value)) { quality='invalid';value=null; }
  if (quality === 'valid' && key === 'alert_level' && !Number.isInteger(value)) { quality='invalid';value=null; }
  return { deviceId: 'esp32-01', pondId: 'pond-01', metric: key, value, unit: METRICS[key].unit || null,
    observedAt: new Date(ts), receivedAt: new Date(), quality, source, schemaVersion: 1 };
}
export function validateSettings(body) {
  const s = structuredClone(DEFAULT_SETTINGS);
  if (typeof body.pondName !== 'string' || !body.pondName.trim() || body.pondName.length > 80) throw new Error('Tên ao phải có từ 1 đến 80 ký tự.');
  s.pondName = body.pondName.trim();
  for (const [key, lo, hi] of [['latitude', -90, 90], ['longitude', -180, 180]]) {
    if (body[key] !== null && (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < lo || body[key] > hi)) throw new Error('Tọa độ không hợp lệ.');
    s[key] = body[key];
  }
  if ((s.latitude === null) !== (s.longitude === null)) throw new Error('Cần nhập đủ vĩ độ và kinh độ.');
  for (const [key, lo, hi] of [['tempMin', -10, 80], ['tempMax', -10, 80], ['phMin', 0, 14], ['phMax', 0, 14], ['turbMax', 0, 100]]) {
    const n = body.thresholds?.[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new Error('Ngưỡng cảnh báo không hợp lệ.');
    s.thresholds[key] = n;
  }
  if (s.thresholds.tempMin >= s.thresholds.tempMax || s.thresholds.phMin >= s.thresholds.phMax) throw new Error('Ngưỡng thấp phải nhỏ hơn ngưỡng cao.');
  for (const [key, lo, hi] of [['rainMm', 1, 200], ['windKmh', 1, 300], ['hotC', 0, 60]]) {
    const n = body.weather?.[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new Error('Ngưỡng thời tiết không hợp lệ.');
    s.weather[key] = n;
  }
  return s;
}
export function candidates(latest, settings, now = Date.now()) {
  const alerts = [], t = settings.thresholds;
  for (const [key, low, high, name] of [['temp', t.tempMin, t.tempMax, 'Nhiệt độ nước'], ['ph', t.phMin, t.phMax, 'pH'], ['turb', null, t.turbMax, 'Độ đục']]) {
    const p = latest[key];
    if (!p || now - new Date(p.observedAt).getTime() > 30000) continue;
    if (p.quality !== 'valid') { alerts.push({ key: `sensor:${key}`, kind: 'sensor', severity: 'warning', title: `${name}: dữ liệu thiếu hoặc không hợp lệ`, detail: 'Kiểm tra cảm biến và hiệu chuẩn. Không dùng bản ghi này để huấn luyện.' }); continue; }
    if ((low !== null && p.value < low) || p.value > high) alerts.push({ key: `threshold:${key}`, kind: 'threshold', severity: key === 'temp' && (p.value < 24 || p.value > 34) ? 'critical' : 'warning', title: `${name} vượt ngưỡng`, detail: `Giá trị ${p.value} ${p.unit || ''}. Ngưỡng theo dõi: ${low === null ? '≤ ' : low + '–'}${high}.` });
  }
  if (latest.laser?.value === 1 && now-new Date(latest.laser.observedAt).getTime() <= 30000) alerts.push({ key: 'security:laser', kind: 'security', severity: 'critical', title: 'Hàng rào laser bị cắt', detail: 'Kiểm tra khu vực ao. Chưa có kết luận nhận diện vật thể từ camera.' });
  return alerts;
}
function regression(points, origin) {
  const xs = points.map(p=>(new Date(p.observedAt).getTime()-origin)/3600000), ys=points.map(p=>p.value);
  const mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=ys.reduce((a,b)=>a+b,0)/ys.length;
  const den=xs.reduce((s,x)=>s+(x-mx)**2,0);
  const slope=den ? xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0)/den : 0;
  return { slope, intercept: my-slope*mx };
}
// Baseline học từ dữ liệu thật theo thời gian, chỉ dùng cho thí nghiệm.
export function trainBaseline(points, metric) {
  if (!METRICS[metric]?.forecast) throw new Error('Chỉ số không hỗ trợ dự báo.');
  const p=points.filter(x=>x.metric===metric && x.quality==='valid' && Number.isFinite(x.value)).sort((a,b)=>new Date(a.observedAt)-new Date(b.observedAt));
  if(p.length<60 || new Date(p.at(-1).observedAt)-new Date(p[0].observedAt)<3*3600000) throw new Error('Cần ít nhất 60 điểm hợp lệ trải dài tối thiểu 3 giờ.');
  if(Date.now()-new Date(p.at(-1).observedAt).getTime()>30*60000) throw new Error('Dữ liệu gần nhất đã cũ hơn 30 phút. Cần đồng bộ trước khi dự báo.');
  const cut=Math.floor(p.length*.8), train=p.slice(0,cut), test=p.slice(cut), origin=new Date(p[0].observedAt).getTime();
  const fit=regression(train,origin);
  const mae=test.reduce((s,x)=>s+Math.abs(x.value-(fit.intercept+fit.slope*(new Date(x.observedAt).getTime()-origin)/3600000)),0)/test.length;
  const naiveMAE=test.reduce((s,x)=>s+Math.abs(x.value-train.at(-1).value),0)/test.length;
  const final=regression(p,origin), last=new Date(p.at(-1).observedAt).getTime();
  const forecasts=Array.from({length:6},(_,i)=>({ targetAt:new Date(last+(i+1)*30*60000), value:final.intercept+final.slope*(last-origin+(i+1)*30*60000)/3600000 }));
  return { algorithm:'linear-trend-v1', metric, trainedAt:new Date(), dataStart:new Date(p[0].observedAt), dataEnd:new Date(last), sampleCount:p.length,
    split:'chronological-80-20', validation:{mae,naiveMAE,trainCount:train.length,testCount:test.length}, parameters:{...final,origin}, forecasts,
    warning:'Baseline tuyến tính thử nghiệm; không phải dự báo đã được kiểm chứng để tự động điều khiển. Không suy ra pH từ thời tiết.' };
}
