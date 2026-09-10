/**
 * oauth.js — Wikimedia OAuth 2.0 authorization-code + PKCE client (public client, no secret).
 *
 * Why PKCE and nothing simpler:
 *  - Commons' CORS responses are `access-control-allow-origin: *` with
 *    `access-control-allow-credentials: false`, so a browser page can never hold a
 *    cookie session. Bearer tokens are the only way to write as a logged-in user.
 *  - A static page cannot keep a client secret → public client + PKCE (RFC 7636).
 * Verified 2026-09-10: POST /w/rest.php/oauth2/access_token answers with
 * `access-control-allow-origin: *`, so the code→token exchange is readable from the browser.
 * Docs: https://www.mediawiki.org/wiki/OAuth/For_Developers
 *
 * One-time setup the tool owner must do (2 minutes):
 *   https://commons.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose
 *     · "This consumer is for use only by <you>"  → optional, kept off for a shared tool
 *     · Grants: "Upload new files" (uploadfile) + "Upload, replace, and move files" (uploadeditmovefile)
 *     · OAuth2 grants: authorization_code + refresh_token
 *     · Confidential client: NO  (we are a browser app → PKCE)
 *     · Redirect URI: the URL this app is served from, e.g. https://example.org/svg-editor/
 *   Then paste the client ID into the Connect dialog.
 */

export const AUTH_ENDPOINTS = {
  authorize: 'https://commons.wikimedia.org/w/rest.php/oauth2/authorize',
  token: 'https://commons.wikimedia.org/w/rest.php/oauth2/access_token',
  profile: 'https://commons.wikimedia.org/w/rest.php/oauth2/resource/profile'
};

export const DEFAULT_SETUP = {
  clientId: '',
  redirectUri: '',
  scopes: 'basic uploadfile uploadeditmovefile'
};

/* --------------------------------------------------------------- PKCE bits */

export function base64Url (bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier (byteLength = 48) {
  const a = new Uint8Array(byteLength);
  crypto.getRandomValues(a);
  return base64Url(a);
}

export async function pkceChallenge (verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/* ------------------------------------------------------------ url building */

export function buildAuthorizeUrl ({ clientId, redirectUri, state, challenge, scopes = '' }) {
  if (!clientId) throw new Error('Missing OAuth client ID.');
  const u = new URL(AUTH_ENDPOINTS.authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  if (redirectUri) u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (scopes) u.searchParams.set('scope', scopes);
  return u.toString();
}

/** Pure helper (unit-tested): pull `code`/`state`/`error` out of a callback URL. */
export function parseCallback (href) {
  const u = new URL(href);
  const q = u.searchParams;
  return {
    code: q.get('code'),
    state: q.get('state'),
    error: q.get('error'),
    errorDescription: q.get('error_description')
  };
}

/* ------------------------------------------------------------------- flow */

const LS_SETUP = 'cse.oauth.setup';
const SS_FLOW = 'cse.oauth.flow';
const SS_TOKEN = 'cse.oauth.token';

export function loadSetup () {
  try { return { ...DEFAULT_SETUP, redirectUri: location.href.split('?')[0].split('#')[0], ...JSON.parse(localStorage.getItem(LS_SETUP) || '{}') }; }
  catch { return { ...DEFAULT_SETUP, redirectUri: location.href.split('?')[0] }; }
}
export function saveSetup (setup) { localStorage.setItem(LS_SETUP, JSON.stringify(setup)); }

export function currentAuth () {
  try {
    const t = JSON.parse(sessionStorage.getItem(SS_TOKEN) || 'null');
    if (!t?.accessToken) return null;
    if (t.expiresAt && Date.now() > t.expiresAt - 60000) return null; // expired
    return t;
  } catch { return null; }
}
export function storeAuth (token) { sessionStorage.setItem(SS_TOKEN, JSON.stringify(token)); }
export function clearAuth () { sessionStorage.removeItem(SS_TOKEN); }

/** Kick off the redirect to Commons. */
export async function beginLogin (setup) {
  const verifier = randomVerifier();
  const challenge = await pkceChallenge(verifier);
  const state = randomVerifier(16);
  sessionStorage.setItem(SS_FLOW, JSON.stringify({ verifier, state, ts: Date.now() }));
  const url = buildAuthorizeUrl({ ...setup, state, challenge });
  location.assign(url);
}

/** If the page was reached with ?code=… , exchange it for an access token. */
export async function completeLoginIfCallback (setup) {
  const { code, state, error, errorDescription } = parseCallback(location.href);
  if (error) { cleanUrl(); throw new Error(`Commons refused the authorization: ${error} ${errorDescription || ''}`); }
  if (!code) return null;
  const flow = JSON.parse(sessionStorage.getItem(SS_FLOW) || 'null');
  if (!flow) throw new Error('No OAuth flow in progress in this tab (state lost). Start the connection again.');
  if (flow.state !== state) throw new Error('OAuth state mismatch — refusing the callback.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: setup.clientId,
    redirect_uri: setup.redirectUri,
    code_verifier: flow.verifier
  });
  const res = await fetch(AUTH_ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    credentials: 'omit'
  });
  const data = await res.json().catch(() => ({}));
  cleanUrl();
  sessionStorage.removeItem(SS_FLOW);
  if (!res.ok || !data.access_token) {
    throw new Error(`Token exchange failed: ${data.error || res.status} ${data.error_description || ''}`);
  }
  const auth = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
    scopes: data.scope || setup.scopes
  };
  storeAuth(auth);
  return auth;
}

export async function refresh (setup, auth) {
  if (!auth?.refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: setup.clientId
  });
  const res = await fetch(AUTH_ENDPOINTS.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, credentials: 'omit'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  const next = { ...auth, accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000) };
  storeAuth(next);
  return next;
}

function cleanUrl () {
  history.replaceState({}, '', location.pathname + location.hash);
}
