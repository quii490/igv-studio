#!/usr/bin/env node
/** Peak memory + responsiveness while importing several large SVGs; also proves only one doc is mounted. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sendMetric(page);
await sleep(1200);

async function sendMetric(p) { await p.send('Performance.enable').catch(() => {}); }
const heap = async () => {
  const r = await page.send('Runtime.getHeapUsage');
  return r.result ?? r;
};
const nodes = () => page.evalJs(`document.querySelectorAll('*').length`);

const base = readFileSync(path.join(CWD, 'fixtures/panel_igv2198.svg'), 'utf8');
const files = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((t) => {
  const p = `/tmp/mem_${t}.svg`;
  writeFileSync(p, base.replace('SAMPLE_clean', `SAMPLE${t}_clean`));
  return p;
});

const before = { heap: await heap(), nodes: await nodes() };
const t0 = Date.now();
const data = { items: [], files, dragOperationsMask: 1 };
await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 700, y: 400, data });
await page.send('Input.dispatchDragEvent', { type: 'drop', x: 700, y: 400, data });

// sample responsiveness while parsing
const samples = [];
for (let i = 0; i < 40; i++) {
  const t = Date.now();
  await page.evalJs('1');
  samples.push(Date.now() - t);
  await sleep(150);
  if (await page.evalJs(`document.querySelectorAll('.docrow').length`) >= files.length) break;
}
const importMs = Date.now() - t0;
await sleep(800);
const after = {
  heap: await heap(), nodes: await nodes(),
  docs: await page.evalJs(`document.querySelectorAll('.docrow').length`),
  mountedSvgs: await page.evalJs(`document.querySelectorAll('.paper svg').length`),
  status: await page.evalJs(`document.querySelector('footer')?.textContent?.slice(0, 60) ?? ''`),
};

const report = {
  files: files.length,
  importMs,
  heapBeforeMB: +(before.heap.usedSize / 1048576).toFixed(1),
  heapAfterMB: +(after.heap.usedSize / 1048576).toFixed(1),
  heapDeltaMB: +((after.heap.usedSize - before.heap.usedSize) / 1048576).toFixed(1),
  domNodesBefore: before.nodes,
  domNodesAfter: after.nodes,
  documents: after.docs,
  mountedSvgElements: after.mountedSvgs,
  evalLatencyMs: { max: Math.max(...samples), avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) },
  status: after.status,
};
writeFileSync('docs/validation/perf_memory.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(after.docs === files.length && after.mountedSvgs === 1 ? 0 : 2);
