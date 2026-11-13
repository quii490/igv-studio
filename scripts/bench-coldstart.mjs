#!/usr/bin/env node
/** Cold start: spawn → first interactive JS (Electron: CDP page ready; Tauri: boot marker file). */
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const ELECTRON = path.join(CWD, 'release/mac-universal/IGV Studio.app/Contents/MacOS/IGV Studio');
const TAURI = path.join(CWD, 'src-tauri/target/release/bundle/macos/IGV Studio.app/Contents/MacOS/igv-studio');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;

const kill = (pat) => { try { execFileSync('pkill', ['-f', pat], { stdio: 'ignore' }); } catch {} };

async function electronOnce(port) {
  kill('IGV Studio.app/Contents/MacOS/IGV Studio');
  await sleep(900);
  const t0 = Date.now();
  const p = spawn(ELECTRON, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.find((t) => t.type === 'page')) { p.kill('SIGKILL'); return Date.now() - t0; }
    } catch {}
    await sleep(25);
  }
  p.kill('SIGKILL');
  return -1;
}

async function tauriOnce() {
  kill('Contents/MacOS/igv-studio');
  await sleep(900);
  if (existsSync('/tmp/igv-tauri-boot-ts.json')) rmSync('/tmp/igv-tauri-boot-ts.json');
  const t0 = Date.now();
  const p = spawn(TAURI, [], { stdio: 'ignore', env });
  for (let i = 0; i < 600; i++) {
    if (existsSync('/tmp/igv-tauri-boot-ts.json')) { p.kill('SIGTERM'); return Date.now() - t0; }
    await sleep(10);
  }
  p.kill('SIGTERM');
  return -1;
}

const electron = [];
for (let i = 0; i < 3; i++) electron.push(await electronOnce(9490 + i));
const tauri = [];
for (let i = 0; i < 3; i++) tauri.push(await tauriOnce());
kill('Contents/MacOS/igv-studio'); kill('IGV Studio.app/Contents/MacOS/IGV Studio');

const report = { electronMs: electron, tauriMs: tauri,
  note: 'Electron: spawn→CDP page ready; Tauri: spawn→JS boot marker. Different milestones, same machine.' };
writeFileSync('docs/validation/bench_coldstart.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
