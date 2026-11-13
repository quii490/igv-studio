#!/usr/bin/env node
/** "全部套用" must push the current template onto every imported document. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import path from 'node:path';

const CWD = process.cwd();
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1400);

const base = readFileSync(path.join(CWD, 'fixtures/panel_igv2198.svg'), 'utf8');
const a = '/tmp/apply_a.svg', b = '/tmp/apply_b.svg';
writeFileSync(a, base.replace('SAMPLE_clean', 'SAMPLEA_clean'));
writeFileSync(b, base.replace('SAMPLE_clean', 'SAMPLEB_clean'));
for (const f of [a, b]) {
  const data = { items: [], files: [f], dragOperationsMask: 1 };
  await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 500, y: 400, data });
  await page.send('Input.dispatchDragEvent', { type: 'drop', x: 500, y: 400, data });
  await sleep(900);
}
const rangeX = () => page.evalJs(`(()=>{const el=document.querySelector('[data-kind="range"]');return el? +el.getAttribute('x') : null;})()`);
const docs = await page.evalJs(`document.querySelectorAll('.docrow').length`);
const before0 = await rangeX();                       // outside → x = 1.2

// switch template on the ACTIVE doc to "exact", then apply to all
await page.evalJs(`(()=>{const s=document.querySelector('select.preset');
 const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'exact'); s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
await sleep(700);
const afterExact = await rangeX();
await page.evalJs(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='全部套用').click(); return true;})()`);
await sleep(800);

// switch to the second document and read its range x
await page.evalJs(`(()=>{const rows=document.querySelectorAll('.docrow'); rows[1].click(); return true;})()`);
await sleep(800);
const docBx = await rangeX();
const status = await page.evalJs(`document.querySelector('footer')?.textContent?.slice(0,60) ?? ''`);

const report = { docs, rangeXBefore: before0, rangeXAfterExactOnActive: afterExact, rangeXSecondDocAfterApplyAll: docBx, status,
  pass: docs === 2 && before0 === 1.2 && afterExact !== 1.2 && docBx === afterExact };
writeFileSync('docs/validation/e2e_apply_all.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(report.pass ? 0 : 2);
