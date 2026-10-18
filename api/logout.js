// Clears the session cookie and returns to the access page. With the private-workspace identity on (PROPX_IDENTITY=on),
// the named session is also ENDED on the server (not just forgotten by the browser) and its cookie cleared; a store
// that does not answer within 3 s never blocks the sign-out — the identity session is bound to the perimeter session
// just cleared, so it cannot be used again either way.

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
