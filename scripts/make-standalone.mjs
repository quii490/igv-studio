#!/usr/bin/env node
/** Build dist/ then inline JS+CSS into ONE html that works from file:// (double-click). */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });

const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
const assets = existsSync(path.join(DIST, 'assets')) ? readdirSync(path.join(DIST, 'assets')) : [];
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
const js = jsFile ? readFileSync(path.join(DIST, 'assets', jsFile), 'utf8') : '';
const css = cssFile ? readFileSync(path.join(DIST, 'assets', cssFile), 'utf8') : '';

// NB: replacement strings must be functions — the bundle contains `$'` / `$&`
// sequences that String.replace would expand and corrupt the output.
// The bundle is an IIFE that mounts React into #root: it must run AFTER <body>.
// (Vite's module tag is deferred by spec; a classic inline script is not.)
let out = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '');
out = out.replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);
out = out.replace(/<link[^>]*rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);
if (!out.includes('<style>') && css) out = out.replace('</head>', () => `<style>\n${css}\n</style></head>`);
const target = path.join(DIST, 'IGV-Single-SVG-Studio.html');
writeFileSync(target, out);
console.log(`standalone: ${target} (${(out.length / 1024).toFixed(0)} KB)`);
