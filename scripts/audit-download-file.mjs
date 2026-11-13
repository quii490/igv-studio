#!/usr/bin/env node
/** Download test on the single-file build over file:// (what users double-click). */
import { launch, newPage } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, existsSync, writeFileSync, statSync, rmSync, readFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import path from 'node:path';

rmSync('/tmp/igv-dl2', { recursive: true, force: true });
const { proc, browser } = await launch({ downloads: '/tmp/igv-dl2' });
const file = 'file://' + encodeURI(path.resolve('IGV-Single-SVG-Studio.html'));
const page = await newPage(browser, file);
await sleep(2000);

const svg = readFileSync('fixtures/panel_igv2198.svg', 'utf8');
await page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(sel)=>{for(let i=0;i<100;i++){const e=document.querySelector(sel);if(e)return e;await sleep(100);}throw new Error(sel);};
  const inp=await wait('input[type=file]');
  const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(svg)}],'panel_igv2198.svg',{type:'image/svg+xml'}));
  inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));
  await wait('.paper svg'); await sleep(500); return true; })()`);

const box = await page.evalJs(`(()=>{const b=document.querySelector('header .primary');const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:b.disabled}})()`);
const ev = (type) => page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
await ev('mousePressed'); await sleep(60); await ev('mouseReleased');
await sleep(3000);

const files = existsSync('/tmp/igv-dl2') ? readdirSync('/tmp/igv-dl2') : [];
const report = { url: 'file://.../IGV-Single-SVG-Studio.html', buttonDisabled: box.disabled, files: files.map((f) => ({ name: f, size: statSync(`/tmp/igv-dl2/${f}`).size })) };
writeFileSync('docs/validation/download_test_file.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); browser.ws.close(); process.exit(0);
