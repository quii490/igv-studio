import type { EditorState } from './types';
import { DEFAULT_EDIT } from './engine';

/**
 * Measured from FigureR1(1).ai (PDF vector content, 2026-11-11 third audit).
 * Per-locus data widths differ: one fixed 101.7 cannot reproduce all six.
 */
export const FIGURE_R1_PRESET = {
  name: 'FigureR1 (measured)',
  values: {
    namePt: 5, rangePt: 4, tickPt: 5, genePt: 6, chrPt: 6,
    strokePt: 0.25, rowPitchPt: 8.123,
    fontFamily: 'Arial',
  },
  colors: {
    IgG: '#020202', KDM5A: '#C01834', KDM5B: '#4C4C9E',
    'H3K4me3-WT': '#666767', 'H3K4me3-KO': '#F39619',
    geneModel: '#132D8A',
  },
  /** data-area widths actually measured on the six panels */
  dataWidths: {
    'A·Socs1': 101.728, 'A·Ptpn6': 117.742,
    'B·Ctsz': 125.356, 'B·Ctsl': 117.136, 'B·Ctsb': 93.297, 'B·Ctsa': 104.895,
  },
  /** two label layouts: the original is compact (ranges inside), the改良版 keeps ranges outside */
  templates: {
    exact: { rangePlacement: 'inside' as const, rangeGapPt: 0.7, labelGapPt: 1.4 },
    noOverlap: { rangePlacement: 'outside' as const, rangeGapPt: 1.8, labelGapPt: 1.4 },
  },
} as const;

export type TemplateId = keyof typeof FIGURE_R1_PRESET.templates;

export function applyPreset(base: EditorState, template: TemplateId = 'noOverlap', dataWidthPt?: number): EditorState {
  const v = FIGURE_R1_PRESET.values;
  const t = FIGURE_R1_PRESET.templates[template];
  const colors = FIGURE_R1_PRESET.colors;
  return {
    ...base,
    ...v,
    ...t,
    dataWidthPt: dataWidthPt ?? base.dataWidthPt,
    tracks: base.tracks.map((tr) => {
      const key = (Object.keys(colors) as (keyof typeof colors)[]).find((k) => k !== 'geneModel' && tr.label.includes(k));
      return key ? { ...tr, color: colors[key] } : tr;
    }),
  };
}

export const DEFAULT_STATE_BASE = DEFAULT_EDIT;
