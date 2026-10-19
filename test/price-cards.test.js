'use strict';
/* PRICE CARDS — one contract for every geography (owner's decision 19.10.2026, P0 "fix price cards across all geographies").

   CARD 1 — "Average transaction price — <place>": the CBS average of ALL dwellings (new + second-hand) on the geography's OWN row of
            CBS Table 2.2 (Q2 2026) — OFFICIAL — or "—" with "No supported all-dwellings average is currently available for this
            geography." Never the estimate, never the district's row, never a figure made up for a city.
   CARD 2 — "Estimated new-home price — <place>": PROPX ESTIMATE, MODEL — always; no formula (× 1.12 / +12%) on the card; the method
            is level 2 of its ⓘ.
   The gates run the page's OWN renderKPIs / pricePair / vcOf over the page's OWN PRICE_SRC / PRICE_BASIS / LOCATIONS / I18N, in Hebrew
   and English, and read the cards it renders. Stubs only for the DOM, the sales / inventory read-outs and the ⓘ buttons. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const X = require('../lib/explain/registry.js');

let n = 0; const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const matched = (anchor) => {
  const i = INDEX.indexOf(anchor); assert.ok(i >= 0, 'missing ' + anchor);
  const open = INDEX.indexOf(anchor.endsWith('[') ? '[' : '{', i + anchor.length - 1), close = { '{': '}', '[': ']' }[INDEX[open]];
  let depth = 0;
  for (let k = open; k < INDEX.length; k++) { if (INDEX[k] === INDEX[open]) depth++; else if (INDEX[k] === close && --depth === 0) return INDEX.slice(i, k + 1); }
  throw new Error('unbalanced ' + anchor);
};
const line = (start) => { const i = INDEX.indexOf(start); assert.ok(i >= 0, start); return INDEX.slice(i, INDEX.indexOf('\n', i)); };
const fn = (name) => matched(`function ${name}(`);

/* the page's own pieces, in one context */
const SRC = [matched('const PRICE_SRC={'), matched('const PRICE_BASIS={'), matched('const LOCATIONS = ['), matched('const I18N={'),
  line('const M_ROOMS='), line('const M_TYPE='), line('const M_AREA='), line('const M_COND='), line('const ltr='), line('const nf='), line('const fmtInt='),
  line('const fmtNIS='), fn('fmtCompact'), line('const fmtPct='), line('const deltaCls='), fn('deltaHTML'), line('const heName='), fn('filtersActive'),
  fn('metricsOf'), fn('vcOf'), fn('vcPer'), line('const vcTag='), fn('pricePair'), fn('renderKPIs')].join(';\n');
function page({ basis, locations } = {}) {
  const nodes = {};
  const el = (id) => (nodes[id] = nodes[id] || { id, innerHTML: '', textContent: '', classList: { toggle() {} }, querySelectorAll: () => [] });
  const ctx = { el, MKT: {}, isStatic: () => false, cbsGeo: () => null, cbsInv: () => null, STATIC_SRC: { cite: {} }, kpiPrev: {}, matchMedia: () => ({ matches: true }),
    txShown: () => ({ show: false, cls: 'na', why: 'tx —' }), invShown: () => ({ show: false, cls: 'na', why: 'inv —' }),
    xpBtn: (id) => `<i data-xp="${id}"></i>`, xpMiss: (id) => `<i data-xpm="${id}"></i>`, Intl, Math, Object };
  vm.createContext(ctx);
  vm.runInContext(`${SRC};\nconst state={lang:"he",mode:"sale",locId:"il",filters:{rooms:"all",type:"all",area:"all",cond:"all"}};const T=()=>I18N[state.lang];
    const LOC=Object.fromEntries(LOCATIONS.map(l=>[l.id,l]));this.P={state,LOC,LOCATIONS,PRICE_BASIS,PRICE_SRC,I18N,renderKPIs,pricePair,vcOf,metricsOf};`, ctx);
  const P = ctx.P;
  if (basis) basis(P.PRICE_BASIS);
  if (locations) locations(P.LOCATIONS);
  /** the cards renderKPIs prints for a geography, in a language (filters optional) */
  P.cards = (locId, lang, filters) => {
    P.state.locId = locId; P.state.lang = lang; Object.assign(P.state.filters, { rooms: 'all', type: 'all', area: 'all', cond: 'all' }, filters || {});
    P.renderKPIs(false);
    return nodes.kpis.innerHTML.split('<div class="card kpi ').slice(1).map((h) => {
      const g = (re) => { const m = re.exec(h); return m ? m[1] : null; };
      const text = h.replace(/<span class="vc [^"]*" title="[^"]*">/g, '<span>').replace(/title="[^"]*"/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { html: h, text,
        label: g(/<span class="lbl" title="[^"]*">([^<]*)<\/span>/), pop: g(/<span class="kpop (\w+)">/), popText: g(/<span class="kpop \w+">([^<]*)<\/span>/),
        value: g(/data-kpi="\w+">([^<]*)<\/span>/), na: /<span class="na-v">/.test(h), vc: g(/<span class="vc (\w+)"/),
        xp: g(/data-xp="(\w+)"/), xm: g(/data-xpm="(\w+)"/), basis: g(/<span class="kb">([^<]*)<\/span>/), cmp: g(/<span class="cmp">([\s\S]*?)<\/span>\s*(?:<span class="kb">|<\/div>|$)/) };
    });
  };
  return P;
}
const P = page();
const B = P.PRICE_BASIS, S = P.PRICE_SRC, LOC = P.LOC;

