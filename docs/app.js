/**
 * app.js — glue: SVG-Edit ⇄ Wikimedia Commons.
 *
 * Flow: Commons file → (API imageinfo + sha1) → raw SVG text → SVG-Edit canvas →
 *       local pre-flight checks → upload as new version (OAuth 2.0 bearer) → verify by re-reading.
 */
import * as C from './commons.js';
import * as O from './oauth.js';
import * as V from './validate.js';

const $ = (s) => document.querySelector(s);

const state = {
  file: null,            // live Commons metadata for the loaded revision
  originalText: null,    // exact bytes we loaded (conflict baseline)
  localOnly: false,      // loaded from disk, no Commons side
  auth: null,
  setup: O.loadSetup(),
  profile: null
};

let editor = null;
/** Keep the source file's gradient/filter/pattern definitions instead of SVG-Edit's rewrite. */
let preserveDefsPref = true;

/* ------------------------------------------------------------------ chrome */

function toast (msg, kind = 'info', ms = 6000) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'info' ? '' : kind);
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}
function setBusy (text) { $('#busyText').textContent = text; $('#busy').classList.remove('hidden'); }
function clearBusy () { $('#busy').classList.add('hidden'); }
function welcome (show) { $('#welcome').classList.toggle('hidden', !show); }
function drawer (show) { $('#drawer').classList.toggle('hidden', !show); }
function shortSha1 (s) { return s ? s.slice(0, 8) : '—'; }
function fmtBytes (n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
function fmtDate (ts) { try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + 'Z'; } catch { return ts; } }

/* ------------------------------------------------------------------ editor */

const EditorCtor = (window.Editor && window.Editor.default) || window.Editor;

function mountEditor () {
  const base = new URL('.', location.href).toString();
  editor = new EditorCtor(document.getElementById('svgcontainer'));
  editor.setConfig({
    allowInitialUserOverride: true,
    extPath: new URL('vendor/svgedit/extensions', base).toString().replace(/\/$/, ''),
    imgPath: new URL('vendor/svgedit/images', base).toString().replace(/\/$/, ''),
    noDefaultExtensions: false,   // grid, layer view, markers, open/save, shapes, storage…
    noStorageOnLoad: true,        // never resurrect a half-finished drawing from localStorage
    showRulers: false,
    show_outside_canvas: true,
    dimensions: [640, 480],
    initTool: 'select',
    lang: 'en'
  });
  editor.init();
}

function editorReady (timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll () {
      if (editor.svgCanvas && typeof editor.svgCanvas.getSvgString === 'function') return resolve(true);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('SVG-Edit did not finish initialising'));
      setTimeout(poll, 100);
    })();
  });
}

async function putSvgIntoEditor (text) {
  await editorReady();
  await editor.loadFromString(text, { noAlert: true });
}

function editorSvg () { return editor.svgCanvas.getSvgString(); }

/* -------------------------------------------------------------- loading flow */

async function loadFromCommons (rawTitle) {
  let title;
  try { title = C.normalizeTitle(rawTitle); } catch (e) { return toast(e.message, 'err'); }
  setBusy(`Fetching ${title} from Commons…`);
  const t0 = performance.now();
  try {
    const info = await C.getFileInfo(title);
    const { text, bytes } = await C.fetchSvgText(info.url);
    const localSha1 = await C.sha1Hex(bytes);
    await putSvgIntoEditor(text);
    state.file = { ...info, localSha1, integrity: localSha1 === info.sha1 };
    state.originalText = text;
    state.localOnly = false;
    snapshotBaseline();
    renderFileBar();

    welcome(false);
    $('#saveBtn').disabled = false;
    toast(info.integrity === false
      ? `Loaded ${title}, but the bytes do not match the API sha1 — treat with suspicion.`
      : `Loaded ${title} · ${fmtBytes(info.size)} · ${Math.round(performance.now() - t0)} ms · sha1 verified`,
    info.integrity === false ? 'err' : 'ok');
    enrichFileInfo(text);
  } catch (e) {
    toast('Load failed: ' + e.message, 'err');
  } finally { clearBusy(); }
}

