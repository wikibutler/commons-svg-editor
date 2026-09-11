# Why "just edit SVG in a browser" is so hard (and why Commons won't accept it yet)

*A plain-language explainer for experienced editors who know nothing about this corner of the problem.*

**The setup.** Commons holds about 5.2 million SVG files. SVG isn't a picture — it's a text file (XML) that
describes a picture. Editing one is editing text, and Commons reviewers judge the text (the diff), not just the
picture.

**The technical trap.** Most editors read the file, build a simplified model of the drawing, then write a new file
from that model. Anything the model can't hold is lost. We loaded and re-saved 44 real Commons files with **no edits
at all**: 10 changed by more than 10% of their pixels, 25 by more than 2%. Feature classes that failed *every single
time*: gradients, filters, patterns, markers, embedded images and `<switch>` language blocks. One map lost all 13
`<switch>` blocks and every label: a multilingual map became an unlabelled one. The Egypt map lost its
`sodipodi`/`inkscape` data (35 attributes → 0).

**Who gets hurt.** The failures land where the community cares most: maps, charts, diagrams, multilingual files and
anything an Inkscape user maintains (18 of the 44 carried Inkscape editing metadata; 33 declared a foreign
namespace).

**Why the community is right to object.** That data isn't decoration: it keeps the file re-editable and often
carries author and licence information. Commons says overwriting is for *small corrections*, and COM:SVGOPT says
"pure sourcecode-edits are not allowed". Inkscape's own "Plain SVG" export rebuilds every object from parsed data,
and its attribute reordering makes ~90% of a file's lines change for a one-word fix (their bug tracker). So an
editor save can't be reviewed as a small diff; it looks like a rewrite, and reviewers treat it as a new file. That's
the wall.

**The 14-year saga.** 2006: "why can't we edit SVG wikistyle?" 2012: a task was filed to deploy SVG-Edit on-wiki —
still open. The blocker recorded is exactly that trap: SVG-Edit *displays* `<switch>` but won't let you edit the
text inside it. 2019: a wishlist proposal for an SVG editor was archived *before voting* — "too big for our team".
The only thing that shipped was narrow and surgical — SVG Translate (2017, #9) — which inserts translation blocks
instead of rewriting.

**Solutions, most promising first.**

1. **Surgical editing** — change only what the user touched, leave every other byte alone. Wikimedia's own Parsoid
   does this for wikitext ("selective serialization") to avoid dirty diffs.
2. **Narrow tools that insert rather than rewrite** — the SVG Translate model.
3. **Source diffs for SVG** — requested since 2012, never built; it would let a reviewer see a one-line change.
4. **Plain-text or command-line editing**, which Commons already recommends.

**The one test that decides everything:** open a file, save it untouched, and get the identical file back. Almost no
editor passes. That's the whole argument.
