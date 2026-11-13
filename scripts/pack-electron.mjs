#!/usr/bin/env node
/** Stage a minimal app dir for electron-builder (never let it touch the project package.json). */
import { mkdirSync, rmSync, cpSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAGE = path.join(ROOT, 'build-app');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(path.join(ROOT, 'electron'), path.join(STAGE, 'electron'), { recursive: true });
mkdirSync(path.join(STAGE, 'dist'), { recursive: true });
const html = path.join(ROOT, 'dist', 'IGV-Single-SVG-Studio.html');
if (!existsSync(html)) { console.error('missing dist/IGV-Single-SVG-Studio.html (run npm run standalone)'); process.exit(1); }
cpSync(html, path.join(STAGE, 'dist', 'IGV-Single-SVG-Studio.html'));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: pkg.name, productName: 'IGV Studio', version: pkg.version,
  description: pkg.description, author: pkg.author, license: 'MIT',
  main: 'electron/main.cjs', private: true,
}, null, 2));
console.log('staged', STAGE);
