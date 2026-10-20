#!/usr/bin/env node
// PROPX · THE LIVE CHECK OF "ALL" AND OF "LATEST" THROUGH THE USER'S OWN PATH (closure P0, 20.10.2026) → data/txevents/all-check.json.
//
// Runs the real /api/gov/transactions handler in-process (the page's requests, the page's paging: offset pages inside the stored union,
// then the date cursor through the history) against the live register copy — on a runner (the sandbox reaches no Israeli host). One source
// request a second; the GovMap platform (403 to servers) is not asked.
//   1. ALL, page by page to the end, for a street, small localities, a large locality: every register deal the copy counts for the
//      place's settlement names is listed exactly once (shown = the register's own count), no event twice, dates never rising, and every
//      GovMap history row of the place is shown or folded into the register deal it repeats; the largest cities, Israel and a district:
//      the first pages and the oldest pages (the history reaches 1998).
//   2. Periods (30 / 90 days, 6 / 12 / 24 months): every event inside the period; the API's count = the stored union's count.
//   3. LATEST: every official locality whose stored union holds no event (its newest deal is older than the stored window, or it has
//      none): the first event the user sees for ALL = the newest the sources hold (the register's own last deal per settlement name, the
//      GovMap history's newest row of the place); Israel and every district: the first event of the area's ALL list.
//   node scripts/txevents-all-check.js [--quick]

'use strict';

process.env.GOV_GOVMAP_DISABLED = '1';
const GAP_MS = Number(process.env.TXEVENTS_CHECK_GAP_MS || 1000);
const realFetch = globalThis.fetch;
let lastAt = 0, requests = 0;
let backoffs = 0;
globalThis.fetch = async (url, init) => {
  for (let attempt = 1; ; attempt++) {
    const wait = lastAt + GAP_MS - Date.now();
    lastAt = Math.max(Date.now(), lastAt + GAP_MS);
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    requests++;
    const r = await realFetch(url, init);
    /* the republisher's rate limit: wait (a minute, then longer) and ask again — never read as an answer */
    if (r.status !== 429 || attempt >= 6) return r;
    backoffs++;
    const pause = 60000 * attempt;
    lastAt = Date.now() + pause;
    await new Promise((ok) => setTimeout(ok, pause));
  }
};

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const handler = require('../api/gov/transactions');
const TX = require('../lib/txevents');
const HIST = require('../lib/txevents/history');
const EV = require('../lib/streets/evidence');
const D = require('../lib/streets/directory').load();
const quick = process.argv.includes('--quick');
const today = new Date().toISOString().slice(0, 10);
const BASE = process.env.STREET_EVIDENCE_BASE || 'https://www.over.org.il';

async function call1(params) {
  const req = { method: 'GET', url: '/api/gov/transactions?' + new URLSearchParams(params).toString(), headers: {} };
  let body = '';
  const res = { statusCode: 200, setHeader() {}, end(b) { body = b; } };
  await handler(req, res);
  const b = JSON.parse(body);
  b.__status = res.statusCode;
  return b;
}
/* the page's own retry: a page refused (503 · retry) or a history read that did not answer is asked again, as the user's "load more"
   / retry would — after 30 s, 60 s, 90 s, 120 s; the last answer is kept with its error */
let retries = 0;
const transient = (b) => b.__status === 503 || !!b.error || !!(b.meta && b.meta.sourceCoverage && b.meta.sourceCoverage.olderError);
async function call(params) {
  let b = await call1(params);
  for (let attempt = 1; attempt <= 4 && transient(b); attempt++) {
    retries++;
    console.log(JSON.stringify({ retry: attempt, params: { ...params, city: params.city ? '…' : undefined }, error: b.error || (b.meta && b.meta.sourceCoverage && b.meta.sourceCoverage.olderError) || b.__status }));
    await new Promise((ok) => setTimeout(ok, 30000 * attempt));
    b = await call1(params);
  }
  return b;
}
const only = (() => { const a = process.argv.find((x) => x.startsWith('--only=')); return a ? new Set(a.slice(7).split(',').filter(Boolean)) : null; })();
const want = (part) => !only || only.has(part);
const counted = (t) => t.state !== 'POSSIBLE_DUPLICATE';

