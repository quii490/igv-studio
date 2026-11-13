#!/usr/bin/env node
/** Acceptance: continuous wheel zoom must not unmount/rebuild the signal SVG DOM. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await page.send('DOM.enable');
await sleep(2000);
const { root } = await page.send('DOM.getDocument', { depth: 1 });
const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await page.send('DOM.setFileInputFiles', { nodeId, files: [path.resolve('fixtures/panel_igv2198.svg')] });
await sleep(1800);

const start = await page.evalJs(`(()=>{const s=document.querySelector('.paper svg'); s.dataset.mark='A'; window.__svg0=s;
 return {nodes:s.querySelectorAll('*').length, vb:s.getAttribute('viewBox')};})()`);
const box = await page.evalJs(`(()=>{const s=document.querySelector('.paper svg');const r=s.getBoundingClientRect();return {x:r.left+r.width*0.6,y:r.top+40};})()`);

const frames = [];
for (let i = 0; i < 10; i++) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -60, modifiers: 0 });
  await sleep(45);
  const s = await page.evalJs(`(()=>{const s=document.querySelector('.paper svg');return {same: s===window.__svg0, mark:s.dataset.mark, nodes:s.querySelectorAll('*').length, vb:s.getAttribute('viewBox')};})()`);
  frames.push({ i, ...s });
}
await sleep(500); // debounce commit
const after = await page.evalJs(`(()=>{const s=document.querySelector('.paper svg');const crop=[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>Number(i.value));
 return {same: s===window.__svg0, nodes:s.querySelectorAll('*').length, crop, vb:s.getAttribute('viewBox')};})()`);

const sameThroughout = frames.every((f) => f.same && f.mark === 'A');
const nodesStable = frames.every((f) => f.nodes === start.nodes);
const zoomed = after.crop[1] - after.crop[0] < 63147923 - 63120461;
const report = { start, frames, after, verdict: { sameThroughout, nodesStable, zoomed } };
writeFileSync('docs/validation/zoom_stability.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, startNodes: start.nodes, endNodes: after.nodes, crop: after.crop }, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(sameThroughout && nodesStable && zoomed ? 0 : 2);
