/** Panel IR — the only thing the editing engine is allowed to read. */

export interface CanvasInfo {
  width: number;
  height: number;
  minX: number;
  minY: number;
  source: 'viewBox' | 'width_height' | 'geometry' | 'clamped';
}

export interface GenomicLocus {
  chr: string;
  start: number;
  end: number;
}

export interface Tick {
  bp: number;
  x: number;
  label: string;
}

export interface Calibration {
  /** source px per bp */
  pxPerBp: number;
  /** x_source = xAtBp0 + bp * pxPerBp */
  xAtBp0: number;
  method: 'ticks' | 'locus' | 'both' | 'manual';
  tickResidualPx: number | null;
  /** ticks-derived x(locus.start) minus gutter; |.|>1 means sources disagree */
  crossCheckPx: number | null;
  ticks: Tick[];
}

export interface NameGutter {
  x0: number;
  x1: number;
  width: number;
}

export interface GraphicLayer {
  y0: number;
  y1: number;
  nodeCount: number;
}

export interface RulerInfo {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

export interface TrackSource {
  id: number;
  /** index in the source document order */
  sourceIndex: number;
  y0: number;
  y1: number;
  height: number;
  /** label reconstructed from possibly-split <text> nodes */
  rawLabel: string;
  /** original filename-like label, if derivable */
  fileName: string | null;
  rangeText: string | null;
  yMax: number | null;
  color: string | null;
  barCount: number;
  nodes: Node[];
}

export interface GeneLabel { text: string; x: number }
export interface GeneLayer {
  y0: number;
  y1: number;
  names: GeneLabel[];
  nodes: Node[];
}

export interface Diagnostics {
  doctypeStripped: boolean;
  entityRejected: boolean;
  canvasSource: string;
  gutterConfidence: 'high' | 'low';
  tickCount: number;
  warnings: string[];
  /** element counts of the imported document, for diagnosing unsupported exports */
  counts?: { rect: number; path: number; text: number; image: number; foreignObject: number };
  signalBars?: number;
}

export interface PanelIR {
  canvas: CanvasInfo;
  locus: GenomicLocus | null;
  calibration: Calibration | null;
  name_gutter: NameGutter;
  ideogram: GraphicLayer | null;
  ruler: RulerInfo | null;
  tracks: TrackSource[];
  genes: GeneLayer | null;
  diagnostics: Diagnostics;
  dataX0: number;
  dataX1: number;
  sourceText: string;
  sourceSize: number;
  counts: { rect: number; line: number; path: number; text: number; image: number };
}

/* ---------- editable state (never touches signal geometry) ---------- */

export interface TrackEdit {
  id: number;
  label: string;
  color: string | null;
  visible: boolean;
  yMax: number | null;
  showRange: boolean;
}

export interface EditState {
  /** width of the data area in pt (reference FigureR1: 101.7) */
  dataWidthPt: number;
  rowPitchPt: number;
  topPadPt: number;
  bottomPadPt: number;
  strokePt: number;
  fontFamily: string;
  namePt: number;
  rangePt: number;
  tickPt: number;
  genePt: number;
  chrPt: number;
  gutterPt: number;
  labelGapPt: number;
  rangeGapPt: number;
  geneGapPt: number;
  showLabels: boolean;
  showRanges: boolean;
  showRuler: boolean;
  showGenes: boolean;
  showBaselines: boolean;
  cropStart: number | null;
  cropEnd: number | null;
  tracks: TrackEdit[];
}

export type ObjKind = 'track-label' | 'range' | 'chr' | 'gene' | 'tick';

/** A semantic, selectable object. Signals are never exposed as individual objects. */
export interface EditorObject {
  id: string;
  kind: ObjKind;
  text: string;
  /** base position in user units, before per-object offsets */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  fontSizePt: number;
  trackId?: number;
  locked: boolean;
  /** true when the text is bound to data (range labels) and must not be edited */
  bound: boolean;
}

export interface ObjOverride {
  text?: string;
  fontSizePt?: number;
  anchor?: 'start' | 'middle' | 'end';
  visible?: boolean;
  color?: string;
}

export interface KindStyle {
  fontSizePt?: number;
  anchor?: 'start' | 'middle' | 'end';
  visible?: boolean;
  color?: string;
}

export interface EditorState extends EditState {
  /** per-object offset in pt */
  objOffsets: Record<string, { dx: number; dy: number }>;
  objStyles: Record<string, ObjOverride>;
  /** where `[0 - max]` lives: outside the plot (default) or just inside it */
  rangePlacement: 'outside' | 'inside';
  /** category-level styles: preset -> kind -> object */
  kindStyles: Partial<Record<ObjKind, KindStyle>>;
  /** category-level position offsets (pt) */
  kindOffsets: Partial<Record<ObjKind, { dx: number; dy: number }>>;
  /** paint for the gene model layer (kept apart from signal colours) */
  geneModelColor: string | null;
}

export type Tool = 'select' | 'pan' | 'crop';

export interface BuildMetrics {
  k: number | null;
  /** vertical pt per source unit (constant across zoom) */
  ky?: number | null;
  topPadPt?: number;
  viewBox: [number, number, number, number] | null;
  widthPt: number;
  heightPt: number;
  dataLeftUnits: number;
  cropUnits: number;
  pitchUnits: number;
  trackCount: number;
  signalNodes: number;
  textNodes: number;
  fontSizesPt: number[];
  clippedTracks: number[];
}
