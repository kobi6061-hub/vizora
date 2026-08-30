// POST {password} → verifies against the SITE_PASSWORD environment variable
// and sets a signed, HttpOnly session cookie. The password never appears in
// any client-delivered code. With SITE_PASSWORD or SESSION_SECRET unset, the
// deployment stays closed and answers 503 {error:"config"} so the login page
// can say "not configured yet" instead of a misleading "wrong password".

const { timingSafeEqual } = require('node:crypto');

const COOKIE = 'kobix_session';
const MAX_AGE_S = 60 * 60 * 12; // 12-hour session

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let password = '';
  try {
    password = String(JSON.parse(body || '{}').password || '');
  } catch {
    /* malformed body → empty password → 401 */
  }

  const expected = process.env.SITE_PASSWORD || '';
  if (!expected || !process.env.SESSION_SECRET) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false, error: 'config' }));
  }
  const a = Buffer.from(password.padEnd(256, '\0').slice(0, 256));
  const b = Buffer.from(expected.padEnd(256, '\0').slice(0, 256));
  const ok = expected.length > 0 && password.length > 0 && timingSafeEqual(a, b);

  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (!ok) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false }));
  }

  const exp = String(Date.now() + MAX_AGE_S * 1000);
  const sig = await hmacHex('kobix|' + exp);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${exp}.${sig}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`,
  );
  res.end(JSON.stringify({ ok: true }));
};

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
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
