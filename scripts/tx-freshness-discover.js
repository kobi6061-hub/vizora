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

/* the GovMap-layer search answers HTTP 500 to any date filter (observed 19.10.2026), so a city is paged newest first with no
   date filter and the paging stops at the first page that ends before `from` (future-dated source rows sort first) */
async function govmapRows(names, from) {
  const rows = [];
  for (const name of names) {
    for (let offset = 0, guard = 0; guard < 200; guard++) {
      const p = `/api/deals/govmap/search?settlement=${encodeURIComponent(name)}&sort=date_desc&limit=200&offset=${offset}`;
      const r = await overGet(p);
      const b = rowsOf(r.json) || [];
      if (r.status !== 200) { out({ kind: 'compare', step: 'govmap-page', name, offset, status: r.status, body: trim(r.text, 300) }); break; }
      rows.push(...b.filter((g) => String(g.deal_date).slice(0, 10) >= from)); offset += b.length;
      if (b.length < 200 || String(b[b.length - 1].deal_date).slice(0, 10) < from) break;
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
    const G = (await govmapRows(spell, from)).map((g) => ({ ...g, sub: num(g.sub_parcel), gush: num(g.gush), parcel: num(g.parcel), amount: num(g.deal_amount), area: num(g.asset_area), rooms: num(g.rooms), date: String(g.deal_date).slice(0, 10) }));
    const sh = code ? EV.shardOf(code) : null;
    const P = sh ? EV.dealsOf(sh).map((x) => ({ ...x.deal, streetCodes: x.streets.map((s) => s.code), gushN: num(x.deal.gush), helkaN: num(x.deal.helka), subN: num(x.deal.subParcel) })).filter((d) => d.date >= from) : [];
    /* one unit = block · parcel · sub-parcel (a missing sub-parcel is 0 on both sides); a deal = a unit on a date. The GovMap-layer
       copy prints some dates one day EARLIER than the register (its newer deal-id series, a UTC conversion of a local midnight)
       and truncates amounts to ₪1,000; a register row of a sold SHARE prints the share's amount. Each is a FIELD DIFFERENCE with
       its cause — never silently equal. */
    const unit = (gush, parcel, sub) => `${gush}|${parcel}|${sub || 0}`;
    const pByUnit = new Map(); for (const d of P) { const k = unit(d.gushN, d.helkaN, d.subN); if (!pByUnit.has(k)) pByUnit.set(k, []); pByUnit.get(k).push(d); }
    const pByParcel = new Map(); for (const d of P) { const k = `${d.gushN}|${d.helkaN}`; if (!pByParcel.has(k)) pByParcel.set(k, []); pByParcel.get(k).push(d); }
    const pByDate = new Map(); for (const d of P) { if (!pByDate.has(d.date)) pByDate.set(d.date, []); pByDate.get(d.date).push(d); }
    const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
    const amountRel = (g, deal) => {
      const d = deal.amount;
      if (g == null || d == null) return 'missing';
      if (g === d) return 'equal';
      if (g <= d && d - g < 1000) return 'truncated';                        // GovMap prints ₪1,000 steps
      if (deal.portionFraction != null && deal.portionFraction < 1) return 'share';
      return 'differs';
    };
    const near = (g, d) => g != null && d != null && (g === d || (g <= d && d - g < 1000));
    const cls = { MATCH: 0, MATCH_AMOUNT_TRUNCATED: 0, FIELD_DIFFERENCE: 0, POSSIBLY_SAME_DEAL_PARCEL_DIFFERS: 0, MISSING_IN_PROPX_REPORTED_LATE: 0, MISSING_IN_PROPX_OLDER: 0, FUTURE_DATED_AT_SOURCE: 0, EXTRA_IN_PROPX: 0 };
    const samples = Object.fromEntries(Object.keys(cls).map((k) => [k, []]));
    const diffKinds = {}, missWhy = {};
    const missSamples = {};
    const push = (k, o) => { cls[k]++; if (samples[k].length < 8) samples[k].push(o); };
    const gOut = (g) => [g.date, g.street, g.house_num, `${g.gush}/${g.parcel}/${g.sub}`, g.amount, g.area, g.rooms, g.property_type || g.deal_nature, g.deal_id];
    const pOut = (d) => [d.date, (d.parcelAddresses || []).slice(0, 2).join(' · '), `${d.gushN}/${d.helkaN}/${d.subN}`, d.amount, d.areaSqm, d.rooms, d.nature, d.yearBuilt, d.portionFraction];
    const matched = new Set();
    const cand = [];
    /* "reported late": a deal dated within 60 days before the register copy's latest deal — the register's own reporting lag
       (the copy held ≈ 13 % of August and ≈ 41 % of July 2026 when it was taken) */
    const lateFrom = minusDays(copyEnd, 75);
    for (const g of G) {
      if (g.date > today) { push('FUTURE_DATED_AT_SOURCE', gOut(g)); continue; }
      const ps = (pByUnit.get(unit(g.gush, g.parcel, g.sub)) || []).filter((d) => !matched.has(d) && Math.abs(dayDiff(g.date, d.date)) <= 1);
      if (ps.length) {
        const d = ps.find((x) => x.date === g.date && x.amount === g.amount) || ps.find((x) => near(g.amount, x.amount)) || ps.find((x) => x.date === g.date) || ps[0];
        matched.add(d);
        const diffs = [];
        const ar = amountRel(g.amount, d);
        if (ar === 'share') diffs.push('amount:share-of-property'); else if (ar === 'differs' || ar === 'missing') diffs.push('amount');
        if (d.date !== g.date) diffs.push(dayDiff(g.date, d.date) === -1 ? 'date:govmap-one-day-earlier' : 'date');
        if (g.area != null && d.areaSqm != null && Math.abs(g.area - d.areaSqm) > 1) diffs.push('area');
        if (g.rooms != null && d.rooms != null && g.rooms !== d.rooms) diffs.push('rooms');
        if (diffs.length) { push('FIELD_DIFFERENCE', { govmap: gOut(g), propx: pOut(d), diffs }); for (const x of diffs) diffKinds[x] = (diffKinds[x] || 0) + 1; }
        else {
          push(ar === 'truncated' ? 'MATCH_AMOUNT_TRUNCATED' : 'MATCH', gOut(g));
          if (ar === 'equal' && g.street && d.date > minusDays(copyEnd, 150)) cand.push({ city, code, street: g.street, house: g.house_num, date: g.date, gush: g.gush, parcel: g.parcel, sub: g.sub || 0,
            amount: g.amount, areaSqm: g.area, rooms: g.rooms, govmapType: g.property_type || g.deal_nature || null, registerNature: d.nature, yearBuilt: d.yearBuilt, govmapDealId: g.deal_id,
            propxStreetCodes: d.streetCodes, propxMatch: d.match });
        }
        continue;
      }
      /* the same deal printed under another unit number: the two channels number sub-parcels (and, for new projects, parcels)
         differently. Same parcel + date ±1 + amount + area → the same deal, FIELD DIFFERENCE sub-parcel; another parcel of the
         city + date ±1 + amount + area + rooms → POSSIBLY THE SAME DEAL (never counted as a match) */
      const sameArea = (d) => g.area == null || d.areaSqm == null || Math.abs(g.area - d.areaSqm) <= 1;
      const sameParcel = (pByParcel.get(`${g.gush}|${g.parcel}`) || []).find((d) => !matched.has(d) && Math.abs(dayDiff(g.date, d.date)) <= 1 && (near(g.amount, d.amount) || amountRel(g.amount, d) === 'share') && sameArea(d));
      if (sameParcel) { matched.add(sameParcel); push('FIELD_DIFFERENCE', { govmap: gOut(g), propx: pOut(sameParcel), diffs: ['sub-parcel'] }); diffKinds['sub-parcel'] = (diffKinds['sub-parcel'] || 0) + 1; continue; }
      const sameDay = [-1, 0, 1].flatMap((k) => pByDate.get(iso(Date.parse(g.date) + k * 864e5)) || []).find((d) => !matched.has(d) && near(g.amount, d.amount) && sameArea(d) && (g.rooms == null || d.rooms == null || g.rooms === d.rooms));
      if (sameDay) { matched.add(sameDay); push('POSSIBLY_SAME_DEAL_PARCEL_DIFFERS', { govmap: gOut(g), propx: pOut(sameDay) }); continue; }
      const ty = g.property_type || g.deal_nature || '(none)';
      if (g.date >= lateFrom) { push('MISSING_IN_PROPX_REPORTED_LATE', gOut(g)); missWhy['late:' + ty] = (missWhy['late:' + ty] || 0) + 1; continue; }
      const why = (g.gush == null ? 'no-block-at-source' : 'not-found') + ':' + ty;
      missWhy[why] = (missWhy[why] || 0) + 1;
      if (!missSamples[why]) missSamples[why] = [];
      if (missSamples[why].length < 4) missSamples[why].push(gOut(g));
      push('MISSING_IN_PROPX_OLDER', gOut(g));
    }
    const extras = [];
    const extraWhy = {};
    for (const d of P) if (!matched.has(d) && d.dwelling && d.date <= today) { push('EXTRA_IN_PROPX', pOut(d)); extras.push(d); const k = (d.portionFraction != null && d.portionFraction < 1 ? 'share' : 'whole') + (d.date >= lateFrom ? ':late-window' : ''); extraWhy[k] = (extraWhy[k] || 0) + 1; }
    /* a sample of the extra rows looked up in the GovMap-layer copy by block + parcel (any settlement spelling, or none) */
    const extraCheck = { FOUND_UNDER_OTHER_SETTLEMENT: 0, FOUND_DIFFERENT_FIELDS: 0, NOT_IN_GOVMAP_COPY: 0, LOOKUP_FAILED: 0 }, extraSamples = [];
    for (const d of extras.filter((x) => x.date < lateFrom && x.gushN != null && x.helkaN != null).slice(0, 12)) {
      const r = await overGet(`/api/deals/govmap/search?gush=${d.gushN}&helka=${d.helkaN}&sort=date_desc&limit=200`);
      const rows = rowsOf(r.json);
      if (r.status !== 200 || !rows) { extraCheck.LOOKUP_FAILED++; continue; }
      const hit = rows.find((g) => Math.abs(dayDiff(String(g.deal_date).slice(0, 10), d.date)) <= 1 && (near(num(g.deal_amount), d.amount) || amountRel(num(g.deal_amount), d) === 'share'));
      const k = !hit ? 'NOT_IN_GOVMAP_COPY' : normCity(hit.settlement) !== normCity(city) ? 'FOUND_UNDER_OTHER_SETTLEMENT' : 'FOUND_DIFFERENT_FIELDS';
      extraCheck[k]++;
      if (extraSamples.length < 6) extraSamples.push({ k, propx: pOut(d), govmap: hit ? [String(hit.deal_date).slice(0, 10), hit.settlement, hit.street, hit.house_num, `${hit.gush}/${hit.parcel}/${hit.sub_parcel}`, num(hit.deal_amount), num(hit.asset_area), num(hit.rooms)] : null, parcelRowsInGovmap: rows.length });
    }
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
    out({ kind: 'compareSamples', city, samples, missWhy, missSamples, extraWhy, extraCheck, extraSamples });
    /* streets: the three busiest GovMap streets of the last 365 days + one of medium and one of low activity */
    const byStreet = new Map(); for (const g of G) { if (!g.street || g.date > today) continue; if (!byStreet.has(g.street)) byStreet.set(g.street, []); byStreet.get(g.street).push(g); }
    const ranked = [...byStreet].sort((a, b) => b[1].length - a[1].length);
    const pick = [...ranked.slice(0, 3), ranked.find(([, v]) => v.length >= 8 && v.length <= 15), ranked.find(([, v]) => v.length >= 2 && v.length <= 3)].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const [name, gs2] of pick) {
      const ids = D.streets.filter((s) => s.cityCode === code && SD.normName(s.name) === SD.normName(name)).map((s) => s.code);
      const pS = P.filter((d) => d.dwelling && d.streetCodes.some((c) => ids.includes(c)));
      const gD = gs2.map((g) => g.date).sort(), pD = pS.map((d) => d.date).sort();
      const inP = (g) => (pByParcel.get(`${g.gush}|${g.parcel}`) || []).some((d) => Math.abs(dayDiff(g.date, d.date)) <= 1 && (near(g.amount, d.amount) || amountRel(g.amount, d) === 'share'));
      const status = gs2.slice(0, 40).map((g) => (inP(g) ? 'M' : g.date >= lateFrom ? 'L' : 'W'));
      out({ kind: 'compareStreet', city, street: name, directoryCodes: ids, govmap: { n: gs2.length, latest: gD.slice(-1)[0], d90: within(gD, today, 90) },
        propx: { n: pS.length, latest: pD.slice(-1)[0] || null, d90: within(pD, today, 90) },
        recentGovmapInPropx: { matched: status.filter((x) => x === 'M').length, reportedLate: status.filter((x) => x === 'L').length, olderMissing: status.filter((x) => x === 'W').length, of: status.length },
        sample: gs2.slice(0, 4).map((g) => ({ g: gOut(g), inPropx: inP(g) })) });
    }
  }
  out({ kind: 'fixtureCandidates', n: fixture.length, rows: fixture });
}

