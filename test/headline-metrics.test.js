'use strict';
/* HEADLINE METRICS — scope gates (data-integrity audit 19.10.2026).

   The question: is the overview's national "average price" (≈ ₪2.73M) a district figure under a national label? CBS Table 2.2,
   Q2 2026 (the reference supplied with the audit request): Israel total ₪2,435,000 · Central District ₪2,731,500. Lineage (git
   d0f696c, 29.08.2026): the Israel row was ₪2,435,000 — the CBS national total — and became ₪2,730,000 = 2,435,000 × 1.12 (the
   assumed new-build premium, rounded to ₪10,000). It is NOT Central District; the two numbers are only close. These gates keep it so:
   the national row is the national basis × the stated premium, it never takes a district's value, every official headline series is
   read under its national code, and every headline card carries an ⓘ whose registry entry names definition, geography, population,
   period, source, class and what it does not mean. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const X = require('../lib/explain/registry.js');
const CBS_SERIES = require('../lib/cbs-sales/series.js');

let n = 0; const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const matched = (anchor) => {
  const i = INDEX.indexOf(anchor); assert.ok(i >= 0, 'missing ' + anchor);
  const open = INDEX.indexOf(anchor.endsWith('[') ? '[' : '{', i + anchor.length - 1), close = { '{': '}', '[': ']' }[INDEX[open]];
  let depth = 0;
  for (let k = open; k < INDEX.length; k++) { if (INDEX[k] === INDEX[open]) depth++; else if (INDEX[k] === close && --depth === 0) return INDEX.slice(i, k + 1); }
  throw new Error('unbalanced ' + anchor);
};
const M = vm.runInNewContext(`${matched('const PRICE_BASIS={')};\n${matched('const LOCATIONS = [')};\n({PRICE_BASIS,LOCATIONS})`, {});
const LOC = Object.fromEntries(M.LOCATIONS.map((l) => [l.id, l]));
const IL = LOC.il, B = M.PRICE_BASIS.il;
const CBS_REF = { israelTotal: 2435000, centralDistrict: 2731500 };   // CBS Table 2.2, Q2 2026, as supplied with the audit request

console.log('headline metrics: lineage and scope');
at('the national average price = the CBS ISRAEL-TOTAL average × the stated 1.12 premium (₪2,435,000 → ₪2,730,000) — not Central District', () => {
  assert.equal(B.cbs, CBS_REF.israelTotal, 'the national basis is the CBS Israel-total figure');
  assert.notEqual(B.cbs, CBS_REF.centralDistrict, 'never the Central District figure');
  assert.equal(B.geo, 'Israel — total');
  assert.equal(B.premium, 1.12);
  assert.equal(IL.base.price, Math.round(B.cbs * B.premium / 1e4) * 1e4);
  assert.equal(IL.base.sqm, Math.round(B.cbsPsm * B.premium / 100) * 100);
  assert.equal(IL.type, 'country');
});
at('no district → national leakage: the national row takes no district row\'s value, and no district carries the national basis', () => {
  const districts = M.LOCATIONS.filter((l) => l.type === 'district');
  assert.equal(districts.length, 6);
  for (const d of districts) {
    assert.equal(d.parent, 'il');
    for (const f of ['price', 'sqm', 'rent', 'tx', 'listings']) assert.notEqual(IL.base[f], d.base[f], `national ${f} equals ${d.id}'s`);
    assert.notEqual(d.base.price, B.cbs, d.id + ' carries the national basis');
    assert.ok(!M.PRICE_BASIS[d.id], 'a district has no national basis entry');
  }
  assert.deepEqual(Object.keys(M.PRICE_BASIS), ['il'], 'only the national row has a recorded basis');
});
at('official headline series are read under the national code: CBS 5069 "Israel — total" → il; districts 5070–5076 never map to il', () => {
  const nat = CBS_SERIES.GEOS.filter((g) => g.key === 'il');
  assert.deepEqual(nat.map((g) => [g.cbs, g.level, g.en]), [[5069, 'national', 'Israel — total']]);
  for (const g of CBS_SERIES.GEOS.filter((x) => x.cbs !== 5069)) { assert.equal(g.level, 'district'); assert.notEqual(g.key, 'il'); }
  for (const m of ['inventory', 'months_supply']) assert.deepEqual(CBS_SERIES.MEASURES[m].geos, [5069], m + ' is national only');
  global.window = {};
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'data/cbs-sales/latest.js'), 'utf8'));
  const S = global.window.PROPX_CBS_SALES;
  assert.equal(S.geos.il.cbs, 5069); assert.equal(S.geos.il.level, 'national');
  for (const [k, g] of Object.entries(S.geos)) if (k !== 'il') assert.notEqual(g.cbs, 5069, k);
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'data/market/latest.js'), 'utf8'));
  const nh = global.window.PROPX_MARKET.indicators.newHomesIndex;
  assert.equal(nh.series.code, '70000', 'the national new-homes price index');
});
at('the overview cards name their basis: the national price card says "Israel — total (not a district)", all dwellings, the premium as an assumption', () => {
  assert.match(INDEX, /basisIl:\(v,p\)=>`Israel — total \(not a district\) · CBS average of all dwellings, new and second-hand: \$\{v\}, Q2 2026 · × \$\{p\} new-build premium \(assumption\)`/);
  assert.match(INDEX, /basisIl:\(v,p\)=>`ישראל — כלל הארץ \(לא מחוז\) · ממוצע הלמ״ס לכל הדירות, חדשות ויד שנייה: \$\{v\}, רבעון ב׳ 2026 · × \$\{p\} פרמיית דירה חדשה \(הנחה\)`/);
  assert.match(INDEX, /const basisOf=f=>filtersActive\(\)\?t\.basisFiltered:B\?/);
  assert.match(INDEX, /\{k:"price",l:t\.avgPrice,[^\n]*b:basisOf\("price"\),xp:"board_average_price"\}/);
  assert.match(INDEX, /\{k:"sqm",l:t\.psm,[^\n]*b:basisOf\("sqm"\),xp:"board_price_per_sqm"\}/);
});
at('the index change under the price is labelled as the new-homes INDEX (a different series and period), never as the price\'s own change', () => {
  assert.match(INDEX, /const idxLbl=f=>f==="yoy"&&l\.id==="il"&&MKT\.nh\?t\.nhIdxLbl:t\.yoyLbl;/);
  assert.match(INDEX, /nhIdxLbl:"מדד מחירי דירות חדשות · שינוי שנתי"/);
  assert.match(INDEX, /nhIdxLbl:"New-homes price index · annual change"/);
});
at('every headline card with a value carries an ⓘ whose registry entry gives definition · geography · population · period · source · class · what it does not mean', () => {
  const body = matched('function renderKPIs(');
  const cards = [...body.matchAll(/\{k:"(\w+)"[^\n]*/g)].map((m) => m[0]);
  const withValue = cards.filter((c) => !/na:t\.naMedianWhy/.test(c));
  assert.ok(withValue.length >= 10, 'cards ' + withValue.length);
  for (const c of withValue) assert.match(c, /xp:("\w+"|yoyXp)/, c.slice(0, 60));
  const ids = new Set([...body.matchAll(/xp:"(\w+)"/g)].map((m) => m[1]).concat(['new_homes_price_index_change', 'board_annual_change_estimate']));
  for (const id of ids) {
    for (const L of ['he', 'en']) {
      const x = X.level2(id, L); assert.ok(x, id);
      for (const k of ['title', 'short', 'geography', 'population', 'period', 'notAs']) assert.ok(x[k] && String(x[k]).trim(), `${id}.${k} (${L})`);
      assert.ok(x.sources.length && x.cls, id + ' source / class');
    }
  }
  assert.match(X.level2('board_average_price', 'en').notAs, /not the Central District \(or any district\)/);
  assert.match(X.level2('board_average_price', 'en').population, /all dwellings sold/);
  assert.equal(X.level2('new_homes_price_index_change', 'en').cls, 'OFFICIAL');
  assert.equal(X.level2('board_average_rent', 'en').cls, 'MODEL', 'the ×1.08 rent premium is a model, as the board classes it');
});

console.log(`headline metrics: ${n} passed`);
