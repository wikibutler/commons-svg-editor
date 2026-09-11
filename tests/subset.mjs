/**
 * subset.mjs — Epic A2 measurement over the 44-file corpus.
 *
 * Two questions, both measured:
 *   1. ADDRESSING — can every element be addressed, and does the address resolve to the right source span
 *      without relying on an id? (The prototype's "first element with an id" heuristic hit definitions.)
 *   2. EDITABLE SUBSET — for a safe style edit, is the chosen target a *rendered* shape, and is the splice
 *      byte-minimal?
 * The address is document-order: index i, which maps onto the i-th start tag in the text.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildIndex, canEdit, visibleShapes, subsetReport, classifyAttr, resolve } from '../docs/review/lib/svg-address.mjs';
import { elements, setAttribute, diffSummary } from '../docs/review/lib/svg-patch.mjs';

const R = fileURLToPath(new URL('..', import.meta.url));
const OUT = R + 'test-results/subset/';
mkdirSync(OUT, { recursive: true });
const idx = JSON.parse(readFileSync(R + 'corpus/files-cache/index.json', 'utf8')).files;
const sample = JSON.parse(readFileSync(R + 'corpus/sample.json', 'utf8')).corpus;
const stratum = Object.fromEntries(sample.map((c) => [c.title, c.stratum]));

const rows = [];
for (const [title, meta] of Object.entries(idx)) {
  const text = readFileSync(R + meta.path, 'utf8');
  const index = buildIndex(text);
  const rep = subsetReport(text);
  const spans = elements(text);
  const row = { title, stratum: stratum[title], bytes: text.length, ...rep };

  // (1) addressing: does index i give us the same element the tree walk found?
  let alignErrors = 0;
  for (const n of index.nodes) {
    const span = spans[n.docIndex];
    if (!span || span.name !== n.rawTag) alignErrors++;
  }
  row.addressAlignErrors = alignErrors;
  row.allAddressable = alignErrors === 0 && index.nodes.length > 0;

  // (2) the old heuristic, for comparison
  const firstId = index.nodes.find((n) => n.id);
  row.firstIdTarget = firstId ? { tag: firstId.tag, isShape: firstId.isShape, inDefinition: firstId.inDefinition } : null;

  // (3) choose a rendered shape with a safe style edit, by rule rather than by id
  let target = null; let decision = null;
  outer:
  for (const n of visibleShapes(index)) {
    // consider every style-valued attribute (an element whose fill is url(#…) often still has a plain stroke)
    for (const k of Object.keys(n.attrs)) {
      if (classifyAttr(k) !== 'style') continue;
      const d = canEdit(index, n, k);
      if (d.decision === 'safe') { target = n; decision = { attr: k, reason: d.reason }; break outer; }
    }
  }
  row.target = target ? { tag: target.tag, id: target.id, address: target.address, attr: decision.attr, reason: decision.reason } : null;
  row.editApplied = false;
  if (target) {
    const span = spans[target.docIndex];
    if (span && span.name === target.rawTag) {
      const out = setAttribute(text, span, decision.attr, '#ff00aa');
      const d = diffSummary(text, out.text);
      row.editApplied = out.ok;
      row.changedBytes = d.changedBytes;
      row.diffPctOfFile = +(100 * d.changedBytes / text.length).toFixed(4);
      row.resolveAfterEdit = resolve(buildIndex(out.text), target.address).ok;
      const base = title.replace(/^File:/, '').replace(/[^\w.-]/g, '_');
      writeFileSync(OUT + base + '.orig.svg', text);
      writeFileSync(OUT + base + '.patch.svg', out.text);
    }
  }
  rows.push(row);
}
writeFileSync(R + 'test-results/subset.json', JSON.stringify(rows, null, 1));

const n = rows.length;
const aligned = rows.filter((r) => r.allAddressable);
const applied = rows.filter((r) => r.editApplied);
const idFirst = rows.filter((r) => r.firstIdTarget);
const idFirstShape = idFirst.filter((r) => r.firstIdTarget.isShape);
const diffs = applied.map((r) => r.diffPctOfFile).sort((a, b) => a - b);
console.log(`files: ${n}`);
console.log(`document-order addressing aligns with the text for: ${aligned.length}/${n} files (0 mismatches in ${aligned.length})`);
console.log(`files whose FIRST id-bearing element is a rendered shape: ${idFirstShape.length}/${idFirst.length}  <- the old heuristic's hit rate`);
console.log(`files with a SAFE style-edit target: ${applied.length}/${n}`);
console.log(`elements: ${rows.reduce((s, r) => s + r.elements, 0)} · in definitions: ${rows.reduce((s, r) => s + r.definitions, 0)} · rendered shapes: ${rows.reduce((s, r) => s + r.visibleShapes, 0)}`);
console.log(`reference-bearing attributes (url(#…)): ${rows.reduce((s, r) => s + r.referenceAttrs, 0)}`);
console.log(`CSS-cascade risk elements: ${rows.reduce((s, r) => s + r.cssClassRisk, 0)} across ${rows.filter((r) => r.hasStyleBlock).length} files that carry a <style> block`);
if (applied.length) {
  console.log(`edits: changed bytes ${Math.min(...applied.map((r) => r.changedBytes))}–${Math.max(...applied.map((r) => r.changedBytes))}; median diff ${diffs[Math.floor(diffs.length / 2)]}% of file; re-resolvable after the edit: ${applied.filter((r) => r.resolveAfterEdit).length}/${applied.length}`);
}
console.log('attribute kinds across the corpus:', rows.reduce((a, r) => { for (const [k, v] of Object.entries(r.attributeKinds)) a[k] = (a[k] || 0) + v; return a; }, {}));
console.log('→ test-results/subset.json + .svg pairs in test-results/subset/');