/** ALL for one place, page by page as the page reads it; `maxPages` stops early (the first pages), `older` starts at a cursor */
async function pageAll(params, { maxPages = Infinity, older = null } = {}) {
  const seen = new Map(), dups = [], risingAt = [];
  let rising = 0, prev = null, prevId = null, pages = 0, folded = 0, end = false, error = null, first = null, last = null;
  const take = (rows) => {
    for (const t of rows) {
      if (seen.has(t.id)) dups.push(t.id); else seen.set(t.id, t);
      if (prev && t.date && t.date > prev) { rising++; if (risingAt.length < 10) risingAt.push({ page: pages, before: { id: prevId, date: prev }, after: { id: t.id, date: t.date, source: t.source } }); }
      if (t.date) { prev = t.date; prevId = t.id; }
      if (!first && t.date && counted(t)) first = t.date;
      if (t.date) last = t.date;
    }
  };
  let cursor = older;
  if (!cursor) {
    for (let offset = 0; pages < maxPages; offset += 200) {
      const b = await call({ ...params, all: '1', months: '240', limit: '200', offset: String(offset) });
      pages++;
      if (b.error) { error = b.error; break; }
      take(b.transactions || []);
      const sc = (b.meta && b.meta.sourceCoverage) || {};
      if (offset === 0) folded += sc.olderFolded || 0;
      if (!sc.more) { cursor = sc.olderMore ? sc.olderNext : null; end = !sc.olderMore; if (sc.olderError) error = sc.olderError; break; }
    }
  }
  prev = prev || null;
  while (cursor && pages < maxPages) {
    const b = await call({ ...params, all: '1', months: '240', limit: '200', older: cursor });
    pages++;
    if (b.error) { error = b.error; break; }
    take(b.transactions || []);
    const sc = (b.meta && b.meta.sourceCoverage) || {};
    folded += sc.folded || 0;
    if (sc.olderError) { error = sc.olderError; break; }
    if (!sc.olderMore) { end = true; cursor = null; break; }
    if (sc.olderNext === cursor) { error = 'cursor did not move: ' + cursor; break; }
    cursor = sc.olderNext;
  }
  const ev = [...seen.values()];
  const reg = ev.filter((t) => t.source === 'register' && !/^regx:/.test(String(t.id)));
  return { pages, end, error, events: ev.length, counted: ev.filter(counted).length, duplicateIds: dups.length, risingDates: rising, firstCounted: first, oldest: last,
    register: reg.length, registerUnmapped: ev.filter((t) => /^regx:/.test(String(t.id))).length, govmapWindow: ev.filter((t) => /^gm:/.test(String(t.id))).length,
    govmapHistory: ev.filter((t) => /^gmh:/.test(String(t.id))).length, govmapFolded: folded, unplaced: ev.filter((t) => /^gmu:/.test(String(t.id))).length,
    possibleDuplicates: ev.length - ev.filter(counted).length, cursorAtStop: cursor, risingAt, duplicateExamples: dups.slice(0, 10), ids: ev.map((t) => t.id) };
}

