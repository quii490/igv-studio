#!/usr/bin/env node
/** Drives the PACKAGED Electron app: real IPC save, drag&drop, single-instance focus. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const APP = path.join(CWD, 'release/mac-universal/IGV Studio.app/Contents/MacOS/IGV Studio');
const SAVE_DIR = '/tmp/igv-electron-save';
const PORT = 9461;
rmSync(SAVE_DIR, { recursive: true, force: true }); mkdirSync(SAVE_DIR, { recursive: true });
if (!existsSync(APP)) { console.error('missing packaged app; run npm run dist:mac first'); process.exit(2); }

const env = { ...process.env, IGV_TEST_SAVE_DIR: SAVE_DIR };
delete env.ELECTRON_RUN_AS_NODE;
const proc = spawn(APP, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/list`)).ok) break; } catch {} await sleep(300); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const events = [];
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pend.set(i, r)); };
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
await sleep(2500);

const bridge = await evalJs(`!!window.studio?.isElectron`);
const title = await evalJs(`document.title`);

// 1) real drag & drop inside Electron
const fixture = path.resolve(CWD, 'fixtures/panel_igv2198.svg');
const data = { items: [], files: [fixture], dragOperationsMask: 1 };
await send('Input.dispatchDragEvent', { type: 'dragEnter', x: 700, y: 400, data });
await send('Input.dispatchDragEvent', { type: 'dragOver', x: 700, y: 400, data });
await send('Input.dispatchDragEvent', { type: 'drop', x: 700, y: 400, data });
await sleep(2500);
const docs = await evalJs(`document.querySelectorAll('.docrow').length`);

// 2) export through the real IPC → main writes the file
await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('导出 SVG')); if(b) b.click(); return true;})()`);
await sleep(1500);
const statusText = await evalJs(`document.querySelector('footer')?.textContent?.slice(0,120) ?? ''`);
const saved = existsSync(path.join(SAVE_DIR, 'panel_igv2198.edited.svg')) ? path.join(SAVE_DIR, 'panel_igv2198.edited.svg') : null;
const savedBytes = saved ? statSync(saved).size : 0;
const savedHead = saved ? readFileSync(saved, 'utf8').slice(0, 60) : '';

// 2b) ZIP through the same IPC path
await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('导出全部')); if(b) b.click(); return true;})()`);
await sleep(2500);
const zipPath = path.join(SAVE_DIR, 'IGV-Studio-Export.zip');
const zipSaved = existsSync(zipPath) ? statSync(zipPath).size : 0;

// 3) single instance: launching again must NOT create a second window
const second = spawn(APP, [], { env, stdio: 'ignore' });
await sleep(2500);
const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages2 = list2.filter((t) => t.type === 'page').length;
second.kill();

// 4) native open dialog seam: second app instance launched with IGV_TEST_OPEN_FILES
const PORT2 = 9462;
const env2 = { ...env, IGV_TEST_OPEN_FILES: path.resolve(CWD, 'fixtures/panel_igv2198.svg') };
const proc2 = spawn(APP, ['--user-data-dir=/tmp/igv-el-second', `--remote-debugging-port=${PORT2}`], { env: env2, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT2}/json/list`)).ok) break; } catch {} await sleep(300); }
const list3 = await (await fetch(`http://127.0.0.1:${PORT2}/json/list`)).json();
const page3 = list3.find((t) => t.type === 'page');
let openDocs = 0;
if (page3) {
  const ws3 = new WebSocket(page3.webSocketDebuggerUrl);
  let id3 = 0; const pend3 = new Map();
  await new Promise((r) => (ws3.onopen = r));
  ws3.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend3.has(d.id)) { pend3.get(d.id)(d); pend3.delete(d.id); } };
  const send3 = (method, params = {}) => { const i = ++id3; ws3.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pend3.set(i, r)); };
  await sleep(2500);
  await send3('Runtime.evaluate', { expression: `(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('打开文件')).click(); return true;})()`, returnByValue: true });
  await sleep(2000);
  const r = await send3('Runtime.evaluate', { expression: `document.querySelectorAll('.docrow').length`, returnByValue: true });
  openDocs = r.result.result.value;
  ws3.close();
}
proc2.kill('SIGKILL');

const report = { bridge, title, docsAfterDrop: docs, savedPath: saved, savedBytes, savedHead, zipSaved, statusText, pagesAfterSecondLaunch: pages2, nativeOpenDocs: openDocs };
writeFileSync('docs/validation/e2e_electron.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
proc.kill('SIGKILL');
process.exit(bridge && docs >= 1 && saved && zipSaved > 0 && pages2 === 1 && openDocs >= 1 ? 0 : 2);
