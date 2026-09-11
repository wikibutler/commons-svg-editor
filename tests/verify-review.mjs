// verify-review.mjs — drive the review page in a real browser against a real Commons file.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = Number(process.argv[2] || 4201);
const server = spawn(process.execPath, ['/opt/data/prototypes/commons-svg-edit/tests/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
// assert the dev server is the one we just started, and that it serves ES modules correctly: a stale server from
// an earlier run on the same port silently served the old MIME type and made the page look broken.
const probe = await fetch(`http://127.0.0.1:${PORT}/review/lib/svg-diff.mjs`).then((r) => r.headers.get('content-type')).catch((e) => 'unreachable: ' + e.message);
console.log('module MIME:', probe);
if (!/javascript/.test(probe || '')) { console.log('ABORT: dev server is not serving ES modules as JavaScript (stale process on this port?)'); server.kill(); process.exit(0); }
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const candidates = [
  '/opt/data/home/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
  '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome',
  '/opt/data/home/.cache/ms-playwright/chromium_headless_shell-1217/chrome-linux/headless_shell',
];
let browser = null;
for (const exe of candidates) {
  try { browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); console.log('launched:', exe.split('/')[5]); break; }
  catch (e) { console.log('launch failed:', exe.split('/')[5], String(e).slice(0, 70)); }
}
if (!browser) { console.log('NO BROWSER AVAILABLE — page unverified'); server.kill(); process.exit(0); }
const page = await browser.newPage();
const errs = []; const apiCalls = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
page.on('requestfailed', (r) => errs.push('reqfail: ' + r.url().slice(0, 90) + ' ' + (r.failure() && r.failure().errorText)));
page.on('response', (r) => { if (/wikimedia\.org/.test(r.url())) apiCalls.push(`${r.status()} ${r.url().split('/').pop().slice(0, 40)}`); });
await page.goto(`http://127.0.0.1:${PORT}/review/`, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForFunction(() => document.querySelectorAll('#older option').length > 1, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
const pickers = await page.evaluate(() => document.querySelectorAll('#older option').length);
console.log('revision pickers:', pickers);
console.log('status line :', await page.evaluate(() => document.getElementById('status').textContent.trim().slice(0, 160)));
if (errs.length) console.log('EARLY PAGE ERRORS:', errs);
if (!pickers) { console.log('page could not load revisions — stopping'); await browser.close(); server.kill(); process.exit(0); }
await page.click('#run');
await page.waitForFunction(() => (document.querySelector('.badge') || {}).textContent, null, { timeout: 60000 }).catch(() => {});
const out = await page.evaluate(() => ({
  verdict: document.querySelector('.badge')?.textContent.trim(),
  meta: document.querySelector('.card .dim')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 220),
  flags: [...document.querySelectorAll('ul.flags li')].map((l) => l.textContent.slice(0, 120)).slice(0, 6),
  factsRows: document.querySelectorAll('.grid table tr').length,
  changed: [...document.querySelectorAll('table code')].map((c) => c.textContent).slice(0, 4),
}));
console.log('VERDICT  :', out.verdict);
console.log('META     :', out.meta);
out.flags.forEach((f) => console.log('FLAG     :', f));
console.log('fact rows:', out.factsRows, '| changed elements:', out.changed.length ? out.changed.join(', ') : '(none)');
console.log('wikimedia requests:', apiCalls.length ? apiCalls.slice(0, 4) : 'none');
console.log('page errors:', errs.length ? errs : 'none');
await browser.close(); server.kill(); process.exit(0);
