import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';import path from 'node:path';
const file=process.env.AUDIO_TEST_FILE;if(!file)throw new Error('AUDIO_TEST_FILE required');
const folder=await mkdtemp(path.join(os.tmpdir(),'cation-wheel-perf-'));
const app=await electron.launch({executablePath:process.env.VIEWER_EXECUTABLE,args:[...(process.env.VIEWER_EXECUTABLE?[]:['.']),file,`--user-data-dir=${folder}`],env:{...process.env,VITE_DEV_SERVER_URL:''}});
try{
 const page=await app.firstWindow();await page.waitForFunction(name=>document.querySelector('.audio-workspace')?.dataset.name===name,path.basename(file));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1400,900);w.center();w.show();w.webContents.setBackgroundThrottling(false);w.focus();});
 console.log('GPU',await app.evaluate(({app})=>app.getGPUFeatureStatus()));
 await page.evaluate(()=>{
 window.wheelPerf={paints:[],frames:[],wheelLatency:[],last:0};const raf=requestAnimationFrame;
 window.requestAnimationFrame=fn=>raf(t=>{const a=performance.now();fn(t);const elapsed=performance.now()-a;if(fn.toString().includes('.paint('))window.wheelPerf.paints.push(elapsed);});
 const tick=t=>{if(window.wheelPerf.last)window.wheelPerf.frames.push(t-window.wheelPerf.last);window.wheelPerf.last=t;raf(tick);};raf(tick);
 document.querySelector('#audio-wave-area').addEventListener('wheel',()=>{const a=performance.now();raf(()=>window.wheelPerf.wheelLatency.push(performance.now()-a));},{capture:true,passive:true});
 });
 const box=await page.locator('#audio-wave-area').boundingBox();await page.mouse.move(box.x+box.width*.48,box.y+box.height*.6);
 const runs=[];
 for(const mode of ['plain','loops-playing']){
  if(mode==='loops-playing'){await page.locator('#audio-fit').click();await page.locator('#audio-find-loops').click();await page.locator('.audio-loop-region').first().waitFor();await page.locator('.audio-loop-region').first().click();}
  await page.mouse.move(box.x+box.width*.48,box.y+box.height*.6);
  await page.evaluate(()=>{window.wheelPerf.paints=[];window.wheelPerf.frames=[];window.wheelPerf.wheelLatency=[];});
  const started=Date.now(); console.log('begin',mode);
  if(process.env.AUDIO_NATIVE_WHEEL === '1') {
 for(let repeat=0;repeat<2;repeat++)for(const direction of [-1,1])for(let i=0;i<20;i++)await page.mouse.wheel(0,direction*30);
 } else await page.evaluate(async()=>{
 const area=document.querySelector('#audio-wave-area'),r=area.getBoundingClientRect();
 for(const direction of [-1,1])for(let i=0;i<6;i++){
 area.dispatchEvent(new WheelEvent('wheel',{deltaY:direction*20,clientX:r.left+r.width*.48,clientY:r.top+r.height*.6,bubbles:true,cancelable:true}));
 await new Promise(resolve=>requestAnimationFrame(resolve));
 }
});
  await page.waitForTimeout(150);
  const stats=await page.evaluate(()=>{const summary=a=>{a.sort((a,b)=>a-b);return {count:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}};return{paints:summary(window.wheelPerf.paints),frames:summary(window.wheelPerf.frames),wheelLatency:summary(window.wheelPerf.wheelLatency),canvas:{width:document.querySelector('#audio-wave').width,height:document.querySelector('#audio-wave').height,dpr:devicePixelRatio}}});
  runs.push({mode,elapsed:Date.now()-started,...stats}); console.log(mode,JSON.stringify(stats));
 }
 await mkdir('artifacts/audio',{recursive:true});await page.screenshot({path:'artifacts/audio/wheel-render.png'});await writeFile(`artifacts/audio/wheel-${process.env.AUDIO_BASELINE==='1'?'before':process.env.AUDIO_NATIVE_WHEEL==='1'?'native-after':'after'}.json`,JSON.stringify(runs,null,2));console.log(JSON.stringify(runs,null,2));
 if(process.env.AUDIO_BASELINE !== '1') for(const run of runs) { assert.ok(run.paints.count >= 6); assert.ok(run.wheelLatency.p95 < 50, 'Wheel-to-frame p95 must remain responsive'); assert.ok(run.paints.p95 < 16.7, 'Paint preparation should fit within one 60 Hz frame'); assert.ok(run.frames.p95 < 50, 'Presentation cadence must not stall on waveform rasterization'); }
}finally{await app.close();}
