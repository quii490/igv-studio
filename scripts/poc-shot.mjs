import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/poc/svgedit.html`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/poc/svgedit.html`);
await sleep(6000);
const shot = await page.send('Page.captureScreenshot', { format: 'png' });
writeFileSync('docs/validation/poc_svgedit.png', Buffer.from(shot.data, 'base64'));
console.log('shot saved');
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close(); process.exit(0);
