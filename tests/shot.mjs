/**
 * shot.mjs — load a file, open the save panel, take pictures (used for the write-up).
 * Run: node tests/shot.mjs ["File:Subduction-en.svg"] [outdir]
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4186;
const title = process.argv[2] || 'File:Subduction-en.svg';
const out = process.argv[3] || fileURLToPath(new URL('../test-results/', import.meta.url));

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await mkdir(out, { recursive: true });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });
await page.screenshot({ path: out + 'shot-0-welcome.png' });

await page.evaluate(async (t) => { await window.__cse.loadFromCommons(t); }, title);
await page.waitForTimeout(1500);
await page.screenshot({ path: out + 'shot-1-loaded.png' });

// make a visible edit so the save panel has something to report
await page.evaluate(async () => {
  const sc = window.__cse.editor().svgCanvas;
  const el = document.querySelector('#svgcontent').querySelector('path,rect,polygon');
  if (el) { sc.clearSelection(); sc.selectOnly([el]); sc.changeSelectedAttribute('fill', '#ff00aa'); }
  await window.__cse.openSaveDrawer();
});
await page.waitForTimeout(4000);
await page.screenshot({ path: out + 'shot-2-savepanel.png' });
await page.evaluate(() => document.querySelector('#drawerBody').scrollTop = 700);
await page.waitForTimeout(500);
await page.screenshot({ path: out + 'shot-3-savepanel-lower.png' });
console.log('saved screenshots to', out);
await browser.close(); server.kill(); process.exit(0);
