// PROPX · STREET INVESTMENT INTELLIGENCE gates (21.10.2026): the street report is a COMPOSITION — it never re-labels, re-thresholds or
// re-counts what Street Intelligence, the transaction events, the Street Value Model or the benchmarks say; a neighbourhood is VERIFIED only
// through a verified street link, a source's printed name is a SOURCE LABEL; a spatial relation is context (never a join, never a value);
// a statutory transit plan is never an operating line; the assessment carries no score / probability / recommendation; the property
// assessment computes no scenario the user did not enter. Real committed data; eight live acceptance streets.
//   NEIGHBOURHOOD SOURCE LABEL ≠ VERIFIED · PLAN NEARBY ≠ PLAN ON THE STREET · APPROVED PLAN ≠ OPERATING LINE · CITY FIGURE ≠ STREET FIGURE ·
//   POSSIBLE MATCH ≠ RELIABLE MATCH · SURROUNDING AREA ≠ THIS STREET · USER ASSUMPTION ≠ FORECAST

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const R = require('../lib/streets/report');
const B = require('../lib/streets/benchmarks');
const EV = require('../lib/streets/evidence');
const ST = require('../lib/streets/street');
const SD = require('../lib/streets/directory');
const TX = require('../lib/txevents');
const SVM = require('../lib/streets/value-read');
const { topicOf } = require('../lib/planning/topic');
const GR = require('../lib/geo/registry');

let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);

/* the live acceptance set (§8): resolved from the official directory, never by a name */
const ACCEPT = {
  untermann: 'st:7900:546',      // הרב אונטרמן, פתח תקווה — searched as "הרב אונטרמן משה פתח תקווה"
  auerbach: 'st:7900:595',       // הרב אויערבך משה, פתח תקווה — searched as "הרב ד"ר משה אויערבך פתח תקווה"
  shaham: 'st:7900:156',         // שחם, פתח תקווה
  dizengoff: 'st:5000:404',      // דיזנגוף, תל אביב-יפו (verified neighbourhood · Tel Aviv permits)
  herzlHaifa: 'st:4000:856',     // הרצל, חיפה
  weak: 'st:6600:211',           // דובנוב, חולון — one observed deal, no model estimate
  unresolved: 'st:7900:360',     // דרך יצחק רבין, פתח תקווה — no verified link, no source label
};
const REP = {};
const rep = (id) => REP[id] || (REP[id] = R.report(id));

t('acceptance: every live street resolves to its official id and reports every section (or says why not)', () => {
  for (const [k, id] of Object.entries(ACCEPT)) {
    const r = rep(id);
    assert.ok(r && r.id === id, k);
    for (const sec of ['identity', 'hierarchy', 'overview', 'transactions', 'comparison', 'planning', 'map', 'assessment', 'sources', 'missing']) assert.ok(r[sec] != null, `${k}.${sec}`);
    assert.ok(r.planning.available || r.planning.reason, k + ' planning states why');
    assert.ok(r.map.available || r.map.reason, k + ' map states why');
    assert.ok(r.timings && r.timings.totalMs >= 0, k + ' timings');
  }
});

t('search: the directive\'s spellings reach the official streets — a synonym (tier 2) and a name plus a given name (discovery, tier 6); exact ranks unchanged', () => {
  const m = (q) => GR.searchGeo(q, 12).matches.filter((x) => x.kind === 'street');
  const a = m('הרב ד"ר משה אויערבך פתח תקווה'); assert.equal(a[0].id, ACCEPT.auerbach); assert.equal(a[0].via, 'synonym');
  const u = m('הרב אונטרמן משה פתח תקווה'); assert.equal(u[0].id, ACCEPT.untermann); assert.equal(u[0].tier, 6, 'the added-words rung is discovery, never above another rung');
  const h = m('הרצל פתח תקווה'); assert.equal(h[0].tier, 1);
  const n = m('הרצל 5 פתח תקווה'); assert.equal(n[0].id, h[0].id, 'a house number never picks a street');
  assert.equal(m('הרב אונטרמן 12 15 פתח תקווה').filter((x) => x.tier === 6 && x.id === ACCEPT.untermann && /\d/.test(x.matchedName || '')).length, 0);
});

