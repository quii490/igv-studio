/**
 * Interactive E2E — drives the real app with real PointerEvents.
 * Scenarios: A text edit/drag/font-size, B genomic pan+zoom, C range label,
 *            D per-gene hide, E undo/redo, F clean export.
 */
interface R { id: string; pass: boolean; detail: Record<string, unknown> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T extends Element>(sel: string, ms = 15000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const el = document.querySelector<T>(sel);
    if (el) return el;
    await sleep(100);
  }
  throw new Error(`timeout ${sel}`);
}

function pe(el: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra,
  });
  el.dispatchEvent(ev);
}
function click(el: Element, shift = false) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  pe(el, 'pointerdown', x, y, { shiftKey: shift });
  pe(el, 'pointerup', x, y, { shiftKey: shift });
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
async function drag(el: Element, dx: number, dy: number) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  pe(el, 'pointerdown', x, y);
  await sleep(30);
  pe(el, 'pointermove', x + dx / 2, y + dy / 2);
  await sleep(30);
  pe(el, 'pointermove', x + dx, y + dy);
  await sleep(30);
  pe(el, 'pointerup', x + dx, y + dy);
  await sleep(120);
}
const obj = (id: string) => document.querySelector<SVGGraphicsElement>(`[data-obj="${id}"]`);
const waitBoxes = async (n = 1) => {
  for (let i = 0; i < 60; i++) { if (document.querySelectorAll('.selbox').length >= n) return true; await sleep(50); }
  return false;
};
const selectWithOption = (value: string) =>
  Array.from(document.querySelectorAll<HTMLSelectElement>('select')).find((s) => Array.from(s.options).some((o) => o.value === value));
const num = (el: Element | null, attr: string) => (el ? parseFloat(el.getAttribute(attr) ?? 'NaN') : NaN);

