#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5199;
const run = (cmd, args) => {
  const p = spawn(cmd, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => (out += d));
  return { p, done: new Promise((r) => p.on('close', (code) => r({ code, out }))) };
};
const waitPort = async (url, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return true; } catch {} await sleep(300); }
  return false;
};

const vite = run('npx', ['vite', '--port', String(PORT), '--strictPort']);
if (!(await waitPort(`http://localhost:${PORT}/e2e.html`))) { vite.p.kill(); console.error('vite failed'); process.exit(1); }

const chrome = run(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1600,1000',
  '--user-data-dir=/tmp/igvstudio-e2e', '--virtual-time-budget=60000', '--dump-dom', `http://localhost:${PORT}/e2e.html`]);
const { out } = await chrome.done;
vite.p.kill('SIGTERM');

const m = /<pre id="results"[^>]*>([\s\S]*?)<\/pre>/.exec(out);
if (!m) { console.error('no results; dom length', out.length); process.exit(1); }
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const data = JSON.parse(decode(m[1]));
writeFileSync('docs/validation/e2e.json', JSON.stringify(data, null, 2));

const lines = ['# 交互 E2E — 真实浏览器 PointerEvent\n', '| 编号 | 结果 | 实测 |\n|---|---|---|'];
for (const r of data.results) lines.push(`| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | \`${JSON.stringify(r.detail)}\` |`);
lines.push('', `**汇总：${data.summary.pass}/${data.summary.total} PASS**`);
writeFileSync('docs/validation/e2e.md', lines.join('\n'));
console.log(lines.join('\n'));
process.exit(data.summary.pass === data.summary.total ? 0 : 2);
