export interface LabelRule { pattern: RegExp; template: string; note?: string }

/**
 * Naming rules are lab-specific, so none are built in.
 * Supply your own through the “轨道名映射” box (one `pattern => label` per line),
 * or pass rules explicitly.
 */
export const DEFAULT_RULES: LabelRule[] = [];

/** Fallback cleanup for common IGV/DeepTools file-name decorations. */
const NOISE = /(?:[_-]?clean|[_-]?filtered|[_-]?\d+bp|[_-]?rpgc|[_-]?bw)+$/i;

export function shortLabel(fileName: string, rules: LabelRule[] = DEFAULT_RULES): string {
  const base = fileName.replace(/\.\w+$/, '');
  for (const r of rules) {
    const m = r.pattern.exec(base);
    if (m) return r.template.replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
  }
  return base.replace(NOISE, '').replace(/[_-]{2,}/g, '_').replace(/[_-]+$/, '') || base;
}

export type Mapping = Record<string, string>;

export function parseMapping(text: string): Mapping {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Mapping;
  const out: Mapping = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const [a, b] = line.split(',').map((s) => s?.trim());
    if (a && b) out[a] = b;
  }
  return out;
}
