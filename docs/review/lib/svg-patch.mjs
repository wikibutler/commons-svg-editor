/**
 * svg-patch.mjs — the surgical core of Epic A.
 *
 * The claim under test: you can edit an SVG *as text* and touch nothing else. There is no model, no parse-and-
 * re-serialise step, and therefore no way for the editor to "normalise" a file it was not asked to change.
 *
 * How it works: the file is a string. Tags are located by a quote-aware scanner (no DOM, no DOMParser, so
 * nothing is rewritten as a side effect of looking at it). An edit is addressed to a tag and an attribute, and
 * applied by splicing exactly that attribute's value span. Everything outside the splice is byte-identical,
 * including whitespace, attribute order, comments, CDATA, namespace prefixes and constructs this code has no
 * idea about.
 *
 * Deliberate limitations (Epic A2/A3 turn these into a documented editable subset with explicit refusals):
 *   - it edits attributes and text nodes, not geometry or structure;
 *   - it does not attempt to resolve CSS cascade or <use> references;
 *   - text-node edits are byte splices too, so they must respect XML escaping (caller's responsibility here).
 */

export function scanTags (text) {
  const tags = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt); i = e < 0 ? n : e + 2; continue; }
    if (text.startsWith('<!', lt)) { const e = text.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const m = /^<\/?([A-Za-z_][\w.:-]*)/.exec(text.slice(lt, lt + 256));
    if (!m) { i = lt + 1; continue; }
    let j = lt; let q = null;
    while (j < n) {
      const c = text[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      j++;
    }
    const raw = text.slice(lt, j + 1);
    if (raw.startsWith('<?') || raw.startsWith('<!')) { i = j + 1; continue; }
    const attrs = [];
    const attrRe = /([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(raw))) {
      const vRaw = am[2];
      const rel = am.index + (am[0].length - vRaw.length);
      attrs.push({ name: am[1], value: am[3] !== undefined ? am[3] : am[4],
        valueStart: lt + rel + 1, valueEnd: lt + rel + 1 + vRaw.length - 2, quote: vRaw[0] });
    }
    tags.push({ name: m[1], start: lt, end: j + 1, closing: raw.startsWith('</'),
      selfClosing: /\/>\s*$/.test(raw), attrs, raw });
    i = j + 1;
  }
  return tags;
}

/** Element tags only (no comments/PIs), with an index for addressing. */
export function elements (text) {
  return scanTags(text).filter((t) => !t.closing);
}

export function byId (text, id) {
  return elements(text).find((t) => t.attrs.some((a) => a.name === 'id' && a.value === id)) || null;
}

/** Change exactly one attribute value. Returns {ok, text, note} — never throws, never guesses. */
export function setAttribute (text, tag, name, value) {
  const existing = tag.attrs.find((a) => a.name === name);
  if (existing) {
    const out = text.slice(0, existing.valueStart) + value + text.slice(existing.valueEnd);
    return { ok: true, text: out, note: `replaced ${name} on <${tag.name}>`, changedBytes: value.length + (text.length - out.length) * -1 };
  }
  if (tag.selfClosing) {
    const at = tag.end - 2;
    const ins = ` ${name}="${value}"`;
    return { ok: true, text: text.slice(0, at) + ins + text.slice(at), note: `inserted ${name} on <${tag.name}/>`, changedBytes: ins.length };
  }
  const at = tag.end - 1;
  const ins = ` ${name}="${value}"`;
  return { ok: true, text: text.slice(0, at) + ins + text.slice(at), note: `inserted ${name} on <${tag.name}>`, changedBytes: ins.length };
}

/** Replace the text content of a non-self-closing element, located between its start and end tags. */
export function setText (text, tag, value) {
  if (tag.selfClosing) return { ok: false, text, note: `refused: <${tag.name}/> has no text content` };
  const openEnd = tag.end;
  const close = text.indexOf(`</${tag.name}`, openEnd);
  if (close < 0) return { ok: false, text, note: `refused: no closing </${tag.name}> found` };
  const out = text.slice(0, openEnd) + value + text.slice(close);
  return { ok: true, text: out, note: `set text of <${tag.name}>`, changedBytes: value.length - (close - openEnd) };
}

/** Byte-level diff summary: how much of the file actually moved. */
export function diffSummary (a, b) {
  if (a === b) return { identical: true, changedBytes: 0, changedLines: 0 };
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const changedA = a.slice(p, a.length - s);
  const changedB = b.slice(p, b.length - s);
  const linesA = changedA.split('\n').length;
  const linesB = changedB.split('\n').length;
  return { identical: false, changedBytes: Math.max(changedA.length, changedB.length),
    changedLines: Math.max(linesA, linesB), changedRegion: [changedA.slice(0, 60), changedB.slice(0, 60)] };
}
