/**
 * svg-diff.mjs — "what changed between these two Commons revisions, and would a reviewer accept it?"
 *
 * Built for the Commons review question, not for programmers: it answers
 *   (a) WHAT changed, grouped the way a Commons editor thinks (geometry, colour/style, text and translations,
 *       definitions, framing, metadata, structure),
 *   (b) HOW MUCH of the file moved (source churn), which is what decides whether an overwrite is reviewable at
 *       all under COM:OVERWRITE, and
 *   (c) whether known-damaging patterns are present (metadata stripped, translations lost, definitions rewritten,
 *       a minification pass, a whole-file reserialisation).
 */
import { parseSvg, flatten, facts } from './svg-tree.mjs';

const DEF_TAGS = /(Gradient|filter|pattern|marker|clipPath|mask|symbol)$/;

export function reviewPair (oldText, newText) {
  const fa = facts(oldText); const fb = facts(newText);
  const A = flatten(parseSvg(oldText)); const B = flatten(parseSvg(newText));
  const mapA = new Map(A.map((f) => [f.key, f])); const mapB = new Map(B.map((f) => [f.key, f]));

  const added = [...mapB.values()].filter((f) => !mapA.has(f.key));
  const removed = [...mapA.values()].filter((f) => !mapB.has(f.key));
  const changed = [];
  for (const [k, a] of mapA) {
    const b = mapB.get(k); if (!b) continue;
    const names = new Set([...Object.keys(a.node.attrs), ...Object.keys(b.node.attrs)]);
    const attrChanges = [];
    for (const n of names) if (a.node.attrs[n] !== b.node.attrs[n]) attrChanges.push({ name: n, from: a.node.attrs[n], to: b.node.attrs[n] });
    // A path-keyed element "moves" whenever an ancestor is inserted or removed, which is not evidence of churn.
    // Only id-keyed elements give a trustworthy move signal; everything else counts as changed on attributes/text.
    const moved = k.includes('#') && a.path !== b.path;
    const textChanged = a.node.text !== b.node.text;
    if (attrChanges.length || moved || textChanged) changed.push({ key: k, tag: a.node.tag, attrChanges, moved, textChanged,
      textFrom: a.node.text.slice(0, 60), textTo: b.node.text.slice(0, 60) });
  }
  const named = (n) => `${n.node.tag}${n.node.id ? '#' + n.node.id : ''}`;
  const defChanged = changed.filter((c) => DEF_TAGS.test(c.tag));
  const realChanges = changed.filter((c) => c.attrChanges.length || c.textChanged);
  const structural = { added: added.length, removed: removed.length, changed: changed.length,
    realChanges: realChanges.length, attrChanges: changed.reduce((n, c) => n + c.attrChanges.length, 0),
    moved: changed.filter((c) => c.moved).length,
    reflowedNote: 'path keying reflows when ancestors are inserted/removed; moves are only reported for elements with ids' };

  const pct = (a, b) => (a ? Math.round(1000 * (b - a) / a) / 10 : null);
  const factsDelta = {
    bytes: [fa.bytes, fb.bytes, pct(fa.bytes, fb.bytes)],
    elements: [fa.elements, fb.elements], comments: [fa.comments, fb.comments],
    switch: [fa.switch, fb.switch], systemLanguage: [fa.systemLanguage, fb.systemLanguage],
    textNodes: [fa.textNodes, fb.textNodes], gradients: [fa.gradients, fb.gradients],
    defsIds: [fa.defsIds, fb.defsIds], filters: [fa.filters, fb.filters], patterns: [fa.patterns, fb.patterns],
    embeddedRaster: [fa.embeddedRaster, fb.embeddedRaster], styleAttrs: [fa.styleAttrs, fb.styleAttrs],
    inkscape: [fa.inkscape, fb.inkscape], namedview: [fa.namedview, fb.namedview], namespaces: [fa.namespaces, fb.namespaces]
  };
  const framing = ['viewBox', 'width', 'height', 'preserveAspectRatio']
    .filter((k) => (fa[k] || '') !== (fb[k] || ''))
    .map((k) => ({ attr: k, from: fa[k], to: fb[k] }));

  // source churn: what share of elements the edit touched
  // churn = elements genuinely added, removed, or whose attributes/text changed — not path reflow
  const touchShare = fa.elements
    ? Math.min(1, (structural.added + structural.removed + realChanges.length) / fa.elements) : 0;
  const sizeChange = pct(fa.bytes, fb.bytes);

  const flags = [];
  if (oldText === newText) flags.push({ level: 'info', text: 'The two revisions are byte-identical.' });
  if (fa.inkscape && fb.inkscape < fa.inkscape * 0.5) flags.push({ level: 'warn', text: `Editor metadata removed: inkscape:/sodipodi: attributes ${fa.inkscape} → ${fb.inkscape}. That metadata is what keeps a file re-editable.` });
  if (fa.namedview && !fb.namedview) flags.push({ level: 'warn', text: 'The sodipodi:namedview block (canvas/view settings) was dropped.' });
  if (fb.switch < fa.switch) flags.push({ level: 'err', text: `Translation blocks lost: <switch> ${fa.switch} → ${fb.switch}.` });
  if (fb.switch > fa.switch) flags.push({ level: 'info', text: `Translation blocks added: <switch> ${fa.switch} → ${fb.switch} (this is what the SVG Translate tool does).` });
  if (fb.systemLanguage < fa.systemLanguage) flags.push({ level: 'err', text: `Languages lost: ${fa.systemLanguage} → ${fb.systemLanguage}.` });
  if (fb.comments < fa.comments) flags.push({ level: 'info', text: `Comments removed: ${fa.comments} → ${fb.comments}.` });
  if (fa.defsIds && fb.defsIds < fa.defsIds) flags.push({ level: 'warn', text: `Definitions in <defs> with ids: ${fa.defsIds} → ${fb.defsIds}.` });
  if (defChanged.length) flags.push({ level: 'warn', text: `${defChanged.length} definition(s) rewritten (${defChanged.slice(0, 3).map((c) => c.tag).join(', ')}${defChanged.length > 3 ? ', …' : ''}).` });
  if (sizeChange !== null && sizeChange <= -20) flags.push({ level: 'warn', text: `File shrank ${Math.abs(sizeChange)}% — an optimisation/minification pass (SVGO-style). COM:SVGOPT says mass minimisation is often buggy and does not justify reuploading on its own.` });
  if (touchShare > 0.5) flags.push({ level: 'warn', text: `Whole-file churn: ${Math.round(touchShare * 100)}% of elements added, removed or changed. This cannot be reviewed as a small diff; under COM:OVERWRITE it is a new file, not a correction.` });
  if (framing.length) flags.push({ level: 'warn', text: `Framing changed: ${framing.map((f) => `${f.attr} ${f.from || '—'} → ${f.to || '—'}`).join('; ')}.` });
  if (fb.embeddedRaster !== fa.embeddedRaster) flags.push({ level: 'info', text: `Embedded raster images: ${fa.embeddedRaster} → ${fb.embeddedRaster}.` });
  if (fa.textNodes && fb.textNodes < fa.textNodes) flags.push({ level: 'warn', text: `Text elements ${fa.textNodes} → ${fb.textNodes}: text was converted to paths or removed. Converting text to outlines is accepted practice for font-independence, but it ends translatability (SVG Translate needs live text).` });
  if (fa.textNodes && fb.tspan < fa.tspan) flags.push({ level: 'info', text: `tspan runs ${fa.tspan} → ${fb.tspan}.` });

  let verdict;
  if (oldText === newText) verdict = 'identical';
  else if (touchShare <= 0.05 && !framing.length) verdict = 'targeted edit — a small, reviewable change';
  else if (touchShare <= 0.25) verdict = 'moderate edit — review the changed elements below';
  else verdict = 'whole-file rewrite — review for damage rather than for content';

  return {
    structural, factsDelta, framing, flags, verdict, touchShare: Math.round(touchShare * 1000) / 10,
    sizeChangePercent: sizeChange,
    sample: { added: added.slice(0, 8).map(named), removed: removed.slice(0, 8).map(named),
      changed: changed.slice(0, 12).map((c) => ({ el: c.tag + (c.key.includes('#') ? '#' + c.key.split('#')[1] : ''),
        attrs: c.attrChanges.map((a) => `${a.name}: ${String(a.from).slice(0, 24)} → ${String(a.to).slice(0, 24)}`),
        moved: c.moved, text: c.textChanged ? [c.textFrom, c.textTo] : null })) },
    factsOld: fa, factsNew: fb
  };
}