t('COMPOSITION: identity, evidence statistics, model and counts are the read models\' own — never re-labelled or re-thresholded', () => {
  for (const id of Object.values(ACCEPT)) {
    const r = rep(id), s = ST.street(id, { limit: 1 });
    assert.deepEqual(r.identity, s.identity);
    if (s.evidence && s.evidence.stats) {
      assert.equal(r.overview.stats.state, s.evidence.stats.state); assert.equal(r.overview.stats.priced, s.evidence.stats.priced);
      assert.equal(r.overview.stats.medianPricePerSqm, s.evidence.stats.medianPricePerSqm);
    }
    const e = SVM.estimate(id);
    if (e && e.available && e.value != null) { assert.equal(r.overview.model.value, e.value); assert.equal(r.overview.model.tier, e.tier); }
    else assert.ok(r.overview.model.available === false || r.overview.model.value == null);
    assert.deepEqual(r.overview.counts, s.transactionCounts);
  }
});

t('NEIGHBOURHOOD: VERIFIED only through a verified street link; a printed name is a SOURCE LABEL with its share; neither → UNRESOLVED with the reason', () => {
  const d = rep(ACCEPT.dizengoff).hierarchy.neighbourhood;
  assert.equal(d.state, 'VERIFIED'); assert.ok(d.verified && d.verified.method === 'verified-street-link');
  const u = rep(ACCEPT.untermann).hierarchy.neighbourhood;
  assert.equal(u.state, 'SOURCE_LABEL'); assert.equal(u.verified, null); assert.equal(u.sourceLabel.cls, 'SOURCE LABEL'); assert.ok(u.sourceLabel.sharePct >= 80);
  const sh = rep(ACCEPT.shaham).hierarchy.neighbourhood;
  assert.equal(sh.state, 'SOURCE_LABEL_MIXED', 'two printed names, none ≥ 80 %');
  const x = rep(ACCEPT.unresolved).hierarchy.neighbourhood;
  assert.equal(x.state, 'UNRESOLVED'); assert.match(x.reason, /never infers/);
  for (const id of Object.values(ACCEPT)) { const n = rep(id).hierarchy.neighbourhood; if (n.state !== 'VERIFIED') assert.equal(n.verified, null); }
});

t('TRANSACTIONS: one event per deal; RELIABLE = STREET / BUILDING placement only; POSSIBLE apart; the stored union + the stored history, never twice', () => {
  for (const id of [ACCEPT.shaham, ACCEPT.dizengoff, ACCEPT.untermann]) {
    const all = R.transactions(id, { all: true, cat: 'STREET,POSSIBLE' });
    const ids = all.rows.map((r) => r.txId);
    assert.equal(new Set(ids).size, ids.length, 'no event twice');
    const oids = all.rows.filter((r) => /^gm[h]?:/.test(r.txId)).map((r) => r.txId.replace(/^gmh?:/, ''));
    assert.equal(new Set(oids).size, oids.length, 'a GovMap row never as both a window and a history event');
    for (const r of all.rows) {
      if (r.category === 'STREET') assert.ok(['STREET', 'BUILDING'].includes(r.geo.match), r.txId);
      else assert.ok(!['STREET', 'BUILDING'].includes(r.geo.match), r.txId);
      if (r.inStatistics) assert.equal(r.source, 'register', 'only a register price enters a statistic');
      if (r.pricePerSqm != null) assert.ok(r.psmShown && r.source === 'register');
    }
    const U = TX.query({ streetId: id, all: true, unlimited: true });
    assert.equal(all.total, U.total + all.historyRows, 'the union + the stored history, counted');
  }
});

