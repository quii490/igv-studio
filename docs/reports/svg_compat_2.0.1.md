# SVG compatibility patch — what was merged (2.0.1)

Source: `IGV_Studio_SVG_compatibility_fix_patch.zip` (external patch, built against an older snapshot).
The patch could not be applied as-is: this repository has since been ported to the Tauri shell,
the pt-space engine and the layered renderer. Its **intent** was ported instead.

## A. Source colours were always `null` — merged

Root cause was identical here: the histogram was computed over the cloned wrapper `<g>` nodes,
and the code only counted nodes whose `localName === 'rect'`, which a `<g>` never is.

- Added `inheritedPaint()` (inline `style` first, then attribute, walking ancestors) and
  `canonicalColor()` (named / `#rgb` / `#rrggbb` / `rgb()` → `#rrggbb`) in `src/core/parser.ts`.
- Track colour is now computed from the **source** bars inside each band.
- `inherited()` also honours inline `style` for the other inherited properties.

Verified on the real fixture: previously all three tracks reported `null`, now `#0000b2`
(the colour actually inherited from the IGV export), 1,612 / 1,633 / 1,654 bars per track.

## B. Recolouring could be overridden — merged

`serializeNode()` now sets `fill` on the bar-shaped rects themselves and strips any inline
`fill:` declaration from their `style`. Axes, baselines, ruler and gene models keep their paint.
"Bar-shaped" = `0 < width ≤ 20 && height ≥ 1`; this is a deliberate heuristic, documented in code.

## C. Unsupported SVG → read-only original — merged

A file that parses but has zero tracks or zero signal objects no longer produces a blank editor:

- `StudioDoc.unsupported = { reason, rawSvg, diag }`
- the canvas shows the original drawing read-only, with a banner listing
  rect / path / text / image / foreignObject counts, tracks and thin-bar count;
- **Export SVG** saves the untouched original (`*.raw.svg`) instead of regenerating an empty figure;
- the raw preview is sanitised: `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`,
  `<image>`, `on*` attributes and non-fragment `href`s are removed.

Verified with a path-only SVG (1 rect / 1 path / 1 text, 0 tracks) and with a hostile SVG:
no script execution, no script/foreignObject/image in the preview, 0 `on*` attributes.

## D/E. Drop and export — already present, hardened

The window-level HTML5 drop already existed; it now listens in the **capture** phase so nothing
inside the app can swallow a file drop. Tauri keeps using the native `onDragDropEvent` →
`read_files` → `importPayloads` path. If the OS hands over paths that cannot be read, the status
bar now says so instead of failing silently.

Export already preferred native save dialogs; unsupported documents now use the same bridge.

## Not merged (still unsupported)

- CSS `<style>` rule sheets, `<use>` references, complex `matrix()` transforms and pattern fills:
  such files fall back to the read-only original rather than being "corrected".
- Path-based signal exporters: not classified as histogram bars, so they trigger the fallback.
- Windows smoke testing of read/save/drag: still not performed on a real Windows machine.

## Reproduction

```bash
npm test            # 14/14
npm run test:e2e    # 17/17
npm run test:edge   # unsupported fallback + visual-only + malformed input
npm run test:real   # 10/10 real mouse
```
