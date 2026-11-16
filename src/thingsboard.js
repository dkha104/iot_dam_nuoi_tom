import { METRICS, measurement } from './domain.js';
export class ThingsBoard {
  constructor(store) {
    this.store=store;this.jwt=process.env.TB_JWT||'';this.status={connected:false,lastSyncAt:null,error:null};
    if(!process.env.TB_URL||!process.env.TB_DEVICE_ID)throw new Error('Live cần TB_URL và TB_DEVICE_ID.');
    this.base=new URL(process.env.TB_URL);
    if(!['https:','http:'].includes(this.base.protocol))throw new Error('TB_URL phải dùng HTTP/HTTPS.');
    this.device=encodeURIComponent(process.env.TB_DEVICE_ID);
  }
  async login() {
    if(!process.env.TB_USERNAME||!process.env.TB_PASSWORD)throw new Error('JWT hết hạn hoặc chưa có thông tin đăng nhập ThingsBoard.');
    const r=await fetch(new URL('/api/auth/login',this.base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.TB_USERNAME,password:process.env.TB_PASSWORD}),signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error(`Đăng nhập ThingsBoard thất bại (HTTP ${r.status}).`);
    this.jwt=(await r.json()).token;
  }
  async request(path,body,retry=true) {
    if(!this.jwt)await this.login();
    const r=await fetch(new URL(path,this.base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Authorization':`Bearer ${this.jwt}`},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    if(r.status===401 && retry){await this.login();return this.request(path,body,false);}
    if(!r.ok){const e=new Error(`ThingsBoard HTTP ${r.status}${r.status===504?': hết thời gian chờ, trạng thái thiết bị chưa xác định.':''}`);e.status=r.status;throw e;}
    const text=await r.text();return text?JSON.parse(text):null;
  }
  async sync() {
    const end=Date.now();
    try {
      // Timestamp gốc, cursor riêng từng key; overlap 60s an toàn nhờ unique index.
      for(const metric of Object.keys(METRICS)) {
        const cursor=await this.store.cursor(metric);
        let start=cursor===undefined ? end-Math.min(168,Math.max(1,Number(process.env.TB_BACKFILL_HOURS)||24))*3600000 : Math.max(0,cursor-60000);
        let pages=0;
        while(start<=end && pages++<200) {
          const query=new URLSearchParams({keys:metric,startTs:String(start),endTs:String(end),limit:'1000',agg:'NONE',orderBy:'ASC'});
          const data=await this.request(`/api/plugins/telemetry/DEVICE/${this.device}/values/timeseries?${query}`);
          const arr=data[metric]||[];
          const rows=arr.map(p=>measurement(metric,p.value,Number(p.ts)));
          await this.store.ingest(rows);
          if(arr.length<1000){await this.store.setCursor(metric,end);break;}
          const max=Math.max(...arr.map(x=>Number(x.ts)));
          if(!Number.isFinite(max)||max<start)throw new Error('Timestamp ThingsBoard không hợp lệ.');
          await this.store.setCursor(metric,max);start=max+1;
        }
      }
      this.status={connected:true,lastSyncAt:new Date(),error:null};
    }catch(e){this.status={...this.status,connected:false,error:e.message};}
  }
  async rpc(method,params) {
    const root=process.env.TB_RPC_PATH||'/api/rpc/twoway';
    return this.request(`${root}/${this.device}`,{method,params,timeout:10000,persistent:false});
  }
}
