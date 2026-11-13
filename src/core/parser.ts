import type {
  Calibration, CanvasInfo, GeneLabel, GeneLayer, GenomicLocus, PanelIR, Tick, TrackSource,
} from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function stripDoctype(raw: string): { text: string; stripped: boolean } {
  if (/<!ENTITY/i.test(raw)) throw new Error('拒绝导入：SVG 含 ENTITY 声明（XXE 风险）');
  const text = raw.replace(/<!DOCTYPE[^>\[]*(\[[\s\S]*?\]\s*)?>/i, '');
  return { text, stripped: text.length !== raw.length };
}

function n(v: string | null, d = 0): number {
  const x = parseFloat(v ?? '');
  return Number.isFinite(x) ? x : d;
}

function parseTranslate(t: string | null): [number, number] {
  if (!t) return [0, 0];
  let m = /translate\(\s*(-?[\d.eE+]+)[\s,]+(-?[\d.eE+]+)\s*\)/.exec(t);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  m = /translate\(\s*(-?[\d.eE+]+)\s*\)/.exec(t);
  if (m) return [parseFloat(m[1]), 0];
  return [0, 0];
}

export function absOffset(el: Element): [number, number] {
  let x = 0, y = 0, node: Element | null = el;
  while (node) {
    const t = node.getAttribute?.('transform');
    if (t) { const [dx, dy] = parseTranslate(t); x += dx; y += dy; }
    node = node.parentElement;
  }
  return [x, y];
}

export type Box = [number, number, number, number];

export function bboxOf(el: Element): Box | null {
  const tag = el.localName;
  const [ox, oy] = absOffset(el);
  if (tag === 'rect') {
    const x = n(el.getAttribute('x')), y = n(el.getAttribute('y'));
    return [ox + x, oy + y, ox + x + n(el.getAttribute('width')), oy + y + n(el.getAttribute('height'))];
  }
  if (tag === 'line') {
    const x1 = n(el.getAttribute('x1')), x2 = n(el.getAttribute('x2'));
    const y1 = n(el.getAttribute('y1')), y2 = n(el.getAttribute('y2'));
    return [ox + Math.min(x1, x2), oy + Math.min(y1, y2), ox + Math.max(x1, x2), oy + Math.max(y1, y2)];
  }
  if (tag === 'circle') {
    const cx = n(el.getAttribute('cx')), cy = n(el.getAttribute('cy')), r = n(el.getAttribute('r'));
    return [ox + cx - r, oy + cy - r, ox + cx + r, oy + cy + r];
  }
  if (tag === 'ellipse') {
    const cx = n(el.getAttribute('cx')), cy = n(el.getAttribute('cy'));
    const rx = n(el.getAttribute('rx')), ry = n(el.getAttribute('ry'));
    return [ox + cx - rx, oy + cy - ry, ox + cx + rx, oy + cy + ry];
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
    if (!pts.length) return null;
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) { xs.push(pts[i]); ys.push(pts[i + 1]); }
    return [ox + Math.min(...xs), oy + Math.min(...ys), ox + Math.max(...xs), oy + Math.max(...ys)];
  }
  if (tag === 'path') {
    const d = el.getAttribute('d') ?? '';
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return null;
    // crude but only used for layer assignment, never for genomic calibration
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    return [ox + Math.min(...xs), oy + Math.min(...ys), ox + Math.max(...xs), oy + Math.max(...ys)];
  }
  return null;
}

export function detectCanvas(root: Element): CanvasInfo {
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const a = vb.split(/[\s,]+/).map(parseFloat);
    if (a.length === 4 && a.every(Number.isFinite) && a[2] > 0 && a[3] > 0)
      return { width: a[2], height: a[3], minX: a[0], minY: a[1], source: 'viewBox' };
  }
  const w = n(root.getAttribute('width')), h = n(root.getAttribute('height'));
  if (w > 20 && h > 20) return { width: w, height: h, minX: 0, minY: 0, source: 'width_height' };

  let maxX = 0, maxY = 0;
  root.querySelectorAll('rect,line,circle,ellipse,polygon,polyline').forEach((el) => {
    const b = bboxOf(el);
    if (!b) return;
    maxX = Math.max(maxX, b[2]);
    maxY = Math.max(maxY, b[3]);
  });
  return { width: Math.ceil(maxX), height: Math.ceil(maxY), minX: 0, minY: 0, source: 'geometry' };
}

