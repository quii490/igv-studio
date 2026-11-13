#!/usr/bin/env node
/** Reproduce "export button disabled" with a degraded SVG, then fix it via manual calibration + real download. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}

const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }

// de-grade: drop the locus text and every ruler tick text, like an SVG exported without them
let svg = readFileSync('fixtures/panel_igv2198.svg', 'utf8');
// IGV writes closing tags across lines (</text\n >), so strip every <text> block wholesale
svg = svg.replace(/<text\b[\s\S]*?<\/text\s*>/g, '');
console.log('texts left after degrade:', (svg.match(/<text/g) || []).length);

rmSync('/tmp/igv-dl3', { recursive: true, force: true });
const { proc, browser } = await launch({ downloads: '/tmp/igv-dl3' });
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(2000);

const state1 = await page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(s)=>{for(let i=0;i<100;i++){const e=document.querySelector(s);if(e)return e;await sleep(100);}throw new Error(s);};
  const inp=await wait('input[type=file]');
  const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(svg)}],'degraded.svg',{type:'image/svg+xml'}));
  inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));
  await wait('.paper svg'); await sleep(800);
  const btn=document.querySelector('header .primary');
  return { disabled: btn.disabled, title: btn.title, badge: document.querySelector('.badge')?.textContent,
           manualPanel: !!Array.from(document.querySelectorAll('h3')).find(h=>h.textContent.includes('手动标定')) };
})()`);

// fill manual calibration and apply
console.log('BEFORE', JSON.stringify(state1));
const headings = await page.evalJs(`[...document.querySelectorAll('h3')].map(h=>h.textContent)`);
console.log('HEADINGS', JSON.stringify(headings));
const state2 = await page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
  const sec=Array.from(document.querySelectorAll('section')).find(s=>s.textContent.includes('手动标定'));
  if(!sec) return {error:'no manual section', headings:[...document.querySelectorAll('h3')].map(h=>h.textContent)};
  const inputs=[...sec.querySelectorAll('input')];
  set(inputs[0],'chr14'); set(inputs[1],'63120461'); set(inputs[2],'63147923');
  await sleep(100);
  sec.querySelector('button').click();
  await sleep(900);
  const btn=document.querySelector('header .primary');
  return { disabled: btn.disabled, title: btn.title, badge: document.querySelector('.badge')?.textContent };
})()`);

// trusted click download
const box = await page.evalJs(`(()=>{const b=document.querySelector('header .primary');const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
const ev = (t) => page.send('Input.dispatchMouseEvent', { type: t, x: box.x, y: box.y, button: 'left', clickCount: 1 });
await ev('mousePressed'); await sleep(60); await ev('mouseReleased'); await sleep(2500);
const files = existsSync('/tmp/igv-dl3') ? readdirSync('/tmp/igv-dl3').map((f) => ({ name: f, size: statSync(`/tmp/igv-dl3/${f}`).size })) : [];

const report = { before: state1, afterManual: state2, download: files };
writeFileSync('docs/validation/manual_calibration.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close(); process.exit(0);
