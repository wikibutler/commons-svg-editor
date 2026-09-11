/**
 * review.mjs — run the review engine over real Commons revision pairs and print a reviewer-facing report.
 * Input: review-cache/pairs.json (+ the two revision files), produced by tools/fetch_review_pairs.py.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reviewPair } from '../docs/review/lib/svg-diff.mjs';

const R = fileURLToPath(new URL('..', import.meta.url));
const pairs = JSON.parse(readFileSync(R + 'review-cache/pairs.json', 'utf8'));
const out = [];
for (const p of pairs) {
  const a = readFileSync(R + p.older.path, 'utf8');
  const b = readFileSync(R + p.newer.path, 'utf8');
  const r = reviewPair(a, b);
  out.push({ title: p.title, older: p.older.timestamp.slice(0, 10), newer: p.newer.timestamp.slice(0, 10),
    user: p.newer.user, comment: p.newer.comment, result: r });
  console.log(`\n=== ${p.title.replace('File:', '')}  (${p.older.timestamp.slice(0, 10)} → ${p.newer.timestamp.slice(0, 10)}, ${p.newer.user})`);
  console.log(`    edit summary: "${(p.newer.comment || '').slice(0, 80)}"`);
  console.log(`    VERDICT: ${r.verdict}`);
  console.log(`    churn: ${r.touchShare}% of elements touched · +${r.structural.added}/-${r.structural.removed}/~${r.structural.changed} · attr changes ${r.structural.attrChanges} · size ${r.sizeChangePercent}%`);
  const d = r.factsDelta;
  const deltas = Object.entries(d).filter(([k, v]) => Array.isArray(v) && v.length === 2 && v[0] !== v[1] && k !== 'elements')
    .map(([k, v]) => `${k} ${v[0]}→${v[1]}`);
  if (deltas.length) console.log(`    facts moved: ${deltas.join(' · ')}`);
  for (const f of r.flags) console.log(`    [${f.level}] ${f.text}`);
  if (r.sample.changed.length) {
    console.log(`    changed elements (first ${Math.min(4, r.sample.changed.length)}):`);
    for (const c of r.sample.changed.slice(0, 4)) console.log(`      ${c.el}: ${c.attrs.join('; ') || (c.text ? `text "${c.text[0]}" → "${c.text[1]}"` : 'moved')}`);
  }
}
writeFileSync(R + 'test-results/review.json', JSON.stringify(out, null, 1));
console.log('\n→ test-results/review.json');
