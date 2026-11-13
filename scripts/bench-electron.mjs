#!/usr/bin/env node
/** Runs the SAME in-app benchmark harness inside the packaged Electron app via CDP. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const CWD = process.cwd();
const APP = path.join(CWD, 'release/mac-universal/IGV Studio.app/Contents/MacOS/IGV Studio');
const PORT = 9481;
const fixturePath = process.env.FIXTURE || 'fixtures/panel_igv2198.svg';
const fixture = readFileSync(path.join(CWD, fixturePath), 'utf8');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;

try { execFileSync('pkill', ['-f', 'IGV Studio.app/Contents/MacOS'], { stdio: 'ignore' }); } catch {}
await sleep(1200);
const t0 = Date.now();
const proc = spawn(APP, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });
let page = null;
for (let i = 0; i < 200; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
    if (page) break;
  } catch {}
  await sleep(100);
}
if (!page) { console.error('no page'); proc.kill('SIGKILL'); process.exit(2); }
const coldStartMs = Date.now() - t0;

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pend.set(i, r)); };
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
for (let i = 0; i < 100; i++) {
  if (await evalJs(`!!window.__studioBench`)) break;
  await sleep(100);
}
const result = await evalJs(`window.__studioBench(${JSON.stringify(fixture)}, 'panel_igv2198.svg')`);
const rss = await evalJs(`1`).then(() => null);
const payload = { runtime: 'electron', fixture: fixturePath, coldStartMs, benchmark: result, ua: await evalJs('navigator.userAgent') };
writeFileSync(process.env.OUT || 'docs/validation/bench_electron.json', JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ coldStartMs, loadMs: result.loadMs, counts: result.counts, zoom: result.zoom, pan: result.pan }, null, 2));
proc.kill('SIGKILL');
