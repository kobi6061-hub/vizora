#!/usr/bin/env node
// PROPX · read-only LIVE CHECK of the street search on deployed sites (21.10.2026, the founder's "הרב משה → לא נמצאו תוצאות").
// For every host and query it records what the browser's request actually receives: HTTP status · content type · redirect target ·
// Vercel deployment id · API error code · number of matches · the first matches — and classifies it:
//   OK (n matches, zero included) · AUTH_REQUIRED (the session gate redirects to /login.html — what a page whose session ended gets) ·
//   VERCEL_PROTECTION (Vercel deployment protection answers before the site) · INDEX_UNAVAILABLE (503) · SERVER_ERROR · TIMEOUT ·
//   INVALID_RESPONSE (not the API's JSON) · NETWORK.
// Authentication is the browser's own: POST /api/login with the password from the runner secret PROPX_SITE_PASSWORD (the preview may
// use PROPX_PREVIEW_SITE_PASSWORD); a preview behind Vercel protection is reached only with the project's own automation-bypass secret
// (VERCEL_AUTOMATION_BYPASS_SECRET, header x-vercel-protection-bypass). Neither secret, nor the session cookie, is ever printed. Without
// them the run says NOT AUTHENTICATED and exits 2 — never a pass. GET only (+ the one login POST). Writes nothing to the repository.
//
// env: HOSTS="production=https://propx.live,preview=https://…vercel.app" · SITE_PW · PREVIEW_SITE_PW · VERCEL_BYPASS ·
//      WAIT_SHA + GITHUB_TOKEN + GITHUB_REPOSITORY (wait for this commit's Vercel deployment first) · OUT (JSON report path)

'use strict';

const fs = require('node:fs');

const HOSTS = (process.env.HOSTS || 'production=https://propx.live').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return { name: x.slice(0, i), base: x.slice(i + 1).replace(/\/$/, '') }; });
const QUERIES = [
  { q: 'הרב משה', expect: { min: 1 } },
  { q: 'הרב משה', near: '7900', expect: { min: 1 } },
  { q: 'הרצל פתח תקווה', expect: { first: 'st:7900:213' } },
  { q: 'שחם פתח תקווה', expect: { first: 'st:7900:156' } },
  { q: 'הרב אונטרמן משה פתח תקווה', expect: { first: 'st:7900:546' } },
  { q: 'הרב משה פתח תקווה', expect: { min: 1 } },
  { q: 'אויערבך', expect: { has: 'st:7900:595' } },
  { q: 'משה אויערבך', expect: { first: 'st:7900:595' } },
  { q: 'הרב מש', expect: { min: 1 } },
  { q: 'רידינג', near: '5000', expect: { min: 1 } },
  { q: 'שדרות הפרחים ניר ח"ן', expect: { first: 'st:11:100' } },
  { q: 'קקקקקקק', expect: { zero: true } },
];
const REPORTS = ['st:7900:546', 'st:7900:595', 'st:11:100'];

const redact = (s) => String(s || '').replace(/kobix_session=[^;,\s]+/g, 'kobix_session=<redacted>').replace(/x-vercel-protection-bypass=[^&\s]+/g, 'x-vercel-protection-bypass=<redacted>');

