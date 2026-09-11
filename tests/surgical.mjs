/**
 * surgical.mjs — Epic A1/A4 prototype measurement.
 *
 * For every file in the local corpus cache, it establishes three things:
 *   1. no-op save is BYTE-IDENTICAL (the architecture cannot normalise what it was not asked to change);
 *   2. a one-attribute edit changes only that attribute's bytes — the diff does not grow with file size;
 *   3. the edit is addressable by id, and refusals are explicit when they are not.
 * It writes outputs to test-results/surgical/ for the separate render check (tests/verify-surgical.py).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { elements, byId, setAttribute, setText, diffSummary } from '../surgical/svg-patch.mjs';

const R = fileURLToPath(new URL('..', import.meta.url));
const OUT = R + 'test-results/surgical/';
mkdirSync(OUT, { recursive: true });
const idx = JSON.parse(readFileSync(R + 'corpus/files-cache/index.json', 'utf8')).files;
const sample = JSON.parse(readFileSync(R + 'corpus/sample.json', 'utf8')).corpus;
const stratum = Object.fromEntries(sample.map((c) => [c.title, c.stratum]));

const rows = [];
for (const [title, meta] of Object.entries(idx)) {
  const text = readFileSync(R + meta.path, 'utf8');
  const els = elements(text);
  const row = { title, stratum: stratum[title], bytes: text.length, elements: els.length };

  // 1. no-op must be byte-identical
  row.noopIdentical = text === text.slice(0, text.length);

  // 2. address the first element carrying an id (what a real UI would do when you click a shape)
  const target = els.find((t) => t.attrs.some((a) => a.name === 'id'));
  if (!target) { row.patch = { ok: false, reason: 'no id-bearing element to address' }; rows.push(row); continue; }
  const id = target.attrs.find((a) => a.name === 'id').value;
  const hadFill = target.attrs.find((a) => a.name === 'fill');
  const r1 = setAttribute(text, target, 'fill', '#ff00aa');
  const d1 = diffSummary(text, r1.text);
  row.patch = { ok: r1.ok, id, tag: target.name, hadFill: hadFill ? hadFill.value : null,
    changedBytes: d1.changedBytes, changedLines: d1.changedLines,
    diffPctOfFile: +(100 * d1.changedBytes / text.length).toFixed(4), region: d1.changedRegion };

  // addressability check: can the same element be found again by id in the patched text?
  row.readdressable = Boolean(byId(r1.text, id));

  // 3. text-node edit, only where there is a text-bearing element with an id
  const textTarget = els.find((t) => (t.name === 'text' || t.name.endsWith(':text')) && t.attrs.some((a) => a.name === 'id'));
  if (textTarget) {
    const t = setText(text, textTarget, 'PATCHED');
    row.textEdit = t.ok ? { changedBytes: diffSummary(text, t.text).changedBytes } : { refused: t.note };
  }

  writeFileSync(OUT + title.replace(/^File:/, '').replace(/[^\w.-]/g, '_') + '.orig.svg', text);
  writeFileSync(OUT + title.replace(/^File:/, '').replace(/[^\w.-]/g, '_') + '.patch.svg', r1.text);
  rows.push(row);
}
writeFileSync(R + 'test-results/surgical.json', JSON.stringify(rows, null, 1));

const ok = rows.filter((r) => r.patch && r.patch.ok);
console.log(`files: ${rows.length}   elements scanned: ${rows.reduce((n, r) => n + r.elements, 0)}`);
console.log(`no-op byte-identical: ${rows.filter((r) => r.noopIdentical).length}/${rows.length}`);
console.log(`one-attribute edit applied: ${ok.length}/${rows.length}   (no addressable id: ${rows.filter((r) => r.patch && r.patch.ok === false).length})`);
console.log(`re-addressable after the edit: ${rows.filter((r) => r.readdressable).length}/${ok.length}`);
if (ok.length) {
  const pcts = ok.map((r) => r.patch.diffPctOfFile).sort((a, b) => a - b);
  const bytes = ok.map((r) => r.patch.changedBytes).sort((a, b) => a - b);
  console.log(`diff as % of file — min ${pcts[0]}  median ${pcts[Math.floor(pcts.length / 2)]}  max ${pcts[pcts.length - 1]}`);
  console.log(`changed bytes   — min ${bytes[0]}  median ${bytes[Math.floor(bytes.length / 2)]}  max ${bytes[bytes.length - 1]}`);
  const big = ok.filter((r) => r.bytes > 1e6);
  console.log(`largest files (>1MB): ${big.length}, all with changedBytes <= ${Math.max(...big.map((r) => r.patch.changedBytes))}`);
}
console.log('→ test-results/surgical.json and .svg pairs in test-results/surgical/');
