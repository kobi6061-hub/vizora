// PROPX · TRANSACTION COMPLETENESS CLOSURE gates (20.10.2026): ALL is the whole history (no product window hides a known deal), every
// source row is surfaced or has a documented reason, the unplaced rows are Israel's and never a locality's, and the latest event the
// sources hold is the first one the user sees.
//   node test/txevents-closure.test.js
'use strict';

process.env.GOV_GOVMAP_DISABLED = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const T = path.join(ROOT, 'data', 'txevents');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/* ── a fake register copy (the over.org.il API shape) — the stored deals of one locality, their copies 3 and 6 years earlier (the
   history the live search reaches), behind an overridden fetch: nothing leaves the process ── */
const EV = require('../lib/streets/evidence');
const FAKE = { code: 26, rows: [], fail: false, names: [] };
{
  const sh = EV.shardOf(FAKE.code);
  FAKE.names = sh.settlements;
  const shift = (d, y) => (Number(d.slice(0, 4)) - y) + d.slice(4);
  for (const x of EV.dealsOf(sh)) for (const y of [0, 3, 6]) {
    const d = x.deal;
    FAKE.rows.push({ date: shift(d.date, y), amount: d.amount, declared_amount: d.declaredAmount, nature: d.nature, area_sqm: d.areaSqm, rooms: d.rooms, year_built: d.yearBuilt,
      portion: null, portion_fraction: d.portionFraction, sub_parcel: d.subParcel, settlement: FAKE.names[0], settlement_code: String(FAKE.code), gush: d.gush, helka: d.helka,
      addresses: d.parcelAddresses || [], addresses_total: d.parcelAddressesTotal || 0 });
  }
  FAKE.rows.sort((a, b) => b.date.localeCompare(a.date));
}
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
  if (!/over\.org\.il$/.test(u.hostname)) return json({}, 404);
  if (u.pathname === '/api/deals/stats') return json({ deals: FAKE.rows.length, first_deal: FAKE.rows[FAKE.rows.length - 1].date, last_deal: FAKE.rows[0].date, scraped_at: '2026-09-19 11:07:39+00' });
  if (u.pathname === '/api/deals/settlements') return json({ data: FAKE.names.map((n) => ({ settlement: n, settlement_code: String(FAKE.code), deals: FAKE.rows.length, last_deal: FAKE.rows[0].date, resolved_code: FAKE.code })) });
  if (u.pathname === '/api/deals/search') {
    if (FAKE.fail) return json({ error: 'unavailable' }, 503);
    const p = u.searchParams, st = p.get('settlement'), f = p.get('date_from'), t = p.get('date_to'), off = Number(p.get('offset')) || 0, lim = Number(p.get('limit')) || 50;
    const m = FAKE.rows.filter((d) => (!st || d.settlement === st) && (!f || d.date >= f) && (!t || d.date <= t) && (!p.get('gush') || String(d.gush) === p.get('gush')) && (!p.get('helka') || String(d.helka) === p.get('helka')));
    return json({ data: m.slice(off, off + lim), total: Math.min(m.length, 10000), total_capped: m.length > 10000 });
  }
  return json({}, 404);
};

const TX = require('../lib/txevents');
const HIST = require('../lib/txevents/history');
const U = require('../lib/txevents/unplaced');
const handler = require('../api/gov/transactions');
const D = require('../lib/streets/directory').load();
const H = HIST.meta();
const winFrom = EV.store().meta.window.from;
const today = new Date().toISOString().slice(0, 10);

async function call(params) {
  const req = { method: 'GET', url: '/api/gov/transactions?' + new URLSearchParams(params).toString(), headers: {} };
  let body = '';
  await handler(req, { statusCode: 200, setHeader() {}, end(b) { body = b; } });
  return JSON.parse(body);
}
/* ALL, page by page, exactly as the page reads it: offset pages inside the stored union, then the date cursor */
async function pageAll(params, max = 400) {
  const seen = new Map(); let dups = 0, rising = 0, prev = null, folded = 0, cursor = null, pages = 0, error = null, end = false;
  const take = (rows) => { for (const t of rows) { if (seen.has(t.id)) dups++; else seen.set(t.id, t); if (prev && t.date > prev) rising++; prev = t.date; } };
  for (let offset = 0; pages < max; offset += 200) {
    const b = await call({ ...params, all: '1', months: '240', limit: '200', offset: String(offset) }); pages++;
    take(b.transactions); const sc = b.meta.sourceCoverage;
    if (offset === 0) folded += sc.olderFolded || 0;
    if (!sc.more) { if (sc.olderError) error = sc.olderError; cursor = sc.olderMore ? sc.olderNext : null; end = !sc.olderMore; break; }
  }
  prev = null;
  while (cursor && pages < max) {
    const b = await call({ ...params, all: '1', months: '240', limit: '200', older: cursor }); pages++;
    take(b.transactions); const sc = b.meta.sourceCoverage; folded += sc.folded || 0;
    if (sc.olderError) { error = sc.olderError; break; }
    if (!sc.olderMore) { end = true; break; }
    assert.notEqual(sc.olderNext, cursor, 'the cursor always moves'); cursor = sc.olderNext;
  }
  return { ev: [...seen.values()], dups, rising, folded, pages, error, end };
}

