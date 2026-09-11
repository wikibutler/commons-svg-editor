# Round-trip SVG editing: landscape, root cause, and what other formats did

*Research synthesis, 2026-09-11. Six parallel literature/investigation threads; every claim carries a source.
Marked **[unverified]** where only a vendor or secondary claim exists. Our own measurements are marked **[measured]**.*

## 1. The question

Is a browser editor that edits a Wikimedia Commons SVG and rewrites **only** what the user touched (a) something
others have tried, (b) structurally impossible, or (c) the local instance of a general problem with rich document
formats? And is the root cause "SVG is underspecified"?

## 2. Verdicts

**V1 — The root cause is not underspecification of rendering; it is that SVG privileges the DOM over the text
and imposes no preservation duty on writing tools.** The spec is *precise*, even aggressively so: it defines
normative equivalence classes. But conformance is defined over a DOM, not a file form — SVG 2 §2.4: "conformance
with this specification is defined by whether the content is or can generate a conforming DOM". SVG 1.1's
conformance algorithm (G.2) *deletes* non-SVG-namespace subtrees and non-XLink attributes before validating, so
discarding `sodipodi:`/`inkscape:`/vendor data cannot make a file non-conforming. Preservation duties are bound
only to *user agents* operating in the DOM (SVG 1.1 §23.1, SVG 2 §5.11), never to generators or authoring tools
(SVG 2 §2.5.1–2.5.2, SVG 1.1 G.4 — verified as a *documented absence*). Conformance is explicitly non-binary
("not a binary matter; software may be conforming within a restricted feature set", SVG 2 §2.1) and interpreters
"are not required to interpret the semantics of all features correctly" (SVG 2 §2.5.4). Net: an editor that
destroys the source form is not violating SVG — and nothing in SVG forbids an editor from preserving bytes
verbatim either. Preservation is optional, unpoliced, and left to editor discretion.

