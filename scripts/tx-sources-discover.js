#!/usr/bin/env node
// PROPX · transaction SOURCE INVENTORY + screenshot regression capture (read-only, 20.10.2026).
//
//   node scripts/tx-sources-discover.js --inventory          every candidate transaction channel: who runs it, what it answers today,
//                                                            whether it is machine-readable, its latest update / latest deal
//   node scripts/tx-sources-discover.js --case "<city>|<street>[|<house>]"
//                                                            the transactions section's OWN answer for one geography, exactly as
//                                                            production computes it (api/gov/transactions.js with the default
//                                                            service), for every period the page offers — the BEFORE evidence
//
// GET only, one request at a time, a pause between requests. A channel behind an identification / CAPTCHA / bot-manager screen or a
// key is RECORDED, never bypassed; a paid or commercial service is listed, never called. One JSON line per finding on stdout.

'use strict';

const UA = 'PROPX-tx-sources-discover/1.0 (+https://github.com/kobi6061-hub/vizora; read-only)';
const TIMEOUT = 45000;
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = (o) => console.log(JSON.stringify(o));
const trim = (v, n = 800) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const pause = (ms = 1000) => new Promise((ok) => setTimeout(ok, ms));

async function get(url, accept = 'application/json') {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    return { status: r.status, ms: Date.now() - t0, type: r.headers.get('content-type'), server: r.headers.get('server'), finalUrl: r.url, text, json, cookies, bytes: text.length };
  } catch (e) { return { status: null, ms: Date.now() - t0, error: e.message, text: '', json: null, cookies: [] }; } finally { await pause(); }
}
/* an anti-bot / identification screen: recorded, never worked around */
const BOT = [['recaptcha', /recaptcha|grecaptcha/i], ['cloudflare', /cf-chl|cloudflare|__cf_bm/i], ['cloudfront-block', /Request blocked|cloudfront/i],
  ['imperva', /incapsula|_Incapsula_|visid_incap/i], ['f5', /TSPD|BIG-IP|bobcmn/i], ['identification', /הזדהות|אימות|login|signin|identity/i]];
const markers = (r) => BOT.filter(([, re]) => re.test(r.text || '') || (r.cookies || []).some((c) => re.test(c))).map(([k]) => k);
const titleOf = (t) => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(t || ''); return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 160) : null; };
const brief = (r) => ({ status: r.status, ms: r.ms, type: r.type, server: r.server, bytes: r.bytes, finalUrl: r.finalUrl, title: titleOf(r.text), markers: markers(r), error: r.error || null });

/* ── the inventory ── */
const OVER = 'https://www.over.org.il';
const GOVMAP_DS = '4174aac2-c8b2-443e-9425-3773ce47c8da', REGISTER_DS = 'fd06f5ae-8a4f-4120-b275-8a514ad23499';

async function ckanSearch(label, base, q) {
  const r = await get(`${base}/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=20`);
  const res = r.json && r.json.result ? r.json.result : null;
  out({ kind: 'inventory', label, query: q, ...brief(r), count: res ? res.count : null,
    packages: res ? res.results.map((p) => ({ name: p.name, title: p.title, org: p.organization && (p.organization.title || p.organization.name), modified: p.metadata_modified,
      resources: (p.resources || []).slice(0, 6).map((x) => ({ name: x.name, format: x.format, modified: x.last_modified || x.metadata_modified, datastore: !!x.datastore_active, url: x.url })) })) : null });
  return res;
}