const results = [];
const t = (name, fn) => results.push([name, fn]);

t('HISTORY PARTITIONS: the per-locality files are the year files regrouped — the same rows, derived from the year files meta.json lists', () => {
  const ix = readJson(path.join(T, 'history', 'loc', 'index.json'));
  assert.ok(ix, 'data/txevents/history/loc/index.json');
  assert.equal(ix.rows, H.shown, 'every shown history row, once');
  assert.ok(HIST.locReady(H), 'derived from the year files of this build (sha256)');
  for (const [c, x] of Object.entries(H.localities)) assert.equal((ix.localities[c] || {}).rows, x.rows, 'locality ' + c);
  /* a locality's partition = the year files' rows of that locality (one year compared row by row) */
  const y = 2015, code = 7900;
  const fromYear = HIST.year(y).filter((r) => r.cityCode === code);
  const fromLoc = HIST.rows({ code }, `${y}-01-01`, `${y}-12-31`);
  assert.equal(fromLoc.length, fromYear.length);
  const key = (r) => JSON.stringify(r);
  const set = new Set(fromYear.map(key));
  assert.ok(fromLoc.every((r) => set.has(key(r))), 'identical rows');
  assert.ok(fromLoc.every((r, i) => !i || fromLoc[i - 1].date >= r.date), 'newest first');
});

t('FOLD: a layer row and the register deal it repeats are one event (same unit / parcel, ±1 day, the amount equal · truncated · a share); a near miss is shown flagged, never counted', () => {
  const g = (o) => ({ id: 'gmh:' + (o.oid || 1), date: '2010-05-05', price: 1000000, areaSqm: 80, rooms: 3, block: 6393, parcel: 348, subParcel: 5, ...o });
  const r = (o) => ({ id: 'live:x', date: '2010-05-05', price: 1000000, areaSqm: 80, rooms: 3, block: 6393, parcel: 348, subParcel: 5, portion: null, ...o });
  let F = HIST.fold([g({})], [r({})]); assert.equal(F.folded.length, 1); assert.equal(F.shown.length, 0);
  F = HIST.fold([g({ price: 1000000, date: '2010-05-06' })], [r({ price: 1000400 })]); assert.equal(F.folded.length, 1, 'the layer\'s ₪1,000 truncation, one day apart');
  assert.ok(F.folded[0].differences.includes('amount:truncated'));
  F = HIST.fold([g({ price: 2000000 })], [r({ price: 1000000, portion: { fraction: 0.5 } })]); assert.equal(F.folded.length, 1, 'a share printed as the whole value');
  F = HIST.fold([g({ price: 1500000 })], [r({})]); assert.equal(F.folded.length, 0); assert.equal(F.shown[0].state, 'POSSIBLE_DUPLICATE', 'the same unit and day, another amount → flagged');
  F = HIST.fold([g({ date: '2010-05-09' })], [r({})]); assert.equal(F.folded.length, 0); assert.notEqual(F.shown[0].state, 'POSSIBLE_DUPLICATE', 'four days apart → its own event');
  F = HIST.fold([g({ oid: 1 }), g({ oid: 2 })], [r({})]); assert.equal(F.folded.length, 1, 'a register deal absorbs one row'); assert.equal(F.shown.length, 1);
});

