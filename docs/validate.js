/**
 * validate.js — "will this still render and still be editable on Commons?" checks.
 *
 * Nothing here talks to the network; it is the local gate that runs on every export.
 * The rules encode the Commons/librsvg hygiene conventions (see COM:SVG guidelines):
 *  - commons renders SVG with librsvg only → no scripts, no foreignObject, no remote refs,
 *    no flowRoot/textPath (unimplemented in librsvg), no fonts the render server does not have.
 *  - optimizer-clean ≠ editor-clean: we do NOT strip Inkscape/Sodipodi editor metadata,
 *    because that structure is what makes a file editable by the next person.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** fonts known to be present on the Wikimedia render/video servers (subset, warn-only). */
const SAFE_FONTS = [
  'dejavu sans', 'dejavu serif', 'dejavu sans mono', 'liberation sans', 'liberation serif',
  'liberation mono', 'noto sans', 'noto serif', 'noto sans cjk', 'noto sans jp', 'noto naskh arabic',
  'noto sans hebrew', 'noto sans devanagari', 'times new roman', 'arial', 'helvetica', 'courier new',
  'courier', 'georgia', 'verdana', 'tahoma', 'sans-serif', 'serif', 'monospace', 'symbol'
];

export function parseSvg (svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('exported SVG is not well-formed XML: ' + err.textContent.trim().slice(0, 220));
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') throw new Error('exported document root is <' + (root?.localName) + '>, not <svg>');
  return { doc, root };
}

/** Remove editor artefacts that must not land on Commons (SVG-Edit's `se:` namespace, editability flags). */
export function cleanExport (svgText) {
  let text = svgText;
  text = text.replace(/\sxmlns:se="[^"]*"/g, '');
  text = text.replace(/\sse:[a-zA-Z-]+="[^"]*"/g, '');
  text = text.replace(/\scontenteditable="(true|false)"/g, '');
  if (!/^\s*<\?xml/.test(text)) text = '<?xml version="1.0" encoding="UTF-8"?>\n' + text;
  return ensureNamespaces(text);
}

/** Make sure any namespace actually used in the document is declared on the root element.
 *  (Needed after restoring source definition blocks: SVG-Edit writes SVG2-style `href` and
 *  therefore omits `xmlns:xlink`, but a restored block may still use `xlink:href`.) */
export function ensureNamespaces (svgText, sourceText = null) {
  let text = svgText;
  const declares = (t, p) => (t.match(new RegExp(`xmlns:${p}=`)) || []);
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(text)) {
    text = text.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (/xlink:/.test(text) && !/xmlns:xlink\s*=/.test(text)) {
    text = text.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  // Namespace declarations are framing metadata too: restoring a source block that uses
  // `inkscape:stockid` on a marker (or `inkscape:collect`, `sodipodi:…`, `dc:…`) is pointless if the
  // export root no longer declares that prefix — the result is not well-formed XML.
  if (sourceText) {
    const srcRoot = (sourceText.match(/<svg\b[^>]*>/) || [''])[0];
    for (const m of srcRoot.matchAll(/xmlns:([\w-]+)="([^"]*)"/g)) {
      const [, prefix, uri] = m;
      // NOTE: plain string test, not a template-literal RegExp — inside a template literal `\b` is a
      // backspace escape and `\w` collapses to `w`, which silently broke this guard once already.
      if (declares(text, prefix).length || !text.includes(prefix + ':')) continue;
      text = text.replace(/<svg\b/, `<svg xmlns:${prefix}="${uri}"`);
    }
  }
  return text;
}

