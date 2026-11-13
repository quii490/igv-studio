#!/usr/bin/env node
/** Prove a style edit patches only the annotation layer: signal nodes keep their identity. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import path from 'node:path';

const CWD = process.cwd();
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);
await page.evalJs(`(async()=>{const raw=await (await fetch('/fixtures/panel_igv2198.svg')).text();
 const dt=new DataTransfer(); dt.items.add(new File([raw],'p.svg',{type:'image/svg+xml'}));
 const i=document.querySelector('input[type=file]'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true}));
 for(let k=0;k<120;k++){ if(document.querySelector('[data-obj="label:0"]')) return true; await new Promise(r=>setTimeout(r,50)); }
 return false;})()`);

const before = await page.evalJs(`(()=>{const svg=document.querySelector('.paper svg');const r=svg.querySelector('#track-0 rect');
 window.__svg0=svg; window.__rect0=r; return {builds: window.__buildCount||0, rects: document.querySelectorAll('#track-0 rect').length,
 fs: document.querySelector('[data-obj="label:0"]').getAttribute('font-size'), svg:!!svg};})()`);

// change category font size through the UI (commit on Enter)
await page.evalJs(`(()=>{const row=[...document.querySelectorAll('.kindrow')].find(x=>x.textContent.includes('轨道名'));
 const inp=row.querySelector('.ksize'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 setter.call(inp,'8'); inp.dispatchEvent(new Event('input',{bubbles:true}));
 inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); inp.dispatchEvent(new Event('blur',{bubbles:true})); return true;})()`);
await sleep(600);

const after = await page.evalJs(`(()=>{const svg=document.querySelector('.paper svg');
 return {builds: window.__buildCount||0, sameSvg: svg===window.__svg0, sameRect: svg.querySelector('#track-0 rect')===window.__rect0,
 rects: document.querySelectorAll('#track-0 rect').length, fs: document.querySelector('[data-obj="label:0"]').getAttribute('font-size')};})()`);

// export still reflects the new style
const exported = await page.evalJs(`window.__studioExport()`);
const m = exported.match(/<text[^>]*>IgG-rep1<\/text>/);
const exportFs = m ? (m[0].match(/font-size="([^"]+)"/) || [])[1] : null;
const report = { before, after, exportFs, exportLen: exported.length, exportHead: (m ? m[0] : exported.slice(0, 120)), ok: after.sameSvg && after.sameRect && after.builds === before.builds && after.fs === '8' && exportFs === '8' };
writeFileSync('docs/validation/e2e_layers.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(report.ok ? 0 : 2);