export function parseLocus(text: string): GenomicLocus | null {
  const m = /(chr[\w.]+)\s*:\s*([\d,]+)\s*[-–]\s*([\d,]+)/i.exec(text ?? '');
  if (!m) return null;
  const start = +m[2].replace(/,/g, ''), end = +m[3].replace(/,/g, '');
  return end > start ? { chr: m[1], start, end } : null;
}

function detectGutter(root: Element, canvasW: number): { x: number; confidence: 'high' | 'low' } {
  const counts = new Map<number, number>();
  let bestN = 0, bestX = -1;
  root.querySelectorAll('rect').forEach((el) => {
    if (n(el.getAttribute('width')) < canvasW * 0.4) return;
    const b = bboxOf(el);
    if (!b) return;
    const x = Math.round(b[0]);
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c > bestN) { bestN = c; bestX = x; }
  });
  if (bestX >= 0) return { x: bestX, confidence: 'high' };
  const cands: number[] = [];
  root.querySelectorAll('g[transform]').forEach((g) => {
    const [tx] = parseTranslate(g.getAttribute('transform'));
    if (tx > 0 && tx < canvasW * 0.5) cands.push(tx);
  });
  cands.sort((a, b) => a - b);
  return { x: cands[0] ?? 0, confidence: 'low' };
}

/**
 * SVG paint comes from the closest declaration (inline style or attribute), and
 * Java/Batik commonly puts it on a parent <g>, not the leaf <rect>. Parsed
 * documents are detached, so getComputedStyle() is not dependable here.
 */
export function inheritedPaint(el: Element, property: 'fill' | 'stroke'): string | null {
  let current: Element | null = el;
  while (current) {
    for (const decl of (current.getAttribute('style') ?? '').split(';')) {
      const pos = decl.indexOf(':');
      if (pos === -1) continue;
      if (decl.slice(0, pos).trim().toLowerCase() !== property) continue;
      const value = decl.slice(pos + 1).trim().replace(/\s*!important\s*$/i, '');
      if (value && value.toLowerCase() !== 'inherit') return value;
    }
    const attr = current.getAttribute(property);
    if (attr && attr.toLowerCase() !== 'inherit') return attr.trim();
    current = current.parentElement;
  }
  return null;
}

/** Convert an inherited CSS/SVG color to a #rrggbb the colour input can use. */
export function canonicalColor(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'none' || s === 'transparent' || s.startsWith('url(')) return null;
  const named: Record<string, string> = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
    blue: '#0000ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080',
  };
  if (named[s]) return named[s];
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]+\s*(\d+(?:\.\d+)?)\s*[,\s]+\s*(\d+(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  return '#' + m.slice(1, 4)
    .map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join('');
}

interface Band { y0: number; y1: number; count: number; }

function clusterBands(items: { y0: number; y1: number }[], gap = 2): Band[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.y0 - b.y0);
  const bands: Band[] = [{ y0: sorted[0].y0, y1: sorted[0].y1, count: 1 }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = bands[bands.length - 1];
    if (sorted[i].y0 - cur.y1 <= gap) { cur.y1 = Math.max(cur.y1, sorted[i].y1); cur.count++; }
    else bands.push({ y0: sorted[i].y0, y1: sorted[i].y1, count: 1 });
  }
  return bands;
}

