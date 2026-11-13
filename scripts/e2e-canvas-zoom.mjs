#!/usr/bin/env node
/** Canvas zoom must keep the artwork point under the cursor (and viewport centre) fixed. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}

const CWD = process.cwd();
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);
await page.evalJs(`(async()=>{const raw=await (await fetch('/fixtures/panel_igv2198.svg')).text();
 const dt=new DataTransfer(); dt.items.add(new File([raw],'p.svg',{type:'image/svg+xml'}));
 const i=document.querySelector('input[type=file]'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true}));
 for(let k=0;k<120;k++){ if(document.querySelector('[data-obj="label:0"]')) return true; await new Promise(r=>setTimeout(r,50)); } return false;})()`);

// point of interest: centre of the selected label, in viewport coords
const before = await page.evalJs(`(()=>{const el=document.querySelector('[data-obj="label:0"]');const b=el.getBoundingClientRect();
 return {x:b.left+b.width/2, y:b.top+b.height/2, zoom:document.querySelector('.tb span')?.textContent};})()`);

// ctrl+wheel x5 at that point
for (let i = 0; i < 5; i++) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: before.x, y: before.y, deltaX: 0, deltaY: -80, modifiers: 2 });
  await sleep(120);
}
await sleep(400);
const after = await page.evalJs(`(()=>{const el=document.querySelector('[data-obj="label:0"]');const b=el.getBoundingClientRect();
 const z=[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/%$/.test(t||''));
 return {x:b.left+b.width/2, y:b.top+b.height/2, zoom:z};})()`);

// when the artboard becomes smaller than the viewport it must be centred (not anchor-locked)
await page.evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent==='100%').click()`);
await sleep(600);
const centre = await page.evalJs(`(()=>{const c=document.querySelector('.canvas').getBoundingClientRect();
 const p=document.querySelector('.paper').getBoundingClientRect(); const z=parseFloat(([...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/%$/.test(t||''))||'100'))/100;
 return { fits: p.width <= c.width - 8, dx: Math.round((p.left + p.width/2 - (c.left + c.width/2)) * 10)/10, z};})()`);
const midAfter = { centreOffsetPx: Math.abs(centre.dx), fitsAt100: centre.fits, z1: centre.z };
const centreOk = centre.fits && Math.abs(centre.dx) < 2;

const drift = Math.hypot(after.x - before.x, after.y - before.y);
const report = { before, after, driftPx: Math.round(drift * 10) / 10, zoomBefore: before.zoom, zoomAfter: after.zoom, centreZoom: midAfter };
writeFileSync('docs/validation/e2e_canvas_zoom.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(drift < 3 && centreOk ? 0 : 2);
