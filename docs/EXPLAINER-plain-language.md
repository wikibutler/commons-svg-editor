# Why "just edit SVG in a browser" is so hard (and why Commons won't accept it yet)

*A plain-language explainer for experienced editors who know nothing about this corner of the problem.*

**The setup.** Commons holds about 5.2 million SVG files. SVG isn't a picture — it's a text file (XML) that
describes a picture. So editing one is editing text, and Commons reviewers judge the *text* (the diff), not just
what the picture looks like.

**The technical trap.** Most editors work by reading the file, building a simplified model of the drawing, and
writing a new file out of that model. Anything the model can't hold is lost. We sampled 44 real Commons files and
loaded and saved each one with **no edits at all**: 10 of them changed by more than 10% of their pixels, 25 by more
than 2%. Feature classes that failed *every single time*: gradients, filters, patterns, markers, embedded images,
and `<switch>` language blocks. One map lost all 13 of its `<switch>` blocks and every text label — a multilingual
map became an unlabelled map. The Egypt map lost its `sodipodi`/`inkscape` data (35 attributes → 0).

**Who gets hurt.** The failures land on the files the community values most: maps, charts, diagrams and
multilingual files, plus anything an Inkscape user maintains — 18 of the 44 carried Inkscape editing metadata, and
33 declared a foreign namespace.

**Why the community is right to object.** That data isn't decoration. It is what makes a file re-editable, and it
often carries author and licence information. Commons says overwriting is for *small corrections*, and COM:SVGOPT
says "pure sourcecode-edits are not allowed". Meanwhile Inkscape's own "Plain SVG" export rebuilds every object from
parsed data, and Inkscape's attribute reordering makes about 90% of a file's lines change for a one-word fix —
documented in their own bug tracker. So an ordinary editor save cannot be reviewed as a small diff. It looks like a
rewrite, and reviewers treat it as a new file, not a revision. That is the wall.

**The 14-year saga.** 2006: "why can't we edit SVG wikistyle?" 2012: a task was filed to deploy SVG-Edit on-wiki —
still open today. The recorded blocker is exactly the trap above: SVG-Edit *displays* `<switch>` but won't let you
edit the text inside it. 2019: a wishlist proposal for an SVG editor was archived *before voting* — "too big for our
team". The only thing that shipped was narrow and surgical: SVG Translate (2017, ranked #9), which *inserts*
translation blocks instead of rewriting the file.

**Solutions, most promising first.**

1. **Surgical editing** — change only what the user touched and leave every other byte alone. Wikimedia's own
   Parsoid does this for wikitext ("selective serialization") specifically to avoid dirty diffs.
2. **Narrow tools that insert rather than rewrite** — the SVG Translate model.
3. **Source diffs for SVG** — requested since 2012, never built; it would let a reviewer see a one-line change.
4. **Plain-text or command-line editing** — which Commons already recommends as the safest fallback.

**The one test that decides everything:** open a file, save it without touching anything, and the two files should
be identical. Almost no editor passes. That single test is the whole argument.