/* the geographies the request names, and ones without a row */
const GEOS = { il: 'Israel', 'd-center': 'Central District', 'd-ta': 'Tel Aviv District', 'petah-tikva': 'Petah Tikva', tlv: 'Tel Aviv-Yafo', haifa: 'Haifa', 'beer-sheva': "Be'er Sheva" };
const NO_ROW = ['givatayim', 'ramat-hasharon', 'modiin', 'raanana', 'nof-hagalil'];
const NBHD = LOC['rhs-center'] ? 'rhs-center' : P.LOCATIONS.find((l) => l.type === 'nbhd').id;
const CBS_Q2 = { il: 2435000, 'd-center': 2731500, 'd-ta': 3576800, 'petah-tikva': 2518600, tlv: 4553500, haifa: 1816400, 'beer-sheva': 1236200 };

console.log('price cards: the basis (CBS Table 2.2, Q2 2026)');
at('the basis is ONE release and period: Table 2.2, Q2 2026 (provisional), Price Statistics Monthly 7/2026 — all dwellings, new + second-hand', () => {
  assert.deepEqual([S.table, S.period, S.provisional, S.edition, S.premium], ['2.2', '2026-Q2', true, 'Price Statistics Monthly No. 7/2026', 1.12]);
  assert.match(S.pop, /all dwelling transactions, new \+ second-hand/);
  assert.match(S.url, /^https:\/\/www\.cbs\.gov\.il\/he\/publications\/Madad\/DocLib\/2026\/price09aa\/aa2_2_e\.pdf$/);
  for (const [id, v] of Object.entries(CBS_Q2)) assert.equal(B[id].cbs, v, id);
  assert.equal(Object.keys(B).length, 25, 'Israel + 6 districts + 18 big cities');
  const types = Object.keys(B).map((id) => LOC[id] && LOC[id].type);
  assert.deepEqual([types.filter((t) => t === 'country').length, types.filter((t) => t === 'district').length, types.filter((t) => t === 'city').length], [1, 6, 18]);
  for (const [id, r] of Object.entries(B)) { assert.ok(Number.isInteger(r.cbs) && r.cbs % 100 === 0 && r.n > 0 && r.row, id); }   // NIS thousand, one decimal → ₪100
  // district rows keyed by the CBS district number; city rows by the CBS locality code — each once
  assert.deepEqual(['d-jm', 'd-north', 'd-haifa', 'd-center', 'd-ta', 'd-south'].map((d) => B[d].code), [1, 2, 3, 4, 5, 6]);
  const codes = Object.entries(B).filter(([id]) => LOC[id].type === 'city').map(([, r]) => r.code);
  assert.equal(new Set(codes).size, 18);
  assert.equal(B['petah-tikva'].code, 7900); assert.equal(B.tlv.code, 5000); assert.equal(B['beer-sheva'].code, 9000); assert.equal(B.haifa.code, 4000);
});
at('every estimate with a row is that row × the stated premium, rounded to ₪10,000 — the national row unchanged (₪2,730,000)', () => {
  for (const [id, r] of Object.entries(B)) assert.equal(LOC[id].base.price, Math.round(r.cbs * S.premium / 1e4) * 1e4, id);
  assert.equal(LOC.il.base.price, 2730000);
  assert.equal(LOC['d-center'].base.price, 3060000, 'Central District rebuilt from its own Q2 2026 row (was ₪2,780,000 ≈ ₪2.48M × 1.12)');
  assert.equal(LOC['petah-tikva'].base.price, 2820000);
});