async function inventory() {
  /* 1 · the official channels — status only (each was audited before; re-checked today) */
  for (const [label, url, accept] of [
    ['official:nadlan.gov.il', 'https://www.nadlan.gov.il/', 'text/html'],
    ['official:nadlan.gov.il:api', 'https://www.nadlan.gov.il/Nadlan.REST/Main/GetAssestAndDeals', 'application/json'],
    ['official:nadlan.taxes.gov.il', 'https://www.nadlan.taxes.gov.il/', 'text/html'],
    ['official:gov.il-service', 'https://www.gov.il/he/service/real_estate_information', 'text/html'],
    ['official:govmap', 'https://www.govmap.gov.il/?lay=16', 'text/html'],
    ['official:govmap:api', 'https://www.govmap.gov.il/api/real-estate/deals/3881542.0,644219.0/1', 'application/json'],
    ['official:govmap:ags', 'https://ags.govmap.gov.il/', 'text/html'],
  ]) { const r = await get(url, accept); out({ kind: 'inventory', label, url, ...brief(r) }); }

  /* 2 · official open-data portal (data.gov.il, CKAN) — any deal-level dataset? */
  for (const q of ['עסקאות נדל"ן', 'עסקאות מקרקעין', 'מיסוי מקרקעין', 'מכירת דירות', 'real estate transactions', 'nadlan']) await ckanSearch('datagov:search', 'https://data.gov.il', q);

  /* 3 · the public-knowledge workshop's portal (odata.org.il, CKAN) — the "nadlan" dataset and the register's odata copy */
  for (const q of ['nadlan', 'עסקאות נדל"ן', 'מאגר נדל"ן']) await ckanSearch('odata:search', 'https://www.odata.org.il', q);
  /* the register dataset's own odata link (over.org.il names it) */
  const regMeta = await get(`${OVER}/api/v1/datasets/${REGISTER_DS}`);
  const odataIds = [...new Set((JSON.stringify(regMeta.json || {}).match(/odata\.org\.il\/dataset\/([0-9a-z-]+)/gi) || []).map((m) => m.split('/').pop()))];
  out({ kind: 'inventory', label: 'over:register:odata-link', status: regMeta.status, odataIds });
  for (const id of ['nadlan', ...odataIds]) {
    const r = await get(`https://www.odata.org.il/api/3/action/package_show?id=${encodeURIComponent(id)}`);
    const p = r.json && r.json.result;
    out({ kind: 'inventory', label: 'odata:package', id, ...brief(r), package: p ? { name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified, notes: trim(p.notes || '', 1200),
      resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, format: x.format, size: x.size, modified: x.last_modified || x.metadata_modified, datastore: !!x.datastore_active, url: x.url })) } : null });
    /* the newest deal a datastore resource holds (sorted read of one row — never a bulk download) */
    for (const x of (p && p.resources || []).filter((y) => y.datastore_active).slice(0, 4)) {
      const fields = await get(`https://www.odata.org.il/api/3/action/datastore_search?resource_id=${x.id}&limit=1`);
      const f = fields.json && fields.json.result;
      const dateField = f && (f.fields || []).map((y) => y.id).find((k) => /date|תאריך/i.test(k));
      const newest = dateField ? await get(`https://www.odata.org.il/api/3/action/datastore_search?resource_id=${x.id}&limit=2&sort=${encodeURIComponent(`"${dateField}" desc`)}`) : null;
      out({ kind: 'inventory', label: 'odata:resource', id: x.id, name: x.name, total: f ? f.total : null, fields: f ? (f.fields || []).map((y) => y.id) : null, dateField,
        newest: newest && newest.json && newest.json.result ? trim(newest.json.result.records, 1500) : null, status: fields.status });
    }
  }

  /* 4 · over.org.il — the catalogue (every dataset about deals), both copies' versions, the register's change log */
  const spec = await get(OVER + '/openapi.json');
  const paths = spec.json && spec.json.paths ? Object.keys(spec.json.paths) : [];
  out({ kind: 'inventory', label: 'over:openapi', status: spec.status, paths: paths.length, catalogue: paths.filter((p) => /datasets|search|catalog/i.test(p)).slice(0, 40), deals: paths.filter((p) => /deal|nadlan/i.test(p)) });
  for (const q of ['עסקאות', 'נדל"ן', 'מקרקעין', 'nadlan', 'deals']) {
    for (const p of [`/api/v1/datasets?q=${encodeURIComponent(q)}&limit=50`, `/api/v1/datasets/search?q=${encodeURIComponent(q)}&limit=50`]) {
      const r = await get(OVER + p);
      const list = Array.isArray(r.json) ? r.json : r.json && (r.json.data || r.json.results || r.json.datasets || r.json.items);
      out({ kind: 'inventory', label: 'over:catalogue', asked: p, status: r.status, n: Array.isArray(list) ? list.length : null,
        datasets: Array.isArray(list) ? list.slice(0, 50).map((d) => ({ id: d.id, title: d.title || d.name, org: d.organization && (d.organization.title || d.organization.name) || d.publisher || null, modified: d.metadata_modified || d.updated_at || null, rows: d.total_rows || d.rows || null })) : trim(r.json || r.text, 600) });
      if (Array.isArray(list)) break;
    }
  }
  for (const [name, ds] of [['govmap', GOVMAP_DS], ['register', REGISTER_DS]]) {
    const v = await get(`${OVER}/api/v1/datasets/${ds}/versions`);
    const vs = Array.isArray(v.json) ? v.json : [];
    out({ kind: 'inventory', label: `over:${name}:versions`, status: v.status, n: vs.length, latest: vs[0] ? { n: vs[0].version_number, id: vs[0].id, detected: vs[0].detected_at, modified: vs[0].metadata_modified,
      resources: (vs[0].resources || []).map((x) => ({ name: x.name, format: x.format, url: x.download_url })).slice(0, 6) } : null });
  }
  for (const p of ['/api/deals/stats', '/api/deals/govmap/stats', '/api/deals/log']) { const r = await get(OVER + p); out({ kind: 'inventory', label: 'over:' + p, status: r.status, body: trim(r.json || r.text, 2500) }); }

  /* 5 · municipal GIS catalogues — a city layer of deals? (catalogue listing only) */
  for (const [label, url] of [['tlv:gis', 'https://gisn.tel-aviv.gov.il/arcgis/rest/services?f=json'], ['jerusalem:gis', 'https://gisviewer.jerusalem.muni.il/arcgis/rest/services?f=json'],
    ['haifa:gis', 'https://gisserver.haifa.muni.il/arcgis/rest/services?f=json']]) {
    const r = await get(url);
    const names = r.json ? [...(r.json.services || []).map((s) => s.name), ...(r.json.folders || [])] : [];
    out({ kind: 'inventory', label, url, ...brief(r), services: names.length, dealLike: names.filter((n) => /deal|עסק|nadlan|נדל|sale|מכיר|price|מחיר/i.test(n)) });
  }

  /* 6 · listed, never called: commercial / paid / key-gated services (their terms, price and provenance decide — and some reach a
     channel PROPX may not read itself) */
  for (const s of [
    { label: 'commercial:apify-swerve-nadlan-deals', url: 'https://apify.com/swerve/nadlan-deals', why: 'paid third-party scraper of the GovMap deals API (which refuses PROPX\'s servers) — a token and a fee; reading GovMap through a third party is not a channel PROPX may use on its own' },
    { label: 'commercial:apify-swerve-nadlan-gov-deals', url: 'https://apify.com/swerve/nadlan-gov-deals', why: 'paid third-party scraper of nadlan.gov.il (behind reCAPTCHA Enterprise for PROPX) — not used: it would route around the anti-bot screen' },
    { label: 'commercial:byndbiz', url: 'https://byndbiz.co.il/en/nadlan/', why: 'commercial transaction database; no public API or terms for machine use' },
    { label: 'community:nadlan-mcp / internal-endpoint wrappers', url: 'https://github.com/danielrosehill/Israel-Open-Data-Resources', why: 'wrap nadlan.gov.il internal JSON endpoints that sit behind reCAPTCHA — not used' },
    { label: 'listings:madlan / yad2', url: 'https://www.madlan.co.il/', why: 'asking prices of listings, not transactions — never transaction evidence' },
  ]) out({ kind: 'inventory', ...s, called: false });
}

