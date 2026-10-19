'use strict';
/* HEADLINE METRICS — scope gates (data-integrity audit 19.10.2026).

   The question: is the overview's national "average price" (≈ ₪2.73M) a district figure under a national label? CBS Table 2.2,
   Q2 2026 (the reference supplied with the audit request): Israel total ₪2,435,000 · Central District ₪2,731,500. Lineage (git
   d0f696c, 29.08.2026): the Israel row was ₪2,435,000 — the CBS national total — and became ₪2,730,000 = 2,435,000 × 1.12 (the
   assumed new-build premium, rounded to ₪10,000). It is NOT Central District; the two numbers are only close. These gates keep it so:
   the national row is the national basis × the stated premium, it never takes a district's value, every official headline series is
   read under its national code, and every headline card carries an ⓘ whose registry entry names definition, geography, population,
   period, source, class and what it does not mean.
   PRESENTATION (owner's decision 19.10.2026 — "official first, model second"): the national headline is the CBS figure ₪2,435,000
   (OFFICIAL, all dwelling transactions); the ×1.12 figure (≈ ₪2.73M) follows on its own card as PROPX's new-home ESTIMATE (MODEL),
   its +12% assumption in view. Gates 1–6 below are the six the decision asked for. Since 19.10.2026 (P0 "price cards across all
   geographies") the pair is ONE contract for every level (pricePair; test/price-cards.test.js) and the assumption lives in the ⓘ (level
   2) only — gate 4 now holds it OFF the card. */
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
const M = vm.runInNewContext(`${matched('const PRICE_SRC={')};\n${matched('const PRICE_BASIS={')};\n${matched('const LOCATIONS = [')};\n({PRICE_SRC,PRICE_BASIS,LOCATIONS})`, {});
const LOC = Object.fromEntries(M.LOCATIONS.map((l) => [l.id, l]));
const IL = LOC.il, B = M.PRICE_BASIS.il, SRC = M.PRICE_SRC;
const CBS_REF = { israelTotal: 2435000, centralDistrict: 2731500 };   // CBS Table 2.2, Q2 2026 (read on a PROPX runner, run 39211103296)