async function enrichFileInfo (text) {
  try {
    const [wikitext, history] = await Promise.all([
      C.getFileWikitext(state.file.title),
      C.getFileHistory(state.file.title, 8)
    ]);
    state.file.wikitext = wikitext;
    state.file.history = history;
    const lic = (wikitext || '').match(/\{\{\s*([A-Za-z0-9 ._\-]*(?:licen[cs]e|PD-|CC[- ]|self|GFDL|FAL)[A-Za-z0-9 ._\-]*)/i);
    state.file.licenseHint = lic ? lic[1].trim() : null;
    renderFileBar();
  } catch { /* non-fatal */ }
}

function loadLocalText (text, name = 'local file') {
  state.file = { title: name, url: null, sha1: null, size: new Blob([text]).size, user: 'you',
    timestamp: new Date().toISOString(), integrity: null, localOnly: true };
  state.originalText = text;
  state.localOnly = true;
  return putSvgIntoEditor(text).then(() => {
    snapshotBaseline();
    renderFileBar(); welcome(false); $('#saveBtn').disabled = false;
    toast(`Opened ${name} locally — saving to Commons is disabled in this mode.`, 'warn');
  });
}

/**
 * SVG-Edit rewrites a document the moment it is loaded (it wraps content in `<g class="layer">`,
 * assigns ids, may regroup shapes). So "what the user changed" must be measured against the
 * document *as loaded into the canvas*, not against the bytes on Commons — otherwise every save
 * would look like a full rewrite. The load-time rewrite itself is kept separately as `drift`,
 * because it is a real (if visually inert) difference from the current Commons revision.
 */
function snapshotBaseline () {
  try {
    state.baseline = V.cleanExport(editorSvg());
    state.drift = V.changeProfile(state.originalText, state.baseline);
  } catch (e) {
    state.baseline = state.originalText;
    state.drift = null;
    console.warn('baseline snapshot failed', e);
  }
}

function renderFileBar () {
  const f = state.file;
  if (!f) { $('#filebar').classList.add('hidden'); return; }
  $('#filebar').classList.remove('hidden');
  $('#fileTitle').textContent = f.title;
  $('#fileMeta').textContent = [
    f.localOnly ? 'local file' : `rev by ${f.user}`,
    f.localOnly ? null : fmtDate(f.timestamp),
    fmtBytes(f.size),
    f.width ? `${f.width}×${f.height}` : null,
    f.sha1 ? 'sha1 ' + shortSha1(f.sha1) : null,
    f.licenseHint ? 'license: ' + f.licenseHint : null
  ].filter(Boolean).join(' · ');
  const link = $('#fileLink');
  link.href = f.localOnly ? '#' : C.WIKI.filePage(f.title);
  link.classList.toggle('hidden', Boolean(f.localOnly));
  const pill = $('#freshPill');
  if (f.integrity === true) { pill.className = 'pill ok'; pill.textContent = 'sha1 verified against Commons'; }
  else if (f.integrity === false) { pill.className = 'pill err'; pill.textContent = 'sha1 mismatch'; }
  else { pill.className = 'pill warn'; pill.textContent = 'local (no Commons revision)'; }
}

/* --------------------------------------------------------------- saving flow */

async function openSaveDrawer () {
  let plain;
  try { plain = V.cleanExport(editorSvg()); } catch (e) { return toast('Export failed: ' + e.message, 'err'); }
  // SVG-Edit rewrites <linearGradient>/<filter>/… definitions on load; offer to keep the source ones
  const defDrift = state.originalText ? V.definitionDrift(state.originalText, plain) : { total: 0, rewritten: [], corrupted: [], missing: [] };
  let text = plain;
  let defsRestored = 0;
  let defsSkipped = 0;
  let framing = { applied: false, attributes: [] };
  if (!state.localOnly && preserveDefsPref && defDrift.total) {
    const r = V.preserveDefinitions(state.originalText, plain, state.baseline);
    text = V.ensureNamespaces(r.text, state.originalText); defsRestored = r.restored; defsSkipped = r.skippedEdited || 0;
  }
  if (!state.localOnly && state.originalText) {
    framing = V.preserveRootFraming(state.originalText, text, state.baseline);
    text = V.ensureNamespaces(framing.text, state.originalText);
  }
  const report = V.inspect(text);
  // user edits are measured against the canvas baseline (see snapshotBaseline), not the raw source
  const change = V.changeProfile(state.baseline ?? state.originalText, plain);
  state.draft = { text, plain, report, change, defDrift, defsRestored, defsSkipped, framing };
  drawer(true);
  $('#drawerBody').innerHTML = '<p class="dim">Checking the export against the live file…</p>';
  let fresh = null;
  if (!state.localOnly && state.file) {
    try { fresh = await C.checkFreshness(state.file.sha1, state.file.title); }
    catch (e) { fresh = { error: e.message }; }
  }
  renderSavePanel({ report, change, fresh, drift: state.drift, defDrift, defsRestored, defsSkipped, framing });
}

function renderSavePanel ({ report, change, fresh, drift, defDrift, defsRestored, defsSkipped = 0, framing = { applied: false, attributes: [] } }) {
  const f = state.file;
  const outSha1 = null; // filled asynchronously below
  const modeOverwrite = change.verdict === 'overwrite-ok';
  const body = $('#drawerBody');
  body.innerHTML = `
    <div class="sec">
      <h4>Before / after</h4>
      <div class="preview" id="previewRow">
        <figure><img id="pvBefore" alt="original"><figcaption>${f ? f.title : ''} (current revision)</figcaption></figure>
        <figure><img id="pvAfter" alt="edited"><figcaption>your edit (${fmtBytes(report.stats.bytes || 0)})</figcaption></figure>
      </div>
    </div>

    <div class="sec">
      <h4>Pre-flight checks (${report.errors.length} blocking, ${report.warnings.length} warning)</h4>
      <ul class="report">
        ${report.errors.map((e) => `<li class="err">✖ ${esc(e)}</li>`).join('')}
        ${report.warnings.map((w) => `<li class="warn">▲ ${esc(w)}</li>`).join('')}
        ${report.info.map((i) => `<li class="info">ℹ ${esc(i)}</li>`).join('')}
        ${report.ok && !report.warnings.length ? '<li class="ok">✔ no blocking problems found</li>' : ''}
      </ul>
    </div>

    <div class="sec">
      <h4>Definition fidelity</h4>
      ${defDrift.total === 0
        ? '<ul class="report"><li class="ok">✔ the editor did not rewrite any gradient/filter/pattern definition in this file.</li></ul>'
        : `<ul class="report">
            ${defDrift.corrupted.length ? `<li class="err">✖ ${defDrift.corrupted.length} definition(s) were corrupted by the editor (non-finite numbers): ${esc(defDrift.corrupted.slice(0, 2).join(' | '))}</li>` : ''}
            ${defDrift.rewritten.length ? `<li class="warn">▲ the editor rewrote ${defDrift.rewritten.length} definition(s) (gradientUnits/gradientTransform dropped, coordinates re-expressed) — visually equivalent only if the gradient maps the same bbox.</li>` : ''}
            ${defDrift.missing.length ? `<li class="warn">▲ ${defDrift.missing.length} definition(s) present in the source are missing from the export.</li>` : ''}
          </ul>
          <div class="row"><label><input type="checkbox" id="keepDefs" ${preserveDefsPref ? 'checked' : ''}> keep the source definitions verbatim (restored ${defsRestored}${defsSkipped ? `, ${defsSkipped} left as edited` : ''})</label></div>`}
      ${framing.applied ? `<ul class="report" style="margin-top:8px"><li class="info">ℹ root framing restored from the source revision: ${esc(framing.attributes.join(', '))} — the editor drops <code>viewBox</code>, which reframes any drawing whose viewBox origin is not <code>0 0</code>.</li></ul>` : ''}
      <div class="row"><button class="btn small" id="compareRenders">compare renders (pixel diff)</button><span class="dim" id="diffOut"></span></div>
    </div>

    <div class="sec">
      <h4>What you changed</h4>
      <dl class="kv">
        <dt>elements</dt><dd>${change.elementsBefore} → ${change.elementsAfter} (${change.elementDelta >= 0 ? '+' : ''}${change.elementDelta})</dd>
        <dt>geometry/attributes</dt><dd>${change.geometryChanged} element(s) changed (${Math.round(change.ratio * 100)}% of the drawing)</dd>
        <dt>text</dt><dd>${change.textChanged} of ${change.textTotal} text run(s) changed</dd>
        <dt>&lt;switch&gt; i18n</dt><dd>${change.switchesBefore} → ${change.switchesAfter}${change.switchesLost ? ' ⚠ translations lost' : ''}</dd>
      </dl>
      <p class="dim" style="margin:6px 0 0">${change.editedNothing
        ? 'Nothing has been edited in the canvas yet.'
        : change.verdict === 'overwrite-ok'
          ? 'Small, targeted change → a normal <em>overwrite</em> (new version of the same file) is appropriate (COM:OVERWRITE).'
          : 'Large or structural change → Commons convention is to upload this as a <em>new file</em>, or discuss it first (COM:OVERWRITE).'}</p>
      ${drift && (drift.geometryChanged || drift.shapeChanged || drift.elementDelta) ? `<ul class="report" style="margin-top:8px"><li class="info">ℹ editor normalisation, not your edit: loading this file into the canvas already rewrote ${drift.geometryChanged} element attribute set(s) (${drift.elementDelta >= 0 ? '+' : ''}${drift.elementDelta} elements, e.g. SVG-Edit wraps content in a <code>&lt;g class="layer"&gt;</code> and assigns ids). That difference is included in whatever you save.</li></ul>` : ''}
    </div>

    <div class="sec" id="conflictSec"></div>

    <div class="sec">
      <h4>Destination</h4>
      <div class="row"><label><input type="radio" name="mode" value="overwrite" ${modeOverwrite ? 'checked' : ''} ${state.localOnly ? 'disabled' : ''}> New version of <code>${esc(f?.title || '')}</code></label></div>
      <div class="row"><label><input type="radio" name="mode" value="new" ${modeOverwrite ? '' : 'checked'} ${state.localOnly ? 'disabled' : ''}> Upload as a <strong>new file</strong></label></div>
      <div class="row hidden" id="newFileRow"><input type="text" class="w" id="newName" placeholder="File:My new diagram.svg" value="${esc(suggestNewName(f?.title))}"></div>
    </div>

    <div class="sec" id="newFileMetaSec hidden">
    </div>

    <div class="sec">
      <h4>Edit summary (goes in the file history)</h4>
      <input type="text" class="w" id="comment" value="${esc(prefillComment(change))}">
      <div class="row"><label><input type="checkbox" id="watch"> add file to my watchlist</label></div>
    </div>

    <div class="sec">
      <h4>Account</h4>
      <div id="authLine" class="dim">${state.auth ? 'connected' : 'not connected'}</div>
    </div>

    <div class="sec">
      <button class="btn primary" id="doSave" style="width:100%" ${(!report.ok || state.localOnly || !state.auth || change.editedNothing || (fresh && fresh.fresh === false)) ? 'disabled' : ''}>
        ${state.localOnly ? 'Saving disabled for local files' : change.editedNothing ? 'Edit something first' : 'Save to Commons'}
      </button>
      <p class="dim" id="saveWhy" style="margin:6px 0 0"></p>
    </div>
  `;

  renderAuthLine();
  renderPreviews();
  renderConflict(fresh);
  wirePanel();

  // explain a disabled button instead of leaving the user guessing
  const why = $('#saveWhy');
  const reasons = [];
  if (state.localOnly) reasons.push('chosen file was opened from disk (no Commons file to write to)');
  if (change.editedNothing) reasons.push('nothing has been edited in the canvas yet — saving now would only add the editor\'s own normalisation to the file');
  if (!report.ok) reasons.push('blocking problems in the checks above');
  if (!state.auth) reasons.push('not connected to Commons — press “Connect to Commons”');
  if (fresh && fresh.fresh === false) reasons.push('a newer revision exists on Commons — reload first');
  why.textContent = reasons.length ? 'Blocked: ' + reasons.join('; ') + '.' : 'The upload will create a new revision; the file description page is not touched.';
}

function wirePanel () {
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
    const isNew = document.querySelector('input[name=mode]:checked').value === 'new';
    $('#newFileRow').classList.toggle('hidden', !isNew);
    const meta = $('#newFileMetaSec');
    if (isNew && !meta.dataset.built) { meta.innerHTML = newFileFields(); meta.dataset.built = '1'; }
    meta.classList.toggle('hidden', !isNew);
  }));
  $('#keepDefs')?.addEventListener('change', (e) => { preserveDefsPref = e.target.checked; openSaveDrawer(); });
  $('#compareRenders')?.addEventListener('click', async () => {
    const out = $('#diffOut');
    out.textContent = ' rendering…';
    try {
      const d = await V.pixelDiff(state.originalText, state.draft.text, 600);
      out.textContent = ` ${d.percentDifferent}% of pixels differ (browser render, ${d.width}×${d.height})`;
      state.lastDiff = d;
    } catch (e) { out.textContent = ' diff failed: ' + e.message; }
  });
  $('#doSave')?.addEventListener('click', doSave);
}

