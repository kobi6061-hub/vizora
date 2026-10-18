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
   its +12% assumption in view. Gates 1–6 below are the six the decision asked for. */
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
/* ── the national price: OFFICIAL first, MODEL second (owner's decision 19.10.2026) ── */
const fnSrc = (name) => matched(`function ${name}(`);
const constSrc = (name) => { const i = INDEX.indexOf(`const ${name}=`); assert.ok(i >= 0, name); return INDEX.slice(i, INDEX.indexOf('\n', i)); };
/** the page's own natPrice / premPct / vcOf, run over the page's own PRICE_BASIS and LOCATIONS (stubs only for the board's filter state) */
function pageNat({ filters = false, locations = M.LOCATIONS } = {}) {
  const LOCX = Object.fromEntries(locations.map((l) => [l.id, l]));
  const ctx = { ltr: (x) => '\u2066' + x + '\u2069', PRICE_BASIS: JSON.parse(JSON.stringify(M.PRICE_BASIS)), LOC: LOCX, filtersActive: () => filters, isStatic: () => false, MKT: {}, cbsGeo: () => null, cbsInv: () => null,
    metricsOf: (id) => ({ price: LOCX[id].base.price, sqm: LOCX[id].base.sqm }) };
  vm.runInNewContext(`${constSrc('premPct')}\n${fnSrc('natPrice')}\n${fnSrc('vcOf')}\nthis.out={natPrice,premPct,vcOf};`, ctx);
  return ctx.out;
}
const KPI = matched('function renderKPIs(');
const CARDS = KPI.slice(KPI.indexOf('const cards=(state.mode==="sale"?['), KPI.indexOf(']).filter(Boolean);'));

