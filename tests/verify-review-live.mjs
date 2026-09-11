// verify-review-live.mjs — does the DEPLOYED review page work end-to-end from a foreign origin?
import { createRequire } from 'node:module';
const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const URL_ = process.argv[2] || 'https://wikibutler.github.io/commons-svg-editor/review/';
const TITLE = process.argv[3] || 'File:Steinwiesen in KC.svg';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1243/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errs = []; const hits = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
page.on('response', (r) => { if (/wikimedia\.org/.test(r.url())) hits.push(r.status() + ' ' + r.url().split('/').pop().slice(0, 34)); });
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.fill('#title', TITLE);
await page.click('#load');
await page.waitForFunction(() => document.querySelectorAll('#older option').length > 1, null, { timeout: 60000 }).catch(() => {});
const revs = await page.evaluate(() => document.querySelectorAll('#older option').length);
await page.click('#run');
await page.waitForFunction(() => (document.querySelector('.badge') || {}).textContent, null, { timeout: 60000 }).catch(() => {});
const out = await page.evaluate(() => ({
  verdict: (document.querySelector('.badge') || {}).textContent,
  flags: [...document.querySelectorAll('ul.flags li')].map((l) => l.textContent.slice(0, 96)).slice(0, 4),
  facts: document.querySelectorAll('.grid table tr').length,
}));
console.log('page      :', URL_);
console.log('revisions :', revs);
console.log('verdict   :', out.verdict);
out.flags.forEach((f) => console.log('flag      :', f));
console.log('fact rows :', out.facts);
console.log('wikimedia :', hits.slice(0, 3));
console.log('errors    :', errs.length ? errs : 'none');
await browser.close(); process.exit(0);