t('TRANSACTIONS: filters intersect, missing values sort last (never 0), paging is stable, the latest event leads', () => {
  const id = ACCEPT.dizengoff;
  const f = R.transactions(id, { all: true, roomsMin: 3, roomsMax: 4, areaMin: 60, priceMin: 1000000, kind: 'DWELLING' });
  for (const r of f.rows) { assert.ok(r.rooms >= 3 && r.rooms <= 4); assert.ok(r.areaSqm >= 60); assert.ok(r.price >= 1000000); assert.equal(r.kind, 'DWELLING'); }
  const s = R.transactions(id, { all: true, sort: 'floor', dir: 'asc' });
  const firstNull = s.rows.findIndex((r) => r.floorNo == null);
  if (firstNull >= 0) assert.ok(s.rows.slice(firstNull).every((r) => r.floorNo == null), 'missing floors last');
  for (let i = 1; i < firstNull; i++) assert.ok(s.rows[i - 1].floorNo <= s.rows[i].floorNo);
  const p1 = R.transactions(id, { limit: 50, offset: 0 }), p2 = R.transactions(id, { limit: 50, offset: 50 });
  assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => r.txId)).size, 100);
  const full = R.transactions(id, { all: true });
  assert.equal(p1.latest.txId, full.rows.find((r) => r.state !== 'POSSIBLE_DUPLICATE').txId);
  const d90 = R.transactions(id, { all: true, days: 90, today: '2026-10-21' });
  assert.ok(d90.rows.every((r) => r.date >= '2026-07-23'));
});

t('SURROUNDING AREA: other streets only, each with its distance — never this street, never counted as its market', () => {
  const a = R.transactions(ACCEPT.shaham, { all: true, cat: 'AREA' });
  assert.ok(a.area && a.area.available);
  for (const r of a.rows) { assert.equal(r.category, 'AREA'); assert.ok(r.areaStreet && r.areaStreet.id !== ACCEPT.shaham && r.areaStreet.distanceM <= R.AREA_STREET_M); }
  const st = rep(ACCEPT.shaham).comparison.rows.find((x) => x.level === 'STREET');
  assert.equal(st.priced, EV.street(ACCEPT.shaham).stats.priced, 'the area never enters the street\'s figures');
});

t('CSV: UTF-8 BOM, one header row, every filtered row, a spreadsheet formula is never executed', () => {
  const csv = R.transactionsCsv(ACCEPT.shaham, { cat: 'STREET' });
  assert.ok(csv.startsWith('﻿date,category,street,house,price_ils,price_used_in_statistics'));
  const T = R.transactions(ACCEPT.shaham, { all: true, cat: 'STREET' });
  assert.equal(csv.trim().split('\r\n').length, T.total + 1);
  assert.ok(!/(^|,)[=+@]/m.test(csv.replace(/^﻿/, '')), 'no cell starts a formula');
});

t('FAIR COMPARISON: the same population at every level; a difference only where both sides are SUPPORTED with ≥ 10 ₪/m²; a district pools its localities', () => {
  for (const id of Object.values(ACCEPT)) {
    const C = rep(id).comparison, st = C.rows[0];
    assert.equal(st.level, 'STREET');
    for (const r of C.rows.slice(1)) {
      if (r.streetVsLevelPct != null) assert.ok(st.state === 'SUPPORTED' && st.withSqm >= 10 && r.state === 'SUPPORTED' && r.withSqm >= 10, id + ' ' + r.level);
      if (r.state === 'INSUFFICIENT' || r.state === 'NONE') assert.equal(r.medianPrice, null);
    }
  }
  const BM = B.load(); assert.ok(BM && BM.current, 'the benchmarks are built from the copy stored now');
  const D = SD.load();
  const codes = Object.keys(BM.localities).map(Number).filter((c) => (D.localities.get(c) || {}).district === 'd-haifa');
  assert.equal(BM.districts['d-haifa'].all.priced, codes.reduce((a, c) => a + BM.localities[c].all.priced, 0), 'pooled, never an average of medians');
  const auer = rep(ACCEPT.auerbach).comparison.rows;
  assert.equal(auer[0].state, 'LIMITED'); assert.ok(auer.slice(1).every((r) => r.streetVsLevelPct == null), 'a LIMITED street is compared to nothing');
});