function renderAuthLine () {
  const el = $('#authLine');
  if (!el) return;
  el.innerHTML = state.auth
    ? `Connected as <strong>${esc(state.profile?.name || 'OAuth user')}</strong> <button class="btn small" id="logout">disconnect</button>`
    : `<button class="btn small" id="connect">Connect to Commons (OAuth 2.0)</button>`;
  $('#connect')?.addEventListener('click', showConnectPanel);
  $('#logout')?.addEventListener('click', () => { O.clearAuth(); state.auth = null; state.profile = null; refreshAuthButton(); renderAuthLine(); toast('Disconnected.', 'info'); });
}

async function renderPreviews () {
  try {
    if (state.originalText) {
      const a = await V.renderThumb(state.originalText, 320);
      $('#pvBefore').src = a.dataUrl;
    } else { $('#pvBefore').parentElement.style.display = 'none'; }
    const b = await V.renderThumb(state.draft.text, 320);
    $('#pvAfter').src = b.dataUrl;
    state.thumbRendered = b.nonBlank;
  } catch (e) { toast('Could not render a preview: ' + e.message, 'warn'); }
}

function renderConflict (fresh) {
  const el = $('#conflictSec');
  if (!el) return;
  if (state.localOnly) { el.innerHTML = '<h4>Conflict guard</h4><p class="dim">Not applicable (local file).</p>'; return; }
  if (fresh?.error) { el.innerHTML = `<h4>Conflict guard</h4><ul class="report"><li class="warn">▲ could not re-check the file: ${esc(fresh.error)}</li></ul>`; return; }
  if (fresh?.fresh) {
    el.innerHTML = `<h4>Conflict guard</h4><ul class="report"><li class="ok">✔ latest Commons sha1 ${shortSha1(fresh.current.sha1)} still matches the revision you loaded — safe to overwrite.</li></ul>`;
  } else if (fresh) {
    el.innerHTML = `<h4>Conflict guard</h4><ul class="report"><li class="err">✖ someone uploaded a new version while you were editing
      (now ${shortSha1(fresh.current.sha1)} by ${esc(fresh.current.user)} at ${fmtDate(fresh.current.timestamp)}).
      Saving would silently discard their work.</li></ul>
      <button class="btn small" id="reloadFile">Reload the current revision</button>`;
    $('#reloadFile')?.addEventListener('click', () => loadFromCommons(state.file.title));
  }
}

