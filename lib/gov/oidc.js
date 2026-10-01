// PROPX · GitHub Actions OIDC verification — machine authentication with no
// shared secret. A workflow of THIS repository, on the production branch, asks
// GitHub for a short-lived token signed by GitHub (RS256, published keys);
// the server verifies the signature and every identity claim. A fork, another
// branch, another workflow, a pull request or an expired token is refused.
//
// Used by api/jobs/tx-refresh.js next to the PROPX_JOB_TOKEN bearer token.

'use strict';

const crypto = require('node:crypto');

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = ISSUER + '/.well-known/jwks';
const AUDIENCE = 'propx-jobs';
/* the only identity allowed to call: kobi6061-hub/vizora (numeric id, so a rename or a lookalike never
   matches), its production branch, the job workflow, and only scheduled or hand-dispatched runs */
const EXPECT = {
  repositoryId: '1345179019', repository: 'kobi6061-hub/vizora', ref: 'refs/heads/claude/vizora-project-isolation-6lbq3g',
  workflows: ['.github/workflows/tx-refresh.yml'], events: ['workflow_dispatch', 'schedule'],
};

const b64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const isJwt = (t) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(t || ''));

let JWKS = null;   // { at, keys }
async function keyFor(kid, fetchImpl, now) {
  const fresh = JWKS && now - JWKS.at < 10 * 60e3;
  let k = fresh && JWKS.keys.find((x) => x.kid === kid);
  if (k) return k;
  const r = await fetchImpl(JWKS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('jwks ' + r.status);
  const body = await r.json();
  JWKS = { at: now, keys: Array.isArray(body.keys) ? body.keys : [] };
  k = JWKS.keys.find((x) => x.kid === kid);
  if (!k) throw new Error('unknown signing key');
  return k;
}

/**
 * @returns {Promise<object>} the verified claims; throws with the reason otherwise
 */
async function verifyGithubOidc(token, { fetchImpl = globalThis.fetch, now = Date.now(), expect = EXPECT, audience = AUDIENCE } = {}) {
  if (!isJwt(token)) throw new Error('not a JWT');
  const [h, p, s] = String(token).split('.');
  let header, claims;
  try { header = JSON.parse(b64u(h).toString('utf8')); claims = JSON.parse(b64u(p).toString('utf8')); } catch { throw new Error('malformed token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected algorithm');
  const jwk = await keyFor(header.kid, fetchImpl, now);
  if (jwk.kty !== 'RSA') throw new Error('unexpected key type');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64u(s));
  if (!ok) throw new Error('bad signature');
  const t = Math.floor(now / 1000);
  if (claims.iss !== ISSUER) throw new Error('issuer');
  if (!(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience)) throw new Error('audience');
  if (!(Number(claims.exp) > t - 30) || Number(claims.iat) > t + 60 || (claims.nbf != null && Number(claims.nbf) > t + 60)) throw new Error('expired or not yet valid');
  if (String(claims.repository_id) !== expect.repositoryId || claims.repository !== expect.repository) throw new Error('repository');
  if (claims.ref !== expect.ref) throw new Error('ref');
  if (!expect.events.includes(claims.event_name)) throw new Error('event');
  if (!expect.workflows.some((w) => claims.workflow_ref === `${expect.repository}/${w}@${expect.ref}`)) throw new Error('workflow');
  return claims;
}

module.exports = { verifyGithubOidc, isJwt, AUDIENCE, EXPECT, ISSUER, JWKS_URL };