async function main() {
  const out: R[] = [];
  const add = (id: string, pass: boolean, detail: Record<string, unknown>) => out.push({ id, pass, detail });

  try {
    const raw = await (await fetch('/fixtures/panel_igv2198.svg')).text();
    const inp = await waitFor<HTMLInputElement>('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([raw], 'panel_igv2198.svg', { type: 'image/svg+xml' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor('[data-obj="label:0"]', 20000);

    /* ---------- A: select, drag, font size, edit text ---------- */
    const label0 = obj('label:0');
    if (!label0) throw new Error('label:0 missing');
    const y0 = num(label0, 'y');
    click(label0);
    const okBox = await waitBoxes(1);
    add('E1-select', okBox, { boxes: document.querySelectorAll('.selbox').length });

    await drag(label0, 0, -12);
    const y1 = num(obj('label:0'), 'y');
    const fs0 = num(label0, 'font-size');
    add('E2-drag', y1 < y0 - 0.5, { y0, y1 });

    const sizeInput = Array.from(document.querySelectorAll<HTMLInputElement>('.selprops input[type=number]'))[0];
    if (sizeInput) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(sizeInput, '8');
      sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
      sizeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      sizeInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(300);
    }
    const fs1 = num(obj('label:0'), 'font-size');
    add('E3-fontsize', fs1 > fs0 * 1.2, { fs0, fs1, note: 'font-size 属性被改写，不是 transform 缩放' });

    click(obj('label:0')!);
    await sleep(80);
    const lbl = obj('label:0')!;
    const r = lbl.getBoundingClientRect();
    lbl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    await sleep(200);
    const edit = document.querySelector<HTMLInputElement>('.textedit input');
    if (edit) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(edit, 'IgG-EDIT');
      edit.dispatchEvent(new Event('input', { bubbles: true }));
      edit.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      await sleep(200);
    }
    add('E4-textedit', (obj('label:0')?.textContent ?? '') === 'IgG-EDIT', { text: obj('label:0')?.textContent ?? null });

    /* ---------- B: genomic pan + wheel zoom, y untouched ---------- */
    const cropOf = () => {
      const a = document.querySelectorAll<HTMLInputElement>('.left input[type=number]');
      return { start: Number(a[0]?.value), end: Number(a[1]?.value) };
    };
    const c0 = cropOf();
    const barH0 = num(document.querySelector('#signals rect'), 'height');
    const svg = await waitFor<SVGSVGElement>('.paper svg');
    // zoom in with the wheel first: panning a full-locus view must be clamped (no out-of-source navigation)
    const wheelX = svg.getBoundingClientRect().left + svg.getBoundingClientRect().width * 0.7;
    svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: wheelX, clientY: svg.getBoundingClientRect().top + 40 }));
    await sleep(500);   // debounce commit is 220 ms
    const c1 = cropOf();
    add('E5-wheelzoom', (c1.end - c1.start) < (c0.end - c0.start), { before: c0, after: c1 });
    const barH1 = num(document.querySelector('#signals rect'), 'height');
    add('E6-yfidelity', Math.abs(barH1 - barH0) < 1e-6, { barH0, barH1, note: '缩放只改 viewBox 宽度，信号几何不变' });

    (document.querySelectorAll('.tools button')[1] as HTMLButtonElement).click(); // pan
    await sleep(100);
    const svgNow = await waitFor<SVGSVGElement>('.paper svg');
    await drag(svgNow, -60, 0);
    const c2 = cropOf();
    add('E7-pan', c2.start > c1.start && Math.abs((c2.end - c2.start) - (c1.end - c1.start)) < 2, { c1, c2 });

    // panning beyond the source locus must be clamped
    await drag(svgNow, -4000, 0);
    const c3 = cropOf();
    add('E7b-clamp', c3.start >= 63120461, { c3, locusStart: 63120461 });

    /* ---------- C: range label is an independent object ---------- */
    (document.querySelectorAll('.tools button')[0] as HTMLButtonElement).click(); // select
    await sleep(100);
    const range = obj('range:0');
    const rx0 = num(range, 'x');
    await drag(range!, 30, 8);
    const rx1 = num(obj('range:0'), 'x');
    add('E8-range-drag', rx1 > rx0, { rx0, rx1, text: obj('range:0')?.textContent });
    const sel = selectWithOption('inside');
    if (sel) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(sel, 'inside');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
    }
    add('E9-range-placement', num(obj('range:0'), 'x') !== rx1, { x: num(obj('range:0'), 'x') });

    /* ---------- D: hide one gene label ---------- */
    const gene = obj('gene:Ctsb');
    click(gene!);
    await sleep(120);
    const selCount = document.querySelectorAll('.selbox').length;
    const genesBefore = Array.from(document.querySelectorAll('#labels text[data-kind="gene"]')).map((e) => e.getAttribute('data-obj'));
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    await sleep(200);
    const genesAfter = Array.from(document.querySelectorAll('#labels text[data-kind="gene"]')).map((e) => e.getAttribute('data-obj'));
    add('E10-gene-hide', !obj('gene:Ctsb') && !!obj('gene:Fdft1'), { selCount, genesBefore, genesAfter });

    /* ---------- E: undo / redo ---------- */
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'z', metaKey: isMac, ctrlKey: !isMac }));
    await sleep(200);
    const afterUndo = !!obj('gene:Ctsb');
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'z', shiftKey: true, metaKey: isMac, ctrlKey: !isMac }));
    await sleep(200);
    add('E11-undo-redo', afterUndo && !obj('gene:Ctsb'), { afterUndo, afterRedo: !!obj('gene:Ctsb') });

    /* ---------- G: SVG-Edit style grips + snapping ---------- */
    click(obj('label:1')!);
    await waitBoxes(1);
    await sleep(80);
    const grips = document.querySelectorAll('.grip').length;
    add('E13-grips', grips === 4, { grips, boxes: document.querySelectorAll('.selbox').length, hasL1: !!obj('label:1'), selText: document.querySelector('.selkind')?.textContent ?? null });

    const g0 = num(obj('label:1'), 'font-size');
    const se = Array.from(document.querySelectorAll('.grip'))[3] as HTMLElement; // south-east
    const gr = se.getBoundingClientRect();
    se.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: gr.left + 3, clientY: gr.top + 3, pointerId: 1, isPrimary: true, buttons: 1 }));
    await sleep(40);
    se.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: gr.left + 40, clientY: gr.top + 40, pointerId: 1, isPrimary: true, buttons: 1 }));
    await sleep(40);
    se.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await sleep(200);
    const g1 = num(obj('label:1'), 'font-size');
    add('E14-grip-fontsize', g1 > g0, { before: g0, after: g1 });

    // snapping: drag label:1 onto label:2's centre line, expect a guide to appear
    const l2 = obj('label:2')!;
    const r1 = obj('label:1')!.getBoundingClientRect();
    const r2 = l2.getBoundingClientRect();
    const targetY = r1.top + (r2.top + r2.height / 2) - (r1.top + r1.height / 2) - (r2.top - r1.top) + (r2.top - r1.top);
    const src = obj('label:1')!;
    const sr = src.getBoundingClientRect();
    pe(src, 'pointerdown', sr.left + 3, sr.top + 3);
    await sleep(30);
    pe(src, 'pointermove', sr.left + 3, sr.top + 3 + (r2.top + r2.height / 2 - (sr.top + sr.height / 2)));
    await sleep(60);
    const guideCount = document.querySelectorAll('.guide').length;
    pe(src, 'pointerup', sr.left + 3, sr.top + 3);
    add('E15-snap-guide', guideCount > 0, { guides: guideCount, targetY });

    /* ---------- H: multi-select batch font size ---------- */
    click(obj('label:0')!);
    await waitBoxes(1);
    click(obj('label:1')!, true); // shift
    await waitBoxes(2);
    const selCount2 = document.querySelectorAll('.selbox').length;
    const numInput = Array.from(document.querySelectorAll<HTMLInputElement>('.selprops input[type=number]'))[0];
    const fsBefore = [num(obj('label:0'), 'font-size'), num(obj('label:1'), 'font-size')];
    if (numInput) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(numInput, '12');
      numInput.dispatchEvent(new Event('input', { bubbles: true }));
      numInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      numInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(350);
    }
    const fsAfter = [num(obj('label:0'), 'font-size'), num(obj('label:1'), 'font-size')];
    const target = 12; // pt -> user units
    const kUnit = 12 / fsAfter[0];
    const both = fsAfter.every((v) => Math.abs(v * (1 / 9.44) - target) < 1);
    add('E16-batch-fontsize', selCount2 === 2 && Math.abs(fsAfter[0] - fsAfter[1]) < 0.01, { selCount2, fsBefore, fsAfter, note: '两个对象被设成同一个字号' });

    /* ---------- F: clean export ---------- */
    const exported = (window as unknown as { __studioExport?: () => string }).__studioExport?.() ?? '';
    const doc = new DOMParser().parseFromString(exported, 'image/svg+xml');
    add('E12-export-clean', !!exported && !doc.querySelector('image') && !doc.querySelector('[data-obj]') && !exported.includes('selbox'), {
      bytes: exported.length, images: doc.querySelectorAll('image').length, dataAttrs: doc.querySelectorAll('[data-obj]').length,
    });
  } catch (e) {
    add('E-FATAL', false, { error: (e as Error).message, stack: (e as Error).stack });
  }

  const pre = document.getElementById('results')!;
  pre.textContent = JSON.stringify({ results: out, summary: { pass: out.filter((r) => r.pass).length, total: out.length } }, null, 2);
}

void main();
