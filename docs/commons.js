/**
 * commons.js — Wikimedia Commons storage layer for the SVG editor.
 *
 * Verified API facts (live probes 2026-09-10, see PROTO_FINDINGS.md):
 *  - upload.wikimedia.org serves `access-control-allow-origin: *`  → a browser page can
 *    fetch the raw SVG bytes of any Commons file directly.
 *  - The Action API enables CORS *only* when the query string carries `origin` (for anonymous
 *    requests: `origin=*`) or `crossorigin` (for OAuth-authenticated requests); that parameter
 *    must be present on the preflight OPTIONS request too.
 *    OPTIONS …/api.php?action=upload&crossorigin=  →  `access-control-allow-headers: authorization,content-type`
 *    https://www.mediawiki.org/wiki/Manual:CORS
 *  - Cross-origin cookie sessions are impossible (allow-origin `*` + allow-credentials `false`),
 *    so OAuth bearer tokens are the only browser-side write path.
 *  - The `sha1` of `prop=imageinfo` is the SHA-1 of the raw file bytes → usable as a
 *    client-side conflict guard (verified: Flag_of_Japan.svg == bda514e7…).
 */

export const WIKI = {
  host: 'commons.wikimedia.org',
  api: 'https://commons.wikimedia.org/w/api.php',
  rest: 'https://commons.wikimedia.org/w/rest.php',
  filePage: (title) => `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
  historyPage: (title) => `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=history`,
  uploadWizard: (title) => `https://commons.wikimedia.org/wiki/Special:Upload?wpDestFile=${encodeURIComponent(title.replace(/^File:/, '').replace(/ /g, '_'))}`
};

/* ------------------------------------------------------------------ titles */

/** Accepts "File:X.svg", "X.svg", "file:x.SVG", a commons.wikimedia.org/wiki/… URL,
 *  Special:FilePath/X.svg, or an upload.wikimedia.org path; returns a canonical File: title. */
export function normalizeTitle (input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter a file title or Commons URL.');
  if (/^https?:\/\/upload\.wikimedia\.org\//i.test(s)) {
    throw new Error('That is a raw file URL — give the file title (File:Name.svg) instead.');
  }
  const url = s.match(/^https?:\/\/[^/]*commons\.wikimedia\.org\/(?:wiki|w\/index\.php\?title=)\/?(.*)$/i);
  if (url) s = decodeURIComponent(url[1].split('&')[0]);
  s = s.replace(/^special:filepath\//i, '');
  s = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(?:file|image)\s*:\s*(.+)$/i);
  s = m ? m[1] : s;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  const title = `File:${s}`;
  if (!/\.svg$/i.test(title)) throw new Error('Only .svg files can be edited here (got: ' + title + ').');
  if (/[|\[\]{}<>]/.test(title)) throw new Error('Title contains characters that are not allowed.');
  return title;
}

/* -------------------------------------------------------------------- http */

function apiUrl (params, authed) {
  const u = new URL(WIKI.api);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('format', 'json');
  u.searchParams.set('formatversion', '2');
  // CORS trigger: `crossorigin` for OAuth requests, `origin=*` for anonymous ones (Manual:CORS).
  if (authed) u.searchParams.set('crossorigin', '');
  else u.searchParams.set('origin', '*');
  return u.toString();
}

