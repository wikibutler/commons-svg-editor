
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4196;
const server = spawn(process.execPath, ['/opt/data/prototypes/commons-svg-edit/tests/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
await page.goto(`http://127.0.0.1:${PORT}/board/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.card').length > 0, null, { timeout: 30000 }).catch(() => {});
const out = await page.evaluate(() => ({
  legend: document.getElementById('legend').textContent.trim().slice(0, 160),
  columns: [...document.querySelectorAll('.col')].map((c) => `${c.querySelector('h2').textContent.trim()}`),
  cards: [...document.querySelectorAll('.card a')].map((a) => a.textContent.trim().slice(0, 54)),
}));
console.log('legend :', out.legend);
console.log('columns:', out.columns.join(' | '));
console.log('cards  :', out.cards.length); out.cards.slice(0, 12).forEach((c) => console.log('   -', c));
console.log('page errors:', errs.length ? errs : 'none');
await browser.close(); server.kill(); process.exit(0);
