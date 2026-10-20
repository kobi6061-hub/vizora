// PROPX · TRANSACTION EVENTS — the hard gates of the freshest-transactions P0 (20.10.2026).
// Offline: node test/txevents.test.js
//
//   1  FRESHEST KNOWN EVENT MUST BE VISIBLE                 8  30-DAY FILTER MUST NOT SHOW TRANSACTIONS OUTSIDE 30 DAYS
//   2  RECENT EVENT MUST NOT BE HIDDEN BECAUSE PRICE IS LIMITED   9  EMPTY 30-DAY RESULT MUST NOT FALL BACK TO OLD DEALS
//   3  SOURCE DIFFERENCE MUST NOT HIDE A DEAL               10 STALE SOURCE MUST NOT BE PRESENTED AS CURRENT
//   4  STREET SPELLING DIFFERENCE MUST NOT HIDE A DEAL      11 UNSAFE PRICE MUST NOT ENTER PRICE STATISTICS
//   5  PARCEL MATCH MAY RECOVER A DEAL WHEN STREET STRING FAILS   12 UNKNOWN SHARE MUST NOT REMOVE THE TRANSACTION EVENT
//   6  ONE REAL DEAL IN TWO SOURCES MUST APPEAR ONCE        13 SOURCE CONFLICT MUST NOT SILENTLY DELETE THE EVENT
//   7  NEWER TRANSACTION MUST SORT ABOVE OLDER TRANSACTION  14 NO UNEXPLAINED SOURCE ROWS
// + the screenshot regression case (Petah Tikva / Shaham), the API's unified read, the page, and the Street Value Model untouched.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TX = require('../lib/txevents');
const EV = require('../lib/streets/evidence');
const RECENT = require('../lib/recent/read');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); } };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const TODAY = '2026-10-20';
const SHAHAM = 'st:7900:156';
const S = TX.stores();
const L = RECENT.load();
const layerRows = L.layer ? L.layer.rows.map((r) => Object.fromEntries(L.layer.columns.map((c, i) => [c, r[i]]))) : [];
const sortedDesc = (evs) => evs.every((e, i) => i === 0 || (evs[i - 1].date || '') >= (e.date || ''));
const ALL = (q) => TX.query({ ...q, all: true, unlimited: true, today: TODAY });
const codes = [...new Set([...Object.keys((L.layer || {}).byCode || {}), ...Object.keys(((S.national || {}).byCode) || {})].map(Number))].filter((c) => EV.shardOf(c));

t('REGRESSION · Petah Tikva / Shaham: the newest event PROPX can find is the newest shown, first (BEFORE: 05.07.2026 from the register\'s live search alone)', () => {
  const q = TX.query({ city: 'פתח תקווה', street: 'שחם', months: 24, today: TODAY, limit: 20 });
  assert.equal(q.scope.streetId, SHAHAM);
  const all = ALL({ streetId: SHAHAM });
  const newest = all.events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE')[0];
  assert.ok(newest && newest.date >= '2026-08-30', 'the GovMap-layer copy holds 30.08.2026 on Shaham');
  assert.equal(q.events[0].date, newest.date, 'the first row shown is the newest known event');
  assert.equal(q.recency.latestKnownEvent.date, newest.date);
  assert.ok(q.events[0].date > '2026-07-05', 'newer than everything the old section showed');
  const before = readJson('lib/trust/discovery/2026-10-20-transaction-sources.json').regressionCase.before;
  assert.equal(before.m24.newest, '2026-07-05');
});

t('1 · FRESHEST KNOWN EVENT MUST BE VISIBLE — for every locality with a GovMap-layer row, the first row of ALL is the latest known event; the recency summary is the union\'s, not the register\'s', () => {
  let n = 0;
  for (const code of codes.slice(0, 120)) {
    const q = TX.query({ code, all: true, limit: 5, today: TODAY });
    const counted = q.events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
    if (!counted.length) continue;
    assert.equal(q.recency.latestKnownEvent.date, counted[0].date, `locality ${code}`);
    assert.ok(q.recency.evidenceCheckedThrough >= (EV.store().meta.source.lastDeal), 'checked through ≥ the register\'s latest deal');
    n++;
  }
  assert.ok(n >= 50, `${n} localities checked`);
  const c = readJson('data/txevents/completeness.json');
  assert.ok(c.latestEvent > EV.store().meta.source.lastDeal, `the national latest event (${c.latestEvent}) is newer than the register copy's latest deal`);
});

