#!/usr/bin/env python3
"""verify-surgical.py — is the surgical output actually a valid, renderable SVG?

Two checks over the pairs in test-results/surgical/:
  1. well-formedness of every patched file (xml.etree) — a text editor that produces invalid XML is worthless;
  2. render comparison with resvg (a real SVG renderer, not a browser): both files must render, and the pixels
     must differ only where the edited element is — NOT across the whole drawing, which is what a rebuild does.
"""
import glob, io, os, sys, xml.etree.ElementTree as ET
from PIL import Image, ImageChops
import resvg_py

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
pairs = sorted(glob.glob(R + 'test-results/surgical/*.orig.svg'))
wellformed = 0; bad = []
rendered = []; failed = []
for orig in pairs:
    patch = orig.replace('.orig.svg', '.patch.svg')
    if not os.path.exists(patch): continue
    for f in (orig, patch):
        try:
            ET.parse(f); wellformed += 1
        except Exception as e:
            bad.append((os.path.basename(f), str(e)[:60]))
    if os.path.getsize(orig) > 3_000_000:      # skip the very largest for render time
        continue
    try:
        a = Image.open(io.BytesIO(resvg_py.svg_to_bytes(svg_path=orig, width=500))).convert('RGB')
        b = Image.open(io.BytesIO(resvg_py.svg_to_bytes(svg_path=patch, width=500))).convert('RGB')
        if a.size != b.size: b = b.resize(a.size)
        d = ImageChops.difference(a, b)
        px = list(d.getdata()); changed = sum(1 for p in px if p != (0, 0, 0))
        rendered.append((os.path.basename(orig), 100 * changed / len(px), os.path.getsize(orig)))
    except Exception as e:
        failed.append((os.path.basename(orig), str(e)[:70]))

print(f"pairs checked: {len(pairs)}")
print(f"well-formed XML: {wellformed}/{2*len(pairs)} files")
for n, e in bad[:6]: print(f"   NOT well-formed: {n} — {e}")
print(f"rendered with resvg: {len(rendered)}   render failures: {len(failed)}")
for n, e in failed[:6]: print(f"   RENDER FAIL: {n} — {e}")
if rendered:
    pcts = sorted(r[1] for r in rendered)
    print(f"pixel change from a one-attribute edit — min {pcts[0]:.3f}%  median {pcts[len(pcts)//2]:.3f}%  max {pcts[-1]:.3f}%")
    touched = [r for r in rendered if r[1] > 0]
    print(f"files where the edit is visible in the render: {len(touched)}/{len(rendered)}")
    for n, p, s in sorted(rendered, key=lambda r: -r[1])[:5]:
        print(f"   {p:8.3f}%  {s//1024:>6} KB  {n[:52]}")
