#!/usr/bin/env node
// PROPX · transaction freshness — read-only source discovery (P0 transaction-freshness audit, 19.10.2026).
//
// Runs on a GitHub runner (the Israeli hosts answer there, not from the Claude sandbox) and records what each transaction
// channel answers TODAY, before PROPX claims anything about freshness. Read-only: GET requests only, one at a time, an honest
// User-Agent, no cookies kept, no retries, nothing written or committed. A channel that answers with an identification /
// CAPTCHA / bot-manager page is RECORDED as such and never read further — PROPX does not bypass authentication, CAPTCHA or
// anti-bot controls.
//
//   node scripts/tx-freshness-discover.js --official        the official channels: the Tax Authority register, nadlan.gov.il,
//                                                            GovMap, data.gov.il — status, anti-bot markers, API hosts
//   node scripts/tx-freshness-discover.js --over            both republished copies on over.org.il (the register copy and the
//                                                            GovMap-layer copy): stats, shapes, the latest rows
//   node scripts/tx-freshness-discover.js --compare "<city>|<city>…" [--from YYYY-MM-DD]
//                                                            per city: the GovMap-layer copy's dwelling deals vs the deals PROPX
//                                                            stores (data/streets/evidence on the runner's checkout) — MATCH /
//                                                            MISSING IN PROPX / EXTRA IN PROPX / FIELD DIFFERENCE, latest dates,
//                                                            90 / 365-day counts, the busiest streets

'use strict';

const UA = 'PROPX-tx-freshness-discover/1.0 (+https://github.com/kobi6061-hub/vizora; read-only)';
const TIMEOUT = 45000;
const OVER = 'https://www.over.org.il';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = (o) => console.log(JSON.stringify(o));
const trim = (v, n = 600) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const pause = (ms = 1000) => new Promise((ok) => setTimeout(ok, ms));

async function get(url, accept = 'application/json') {
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const h = (k) => r.headers.get(k);
  /* cookie NAMES only (a bot manager announces itself by its cookie names); values are never printed */
  const cookies = (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [h('set-cookie')].filter(Boolean))
    .map((c) => String(c).split('=')[0].trim()).filter(Boolean);
  return { status: r.status, url: r.url, text, json, ms: Date.now() - t0, type: h('content-type'), lastModified: h('last-modified'),
    headers: { server: h('server'), via: h('via'), xCache: h('x-cache'), cfRay: h('cf-ray') ? 'present' : null, xIinfo: h('x-iinfo') ? 'present' : null }, cookies };
}

/* ── the official channels ── */
const BOT = [
  ['recaptcha', /recaptcha|grecaptcha/i], ['hcaptcha', /hcaptcha/i], ['turnstile', /turnstile|challenges\.cloudflare/i],
  ['captcha-word', /captcha/i], ['cloudfront-block', /Request blocked|The request could not be satisfied/i],
  ['access-denied', /Access Denied|403 Forbidden/i], ['incapsula', /incapsula|_Incapsula_Resource|visid_incap/i],
  ['perimeterx', /perimeterx|px-captcha|_pxhd/i], ['radware', /radware|perfdrive|validate\.perfdrive/i],
  ['f5-asm', /The requested URL was rejected|support ID/i], ['cf-challenge', /cf-chl|challenge-platform|Just a moment/i],
  ['he-identify', /הזדהות|אימות|אני לא רובוט|אינך רובוט/],
];
const markers = (r) => BOT.filter(([, re]) => re.test(r.text) || r.cookies.some((c) => re.test(c))).map(([k]) => k);
const titleOf = (t) => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(t || ''); return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 160) : null; };

async function probePage(label, url) {
  try {
    const r = await get(url, 'text/html,application/json;q=0.9,*/*;q=0.8');
    const o = { kind: 'official', label, asked: url, status: r.status, final: r.url, type: r.type, bytes: r.text.length, ms: r.ms, title: titleOf(r.text),
      markers: markers(r), headers: r.headers, cookieNames: r.cookies, lastModified: r.lastModified, head: trim(r.text.replace(/\s+/g, ' '), 500) };
    out(o);
    return r;
  } catch (e) { out({ kind: 'official', label, asked: url, error: e.message }); return null; }
}

