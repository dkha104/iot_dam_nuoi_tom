const {chromium}=require('playwright');
const path=require('node:path');
// Resolve project files independently of the shell's current directory.
process.chdir(path.resolve(__dirname,'..'));
const {spawn}=require('node:child_process');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const child=spawn(process.execPath,['src/server.js','--port','3198'],{env:{...process.env,APP_MODE:'demo',CAMERA_STREAM_URL:'',CAMERA_CAPTURE_URL:'',TB_URL:'',TB_JWT:'',TB_USERNAME:'',TB_PASSWORD:'',MONGODB_URI:''},stdio:['ignore','pipe','pipe']});
 let browser;
 try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Demo startup timeout (15s). Check port 3198.')),15000);let output='';const fail=e=>{clearTimeout(timer);reject(e);};child.stdout.on('data',b=>{output+=String(b);if(output.includes('http://localhost:3198')){clearTimeout(timer);resolve();}});child.on('error',fail);child.on('exit',c=>fail(Error('Demo exited with code '+c+'. Check port 3198.')));});
 // Default to Playwright Chromium on Windows, macOS and Linux.
 // Optional: UI_BROWSER_CHANNEL=msedge or chrome for an installed browser.
 browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL?{channel:process.env.UI_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'||u.port!=='3198')return route.abort();return route.continue();});
 const out='docs/ui-review/run-'+Date.now();fs.mkdirSync(out,{recursive:true});
 for(const width of [1440,1280,768,390]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:3198');await page.locator('#series-chart').waitFor();
  assert.equal(await page.locator('.water-metrics .metric-card').count(),3);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${out}/overview-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 for(const name of ['history','controls','alerts','weather','camera','ai','settings']){await page.locator(`.nav [data-nav="${name}"]`).click();await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
 await page.locator('[name="pondName"]').fill('Chưa lưu');await page.waitForTimeout(5200);assert.equal(await page.locator('[name="pondName"]').inputValue(),'Chưa lưu');
 await page.locator('.nav [data-nav="controls"]').click();await page.locator('[data-command="setPump"]').click();await page.getByText('ESP32 đã phản hồi',{exact:false}).first().waitFor();
 await page.locator('.nav [data-nav="alerts"]').click();await page.waitForTimeout(5200);assert.equal(await page.locator('#main.content').count(),1);await page.locator('[data-filter="acked"]').click();await page.reload();assert.ok(await page.locator('[data-filter="acked"]').evaluate(e=>e.classList.contains('active')));await page.locator('.nav [data-nav="history"]').click();await page.locator('#history-metric').selectOption('ph');await page.reload();assert.equal(await page.locator('#history-metric').inputValue(),'ph');
 const fixture=await(await fetch('http://127.0.0.1:3198/api/state')).json();
 fixture.latest.laser={value:null,quality:'missing',observedAt:new Date().toISOString()};
 fixture.latest.ph={value:9,quality:'valid',observedAt:new Date().toISOString()};
 fixture.latest.temp={value:null,quality:'missing',observedAt:new Date().toISOString()};
 fixture.commands=[{method:'setPump',status:'unknown',createdAt:new Date().toISOString()}];
 await page.route('**/api/state',r=>r.fulfill({json:fixture}));
 await page.goto('http://127.0.0.1:3198');await page.locator('#series-chart').waitFor();
 assert.ok((await page.locator('.camera-bottom').innerText()).includes('chưa rõ'));
 assert.ok((await page.locator('.water-metrics').innerText()).includes('Vượt ngưỡng'));
 assert.ok((await page.locator('.command-feedback').innerText()).includes('Chưa rõ kết quả'));
 assert.ok((await page.locator('.metric-value').first().innerText()).includes('—'));
 await page.screenshot({path:`${out}/edge-states.png`,fullPage:true});
 await page.route('**/api/state',r=>r.abort());await page.waitForTimeout(5500);assert.equal(await page.locator('#connection-lost').isVisible(),true);assert.ok((await page.locator('.system-status').innerText()).includes('Mất kết nối'));assert.deepEqual(errors,[]);console.log('UI CHECK PASS: 4 viewports, 8 pages, demo control, form preservation, URL, missing/invalid/stale data and unknown command.');
 }finally{try{await browser?.close();}finally{child.kill('SIGTERM');}}
})().catch(e=>{console.error(e);process.exitCode=1;});