function newFileFields () {
  return `<h4>New file details</h4>
    <div class="row"><input type="text" class="w" id="nfDesc" placeholder="description"></div>
    <div class="row"><input type="text" class="w" id="nfAuthor" placeholder="author (your username)"></div>
    <div class="row"><input type="text" class="w" id="nfSource" placeholder="source (default {{own}})" value="{{own}}"></div>
    <div class="row"><input type="text" class="w" id="nfLicense" placeholder="license template" value="{{self|cc-by-sa-4.0}}"></div>
    <p class="dim">A file without a licence is deleted. This prototype only fills the standard {{Information}} block — check the licence before publishing.</p>`;
}

function prefillComment (change) {
  const bits = [];
  if (change.geometryChanged) bits.push(`${change.geometryChanged} element(s) edited`);
  if (change.textChanged) bits.push(`${change.textChanged} text run(s) updated`);
  if (!bits.length) bits.push('minor tweak');
  return `Edited in browser with the Commons SVG editor: ${bits.join(', ')} — `;
}

function suggestNewName (title) {
  if (!title) return 'File:New diagram.svg';
  return title.replace(/\.svg$/i, '') + ' (edited).svg';
}

async function doSave () {
  const draft = state.draft;
  const isNew = document.querySelector('input[name=mode]:checked')?.value === 'new';
  const comment = $('#comment').value.trim();
  const title = isNew ? C.normalizeTitle($('#newName').value) : state.file.title;
  if (!comment) return toast('Please write an edit summary — it is the only change description the next editor sees.', 'warn');
  if (!state.auth) return toast('Not connected to Commons.', 'err');

  let wikitext = null;
  if (isNew) {
    wikitext = V.newFileWikitext({
      description: $('#nfDesc')?.value || '', author: $('#nfAuthor')?.value || '',
      source: $('#nfSource')?.value || '{{own}}', license: $('#nfLicense')?.value || '{{self|cc-by-sa-4.0}}'
    });
  }

  setBusy('Uploading a new revision to Commons…');
  try {
    const localSha1 = await C.sha1Hex(new TextEncoder().encode(draft.text));
    const res = await C.uploadSvg({
      title, svgText: draft.text, comment, auth: state.auth,
      newFile: isNew, wikitext, ignoreWarnings: draft.report.warnings.length > 0,
      watchlist: $('#watch')?.checked ? 'watch' : 'nochange'
    });
    if (!res.ok) return showSaveError(res, { isNew, localSha1, title });

    const check = await C.verifySaved(title, localSha1);
    showSaveSuccess({ check, title, isNew, localSha1, revid: res.data?.upload?.result });
    if (!isNew) { state.file = { ...state.file, ...check, integrity: true }; state.originalText = draft.text; renderFileBar(); }
  } catch (e) {
    toast('Upload error: ' + e.message, 'err');
  } finally { clearBusy(); }
}