console.log('headline metrics: the national price — official first, model second');
at('1 · the Israel headline average price is the official CBS figure ₪2,435,000 (OFFICIAL, Q2 2026, all dwelling transactions)', () => {
  const N = pageNat().natPrice();
  assert.deepEqual([N.off.show, N.off.v, N.off.cls], [true, CBS_REF.israelTotal, 'raw'], 'the official card value and class');
  assert.equal(B.period, '2026-Q2'); assert.equal(B.table, '2.2'); assert.match(B.pop, /all dwelling transactions, new \+ second-hand/);
  // the first card of the national board is the official one (index 0 = the hero), built only from natPrice().off
  assert.match(KPI, /\]\)\.filter\(Boolean\);/, 'the absent card is dropped from BOTH lists (sale and rent), not only the last one');
  assert.match(CARDS, /^const cards=\(state\.mode==="sale"\?\[\n    NAT&&\(NAT\.off\.show\?\{k:"offPrice",l:t\.offPriceL,v:NAT\.off\.v,f:fmtNIS,vc:NAT\.off\.cls,s:t\.offPriceS,b:t\.offPriceB,xp:"cbs_average_transaction_price",pop:"all"\}/);
  assert.match(KPI, /const NAT=state\.mode==="sale"&&l\.id==="il"\?natPrice\(\):null;/);
  assert.match(KPI, /\$\{i===0\?"hero":/, 'the first card is the hero');
  assert.match(INDEX, /offPriceL:"Average transaction price — Israel",offPriceS:"Q2 2026 · CBS Table 2\.2"/);
  assert.match(INDEX, /offPriceL:"מחיר עסקה ממוצע — ישראל",offPriceS:"רבעון ב׳ 2026 · הלמ״ס, לוח 2\.2"/);
  const x = X.level2('cbs_average_transaction_price', 'en');
  assert.equal(x.cls, 'OFFICIAL'); assert.equal(x.formula, null);
  assert.match(x.short, /₪2,435,000 in Q2 2026 \(Table 2\.2, the "Israel — total" row\)/);
  assert.match(x.population, /new and second-hand dwellings together/);
  // the profile card says the same, in the same order
  assert.match(INDEX, /const NP=sale&&l\.id==="il"\?natPrice\(\):null;/);
  assert.ok(INDEX.indexOf('<div class="ap-off">') < INDEX.indexOf('<div class="ap-est">'), 'official first in the profile card too');
});
at('2 · the modelled new-home estimate can never replace the official headline (not its value, not its place, not under a filter)', () => {
  const S = fnSrc('natPrice');
  assert.match(S, /v:B\.cbs,cls:"raw"/, 'the official value is read from the citation only');
  assert.ok(!/base\.price|LOCATIONS/.test(S.slice(0, S.indexOf('return{B,off'))), 'the official value never reads the board row');
  // move the estimate: the official headline does not move
  const moved = M.LOCATIONS.map((l) => (l.id === 'il' ? { ...l, base: { ...l.base, price: 9990000 } } : l));
  assert.equal(pageNat({ locations: moved }).natPrice().off.v, CBS_REF.israelTotal);
  assert.equal(pageNat({ locations: moved }).natPrice().est.v, 9990000);
  // a filter never splits the official figure — the card shows "—" with the reason, never the filtered estimate
  const F = pageNat({ filters: true }).natPrice();
  assert.equal(F.off.show, false);
  assert.match(CARDS, /:\{k:"offPrice",l:t\.offPriceL,na:t\.offNaFilt,pop:"all"\}\),\n    NAT\?\{k:"price",l:t\.nhEstL,/, 'the estimate card comes second, after the official one');
  assert.ok(!/k:"offPrice"[^\n]*m\.price/.test(CARDS), 'the official card never takes the board value');
  assert.equal(X.level2('board_average_price', 'en').cls, 'DERIVED', 'the area card (districts / cities) is a different term');
});
at('3 · the modelled estimate is classified MODEL (the card, the profile, the registry) — never DERIVED, never OFFICIAL', () => {
  const P = pageNat();
  assert.equal(P.vcOf(M.LOCATIONS.find((l) => l.id === 'il'), 'price'), 'mod');
  assert.equal(P.vcOf(M.LOCATIONS.find((l) => l.id === 'il'), 'sqm'), 'mod');
  assert.equal(P.natPrice().est.cls, 'mod');
  for (const d of M.LOCATIONS.filter((l) => l.type === 'district')) assert.equal(P.vcOf(d, 'price'), 'der', 'district rows keep their class (the capital model reads it): ' + d.id);
  assert.match(CARDS, /NAT\?\{k:"price",l:t\.nhEstL,v:m\.price,f:v=>"≈ "\+fmtCompact\(v\),vc:vcOf\(l,"price"\),[^\n]*xp:"new_home_price_estimate",pop:"est"\}/);
  assert.match(CARDS, /\{k:"sqm",l:NAT\?t\.psmEst:t\.psm,[^\n]*xp:NAT\?"new_home_price_per_sqm_estimate":"board_price_per_sqm",pop:NAT\?"est":null\}/);
  for (const id of ['new_home_price_estimate', 'new_home_price_per_sqm_estimate']) assert.equal(X.level2(id, 'en').cls, 'MODEL', id);
  const e = X.level2('new_home_price_estimate', 'en');
  assert.match(e.short, /CBS does not publish this figure as the official national average price of a new dwelling/);
  assert.match(e.notAs, /Not an official figure; not CBS's average price of a new dwelling/);
  assert.equal(e.formula, '₪2,435,000 × 1.12 = ₪2,727,200 → rounded to ₪10,000 = ₪2,730,000');
  assert.equal(IL.base.price, Math.round(B.cbs * B.premium / 1e4) * 1e4, 'the formula is the stored value');
  assert.match(INDEX, /<div class="ap-l">\$\{t\.nhEstL\} \$\{vcTag\(NP\.est\.cls\)\}<\/div>/);
});
at('4 · the +12% assumption is visible on the estimate card, its basis line, the profile card and the ⓘ', () => {
  const P = pageNat();
  assert.equal(P.premPct(B), '\u2066+12%\u2069', '"+12%", isolated left-to-right for the Hebrew page');
  assert.match(CARDS, /s:t\.nhEstS\(NAT\.B\.premium,premPct\(NAT\.B\)\)/, 'the card line names the premium');
  assert.match(KPI, /t\.basisIl\(fmtNIS\(B\.cbs\),B\.premium,premPct\(B\)\)/);
  const he = vm.runInNewContext(`(${/nhEstS:(\(p,pct\)=>`[^`]*`)/.exec(INDEX.slice(INDEX.indexOf('offPriceL:"מחיר')))[1]})`);
  const en = vm.runInNewContext(`(${/nhEstS:(\(p,pct\)=>`[^`]*`)/.exec(INDEX.slice(INDEX.indexOf('offPriceL:"Average')))[1]})`);
  assert.equal(en(1.12, '+12%'), 'official average × 1.12 · assumed +12% new-build premium');
  assert.match(he(1.12, '+12%'), /× 1\.12 · הנחה: \+12% לדירה חדשה/);
  assert.match(INDEX, /basisIl:\(v,p,pct\)=>`PROPX estimate: \$\{v\} \(CBS, all dwellings, Israel — total, Q2 2026\) × \$\{p\} — an assumed \$\{pct\} new-build premium\. CBS does not publish this figure as the national average price of a new dwelling\.`/);
  assert.match(INDEX, /\$\{t\.nhEstS\(NP\.B\.premium,premPct\(NP\.B\)\)\} · \$\{t\.popEst\}/, 'the profile card names it too');
  assert.match(X.level2('new_home_price_estimate', 'en').short, /an assumed \+12% new-build premium/);
  assert.match(X.level2('new_home_price_estimate', 'he').short, /פרמיה של \u2066?\+12%\u2069? לדירה חדשה/);
});
at('5 · the two populations are named and look different: "all dwelling transactions" (solid) vs "new homes · PROPX estimate" (dashed)', () => {
  assert.match(INDEX, /popAll:"All dwelling transactions · new \+ second-hand",popEst:"New homes · PROPX estimate — not an official figure"/);
  assert.match(INDEX, /popAll:"כל עסקאות הדירות · חדשות \+ יד שנייה",popEst:"דירה חדשה · אומדן PROPX — לא נתון רשמי"/);
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
  assert.notEqual(pageNat().natPrice().off.v, CBS_REF.centralDistrict);
  // give every district the Central District figure and the national figure: the national pair does not move
  const poisoned = M.LOCATIONS.map((l) => (l.type === 'district' ? { ...l, base: { ...l.base, price: CBS_REF.centralDistrict, sqm: 99999 } } : l));
  const N = pageNat({ locations: poisoned }).natPrice();
  assert.equal(N.off.v, CBS_REF.israelTotal); assert.equal(N.est.v, IL.base.price);
  const S = fnSrc('natPrice');
  assert.ok(/PRICE_BASIS\.il/.test(S) && !/PRICE_BASIS\[/.test(S), 'the citation is read for the country only');
  assert.deepEqual([...S.matchAll(/LOC\.(\w+)|metricsOf\("(\w+)"\)/g)].map((m) => m[1] || m[2]), ['il', 'il'], 'only the country row');
  assert.deepEqual(Object.keys(M.PRICE_BASIS), ['il']);
  assert.match(X.level2('cbs_average_transaction_price', 'en').geography, /Never a district: Central District \(₪2,731,500 in the same table\) is a different row/);
});
at('every headline card with a value carries an ⓘ whose registry entry gives definition · geography · population · period · source · class · what it does not mean', () => {
  const cards = [...KPI.matchAll(/\{k:"(\w+)"[^\n]*/g)].map((m) => m[0]);
  const withValue = cards.filter((c) => !/^\{k:"\w+",l:[^,]+,na:/.test(c));
  assert.ok(withValue.length >= 12, 'cards ' + withValue.length);
  for (const c of withValue) assert.match(c, /xp:("\w+"|yoyXp|NAT\?"\w+":"\w+")/, c.slice(0, 60));
  const ids = new Set([...KPI.matchAll(/xp:(?:NAT\?)?"(\w+)"(?::"(\w+)")?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean).concat(['new_homes_price_index_change', 'board_annual_change_estimate']));
  for (const id of ['cbs_average_transaction_price', 'new_home_price_estimate', 'new_home_price_per_sqm_estimate', 'board_average_price', 'board_price_per_sqm']) assert.ok(ids.has(id), id);
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
  // the source of the official figure is in the Trust Center, labelled as transcribed
  const TC = require('../lib/trust/catalog').catalog().sources.find((s) => s.id === 'cbs:average-dwelling-price');
  assert.ok(TC && TC.classification === 'TRANSCRIBED' && TC.sync.state === 'NO_RUN');
});
at('the index change is labelled as the new-homes INDEX (a different series and period), and no longer sits under the national price', () => {
  assert.match(INDEX, /const idxLbl=f=>f==="yoy"&&l\.id==="il"&&MKT\.nh\?t\.nhIdxLbl:t\.yoyLbl;/);
  assert.match(INDEX, /nhIdxLbl:"מדד מחירי דירות חדשות · שינוי שנתי"/);
  assert.match(INDEX, /nhIdxLbl:"New-homes price index · annual change"/);
  assert.ok(!/k:"offPrice"[^\n]*\bd:/.test(CARDS) && !/NAT\?\{k:"price"[^\n]*\bd:m\.yoy/.test(CARDS), 'no delta on either national price card');
});

console.log(`headline metrics: ${n} passed`);
