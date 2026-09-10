# Findings (measured, 2026-09-10)

All numbers come from live runs against real Commons files with headless Chromium, in this repo
(`tests/fidelity.mjs`, `tests/corpus.mjs`, `tests/roundtrip.mjs`) — not estimates.

## 1. The infrastructure question: can a browser write to Commons at all?

| Question | Answer | How it was verified |
|---|---|---|
| Can a page read a Commons file's *source*? | **Yes** | `upload.wikimedia.org` serves `access-control-allow-origin: *`; the browser fetched raw SVG bytes for every test file |
| Can a page POST an OAuth-authenticated upload? | **Yes, with a caveat** | `OPTIONS .../api.php?action=upload&crossorigin=` returned `access-control-allow-headers: authorization,content-type`, `allow-methods: POST, GET, HEAD`; a real multipart `action=upload` POST with an invalid bearer reached Wikimedia and was refused *by Commons* (`Jwt is not in the form of Header.Payload.Signature…`) |
| The caveat | **`origin=*` and `crossorigin` must not be combined** | Both work alone; together the request fails in-browser while `curl` gets a clean preflight. (Manual:CORS documents `crossorigin` for OAuth, `origin=*` for anonymous.) |
| Cookie sessions? | **Impossible cross-origin** | `access-control-allow-credentials: false` on every API response; OAuth bearer is the only browser path |
| Conflict detection | **Client-side, sound** | `prop=imageinfo` `sha1` equals SHA-1 of the raw bytes (verified on `File:Flag of Japan.svg`), so a re-fetch before saving is a real guard |

Consequence: a static single-page app is a viable shell for a Commons SVG editor; no server, no proxy, no
Toolforge webservice is required for v1. The only blocker to a live save is an OAuth consumer registration.

## 2. Round-trip fidelity of SVG-Edit 7.4.2 (the engine inside the prototype)

Measured on six real files (209 B → 2.4 MB), browser-render pixel comparison at 600 px, source vs saved file:

| File | definitions rewritten | corrupted | non-finite values | pixel diff, raw save | after definition + framing preservation |
|---|---|---|---|---|---|
| Flag of Japan | 0 | 0 | 0 | 0% | 0% |
| Flagellum diagram (124 KB) | 16 | 0 | 0 | 1.68% | **0.06%** |
| Egypt map (849 KB) | 0 (3 markers dropped, unreferenced) | 0 | 0 | 0.07% | 0.07% |
| BlankMap-World (1.1 MB) | 1 | 0 | 0 | 0% | 0% |
| Blood-cells diagram (57 KB, i18n) | 2 | 0 | 0 | **57.99%** | **1.64%** |
| Subduction map (2.4 MB) | 261 of 264 | 3 | 12 | **39.23%** | **3.79%** |

Two defects explain nearly all of it:

1. **`viewBox` is dropped** (and CSS units stripped from `width`/`height`). When the viewBox origin is not
   `0 0` — or when there is no `width`/`height` at all — the drawing is silently reframed. This is the single
   largest silent-damage risk found.
2. **Definitions are regenerated.** `gradientUnits="userSpaceOnUse"` and `gradientTransform` are discarded and
   coordinates re-expressed relative to the bounding box; with a degenerate transform the arithmetic produces
   literal `x1="Infinity"`, which no renderer accepts.

Also structural, not visual: merely loading a file wraps content in `<g class="layer">` and assigns ids, so a
save with no edits is still a source-level change — which Commons' norms discourage. Hence the no-op guard.

## 3. Corpus run (17 files, 11.4 MB) — defect sizes

| Symptom | Worst measured | File |
|---|---|---|
| Namespace resurrection (my repair layer restored `inkscape:` attributes without the declaration → invalid XML) | **4 of 17 files failed to render** | Little Moreton Hall, Bergen County, Languages-Europe, Ukraine map |
| Embedded raster (data-URI) inside SVG | **93.8%** pixel change | Leonardo da Vinci monument in Milan |
| Pattern + filter + feGaussianBlur (data graphic) | **10.0%** | Pittsburgh newspaper consolidation timeline |
| `textPath` — the one feature librsvg cannot render at all | **8.1%** | SVGtextPath01 |
| CSS `<style>` + class-based styling | **6.8%** | Logo of IAB |
| Load time pathology | **17.9 s for a 121 KB file** (vs 1.4 s for a 2.4 MB map) | MCM Margolin |
| Everything else | 0–5% | — |

The namespace failure was a bug in this repo's repair layer, not in SVG-Edit; it is fixed (namespace
declarations are now treated as framing metadata and copied from the source), and the affected files dropped to
**0.03–0.08%**. It is kept in this list because the failure mode — restoring bytes from two documents without
restoring the declarations they depend on — is exactly the class of bug an acceptance suite exists to catch.

## 4. Open questions

- Is the residual 1.6–3.8% acceptable? A browser render is not the authoritative one: Commons renders with
  **librsvg**, so the honest check is the thumbnail after a real (human-driven) upload, at several sizes.
- Do filters and patterns need source-preservation too, or is SVG-Edit's regeneration faithful for them?
  10% on one chart suggests not — needs attribution work.
- The embedded-raster case (93.8%) is unexplained and should be triaged before anyone claims the tool handles
  "diagrams with images".
- Corpus growth needs throttled sampling: 25 of 368 candidates could be feature-profiled before Commons
  rate-limited the burst.
