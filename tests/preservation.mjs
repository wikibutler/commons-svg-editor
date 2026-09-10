/**
 * preservation.mjs — does the preservation meter actually discriminate?
 *
 * For each file it reports two numbers:
 *   TOOL CHURN   = score for (source → canvas baseline)          i.e. what the editor rewrites with zero user edits
 *   SAVED FILE   = score for (source → what the save would write) i.e. after this prototype's definition/framing repair
 * plus the pixel diff of each, so the score can be sanity-checked against visible damage.
 *
 * Run: node tests/preservation.mjs [--files "File:A.svg,File:B.svg"]
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4193;
const OUT = fileURLToPath(new URL('../test-results/', import.meta.url));
const args = process.argv.slice(2);
const filesArg = args.indexOf('--files');
const FILES = filesArg >= 0 ? args[filesArg + 1].split(',').map((s) => s.trim()) : [
  'File:Flag of Japan.svg',
  'File:Logo of IAB.svg',                             // CSS <style> + classes
  'File:SVGtextPath01.svg',                           // textPath (librsvg cannot render it at all)
  'File:Pittsburgh newspaper consolidation timeline.svg', // pattern + filter + blur
  'File:Flagellum base diagram-en.svg',               // classic diagram, 16 gradients
  'File:Ancient Egypt map-en.svg',                    // 849 KB Inkscape map
  'File:Subduction-en.svg',                           // 2.4 MB, 264 gradients, non-zero viewBox
  'File:Leonardo da Vinci monument in Milan.svg'      // embedded data-URI raster
];

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });
await mkdir(OUT, { recursive: true });

const rows = [];
for (const title of FILES) {
  const rec = await page.evaluate(async (t) => {
    const n = window.__cse;
    await n.loadFromCommons(t);
    const src = n.state.originalText;
    await n.openSaveDrawer();
    await new Promise((r) => setTimeout(r, 350));
    const d = n.state.draft;
    const noop = d.noopPreservation || n.preservationReport(src, n.state.baseline);
    const saved = d.preservation;
    const pixSaved = (await n.pixelDiff(src, d.text, 500).catch(() => ({ percentDifferent: null }))).percentDifferent;
    return {
      title: t, bytes: src.length,
      toolChurn: { score: noop.score, grade: noop.grade, components: noop.components.map((c) => `${c.key}:${c.score}/${c.weight}`).join(' ') },
      savedFile: { score: saved.score, grade: saved.grade, verdict: saved.verdict,
        components: saved.components.map((c) => `${c.key}:${c.score}/${c.weight}`).join(' ') },
      findings: saved.findings.map((f) => f.level + ': ' + f.text.slice(0, 90)),
      pixelDiffSaved: pixSaved,
      meta: { srcInkscape: (src.match(/inkscape:[\w-]+=/g) || []).length, savedInkscape: (d.text.match(/inkscape:[\w-]+=/g) || []).length,
              srcSodipodi: (src.match(/sodipodi:[\w-]+=/g) || []).length, savedSodipodi: (d.text.match(/sodipodi:[\w-]+=/g) || []).length,
              srcSwitch: (src.match(/<[\w:]*switch[\s>]/g) || []).length, savedSwitch: (d.text.match(/<[\w:]*switch[\s>]/g) || []).length },
      componentsFull: { churn: noop.components.map(c => ({k:c.key, s:c.score, w:c.weight, d:c.detail})), saved: saved.components.map(c => ({k:c.key, s:c.score, w:c.weight, d:c.detail})) }
    };
  }, title);
  rows.push(rec);
  console.log(`${String(rec.toolChurn.grade).padEnd(2)} churn / ${String(rec.savedFile.grade).padEnd(2)} saved  ` +
    `${String(rec.toolChurn.score).padStart(3)} / ${String(rec.savedFile.score).padStart(3)}  ` +
    `pixel ${String(rec.pixelDiffSaved).padStart(6)}%  ${title.slice(0, 48)}`);
  console.log(`      churn: ${rec.toolChurn.components}`);
  console.log(`      saved: ${rec.savedFile.components}`);
  if (rec.findings.length) console.log(`      findings: ${rec.findings.slice(0, 3).join(' || ')}`);
  console.log(`      metadata: inkscape ${rec.meta.srcInkscape}->${rec.meta.savedInkscape} | sodipodi ${rec.meta.srcSodipodi}->${rec.meta.savedSodipodi} | switch ${rec.meta.srcSwitch}->${rec.meta.savedSwitch}`);
}
await writeFile(OUT + 'preservation.json', JSON.stringify(rows, null, 1));
console.log('\n→', OUT + 'preservation.json');
await browser.close(); server.kill(); process.exit(0);
