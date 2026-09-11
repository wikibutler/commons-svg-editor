/**
 * fetch-corpus.mjs — download corpus files ONCE into a local cache; the test run then never touches Commons.
 *
 * This is the fix for the design flaw in the first harness: it fetched every file from Commons twice per
 * run (once for the no-op test, once for the edit test), so a 44-file run made ~88 requests and hit
 * HTTP 429 on 8 files. Fetching belongs in its own step:
 *
 *   node tests/fetch-corpus.mjs --corpus corpus/sample.json     # network, once, polite
 *   node tests/corpus.mjs --local corpus/files-cache/index.json # offline, repeatable, no Commons traffic
 *
 * Cache layout: corpus/files-cache/<sha1>/<basename>.svg  (sha1-keyed => files that change on-wiki get a
 * new directory instead of silently overwriting the old revision, and a re-run is a no-op).
 * Commons media itself stays out of git (.gitignore); corpus/files-cache/index.json is committed, so the
 * suite records exactly which revisions were tested.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const UA = 'HermesAgent/1.0 (https://en.wikipedia.org/wiki/User:Fuzheado) commons-svg-editor test-suite; contact via GitHub wikibutler/commons-svg-editor';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = ROOT + 'corpus/files-cache';
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const manifests = flag('corpus', 'corpus/sample.json,corpus/corpus.json').split(',').map((s) => s.trim());
const PACE = Number(flag('pace', 1200));

const wanted = new Map();
for (const m of manifests) {
  const j = JSON.parse(readFileSync(m.startsWith('/') ? m : ROOT + m, 'utf8'));
  for (const c of j.corpus) if (!wanted.has(c.title)) wanted.set(c.title, { ...c, manifest: m });
}
console.log(`${wanted.size} distinct files requested from: ${manifests.join(', ')}`);

const index = existsSync(CACHE + '/index.json') ? JSON.parse(readFileSync(CACHE + '/index.json', 'utf8')) : {};
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fetched = 0; let cached = 0; const failures = [];

for (const [title, entry] of wanted) {
  const base = title.replace(/^File:/, '');
  const dir = `${CACHE}/${entry.sha1}`;
  const file = `${dir}/${base}`;
  if (existsSync(file) && sha1(readFileSync(file)) === entry.sha1) {
    cached++;
    index[title] = { path: `corpus/files-cache/${entry.sha1}/${base}`, sha1: entry.sha1, bytes: statSync(file).size, title };
    continue;                                   // never downloaded again
  }
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    try {
      const res = await fetch(entry.url, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 3000 * Math.pow(2, attempt);
        console.log(`   ${res.status} on ${base.slice(0, 40)} — waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = sha1(buf);
      if (entry.sha1 && got !== entry.sha1) {
        failures.push(`${title} — sha1 mismatch (manifest ${entry.sha1.slice(0, 8)}, downloaded ${got.slice(0, 8)}): the file changed on Commons since the sample was drawn`);
        break;                                  // do NOT cache a revision the manifest did not ask for
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, buf);
      index[title] = { path: `corpus/files-cache/${entry.sha1}/${base}`, sha1: got, bytes: buf.length, title };
      fetched++; ok = true;
      console.log(`   ↓ ${(buf.length / 1024).toFixed(0).padStart(6)} KB  ${base.slice(0, 52)}`);
    } catch (e) {
      const wait = 2500 * Math.pow(2, attempt);
      console.log(`   ${e.message} on ${base.slice(0, 34)} — retry in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  if (!ok && !failures.some((f) => f.startsWith(title))) failures.push(`${title} — could not download`);
  if (ok) await sleep(PACE);                     // be a good citizen only when we actually hit the network
}
writeFileSync(CACHE + '/index.json', JSON.stringify({
  generated: new Date().toISOString(),
  note: 'Local cache index for offline test runs. Paths point at corpus/files-cache/ (git-ignored: Commons media is not redistributed by this repo). sha1 pins the revision that was tested.',
  files: index
}, null, 1));
console.log(`\ncached already: ${cached}   downloaded now: ${fetched}   failed: ${failures.length}`);
failures.forEach((f) => console.log('   ! ' + f));
console.log(`index → corpus/files-cache/index.json (${Object.keys(index).length} entries, ${(Object.values(index).reduce((n, f) => n + f.bytes, 0) / 1048576).toFixed(1)} MB on disk)`);
