// Local simulation of the Vercel deployment for QA:
// reproduces middleware.js + api/login.js + api/logout.js semantics over the static repo root. NOT deployed.
// The gate IS the deployed one: lib/identity/gate.mjs (the same module middleware.js imports), and /api/login, /api/logout,
// /api/identity are the deployed modules — so the local and the deployed gate cannot drift.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decide, accessMode, PUBLIC_PATHS, MACHINE_PATHS, CLEAR_COOKIES, BOUNCE_HTML, CLOSED_HTML } from '../lib/identity/gate.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 3200);
const EVIDENCE_PATH = '/api/intel';
const MAX_EVIDENCE_BODY = 256 * 1024;
void PUBLIC_PATHS; void MACHINE_PATHS;   // the exact lists live in the gate module only (test/security-gate.test.js)

// private-workspace identity: with PROPX_WS_PSQL set (a THROWAWAY local database from scripts/private-pg-local.sh, connected
// as `authenticator`) the store is that database through scripts/identity-psql-adapter.js; otherwise the default
// (PROPX_IDENTITY unset → PERIMETER, the shared password).
const IDENTITY_PSQL = process.env.PROPX_WS_PSQL || '';
let identityApi = null;
async function identity() {
  if (identityApi) return identityApi;
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const adapter = IDENTITY_PSQL ? require(path.join(ROOT, 'scripts/identity-psql-adapter.js')).psqlAdapter(IDENTITY_PSQL) : null;
  identityApi = {
    adapter,
    handler: require(path.join(ROOT, 'api/identity.js')).createHandler({ adapter, env: process.env }),
    logout: require(path.join(ROOT, 'api/logout.js')).createLogout({ adapter, env: process.env }),
    login: require(path.join(ROOT, 'api/login.js')).createLogin({ adapter, env: process.env }),
  };
  return identityApi;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** the gate, exactly as the Edge middleware runs it (the store check through the local adapter) */
async function gate(req, p) {
  const I = await identity();
  const injectedStore = Boolean(I.adapter);
  const M = accessMode(process.env, { injectedStore });
  const checkSession = M.mode === 'identity' && I.adapter
    ? async (sid, tokenHash) => { const r = await I.adapter.rpc('auth_session_check', { p_session_id: sid, p_token_hash: tokenHash }, { role: 'propx_auth' }); return r.ok ? { ok: true, value: r.value } : { ok: false }; }
    : null;
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return decide({ url: 'http://local' + req.url, method: req.method, headers }, process.env, { checkSession, injectedStore });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://x`);
  const p = url.pathname;

  if (p === '/api/login') return (await identity()).login(req, res);     // the deployed module: perimeter or individual sign-in
  if (p === '/api/logout') return (await identity()).logout(req, res);   // the deployed module: perimeter + named session

  // the gate — lib/identity/gate.mjs, the module middleware.js runs at the Edge
  const d = await gate(req, p);
  if (d.action !== 'pass') {
    res.setHeader('cache-control', 'no-store');
    if (d.action === 'bounce') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(BOUNCE_HTML); }
    if (d.action === 'closed' || d.action === 'store-unavailable') {
      res.statusCode = 503;
      if (p.startsWith('/api/')) { res.setHeader('content-type', 'application/json; charset=utf-8'); return res.end(JSON.stringify({ ok: false, error: d.action === 'closed' ? 'access-closed' : 'identity-store-unavailable' })); }
      res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(CLOSED_HTML);
    }
    if (d.clear) res.setHeader('Set-Cookie', CLEAR_COOKIES);
    res.statusCode = 302; res.setHeader('Location', '/login.html'); return res.end();
  }
  /* parity with middleware.js: a declared evidence body over 256 KB is refused before the function runs */
  if (d.why !== 'public' && d.why !== 'machine' && req.method === 'POST' && p === EVIDENCE_PATH && Number(req.headers['content-length']) > MAX_EVIDENCE_BODY) {
    res.statusCode = 413; res.setHeader('content-type', 'application/json; charset=utf-8'); return res.end(JSON.stringify({ error: 'body too large', limitBytes: MAX_EVIDENCE_BODY }));
  }

  if (p === '/api/identity') return (await identity()).handler(req, res);

  // serverless api simulation (same modules Vercel runs)
  if (p.startsWith('/api/geo/') || p.startsWith('/api/gov/') || p.startsWith('/api/jobs/') || p === '/api/housing' || p === '/api/land' || p === '/api/intel') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const mod = path.join(ROOT, p.replace(/^\/api\//, 'api/') + '.js');
    try { return require(mod)(req, res); }
    catch (e) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'no-such-endpoint', reason: e.message })); }
  }

  // static
  // vercel.json rewrites: /altaris → /altaris/index.html (the ALTARIS module); a directory path serves its index
  const file = p === '/' ? '/index.html' : p === '/altaris' || p === '/altaris/' ? '/altaris/index.html' : p;
  try {
    const data = await readFile(path.join(ROOT, path.normalize(file).replace(/^([.][.][/\\])+/, '')));
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404; res.end('not found');
  }
}).listen(PORT, () => console.log('kobix dev server on :' + PORT));