**V2 — The PDF parallel holds at the level of architecture, not format.** The naive version ("PDF is binary and
compressed, so it can't be edited") is wrong. The real mechanisms are: (i) no canonical byte form and no document
model — a content stream is "a sequence of instructions ... interpreted and acted upon sequentially" (ISO 32000-1
§7.8.2), and the spec contains no file-level canonicalisation requirement; (ii) text is stored as font-dependent
glyph codes (§9.2.1) with embedded fonts often reduced to subsets (§9.6.4), so even inserting a character is not a
text operation; (iii) the only spec-sanctioned lossless edit is the **incremental update** — "changes shall be
appended to the end of the file, leaving its original contents intact" (§7.5.6), which is mandatory for signed
documents (§12.8, and the AppendOnly flag, §12.7.2 anticipates that a full save invalidates signatures). Ghostscript
states the rebuild case bluntly: output "is not the same as the original input ... the actual insides of the PDF
file are not the same as the original", and tells users to use a different tool if the original contents matter.
Even qpdf, which calls itself "content-preserving", "may be structurally reorganized" and *cannot write incremental
updates* (an open item in its own TODO). So the operative dichotomy everywhere is **patch vs rebuild**.
The one structural difference that matters for us: **SVG has no incremental-append mechanism**, so the equivalent
of a PDF incremental save is node-level passthrough — feasible in XML, and the property our prototype must
demonstrate. Also noted: preservation institutions classify PDF as a final-state/output format, not an authoring
format (Library of Congress FDD) — the trajectory Commons is drifting toward for SVG.

**V3 — The "no ready package exists" premise is false, but only just.** A currently developed browser SVG editor,
`@grida/svg-editor`, advertises the exact guarantee we specified: "Open + save without edits -> byte-equal output.
Comments, whitespace, attribute order, and even legacy or unknown-namespace attributes survive verbatim"
**[unverified vendor claim, v0.x/experimental]**. It has also shipped a bug of exactly our damage class — editing
one declaration inside a `style` attribute rewrote the formatting of every untouched sibling declaration
(gridaco/grida#823, fixed #868) — which shows per-attribute sub-syntax needs its own token preservation. Everything
mainstream is the other architecture: SVG-Edit's load-time **whitelist sanitizer** ("if the attribute is not in our
whitelist, then remove it"; style rewritten into presentation attributes; external hrefs stripped), Inkscape's
Plain SVG ("All objects will be reconstructed from parsed data"), Penpot ("penpot is not a SVG edition
application"), Graphite (imports SVG into its own node-graph `VectorModification` model).
**No independent measurement of open-and-save damage across SVG editors was found anywhere.** Our 43-file Commons
sample (10 files >10% different after a zero-edit save) appears to be the only quantitative data point.

**V4 — Why the failures cluster the way they do [measured].** Damage is feature-dependent, with zero pass rate for
gradients (8 files), embedded raster (5), filter/blur (9), pattern (6), markers (4), `<switch>` (7). These are not
ambiguous shorthand; they are semantics the editor's model cannot represent, so they are rebuilt from something
less expressive. That is V1 made concrete: the loss is the gap between the format's expressiveness and the tool's
model.

**V5 — Wikimedia has been here for twenty years, and the dead end is documented.** T7899 (2006, "edit SVG images
wikistyle") is the ancestor; **T40271, "Review and deploy SVGEdit extension", is still open after 14 years** — and
its recorded blocker is precisely our V4 finding: SVG-Edit "support for certain parts of the SVG1.1 specification
on which TranslateSvg relies (namely `<switch>` tags) ... the text is not editable, and the thing isn't movable".
T64562 (2014, "online tool in Wikimedia Commons to edit svg files") was closed as a duplicate of T40271.
The **2019 Community Wishlist proposal "SVG editor — a new editor for graphics — with a visual mode and a textual
mode" was archived before voting**: "this project is too big for our team". The one thing that shipped from a
wishlist was the *narrow, surgical* tool: SVG-Translate (2017 #9 → built by WMF Community Tech in 2018), which
inserts `<switch>` blocks rather than reserialising. Community expert Glrx's refusal on T134415 is on the record:
"WMF is not in the tool business, and the tool would require enormous/impossible sophistication ... we do not want
sledgehammer tools applied to SVG files ... It removes metadata that removes author and license information and may
violate license terms." Commons' written guidance today is still download → Inkscape → upload; `toolforge:svgedit`
is "an old copy of SVG-edit"; Rillke's on-wiki `SVGedit.js` is self-described as experimental and buggy; even the
official SVG Translate tool is documented as "reported as buggy. When in doubt, it is preferable to edit svg files
with a plain text editor." COM:SVGOPT states "Pure sourcecode-edits are not allowed" and that mass minimisation "is
often buggy and does generally not justify reuploading". The live WMF channel is now Wishlist **W222 / T428062**
("A set of tools for image editing directly in Wikimedia Commons", In Progress) and focus area **FA8** — raster
operations plus the existing translation tool, **not** a vector editor; W298 was declined as a duplicate.

## 3. Spec-level mechanisms (why preservation is optional)

- Conformance is DOM-based: SVG 2 §2.4; SVG 1.1 G.6 (a subtree is conforming if "once serialized to XML, is a
  Conforming SVG Document Fragment" — post-serialisation validity, never identity with the input).
- Foreign content is stripped before conformance is judged: SVG 1.1 G.2.
- No clause in SVG 1.1 or SVG 2 requires a generator/authoring tool to preserve the source form.
- Roundtripping is delegated to *foreign namespaces*, with the duty resting on the user agent in the DOM
  (SVG 1.1 §23.1, SVG 2 §5.11).
- Normative equivalence classes: presentation attribute ≡ CSS declaration (SVG 1.1 §6.4); `#f00` ≡ `#ff0000` ≡
  `rgb(255,0,0)` (CSS Color 3 §4.2.1); `use` ≡ deep clone, and the DOM "does not show the referenced element's
  contents as children" (SVG 1.1 §5.6); transform ≡ folded coordinates, nested transforms post-multiply (§7.4–7.5).
- Renderer-dependent rendering is designed in: `switch` with `systemLanguage`/`requiredFeatures`/`requiredExtensions`
  (§5.8); `baseProfile` is explicitly "metadata" with "no processing restrictions" (§5.1.2), so even a published
  "editable profile" could not constrain tools.
- Unknown SVG-namespace elements rendering as `g`/`tspan` (SVG 2 §5.3) is annotated **at risk, no known
  implementations**; SVG Native (svgwg.org) is a profile draft, not a Recommendation. SVG 2 has been a Candidate
  Recommendation since 2018-10-04 and has not advanced.
- XML's own canonicalisation cannot be the oracle: Canonical XML 1.1 §1.1 notes equivalence-if-identical-canonical-
  forms "is unachievable" because of application-specific rules (it also discards CDATA, DOCTYPE, empty-element form
  and comments by design).

## 4. The same problem in other formats, and what each ecosystem did

| Format | Round-trip status | Coping strategy |
|---|---|---|
| PDF | Not lossless without incremental update | Append-only patch (ISO 32000-1 §7.5.6); rebuild tools (Ghostscript, mutool, Acrobat optimiser) are explicitly lossy |
| HTML/WYSIWYG | Abandoned as a goal | Dreamweaver "Roundtrip HTML" (don't change unrecognised tags); TinyMCE allow-list schema (`valid_elements`); ProseMirror: model is truth, HTML is an output target; industry moved to CMS/code editors |
| OOXML | Bounded | ISO 29500-3 **MCE** — a standardised "skip what you don't understand" vocabulary (`Ignorable`, alternate content); Microsoft's stated goal was faithful representation of the legacy corpus |
| ODF | Mandated, unenforced | ODF 1.1 §1.5 says foreign elements "shall be preserved" — OOo 2.x was documented as "eating" them anyway. **A requirement without enforcement did not survive** |
| OOXML in LibreOffice | Cache-with-invalidation | "Grab bag": unrepresentable markup stored aside and restored **when the file returns to the origin format**; a LibreOffice dev states that emptying the grab bag when the shape is edited is "perfectly valid" |
| Word (fast save) | Abandoned | Incremental append + piece table was **disabled in Office 2003 SP3** (leftover bytes leaked deleted text/metadata) and removed in 2007 as corruption-prone — the *opposite* choice to PDF's |
| Wikitext/Parsoid | Solved by policy + engineering | **Selective serialization**: reuse "a corresponding substring of the source Wikitext when serializing an unmodified DOM part", explicitly to avoid "dirty diffs"; round-trip tested on 100k articles |
| CAD (DWG/DXF/STEP) | Lossy by design | Native format is master, neutral format is a one-way export; AP242 adds geometric checksums so recipients can *verify* a round trip |
| YAML/TOML/Python/C# | Solved at library level | Round-trip/CST modes: ruamel.yaml `typ='rt'` (default), tomlkit, LibCST ("Like a JPEG, the Abstract Syntax Tree is lossy. ... This tree is lossless"), Roslyn ("completely round-trippable ... even when the source text contains syntax errors") |
| Augeas (config files) | Solved by refusing | A lens defines get/put/create together so the two directions cannot drift; **Augeas refuses to write a tree that is not canonical** |

## 5. Technique catalogue (what a fidelity-preserving editor actually is)

- **CST / trivia-preserving parse** — the model *is* the syntax tree, whitespace and comments included
  (LibCST, Roslyn, tomlkit, ruamel.yaml `rt`).
- **Selective serialization** — unmodified regions re-emit their original source substring, never a regenerated
  equivalent (Parsoid; the Wikimedia-native precedent for exactly our problem).
- **Addressed patching** — operations name a node path and a new value; nothing else is touched.
- **Preserve-and-skip vocabularies** — a declared mechanism for "keep what you don't understand" (OOXML MCE).
- **Refusal instead of normalisation** — declare an editable subset and hard-error outside it (Augeas; Grida's
  documented stance).
- **Canonicalisation + measured validation** — checksums/round-trip test suites rather than promises
  (AP242 validation properties; Parsoid's 100k-article round-trip tests).
- **Preserve-as-is formatter switches** — e.g. oXygen's "Preserve text as it is / empty lines / line breaks in
  attributes" (and its opposite, "Sort attributes", as the documented non-conservative default).
- **Rendering-based regression testing** — necessary but insufficient: rendering equality does *not* imply source
  fidelity (C14N, attribute sorting and Plain SVG reconstruction all change bytes with identical pixels). Our suite
  must gate on both byte/diff-level and render-level criteria.

**Negative findings (things that do not work as often assumed):**
- Batik documents **no** preservation guarantee; its pretty printer re-serialises the whole document
  (`-no-format` preserves only indentation and doctype handling). Unknown-element survival is untested — no source.
- SVG Salamander exposes a **scene graph** (a rendering IR) — unsuitable as a persistence layer.
- `lxml.etree.xmlfile` is a *writer for incremental generation*, **not** an in-place editor of an existing file;
  and lxml's defaults are lossy (`strip_cdata=True`, `resolve_entities=True`).
- Inkscape's Plain SVG "reconstructs all objects from parsed data"; Inkscape also *regenerates* a path's `d` from
  its stored `sodipodi` data, discarding hand edits made in other editors.
- **Append-style preservation keeps deleted content recoverable** (documented for PDF incremental updates; it is
  also why Word's fast save was killed). Any Commons design must therefore be minimal-diff **rewrite**, not
  append-history — otherwise removed text and metadata linger in the file.

## 6. Dead ends, in order of how much they cost people

1. **SVG-Edit as the on-wiki editor** — T40271 open since 2012; blocked by `<switch>`/multilingual support, i.e.
   the exact content Commons most wants edited; its whitelist sanitizer deletes unknown attributes by design.
2. **WMF-built visual SVG editor** — 2019 wishlist proposal archived pre-vote ("too big for our team"); no WMF
   position statement ever issued; current WMF scope (W222/T428062/FA8) is raster editing + translation.
3. **On-wiki source editing gadgets** — Rillke's `SVGedit.js` (self-described buggy; preview broken since 2020 via
   a cross-origin redirect, T345972) and `toolforge:svgedit` ("an old copy").
4. **Optimiser/mass-fix pipelines** — Glrx's on-record objection (breaks files; strips author/licence metadata;
   "an insult to original author"); COM:SVGOPT forbids pure source-code reuploads.
5. **Byte-preserving editor as a shipped product** — Grida proves the architecture is possible; nothing else
   mainstream attempts it, and there is no independent measurement of the damage it avoids.

## 7. Options

- **A — Build the surgical editor.** Source bytes are truth; edits are addressed patches; unknown/unmodelled
  constructs are preserved verbatim and shown read-only; export is minimal-diff. Acceptance bar: **byte-equal no-op
  save** (the only falsifiable fidelity claim), plus render checks and idempotence. Precedent: Parsoid's selective
  serialization, LibCST/Roslyn, Grida (unverified), OOXML MCE conventions. Cost: we build the selection/transform
  UI ourselves; feature scope stays small. Risk: false "supported" claims reintroduce damage — the editable subset
  must be enumerated from corpus evidence.
- **B — Narrow surgical tools instead of a general editor** (the SVG Translate model): pick 2–3 high-value edit
  types (attribute/colour changes, text edits, translation insertion) and do them as targeted transforms with
  refusal elsewhere. Precedent: the only Wikimedia wishlist success. Cost: no general-purpose editor; users still
  need Inkscape for geometry.
- **C — Don't build an editor; build the missing validator/diff/review layer.** Commons has repeatedly asked for
  **source diffs for SVGs** (T44566 open since 2012, T154176 open) and never got them; our suite already produces
  exactly this kind of evidence. Precedent: Parsoid's "dirty diff" as a first-class concern; AP242 verification
  properties. Lowest risk, no overlap with WMF's raster-editing mandate, and it makes *text* editing (the community's
  recommended fallback) materially safer.
- **D — Publish the measurement, not the tool.** Our 43-file no-op damage data has no published equivalent. A
  written, cited problem statement plus the acceptance suite could be the contribution; no editor needed.

**Recommendation: A + C, with D as the deliverable either way.** The suite is what makes A's claim falsifiable and
C's review possible; if the engineering budget stops, D is still a real contribution. B is the pragmatic middle if
the appetite is for something shippable into Wikimedia channels.

**Process constraints carried forward:** nothing on-wiki by an agent — all Wikimedia-facing steps go through Andrew
as an editor. The live WMF channel is W222/T428062 (attach to it; do not file a duplicate wish — W298 was declined
as one). Any new tool must produce files that satisfy COM:SVGOPT (metadata preserved, no pure source-code reuploads).