t('PLANNING: INTERSECTS = a located parcel inside; NEARBY = the stated distance ≤ the radius; AREA-WIDE apart; a rail-transit plan is a statutory stage, never "operating"', () => {
  for (const id of [ACCEPT.shaham, ACCEPT.dizengoff, ACCEPT.untermann, ACCEPT.auerbach]) {
    const P = rep(id).planning;
    assert.ok(P.available, id);
    for (const p of P.plans.concat(P.transit)) {
      if (p.relation === 'INTERSECTS') assert.ok(p.streetPointsInside > 0 && p.distanceM === 0 && p.areaDunam < R.AREA_WIDE_DUNAM);
      if (p.relation === 'AREA_WIDE') assert.ok(p.streetPointsInside > 0 && p.areaDunam >= R.AREA_WIDE_DUNAM);
      if (p.relation === 'NEARBY') assert.ok(p.streetPointsInside === 0 && p.distanceM > 0 && p.distanceM <= (p.topic === 'RAIL_TRANSIT' ? R.TRANSIT_M : R.NEAR_M));
      assert.equal(p.cls, 'OFFICIAL'); assert.equal(p.relationCls, 'DERIVED');
    }
    const near = P.transit.filter((p) => p.relation !== 'AREA_WIDE');
    assert.equal(P.summary.transit, near.length);
    assert.equal(P.summary.transitNearestM, near.length ? Math.min(...near.map((p) => p.distanceM)) : null, 'an area-wide metro plan is never "the nearest line"');
    assert.ok(!/operat|פעיל/.test(JSON.stringify(P.transit.map((p) => [p.stage, p.stageHe]))));
    assert.match(P.doesNotMean, /not an operating line/);
    assert.equal(P.summary.housingUnitDelta, P.plans.filter((p) => p.relation !== 'AREA_WIDE' && (p.planUnitDelta || 0) > 0).reduce((a, p) => a + p.planUnitDelta, 0));
  }
  const d = rep(ACCEPT.dizengoff).planning.transit.find((p) => /הקו הירוק/.test(p.name || ''));
  assert.ok(d && d.relation === 'NEARBY' && d.distanceM < 50, 'the Green Line light-rail plan runs beside Dizengoff');
});

t('A SPATIAL RELATION IS NEVER A JOIN: no plan unit is attributed to the street, no record id is merged, the graph and the statistics read none of it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/streets/report.js'), 'utf8');
  assert.match(src, /never a join of records|never joins a record/);
  for (const f of ['lib/streets/street.js', 'lib/streets/evidence.js', 'lib/streets/value-model.js', 'lib/streets/value-read.js', 'lib/graph/index.js', 'lib/txevents/index.js'])
    if (fs.existsSync(path.join(ROOT, f))) assert.ok(!/streets\/report|street-geo|planning\/national/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' never reads the report layer');
  const r = rep(ACCEPT.dizengoff);
  assert.ok(!('units' in r.overview) && !('plannedUnits' in r.overview));
});

t('TOPIC from the plan\'s own words: "מטרופוליני" is not a metro; a land-use plan along a line is not the line; the line itself is', () => {
  assert.equal(topicOf({ name: 'פת/2200 תכנית מתאר לאזור תעסוקה מטרופוליני משני קרית אריה' }), 'OTHER');
  assert.equal(topicOf({ name: 'עיבוי בינוי לאורך ציר רק"ל ברחוב יקותיאל אדם' }), 'OTHER');
  assert.equal(topicOf({ name: 'תת"ל 103 - קו מטרו M3' }), 'RAIL_TRANSIT');
  assert.equal(topicOf({ name: 'הרכבת הקלה בירושלים' }), 'RAIL_TRANSIT');
  assert.equal(topicOf({ name: 'מתחם הרכבת קרית גת' }), 'OTHER');
  assert.equal(topicOf({ name: 'פינוי בינוי רחוב הרצל' }), 'RENEWAL');
});

