#!/usr/bin/env node
/** The single-file HTML (what the Electron app loads) must import a file over file://. */
import { launch, newPage } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const html = path.join(CWD, 'dist/IGV-Single-SVG-Studio.html');
const { proc, browser } = await launch({});
const page = await newPage(browser, `file://${html}`);
await page.send('DOM.enable');
await sleep(2000);
let nodeId = 0;
for (let i = 0; i < 40; i++) {
  try {
    const { root } = await page.send('DOM.getDocument', { depth: 1 });
    const r = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
    if (r.nodeId) { nodeId = r.nodeId; break; }
  } catch {}
  await sleep(250);
}
if (!nodeId) { console.error('file input not found'); process.exit(2); }
await page.send('DOM.setFileInputFiles', { nodeId, files: [path.resolve(CWD, 'fixtures/panel_igv2198.svg')] });
await sleep(2500);
const report = await page.evalJs(`(()=>({title:document.title, docs:document.querySelectorAll('.docrow').length,
 svg:!!document.querySelector('.paper svg'), labels:document.querySelectorAll('[data-kind="track-label"]').length,
 status:document.querySelector('footer')?.textContent?.slice(0,50) ?? ''}))()`);
report.file = 'dist/IGV-Single-SVG-Studio.html';
writeFileSync('docs/validation/e2e_standalone.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL'); browser.ws.close();
process.exit(report.docs >= 1 && report.svg && report.labels >= 1 ? 0 : 2);
