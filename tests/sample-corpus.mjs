/**
 * sample-corpus.mjs — draw a reproducible, stratified sample of Commons SVG files.
 *
 * Commons has ~5.3 million SVG files (search totalhits, 2026-09-10). Sampling all of them is neither
 * possible nor useful; sampling a few hundred *stratified* files is both. This script draws from the
 * community's own categories plus a few feature-targeted searches, keeps each stratum's selection
 * seeded (so the sample can be regenerated and audited), and pins each file's sha1 so results stay
 * comparable when files change on-wiki (they do — that is the whole reason the suite cannot trust URLs).
 *
 * Politeness (measured: a 16-thread burst got rate-limited after ~25 files):
 *   · metadata only (category members + imageinfo), no file content fetched here
 *   · sequential requests, 1.1 s apart, descriptive User-Agent, exponential backoff on 429/5xx
 *   · responses cached under corpus/cache/ so re-runs cost nothing
 *
 * Usage: node tests/sample-corpus.mjs [--per-stratum 6] [--seed 20260910] [--out corpus/sample-45.json]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const UA = 'HermesAgent/1.0 (https://en.wikipedia.org/wiki/User:Fuzheado) commons-svg-editor research; contact via GitHub wikibutler/commons-svg-editor';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = ROOT + 'corpus/cache';
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const PER = Number(flag('per-stratum', 6));
const SEED = Number(flag('seed', 20260910));
const outArg = flag('out', 'corpus/sample.json');
const OUT = outArg.startsWith('/') ? outArg : ROOT + outArg;

/* deterministic RNG so a sample can be reproduced from its seed */
function mulberry32 (a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr, n) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function api (params) {
  // Full-length digest: a truncated key collided between different title lists and silently served
  // the wrong cached response (16 picked files vanished from the sample because of it).
  const key = CACHE + '/' + createHash('sha256').update(JSON.stringify(params)).digest('hex') + '.json';
  if (existsSync(key)) return JSON.parse(readFileSync(key, 'utf8'));
  for (let attempt = 0; attempt < 5; attempt++) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2' })) u.searchParams.set(k, String(v));
    try {
      calls++;
      const res = await fetch(u, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error(j.error.code + ': ' + (j.error.info || '').slice(0, 80));
      writeFileSync(key, JSON.stringify(j));
      await sleep(1100);                                    // be a good citizen, always
      return j;
    } catch (e) {
      const wait = 2000 * Math.pow(2, attempt);
      console.log(`   retry in ${wait / 1000}s (${e.message})`);
      await sleep(wait);
    }
  }
  throw new Error('giving up on ' + JSON.stringify(params).slice(0, 120));
}

async function categoryFiles (cat, limit = 500) {
  const out = [];
  let cont = null;
  do {
    const p = { action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: '500', cmtype: 'file' };
    if (cont) p.cmcontinue = cont;
    const d = await api(p);
    out.push(...d.query.categorymembers.map((m) => m.title));
    cont = d.continue?.cmcontinue || null;
    if (out.length >= limit) break;
  } while (cont);
  return out;
}

async function searchFiles (q, limit = 200) {
  const out = [];
  let off = 0;
  let total = Infinity;
  while (off < Math.min(limit, total)) {
    const d = await api({ action: 'query', list: 'search', srsearch: q, srnamespace: '6', srlimit: '50', sroffset: off });
    if (!d.query) break;
    out.push(...d.query.search.map((h) => h.title));
    total = d.query.searchinfo ? d.query.searchinfo.totalhits : out.length;
    off += 50;
    if (d.query.search.length < 50) break;
  }
  return out;
}

async function imageinfo (titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const d = await api({ action: 'query', prop: 'imageinfo', redirects: 1, iiprop: 'url|size|sha1|mime', titles: titles.slice(i, i + 40).join('|') });
    for (const p of d.query.pages) {
      const ii = (p.imageinfo || [])[0];
      if (ii && ii.mime === 'image/svg+xml') out[p.title] = { url: ii.url.split('?')[0], size: ii.size, sha1: ii.sha1 };
    }
  }
  return out;
}