/* ── --recent-probe: before PROPX stores the GovMap-layer copy's recent rows — is the copy still the audited version, is
   newest-first paging stable (overlapping pages agree; a repeated page is identical), what do the recent rows look like
   (future dates, no settlement, no property type, the two deal-id series, in-source duplicates)? ── */
async function recentProbe(from) {
  const gs = await overGet('/api/deals/govmap/stats');
  out({ kind: 'recentProbe', step: 'stats', body: gs.json });
  const page = async (q, offset) => { const r = await overGet(`/api/deals/govmap/search?${q}sort=date_desc&limit=200&offset=${offset}`); return { status: r.status, rows: rowsOf(r.json) || [] }; };
  const key = (g) => String(g.objectid);
  /* global paging with a 50-row overlap: rows 150–199 of page k must equal rows 0–49 of page k + 1 */
  const all = new Map(); let disagreements = 0, pages = 0, stop = false, offset = 0, firstAgain = null;
  let prev = null;
  while (!stop && pages < 400) {
    const p = await page('', offset); pages++;
    if (p.status !== 200) { out({ kind: 'recentProbe', step: 'page', offset, status: p.status }); break; }
    if (prev) { const a = prev.rows.slice(150).map(key).join(','), b = p.rows.slice(0, 50).map(key).join(','); if (a !== b) disagreements++; }
    for (const g of p.rows) all.set(key(g), g);
    const last = p.rows[p.rows.length - 1];
    if (p.rows.length < 200 || !last || String(last.deal_date).slice(0, 10) < from) stop = true;
    prev = p; offset += 150;
    if (pages === 1) firstAgain = p.rows.map(key).join(',');
  }
  const again = await page('', 0);
  out({ kind: 'recentProbe', step: 'global-paging', pages, rows: all.size, overlapDisagreements: disagreements, repeatIdentical: again.rows.map(key).join(',') === firstAgain });
  const today = iso(Date.now());
  const rows = [...all.values()].map((g) => ({ ...g, date: String(g.deal_date).slice(0, 10) }));
  const recent = rows.filter((g) => g.date >= from && g.date <= today);
  const fut = rows.filter((g) => g.date > today);
  const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const series = (g) => (String(g.deal_id).startsWith('1136') && String(g.deal_id).length === 11 ? '1136…' : String(g.deal_id).length + '-digit');
  out({ kind: 'recentProbe', step: 'recent-shape', from, today, recent: recent.length, future: fut.length, futureDates: fut.map((g) => g.date).sort().slice(-8),
    noSettlement: recent.filter((g) => !g.settlement).length, noStreet: recent.filter((g) => !g.street).length, noBlock: recent.filter((g) => g.gush == null).length,
    propertyType: by(recent, (g) => g.property_type || '(none)'), dealNature: by(recent, (g) => g.deal_nature || '(none)'), series: by(recent, series),
    seriesByType: by(recent, (g) => series(g) + ' / ' + (g.property_type || '(none)')), byMonth: by(recent, (g) => g.date.slice(0, 7)),
    keys: rows[0] ? Object.keys(rows[0]) : null });
  /* in-source duplicates: same block · parcel · amount · area, dates ≤ 1 day apart */
  const grp = new Map();
  for (const g of recent) { const k = [g.gush, g.parcel, g.deal_amount, g.asset_area].join('|'); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(g); }
  const dups = [...grp.values()].filter((xs) => xs.length > 1 && xs.some((a, i) => xs.some((b, j) => j !== i && Math.abs(Date.parse(a.date) - Date.parse(b.date)) <= 864e5)));
  out({ kind: 'recentProbe', step: 'in-source-duplicates', groups: dups.length, rows: dups.reduce((a, xs) => a + xs.length, 0),
    shapes: by(dups, (xs) => xs.map((g) => series(g) + ':' + (g.property_type ? 'T' : '-') + ':' + (g.sub_parcel == null ? 'nosub' : 'sub')).sort().join(' + ')),
    sameSub: dups.filter((xs) => new Set(xs.map((g) => g.sub_parcel)).size === 1).length,
    dayGap: by(dups, (xs) => { const d = xs.map((g) => Date.parse(g.date)); return String((Math.max(...d) - Math.min(...d)) / 864e5); }),
    sample: dups.slice(0, 6).map((xs) => xs.map((g) => [g.deal_id, g.date, g.settlement, g.street, g.house_num, `${g.gush}/${g.parcel}/${g.sub_parcel}`, g.deal_amount, g.asset_area, g.rooms, g.property_type, g.deal_nature, g.floor])) });
  /* per-settlement paging stability (Petah Tikva) */
  const s1 = await page('settlement=' + encodeURIComponent('פתח תקווה') + '&', 0), s2 = await page('settlement=' + encodeURIComponent('פתח תקווה') + '&', 150);
  out({ kind: 'recentProbe', step: 'settlement-paging', overlapAgrees: s1.rows.slice(150).map(key).join(',') === s2.rows.slice(0, 50).map(key).join(',') });
}

(async () => {
  try {
    if (args.includes('--official')) await official();
    else if (args.includes('--over')) await over();
    else if (args.includes('--recent-probe')) await recentProbe(opt('--from') || '2026-07-03');
    else if (args.includes('--compare')) await compare(String(opt('--compare') || '').split('|').filter(Boolean), opt('--from'));
    else { console.error('usage: --official | --over | --compare "<city>|<city>"'); process.exit(2); }
  } catch (e) { out({ kind: 'error', error: e.message }); process.exit(1); }
})();
