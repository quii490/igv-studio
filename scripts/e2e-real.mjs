#!/usr/bin/env node
/**
 * Real-input E2E (CDP): no synthetic PointerEvent.
 * File picked through the real <input type=file> (DOM.setFileInputFiles),
 * mouse through Input.dispatchMouseEvent, keys through Input.dispatchKeyEvent,
 * download through the browser's own download manager.
 */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, existsSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import path from 'node:path';

const DL = '/tmp/igv-real-dl';
rmSync(DL, { recursive: true, force: true });
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }

const { proc, browser } = await launch({ downloads: DL });
const page = await newPage(browser, `${config.URL_BASE}/`);
await page.send('DOM.enable');
await sleep(2000);

const results = [];
const add = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(id, pass, JSON.stringify(detail)); };
const rect = (sel) => page.evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,l:r.left,t:r.top,w:r.width,h:r.height};})()`);
const mouse = (type, x, y, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1, ...extra });
async function clickAt(x, y, mods = 0) {
  await mouse('mousePressed', x, y, { modifiers: mods });
  await sleep(40);
  await mouse('mouseReleased', x, y, { modifiers: mods });
  await sleep(120);
}
async function dragFrom(x, y, dx, dy, steps = 6) {
  await mouse('mousePressed', x, y);
  for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps); await sleep(35); }
  await mouse('mouseReleased', x + dx, y + dy);
  await sleep(250);
}
async function typeInto(sel, text) {
  const r = await rect(sel);
  await clickAt(r.x, r.y);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
  await page.send('Input.insertText', { text });
  await sleep(120);
}

try {
  /* ---- 1. pick the real file through the real file input ---- */
  const { root } = await page.send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  add('R0-file-input', nodeId > 0, { nodeId });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [path.resolve('fixtures/panel_igv2198.svg')] });
  await sleep(1800);
  const loaded = await page.evalJs(`({objs:document.querySelectorAll('[data-obj]').length, badge:document.querySelector('.badge')?.textContent})`);
  add('R1-import', loaded.objs >= 8, loaded);

  /* ---- 2. click a label ---- */
  const l0 = await rect('[data-obj="label:0"]');
  await clickAt(l0.x, l0.y);
  const sel1 = await page.evalJs(`document.querySelectorAll('.selbox').length`);
  add('R2-click-select', sel1 === 1, { boxes: sel1 });

  /* ---- 3. drag it ---- */
  const y0 = await page.evalJs(`parseFloat(document.querySelector('[data-obj="label:0"]').getAttribute('y'))`);
  await dragFrom(l0.x, l0.y, 0, -18);
  const y1 = await page.evalJs(`parseFloat(document.querySelector('[data-obj="label:0"]').getAttribute('y'))`);
  add('R3-drag', y1 < y0 - 0.5, { y0, y1 });

  /* ---- 4. font size via the panel ---- */
  const fs0 = await page.evalJs(`parseFloat(document.querySelector('[data-obj="label:0"]').getAttribute('font-size'))`);
  await typeInto('.selprops input[type=number]', '9');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(300);
  const fs1 = await page.evalJs(`parseFloat(document.querySelector('[data-obj="label:0"]').getAttribute('font-size'))`);
  add('R4-fontsize', fs1 > fs0 * 1.5, { fs0, fs1 });

  /* ---- 5. crop tool: drag a new genomic window ---- */
  const cropBtn = await rect('.tools button:nth-child(3)');
  await clickAt(cropBtn.x, cropBtn.y);
  const svgBox = await rect('.paper svg');
  const crop0 = await page.evalJs(`[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>Number(i.value))`);
  await dragFrom(svgBox.l + svgBox.w * 0.5, svgBox.t + 30, svgBox.w * 0.25, 0, 8);
  const crop1 = await page.evalJs(`[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>Number(i.value))`);
  add('R5-crop', crop1[1] - crop1[0] < crop0[1] - crop0[0], { crop0, crop1 });

  /* ---- 6. pan tool: shift the window ---- */
  const panBtn = await rect('.tools button:nth-child(2)');
  await clickAt(panBtn.x, panBtn.y);
  const before = await page.evalJs(`[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>Number(i.value))`);
  await dragFrom(svgBox.l + svgBox.w * 0.6, svgBox.t + 60, -80, 0, 8);
  const after = await page.evalJs(`[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>Number(i.value))`);
  add('R6-pan', after[0] > before[0] && Math.abs((after[1] - after[0]) - (before[1] - before[0])) < 5, { before, after });

  /* ---- 7. undo with the real shortcut ---- */
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
  await sleep(400);
  const undone = await page.evalJs(`[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>Number(i.value))`);
  add('R7-undo', Math.abs(undone[0] - before[0]) < 5, { before, undone });

  /* ---- 8. export through the real button ---- */
  const btn = await rect('header .primary');
  await clickAt(btn.x, btn.y);
  await sleep(2500);
  const files = existsSync(DL) ? readdirSync(DL).filter((f) => !f.endsWith('.crdownload')) : [];
  const size = files[0] ? statSync(path.join(DL, files[0])).size : 0;
  add('R8-download', files.length === 1 && size > 100000, { files, size });

  /* ---- 9. reopen the exported SVG in the app ---- */
  const { root: root2 } = await page.send('DOM.getDocument', { depth: 1 });
  const { nodeId: ni2 } = await page.send('DOM.querySelector', { nodeId: root2.nodeId, selector: 'input[type=file]' });
  await page.send('DOM.setFileInputFiles', { nodeId: ni2, files: [path.join(DL, files[0])] });
  await sleep(1800);
  const reopened = await page.evalJs(`({objs:document.querySelectorAll('[data-obj]').length, badge:document.querySelector('.badge')?.textContent, image:document.querySelectorAll('.paper svg image').length})`);
  add('R9-reopen', reopened.objs >= 8 && reopened.image === 0, reopened);
} catch (e) {
  add('R-FATAL', false, { error: e.message });
}

const report = { results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } };
writeFileSync('docs/validation/e2e_real_mouse.json', JSON.stringify(report, null, 2));
console.log('SUMMARY', JSON.stringify(report.summary));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(report.summary.pass === report.summary.total ? 0 : 2);