t('2 / 12 · RECENT EVENT MUST NOT BE HIDDEN BECAUSE PRICE IS LIMITED · UNKNOWN SHARE MUST NOT REMOVE THE EVENT — every GovMap-layer row the register copy does not hold is an event of its locality (and of its street when it has one)', () => {
  let miss = 0, checked = 0;
  for (const code of codes) {
    const ids = new Set(TX.govmapEvents(code, S).map((e) => e.id));
    for (const r of layerRows.filter((x) => x.cityCode === code)) { checked++; if (!ids.has(`gm:${r.dealId || 'o' + r.oid}`)) miss++; }
    if (S.national) { const cols = S.national.columns; for (const i of S.national.byCode[String(code)] || []) { const r = Object.fromEntries(cols.map((c, k) => [c, S.national.rows[i][k]])); checked++; if (!ids.has(`gm:${r.dealId || 'o' + r.oid}`)) miss++; } }
  }
  assert.equal(miss, 0, `${miss} of ${checked} rows missing`);
  assert.ok(checked >= layerRows.length, `${checked} rows checked`);
  /* street level: a sample of streets, every layer row on the street is in the street's ALL */
  const streets = [...new Set(layerRows.filter((r) => r.streetCode != null).map((r) => `st:${r.cityCode}:${r.streetCode}`))].slice(0, 150);
  for (const id of streets) {
    const got = new Set(ALL({ streetId: id }).events.map((e) => e.id));
    for (const r of layerRows.filter((x) => `st:${x.cityCode}:${x.streetCode}` === id)) assert.ok(got.has(`gm:${r.dealId}`), `${r.dealId} on ${id}`);
  }
  /* the limited state keeps the event visible: LIMITED rows exist and none has a usable price */
  const lim = TX.govmapEvents(7900, S).filter((e) => e.state === 'LIMITED_SHARE_NOT_STATED');
  assert.ok(lim.length > 0);
});

t('3 · SOURCE DIFFERENCE MUST NOT HIDE A DEAL — a register deal the republisher\'s live search places on the street (but PROPX\'s crosswalk does not) is added once, flagged', () => {
  const scope = TX.resolveScope({ streetId: SHAHAM });
  const sh = EV.shardOf(7900);
  const other = TX.registerEvents(sh, S).find((e) => e.kind === 'DWELLING' && !(e.streets || []).some((s) => s.code === 156) && (e.streets || []).length && e.date >= '2025-01-01');
  const live = { date: other.date, price: other.price, block: other.block, parcel: other.parcel, subParcel: other.subParcel, cityCode: 7900, city: 'פתח תקווה', street: 'שחם', houseNumber: '44', dealType: other.dealType, propertyClass: 'residential' };
  const extra = TX.liveEvents([live, live], scope, 'street');
  assert.equal(extra.length, 1, 'once, even when the live search repeats it');
  assert.equal(extra[0].geo.match, 'STREET_REPUBLISHER_LINK');
  assert.equal(extra[0].inStatistics, false);
  const q = TX.query({ streetId: SHAHAM, all: true, unlimited: true, today: TODAY, extraEvents: extra });
  assert.ok(q.events.some((e) => e.key === other.key && e.geo.match === 'STREET_REPUBLISHER_LINK'));
  /* a live row already placed in the scope adds nothing; a live answer from a wider rung adds nothing */
  const placed = q.events.find((e) => e.source === 'register' && e.geo.match === 'STREET');
  assert.equal(TX.liveEvents([{ date: placed.date, price: placed.price, block: placed.block, parcel: placed.parcel, subParcel: placed.subParcel, cityCode: 7900 }], scope, 'street').length, 0);
  assert.equal(TX.liveEvents([live], scope, 'locality').length, 0);
});

