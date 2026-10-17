'use strict';
/* PROPX · Land Economics 2.0 (lib/land/economics.js) — the gates.
 *
 * Three universes never averaged together (competitive-bid open-market ₪/unit · ₪/m² bids on subsidized tracks · tender
 * outcomes); quartiles only over ≥ 5 lots; a window comparison only when both windows hold ≥ 5 lots, with a lot-mix warning;
 * re-tenders only through the Authority's lot file id; the largest winner by exact name; a locality carries its district's
 * block of the same universe as context; nominal consideration — never a land value or an all-in cost. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../lib/land/economics');
const LQ = require('../lib/land/query');
const D = require('../lib/dossier/query');
const N = require('../lib/dossier/narrative');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = Date.parse('2026-10-17T12:00:00Z');
const IL = E.economics({ level: 'il', now: NOW }), TA = E.economics({ level: 'district', code: 'd-ta', now: NOW }), TLV = E.economics({ level: 'locality', code: '5000', now: NOW }), HOLON = E.economics({ level: 'locality', code: '6600', now: NOW });

console.log('land economics: module');
t('pure and read-only; version stamped; unknown geography → null; the three universes are separate objects with their own basis', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/land/economics.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random|child_process/.test(src));
  assert.equal(E.VERSION.id, 'propx-land-economics-v1'); assert.equal(E.economics({ level: 'locality', code: '0', now: NOW }), null); assert.equal(E.economics({ level: 'district', code: 'd-nope', now: NOW }), null);
  for (const e of [IL, TA, TLV]) { assert.ok(e.competitiveBid.basis.he && e.perSqmBid.basis.he && e.outcomes.basis.he); assert.equal(e.competitiveBid.cls, 'DERIVED'); assert.equal(e.outcomes.cls, 'OFFICIAL'); assert.equal(e.concentration.cls, 'OBSERVED'); assert.match(e.basis.en, /never averaged together/); }
});
t('the competitive-bid block is the land read model\'s own landPerUnitOver over open-market lots decided in the window: same lots, same quartiles; p25 ≤ median ≤ p75; the unit-weighted figure = Σ sums ÷ Σ units', () => {
  const C = LQ.load(); const dd = (r) => r.committeeDate || r.lotteryDate || r.closeDate || r.publishedDate || null;
  const rows = C.live.filter((r) => String(r.localityCode) === '5000' && dd(r) && String(dd(r)).slice(0, 10) >= IL.window.from);
  const over = LQ.landPerUnitOver(rows, { from: IL.window.from, to: IL.window.to, dateField: 'decision' });
  const c = TLV.competitiveBid.current; assert.equal(c.lots, over.lots); assert.equal(c.median, over.medianLotPerUnit); assert.equal(c.unitWeighted, over.perUnit); assert.deepEqual(c.tracks, ['open-market']); assert.equal(c.basis, 'competitive-bid');
  for (const e of [IL, TA, TLV]) { const b = e.competitiveBid.current; if (b.median != null) { assert.ok(b.p25 <= b.median && b.median <= b.p75, e.geo.code); assert.ok(b.lots >= E.MIN_N); } assert.match(b.formula, /Σ winning sums ÷ Σ units/); assert.equal(b.period.dateField, 'decision'); }
  assert.equal(IL.window.months, 36); assert.ok(IL.window.priorFrom < IL.window.from && IL.window.from < IL.window.to);
});
t('quartiles only over ≥ 5 lots (Holon: 1 lot → median null, flagged small, the unit-weighted figure kept with its n); a window change only when both windows hold ≥ 5 lots; a lot-mix warning when the mean units per lot doubles or halves', () => {
  const h = HOLON.competitiveBid; assert.ok(h.current.lots < E.MIN_N); assert.equal(h.current.median, null); assert.equal(h.current.small, true); assert.ok(h.current.unitWeighted != null); assert.equal(h.change.small, true); assert.equal(h.change.medianPct, null); assert.ok(h.change.reason.en);
  assert.ok(HOLON.missing.some((m) => m.id === 'small_sample'));
  const il = IL.competitiveBid; assert.equal(il.change.small, false); assert.ok(Number.isFinite(il.change.medianPct)); assert.match(il.change.formula, /prior median/);
  const BS = E.economics({ level: 'locality', code: '9000', now: NOW }); const ch = BS.competitiveBid.change; if (!ch.small) { const r = BS.competitiveBid.current.meanUnitsPerLot / BS.competitiveBid.prior.meanUnitsPerLot; assert.equal(!!ch.mixWarning, r >= 2 || r <= 0.5, 'mix warning rule'); }
});
t('₪/m² bids are a separate universe: never inside the competitive-bid block; an empty window names the track\'s latest decision instead of 0', () => {
  for (const e of [IL, TA, TLV]) { assert.ok(!('perSqm' in e.competitiveBid)); const P = e.perSqmBid; if (!P.lots) { assert.equal(P.median, null); assert.ok(P.reason && P.reason.en); if (P.latestDecision) assert.match(P.reason.en, new RegExp(P.latestDecision)); } else assert.ok(P.lots < E.MIN_N ? P.median == null : P.p25 <= P.median); }
  assert.match(IL.perSqmBid.basis.en, /never averaged/);
});
t('outcomes = the dossier\'s failed-tender rule over the tenders PUBLISHED in the window: (decided without a winner + cancelled) ÷ published; "decided — not read" never counts as failed; re-tenders only through the lot file (same-parcel excluded); the largest winner by exact name with its share', () => {
  for (const e of [IL, TA, TLV]) { const O = e.outcomes; if (O.tenders) { assert.equal(O.failedRatio, Math.round(((O.decidedWithoutWinner + O.cancelled) / O.tenders) * 1000) / 1000); assert.equal(O.period.dateField, 'published'); }
    const R = e.reTenders; assert.ok(!('same-parcel' in (R.relations || {}))); assert.ok(R.tenders == null || R.tenders <= R.ofTenders); assert.match(R.basis.en, /never by name or geometry/);
    const K = e.concentration; if (K.top) { assert.ok(K.top.lots <= K.lots); assert.equal(K.top.share, Math.round((K.top.lots / K.lots) * 1000) / 10); assert.ok(/[֐-׿]/.test(K.top.name)); } }
  assert.ok(IL.reTenders.tenders > 0 && IL.reTenders.relations['re-tender'] > 0, 'national re-tenders exist');
});
t('a locality carries its district\'s block of the same universe as context (never the reverse); the district and national reads carry none', () => {
  assert.ok(TLV.districtContext && TLV.districtContext.district === 'd-ta' && TLV.districtContext.current.lots === TA.competitiveBid.current.lots && TLV.districtContext.current.median === TA.competitiveBid.current.median);
  assert.equal(TA.districtContext, null); assert.equal(IL.districtContext, null);
  assert.match(TLV.districtContext.scope.en, /context only/);
});
t('nominal consideration, never a land value or an all-in cost: the missing list says so with a registry reason; private land is not observed', () => {
  for (const e of [IL, TLV]) { const ids = e.missing.map((m) => m.id); assert.ok(ids.includes('development-costs') && ids.includes('private-land')); for (const id of ids) assert.ok(X.missing(id), id); }
  for (const id of ['land_cost_quartiles', 'land_cost_change', 'per_sqm_bid_level', 'tender_outcomes', 're_tender_share']) { const T = X.term(id); assert.ok(T && T.cls === 'DERIVED' && T.formula, id); assert.match(T.notAs.en, /land value|land price|market price|double supply|open-market demand/i, id); }
});
t('the dossier carries the read as sections.landEconomics (additive — every prior section unchanged); the narrative states it in one DERIVED sentence only with ≥ 5 lots; the page renders the block from the dossier', () => {
  const d = D.dossier({ level: 'locality', code: '5000', now: NOW }); assert.ok(d.sections.landEconomics && d.sections.landEconomics.competitiveBid); for (const k of ['sales', 'land', 'housing', 'renewal', 'rental', 'developers', 'macro', 'changes']) assert.ok(d.sections[k], k);
  const s = N.narrative(d, {}).sentences.find((x) => x.id === 'land-economics'); assert.ok(s && s.cls === 'DERIVED' && s.term === 'land_cost_quartiles' && /median ₪[\d,]+ per unit/.test(s.en) && /not a land value/.test(s.en), s && s.en);
  const h = D.dossier({ level: 'locality', code: '6600', now: NOW }); assert.ok(!N.narrative(h, {}).sentences.some((x) => x.id === 'land-economics'), 'no sentence under 5 lots');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.match(page, /function dsLandEconHTML\(D\)/); assert.match(page, /\$\{dsLandEconHTML\(D\)\}/); assert.match(page, /dsLe:\{title:"כלכלת קרקע/); assert.match(page, /dsLe:\{title:"Land economics/); assert.ok(!/view=landEconomics/.test(page), 'no separate fetch');
});
t('deterministic and cheap: the same inputs give the same read; the national read in bounded time', () => {
  assert.deepEqual(E.economics({ level: 'district', code: 'd-north', now: NOW }), E.economics({ level: 'district', code: 'd-north', now: NOW }));
  const t0 = Date.now(); E.economics({ level: 'il', now: NOW }); E.economics({ level: 'district', code: 'd-center', now: NOW }); assert.ok(Date.now() - t0 < 4000);
});
console.log(`land economics: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`); process.exit(failed ? 1 : 0);