t('SPAN: a page shows the register\'s rows in (L, C] and the layer\'s in (L+1, C+1]; L = the highest floor of the spellings still holding older rows; no more rows → the last page', () => {
  const rows = [{ date: '2010-05-05' }, { date: '2010-04-01' }];
  assert.deepEqual(HIST.span('2010-06-01', rows, false), { L: null, last: true, regTo: '2010-06-01', gmTo: '2010-06-02' });
  const s = HIST.span('2010-06-01', rows, true, ['2010-03-01', '2010-04-20']);
  assert.equal(s.L, '2010-04-20'); assert.equal(s.gmAbove, '2010-04-21'); assert.equal(s.last, false);
});

t('ALL = THE WHOLE HISTORY: every register deal of the locality is listed exactly once (all years), no event twice, dates never rise, and every GovMap history row is shown or folded into the register deal it repeats', async () => {
  const r = await pageAll({ city: D.localities.get(FAKE.code).he });
  assert.equal(r.error, null); assert.ok(r.end, 'paged to the end');
  assert.equal(r.dups, 0); assert.equal(r.rising, 0);
  const reg = r.ev.filter((e) => e.source === 'register' && !/^regx:/.test(e.id));
  assert.equal(reg.length, FAKE.rows.length, 'the register copy\'s every deal (its stored window + 3 and 6 years earlier)');
  assert.ok(reg.some((e) => e.date < '2021-01-01'), 'deals far older than the stored window');
  const hist = HIST.rows({ code: FAKE.code }, null, HIST.addDays(winFrom, -1)).length;
  const gmh = r.ev.filter((e) => /^gmh:/.test(e.id)).length;
  assert.equal(gmh + r.folded, hist, 'GovMap history rows: shown + folded = the locality\'s history rows');
  const oldest = r.ev.map((e) => e.date).sort()[0];
  assert.ok(oldest <= (H.localities[FAKE.code] || {}).earliest, 'reaches the oldest history row');
  assert.ok(r.ev.every((e) => e.geo && e.geo.match !== 'UNPLACED'), 'a locality never lists an unplaced event');
});

t('A REGISTER THAT DOES NOT ANSWER IS NEVER "NO OLDER DEALS": the history stops with an error and a retry cursor; the register\'s own "no settlement" is a real zero', async () => {
  FAKE.fail = true;
  try {
    /* (cursors no earlier read asked for: the service answers a repeated upstream call from its memory) */
    const b = await call({ city: D.localities.get(FAKE.code).he, all: '1', months: '240', limit: '200', older: '2015-01-01' });
    const sc = b.meta.sourceCoverage;
    assert.ok(sc.olderError, 'the error is reported'); assert.equal(sc.olderMore, true, 'and the history can be retried');
    assert.equal(sc.olderNext, '2015-01-01', 'the same page is asked again');
    assert.equal(b.transactions.length, 0, 'nothing shown as if the register held no older deal');
    const c = await call({ city: D.localities.get(FAKE.code).he, all: '1', months: '240', limit: '200', older: '2003-02-01g' });
    assert.ok(c.meta.sourceCoverage.olderError, JSON.stringify(c.meta.sourceCoverage)); assert.equal(c.meta.sourceCoverage.olderNext, '2003-02-01g', JSON.stringify(c.meta.sourceCoverage));
  } finally { FAKE.fail = false; }
  /* a locality the register's settlement list does not hold (Zanoah: only the GovMap layer's history): its rows, no error */
  const z = await pageAll({ city: D.localities.get(816).he });
  assert.equal(z.error, null); assert.ok(z.end);
  assert.equal(z.ev.filter((e) => /^gmh:/.test(e.id)).length + z.folded, H.localities[816].rows);
});

t('PAST THE REGISTER\'S OLDEST DEAL: the GovMap layer\'s rows continue in pages of whole days (a `g` cursor), never one unbounded answer', async () => {
  const b = await call({ city: D.localities.get(7900).he, all: '1', months: '240', limit: '200', older: '2004-12-31g' });
  const sc = b.meta.sourceCoverage;
  assert.ok(b.transactions.length <= 700, 'about 500 rows a page (whole days)');
  assert.ok(b.transactions.every((e) => e.date <= '2004-12-31'));
  assert.ok(b.transactions.every((e) => /^gmh:/.test(e.id)), 'the register shows nothing again past its oldest deal');
  if (sc.olderMore) { assert.match(sc.olderNext, /^\d{4}-\d{2}-\d{2}g$/); assert.ok(b.transactions.every((e) => e.date > sc.olderNext.slice(0, 10))); }
});