function detectTicks(root: Element): Tick[] {
  const labels: { bp: number; x: number; y: number; text: string }[] = [];
  root.querySelectorAll('text').forEach((t) => {
    const s = (t.textContent ?? '').trim();
    const m = /^([\d,]+(?:\.\d+)?)\s*kb$/i.exec(s);
    if (!m) return;
    const [ox, oy] = absOffset(t);
    const fs = n(t.getAttribute('font-size'), 12);
    const anchor = (t.getAttribute('text-anchor') ?? '').toLowerCase();
    labels.push({
      bp: parseFloat(m[1].replace(/,/g, '')) * 1000,
      // start-anchored labels (IGV) need a width estimate; middle-anchored (our export) do not
      x: ox + n(t.getAttribute('x')) + (anchor === 'middle' || anchor === 'end' ? 0 : s.length * fs * 0.25),
      y: oy + n(t.getAttribute('y')),
      text: s,
    });
  });
  if (!labels.length) return [];

  const vticks: { x: number; y: number }[] = [];
  root.querySelectorAll('line').forEach((ln) => {
    const x1 = n(ln.getAttribute('x1')), x2 = n(ln.getAttribute('x2'));
    if (Math.abs(x1 - x2) > 0.6) return;
    const [ox, oy] = absOffset(ln);
    const y1 = oy + n(ln.getAttribute('y1')), y2 = oy + n(ln.getAttribute('y2'));
    const len = Math.abs(y2 - y1);
    if (len < 2 || len > 80) return;
    vticks.push({ x: ox + x1, y: Math.min(y1, y2) });
  });

  const out: Tick[] = [];
  for (const lab of labels) {
    let best: { x: number; y: number } | null = null, bestD = 1e9;
    for (const t of vticks) {
      if (Math.abs(t.y - lab.y) > 60) continue;
      const d = Math.abs(t.x - lab.x);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best && bestD <= 20) out.push({ bp: lab.bp, x: best.x, label: lab.text });
  }
  return out.sort((a, b) => a.bp - b.bp);
}

function fitTicks(ticks: Tick[]): { pxPerBp: number; xAtBp0: number; residual: number | null } | null {
  if (ticks.length < 2) return null;
  const first = ticks[0], last = ticks[ticks.length - 1];
  const pxPerBp = (last.x - first.x) / (last.bp - first.bp);
  if (!Number.isFinite(pxPerBp) || pxPerBp === 0) return null;
  let residual: number | null = null;
  if (ticks.length >= 3) {
    const mid = ticks[1];
    residual = Math.abs(first.x + (mid.bp - first.bp) * pxPerBp - mid.x);
  }
  return { pxPerBp, xAtBp0: first.x - first.bp * pxPerBp, residual };
}

export function bboxOfNode(node: Node): Box | null {
  const el = node as Element;
  if (el.localName === 'g') {
    const child = el.firstElementChild;
    return child ? bboxOf(child) : null;
  }
  return bboxOf(el);
}

export const __debugDetectTicks = (root: Element) => detectTicks(root);