t('4 · STREET SPELLING DIFFERENCE MUST NOT HIDE A DEAL — spelling / type-word variants resolve to the one official street; a published address in another spelling is shown as a POSSIBLE match', () => {
  for (const s of ['שחם', 'רחוב שחם', 'רח׳ שחם', 'רח\' שחם', ' שחם ']) assert.equal(TX.resolveScope({ city: 'פתח תקווה', street: s }).streetId, SHAHAM, s);
  assert.equal(TX.resolveScope({ city: 'פתח-תקווה', street: 'שחם' }).streetId, SHAHAM, 'a locality spelling');
  const e = { source: 'govmap', sourceId: 'over:govmap-recent', cityCode: 7900, streetCode: null, street: 'רחוב שחם', houseNumber: '31', block: '6393', parcel: '348', date: '2026-08-30' };
  const pl = TX.placeEvent(e, TX.resolveScope({ streetId: SHAHAM }), S);
  assert.ok(pl && /STREET/.test(pl.match), 'placed on the street');
});

t('5 · PARCEL MATCH MAY RECOVER A DEAL WHEN STREET STRING FAILS — register deals on Shaham\'s new parcels (no address in the register\'s crosswalk) reach the street through the GovMap layer\'s address of the same parcel, never in its statistics', () => {
  const q = ALL({ streetId: SHAHAM });
  const rec = q.events.filter((e) => e.source === 'register' && /VIA_PARCEL/.test(e.geo.match));
  assert.ok(rec.length >= 100, `${rec.length} recovered`);
  assert.ok(rec.some((e) => e.block === '6393' && e.parcel === '348'));
  assert.ok(rec.every((e) => !e.inStatistics && e.street === 'שחם'), 'shown on the street, never priced in its statistics');
  const nm = readJson('data/txevents/national/meta.json');
  assert.ok(nm.parcelRecovery.recovered > 1000, `${nm.parcelRecovery.recovered} parcels recovered nationally`);
});

t('6 · ONE REAL DEAL IN TWO SOURCES MUST APPEAR ONCE — a GovMap row the register holds is the register event\'s evidence, never a second row; ids are unique', () => {
  const links = readJson('data/txevents/links.json');
  const linkedOids = new Set(Object.values(links.byKey).flat().filter((x) => x[5] === 'IN_REGISTER' || x[5] === 'IN_REGISTER_OTHER_UNIT').map((x) => x[1]));
  for (const code of codes.slice(0, 80)) {
    const evs = TX.govmapEvents(code, S);
    for (const e of evs) assert.ok(!linkedOids.has(e.oid), `GovMap row ${e.oid} is a register deal`);
  }
  const q = ALL({ code: 7900 });
  assert.equal(new Set(q.events.map((e) => e.id)).size, q.events.length, 'unique ids');
  const withEvidence = q.events.filter((e) => e.evidence && e.evidence.length);
  assert.ok(withEvidence.length > 0, 'register events list their GovMap representation');
});

t('7 · NEWER TRANSACTION MUST SORT ABOVE OLDER TRANSACTION — every scope, every period', () => {
  for (const q of [{ streetId: SHAHAM, months: 24 }, { code: 5000, days: 90 }, { code: 3000, months: 6 }, { code: 7900, all: true }, { code: 70, months: 12 }]) {
    const r = TX.query({ ...q, today: TODAY, limit: 500 });
    assert.ok(sortedDesc(r.events), JSON.stringify(q));
  }
});

t('8 · 30-DAY FILTER MUST NOT SHOW TRANSACTIONS OUTSIDE 30 DAYS (and 90 days / 6 months alike)', () => {
  for (const [q, days] of [[{ code: 6100, days: 30, today: '2026-10-08' }, 30], [{ code: 7100, days: 30, today: '2026-09-25' }, 30], [{ code: 7900, days: 90, today: TODAY }, 90], [{ code: 3000, months: 6, today: TODAY }, 183]]) {
    const r = TX.query({ ...q, unlimited: true });
    const from = new Date(Date.parse(q.today + 'T00:00:00Z') - days * 864e5).toISOString().slice(0, 10);
    assert.ok(r.events.length > 0, JSON.stringify(q));
    assert.ok(r.events.every((e) => e.date > from && e.date <= q.today), JSON.stringify(q));
  }
});