console.log('price cards: the 14 gates');
const both = (fnL) => { for (const L of ['he', 'en']) fnL(L); };
at('1 · Israel card 1 = the all-dwellings average (₪2,435,000, OFFICIAL, all dwellings — new + second-hand)', () => both((L) => {
  const c = P.cards('il', L)[0];
  assert.equal(c.value, '₪2,435,000'); assert.equal(c.vc, 'raw'); assert.equal(c.pop, 'all'); assert.equal(c.xp, 'cbs_average_transaction_price');
  assert.equal(c.label, L === 'en' ? 'Average transaction price — Israel' : 'מחיר עסקה ממוצע — ישראל');
  assert.equal(c.popText, L === 'en' ? 'All dwellings — new + second-hand' : 'כלל הדירות — חדשות + יד שנייה');
  assert.match(c.html, /^hero /, 'card 1 is the hero');
}));
at('2 · Israel card 2 = the MODEL new-home estimate (≈ ₪2.73M, PROPX estimate)', () => both((L) => {
  const c = P.cards('il', L)[1];
  assert.equal(c.value, '≈ ₪2.73M'); assert.equal(c.vc, 'mod'); assert.equal(c.pop, 'est'); assert.equal(c.xp, 'new_home_price_estimate');
  assert.equal(c.label, L === 'en' ? 'Estimated new-home price — Israel' : 'מחיר מוערך לדירה חדשה — ישראל');
  assert.equal(c.popText, L === 'en' ? 'PROPX estimate' : 'הערכת PROPX');
}));
at('3 · district card 1 = the district\'s own all-dwellings row (Central ₪2,731,500 · Tel Aviv District ₪3,576,800), OFFICIAL', () => both((L) => {
  for (const [id, v] of [['d-center', '₪2,731,500'], ['d-ta', '₪3,576,800']]) {
    const c = P.cards(id, L)[0];
    assert.equal(c.value, v, id); assert.equal(c.vc, 'raw'); assert.equal(c.pop, 'all'); assert.equal(c.xp, 'cbs_average_transaction_price');
    assert.match(c.basis, L === 'en' ? /its own CBS row \(district [45]\)/ : /השורה של הלמ״ס לאזור עצמו \(מחוז [45]\)/);
  }
  // every district, not only Central
  for (const d of P.LOCATIONS.filter((l) => l.type === 'district')) assert.equal(P.cards(d.id, L)[0].value, '₪' + new Intl.NumberFormat('he-IL').format(B[d.id].cbs), d.id);
}));
at('4 · district card 2 = the MODEL new-home estimate (never DERIVED, never OFFICIAL)', () => both((L) => {
  for (const d of P.LOCATIONS.filter((l) => l.type === 'district')) {
    const c = P.cards(d.id, L)[1];
    assert.equal(c.vc, 'mod', d.id); assert.equal(c.pop, 'est'); assert.equal(c.xp, 'new_home_price_estimate');
    assert.equal(c.value, '≈ ₪' + (LOC[d.id].base.price / 1e6).toFixed(2).replace(/\.0+$/, '') + 'M');
  }
}));
at('5 · a city\'s card 1 never becomes the estimate — it is its own row or "—"', () => both((L) => {
  for (const l of P.LOCATIONS.filter((x) => x.type === 'city')) {
    const [c1, c2] = P.cards(l.id, L);
    assert.equal(c1.pop, 'all', l.id); assert.notEqual(c1.vc, 'mod', l.id);
    if (B[l.id]) assert.equal(c1.value, '₪' + new Intl.NumberFormat('he-IL').format(B[l.id].cbs), l.id);
    else { assert.ok(c1.na && c1.value === null, l.id + ' shows —'); assert.equal(c1.xm, 'cbs_average_price_no_row'); }
    assert.notEqual(c1.value, c2.value, l.id);
    assert.ok(!c1.html.includes(String(LOC[l.id].base.price)) && !c1.text.includes('≈'), l.id + ': no estimate in card 1');
  }
}));
at('6 · a city\'s card 2 is always "PROPX estimate", MODEL (Petah Tikva · Tel Aviv-Yafo · Haifa · Be\'er Sheva · every city)', () => both((L) => {
  for (const l of P.LOCATIONS.filter((x) => x.type === 'city')) {
    const c = P.cards(l.id, L)[1];
    assert.equal(c.vc, 'mod', l.id); assert.equal(c.pop, 'est'); assert.equal(c.popText, L === 'en' ? 'PROPX estimate' : 'הערכת PROPX'); assert.match(c.value, /^≈ ₪/);
  }
  const pt = P.cards('petah-tikva', L);
  assert.deepEqual([pt[0].label, pt[0].value, pt[1].label, pt[1].value], L === 'en'
    ? ['Average transaction price — Petah Tikva', '₪2,518,600', 'Estimated new-home price — Petah Tikva', '≈ ₪2.82M']
    : ['מחיר עסקה ממוצע — פתח תקווה', '₪2,518,600', 'מחיר מוערך לדירה חדשה — פתח תקווה', '≈ ₪2.82M']);
}));
const ALL_IDS = P.LOCATIONS.map((l) => l.id);
const visible = (id, L, f) => P.cards(id, L, f).slice(0, 4).map((c) => [c.label, c.popText, c.text, c.basis].join(' | ')).join(' || ');
at('7 · no "× 1.12" (nor "1.12") in the visible copy of the price cards — any geography, any language, filtered or not', () => {
  for (const id of ALL_IDS) for (const L of ['he', 'en']) for (const f of [null, { rooms: '4' }]) {
    const v = visible(id, L, f);
    assert.ok(!/[×x]\s*1\.12|1\.12/.test(v), `${id} ${L}: ${v.slice(0, 160)}`);
  }
});
at('8 · no "+12%" (nor "12%" premium) in the visible copy of the price cards', () => {
  for (const id of ALL_IDS) for (const L of ['he', 'en']) {
    const v = visible(id, L);
    assert.ok(!/\+?\s*⁦?\+?12%|premium|פרמי/.test(v), `${id} ${L}: ${v.slice(0, 160)}`);
  }
  // and the strings the cards read carry no formula at all
  for (const L of ['he', 'en']) { const t = P.I18N[L];
    for (const k of ['nhEstS', 'popEst', 'popAll', 'offPriceS', 'offNaGeo', 'offNaFilt', 'psmEst', 'perPrice']) assert.ok(!/1\.12|12%|×/.test(t[k]), `${L}.${k}`);
    for (const k of ['offPriceL', 'nhEstL', 'basisEstB', 'basisPsmB']) assert.ok(!/1\.12|12%|×/.test(t[k]('X')), `${L}.${k}`);
    assert.ok(!('basisIl' in t) && !('basisIlPsm' in t) && !('basisArea' in t), 'the formula-bearing basis strings are gone'); }
});
at('9 · MODEL is never labelled OFFICIAL or DERIVED: every board price / per-m² estimate is MODEL; only card 1 is OFFICIAL', () => {
  for (const l of P.LOCATIONS) {
    assert.equal(P.vcOf(l, 'price'), 'mod', l.id); assert.equal(P.vcOf(l, 'sqm'), 'mod', l.id);
    assert.equal(P.pricePair(l).est.cls, 'mod', l.id);
  }
  for (const id of ALL_IDS) for (const L of ['he', 'en']) {
    const cs = P.cards(id, L);
    assert.equal(cs[1].vc, 'mod'); assert.equal(cs[3].vc, 'mod'); assert.equal(cs[3].xp, 'new_home_price_per_sqm_estimate'); assert.equal(cs[3].pop, 'est');
    assert.ok(cs[0].na || cs[0].vc === 'raw', id);
    assert.ok(!cs.slice(1, 4).some((c) => c.vc === 'raw' || c.vc === 'der'), id);
  }
  for (const L of ['he', 'en']) {
    assert.equal(X.level1('new_home_price_estimate', L).cls, 'MODEL'); assert.equal(X.level1('new_home_price_per_sqm_estimate', L).cls, 'MODEL');
    assert.equal(X.level1('cbs_average_transaction_price', L).cls, 'OFFICIAL');
  }
  // the capital model's DATA BASIS (base) keeps its own reading, unchanged
  assert.equal(P.vcOf(LOC['d-center'], 'price', true), 'der'); assert.equal(P.vcOf(LOC.il, 'price', true), 'mod');
});
at('10 · a geography without its own row shows "—" with the stated reason — never its district\'s row (cities, neighbourhoods)', () => both((L) => {
  const msg = L === 'en' ? 'No supported all-dwellings average is currently available for this geography.' : 'אין כרגע ממוצע נתמך של כלל הדירות לאזור זה.';
  for (const id of [...NO_ROW, NBHD]) {
    const c = P.cards(id, L)[0];
    assert.ok(c.na, id); assert.ok(c.text.includes(msg), id + ': ' + c.text); assert.equal(c.xm, 'cbs_average_price_no_row');
    const d = P.LOCATIONS.find((x) => x.id === (LOC[id].type === 'city' ? LOC[id].parent : LOC[LOC[id].parent].parent));
    assert.ok(!c.html.includes(new Intl.NumberFormat('he-IL').format(B[d.id].cbs)), id + ' shows its district');
  }
  assert.ok(X.missing('cbs_average_price_no_row', L));
}));
at('11 · district data never populates a city average: poison every district row — no city card 1 moves', () => {
  const Q = page({ basis: (b) => { for (const id of Object.keys(b)) if (id.startsWith('d-')) b[id].cbs = 9999900; } });
  for (const l of Q.LOCATIONS.filter((x) => x.type === 'city' || x.type === 'nbhd' || x.type === 'sub')) {
    const c = Q.cards(l.id, 'en')[0];
    assert.ok(!c.html.includes('9,999,900'), l.id);
    if (B[l.id]) assert.equal(c.value, P.cards(l.id, 'en')[0].value, l.id); else assert.ok(c.na, l.id);
  }
  const S2 = fn('pricePair');
  assert.match(S2, /PRICE_BASIS\[l\.id\]/); assert.ok(!/parent|cityOf|chainOf|LOC\[/.test(S2), 'pricePair reads the geography\'s own row only');
});
at('12 · the estimate never replaces card 1: double every estimate — card 1 does not move, "—" stays "—", the order holds', () => {
  const Q = page({ locations: (ls) => { for (const l of ls) l.base.price *= 2; } });
  for (const id of ALL_IDS) {
    const a = P.cards(id, 'en'), b = Q.cards(id, 'en');
    assert.equal(b[0].value, a[0].value, id); assert.equal(b[0].na, a[0].na, id); assert.equal(b[0].pop, 'all');
    assert.notEqual(b[1].value, a[1].value, id + ': the estimate moved');
  }
  // under a filter card 1 is "—" (never split, never the filtered estimate); card 2 stays the estimate
  for (const id of ['il', 'd-center', 'petah-tikva']) for (const L of ['he', 'en']) {
    const [c1, c2] = P.cards(id, L, { rooms: '4' });
    assert.ok(c1.na); assert.equal(c1.xp, 'cbs_average_transaction_price'); assert.equal(c2.vc, 'mod'); assert.match(c2.value, /^≈ ₪/);
  }
});
at('13 · switching geography never changes what a card means: the same cards, order, populations, classes and ⓘ everywhere', () => both((L) => {
  const sig = (id) => P.cards(id, L).map((c) => [c.html.match(/t-(\w+)"/)[1], c.pop || '-', c.xp || c.xm || '-', c.vc || 'na'].join(':'));
  const shape = (id) => sig(id).map((s, i) => (i === 0 ? s.replace(/:(cbs_average_transaction_price|cbs_average_price_no_row):(raw|na)$/, ':CARD1') : s));
  const ref = shape('il');
  assert.equal(ref.length, 7);
  assert.deepEqual(ref.slice(0, 2), ['b:all:CARD1', 'b:est:new_home_price_estimate:mod']);
  for (const id of ['d-center', 'd-ta', 'petah-tikva', 'tlv', 'haifa', 'beer-sheva', ...NO_ROW, NBHD, 'il']) {
    const s = shape(id);
    assert.deepEqual(s.slice(0, 4).map((x) => x.split(':').slice(0, 3).join(':')), ref.slice(0, 4).map((x) => x.split(':').slice(0, 3).join(':')), id);
    assert.equal(s.length, 7, id);
  }
  // Israel → Petah Tikva → Central → Israel: the first two cards keep their meaning at every step
  for (const id of ['il', 'petah-tikva', 'd-center', 'il']) { const cs = P.cards(id, L); assert.equal(cs[0].pop, 'all'); assert.equal(cs[1].pop, 'est'); assert.equal(cs[1].vc, 'mod'); }
}));
at('14 · Hebrew / English parity: the same cards, values, classes, populations and ⓘ — only the words differ', () => {
  for (const id of ALL_IDS) {
    const he = P.cards(id, 'he'), en = P.cards(id, 'en');
    assert.equal(he.length, en.length, id);
    for (let i = 0; i < he.length; i++) {
      for (const k of ['value', 'vc', 'pop', 'xp', 'xm', 'na']) assert.deepEqual(he[i][k], en[i][k], `${id}#${i}.${k}`);
      if (i < 2) { assert.match(he[i].label, /[֐-׿]/, id); assert.ok(!/[֐-׿]/.test(en[i].label), id); }
    }
  }
  for (const L of ['he', 'en']) for (const id of ['cbs_average_transaction_price', 'new_home_price_estimate', 'new_home_price_per_sqm_estimate']) {
    const x = X.level2(id, L); for (const k of ['title', 'short', 'geography', 'population', 'period', 'notAs', 'methodology']) assert.ok(x[k], `${id}.${k} ${L}`);
  }
});

console.log('price cards: explanation (ⓘ) — level 1 says what it is; the method is level 2 only');
at('card 2 level 1 is exactly the stated sentence; no formula at level 1; methodology / inputs at level 2', () => {
  assert.equal(X.level1('new_home_price_estimate', 'en').short, 'This is a PROPX estimate of the average price of a new dwelling for the selected geography.');
  assert.equal(X.level1('new_home_price_estimate', 'he').short, 'זוהי הערכת PROPX למחיר הממוצע של דירה חדשה באזור שנבחר.');
  for (const L of ['he', 'en']) for (const id of ['cbs_average_transaction_price', 'new_home_price_estimate', 'new_home_price_per_sqm_estimate']) {
    const a = X.level1(id, L); assert.ok(!/1\.12|12%|×/.test(a.title + a.short), `${id} ${L} level 1`);
  }
  const e = X.level2('new_home_price_estimate', 'en');
  assert.match(e.formula, /× 1\.12/); assert.match(e.methodology, /12% new-build premium/); assert.equal(e.inputs.length, 2);
  assert.match(e.notAs, /Not an official CBS published average new-home price/);
});
at('card 1 ⓘ: what · population (new + second-hand) · source · period · geography · class — and not "a new-home price"', () => {
  const x = X.level2('cbs_average_transaction_price', 'en');
  assert.match(x.short, /all dwelling transactions — new and second-hand — in the selected geography, per CBS \(Table 2\.2, Q2 2026\)/);
  assert.match(x.population, /new and second-hand dwellings together/); assert.match(x.period, /Q2 2026/); assert.equal(x.cls, 'OFFICIAL');
  assert.deepEqual(x.sources.map((s) => s.id), ['cbs:average-dwelling-price']);
  assert.match(x.geography, /never its district's row/); assert.match(x.notAs, /^Not specifically the average price of a new dwelling/);
  assert.match(X.level2('cbs_average_transaction_price', 'he').notAs, /^לא דווקא המחיר הממוצע של דירה חדשה/);
});
at('the profile card and the data-basis card read the same pair (no Israel-only branch left)', () => {
  assert.ok(!/natPrice|premPct|l\.id==="il"\?natPrice/.test(INDEX), 'the Israel-only path is gone');
  assert.match(INDEX, /const PP=sale\?pricePair\(l\):null;/);
  assert.match(INDEX, /<div class="ap-l">\$\{t\.offPriceL\(heName\(l\)\)\}/); assert.match(INDEX, /<div class="ap-l">\$\{t\.nhEstL\(heName\(l\)\)\} \$\{vcTag\(PP\.est\.cls\)\}<\/div>/);
  assert.ok(INDEX.indexOf('<div class="ap-off">') < INDEX.indexOf('<div class="ap-est">'));
  assert.match(INDEX, /\["offPrice",t\.offPrice0\],\["price",t\.nhEst0\],\["sqm",t\.psmEst\]/);
});

console.log(`price cards: ${n} passed`);
