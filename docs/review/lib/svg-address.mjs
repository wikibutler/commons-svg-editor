/**
 * svg-address.mjs — Epic A2: how a *rendered* shape maps back to a *source* node, and which edits are safe.
 *
 * The prototype's first attempt patched "the first element carrying an id" and found that 33 of 37 targets were
 * gradient/filter/pattern definitions — i.e. `id` is not a handle on what the user clicked. This module replaces
 * that with an address that is stable, verifiable and derived from the file itself:
 *
 *   address = <document-order index> : <tag> : <fingerprint>
 *   fingerprint = id, else nearest ancestor id + tag, else class + tag
 *
 * The render side of the mapping is the caller's job (a click on the canvas gives a DOM element; document order
 * is preserved by every XML parser, so index → source span is a direct lookup). What this module guarantees is
 * that a *source* address resolves back to the same element with the same fingerprint before any edit is allowed:
 * if the file changed underneath us, the edit is refused rather than applied to the wrong node.
 *
 * Second job: an editable-subset inventory, expressed as rules that can be checked against the text rather than
 * asserted in a document. Every edit is classified as safe / caution / refuse with a reason.
 */
import { parseSvg, flatten } from './svg-tree.mjs';

const HIDDEN_CTX = ['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'filter', 'linearGradient',
  'radialGradient', 'metadata', 'title', 'desc', 'style', 'script', 'switch'];
const SHAPES = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text', 'tspan', 'image'];
const REF_ATTRS = ['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'href', 'xlink:href'];
const STYLE_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'clip-rule', 'opacity', 'color',
  'stop-color', 'stop-opacity', 'font-size', 'font-family', 'font-style', 'font-weight', 'paint-order'];
