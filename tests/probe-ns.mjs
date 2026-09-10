
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4192;
const server = spawn(process.execPath, ['/opt/data/prototypes/commons-svg-edit/tests/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });
const out = await page.evaluate(async (t) => {
  const n = window.__cse;
  await n.loadFromCommons(t);
  const src = n.state.originalText;
  const srcRoot = src.match(/<svg\b[^>]*>/)[0];
  const plain = n.cleanExport(n.editor().svgCanvas.getSvgString());
  await n.openSaveDrawer();
  await new Promise(r => setTimeout(r, 300));
  const draft = n.state.draft.text;
  return {
    srcRootDeclares: (srcRoot.match(/xmlns:[\w-]+="[^"]*"/g) || []),
    plainRoot: plain.match(/<svg\b[^>]*>/)[0].slice(0, 300),
    draftRoot: draft.match(/<svg\b[^>]*>/)[0].slice(0, 300),
    draftHasInkscapeDecl: /xmlns:inkscape=/.test(draft),
    draftInkscapeUses: (draft.match(/inkscape:[\w-]+=/g) || []).length,
    plainInkscapeUses: (plain.match(/inkscape:[\w-]+=/g) || []).length,
    draftFirstInkscapeAttr: (draft.match(/.{60}inkscape:[\w-]+="[^"]*"/) || ['none'])[0],
    defsRestored: n.state.draft.defsRestored, framing: n.state.draft.framing,
    reportErrors: n.state.draft.report.errors.map(e => String(e).slice(0, 140))
  };
}, 'File:Bergen County, NJ municipalities labeled.svg');
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.kill(); process.exit(0);
