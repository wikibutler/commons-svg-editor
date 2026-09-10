// cors-probe.mjs — which query parameter lets a browser POST to the Action API with an
// Authorization header? (This decides whether a pure-client OAuth upload is possible.)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/data/browser-test/x.js');
const { chromium } = require('playwright');
const PORT = 4184;
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/data/home/.cache/ms-playwright';
const browser = await chromium.launch({ executablePath: '/opt/data/home/.cache/ms-playwright/chromium-1217/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const preflights = [];
page.on('request', (r) => { if (r.method() === 'OPTIONS') preflights.push(r.url()); });
page.on('response', async (r) => {
  if (r.request().method() === 'OPTIONS') {
    preflights.push({ url: r.url(), status: r.status(), headers: await r.allHeaders() });
  }
});
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async () => {
  const tok = 'NOT-A-REAL-TOKEN';
  const mk = (q) => `https://commons.wikimedia.org/w/api.php?action=upload&format=json&formatversion=2${q}`;
  const variants = {
    'origin=* only': mk('&origin=*'),
    'crossorigin only': mk('&crossorigin='),
    'both': mk('&crossorigin=&origin=*'),
    'neither': mk('')
  };
  const res = {};
  for (const [name, url] of Object.entries(variants)) {
    const rec = { url };
    // A: simple GET with Authorization (preflight) — does the header survive?
    try {
      const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&meta=tokens&type=csrf&format=json${name === 'neither' ? '' : '&' + name.split(' only')[0].replace('both', 'crossorigin=&origin=*')}`,
        { headers: { Authorization: 'Bearer ' + tok }, credentials: 'omit' });
      rec.getStatus = r.status; rec.getType = r.type;
      rec.getBody = (await r.clone().text()).slice(0, 120);
    } catch (e) { rec.getError = e.message; }
    // B: the real multipart POST
    try {
      const fd = new FormData();
      fd.set('action', 'upload'); fd.set('format', 'json'); fd.set('formatversion', '2');
      fd.set('filename', 'File:Flag of Japan.svg'); fd.set('token', '+\\');
      fd.set('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'], { type: 'image/svg+xml' }), 'x.svg');
      const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd, credentials: 'omit' });
      rec.postStatus = r.status; rec.postType = r.type;
      rec.postBody = (await r.text()).slice(0, 160);
    } catch (e) { rec.postError = e.message; }
    res[name] = rec;
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('\nOPTIONS seen:', preflights.length);
for (const p of preflights) {
  if (typeof p === 'string') continue;
  const h = p.headers || {};
  console.log(` ${p.status} ${p.url}`);
  console.log(`   allow-origin: ${h['access-control-allow-origin']} | allow-headers: ${h['access-control-allow-headers']} | allow-methods: ${h['access-control-allow-methods']}`);
}
await browser.close(); server.kill(); process.exit(0);