t('ASSESSMENT: deterministic rules; FACT and INTERPRETATION apart; no score, no probability, no recommendation', () => {
  for (const id of Object.values(ACCEPT)) {
    const A = rep(id).assessment;
    for (const it of [...A.supports, ...A.against, ...A.couldChange]) { assert.ok(['FACT', 'INTERPRETATION'].includes(it.kind)); assert.match(it.rule, /^SA-/); assert.ok(it.he && it.en); }
    for (const d of A.dueDiligence) assert.match(d.rule, /^DD-/);
    /* the items themselves (the rule statement names what is absent) */
    const txt = JSON.stringify([...A.supports, ...A.against, ...A.couldChange, ...A.dueDiligence]);
    assert.ok(!/"score"|probab|\b(buy|sell) (it|now)\b|recommend/i.test(txt), id);
    assert.match(A.rule, /no score, no probability, no recommendation/);
    for (const n of rep(id).overview.narrative) assert.ok(['FACT', 'MODEL', 'INTERPRETATION'].includes(n.kind));
  }
  const w = rep(ACCEPT.weak);
  assert.ok(w.assessment.against.some((x) => x.rule === 'SA-SAMPLE') && w.assessment.against.some((x) => x.rule === 'SA-MODEL'), 'weak evidence argues against');
  assert.ok(w.missing.some((m) => m.section === 'model'));
});

t('PROPERTY: an asking price and an area are required; no scenario without the user\'s own assumption; the arithmetic is the stated formula', () => {
  assert.equal(R.property(ACCEPT.shaham, { sqm: 100 }).available, false);
  const n = R.property(ACCEPT.shaham, { askingPrice: 2900000, sqm: 100, rooms: 4 });
  assert.ok(n.available); assert.deepEqual(n.scenarios, { bull: null, base: null, bear: null }); assert.equal(n.income.available, false);
  const p = R.property(ACCEPT.shaham, { askingPrice: 2900000, sqm: 100, rooms: 4, base: 3, holdYears: 5, rentMonthly: 7500, costsPct: 2 });
  assert.equal(p.scenarios.base.endValue, Math.round(2900000 * Math.pow(1.03, 5) / 1000) * 1000);
  assert.equal(p.scenarios.bull, null, 'only the scenarios entered');
  assert.equal(p.income.grossYieldPct, Math.round(7500 * 12 / 2900000 * 1000) / 10);
  assert.equal(p.askPricePerSqm, 29000);
  const apt = SVM.apartment(ACCEPT.shaham, { sqm: 100, rooms: 4, newness: 'existing', type: 'flat' });
  assert.equal(p.model.value, apt.apartment.value, 'the model\'s own apartment read');
  for (const s of p.street.similar) assert.ok(Math.abs(s.areaSqm - 100) <= 20);
});

t('STREET GEOGRAPHY: built from the GovMap-layer file and validated against the API\'s own points; coordinates never join', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/street-geo/meta.json'), 'utf8'));
  assert.ok(m.validation.pass && m.validation.medianM <= 15 && m.validation.within50mPct >= 95 && m.validation.matched >= 10000);
  assert.ok(m.stats.streetInDirectory > 0 && m.stats.streetNotInDirectory === undefined || m.stats.streetInDirectory > m.stats.streetNotInDirectory, 'decoded street codes are official codes');
  assert.match(m.notJoin, /never join/);
  const g = rep(ACCEPT.dizengoff).map;
  assert.ok(g.available && g.located > 100 && g.points.every((p) => p[0] > 34 && p[0] < 36 && p[1] > 29 && p[1] < 34));
});

