import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getBridge } from './platform/bridge';
import './styles.css';

(window as unknown as { __BOOT_AT__?: number }).__BOOT_AT__ = performance.timeOrigin;
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

/**
 * Benchmark mode (Tauri): `IGV_BENCH=1 IGV_BENCH_FIXTURE=... IGV_BENCH_OUT=...`.
 * Runs the exact same window.__studioBench harness the Electron bench uses.
 */
const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? 'dev';
document.documentElement.dataset.build = BUILD_ID;

void (async () => {
  if (import.meta.env.MODE === 'production') return;   // bench/self-test harness is not shipped
  const bridge = await getBridge();
  // cold-start marker for the PoC report (Tauri only)
  if (bridge.kind === 'tauri' && (window as unknown as { __BOOT_AT__?: number }).__BOOT_AT__) {
    try { await bridge.writeDiag('/tmp/igv-tauri-boot-ts.json', JSON.stringify({ bootAt: (window as unknown as { __BOOT_AT__: number }).__BOOT_AT__, ua: navigator.userAgent })); } catch {}
  }
  const dbg = async (stage: string, extra: Record<string, unknown> = {}) => {
    if (bridge.kind !== 'tauri') return;
    try { await bridge.writeDiag('/tmp/igv-tauri-boot.json', JSON.stringify({ stage, at: Date.now(), ...extra })); } catch {}
  };
  await dbg('bridge', { kind: bridge.kind });
  if (!bridge.isDesktop || bridge.kind === 'electron') return;
  const cfg = await bridge.benchConfig().catch((e: Error) => { void dbg('bench_config_error', { message: String(e) }); return null; });
  await dbg('config', cfg ?? {});
  if (cfg?.selfTest && cfg.fixturePath && cfg.selfTestOut) {
    const read = async (p?: string) => (p ? (await bridge.readPaths([p]))[0]?.text ?? '' : '');
    const fixture = await read(cfg.fixturePath);
    const variant = await read(cfg.selfTestVariant) || fixture.replace(/([A-Za-z0-9]+)_clean/, '$1_testclean');
    const bad = await read(cfg.selfTestBad) || '<svg><rect';
    for (let i = 0; i < 240; i++) {
      if ((window as unknown as { __studioSelftest?: unknown }).__studioSelftest) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const run = (window as unknown as { __studioSelftest: (a: string, b: string, c: string) => Promise<unknown> }).__studioSelftest;
    const t0 = performance.now();
    const result = await run(fixture, variant, bad);
    const payload = { runtime: bridge.kind, ms: Math.round(performance.now() - t0), result, ua: navigator.userAgent };
    await bridge.writeDiag(cfg.selfTestOut, JSON.stringify(payload, null, 2));
    (window as unknown as { __SELFTEST__: unknown }).__SELFTEST__ = payload;
    return;
  }
  if (!cfg?.enabled || !cfg.fixturePath) return;
  const [file] = await bridge.readPaths([cfg.fixturePath]).catch((e: Error[]) => { void dbg('read_error', { e: String(e) }); return []; });
  await dbg('read', { got: !!file, name: file?.name });
  if (!file) return;
  for (let i = 0; i < 240; i++) {
    if ((window as unknown as { __studioBench?: unknown }).__studioBench) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const bench = (window as unknown as { __studioBench: (t: string, n?: string) => Promise<unknown> }).__studioBench;
  const started = performance.now();
  let result: unknown;
  try { result = await bench(file.text, file.name); }
  catch (e) { await dbg('bench_error', { message: String(e) }); return; }
  const payload = {
    runtime: bridge.kind,
    fixture: file.name,
    benchmark: result,
    wallClockMs: Math.round(performance.now() - started),
    ua: navigator.userAgent,
  };
  await dbg('bench_done', { loadMs: (result as { loadMs?: number })?.loadMs });
  if (cfg.outPath) await bridge.writeDiag(cfg.outPath, JSON.stringify(payload, null, 2));
  (window as unknown as { __BENCH_RESULT__: unknown }).__BENCH_RESULT__ = payload;
})();
