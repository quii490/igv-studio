#!/usr/bin/env node
/** Real download test: trusted mouse event on 导出 SVG. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, existsSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}

rmSync('/tmp/igv-dl', { recursive: true, force: true });
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }

const { proc, browser } = await launch({ downloads: '/tmp/igv-dl' });
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(2000);
await page.evalJs(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(sel)=>{for(let i=0;i<100;i++){const e=document.querySelector(sel);if(e)return e;await sleep(100);}throw new Error(sel);};
  const raw=await (await fetch('/fixtures/panel_igv2198.svg')).text();
  const inp=await wait('input[type=file]');
  const dt=new DataTransfer();dt.items.add(new File([raw],'panel_igv2198.svg',{type:'image/svg+xml'}));
  inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));
  await wait('.paper svg'); await sleep(500); return true; })()`);

const box = await page.evalJs(`(()=>{const b=document.querySelector('header .primary');const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:b.disabled}})()`);
const ev = (type) => page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
await ev('mousePressed'); await sleep(60); await ev('mouseReleased');
await sleep(3000);

const files = existsSync('/tmp/igv-dl') ? readdirSync('/tmp/igv-dl') : [];
const report = { buttonDisabled: box.disabled, files: files.map((f) => ({ name: f, size: statSync(`/tmp/igv-dl/${f}`).size })) };
writeFileSync('docs/validation/download_test.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close(); process.exit(0);