t('9 · EMPTY 30-DAY RESULT MUST NOT FALL BACK TO OLD DEALS — no rows, and the statement says why (not "no deals")', () => {
  const r = TX.query({ streetId: SHAHAM, days: 30, today: TODAY });
  assert.equal(r.events.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.statement.kind, 'COVERAGE_INCOMPLETE', 'the evidence reaches 28.09: 8 of 30 days');
  assert.deepEqual(r.statement.text, TX.STATEMENT_TEXT.COVERAGE_INCOMPLETE);
  assert.ok(r.statement.uncoveredTail && r.statement.uncoveredTail.from === '2026-09-29');
});

t('10 · STALE SOURCE MUST NOT BE PRESENTED AS CURRENT — "no recorded transactions" only when the freshest copy is current and covers the period', () => {
  /* in the copy's own time (08.10, RECENT) a covered quiet period may say NONE; months later the same zero is never NONE */
  const quiet = codes.find((c) => TX.query({ code: c, days: 30, today: '2026-09-30', limit: 1 }).total === 0) || null;
  if (quiet != null) {
    const later = TX.query({ code: quiet, days: 30, today: '2027-02-01' });
    assert.notEqual(later.statement.kind, 'NONE_IN_PERIOD');
  }
  const r = TX.query({ streetId: SHAHAM, days: 90, today: '2027-03-01' });
  assert.equal(r.events.length, 0);
  assert.notEqual(r.statement.kind, 'NONE_IN_PERIOD');
  const cov = TX.coverageOf(7900, S, '2027-03-01');
  assert.ok(cov.every((c) => c.state !== 'CURRENT' && c.state !== 'RECENT'), 'a copy months old is not current');
  /* the statement table: NONE needs CURRENT / RECENT + ≥ half the period covered */
  const fake = (state, through) => TX.statementOf(0, { days: 30, from: '2026-09-01', to: '2026-10-01' }, { evidenceCheckedThrough: through, state }, [{ id: 'over:deals-register', read: true }], { resolved: true });
  assert.equal(fake('CURRENT', '2026-09-30').kind, 'NONE_IN_PERIOD');
  assert.equal(fake('STALE', '2026-09-30').kind, 'NOT_IN_AVAILABLE_COVERAGE');
  assert.equal(fake('CURRENT', '2026-09-05').kind, 'COVERAGE_INCOMPLETE');
});

t('11 · UNSAFE PRICE MUST NOT ENTER PRICE STATISTICS — only a register whole-dwelling deal, priced, placed with certainty; no GovMap price, no ₪/m² from it; the page medians read only those rows', () => {
  for (const q of [ALL({ streetId: SHAHAM }), ALL({ code: 7900 }), ALL({ code: 5000 })]) {
    for (const e of q.events) {
      if (e.inStatistics) {
        assert.equal(e.source, 'register'); assert.equal(e.kind, 'DWELLING'); assert.equal(e.priced, true); assert.equal(e.geo.certain, true);
        assert.equal(e.partialSale, false); assert.ok(e.price >= EV.MIN_MARKET);
      }
      if (e.source === 'govmap') { assert.equal(e.inStatistics, false); const w = TX.wire(e); assert.equal(w.pricePerSqm, null); assert.equal(w.psmShown, false); }
    }
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('const pricedU=uniM?priced.filter(r=>r.inStatistics):priced;') && html.includes('const prices=pricedU.map(r=>r.price)'), 'the section\'s medians read only rows PRICED IN STATISTICS');
  assert.ok(html.includes('if(t.psmShown===false)return null'), 'no ₪/m² from an unused price');
});

