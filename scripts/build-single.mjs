#!/usr/bin/env node
/** Build a double-clickable single HTML file (no server, no assets folder).
 *  The JS bundle is embedded base64 and evaluated from a Blob-free string, so no
 *  "</script>" / "<" escaping pitfalls can break the document.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

const dist = path.join(ROOT, 'dist');
const assets = path.join(dist, 'assets');
const files = readdirSync(assets);
const js = files.find((f) => f.endsWith('.js'));
const css = files.find((f) => f.endsWith('.css'));
if (!js) throw new Error('no js bundle found');

const jsCode = readFileSync(path.join(assets, js), 'utf8');
const cssCode = css ? readFileSync(path.join(assets, css), 'utf8') : '';
const b64 = Buffer.from(jsCode, 'utf8').toString('base64');

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IGV Single SVG Studio</title>
<style>
${cssCode}
</style>
</head>
<body>
<div id="root"></div>
<script id="bundle" type="text/plain">${b64}</script>
<script>
(function () {
  var raw = document.getElementById('bundle').textContent.trim();
  var bin = atob(raw);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var code = new TextDecoder('utf-8').decode(bytes);
  var s = document.createElement('script');
  s.textContent = code;
  document.body.appendChild(s);
  s.remove();
})();
</script>
</body>
</html>`;

const out = path.join(dist, 'IGV-Studio.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
