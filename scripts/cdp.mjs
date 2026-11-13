#!/usr/bin/env node
/** Minimal CDP client (no deps): real-time perf measurement + real browser download test. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const URL_BASE = 'http://localhost:5199';

export async function launch({ downloads, windowSize = '1600,1000' } = {}) {
  const dir = '/tmp/igv-cdp-profile';
  rmSync(dir, { recursive: true, force: true });
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', `--window-size=${windowSize}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {}
    await sleep(150);
  }
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const bw = new WS(version.webSocketDebuggerUrl);
  await bw.open();
  if (downloads) {
    mkdirSync(downloads, { recursive: true });
    await bw.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(downloads), eventsEnabled: true });
  }
  return { proc, browser: bw };
}

class WS {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.events = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(e);
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        } else if (msg.method) this.events.push(msg);
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

export async function newPage(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  const send = async (method, params = {}) => {
    const id = ++browser.id;
    browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => browser.pending.set(id, { resolve, reject }));
  };
  const nav = (u) => send('Page.navigate', { url: u });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await nav(url);
  /** subscribe to a CDP event on this page session */
  const on = (method, cb) => {
    const hook = (m) => { const msg = JSON.parse(m.data); if (msg.method === method && msg.sessionId === sessionId) cb(msg.params); };
    browser.ws.addEventListener('message', hook);
    return () => browser.ws.removeEventListener('message', hook);
  };
  return { targetId, sessionId, send, nav, evalJs, on };
}

export const config = { URL_BASE, PORT };
