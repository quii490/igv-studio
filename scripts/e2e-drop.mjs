#!/usr/bin/env node
/** Real system-file drag & drop: CDP Input.dispatchDragEvent with actual file paths. */
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

const fsMod = await import('node:fs');
const fixture = path.resolve(CWD, 'fixtures/panel_igv2198.svg');
const svgText = fsMod.readFileSync(fixture, 'utf8');
// distinct content per drop, otherwise the duplicate filter (correctly) skips them
const variants = ['P1', 'P2', 'P3', 'P4', 'P5'].map((t) => {
  const f = `/tmp/panel_drop_${t}.svg`;
  fsMod.writeFileSync(f, svgText.replace('SAMPLE_clean_Filtered_10bp_rpgc', `SAMPLE${t}_clean_Filtered_10bp_rpgc`));
  return f;
});

const results = [];
const docCount = () => page.evalJs(`document.querySelectorAll('.docrow').length`);
const overlay = () => page.evalJs(`!!document.querySelector('.dropveil')`);

const vp = await page.evalJs('({w: innerWidth, h: innerHeight})');
for (const [name, fx, fy] of [['左上', 0.03, 0.03], ['右上', 0.97, 0.03], ['左下', 0.03, 0.97], ['右下', 0.97, 0.97], ['中间', 0.5, 0.5]]) {
  const x = Math.round(vp.w * fx), y = Math.round(vp.h * fy);
  const data = { items: [], files: [variants[results.length]], dragOperationsMask: 1 };
  await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
  await page.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  const shown = await overlay();
  await page.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await sleep(900);
  const n = await docCount();
  results.push({ at: name, overlayShown: shown, docs: n });
}

// multi-file drop
const data = { items: [], files: ['/tmp/panel_drop_m1.svg', '/tmp/panel_drop_m2.svg'], dragOperationsMask: 1 };
fsMod.writeFileSync('/tmp/panel_drop_m1.svg', svgText.replace('SAMPLE_clean', 'SAMPLEM1_clean'));
fsMod.writeFileSync('/tmp/panel_drop_m2.svg', svgText.replace('SAMPLE_clean', 'SAMPLEM2_clean'));
await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 700, y: 400, data });
await page.send('Input.dispatchDragEvent', { type: 'dragOver', x: 700, y: 400, data });
await page.send('Input.dispatchDragEvent', { type: 'drop', x: 700, y: 400, data });
await sleep(1200);
const afterMulti = await docCount();

// non-SVG must not navigate away
const before = await page.evalJs('location.href');
const data2 = { items: [], files: [path.resolve(CWD, 'package.json')], dragOperationsMask: 1 };
await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 800, y: 500, data: data2 });
await page.send('Input.dispatchDragEvent', { type: 'drop', x: 800, y: 500, data: data2 });
await sleep(800);
const after = await page.evalJs('location.href');
const status = await page.evalJs(`document.querySelector('footer')?.textContent ?? ''`);

const report = { drops: results, multiFileDocs: afterMulti, nonSvg: { sameUrl: before === after, status } };
writeFileSync('docs/validation/e2e_drop.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(results.every((r) => r.overlayShown && r.docs >= 1) && afterMulti >= 7 && before === after ? 0 : 2);
