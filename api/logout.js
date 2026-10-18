// Clears the session cookie and returns to the access page. With the private-workspace identity on (PROPX_IDENTITY=on),
// the named session is also ENDED on the server (not just forgotten by the browser) and its cookie cleared — when the
// identity cookie reaches this request. It does not on a cross-site navigation (the cookie is SameSite=Strict), and a store
// that does not answer within 3 s never blocks the sign-out; in both cases the server session stays valid until it expires
// (≤ 8 h) for whoever still holds BOTH cookies. The page therefore ends it first with a same-origin intent POST
// (/api/identity?op=signout) and only then follows this link (security review 19.10.2026, finding 6).

const { identityConfig, redact } = require('../lib/identity/config');
const { restAdapter } = require('../lib/identity/rest');
const { revokeFromCookie } = require('../lib/identity/service');
const { clear } = require('../lib/identity/cookie');

function createLogout({ adapter = null, env = process.env } = {}) {
  return async (req, res) => {
    const cfg = identityConfig(env, { injectedStore: Boolean(adapter) });
    if (cfg.enabled) {
      try {
        let timer;
        await Promise.race([
          revokeFromCookie(adapter || restAdapter(cfg, { timeoutMs: 3000 }), cfg, String((req.headers && req.headers.cookie) || '')),
          new Promise((ok) => { timer = setTimeout(ok, 3000); }),
        ]).finally(() => clearTimeout(timer));
      } catch (e) { console.error('logout: ' + redact(e && e.message, env)); }
    }
    res.setHeader('Set-Cookie', [
      'kobix_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      clear(),
    ]);
    res.statusCode = 302;
    res.setHeader('Location', '/login.html');
    res.end();
  };
}

module.exports = createLogout();
module.exports.createLogout = createLogout;
