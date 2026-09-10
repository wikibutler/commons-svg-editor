/**
 * roundtrip.mjs — headless end-to-end test of the prototype against real Commons files.
 *
 * Per file it checks:
 *   1. the browser can fetch the raw SVG bytes from upload.wikimedia.org (CORS)
 *   2. those bytes hash to the sha1 the Commons API reports (conflict-guard premise)
 *   3. SVG-Edit loads the file; the canvas holds its elements
 *   4. a real edit made through the canvas API survives into the export
 *   5. the export is well-formed, passes the Commons pre-flight checks, still renders
 *   6. fidelity: which SVG constructs survive a load→save cycle (switch/text/gradients/…)
 *   7. the save panel's own logic: change profile vs baseline, drift, no-edit guard
 * Then, once: the OAuth-authenticated upload endpoint must be reachable from a foreign origin
 * (invalid bearer → Wikimedia API error, never a browser CORS failure).
 *
 * Run: node tests/roundtrip.mjs [--files "File:A.svg,File:B.svg"] [--headed]
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');

const PORT = 4181;
const BASE = `http://127.0.0.1:${PORT}/`;
const EXE = '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome';
const OUT = fileURLToPath(new URL('../test-results/', import.meta.url));

const DEFAULT_FILES = [
  'File:Flag of Japan.svg',                       // 209 B    sanity
  'File:Osmotic pressure on blood cells diagram.svg', // 57 KB  6 <switch> i18n blocks + 54 text runs
  'File:Flagellum base diagram-en.svg',           // 124 KB  classic Inkscape-era diagram
  'File:Ancient Egypt map-en.svg',                // 849 KB  Inkscape layers + gradients
  'File:BlankMap-World.svg',                      // 1.1 MB  heavy geometry (2800 shapes)
  'File:Subduction-en.svg'                        // 2.4 MB  long-tail stress case
];

const args = process.argv.slice(2);
const filesArg = args.indexOf('--files');
const FILES = filesArg >= 0 ? args[filesArg + 1].split(',').map((s) => s.trim()) : DEFAULT_FILES;
const HEADED = args.includes('--headed');

const results = { startedAt: new Date().toISOString(), base: BASE, files: [], pageErrors: [], failedRequests: [], uploadBoundary: null, unit: null };

function startServer () {
  const p = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(p); });
    p.stderr.on('data', (d) => reject(new Error('server: ' + d)));
    setTimeout(() => reject(new Error('server did not start')), 10000);
  });
}

const server = await startServer();
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: EXE, headless: !HEADED, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') results.pageErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => results.pageErrors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) results.failedRequests.push(`${r.status()} ${r.url()}`); });

await mkdir(OUT, { recursive: true });
await mkdir(OUT + 'exports', { recursive: true });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse && window.__cse.ready, null, { timeout: 60000 });

/* ------------------------------------------------------- client-side units */

results.unit = await page.evaluate(async () => {
  const n = window.__cse;
  const verifier = n.randomVerifier();
  const challenge = await n.pkceChallenge(verifier);
  const expected = await (async () => {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  })();
  const url = n.buildAuthorizeUrl({ clientId: 'CLIENT123', redirectUri: 'https://tools.example/app/', state: 'st4te', challenge, scopes: 'basic uploadfile' });
  const titles = ['Flag of Japan.svg', 'File:Flag_of_Japan.svg', 'https://commons.wikimedia.org/wiki/File:Subduction-en.svg', 'special:filepath/BlankMap-World.svg']
    .map((t) => { try { return n.normalizeTitle(t); } catch (e) { return 'ERROR: ' + e.message; } });
  let rejected = ''; try { n.normalizeTitle('File:Picture.jpg'); } catch (e) { rejected = e.message; }
  // conflict-guard logic: a stale sha1 must be reported stale
  const stale = await n.checkFreshness('0000000000000000000000000000000000000000', 'File:Flag of Japan.svg');
  return {
    verifierLength: verifier.length, verifierIsBase64Url: /^[A-Za-z0-9_-]+$/.test(verifier),
    challengeIsSha256OfVerifier: challenge === expected,
    authorizeUrl: url, normalized: titles, nonSvgRejected: rejected,
    sha1OfAbc: await n.sha1Hex(new TextEncoder().encode('abc')),
    staleSha1Detected: stale.fresh === false, liveSha1: stale.current.sha1
  };
});

/* ------------------------------------------------------------- per-file run */

