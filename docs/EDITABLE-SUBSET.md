# The editable subset, and how a click maps back to the source (Epic A2)

*2026-09-11. Code: `docs/review/lib/svg-address.mjs`. Measurement: `tests/subset.mjs` over the 44-file corpus,
render check `tests/verify-subset.py`. Raw: `test-results/subset.json`, pairs in `test-results/subset/`.*

## The problem this solves

The first working prototype edited "the first element carrying an `id`". Measured over the corpus:
**in 0 of 37 files was that element a rendered shape** — they were `<linearGradient id="a">`, `<filter>`,
`<pattern>`, `<clipPath>`, `<svg>` itself. The edits were correct, byte-minimal, valid XML, and invisible:
21 of 24 rendered pairs showed no change at all. `id` is not a handle on the thing the user clicked.

## The address

```
address = <document-order index> : <tag> : <fingerprint>
fingerprint = id  |  class=<class>  |  <parent-tag>/<tag>
```

Document order is the one thing every XML parser preserves, so the address is a direct lookup into the source
spans the surgical scanner already records. The fingerprint is verified on every resolve: if the file is not the
revision the address was minted for, the edit is **refused** rather than applied to the wrong node.

Measured: **44/44 files, 0 mismatches** between the tree walk and the raw text spans. Every element in every file
is addressable; no ids required.

## The inventory: what an editor may touch

Attribute kinds, counted by census over the corpus (36,467 elements, 108,000+ attributes):

| kind | occurrences | decision | why |
|---|---|---|---|
| `identity` (id, class) | 35,784 | refuse | changing them can break references elsewhere |
| `inline-style` (`style="…"`) | 10,866 | caution | edit the *property inside* the declaration, never re-serialise the whole attribute |
| `metadata` (inkscape:, sodipodi:, xml:, rdf:) | 9,187 | refuse | preserved verbatim; this is the data Commons wants kept |
| `filter-param` (stdDeviation, in, result, …) | 6,053 | refuse | part of a filter graph: editing one number changes output unpredictably |
| `reference` (xlink:href, clip-path, mask, marker-*, …) | 2,494 | caution | the target definition must stay byte-identical and must not be orphaned |
| `style` (fill, stroke, stroke-width, opacity, …) | 1,555 | **safe** | literal value on a rendered element: byte-minimal splice, no model needed |
| `definition-param` (gradientUnits, patternTransform, refX, orient, …) | 1,005 | refuse | gradient/marker/pattern geometry: preserve verbatim |
| `geometry` (d, points, x, y, width, transform, …) | 30,050 | safe* | a splice is faithful, but a wrong number is a drawing change a source diff will not explain |
| `conditional` (systemLanguage, requiredFeatures) | 249 | caution | changes which branch different renderers show |
| `a11y` (role, aria-*, data-*) | 12 | caution | spliceable, not visible in the drawing |
| `unknown` | 1,051 | refuse | not in the subset, preserve verbatim |

\* geometry is "safe to splice" but is not offered as a one-click edit; it needs the user to mean it.

Two hazards are encoded as rules rather than prose:

- **Cascade**: **4,595 elements across 18 files** carry a class and live in a document with a `<style>` block, so a
  presentation attribute may not be what actually paints. Those edits return *caution* with the reason, and the
  rule points at the declaration that does win (inline `style` on the element if present).
- **References**: **826 attributes** across the corpus have values of the form `url(#…)`. Editing them can orphan
  a definition, so they are caution, and the definition itself is never rewritten.

## Does the rule set pick targets a human can see?

Editing a safe style attribute on a rendered shape, verified by rendering both revisions with resvg:

- **visible-change rate: 8/13 = 62%**, against **3/24 = 13%** for the id-based heuristic.
- well-formed output: 28/28 files; byte-minimal splices: 4–16 changed bytes, median 0.10% of file; address
  re-resolvable after the edit: 14/14.

## Honest limits

- **Only 14 of 44 files had a *safe* style target** under these rules. The other 30 need a caution path (a
  declaration inside `style`, a reference-aware edit, or an explicit user decision about a definition) — that is
  what the rule set is for, and it is the honest boundary of "one-click" editing today.
- 13,143 of 36,467 elements (36%) live inside definitions: **a third of a typical Commons file is not directly
  editable**, and edits there are invisible in the drawing while affecting every referencing shape.
- Pixel comparisons used **resvg**, not **librsvg** (Commons' actual renderer); one file still fails to render with
  a width hint only. The visible-change rate is therefore indicative.
- The render-side half of the mapping (canvas click → document order) is designed but not yet wired into a UI;
  today the addresses are exercised from the corpus harness.
