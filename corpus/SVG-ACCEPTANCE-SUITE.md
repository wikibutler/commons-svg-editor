# A Commons SVG acceptance suite: what exists, what's missing, and a starter corpus

*Draft for discussion — assembled 2026-09-10 by Hermes Agent (prototype work for Andrew Lih / WikiButler). All numbers below are from live runs against Commons files unless marked otherwise.*

## 1. Answer first: does it exist already?

**For renderers: yes, quite a lot. For editors: no — nobody has defined one.**

What the community already has (verified live, 2026-09-10):

| Artefact | What it is | Gap for our question |
|---|---|---|
| [`User:JoKalliauer/SVG test suites`](https://commons.wikimedia.org/wiki/User:JoKalliauer/SVG_test_suites) | The most serious existing work: scores **librsvg 2.50, resvg 0.14, Inkscape 1.0, Batik 1.13** against the **W3C test suite**, the **resvg test suite**, and **Wikimedia's own featured vector pictures**; includes CPU time and solved-Phabricator-task ratios. Sub-pages: `/all_Images`, `/Featured_details` (per-file rendering differences with `vdiff`). | It measures **rendering correctness** of a renderer. It says nothing about what happens when a tool *writes* a file back. |
| [`Category:Pictures showing a librsvg bug`](https://commons.wikimedia.org/wiki/Category:Pictures_showing_a_librsvg_bug) | 75 files directly in the category plus sub-categories (unsolved, flowRoot exception, feGaussianBlur, by producer: Inkscape/Adobe/HandSVG/ArcMap…) — a **curated corpus of hard files**, each tagged with `{{Rsvg bug}}` | Curated for "does it render", not "does a tool preserve it". Different failure direction. |
| [`Commons:Commons SVG Checker`](https://commons.wikimedia.org/wiki/Commons:Commons_SVG_Checker) + `/KnownBugs` | A live checker (JS: `MediaWiki:CommonsSvgChecker.js`) encoding known librsvg bugs and pointing at specific test files (`File:SVG Gradient.svg`, `File:SVG Test TextAlign.svg`, …) | Validation/warning tool. No pass/fail contract for tools. |
| [`Librsvg bugs`](https://commons.wikimedia.org/wiki/Librsvg_bugs) | The community's bug ledger: `textPath` unsupported, multi-valued `x`/`y` text placement (T35245), `systemLanguage` multilingual regression (T261192), arc parsing (T217990), `image` needs width/height (T304190), `clipPath` may not contain `<g>`… | Perfect **content** for a test suite; not organised as one. |
| W3C SVG 1.1 test suite; resvg test suite | Standards-level feature coverage, ~1000s of micro-tests | Micro-tests, synthetic; not "real file a Commons editor would touch". |
| `svgcheck` (Toolforge), `{{Valid SVG}}`/`{{Invalid SVG}}`, `Category:SVG files with errors` | Per-file validity/render diagnostics | Per-file, not a suite. |

**Nothing found that specifies what a *writing* tool (editor, converter, bot, optimizer) must preserve**, and no discussion thread doing it — searches across Commons VP/Graphics VP archives, the librsvg/SVG Phabricator work, and the tool landscape turned up renderer-focused work only. That is the gap. It is also why the current proposal in idea-backlog #13 (browser SVG editor) should not be built further without it: *"if it doesn't pass this suite, the community will predictably not accept it"* is exactly right, and the suite has to exist before the tool, not after.

## 2. Why an editor suite is a different animal

Renderer suites ask: *does feature X look right?* Editor suites must ask: **did anything change that the human did not intend?**

That has a property renderer suites lack: the answer is verifiable **without any reference image** — you compare the file to itself.
The hard criterion is **idempotence**: *load a file and save it unchanged → the bytes should be as close to the input as the format allows; feed that output back through the tool → it must be a fixpoint.* Plus: no-op saves should be **refused** on Commons (COM:OVERWRITE discourages pure source refactors), so the correct behaviour is often "don't write at all".

## 3. Proposed criteria (the actual test contract)

Each axis is pass/warn/fail. A/B/D/F/G/H/I are byte/structure checks; K is a rendered check; L is a budget.

- **A — Integrity.** File fetched and parsed; if the tool reports an sha1, it matches `prop=imageinfo`.
- **B — Structure.** Element census and group nesting preserved (a `<g class="layer">` wrapper is tolerable *if* nothing else moves).
- **C — Definitions.** `linearGradient`/`radialGradient`/`pattern`/`filter`/`clipPath`/`mask`/`marker` survive **verbatim** unless the user edited them. (Measured: SVG-Edit rewrites 261 of 264 gradients in `File:Subduction-en.svg` and, on 3 of them, writes literal `x1="Infinity"`.)
- **D — Framing.** `viewBox`, `preserveAspectRatio`, `width`/`height` preserved, including units and non-zero origins. (Measured: dropping `viewBox` reframed a map by **39%** and a diagram by **58%** of pixels.)
- **E — Text.** Text stays text; `tspan`, `<switch>`/`systemLanguage`, `flowRoot`, `textPath`, `textLength`, `xml:space` not rewritten, converted or dropped. (Measured: `textPath` file drifts 8.1%.)
- **F — Namespaces & metadata.** `inkscape:`/`sodipodi:`/`dc:`/`cc:`/`rdf:` declarations and attributes survive; **no prefix may be used without being declared** (this is the failure mode when a tool restores pieces of two documents — my own prototype hit it, see §5); no editor cruft (`se:`, `contenteditable`) added.
- **G — Validity.** No non-finite numbers (`Infinity`, `NaN`), no undefined prefixes, XML well-formed.
- **H — CSS.** `<style>` blocks and `class`-based styling preserved (librsvg supports a CSS subset; converting classes to inline attributes is a rewrite). (Measured: 6.8% pixel drift on a class-styled logo.)
- **I — Editability retained.** Not flattened into one mega-path; ids stable enough that talk-page/patch references still resolve.
- **J — No-op guard.** Saving with zero edits is refused or loudly warned.
- **K — Visual equivalence.** Pixel diff of saved file vs current revision: **≤2% pass, ≤5% warn** (browser render; the authoritative check is the Commons thumbnail via librsvg, which can only be verified by an actual upload).
- **L — Budget.** Load+export time on multi-megabyte files. (Measured pathology: one **121 KB** file took **17.9 s** to load — size is not a proxy for difficulty.)

## 4. The starter corpus

`corpus/corpus.json` — **17 files, 11.4 MB**, chosen to span the axes above. Domains: baseline flag · gradients/clipPath/mask · CSS-styled logo · textPath typography · chart/graph with pattern+filter+blur · i18n `<switch>` diagram · Inkscape `flowRoot` diagram · radial-gradient illustration · classic diagram · architectural plan (markers+filters) · two maps (markers/CSS/non-zero-viewBox; patterns/mega-path) · transit logo system (clipPath+symbol+CSS) · Egypt map (849 KB) · Subduction map (2.4 MB) · Ukraine invasion map (4.35 MB) · raster-in-SVG (data URI).

Selection was deliberate, not random: candidates came from the community's own slices (`Category:Pictures showing a librsvg bug` and its by-producer subcategories, `Images with SVG 2.0 / 1.2 features`, `SVG charts/maps/diagrams`), were profiled for features by fetching their source, and then picked to cover the matrix. Only 25 of 368 candidates could be profiled before Commons rate-limited the burst — **the corpus should be grown with that throttling in mind.**

To grow it (cheap, repeatable): category membership via `list=categorymembers`, feature targeting via CirrusSearch `insource:` (works well for `"<switch"`, `"gradientTransform"`, `"textPath"`), plus stratified sampling by byte size and by producer string (`Inkscape`, `Adobe Illustrator`, `HandSVG`, `matplotlib`, `QGIS`).

## 5. First run of the suite against SVG-Edit (the prototype)

`node tests/corpus.mjs` → `test-results/corpus-scorecard.json`. Findings, in order of severity:

1. **Namespace resurrection (my bug, fixed).** Restoring source definition blocks that carry `inkscape:stockid` on a marker, while the editor's export no longer declares `xmlns:inkscape`, produced **not-well-formed XML** on 4 of 17 files (Little Moreton Hall, Bergen County, Languages-Europe, Ukraine map). Fix: treat namespace declarations as framing metadata and copy any prefix the source declared and the export uses; verified — those files now come out at **0.03–0.08%** pixel difference. Lesson for the suite: **F must run before K**, and "restore bytes from two documents" is a distinct failure class worth its own axis.
2. **Embedded raster SVG: 93.8% pixel change** (`File:Leonardo da Vinci monument in Milan.svg`, data-URI image). Worst result in the corpus; needs a targeted look — the raster embed either does not survive or is no longer referenced.
3. **Pattern/filter/blur chart: 10.0%** (`Pittsburgh newspaper consolidation timeline`) — filter and pattern definitions are exactly the class that gets rewritten; needs attribution against a librsvg render.
4. **`textPath`: 8.1%** (`File:SVGtextPath01.svg`) — the one SVG feature librsvg cannot render at all. If a tool rewrites it, the file's meaning on Commons changes silently.
5. **CSS/class styling: 6.8%** (`File:Logo of IAB.svg`).
6. **Perf pathology: 17.9 s to load a 121 KB file** (`File:MCM Margolin.svg`) vs 1.4 s for the 2.4 MB map. Something in that file is quadratic; axis L must be per-file, not per-size.
7. **Baseline reality check:** most files round-trip at **0–1%** once definitions and framing are preserved — the problems are concentrated, not diffuse. Subduction-en (2.4 MB, 264 gradients) sits at **3.8%**; the 4.35 MB Ukraine map at **5.0%**.

The scorecard currently marks a file FAIL whenever the no-op guard, idempotence or a hard criterion trips; several of the FAILs in the last run are **harness strictness**, not tool defects (the idempotence check rebuilds pass 2 with a null baseline). Fixing the harness's own verdict logic is the next commit — an acceptance suite that mislabels failures is worse than none.

## 6. What it would take to make this real

- **Corpus**: grow 17 → ~60 files with the throttled sampler above (~1 day), freeze a copy (Commons files change!) with sha1s recorded per file — a test suite pinned to mutable URLs is not a test suite.
- **Harness**: keep it dependency-light and runnable by anyone (`node tests/corpus.mjs`, Playwright + the tool's URL as arguments). ~1 day to generalise the prototype runner into "point it at any editor URL".
- **Reference renderer**: add librsvg (`rsvg-convert`) into the harness so K is measured against the real Commons renderer, not a browser. Non-trivial on this host (no apt), trivial in a container/Toolforge CI.
- **Governance**: post the criteria + corpus to **Commons:Graphics village pump** and the `wikimedia-svg-rendering` Phabricator tag, get 2–3 SVG-fluent editors (JoKalliauer is the obvious first reviewer — they built the closest thing to this) to argue the thresholds, then link it from `Help:SVG` as "if you build a tool that writes SVGs, here is what it must not break". Community acceptance is the deliverable; the suite is the argument.
- **Then** the editor prototype can be judged by it in public — which is the only way the "Google Drawings for Commons" idea survives contact with the community.

## 7. Files in this repo

- `corpus/corpus.json` — the 17-file manifest with per-file feature profiles, domain and the axes each file exercises.
- `corpus/profiles.json`, `corpus/candidates.json` — the 368-file candidate pool and the 25 feature profiles gathered before rate limiting.
- `tests/corpus.mjs` — the acceptance runner (scorecard + incremental JSON output).
- `tests/fidelity.mjs` — the narrower load→save fidelity measurement used for §3's numbers.
- `tests/roundtrip.mjs` — the end-to-end editor test (load, edit, export, save-gate, upload-endpoint boundary).


## 8. Scale: is a Commons-wide suite too big? No — but the constraint is politeness, not size

Measured 2026-09-10 on this host, not estimated.

- **5,283,832** SVG files on Commons (`list=search&srsearch=filetype:svg` totalhits). Sampling all of them is
  neither possible nor useful; a **stratified sample of a few hundred** is both.
- **Bulk metadata is cheap.** Category membership and `imageinfo` come back 50/40 titles per request; a
  9-stratum sample of 44 files cost **9 API calls** with responses cached to disk.
- **Bulk content fetching is the limiting factor.** A 16-thread burst got rate-limited after ~25 files, and a
  paced run (2 fetches per file, ~1.1 s apart) still hit **HTTP 429 on 8 of 44 files** (all in the consecutive
  map stratum). Those records are now marked `INFRA` so a rate-limited run can never masquerade as tool failures.
- **Runtime is not the problem.** 44 files scored in roughly 4 minutes of wall clock including browser
  start/stop; per-file load times were 200–620 ms for everything up to 241 KB.
- **The fix, and the next commit:** fetch each file **once** into a local, git-ignored cache
  (`corpus/files-cache/`, keyed by sha1), then run the browser against `http://127.0.0.1/…`. That turns a run
  from *2 network fetches per file per run* into *one fetch ever*, which is both polite to Commons and makes
  results reproducible after a file changes on-wiki. Until that lands, size the sample to what one paced run
  can fetch (≈40 files here) rather than to what you would like to test.

### What the first 44-file sample says (36 scored; 8 rate-limited)

Verdicts: **16 PASS · 4 WARN · 16 FAIL** (8 INFRA). Pass rate by stratum, worst first — the failures cluster
exactly where the community's stake is highest:

- embedded-raster **0/2** · map **0/6** · multilingual **1/6** · inkscape-native **1/5** · known-hard **1/4**
- svg2-features **1/3** · diagram **3/6** · chart/graph **4/6** · icon/logo **5/6**

Worst load-and-save damage with **no user edits at all** (pixel diff, source vs saved):

- 89.68% — Tradex Logo (33 KB) · 27.65% — PAES logo · 14.85% — a household-income chart
- 8.79% / 8.71% / 7.58% — three *Wind power installed capacity* charts (same generator, same defect)
- 6.69% — the community's own `File:SystemLanguage MediaWiki internal code.svg` · 5.12% — `Languages-Europe edit`

Also newly visible at sample scale: **5 of 36 files are not idempotent** (feeding the saved file back through
the editor produces a different file), which a single-file test would never have surfaced.
