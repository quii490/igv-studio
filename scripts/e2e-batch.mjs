#!/usr/bin/env node
/** Multi-file import + batch ZIP export, verified by unzipping and re-parsing each SVG. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const CWD = process.cwd();
const DL = '/tmp/igv-batch-dl';
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }

const { proc, browser } = await launch({ downloads: DL });
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);

// three genuinely different files (label text differs so content hashes differ)
const fixture = path.resolve(CWD, 'fixtures/panel_igv2198.svg');
const base = readFileSync(fixture, 'utf8');
const variants = ['A', 'B', 'C'].map((tag, i) => {
  const p = `/tmp/panel_variant_${tag}.svg`;
  writeFileSync(p, base.replace('SAMPLE_clean_Filtered_10bp_rpgc', `SAMPLE${tag}_clean_Filtered_10bp_rpgc`));
  return p;
});
for (let i = 0; i < variants.length; i++) {
  const data = { items: [], files: [variants[i]], dragOperationsMask: 1 };
  await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 400 + i * 10, y: 300, data });
  await page.send('Input.dispatchDragEvent', { type: 'drop', x: 400 + i * 10, y: 300, data });
  await sleep(700);
}
// identical file again must be skipped as duplicate
{
  const data = { items: [], files: [variants[0]], dragOperationsMask: 1 };
  await page.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 600, y: 300, data });
  await page.send('Input.dispatchDragEvent', { type: 'drop', x: 600, y: 300, data });
  await sleep(800);
}
const docs = await page.evalJs(`document.querySelectorAll('.docrow').length`);

// click 导出全部 ZIP
await page.evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('导出全部')); b.click(); return true;})()`);
for (let i = 0; i < 60; i++) { if (readdirSync(DL).some((f) => f.endsWith('.zip'))) break; await sleep(250); }
const zip = readdirSync(DL).find((f) => f.endsWith('.zip'));
const list = zip ? execFileSync('unzip', ['-l', path.join(DL, zip)], { encoding: 'utf8' }) : '';

// verify each SVG re-parses and has text/no images
let parsed = [];
if (zip) {
  execFileSync('unzip', ['-o', path.join(DL, zip), '-d', path.join(DL, 'x')]);
  for (const f of readdirSync(path.join(DL, 'x')).filter((f) => f.endsWith('.svg'))) {
    const t = readFileSync(path.join(DL, 'x', f), 'utf8');
    parsed.push({ name: f, bytes: t.length, images: (t.match(/<image/g) || []).length, texts: (t.match(/<text/g) || []).length, locus: (t.match(/data-locus="([^"]+)"/) || [])[1] ?? null });
  }
}
let manifest = null;
try { manifest = JSON.parse(readFileSync(path.join(DL, 'x', 'export_manifest.json'), 'utf8')); } catch {}
const report = { docs, zip, listed: list.split('\n').filter(Boolean).length, parsed,
  manifestDocs: manifest?.documents?.map((d) => ({ name: d.name, status: d.status, verified: d.verify?.verified, built: d.verify?.signalObjectsBuilt, reparsed: d.verify?.signalObjectsReparsed })) ?? null };
writeFileSync('docs/validation/e2e_batch_export.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close();
process.exit(docs >= 3 && parsed.length >= 3 && parsed.every((p) => p.images === 0 && p.texts > 0) ? 0 : 2);
