#!/usr/bin/env node
/** Real-time perf + real download test against the current editor. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';

const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }

const { proc, browser } = await launch({ downloads: '/tmp/igv-downloads' });
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(2500);

const loadScript = `
(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(sel)=>{for(let i=0;i<100;i++){const e=document.querySelector(sel);if(e)return e;await sleep(100);}throw new Error(sel);};
  const t0=performance.now();
  const raw=await (await fetch('/fixtures/panel_igv2198.svg')).text();
  const inp=await wait('input[type=file]');
  const dt=new DataTransfer();dt.items.add(new File([raw],'panel_igv2198.svg',{type:'image/svg+xml'}));
  inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));
  await wait('.paper svg');
  await sleep(300);
  window.__loadMs = performance.now()-t0;
  return { bytes: raw.length, loadMs: Math.round(window.__loadMs), dom: document.querySelector('.paper svg').querySelectorAll('*').length };
})()`;
const load = await page.evalJs(loadScript);

const perf = await page.evalJs(`(()=>{
  const b=window.__studioBuild();
  const t=performance.now(); const s=window.__studioExport(); const exportMs=performance.now()-t;
  const buildMs=b?b.ms:-1;
  const el=document.querySelector('[data-obj="label:0"]'); const r=el.getBoundingClientRect();
  const t0=performance.now();
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+3,clientY:r.top+3,pointerId:1,isPrimary:true,buttons:1}));
  return { buildMs: +buildMs.toFixed(1), exportMs: +exportMs.toFixed(2), objects: b&&b.objects, bytes: s.length, startX: r.left, startY: r.top, t0 };
})()`);

const drag = await page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const t0=performance.now(); const times=[];
  for(let i=1;i<=12;i++){
    const s=performance.now();
    const el=document.querySelector('[data-obj="label:0"]');
    el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:window.__p0x+i*3,clientY:window.__p0y-i*2,pointerId:1,isPrimary:true,buttons:1}));
    await new Promise(r=>requestAnimationFrame(()=>r()));
    times.push(performance.now()-s);
  }
  const total=performance.now()-t0;
  document.querySelector('[data-obj="label:0"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));
  return { frames: times.map(t=>+t.toFixed(1)), avg: +(total/12).toFixed(1), max: +Math.max(...times).toFixed(1) };
})()`.replace(/window\.__p0x/g, String(perf.startX)).replace(/window\.__p0y/g, String(perf.startY)));

// pan/crop frame cost (the audit's point: only text drag was optimised)
const panPerf = await page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const btn=document.querySelectorAll('.tools button')[1]; btn.click(); await sleep(120);
  const svg=document.querySelector('.paper svg'); const r=svg.getBoundingClientRect();
  svg.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+300,clientY:r.top+60,pointerId:1,isPrimary:true,buttons:1}));
  const times=[];
  for(let i=1;i<=10;i++){
    const t=performance.now();
    svg.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.left+300+6*i,clientY:r.top+60,pointerId:1,isPrimary:true,buttons:1}));
    await new Promise(res=>requestAnimationFrame(()=>res()));
    times.push(performance.now()-t);
  }
  svg.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));
  await sleep(300);
  const crop=document.querySelectorAll('.left input[type=number]');
  return {avg:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(1), max:+Math.max(...times).toFixed(1), cropStart:Number(crop[0].value)};
})()`);

// real download via the actual button
const before = existsSync('/tmp/igv-downloads') ? readdirSync('/tmp/igv-downloads') : [];
await page.evalJs(`document.querySelector('header .primary').click(); true`);
await sleep(2500);
const after = existsSync('/tmp/igv-downloads') ? readdirSync('/tmp/igv-downloads').filter(f => !f.endsWith('.crdownload')) : [];
const downloaded = after.filter((f) => !before.includes(f));

const report = { load, perf, drag, pan: panPerf, download: { files: downloaded, size: downloaded[0] ? statSync(`/tmp/igv-downloads/${downloaded[0]}`).size : 0 } };
writeFileSync('docs/validation/perf_current.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(0);