export function inspect (svgText) {
  const errors = []; const warnings = []; const info = [];
  let root = null; let doc = null;
  try {
    ({ doc, root } = parseSvg(svgText));
  } catch (e) {
    return { ok: false, errors: [e.message], warnings, info, stats: {} };
  }

  const owners = (ns) => [...root.ownerDocument.getElementsByTagNameNS(ns, '*')];
  const all = [...root.querySelectorAll('*')];

  // --- hard errors: things Commons' renderer or upload filter will reject/mangle
  const scripts = all.filter((el) => el.localName === 'script');
  if (scripts.length) errors.push(`${scripts.length} <script> element(s) — Commons forbids scripting in SVG.`);
  const foreign = all.filter((el) => el.localName === 'foreignObject');
  if (foreign.length) errors.push(`${foreign.length} <foreignObject> element(s) — not supported by the Commons renderer.`);
  const remoteRefs = all.filter((el) => {
    const href = el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href') || '';
    return /^\s*(https?:)?\/\//i.test(href) || /^\s*data:text\/html/i.test(href);
  });
  if (remoteRefs.length) errors.push(`${remoteRefs.length} element(s) reference a remote resource — the render server cannot fetch it.`);
  const handlers = all.filter((el) => [...el.attributes].some((a) => /^on[a-z]+$/i.test(a.name)));
  if (handlers.length) errors.push(`${handlers.length} inline event handler(s) (on*) found.`);
  // SVG-Edit can compute non-finite numbers (e.g. gradient x1="Infinity") on some documents.
  const nonFinite = [...new Set((svgText.match(/[\w:-]+="[^"]*(?:Infinity|NaN)[^"]*"/g) || []))].slice(0, 5);
  if (nonFinite.length) errors.push(`non-finite numeric value(s) in the markup — renderers will fail on these: ${nonFinite.join(', ')}`);
  if (!root.getAttribute('xmlns')) errors.push('missing xmlns="http://www.w3.org/2000/svg" on the root element.');
  if (!root.getAttribute('viewBox') && !(root.getAttribute('width') && root.getAttribute('height'))) {
    errors.push('the root element has neither width/height nor viewBox — it has no intrinsic size.');
  }

  // --- soft warnings: legal but known to render differently than they look here
  const flowRoot = all.filter((el) => el.localName === 'flowRoot').length;
  if (flowRoot) warnings.push(`${flowRoot} <flowRoot> (Inkscape flowed text) — librsvg does not render it; convert to <text>.`);
  const textPath = all.filter((el) => el.localName === 'textPath').length;
  if (textPath) warnings.push(`${textPath} <textPath> — not implemented by librsvg; the browser preview will differ from the Commons thumbnail.`);
  const fonts = new Set();
  all.forEach((el) => {
    const f = el.getAttribute && el.getAttribute('font-family');
    const st = el.getAttribute && el.getAttribute('style');
    if (f) fonts.add(f);
    if (st && /font-family\s*:/.test(st)) fonts.add(st.split('font-family:')[1].split(';')[0]);
  });
  const risky = [...fonts].map((f) => f.split(',')[0].trim().replace(/["']/g, '').toLowerCase())
    .filter((f) => f && !SAFE_FONTS.includes(f));
  if (risky.length) warnings.push(`font-family not in the Wikimedia font list: ${[...new Set(risky)].join(', ')} — text may be substituted in the render.`);
  const rasters = all.filter((el) => el.localName === 'image' && /^data:image\//.test(el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href') || ''));
  if (rasters.length) info.push(`${rasters.length} embedded raster image(s) — allowed, but the file is no longer pure vector.`);

  // --- editor-cleanliness signals
  const layers = all.filter((el) => el.getAttribute('inkscape:label') || el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label'));
  const switches = all.filter((el) => el.localName === 'switch');
  const pathEls = all.filter((el) => el.localName === 'path');
  const maxD = pathEls.reduce((m, p) => Math.max(m, (p.getAttribute('d') || '').length), 0);
  const stats = {
    bytes: svgText.length,
    elements: all.length,
    groups: all.filter((el) => el.localName === 'g').length,
    namedLayers: layers.length,
    texts: all.filter((el) => el.localName === 'text' || el.localName === 'tspan').length,
    switches: switches.length,
    languages: [...new Set(switches.flatMap((s) => [...s.children].map((c) => c.getAttribute('systemLanguage')).filter(Boolean)))],
    paths: pathEls.length,
    longestPathData: maxD,
    images: all.filter((el) => el.localName === 'image').length,
    defs: all.filter((el) => el.localName === 'defs').length,
    hasInkscapeMeta: /sodipodi:|inkscape:/.test(svgText)
  };
  if (stats.namedLayers) info.push(`${stats.namedLayers} named layer(s) preserved — the file stays editable for the next person.`);
  if (stats.switches) info.push(`${stats.switches} <switch> block(s) for ${stats.languages.length || 'n'} translation language(s) present.`);
  if (maxD > 40000) warnings.push(`longest path "d" attribute is ${maxD} chars — heavy geometry; the editor may feel slow.`);

  return { ok: errors.length === 0, errors, warnings, info, stats, doc, root };
}

const GEO_ATTRS = ['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points',
  'width', 'height', 'transform', 'fill', 'stroke', 'stroke-width', 'style', 'opacity'];

/** Compare the loaded revision with the edited export → what actually changed, and how much. */
export function changeProfile (originalText, newText) {
  const before = signatureList(originalText);
  const after = signatureList(newText);
  let geometryChanged = 0; let shapeChanged = 0;
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const b = before[i]; const a = after[i];
    if (!b || !a) { shapeChanged++; continue; }
    if (b.geo !== a.geo) geometryChanged++;
    if (b.tag !== a.tag) shapeChanged++;
  }
  const textBefore = textsOf(originalText); const textAfter = textsOf(newText);
  let textChanged = 0;
  for (let i = 0; i < Math.max(textBefore.length, textAfter.length); i++) {
    if (textBefore[i] !== textAfter[i]) textChanged++;
  }
  const beforeSwitch = (originalText.match(/<switch\b/g) || []).length;
  const afterSwitch = (newText.match(/<switch\b/g) || []).length;
  const denominator = Math.max(before.length, 1);
  const ratio = +(geometryChanged / denominator).toFixed(3);
  const elementDelta = after.length - before.length;
  const structuralChange = shapeChanged > 0 || elementDelta !== 0;
  const editedNothing = geometryChanged === 0 && shapeChanged === 0 && textChanged === 0 && elementDelta === 0;
  const major = ratio > 0.5 || elementDelta > Math.max(10, before.length * 0.25) || (beforeSwitch && !afterSwitch);
  return {
    elementsBefore: before.length, elementsAfter: after.length, elementDelta,
    geometryChanged, shapeChanged, textChanged, ratio,
    switchesBefore: beforeSwitch, switchesAfter: afterSwitch,
    switchesLost: beforeSwitch > 0 ? beforeSwitch - afterSwitch : 0,
    textTotal: textAfter.length, structuralChange, editedNothing,
    verdict: major ? 'consider-new-file' : 'overwrite-ok'
  };
}

function signatureList (svgText) {
  let doc; let root;
  try { ({ doc, root } = parseSvg(svgText)); } catch { return []; }
  return [...root.querySelectorAll('*')].map((el) => ({
    tag: el.localName,
    id: el.getAttribute('id') || '',
    geo: GEO_ATTRS.map((a) => el.getAttribute(a) || '').join('|') + '#' + (el.textContent || '').trim().length
  }));
}

function textsOf (svgText) {
  return elementsOf(svgText)
    .filter((el) => el.localName === 'text' || el.localName === 'tspan')
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
}

/** Rasterise an SVG string in-page (used for the before/after thumbnails). */
export async function renderThumb (svgText, width = 300) {
  const { root } = parseSvg(svgText);
  let vb = root.getAttribute('viewBox');
  if (!vb) {
    const w = parseFloat(root.getAttribute('width')) || 640;
    const h = parseFloat(root.getAttribute('height')) || 480;
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const doc = new XMLSerializer().serializeToString(root);
  const blob = new Blob([doc], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('could not render SVG'));
      i.src = url;
    });
    const ratio = (img.height || 480) / (img.width || 640);
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.max(40, Math.round(width * ratio));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL('image/png'), nonBlank: isNonBlank(ctx, c) };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function isNonBlank (ctx, c) {
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4 * 37) {
    if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return true;
  }
  return false;
}

/** Minimal wikitext for a *new* file (existing files keep their description page untouched). */
export function newFileWikitext ({ description, source, author, license, date = new Date().toISOString().slice(0, 10) }) {
  return `== {{int:filedesc}} ==
{{Information
|description=${description || ''}
|date=${date}
|source=${source || '{{own}}'}
|author=${author || ''}
}}

== {{int:license-header}} ==
${license || '{{self|cc-by-sa-4.0}}'}

[[Category:SVG files]]`;
}

/* ---------------------------------------------------------------------------
 * Definition-preserving merge.
 *
 * SVG-Edit rewrites gradient/pattern/filter definitions on load: it drops
 * `gradientUnits="userSpaceOnUse"` and `gradientTransform`, re-expresses the coordinates relative to
 * the bounding box, and — when the original transform is degenerate — computes literal
 * `x1="Infinity"`. Measured on File:Subduction-en.svg (176 gradients): 173 rewritten, 3 corrupted
 * with non-finite numbers. Definitions are shared by many shapes and are almost never what the user
 * edits, so the editor offers to keep the *source* definitions verbatim and only take the user's
 * geometry/text/colour edits from the canvas.
 */
const DEF_TAGS = ['linearGradient', 'radialGradient', 'pattern', 'filter', 'clipPath', 'mask', 'marker', 'symbol', 'style'];

function defBlocks (svgText, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g');
  let m;
  while ((m = re.exec(svgText))) {
    const idm = m[0].match(/\bid="([^"]+)"/);
    out.push({ id: idm ? idm[1] : null, block: m[0] });
  }
  return out;
}

/** Report which definitions the export rewrote relative to the source. */
export function definitionDrift (originalText, exportText) {
  const report = { rewritten: [], corrupted: [], missing: [] };
  for (const tag of DEF_TAGS) {
    const orig = defBlocks(originalText, tag);
    for (const { id, block } of orig) {
      if (!id) continue;
      const inExport = defBlocks(exportText, tag).find((d) => d.id === id);
      if (!inExport) { report.missing.push(`${tag}#${id}`); continue; }
      if (/(?:Infinity|NaN)/.test(inExport.block)) report.corrupted.push(`${tag}#${id}: ${inExport.block.slice(0, 120)}`);
      else if (inExport.block.replace(/\s+/g, ' ') !== block.replace(/\s+/g, ' ')) report.rewritten.push(`${tag}#${id}`);
    }
  }
  report.total = report.rewritten.length + report.corrupted.length + report.missing.length;
  return report;
}

/** Put the original definition blocks back into the export, matched by id.
 *  A definition the user actually changed in the canvas (export ≠ canvas baseline) is left alone —
 *  the merge only undoes the editor's *own* rewrite of definitions the user never touched. */
export function preserveDefinitions (originalText, exportText, baselineText = null) {
  let out = exportText;
  let restored = 0;
  let skippedEdited = 0;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (const tag of DEF_TAGS) {
    const originals = new Map(defBlocks(originalText, tag).filter((d) => d.id).map((d) => [d.id, d.block]));
    if (!originals.size) continue;
    const baseline = baselineText
      ? new Map(defBlocks(baselineText, tag).filter((d) => d.id).map((d) => [d.id, d.block]))
      : null;
    out = out.replace(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'), (block) => {
      const idm = block.match(/\bid="([^"]+)"/);
      if (!idm || !originals.has(idm[1])) return block;
      const source = originals.get(idm[1]);
      if (norm(source) === norm(block)) return block;
      if (baseline && baseline.has(idm[1]) && norm(baseline.get(idm[1])) !== norm(block)) { skippedEdited++; return block; }
      restored++;
      return source;
    });
  }
  return { text: out, restored, skippedEdited };
}