async function waitForDeployment() {
  const sha = process.env.WAIT_SHA, tok = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!sha || !tok || !repo) return null;
  const until = Date.now() + 12 * 60 * 1000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=50`, { headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json' } });
      const l = r.ok ? await r.json() : [];
      const v = l.find((s) => /vercel/i.test(s.context || ''));
      if (v && v.state !== 'pending') return { context: v.context, state: v.state, description: v.description, at: v.created_at };
    } catch { /* retry */ }
    await new Promise((ok) => setTimeout(ok, 15000));
  }
  return { state: 'timeout', description: 'no Vercel status for this commit within 12 minutes' };
}

async function req(base, path, opt) {
  const t0 = Date.now();
  try {
    const r = await fetch(base + path, { method: opt.method || 'GET', redirect: 'manual', headers: opt.headers, body: opt.body, signal: AbortSignal.timeout(30000) });
    const type = r.headers.get('content-type') || '', loc = r.headers.get('location') || '';
    const text = await r.text().catch(() => '');
    return { status: r.status, type, location: redact(loc), vercelId: r.headers.get('x-vercel-id') || null, cache: r.headers.get('cache-control') || null, setCookie: r.headers.getSetCookie ? r.headers.getSetCookie() : [], text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, error: e.name === 'TimeoutError' ? 'timeout' : 'network', detail: String(e.cause && e.cause.code || e.message).slice(0, 80), ms: Date.now() - t0 };
  }
}
function classify(r, isAnswer) {
  if (r.status === 0) return r.error === 'timeout' ? 'TIMEOUT' : 'NETWORK';
  if (r.status >= 300 && r.status < 400) return /vercel\.com\/sso|_vercel_sso|vercel\.com\/login/.test(r.location) ? 'VERCEL_PROTECTION' : /\/login\.html/.test(r.location) ? 'AUTH_REQUIRED' : 'REDIRECT';
  if (r.status === 401 || r.status === 403) return /vercel/i.test(r.text.slice(0, 2000)) ? 'VERCEL_PROTECTION' : 'AUTH_REQUIRED';
  let j = null; if (/json/.test(r.type)) try { j = JSON.parse(r.text); } catch { j = null; }
  if (r.status === 503 && j && j.error === 'geo-index-unavailable') return 'INDEX_UNAVAILABLE';
  if (r.status === 504) return 'TIMEOUT';
  if (r.status >= 500) return 'SERVER_ERROR';
  if (r.status !== 200 || !j || !isAnswer(j)) return 'INVALID_RESPONSE';
  return 'OK';
}

(async () => {
  const deployment = await waitForDeployment();
  if (deployment) console.log('deployment of', process.env.WAIT_SHA, '→', JSON.stringify(deployment));
  const report = { at: new Date().toISOString(), commit: process.env.WAIT_SHA || null, deployment, hosts: [] };
  let verified = 0, failed = 0;
  for (const h of HOSTS) {
    const isPreview = h.name !== 'production';
    const pw = (isPreview && process.env.PREVIEW_SITE_PW) || process.env.SITE_PW || '';
    const headers = { accept: 'application/json' };
    if (isPreview && process.env.VERCEL_BYPASS) headers['x-vercel-protection-bypass'] = process.env.VERCEL_BYPASS;
    const H = { name: h.name, base: h.base, bypassSent: !!headers['x-vercel-protection-bypass'], login: null, page: null, search: [], reports: [] };
    /* sign in as the browser does (only with the runner secret) */
    if (pw) {
      const r = await req(h.base, '/api/login', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      const c = (r.setCookie || []).map((x) => x.split(';')[0]).find((x) => x.startsWith('kobix_session='));
      if (c) headers.cookie = c;
      H.login = { status: r.status, type: r.type, location: r.location, vercelId: r.vercelId, sessionCookie: !!c, class: c ? 'SIGNED_IN' : classify(r, () => false), ms: r.ms };
    } else H.login = { class: 'NOT_ATTEMPTED', reason: 'runner secret PROPX_SITE_PASSWORD not configured' };
    const authed = !!headers.cookie;
    /* the page itself: does this deployment carry the search fix? */
    { const r = await req(h.base, '/', { headers: { ...headers, accept: 'text/html' } });
      H.page = { status: r.status, type: r.type, location: r.location, vercelId: r.vercelId, hasSearchFix: r.status === 200 ? /async function srchFetch\(/.test(r.text) : null, ms: r.ms }; }
    for (const Q of QUERIES) {
      const path = '/api/geo/search?limit=12&q=' + encodeURIComponent(Q.q) + (Q.near ? '&near=' + encodeURIComponent(Q.near) : '');
      const r = await req(h.base, path, { headers });
      const cls = classify(r, (j) => Array.isArray(j.matches));
      const row = { q: Q.q, near: Q.near || null, status: r.status, type: r.type || null, location: r.location || null, vercelId: r.vercelId || null, cache: r.cache || null, ms: r.ms, class: cls };
      if (cls === 'OK') {
        const j = JSON.parse(r.text), st = j.matches.filter((m) => m.kind === 'street');
        row.matches = j.matches.length; row.streets = st.length; row.top = st.slice(0, 3).map((m) => `${m.id} ${m.he} · ${m.city}`);
        const e = Q.expect, ids = st.map((m) => m.id);
        row.expectation = e.zero ? (j.matches.length === 0) : e.first ? ids[0] === e.first : e.has ? ids.includes(e.has) : st.length >= (e.min || 1);
      } else {
        let j = null; try { j = JSON.parse(r.text); } catch { j = null; }
        row.apiError = j && j.error ? (typeof j.error === 'string' ? j.error : String(j.error.code || j.error.message || 'error').slice(0, 60)) : null; row.error = r.error || null;
        row.expectation = false;
      }
      if (authed) { if (row.expectation) verified++; else failed++; }
      H.search.push(row);
      console.log(`${h.name.padEnd(10)} ${String(r.status).padEnd(4)} ${cls.padEnd(18)} ${(row.type || '-').slice(0, 30).padEnd(31)} ${row.location ? '→ ' + row.location.slice(0, 60) + ' ' : ''}${row.streets != null ? row.streets + ' streets · ' + (row.top[0] || '—') : row.apiError || ''} · "${Q.q}"${Q.near ? ' near ' + Q.near : ''} · ${r.ms} ms${authed ? (row.expectation ? ' ✓' : ' ✗') : ''}`);
    }
    if (isPreview) for (const id of REPORTS) {
      const r = await req(h.base, '/api/intel?view=streetReport&part=core&id=' + encodeURIComponent(id), { headers });
      const cls = classify(r, (j) => j && j.id === id && !!j.identity);
      H.reports.push({ id, status: r.status, class: cls, type: r.type || null, location: r.location || null, ms: r.ms, bytes: r.text ? r.text.length : 0 });
      console.log(`${h.name.padEnd(10)} ${String(r.status).padEnd(4)} ${cls.padEnd(18)} street report ${id} · ${r.ms} ms`);
      if (authed) { if (cls === 'OK') verified++; else failed++; }
    }
    H.authenticated = authed;
    report.hosts.push(H);
  }
  const anyAuthed = report.hosts.some((x) => x.authenticated);
  report.verdict = !anyAuthed ? 'NOT AUTHENTICATED — the deployed search was not verified (configure the runner secrets)' : failed ? `FAILED — ${failed} check(s) did not meet expectation` : `VERIFIED — ${verified} authenticated checks passed`;
  console.log('\n' + report.verdict);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(report, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`## Street search live check · ${report.verdict}`, '', deployment ? `Deployment of \`${String(report.commit).slice(0, 7)}\`: ${deployment.state} — ${deployment.description || ''}` : ''];
    for (const H of report.hosts) {
      md.push('', `### ${H.name} · ${H.base}`, `sign-in: **${H.login.class}**${H.login.status ? ' (HTTP ' + H.login.status + ')' : ''} · bypass header sent: ${H.bypassSent} · page: HTTP ${H.page.status}${H.page.location ? ' → ' + H.page.location : ''} · search fix in page: ${H.page.hasSearchFix == null ? '—' : H.page.hasSearchFix}`, '',
        '| query | HTTP | class | content type | redirect | streets | first match | ms |', '|---|---|---|---|---|---|---|---|');
      for (const r of H.search) md.push(`| ${r.q}${r.near ? ' (near ' + r.near + ')' : ''} | ${r.status} | ${r.class} | ${r.type || '—'} | ${r.location ? r.location.slice(0, 50) : '—'} | ${r.streets != null ? r.streets : r.apiError || '—'} | ${r.top && r.top[0] ? r.top[0] : '—'} | ${r.ms} |`);
      for (const r of H.reports) md.push(`| street report ${r.id} | ${r.status} | ${r.class} | ${r.type || '—'} | ${r.location ? r.location.slice(0, 50) : '—'} | — | — | ${r.ms} |`);
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }
  process.exit(!anyAuthed ? 2 : failed ? 1 : 0);
})();
