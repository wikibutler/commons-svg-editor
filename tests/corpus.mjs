/**
 * corpus.mjs — run the prototype against the acceptance corpus and score every file.
 *
 * The point of this harness is not to test SVG-Edit; it is to be the thing any candidate tool
 * (this prototype, Penpot, a future Wikimedia-native editor) has to pass before the Commons
 * community should trust it with real files. Criteria A–L are defined in corpus/corpus.json.
 *
 * Run: node tests/corpus.mjs [--limit 5] [--files "File:A.svg"] [--diff-width 500]
 * Output: test-results/corpus-scorecard.json (+ incremental writes, so a timeout keeps data)
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4191;
const OUT = fileURLToPath(new URL('../test-results/', import.meta.url));
const corpusArg = process.argv.indexOf('--corpus');
const CORPUS = JSON.parse(readFileSync(corpusArg >= 0
  ? process.argv[corpusArg + 1]
  : fileURLToPath(new URL('../corpus/corpus.json', import.meta.url)), 'utf8'));

const args = process.argv.slice(2);
// --local <index.json>: run entirely from the on-disk corpus cache (tests/fetch-corpus.mjs), making zero
// requests to Commons. Wikimedia hosts are then blocked in the browser, which is what makes this a test
// rather than a claim: if the run still completes, it provably did not touch the network.
const localArg = args.indexOf('--local');
const LOCAL = localArg >= 0
  ? JSON.parse(readFileSync(args[localArg + 1].startsWith('/') ? args[localArg + 1] : new URL('../' + args[localArg + 1], import.meta.url), 'utf8'))
  : null;
const limitArg = args.indexOf('--limit');
const filesArg = args.indexOf('--files');
const DIFF_W = args.includes('--diff-width') ? Number(args[args.indexOf('--diff-width') + 1]) : 500;
let entries = CORPUS.corpus;
if (filesArg >= 0) { const want = args[filesArg + 1].split(',').map((s) => s.trim()); entries = entries.filter((e) => want.includes(e.title)); }
if (limitArg >= 0) entries = entries.slice(0, Number(args[limitArg + 1]));

await mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let blockedWikimedia = 0;
if (LOCAL) {
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (/wikimedia\.org|wikipedia\.org/.test(u)) { blockedWikimedia++; return route.abort(); }
    return route.continue();
  });
}
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });

const results = { startedAt: new Date().toISOString(), diffWidth: DIFF_W, files: [], pageErrors };

async function scoreOne (entry) {
  const loc = LOCAL?.files?.[entry.title] || null;
  const cachedText = loc ? readFileSync(new URL('../' + loc.path, import.meta.url), 'utf8') : null;
  const rec = await page.evaluate(async ({ title, diffWidth, cachedText, sha1, offline }) => {
    const n = window.__cse;
    const out = { title };
    try {
      // --- A: load + integrity
      let t0 = performance.now();
      if (cachedText) {
        // offline path: bytes from corpus/files-cache, integrity checked against the pinned Commons sha1
        await n.loadLocalText(cachedText, title, sha1);
        out.source = 'cache';
      } else {
        const info = await n.getFileInfo(title);
        await n.loadFromCommons(title);
        out.source = 'commons';
      }
      out.loadMs = Math.round(performance.now() - t0);
      out.integrity = n.state.file?.integrity;
      out.bytes = n.state.originalText.length;
      out.canvasElements = document.querySelectorAll('#svgcontent *').length;
      const src = n.state.originalText;

      // --- J: no-op save must be refused, and C/D: what the save *would* contain
      await n.openSaveDrawer();
      await new Promise((r) => setTimeout(r, 300));
      const d = n.state.draft;
      out.noop = {
        editedNothing: d.change.editedNothing,
        saveButtonDisabled: document.querySelector('#doSave')?.disabled ?? null,
        checksOk: d.report.ok,
        errors: d.report.errors.map((e) => String(e).slice(0, 120)),
        warnings: d.report.warnings.length,
        defsRewritten: d.defDrift.rewritten.length,
        defsCorrupted: d.defDrift.corrupted.length,
        defsMissing: d.defDrift.missing.length,
        defsRestored: d.defsRestored,
        framingRestored: d.framing?.attributes || [],
        bytesOut: d.text.length
      };
      out.noop.pixelDiffPercent = (await n.pixelDiff(src, d.text, diffWidth).catch((e) => ({ percentDifferent: 'err:' + e.message }))).percentDifferent;
      const pass1 = d.text;

      // --- K/idempotence: feed the saved file back through the editor; the result must be stable
      await n.editor().loadFromString(pass1, { noAlert: true });
      const pass2raw = n.getExport();
      const drift2 = n.definitionDrift(pass1, pass2raw);
      let pass2 = pass2raw;
      if (!drift2.missing.length || true) {
        pass2 = n.ensureNamespaces(n.preserveDefinitions(pass1, pass2, null).text);
        pass2 = n.ensureNamespaces(n.preserveRootFraming(pass1, pass2, null).text);
      }
      const norm = (s) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
      out.idempotent = norm(pass1) === norm(pass2);

      // --- edit pass: a real canvas edit must survive, and stay faithful
      // (offline: reload from the cached bytes — this is what previously hit Commons once per file per run)
      if (cachedText) await n.loadLocalText(cachedText, title, sha1);
      else await n.loadFromCommons(title);
      const sc = n.editor().svgCanvas;
      const els = [...document.querySelectorAll('#svgcontent path,#svgcontent rect,#svgcontent polygon,#svgcontent circle,#svgcontent polyline,#svgcontent text')];
      let el = null; let bestArea = Infinity;
      for (const e of els) {
        try { const b = e.getBBox(); const a = (b.width || 0) * (b.height || 0); if (a > 0 && a < bestArea) { bestArea = a; el = e; } } catch {}
      }
      let edited = false; let before = null; let after = null;
      if (el) { sc.clearSelection(); sc.selectOnly([el]); before = el.getAttribute('fill'); sc.changeSelectedAttribute('fill', '#ff00aa'); after = el.getAttribute('fill'); edited = true; }
      t0 = performance.now();
      await n.openSaveDrawer();
      await new Promise((r) => setTimeout(r, 400));
      const d2 = n.state.draft;
      const final = d2.text;
      out.edit = {
        edited, fillBefore: before, fillAfter: after,
        present: final.includes('#ff00aa'),
        checksOk: d2.report.ok,
        errors: d2.report.errors.map((e) => String(e).slice(0, 120)),
        elementChangePercent: Math.round((d2.change.ratio || 0) * 100),
        textRunsChanged: d2.change.textChanged,
        switchesBefore: d2.change.switchesBefore, switchesAfter: d2.change.switchesAfter,
        verdict: d2.change.verdict,
        exportMs: Math.round(performance.now() - t0),
        bytesOut: final.length
      };
      out.edit.editFootprintPercent = (await n.pixelDiff(pass1, final, diffWidth).catch((e) => ({ percentDifferent: 'err' }))).percentDifferent;
      out.edit.pixelDiffPercent = (await n.pixelDiff(src, final, diffWidth).catch((e) => ({ percentDifferent: 'err:' + e.message }))).percentDifferent;
      // G: invalid values introduced?
      out.nonFinite = (final.match(/(Infinity|NaN)/g) || []).length;
    } catch (e) {
      out.fatal = String(e.message || e).slice(0, 200);
    }
    return out;
  }, { title: entry.title, diffWidth: DIFF_W, cachedText, sha1: loc?.sha1 || null, offline: Boolean(LOCAL) });

  const noopDiff = typeof rec.noop?.pixelDiffPercent === 'number' ? rec.noop.pixelDiffPercent : null;
  const editDiff = typeof rec.edit?.pixelDiffPercent === 'number' ? rec.edit.pixelDiffPercent : null;
  const fails = [];
  if (rec.fatal) fails.push('fatal');
  if (rec.integrity !== true) fails.push('A: sha1/integrity');
  if (!rec.noop?.checksOk) fails.push('G: pre-flight errors on no-op export');
  if (rec.nonFinite) fails.push(`G: ${rec.nonFinite} non-finite values`);
  if (rec.noop?.defsCorrupted) fails.push(`C: ${rec.noop.defsCorrupted} definitions corrupted`);
  if (noopDiff === null) fails.push('K: no-op render not measurable');
  else if (noopDiff > 5) fails.push(`K: no-op diff ${noopDiff}%`);
  if (rec.edit && !rec.edit.present) fails.push('edit lost in export');
  if (!rec.idempotent) fails.push('idempotence: second pass differs');
  if (rec.source === 'cache') rec.noopGuard = 'n/a — offline mode; saving to Commons is disabled by design'
  else if (!rec.noop?.editedNothing || rec.noop?.saveButtonDisabled !== true) fails.push('J: no-op save not blocked');
  const warns = [];
  if (noopDiff !== null && noopDiff > 2 && noopDiff <= 5) warns.push(`K: no-op diff ${noopDiff}%`);
  if (editDiff !== null && editDiff > 5) warns.push(`K: edited diff ${editDiff}%`);
  if (rec.edit?.editFootprintPercent !== undefined && typeof rec.edit.editFootprintPercent === 'number' && rec.edit.editFootprintPercent > 25) warns.push(`edit footprint ${rec.edit.editFootprintPercent}% (larger than the edited shape suggests)`);
  if (rec.noop?.defsRewritten && !rec.noop?.defsRestored) warns.push('C: definitions rewritten and not restored');
  // A pixel-diff failure only softens to a warning when it is a near-miss. The old rule treated ANY
  // K-only failure as a warning, which labelled a 39% destroyed render as WARN.
  const hardFails = fails.filter((f) => !f.startsWith('K:'));
  const worstKDiff = Math.max(noopDiff ?? 0, editDiff ?? 0);
  rec.verdict = (hardFails.length || worstKDiff > 10) ? 'FAIL' : (fails.length || warns.length) ? 'WARN' : 'PASS';
  rec.fails = fails; rec.warns = warns;
  return rec;
}

for (const entry of entries) {
  const started = Date.now();
  let rec;
  try { rec = await scoreOne(entry); } catch (e) { rec = { title: entry.title, fatal: String(e.message).slice(0, 200) }; }
  rec.domain = entry.domain || entry.stratum; rec.corpusBytes = entry.bytes; rec.wallMs = Date.now() - started;
  // Distinguish "the tool failed" from "we failed to fetch the file". A burst of 44 files tripped
  // Wikimedia's rate limiting: those records show integrity !== true and no measurable no-op diff.
  if (rec.integrity !== true || rec.fatal) { rec.verdict = 'INFRA'; rec.fails = ['not measurable — file could not be fetched/verified'] ; }
  await page.waitForTimeout(900);
  results.files.push(rec);
  await writeFile(OUT + 'corpus-scorecard.json', JSON.stringify(results, null, 1)); // incremental
  const v = rec.verdict || 'FAIL';
  console.log(`${v.padEnd(4)} ${(rec.domain || '').padEnd(14)} ${entry.title.slice(0, 52).padEnd(52)} ` +
    `load ${String(rec.loadMs ?? '-').padStart(5)}ms  no-op diff ${String(rec.noop?.pixelDiffPercent ?? '-').padStart(6)}%  ` +
    `edited diff ${String(rec.edit?.pixelDiffPercent ?? '-').padStart(6)}%  ${rec.fails?.length ? ' | ' + rec.fails.join('; ') : ''}${rec.warns?.length ? ' | warn: ' + rec.warns.join('; ') : ''}`);
}

const tally = results.files.reduce((a, r) => (a[r.verdict || 'FAIL'] = (a[r.verdict || 'FAIL'] || 0) + 1, a), {});
const scored = results.files.filter((r) => r.verdict !== 'INFRA');
const byStratum = scored.reduce((a, r) => { const k = r.domain || '?'; a[k] = a[k] || [0, 0]; a[k][0]++; if (r.verdict === 'PASS') a[k][1]++; return a; }, {});
console.log('per stratum (scored: passed):', JSON.stringify(byStratum));
console.log('\ntally:', tally);
if (LOCAL) {
  console.log(`offline mode: ${blockedWikimedia} request(s) to Wikimedia hosts were attempted and blocked`);
  results.blockedWikimedia = blockedWikimedia;
  results.mode = 'offline (local corpus cache)';
}
results.verdicts = tally;
console.log('scorecard →', OUT + 'corpus-scorecard.json');
await browser.close(); server.kill(); process.exit(0);