/* ---------------------------------------------------------------------------
 * Preservation meter — "did the tool do the minimum, or did it transmogrify the file?"
 *
 * Two different questions, deliberately kept apart:
 *   1. TOOL CHURN  — what the editor rewrote on load/save with no user edits at all
 *      (this is the transmogrification axis: intermediate-format editors score terribly here).
 *   2. FILE MINIMALITY — how much the *saved* file differs from the *source* beyond the user's edit.
 *
 * Churn is attributed, not guessed: differences between source and saved that are also explained by
 * (baseline → saved) are treated as the user's edit and excluded. Every component is reported with its
 * measured value, so the number can be audited rather than trusted.
 */

const CENSUS_TAGS = ['g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan',
  'switch', 'use', 'symbol', 'defs', 'linearGradient', 'radialGradient', 'pattern', 'filter', 'clipPath',
  'mask', 'marker', 'style', 'image', 'metadata'];

/** DOM-based counting: matches by localName regardless of the prefix used in the document
 *  (`<text>` and `<svg:text>` are the same element; a regex on raw text counts only one of them). */
function elementsOf (svgText) {
  try { return [...parseSvg(svgText).root.querySelectorAll('*')]; } catch { return []; }
}

function censusOf (svgText) {
  const out = {};
  for (const t of CENSUS_TAGS) out[t] = 0;
  for (const el of elementsOf(svgText)) if (out[el.localName] !== undefined) out[el.localName]++;
  return out;
}

