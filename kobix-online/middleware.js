// KobiX RealEstate — Vercel Edge Middleware access gate.
// Every request (except the login endpoints and crawler files) must carry a
// valid signed session cookie; otherwise it is redirected to /login.html.
// The password itself never reaches the client: it lives in the SITE_PASSWORD
// environment variable and is checked only in /api/login.

const COOKIE = 'kobix_session';

export const config = {
  matcher: ['/((?!api/login|login\\.html|robots\\.txt|favicon\\.ico).*)'],
};

export default async function middleware(req) {
  const cookies = req.headers.get('cookie') || '';
  const raw = cookies
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + '='));
  if (raw && (await verify(raw.slice(COOKIE.length + 1)))) {
    return; // valid session — continue to the static asset
  }
  return Response.redirect(new URL('/login.html', req.url), 302);
}

async function verify(token) {
  try {
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
