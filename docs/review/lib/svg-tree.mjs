/**
 * svg-tree.mjs — a lightweight structural view of an SVG, built from the text.
 *
 * Why not a DOM: the review layer must describe what changed *in the file*, not in some parsed representation of
 * it. This walks the raw text with a quote-aware scanner (no DOMParser dependency, so the same code runs in Node
 * for measurement and in the browser for the UI) and records every element with its byte span, so a reviewer can
 * be pointed at the exact characters.
 */
import { scanTags } from './svg-patch.mjs';

export function parseSvg (text) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, start: 0, end: text.length, text: '' };
  const stack = [root];
  const ents = scanTags(text).filter((t) => !/^<\?|^<!/.test(t.raw));
  for (const t of ents) {
    const top = stack[stack.length - 1];
    if (t.closing) {
      if (top !== root && top.tag === t.name) stack.pop();
      continue;
    }
    const node = {
      tag: t.name, attrs: {}, parent: top, children: [], start: t.start, end: t.end,
      selfClosing: t.selfClosing, text: ''
    };
    for (const a of t.attrs) node.attrs[a.name] = a.value;
    node.id = node.attrs.id || null;
    top.children.push(node);
    if (!t.selfClosing) stack.push(node);
  }
  // text content of leaf elements (between start and the first child / closing tag)
  (function walk (n) {
    for (const c of n.children) {
      const first = c.children.length ? c.children[0].start : null;
      const close = text.indexOf('</' + c.tag, c.end);
      if (!first && close > c.end) c.text = text.slice(c.end, close).trim();
      walk(c);
    }
  })(root);
  return root;
}

/** document-order list with a stable path, so the same element can be found in both revisions */
export function flatten (root) {
  const out = [];
  (function walk (n, path) {
    n.children.forEach((c, i) => {
      const p = path + '/' + i;
      out.push({ node: c, path: p, key: c.id ? `${c.tag}#${c.id}` : `${c.tag}@${p}` });
      walk(c, p);
    });
  })(root, '');
  return out;
}

/** preservation-relevant facts about a single document, as counts */
export function facts (text, root = parseSvg(text)) {
  const c = {};
  const all = flatten(root).map((f) => f.node);
  c.elements = all.length;
  c.comments = (text.match(/<!--/g) || []).length;
  c.switch = all.filter((n) => n.tag === 'switch' || n.tag.endsWith(':switch')).length;
  c.systemLanguage = new Set(all.map((n) => n.attrs.systemLanguage).filter(Boolean)).size;
  c.textNodes = all.filter((n) => n.tag === 'text' || n.tag.endsWith(':text')).length;
  c.tspan = all.filter((n) => n.tag === 'tspan' || n.tag.endsWith(':tspan')).length;
  c.gradients = all.filter((n) => /Gradient$/.test(n.tag)).length;
  c.defsIds = new Set(all.filter((n) => n.id && n.parent && n.parent.tag === 'defs').map((n) => n.id)).size;
  c.filters = all.filter((n) => n.tag === 'filter').length;
  c.patterns = all.filter((n) => n.tag === 'pattern').length;
  c.markers = all.filter((n) => n.tag === 'marker').length;
  c.images = all.filter((n) => n.tag === 'image' || n.tag.endsWith(':image')).length;
  c.embeddedRaster = (text.match(/data:image\//g) || []).length;
  c.styleAttrs = all.filter((n) => n.attrs.style).length;
  c.classAttrs = all.filter((n) => n.attrs['class']).length;
  c.inkscape = (text.match(/(inkscape|sodipodi):[\w-]+=/g) || []).length;
  c.namedview = (text.match(/<sodipodi:namedview|<inkscape:(namedview|page)/g) || []).length;
  c.namespaces = (text.match(/xmlns:[\w-]+=/g) || []).length;
  const rootAttrs = root.children.find((n) => n.tag === 'svg' || n.tag.endsWith(':svg')) || root.children[0] || { attrs: {} };
  c.viewBox = rootAttrs.attrs.viewBox || null;
  c.width = rootAttrs.attrs.width || null;
  c.height = rootAttrs.attrs.height || null;
  c.preserveAspectRatio = rootAttrs.attrs.preserveAspectRatio || null;
  c.bytes = text.length;
  return c;
}