(async () => {
  const out = { schema: 1, ranAt: new Date().toISOString(), today, engine: TX.ENGINE, quick, window: (EV.store().meta || {}).window || null };
  /* the register's own per-settlement counts and latest deal (one request) */
  const sl = await (await globalThis.fetch(BASE + '/api/deals/settlements', { headers: { Accept: 'application/json', 'User-Agent': 'PROPX-txevents-all-check/1.0 (read-only)' } })).json();
  const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const regByCode = new Map();
  for (const s of sl.data || []) {
    const c = num(s.settlement_code) != null ? num(s.settlement_code) : num(s.resolved_code);
    if (c == null || !D.localities.has(c)) continue;
    const x = regByCode.get(c) || { names: [], deals: 0, lastDeal: null };
    x.names.push(s.settlement); x.deals += num(s.deals) || 0;
    const ld = s.last_deal ? String(s.last_deal).slice(0, 10) : null;
    if (ld && (!x.lastDeal || ld > x.lastDeal)) x.lastDeal = ld;
    regByCode.set(c, x);
  }
  const H = HIST.meta() || { localities: {} };
  const winFrom = out.window ? out.window.from : null;
  const histRows = (code) => HIST.rows({ code }, null, winFrom ? HIST.addDays(winFrom, -1) : null);

  const name = (c) => D.localities.get(c).he;
  if (want('full')) {
  /* 1. ALL to the end */
  const smallWithWindow = [...regByCode.entries()].filter(([c, x]) => x.deals >= 150 && x.deals <= 400 && D.localities.get(c)).sort((a, b) => a[0] - b[0])[0];
  const full = [
    { id: 'street:shaham-petah-tikva', params: { city: name(7900), street: 'שחם', sid: 'st:7900:156' }, code: 7900, streetCode: 156 },
    { id: 'locality:history-only:816', params: { city: name(816) }, code: 816 },
    smallWithWindow ? { id: 'locality:small:' + smallWithWindow[0], params: { city: name(smallWithWindow[0]) }, code: smallWithWindow[0] } : null,
    ...(quick ? [] : [{ id: 'locality:petah-tikva', params: { city: name(7900) }, code: 7900 }, { id: 'locality:haifa', params: { city: name(4000) }, code: 4000 }]),
  ].filter(Boolean);
  out.full = [];
  for (const f of full) {
    const r = await pageAll(f.params);
    const reg = regByCode.get(f.code);
    const hist = f.streetCode != null ? null : histRows(f.code).length;
    const row = { id: f.id, code: f.code, streetCode: f.streetCode || null, ...r,
      registerExpected: f.streetCode != null ? null : reg ? reg.deals : 0, registerNames: reg ? reg.names : [],
      govmapHistoryRows: hist, govmapHistoryAccounted: hist == null ? null : r.govmapHistory + r.govmapFolded };
    row.pass = !r.error && r.end && !r.duplicateIds && !r.risingDates && (row.registerExpected == null || row.register === row.registerExpected)
      && (hist == null || row.govmapHistoryAccounted === hist);
    out.full.push(row);
    console.log(JSON.stringify({ full: f.id, pass: row.pass, register: row.register, expected: row.registerExpected, hist, acc: row.govmapHistoryAccounted, pages: r.pages, oldest: r.oldest, error: r.error }));
  }
  /* small places: every deal the register's own search returns for the locality's names (all years) is one of the events shown, by
     its deal key — and the deals the register dates nowhere are counted apart */
  for (const st of out.full.filter((x) => x.streetCode == null && x.registerExpected != null && x.registerExpected <= 10000)) {
    const names = (regByCode.get(st.code) || { names: [] }).names;
    const want = new Map(); let total = 0, undated = 0; const undatedRows = [];
    for (const n of names) {
      for (let offset = 0; ; offset += 200) {
        const b = await (await globalThis.fetch(`${BASE}/api/deals/search?` + new URLSearchParams({ settlement: n, sort: 'date_desc', limit: '200', offset: String(offset) }), { headers: { Accept: 'application/json' } })).json();
        const data = Array.isArray(b.data) ? b.data : [];
        for (const d of data) {
          total++;
          if (!d.date) { undated++; if (undatedRows.length < 10) undatedRows.push({ gush: d.gush, helka: d.helka, amount: d.amount, nature: d.nature }); continue; }
          const k = TX.unitKey(st.code, String(d.date).slice(0, 10), d.gush, d.helka, d.sub_parcel, num(d.amount)); want.set(k, (want.get(k) || 0) + 1);
        }
        if (!data.length || offset + data.length >= Number(b.total)) break;
      }
    }
    const shown = new Map();
    for (const id of st.ids || []) { const m = /^(?:reg|live):(.*?)(?:#\d+)?$/.exec(String(id)); if (m) shown.set(m[1], (shown.get(m[1]) || 0) + 1); }
    let missing = 0; const examples = [];
    for (const [k, n] of want) { const d = n - (shown.get(k) || 0); if (d > 0) { missing += d; if (examples.length < 10) examples.push({ key: k, inRegisterSearch: n, shown: shown.get(k) || 0, shownSameDay: (st.ids || []).filter((id) => String(id).includes('|' + k.split('|')[1] + '|')) }); } }
    let extra = 0; for (const [k, n] of shown) if (n > (want.get(k) || 0)) extra += n - (want.get(k) || 0);
    Object.assign(st, { registerSearchTotal: total, registerSearchKeys: want.size, registerUndated: undated, registerUndatedRows: undatedRows, registerMissing: missing, registerMissingExamples: examples, registerShownNotInSearch: extra });
    st.pass = st.pass && missing === 0;
  }
  /* the street: every deal the register's own street search returns (all years) is one of the events shown — by its deal key */
  {
    const st = out.full.find((x) => x.streetCode != null);
    if (st) {
      const names = (regByCode.get(7900) || { names: [] }).names;
      const want = new Map();
      let total = 0, capped = false;
      for (const n of names) {
        for (let offset = 0; ; offset += 200) {
          const b = await (await globalThis.fetch(`${BASE}/api/deals/search?` + new URLSearchParams({ settlement: n, street: 'שחם', sort: 'date_desc', limit: '200', offset: String(offset) }), { headers: { Accept: 'application/json' } })).json();
          const data = Array.isArray(b.data) ? b.data : [];
          if (b.total_capped) capped = true;
          for (const d of data) { const k = TX.unitKey(7900, String(d.date).slice(0, 10), d.gush, d.helka, d.sub_parcel, num(d.amount)); want.set(k, (want.get(k) || 0) + 1); total++; }
          if (!data.length || offset + data.length >= Number(b.total)) break;
        }
      }
      const shown = new Map();
      for (const id of st.ids || []) { const m = /^(?:reg|live):(.*?)(?:#\d+)?$/.exec(String(id)); if (m) shown.set(m[1], (shown.get(m[1]) || 0) + 1); }
      let missing = 0; const examples = [];
      for (const [k, n] of want) { const d = n - (shown.get(k) || 0); if (d > 0) { missing += d; if (examples.length < 10) examples.push(k); } }
      Object.assign(st, { registerExpected: total, registerSearchCapped: capped, registerMissing: missing, registerMissingExamples: examples, registerShownBeyondSearch: st.register - (total - missing) });
      st.pass = !st.error && st.end && !st.duplicateIds && !st.risingDates && !capped && missing === 0;
    }
  }
  for (const x of out.full) delete x.ids;
  }
  if (want('partial')) {
  /* the largest cities, Israel and a district: the first pages and the oldest pages */
  out.partial = [];
  const partial = [
    { id: 'locality:tel-aviv', params: { city: name(5000) } }, { id: 'locality:jerusalem', params: { city: name(3000) } },
    { id: 'area:il', params: { area: 'il' } }, { id: 'area:d-haifa', params: { area: 'd-haifa' } },
  ];
  for (const p of partial) {
    const head = await pageAll(p.params, { maxPages: 3 });
    const tail = await pageAll(p.params, { older: '1998-03-31' });
    out.partial.push({ id: p.id, head: { pages: head.pages, firstCounted: head.firstCounted, oldest: head.oldest, duplicateIds: head.duplicateIds, risingDates: head.risingDates, unplaced: head.unplaced, error: head.error },
      tail: { pages: tail.pages, end: tail.end, oldest: tail.oldest, events: tail.events, duplicateIds: tail.duplicateIds, risingDates: tail.risingDates, error: tail.error },
      pass: !head.error && !tail.error && tail.end && !head.duplicateIds && !tail.duplicateIds && !head.risingDates && !tail.risingDates && !!tail.oldest && tail.oldest <= '1998-03-31' });
    console.log(JSON.stringify({ partial: p.id, first: head.firstCounted, oldest: tail.oldest, end: tail.end }));
  }

  }
  if (want('periods')) {
  /* 2. periods */
  out.periods = [];
  const PER = [{ id: 'd30', days: 30 }, { id: 'd90', days: 90 }, { id: 'm6', months: 6 }, { id: 'm12', months: 12 }, { id: 'm24', months: 24 }];
  const places = [{ id: 'tel-aviv', code: 5000, params: { city: name(5000) } }, { id: 'jerusalem', code: 3000, params: { city: name(3000) } }, { id: 'haifa', code: 4000, params: { city: name(4000) } },
    { id: 'petah-tikva', code: 7900, params: { city: name(7900) } }, { id: 'shaham', code: 7900, sid: 'st:7900:156', params: { city: name(7900), street: 'שחם', sid: 'st:7900:156' } }];
  for (const pl of places) for (const p of PER) {
    const q = p.days ? { days: String(p.days) } : { months: String(p.months) };
    const b = await call({ ...pl.params, ...q, limit: '200' });
    const per = TX.periodOf({ days: p.days, months: p.months, today });
    const rows = b.transactions || [];
    const outside = rows.filter((t) => !(t.date && t.date <= per.to && t.date > per.from)).length;
    const U = TX.query({ code: pl.code, streetId: pl.sid, days: p.days, months: p.days ? null : p.months, today, unlimited: true });
    const sc = (b.meta && b.meta.sourceCoverage) || {};
    const row = { place: pl.id, period: p.id, from: per.from, to: per.to, apiTotal: sc.total, storedUnion: U.total, outside, liveAdded: b.meta && b.meta.live ? b.meta.live.added : null,
      newest: rows.find(counted) ? rows.find(counted).date : null, statement: b.meta && b.meta.statement ? b.meta.statement.kind || b.meta.statement.id || null : null };
    /* the API adds the register's own address-link rows of the period (live) to the stored union — never fewer, never more than it added */
    row.pass = outside === 0 && sc.total >= U.total && sc.total - U.total <= (row.liveAdded || 0);
    out.periods.push(row);
  }
  console.log(JSON.stringify({ periods: out.periods.length, failed: out.periods.filter((x) => !x.pass).length }));

  }
  if (want('historyStreets')) {
  /* 2b. LATEST on streets whose every event is older than the stored window: the first event ALL shows = the newest of the register's
     own street search (the republisher's address link — the only register read of a street before the window) and the GovMap layer's
     history rows on the street. Two streets per locality, the ones with the most history rows and no event in the stored window. */
  out.historyStreets = [];
  const streetName = (c, sc) => (D.byId.get(`st:${c}:${sc}`) || {}).name || null;
  for (const c of [5000, 3000, 4000, 7900, 70, 6100, 8300, 7100, 1031, 2640]) {
    if (!D.localities.has(c)) continue;
    const by = new Map(), rowsC = histRows(c);
    for (const r of rowsC) if (r.streetCode != null) { const x = by.get(r.streetCode) || { n: 0, latest: null }; x.n++; if (!x.latest || r.date > x.latest) x.latest = r.date; by.set(r.streetCode, x); }
    let picked = 0;
    for (const [sc, x] of [...by.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0])) {
      if (picked >= 2) break;
      const nm = streetName(c, sc); if (!nm) continue;
      if (TX.query({ streetId: `st:${c}:${sc}`, all: true, unlimited: true, today }).total) continue;
      picked++;
      /* the GovMap side: every history row the API itself places on the street (its official code, its published name, its parcel) */
      const scope = TX.resolveScope({ code: c, streetId: `st:${c}:${sc}` });
      const S = TX.stores();
      let gmPlaced = null, gmPlacedRows = 0;
      for (const r of rowsC) {
        const e = TX.gmEvent(HIST.asLayerRow(r), 'over:govmap-national', null);
        if (e.state === 'POSSIBLE_DUPLICATE' || !TX.placeEvent(e, scope, S)) continue;
        gmPlacedRows++; if (!gmPlaced || r.date > gmPlaced) gmPlaced = r.date;
      }
      let regLatest = null, regError = null;
      for (const n of (regByCode.get(c) || { names: [] }).names) {
        let b;
        try {
          const r = await globalThis.fetch(`${BASE}/api/deals/search?` + new URLSearchParams({ settlement: n, street: nm, sort: 'date_desc', limit: '1' }), { headers: { Accept: 'application/json' } });
          if (!r.ok) { regError = 'HTTP ' + r.status; continue; }
          b = await r.json();
        } catch (e) { regError = e.message; continue; }
        const d = (b.data || [])[0];
        if (d && d.date) { const dd = String(d.date).slice(0, 10); if (!regLatest || dd > regLatest) regLatest = dd; }
      }
      const b = await call({ city: name(c), street: nm, sid: `st:${c}:${sc}`, all: '1', months: '240', limit: '50' });
      const t = (b.transactions || []).find(counted);
      const sc0 = (b.meta && b.meta.sourceCoverage) || {};
      const source = [regLatest, gmPlaced].filter(Boolean).sort().pop() || null;
      const row = { street: `st:${c}:${sc}`, name: nm, govmapHistoryRows: x.n, govmapHistoryLatest: x.latest, govmapPlacedRows: gmPlacedRows, govmapPlacedLatest: gmPlaced, registerStreetSearchLatest: regLatest, source, visible: t ? t.date : null,
        visibleEvent: t ? { id: t.id, source: t.source, match: t.geo && t.geo.match } : null,
        error: b.error || sc0.olderError || regError || null };
      row.pass = !row.error && row.source === row.visible;
      out.historyStreets.push(row);
      console.log(JSON.stringify({ historyStreet: row.street, source, visible: row.visible, pass: row.pass, error: row.error }));
    }
  }

  }
  if (want('latest')) {
  /* 3. LATEST — every official locality the stored union does not cover, through the page's own ALL read; Israel and every district */
  const latest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'txevents', 'latest.json'), 'utf8'));
  out.latest = { localities: [], areas: [] };
  /* every locality the stored union does not cover, and every one whose stored events are all older than the window (its newest may sit in
     the ALL history page, not in the stored index) */
  const codes = [...D.localities.keys()].filter((c) => !(latest.localities[c] && latest.localities[c].latest && (!winFrom || latest.localities[c].latest >= winFrom))).sort((a, b) => a - b);
  for (const c of codes) {
    const reg = regByCode.get(c) || null;
    const h = H.localities ? H.localities[c] : null;
    const source = [reg && reg.lastDeal, h && h.latest].filter(Boolean).sort().pop() || null;
    let visible = null, error = null;
    if (source) {
      const b = await call({ city: name(c), all: '1', months: '240', limit: '50' });
      if (b.error) error = b.error; else { const t = (b.transactions || []).find(counted); visible = t ? t.date : null; if (b.meta && b.meta.sourceCoverage && b.meta.sourceCoverage.olderError) error = b.meta.sourceCoverage.olderError; }
    }
    out.latest.localities.push({ code: c, name: name(c), registerLastDeal: reg ? reg.lastDeal : null, registerDeals: reg ? reg.deals : 0, govmapHistoryLatest: h ? h.latest : null,
      source, visible, error, match: source === visible, reason: source == null ? 'NO_TRANSACTION_IN_ANY_SOURCE' : null });
  }
  for (const a of ['il', ...[...new Set([...D.localities.values()].map((l) => l.district).filter(Boolean))].sort()]) {
    const b = await call({ area: a, all: '1', months: '240', limit: '200' });
    const t = (b.transactions || []).find(counted);
    out.latest.areas.push({ area: a, visible: t ? t.date : null, storedLatest: a === 'il' ? latest.national.latest : (latest.districts[a] || {}).latest || null, error: b.error || null });
  }
  }
  /* a partial run (--only=…) keeps the other sections of the previous check, each with the time it ran */
  const OUT = process.env.TXEVENTS_CHECK_OUT || path.join(ROOT, 'data', 'txevents', 'all-check.json');
  const prevOut = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
  out.sectionsRanAt = {};
  for (const sec of ['full', 'partial', 'periods', 'historyStreets', 'latest']) {
    if (want(sec)) { out.sectionsRanAt[sec] = out.ranAt; continue; }
    out[sec] = prevOut && prevOut[sec] != null ? prevOut[sec] : (sec === 'latest' ? { localities: [], areas: [] } : []);
    out.sectionsRanAt[sec] = prevOut ? (prevOut.sectionsRanAt && prevOut.sectionsRanAt[sec]) || prevOut.ranAt : null;
  }
  const L = out.latest.localities;
  out.latest.summary = { checked: L.length, withTransactions: L.filter((x) => x.source).length, match: L.filter((x) => x.source && x.match).length,
    mismatch: L.filter((x) => x.source && !x.match).length, noTransaction: L.filter((x) => !x.source).length, errors: L.filter((x) => x.error).length };
  out.requests = requests; out.backoffs = backoffs; out.retries = retries; out.only = only ? [...only] : null;
  out.pass = out.full.every((x) => x.pass) && out.partial.every((x) => x.pass) && out.periods.every((x) => x.pass) && out.historyStreets.every((x) => x.pass) && out.latest.summary.mismatch === 0 && out.latest.summary.errors === 0;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ pass: out.pass, latest: out.latest.summary, areas: out.latest.areas, requests }));
})().catch((e) => { console.error('all-check: ' + (e.stack || e.message)); process.exit(1); });
