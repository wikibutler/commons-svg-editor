// debug-one.mjs — inspect what SVG-Edit does to a file on load and after an edit
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4183;
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';

const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });

const title = process.argv[2] || 'File:Flag of Japan.svg';
const out = await page.evaluate(async (t) => {
  await window.__cse.loadFromCommons(t);
  const original = window.__cse.state.originalText;
  const afterLoad = window.__cse.getExport();
  // find every svg element in the page and say which one looks like the canvas
  const svgs = [...document.querySelectorAll('svg')].map((s) => ({
    id: s.id || null, parent: s.parentElement?.id || s.parentElement?.className || null,
    children: s.children.length, w: s.getAttribute('width'), h: s.getAttribute('height')
  }));
  const sc = window.__cse.editor().svgCanvas;
  const canvasSvg = document.querySelector('#svgcontainer svg');
  const el = canvasSvg.querySelector('rect,path,circle');
  sc.clearSelection(); sc.selectOnly([el]);
  sc.changeSelectedAttribute('fill', '#ff00aa');
  const afterEdit = window.__cse.getExport();
  return { original, afterLoad, afterEdit, svgs,
    canvasOuter: canvasSvg.outerHTML.slice(0, 300),
    elTag: el.tagName, elOuter: el.outerHTML.slice(0, 200),
    afterLoadHasSe: /se:/.test(afterLoad), afterEditHasFill: afterEdit.includes('ff00aa'),
    afterLoadLength: afterLoad.length, afterEditLength: afterEdit.length };
}, title);

console.log('--- page svg elements ---'); console.log(JSON.stringify(out.svgs, null, 1));
console.log('--- canvas element outerHTML ---'); console.log(out.canvasOuter);
console.log('--- edited element outerHTML ---'); console.log(out.elOuter);
console.log('--- original (first 400) ---'); console.log(out.original.slice(0, 400));
console.log('--- afterLoad (first 600) ---'); console.log(out.afterLoad.slice(0, 600));
console.log('--- afterEdit (first 600) ---'); console.log(out.afterEdit.slice(0, 600));
console.log('afterEdit includes ff00aa:', out.afterEditHasFill, '| afterLoad has se: cruft:', out.afterLoadHasSe);
console.log('lengths original/load/edit:', out.original.length, out.afterLoadLength, out.afterEditLength);
console.log('console errors:', errors.slice(0, 8));
await writeFile('/opt/data/prototypes/commons-svg-edit/test-results/debug-afterload.svg', out.afterLoad);
await writeFile('/opt/data/prototypes/commons-svg-edit/test-results/debug-afteredit.svg', out.afterEdit);
await browser.close(); server.kill(); process.exit(0);
