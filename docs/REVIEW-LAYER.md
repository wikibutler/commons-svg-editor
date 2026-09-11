# Epic C: the review layer, measured on real Commons history

*2026-09-11. Code: `docs/review/lib/{svg-patch,svg-tree,svg-diff}.mjs` (the same modules the browser UI loads).
UI: `docs/review/` → https://wikibutler.github.io/commons-svg-editor/review/ . Measurement: `tests/review.mjs`
(+ `tests/verify-review.mjs` for the browser end-to-end run). Data: `review-cache/pairs.json`,
`test-results/review.json`.*

## What it does

Given two revisions of a Commons SVG it answers the three questions a reviewer actually has:

1. **What changed**, grouped the way a Commons editor thinks: geometry, colour/style, text and translations,
   definitions, framing, editor metadata, structure.
2. **How much of the file moved** — source churn — which is what decides whether an overwrite is reviewable at all
   under COM:OVERWRITE or is really a new file.
3. **Whether known-damaging patterns are present**: metadata stripped, translations lost, definitions rewritten,
   text converted to paths, a minification pass, a whole-file reserialisation, framing changed.

It also runs preliminary source checks (missing viewBox, scripts, `flowRoot`, embedded raster, external URLs,
`<switch>` usage). Churn counts elements **added, removed, or whose attributes/text actually changed**; path
reflow caused by inserting a group is *not* churn (that bug made an early version report 90% churn where the real
figure was 2%).

## Result: 12 real Commons revision pairs (newest two revisions each, SHA-1 verified)

| verdict | pairs |
|---|---|
| targeted edit (small, reviewable) | 2 |
| moderate edit | 2 |
| **whole-file rewrite** | **8** |

Sample of the eight rewrites, with what the engine said about them:

- **Steinwiesen in KC.svg** (2025-12-30, "upd") — *"Translation blocks lost: `<switch>` 1 → 0"*, *"tspan runs 29 → 0"*
  (all text converted to paths: translatability gone), *"viewBox 2183.167 117.481 456.333 555 → 0 0 456.333 555"*
  (the drawing's coordinate origin reset), file 49.5% smaller.
- **Gold Star (with border).svg** — *"slimmed down with svgomg"*: −29.3%, `style` attributes gone, namespaces gone,
  `width`/`height` dropped. The exact case Glrx objects to on COM:SVGOPT grounds.
- **Tuvalu / Sweden Product Exports** — regenerated charts (~90% churn, −11.6% and −17.5%).
- **Seal of Kansas.svg** — moderate (2.1% churn) but *"Text elements 4 → 0"* and framing nudged.
- **Gold Star Medal of Azerbaijan.svg** — a genuinely targeted edit: one `style` text change
  (`fill:#FFDD55` → `fill:#F7D163`), 0.6% churn.

So the measured answer to "are editor-generated overwrites reviewable as small diffs?" is **no, mostly not**: 8 of 12
are whole-file rewrites, and in at least two of them real damage (lost translations, lost text, moved origin,
stripped metadata) sits inside a diff no human can read.

## Engineering findings from building it

- **Revision fetching must be verified.** `imageinfo` returns the current file URL for the newest revision and an
  archived URL for older ones; one download returned bytes whose SHA-1 did not match the revision's — so the tool
  now verifies SHA-1 on download and refuses to build a diff on unverified bytes. (First version reported two
  different revisions as "byte-identical" because of this.)
- **Archive URLs have no filename segment** (`/archive/a/a6/20251230…!Name.svg`); the older three-segment form 404s.
- **ES modules need `text/javascript`**: a dev server missing a `.mjs` MIME entry makes the page look broken
  (Chrome: *"Expected a JavaScript-or-Wasm module script"*). Also beware stale servers on a fixed port.
- **CORS works anonymous**: Action API with `origin=*` + `upload.wikimedia.org` (`ACAO: *`) means the review tool
  needs no server, no account and no token — it is a static page.

## Status

C1 (structure-aware diff), C2 (preservation facts per pair) and C4 (browser UI on real Commons history) are done.
C3 (validator checklist) is partial: the preliminary source checks exist, but they are not yet aligned
line-by-line with Commons SVG Checker / COM:SVGOPT.
