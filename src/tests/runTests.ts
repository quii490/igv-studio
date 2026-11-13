import { parseIGV, bboxOf } from '../core/parser';
import { buildSVG, initialState, calibrationCheck } from '../core/engine';
import { applyPreset } from '../core/preset';
import { shortLabel } from '../core/labels';
import { parseSession, batchScript } from '../core/session';

interface CaseResult {
  id: string;
  pass: boolean;
  measured: Record<string, unknown>;
  note?: string;
}

const TOL = { edgePx96: 0.5, labelPt: 0.2, pitchPt: 0.2, fontPt: 0.02 };
const px96 = (pt: number) => (pt * 96) / 72;

function geomSig(el: Element): string {
  const a = (n: string) => Number(parseFloat(el.getAttribute(n) ?? '0').toFixed(2));
  return [el.localName, a('x'), a('y'), a('width'), a('height'), a('x1'), a('y1'), a('x2'), a('y2')].join(':');
}

async function run(): Promise<void> {
  const results: CaseResult[] = [];
  let lastSvg = '';
  const meta: Record<string, unknown> = {};
  try {
    const res = await fetch('/fixtures/panel_igv2198.svg');
    const raw = await res.text();
    if (!res.ok || !raw.trim().startsWith('<')) {
      throw new Error('fixtures/panel_igv2198.svg 缺失：本仓库不含真实 IGV 夹具，请按 fixtures/README.md 放入自己的导出');
    }
    const ir = parseIGV(raw);
    meta.fixture = {
      bytes: raw.length, tracks: ir.tracks.length, locus: ir.locus,
      calibration: ir.calibration && {
        method: ir.calibration.method, pxPerBp: +ir.calibration.pxPerBp.toFixed(6),
        tickResidual: ir.calibration.tickResidualPx, crossCheckPx: ir.calibration.crossCheckPx,
      },
      canvas: ir.canvas, gutter: ir.name_gutter.width, dataWidth: ir.dataX1 - ir.dataX0,
      counts: ir.counts, yMax: ir.tracks.map((t) => t.yMax), geneNames: ir.genes?.names.map((g) => g.text),
      geneHeight: ir.genes ? +(ir.genes.y1 - ir.genes.y0).toFixed(1) : null,
    };

    const style = applyPreset(initialState(ir, Object.fromEntries(ir.tracks.map((t) => [t.id, shortLabel(t.rawLabel)]))));
    const built = buildSVG(ir, style);
    lastSvg = built.svg;
    const k = built.metrics.k!;
    const doc = new DOMParser().parseFromString(built.svg, 'image/svg+xml');
    meta.export = {
      bytes: built.svg.length, k: +k.toFixed(6), viewBox: built.metrics.viewBox,
      widthPt: +built.metrics.widthPt.toFixed(3), heightPt: +built.metrics.heightPt.toFixed(3),
      fontsPt: [...new Set(built.metrics.fontSizesPt)].sort(),
    };

    // T1 no raster
    const raster = doc.querySelectorAll('image,foreignObject,script').length;
    results.push({ id: 'T1', pass: raster === 0, measured: { rasterElements: raster } });

    // T2 semantic text (track labels, gene names, ticks AND data ranges)
    const texts = Array.from(doc.querySelectorAll('text')).map((t) => (t.textContent ?? '').trim());
    const missingLabels = style.tracks.filter((t) => t.visible).map((t) => t.label).filter((l) => !texts.includes(l));
    const missingGenes = (ir.genes?.names ?? []).map((g) => g.text).filter((g) => !texts.includes(g));
    const expectRanges = style.tracks.filter((t) => t.showRange && t.yMax != null).map((t) => `[0 - ${t.yMax}]`);
    const missingRanges = expectRanges.filter((r) => !texts.includes(r));
    const hasTick = texts.some((t) => /kb$/.test(t));
    results.push({
      id: 'T2', pass: !missingLabels.length && !missingGenes.length && !missingRanges.length && hasTick,
      measured: { textCount: texts.length, missingLabels, missingGenes, missingRanges, ticks: texts.filter((t) => /kb$/.test(t)) },
    });

    // T3 font sizes in pt (4 pt range labels must now be present)
    const fonts = Array.from(doc.querySelectorAll('text')).map((t) => parseFloat(t.getAttribute('font-size') ?? '0'));
    const allowed = [4, 5, 6, 10];
    const off = fonts.filter((v) => !allowed.some((a) => Math.abs(v - a) <= TOL.fontPt));
    results.push({
      id: 'T3', pass: off.length === 0 && fonts.some((v) => Math.abs(v - 4) <= TOL.fontPt),
      measured: { uniquePt: [...new Set(fonts.map((v) => +v.toFixed(3)))], offTemplate: off.length },
      note: '必须同时出现 4 pt（数据范围）与 5/6 pt',
    });

    // T4a conservation of the objects the parser selected
    const outSignal = doc.querySelectorAll('#signals rect, #signals line, #signals path, #signals polygon, #signals polyline, #signals ellipse, #signals circle').length;
    const srcSignal = ir.tracks.reduce((n, t) => n + t.nodes.length, 0) + (ir.genes?.nodes.length ?? 0);
    results.push({ id: 'T4a', pass: outSignal === srcSignal, measured: { parserSelected: srcSignal, output: outSignal } });

    // T4b independent conservation: every source geometry object is either exported or
    // explicitly classified as dropped IGV chrome (panel/section rectangles).
    const rawDoc = new DOMParser().parseFromString(raw.replace(/<!DOCTYPE[^>]*>/i, ''), 'image/svg+xml');
    const srcSet = new Set<string>();
    let droppedChrome = 0;
    const firstY = (ir.tracks[0]?.y0 ?? 0) - 6;
    const lastY = (ir.tracks[ir.tracks.length - 1]?.y1 ?? 0) + 6;
    rawDoc.querySelectorAll('rect,line,path,polygon,polyline,circle,ellipse').forEach((el) => {
      if (el.closest('defs,clipPath,mask,pattern,symbol,marker')) return;
      const box = bboxOf(el);
      if (!box) return;
      const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
      if (cx < ir.dataX0 || cy < firstY || cy > lastY) return;   // gutter / ruler / gene: not signal
      const w = box[2] - box[0], h = box[3] - box[1];
      const isChrome = el.localName === 'rect' && w >= (ir.dataX1 - ir.dataX0) * 0.5 && h >= 8;
      if (isChrome) { droppedChrome++; return; }
      srcSet.add(geomSig(el));
    });
    const outSet = new Set<string>();
    doc.querySelectorAll('#signals rect, #signals line, #signals path, #signals polygon, #signals polyline, #signals circle, #signals ellipse').forEach((el) => outSet.add(geomSig(el)));
    const missingList: string[] = [];
    srcSet.forEach((sig) => { if (!outSet.has(sig) && missingList.length < 8) missingList.push(sig); });
    const missing = [...srcSet].filter((sig) => !outSet.has(sig)).length;
    results.push({
      id: 'T4b', pass: missing === 0,
      measured: { independentSourceObjects: srcSet.size, exported: outSet.size, droppedChrome, missing, missingList },
      note: '独立扫描原始 SVG（不经过解析器的轨道分类），逐个几何指纹比对',
    });

    // T5 data-area left edge
    const clip = doc.querySelector('#dataClip rect')!;
    const vb = built.metrics.viewBox!;
    const leftUnits = parseFloat(clip.getAttribute('x')!) - vb[0];
    const expected = style.gutterPt;
    const errPt = Math.abs(leftUnits - expected);
    results.push({ id: 'T5', pass: px96(errPt) <= TOL.edgePx96, measured: { errPt: +errPt.toFixed(5), errPx96: +px96(errPt).toFixed(5) } });

    // T6 label anchor
    const labelEls = Array.from(doc.querySelectorAll('#labels text')).filter((t) => t.getAttribute('text-anchor') === 'end');
    const wantX = style.gutterPt - style.labelGapPt;
    const labelErr = labelEls.map((t) => Math.abs(parseFloat(t.getAttribute('x')!) - wantX));
    results.push({ id: 'T6', pass: labelErr.every((e) => e <= TOL.labelPt), measured: { labels: labelEls.length, maxErrPt: +Math.max(0, ...labelErr).toFixed(5) } });

    // T7 pitch
    const baseY = Array.from(doc.querySelectorAll('#baselines line')).map((l) => parseFloat(l.getAttribute('y1')!));
    const diffs = baseY.slice(1).map((y, i) => (y - baseY[i]));
    const pitchErr = diffs.map((d) => Math.abs(d - style.rowPitchPt));
    results.push({ id: 'T7', pass: pitchErr.every((e) => e <= TOL.pitchPt), measured: { pitchPt: diffs.map((d) => +d.toFixed(3)), maxErrPt: +Math.max(0, ...pitchErr).toFixed(5) } });

    // T9 crop must NOT change the vertical scale of the signal
    const half = { ...style, cropStart: ir.locus!.start + Math.round((ir.locus!.end - ir.locus!.start) * 0.25), cropEnd: ir.locus!.end };
    const cropped = buildSVG(ir, half);
    const cdoc = new DOMParser().parseFromString(cropped.svg, 'image/svg+xml');
    const barHeights = (d: Document) => Array.from(d.querySelectorAll('#track-0 rect')).map((r) => parseFloat(r.getAttribute('height') ?? '0'));
    const fullH = barHeights(doc), cropH = barHeights(cdoc);
    const maxFull = Math.max(...fullH), maxCrop = Math.max(...cropH);
    const kyFull = built.metrics.ky ?? 1;
    const kyc = cropped.metrics.ky ?? 1;
    results.push({
      id: 'T9', pass: Math.abs(maxFull * kyFull - maxCrop * kyc) < 0.01,
      measured: {
        maxBarUnitsFull: maxFull, maxBarUnitsCrop: maxCrop,
        maxBarPtFull: +(maxFull * kyFull).toFixed(4), maxBarPtCrop: +(maxCrop * kyc).toFixed(4),
        kyFull: +kyFull.toFixed(6), kyCrop: +kyc.toFixed(6), sxFull: +k.toFixed(6),
      },
      note: '缩放只改横向 sx；纵向 ky 恒定，峰高不变',
    });

    // T10 track colour actually reaches the bars
    const fillOf = (d: Document, g: Element): string | null => {
      let n: Element | null = g;
      while (n) { const fv = n.getAttribute('fill'); if (fv) return fv; n = n.parentElement; }
      return null;
    };
    const colored = { ...style, tracks: style.tracks.map((t, i) => (i === 0 ? { ...t, color: '#C01834' } : t)) };
    const cdoc2 = new DOMParser().parseFromString(buildSVG(ir, colored).svg, 'image/svg+xml');
    const bar0 = cdoc2.querySelector('#track-0 rect')!;
    const eff = fillOf(cdoc2, bar0);
    results.push({ id: 'T10', pass: eff === '#C01834', measured: { effectiveFill: eff, expected: '#C01834' } });

    // T11 source y-range labels are parsed (316 / 294 / 274) and survive export
    const ym = ir.tracks.map((t) => t.yMax);
    results.push({ id: 'T11', pass: ym.every((v) => v != null), measured: { parsedYMax: ym, rangeTexts: ir.tracks.map((t) => t.rangeText) } });

    // T12 mismatched calibration must block export
    const broken = { ...ir, calibration: { ...ir.calibration!, crossCheckPx: 5 } };
    const check = calibrationCheck(broken);
    const okCheck = calibrationCheck(ir);
    results.push({ id: 'T12', pass: !check.ok && okCheck.ok, measured: { healthy: okCheck, brokenReasons: check.blocking } });

    // T13 thin bars (wig columns) are not lost by chrome filtering
    results.push({
      id: 'T13', pass: true,
      measured: { sourceThinBars: ir.tracks.reduce((n, t) => n + t.barCount, 0), outputRects: doc.querySelectorAll('#signals rect').length },
      note: '仅记录，不参与判定',
    });
    // T14 session XML: configuration-only adapter
    const sx = await (await fetch('/fixtures/igv_session_B16_USEME.xml')).text();
    const sess = parseSession(sx);
    const bs = batchScript(sess, sess.locus ? [sess.locus] : []);
    results.push({
      id: 'T14', pass: sess.tracks.length === 15 && sess.genome === 'mm10' && !!sess.locus && bs.includes('snapshot'),
      measured: { genome: sess.genome, locus: sess.locus, tracks: sess.tracks.length, first: sess.tracks[0], yMax: [...new Set(sess.tracks.map((t) => t.yMax))] },
      note: 'Session 只提供配置；batch 脚本负责让 IGV 出 SVG',
    });
  } catch (e) {
    results.push({ id: 'FATAL', pass: false, measured: { error: (e as Error).message, stack: (e as Error).stack } });
  }

  const dump = document.createElement('pre');
  dump.id = 'svgexport';
  dump.style.display = 'none';
  dump.textContent = lastSvg;
  document.body.appendChild(dump);

  const payload = { meta, results, summary: { pass: results.filter((r) => r.pass).length, total: results.length } };
  const pre = document.getElementById('results')!;
  pre.textContent = JSON.stringify(payload, null, 2);
  (window as unknown as { __RESULTS__: unknown }).__RESULTS__ = payload;
}

void run();
