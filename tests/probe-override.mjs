// Why did 21 of 24 rendered files show no visible change from a fill edit?
// Hypothesis: presentation attributes lose to inline style (SVG 1.1 §6.4), so patching fill="..." on an element
// that carries style="fill:..." changes the bytes and nothing else.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { elements } from '../surgical/svg-patch.mjs';
const R = fileURLToPath(new URL('..', import.meta.url));
const idx = JSON.parse(readFileSync(R + 'corpus/files-cache/index.json', 'utf8')).files;
let withStyleFill = 0; let withPresAttrOnly = 0; let container = 0; const examples = [];
for (const [title, meta] of Object.entries(idx)) {
  const text = readFileSync(R + meta.path, 'utf8');
  const t = elements(text).find((e) => e.attrs.some((a) => a.name === 'id'));
  if (!t) continue;
  const style = t.attrs.find((a) => a.name === 'style');
  const hasFillAttr = t.attrs.some((a) => a.name === 'fill');
  const styleHasFill = style && /(^|;|\s)fill\s*:/.test(style.value);
  const isContainer = ['g', 'svg', 'defs', 'symbol', 'marker', 'clipPath', 'mask', 'pattern', 'switch'].some((c) => t.name === c || t.name.endsWith(':' + c));
  if (styleHasFill) withStyleFill++; else if (isContainer) container++; else if (hasFillAttr) withPresAttrOnly++;
  if (examples.length < 6) examples.push(`${t.name.padEnd(12)} styleFill=${Boolean(styleHasFill)} fillAttr=${hasFillAttr} container=${isContainer}  ${title.slice(0, 46)}`);
}
console.log('targets whose first id-bearing element ...');
console.log('  carries style="…fill:…" (patch invisible) :', withStyleFill);
console.log('  is a container element (patch inert)      :', container);
console.log('  carries only a presentation fill attribute:', withPresAttrOnly);
console.log('examples:'); examples.forEach((e) => console.log('   ', e));