t('13 · SOURCE CONFLICT MUST NOT SILENTLY DELETE THE EVENT — a contradicted deal stays, marked, with both values kept', () => {
  const q = ALL({ code: 7900 });
  const reg = q.events.filter((e) => e.source === 'register' && e.conflict);
  assert.ok(reg.length > 0, 'register events with a SOURCE CONFLICT are shown');
  assert.ok(reg.every((e) => e.evidence.length && e.conflictFields.length));
  const anyConflict = codes.flatMap((c) => TX.govmapEvents(c, S)).filter((e) => e.state === 'CONFLICT');
  const layerConflicts = layerRows.filter((r) => r.state === 'RECENT_CONFLICT' && !(r.reasons || []).includes('possible-duplicate-of-register-deal')).length;
  assert.equal(anyConflict.length, layerConflicts, 'every RECENT_CONFLICT row is an event marked CONFLICT');
});

t('14 · NO UNEXPLAINED SOURCE ROWS — every row of both snapshots has one reconciliation state; the accounting adds up exactly', () => {
  const c = readJson('data/txevents/completeness.json');
  assert.equal(c.notSurfaced.unexplained, 0);
  const a = c.recentAccounting;
  assert.equal(Object.values(a.buckets).reduce((x, y) => x + y, 0), a.rows, 'recent window: buckets = rows');
  assert.ok(!a.buckets.UNEXPLAINED);
  assert.equal(a.proofs.recentNewInLayer.equal, true);
  assert.equal(a.proofs.duplicatesWhoseRegisterDealIsMissing, 0);
  const nm = readJson('data/txevents/national/meta.json');
  const sum = Object.values(nm.classes).reduce((x, o) => x + Object.values(o).reduce((p, q) => p + q, 0), 0);
  assert.equal(sum, nm.reconciledRows, 'national: classes = rows');
  assert.equal(nm.validation.pass, true);
  const known = new Set(['RECENT_NEW', 'IN_REGISTER', 'IN_REGISTER_OTHER_UNIT', 'DUPLICATE_IN_SOURCE', 'POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER', 'NO_SETTLEMENT', 'UNMAPPED_SETTLEMENT', 'FUTURE_DATED', 'CONTEXT_BEFORE_WINDOW']);
  for (const o of Object.values(nm.classes)) for (const k of Object.keys(o)) assert.ok(known.has(k), k);
  /* the national shown rows: every register-window RECENT_NEW is in govmap-only.json */
  const g = readJson('data/txevents/national/govmap-only.json');
  assert.equal(g.rows.filter((x) => x[24] === 'RECENT_NEW' && x[23] !== 'recovery').length, nm.classes['register-window'].RECENT_NEW);
  /* the recent overlap of the national file reproduces the recent layer exactly */
  assert.equal((nm.classes['recent-overlap'].RECENT_NEW || 0) + ((nm.classes['after-register'] || {}).RECENT_NEW || 0), layerRows.length);
});

