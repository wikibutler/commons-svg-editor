# Why "just edit SVG in a browser" is so hard (and why Commons won't accept it yet)

*A plain-language explainer for experienced editors who know nothing about this corner of the problem.*

**The setup.** Commons holds about 5.2 million SVG files. SVG isn't a picture — it's a text file (XML) that
describes one. Editing it is editing text, and reviewers judge the text (the diff), not just the picture.

**What we opened the files with.** SVG-Edit 7.4.2 — the most widely used browser SVG editor, actively maintained,
MIT-licensed, and the very tool Wikimedia's own 2012 task proposed deploying on-wiki. It is not a straw man: among
browser editors it had the most potential for this job. It damaged the files anyway.

**Where the files came from.** The hardest ones come from categories Commons editors maintain themselves —
`Category:Pictures showing a librsvg bug` (75+ files) and `Category:Images with SVG 2.0 features` — plus a seeded,
SHA-1-pinned draw from maps, charts, diagrams, logos, multilingual files and embedded-raster files. Note the gap:
the community has good test suites for SVG *renderers* (User:JoKalliauer's), but none for SVG *editors*.

**The technical trap.** Editors read the file, build a simplified model of the drawing, then write a new file from
that model. Anything the model can't hold is lost. We loaded and re-saved 44 real Commons files with **no edits at
all**: 10 changed by more than 10% of their pixels, 25 by more than 2%. Feature classes that failed *every single
time*: gradients, filters, patterns, markers, embedded images, `<switch>` language blocks. One map lost all 13
`<switch>` blocks and every label — a multilingual map became unlabelled. The Egypt map lost its `sodipodi`/
`inkscape` data (35 attributes → 0). The failures land where the community cares most: maps, charts, diagrams,
multilingual files, and anything an Inkscape user maintains.

**Why the community is right to object.** That data isn't decoration: it keeps files re-editable and often carries
author and licence information. Commons says overwriting is for *small corrections*; COM:SVGOPT says "pure
sourcecode-edits are not allowed". Inkscape's own "Plain SVG" rebuilds every object from parsed data, and its
attribute reordering changes ~90% of a file's lines for a one-word fix. So an editor save can't be reviewed as a
small diff — it looks like a rewrite, and reviewers treat it as a new file. That's the wall.

**The 14-year saga.** 2006: "why can't we edit SVG wikistyle?" 2012: a task was filed to deploy SVG-Edit on-wiki —
still open, and the blocker recorded is exactly that trap (SVG-Edit *displays* `<switch>` but won't let you edit the
text inside it). 2019: a wishlist proposal for an SVG editor was archived *before voting* — "too big for our team".
The only thing that shipped was narrow and surgical: SVG Translate (2017, #9), which inserts translation blocks
instead of rewriting.

**Solutions, most promising first.** (1) **Surgical editing** — change only what the user touched, leave every other
byte alone; Wikimedia's own Parsoid does this for wikitext ("selective serialization"). (2) **Narrow insert-only
tools** like SVG Translate. (3) **Source diffs for SVG** — requested since 2012, never built. (4) **Plain-text
editing**, which Commons already recommends.

**The test that decides everything:** open a file, save it untouched, get the identical file back. Almost no editor
passes.
