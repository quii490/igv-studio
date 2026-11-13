#!/usr/bin/env node
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/poc/svgedit.html`)).ok) break; } catch {} await sleep(300); }

const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/poc/svgedit.html`);
// wait for the harness to finish
let data = null;
for (let i = 0; i < 120; i++) {
  data = await page.evalJs(`(()=>{const p=document.getElementById('results');const t=p&&p.textContent||'';return t.startsWith('{')?t:null;})()`);
  if (data) break;
  await sleep(500);
}
if (!data) { console.error('poc timeout'); proc.kill('SIGKILL'); vite.kill('SIGTERM'); process.exit(1); }
const parsed = JSON.parse(data);
writeFileSync('docs/validation/svgedit_poc.json', JSON.stringify(parsed, null, 2));
console.log(JSON.stringify(parsed, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close(); process.exit(0);