(async () => {
  const h = require('../api/gov/transactions');
  const call = (q) => new Promise((ok) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { ok({ status: this.statusCode, body: b }); } }; h({ method: 'GET', url: '/api/gov/transactions?' + new URLSearchParams(q) }, res); });
  const prev = process.env.GOV_OVER_DISABLED; process.env.GOV_OVER_DISABLED = '1';
  try {
    const r = await call({ city: 'פתח תקווה', street: 'שחם', months: '24', limit: '10' });
    const d = JSON.parse(r.body);
    t('API · unified: newest first, the union\'s recency, a state and a source on every row', () => {
      assert.equal(d.meta.unified, true);
      assert.equal(d.scope.streetId, SHAHAM);
      assert.ok(d.transactions[0].date >= '2026-08-30');
      assert.ok(sortedDesc(d.transactions));
      assert.ok(d.transactions.every((x) => x.state && x.sourceId && x.snapshotDate));
      assert.equal(d.meta.latestTransactionDate, d.meta.recency.latestKnownEvent.date);
      assert.ok(d.meta.coverage.some((c) => c.id === 'over:govmap-recent' && c.read));
    });
    const e = JSON.parse((await call({ city: 'פתח תקווה', street: 'שחם', days: '30', limit: '10' })).body);
    t('API · an empty 30 days returns no rows and the statement', () => { assert.equal(e.transactions.length, 0); assert.equal(e.meta.statement.kind, 'COVERAGE_INCOMPLETE'); });
  } finally { if (prev == null) delete process.env.GOV_OVER_DISABLED; else process.env.GOV_OVER_DISABLED = prev; }

  const hi = require('../api/intel');
  const callI = (q) => new Promise((ok) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { ok({ status: this.statusCode, body: b }); } }; hi({ method: 'GET', url: '/api/intel?' + new URLSearchParams(q) }, res); });
  const area = JSON.parse((await callI({ view: 'txLatest', district: 'd-ta', months: '24', limit: '50' })).body);
  const area30 = JSON.parse((await callI({ view: 'txLatest', district: 'd-south', days: '30', limit: '50' })).body);
  t('API · a district / the country: newest first from every source, the period\'s exact count from the per-day tally, the statement by the same rule', () => {
    assert.equal(area.available, true);
    assert.ok(sortedDesc(area.district.top), 'newest first');
    assert.equal(area.district.top[0].date, area.district.latest, 'the first row is the district\'s latest event');
    const n = Object.entries(area.perDay).reduce((a, [k, v]) => a + (TX.inPeriod(k, area.period) ? v : 0), 0);
    assert.equal(area.statement.n, n);
    assert.equal(area.statement.kind, n ? 'EVENTS' : area.statement.kind);
    for (const x of [area, area30]) {
      assert.equal(x.statement.kind === 'EVENTS', x.statement.n > 0, 'EVENTS only with events');
      if (!x.statement.n) assert.deepEqual(x.statement.text, TX.STATEMENT_TEXT[x.statement.kind]);
    }
    /* every locality any source holds is in the area index — also those only the GovMap layer reaches (no register sweep) */
    const LI = readJson('data/txevents/latest.json');
    const gmCodes = new Set([...Object.keys(L.layer.byCode), ...Object.keys(S.national.byCode)].map(Number).filter((c) => c > 0));
    for (const c of gmCodes) assert.ok(LI.localities[c], 'locality ' + c + ' is in the area index');
    assert.ok(Object.keys(LI.localities).some((c) => !EV.shardOf(Number(c))), 'GovMap-only localities are counted');
    assert.equal(LI.national.events, Object.values(LI.districts).reduce((a, d) => a + d.events, 0), 'the country = the sum of its districts');
    assert.equal(LI.national.events, Object.values(LI.localities).reduce((a, x) => a + x.events, 0));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.includes('async function txFetchArea') && html.includes('inStatistics:false,geo:{match:"LOCALITY"}'), 'an area\'s newest rows are a list, never priced as the area');
  });

  t('PAGE · one chronological table: recency summary, statements, a state chip + source on every row, the price marker, paging over the union', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const k of ['function txRecencyHTML', 'function txStatementHTML', 'LATEST KNOWN TRANSACTION', 'RECENT TRANSACTION SOURCES CHECKED', 'FRESHEST SOURCE SNAPSHOT', 'PRIMARY REGISTER SNAPSHOT',
      'PRICE NOT USED IN MARKET STATISTICS', '0 RECORDED TRANSACTION EVENTS', 'data-txe-row', 'cv.kind==="unified"', 'txState.olderMore', 'propertyClass==="type-not-stated"'])
      assert.ok(html.includes(k), k);
    assert.ok(html.includes('PROPX combines multiple transaction sources') || html.includes('ldE(state.lang==="en"?R.note:R.noteHe)'));
  });

  t('THE STREET VALUE MODEL IS UNTOUCHED — no model or street-statistics module reads the event layer', () => {
    for (const f of ['lib/streets/evidence.js', 'lib/streets/value-model.js', 'lib/streets/value-validate.js', 'lib/streets/value-read.js', 'scripts/street-model-build.js', 'lib/streets/model-deps.js'])
      assert.ok(!/txevents/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
    const MD = require('../lib/streets/model-deps');
    assert.equal(MD.check().stale, false, 'the model is not stale');
  });

  console.log(`txevents: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
