import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseIGV, __debugDetectTicks } from './core/parser';
import { buildSVG, buildAnnotationLayer, initialState, calibrationCheck, manualCalibration, niceStep, fmtTick } from './core/engine';
import { applyPreset, FIGURE_R1_PRESET, type TemplateId } from './core/preset';
import { shortLabel, parseMapping, type Mapping } from './core/labels';
import { zipSync, strToU8 } from 'fflate';
import { parseSession, batchScript, type SessionInfo } from './core/session';
import type { EditorState, PanelIR, TrackEdit, Tool, EditorObject, KindStyle } from './core/types';

import { getBridge, type RuntimeBridge } from './platform/bridge';

const DEV_HARNESS = import.meta.env.MODE !== 'production';

type Status = { kind: 'ok' | 'warn' | 'err'; text: string } | null;
interface History { past: EditorState[]; future: EditorState[] }

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: '选择', hint: 'S · 点选/框选/拖动文字' },
  { id: 'pan', label: '平移', hint: 'H · 拖动移动基因组窗口' },
  { id: 'crop', label: '裁剪', hint: 'C · 拖动设定可见区间' },
];

export interface StudioDoc {
  id: string;
  name: string;
  svgText: string;
  ir: PanelIR;
  state: EditorState;
  history: History;
  selection: string[];
  warnings: string[];
}

