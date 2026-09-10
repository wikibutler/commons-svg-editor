# commons-svg-editor

Research prototype + acceptance test suite for **browser-based editing of SVG files on Wikimedia Commons** —
the "Google Drawings for Commons" question: can someone load a Commons SVG, edit it in a browser, and save it
back as a new revision, without the file being damaged in the process?

Everything here is read-only with respect to Wikimedia. The tool fetches public files anonymously and (in
principle) could save via a user's own OAuth 2.0 token; **no bot or automated account interacts with any wiki**.
See "Scope and provenance" below.

*Status: prototype, 2026-09-10. Numbers in the docs are from live runs against real Commons files, not estimates.*

## Why a test suite is part of this repo

Commons is strict about SVG because its thumbnails come from **librsvg**, not a browser, and because the
community's norm is that a re-upload should change the drawing, not its source. Any editor can *load* an SVG;
the interesting question is what it *writes back*. `corpus/SVG-ACCEPTANCE-SUITE.md` proposes the pass/fail
contract (integrity, structure, definitions, framing, text, namespaces, validity, CSS, editability, no-op guard,
visual equivalence, time budget) and this repo ships the starter corpus and a runnable harness for it.

## Layout

| Path | What it is |
|---|---|
| `docs/` | the prototype itself: a static single-page app (no server, no build step) — SVG-Edit 7.4.2 + Commons API + OAuth 2.0 PKCE |
| `corpus/SVG-ACCEPTANCE-SUITE.md` | the proposal: what exists already, what's missing, the criteria, how to grow the corpus |
| `corpus/corpus.json` | 17-file starter corpus with per-file feature profiles and the criteria each file exercises |
| `docs/FINDINGS.md` | measured findings — CORS/OAuth boundary, round-trip fidelity numbers, open defects |
| `tests/roundtrip.mjs` | load → edit → export → save-gate → upload-endpoint boundary |
| `tests/fidelity.mjs` | load → save fidelity, definition/framing drift, pixel diff |
| `tests/corpus.mjs` | the acceptance runner: scores every corpus file against the criteria |

## Running it

```bash
node tests/serve.mjs 4180          # serve the prototype on http://127.0.0.1:4180/
node tests/roundtrip.mjs           # end-to-end editor test (needs Playwright chromium)
node tests/fidelity.mjs            # fidelity measurement
node tests/corpus.mjs --limit 5    # acceptance run; add --files "File:X.svg"
```

The prototype needs no API keys. Saving to Commons needs an OAuth 2.0 consumer (client ID) registered by a
human at `Special:OAuthConsumerRegistration/propose` with the `uploadfile` + `uploadeditmovefile` grants and the
PKCE flow; the app never stores a client secret.

## Verified so far (short version)

- A static browser app **can** read a Commons SVG's source (`upload.wikimedia.org` sends CORS `*`) and **can**
  POST an OAuth-authenticated upload to the Commons API (Action API CORS needs `crossorigin`, or `origin=*` for
  anonymous requests — **never both**). Verified by reaching Wikimedia from a foreign origin with an invalid
  token: the refusal comes from Commons, not from the browser.
- SVG-Edit preserves document structure well but **drops `viewBox`** and **rewrites gradient/filter/pattern
  definitions** (including writing literal `Infinity` into 3 gradients of one map). Preserving the source's
  definitions and framing drops the measured pixel difference from **39–58% to ~1.6–3.8%** on the worst files.
- Current open defects and their measured sizes: embedded-raster SVG 93.8%, pattern/filter chart 10.0%,
  `textPath` 8.1%, CSS/class styling 6.8%, and a 121 KB file that takes 17.9 s to load.

## Scope and provenance

Built by **Hermes Agent** (Nous Research) operating the **WikiButler** automation identity, as research and
prototype work for **Andrew Lih ([[User:Fuzheado]])**. It is not a Wikimedia Foundation tool, not endorsed by
Wikimedia or the Commons community, and not affiliated with the SVG-Edit project beyond vendoring its MIT-licensed
editor.

**Deliberate constraint:** the Wikimedia community has restricted AI/bot participation, and this project respects
that by design — nothing here posts, edits, uploads, comments, or tags anything on a wiki. Any on-wiki step
(a test upload, a proposal on a village pump, a talk-page review of the criteria) is a decision for a human
editor to make and execute.

## Licence and third-party disclosure

**Read [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) first — it is not a formality here.** The vendored
editor is *not* plain MIT: SVG-Edit's package declares `(MIT AND Apache-2.0 AND ISC AND LGPL-3.0-or-later AND
X11)`, and the prebuilt bundle in `docs/vendor/svgedit/` contains code under all of those, including an
LGPL-3.0-or-later plugin. Upstream's per-file inventory (`licenseInfo.json`) and every licence text ship in
`docs/vendor/svgedit/LICENSES/`. That file also lists the development-only tools (Playwright, Chromium,
esbuild, Node) that are used but not redistributed.

- This repository's own code (`docs/*.js|css|html`, `tests/*.mjs`, `corpus/*`, the docs): **MIT** — see `LICENSE`.
- The corpus **references** Commons files by title, URL and SHA-1 and does **not** redistribute them; each
  file's own licence and attribution apply on Commons. Downloaded copies are git-ignored deliberately.
- The disclosure is not legal advice and does not certify compliance; a production deployment (especially on
  Wikimedia infrastructure) should ship a rebuildable build and get a proper licence review.
