
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4194;
const server = spawn(process.execPath, ['/opt/data/prototypes/commons-svg-edit/tests/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__cse?.ready, null, { timeout: 60000 });
const out = await page.evaluate(async (titles) => {
  const n = window.__cse;
  const count = (text, local) => {
    const d = new DOMParser().parseFromString(text, 'image/svg+xml');
    return [...d.documentElement.querySelectorAll('*')].filter(e => e.localName === local).length;
  };
  const res = {};
  for (const t of titles) {
    await n.loadFromCommons(t);
    const src = n.state.originalText;
    const saved = n.state.baseline;   // the editor's own load-time export = purest measurement of what SVG-Edit does
    const langs = (x) => [...new Set([...new DOMParser().parseFromString(x,'image/svg+xml').documentElement.querySelectorAll('*')].map(e=>e.getAttribute('systemLanguage')).filter(Boolean))];
    const labels = (x) => [...new DOMParser().parseFromString(x,'image/svg+xml').documentElement.querySelectorAll('*')].filter(e=>[...e.attributes].some(a=>a.name==='inkscape:label')).length;
    const nodes = (x) => [...new DOMParser().parseFromString(x,'image/svg+xml').documentElement.querySelectorAll('*')].filter(e=>[...e.attributes].some(a=>a.name==='sodipodi:nodetypes')).length;
    res[t] = {
      text: [count(src,'text'), count(saved,'text')], tspan: [count(src,'tspan'), count(saved,'tspan')],
      switch: [count(src,'switch'), count(saved,'switch')],
      languages: [langs(src).length, langs(saved).length], languageSample: [...new Set([...langs(src), ...langs(saved)])].slice(0,5),
      inkscapeLabelAttrs: [labels(src), labels(saved)], sodipodiNodetypes: [nodes(src), nodes(saved)],
      sampleTextInSource: [...new DOMParser().parseFromString(src,'image/svg+xml').documentElement.querySelectorAll('*')]
        .filter(e=>e.localName==='tspan').slice(0,3).map(e=>e.textContent.slice(0,28)),
      sampleTextInSaved: [...new DOMParser().parseFromString(saved,'image/svg+xml').documentElement.querySelectorAll('*')]
        .filter(e=>e.localName==='tspan').slice(0,3).map(e=>e.textContent.slice(0,28))
    };
  }
  return res;
}, ['File:Subduction-en.svg','File:Ancient Egypt map-en.svg']);
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.kill(); process.exit(0);