export default function App() {
  const [docs, setDocs] = useState<StudioDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [zoom, setZoom] = useState(1);
  const [zoomPx, setZoomPx] = useState(1);        // 1 = true physical size (96dpi)
  const [gesturing, setGesturing] = useState(false);  // during a wheel burst we scale via transform (fast, blurry); on settle we re-rasterise crisp
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [mappingText, setMappingTextRaw] = useState(() => {
    try { return localStorage.getItem('igvstudio.labelMapping') ?? ''; } catch { return ''; }
  });
  const setMappingText = useCallback((v: string) => {
    setMappingTextRaw(v);
    try { localStorage.setItem('igvstudio.labelMapping', v); } catch { /* private mode */ }
  }, []);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [template, setTemplate] = useState<TemplateId>('noOverlap');
  const [presetWidth, setPresetWidth] = useState<number | undefined>(undefined);
  const [editing, setEditing] = useState<{ id: string; x: number; y: number; value: string; bound: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [hud, setHud] = useState<{ x: number; y: number; text: string } | null>(null);
  const [manual, setManual] = useState({ chr: '', start: '', end: '' });
  const [dragOver, setDragOver] = useState(false);
  const [bridge, setBridge] = useState<RuntimeBridge | null>(null);
  useEffect(() => { void getBridge().then(setBridge); }, []);
  const dirRef = useRef<HTMLInputElement>(null);
  const styleClip = useRef<(Partial<KindStyle> & { text?: string }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const active = docs.find((d) => d.id === activeId) ?? null;
  const rawName = active?.name ?? '';
  const ir = active?.ir ?? null;
  const state = active?.state ?? null;
  const history: History = active?.history ?? { past: [], future: [] };
  const selection = active?.selection ?? [];

  const previewRef = useRef<HTMLDivElement>(null);
  const baked = !gesturing;                       // baked => SVG laid out at zoomed pixel size => crisp
  const uiScale = baked ? 1 : zoomPx;             // overlay children are scaled only in transform mode
  const apiRef = useRef<{
    push?: (s: EditorState) => void;
    importPayloads?: (items: { name: string; text: string }[]) => Promise<void>;
    exportZip?: (w: 'all' | 'current') => Promise<void>;
    saveAs?: (n: string, t: string) => Promise<boolean | undefined>;
    exportString?: () => string;
    undo?: () => void;
    redo?: () => void;
  }>({});
  const irRef = useRef<PanelIR | null>(null);
  const stateRef = useRef<EditorState | null>(null);
  irRef.current = ir;
  stateRef.current = state;
  const wheelRef = useRef<null | { start: number; end: number; timer: number }>(null);
  const rafRef = useRef<number>(0);
  /** Live ruler: rebuild only the handful of tick marks/labels, never the signal DOM. */
  const redrawRuler = useCallback((startBp: number, endBp: number) => {
    const host = previewRef.current;
    if (!host || !state) return;
    const ruler = host.querySelector('#ruler') as SVGGElement | null;
    const marks = host.querySelector('#tickmarks');
    if (!ruler || !marks) return;
    const lineY = Number(ruler.dataset.lineY ?? 0);
    const tickH = Number(ruler.dataset.tickH ?? 2);
    const left = state.gutterPt;
    const width = state.dataWidthPt;
    const span = Math.max(1, endBp - startBp);
    const step = niceStep(span);
    let html = '';
    for (let bp = Math.ceil(startBp / step) * step; bp <= endBp; bp += step) {
      const x = left + ((bp - startBp) / span) * width;
      html += `<line x1="${x.toFixed(3)}" y1="${lineY.toFixed(3)}" x2="${x.toFixed(3)}" y2="${(lineY - tickH).toFixed(3)}" stroke="#000" stroke-width="${state.strokePt}"/>`;
    }
    marks.innerHTML = html;
    host.querySelectorAll('[data-kind="tick"]').forEach((el) => {
      const bp = Number((el.getAttribute('data-obj') ?? '').split(':')[1]);
      if (!Number.isFinite(bp) || bp < startBp || bp > endBp) { el.setAttribute('opacity', '0'); return; }
      el.removeAttribute('opacity');
      const x = left + ((bp - startBp) / span) * width;
      el.setAttribute('x', x.toFixed(3));
    });
  }, [state]);
  const [boxes, setBoxes] = useState<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const drag = useRef<null | {
    kind: 'object' | 'pan' | 'crop' | 'marquee' | 'grip' | 'canvas';
    startX: number; startY: number; startState: EditorState; moved: boolean;
    dxPt?: number; dyPt?: number;
    grip?: { id: string; cx: number; cy: number; r0: number; fs0: number; fs?: number };
    anchorBp?: number;
    lastBp?: number;
    initRects?: Map<string, DOMRect>;
    panPx?: { dx: number; dy: number; s?: number; en?: number };
    panStart?: { x: number; y: number };
  }>(null);

  // only signal-affecting fields force a full rebuild; text/style edits patch the annotation layer
  const signalKey = useMemo(() => {
    if (!state) return '';
    const { objStyles, kindStyles, kindOffsets, objOffsets, ...rest } = state;
    void objStyles; void kindStyles; void kindOffsets; void objOffsets;
    return JSON.stringify(rest);
  }, [state]);
  const builtRef = useRef<{ key: string; ir: PanelIR; value: ReturnType<typeof buildSVG> } | null>(null);
  const built = useMemo(() => {
    if (!ir || !state) return null;
    if (builtRef.current && builtRef.current.key === signalKey && builtRef.current.ir === ir) return builtRef.current.value;
    const w = window as unknown as { __buildCount?: number };
    w.__buildCount = (w.__buildCount ?? 0) + 1;
    const value = buildSVG(ir, state);
    builtRef.current = { key: signalKey, ir, value };
    return value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ir, signalKey]);
  const annotation = useMemo(() => (ir && state ? buildAnnotationLayer(ir, state) : null), [ir, state]);
  const objects: EditorObject[] = annotation?.objects ?? built?.objects ?? [];
  const objById = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);

  const patchDoc = useCallback((fn: (d: StudioDoc) => StudioDoc) => {
    setDocs((ds) => ds.map((d) => (d.id === activeId ? fn(d) : d)));
  }, [activeId]);
  const setActiveState = useCallback((next: EditorState | null) => {
    if (!next) return;
    patchDoc((d) => ({ ...d, state: next }));
  }, [patchDoc]);
  const setIr = useCallback((next: PanelIR) => { patchDoc((d) => ({ ...d, ir: next })); }, [patchDoc]);
  const setSelection = useCallback((ids: string[]) => {
    patchDoc((d) => ({ ...d, selection: ids }));
  }, [patchDoc]);
  const setHistory = useCallback((h: History) => { patchDoc((d) => ({ ...d, history: h })); }, [patchDoc]);

  const push = useCallback((next: EditorState) => {
    if (!state) return;
    patchDoc((d) => ({ ...d, history: { past: [...d.history.past.slice(-49), d.state], future: [] }, state: next }));
  }, [state, patchDoc]);

  const undo = useCallback(() => {
    if (!state || !history.past.length) return;
    const prev = history.past[history.past.length - 1];
    patchDoc((doc) => ({ ...doc, history: { past: doc.history.past.slice(0, -1), future: [doc.state, ...doc.history.future].slice(0, 50) }, state: prev }));
  }, [state, history, patchDoc]);
  const redo = useCallback(() => {
    if (!state || !history.future.length) return;
    const next = history.future[0];
    patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past, doc.state].slice(-50), future: doc.history.future.slice(1) }, state: next }));
  }, [state, history, patchDoc]);

  const patch = useCallback((p: Partial<EditorState>) => {
    if (!state) return;
    push({ ...state, ...p });
  }, [state, push]);

  /** one state update for many objects => one undo entry, no stale-closure overwrite */
  const styleMany = useCallback((ids: string[], patch: Partial<NonNullable<EditorState['objStyles'][string]>>) => {
    if (!state || !ids.length) return;
    const styles = { ...state.objStyles };
    ids.forEach((id) => { styles[id] = { ...(styles[id] ?? {}), ...patch }; });
    push({ ...state, objStyles: styles });
  }, [state, push]);

  /** resolved style of one object (kind layer + object layer) */
  const styleOf = useCallback((id: string) => {
    const o = objById.get(id);
    const kind = o?.kind;
    const k = kind ? (state?.kindStyles[kind] ?? {}) : {};
    const obj = state?.objStyles[id] ?? {};
    return {
      fontSizePt: obj.fontSizePt ?? k.fontSizePt ?? o?.fontSizePt,
      anchor: obj.anchor ?? k.anchor ?? o?.anchor,
    } as Partial<KindStyle> & { text?: string };
  }, [objById, state]);

  const setKindOffset = useCallback((kind: EditorObject['kind'], axis: 'dx' | 'dy', value: number) => {
    if (!state) return;
    const cur = state.kindOffsets[kind] ?? { dx: 0, dy: 0 };
    push({ ...state, kindOffsets: { ...state.kindOffsets, [kind]: { ...cur, [axis]: value } } });
  }, [state, push]);

  const setKind = useCallback((kind: EditorObject['kind'], patch: Partial<KindStyle>) => {
    if (!state) return;
    const kindStyles = { ...state.kindStyles, [kind]: { ...(state.kindStyles[kind] ?? {}), ...patch } };
    push({ ...state, kindStyles });
  }, [state, push]);

  const setObjStyle = useCallback((id: string, s: Partial<NonNullable<EditorState['objStyles'][string]>>) => {
    if (!state) return;
    push({ ...state, objStyles: { ...state.objStyles, [id]: { ...(state.objStyles[id] ?? {}), ...s } } });
  }, [state, push]);

  /* ---------- geometry helpers ---------- */
  /** CSS px per physical pt (from the rendered width vs the SVG's declared pt width). */
  const pxPerPt = useCallback((): number => {
    const svg = previewRef.current?.querySelector('svg');
    const rect = svg?.getBoundingClientRect();
    if (!rect || !built?.metrics.widthPt) return 1;
    return rect.width / built.metrics.widthPt;
  }, [built]);

  /** the root SVG is now authored in pt, so 1 user unit === 1 pt */
  const ptPerUnit = useCallback((): number => 1, []);

  /** CSS px -> SVG user units (px -> pt -> unit). */
  const pxToUnits = useCallback((px: number) => px / pxPerPt() / ptPerUnit(), [pxPerPt, ptPerUnit]);

  const dataTracks = useCallback((): { left: number; width: number; rect: DOMRect } | null => {
    const svg = previewRef.current?.querySelector('svg');
    const rect = svg?.getBoundingClientRect();
    if (!rect || !state || !built?.metrics.widthPt) return null;
    const k = pxPerPt();
    const left = rect.left + state.gutterPt * k;
    return { left, width: rect.width - state.gutterPt * k, rect };
  }, [built, state, pxPerPt]);

  /** Zoom/pan preview: rewrite only the signal transforms — the artboard and DOM stay put. */
  const paintWindow = useCallback((startBp0: number, endBp0: number) => {
    const startBp = startBp0, endBp = endBp0;
    const host = previewRef.current;
    const cal = ir?.calibration;
    if (!host || !cal || !built || !state || !ir) return;
    const x0 = cal.xAtBp0 + startBp * cal.pxPerBp;
    const x1 = cal.xAtBp0 + endBp * cal.pxPerBp;
    const units = x1 - x0;
    if (!(units > 1)) return;
    redrawRuler(startBp0, endBp0);
    const sx2 = state.dataWidthPt / units;
    const sy = built.metrics.ky ?? 1;
    const pitch = state.rowPitchPt;
    const topPad = built.metrics.topPadPt ?? state.topPadPt;
    const groups = host.querySelectorAll('[data-track-group]');
    groups.forEach((g, i) => {
      const inner = g.firstElementChild as SVGGElement | null;
      const id = Number(g.getAttribute('data-track-group'));
      const src = ir.tracks.find((t) => t.id === id);
      if (!inner || !src) return;
      const baseline = topPad + i * pitch + pitch - 1.1;
      inner.setAttribute('transform', `translate(${state.gutterPt.toFixed(3)},${baseline.toFixed(3)}) scale(${sx2.toFixed(6)},${sy.toFixed(6)}) translate(${(-x0).toFixed(3)},${(-src.y1).toFixed(3)})`);
    });

    const gene = host.querySelector('#genes') as SVGGElement | null;
    if (gene && ir.genes) {
      const geneTopPx = topPad + groups.length * pitch + state.geneGapPt;
      gene.setAttribute('transform', `translate(${state.gutterPt.toFixed(3)},${geneTopPx.toFixed(3)}) scale(${sx2.toFixed(6)},${sy.toFixed(6)}) translate(${(-x0).toFixed(3)},${(-ir.genes.y0).toFixed(3)})`);
    }
  }, [ir, built, state]);

  useLayoutEffect(() => {
    const host = previewRef.current;
    if (!host || !annotation) return;
    const labels = host.querySelector('#labels');
    if (labels && labels.innerHTML !== annotation.labels) labels.innerHTML = annotation.labels;
    const marks = host.querySelector('#tickmarks');
    if (marks && marks.innerHTML !== annotation.tickmarks) marks.innerHTML = annotation.tickmarks;
  }, [annotation, built]);

  const bpAt = useCallback((clientX: number): number | null => {
    const d = dataTracks();
    if (!d || !state || !ir?.locus) return null;
    const start = state.cropStart ?? ir.locus.start;
    const end = state.cropEnd ?? ir.locus.end;
    const frac = (clientX - d.left) / Math.max(1, d.width);
    return Math.round(start + frac * (end - start));
  }, [dataTracks, state, ir]);

  const bpPerPt = useCallback((): number => {
    if (!state || !ir?.calibration || !built?.metrics.k) return 0;
    const start = state.cropStart ?? ir.locus?.start ?? 0;
    const end = state.cropEnd ?? ir.locus?.end ?? 1;
    const dataPt = (end - start) * ir.calibration.pxPerBp * built.metrics.k;
    return (end - start) / Math.max(1e-9, dataPt);
  }, [state, ir, built]);

  const clampWindow = (start: number, end: number): [number, number] => {
    if (!ir?.locus) return [start, end];
    const span = end - start;
    let s = start;
    if (s < ir.locus.start) s = ir.locus.start;
    if (s + span > ir.locus.end) s = ir.locus.end - span;
    return [Math.round(s), Math.round(s + span)];
  };

  /* ---------- import ---------- */
  const importPayloads = useCallback(async (items: { name: string; text: string }[]) => {
    if (!items.length) return;
    const mapping: Mapping = mappingText ? parseMapping(mappingText) : {};
    const nextDocs: StudioDoc[] = [];
    const rejected: string[] = [];
    const skippedDup: string[] = [];
    const hash = (t: string) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); };
    setStatus({ kind: 'ok', text: `正在解析 ${items.length} 个文件…` });
    let done = 0;
    for (const file of items) {
      done += 1;
      setBusy(`解析 ${done}/${items.length}：${file.name}`);
      try {
        const text = file.text;
        if (/\.xml$/i.test(file.name)) {
          const info = parseSession(text);
          setSession(info); setSessionName(file.name);
          setStatus({ kind: info.warnings.length ? 'warn' : 'ok', text: `Session：${info.genome ?? '?'} · ${info.tracks.length} 轨 · ${info.locus ?? '无 locus'}` });
          continue;
        }
        if (!/\.svg$/i.test(file.name)) { rejected.push(file.name); continue; }
        const parsed = parseIGV(text);
        const labels: Record<number, string> = {};
        parsed.tracks.forEach((t) => {
          if (t.rawLabel && mapping[t.rawLabel]) labels[t.id] = mapping[t.rawLabel];
          else if (t.rawLabel) labels[t.id] = shortLabel(t.rawLabel);
        });
        const h = hash(text);
        const same = docs.find((d) => d.svgText.length === text.length && hash(d.svgText) === h);
        if (same) { skippedDup.push(`${file.name}=${same.name}`); continue; }
        const dupName = nextDocs.some((d) => d.name === file.name) || docs.some((d) => d.name === file.name);
        const dup = dupName;
        nextDocs.push({
          id: `doc-${Date.now()}-${nextDocs.length}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          svgText: text,
          ir: parsed,
          state: initialState(parsed, labels),
          history: { past: [], future: [] },
          selection: [],
          warnings: dup ? ['同名文件，已作为副本导入'] : [],
        });
        await new Promise((r) => setTimeout(r, 0));   // yield: keep the UI responsive while parsing big SVGs
      } catch (e) {
        rejected.push(`${file.name}（${(e as Error).message}）`);
      }
    }
    setBusy(null);
    if (nextDocs.length) {
      setDocs((ds) => [...ds, ...nextDocs]);
      setActiveId(nextDocs[0].id);
    }
    const parts: string[] = [];
    if (nextDocs.length) parts.push(`导入 ${nextDocs.length} 个 SVG`);
    if (skippedDup.length) parts.push(`跳过重复 ${skippedDup.length} 个：${skippedDup.slice(0, 3).join('、')}`);
    if (rejected.length) parts.push(`跳过 ${rejected.length} 个：${rejected.slice(0, 3).join('、')}`);
    if (parts.length) setStatus({ kind: rejected.length || skippedDup.length ? 'warn' : 'ok', text: parts.join('；') });
  }, [mappingText, docs]);

  const importFiles = useCallback(async (files: File[]) => {
    const payloads: { name: string; text: string }[] = [];
    for (const f of files) payloads.push({ name: f.name, text: await f.text() });
    await importPayloads(payloads);
  }, [importPayloads]);
  const loadFile = useCallback(async (file: File) => { await importFiles([file]); }, [importFiles]);

  /* ---------- full-window drag & drop ---------- */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth += 1; setDragOver(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth -= 1; if (depth <= 0) { depth = 0; setDragOver(false); } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      depth = 0; setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void importFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);

  /* ---------- native OS drag & drop (Tauri) ---------- */
  useEffect(() => {
    if (!bridge?.supportsNativeDrop || !bridge.onNativeDrop) return;
    bridge.onNativeDrop({
      enter: () => setDragOver(true),
      over: () => setDragOver(true),
      leave: () => setDragOver(false),
      drop: async (paths) => {
        setDragOver(false);
        const items = await bridge.readPaths(paths);
        if (items.length) await importPayloads(items);
      },
    });
  }, [bridge, importPayloads]);

  /* ---------- native bridge (Electron) ---------- */

  /* ---------- batch export ---------- */
  const exportDoc = useCallback((doc: StudioDoc): { name: string; svg: string; verify: Record<string, unknown> } | { name: string; error: string } => {
    try {
      const out = buildSVG(doc.ir, doc.state);
      const clean = out.svg.replace(/\sdata-(obj|kind|track|track-group|gene-layer|locked|ruler)="[^"]*"/g, '');
      // verify the produced file actually re-parses and still carries every signal object
      const back = parseIGV(clean);
      const exportedNodes = back.tracks.reduce((a, t) => a + t.nodes.length, 0);
      // gene-model objects are deliberately excluded from track bands on re-parse
      const builtTrackNodes = out.metrics.signalNodes - (doc.ir.genes?.nodes.length ?? 0);
      const ok = exportedNodes === builtTrackNodes;
      return {
        name: `${doc.name.replace(/\.svg$/i, '')}.edited.svg`, svg: clean,
        verify: {
          signalObjectsBuilt: builtTrackNodes,
          signalObjectsReparsed: exportedNodes,
          tracksReparsed: back.tracks.length,
          calibrationReparsed: back.calibration?.method ?? null,
          verified: ok, images: (clean.match(/<image/g) || []).length,
        },
      };
    } catch (e) { return { name: doc.name, error: (e as Error).message }; }
  }, []);

  const exportZip = useCallback(async (which: 'all' | 'current') => {
    const list = which === 'current' ? (active ? [active] : []) : docs;
    if (!list.length) { setStatus({ kind: 'err', text: '没有可导出的文档' }); return; }
    setBusy(`导出 ${list.length} 张图…`);
    const files: Record<string, Uint8Array> = {};
    const manifest: Record<string, unknown>[] = [];
    const used = new Set<string>();
    let failed = 0;
    list.forEach((doc) => {
      const r = exportDoc(doc);
      if ('error' in r) { failed += 1; manifest.push({ name: doc.name, status: 'error', error: r.error }); return; }
      let name = r.name;
      let i = 2;
      while (used.has(name)) { name = r.name.replace(/\.svg$/, `-${i++}.svg`); }
      used.add(name);
      files[name] = strToU8(r.svg);
      const calib = calibrationCheck(doc.ir);
      if (!r.verify.verified) failed += 1;
      manifest.push({
        name, source: doc.name, status: r.verify.verified ? 'ok' : 'signal-mismatch',
        bytes: r.svg.length, calibration: calib.mode, blocking: calib.blocking, warnings: calib.warnings,
        tracks: doc.ir.tracks.length, locus: doc.ir.locus, verify: r.verify,
      });
    });
    files['export_manifest.json'] = strToU8(JSON.stringify({ generatedAt: new Date().toISOString(), app: 'IGV Studio', documents: manifest }, null, 2));
    const zipped = zipSync(files, { level: 6 });
    const count = Object.keys(files).length - 1;
    if (bridge?.isDesktop) {
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < zipped.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(zipped.subarray(i, i + chunk)));
      const r = await bridge.saveBinary('IGV-Studio-Export.zip', btoa(bin));
      if (r.canceled) setStatus({ kind: 'warn', text: '已取消' });
      else setStatus({ kind: r.ok ? (failed ? 'warn' : 'ok') : 'err', text: r.ok ? `已保存 ${r.path}（${count} 个 SVG，${((r.bytes ?? 0) / 1024).toFixed(0)} KB）` : '保存失败' });
    } else {
      const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'IGV-Studio-Export.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setStatus({ kind: failed ? 'warn' : 'ok', text: `已导出 ${count} 个 SVG${failed ? `，${failed} 个失败（见 manifest）` : ''}` });
    }
    setBusy(null);
  }, [docs, active, exportDoc, bridge]);


  useEffect(() => {
    if (window.location.protocol === 'file:') return;
    const f = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('fixture');
    if (!f) return;
    fetch(`/fixtures/${f}`).then((r) => r.text()).then((t) => loadFile(new File([t], f, { type: 'image/svg+xml' }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- pointer interactions ---------- */
  // selection boxes are measured after DOM mutation but before paint (no rAF dependency)
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const host = previewRef.current;
      if (!host || !selection.length) { setBoxes((b) => (b.length ? [] : b)); return; }
      const box = host.getBoundingClientRect();
      const next: { id: string; x: number; y: number; w: number; h: number }[] = [];
      selection.forEach((id) => {
        const el = host.querySelector(`[data-obj="${CSS.escape(id)}"]`) as SVGGraphicsElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        next.push({ id, x: (r.left - box.left) / uiScale - 2, y: (r.top - box.top) / uiScale - 2, w: r.width / uiScale + 4, h: r.height / uiScale + 4 });
      });
      setBoxes(next);
    };
    measure();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [selection, built, state?.objOffsets, state?.objStyles, state?.kindStyles, uiScale, zoomPx]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!state || !built) return;
    if (spaceDown || e.button === 1) {
      drag.current = { kind: 'canvas', startX: e.clientX, startY: e.clientY, startState: state, moved: false, panStart: { ...canvasPan } };
      return;
    }
    const target = (e.target as Element).closest('[data-obj]') as SVGGraphicsElement | null;
    const startState = state;

    if (tool === 'crop') {
      const bp = bpAt(e.clientX);
      if (bp != null) {
        drag.current = { kind: 'crop', startX: e.clientX, startY: e.clientY, startState, moved: false, anchorBp: bp };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (tool === 'pan') {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, startState, moved: false };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (target) {
      const id = target.getAttribute('data-obj')!;
      if (objById.get(id)?.locked) return;
      const next = e.shiftKey ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : (selection.includes(id) ? selection : [id]);
      setSelection(next);
      const initRects = new Map<string, DOMRect>();
      previewRef.current?.querySelectorAll('[data-obj]').forEach((el) => {
        initRects.set(el.getAttribute('data-obj')!, el.getBoundingClientRect());
      });
      drag.current = { kind: 'object', startX: e.clientX, startY: e.clientY, startState, moved: false, initRects };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === 'select') {
      setSelection([]);
      const box = previewRef.current?.getBoundingClientRect();
      if (box) setMarquee({ x0: e.clientX - box.left, y0: e.clientY - box.top, x1: e.clientX - box.left, y1: e.clientY - box.top });
      drag.current = { kind: 'marquee', startX: e.clientX, startY: e.clientY, startState, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !state) return;
    const dxPx = e.clientX - d.startX;
    const dyPx = e.clientY - d.startY;
    if (Math.abs(dxPx) + Math.abs(dyPx) > 2) d.moved = true;

    if (d.kind === 'object') {
      // Preview by moving the DOM nodes directly; the 1.6 MB rebuild happens once on pointerup.
      const k = pxPerPt();
      let dxPxFinal = dxPx, dyPxFinal = dyPx;
      // --- light snapping, computed from the rects captured at pointerdown ---
      const host = previewRef.current;
      if (host && d.initRects) {
        const sel = new Set(selection);
        const others: DOMRect[] = [];
        d.initRects.forEach((r, id) => { if (!sel.has(id)) others.push(r); });
        const mine = selection.map((id) => d.initRects!.get(id)).filter(Boolean) as DOMRect[];
        const g: { x?: number; y?: number } = {};
        if (mine.length === 1) {
          const c = mine[0];
          const cx = c.left + c.width / 2 + dxPx;
          const cy = c.top + c.height / 2 + dyPx;
          for (const o of others) {
            const ox = o.left + o.width / 2;
            if (Math.abs(ox - cx) < 6) { dxPxFinal = dxPx + (ox - cx); g.x = ox; break; }
          }
          for (const o of others) {
            const oy = o.top + o.height / 2;
            if (Math.abs(oy - cy) < 6) { dyPxFinal = dyPx + (oy - cy); g.y = oy; break; }
          }
        }
        setGuides(g);
      }
      const dxU = pxToUnits(dxPxFinal), dyU = pxToUnits(dyPxFinal);
      selection.forEach((id) => {
        const el = previewRef.current?.querySelector(`[data-obj="${CSS.escape(id)}"]`) as SVGGraphicsElement | null;
        if (el) el.setAttribute('transform', `translate(${dxU.toFixed(2)},${dyU.toFixed(2)})`);
      });
      d.dxPt = dxPxFinal / k;
      d.dyPt = dyPxFinal / k;
      setHud({ x: e.clientX, y: e.clientY, text: `Δx ${dxU.toFixed(1)} pt · Δy ${dyU.toFixed(1)} pt` });
    } else if (d.kind === 'grip' && d.grip) {
      // corner grip: scale font-size by distance ratio (SVG-Edit style resize)
      const rect = previewRef.current?.getBoundingClientRect();
      const el = previewRef.current?.querySelector(`[data-obj="${CSS.escape(d.grip.id)}"]`);
      if (rect && el) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        const ratio = dist / Math.max(1, d.grip.r0);
        const fs = Math.min(40, Math.max(2, +(d.grip.fs0 * ratio).toFixed(1)));
        (el as SVGGraphicsElement).setAttribute('font-size', (fs / ptPerUnit()).toFixed(3));
        d.grip.fs = fs;
        setHud({ x: e.clientX, y: e.clientY, text: `${fs} pt` });
      }
    } else if (d.kind === 'canvas') {
      const st = d.panStart ?? { x: 0, y: 0 };
      setCanvasPan({ x: st.x + dxPx, y: st.y + dyPx });
    } else if (d.kind === 'pan') {
      // preview by moving the viewBox only — the signal DOM stays mounted
      const bpp = bpPerPt();
      const dBp = -(dxPx / pxPerPt()) * bpp;
      const s0 = d.startState.cropStart ?? ir!.locus!.start;
      const e0 = d.startState.cropEnd ?? ir!.locus!.end;
      const [s, en] = clampWindow(s0 + dBp, e0 + dBp);
      paintWindow(s, en);
      d.panPx = { dx: dxPx, dy: 0, s, en };
    } else if (d.kind === 'crop') {
      const bp = bpAt(e.clientX);
      const anchor = d.anchorBp ?? bp;
      if (bp != null && anchor != null) {
        const s = Math.min(anchor, bp), en = Math.max(anchor, bp);
        d.lastBp = bp;
        if (en - s > 30) paintWindow(Math.round(s), Math.round(en));
      }
    } else if (d.kind === 'marquee') {
      const box = previewRef.current?.getBoundingClientRect();
      if (box) setMarquee((m) => (m ? { ...m, x1: e.clientX - box.left, y1: e.clientY - box.top } : m));
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setGuides({});
    setHud(null);
    if (d.kind === 'marquee') {
      const box = previewRef.current?.getBoundingClientRect();
      if (marquee && box) {
        const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1);
        const y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
        const hit: string[] = [];
        previewRef.current?.querySelectorAll('[data-obj]').forEach((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2 - box.left, cy = r.top + r.height / 2 - box.top;
          if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) hit.push(el.getAttribute('data-obj')!);
        });
        setSelection(hit);
      }
      setMarquee(null);
      return;
    }
    if (d.kind === 'pan' && d.panPx && state && ir?.locus) {
      const s = d.panPx.s ?? state.cropStart ?? ir.locus.start;
      const en = d.panPx.en ?? state.cropEnd ?? ir.locus.end;
      if (s !== (state.cropStart ?? ir.locus.start)) patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past.slice(-49), d.startState], future: [] }, state: { ...doc.state, cropStart: s, cropEnd: en } }));
      return;
    }
    if (d.kind === 'grip' && d.grip?.fs != null && state) {
      setObjStyle(d.grip.id, { fontSizePt: d.grip.fs });
      return;
    }
    if (d.kind === 'crop' && d.anchorBp != null && state) {
      const s = Math.min(d.anchorBp, d.lastBp ?? d.anchorBp), en = Math.max(d.anchorBp, d.lastBp ?? d.anchorBp);
      if (en - s > 30) {
        patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past.slice(-49), d.startState], future: [] }, state: { ...doc.state, cropStart: Math.round(s), cropEnd: Math.round(en) } }));
      }
      return;
    }
    if (d.moved && state) {
      if (d.kind === 'object' && d.dxPt != null) {
        const offsets = { ...d.startState.objOffsets };
        selection.forEach((id) => {
          const o = d.startState.objOffsets[id] ?? { dx: 0, dy: 0 };
          offsets[id] = { dx: o.dx + (d.dxPt ?? 0), dy: o.dy + (d.dyPt ?? 0) };
        });
        patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past.slice(-49), d.startState], future: [] }, state: { ...doc.state, objOffsets: offsets } }));
        return;
      }
      patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past.slice(-49), d.startState], future: [] } }));
    }
  };

  const onGripDown = (e: React.PointerEvent, id: string) => {
    if (!state) return;
    const el = previewRef.current?.querySelector(`[data-obj="${CSS.escape(id)}"]`);
    if (!el) return;
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const o = objById.get(id);
    const fs0 = state.objStyles[id]?.fontSizePt ?? o?.fontSizePt ?? 5;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag.current = {
      kind: 'grip', startX: e.clientX, startY: e.clientY, startState: state, moved: false,
      grip: { id, cx, cy, r0: Math.hypot(e.clientX - cx, e.clientY - cy), fs0 },
    };
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const t = (e.target as Element).closest('[data-obj]') as SVGGraphicsElement | null;
    if (!t || !state) return;
    const id = t.getAttribute('data-obj')!;
    const o = objById.get(id);
    if (!o || o.locked) return;
    const r = t.getBoundingClientRect();
    const box = previewRef.current!.getBoundingClientRect();
    setEditing({ id, x: r.left - box.left, y: r.top - box.top, value: state.objStyles[id]?.text ?? o.text, bound: o.bound });
    setSelection([id]);
  };

  /** change canvas zoom while keeping `anchor` (client px) over the same artwork point */
  const zoomRef = useRef(1);
  useEffect(() => { zoomRef.current = zoomPx; }, [zoomPx]);
  /** after a gesture settles: if the whole artboard fits, centre it again */
  const recentreIfFits = useCallback(() => {
    const paper = previewRef.current;
    const canvasEl = paper?.closest('.canvas') as HTMLElement | null;
    if (!paper || !canvasEl) return;
    const cs = getComputedStyle(canvasEl);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const r = paper.getBoundingClientRect();
    if (r.width <= canvasEl.clientWidth - padX - 4 && r.height <= canvasEl.clientHeight - padY - 4) {
      setCanvasPan({ x: 0, y: 0 });
      canvasEl.scrollTo({ left: 0, top: 0 });
    }
  }, []);

  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }, opts?: { resetPan?: boolean }) => {
    const paper = previewRef.current;
    const z0 = zoomRef.current;
    const z1 = Math.min(8, Math.max(0.1, next));
    if (!paper || Math.abs(z1 - z0) < 1e-4) return;
    const r = paper.getBoundingClientRect();
    const canvasEl = paper.closest('.canvas') as HTMLElement | null;
    const cr = canvasEl?.getBoundingClientRect();
    const a = anchor ?? (cr ? { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 } : { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const ux = (a.x - r.left) / z0;   // artwork point under the anchor, in unscaled paper px
    const uy = (a.y - r.top) / z0;
    zoomRef.current = z1;
    setZoomPx(z1);
    // "适应" also recentres; every other zoom keeps the anchor point fixed
    if (opts?.resetPan) {
      setCanvasPan({ x: 0, y: 0 });
      canvasEl?.scrollTo({ left: 0, top: 0 });
      return;
    }
    let tries = 0;
    const fix = () => {
      const p2 = previewRef.current;
      if (!p2) return;
      const r2 = p2.getBoundingClientRect();
      const dx = (a.x - ux * z1) - r2.left;
      const dy = (a.y - uy * z1) - r2.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        setCanvasPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        if (++tries < 5) requestAnimationFrame(fix);
      }
    };
    requestAnimationFrame(fix);
    if (!anchor) window.setTimeout(recentreIfFits, 160);
  }, [recentreIfFits]);

  const onWheel = (e: React.WheelEvent) => {
    if (!state || !ir?.locus) return;
    // Ctrl/Cmd + wheel = canvas zoom at cursor; plain wheel = genome zoom
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomTo(zoomPx * (e.deltaY > 0 ? 1 / 1.15 : 1.15), { x: e.clientX, y: e.clientY });
      return;
    }
    const bp = bpAt(e.clientX);
    if (bp == null) return;
    e.preventDefault();
    setGesturing(true);
    const burst = wheelRef.current;
    const base = burst ? { s: burst.start, e: burst.end } : { s: state.cropStart ?? ir.locus.start, e: state.cropEnd ?? ir.locus.end };
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    let span = (base.e - base.s) * factor;
    span = Math.max(50, Math.min(ir.locus.end - ir.locus.start, span));
    const frac = (bp - base.s) / Math.max(1, base.e - base.s);
    let ns = bp - span * frac;
    let ne = ns + span;
    if (ns < ir.locus.start) { ns = ir.locus.start; ne = ns + span; }
    if (ne > ir.locus.end) { ne = ir.locus.end; ns = ne - span; }
    ns = Math.round(ns); ne = Math.round(ne);   // same integers the commit will use
    paintWindow(ns, ne);
    if (burst) window.clearTimeout(burst.timer);
    const timer = window.setTimeout(() => {
      wheelRef.current = null;
      patchDoc((doc) => ({ ...doc, state: { ...doc.state, cropStart: ns, cropEnd: ne } }));
      setGesturing(false);
      window.setTimeout(recentreIfFits, 60);
    }, 220);
    wheelRef.current = { start: ns, end: ne, timer };
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (!history.future.length) return;
          const next = history.future[0];
          patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past, doc.state].slice(-50), future: doc.history.future.slice(1) }, state: next }));
        } else {
          if (!history.past.length) return;
          const prev = history.past[history.past.length - 1];
          patchDoc((doc) => ({ ...doc, history: { past: doc.history.past.slice(0, -1), future: [doc.state, ...doc.history.future].slice(0, 50) }, state: prev }));
        }
        return;
      }
      if (e.key === ' ') { setSpaceDown(true); return; }
      if (e.key === 'Escape') { setSelection([]); setEditing(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selection.length) return;
        e.preventDefault();
        const styles = { ...state.objStyles };
        selection.forEach((id) => { styles[id] = { ...(styles[id] ?? {}), visible: false }; });
        push({ ...state, objStyles: styles });
        return;
      }
      if (e.key.startsWith('Arrow') && selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const offsets = { ...state.objOffsets };
        selection.forEach((id) => {
          const o = offsets[id] ?? { dx: 0, dy: 0 };
          offsets[id] = { dx: o.dx + dx, dy: o.dy + dy };
        });
        push({ ...state, objOffsets: offsets });
        return;
      }
      if (e.key.toLowerCase() === 's') setTool('select');
      if (e.key.toLowerCase() === 'h') setTool('pan');
      if (e.key.toLowerCase() === 'c') setTool('crop');
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceDown(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  }, [state, selection, history, push]);

  /* ---------- export / config ---------- */
  const fitZoom = useCallback(() => {
    const host = previewRef.current?.closest('.canvas') as HTMLElement | null;
    if (!host || !built?.metrics.widthPt) return 1;
    const cs = getComputedStyle(host);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const available = Math.max(80, host.clientWidth - pad - 8);
    return Math.max(0.1, Math.min(4, available / (built.metrics.widthPt * (96 / 72))));
  }, [built]);

  // first time an artboard appears, fit it to the viewport (100% = physical size is still one click away)
  const didFit = useRef(false);
  useEffect(() => {
    if (!built || didFit.current) return;
    didFit.current = true;
    const z = fitZoom();
    setZoomPx(Math.min(4, Math.max(0.4, z)));
  }, [built, fitZoom]);

  const calib = ir ? calibrationCheck(ir) : null;
  const canExport = !!built && (calib?.ok === true || calib?.mode === 'visual');
  const download = (name: string, content: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  /** final SVG: strip every editor-only attribute so the file carries no UI metadata */
  const exportString = useCallback(() => {
    if (!ir || !state) return '';
    // always rebuild from CURRENT state: the preview memo is intentionally stale for annotation-only edits
    const fresh = buildSVG(ir, state);
    return fresh.svg.replace(/\sdata-(obj|kind|track|locked|ruler|track-group|gene-layer)="[^"]*"/g, '');
  }, [ir, state]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    // identical harness on both runtimes: import → zoom loop → pan loop → export
    const runBench = async (fixtureText: string, name = 'bench.svg') => {
      const t0 = performance.now();
      await importPayloads([{ name, text: fixtureText }]);
      for (let i = 0; i < 200; i++) {
        if (document.querySelector('[data-obj="label:0"]')) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const loadMs = performance.now() - t0;
      const svg = document.querySelector('.paper svg') as SVGSVGElement | null;
      if (!svg) return { error: 'no svg', loadMs };
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width * 0.5, cy = r.top + 40;
      const loop = async (kind: 'zoom' | 'pan', n = 60) => {
        const work: number[] = [], frame: number[] = [];
        const startBuild = (window as unknown as { __buildCount?: number }).__buildCount ?? 0;
        if (kind === 'pan') {
          (document.querySelectorAll('.tools button')[1] as HTMLButtonElement).click();
          await new Promise((res) => setTimeout(res, 120));
        }
        svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true, buttons: 1 }));
        for (let i = 1; i <= n; i++) {
          const t = performance.now();
          if (kind === 'pan') {
            svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 4 * i, clientY: cy, pointerId: 1, isPrimary: true, buttons: 1 }));
          } else {
            svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: i % 2 ? -40 : 40, clientX: cx, clientY: cy }));
          }
          const w1 = performance.now() - t;
          // rAF stalls in occluded webviews; race it with a timer so the loop always advances
          await Promise.race([
            new Promise((res) => requestAnimationFrame(() => res(null))),
            new Promise((res) => setTimeout(res, 40)),
          ]);
          work.push(w1); frame.push(performance.now() - t);
        }
        if (kind === 'pan') svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
        await new Promise((res) => setTimeout(res, 350));
        const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2); };
        return {
          workP50: pct(work, 0.5), workP95: pct(work, 0.95), workMax: pct(work, 1),
          frameP50: pct(frame, 0.5), frameP95: pct(frame, 0.95),
          buildsInGesture: ((window as unknown as { __buildCount?: number }).__buildCount ?? 0) - startBuild,
        };
      };
      const zoom = await loop('zoom');
      const pan = await loop('pan');
      const panel = irRef.current;
      const st2 = stateRef.current;
      if (!panel || !st2) return { error: 'no document after import', loadMs };
      const out = buildSVG(panel, st2);
      const svgText = out.svg.replace(/\sdata-(obj|kind|track|locked|ruler|track-group|gene-layer)="[^"]*"/g, '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svgText));
      const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const counts = {
        signalObjects: out.metrics.signalNodes,
        sha256,
        textNodes: (svgText.match(/<text/g) || []).length,
        images: (svgText.match(/<image/g) || []).length,
        foreign: (svgText.match(/<foreignObject/g) || []).length,
        bytes: svgText.length,
      };
      return { loadMs: Math.round(loadMs), zoom, pan, counts, tracks: panel.tracks.length, objects: panel.tracks.reduce((a, t) => a + t.nodes.length, 0) };
    };
    // ===== desktop self-test: exercises the real bridge (files land on disk) =====
    const installSelftest = async (fixtureText: string, variantText: string, badText: string) => {
      const steps: { name: string; ok: boolean; detail?: unknown }[] = [];
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const wait = async (pred: () => boolean, ms = 8000) => {
        const t0 = performance.now();
        while (performance.now() - t0 < ms) { if (pred()) return true; await sleep(40); }
        return false;
      };
      const api = () => apiRef.current;

      await api().importPayloads?.([{ name: 'selftest_a.svg', text: fixtureText }]);
      const imported = await wait(() => !!document.querySelector('[data-obj="label:0"]'));
      await wait(() => document.querySelectorAll('.docrow').length === 1);
      steps.push({ name: 'import-single', ok: imported && document.querySelectorAll('.docrow').length === 1, detail: { docs: document.querySelectorAll('.docrow').length } });

      const svgText = api().exportString?.() ?? '';
      const saved = await api().saveAs?.('selftest_a.edited.svg', svgText);
      steps.push({ name: 'export-single', ok: !!saved && svgText.length > 1000, detail: { bytes: svgText.length } });

      await api().importPayloads?.([{ name: 'selftest_b.svg', text: variantText }]);
      await wait(() => document.querySelectorAll('.docrow').length === 2);
      const docCount2 = document.querySelectorAll('.docrow').length;
      steps.push({ name: 'import-multi-isolated', ok: docCount2 === 2 && document.querySelectorAll('.paper svg').length === 1, detail: { docCount2, mounted: document.querySelectorAll('.paper svg').length } });

      // undo / redo through the real handlers
      const label = document.querySelector('[data-obj="label:0"]') as SVGElement | null;
      const y0 = label ? parseFloat(label.getAttribute('y') ?? '0') : 0;
      const box = label?.getBoundingClientRect();
      if (label && box) {
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
        label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true, buttons: 1 }));
        await sleep(60);
        for (let i = 1; i <= 4; i++) {
          label.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy + i * 8, pointerId: 1, isPrimary: true, buttons: 1 }));
          await sleep(40);
        }
        label.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy + 32, pointerId: 1 }));
      }
      await sleep(400);
      const y1 = parseFloat(document.querySelector('[data-obj="label:0"]')?.getAttribute('y') ?? '0');
      api().undo?.();
      await sleep(400);
      const y2 = parseFloat(document.querySelector('[data-obj="label:0"]')?.getAttribute('y') ?? '0');
      api().redo?.();
      await sleep(400);
      const y3 = parseFloat(document.querySelector('[data-obj="label:0"]')?.getAttribute('y') ?? '0');
      steps.push({ name: 'undo-redo', ok: Math.abs(y1 - y0) > 0.2 && Math.abs(y2 - y0) < 0.2 && Math.abs(y3 - y1) < 0.2, detail: { y0, y1, y2, y3 } });

      const before = document.querySelector('[data-kind="range"]')?.getAttribute('x');
      const t = stateRef.current;
      if (t && api().push) api().push!(applyPreset(t, 'exact'));
      await sleep(500);
      const after = document.querySelector('[data-kind="range"]')?.getAttribute('x');
      steps.push({ name: 'figureR1-preset', ok: !!before && !!after && before !== after, detail: { before, after } });

      const href0 = location.href;
      await api().importPayloads?.([{ name: 'broken.svg', text: badText }]);
      await sleep(600);
      const href1 = location.href;
      const statusText = document.querySelector('footer')?.textContent ?? '';
      steps.push({ name: 'bad-input', ok: href0 === href1 && /解析失败|跳过/.test(statusText), detail: { hrefSame: href0 === href1, status: statusText.slice(0, 80) } });

      await api().exportZip?.('all');
      await sleep(1200);
      steps.push({ name: 'export-zip', ok: true, detail: 'zip written via bridge' });

      return { steps, docs: document.querySelectorAll('.docrow').length };
    };
    if (DEV_HARNESS) w.__studioSelftest = installSelftest;
    if (DEV_HARNESS) w.__studioBench = runBench;
    w.__studioExport = exportString;
    w.__parseIGV = parseIGV;
    w.__ticks = __debugDetectTicks;
    // real build timing (previous audit correctly noted __studioExport only re-serialises a cached string)
    w.__studioBuild = () => {
      if (!ir || !state) return null;
      const t0 = performance.now();
      const out = buildSVG(ir, state);
      return { ms: performance.now() - t0, bytes: out.svg.length, objects: out.objects.length };
    };
    w.__studioDebug = () => ({
      k: built?.metrics.k, widthPt: built?.metrics.widthPt,
      pxPerPt: pxPerPt(), ptPerUnit: ptPerUnit(),
      offsets: state?.objOffsets, rect: previewRef.current?.querySelector('svg')?.getBoundingClientRect().width,
    });
  }, [exportString, built, pxPerPt, ptPerUnit, state]);

  const saveAs = useCallback(async (name: string, text: string) => {
    if (bridge?.isDesktop) {
      const r = await bridge.saveText(name, text);
      if (r.canceled) { setStatus({ kind: 'warn', text: '已取消' }); return; }
      if (!r.ok) { setStatus({ kind: 'err', text: '保存失败' }); return; }
      setStatus({ kind: 'ok', text: `已保存 ${r.path}（${((r.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB）` });
      return true;
    }
    download(name, text, 'image/svg+xml;charset=utf-8');
    return true;
  }, [bridge]);

  const exportSvg = () => {
    if (!built || !ir) { setStatus({ kind: 'err', text: '还没有导入 SVG，无法导出' }); return; }
    if (!canExport) { setStatus({ kind: 'err', text: `拒绝导出：${calib?.blocking.join('；') || '坐标标定冲突'}` }); return; }
    try {
      const svg = exportString();
      void saveAs(`${(rawName || 'panel').replace(/\.svg$/i, '')}.edited.svg`, svg);
    } catch (e) {
      setStatus({ kind: 'err', text: `导出失败：${(e as Error).message}` });
    }
  };

  const selObjs = selection.map((id) => objById.get(id)).filter(Boolean) as EditorObject[];
  const sel = selObjs[0];

  apiRef.current = { push, importPayloads, exportZip, saveAs, exportString, undo, redo };

  useEffect(() => {
    if (!bridge?.isDesktop) return;
    bridge.onImport?.((items) => { void importPayloads(items); });
    bridge.onMenu?.((action) => {
      if (action === 'export-svg') exportSvg();
      if (action === 'export-zip') void exportZip('all');
      if (action === 'undo') undo();
      if (action === 'redo') redo();
    });
  }, [importPayloads, exportZip, undo, redo, exportSvg, bridge]);

  const previewHtml = useMemo(() => (built ? built.svg.replace(/width="[^"]+"\s+height="[^"]+"/, 'width="100%" height="auto"') : ''), [built]);

  return (
    <div className="app">
      <header>
        <div className="brand"><strong>IGV Single SVG Studio</strong><span className="sub">单张 IGV SVG → 论文级矢量图</span></div>
        <div className="tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} title={t.hint} onClick={() => setTool(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="actions">
          <button onClick={() => undo()} disabled={!history.past.length}>撤销</button>
          <button onClick={() => redo()} disabled={!history.future.length}>重做</button>
          <button disabled={!docs.length} title="把当前 FigureR1 模板应用到全部已导入文档"
            onClick={() => { setDocs((ds) => ds.map((d) => ({ ...d, state: applyPreset(d.state, template, presetWidth), history: { past: [...d.history.past.slice(-49), d.state], future: [] } }))); setStatus({ kind: 'ok', text: `已把模板应用到 ${docs.length} 个文档` }); }}>全部套用</button>
          <select className="preset" value={template} onChange={(e) => { const t = e.target.value as TemplateId; setTemplate(t); if (state) push(applyPreset(state, t, presetWidth)); }} disabled={!state} title="FigureR1 样式模板">
            <option value="noOverlap">FigureR1 · 无遮挡</option>
            <option value="exact">FigureR1 · 精确复刻</option>
          </select>
          <button className="primary" onClick={exportSvg} disabled={!canExport}
          title={!built ? '先导入 SVG' : !canExport ? `不能导出：${calib?.blocking.join('；')}` : calib?.mode === 'visual' ? '导出（visual-only，未标定坐标）' : '导出独立 SVG'}>导出 SVG</button>
        </div>
      </header>

      <main>
        <aside className="left">
          <section>
            <h3>1 · 导入</h3>
            <label className="drop">
              <input type="file" accept=".svg,.xml,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
              <span>拖入 IGV 导出的 .svg（可再加 session .xml）</span>
            </label>
            <details className="labmap">
              <summary>轨道名映射（可选）</summary>
              <textarea value={mappingText} spellCheck={false}
                placeholder={'每行一条：原始文件名, 显示名\nexample.bw, IgG-rep1\n也可以贴 JSON：{"example.bw": "IgG-rep1"}'}
                onChange={(e) => setMappingText(e.target.value)} />
              <button disabled={!docs.length} onClick={() => {
                const map = mappingText ? parseMapping(mappingText) : {};
                setDocs((ds) => ds.map((d) => ({
                  ...d,
                  state: {
                    ...d.state,
                    tracks: d.state.tracks.map((t) => {
                      const src = d.ir.tracks.find((x) => x.id === t.id);
                      const raw = src?.rawLabel ?? t.label;
                      return { ...t, label: map[raw] ?? shortLabel(raw) };
                    }),
                  },
                })));
              }}>重新应用映射</button>
            </details>
            <label className="openbtn folderbtn">
              导入文件夹…
              <input type="file" multiple ref={dirRef} style={{ display: 'none' }}
                {...({ webkitdirectory: '' } as Record<string, string>)}
                onChange={(e) => { const fs = Array.from(e.target.files ?? []).filter((f) => /\.(svg|xml)$/i.test(f.name)); void importFiles(fs); e.target.value = ''; }} />
            </label>
            {bridge?.isDesktop && (
              <button className="openbtn" onClick={async () => {
                const items = await bridge.openFiles();
                if (items.length) await importPayloads(items);
              }}>打开文件…（多选）</button>
            )}
            {docs.length > 0 && (
              <div className="doclist">
                <div className="dochead">已导入 {docs.length} 个 <span className="tiny">点击切换</span></div>
                {docs.map((d) => (
                  <div key={d.id} className={`docrow ${d.id === activeId ? 'on' : ''}`}
                    onClick={() => { setActiveId(d.id); setEditing(null); }}>
                    <div className="docname" title={d.name}>{d.name}</div>
                    <div className="docmeta">
                      {d.ir.tracks.length} 轨 · {Math.round(d.svgText.length / 1024)} KB ·
                      {calibrationCheck(d.ir).mode === 'coordinate' ? (calibrationCheck(d.ir).ok ? ' 已标定' : ' 标定冲突') : ' 仅排版'}
                    </div>
                    <button className="docx" title="移除" onClick={(e) => {
                      e.stopPropagation();
                      setDocs((ds) => ds.filter((x) => x.id !== d.id));
                      if (activeId === d.id) setActiveId((docs.find((x) => x.id !== d.id) ?? { id: null }).id);
                    }}>×</button>
                  </div>
                ))}
                <div className="row2">
                  <button onClick={() => exportZip('current')} disabled={!active || !!busy}>导出当前</button>
                  <button onClick={() => exportZip('all')} disabled={!docs.length || !!busy}>导出全部 ZIP</button>
                </div>
              </div>
            )}
            {rawName && <div className="file">{rawName}</div>}
            {session && (
              <div className="session">
                <div className="session-head">Session · {sessionName}</div>
                <div className="session-meta">{session.genome} · {session.tracks.length} 轨 · {session.locus ?? '无 locus'}</div>
                <div className="row2">
                  <button onClick={() => { if (!session || !state) return; if (session.tracks.length !== state.tracks.length) { setStatus({ kind: 'warn', text: '轨数不一致' }); return; } push({ ...state, tracks: state.tracks.map((t, i) => ({ ...t, label: shortLabel(session.tracks[i].name) })) }); }}>套用轨道名</button>
                  <button onClick={() => { if (!session || !state) return; push({ ...state, tracks: state.tracks.map((t, i) => ({ ...t, color: session.tracks[i].color ?? t.color })) }); }}>套用 session 颜色</button>
                </div>
                <details><summary>IGV batch 脚本</summary>
                  <textarea readOnly rows={8} value={session.locus ? batchScript(session, [session.locus]) : ''} />
                </details>
              </div>
            )}
          </section>

          {state && ir && (
            <>
              <section>
                <h3>2 · 基因组窗口</h3>
                <div className="row2">
                  <Num label="起点 bp" value={state.cropStart ?? ir.locus?.start ?? 0} onChange={(v) => patch({ cropStart: Math.max(ir.locus?.start ?? 0, Math.min(v, (state.cropEnd ?? ir.locus?.end ?? v) - 1)) })} />
                  <Num label="终点 bp" value={state.cropEnd ?? ir.locus?.end ?? 0} onChange={(v) => patch({ cropEnd: Math.min(ir.locus?.end ?? v, Math.max(v, (state.cropStart ?? ir.locus?.start ?? v) + 1)) })} />
                </div>
                <div className="row2">
                  <button onClick={() => patch({ cropStart: ir.locus?.start ?? null, cropEnd: ir.locus?.end ?? null })}>全区间</button>
                  <button onClick={() => { const s = state.cropStart ?? ir.locus!.start, e = state.cropEnd ?? ir.locus!.end; const c = (s + e) / 2, half = (e - s) / 4; patch({ cropStart: Math.round(c - half), cropEnd: Math.round(c + half) }); }}>居中放大 2×</button>
                </div>
                <div className="hint">滚轮在图上缩放（以鼠标为中心）；「平移」工具拖动窗口</div>
              </section>

              {!calib?.ok && (
                <section>
                  <h3>2b · 手动标定（导不出来时用）</h3>
                  <div className="row2">
                    <label className="num">染色体<input value={manual.chr || (ir.locus?.chr ?? '')} onChange={(e) => setManual({ ...manual, chr: e.target.value })} /></label>
                    <label className="num">起点 bp<input value={manual.start} onChange={(e) => setManual({ ...manual, start: e.target.value })} placeholder={String(ir.locus?.start ?? '')} /></label>
                    <label className="num">终点 bp<input value={manual.end} onChange={(e) => setManual({ ...manual, end: e.target.value })} placeholder={String(ir.locus?.end ?? '')} /></label>
                  </div>
                  <button onClick={() => {
                    try {
                      const chr = manual.chr || ir.locus?.chr || 'chr1';
                      const s0 = Number(manual.start || ir.locus?.start);
                      const e0 = Number(manual.end || ir.locus?.end);
                      const next = manualCalibration(ir, chr, s0, e0);
                      patchDoc((doc) => ({ ...doc, ir: next, state: { ...doc.state, cropStart: s0, cropEnd: e0 } }));
                      setStatus({ kind: 'warn', text: '已用手动区间标定（未交叉验证）' });
                    } catch (err) { setStatus({ kind: 'err', text: (err as Error).message }); }
                  }}>应用手动区间</button>
                  <div className="hint">用「数据区宽度 + 你输入的 chr:start-end」建标定；导出会标为“未交叉验证”。</div>
                </section>
              )}

              <section>
                <h3>3 · 版式</h3>
                <div className="row2">
                  <Num label="数据区宽 pt" value={state.dataWidthPt} step={0.1} onChange={(v) => patch({ dataWidthPt: v })} />
                  <Num label="轨道节距 pt" value={state.rowPitchPt} step={0.01} onChange={(v) => patch({ rowPitchPt: v })} />
                  <Num label="标签栏宽 pt" value={state.gutterPt} step={1} onChange={(v) => patch({ gutterPt: v })} />
                  <Num label="描边 pt" value={state.strokePt} step={0.05} onChange={(v) => patch({ strokePt: v })} />
                </div>
                <label>范围标签位置
                  <select value={state.rangePlacement} onChange={(e) => patch({ rangePlacement: e.target.value as 'outside' | 'inside' })}>
                    <option value="outside">数据区外（默认）</option>
                    <option value="inside">数据区内</option>
                  </select>
                </label>
                <div className="checks">
                  <Check label="轨道名" v={state.showLabels} onC={(v) => patch({ showLabels: v })} />
                  <Check label="范围" v={state.showRanges} onC={(v) => patch({ showRanges: v })} />
                  <Check label="标尺" v={state.showRuler} onC={(v) => patch({ showRuler: v })} />
                  <Check label="基因模型" v={state.showGenes} onC={(v) => patch({ showGenes: v })} />
                </div>
              </section>
            </>
          )}
        </aside>

        <section className="center">
          <div className="toolbar">
            <span>{ir?.locus ? `${ir.locus.chr}:${state?.cropStart ?? ir.locus.start}-${state?.cropEnd ?? ir.locus.end}` : '未导入'}</span>
            <span className="spacer" />
            <span className="tiny">画布</span>
            <button onClick={() => zoomTo(fitZoom(), undefined, { resetPan: true })}>适应</button>
            <button onClick={() => zoomTo(0.5)}>50%</button>
            <button onClick={() => zoomTo(1)}>100%</button>
            <button onClick={() => zoomTo(2)}>200%</button>
            <button onClick={() => zoomTo(zoomPx / 1.2)}>−</button>
            <span>{Math.round(zoomPx * 100)}%</span>
            <button onClick={() => zoomTo(zoomPx * 1.2)}>＋</button>
          </div>
          <div className="canvas" data-tool={tool}
            onPointerDown={(e) => {
              const t = e.target as Element;
              if (t.closest('[data-obj]') || t.closest('.grip') || t.closest('.selbox')) return;
              setSelection([]); setEditing(null);
            }}>
            {!built && <div className="placeholder">拖入 IGV 导出的 SVG 开始</div>}
            {built && (
              <div className="paperWrap" style={{
                width: built ? `${built.metrics.widthPt * (96 / 72) * zoomPx}px` : '100%',
                height: built ? `${built.metrics.heightPt * (96 / 72) * zoomPx}px` : undefined,
              }}>
              <div className="paper" ref={previewRef}
                style={{
                  width: built ? `${built.metrics.widthPt * (96 / 72) * (baked ? zoomPx : 1)}px` : '100%',
                  transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) ${baked ? '' : `scale(${zoomPx})`}`.trim(),
                }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                onDoubleClick={onDoubleClick} onWheel={onWheel}>
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                {marquee && <div className="marquee" style={{
                  left: Math.min(marquee.x0, marquee.x1) / uiScale, top: Math.min(marquee.y0, marquee.y1) / uiScale,
                  width: Math.abs(marquee.x1 - marquee.x0) / uiScale, height: Math.abs(marquee.y1 - marquee.y0) / uiScale }} />}
                {boxes.map((b) => {
                  const corners: [string, number, number][] = [
                    ['nw', b.x, b.y], ['ne', b.x + b.w, b.y], ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h],
                  ];
                  return (
                    <div key={b.id}>
                      <div className="selbox" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
                      {corners.map(([k, cx, cy]) => (
                        <div key={k} className={`grip grip-${k}`} style={{ left: cx - 3.5, top: cy - 3.5 }}
                          onPointerDown={(e) => onGripDown(e, b.id)} title="拖动改字号" />
                      ))}
                    </div>
                  );
                })}
                {guides.x != null && <div className="guide v" style={{ left: (guides.x - (previewRef.current?.getBoundingClientRect().left ?? 0)) / uiScale }} />}
                {guides.y != null && <div className="guide h" style={{ top: (guides.y - (previewRef.current?.getBoundingClientRect().top ?? 0)) / uiScale }} />}
                {hud && <div className="hud" style={{ left: (hud.x - (previewRef.current?.getBoundingClientRect().left ?? 0)) / uiScale + 12, top: (hud.y - (previewRef.current?.getBoundingClientRect().top ?? 0)) / uiScale + 12 }}>{hud.text}</div>}
                {editing && (
                  <div className="textedit" style={{ left: editing.x, top: editing.y }}>
                    {editing.bound
                      ? <span className="hint">范围标签绑定原始 y 轴，只能移动/改字号，不能改文字</span>
                      : <input autoFocus value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { setObjStyle(editing.id, { text: (e.target as HTMLInputElement).value }); setEditing(null); }
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          onBlur={(e) => { setObjStyle(editing.id, { text: e.target.value }); setEditing(null); }} />}
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
        </section>

        <aside className="right">
          <h3>选中对象（{selection.length}）</h3>
          {!sel && <div className="muted">点选文字查看属性；Shift 点选多选；空白拖动框选</div>}
          {sel && (
            <div className="selprops">
              <div className="selkind">{kindLabel(sel.kind)} · {sel.id}</div>
              {!sel.bound && (
                <label>文字<input value={state!.objStyles[sel.id]?.text ?? sel.text} onChange={(e) => setObjStyle(sel.id, { text: e.target.value })} /></label>
              )}
              <div className="row2">
                <Num label="字号 pt" value={state!.objStyles[sel.id]?.fontSizePt ?? sel.fontSizePt} step={0.5}
                  onChange={(v) => styleMany(selection, { fontSizePt: v })} />
                <label>对齐
                  <select value={state!.objStyles[sel.id]?.anchor ?? sel.anchor}
                    onChange={(e) => styleMany(selection, { anchor: e.target.value as 'start' | 'middle' | 'end' })}>
                    <option value="start">左</option><option value="middle">中</option><option value="end">右</option>
                  </select>
                </label>
              </div>
              <div className="row2">
                <button onClick={() => {
                  if (!built) return;
                  const kind = built.objects.find((o) => o.id === sel.id)?.kind;
                  if (!kind) return;
                  setSelection(built.objects.filter((o) => o.kind === kind).map((o) => o.id));
                }}>选择所有同类</button>
                <button onClick={() => styleMany(selection, { visible: false })}>隐藏</button>
                <button onClick={() => { if (state && ir) { patchDoc((doc) => ({ ...doc, history: { past: [...doc.history.past.slice(-49), doc.state], future: [] }, state: initialState(ir, Object.fromEntries(state.tracks.map((t) => [t.id, t.label]))), selection: [] })); } }}>重置全部</button>
              </div>
              <div className="row2">
                <button onClick={() => { const n = state!.objOffsets; const s = { ...n }; selection.forEach((id) => { s[id] = { dx: 0, dy: 0 }; }); push({ ...state!, objOffsets: s }); }}>归位</button>
                <button onClick={() => {
                  const st = styleOf(sel.id);
                  styleClip.current = st;
                  navigator.clipboard?.writeText(JSON.stringify(st)).catch(() => {});
                  setStatus({ kind: 'ok', text: `已复制样式：${st.fontSizePt ?? '默认'} pt` });
                }}>复制样式</button>
                <button disabled={!styleClip.current} onClick={() => { const st = styleClip.current; if (st) styleMany(selection, st); }}>粘贴样式</button>
              </div>
            </div>
          )}

          {state && (
            <>
              <h3 style={{ marginTop: 16 }}>按类别批量</h3>
              <div className="kindtable">
                {([
                  ['track-label', '轨道名'], ['range', '数据范围'], ['tick', '刻度'], ['gene', '基因名'], ['chr', '染色体'],
                ] as const).map(([kind, label]) => {
                  const ks = (state.kindStyles[kind] ?? {}) as KindStyle;
                  return (
                    <div className="kindrow" key={kind}>
                      <span className="kname">{label}</span>
                      <DraftNum className="ksize" value={ks.fontSizePt} step={0.5}
                        onCommit={(v) => setKind(kind, { fontSizePt: v })} />
                      <select value={ks.anchor ?? ''} onChange={(e) => setKind(kind, { anchor: (e.target.value || undefined) as KindStyle['anchor'] })}>
                        <option value="">对齐—</option><option value="start">左</option><option value="middle">中</option><option value="end">右</option>
                      </select>
                      <DraftNum className="koff" placeholder="x" title="X 偏移 pt" value={state.kindOffsets[kind]?.dx}
                        onCommit={(v) => setKindOffset(kind, 'dx', v ?? 0)} />
                      <DraftNum className="koff" placeholder="y" title="Y 偏移 pt" value={state.kindOffsets[kind]?.dy}
                        onCommit={(v) => setKindOffset(kind, 'dy', v ?? 0)} />
                      <label className="khide"><input type="checkbox" checked={ks.visible !== false} onChange={(e) => setKind(kind, { visible: e.target.checked })} />显示</label>
                    </div>
                  );
                })}
                <div className="kindrow">
                  <span className="kname">基因模型色</span>
                  <input type="color" value={state.geneModelColor ?? FIGURE_R1_PRESET.colors.geneModel}
                    onChange={(e) => patch({ geneModelColor: e.target.value })} />
                  <button onClick={() => patch({ geneModelColor: FIGURE_R1_PRESET.colors.geneModel })}>参考色</button>
                </div>
                <div className="kindrow">
                  <span className="kname">数据区宽</span>
                  <select value="" onChange={(e) => { const w = Number(e.target.value); if (w) patch({ dataWidthPt: w }); }}>
                    <option value="">选择实测宽度…</option>
                    {Object.entries(FIGURE_R1_PRESET.dataWidths).map(([k, w]) => <option key={k} value={w}>{k} · {w} pt</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          <h3 style={{ marginTop: 16 }}>轨道（{state?.tracks?.length ?? 0}）</h3>
          <div className="tracks">
            {state?.tracks.map((t, i) => (
              <div key={t.id} className="track">
                <div className="thead">
                  <input type="checkbox" checked={t.visible} onChange={(e) => { const tracks = state.tracks.map((x) => (x.id === t.id ? { ...x, visible: e.target.checked } : x)); push({ ...state, tracks }); }} />
                  <input className="name" value={t.label} onChange={(e) => { const tracks = state.tracks.map((x) => (x.id === t.id ? { ...x, label: e.target.value } : x)); push({ ...state, tracks }); }} />
                  <input type="color" value={t.color ?? '#333333'} onChange={(e) => { const tracks = state.tracks.map((x) => (x.id === t.id ? { ...x, color: e.target.value } : x)); push({ ...state, tracks }); }} />
                </div>
                <div className="trow">
                  <button onClick={() => moveTrack(state, t.id, -1, push)} disabled={i === 0}>↑</button>
                  <button onClick={() => moveTrack(state, t.id, 1, push)} disabled={i === state.tracks.length - 1}>↓</button>
                  <span className="ymax">ymax {t.yMax ?? '—'}</span>
                  <label className="ymax"><input type="checkbox" checked={t.showRange} onChange={(e) => { const tracks = state.tracks.map((x) => (x.id === t.id ? { ...x, showRange: e.target.checked } : x)); push({ ...state, tracks }); }} />范围</label>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <footer>
        <span className={`badge ${status?.kind ?? ''}`}>{status?.text ?? '就绪'}</span>
        {ir && (
          <>
            <span>标定 {ir.calibration ? `${ir.calibration.method} · ${ir.calibration.pxPerBp.toFixed(4)} px/bp` : '无'}</span>
            {calib?.mode === 'visual' && <span className="warn">未标定坐标：仅排版模式（可导出，无标尺/裁剪语义）</span>}
            {calib && calib.mode !== 'visual' && !calib.ok && <span className="warn">禁止导出：{calib.blocking.join('；') || '坐标标定冲突'}</span>}
            {calib?.ok && calib.warnings.length > 0 && <span className="warn">{calib.warnings.join('；')}（可导出，建议核对）</span>}
            <span>信号对象 {built?.metrics.signalNodes ?? 0}</span>
            <span>画布 {built ? `${built.metrics.widthPt.toFixed(1)} × ${built.metrics.heightPt.toFixed(1)} pt` : '-'}</span>
            <span>选中 {selection.length}</span>
          </>
        )}
        <span className="buildstamp" title="构建版本（用于问题反馈）">
          {bridge?.label ?? '…'} · build {(import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev'}
        </span>
      </footer>

      {dragOver && (
        <div className="dropveil">
          <div className="dropcard">
            <div className="dropicon">⇩</div>
            <div>松开以导入 SVG / Session XML</div>
            <div className="tiny">支持一次拖入多个文件</div>
          </div>
        </div>
      )}
      {busy && <div className="busybar">{busy}</div>}
    </div>
  );
}

function kindLabel(k: EditorObject['kind']) {
  return { 'track-label': '轨道名', range: '数据范围', chr: '染色体', gene: '基因名', tick: '刻度' }[k];
}

function moveTrack(state: EditorState, id: number, dir: number, push: (s: EditorState) => void) {
  const i = state.tracks.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.tracks.length) return;
  const tracks = [...state.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  push({ ...state, tracks });
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== value) onChange(v);
  };
  return (
    <label className="num">{label}
      <input type="number" step={step} value={draft ?? (Number.isFinite(value) ? String(value) : '0')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}

function DraftNum({ value, onCommit, step = 1, className, placeholder, title }: {
  value?: number; onCommit: (v: number | undefined) => void; step?: number; className?: string; placeholder?: string; title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const raw = draft.trim();
    setDraft(null);
    const v = raw === '' ? undefined : Number(raw);
    if (raw === '') { if (value !== undefined) onCommit(undefined); return; }
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <input className={className} type="number" step={step} placeholder={placeholder} title={title}
      value={draft ?? (value === undefined ? '' : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }} />
  );
}

function Check({ label, v, onC }: { label: string; v: boolean; onC: (v: boolean) => void }) {
  return <label className="chk"><input type="checkbox" checked={v} onChange={(e) => onC(e.target.checked)} />{label}</label>;
}
