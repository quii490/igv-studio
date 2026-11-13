#!/usr/bin/env node
/** Records a real workflow via CDP screencast and assembles docs/validation/demo.gif. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const DIR = '/tmp/igv-demo-frames';
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);

let n = 0;
page.on('Page.screencastFrame', async (p) => {
  writeFileSync(path.join(DIR, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(p.data, 'base64'));
  await page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
});
await page.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, quality: 90 });

const step = async (label, fn) => { await fn(); await sleep(650); };
await step('import', () => page.evalJs(`(async()=>{const raw=await (await fetch('/fixtures/panel_igv2198.svg')).text();
  const dt=new DataTransfer(); dt.items.add(new File([raw],'panel_igv2198.svg',{type:'image/svg+xml'}));
  const i=document.querySelector('input[type=file]'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true}));
  for(let k=0;k<120;k++){ if(document.querySelector('[data-obj="label:0"]')) return true; await new Promise(r=>setTimeout(r,50)); } return false;})()`));
const box = await page.evalJs(`(()=>{const e=document.querySelector('[data-obj="label:0"]');const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
await step('select', async () => {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
});
await step('drag', async () => {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 3 * i, y: box.y + 2 * i, button: 'left', buttons: 1 }); await sleep(30); }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 36, y: box.y + 24, button: 'left', buttons: 0, clickCount: 1 });
});
await step('fontsize', () => page.evalJs(`(()=>{const row=[...document.querySelectorAll('.kindrow')].find(x=>x.textContent.includes('轨道名'));
  const inp=row.querySelector('.ksize'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(inp,'7'); inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); inp.dispatchEvent(new Event('blur',{bubbles:true})); return true;})()`));
await step('canvas-zoom', () => page.evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent==='200%').click()`));
await step('genome-zoom', async () => {
  for (let i = 0; i < 6; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y - 40, deltaX: 0, deltaY: -60 }); await sleep(90); }
  await sleep(400);
});
await step('crop', async () => {
  await page.evalJs(`[...document.querySelectorAll('.tools button')].find(b=>b.textContent==='裁剪').click()`);
  await sleep(120);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x + 120, y: box.y - 20, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 120 + 12 * i, y: box.y - 20, button: 'left', buttons: 1 }); await sleep(40); }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 216, y: box.y - 20, button: 'left', buttons: 0, clickCount: 1 });
});
await step('undo', async () => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, commands: ['undo'] });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4 });
});
await step('multi-drop', async () => {
  const fixture = path.resolve(CWD, 'fixtures/panel_igv2198.svg');
  const data = { items: [], files: [fixture], dragOperationsMask: 1 };
  await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 600, y: 500, data });
  await page.send('Input.dispatchDragEvent', { type: 'drop', x: 600, y: 500, data });
});
await sleep(500);
await page.send('Page.stopScreencast');
const frames = execFileSync('ls', [DIR]).toString().trim().split('\n').filter(Boolean).length;
console.log('frames', frames, '-> docs/validation/demo.gif');
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
