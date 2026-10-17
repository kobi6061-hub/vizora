'use strict';
/* PROPX · DEVELOPER INTELLIGENCE 2.0 (lib/entities/intel.js) — the gates.
 *
 * The module is a pure read over the registry: no fetch, no randomness, never a merge, never a score. Every signal
 * rule is held to its threshold on a synthetic entity (fires at the threshold, silent just below it); every text,
 * trigger and limitation exists in Hebrew and English; shares live in 0–1 and are null on a zero denominator; the
 * trend rule is exercised branch by branch; `developer(id)` over the committed data keeps every pre-existing key
 * and gains `intel`. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../lib/entities/intel');
const Q = require('../lib/entities/query');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = '2026-10-17';
/* the reference day's windows: last6 ≥ 2026-04-17 · last12 ≥ 2025-10-17 · prior12 = [2024-10-17, 2025-10-17) · prior24to36 = [2023-10-17, 2024-10-17) */
const D = { last6: '2026-06-01', last12: '2026-01-15', prior12: '2025-03-01', prior24to36: '2024-03-01', old: '2022-05-05' };

/* ---- synthetic world: the minimal entity + cache shape the function reads ----
 *   cache = { projById: Map<id, site | project>, landById: Map<tenderId, tender record>, R: { entries: [] } }        */
let seq = 0;
const site = (o = {}) => { const n = ++seq; return { id: `ila:999:${n}`, kind: 'ila-awarded-lot', tenderId: `rmi:999${n}`, track: 'open-market', units: 50, priceBasis: 'competitive-bid', landPrice: 10000000, landPerUnit: 200000,
  decisionDate: D.last12, localityCode: 9000, city: 'באר שבע', cityEn: "be'er sheva", planLots: [], construction: null, stage: { furthest: 'land-awarded', evidence: [{ stage: 'land-awarded' }] }, ...o }; };
const project = (o = {}) => { const n = ++seq; return { id: `moch:999${n}`, kind: 'moch-lottery-project', developerIds: ['dev-x'], localityCode: 9000, lotteries: [{ type: 'first', date: D.last12, units: 40, applicants: 400 }],
  stage: { furthest: 'marketed', evidence: [{ stage: 'marketed' }] }, ...o }; };