for (const title of FILES) {
  const rec = { title, ok: false };
  const t0 = Date.now();
  try {
    const load = await page.evaluate(async (t) => {
      const info = await window.__cse.getFileInfo(t);
      await window.__cse.loadFromCommons(t);
      const st = window.__cse.state;
      const content = document.querySelector('#svgcontent');
      const count = (sel) => content.querySelectorAll(sel).length;
      const fidelity = (text) => {
        const m = {};
        for (const tag of ['g', 'path', 'rect', 'circle', 'polygon', 'polyline', 'ellipse', 'text', 'tspan',
          'switch', 'use', 'defs', 'linearGradient', 'radialGradient', 'filter', 'clipPath', 'mask', 'style', 'image']) {
          m[tag] = (text.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
        }
        m['inkscape:'] = (text.match(/inkscape:/g) || []).length;
        m['sodipodi:'] = (text.match(/sodipodi:/g) || []).length;
        return m;
      };
      return {
        apiSha1: info.sha1, size: info.size, user: info.user, bytes: st.originalText.length,
        integrity: st.file?.integrity, localSha1: st.file?.localSha1,
        canvasContentElements: content.querySelectorAll('*').length,
        canvasLayers: count('g.layer'),
        drift: st.drift && { elements: [st.drift.elementsBefore, st.drift.elementsAfter], geometryChanged: st.drift.geometryChanged, textChanged: st.drift.textChanged },
        fidelityOriginal: fidelity(st.originalText), fidelityBaseline: fidelity(st.baseline)
      };
    }, title);
    Object.assign(rec, load, { loadMs: Date.now() - t0 });

    // a real edit: paint a content element through the SVG-Edit canvas API
    const edit = await page.evaluate(async () => {
      const sc = window.__cse.editor().svgCanvas;
      const content = document.querySelector('#svgcontent');
      const el = content.querySelector('path,rect,circle,polygon,polyline,ellipse');
      if (!el) return { edited: false, reason: 'no drawable element inside #svgcontent' };
      sc.clearSelection();
      sc.selectOnly([el]);
      const before = el.getAttribute('fill');
      sc.changeSelectedAttribute('fill', '#ff00aa');
      const after = content.querySelector('path,rect,circle,polygon,polyline,ellipse').getAttribute('fill');
      // also nudge geometry so the change is not merely cosmetic-attribute
      try { sc.moveSelectedElements(7, 5, true); } catch { /* optional */ }
      return { edited: true, tag: el.tagName, fillBefore: before, fillAfter: after };
    });
    rec.edit = edit;

    // exercise the app's own save-panel logic (not a re-implementation of it)
    const panel = await page.evaluate(async () => {
      await window.__cse.openSaveDrawer();
      await new Promise((r) => setTimeout(r, 400));
      const st = window.__cse.state;
      const btn = document.querySelector('#doSave');
      const rawText = window.__cse.getExport();           // editor output, before the fidelity repairs
      const finalText = st.draft.text;                    // what would actually be uploaded
      const report = st.draft.report;
      const rawReport = window.__cse.inspect(rawText);
      const thumb = await window.__cse.renderThumb(finalText, 240).catch((e) => ({ error: e.message }));
      return {
        bytes: finalText.length, rawBytes: rawText.length, hasFillEdit: finalText.includes('#ff00aa'),
        ok: report.ok, errors: report.errors, warnings: report.warnings, stats: report.stats,
        rawErrors: rawReport.errors.map((e) => String(e).slice(0, 90)),
        defsRestored: st.draft.defsRestored, framingRestored: st.draft.framing?.attributes || [],
        change: st.draft.change, verdict: st.draft.change.verdict,
        editedNothing: st.draft.change.editedNothing,
        saveButtonDisabled: btn ? btn.disabled : null,
        saveButtonLabel: btn ? btn.textContent.trim() : null,
        saveWhy: document.querySelector('#saveWhy')?.textContent || '',
        conflictText: document.querySelector('#conflictSec')?.textContent.trim().slice(0, 160) || '',
        renders: thumb.nonBlank === true, thumbError: thumb.error || null
      };
    });
    rec.panel = panel;
    // keep the export for offline inspection
    const safe = title.replace(/^File:/, '').replace(/[^\w.-]/g, '_');
    await page.evaluate(async (f) => { const t = window.__cse.getExport(); await window.__cse.state && (window.__exportText = t); return t.length; }, safe);
    const exportText = await page.evaluate(() => window.__exportText || '');
    await writeFile(`${OUT}exports/${safe}`, exportText);
    // close the drawer again for the next file (click via DOM: no actionability wait)
    await page.evaluate(() => document.querySelector('#drawerClose')?.click());

    rec.checks = {
      fetchedAndSha1Verified: rec.integrity === true,
      canvasPopulated: rec.canvasContentElements > 2,
      editLanded: Boolean(rec.edit?.edited && panel.hasFillEdit),
      exportValid: panel.ok,
      exportRenders: panel.renders,
      changeDetected: panel.editedNothing === false,
      saveGateCorrect: panel.saveButtonDisabled === true && /not connected/i.test(panel.saveWhy) || panel.saveButtonDisabled === false
    };
    rec.ok = Object.values(rec.checks).every(Boolean);
  } catch (e) {
    rec.error = e.message;
  }
  rec.totalMs = Date.now() - t0;
  results.files.push(rec);
  console.log(`${rec.ok ? 'PASS' : 'FAIL'}  ${title}  ${rec.totalMs}ms  load=${rec.loadMs}ms  ` +
    `export=${rec.panel?.bytes}B  checks=${JSON.stringify(rec.checks || rec.error)}`);
}

/* ------------------------------- no-edit guard (must block a pure normalisation save) */

try {
  results.noEditGuard = await page.evaluate(async (t) => {
    await window.__cse.loadFromCommons(t);
    await window.__cse.openSaveDrawer();
    await new Promise((r) => setTimeout(r, 300));
    const st = window.__cse.state;
    const btn = document.querySelector('#doSave');
    return { editedNothing: st.draft.change.editedNothing, disabled: btn?.disabled, label: btn?.textContent.trim(),
      why: document.querySelector('#saveWhy')?.textContent, drift: st.drift && { geometryChanged: st.drift.geometryChanged, elements: [st.drift.elementsBefore, st.drift.elementsAfter] } };
  }, FILES[0]);
  await page.evaluate(() => document.querySelector('#drawerClose')?.click());
} catch (e) { results.noEditGuard = { error: e.message }; }

/* --------------------------------------- upload endpoint boundary test (CORS) */

results.uploadBoundary = await page.evaluate(async () => {
  // NOTE: send `crossorigin` (or `origin=*`) — never both: combining them makes the request fail
  // in the browser even though curl gets a well-formed preflight. Measured 2026-09-10.
  const endpoint = 'https://commons.wikimedia.org/w/api.php?action=upload&format=json&formatversion=2&crossorigin=';
  const out = { requests: [] };
  // 1. authenticated GET (CSRF token) with an invalid bearer → API error JSON, proves CORS+auth path
  try {
    const r = await fetch('https://commons.wikimedia.org/w/api.php?action=query&meta=tokens&type=csrf&format=json&crossorigin=',
      { headers: { Authorization: 'Bearer NOT-A-REAL-TOKEN' }, credentials: 'omit' });
    const j = await r.json().catch(() => ({}));
    out.requests.push({ kind: 'GET meta=tokens (bearer)', status: r.status, cors: r.type, body: JSON.stringify(j).slice(0, 200) });
  } catch (e) { out.requests.push({ kind: 'GET meta=tokens (bearer)', error: e.message }); }
  // 2. the real multipart upload POST with an invalid bearer → must reach Wikimedia and be refused there
  try {
    const fd = new FormData();
    fd.set('action', 'upload'); fd.set('format', 'json'); fd.set('formatversion', '2');
    fd.set('filename', 'File:Flag of Japan.svg'); fd.set('comment', 'prototype boundary test — must fail');
    fd.set('token', '+\\');
    fd.set('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'], { type: 'image/svg+xml' }), 'test.svg');
    const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer NOT-A-REAL-TOKEN' }, body: fd, credentials: 'omit' });
    const j = await r.json().catch(() => ({}));
    out.requests.push({ kind: 'POST action=upload (bearer)', status: r.status, cors: r.type, body: JSON.stringify(j).slice(0, 240) });
    out.reachedServer = r.status > 0;
  } catch (e) { out.requests.push({ kind: 'POST action=upload (bearer)', error: e.message }); out.reachedServer = false; }
  return out;
});

await page.screenshot({ path: OUT + 'roundtrip.png' });
await writeFile(OUT + 'roundtrip.json', JSON.stringify(results, null, 1));

const passed = results.files.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.files.length} files passed the round-trip`);
console.log('no-edit guard:', JSON.stringify(results.noEditGuard));
console.log('upload boundary:', JSON.stringify(results.uploadBoundary, null, 1));
console.log('failed requests:', results.failedRequests.slice(0, 10));
console.log('page errors:', results.pageErrors.length, results.pageErrors.slice(0, 5));
console.log('results →', OUT + 'roundtrip.json');

await browser.close();
server.kill();
process.exit(passed === results.files.length ? 0 : 1);