t('AREAS: Israel\'s list carries the UNPLACED events (never a locality, street or district); a district lists only its own localities', async () => {
  const il = await call({ area: 'il', all: '1', months: '240', limit: '200' });
  const un = il.transactions.filter((e) => e.geo && e.geo.match === 'UNPLACED');
  assert.ok(un.length > 0, 'unplaced events in Israel\'s first page');
  for (const e of un) { assert.equal(e.cityCode, null); assert.equal(e.inStatistics, false); assert.equal(e.pricePerSqm, null); assert.ok(e.notes.includes('LOCALITY_NOT_RESOLVED')); }
  const dh = await call({ area: 'd-haifa', all: '1', months: '240', limit: '200' });
  assert.ok(dh.transactions.length > 0);
  for (const e of dh.transactions) { assert.notEqual(e.geo.match, 'UNPLACED'); if (e.cityCode != null) assert.equal(D.localities.get(e.cityCode).district, 'd-haifa'); }
});

t('PERIODS: 30 / 90 days and 6 / 12 / 24 months list only events inside the period, the count is the stored union\'s — no substitution, no fallback', async () => {
  for (const q of [{ days: 30 }, { days: 90 }, { months: 6 }, { months: 12 }, { months: 24 }]) {
    for (const [p, code, sid] of [[{ city: D.localities.get(FAKE.code).he }, FAKE.code, null], [{ city: D.localities.get(7900).he, street: 'שחם', sid: 'st:7900:156' }, 7900, 'st:7900:156']]) {
      const b = await call({ ...p, ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])), limit: '200' });
      const P = TX.periodOf({ days: q.days, months: q.months, today });
      assert.ok(b.transactions.every((e) => e.date > P.from && e.date <= P.to), JSON.stringify(q) + ' inside the period');
      const U0 = TX.query({ code, streetId: sid || undefined, days: q.days, months: q.days ? null : q.months, today, unlimited: true });
      assert.equal(b.meta.sourceCoverage.total, U0.total, JSON.stringify(q) + ' the stored union\'s count');
    }
  }
});

t('UNPLACED TRANSACTION EVENTS: every unplaced row of the window and of the history is listed (state · basis · candidates kept), none is attributed, none is priced', () => {
  const nm = readJson(path.join(T, 'national', 'meta.json'));
  const { rows } = U.load();
  assert.equal(rows.length, (nm.unplaced || 0) + (H.unplaced || 0));
  const ev = U.events({});
  assert.equal(ev.length, rows.filter((r) => r.date).length);
  for (const e of ev.slice(0, 2000)) {
    assert.equal(e.cityCode, null); assert.equal(e.geo.match, 'UNPLACED'); assert.equal(e.inStatistics, false); assert.equal(e.priced, false);
    assert.ok(['POSSIBLE_LOCATION', 'UNPLACED'].includes(e.unplaced.state));
    if (e.unplaced.state === 'POSSIBLE_LOCATION') assert.ok(e.geo.candidates.length >= 1, 'a POSSIBLE LOCATION lists its candidates');
  }
  assert.ok(ev.every((e) => e.date <= nm.version.detectedAt.slice(0, 10)), 'no future-dated row is an event (INVALID rows stay in the evidence)');
});

t('THE FULL UNIVERSE: every row of the GovMap file in one bucket (history + window + invalid = the file), every bucket reachable — DEFENSIBLE KNOWN SOURCE EVENTS NOT SURFACED = 0', () => {
  const A = readJson(path.join(T, 'completeness-audit.json'));
  assert.ok(A, 'data/txevents/completeness-audit.json');
  assert.equal(A.universe.govmap.partition.equal, true);
  assert.equal(A.universe.govmap.partition.sum, A.universe.govmap.file.rowsTotal);
  const B = A.buckets.govmapAll;
  assert.equal(Object.values(B).reduce((a, b) => a + b, 0), A.universe.govmap.file.rowsTotal, 'every row in exactly one bucket');
  assert.ok(!Object.keys(B).some((k) => /^UNEXPLAINED/.test(k)), 'no unexplained class');
  assert.equal(A.defensibleKnownSourceEventsNotSurfaced, 0);
  for (const c of A.reachability.checks) assert.equal(c.notReachable, 0, c.id);
  assert.equal(A.universe.register.storedWindow.equal, true, 'every stored register deal is an event');
});

