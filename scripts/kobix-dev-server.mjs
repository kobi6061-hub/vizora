// Local simulation of the Vercel deployment for QA:
// reproduces middleware.js + api/login.js + api/logout.js semantics
// over the static repo root. NOT deployed.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 3200);
const SITE_PASSWORD = String(process.env.SITE_PASSWORD || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE = 'kobix_session';
const MAX_AGE_S = 60 * 60 * 12;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon' };

const hmacHex = (msg) => createHmac('sha256', SESSION_SECRET).update('kobix|' + msg).digest('hex');

function verify(token) {
  try {
    if (!SESSION_SECRET) return false; // parity with middleware.js fail-closed
    const [exp, sig] = String(token).split('.');
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    const expect = hmacHex(exp);
    return sig.length === expect.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch { return false; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://x`);
  const p = url.pathname;

  if (p === '/api/login' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let password = '';
    try { password = String(JSON.parse(body || '{}').password || '').trim(); } catch {}
    res.setHeader('content-type', 'application/json');
    if (!SITE_PASSWORD || !SESSION_SECRET) { res.statusCode = 503; return res.end('{"ok":false,"error":"config"}'); }
    const a = Buffer.from(password.padEnd(256, '\0').slice(0, 256));
    const b = Buffer.from(SITE_PASSWORD.padEnd(256, '\0').slice(0, 256));
    const ok = SITE_PASSWORD.length > 0 && password.length > 0 && timingSafeEqual(a, b);
    if (!ok) { res.statusCode = 401; return res.end('{"ok":false}'); }
    const exp = String(Date.now() + MAX_AGE_S * 1000);
    res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${hmacHex(exp)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax`);
    return res.end('{"ok":true}');
  }
  if (p === '/api/logout') {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.statusCode = 302; res.setHeader('Location', '/login.html'); return res.end();
  }

  // middleware gate (same exclusions as middleware.js matcher)
  const open = p === '/login.html' || p === '/robots.txt' || p === '/favicon.ico';
  if (!open) {
    const raw = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
    if (!(raw && verify(raw.slice(COOKIE.length + 1)))) {
      res.statusCode = 302; res.setHeader('Location', '/login.html'); return res.end();
    }
  }

  // serverless api simulation (same modules Vercel runs)
  if (p.startsWith('/api/geo/') || p.startsWith('/api/gov/')) {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const mod = path.join(ROOT, p.replace(/^\/api\//, 'api/') + '.js');
    try { return require(mod)(req, res); }
    catch (e) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'no-such-endpoint', reason: e.message })); }
  }

  // static
  const file = p === '/' ? '/index.html' : p;
  try {
    const data = await readFile(path.join(ROOT, path.normalize(file).replace(/^([.][.][/\\])+/, '')));
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404; res.end('not found');
  }
}).listen(PORT, () => console.log('kobix dev server on :' + PORT));
