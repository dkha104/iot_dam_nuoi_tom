import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {unlink} from 'node:fs/promises';
test('camera adapter saves actual bytes and proxies MJPEG without aborting a completed GET request',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLGQAAAAASUVORK5CYII=','base64');
 const camera=http.createServer((req,res)=>{if(req.url==='/capture'){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}res.writeHead(200,{'Content-Type':'multipart/x-mixed-replace; boundary=frame'});res.write('--frame\r\nContent-Type: image/png\r\n\r\n');res.write(png);setTimeout(()=>res.end('\r\n--frame--'),80);});
 await new Promise(r=>camera.listen(0,'127.0.0.1',r));const cameraBase=`http://127.0.0.1:${camera.address().port}`;
 const child=spawn(process.execPath,['src/server.js','--port','3198'],{env:{...process.env,APP_MODE:'demo',CAMERA_CAPTURE_URL:cameraBase+'/capture',CAMERA_STREAM_URL:cameraBase+'/stream'},stdio:['ignore','pipe','pipe']});
 let media;
 try{await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Startup timeout')),10000);child.stdout.on('data',x=>{if(String(x).includes('http://localhost:3198')){clearTimeout(t);resolve();}});});
 const base='http://127.0.0.1:3198',state=await(await fetch(base+'/api/state')).json();assert.equal(state.connection.camera,true);
 const r=await fetch(base+'/api/camera/capture',{method:'POST',headers:{'X-App-Token':state.token,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,201);media=await r.json();assert.equal(media.sizeBytes,png.length);assert.equal(media.inferenceStatus,'not_run');
 const saved=Buffer.from(await(await fetch(base+'/api/media/'+media._id)).arrayBuffer());assert.deepEqual(saved,png);
 const stream=await fetch(base+'/api/camera/stream',{signal:AbortSignal.timeout(3000)});assert.equal(stream.status,200);const bytes=Buffer.from(await stream.arrayBuffer());assert.ok(bytes.includes(png));assert.match(stream.headers.get('content-type'),/multipart/);
 }finally{child.kill('SIGTERM');await once(child,'exit');camera.closeAllConnections();await new Promise(r=>camera.close(r));if(media)await unlink(new URL('../data/images/'+media.storageKey,import.meta.url));}
});