/* ── the screenshot regression case: the section's own answer, through production's handler ── */
async function caseRun(spec) {
  const [city, street, house] = String(spec || '').split('|');
  const handler = require('../api/gov/transactions');
  const call = (q) => new Promise((ok) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { ok({ status: this.statusCode, body }); } };
    handler({ method: 'GET', url: '/api/gov/transactions?' + new URLSearchParams(q).toString() }, res);
  });
  for (const per of [{ months: '24' }, { days: '30' }, { days: '90' }, { months: '6' }, { months: '12' }, { months: '240' }]) {
    const q = { city, limit: '120', ...per };
    if (street) q.street = street;
    if (house) q.house = house;
    const r = await call(q);
    let d = null; try { d = JSON.parse(r.body); } catch { /* error body */ }
    const tx = d && d.transactions ? d.transactions : [];
    out({ kind: 'case', asked: q, status: r.status, scope: d && d.scope ? { level: d.scope.level, description: d.scope.description } : null,
      rows: tx.length, newest: tx.map((t) => t.date).sort().pop() || null, oldest: tx.map((t) => t.date).sort()[0] || null,
      first12: tx.slice(0, 12).map((t) => [t.date, t.price, t.street, t.houseNumber, `${t.block}/${t.parcel}/${t.subParcel}`, t.dealType]),
      meta: d && d.meta ? { deliveredVia: d.meta.deliveredVia, snapshotAt: d.meta.snapshotAt, latestInRegister: d.meta.latestInRegister, latestTransactionDate: d.meta.latestTransactionDate,
        sourceCoverage: d.meta.sourceCoverage && { level: d.meta.sourceCoverage.level, totalReported: d.meta.sourceCoverage.totalReported, more: d.meta.sourceCoverage.more, addressLink: d.meta.sourceCoverage.addressLink, dateFrom: d.meta.sourceCoverage.dateFrom } } : null,
      unavailable: d && d.unavailable ? d.unavailable.slice(0, 6) : null, error: d && d.error ? d : null });
    await pause();
  }
  /* the GovMap-layer copy's own rows for the same street (newest first) — what the section never reads */
  const r = await get(`${OVER}/api/deals/govmap/search?settlement=${encodeURIComponent(city)}&street=${encodeURIComponent(street || '')}&sort=date_desc&limit=50`);
  const rows = r.json && (r.json.data || r.json.results) || [];
  out({ kind: 'case', label: 'govmap-layer', status: r.status, rows: rows.length, first12: rows.slice(0, 12).map((g) => [String(g.deal_date).slice(0, 10), g.deal_amount, g.street, g.house_num, `${g.gush}/${g.parcel}/${g.sub_parcel}`, g.property_type]) });
}

