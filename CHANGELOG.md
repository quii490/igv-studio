# Changelog

## 2.0.0 — 2026-11

Tauri 2 desktop rewrite, sharing the same React frontend and SVG engine.

**Added**
- Native desktop apps (macOS arm64/x64, Windows x64) with system file dialogs and drag-and-drop.
- Multi-document workspace: import many SVGs, switch documents, per-document undo history.
- Batch export to ZIP with a manifest that records calibration and a re-parse check.
- Category-level styling and X/Y offsets (track names, ranges, ticks, genes, chromosome).
- FigureR1 measured presets, “exact” and “no-overlap” range layouts.
- Visible build stamp in the footer.

**Changed**
- Track-name mapping is no longer hard-coded: the import panel has a persistent mapping box, and the built-in rules were removed.

**Fixed**
- “Fit” kept shrinking the canvas (measured the scaled wrapper instead of the viewport).
- Zoomed view looked blurry (rasterised at layout size; now re-rasterises after the gesture settles).
- Ruler tick labels could not be selected.
- Selection overlay went stale after zooming; clicking empty canvas did not clear the selection.
- Inline text edit committed a stale value when confirming with Enter.

**Notes**
- Builds are unsigned: macOS Gatekeeper and Windows SmartScreen require one manual approval.
- FigureR1 presets follow the measured reference; signal geometry is never redrawn.

## 1.x — Electron era

Single-file HTML editor plus an Electron shell. Superseded by 2.0.0; kept on the `electron` branch for reference.
