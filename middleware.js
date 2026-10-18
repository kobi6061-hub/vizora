// KobiX RealEstate — Vercel Edge Middleware access gate.
// Every request (except the login endpoints and crawler files) must carry a
// valid signed session cookie; otherwise it is redirected to /login.html.
// The password itself never reaches the client: it lives in the SITE_PASSWORD
// environment variable and is checked only in /api/login.
//
// The matcher sends EVERY path here and the exclusions are decided below on the
// parsed pathname by EXACT comparison (19.10.2026 — before, the matcher excluded
// by prefix, so a future /api/login-anything or /login.html.bak would have
// passed ungated). scripts/kobix-dev-server.mjs uses the same two lists;
// test/security-gate.test.js keeps them equal.
//
// One machine-only path passes without a cookie: exactly /api/jobs/tx-refresh
// (compared on the parsed, normalized pathname — no prefix, no encoded
// segments), because that function authenticates the caller itself with a
// bearer token from server-side env and fails closed (api/jobs/tx-refresh.js).
//
// The evidence request (POST /api/intel, view=dd — the user's documents in the
// body) is refused here, before the function runs, when its declared length is
// over 256 KB. A request without a Content-Length (chunked) is checked again by
// the function after the platform has read it (the platform's own ceiling is
// 4.5 MB); the function also caps the normalized evidence at 256 KB.

const COOKIE = 'kobix_session';
const PUBLIC_PATHS = new Set(['/api/login', '/login.html', '/robots.txt', '/favicon.ico']);
const MACHINE_PATHS = new Set(['/api/jobs/tx-refresh']);
const EVIDENCE_PATH = '/api/intel';
const MAX_EVIDENCE_BODY = 256 * 1024;

export const config = {
  matcher: ['/(.*)'],
};

export default async function middleware(req) {
  const pathname = new URL(req.url).pathname;
  if (MACHINE_PATHS.has(pathname)) return; // its own token gate, fail-closed
  if (PUBLIC_PATHS.has(pathname)) return; // exactly these paths — never a prefix
  const cookies = req.headers.get('cookie') || '';
  const raw = cookies
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + '='));
  if (raw && (await verify(raw.slice(COOKIE.length + 1)))) {
    if (req.method === 'POST' && pathname === EVIDENCE_PATH) {
      const declared = Number(req.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BODY) {
        return new Response(JSON.stringify({ error: 'body too large', limitBytes: MAX_EVIDENCE_BODY }), { status: 413, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
      }
    }
    return; // valid session — continue to the static asset / function
  }
  return Response.redirect(new URL('/login.html', req.url), 302);
}

async function verify(token) {
  try {
    // no signing secret configured → no cookie can be trusted (fail closed)
    if (!process.env.SESSION_SECRET) return false;
    const [exp, sig] = String(token).split('.');
    if (!exp || !sig) return false;
    if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    const expected = await hmacHex('kobix|' + exp);
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

async function hmacHex(msg) {
  const secret = process.env.SESSION_SECRET || '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