function world({ sites = [], projects = [], entries = [], tenders = [], entity = {}, diraFor } = {}) {
  const dates = [...sites.map((s) => s.decisionDate), ...projects.flatMap((p) => p.lotteries.map((l) => l.date))].filter(Boolean).sort();
  const tracks = {}; for (const s of sites) tracks[s.track] = (tracks[s.track] || 0) + 1;
  const lotteries = projects.reduce((n, p) => n + p.lotteries.length, 0);
  const E = { id: 'dev-x', name: 'TEST FIXTURE יזם בע"מ', canonical: 'TEST FIXTURE יזם בע"מ', kind: 'company', joint: false, roles: ['ila-tender-winner'], aliases: [{ name: 'TEST FIXTURE יזם בע"מ', occurrences: 1, evidence: 'source-string' }],
    tenders: { lots: sites.length, tenders: sites.length, residentialUnits: sites.length ? sites.reduce((s, x) => s + (x.units || 0), 0) : null, landTotalCompetitive: null, landLots: 0, landPerUnit: null, landPerUnitBasis: 'x', perSqmLots: 0, fixedPriceLots: 0 },
    lotteries: { lotteries, firstLotteries: lotteries, projects: projects.length, unitsFirstLotteries: null, applicantsFirstLotteries: null }, tracks, construction: null, markets: [],
    firstActivity: dates[0] || null, lastActivity: dates[dates.length - 1] || null, sites: sites.map((s) => s.id), projects: projects.map((p) => p.id), possibleSame: [], ...entity };
  const cache = { projById: new Map([...sites, ...projects].map((x) => [x.id, x])), landById: new Map(tenders.map((r) => [r.id, r])), R: { entries } };
  return { entity: E, cache, intel: I.devIntel(E, cache, { now: NOW, diraFor: diraFor || (() => null) }) };
}
const ids = (x) => x.intel.signals.map((s) => s.id);
const has = (x, id) => ids(x).includes(id);
const parity = (v, what) => { assert.ok(v && typeof v.he === 'string' && v.he.length && typeof v.en === 'string' && v.en.length, `${what}: he/en`); };
const checkSignal = (s) => {
  assert.ok(['watch', 'risk', 'info'].includes(s.kind), s.id + ' kind');
  parity(s.text, s.id + ' text'); parity(s.trigger, s.id + ' trigger');
  assert.ok(Array.isArray(s.limitations) && s.limitations.length, s.id + ' limitations'); for (const l of s.limitations) parity(l, s.id + ' limitation');
  for (const k of ['threshold', 'period']) { const v = s[k]; assert.ok(v == null || typeof v === 'string' || (v.he && v.en), `${s.id} ${k}`); if (v && typeof v === 'object') parity(v, s.id + ' ' + k); }
  assert.ok('value' in s && typeof s.source === 'string' && ['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(s.cls), s.id + ' value/source/cls');
};

console.log('entities-intel: module');
t('the module is a pure read: no fetch, no network, no randomness, no merge call, no score', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/entities/intel.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random|child_process|readFileSync/.test(src));
  assert.ok(!/\bmerge\w*\s*\(/.test(src), 'never calls a merge');
  assert.ok(!/\bscores?\w*\s*[:=(]/i.test(src), 'no score of any kind (no identifier, key or call named score — the words "no score" in the basis are allowed)');
  assert.ok(Array.isArray(I.SIGNALS) && I.SIGNALS.length === 10);
  for (const r of I.SIGNALS) { assert.ok(/^[A-Z_]+$/.test(r.id)); assert.ok(['watch', 'risk', 'info'].includes(r.kind)); parity(r.trigger, r.id); for (const l of r.limitations) parity(l, r.id); assert.equal(typeof r.fires, 'function'); assert.equal(typeof r.value, 'function'); assert.equal(typeof r.text, 'function'); }
  assert.deepEqual(I.SIGNALS.map((r) => r.id), ['NEW_MARKET_ENTRY', 'ACCELERATING_LAND_ACTIVITY', 'RECENT_WIN_MOMENTUM', 'HIGH_GEOGRAPHIC_CONCENTRATION', 'PROGRAM_CONCENTRATION', 'LOW_RECENT_PUBLIC_ACTIVITY', 'RENTAL_EXPANSION', 'PLANNING_EVIDENCE', 'CONSTRUCTION_EVIDENCE', 'POSSIBLE_SAME_ENTITY']);
});
t('deterministic: the same entity and cache give the same intel twice; null entity → null', () => {
  const w = world({ sites: [site(), site({ decisionDate: D.prior12 })] });
  assert.deepEqual(I.devIntel(w.entity, w.cache, { now: NOW, diraFor: () => null }), w.intel);
  assert.equal(I.devIntel(null, w.cache, { now: NOW }), null);
  assert.equal(w.intel.generatedFor, NOW); assert.equal(I.dayOf(Date.parse('2026-10-17T12:00:00Z')), NOW);
  assert.deepEqual(w.intel.windows.last12, { from: '2025-10-17', to: '2026-10-17' }); assert.deepEqual(w.intel.windows.prior12, { from: '2024-10-17', to: '2025-10-17' }); assert.deepEqual(w.intel.windows.prior24to36, { from: '2023-10-17', to: '2024-10-17' });
});
t('every block carries source + class, a bilingual basis, and the observation-channel statement exists', () => {
  const w = world({ sites: [site()], entity: { construction: { lots: 1, buildings: 1, units: 30, started: 1, completed: 0, asOf: '2024-03-01' } } });
  for (const k of ['identity', 'activity', 'markets', 'programs', 'landBasis', 'rental', 'planning', 'construction', 'housing', 'entries']) { const b = w.intel[k]; assert.ok(b && typeof b.source === 'string' && ['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(b.cls), k); }
  parity(w.intel.basis, 'basis'); assert.match(w.intel.basis.en, /OBSERVED PROPX ACTIVITY/); assert.match(w.intel.basis.en, /never a land bank, a total pipeline, a complete list or a market share/); assert.match(w.intel.basis.en, /no score/);
  parity(w.intel.programs.observationChannel, 'observationChannel'); assert.match(w.intel.programs.observationChannel.en, /public channels only/); assert.match(w.intel.programs.observationChannel.en, /cannot be measured — only stated/);
  assert.match(w.intel.rental.basis.en, /a rental-track lot is not an operating rental project/); assert.match(w.intel.planning.basis.en, /exact plan number only/);
  assert.equal(w.intel.identity.companyId, null); assert.ok(w.intel.identity.companyIdNote); assert.equal(w.intel.landBasis.vat, 'not-stated-by-source');
  assert.equal(w.intel.construction.stale, true); assert.equal(w.intel.construction.asOf, '2024-03-01');
  assert.equal(world({}).intel.construction, null, 'no construction join → null, never 0');
});

console.log('entities-intel: shares and trend');
t('shares are 0–1 and null on a zero denominator (programs, geography, subsidized share)', () => {
  const none = world({}).intel;
  assert.equal(none.programs.subsidizedShare, null); assert.deepEqual(none.programs.shares, {}); assert.equal(none.programs.topTrack, null);
  assert.equal(none.markets.geographicConcentration.share, null); assert.equal(none.markets.geographicConcentration.topMarket, null); assert.equal(none.markets.geographicConcentration.markets, 0);
  const comm = world({ entity: { tracks: { 'commercial-other': 3 } } }).intel;
  assert.equal(comm.programs.subsidizedShare, null, 'no residential lots → null, not 0'); assert.equal(comm.programs.shares['commercial-other'], 1);
  const mix = world({ sites: [site({ track: 'subsidized' }), site({ track: 'subsidized' }), site({ track: 'open-market' }), site({ track: 'rental' })], entity: { tracks: { subsidized: 2, 'open-market': 1, rental: 1, 'commercial-other': 4 } } }).intel;
  assert.equal(mix.programs.subsidizedShare, 0.5); assert.equal(mix.programs.residentialLots, 4); assert.equal(mix.programs.lots, 8); assert.equal(mix.programs.shares['commercial-other'], 0.5);
  for (const v of Object.values(mix.programs.shares)) assert.ok(v >= 0 && v <= 1);
  const g = world({ sites: [site({ localityCode: 1 }), site({ localityCode: 1 }), site({ localityCode: 2 })] }).intel.markets.geographicConcentration;
  assert.equal(g.share, 0.667); assert.equal(g.lots, 2); assert.equal(g.residentialLots, 3); assert.equal(g.markets, 2); assert.equal(g.topMarket.localityCode, 1);
});
t('land per unit by track: only competitive-bid lots with both a sum and units; ₪/m² bids and fixed allocations stay out', () => {
  const w = world({ sites: [site({ track: 'subsidized', landPrice: 12000000, units: 60 }), site({ track: 'subsidized', landPrice: 8000000, units: 40 }), site({ track: 'open-market', priceBasis: 'price-per-sqm-bid', landPrice: null, bidPerSqm: 9500, units: 80 }),
    site({ track: 'open-market', priceBasis: 'fixed-price-allocation', landPrice: 5000000, units: 20 }), site({ track: 'mixed-use', landPrice: 3000000, units: null })] }).intel.landBasis;
  assert.deepEqual(Object.keys(w.byTrack), ['subsidized']); assert.equal(w.byTrack.subsidized.landPerUnit, 200000); assert.equal(w.byTrack.subsidized.lots, 2);
});
t('the trend rule: inactive (a = b = 0) · insufficient (a < 2 and b < 2) · accelerating (a ≥ 2b) · slowing (a ≤ b/2) · steady', () => {
  const tr = (last12, prior12, lotteries = 0) => world({ sites: [...Array(last12)].map(() => site({ decisionDate: D.last12 })).concat([...Array(prior12)].map(() => site({ decisionDate: D.prior12 }))),
    projects: lotteries ? [project({ lotteries: [...Array(lotteries)].map(() => ({ type: 'first', date: D.last12, units: 10, applicants: 100 })) })] : [] }).intel.activity;
  assert.equal(tr(0, 0).trend, 'inactive'); assert.equal(world({ sites: [site({ decisionDate: D.old })] }).intel.activity.trend, 'inactive', 'old activity only: nothing in 24 months');
  assert.equal(tr(1, 0).trend, 'insufficient'); assert.equal(tr(0, 1).trend, 'insufficient'); assert.equal(tr(1, 1).trend, 'insufficient');
  assert.equal(tr(2, 0).trend, 'accelerating'); assert.equal(tr(2, 1).trend, 'accelerating'); assert.equal(tr(4, 2).trend, 'accelerating');
  assert.equal(tr(3, 2).trend, 'steady'); assert.equal(tr(2, 2).trend, 'steady'); assert.equal(tr(3, 4).trend, 'steady');
  assert.equal(tr(1, 2).trend, 'slowing'); assert.equal(tr(0, 2).trend, 'slowing'); assert.equal(tr(2, 5).trend, 'slowing');
  const x = tr(1, 0, 1); assert.equal(x.trend, 'accelerating', 'lotteries count with lots'); assert.deepEqual(x.trendComponents, { last12: 2, prior12: 0 }); assert.equal(x.windows.last12.lotteries, 1); assert.equal(x.windows.last12.firstLotteries, 1);
  parity(x.trendRule, 'trendRule'); parity(x.basis, 'activity basis'); assert.match(x.basis.en, /not a statement about the company/);
  const w = tr(2, 1); assert.equal(w.windows.last12.residentialUnits, 100); assert.equal(w.windows.prior12.lotsWon, 1); assert.equal(w.windows.prior24to36.lotsWon, 0); assert.equal(w.windows.prior24to36.residentialUnits, null, 'no lot in the window → null, not 0');
  assert.equal(w.monthsSinceLast, 9); assert.equal(I.monthsBetween('2026-04-27', '2026-10-17'), 5); assert.equal(I.monthsBetween(null, NOW), null);
  const far = world({ sites: [site({ decisionDate: D.prior24to36 })] }).intel.activity; assert.equal(far.windows.prior24to36.lotsWon, 1); assert.equal(far.windows.prior12.lotsWon, 0);
});
t('lots on non-residential tracks have no site and are reported as outside the windows; projects count only for their listed developer', () => {
  const w = world({ sites: [site()], projects: [project({ developerIds: ['dev-other'] })], entity: { tenders: { lots: 3 } } }).intel;
  assert.equal(w.activity.lotsOutsideWindows, 2); assert.equal(w.housing.projectsResolved, 0); assert.equal(w.activity.windows.last12.lotteries, 0);
});

console.log('entities-intel: signal rules at and below their thresholds');
t('NEW_MARKET_ENTRY: ≥ 1 entry in 24 months (watch)', () => {
  const e = (date) => ({ developerId: 'dev-x', localityCode: 9000, city: 'באר שבע', cityEn: "be'er sheva", date, via: 'ila-win', earlierActivityFrom: '2019-01-01' });
  const on = world({ sites: [site()], entries: [e('2026-01-01'), { ...e('2026-02-01'), developerId: 'dev-other' }] });
  assert.ok(has(on, 'NEW_MARKET_ENTRY')); const s = on.intel.signals.find((x) => x.id === 'NEW_MARKET_ENTRY'); assert.equal(s.kind, 'watch'); assert.equal(s.value, 1); assert.equal(on.intel.entries.rows.length, 1, 'other developers\' entries are not mine');
  assert.ok(!has(world({ sites: [site()], entries: [e('2024-10-16')] }), 'NEW_MARKET_ENTRY'), 'a day before the window');
  assert.ok(has(world({ sites: [site()], entries: [e('2024-10-17')] }), 'NEW_MARKET_ENTRY'), 'the first day of the window');
  assert.ok(!has(world({ sites: [site()] }), 'NEW_MARKET_ENTRY'));
});
t('ACCELERATING_LAND_ACTIVITY: last-12 lots ≥ 3 and ≥ 2 × prior-12 (watch)', () => {
  const w = (a, b) => world({ sites: [...Array(a)].map(() => site({ decisionDate: D.last12 })).concat([...Array(b)].map(() => site({ decisionDate: D.prior12 }))) });
  assert.ok(has(w(3, 1), 'ACCELERATING_LAND_ACTIVITY')); assert.ok(has(w(4, 2), 'ACCELERATING_LAND_ACTIVITY')); assert.ok(has(w(3, 0), 'ACCELERATING_LAND_ACTIVITY'));
  assert.ok(!has(w(2, 0), 'ACCELERATING_LAND_ACTIVITY'), 'below 3'); assert.ok(!has(w(3, 2), 'ACCELERATING_LAND_ACTIVITY'), 'less than 2 ×'); assert.ok(!has(w(5, 3), 'ACCELERATING_LAND_ACTIVITY'));
  const s = w(4, 2).intel.signals.find((x) => x.id === 'ACCELERATING_LAND_ACTIVITY'); assert.equal(s.value, 4); assert.deepEqual(s.components, { last12: 4, prior12: 2 }); assert.equal(s.cls, 'DERIVED');
});
t('RECENT_WIN_MOMENTUM: ≥ 3 lots in the last 6 months (watch)', () => {
  const w = (n, extra = []) => world({ sites: [...Array(n)].map(() => site({ decisionDate: D.last6 })).concat(extra) });
  assert.ok(has(w(3), 'RECENT_WIN_MOMENTUM')); assert.ok(!has(w(2), 'RECENT_WIN_MOMENTUM')); assert.ok(!has(w(2, [site({ decisionDate: '2026-03-01' })]), 'RECENT_WIN_MOMENTUM'), 'a lot 7 months ago is not momentum');
  assert.ok(has(w(2, [site({ decisionDate: '2026-04-17' })]), 'RECENT_WIN_MOMENTUM'), 'the window\'s first day counts');
  assert.equal(w(3).intel.signals.find((x) => x.id === 'RECENT_WIN_MOMENTUM').value, 3);
});
t('HIGH_GEOGRAPHIC_CONCENTRATION: top market ≥ 70% of ≥ 5 residential lots (risk — not a judgement)', () => {
  const w = (a, b) => world({ sites: [...Array(a)].map(() => site({ localityCode: 1, city: 'א', cityEn: 'a' })).concat([...Array(b)].map(() => site({ localityCode: 2, city: 'ב', cityEn: 'b' }))) });
  assert.ok(has(w(4, 1), 'HIGH_GEOGRAPHIC_CONCENTRATION')); assert.ok(has(w(7, 3), 'HIGH_GEOGRAPHIC_CONCENTRATION'));
  assert.ok(!has(w(3, 2), 'HIGH_GEOGRAPHIC_CONCENTRATION'), '60%'); assert.ok(!has(w(4, 0), 'HIGH_GEOGRAPHIC_CONCENTRATION'), '100% of only 4 lots'); assert.ok(!has(w(6, 3), 'HIGH_GEOGRAPHIC_CONCENTRATION'), '67%');
  const s = w(4, 1).intel.signals.find((x) => x.id === 'HIGH_GEOGRAPHIC_CONCENTRATION'); assert.equal(s.kind, 'risk'); assert.equal(s.value, 0.8); assert.equal(s.components.topMarket.localityCode, 1);
  assert.ok(s.limitations.some((l) => /not a judgement on the company/.test(l.en)));
});
t('PROGRAM_CONCENTRATION: one track ≥ 70% of ≥ 5 lots (info)', () => {
  const w = (tracks) => world({ entity: { tracks } });
  assert.ok(has(w({ subsidized: 4, 'open-market': 1 }), 'PROGRAM_CONCENTRATION')); assert.ok(has(w({ 'open-market': 7, subsidized: 3 }), 'PROGRAM_CONCENTRATION'));
  assert.ok(!has(w({ subsidized: 3, 'open-market': 2 }), 'PROGRAM_CONCENTRATION'), '60%'); assert.ok(!has(w({ subsidized: 4 }), 'PROGRAM_CONCENTRATION'), 'only 4 lots'); assert.ok(!has(w({}), 'PROGRAM_CONCENTRATION'));
  const s = w({ subsidized: 4, 'open-market': 1 }).intel.signals.find((x) => x.id === 'PROGRAM_CONCENTRATION'); assert.equal(s.kind, 'info'); assert.equal(s.value, 0.8); assert.equal(s.components.track, 'subsidized');
});
t('LOW_RECENT_PUBLIC_ACTIVITY: ≥ 3 lifetime lots + lotteries and none in 24 months (info — "no activity observed in PROPX\'s public channels", never "inactive company")', () => {
  const w = (lots, lotteries, lastActivity) => world({ entity: { tenders: { lots }, lotteries: { lotteries }, lastActivity, firstActivity: '2019-01-01' } });
  assert.ok(has(w(3, 0, '2023-01-01'), 'LOW_RECENT_PUBLIC_ACTIVITY')); assert.ok(has(w(1, 2, '2024-10-16'), 'LOW_RECENT_PUBLIC_ACTIVITY'), 'the day before the window');
  assert.ok(!has(w(3, 0, '2024-10-17'), 'LOW_RECENT_PUBLIC_ACTIVITY'), 'activity on the window\'s first day'); assert.ok(!has(w(2, 0, '2023-01-01'), 'LOW_RECENT_PUBLIC_ACTIVITY'), 'fewer than 3 lifetime'); assert.ok(!has(w(3, 0, '2026-01-01'), 'LOW_RECENT_PUBLIC_ACTIVITY'));
  const s = w(3, 0, '2023-01-01').intel.signals.find((x) => x.id === 'LOW_RECENT_PUBLIC_ACTIVITY');
  assert.equal(s.kind, 'info'); assert.equal(s.value, 0); assert.match(s.text.en, /no activity observed in PROPX's public channels/); assert.doesNotMatch(s.text.en + s.trigger.en + s.limitations.map((l) => l.en).join(' '), /inactive company/i);
  assert.ok(s.limitations.some((l) => /absence of observation is not absence of activity/.test(l.en))); assert.equal(s.components.lifetime, 3);
});
t('RENTAL_EXPANSION: ≥ 1 rental-track lot in 24 months (watch); notices joined only through diraFor, stated units summed only where stated', () => {
  const dira = (id) => (id === 'rmi:R1' ? { tenderNumber: 'ים/1/2026', totalUnits: 300, rentalUnits: 200, rentalBasis: 'stated', saleUnits: 100, rentalYears: 20, status: { slug: 'open' }, published: '2026-01-01' } : id === 'rmi:R2' ? { tenderNumber: 'ים/2/2026', totalUnits: 120, rentalUnits: null, rentalBasis: null } : null);
  const on = world({ sites: [site({ track: 'rental', tenderId: 'rmi:R1', units: 300, decisionDate: D.last12 }), site({ track: 'rental', tenderId: 'rmi:R2', units: 120, decisionDate: D.old }), site({ track: 'rental', tenderId: 'rmi:R3', units: 80, decisionDate: D.old })], diraFor: dira });
  assert.ok(has(on, 'RENTAL_EXPANSION')); const R = on.intel.rental;
  assert.equal(R.rentalTrackLots, 3); assert.equal(R.rentalTrackLots24, 1); assert.equal(R.rentalTrackUnits, 500); assert.equal(R.noticesJoined, 2); assert.equal(R.statedRentalUnits, 200); assert.equal(R.statedRentalUnitsNotices, 1);
  assert.match(R.rentalTrackUnitsLabel.en, /tender total units — not "rental units"/);
  const s = on.intel.signals.find((x) => x.id === 'RENTAL_EXPANSION'); assert.equal(s.kind, 'watch'); assert.equal(s.value, 1); assert.ok(s.limitations.some((l) => /not an operating rental project/.test(l.en)));
  assert.ok(!has(world({ sites: [site({ track: 'rental', decisionDate: D.old })], diraFor: dira }), 'RENTAL_EXPANSION'), 'an old rental lot is not expansion');
  assert.ok(!has(world({ sites: [site({ track: 'rental', decisionDate: '2024-10-16' })] }), 'RENTAL_EXPANSION'), 'the day before the window');
  assert.ok(has(world({ sites: [site({ track: 'rental', decisionDate: '2024-10-17' })] }), 'RENTAL_EXPANSION'));
  assert.equal(world({ sites: [site({ track: 'rental', units: null })] }).intel.rental.rentalTrackUnits, null, 'no units published → null');
  assert.equal(world({ sites: [site({ track: 'rental', tenderId: 'rmi:R1' })], diraFor: () => { throw new Error('boom'); } }).intel.rental.noticesJoined, 0, 'a failing rental read model never breaks the intel');
});
t('PLANNING_EVIDENCE: ≥ 2 distinct plans joined to XPlan by exact plan number (info); a plan referenced by several lots counts once', () => {
  const rec = (id, plans) => ({ id, plans });
  const T = [rec('rmi:T1', [{ plan: 'תמל/ 1001', via: 'lot', xplan: { station: 'אישור', shortStatus: 'פרסום אישור', approvalDate: '2020-01-01' } }, { plan: 'תמל/1002', via: 'lot', xplan: null }]),
    rec('rmi:T2', [{ plan: '101-0000002', via: 'lot', xplan: { station: 'הפקדה', shortStatus: 'הפקדה' } }])];
  const on = world({ sites: [site({ tenderId: 'rmi:T1', planLots: ['תמל/1001|10', 'תמל/1001|11', 'תמל/1002|5'] }), site({ tenderId: 'rmi:T1', planLots: ['תמל/1001|12'] }), site({ tenderId: 'rmi:T2', planLots: ['101-0000002|1'] })], tenders: T });
  const P = on.intel.planning; assert.equal(P.plans, 3); assert.equal(P.xplanJoined, 2); assert.deepEqual(P.byStation, { 'אישור': 1, 'הפקדה': 1 }); assert.equal(P.items[0].plan, 'תמל/1001'); assert.equal(P.items[0].lots, 2, 'one lot = one count per plan, however many plan|lot keys');
  assert.ok(has(on, 'PLANNING_EVIDENCE')); assert.equal(on.intel.signals.find((x) => x.id === 'PLANNING_EVIDENCE').value, 2);
  const one = world({ sites: [site({ tenderId: 'rmi:T1', planLots: ['תמל/1001|10'] }), site({ tenderId: 'rmi:T1', planLots: ['תמל/1001|11'] })], tenders: T });
  assert.equal(one.intel.planning.xplanJoined, 1); assert.ok(!has(one, 'PLANNING_EVIDENCE'), 'the same plan twice is one plan');
  const none = world({ sites: [site({ tenderId: 'rmi:T1', planLots: ['תמל/1001|10'] })] }); assert.equal(none.intel.planning.plans, 1); assert.equal(none.intel.planning.xplanJoined, 0, 'no tender record in the cache → no join, never a guess');
});
t('CONSTRUCTION_EVIDENCE: started ≥ 1 (info) with the stale note and the as-of date as its period', () => {
  const w = (construction) => world({ entity: { construction } });
  const on = w({ lots: 2, buildings: 3, units: 90, started: 1, completed: 0, firstStart: '2023-05-01', lastCompletion: null, asOf: '2024-03-01' });
  assert.ok(has(on, 'CONSTRUCTION_EVIDENCE')); const s = on.intel.signals.find((x) => x.id === 'CONSTRUCTION_EVIDENCE');
  assert.equal(s.kind, 'info'); assert.equal(s.value, 1); assert.equal(s.period, '2024-03-01'); assert.match(s.text.en, /STALE/); assert.ok(s.limitations.some((l) => /STALE — as of 2024-03-01/.test(l.en))); assert.equal(s.components.stale, true);
  assert.ok(!has(w({ lots: 1, buildings: 1, units: 30, started: 0, completed: 0, asOf: '2024-03-01' }), 'CONSTRUCTION_EVIDENCE'), 'a join without a start');
  assert.ok(!has(w(null), 'CONSTRUCTION_EVIDENCE'));
});
t('POSSIBLE_SAME_ENTITY: ≥ 1 possible-same link (info) — "possibly the same entity — not merged"; identity carries merged: false', () => {
  const on = world({ entity: { possibleSame: [{ id: 'dev-y', name: 'TEST FIXTURE יזם ב', evidence: 'strict-prefix', note: 'NOT merged' }] } });
  assert.ok(has(on, 'POSSIBLE_SAME_ENTITY')); const s = on.intel.signals.find((x) => x.id === 'POSSIBLE_SAME_ENTITY');
  assert.equal(s.kind, 'info'); assert.equal(s.value, 1); assert.match(s.text.en, /possibly the same entity — not merged/); assert.equal(s.components.possibleSame[0].evidence, 'strict-prefix');
  assert.equal(on.intel.identity.possibleSame[0].merged, false); assert.equal(on.intel.identity.possibleSame[0].note, 'NOT merged'); assert.match(on.intel.identity.rule.en, /never a merge/);
  assert.ok(!has(world({}), 'POSSIBLE_SAME_ENTITY'));
});
t('he/en parity and the signal convention on a fixture that fires nine rules at once', () => {
  const T = [{ id: 'rmi:T1', plans: [{ plan: 'A/1', xplan: { station: 'אישור' } }] }, { id: 'rmi:T2', plans: [{ plan: 'B/2', xplan: { station: 'אישור' } }] }];
  const S = [site({ decisionDate: D.last6, localityCode: 1, tenderId: 'rmi:T1', planLots: ['A/1|1'] }), site({ decisionDate: D.last6, localityCode: 1, tenderId: 'rmi:T2', planLots: ['B/2|1'] }), site({ decisionDate: D.last6, localityCode: 1 }),
    site({ decisionDate: D.last12, localityCode: 1, track: 'rental', tenderId: 'rmi:R1' }), site({ decisionDate: D.prior12, localityCode: 2 })];
  const w = world({ sites: S, tenders: T, entries: [{ developerId: 'dev-x', localityCode: 1, city: 'א', cityEn: 'a', date: D.last6, via: 'ila-win' }],
    entity: { tracks: { 'open-market': 4, rental: 1 }, construction: { lots: 1, buildings: 1, units: 20, started: 1, completed: 1, asOf: '2024-03-01' }, possibleSame: [{ id: 'dev-y', name: 'Y', evidence: 'same-letters' }] } });
  assert.deepEqual(ids(w).sort(), ['ACCELERATING_LAND_ACTIVITY', 'CONSTRUCTION_EVIDENCE', 'HIGH_GEOGRAPHIC_CONCENTRATION', 'NEW_MARKET_ENTRY', 'PLANNING_EVIDENCE', 'POSSIBLE_SAME_ENTITY', 'PROGRAM_CONCENTRATION', 'RECENT_WIN_MOMENTUM', 'RENTAL_EXPANSION']);
  for (const s of w.intel.signals) checkSignal(s);
  assert.equal(w.intel.activity.trend, 'accelerating');
  const walk = (v, p) => { if (!v || typeof v !== 'object') return; for (const [k, x] of Object.entries(v)) { assert.ok(!/score|rank(?!Basis|ed)|probability/i.test(k), p + '.' + k); walk(x, p + '.' + k); } };
  walk(w.intel, 'intel');
});

console.log('entities-intel: the committed data (read-only)');
const c = Q.load(), top = c.R.developers[0], out = Q.developer(top.id);
t('developer(id) of the top developer keeps every pre-existing key unchanged and gains `intel`', () => {
  for (const k of ['id', 'name', 'canonical', 'kind', 'joint', 'roles', 'aliases', 'companyId', 'companyIdNote', 'tenders', 'tendersRecent', 'lotteries', 'lotteriesRecent', 'tracks', 'construction', 'markets', 'cities',
    'firstActivity', 'lastActivity', 'active', 'sites', 'sitesTotal', 'projects', 'projectsTotal', 'possibleSame', 'basis', 'entries', 'sources', 'coverage', 'freshness', 'methodology']) assert.ok(k in out, k);
  for (const k of ['tenders', 'tendersRecent', 'lotteries', 'lotteriesRecent', 'tracks', 'markets', 'possibleSame', 'construction', 'firstActivity', 'lastActivity', 'basis']) assert.deepEqual(out[k], top[k], k);
  assert.equal(out.sitesTotal, top.sites.length); assert.equal(out.projectsTotal, top.projects.length); assert.equal(out.basis, 'OBSERVED PROPX ACTIVITY');
  assert.ok(out.intel && out.intel.schema === 1); assert.equal(out.intel.identity.id, top.id); assert.equal(out.intel.identity.canonical, top.canonical); assert.deepEqual(out.intel.identity.aliases, top.aliases);
  assert.equal(Q.developer('dev-000000000000'), null);
});
t('the real intel: windows add up to the registry, shares in range, plans joined only through the stored records, every signal in both languages', () => {
  const X = out.intel;
  assert.equal(X.generatedFor, c.today); assert.equal(X.activity.windows.last12.lotsWon + X.activity.lotsOutsideWindows <= top.tenders.lots, true);
  assert.ok(X.markets.geographicConcentration.share > 0 && X.markets.geographicConcentration.share <= 1); assert.equal(X.markets.geographicConcentration.residentialLots, top.sites.length);
  assert.ok(X.programs.subsidizedShare >= 0 && X.programs.subsidizedShare <= 1); assert.equal(X.programs.lots, top.tenders.lots); assert.deepEqual(X.programs.tracks, top.tracks);
  assert.equal(X.landBasis.landPerUnit, top.tenders.landPerUnit); assert.equal(X.landBasis.landTotalCompetitive, top.tenders.landTotalCompetitive);
  assert.ok(X.planning.xplanJoined <= X.planning.plans); assert.ok(X.housing.lotteries === top.lotteries.lotteries && X.housing.applicantsPerUnit > 0);
  assert.ok(X.housing.permittedProjects + X.housing.occupiedProjects <= X.housing.projectsResolved);
  assert.ok(['accelerating', 'steady', 'slowing', 'inactive', 'insufficient'].includes(X.activity.trend));
  for (const s of X.signals) checkSignal(s);
  assert.ok(X.signals.some((s) => s.id === 'POSSIBLE_SAME_ENTITY') === top.possibleSame.length > 0);
  assert.ok(X.entries.rows.every((e) => e.developerId === top.id && e.date >= X.windows.last24.from));
});
t('a rental-track developer joins Dira Lehaskir notices only by tender id; a developer with a market entry carries NEW_MARKET_ENTRY', () => {
  const rentalDev = c.R.developers.find((d) => d.tracks.rental && d.sites.some((id) => { const s = c.projById.get(id); return s && s.track === 'rental'; }));
  if (rentalDev) { const X = Q.developer(rentalDev.id).intel; assert.ok(X.rental.rentalTrackLots >= 1); assert.ok(X.rental.noticesJoined <= X.rental.rentalTrackLots); for (const n of X.rental.notices) assert.ok(rentalDev.sites.some((id) => c.projById.get(id).tenderId === n.tenderId)); }
  const since = c.R.coverage.recentFrom, entered = c.R.entries.find((e) => e.date >= since);
  if (entered) { const X = Q.developer(entered.developerId).intel; assert.ok(X.signals.some((s) => s.id === 'NEW_MARKET_ENTRY')); assert.ok(X.entries.rows.some((e) => e.localityCode === entered.localityCode)); }
});
t('no credential, store address or private-person listing path in the module; the page is untouched by this layer', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/entities/intel.js'), 'utf8');
  assert.doesNotMatch(src, /SITE_PASSWORD|SESSION_SECRET|SERVICE_ROLE|supabase\.co|PROPX_JOB_TOKEN/);
  assert.doesNotMatch(src, /land bank'|total pipeline'|"All developers"|all projects in israel|inactive company/i);
  const q = fs.readFileSync(path.join(ROOT, 'lib/entities/query.js'), 'utf8'); assert.match(q, /intel: devIntel\(e, c, \{ now: opt\.now \|\| c\.today \}\)/);
});

console.log(`entities-intel: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
