#!/usr/bin/env node
/** Real-time perf: p95 frame cost for genome zoom / pan, and proof buildSVG is not called mid-gesture. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import path from 'node:path';

const CWD = process.cwd();
const fixture = path.resolve(CWD, process.env.FIXTURE || 'fixtures/panel_igv2198.svg');
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);
const t0 = Date.now();
const rel = '/' + path.relative(CWD, fixture);
await page.evalJs(`(async()=>{const raw=await (await fetch(${JSON.stringify(rel)})).text();
 const dt=new DataTransfer(); dt.items.add(new File([raw],'panel_igv2198.svg',{type:'image/svg+xml'}));
 const inp=document.querySelector('input[type=file]'); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
 for(let i=0;i<120;i++){ if(document.querySelector('[data-obj="label:0"]')) return true; await new Promise(r=>setTimeout(r,50)); } return false;})()`);
const importMs = Date.now() - t0;

const measure = async (kind) => page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const svg=document.querySelector('.paper svg'); const r=svg.getBoundingClientRect();
  const times=[]; const works=[]; const startBuild=window.__buildCount||0;
  if (${kind === 'pan' ? 'true' : 'false'}) { document.querySelectorAll('.tools button')[1].click(); await sleep(80); }
  const cx=r.left+r.width*0.5, cy=r.top+40;
  svg.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:cx,clientY:cy,pointerId:1,isPrimary:true,buttons:1}));
  for(let i=1;i<=60;i++){
    const t=performance.now();
    let work0=performance.now();
    if (${kind === 'pan' ? 'true' : 'false'}) {
      svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:cx+4*i,clientY:cy,pointerId:1,isPrimary:true,buttons:1}));
    } else {
      svg.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:i%2?-40:40,clientX:cx,clientY:cy}));
    }
    const work=performance.now()-work0;
    await new Promise(res=>requestAnimationFrame(()=>res()));
    times.push(performance.now()-t); works.push(work);
  }
  if (${kind === 'pan' ? 'true' : 'false'}) svg.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));
  const buildsInGesture=(window.__buildCount||0)-startBuild;
  await sleep(400);
  const buildsTotal=(window.__buildCount||0)-startBuild;
  const pct=(arr,q)=>{const s=[...arr].sort((a,b)=>a-b);return +s[Math.min(s.length-1,Math.floor(s.length*q))].toFixed(2);};
  return { workAvg:+(works.reduce((a,b)=>a+b,0)/works.length).toFixed(2), workP95:pct(works,.95), workMax:pct(works,1),
           frameP95:pct(times,.95), buildsInGesture, buildsTotal };
})()`);

const zoom = await measure('zoom');
const pan = await measure('pan');
const nodes = await page.evalJs(`document.querySelector('.paper svg')?.querySelectorAll('*').length ?? 0`);
const tracks = await page.evalJs(`document.querySelectorAll('.trackrow').length || document.querySelectorAll('input[type=checkbox].tchk').length || 0`);
const report = { fixture: path.relative(CWD, fixture), importMs, nodes, tracksDetected: tracks, zoom, pan,
  note: process.env.NOTE || '' };
writeFileSync(process.env.OUT || 'docs/validation/perf_v2.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(zoom.p95 < 16.7 && pan.p95 < 16.7 ? 0 : 2);