function counted (svgText, prop, value) {
  return elementsOf(svgText).filter((el) => el.localName === prop || (value && el.getAttribute(prop) === value)).length;
}

function languageValues (svgText) {
  return new Set(elementsOf(svgText).map((el) => el.getAttribute('systemLanguage')).filter(Boolean));
}

function prefixSet (svgText) {
  const root = (svgText.match(/<svg\b[^>]*>/) || [''])[0];
  return new Set([...root.matchAll(/xmlns:([\w-]+)=/g)].map((m) => m[1]));
}

function usedPrefixes (svgText) {
  return new Set([...svgText.matchAll(/([\w-]+):[\w-]+=/g)].map((m) => m[1])
    .filter((p) => !['xml', 'xmlns', 'xlink', 'svg'].includes(p)));
}

/** element-level signature list, used to attribute differences to the user's edit */
function elementSignatures (svgText) {
  let root;
  try { ({ root } = parseSvg(svgText)); } catch { return []; }
  return [...root.querySelectorAll('*')].map((el) => ({
    tag: el.localName,
    attrs: [...el.attributes].map((a) => a.name).sort().join(','),
    vals: [...el.attributes].sort((a, b) => a.name.localeCompare(b.name)).map((a) => a.name + '=' + a.value).join('|'),
    depth: (() => { let d = 0; let n = el; while (n.parentElement) { d++; n = n.parentElement; } return d; })()
  }));
}