function showSaveError (res, { isNew, localSha1, title }) {
  const hints = {
    'mwoauth-invalid-authorization': 'the OAuth token is not valid any more — disconnect and connect again',
    'mwoauth-invalid-authorization-invalid-user': 'the token belongs to a user that no longer exists here',
    'mustbeloggedin': 'no usable OAuth session — connect first',
    'permissiondenied': 'the account is not allowed to overwrite files (needs autoconfirmed + the upload/reupload right), or the OAuth consumer was not granted the upload grants',
    'badaccess-groups': 'the account lacks the group rights required for this upload',
    'fileexists-no-change': 'Commons already holds a byte-identical file — there is nothing to save',
    'fileexists-forbidden': 'a file with that name already exists; pick "new version" instead of "new file"',
    'verification-error': 'the upload filter refused the file — check the pre-flight results above',
    'ratelimited': 'rate limited — wait a moment and retry',
    'badfilename': 'the title is not a legal file name on Commons'
  };
  $('#drawerBody').innerHTML = `
    <div class="sec"><h4>Upload refused</h4>
      <ul class="report">
        <li class="err">✖ ${esc(res.code)}: ${esc(res.info || '')}</li>
        ${hints[res.code] ? `<li class="info">ℹ ${esc(hints[res.code])}</li>` : ''}
      </ul>
      <dl class="kv">
        <dt>target</dt><dd>${esc(title)}</dd>
        <dt>mode</dt><dd>${isNew ? 'new file' : 'new version'}</dd>
        <dt>your file sha1</dt><dd><code>${localSha1}</code></dd>
        <dt>http</dt><dd>${res.status}</dd>
      </dl>
      <button class="btn" id="backToPanel">← back to the save panel</button>
    </div>`;
  $('#backToPanel').addEventListener('click', openSaveDrawer);
}

