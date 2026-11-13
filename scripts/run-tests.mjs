#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5199;

function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  return { p, done: new Promise((res) => p.on('close', (code) => res({ code, out, err }))) };
}

async function waitPort(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await sleep(300);
  }
  return false;
}

const vite = run('npx', ['vite', '--port', String(PORT), '--strictPort']);
const ok = await waitPort(`http://localhost:${PORT}/tests.html`);
if (!ok) { vite.p.kill('SIGTERM'); console.error('vite did not start'); process.exit(1); }

const chrome = run(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/igvstudio-test-profile', '--virtual-time-budget=30000',
  '--dump-dom', `http://localhost:${PORT}/tests.html`,
]);
const { out } = await chrome.done;
vite.p.kill('SIGTERM');

const jsonMatch = /<pre id="results">([\s\S]*?)<\/pre>/.exec(out);
const svgMatch = /<pre id="svgexport"[^>]*>([\s\S]*?)<\/pre>/.exec(out);
if (!jsonMatch) { console.error('no results found; chrome output length', out.length); process.exit(1); }

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const data = JSON.parse(decode(jsonMatch[1]));
mkdirSync('reports', { recursive: true });
writeFileSync('docs/validation/acceptance.json', JSON.stringify(data, null, 2));
if (svgMatch) writeFileSync('docs/validation/export_v1.svg', decode(svgMatch[1]));

const lines = [];
lines.push('# 自动验收报告 — IGV Single SVG Studio\n');
lines.push(`输入夹具：\`fixtures/panel_igv2198.svg\`（${data.meta.fixture?.bytes} B，IGV 2.19.8 导出，${data.meta.fixture?.tracks} 轨）\n`);
lines.push('## 解析结果\n');
lines.push('| 项 | 值 |\n|---|---|');
const fx = data.meta.fixture ?? {};
lines.push(`| locus | ${fx.locus ? `${fx.locus.chr}:${fx.locus.start}-${fx.locus.end}` : '未识别'} |`);
lines.push(`| 画布 | ${fx.canvas?.width?.toFixed(0)} × ${fx.canvas?.height?.toFixed(0)}（${fx.canvas?.source}） |`);
lines.push(`| 标签栏宽 | ${fx.gutter} px |`);
lines.push(`| 数据区宽 | ${fx.dataWidth} px |`);
lines.push(`| 标定 | ${fx.calibration?.method} · ${fx.calibration?.pxPerBp} px/bp · 刻度残差 ${fx.calibration?.tickResidual?.toFixed(2)} px · 双源差 ${fx.calibration?.crossCheckPx?.toFixed(2)} px |`);
lines.push(`| yMax（解析自源标尺文字） | ${JSON.stringify(fx.yMax)} |`);
lines.push(`| 基因名 | ${JSON.stringify(fx.geneNames)} |`);
lines.push(`| 基因层高度 | ${fx.geneHeight} px |`);
lines.push(`| 导出画布 | ${data.meta.export?.widthPt} × ${data.meta.export?.heightPt} pt，k=${data.meta.export?.k} |`);
lines.push('');
lines.push('## 验收项\n');
lines.push('| 编号 | 结果 | 实测 | 说明 |\n|---|---|---|---|');
for (const r of data.results) {
  lines.push(`| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | \`${JSON.stringify(r.measured)}\` | ${r.note ?? ''} |`);
}
lines.push('');
lines.push(`**汇总：${data.summary.pass}/${data.summary.total} PASS**\n`);
lines.push('T8（PDF 文字可选中）由 `npm run test:pdf` 单独执行，见 `docs/validation/t8_pdf.md`。\n');
writeFileSync('docs/validation/acceptance.md', lines.join('\n'));
console.log(lines.join('\n'));
process.exit(data.summary.pass === data.summary.total ? 0 : 2);
