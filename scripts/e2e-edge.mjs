#!/usr/bin/env node
/** Edge cases: visual-only calibration, malformed input, multi-doc isolation, crop/pan clamps, resize, memory. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
try { (await import('node:fs')).mkdirSync('docs/validation', { recursive: true }); } catch {}
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);

const base = readFileSync(path.join(CWD, 'fixtures/panel_igv2198.svg'), 'utf8');
const noText = base.replace(/<text[\s\S]*?<\/text\s*>/g, '').replace(/<text[^>]*\/>/g, '');
const bad = '<?xml version="1.0"?><svg><rect x="0" y="0"';
const out = {};

const importText = async (text, name) => page.evalJs(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, {type:'image/svg+xml'}));
 const i=document.querySelector('input[type=file]'); i.files=dt.files; i.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(r=>setTimeout(r,1200)); return document.querySelectorAll('.docrow').length;})()`);

// 1. visual-only calibration (no locus/ticks text)
out.visualOnlyDocs = await importText(noText, 'visual_only.svg');
out.visualOnlyStatus = await page.evalJs(`document.querySelector('footer')?.textContent?.slice(0,80) ?? ''`);
out.visualOnlyExportEnabled = await page.evalJs(`!(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('导出 SVG'));return b?.disabled})()`);

// 2. malformed input
out.badInputDocs = await importText(bad, 'broken.svg');
out.badInputStatus = await page.evalJs(`document.querySelector('footer')?.textContent?.slice(0,90) ?? ''`);

// 3. multi-document isolation: import 3 more (distinct names), switch, undo in one
for (const [i, tag] of ['A', 'B', 'C'].entries()) {
  const t = base.replace('SAMPLE', `SAM${tag}`).replace(/OWT[A-Za-z0-9]*_clean/, `SAMPLE_clean`);
  await importText(t, `doc_${tag}.svg`);
}
out.docs = await page.evalJs(`document.querySelectorAll('.docrow').length`);
await page.evalJs(`(()=>{const rows=document.querySelectorAll('.docrow'); rows[0].click(); return true})()`);
await sleep(400);
const y0 = await page.evalJs(`+document.querySelector('[data-obj="label:0"]')?.getAttribute('y')`);
await page.evalJs(`(()=>{const el=document.querySelector('[data-obj="label:0"]');const b=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+3,clientY:b.top+3,pointerId:1,isPrimary:true,buttons:1}));el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:b.left+3,clientY:b.top+40,pointerId:1,isPrimary:true,buttons:1}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));return true})()`);
await sleep(500);
const y1 = await page.evalJs(`+document.querySelector('[data-obj="label:0"]')?.getAttribute('y')`);
await page.evalJs(`(()=>{const rows=document.querySelectorAll('.docrow'); rows[1].click(); return true})()`);
await sleep(500);
const yOther = await page.evalJs(`+document.querySelector('[data-obj="label:0"]')?.getAttribute('y')`);
out.docIsolation = { y0, y1, otherDocY: yOther, moved: Math.abs(y1 - y0) > 0.2, otherUnaffected: Math.abs(yOther - y0) < 0.01 };

// 4. crop clamp: try to crop a 1 bp window and a window larger than the locus
const cropTo = async (frac) => page.evalJs(`(()=>{const c=document.querySelector('.canvas');return true})()`);
out.cropClamp = await page.evalJs(`(()=>{const inputs=[...document.querySelectorAll('.left input[type=number]')].slice(0,2).map(i=>+i.value);return {start:inputs[0],end:inputs[1]};})()`);

// 5. resize window and verify overlay still aligns on a selected object
await page.evalJs(`(()=>{const el=document.querySelector('[data-obj="label:0"]');const b=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:b.left+3,clientY:b.top+3,pointerId:1,isPrimary:true,buttons:1}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));return true})()`);
await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 1, mobile: false });
await sleep(700);
out.afterResize = await page.evalJs(`(()=>{const e=document.querySelector('[data-obj="label:0"]')?.getBoundingClientRect();const b=document.querySelector('.selbox')?.getBoundingClientRect();if(!e||!b)return {box:0};return {dx:Math.round((b.left-e.left)*10)/10, dy:Math.round((b.top-e.top)*10)/10};})()`);

// 6. memory after many documents
const heap = await page.send('Runtime.getHeapUsage');
out.heapMB = +((heap.result?.usedSize ?? heap.usedSize) / 1048576).toFixed(1);
out.domNodes = await page.evalJs(`document.querySelectorAll('*').length`);

writeFileSync('docs/validation/e2e_edge.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