export async function apiGet (params, { auth = null, signal } = {}) {
  const res = await fetch(apiUrl(params, Boolean(auth)), {
    method: 'GET',
    headers: auth ? { Authorization: `Bearer ${auth.accessToken}` } : {},
    signal,
    credentials: 'omit'
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new ApiError(data.error.code, data.error.info, data.error);
  if (!res.ok) throw new ApiError('http-' + res.status, res.statusText);
  return data;
}

export class ApiError extends Error {
  constructor (code, info, raw) { super(`${code}: ${info || ''}`); this.code = code; this.info = info; this.raw = raw; }
}

/* ------------------------------------------------------------- file access */

const IMAGEINFO_PROPS = 'url|size|sha1|mime|user|timestamp|comment|canonicaltitle';

export async function getFileInfo (title) {
  const data = await apiGet({
    action: 'query', prop: 'imageinfo', iiprop: IMAGEINFO_PROPS, titles: title
  });
  const page = data.query?.pages?.[0];
  if (!page) throw new Error('Commons returned no page for ' + title);
  if (page.missing) throw new Error(`“${title}” does not exist on Commons (or is not a file).`);
  const ii = page.imageinfo?.[0];
  if (!ii) throw new Error(`“${title}” has no file version.`);
  if (ii.mime && ii.mime !== 'image/svg+xml') throw new Error(`“${title}” is ${ii.mime}, not an SVG.`);
  return {
    title: page.title, pageid: page.pageid,
    url: ii.url.split('?')[0], size: ii.size, sha1: ii.sha1, mime: ii.mime,
    user: ii.user, timestamp: ii.timestamp, comment: ii.comment,
    width: ii.width, height: ii.height
  };
}

export async function getFileWikitext (title) {
  try {
    const data = await apiGet({ action: 'query', prop: 'revisions', rvprop: 'content|user|timestamp',
      rvslots: 'main', titles: title, redirects: 1 });
    return data.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? null;
  } catch { return null; }
}

export async function getFileHistory (title, limit = 12) {
  const data = await apiGet({ action: 'query', prop: 'imageinfo',
    iiprop: 'url|size|sha1|user|timestamp|comment', iilimit: limit, titles: title });
  return data.query?.pages?.[0]?.imageinfo ?? [];
}

/** Fetch the raw SVG text. upload.wikimedia.org sends `access-control-allow-origin: *`. */
export async function fetchSvgText (url, signal) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
  if (!res.ok) throw new Error(`Could not download the SVG (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  return { text: new TextDecoder('utf-8').decode(buf), bytes: new Uint8Array(buf) };
}

export async function sha1Hex (bytes) {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ writing */

export async function getCsrfToken (auth) {
  const data = await apiGet({ action: 'query', meta: 'tokens', type: 'csrf' }, { auth });
  const token = data.query?.tokens?.csrftoken;
  if (!token) throw new Error('Could not obtain a CSRF token (is the OAuth connection alive?).');
  return token;
}

/**
 * Upload an SVG as a new version of `title` (or a new file when `newFile`).
 * Field names come from the live contract of `action=paraminfo&modules=upload`.
 * `text` is only sent for new files, so the description page of an existing file is left untouched.
 */
export async function uploadSvg ({ title, svgText, comment, auth, ignoreWarnings = false,
  newFile = false, wikitext = null, watchlist = 'nochange' }) {
  const token = await getCsrfToken(auth);
  const fd = new FormData();
  fd.set('action', 'upload');
  fd.set('format', 'json');
  fd.set('formatversion', '2');
  fd.set('filename', title);
  fd.set('comment', comment || '');
  fd.set('token', token);
  fd.set('watchlist', watchlist);
  if (ignoreWarnings) fd.set('ignorewarnings', '1');
  if (newFile && wikitext) fd.set('text', wikitext);
  const filename = title.replace(/^File:/, '').replace(/ /g, '_');
  fd.set('file', new Blob([svgText], { type: 'image/svg+xml' }), filename);

  const url = apiUrl({ action: 'upload' }, true); // crossorigin + bearer
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    body: fd,
    credentials: 'omit'
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) return { ok: false, status: res.status, code: data.error.code, info: data.error.info, data };
  if (res.status !== 200) return { ok: false, status: res.status, code: 'http-' + res.status, info: res.statusText, data };
  return { ok: true, status: res.status, data, imageinfo: data.upload?.imageinfo };
}

/** After a save, read back the live file state (external-state verification). */
export async function verifySaved (title, expectedSha1 = null) {
  const info = await getFileInfo(title);
  return { ...info, matchesLocalEdit: expectedSha1 ? info.sha1 === expectedSha1 : null };
}

/** Pre-upload conflict check: has anyone uploaded a new version since we loaded? */
export async function checkFreshness (loadedSha1, title) {
  const info = await getFileInfo(title);
  return { fresh: info.sha1 === loadedSha1, current: info };
}

/* ------------------------------------------------------------ oauth profile */

export async function whoAmI (auth) {
  const res = await fetch(`${WIKI.rest}/oauth2/resource/profile`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }, credentials: 'omit'
  });
  if (!res.ok) throw new Error('OAuth profile request failed (HTTP ' + res.status + ')');
  return res.json();
}
