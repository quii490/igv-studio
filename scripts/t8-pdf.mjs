#!/usr/bin/env node
/** T8: exported SVG -> PDF (Chrome print) -> text must still be selectable. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
import path from 'node:path';

const ROOT = process.cwd();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = readFileSync(path.join(ROOT, 'docs/validation/export_v1.svg'), 'utf8').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const htmlPath = path.join(ROOT, 'docs/validation/_t8.html');
const pdfPath = path.join(ROOT, 'docs/validation/export_v1.pdf');
writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:210mm 120mm;margin:5mm}body{margin:0}svg{width:100%;height:auto}</style></head><body>${svg}</body></html>`);

function run(cmd, args) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  return new Promise((res) => p.on('close', (code) => res({ code, out, err })));
}

const r1 = await run(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer',
  '--user-data-dir=/tmp/igvstudio-pdf-profile', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`]);
const r2 = await run('pdftotext', [pdfPath, '-']);
const text = r2.out.replace(/\s+/g, ' ').trim();
const expected = ['IgG-rep1', 'KDM5A-rep1', 'KDM5B-rep1', 'Ctsb', 'Fdft1', 'chr14'];
const found = expected.filter((e) => text.includes(e));
const pass = found.length === expected.length && text.length > 0;
const md = `# T8 · 导出 SVG → PDF，文字可选中\n\n- Chrome 打印：exit ${r1.code}\n- pdftotext 提取长度：${text.length} 字符\n- 期望出现的文字：${expected.join(', ')}\n- 实际出现：${found.join(', ') || '（无）'}\n\n**结果：${pass ? 'PASS' : 'FAIL'}**\n\n提取到的文本片段：\n\n\`\`\`\n${text.slice(0, 400)}\n\`\`\`\n`;
writeFileSync(path.join(ROOT, 'docs/validation/t8_pdf.md'), md);
try { unlinkSync(htmlPath); } catch {}
console.log(md);
process.exit(pass ? 0 : 1);
