
// live-check.mjs — smoke-test the deployed prototype from a foreign origin (github.io).
// Verifies: assets served, editor boots, a real Commons file loads, export + checks work.
import { createRequire } from 'node:module';
const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const URL_ = process.argv[2] || 'https://wikibutler.github.io/commons-svg-editor/';
const TITLE = process.argv[3] || 'File:Flag of Japan.svg';

process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const bad = [];
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api.php')) bad.push(r.status() + ' ' + r.url()); });
try {
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__cse && window.__cse.ready, null, { timeout: 90000 });
  const res = await page.evaluate(async (t) => {
    const started = performance.now();
    await window.__cse.loadFromCommons(t);
    const st = window.__cse.state;
    const out = window.__cse.getExport();
    const rep = window.__cse.inspect(out);
    await window.__cse.openSaveDrawer();
    await new Promise((r) => setTimeout(r, 400));
    return { title: st.file.title, integrity: st.file.integrity, bytes: st.originalText.length,
      canvasElements: document.querySelectorAll('#svgcontent *').length, exportOk: rep.ok,
      exportErrors: rep.errors, defsRewritten: st.draft.defDrift.rewritten.length,
      defsRestored: st.draft.defsRestored, framing: st.draft.framing?.attributes || [],
      saveDisabled: document.querySelector('#doSave')?.disabled,
      elapsedMs: Math.round(performance.now() - started), title404: null };
  }, TITLE);
  console.log('LIVE CHECK', JSON.stringify(res, null, 1));
} catch (e) {
  console.log('LIVE CHECK FAILED:', e.message.slice(0, 300));
}
console.log('http >=400 (excluding API):', bad.slice(0, 6), '| pageErrors:', errors.slice(0, 4));
await browser.close(); process.exit(0);
