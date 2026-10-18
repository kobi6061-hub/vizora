// PROPX · private workspace identity — passwords (STEP 2A).
//
// scrypt (node:crypto) with a random 16-byte salt: "scrypt$N$r$p$<salt>$<hash>". The password itself never leaves the
// server function: only the hash is stored (private.user_credentials, not exposed through the API). Verification is
// constant-time, and an unknown email is verified against a dummy hash so the answer takes the same time.

'use strict';

const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');

const N = 1 << 15, R = 8, P = 1, KEYLEN = 32, MAXMEM = 64 * 1024 * 1024;
const MIN_LEN = 12, MAX_BYTES = 256;

const derive = (pw, salt, n, r, p) => new Promise((ok, no) =>
  scrypt(String(pw), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? no(e) : ok(k))));

/** null when acceptable, else the reason code */
function policy(pw) {
  const s = String(pw == null ? '' : pw);
  if ([...s].length < MIN_LEN) return 'password_too_short';
  if (Buffer.byteLength(s, 'utf8') > MAX_BYTES) return 'password_too_long';
  if (/^(.)\1*$/.test(s)) return 'password_too_weak';
  return null;
}

async function hash(pw) {
  const salt = randomBytes(16);
  const k = await derive(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${k.toString('base64url')}`;
}

let dummy = null;
async function dummyHash() { if (!dummy) dummy = await hash(randomBytes(24).toString('base64url')); return dummy; }

async function verify(pw, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(String(stored || ''));
  const target = m ? m : /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(await dummyHash());
  const [n, r, p] = [Number(target[1]), Number(target[2]), Number(target[3])];
  if (n !== N || r !== R || p !== P) return false;   // a hash with other parameters is never trusted
  const want = Buffer.from(target[5], 'base64url');
  const got = await derive(String(pw == null ? '' : pw).slice(0, MAX_BYTES), Buffer.from(target[4], 'base64url'), n, r, p);
  return Boolean(m) && want.length === got.length && timingSafeEqual(want, got);
}

module.exports = { hash, verify, policy, dummyHash, MIN_LEN };
