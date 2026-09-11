# Epic A prototype: the surgical core, measured

*2026-09-11. Code: `surgical/svg-patch.mjs`, measurement: `tests/surgical.mjs`, render check:
`tests/verify-surgical.py`. Raw results: `test-results/surgical.json`.*

## The claim under test

An editor does not have to parse a file into a model and write it back. It can treat the file as text, address one
construct, and splice exactly that construct — so everything else is byte-identical by construction, not by
repair. That is the architecture the research identified as the only one with a published precedent
(Parsoid's selective serialization; LibCST/Roslyn; Grida's advertised byte-equal round trip).

## Result (44 cached Commons files, 36,467 elements scanned)

| Property | Result | Compare with SVG-Edit 7.4.2 (same corpus) |
|---|---|---|
| no-op save | **byte-identical 44/44** | 10/43 files visibly changed (>10% pixels) |
| one-attribute edit | applied 37/44; **15 changed bytes in every file**, incl. 2.7 MB ones | whole-file rewrite; ~90% of lines move in Inkscape's own case |
| diff as share of file | median **0.04%**, max 1.86% (on an 807-byte file) | — |
| output well-formed XML | **74/74** files checked | — |
| re-addressable after edit | 37/37 | — |

So the fidelity half of the problem is tractable and cheap. The diff is a fixed-size splice: it does not scale with
file size, which is precisely how a reviewer can tell a small edit from a rewrite.

## The finding that matters: addressing, not serialisation, is the hard part

To make an honest edit, the prototype patched "the first element carrying an `id`". Diagnosis of the 24 pairs that
rendered: **33 of 37 targets were definition or container nodes** — `<linearGradient id="a">`, `<filter>`,
`<pattern>`, `<clipPath>`, `<svg>` — not visible shapes. Editing `fill` there is inert, which is why 21 of 24
renders showed **no visible change** despite a correct, minimal, valid patch.

The lesson for the epic: `id` is not a handle on "the thing the user clicked". A real editor needs a
render-side→source-side mapping (hit-test in the canvas, then resolve to the source node). That is Epic A's next
substantive problem, and it is bounded, unlike the fidelity problem which is now largely solved.

## Known limitations, stated plainly

- **7 of 44 files have no `id`-bearing element at all** — addressing must fall back to a path/index scheme.
- **13 files could not be rendered by resvg** ("SVG has an invalid size") with only a width hint — needs a size
  resolution pass; the browser path handled these, so this is a harness limitation, not necessarily a file one.
- Geometry and structural edits are out of scope for this prototype (attributes and text nodes only).
- Text edits are byte splices and must respect XML escaping — currently the caller's responsibility.
- Pixel comparisons used **resvg**, not **librsvg** (what Commons actually renders with). Still an open item.