async function official() {
  /* 1 · the Tax Authority's register (the legacy system the republished copy was taken from) */
  await probePage('taxes:register-startpage', 'https://nadlan.taxes.gov.il/svinfonadlan2010/startpage.aspx'); await pause();
  /* 2 · nadlan.gov.il — the government's public real-estate site; its public scripts name the API hosts it calls */
  const home = await probePage('nadlan.gov.il:home', 'https://www.nadlan.gov.il/'); await pause();
  if (home && home.status === 200) {
    const srcs = [...home.text.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => new URL(m[1], home.url).href);
    out({ kind: 'official', label: 'nadlan.gov.il:scripts', scripts: srcs.slice(0, 20) });
    for (const s of srcs.filter((x) => /nadlan\.gov\.il/.test(x)).slice(0, 4)) {
      try {
        const js = await get(s, '*/*');
        const hosts = [...new Set([...js.text.matchAll(/https?:\/\/[a-z0-9.-]+\.(?:gov\.il|amazonaws\.com|azurewebsites\.net|azure-api\.net|cloudfront\.net)[a-z0-9/._-]*/gi)].map((m) => m[0]))];
        out({ kind: 'official', label: 'nadlan.gov.il:script', src: s, status: js.status, bytes: js.text.length, recaptcha: /recaptcha|grecaptcha/i.test(js.text),
          recaptchaAction: [...new Set([...js.text.matchAll(/action:\s*["']([a-zA-Z_]+)["']/g)].map((m) => m[1]))].slice(0, 12), hosts: hosts.slice(0, 40) });
      } catch (e) { out({ kind: 'official', label: 'nadlan.gov.il:script', src: s, error: e.message }); }
      await pause();
    }
  }
  /* 3 · GovMap — the State mapping portal that publishes the Tax Authority's deals layer (lay=16) */
  await probePage('govmap:home', 'https://www.govmap.gov.il/'); await pause();
  await probePage('govmap:deals-api', 'https://www.govmap.gov.il/api/real-estate/deals/180000,665000/100'); await pause();
  /* 4 · data.gov.il — is there an open dataset of the transactions? */
  for (const q of ['עסקאות נדל"ן', 'עסקאות מקרקעין', 'מידע נדל"ן', 'רשות המסים', 'מיסוי מקרקעין', 'nadlan', 'real estate transactions']) {
    try {
      const r = await get('https://data.gov.il/api/3/action/package_search?' + new URLSearchParams({ q, rows: 20 }));
      const res = r.json && r.json.result;
      out({ kind: 'datagov', q, status: r.status, count: res ? res.count : null,
        hits: res ? res.results.map((p) => ({ name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified })) : trim(r.text, 300) });
    } catch (e) { out({ kind: 'datagov', q, error: e.message }); }
    await pause();
  }
}

/* ── the republished copies on over.org.il ── */
async function overGet(p) { const r = await get(OVER + p); await pause(); return r; }
function rowsOf(j) { return j && (Array.isArray(j) ? j : j.data || j.results || j.items || j.deals || null); }

async function over() {
  const st = await overGet('/api/deals/stats');
  out({ kind: 'over', label: 'register:stats', status: st.status, body: st.json });
  const gs = await overGet('/api/deals/govmap/stats');
  out({ kind: 'over', label: 'govmap:stats', status: gs.status, body: gs.json });
  const spec = await overGet('/openapi.json');
  for (const [p, ops] of Object.entries((spec.json && spec.json.paths) || {})) {
    if (!/govmap|deals\/(stats|search|settlements)/.test(p)) continue;
    for (const [method, op] of Object.entries(ops)) {
      const params = (op.parameters || []).map((x) => `${x.name}${x.required ? '*' : ''}:${x.schema && (x.schema.type || (x.schema.anyOf || []).map((a) => a.type).join('|'))}${x.schema && x.schema.enum ? '[' + x.schema.enum.join(',') + ']' : ''}${x.schema && x.schema.default != null ? '=' + x.schema.default : ''}`);
      out({ kind: 'over', label: 'spec', method: method.toUpperCase(), path: p, desc: trim(op.description || op.summary || '', 900), params });
    }
  }
  const gl = await overGet('/api/deals/govmap/settlements');
  const gsl = rowsOf(gl.json) || [];
  out({ kind: 'over', label: 'govmap:settlements', status: gl.status, n: gsl.length, keys: gsl[0] ? Object.keys(gsl[0]) : null, head: trim(gsl.slice(0, 5), 900),
    cities: gsl.filter((x) => /תל אביב|ירושלים|פתח תק|חיפה|באר שבע|ראשון לציון|נתניה|אשדוד/.test(JSON.stringify(x))).slice(0, 20) });
  for (const [label, p] of [
    ['govmap:latest', '/api/deals/govmap/search?sort=date_desc&limit=8'],
    ['register:latest', '/api/deals/search?sort=date_desc&limit=8'],
    ['govmap:city-latest', '/api/deals/govmap/search?settlement=' + encodeURIComponent('פתח תקווה') + '&sort=date_desc&limit=5'],
    ['govmap:city-latest-alt', '/api/deals/govmap/search?settlement=' + encodeURIComponent('פתח תקוה') + '&sort=date_desc&limit=5'],
    ['govmap:city-street', '/api/deals/govmap/search?settlement=' + encodeURIComponent('פתח תקוה') + '&street=' + encodeURIComponent('העצמאות') + '&sort=date_desc&limit=5'],
  ]) {
    const r = await overGet(p);
    const rows = rowsOf(r.json);
    out({ kind: 'over', label, url: p, status: r.status, keys: r.json && !Array.isArray(r.json) ? Object.keys(r.json) : null,
      total: r.json && (r.json.total ?? null), capped: r.json && (r.json.total_capped ?? null), n: rows ? rows.length : null,
      head: trim(rows || r.text, 3500) });
  }
}

/* ── per city: the GovMap-layer copy vs what PROPX stores ── */
async function compare(names, from) {
  out({ kind: 'compare', note: 'not yet implemented in this probe version', names, from });
}

(async () => {
  try {
    if (args.includes('--official')) await official();
    else if (args.includes('--over')) await over();
    else if (args.includes('--compare')) await compare(String(opt('--compare') || '').split('|').filter(Boolean), opt('--from'));
    else { console.error('usage: --official | --over | --compare "<city>|<city>"'); process.exit(2); }
  } catch (e) { out({ kind: 'error', error: e.message }); process.exit(1); }
})();