export function preservationReport (sourceText, savedText, baselineText = null, opts = {}) {
  const components = [];
  const findings = [];
  const add = (key, label, weight, ratio, detail) => {
    const score = Math.max(0, Math.min(1, ratio)) * weight;
    components.push({ key, label, weight, score: +score.toFixed(1), ratio: +Math.max(0, Math.min(1, ratio)).toFixed(3), detail });
  };

  // what the user's own edit touched (excluded from churn attribution)
  const editedIdx = new Set();
  if (baselineText) {
    const b = elementSignatures(baselineText); const s = elementSignatures(savedText);
    for (let i = 0; i < Math.max(b.length, s.length); i++) {
      if (!b[i] || !s[i] || b[i].vals !== s[i].vals) editedIdx.add(i);
    }
  }

  /* 1. definitions — 25 */
  const dd = definitionDrift(sourceText, savedText);
  const defTotal = dd.total + (dd.rewritten.length + dd.corrupted.length + dd.missing.length === 0 ? 0 : 0);
  const defSources = DEF_TAGS.reduce((n, t) => n + defBlocks(sourceText, t).filter((b) => b.id).length, 0);
  const touched = dd.rewritten.length + dd.corrupted.length + dd.missing.length;
  add('definitions', 'Definition preservation', 20, defSources ? 1 - (touched / defSources) : 1,
    defSources ? `${touched} of ${defSources} definitions rewritten/corrupted/missing` : 'no id-bearing definitions in source');
  if (dd.corrupted.length) {
    const cap = Math.min(6, dd.corrupted.length * 3);
    components[components.length - 1].score = Math.max(0, components[components.length - 1].score - cap);
    findings.push({ level: 'err', text: `${dd.corrupted.length} definition(s) corrupted (non-finite values) — the saved file will not render as intended.` });
  }
  if (dd.missing.length) findings.push({ level: 'warn', text: `${dd.missing.length} definition(s) present in the source are absent from the saved file.` });

  /* 2. framing — 15 */
  const rTag = (t) => (t.match(/<svg\b[^>]*>/) || [''])[0];
  const rAttrs = (t) => Object.fromEntries([...rTag(t).matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const src = rAttrs(sourceText); const saved = rAttrs(savedText);
  const frameKeys = ['viewBox', 'preserveAspectRatio', 'width', 'height'];
  const frameOk = frameKeys.filter((k) => (src[k] || '') === (saved[k] || '')).length;
  add('framing', 'Framing (viewBox, size, aspect)', 12, frameOk / frameKeys.length,
    frameKeys.map((k) => `${k}: ${src[k] === saved[k] ? '=' : `“${src[k] || '—'}” → “${saved[k] || '—'}”`}`).join(' · '));
  if (frameOk < frameKeys.length) findings.push({ level: 'warn', text: 'Root framing differs from the source: the drawing may be reframed on Commons.' });

  /* 3. structure — 25 (census + wrapping + depth), excluding the user's own edit */
  const cs = censusOf(sourceText); const cd = censusOf(savedText);
  let censusChanged = 0; let censusTotal = 0;
  for (const t of CENSUS_TAGS) { censusTotal += Math.max(cs[t], 1); if (cs[t] !== cd[t]) censusChanged += Math.abs(cd[t] - cs[t]); }
  const structuralRatio = censusTotal ? 1 - (censusChanged / censusTotal) : 1;
  add('structure', 'Structure (element census, wrapping)', 20, structuralRatio,
    CENSUS_TAGS.filter((t) => cs[t] !== cd[t]).map((t) => `${t} ${cs[t]}→${cd[t]}`).join(', ') || 'element counts identical');
  const newRootWrapper = !baselineText && /<g class="layer">/.test(savedText) && !/<g class="layer">/.test(sourceText);
  if (/\bclass="layer"/.test(savedText) && !/\bclass="layer"/.test(sourceText)) findings.push({ level: 'info', text: 'The saved file wraps the drawing in a <g class="layer"> element that the source did not have (editor house style, mostly inert, still a source-level change).' });

  /* 4. text and translation — 15 */
  const sTexts = textsOf(sourceText); const dTexts = textsOf(savedText);
  const textKept = sTexts.length ? 1 - Math.abs(dTexts.length - sTexts.length) / Math.max(sTexts.length, 1) : 1;
  const swSrc = counted(sourceText, 'switch'); const swSaved = counted(savedText, 'switch');
  const langSrc = languageValues(sourceText);
  const langSaved = languageValues(savedText);
  const langsLost = [...langSrc].filter((l) => !langSaved.has(l));
  const textRatio = Math.min(textKept, swSrc ? (swSaved / swSrc) : 1);
  add('text', 'Text and translations', 12, textRatio,
    `${sTexts.length}→${dTexts.length} text/tspan · <switch> ${swSrc}→${swSaved} · ${langSaved.size} language value(s)`);
  if (langsLost.length) findings.push({ level: 'err', text: `${langsLost.length} translation language(s) lost: ${langsLost.slice(0, 4).join(', ')}` });
  else if (swSrc && swSaved < swSrc) findings.push({ level: 'warn', text: `<switch> blocks reduced ${swSrc}→${swSaved}; translations may be gone.` });

  /* 5. namespaces, metadata, cruft — 10 */
  const needPfx = usedPrefixes(savedText); const havePfx = prefixSet(savedText);
  const undeclared = [...needPfx].filter((p) => !havePfx.has(p));
  const mkSrc = (sourceText.match(/inkscape:[\w-]+=/g) || []).length + (sourceText.match(/sodipodi:[\w-]+=/g) || []).length;
  const mkSaved = (savedText.match(/inkscape:[\w-]+=/g) || []).length + (savedText.match(/sodipodi:[\w-]+=/g) || []).length;
  const cruft = (savedText.match(/\sse:[\w-]+=|contenteditable="/g) || []).length + (/xmlns:se=/.test(savedText) ? 1 : 0);
  let nsRatio = 1;
  if (undeclared.length) { nsRatio -= 0.6; findings.push({ level: 'err', text: `Namespace prefix used but not declared: ${undeclared.join(', ')} — the file is not well-formed XML.` }); }
  if (mkSrc && mkSaved < mkSrc) { nsRatio -= 0.3 * (1 - mkSaved / mkSrc); findings.push({ level: 'warn', text: `Editor metadata reduced: ${mkSrc}→${mkSaved} inkscape:/sodipodi: attributes (that metadata is what makes a file easy to edit again).` }); }
  if (cruft) { nsRatio -= 0.2; findings.push({ level: 'warn', text: `${cruft} editor artefact(s) (se:, contenteditable) added to the file.` }); }
  add('namespaces', 'Namespaces and editor metadata', 8, nsRatio,
    `prefixes ${[...havePfx].length} declared, ${needPfx.size} used${undeclared.length ? `, ${undeclared.length} UNDECLARED` : ''} · inkscape/sodipodi ${mkSrc}→${mkSaved} · cruft ${cruft}`);

  /* 6. attribute churn outside the user's edit — 10 */
  const sigS = elementSignatures(sourceText); const sigD = elementSignatures(savedText);
  let attrChanged = 0; let compared = 0;
  for (let i = 0; i < Math.max(sigS.length, sigD.length); i++) {
    const a = sigS[i]; const b = sigD[i];
    if (!a || !b) continue;
    compared++;
    if (editedIdx.has(i)) continue;                      // the user's own edit is not churn
    if (a.tag !== b.tag || a.attrs !== b.attrs) attrChanged++;
  }
  const churnRatio = compared ? 1 - Math.min(1, attrChanged / compared) : 1;
  add('attributes', 'Attribute churn outside your edit', 8, churnRatio,
    compared ? `${attrChanged} of ${compared} elements had attributes added/removed by the tool (your ${editedIdx.size} edited element(s) excluded)` : 'no elements to compare');

  /* 7. visual consistency — 20. Structure can be perfect while the drawing is destroyed
     (measured: an embedded-raster SVG kept every element yet 93.8% of pixels changed). */
  if (typeof opts.pixelDiffPercent === 'number') {
    const pd = opts.pixelDiffPercent;
    // 0% -> full marks; 2% (the acceptance threshold) -> 0.9; 20% and above -> 0
    const ratio = pd <= 2 ? 1 - (pd / 2) * 0.1 : Math.max(0, 0.9 - ((pd - 2) / 18) * 0.9);
    add('visual', 'Visual consistency (rendered)', 20, ratio, `${pd}% of pixels differ between the source and the saved file (browser render at ${opts.diffWidth || 500}px)`);
    if (pd > 20) findings.push({ level: 'err', text: `${pd}% of pixels changed — the saved file does not look like the source; do not overwrite.` });
    else if (pd > 5) findings.push({ level: 'warn', text: `${pd}% of pixels differ from the source (threshold 2%) — check the before/after previews.` });
  } else {
    add('visual', 'Visual consistency (rendered)', 20, 0.5, 'not measured yet — press “compare renders (pixel diff)”');
  }

  const score = Math.round(components.reduce((n, c) => n + c.score, 0));
  const grade = score >= 95 ? 'A' : score >= 85 ? 'B' : score >= 70 ? 'C' : score >= 50 ? 'D' : 'F';
  const verdict = score >= 95 ? 'Minimal edit — the tool changed essentially only what you changed.'
    : score >= 85 ? 'Low-normalisation save — the tool added its own house style (ids, layer grouping) but preserved the file.'
    : score >= 70 ? 'Noticeable normalisation — definitions or attributes were regenerated; review the diff before overwriting.'
    : score >= 50 ? 'Heavy rewrite — the saved file is structurally different from the source; per COM:OVERWRITE prefer a new file.'
    : 'Do not overwrite — the saved file is corrupted or materially restructured.';
  return { score, grade, verdict, components, findings, churn: {
    definesTouched: touched, defsCorrupted: dd.corrupted.length, defsMissing: dd.missing.length,
    censusChanged, langsLost: langsLost.length, undeclaredPrefixes: undeclared, cruft,
    attrChanged, compared, editedElements: editedIdx.size, newRootWrapper } };
}

/* ------------------------------------------------------------ visual compare */

/**
 * Restore the root element's framing attributes (viewBox, preserveAspectRatio, width, height).
 * SVG-Edit drops `viewBox` and strips CSS units from width/height when it loads a document
 * (measured 2026-09-10 on File:Subduction-en.svg and File:Osmotic pressure on blood cells
 * diagram.svg). For a viewBox whose origin is not 0 0 that silently reframes the whole drawing —
 * 39% and 58% of pixels differed before this repair. Framing is document metadata that a vector
 * editor almost never changes implicitly, so it is restored from the source by default.
 * String-level edit: the rest of the export stays byte-identical.
 */
export function preserveRootFraming (originalText, exportText, baselineText = null) {
  const tag = (t) => (t.match(/<svg\b[^>]*>/) || [''])[0];
  const attrs = (t) => Object.fromEntries([...t.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const srcTag = tag(originalText); const expTag = tag(exportText);
  if (!srcTag || !expTag) return { text: exportText, applied: false, attributes: [] };
  const s = attrs(srcTag); const e = attrs(expTag);
  // if the user resized the document in the editor, respect that and restore nothing
  if (baselineText) {
    const b = attrs(tag(baselineText));
    if (b.width !== e.width || b.height !== e.height) return { text: exportText, applied: false, attributes: [], reason: 'canvas size changed in the editor' };
  }
  const changed = [];
  let newTag = expTag;
  for (const a of ['viewBox', 'preserveAspectRatio', 'width', 'height']) {
    if (!s[a] || s[a] === e[a]) continue;
    if (e[a] !== undefined) newTag = newTag.replace(new RegExp(`\\s${a}="[^"]*"`), ` ${a}="${s[a]}"`);
    else newTag = newTag.replace(/<svg\b/, `<svg ${a}="${s[a]}"`);
    changed.push(a);
  }
  return { text: changed.length ? exportText.replace(expTag, newTag) : exportText, applied: changed.length > 0, attributes: changed };
}
/** Render two SVG strings side by side in the browser and report the share of differing pixels.
 *  This is a browser-render comparison, not librsvg — indicative, not authoritative. */
export async function pixelDiff (aText, bText, width = 600) {
  const [a, b] = await Promise.all([rasterise(aText, width), rasterise(bText, width)]);
  const h = Math.min(a.height, b.height);
  const ctxA = a.getContext('2d'); const ctxB = b.getContext('2d');
  const da = ctxA.getImageData(0, 0, a.width, h).data;
  const db = ctxB.getImageData(0, 0, b.width, h).data;
  let diff = 0; let total = 0;
  for (let i = 0; i < da.length; i += 4) {
    total++;
    if (Math.abs(da[i] - db[i]) > 12 || Math.abs(da[i + 1] - db[i + 1]) > 12 || Math.abs(da[i + 2] - db[i + 2]) > 12) diff++;
  }
  return { percentDifferent: +(100 * diff / total).toFixed(2), width: a.width, height: h,
    aPng: a.toDataURL('image/png'), bPng: b.toDataURL('image/png') };
}

async function rasterise (svgText, width) {
  const { root } = parseSvg(svgText);
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width')) || 640;
    const h = parseFloat(root.getAttribute('height')) || 480;
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('render failed'));
      i.src = url;
    });
    const ratio = (img.height || 480) / (img.width || 640);
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.max(40, Math.round(width * ratio));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

