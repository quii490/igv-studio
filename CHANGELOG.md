# Changelog

## 2.0.1 — 2026-11-14

**Fixed**
- Imported tracks reported `color = null`: the colour histogram was read from cloned
  wrapper `<g>` nodes instead of the source histogram bars. Source colours (attribute
  or inline `style`) are now resolved through the ancestor chain and normalised to `#rrggbb`.
- Recolouring a track could be silently overridden by a nested `fill` or inline
  `style="fill:…"`. Bars are now recoloured at the shape itself; axes, baselines and
  gene models keep their own paint.
- An SVG that parses but has no recognisable signal tracks no longer produces a blank
  editor: the original drawing is shown read-only with a diagnostic banner, and
  “Export SVG” saves the untouched original.

**Added**
- Import diagnostics: element counts (rect / path / text / image / foreignObject),
  track and bar counts, and the reason for unsupported files, shown in the banner and
  logged once per import.


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