/* ── the history probe (closure P0, 20.10.2026): what PROPX needs to surface the WHOLE history — the register version's files (format,
   size, header), the live search's limits (no locality, past 10,000, no lower date bound), every locality's register count and latest
   deal. GET only; one file's first 4 KB by a Range request — never a bulk download here. ── */
async function historyProbe() {
  for (const [name, ds] of [['register', REGISTER_DS], ['govmap', GOVMAP_DS]]) {
    const v = await get(`${OVER}/api/v1/datasets/${ds}/versions`);
    const vs = Array.isArray(v.json) ? v.json : [];
    const res = vs[0] ? vs[0].resources || [] : [];
    const fmt = res.reduce((m, x) => ((m[String(x.format || '').toLowerCase() || '?'] = (m[String(x.format || '').toLowerCase() || '?'] || 0) + 1), m), {});
    out({ kind: 'history', label: `over:${name}:resources`, status: v.status, versions: vs.length, latest: vs[0] ? { n: vs[0].version_number, id: vs[0].id, detected: vs[0].detected_at } : null,
      resources: res.length, formats: fmt, keys: res[0] ? Object.keys(res[0]) : null,
      sample: res.slice(0, 12).map((x) => ({ name: x.name, format: x.format, size: x.size || x.bytes || x.file_size || null, url: x.download_url })),
      big: res.filter((x) => /תל אביב|ירושלים|^all|whole|full|combined|file\./i.test(String(x.name) + ' ' + String(x.download_url))).slice(0, 8).map((x) => ({ name: x.name, format: x.format, size: x.size || null, url: x.download_url })) });
    /* sizes of a few files (HEAD) and the first 4 KB of the first CSV-like file */
    for (const x of res.filter((y) => /csv|parquet|gpkg|json/i.test(String(y.format) + String(y.download_url))).slice(0, 3)) {
      try {
        const h = await fetch(x.download_url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
        out({ kind: 'history', label: `over:${name}:head`, name: x.name, status: h.status, bytes: Number(h.headers.get('content-length')) || null, type: h.headers.get('content-type') });
      } catch (e) { out({ kind: 'history', label: `over:${name}:head`, name: x.name, error: e.message }); }
      await pause(500);
    }
    const csv = res.find((y) => /csv/i.test(String(y.format) + String(y.download_url)));
    if (csv) {
      try {
        const r = await fetch(csv.download_url, { headers: { 'User-Agent': UA, Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(TIMEOUT) });
        const t = await r.text();
        out({ kind: 'history', label: `over:${name}:csv-head`, name: csv.name, status: r.status, lines: t.split('\n').slice(0, 4).map((l) => l.slice(0, 700)) });
      } catch (e) { out({ kind: 'history', label: `over:${name}:csv-head`, error: e.message }); }
      await pause(500);
    }
    if (name === 'register') out({ kind: 'history', label: 'over:register:all-resources', names: res.map((x) => x.name).slice(0, 2000) });
  }
  /* the live search's limits */
  const s = (q) => `${OVER}/api/deals/search?${new URLSearchParams(q)}`;
  const brief2 = (r) => ({ status: r.status, total: r.json && r.json.total, capped: r.json && r.json.total_capped, n: r.json && Array.isArray(r.json.data) ? r.json.data.length : null,
    dates: r.json && Array.isArray(r.json.data) ? r.json.data.map((d) => String(d.deal_date || d.date || '').slice(0, 10)) : null, keys: r.json && r.json.data && r.json.data[0] ? Object.keys(r.json.data[0]) : null,
    error: r.json && r.json.detail ? trim(r.json.detail, 300) : r.error || null });
  for (const q of [
    { sort: 'date_desc', limit: 3 },                                                       // no locality at all
    { settlement: 'תל אביב יפו', sort: 'date_asc', limit: 3 },                              // the oldest deal, no lower bound
    { settlement: 'תל אביב יפו', sort: 'date_desc', limit: 3, offset: 10000 },              // past the counted 10,000
    { settlement: 'תל אביב יפו', sort: 'date_desc', limit: 3, offset: 150000 },
    { settlement: 'תל אביב יפו', sort: 'date_desc', limit: 3, date_to: '2006-01-01' },     // before the 240-month bound
    { settlement: 'פתח תקווה', street: 'שחם', sort: 'date_asc', limit: 3 },
    { gush: '6393', helka: '348', sort: 'date_desc', limit: 3 },                           // a parcel filter, if the search has one
  ]) { const r = await get(s(q)); out({ kind: 'history', label: 'over:search', asked: q, ...brief2(r) }); }
  const g = await get(`${OVER}/api/deals/govmap/search?${new URLSearchParams({ sort: 'date_asc', limit: 3 })}`);
  out({ kind: 'history', label: 'over:govmap-search', ...brief2(g) });
  /* the OpenAPI parameters of the deals endpoints */
  const spec = await get(OVER + '/openapi.json');
  const P = spec.json && spec.json.paths ? spec.json.paths : {};
  for (const [p, o] of Object.entries(P).filter(([k]) => /\/api\/(deals|nadlan)/.test(k))) {
    for (const [m, d] of Object.entries(o)) out({ kind: 'history', label: 'over:openapi', path: p, method: m, params: (d.parameters || []).map((x) => `${x.name}${x.required ? '*' : ''}:${(x.schema && (x.schema.type || x.schema.anyOf && 'anyOf')) || ''}`) });
  }
  /* every locality's register count and latest deal */
  const st = await get(`${OVER}/api/deals/settlements`);
  const L = st.json && Array.isArray(st.json.data) ? st.json.data : Array.isArray(st.json) ? st.json : [];
  out({ kind: 'history', label: 'over:settlements', status: st.status, n: L.length, deals: L.reduce((a, x) => a + (Number(x.deals) || 0), 0), keys: L[0] ? Object.keys(L[0]) : null,
    rows: L.map((x) => [x.settlement, x.settlement_code, x.resolved_code, Number(x.deals) || 0, x.last_deal ? String(x.last_deal).slice(0, 10) : null, x.first_deal ? String(x.first_deal).slice(0, 10) : null]) });
  for (const p of ['/api/deals/stats', '/api/deals/govmap/stats']) { const r = await get(OVER + p); out({ kind: 'history', label: 'over:' + p, status: r.status, body: trim(r.json || r.text, 2500) }); }
}

(async () => {
  try {
    if (args.includes('--history')) await historyProbe();
    else if (args.includes('--inventory')) await inventory();
    else if (args.includes('--case')) await caseRun(opt('--case'));
    else { console.error('usage: --inventory | --history | --case "<city>|<street>[|<house>]"'); process.exit(2); }
  } catch (e) { out({ kind: 'error', error: e.message, stack: trim(e.stack, 800) }); process.exit(1); }
})();