/** Remove anything executable or remote from a raw SVG before showing it read-only. */
export function sanitizeForDisplay(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror') return '';
  root.querySelectorAll('script, foreignObject, iframe, object, embed, image').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href') && !a.value.trim().startsWith('#')) el.removeAttribute(a.name);
      else if (name === 'style' && /url\(\s*['"]?(https?:)?\/\//i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return new XMLSerializer().serializeToString(root);
}

export function parseIGV(rawInput: string): PanelIR {
  const { text, stripped } = stripDoctype(rawInput);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('SVG XML 解析失败');
  const root = doc.documentElement;
  if (root.localName !== 'svg') throw new Error('不是 SVG 文件');

  const warnings: string[] = [];
  const counts = {
    rect: root.querySelectorAll('rect').length,
    line: root.querySelectorAll('line').length,
    path: root.querySelectorAll('path').length,
    text: root.querySelectorAll('text').length,
    image: root.querySelectorAll('image').length,
  };

  const canvas = detectCanvas(root);
  const g = detectGutter(root, canvas.width);
  const gutter = g.x;

  // data width: widest rect anchored at the gutter
  let dataW = 0;
  root.querySelectorAll('rect').forEach((el) => {
    const b = bboxOf(el);
    if (b && Math.abs(b[0] - gutter) <= 2) dataW = Math.max(dataW, b[2] - b[0]);
  });
  if (!dataW) { dataW = canvas.width - gutter; warnings.push('数据区宽度未找到面板矩形，使用画布宽度推算'); }
  const dataX0 = gutter, dataX1 = gutter + dataW;

  // ---- track bands from thin bars ----
  const bars: { el: Element; box: Box }[] = [];
  const geneGroup0 = root.querySelector('g#genes');
  root.querySelectorAll('rect').forEach((el) => {
    if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) return;
    if (geneGroup0 && geneGroup0.contains(el)) return;   // gene model is not a signal track
    const w = n(el.getAttribute('width')), h = n(el.getAttribute('height'));
    if (w > 4 || h < 1) return;
    const b = bboxOf(el);
    if (!b || b[0] < gutter - 1) return;
    bars.push({ el, box: b });
  });
  const allBands = clusterBands(bars.map((b) => ({ y0: b.box[1], y1: b.box[3] }))).filter(
    (b) => b.count >= 5 && b.y1 - b.y0 >= 3,
  );
  // A gap clearly larger than the track pitch separates the gene-model panel from the signal tracks.
  let bands = allBands;
  let geneBand: Band | null = null;
  if (allBands.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < allBands.length; i++) gaps.push(allBands[i].y0 - allBands[i - 1].y0);
    const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const lastGap = gaps[gaps.length - 1];
    if (med > 0 && lastGap > med * 3) { geneBand = allBands[allBands.length - 1]; bands = allBands.slice(0, -1); }
  }
  if (!bands.length) warnings.push('未检测到信号轨道（未找到细条状矩形）');

  // ---- all geometry in the data area, assigned to bands ----
  const geo = new Map<Element, Box>();
  root.querySelectorAll('rect,line,path,polygon,polyline,circle,ellipse').forEach((el) => {
    // clipPath/mask/defs children are not data: IGV writes them as <path> rectangles
    if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) return;
    const b = bboxOf(el);
    if (!b) return;
    if (b[2] < gutter - 2) return; // inside name gutter
    geo.set(el, b);
  });

  // IGV sets fill/stroke on ancestor <g>; cloning a leaf alone would lose them and
  // everything would render black. Copy the inherited presentation attributes onto the wrapper.
  const INHERIT = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'opacity'];
  const inherited = (el: Element): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const a of INHERIT) {
      if (a === 'fill' || a === 'stroke') {
        const v = inheritedPaint(el, a);
        if (v) out[a] = v;
        continue;
      }
      let node: Element | null = el;
      while (node) {
        const fromStyle = (node.getAttribute('style') ?? '').split(';')
          .map((d) => { const i = d.indexOf(':'); return i === -1 ? null : [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as const; })
          .find((d) => d && d[0] === a)?.[1];
        const v = fromStyle || node.getAttribute(a);
        if (v && v !== 'inherit') { out[a] = v; break; }
        node = node.parentElement;
      }
    }
    return out;
  };
  const wrap = (el: Element): Node => {
    const [ox, oy] = absOffset(el);
    const g = doc.createElementNS(SVG_NS, 'g');
    if (ox || oy) g.setAttribute('transform', `translate(${ox},${oy})`);
    const inh = inherited(el);
    for (const [k, v] of Object.entries(inh)) if (k !== 'fill' || !el.getAttribute('fill')) g.setAttribute(k, v);
    const clone = el.cloneNode(true) as Element;
    // the engine clips explicitly; dangling url(#clipPathN) references would clip to nothing
    const strip = (n: Element) => {
      n.removeAttribute('clip-path');
      n.removeAttribute('mask');
      n.removeAttribute('filter');
      for (const a of Array.from(n.attributes)) {
        const name = a.name.toLowerCase();
        const v = a.value.trim();
        if (name.startsWith('on')) n.removeAttribute(a.name);
        if ((name === 'href' || name === 'xlink:href') && !v.startsWith('#')) n.removeAttribute(a.name);
        if (/url\s*\(/i.test(v) && !/url\s*\(\s*['"]?#/.test(v)) n.removeAttribute(a.name);
      }
      Array.from(n.children).forEach((c) => strip(c as Element));
    };
    strip(clone);
    g.appendChild(clone);
    return g;
  };
  const geneGroup = root.querySelector('g#genes');
  const inGeneGroup = (el: Element) => !!(geneGroup && geneGroup.contains(el));
  const trackNodes: Node[][] = bands.map(() => []);
  const geneNodes: Node[] = [];
  const ideogramNodes: Node[] = [];
  const lastBandY = geneBand ? geneBand.y0 : (bands.length ? bands[bands.length - 1].y1 : 0);
  const firstBandY = bands.length ? bands[0].y0 : Infinity;

  geo.forEach((b, el) => {
    if (inGeneGroup(el)) return;   // re-imported output: gene layer is explicit
    const cy = (b[1] + b[3]) / 2;
    if (cy < firstBandY - 6) { ideogramNodes.push(wrap(el)); return; }
    if (cy > lastBandY + 6) { geneNodes.push(wrap(el)); return; }
    let idx = -1;
    for (let i = 0; i < bands.length; i++) {
      if (cy >= bands[i].y0 - 6 && cy <= bands[i].y1 + 6) { idx = i; break; }
    }
    if (idx >= 0) {
      const isChrome = el.localName === 'rect' && (b[2] - b[0]) >= dataW * 0.5 && (b[3] - b[1]) >= 8;
      if (!isChrome) trackNodes[idx].push(wrap(el));
    }
  });

  // ---- labels in the gutter ----
  const labelTexts: { text: string; x: number; y: number; w: number; fs: number }[] = [];
  const rangeTexts: { text: string; y: number }[] = [];
  root.querySelectorAll('text').forEach((t) => {
    const [ox, oy] = absOffset(t);
    const x = ox + n(t.getAttribute('x')), y = oy + n(t.getAttribute('y'));
    const s = (t.textContent ?? '').trim();
    if (!s) return;
    if (/^\[\s*[\d.,]+\s*-\s*[\d.,]+\s*\]$/.test(s)) { rangeTexts.push({ text: s, y }); return; }
    if (x >= gutter - 2) return;
    if (/^\.?\s*bw$/i.test(s)) return; // ".bw" wrap fragment carries no information
    const fs = n(t.getAttribute('font-size'), 12);
    labelTexts.push({ text: s, x, y, w: s.length * fs * 0.5, fs });
  });

  // group label fragments by line, join in y then x order (handles split file names)
  labelTexts.sort((a, b) => a.y - b.y || a.x - b.x);
  const labelGroups: { text: string; y: number; x: number }[] = [];
  for (const lt of labelTexts) {
    const last = labelGroups[labelGroups.length - 1];
    // fragments of one wrapped name share a line block: join only if the gap is small
    if (last && Math.abs(lt.y - last.y) <= 12) { last.text += lt.text; continue; }
    labelGroups.push({ text: lt.text, y: lt.y, x: lt.x });
  }

  const tracks: TrackSource[] = bands.map((band, i) => {
    const mid = (band.y0 + band.y1) / 2;
    const lab = labelGroups
      .map((lg) => ({ ...lg, d: Math.abs(lg.y - mid) }))
      .sort((a, b) => a.d - b.d)[0];
    const rng = rangeTexts
      .map((r) => ({ ...r, d: Math.abs(r.y - mid) }))
      .sort((a, b) => a.d - b.d)[0];
    const yMaxMatch = rng ? /([\d.]+)\s*$/.exec(rng.text.replace(/[^\d.,\s-]/g, ' ').trim()) : null;

    const nodes = trackNodes[i];
    // Count SOURCE bars, not the cloned wrapper <g>: the wrapper is not a rect,
    // which is why every imported track used to report color = null.
    const fills = new Map<string, number>();
    bars.forEach(({ el, box }) => {
      const cy = (box[1] + box[3]) / 2;
      if (cy < band.y0 - 1 || cy > band.y1 + 1) return;
      const color = canonicalColor(inheritedPaint(el, 'fill'));
      if (color) fills.set(color, (fills.get(color) ?? 0) + 1);
    });
    const color = [...fills.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      id: i,
      sourceIndex: i,
      y0: band.y0,
      y1: band.y1,
      height: band.y1 - band.y0,
      rawLabel: (lab?.text ?? '').replace(/[.\s]+$/, ''),
      fileName: lab && /\.\w{2,4}$/.test(lab.text) ? lab.text : null,
      rangeText: rng?.text ?? null,
      yMax: yMaxMatch ? parseFloat(yMaxMatch[1]) : null,
      color,
      barCount: band.count,
      nodes,
    };
  });

  // ---- gene names (text below the last track) ----
  const geneNames: GeneLabel[] = [];
  root.querySelectorAll('text').forEach((t) => {
    const [ox, oy] = absOffset(t);
    const x = ox + n(t.getAttribute('x'));
    const y = oy + n(t.getAttribute('y'));
    const s = (t.textContent ?? '').trim();
    if (x < gutter - 2) return;                       // gutter labels are not gene names
    if (y <= lastBandY + 6 || !s) return;
    if (/kb$/i.test(s) || /^chr/i.test(s) || /^RefSeq/i.test(s)) return;
    if (!geneNames.some((g) => g.text === s && Math.abs(g.x - x) < 2)) geneNames.push({ text: s, x });
  });

  if (geneGroup) geneGroup.querySelectorAll('rect,line,path,polygon,polyline,circle,ellipse').forEach((el) => {
    geneNodes.push(wrap(el));
  });
  const geneBoxes = geneNodes
    .map((nd) => bboxOfNode(nd))
    .filter((b): b is Box => !!b);
  const genes: GeneLayer | null = geneNodes.length || geneNames.length
    ? {
        y0: geneBoxes.length ? Math.min(...geneBoxes.map((b) => b[1])) : lastBandY + 8,
        y1: geneBoxes.length ? Math.max(...geneBoxes.map((b) => b[3])) : lastBandY + 24,
        names: geneNames,
        nodes: geneNodes,
      }
    : null;

  const ideogram = ideogramNodes.length
    ? {
        y0: Math.min(...ideogramNodes.map((nd) => bboxOf(nd as Element)?.[1] ?? 0)),
        y1: Math.max(...ideogramNodes.map((nd) => bboxOf(nd as Element)?.[3] ?? 0)),
        nodeCount: ideogramNodes.length,
      }
    : null;

  const rulerTicks = detectTicks(root);
  const fit = fitTicks(rulerTicks);

  let locus: GenomicLocus | null = null;
  const allText = Array.from(root.querySelectorAll('text')).map((t) => (t.textContent ?? '').trim());
  for (const t of allText) { locus = parseLocus(t); if (locus) break; }
  if (!locus) {
    const meta = root.getAttribute('data-locus');   // written by our exporter
    if (meta) locus = parseLocus(meta);
  }

  const locusFit = locus && dataW > 0
    ? { pxPerBp: dataW / (locus.end - locus.start), xAtBp0: gutter - locus.start * (dataW / (locus.end - locus.start)) }
    : null;

  let calibration: Calibration | null = null;
  if (fit && locusFit) {
    const cross = (fit.xAtBp0 + fit.pxPerBp * (locus?.start ?? 0)) - gutter;
    calibration = {
      pxPerBp: fit.pxPerBp,
      xAtBp0: fit.xAtBp0,
      method: 'both',
      tickResidualPx: fit.residual,
      crossCheckPx: cross,
      ticks: rulerTicks,
    };
    if (Math.abs(cross) > 1) warnings.push(`刻度与 locus 推算相差 ${cross.toFixed(2)} px（>1 px）`);
  } else if (fit) {
    calibration = { pxPerBp: fit.pxPerBp, xAtBp0: fit.xAtBp0, method: 'ticks', tickResidualPx: fit.residual, crossCheckPx: null, ticks: rulerTicks };
  } else if (locusFit) {
    calibration = { pxPerBp: locusFit.pxPerBp, xAtBp0: locusFit.xAtBp0, method: 'locus', tickResidualPx: null, crossCheckPx: null, ticks: [] };
    warnings.push('未找到标尺刻度，仅用 locus 与面板宽度推算坐标');
  } else {
    warnings.push('无法标定坐标：缺少 locus 文本与标尺');
  }

  const rulerY = rulerTicks.length
    ? { y0: Math.min(...rulerTicks.map((t) => t.x * 0 + 0)), y1: 0 }
    : null;
  const ruler = rulerTicks.length || locus
    ? { y0: 0, y1: firstBandY === Infinity ? 0 : firstBandY, x0: dataX0, x1: dataX1 }
    : (rulerY as null);

  const clampedCanvas: CanvasInfo = canvas.width > dataX1 + 200
    ? { ...canvas, width: dataX1 + 20, source: 'clamped' }
    : canvas;

  return {
    canvas: clampedCanvas,
    locus,
    calibration,
    name_gutter: { x0: 0, x1: gutter, width: gutter },
    ideogram,
    ruler,
    tracks,
    genes,
    diagnostics: {
      counts: {
        rect: root.querySelectorAll('rect').length,
        path: root.querySelectorAll('path').length,
        text: root.querySelectorAll('text').length,
        image: root.querySelectorAll('image').length,
        foreignObject: root.querySelectorAll('foreignObject').length,
      },
      signalBars: bars.length,
      doctypeStripped: stripped,
      entityRejected: false,
      canvasSource: canvas.source,
      gutterConfidence: g.confidence,
      tickCount: rulerTicks.length,
      warnings,
    },
    dataX0,
    dataX1,
    sourceText: rawInput,
    sourceSize: rawInput.length,
    counts,
  };
}