function showSaveSuccess ({ check, title, isNew, localSha1, revid }) {
  $('#drawerBody').innerHTML = `
    <div class="sec"><h4>Saved to Commons</h4>
      <ul class="report">
        <li class="ok">✔ <strong>${esc(title)}</strong> uploaded ${isNew ? 'as a new file' : 'as a new version'}${revid ? ' (revision ' + esc(String(revid)) + ')' : ''}.</li>
        <li class="${check.matchesLocalEdit ? 'ok' : 'warn'}">${check.matchesLocalEdit ? '✔' : '▲'} live file sha1 is now <code>${shortSha1(check.sha1)}</code>${check.matchesLocalEdit ? ' — identical to what the editor exported.' : ' — it differs from the exported file, check the file page.'}</li>
        <li class="info">ℹ version count is maintained server-side; the revision carries your edit summary and OAuth identity (${esc(check.user)}).</li>
      </ul>
      <dl class="kv">
        <dt>size</dt><dd>${fmtBytes(check.size)}</dd>
        <dt>uploaded by</dt><dd>${esc(check.user)} at ${fmtDate(check.timestamp)}</dd>
        <dt>exported sha1</dt><dd><code>${localSha1}</code></dd>
      </dl>
      <div class="row">
        <a class="btn" href="${C.WIKI.historyPage(title)}" target="_blank" rel="noopener">file history ↗</a>
        <a class="btn" href="${C.WIKI.filePage(title)}" target="_blank" rel="noopener">file page ↗</a>
        <button class="btn" id="reloadSaved">reload in editor</button>
      </div>
    </div>`;
  $('#reloadSaved').addEventListener('click', () => loadFromCommons(title));
}