/* ---------------------------------------------------------------- strata */

const STRATA = [
  { id: 'icon/logo',        why: 'tiny files, few elements: the cheap end of the space', source: async () => {
      try { const c = await categoryFiles('Category:SVG logos', 200); if (c.length) return c; } catch { /* fall through */ }
      return searchFiles('filetype:svg incategory:"SVG logos"', 150);
    } },
  { id: 'diagram',          why: 'schematics — the most common editorial use of SVG', source: () => categoryFiles('Category:SVG diagrams', 200) },
  { id: 'map',              why: 'geography: many paths, often gradients and non-zero viewBox', source: () => categoryFiles('Category:SVG maps', 200) },
  { id: 'chart/graph',      why: 'numerical data graphics: patterns, filters, thin geometry', source: () => categoryFiles('Category:SVG charts', 200) },
  { id: 'multilingual',     why: '<switch>/systemLanguage translation layers', source: () => searchFiles('filetype:svg insource:"systemLanguage"', 150) },
  { id: 'embedded-raster',  why: 'data: URI bitmaps inside SVG', source: () => searchFiles('filetype:svg insource:"data:image/png;base64"', 100) },
  { id: 'known-hard',       why: 'files the community has already filed as renderer bugs', source: () => categoryFiles('Category:Pictures showing a librsvg bug (unsolved)', 100) },
  { id: 'inkscape-native',  why: 'Inkscape-authored: sodipodi metadata, flowRoot, layers', source: () => categoryFiles('Category:Pictures showing a librsvg bug:Inkscape', 100) },
  { id: 'svg2-features',    why: 'files using post-1.1 features', source: () => categoryFiles('Category:Images with SVG 2.0 features', 100) }
];

const existing = JSON.parse(readFileSync(ROOT + 'corpus/corpus.json', 'utf8'));
const already = new Set(existing.corpus.map((c) => c.title));

const chosen = [];
for (const s of STRATA) {
  let pool = [];
  try { pool = await s.source(); } catch (e) { console.log(`!! stratum ${s.id}: ${e.message}`); continue; }
  const fresh = pool.filter((t) => !already.has(t));
  chosen.push({ stratum: s.id, why: s.why, poolSize: fresh.length, titles: pick(fresh, PER) });
  console.log(`${s.id.padEnd(17)} pool ${String(fresh.length).padStart(4)}  → ${Math.min(PER, fresh.length)} picked`);
}

/* ------------------------------------------------------------- pin sha1s */

const all = [];
for (const s of chosen) for (const t of s.titles) all.push(t);
console.log(`\nresolving imageinfo for ${all.length} files…`);
const info = await imageinfo(all);
console.log(`api calls: ${calls} (rest served from corpus/cache/)`);

const corpus = [];
for (const s of chosen) {
  for (const t of s.titles) {
    const ii = info[t];
    if (!ii) continue;
    corpus.push({ title: t, stratum: s.stratum, why: s.why, bytes: ii.size, sha1: ii.sha1, url: ii.url });
  }
}
corpus.sort((a, b) => a.bytes - b.bytes);
const manifest = {
  generated: new Date().toISOString(), seed: SEED, perStratum: PER,
  note: 'Reproducible stratified sample of Wikimedia Commons SVG files. sha1 pins the revision the sample was drawn from — re-verify before comparing runs, because Commons files change.',
  strata: chosen.map((c) => ({ id: c.stratum, why: c.why, poolSize: c.poolSize, picked: c.titles.length })),
  corpus
};
writeFileSync(OUT, JSON.stringify(manifest, null, 1));
console.log(`\nwrote ${OUT}: ${corpus.length} files, ${(corpus.reduce((n, c) => n + c.bytes, 0) / 1048576).toFixed(1)} MB`);
console.log('by stratum:', corpus.reduce((a, c) => (a[c.stratum] = (a[c.stratum] || 0) + 1, a), {}));
