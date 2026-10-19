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

/* ── per city: the GovMap-layer copy vs what PROPX stores ──
   The GovMap-layer copy (over.org.il `govmap_deals`, "the deals as GovMap publishes them in layer 16 — the same deals the
   government real-estate site shows") is a second, independent extraction of the Tax Authority's deals; PROPX stores the
   register copy (nadlan.taxes.gov.il). A deal is keyed by date · block · parcel · sub-parcel (both sources print them);
   amount / area / rooms are then compared. Nothing is reconciled: every difference is printed with its class. */
const normCity = (s) => String(s || '').replace(/["'״׳\s\-–]/g, '').replace(/וו/g, 'ו').replace(/יי/g, 'י');
const CITY_CODES = { 'תל אביב-יפו': 5000, 'ירושלים': 3000, 'פתח תקווה': 7900, 'חיפה': 4000, 'באר שבע': 9000, 'ראשון לציון': 8300, 'נתניה': 7400, 'אשדוד': 70 };
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const minusDays = (d, k) => iso(Date.parse(d + 'T00:00:00Z') - k * 864e5);
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

async function govmapRows(names, from, to) {
  const rows = [];
  for (const name of names) {
    for (let offset = 0, guard = 0; guard < 120; guard++) {
      const p = `/api/deals/govmap/search?settlement=${encodeURIComponent(name)}&date_from=${from}&date_to=${to}&sort=date_desc&limit=200&offset=${offset}`;
      const r = await overGet(p);
      const b = rowsOf(r.json) || [];
      if (r.status !== 200) { out({ kind: 'compare', step: 'govmap-page', name, offset, status: r.status, body: trim(r.text, 300) }); break; }
      rows.push(...b); offset += b.length;
      if (b.length < 200) break;
    }
  }
  return rows;
}

async function compare(names, fromArg) {
  const EV = require('../lib/streets/evidence');
  const SD = require('../lib/streets/directory');
  const D = SD.load();
  const S = EV.store();
  const today = iso(Date.now());
  const copyEnd = S.meta.source.lastDeal;
  const from = fromArg || minusDays(today, 400);
  const gs = await overGet('/api/deals/govmap/stats');
  const st = await overGet('/api/deals/stats');
  out({ kind: 'compare', step: 'sources', today, from, propx: { scrapedAt: S.meta.source.scrapedAt, lastDeal: copyEnd, window: S.meta.window },
    registerCopyNow: st.json && { scraped_at: st.json.scraped_at, last_deal: st.json.last_deal, dataset_id: st.json.dataset_id },
    govmapCopyNow: gs.json && { loaded_at: gs.json.loaded_at, last_deal: gs.json.last_deal, version: gs.json.version, dataset_id: gs.json.dataset_id, deals: gs.json.deals } });
  const gl = await overGet('/api/deals/govmap/settlements');
  const gNames = (rowsOf(gl.json) || []).map((x) => x.settlement);
  const fixture = [];
  for (const city of names) {
    const code = CITY_CODES[city] || null;
    const spell = gNames.filter((n) => normCity(n) === normCity(city));
    const G = (await govmapRows(spell, from, today)).map((g) => ({ ...g, sub: num(g.sub_parcel), gush: num(g.gush), parcel: num(g.parcel), amount: num(g.deal_amount), area: num(g.asset_area), rooms: num(g.rooms), date: String(g.deal_date).slice(0, 10) }));
    const sh = code ? EV.shardOf(code) : null;
    const P = sh ? EV.dealsOf(sh).map((x) => ({ ...x.deal, streetCodes: x.streets.map((s) => s.code), gushN: num(x.deal.gush), helkaN: num(x.deal.helka), subN: num(x.deal.subParcel) })).filter((d) => d.date >= from) : [];
    const key = (date, gush, parcel, sub) => `${date}|${gush}|${parcel}|${sub}`;
    const pIdx = new Map(); for (const d of P) { const k = key(d.date, d.gushN, d.helkaN, d.subN); if (!pIdx.has(k)) pIdx.set(k, []); pIdx.get(k).push(d); }
    const gIdx = new Map(); for (const g of G) { const k = key(g.date, g.gush, g.parcel, g.sub); if (!gIdx.has(k)) gIdx.set(k, []); gIdx.get(k).push(g); }
    /* the loose key: the same unit and amount on another date (a date the two channels print differently) */
    const lkey = (gush, parcel, sub, amount) => `${gush}|${parcel}|${sub}|${amount}`;
    const pLoose = new Map(); for (const d of P) { const k = lkey(d.gushN, d.helkaN, d.subN, d.amount); if (!pLoose.has(k)) pLoose.set(k, []); pLoose.get(k).push(d); }
    const cls = { MATCH: 0, FIELD_DIFFERENCE: 0, DATE_DIFFERENCE: 0, MISSING_IN_PROPX_WITHIN_COPY: 0, MISSING_IN_PROPX_AFTER_COPY: 0, FUTURE_DATED_AT_SOURCE: 0, EXTRA_IN_PROPX: 0 };
    const samples = Object.fromEntries(Object.keys(cls).map((k) => [k, []]));
    const diffKinds = {};
    const push = (k, o) => { cls[k]++; if (samples[k].length < 8) samples[k].push(o); };
    const gOut = (g) => [g.date, g.street, g.house_num, `${g.gush}/${g.parcel}/${g.sub}`, g.amount, g.area, g.rooms, g.property_type || g.deal_nature, g.deal_id];
    const pOut = (d) => [d.date, (d.parcelAddresses || []).slice(0, 2).join(' · '), `${d.gushN}/${d.helkaN}/${d.subN}`, d.amount, d.areaSqm, d.rooms, d.nature, d.yearBuilt];
    const matched = new Set();
    const cand = [];
    for (const g of G) {
      if (g.date > today) { push('FUTURE_DATED_AT_SOURCE', gOut(g)); continue; }
      const k = key(g.date, g.gush, g.parcel, g.sub);
      const ps = pIdx.get(k);
      if (ps && ps.length) {
        const d = ps.find((x) => !matched.has(x) && x.amount === g.amount) || ps.find((x) => !matched.has(x)) || ps[0];
        matched.add(d);
        const diffs = [];
        if (d.amount !== g.amount) diffs.push('amount');
        if (g.area != null && d.areaSqm != null && Math.abs(g.area - d.areaSqm) > 1) diffs.push('area');
        if (g.rooms != null && d.rooms != null && g.rooms !== d.rooms) diffs.push('rooms');
        if (diffs.length) { push('FIELD_DIFFERENCE', { govmap: gOut(g), propx: pOut(d), diffs }); for (const x of diffs) diffKinds[x] = (diffKinds[x] || 0) + 1; }
        else {
          cls.MATCH++;
          if (samples.MATCH.length < 8) samples.MATCH.push(gOut(g));
          if (g.street && d.date > minusDays(copyEnd, 150)) cand.push({ city, code, street: g.street, house: g.house_num, date: g.date, gush: g.gush, parcel: g.parcel, sub: g.sub,
            amount: g.amount, areaSqm: g.area, rooms: g.rooms, govmapType: g.property_type || g.deal_nature || null, registerNature: d.nature, yearBuilt: d.yearBuilt, govmapDealId: g.deal_id,
            propxStreetCodes: d.streetCodes, propxMatch: d.match });
        }
        continue;
      }
      const loose = (pLoose.get(lkey(g.gush, g.parcel, g.sub, g.amount)) || []).find((x) => !matched.has(x));
      if (loose) { matched.add(loose); push('DATE_DIFFERENCE', { govmap: gOut(g), propx: pOut(loose) }); continue; }
      push(g.date <= copyEnd ? 'MISSING_IN_PROPX_WITHIN_COPY' : 'MISSING_IN_PROPX_AFTER_COPY', gOut(g));
    }
    for (const d of P) if (!matched.has(d) && d.dwelling && d.date <= today) push('EXTRA_IN_PROPX', pOut(d));
    /* acceptance candidates: up to 12 per city, newest first, one per street before a second, every property type early */
    const seenSt = new Map(), seenTy = new Set();
    cand.sort((a, b) => b.date.localeCompare(a.date));
    const chosen = [];
    for (const pass of [0, 1, 2]) for (const c of cand) {
      if (chosen.length >= 12 || chosen.includes(c)) continue;
      const ty = c.govmapType || c.registerNature, ns = seenSt.get(c.street) || 0;
      if (pass === 0 && (seenTy.has(ty) || ns)) continue;
      if (pass === 1 && ns) continue;
      chosen.push(c); seenSt.set(c.street, ns + 1); seenTy.add(ty);
    }
    fixture.push(...chosen);
    /* time profile: monthly counts on both sides, latest dates, counts over 90 / 365 days (to today and to the copy's end) */
    const month = (xs) => { const m = {}; for (const x of xs) { const k = x.slice(0, 7); m[k] = (m[k] || 0) + 1; } return m; };
    const gDates = G.map((g) => g.date).filter((d) => d <= today), pDw = P.filter((d) => d.dwelling).map((d) => d.date);
    const within = (ds, ref, k) => ds.filter((d) => d > minusDays(ref, k) && d <= ref).length;
    const gm = month(gDates), pm = month(pDw);
    const types = {}; for (const g of G) { const k = g.property_type || g.deal_nature || '(none)'; types[k] = (types[k] || 0) + 1; }
    out({ kind: 'compare', city, code, govmapSpellings: spell, govmapRows: G.length, propxRows: P.length, propxDwellingRows: pDw.length, classes: cls, diffKinds,
      latest: { govmap: gDates.sort().slice(-1)[0] || null, propxDwelling: pDw.sort().slice(-1)[0] || null },
      counts: { govmap: { d90today: within(gDates, today, 90), d365today: within(gDates, today, 365), d90copy: within(gDates, copyEnd, 90), d365copy: within(gDates, copyEnd, 365) },
        propxDwelling: { d90today: within(pDw, today, 90), d365today: within(pDw, today, 365), d90copy: within(pDw, copyEnd, 90), d365copy: within(pDw, copyEnd, 365) } },
      monthly: Object.keys({ ...gm, ...pm }).sort().map((m) => `${m}:${gm[m] || 0}/${pm[m] || 0}`).join(' '), govmapTypes: types });
    out({ kind: 'compareSamples', city, samples });
    /* streets: the three busiest GovMap streets of the last 365 days + one of medium and one of low activity */
    const byStreet = new Map(); for (const g of G) { if (!g.street || g.date > today) continue; if (!byStreet.has(g.street)) byStreet.set(g.street, []); byStreet.get(g.street).push(g); }
    const ranked = [...byStreet].sort((a, b) => b[1].length - a[1].length);
    const pick = [...ranked.slice(0, 3), ranked.find(([, v]) => v.length >= 8 && v.length <= 15), ranked.find(([, v]) => v.length >= 2 && v.length <= 3)].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const [name, gs2] of pick) {
      const ids = D.streets.filter((s) => s.cityCode === code && SD.normName(s.name) === SD.normName(name)).map((s) => s.code);
      const pS = P.filter((d) => d.dwelling && d.streetCodes.some((c) => ids.includes(c)));
      const gD = gs2.map((g) => g.date).sort(), pD = pS.map((d) => d.date).sort();
      const status = gs2.slice(0, 40).map((g) => (pIdx.get(key(g.date, g.gush, g.parcel, g.sub)) ? 'M' : g.date > copyEnd ? 'A' : 'W'));
      out({ kind: 'compareStreet', city, street: name, directoryCodes: ids, govmap: { n: gs2.length, latest: gD.slice(-1)[0], d90: within(gD, today, 90) },
        propx: { n: pS.length, latest: pD.slice(-1)[0] || null, d90: within(pD, today, 90) },
        recentGovmapInPropx: { matched: status.filter((x) => x === 'M').length, missingWithinCopy: status.filter((x) => x === 'W').length, afterCopy: status.filter((x) => x === 'A').length, of: status.length },
        sample: gs2.slice(0, 4).map((g) => ({ g: gOut(g), inPropx: !!pIdx.get(key(g.date, g.gush, g.parcel, g.sub)) })) });
    }
  }
  out({ kind: 'fixtureCandidates', n: fixture.length, rows: fixture });
}

(async () => {
  try {
    if (args.includes('--official')) await official();
    else if (args.includes('--over')) await over();
    else if (args.includes('--compare')) await compare(String(opt('--compare') || '').split('|').filter(Boolean), opt('--from'));
    else { console.error('usage: --official | --over | --compare "<city>|<city>"'); process.exit(2); }
  } catch (e) { out({ kind: 'error', error: e.message }); process.exit(1); }
})();