/* ------------------------------------------------------------------- auth */

function refreshAuthButton () {
  const b = $('#authBtn');
  if (state.auth) { b.textContent = `Connected: ${state.profile?.name || '…'}`; b.classList.add('btn', 'ghost'); }
  else b.textContent = 'Connect to Commons';
}

function showConnectPanel () {
  drawer(true);
  $('#drawerTitle').textContent = 'Connect to Commons (OAuth 2.0)';
  $('#drawerBody').innerHTML = `
    <div class="sec">
      <h4>One-time setup</h4>
      <p class="dim">Wikimedia tools act through a registered OAuth 2.0 consumer. Register one (2 minutes, needs any account), then paste the client ID here. This page is a public client: no secret is stored, PKCE protects the code exchange.</p>
      <ol class="dim" style="padding-left:18px">
        <li><a href="https://commons.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose" target="_blank" rel="noopener">Special:OAuthConsumerRegistration/propose</a></li>
        <li>Grants: <em>Upload new files</em> (<code>uploadfile</code>) + <em>Upload, replace, and move files</em> (<code>uploadeditmovefile</code>)</li>
        <li>OAuth2 grant types: <code>authorization_code</code>, <code>refresh_token</code></li>
        <li>"Confidential client": <strong>no</strong> — this is a browser app (PKCE)</li>
        <li>Redirect URI: <code>${esc(state.setup.redirectUri)}</code></li>
      </ol>
    </div>
    <div class="sec">
      <h4>Client ID</h4>
      <div class="row"><input type="text" class="w" id="clientId" placeholder="e.g. 8f3c…" value="${esc(state.setup.clientId)}"></div>
      <div class="row"><input type="text" class="w" id="redirectUri" value="${esc(state.setup.redirectUri)}"></div>
      <div class="row"><input type="text" class="w" id="scopes" value="${esc(state.setup.scopes)}"></div>
      <button class="btn primary" id="startLogin">Connect</button>
    </div>`;
  $('#startLogin').addEventListener('click', async () => {
    const setup = { clientId: $('#clientId').value.trim(), redirectUri: $('#redirectUri').value.trim(), scopes: $('#scopes').value.trim() };
    if (!setup.clientId) return toast('Paste the client ID first.', 'warn');
    O.saveSetup(setup); state.setup = setup;
    await O.beginLogin(setup);
  });
}

