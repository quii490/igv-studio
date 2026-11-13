import type { BuildMetrics, EditState, EditorObject, EditorState, PanelIR, TrackEdit } from './types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const f = (v: number, d = 3) => Number(v.toFixed(d)).toString();

export const DEFAULT_EDIT: Omit<EditState, 'tracks'> = {
  dataWidthPt: 101.7,
  rowPitchPt: 8.12,
  topPadPt: 14,
  bottomPadPt: 13,
  strokePt: 0.25,
  fontFamily: 'Arial',
  namePt: 5,
  rangePt: 4,
  tickPt: 5,
  genePt: 6,
  chrPt: 6,
  gutterPt: 72,
  labelGapPt: 1.4,
  rangeGapPt: 1.8,
  geneGapPt: 4,
  showLabels: true,
  showRanges: true,
  showRuler: true,
  showGenes: true,
  showBaselines: true,
  cropStart: null,
  cropEnd: null,
};

export interface BuildResult {
  svg: string;
  metrics: BuildMetrics;
  objects: EditorObject[];
}

export interface CalibrationCheck {
  ok: boolean;
  mode: 'coordinate' | 'visual';
  blocking: string[];
  warnings: string[];
}

export function calibrationCheck(ir: PanelIR): CalibrationCheck {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const cal = ir.calibration;
  if (!cal || !ir.locus) {
    return { ok: false, mode: 'visual', warnings: ['未标定基因组坐标：只能做视觉排版，导出 visual-only SVG'], blocking: [] };
  }
  // Only *conflicts* block an export. A single, self-consistent source is allowed
  // (manual entry or locus+panel width) but must be surfaced as unverified.
  if (cal.method !== 'both') warnings.push(`未交叉验证：只有 ${cal.method} 一个来源`);
  if (cal.crossCheckPx != null && Math.abs(cal.crossCheckPx) > 1) {
    blocking.push(`两套标定在区间起点相差 ${cal.crossCheckPx.toFixed(2)} px（>1 px）`);
  }
  if (cal.tickResidualPx != null && cal.tickResidualPx > 1) {
    blocking.push(`刻度拟合残差 ${cal.tickResidualPx.toFixed(2)} px（>1 px）`);
  }
  if (ir.locus && cal.ticks.length >= 2) {
    const spanUnits = (ir.locus.end - ir.locus.start) * cal.pxPerBp;
    const dataW = ir.dataX1 - ir.dataX0;
    const rel = Math.abs(spanUnits - dataW) / Math.max(1, dataW);
    if (rel > 0.005) blocking.push(`两套标定的比例尺相差 ${(rel * 100).toFixed(2)}%（>0.5%），区间末端会错位 ${(rel * dataW).toFixed(1)} px`);
  }
  return { ok: blocking.length === 0, mode: 'coordinate', blocking, warnings };
}

/** Build a calibration from a user-supplied locus + the detected panel geometry. */
export function manualCalibration(ir: PanelIR, chr: string, start: number, end: number): PanelIR {
  const dataW = ir.dataX1 - ir.dataX0;
  if (!(end > start) || !(dataW > 10)) throw new Error('区间或数据区宽度无效');
  const pxPerBp = dataW / (end - start);
  return {
    ...ir,
    locus: { chr, start, end },
    calibration: {
      pxPerBp, xAtBp0: ir.dataX0 - start * pxPerBp, method: 'manual',
      tickResidualPx: null, crossCheckPx: null, ticks: [],
    },
  };
}

export interface Scale {
  k: number;
  x0: number;
  x1: number;
  fullSpanUnits: number;
  visualOnly?: boolean;
}

export function scaleOf(ir: PanelIR, st: EditState): Scale | null {
  const cal = ir.calibration;
  // Visual-only mode: no genomic calibration, but panel geometry is known.
  if ((!cal || !ir.locus) && ir.dataX1 - ir.dataX0 > 10) {
    const units = ir.dataX1 - ir.dataX0;
    return { k: st.dataWidthPt / units, x0: ir.dataX0, x1: ir.dataX1, fullSpanUnits: units, visualOnly: true };
  }
  if (!cal || !ir.locus) return null;
  const fullSpanUnits = (ir.locus.end - ir.locus.start) * cal.pxPerBp;
  if (!Number.isFinite(fullSpanUnits) || fullSpanUnits <= 1) return null;
  const start = st.cropStart ?? ir.locus.start;
  const end = st.cropEnd ?? ir.locus.end;
  if (!(end > start)) return null;
  const x0 = cal.xAtBp0 + start * cal.pxPerBp;
  const x1 = cal.xAtBp0 + end * cal.pxPerBp;
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 - x0 <= 1) return null;
  return { k: st.dataWidthPt / fullSpanUnits, x0, x1, fullSpanUnits };
}