const GEOM_ATTRS = ['d', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'transform', 'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'offset'];

const local = (tag) => tag.includes(':') ? tag.split(':').pop() : tag;

export function buildIndex (text) {
  const root = parseSvg(text);
  const flat = flatten(root);
  const nodes = flat.map((f, i) => {
    const el = f.node;
    const ancestors = [];
    for (let p = el.parent; p && p.tag !== '#root'; p = p.parent) ancestors.push(local(p.tag));
    const ctx = ancestors.filter((a) => HIDDEN_CTX.includes(a));
    const t = local(el.tag);
    const fingerParent = ancestors.find((a) => a) || 'root';
    const fingerprint = el.id || (el.attrs['class'] ? 'class=' + el.attrs['class'] : fingerParent + '/' + t);
    return {
      docIndex: i, path: f.path, tag: t, rawTag: el.tag, attrs: el.attrs, id: el.id || null,
      address: `${i}:${t}:${fingerprint}`,
      fingerprint,
      inDefinition: ctx.some((c) => ['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'filter', 'linearGradient', 'radialGradient', 'metadata', 'title', 'desc', 'style', 'script'].includes(c)),
      inSwitch: ctx.includes('switch'),
      isShape: SHAPES.includes(t),
      hasInlineStyle: Boolean(el.attrs.style),
      hasClass: Boolean(el.attrs['class']),
      usesReference: Object.entries(el.attrs).some(([k, v]) => REF_ATTRS.includes(local(k)) && /url\(#/.test(String(v)))
    };
  });
  // does the document carry a CSS block? if so, class-based rules can override presentation attributes
  const hasStyleBlock = /<style[\s>]/.test(text) || /<[a-zA-Z0-9]*:?style[\s>]/.test(text);
  return { nodes, hasStyleBlock, byAddress: new Map(nodes.map((n) => [n.address, n])), text };
}

/** Resolve an address, verifying the fingerprint so an edit can never land on the wrong element. */
export function resolve (index, address) {
  const n = index.byAddress.get(address);
  if (!n) return { ok: false, reason: 'address not present in this revision (file changed?)' };
  return { ok: true, node: n };
}

// Kinds are derived from a census of the 44-file corpus (see docs/EDITABLE-SUBSET.md), not from the spec.
const FILTER_PARAMS = ['stdDeviation', 'in', 'in2', 'result', 'operator', 'radius', 'dx', 'dy', 'scale', 'values',
  'tableValues', 'slope', 'intercept', 'amplitude', 'exponent', 'azimuth', 'elevation', 'surfaceScale',
  'specularConstant', 'specularExponent', 'kernelMatrix', 'kernelUnitLength', 'targetX', 'targetY', 'edgeMode',
  'preserveAlpha', 'xChannelSelector', 'yChannelSelector', 'color-interpolation-filters'];
const DEFN_PARAMS = ['patternTransform', 'patternUnits', 'patternContentUnits', 'clipPathUnits', 'maskUnits',
  'maskContentUnits', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'markerUnits', 'markerWidth',
  'markerHeight', 'refX', 'refY', 'orient', 'primitiveUnits', 'filterUnits', 'startOffset', 'method', 'spacing',
  'textLength', 'lengthAdjust', 'text-anchor', 'dominant-baseline', 'baseline-shift', 'letter-spacing', 'word-spacing'];
const A11Y = ['role', 'aria-label', 'aria-labelledby', 'aria-hidden', 'data-name', 'tabindex', 'focusable'];
const DOC_META = ['version', 'baseProfile', 'standalone', 'encoding', 'enable-background', 'xml:space', 'xml:lang',
  'xmlns', 'xmlns:xlink', 'xmlns:svg', 'type', 'effect', 'rdf:resource', 'rdf:about', 'dc:title', 'dc:source'];

export function classifyAttr (name) {
  const n = local(name);
  if (name.startsWith('inkscape:') || name.startsWith('sodipodi:') || name.startsWith('xmlns') || n.endsWith(':resource') || n.endsWith(':about')) return 'metadata';
  if (DOC_META.includes(n) || n.startsWith('xml:')) return 'metadata';
  if (n === 'style') return 'inline-style';                       // the carrier itself: edit the declaration, not the attribute list
  if (STYLE_ATTRS.includes(n)) return 'style';
  if (GEOM_ATTRS.includes(n)) return 'geometry';
  if (FILTER_PARAMS.includes(n)) return 'filter-param';            // inside a filter/effect graph: preserve verbatim
  if (DEFN_PARAMS.includes(n)) return 'definition-param';          // gradient/marker/pattern/text placement: preserve verbatim
  if (REF_ATTRS.includes(n)) return 'reference';
  if (A11Y.includes(n)) return 'a11y';
  if (n === 'systemLanguage' || n === 'requiredFeatures' || n === 'requiredExtensions') return 'conditional';
  if (n === 'id' || n === 'class') return 'identity';
  return 'unknown';
}

/**
 * Can this attribute be edited on this node? Returns {decision, reason, effectiveCarrier}.
 * `effectiveCarrier` is the honest part: a presentation attribute is often NOT what renders.
 */
export function canEdit (index, node, attr) {
  const kind = classifyAttr(attr);
  const a = local(attr);
  if (!node) return { decision: 'refuse', reason: 'no node' };
  if (kind === 'unknown') return { decision: 'refuse', reason: `attribute "${a}" is not in the editable subset; preserve verbatim` };
  if (kind === 'filter-param' || kind === 'definition-param') return { decision: 'refuse', reason: `${kind}: part of a definition or filter graph; this tool preserves it verbatim rather than editing it` };
  if (kind === 'a11y') return { decision: 'caution', reason: 'accessibility metadata: safe to splice, but it is not visible in the drawing' };
  if (kind === 'inline-style') return { decision: 'caution', reason: 'inline style declaration: edit the property inside it (per-property splice), never re-serialise the whole attribute' };
  if (kind === 'reference') return { decision: 'caution', reason: 'reference attribute: the target definition must be preserved byte-for-byte and the reference must not be orphaned' };
  if (kind === 'identity') return { decision: 'caution', reason: 'changing id/class can break references elsewhere in the file' };
  if (kind === 'metadata') return { decision: 'refuse', reason: 'editor metadata is preserved, never rewritten by this tool' };

  // cascade hazards: the attribute may not be what actually paints
  let carrier = null;
  if (node.attrs.style && new RegExp(`(^|;|\\s)${a}\\s*:`).test(node.attrs.style)) {
    carrier = 'inline style attribute on this element (overrides a presentation attribute)';
  } else if (index.hasStyleBlock && node.hasClass) {
    carrier = 'CSS rules in a <style> block may match this element\'s class';
  }
  const value = String(node.attrs[attr] ?? '');
  const isRef = REF_ATTRS.includes(a) && /url\(#/.test(value);

  if (kind === 'style') {
    if (carrier) return { decision: 'caution', reason: `the value that renders may come from ${carrier}; edit that declaration, not the presentation attribute`, effectiveCarrier: carrier, effectiveAttr: carrierClause(node, a) };
    if (isRef) return { decision: 'caution', reason: 'value is a reference to a definition (url(#…)); retargeting it can orphan that definition, and the definition itself must be preserved byte-for-byte' };
    if (node.inDefinition) return { decision: 'caution', reason: 'element lives in a definition (defs/clipPath/mask/pattern/marker/symbol): editing it changes every referencing shape, and such edits do not show up as a local change in the render' };
    if (node.inSwitch) return { decision: 'safe', reason: 'editable: inside a <switch> branch, which is exactly what the SVG Translate tool edits (text/attributes per language)' };
    return { decision: 'safe', reason: 'literal style value on a rendered element: byte-minimal splice, no model needed' };
  }
  if (kind === 'geometry') {
    if (isRef) return { decision: 'caution', reason: 'geometry value carries a reference; preserve unless the user is explicitly retargeting it' };
    return { decision: 'safe', reason: 'numeric/coordinate value: a splice is faithful, but a wrong value is a drawing change that a source diff will not explain' };
  }
  if (kind === 'conditional') {
    return { decision: 'caution', reason: 'conditional-processing attribute: changing it changes which branch renders in different renderers' };
  }
  return { decision: 'refuse', reason: 'unclassified' };
}

// find the property name inside an inline style that actually wins
function carrierClause (node, a) {
  const m = new RegExp(`(^|;)\\s*(${a.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})\\s*:[^;]*`).exec(node.attrs.style || '');
  return m ? m[0].replace(/^;/, '').trim() : a;
}

/** The visible, editable shapes: rendered elements that are not inside a definition or a hidden context. */
export function visibleShapes (index) {
  return index.nodes.filter((n) => n.isShape && !n.inDefinition && !['tspan'].includes(n.tag));
}

/** Corpus-level inventory: what this file contains, and how much of it an editor could touch. */
export function subsetReport (text) {
  const index = buildIndex(text);
  const kinds = {};
  const attrKinds = {};
  let refAttrs = 0; let cssRisk = 0; let inlineStyle = 0; let inDef = 0;
  for (const n of index.nodes) {
    kinds[n.tag] = (kinds[n.tag] || 0) + 1;
    if (n.inDefinition) inDef++;
    if (n.hasInlineStyle) inlineStyle++;
    if (index.hasStyleBlock && n.hasClass) cssRisk++;
    for (const k of Object.keys(n.attrs)) {
      const cls = classifyAttr(k);
      attrKinds[cls] = (attrKinds[cls] || 0) + 1;
      if (REF_ATTRS.includes(local(k)) && /url\(#/.test(String(n.attrs[k]))) refAttrs++;
    }
  }
  const shapes = visibleShapes(index);
  const editableNow = shapes.filter((n) => {
    const styleAttrs = Object.keys(n.attrs).filter((k) => classifyAttr(k) === 'style');
    return styleAttrs.length > 0 && canEdit(index, n, styleAttrs[0]).decision === 'safe';
  });
  return {
    elements: index.nodes.length, definitions: inDef, visibleShapes: shapes.length,
    safeStyleTargets: editableNow.length, referenceAttrs: refAttrs, inlineStyleAttrs: inlineStyle,
    cssClassRisk: cssRisk, hasStyleBlock: index.hasStyleBlock, attributeKinds: attrKinds, topTags: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 12)
  };
}