async function handleCallback () {
  try {
    const auth = await O.completeLoginIfCallback(state.setup);
    if (!auth) return false;
    state.auth = auth;
    try { state.profile = await C.whoAmI(auth); } catch { state.profile = null; }
    refreshAuthButton(); renderAuthLine();
    toast(`Connected to Commons as ${state.profile?.name || 'OAuth user'}.`, 'ok');
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

/* ------------------------------------------------------------------- boot */

function esc (s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function boot () {
  mountEditor();
  await editorReady();
  state.auth = O.currentAuth();
  if (state.auth) { try { state.profile = await C.whoAmI(state.auth); } catch { state.auth = null; } }
  refreshAuthButton();
  if (location.search.includes('code=')) await handleCallback();

  $('#loadForm').addEventListener('submit', (e) => { e.preventDefault(); loadFromCommons($('#fileInput').value); });
  $('#localInput').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    loadLocalText(await f.text(), f.name);
  });
  $('#authBtn').addEventListener('click', () => (state.auth ? showConnectPanel() : showConnectPanel()));
  $('#saveBtn').addEventListener('click', () => { if (!state.file) return toast('Load a file first.', 'warn'); openSaveDrawer(); });
  $('#drawerClose').addEventListener('click', () => { drawer(false); $('#drawerTitle').textContent = 'Save to Commons'; });
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { $('#fileInput').value = c.dataset.title; loadFromCommons(c.dataset.title); }));

  const q = new URL(location.href).searchParams.get('file');
  if (q) { $('#fileInput').value = q; loadFromCommons(q); }

  // test / automation hooks (also handy from the browser console)
  window.__cse = {
    state, loadFromCommons, loadLocalText, openSaveDrawer, doSave,
    getExport: () => V.cleanExport(editorSvg()), inspect: V.inspect, changeProfile: V.changeProfile,
    cleanExport: V.cleanExport,
    definitionDrift: V.definitionDrift, preserveDefinitions: V.preserveDefinitions, pixelDiff: V.pixelDiff,
    ensureNamespaces: V.ensureNamespaces, preserveRootFraming: V.preserveRootFraming,
    renderThumb: V.renderThumb, normalizeTitle: C.normalizeTitle, getFileInfo: C.getFileInfo,
    sha1Hex: C.sha1Hex, uploadSvg: C.uploadSvg, checkFreshness: C.checkFreshness,
    buildAuthorizeUrl: O.buildAuthorizeUrl, pkceChallenge: O.pkceChallenge, randomVerifier: O.randomVerifier,
    editor: () => editor, ready: true
  };
  document.dispatchEvent(new CustomEvent('cse-ready'));
}

boot().catch((e) => { console.error(e); toast('Startup failed: ' + e.message, 'err', 20000); });
