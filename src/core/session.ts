/**
 * IGV Session XML adapter.
 *
 * A session file carries *configuration* only (data paths, colours, y ranges,
 * track order, current locus) — no geometry. It therefore cannot be turned into
 * an SVG inside the browser; it is used to (a) prefill labels/colours/order and
 * (b) generate an IGV batch script that renders the SVGs.
 */
export interface SessionTrack {
  index: number;
  name: string;
  fileName: string | null;
  color: string | null;
  yMax: number | null;
  path: string | null;
}

export interface SessionInfo {
  genome: string | null;
  locus: string | null;
  tracks: SessionTrack[];
  warnings: string[];
}

const num = (v: string | null): number | null => {
  const x = parseFloat(v ?? '');
  return Number.isFinite(x) ? x : null;
};

export function parseSession(xml: string): SessionInfo {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Session XML 解析失败');
  const root = doc.documentElement;
  if (root.localName !== 'Session') throw new Error('不是 IGV Session 文件（根节点应为 <Session>）');

  const warnings: string[] = [];
  const tracks: SessionTrack[] = [];
  doc.querySelectorAll('Track').forEach((el) => {
    const name = el.getAttribute('name') ?? '';
    if (!name) return;
    const clazz = el.getAttribute('clazz') ?? '';
    if (clazz && !clazz.includes('DataSourceTrack')) return; // 只取数据轨道
    const id = el.getAttribute('id') ?? '';
    const base = id.split(/[\\/]/).pop() ?? '';
    const range = el.querySelector('DataRange');
    const color = el.getAttribute('color');
    tracks.push({
      index: tracks.length,
      name,
      fileName: base || null,
      color: color ? `rgb(${color})` : null,
      yMax: range ? num(range.getAttribute('maximum')) : null,
      path: base || null,
    });
  });

  if (!tracks.length) warnings.push('Session 里没有找到数据轨道（DataSourceTrack）');
  const locus = root.getAttribute('locus');
  if (!locus || !/^chr[\w.]+:\d+-\d+/.test(locus)) warnings.push('Session 的 locus 不是精确区间');

  return { genome: root.getAttribute('genome'), locus, tracks, warnings };
}

/** IGV batch script that renders one SVG per locus. Paths must be filled by the user. */
export function batchScript(session: SessionInfo, loci: string[], snapshotDir = './svg_out'): string {
  const lines: string[] = [];
  lines.push('# IGV 2.19.8 · Tools > Run Batch Script');
  lines.push('# 1) 把 <SESSION_XML> 换成你的 session 文件绝对路径');
  lines.push('# 2) snapshotDirectory 换成可写目录');
  lines.push(`snapshotDirectory "${snapshotDir}"`);
  lines.push('new');
  if (session.genome) lines.push(`genome ${session.genome}`);
  lines.push('load "<SESSION_XML>"');
  lines.push('maxPanelHeight 900');
  for (const l of loci) {
    const name = l.replace(/[:,\s]+/g, '_');
    lines.push('');
    lines.push(`goto ${l}`);
    lines.push(`snapshot ${name}.svg`);
  }
  return lines.join('\n') + '\n';
}
