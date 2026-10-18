// /api/identity — named, invite-only users of the PROPX private workspace (STEP 2A).
//
// Behind the site's perimeter gate (middleware.js: the shared-password session is still required for every path).
// Kill switch: PROPX_IDENTITY=on (lib/identity/config.js); OFF → GET ?op=status answers {enabled:false} and every other
// operation 503 — no private store is contacted, the page shows nothing.
//
//   GET  ?op=status                    who is signed in, their organizations and role in each, the session's times
//   GET  ?op=members&org=              the organization's members (any active member)
//   GET  ?op=admin-users               platform administrator only
//   POST ?op=signin {email,password} · signout · signout-all · invite-info {token} · activate {token,password,displayName}
//        accept {token} · invite {org,email,role} · revoke-invite {org,user} · set-role {org,user,role}
//        revoke-member {org,user} · create-team {name} · archive {org,archived} · admin-user-status {user,status}
//        admin-revoke-sessions {user}
//
// Every POST must be same-origin JSON carrying `x-propx-intent: 1` (a custom header a cross-site form or a simple request
// cannot send — login CSRF and cross-site writes are refused before anything is read). Bodies are capped at 8 KB.
// Answers are never cached. Errors say what failed, never the store's address, keys or internal messages.

'use strict';

const { identityConfig, redact } = require('../lib/identity/config');
const { restAdapter } = require('../lib/identity/rest');
const S = require('../lib/identity/service');

const MAX_BODY = 8 * 1024;

function send(res, status, body, setCookie) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  if (setCookie) res.setHeader('Set-Cookie', setCookie);
  res.end(JSON.stringify(body));
}

function originOf(req) {
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')).split(',')[0].trim();
  return host ? `${proto}://${host}` : null;
}

/** same-origin JSON with the intent header — or the reason it is refused */
function postGuard(req) {
  const h = req.headers || {};
  if (h['x-propx-intent'] !== '1') return 'intent';
  if (!/^application\/json\b/i.test(String(h['content-type'] || ''))) return 'content-type';
  const origin = originOf(req);
  if (h.origin && h.origin !== origin) return 'origin';
  if (h['sec-fetch-site'] && h['sec-fetch-site'] !== 'same-origin') return 'origin';
  return null;
}

async function readBody(req) {
  if (Number(req.headers && req.headers['content-length']) > MAX_BODY) return { tooLarge: true };
  if (req.body !== undefined) {   // Vercel parses JSON bodies before the function runs
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) return { tooLarge: true };
    if (typeof req.body === 'object' && req.body && !Buffer.isBuffer(req.body)) return { body: req.body };
    try { return { body: JSON.parse(raw || '{}') }; } catch { return { bad: true }; }
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return { tooLarge: true }; chunks.push(c); }
  try { return { body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }; } catch { return { bad: true }; }
}

function createHandler({ adapter = null, env = process.env } = {}) {
  return async function identity(req, res) {
    const url = new URL(req.url, 'http://local');
    const op = url.searchParams.get('op') || 'status';
    const cfg = identityConfig(env, { injectedStore: Boolean(adapter) });
    if (!cfg.enabled) {
      return op === 'status' && req.method === 'GET' ? send(res, 200, { enabled: false }) : send(res, 503, { enabled: false, error: 'identity-off' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'method' }); }
    let body = {};
    if (req.method === 'POST') {
      const why = postGuard(req);
      if (why) return send(res, 403, { ok: false, error: 'refused', reason: why });
      const b = await readBody(req);
      if (b.tooLarge) return send(res, 413, { ok: false, error: 'body too large', limitBytes: MAX_BODY });
      if (b.bad || !b.body || typeof b.body !== 'object' || Array.isArray(b.body)) return send(res, 400, { ok: false, error: 'invalid_input' });
      body = b.body;
    }
    try {
      const r = await S.dispatch({
        db: adapter || restAdapter(cfg), cfg, method: req.method, op, body,
        query: Object.fromEntries(url.searchParams), cookieHeader: String((req.headers && req.headers.cookie) || ''), origin: originOf(req),
      });
      return send(res, r.status, r.body, r.setCookie);
    } catch (e) {
      console.error('identity: ' + redact(e && e.message, env));
      return send(res, 500, { ok: false, error: 'internal' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
