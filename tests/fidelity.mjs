/**
 * fidelity.mjs — how faithfully does a browser SVG editor round-trip real Commons files?
 *
 * For each file: load → export without edits → compare the export with the source, then apply the
 * definition-preserving merge and compare again. Reports, per file:
 *   · definitions (gradients/filters/patterns) rewritten / corrupted / lost by the editor
 *   · share of differing pixels between a browser render of the source and of each export
 *   · whether non-finite values survive
 *
 * Run: node tests/fidelity.mjs [--files "File:A.svg"] [--width 600]
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4185;
const OUT = fileURLToPath(new URL('../test-results/', import.meta.url));

const FILES = [
  'File:Flag of Japan.svg',
  'File:Osmotic pressure on blood cells diagram.svg',
  'File:Flagellum base diagram-en.svg',
  'File:Ancient Egypt map-en.svg',
  'File:BlankMap-World.svg',
  'File:Subduction-en.svg'
];

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });
await mkdir(OUT + 'fidelity', { recursive: true });

const rows = [];
for (const title of FILES) {
  const row = await page.evaluate(async (t) => {
    const n = window.__cse;
    await n.loadFromCommons(t);
    const src = n.state.originalText;
    const plain = n.getExport();
    const drift = n.definitionDrift(src, plain);
    const fixed = n.preserveDefinitions(src, plain, n.state.baseline);
    const fixedText = n.ensureNamespaces(fixed.text);
    // second repair: root framing (viewBox etc.) is dropped by the editor
    const framed = n.preserveRootFraming(src, fixedText, n.state.baseline);
    const framedText = n.ensureNamespaces(framed.text);
    const repPlain = n.inspect(plain);
    const repFixed = n.inspect(framedText);
    let dPlain = null; let dFixed = null; let dBaseline = null; let dFramed = null;
    try { dPlain = (await n.pixelDiff(src, plain, 600)).percentDifferent; } catch (e) { dPlain = 'err: ' + String(e.message).slice(0, 60); }
    try { dFixed = (await n.pixelDiff(src, fixedText, 600)).percentDifferent; } catch (e) { dFixed = 'err: ' + String(e.message).slice(0, 60); }
    try { dFramed = (await n.pixelDiff(src, framedText, 600)).percentDifferent; } catch (e) { dFramed = 'err: ' + String(e.message).slice(0, 60); }
    try { dBaseline = (await n.pixelDiff(src, n.state.baseline, 600)).percentDifferent; } catch (e) { dBaseline = 'err'; }
    return {
      title: t, srcBytes: src.length, plainBytes: plain.length, fixedBytes: framedText.length,
      definitions: { total: drift.total, rewritten: drift.rewritten.length, corrupted: drift.corrupted.length, missing: drift.missing.length },
      corruptedExample: (drift.corrupted[0] || '').slice(0, 100),
      restored: fixed.restored,
      framingRestored: framed.attributes,
      infinityPlain: (plain.match(/Infinity|NaN/g) || []).length,
      infinityFixed: (framedText.match(/Infinity|NaN/g) || []).length,
      errorsPlain: repPlain.errors.map((e) => String(e).slice(0, 100)),
      errorsFixed: repFixed.errors.map((e) => String(e).slice(0, 100)),
      warningsPlain: repPlain.warnings.slice(0, 3),
      stats: repFixed.stats,
      pixelDiffPercent: { baseline: dBaseline, plain: dPlain, defsRestored: dFixed, defsAndFraming: dFramed }
    };
  }, title);
  rows.push(row);
  console.log(`${title}
    gradients/defs: ${row.definitions.total} touched (rewritten ${row.definitions.rewritten}, corrupted ${row.definitions.corrupted}, missing ${row.definitions.missing}), restored ${row.restored}; framing restored: ${JSON.stringify(row.framingRestored)}
    non-finite values: plain ${row.infinityPlain} → repaired ${row.infinityFixed}
    pixel diff vs source: after load ${row.pixelDiffPercent.baseline}% | plain export ${row.pixelDiffPercent.plain}% | defs restored ${row.pixelDiffPercent.defsRestored}% | defs+framing restored ${row.pixelDiffPercent.defsAndFraming}%
    errors: plain ${JSON.stringify(row.errorsPlain)} | repaired ${JSON.stringify(row.errorsFixed)}`);
}
await writeFile(OUT + 'fidelity.json', JSON.stringify(rows, null, 1));
console.log('\n→', OUT + 'fidelity.json');
await browser.close(); server.kill(); process.exit(0);