t('LATEST MEANS LATEST: Israel, every district, every locality whose stored union holds an event, every street — the newest event the sources hold is the first the user sees', () => {
  const A = readJson(path.join(T, 'completeness-audit.json'));
  assert.equal(A.latest.israel.match, true, JSON.stringify(A.latest.israel));
  for (const d of A.latest.districts) assert.equal(d.match, true, JSON.stringify(d));
  const bad = A.latest.localities.mismatches.filter((x) => x.reason !== 'LIVE_CHECK_PENDING');
  assert.deepEqual(bad, [], 'locality mismatches');
  assert.equal(A.latest.streets.mismatch, 0, JSON.stringify(A.latest.streets.mismatches.slice(0, 3)));
});

t('REGRESSION CASES: Shaham, Tel Aviv, Jerusalem, Haifa, a small locality, an alias-heavy street, a parcel-recovered street, a locality where the recent source is newer than the register and one where it is not — LATEST SOURCE EVENT = LATEST USER-VISIBLE EVENT', () => {
  const S = TX.stores();
  const nc = S.national.columns, RL = require('../lib/recent/read').load(), rc = RL.layer.columns;
  const POSSIBLE = new Set(['POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER']);
  const visible = (q) => TX.query({ ...q, all: true, unlimited: true, today }).events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE').map((e) => e.date).sort().pop() || null;
  const sourceOfLocality = (code) => {
    const reg = EV.shardOf(code) ? EV.dealsOf(EV.shardOf(code)).map((x) => x.deal.date).sort().pop() : null;
    const gm = [...S.national.rows.filter((r) => r[nc.indexOf('cityCode')] === code && !POSSIBLE.has(r[nc.indexOf('class')])).map((r) => r[nc.indexOf('date')]),
      ...RL.layer.rows.filter((r) => r[rc.indexOf('cityCode')] === code && !(r[rc.indexOf('reasons')] || []).includes('possible-duplicate-of-register-deal')).map((r) => r[rc.indexOf('date')])].sort().pop() || null;
    return { reg, gm, latest: [reg, gm].filter(Boolean).sort().pop() };
  };
  const cases = { telAviv: 5000, jerusalem: 3000, haifa: 4000, small: 33, recentNotNewer: 7100 };
  for (const [k, code] of Object.entries(cases)) { const s = sourceOfLocality(code); assert.equal(visible({ code }), s.latest, k + ' ' + JSON.stringify(s)); }
  const ta = sourceOfLocality(5000); assert.ok(ta.gm > ta.reg, 'Tel Aviv: the recent source is newer than the register — and shown');
  const ash = sourceOfLocality(7100); assert.ok(ash.reg >= ash.gm, 'Ashkelon: the register is the newest source');
  const A = readJson(path.join(T, 'completeness-audit.json'));
  const mis = new Set((A.latest.streets.mismatches || []).map((x) => x.street));
  for (const sid of ['st:7900:156', 'st:4000:1145', 'st:8300:842']) {
    assert.ok(!mis.has(sid), sid + ' latest parity');
    assert.ok(visible({ streetId: sid }), sid + ' has events');
  }
  const viaParcel = TX.query({ streetId: 'st:8300:842', all: true, unlimited: true, today }).events.filter((e) => /VIA_PARCEL/.test(e.geo.match)).length;
  assert.ok(viaParcel >= 50, 'the parcel-recovered street lists its recovered deals (' + viaParcel + ')');
  const alias = EV.dealsOf(EV.shardOf(4000)).filter((x) => x.streets.some((s) => s.code === 1145 && s.via === 'official-synonym')).length;
  assert.ok(alias >= 40, 'the alias-heavy street is reached through official synonyms (' + alias + ')');
});

t('THE PAGE: ALL sends all=1; the Trust Center shows the full universe, the not-surfaced count, the latest-date parity and the UNPLACED list; the history label', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /function txcUniverseHTML\(t\)/);
  assert.match(page, /data-txc-not-surfaced="\$\{A\.notSurfaced\}"/);
  assert.match(page, /view=txUnplaced&limit=100&offset=/);
  assert.match(page, /UNPLACED:"UNPLACED TRANSACTION EVENT — not attributed to a locality, street or district"/);
  assert.match(page, /if\(!txState.days&&txState.months>=240\)p.set\("all","1"\)/);
  const intel = fs.readFileSync(path.join(ROOT, 'api', 'intel.js'), 'utf8');
  assert.match(intel, /if \(view === 'txUnplaced'\)/);
});

(async () => {
  let passed = 0, failed = 0;
  for (const [name, fn] of results) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); }
  }
  console.log(`txevents-closure: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
