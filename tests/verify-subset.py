#!/usr/bin/env python3
"""verify-subset.py — did the addressing fix actually pick targets a user can see?

The prototype's first attempt edited "the first element with an id" and 21 of 24 renders showed no visible change,
because the targets were gradient/filter/pattern definitions. This checks the same thing for the A2 addressing
rules: rendered with resvg, how many of the safe-target edits are visible in the picture?
"""
import glob, io, os, xml.etree.ElementTree as ET
from PIL import Image, ImageChops
import resvg_py

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
pairs = sorted(glob.glob(R + 'test-results/subset/*.orig.svg'))
wellformed = 0; bad = []; rendered = []; failed = []
for orig in pairs:
    patch = orig.replace('.orig.svg', '.patch.svg')
    if not os.path.exists(patch): continue
    for f in (orig, patch):
        try: ET.parse(f); wellformed += 1
        except Exception as e: bad.append((os.path.basename(f), str(e)[:50]))
    if os.path.getsize(orig) > 3_000_000: continue
    try:
        a = Image.open(io.BytesIO(resvg_py.svg_to_bytes(svg_path=orig, width=500))).convert('RGB')
        b = Image.open(io.BytesIO(resvg_py.svg_to_bytes(svg_path=patch, width=500))).convert('RGB')
        if a.size != b.size: b = b.resize(a.size)
        d = ImageChops.difference(a, b); px = list(d.getdata())
        rendered.append((os.path.basename(orig), 100 * sum(1 for p in px if p != (0, 0, 0)) / len(px)))
    except Exception as e:
        failed.append((os.path.basename(orig), str(e)[:60]))

print(f"pairs: {len(pairs)} (skipping the largest for render time)")
print(f"well-formed XML: {wellformed}/{2*len(pairs)}  |  not well-formed: {bad[:4] if bad else 'none'}")
print(f"rendered: {len(rendered)}  |  render failures: {len(failed)}")
for n, e in failed[:5]: print('   FAIL', n[:56], '-', e)
if rendered:
    pcts = sorted(p for _, p in rendered)
    visible = [r for r in rendered if r[1] > 0.001]
    print(f"visible-change rate: {len(visible)}/{len(rendered)} = {round(100*len(visible)/len(rendered))}%   (old id-based heuristic: 3/24 = 13%)")
    print(f"pixel change: min {pcts[0]:.3f}%  median {pcts[len(pcts)//2]:.3f}%  max {pcts[-1]:.3f}%")
    for n, p in sorted(rendered, key=lambda r: -r[1])[:4]: print(f"   {p:8.3f}%  {n[:60]}")