export function niceStep(span: number): number {
  const raw = span / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function fmtTick(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} kb`;
  return `${bp.toLocaleString('en-US')} bp`;
}

/**
 * Override histogram paint at the ACTUAL shape, not only on an ancestor <g>:
 * a nested fill attribute or an inline `style="fill:…"` would win over a parent.
 * Only bar-like rects are recoloured; axes, baselines and gene models have their
 * own paint and are never touched here.
 */
function serializeNode(node: Node, paint: string | null): string {
  const clone = (node as Element).cloneNode(true) as Element;
  if (paint) {
    const shapes: Element[] = [];
    if (clone.localName === 'rect') shapes.push(clone);
    clone.querySelectorAll('rect').forEach((r) => shapes.push(r));
    for (const rect of shapes) {
      const w = parseFloat(rect.getAttribute('width') ?? '');
      const h = parseFloat(rect.getAttribute('height') ?? '');
      const existing = rect.getAttribute('fill');
      // thin vertical bars are the histogram; wide rects are backgrounds/panels
      if (!(w > 0 && w <= 20 && h >= 1)) continue;
      if (existing === 'none') continue;
      rect.setAttribute('fill', paint);
      if (rect.hasAttribute('style')) {
        const remain = (rect.getAttribute('style') ?? '').split(';')
          .filter((d) => !/^\s*fill\s*:/i.test(d));
        rect.setAttribute('style', remain.join(';'));
      }
    }
    // anything left without its own paint inherits the group value
    clone.removeAttribute('fill');
    if (!shapes.length) {
      clone.querySelectorAll('[fill]').forEach((el) => el.removeAttribute('fill'));
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

/** Text element for a semantic object; every emitted object carries data-obj for hit-testing. */
function objectEl(o: EditorObject, st: EditorState, k: number, fill: string): string {
  const off = st.objOffsets[o.id];
  const koff = st.kindOffsets?.[o.kind];
  const over = { ...(st.kindStyles?.[o.kind] ?? {}), ...(st.objStyles[o.id] ?? {}) };
  const dx = ((off?.dx ?? 0) + (koff?.dx ?? 0)) / k;
  const dy = ((off?.dy ?? 0) + (koff?.dy ?? 0)) / k;
  const size = (over.fontSizePt ?? o.fontSizePt) / k;
  const anchor = over.anchor ?? o.anchor;
  const visible = over.visible !== false;
  if (!visible) return '';
  const text = over.text ?? o.text;
  const color = over.color ?? fill;
  return `<text data-obj="${esc(o.id)}" data-kind="${o.kind}"${o.trackId != null ? ` data-track="${o.trackId}"` : ''}`
    + ` x="${f(o.x + dx)}" y="${f(o.y + dy)}" text-anchor="${anchor}"`
    + ` font-family="${esc(st.fontFamily)}" font-size="${f(size)}" fill="${esc(color)}"`
    + `${o.locked ? ' data-locked="1"' : ''}>${esc(text)}</text>`;
}


export interface PanelGeo {
  visible: TrackEdit[];
  trackTops: number[];
  pitch: number;
  dataLeft: number;
  dataWidth: number;
  chrY: number;
  tickLabelY: number;
  geneTop: number;
  geneBlockPt: number;
  genePt: number;
  startBp: number;
  endBp: number;
  x0: number;
  cropUnits: number;
}

/** All editable annotation objects — pure, no string building. */
export function collectObjects(ir: PanelIR, st: EditorState, g: PanelGeo, visualOnly: boolean): EditorObject[] {
  const objects: EditorObject[] = [];
  if (st.showRuler && !visualOnly) {
    objects.push({ id: 'chr', kind: 'chr', text: ir.locus?.chr ?? '', x: g.dataLeft, y: g.chrY, anchor: 'start', fontSizePt: st.chrPt, locked: false, bound: false });
  }
  g.visible.forEach((te, i) => {
    const yBase = g.trackTops[i] + st.namePt * 0.95;
    if (st.showLabels) {
      objects.push({ id: `label:${te.id}`, kind: 'track-label', text: te.label, x: g.dataLeft - st.labelGapPt, y: yBase, anchor: 'end', fontSizePt: st.namePt, trackId: te.id, locked: false, bound: false });
    }
    if (st.showRanges && te.showRange && te.yMax != null) {
      const outside = st.rangePlacement === 'outside';
      objects.push({
        id: `range:${te.id}`, kind: 'range', text: `[0 - ${te.yMax}]`,
        x: outside ? 1.2 : g.dataLeft + st.rangeGapPt,
        y: yBase, anchor: 'start', fontSizePt: st.rangePt, trackId: te.id, locked: false, bound: true,
      });
    }
  });
  const span = Math.max(1, g.endBp - g.startBp);
  if (st.showRuler && !visualOnly) {
    const step = niceStep(span);
    for (let bp = Math.ceil(g.startBp / step) * step; bp <= g.endBp; bp += step) {
      const xx = g.dataLeft + ((bp - g.startBp) / span) * g.dataWidth;
      objects.push({ id: `tick:${bp}`, kind: 'tick', text: fmtTick(bp), x: xx, y: g.tickLabelY, anchor: 'middle', fontSizePt: st.tickPt, locked: false, bound: true });
    }
  }
  if (st.showGenes && ir.genes) {
    const seen = new Set<string>();
    for (const gname of ir.genes.names) {
      const gx = g.dataLeft + ((gname.x - g.x0) / Math.max(1, g.cropUnits)) * g.dataWidth;
      if (gx < g.dataLeft - 1 || gx > g.dataLeft + g.dataWidth + 1) continue;
      if (seen.has(gname.text)) continue;
      seen.add(gname.text);
      objects.push({
        id: `gene:${gname.text}`, kind: 'gene', text: gname.text, x: gx,
        y: g.geneTop + g.geneBlockPt + st.genePt * 1.15, anchor: 'middle',
        fontSizePt: st.genePt, locked: false, bound: false,
      });
    }
  }
  return objects;
}

/** Labels + tick marks only — cheap enough to run on every style change. */
export function buildAnnotationLayer(ir: PanelIR, st: EditorState): {
  labels: string; tickmarks: string; objects: EditorObject[];
} {
  const sc = scaleOf(ir, st);
  if (!sc) return { labels: '', tickmarks: '', objects: [] };
  const visible = st.tracks.filter((t) => t.visible);
  const chrY = st.showRuler ? st.chrPt * 1.25 : 2;
  const tickLabelY = chrY + st.tickPt * 1.25 * 1.15;
  const rulerLineY = tickLabelY + st.tickPt * 1.25 * 0.55;
  const rulerBottom = st.showRuler ? rulerLineY + st.tickPt * 1.25 * 0.45 : 2;
  const topPad = Math.max(st.topPadPt, rulerBottom + 2);
  const pitch = st.rowPitchPt;
  const trackTops = visible.map((_, i) => topPad + i * pitch);
  const geneBlockPt = ir.genes ? (ir.genes.y1 - ir.genes.y0) * sc.k * 0 : 0;
  const geneBlock = ir.genes ? (ir.genes.y1 - ir.genes.y0) * (st.dataWidthPt / sc.fullSpanUnits) : 0;
  const geneTop = topPad + visible.length * pitch + (ir.genes ? st.geneGapPt : 0);
  const startBp = st.cropStart ?? ir.locus?.start ?? 0;
  const endBp = st.cropEnd ?? ir.locus?.end ?? 0;
  const objects = collectObjects(ir, st, {
    visible, trackTops, pitch, dataLeft: st.gutterPt, dataWidth: st.dataWidthPt,
    chrY, tickLabelY, geneTop, geneBlockPt: geneBlock, genePt: st.genePt, startBp, endBp,
    x0: sc.x0, cropUnits: sc.x1 - sc.x0,
  }, !!sc.visualOnly && false);
  const labels = objects.map((o) => objectEl(o, st, 1, '#000')).filter(Boolean).join('');
  const span = Math.max(1, endBp - startBp);
  const step = niceStep(span);
  const tickH = st.tickPt * 1.25 * 0.5;
  let tickmarks = '';
  for (let bp = Math.ceil(startBp / step) * step; bp <= endBp; bp += step) {
    const x = st.gutterPt + ((bp - startBp) / span) * st.dataWidthPt;
    tickmarks += `<line x1="${f(x)}" y1="${f(rulerLineY)}" x2="${f(x)}" y2="${f(rulerLineY - tickH)}" stroke="#000" stroke-width="${f(st.strokePt)}"/>`;
  }
  return { labels, tickmarks, objects };
}

export function buildSVG(ir: PanelIR, st: EditorState): BuildResult {
  const sc = scaleOf(ir, st);
  const visible = st.tracks.filter((t) => t.visible);
  const empty: BuildMetrics = {
    k: sc ? sc.k : null, viewBox: null, widthPt: 0, heightPt: 0, dataLeftUnits: 0,
    cropUnits: 0, pitchUnits: 0, trackCount: visible.length, signalNodes: 0,
    textNodes: 0, fontSizesPt: [], clippedTracks: [],
  };
  if (!sc) return { svg: emptySVG('坐标未标定：缺少 locus 或标尺'), metrics: empty, objects: [] };

  const { x0, x1, visualOnly } = sc;
  const cropUnits = x1 - x0;
  /** horizontal pt per source unit (changes with zoom) */
  const sx = st.dataWidthPt / cropUnits;
  /** vertical pt per source unit — pinned to the whole locus so peaks never change height */
  const sy = st.dataWidthPt / sc.fullSpanUnits;
  const pt = (v: number) => v;                       // the root coordinate system IS pt now

  /* ---------- fixed artboard: the box never changes size while zooming ---------- */
  const widthPt = st.gutterPt + st.dataWidthPt;
  const chrY = st.showRuler ? st.chrPt * 1.25 : 2;
  const tickLabelY = chrY + st.tickPt * 1.25 * 1.15;
  const rulerLineY = tickLabelY + st.tickPt * 1.25 * 0.55;
  const rulerBottom = st.showRuler ? rulerLineY + st.tickPt * 1.25 * 0.45 : 2;
  const topPad = Math.max(st.topPadPt, rulerBottom + 2);
  const pitch = st.rowPitchPt;
  const trackTops = visible.map((_, i) => topPad + i * pitch);
  const tracksBottom = topPad + visible.length * pitch;
  const geneBlockPt = ir.genes ? (ir.genes.y1 - ir.genes.y0) * sy : 0;
  const geneGap = ir.genes ? st.geneGapPt : 0;
  const geneTop = tracksBottom + geneGap;
  const geneNamesH = st.showGenes && ir.genes?.names.length ? st.genePt * 1.6 : 0;
  const heightPt = geneTop + (st.showGenes ? geneBlockPt : 0) + geneNamesHsafe(geneNamesH) + st.bottomPadPt;

  const dataLeft = st.gutterPt;

  /* ---------------- annotation objects (shared with the annotation layer) ---------------- */
  const startBp = st.cropStart ?? ir.locus?.start ?? 0;
  const endBp = st.cropEnd ?? ir.locus?.end ?? 0;
  const spanBp = endBp - startBp;
  const objects = collectObjects(ir, st, {
    visible, trackTops, pitch: st.rowPitchPt, dataLeft, dataWidth: st.dataWidthPt,
    chrY, tickLabelY, geneTop, geneBlockPt, genePt: st.genePt, startBp, endBp, x0, cropUnits,
  }, !!visualOnly);

  /* ---------------- render ---------------- */
  const parts: string[] = [];
  const clipped: number[] = [];
  let signalNodes = 0;
  let textNodes = 0;
  const fontSizesPt: number[] = [];
  const locusAttr = ir.locus && !visualOnly ? ` data-locus="${esc(`${ir.locus.chr}:${ir.locus.start}-${ir.locus.end}`)}"` : '';

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(widthPt)}pt" height="${f(heightPt)}pt" viewBox="0 0 ${f(widthPt)} ${f(heightPt)}" version="1.1"${locusAttr}>`);
  parts.push(`<defs><clipPath id="dataClip"><rect x="${f(dataLeft)}" y="0" width="${f(st.dataWidthPt)}" height="${f(heightPt)}"/></clipPath>`);

  const sigGroups: string[] = [];
  visible.forEach((te, i) => {
    const src = ir.tracks.find((t) => t.id === te.id);
    if (!src) return;
    const rowTop = trackTops[i];
    const rowBaseline = rowTop + pitch - 1.1;
    const paint = te.color ?? null;
    const inner = src.nodes.map((nd) => serializeNode(nd, paint)).join('');
    signalNodes += src.nodes.length;
    if ((src.y1 - src.y0) * sy > pitch + 0.5) clipped.push(te.id);
    const fillAttr = paint ? ` fill="${esc(paint)}"` : '';
    parts.push(`<clipPath id="rowClip${i}"><rect x="${f(dataLeft)}" y="${f(rowTop)}" width="${f(st.dataWidthPt)}" height="${f(pitch)}"/></clipPath>`);
    // pt-space: (unit - x0) * sx, (unit - src.y1) * sy + baseline
    sigGroups.push(`<g id="track-${i}" data-track-group="${te.id}" clip-path="url(#rowClip${i})"><g transform="translate(${f(dataLeft)},${f(rowBaseline)}) scale(${f(sx, 6)},${f(sy, 6)}) translate(${f(-x0)},${f(-src.y1)})"${fillAttr}>${inner}</g></g>`);
  });
  parts.push('</defs>');

  parts.push('<g id="signals" clip-path="url(#dataClip)">');
  parts.push(sigGroups.join(''));
  if (st.showGenes && ir.genes) {
    const inner = ir.genes.nodes.map((nd) => serializeNode(nd, st.geneModelColor)).join('');
    signalNodes += ir.genes.nodes.length;
    parts.push(`<g id="genes" data-gene-layer="1" transform="translate(${f(dataLeft)},${f(geneTop)}) scale(${f(sx, 6)},${f(sy, 6)}) translate(${f(-x0)},${f(-ir.genes.y0)})">${inner}</g>`);
  }
  parts.push('</g>');

  if (st.showBaselines) {
    const base: string[] = [];
    visible.forEach((_, i) => {
      const y = trackTops[i] + pitch - 1.1;
      base.push(`<line x1="${f(dataLeft)}" y1="${f(y)}" x2="${f(dataLeft + st.dataWidthPt)}" y2="${f(y)}" stroke="#000" stroke-width="${f(st.strokePt)}" fill="none"/>`);
    });
    parts.push(`<g id="baselines">${base.join('')}</g>`);
  }

  if (st.showRuler && !visualOnly) {
    const startBp = st.cropStart ?? ir.locus?.start ?? 0;
    const endBp = st.cropEnd ?? ir.locus?.end ?? 0;
    const step = niceStep(spanBp);
    const axis = `<line x1="${f(dataLeft)}" y1="${f(rulerLineY)}" x2="${f(dataLeft + st.dataWidthPt)}" y2="${f(rulerLineY)}" stroke="#000" stroke-width="${f(st.strokePt)}" data-ruler="1"/>`;
    const marks: string[] = [];
    for (let bp = Math.ceil(startBp / step) * step; bp <= endBp; bp += step) {
      const xx = dataLeft + ((bp - startBp) / Math.max(1, spanBp)) * st.dataWidthPt;
      marks.push(`<line x1="${f(xx)}" y1="${f(rulerLineY)}" x2="${f(xx)}" y2="${f(rulerLineY - st.tickPt * 1.25 * 0.5)}" stroke="#000" stroke-width="${f(st.strokePt)}"/>`);
    }
    parts.push(`<g id="ruler" data-line-y="${f(rulerLineY)}" data-tick-h="${f(st.tickPt * 1.25 * 0.5)}">${axis}<g id="tickmarks">${marks.join('')}</g></g>`);
  }

  const texts: string[] = [];
  for (const o of objects) {
    const el = objectEl(o, st, 1, '#000');
    if (!el) continue;
    texts.push(el);
    textNodes++;
    const over = { ...(st.kindStyles?.[o.kind] ?? {}), ...(st.objStyles[o.id] ?? {}) };
    fontSizesPt.push(over.fontSizePt ?? o.fontSizePt);
  }
  parts.push(`<g id="labels">${texts.join('')}</g>`);
  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    objects,
    metrics: {
      k: sx, ky: sy, topPadPt: topPad, viewBox: [0, 0, widthPt, heightPt], widthPt, heightPt,
      dataLeftUnits: dataLeft, cropUnits, pitchUnits: pitch,
      trackCount: visible.length, signalNodes, textNodes, fontSizesPt, clippedTracks: clipped,
    },
  };
}

function geneNamesHsafe(h: number): number { return h; }

function emptySVG(msg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120pt" height="40pt" viewBox="0 0 120 40"><text x="4" y="20" font-family="Arial" font-size="6" fill="#b00">${esc(msg)}</text></svg>`;
}

export function initialState(ir: PanelIR, labels?: Record<number, string>): EditorState {
  return {
    ...DEFAULT_EDIT,
    objOffsets: {},
    objStyles: {},
    kindStyles: {},
    kindOffsets: {},
    geneModelColor: null,
    rangePlacement: 'outside',
    tracks: ir.tracks.map((t) => ({
      id: t.id,
      label: labels?.[t.id] ?? t.rawLabel ?? `track ${t.id + 1}`,
      color: t.color,
      visible: true,
      yMax: t.yMax,
      showRange: t.yMax != null,
    })),
  };
}