console.log('headline metrics: lineage and scope');
at('the national average price = the CBS ISRAEL-TOTAL average × the stated 1.12 premium (₪2,435,000 → ₪2,730,000) — not Central District', () => {
  assert.equal(B.cbs, CBS_REF.israelTotal, 'the national basis is the CBS Israel-total figure');
  assert.notEqual(B.cbs, CBS_REF.centralDistrict, 'never the Central District figure');
  assert.equal(B.geo, 'Israel — total'); assert.equal(B.row, 'Total');
  assert.equal(SRC.premium, 1.12);
  assert.equal(IL.base.price, Math.round(B.cbs * SRC.premium / 1e4) * 1e4);
  assert.equal(IL.base.sqm, Math.round(B.cbsPsm * SRC.premium / 100) * 100);
  assert.equal(IL.type, 'country');
});
at('no district → national leakage: the national row takes no district row\'s value, and every district has its OWN row (never the national one)', () => {
  const districts = M.LOCATIONS.filter((l) => l.type === 'district');
  assert.equal(districts.length, 6);
  for (const d of districts) {
    assert.equal(d.parent, 'il');
    for (const f of ['price', 'sqm', 'rent', 'tx', 'listings']) assert.notEqual(IL.base[f], d.base[f], `national ${f} equals ${d.id}'s`);
    assert.notEqual(d.base.price, B.cbs, d.id + ' carries the national basis');
    assert.ok(M.PRICE_BASIS[d.id] && M.PRICE_BASIS[d.id].cbs !== B.cbs && M.PRICE_BASIS[d.id].code >= 1 && M.PRICE_BASIS[d.id].code <= 6, d.id + ' has its own CBS row');
  }
  assert.equal(M.PRICE_BASIS['d-center'].cbs, CBS_REF.centralDistrict);
  assert.ok(!('code' in B), 'the national row is "Total", not a coded district / locality row');
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
/* ── the national price: OFFICIAL first, MODEL second (owner's decision 19.10.2026) — since the same day the ONE price-pair contract
      for every geography (test/price-cards.test.js); these gates keep the national reading of it ── */
const fnSrc = (name) => matched(`function ${name}(`);
/** the page's own pricePair / vcOf, run over the page's own PRICE_BASIS and LOCATIONS (stubs only for the board's filter state) */
function pagePair({ filters = false, locations = M.LOCATIONS, basis = M.PRICE_BASIS } = {}) {
  const LOCX = Object.fromEntries(locations.map((l) => [l.id, l]));
  const ctx = { PRICE_BASIS: JSON.parse(JSON.stringify(basis)), LOC: LOCX, filtersActive: () => filters, isStatic: () => false, MKT: {}, cbsGeo: () => null, cbsInv: () => null,
    metricsOf: (id) => ({ price: LOCX[id].base.price, sqm: LOCX[id].base.sqm }) };
  vm.runInNewContext(`${fnSrc('pricePair')}\n${fnSrc('vcOf')}\nthis.out={pricePair,vcOf};`, ctx);
  return { ...ctx.out, nat: () => ctx.out.pricePair(LOCX.il) };
}
const KPI = matched('function renderKPIs(');
const CARDS = KPI.slice(KPI.indexOf('const cards=(state.mode==="sale"?['), KPI.indexOf(']).filter(Boolean);'));

console.log('headline metrics: the national price — official first, model second');
at('1 · the Israel headline average price is the official CBS figure ₪2,435,000 (OFFICIAL, Q2 2026, all dwelling transactions)', () => {
  const N = pagePair().nat();
  assert.deepEqual([N.off.show, N.off.v, N.off.cls], [true, CBS_REF.israelTotal, 'raw'], 'the official card value and class');
  assert.equal(SRC.period, '2026-Q2'); assert.equal(SRC.table, '2.2'); assert.match(SRC.pop, /all dwelling transactions, new \+ second-hand/);
  // the first card of the board is card 1 (index 0 = the hero), built only from pricePair().off — at every level, Israel included
  assert.match(KPI, /\]\)\.filter\(Boolean\);/);
  assert.match(CARDS, /^const cards=\(state\.mode==="sale"\?\[\n    PP\.off\.show\?\{k:"offPrice",l:t\.offPriceL\(place\),v:PP\.off\.v,f:fmtNIS,vc:PP\.off\.cls,s:t\.offPriceS,b:t\.offPriceB\(place,PP\.B,l\.type\),xp:"cbs_average_transaction_price",pop:"all"\}/);
  assert.match(KPI, /const PP=state\.mode==="sale"\?pricePair\(l\):null/);
  assert.match(KPI, /\$\{i===0\?"hero":/, 'the first card is the hero');
  assert.match(INDEX, /offPriceL:p=>`Average transaction price — \$\{p\}`,offPrice0:"Average transaction price \(all dwellings\)",offPriceS:"Q2 2026 · CBS Table 2\.2"/);
  assert.match(INDEX, /offPriceL:p=>`מחיר עסקה ממוצע — \$\{p\}`,offPrice0:"מחיר עסקה ממוצע \(כלל הדירות\)",offPriceS:"רבעון ב׳ 2026 · הלמ״ס, לוח 2\.2"/);
  const x = X.level2('cbs_average_transaction_price', 'en');
  assert.equal(x.cls, 'OFFICIAL'); assert.equal(x.formula, null);
  assert.match(x.short, /all dwelling transactions — new and second-hand — in the selected geography, per CBS \(Table 2\.2, Q2 2026\)/);
  assert.match(x.population, /new and second-hand dwellings together/);
  assert.ok(INDEX.indexOf('<div class="ap-off">') < INDEX.indexOf('<div class="ap-est">'), 'official first in the profile card too');
});
at('2 · the modelled new-home estimate can never replace the official headline (not its value, not its place, not under a filter)', () => {
  const S = fnSrc('pricePair');
  assert.match(S, /v:B\.cbs,cls:"raw"/, 'the official value is read from the citation only');
  assert.ok(!/base\.price|LOCATIONS/.test(S.slice(0, S.indexOf('return{B,off'))), 'the official value never reads the board row');
  const moved = M.LOCATIONS.map((l) => (l.id === 'il' ? { ...l, base: { ...l.base, price: 9990000 } } : l));
  assert.equal(pagePair({ locations: moved }).nat().off.v, CBS_REF.israelTotal);
  assert.equal(pagePair({ locations: moved }).nat().est.v, 9990000);
  const F = pagePair({ filters: true }).nat();
  assert.equal(F.off.show, false); assert.equal(F.off.why, 'filter');
  assert.match(CARDS, /:PP\.off\.why==="filter"\?\{k:"offPrice",l:t\.offPriceL\(place\),na:t\.offNaFilt,xp:"cbs_average_transaction_price",pop:"all"\}/);
  assert.match(CARDS, /pop:"all"\},\n    \{k:"price",l:t\.nhEstL\(place\),/, 'the estimate card comes second, after the official one');
  assert.ok(!/k:"offPrice"[^\n]*m\.price/.test(CARDS), 'the official card never takes the board value');
});
at('3 · the modelled estimate is classified MODEL (the card, the profile, the registry) — never DERIVED, never OFFICIAL — at every level', () => {
  const P = pagePair();
  for (const l of M.LOCATIONS) { assert.equal(P.vcOf(l, 'price'), 'mod', l.id); assert.equal(P.vcOf(l, 'sqm'), 'mod', l.id); assert.equal(P.pricePair(l).est.cls, 'mod', l.id); }
  for (const d of M.LOCATIONS.filter((l) => l.type === 'district')) assert.equal(P.vcOf(d, 'price', true), 'der', 'the capital model\'s data basis keeps its own reading: ' + d.id);
  assert.match(CARDS, /\{k:"price",l:t\.nhEstL\(place\),v:PP\.est\.v,f:v=>"≈ "\+fmtCompact\(v\),vc:PP\.est\.cls,[^\n]*xp:"new_home_price_estimate",pop:"est"\}/);
  assert.match(CARDS, /\{k:"sqm",l:t\.psmEst,[^\n]*xp:"new_home_price_per_sqm_estimate",pop:"est"\}/);
  for (const id of ['new_home_price_estimate', 'new_home_price_per_sqm_estimate']) assert.equal(X.level2(id, 'en').cls, 'MODEL', id);
  const e = X.level2('new_home_price_estimate', 'en');
  assert.equal(e.short, 'This is a PROPX estimate of the average price of a new dwelling for the selected geography.');
  assert.match(e.notAs, /Not an official CBS published average new-home price/);
  assert.match(e.formula, /Israel: ₪2,435,000 × 1\.12 = ₪2,727,200 → ₪2,730,000/);
  assert.equal(IL.base.price, Math.round(B.cbs * SRC.premium / 1e4) * 1e4, 'the formula is the stored value');
  assert.match(INDEX, /<div class="ap-l">\$\{t\.nhEstL\(heName\(l\)\)\} \$\{vcTag\(PP\.est\.cls\)\}<\/div>/);
});
at('4 · the +12% assumption is NOT on the card (owner\'s decision 19.10.2026) — it is in the ⓘ, level 2 (methodology · formula · inputs)', () => {
  assert.ok(!/premPct|basisIl|nhEstS\(/.test(INDEX), 'the formula-bearing card strings are gone');
  assert.match(INDEX, /nhEstS:"New dwelling · model — not an official figure"/);
  assert.match(INDEX, /nhEstS:"דירה חדשה · מודל — לא נתון רשמי"/);
  const e = X.level2('new_home_price_estimate', 'en'), h = X.level2('new_home_price_estimate', 'he');
  assert.ok(!/12%|1\.12/.test(e.short + h.short), 'not at level 1');
  assert.match(e.methodology, /a stated 12% new-build premium/); assert.match(h.methodology, /פרמיית דירה חדשה מוצהרת של 12%/);
  assert.ok(e.inputs.some((i) => /\+12% new-build premium \(assumption\)/.test(i)));
});
at('5 · the two populations are named and look different: "all dwellings — new + second-hand" (solid) vs "PROPX estimate" (dashed)', () => {
  assert.match(INDEX, /popAll:"All dwellings — new \+ second-hand",popEst:"PROPX estimate"/);
  assert.match(INDEX, /popAll:"כלל הדירות — חדשות \+ יד שנייה",popEst:"הערכת PROPX"/);
  assert.match(KPI, /\$\{c\.pop\?" pop-"\+c\.pop:""\}/, 'the card carries its population class');
  assert.match(KPI, /\$\{c\.pop\?`<span class="kpop \$\{c\.pop\}">\$\{c\.pop==="all"\?t\.popAll:t\.popEst\}<\/span>`:""\}/, 'and prints its population');
  const css = (sel) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(INDEX); assert.ok(m, sel); return m[1]; };
  assert.notEqual(css('.kpi .kpop.all'), css('.kpi .kpop.est'));
  assert.match(css('.kpi.pop-est'), /border-style:dashed/);
  assert.match(css('.kpi .kpop.est'), /dashed/);
  assert.ok(!/dashed/.test(css('.kpi .kpop.all')));
  assert.match(INDEX, /\.ap-est\{border-inline-start:1px dashed/);
});
at('6 · district values can never populate the national headline (nor the national estimate)', () => {
  assert.notEqual(pagePair().nat().off.v, CBS_REF.centralDistrict);
  const poisonedLoc = M.LOCATIONS.map((l) => (l.type === 'district' ? { ...l, base: { ...l.base, price: CBS_REF.centralDistrict, sqm: 99999 } } : l));
  const poisonedBasis = Object.fromEntries(Object.entries(M.PRICE_BASIS).map(([k, v]) => [k, k.startsWith('d-') ? { ...v, cbs: 9999900 } : v]));
  const N = pagePair({ locations: poisonedLoc, basis: poisonedBasis }).nat();
  assert.equal(N.off.v, CBS_REF.israelTotal); assert.equal(N.est.v, IL.base.price);
  const S = fnSrc('pricePair');
  assert.ok(/PRICE_BASIS\[l\.id\]/.test(S) && !/parent|LOC\[/.test(S), 'the citation is the geography\'s own row only');
  assert.match(X.level2('cbs_average_transaction_price', 'en').geography, /Central District \(₪2,731,500\) is a different row from Israel \(₪2,435,000\)/);
});
at('every headline card with a value carries an ⓘ whose registry entry gives definition · geography · population · period · source · class · what it does not mean', () => {
  const cards = [...KPI.matchAll(/\{k:"(\w+)"[^\n]*/g)].map((m) => m[0]);
  const withValue = cards.filter((c) => !/^\{k:"\w+",l:[^,]+,na:/.test(c));
  assert.ok(withValue.length >= 11, 'cards ' + withValue.length);   // one price-card variant per card now (no Israel-only branch)
  for (const c of withValue) assert.match(c, /xp:("\w+"|yoyXp)/, c.slice(0, 60));
  const ids = new Set([...KPI.matchAll(/xp:"(\w+)"/g)].map((m) => m[1]).concat(['new_homes_price_index_change', 'board_annual_change_estimate']));
  for (const id of ['cbs_average_transaction_price', 'new_home_price_estimate', 'new_home_price_per_sqm_estimate']) assert.ok(ids.has(id), id);
  for (const id of ids) {
    for (const L of ['he', 'en']) {
      const x = X.level2(id, L); assert.ok(x, id);
      for (const k of ['title', 'short', 'geography', 'population', 'period', 'notAs']) assert.ok(x[k] && String(x[k]).trim(), `${id}.${k} (${L})`);
      assert.ok(x.sources.length && x.cls, id + ' source / class');
    }
  }
  assert.equal(X.level2('new_homes_price_index_change', 'en').cls, 'OFFICIAL');
  assert.equal(X.level2('board_average_rent', 'en').cls, 'MODEL', 'the ×1.08 rent premium is a model, as the board classes it');
  const TC = require('../lib/trust/catalog').catalog().sources.find((s) => s.id === 'cbs:average-dwelling-price');
  assert.ok(TC && TC.classification === 'TRANSCRIBED' && TC.sync.state === 'NO_RUN' && /18 big cities/.test(TC.geography));
});
at('the index change is labelled as the new-homes INDEX (a different series and period), and no longer sits under any price card', () => {
  assert.match(INDEX, /const idxLbl=f=>f==="yoy"&&l\.id==="il"&&MKT\.nh\?t\.nhIdxLbl:t\.yoyLbl;/);
  assert.match(INDEX, /nhIdxLbl:"מדד מחירי דירות חדשות · שינוי שנתי"/);
  assert.match(INDEX, /nhIdxLbl:"New-homes price index · annual change"/);
  assert.ok(!/k:"offPrice"[^\n]*\bd:/.test(CARDS) && !/\{k:"price"[^\n]*\bd:m\.yoy/.test(CARDS), 'no delta on either price card');
});

console.log(`headline metrics: ${n} passed`);
