#!/usr/bin/env node
/** Small interaction audit: ticks, nudge, delete/undo, inline text edit, empty-click, zoom overlay, category visibility. */
import { launch, newPage, config } from './cdp.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { mkdirSync as __mkdir } from 'node:fs';
try { __mkdir('docs/validation', { recursive: true }); } catch {}
const CWD = process.cwd();
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: CWD, stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${config.URL_BASE}/`)).ok) break; } catch {} await sleep(300); }
const { proc, browser } = await launch({});
const page = await newPage(browser, `${config.URL_BASE}/`);
await sleep(1500);
await page.evalJs(`(async()=>{const raw=await (await fetch('/fixtures/panel_igv2198.svg')).text();const dt=new DataTransfer();dt.items.add(new File([raw],'p.svg',{type:'image/svg+xml'}));const i=document.querySelector('input[type=file]');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));for(let k=0;k<120;k++){if(document.querySelector('[data-obj="label:0"]'))return true;await new Promise(r=>setTimeout(r,50));}return false;})()`);
const click = async (x, y, shift = false) => {
  const m = shift ? 8 : 0;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: m });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: m });
  await sleep(350);
};
const key = async (k, code, mods = 0) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mods });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods });
  await sleep(300);
};
const res = {};
const centre = (sel) => page.evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);

// 1 ticks selectable
let t = await centre('[data-kind="tick"]');
await click(t.x, t.y);
res.tickSelect = await page.evalJs(`({boxes:document.querySelectorAll('.selbox').length, kind:document.querySelector('.selkind')?.textContent||''})`);

// 2 shift-click a second tick
const ticks = await page.evalJs(`[...document.querySelectorAll('[data-kind="tick"]')].slice(0,2).map(e=>{const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})`)
await click(ticks[1].x, ticks[1].y, true);
res.shiftMulti = await page.evalJs(`document.querySelectorAll('.selbox').length`);

// 3 arrow nudge
const before = await page.evalJs(`+document.querySelector('[data-kind="tick"]').getAttribute('x')`);
await key('ArrowRight', 'ArrowRight');
const after = await page.evalJs(`+document.querySelector('[data-kind="tick"]').getAttribute('x')`);
res.nudge = { before, after };

// 4 delete + undo
await key('Delete', 'Delete');
await sleep(300);
res.deleteHidden = await page.evalJs(`document.querySelectorAll('[data-kind="tick"]').length`);
await key('z', 'KeyZ', 4);
res.undoRestores = await page.evalJs(`document.querySelectorAll('[data-kind="tick"]').length`);

// 5 inline text edit (double click label)
const lab = await centre('[data-obj="label:0"]');
for (const cc of [1, 2]) {
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: lab.x, y: lab.y, button: 'left', buttons: 1, clickCount: cc });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lab.x, y: lab.y, button: 'left', buttons: 0, clickCount: cc });
  await sleep(80);
}
await sleep(500);
res.inlineEditor = await page.evalJs(`(()=>{const e=document.querySelector('.textedit');return {open:!!e, tag:e?.firstElementChild?.tagName||'', value:e?.querySelector('input')?.value||''};})()`);

// 6 click empty canvas clears selection
await click(760, 700);  // empty grey area below the artboard
res.emptyClick = await page.evalJs(`document.querySelectorAll('.selbox').length`);

// 7 zoom keeps overlay aligned
const lab2 = await centre('[data-obj="label:0"]');
await click(lab2.x, lab2.y);
await page.evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent==='200%').click()`);
await sleep(700);
res.zoomAlign = await page.evalJs(`(()=>{const e=document.querySelector('[data-obj="label:0"]').getBoundingClientRect();const b=document.querySelector('.selbox');const s=b.getBoundingClientRect();return {dx:Math.round((s.left-e.left)*10)/10, dy:Math.round((s.top-e.top)*10)/10};})()`);

// 8 category visibility off for ranges
await page.evalJs(`(()=>{const row=[...document.querySelectorAll('.kindrow')].find(x=>x.textContent.includes('数据范围'));const cb=row.querySelector('input[type=checkbox]');cb.click();return true})()`);
await sleep(500);
res.rangeHidden = await page.evalJs(`document.querySelectorAll('[data-kind="range"]').length`);
await page.evalJs(`(()=>{const row=[...document.querySelectorAll('.kindrow')].find(x=>x.textContent.includes('数据范围'));row.querySelector('input[type=checkbox]').click();return true})()`);
await sleep(400);
res.rangeShown = await page.evalJs(`document.querySelectorAll('[data-kind="range"]').length`);

// 9 edit text, commit with Enter, verify SVG + exported file
{
  const l = await centre('[data-obj="label:0"]');
  for (const cc of [1, 2]) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: l.x, y: l.y, button: 'left', buttons: 1, clickCount: cc });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l.x, y: l.y, button: 'left', buttons: 0, clickCount: cc });
    await sleep(90);
  }
  await sleep(400);
}
await page.evalJs(`(()=>{const inp=document.querySelector('.textedit input');if(!inp)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(inp,'IgG-edited');inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true})()`);
await sleep(600);
res.textEdited = await page.evalJs(`[...document.querySelectorAll('[data-kind="track-label"]')].map(e=>e.textContent)`);
const exported = await page.evalJs(`window.__studioExport()`);
res.exportHasEditedText = exported.includes('>IgG-edited<');
res.exportClean = { dataAttrs: (exported.match(/ data-(obj|kind|track|locked|x)=/g) || []).length, images: (exported.match(/<image/g) || []).length };

// 10 zoom deeply then scroll range grows
await page.evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent==='适应').click()`);
await sleep(300);
const cw = await page.evalJs(`document.querySelector('.canvas').scrollWidth`);
res.scrollAfterFit = cw;

writeFileSync('docs/validation/e2e_audit.json', JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
proc.kill('SIGKILL'); vite.kill('SIGTERM'); browser.ws.close(); process.exit(0);
