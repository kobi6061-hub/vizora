// PROPX · the server-side store configuration, and the redaction of its values.
//
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-side env only) name the
// dedicated PROPX Supabase project. A value that is set but malformed is
// "store-misconfigured", reported without echoing it. Any text that may leave
// the process (an API answer, a run log committed to the public repository, a
// CI log) passes through redact() first: the store's address, its host, the
// keys and the job token are removed BEFORE any truncation, so a cut can never
// leave part of one behind.

'use strict';

const STORE_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/;
const SECRET_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'PROPX_JOB_TOKEN', 'SESSION_SECRET', 'SITE_PASSWORD'];

/** {ok:true, url, key} | {ok:false, reason:'store-not-configured'|'store-misconfigured'} */
function storeConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim(), key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url && !key) return { ok: false, reason: 'store-not-configured' };
  if (!url || !key || !STORE_URL.test(url)) return { ok: false, reason: 'store-misconfigured' };
  return { ok: true, url: url.replace(/\/$/, ''), key };
}

/** text without the store's address, its host, the keys or the job token */
function redact(text, env = process.env) {
  let s = String(text == null ? '' : text);
  const url = String(env.SUPABASE_URL || '').trim();
  const host = (/^(?:[a-z]+:\/\/)?([^/\s?#]+)/i.exec(url) || [])[1];
  const values = [url, url.replace(/\/$/, ''), host, ...SECRET_NAMES.map((k) => String(env[k] || '').trim())]
    .filter((v) => v && v.length >= 6).sort((a, b) => b.length - a.length);
  for (const v of values) s = s.split(v).join('<redacted>');
  return s.replace(/\b[a-z0-9-]+\.supabase\.(?:co|in|net)\b/gi, '<store>');   // any project host, configured or not
}

module.exports = { storeConfig, redact };