t('PLAN BOUNDARIES: a complete read of the layer (stored + skipped = the layer\'s own count) or nothing', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/planning/national/meta.json'), 'utf8'));
  assert.ok(m.complete); assert.equal(m.stored + m.skipped.noPlanNumberOrMpId + m.skipped.noGeometry, m.layerCount);
  assert.match(m.use, /never a join/);
  const sc = fs.readFileSync(path.join(ROOT, 'scripts/street-planning-sync.js'), 'utf8');
  assert.match(sc, /INCOMPLETE[^\n]*nothing written/); assert.ok(!/method:\s*'(PUT|DELETE)'/.test(sc));
});

t('API: views are additive — 400 for a malformed id, 404 for a street the directory does not hold, CSV as an attachment', async () => {
  const h = require('../api/intel.js');
  const call = (q) => new Promise((r) => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { r({ code: this.statusCode, h: this.headers, b }); } }; h({ url: '/api/intel?' + q, method: 'GET', headers: {} }, res); });
  assert.equal((await call('view=streetReport&id=bad')).code, 400);
  assert.equal((await call('view=streetReport&id=st:7900:99999')).code, 404);
  const c = await call('view=streetTx&format=csv&id=' + ACCEPT.shaham);
  assert.match(c.h['Content-Type'], /text\/csv/); assert.match(c.h['Content-Disposition'], /attachment/);
  const core = JSON.parse((await call('view=streetReport&part=core&id=' + ACCEPT.shaham)).b);
  assert.equal(core.part, 'core'); assert.ok(core.overview.latest && core.planning.deferred);
  const st = JSON.parse((await call('view=street&id=' + ACCEPT.shaham)).b);
  assert.ok(st.identity && st.evidence && st.events, 'view=street unchanged');
});

t('PAGE: the report leads, the full Street Intelligence view follows; every section has its ⓘ; no competing site is read; no credential', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /body\.innerHTML=srHTML\(g\)\+`<details class="st-sec sr-ev" id="sr-ev" open>/);
  for (const id of ['street_report', 'street_report_fair_comparison', 'street_report_relation', 'street_report_assessment', 'street_report_property_assessment', 'street_report_source_label']) assert.ok(page.includes(`xpBtn("${id}")`) || new RegExp(`sec\\("[a-z]+",[^\\n]*,true,"${id}"\\)`).test(page), id);
  for (const k of ['streetReport', 'streetTx', 'streetProperty']) assert.ok(page.includes('view=' + k) || page.includes(`view:"${k}"`), k);
  assert.ok(page.includes('propx:street-property:v1'), 'the property inputs stay in this browser');
  /* the street report's own code: its block of the page + its modules and syncs (a pre-existing board comment of 30.08.2026 about how
     the Ramat HaSharon neighbourhood NAMES were checked is not street-report code and is reported apart) */
  const block = page.slice(page.indexOf('STREET INVESTMENT INTELLIGENCE — the street report'), page.indexOf('let _geoNav=false;'));
  assert.ok(block.length > 10000, 'the report block');
  const code = [block, ...['lib/streets/report.js', 'lib/streets/benchmarks.js', 'lib/planning/topic.js', 'scripts/street-geo-build.py', 'scripts/street-planning-sync.js', 'scripts/street-report-discover.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))].join('\n');
  assert.ok(!/madlan|yad2|homeless\.co\.il|winwin|onmap/i.test(code), 'no competing real-estate site');
  for (const host of ['ags.iplan.gov.il', 'data.gov.il']) assert.ok(fs.readFileSync(path.join(ROOT, 'scripts/street-report-discover.js'), 'utf8').includes(host));
  assert.ok(!/SITE_PASSWORD\s*=\s*['"][^'"]+['"]/.test(code));
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); }
  }
  console.log(`street-report: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
