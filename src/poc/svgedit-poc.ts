import SvgCanvas from '@svgedit/svgcanvas';

interface R { id: string; pass: boolean; detail: Record<string, unknown> }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (root: ParentNode, sel: string) => root.querySelectorAll(sel).length;

async function main() {
  const out: R[] = [];
  const add = (id: string, pass: boolean, detail: Record<string, unknown>) => out.push({ id, pass, detail });
  try {
    const raw = await (await fetch('/fixtures/panel_igv2198.svg')).text();
    const src = new DOMParser().parseFromString(raw.replace(/<!DOCTYPE[^>]*>/i, ''), 'image/svg+xml');
    const inCounts = {
      rect: count(src, 'rect'), line: count(src, 'line'), path: count(src, 'path'),
      text: count(src, 'text'), image: count(src, 'image'), g: count(src, 'g'),
    };

    const el = document.getElementById('c')!;
    const config = {
      initFill: { color: 'FFFFFF', opacity: 1 },
      initStroke: { color: '000000', opacity: 1, width: 1 },
      text: { stroke_width: 0, font_size: 12, font_family: 'Arial' },
      initOpacity: 1,
      imgPath: '/img',
      dimensions: [1200, 700],
      baseUnit: 'px',
    };
    const canvas = new SvgCanvas(el, config as never);
    (canvas as unknown as { updateCanvas: (w: number, h: number) => void }).updateCanvas(1200, 700);

    /* ---- 1. Open (setSvgString) ---- */
    const t0 = performance.now();
    let opened: unknown = false;
    try { opened = canvas.setSvgString(raw); } catch (e) { add('S0-open-threw', false, { error: (e as Error).message }); }
    const openMs = performance.now() - t0;
    await sleep(300);
    const doc = canvas.getSvgContent();
    const outCounts = {
      rect: count(doc, 'rect'), line: count(doc, 'line'), path: count(doc, 'path'),
      text: count(doc, 'text'), image: count(doc, 'image'), g: count(doc, 'g'),
    };
    add('S1-open', opened !== false && outCounts.rect > 0, { opened, openMs: +openMs.toFixed(1), inCounts, outCounts });

    /* ---- 2. text edit: move + font size ---- */
    const texts = Array.from(doc.querySelectorAll('text'));
    const label = texts.find((t) => /IgG-rep1|SAMPLE1/.test(t.textContent ?? '')) ?? texts[0];
    const before = label ? { x: label.getAttribute('x'), y: label.getAttribute('y'), fs: label.getAttribute('font-size') } : null;
    let moved = false, sized = false;
    if (label) {
      canvas.selectOnly([label], true);
      canvas.moveSelectedElements(6, 4, true);
      (canvas as unknown as { setFontSize: (n: number) => void }).setFontSize(9);
      await sleep(80);
      const after = { x: label.getAttribute('x'), y: label.getAttribute('y'), fs: label.getAttribute('font-size') };
      moved = before!.x !== after.x || before!.y !== after.y;
      sized = before!.fs !== after.fs;
      add('S2-text-move-size', moved && sized, { before, after, stillText: label.localName === 'text' });
    } else add('S2-text-move-size', false, { reason: 'no text found' });

    /* ---- 3. gene label delete ---- */
    const geneCount = () => Array.from(canvas.getSvgContent().querySelectorAll('text')).filter((t) => (t.textContent ?? '').trim() === 'Ctsb').length;
    const genesBefore = geneCount();
    const gene = Array.from(doc.querySelectorAll('text')).find((t) => (t.textContent ?? '').trim() === 'Ctsb');
    let deleted = false;
    let selCount = 0, inLayer = false;
    if (gene) {
      const layer = doc.getElementById('layer1');
      inLayer = !!(layer && layer.contains(gene));
      canvas.selectOnly([gene], true);
      selCount = (canvas as unknown as { getSelectedElements: () => Element[] }).getSelectedElements().length;
      canvas.deleteSelectedElements();
      await sleep(120);
      deleted = geneCount() === genesBefore - 1;
    }
    add('S3-gene-delete', deleted, { found: !!gene, genesBefore, genesAfter: geneCount(), selectedCount: selCount, insideLayer1: inLayer, layers: doc.querySelectorAll('[id^="layer"]').length });

    /* ---- 4. export + round-trip fidelity ---- */
    const t1 = performance.now();
    const exported = canvas.getSvgString();
    const saveMs = performance.now() - t1;
    const ex = new DOMParser().parseFromString(exported, 'image/svg+xml');
    const exCounts = {
      rect: count(ex, 'rect'), line: count(ex, 'line'), path: count(ex, 'path'),
      text: count(ex, 'text'), image: count(ex, 'image'),
    };
    add('S4-export', exCounts.image === 0 && exCounts.rect >= inCounts.rect * 0.99, {
      exportMs: +saveMs.toFixed(1), bytes: exported.length, inCounts, exCounts, textStillText: exCounts.text > 0,
    });

    /* ---- 5. coordinate drift on thin (signal) rects ---- */
    const sig = (r: Element) => ['x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2'].map((a) => Number(parseFloat(r.getAttribute(a) ?? '0').toFixed(2))).join(',');
    const srcRects = Array.from(src.querySelectorAll('rect')).filter((r) => parseFloat(r.getAttribute('width') ?? '99') <= 4).map(sig);
    const exRects = new Set(Array.from(ex.querySelectorAll('rect')).map(sig));
    const kept = srcRects.filter((s) => exRects.has(s)).length;
    add('S5-geometry', srcRects.length > 0 && kept / srcRects.length > 0.98, {
      thinBars: srcRects.length, kept, ratio: +(kept / Math.max(1, srcRects.length)).toFixed(4),
    });

    /* ---- 6. Import (importSvgString) into a different document ---- */
    const el2 = document.createElement('div');
    el2.style.cssText = 'width:600px;height:300px';
    document.body.appendChild(el2);
    const c2 = new SvgCanvas(el2, config as never);
    (c2 as unknown as { updateCanvas: (w: number, h: number) => void }).updateCanvas(600, 300);
    c2.setSvgString('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect x="0" y="0" width="600" height="300" fill="#fff"/></svg>');
    await sleep(100);
    const t2 = performance.now();
    let imported: unknown = null;
    try {
      const fn = (c2 as unknown as { importSvgString?: (s: string, d?: boolean) => unknown }).importSvgString;
      imported = fn ? fn.call(c2, raw, true) : 'NO_API';
    } catch (e) { imported = 'THREW ' + (e as Error).message; }
    const importMs = performance.now() - t2;
    await sleep(300);
    const d2 = c2.getSvgContent();
    add('S6-import', count(d2, 'rect') > 100, {
      importMs: +importMs.toFixed(1), rects: count(d2, 'rect'), groups: count(d2, 'g'), returned: typeof imported,
    });

    /* ---- 7. reopen cost ---- */
    const t3 = performance.now();
    canvas.setSvgString(raw);
    const reopenMs = performance.now() - t3;
    add('S7-reopen', reopenMs < 5000, { reopenMs: +reopenMs.toFixed(1) });

    (window as unknown as { __pocSvg: string }).__pocSvg = exported;
  } catch (e) {
    add('S-FATAL', false, { error: (e as Error).message, stack: (e as Error).stack });
  }
  document.getElementById('results')!.textContent = JSON.stringify({ results: out, summary: { pass: out.filter((r) => r.pass).length, total: out.length } }, null, 2);
}
void main();
