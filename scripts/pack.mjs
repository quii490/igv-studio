#!/usr/bin/env node
/** Pack a COMPLETE source project (index.html, tests.html, e2e/poc pages, fixtures, scripts, src). */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist', 'IGV-Single-SVG-Studio-src.zip');
mkdirSync(path.join(root, 'dist'), { recursive: true });
if (existsSync(out)) rmSync(out);
const args = [
  '-r', '-q', out,
  'index.html', 'tests.html', 'e2e.html', 'poc', 'src', 'scripts', 'fixtures',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'README.md', '使用说明.md',
  'IGV-Single-SVG-Studio.html', 'reports',
  '-x', '*/node_modules/*', '-x', '*.DS_Store',
];
execFileSync('zip', args, { cwd: root, stdio: 'inherit' });
console.log('packed', out);
