// PROPX · sales-metric and inventory truth gates (audits 13.10.2026) — offline.
// `node test/sales-metrics.test.js`
//
// Every sales and inventory figure on the board says what it is and what it rests on. New-home sales: the country and
// its districts from the official CBS monthly series (data/cbs-sales — OFFICIAL, the months named), Tel Aviv-Yafo
// from one documented release transcription (MODEL rate, never a plain count); every other place, and any filtered
// view, shows "—". Unsold inventory: the national CBS series, or a cited release figure with its month; else "—";
// never split by a filter. These gates run the page's own code (index.html) — not a copy of it.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PAYLOAD_JS = fs.readFileSync(path.join(ROOT, 'data', 'cbs-sales', 'latest.js'), 'utf8');
let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
/* a brace-matched block starting at `anchor` */
const block = (anchor) => {
  const i = INDEX.indexOf(anchor);
  assert.ok(i >= 0, 'missing ' + anchor);
  const open = INDEX.indexOf(anchor.endsWith('[') ? '[' : '{', i + anchor.length - 1);
  const close = { '{': '}', '[': ']' }[INDEX[open]];
  let d = 0;
  for (let k = open; k < INDEX.length; k++) {
    if (INDEX[k] === INDEX[open]) d++;
    else if (INDEX[k] === close && --d === 0) return INDEX.slice(i, k + 1);
  }
  throw new Error('unbalanced ' + anchor);
};
const line = (re) => { const m = re.exec(INDEX); assert.ok(m, 'missing ' + re); return m[0]; };
const fnBody = (name) => block('function ' + name + '(');
const cbsBlock = () => { const i = INDEX.indexOf('const CBS=(()=>{'); return INDEX.slice(i, INDEX.indexOf('})();', i) + 5); };

/* the page's data + the display gates, run as the page runs them */
const SRC = [
  block('const LOCATIONS = [') + ';',
  'const LOC = Object.fromEntries(LOCATIONS.map(l=>[l.id,l]));const heName=l=>state.lang==="he"?l.he:l.en;',
  block('const STATIC_SRC={') + ';',
  line(/const isStatic=\(l,f\)=>\{[^\n]*\n/),
  line(/const M_ROOMS=\{[^\n]*\n/), line(/const M_TYPE=\{[^\n]*\n/), line(/const M_AREA=\{[^\n]*\n/), line(/const M_COND=\{[^\n]*\n/),
  line(/function filtersActive\(\)\{[^\n]*\n/),
  'const nf=new Intl.NumberFormat("he-IL");const fmtInt=n=>nf.format(Math.round(n));',
  cbsBlock() + ';', line(/const cbsGeo=l=>[^\n]*\n/), line(/const cbsInv=\(\)=>[^\n]*\n/),
  block('const TX_BASIS={') + ';',
  line(/const ltr=x=>[^\n]*\n/), line(/const txShownVal=[^\n]*\n/), line(/const FRESH_TXT=[^\n]*\n/),
  fnBody('cbsDates'), fnBody('txShown'), fnBody('cbsIntel'), fnBody('txEvidence'), fnBody('invShown'), fnBody('msShown'), fnBody('metricsOf'),
  line(/const STALE_DAYS=[^\n]*\n/), line(/const staleSince=[^\n]*\n/), line(/const BLT4_ASOF=[^\n]*\n/),
  line(/const TX_SMALL_N=[^\n]*\n/),
  ';({LOCATIONS,LOC,STATIC_SRC,TX_BASIS,CBS,cbsGeo,txShown,txEvidence,invShown,msShown,cbsIntel,cbsDates,metricsOf,staleSince,BLT4_ASOF,TX_SMALL_N,STALE_DAYS})',
].join('\n');
const mkCtx = (withPayload) => {
  const ctx = { state: { lang: 'he', filters: { rooms: 'all', type: 'all', area: 'all', cond: 'all' } }, Date, Intl, window: {} };
  if (withPayload) vm.runInNewContext(PAYLOAD_JS, ctx);
  return { ctx, P: vm.runInNewContext(SRC, ctx) };
};
const { ctx, P } = mkCtx(true);
const { ctx: ctx0, P: P0 } = mkCtx(false);       /* the board without the CBS payload (offline fallback) */
const PAY = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cbs-sales', 'latest.json'), 'utf8'));
const setF = (f, c = ctx) => Object.assign(c.state.filters, { rooms: 'all', type: 'all', area: 'all', cond: 'all' }, f || {});
const plain = (x) => String(x).replace(/[\u2066-\u2069]/g, '');   // the left-to-right isolates are display-only
const he = (fn) => { ctx.state.lang = 'he'; return fn(); };
const en = (fn) => { ctx.state.lang = 'en'; try { return fn(); } finally { ctx.state.lang = 'he'; } };
const CBS_IDS = ['il', 'd-jm', 'd-north', 'd-haifa', 'd-center', 'd-ta', 'd-south'];

console.log('sales metrics — the board figure');
t('the page compiles (every inline script)', () => {
  for (const m of INDEX.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});
t('a sales figure is shown only for the official CBS geographies and the documented Tel Aviv exception; every other place shows —', () => {
  setF();
  const shown = P.LOCATIONS.filter((l) => P.txShown(l).show).map((l) => l.id).sort();
  assert.deepEqual(shown, [...CBS_IDS, 'tlv'].sort());
  for (const l of P.LOCATIONS) {
    const x = P.txShown(l);
    if (!x.show) { assert.equal(x.cls, 'na'); assert.ok(x.why && x.why.length > 10, l.id + ' must say why it is missing'); }
  }
});
t('exact geography: each CBS row is the place itself by its CBS code — no city, neighbourhood or name join reads the series', () => {
  const codes = { il: 5069, 'd-jm': 5070, 'd-north': 5071, 'd-haifa': 5072, 'd-center': 5073, 'd-ta': 5074, 'd-south': 5075 };
  for (const [id, code] of Object.entries(codes)) assert.equal(P.cbsGeo(P.LOC[id]).cbs, code, id);
  for (const l of P.LOCATIONS.filter((x) => x.type === 'city' || x.type === 'nbhd' || x.type === 'sub')) assert.equal(P.cbsGeo(l), null, l.id + ' reads the CBS series');
  assert.ok(!P.LOCATIONS.some((l) => l.id === 'jsr'), 'Judea & Samaria has no board row — read, never mapped onto another row');
});
t('the official figure is the CBS 12-month total: OFFICIAL, an exact count, its months named, its series and dates stated', () => {
  setF();
  for (const id of CBS_IDS) {
    const g = PAY.geos[id], x = he(() => P.txShown(P.LOC[id])), xe = en(() => P.txShown(P.LOC[id]));
    assert.equal(x.cls, 'raw'); assert.equal(x.v, g.metrics.t12.value);
    assert.equal(plain(x.text), new Intl.NumberFormat('he-IL').format(g.metrics.t12.value), id + ' an official count carries no "~"');
    assert.equal(x.per, `12 חודשים · ${g.metrics.t12.label.he}`); assert.equal(xe.per, `12 months · ${g.metrics.t12.label.en}`);
    assert.match(x.src, new RegExp(`סדרה ${g.seriesId}`));
    const months = g.monthly.slice(-12).map(([, v]) => v).reduce((a, b) => a + b, 0);
    assert.equal(months, g.metrics.t12.value, id + ' T12 = the sum of the 12 published months');
  }
});
t('national 34,000 audited: CBS 2025 = the series total as published (CBS revises months; the page never pins it) — the board shows the fresher CBS 12 months; offline falls back to the cited 2025 figure', () => {
  assert.equal(PAY.reconciliation.year.year, '2025');
  assert.equal(PAY.reconciliation.year.taxAuthority, 34000);
  assert.ok(Math.abs(PAY.reconciliation.year.cbsAnnual - 34000) / 34000 < 0.01, 'the populations match within 1%');
  assert.equal(PAY.geos.il.metrics.lastYear.annual, PAY.geos.il.metrics.lastYear.sumOfMonths, 'the published year = the sum of its months');
  setF(undefined, ctx0);
  const shown0 = P0.LOCATIONS.filter((l) => P0.txShown(l).show).map((l) => l.id).sort();
  assert.deepEqual(shown0, ['il', 'tlv'], 'without the payload: the cited national figure and Tel Aviv');
  const n0 = P0.txShown(P0.LOC.il);
  assert.equal(n0.cls, 'static'); assert.equal(n0.v, 34000); assert.match(n0.per, /2025/);
});
t('national reconciliation: the national 12 months vs the sum of the 7 districts — the residual is CBS\'s unknown district, not forced', () => {
  const R = PAY.reconciliation;
  assert.ok(R.t12 && R.t12.residual === R.t12.national - R.t12.districtSum);
  const sum = ['d-jm', 'd-north', 'd-haifa', 'd-center', 'd-ta', 'd-south', 'jsr'].reduce((a, k) => a + PAY.geos[k].metrics.t12.value, 0);
  assert.equal(sum, R.t12.districtSum);
  assert.equal(R.t12.national, PAY.geos.il.metrics.t12.value);
  const e = P.txEvidence(P.LOC.il);
  const live = PAY.reconciliation.year.cbsAnnual.toLocaleString('en-US');   // the official total as currently published (CBS revised 33,833 → 33,762 in 10.2026)
  assert.match(plain(e.model), new RegExp(`התאמה: 2025 — למ״ס ${live} · רשות המסים \\/ הכלכלן הראשי 34,000`));
  assert.ok(!/33,833|33,762/.test(INDEX), 'the page pins no revisable CBS annual total — the figure is read from the series');
  assert.match(plain(e.model), /= מחוז לא ידוע \(לא נכפה איזון\)/);
});
t('Tel Aviv: the one transcribed city figure — release 252/2026 Table B (820 + 1,236), a MODEL rate "~N לשנה" with its formula', () => {
  setF();
  const x = P.txShown(P.LOC.tlv);
  assert.equal(x.cls, 'mod'); assert.equal(P.TX_BASIS.tlv.n, 820 + 1236);
  assert.match(plain(x.text), /^~[\d,]+ לשנה$/); assert.match(plain(en(() => P.txShown(P.LOC.tlv)).text), /a year$/);
  assert.match(plain(x.per), /^אומדן: 2,056 × 12 ÷ 6 · ינואר–יוני 2026$/);
  assert.match(P.TX_BASIS.tlv.src.he, /הודעה לתקשורת 252\/2026 \(13\.08\.2026\), לוח ב: ינואר–מרץ 820 \+ אפריל–יוני 1,236/);
  assert.match(P.TX_BASIS.tlv.src.he, /לא מתעדכן אוטומטית/);
  assert.equal(P.cbsGeo(P.LOC.tlv), null, 'Tel Aviv-Yafo is a city, not the Tel Aviv District series');
  assert.notEqual(P.txShown(P.LOC.tlv).v, P.txShown(P.LOC['d-ta']).v);
  assert.ok(!/Dec-25–Feb-26 842|1,137 per CBS releases/.test(INDEX), 'the stale note on Tel Aviv\'s basis is gone');
});
t('the annualisation is correct: stored pace = count × 12 ÷ months (to the nearest hundred)', () => {
  for (const [id, B] of Object.entries(P.TX_BASIS)) {
    const annual = B.n * 12 / B.months;
    assert.equal(Math.round(annual / 100) * 100, P.LOC[id].base.tx, `${id}: ${B.n} × 12 ÷ ${B.months} = ${annual} vs stored ${P.LOC[id].base.tx}`);
    if (B.months < 12) assert.equal(B.cls, 'mod'); else assert.ok(['static', 'der'].includes(B.cls));
  }
  assert.match(plain(P.txEvidence(P.LOC.tlv).der), /^2,056 × 12 ÷ 6 = 4,112 → 4,100$/);
  /* the CBS annualised pace: YTD × 12 ÷ months — a rate, labelled as derived, never the headline count */
  const M = PAY.geos.il.metrics;
  assert.equal(M.pace.value, Math.round(M.ytd.value * 12 / M.ytd.months));
  assert.match(plain(P.cbsIntel(P.cbsGeo(P.LOC.il), 'he').join(' ')), /קצב שנתי: ~[\d,]+ לשנה — שנתון מ.* · נגזר, קצב ולא ספירה/);
});
t('YTD and prior-year YTD cover the same months; momentum, volatility and acceleration are derived with their windows', () => {
  for (const id of CBS_IDS) {
    const M = PAY.geos[id].metrics, mon = Object.fromEntries(PAY.geos[id].monthly);
    const [y, m] = M.latest.split('-').map(Number);
    let ytd = 0, prev = 0;
    for (let k = 1; k <= m; k++) { ytd += mon[`${y}-${String(k).padStart(2, '0')}`]; prev += mon[`${y - 1}-${String(k).padStart(2, '0')}`]; }
    assert.equal(M.ytd.value, ytd, id + ' YTD'); assert.equal(M.prevYtd.value, prev, id + ' prior-year YTD');
    assert.equal(M.ytd.from.slice(5), '01'); assert.equal(M.prevYtd.to, `${y - 1}-${String(m).padStart(2, '0')}`);
  }
  const intel = plain(P.cbsIntel(P.cbsGeo(P.LOC['d-ta']), 'he').join(' | '));
  assert.match(intel, /מתחילת השנה: [\d,]+ \(ינואר–\S+ 2026\) מול [\d,]+ \(ינואר–\S+ 2025\)/);
  assert.match(intel, /מומנטום: 3 חודשים [+-][\d.]+% \(מול /);
  assert.match(intel, /תנודתיות חודשית \d+% \(12 חודשים\) · נגזר/);
});
t('low sample: a geography under 30 sales in 3 months keeps its count and loses every trend signal', () => {
  const G = JSON.parse(JSON.stringify(P.cbsGeo(P.LOC['d-jm'])));
  G.metrics.small = true; G.metrics.momentum.m3 = { ok: false }; G.metrics.ytdChange = { ok: false };
  const out = plain(P.cbsIntel(G, 'he').join(' | '));
  assert.match(out, /מדגם קטן — פחות מ-30 מכירות ב-3 חודשים: ללא אותות מגמה/);
  assert.ok(!/מומנטום/.test(out));
  assert.match(out, /חודש אחרון: [\d,]+ /, 'the count stays');
});
t('freshness: observation period, source update and PROPX check are separate; a normal publication delay is not stale', () => {
  const d = plain(P.cbsDates('he')), de = plain(P.cbsDates('en'));
  assert.match(d, /^עודכן במקור \d\d\.\d\d\.\d{4} · נבדק ב-PROPX \d\d\.\d\d\.\d{4} · (עדכני|פיגור דיווח צפוי|ישן)/);
  assert.match(de, /^source updated \d\d\.\d\d\.\d{4} · PROPX check \d\d\.\d\d\.\d{4} · (current|expected reporting lag|stale)/);
  assert.equal(P.CBS.updateDay, PAY.sourceUpdate.split('-').reverse().join('.'));
  assert.ok(['CURRENT', 'EXPECTED_REPORTING_LAG', 'STALE'].includes(PAY.freshness.state));
  if (PAY.freshness.state === 'EXPECTED_REPORTING_LAG') assert.match(d, /\(נתוני \S+ \d{4} טרם פורסמו\)/);
});
t('no place receives another geography\'s count; the geo panel reads each anchor\'s own gate', () => {
  setF();
  const nat = P.txShown(P.LOC.il).v;
  for (const l of P.LOCATIONS.filter((x) => x.type !== 'country')) { const x = P.txShown(l); if (x.show) assert.notEqual(x.v, nat, l.id + ' shows the national figure'); }
  const g = fnBody('renderGeoView');
  assert.match(g, /const tx=txShown\(a\),inv=invShown\(a\),ms=msShown\(a\);/);
  assert.ok(!/fmtInt\(m\.tx\)|fmtInt\(m\.listings\)/.test(g), 'the geo panel prints a raw model value');
  assert.match(g, /\[t\.geoMMs,ms\.show\?ms\.text:"—","ms",ms\.cls,ms\.show\?ms\.per:ms\.why\]/);
});
t('a filter never splits sales or inventory: no figure, no floor of 3 or 2, metricsOf() gives null', () => {
  const R = Object.keys(vm.runInNewContext('(' + line(/const M_ROOMS=(\{[^\n]*\});/).replace(/^const M_ROOMS=/, '').replace(/;\s*$/, '') + ')'));
  let n = 0;
  for (const l of P.LOCATIONS) for (const f of [{ rooms: '6' }, { type: 'ph' }, { cond: 'ready' }, { area: '60' }, { rooms: R[2], type: 'garden' }]) {
    setF(f);
    for (const x of [P.txShown(l), P.invShown(l), P.msShown(l)]) { assert.equal(x.show, false, `${l.id} ${JSON.stringify(f)}`); assert.equal(x.cls, 'na'); }
    assert.ok(P.txShown(l).filtered && P.invShown(l).filtered);
    assert.match(P.invShown(l).why, /אין מקור שמפצל מלאי לפי חדרים, סוג, שטח או מצב/);
    assert.equal(P.metricsOf(l.id).tx, null); assert.equal(P.metricsOf(l.id).listings, null);
    n++;
  }
  setF();
  assert.ok(n >= 500);
  assert.ok(!/Math\.max\(3,/.test(INDEX), 'the floor of 3 is gone');
  assert.ok(!/Math\.max\(2,Math\.round\(b\.listings/.test(INDEX) && !/b\.listings\*share/.test(INDEX), 'the inventory demo share / floor of 2 is gone');
  assert.equal(P.metricsOf('ofakim').listings, P.LOC.ofakim.base.listings, 'unfiltered, metricsOf keeps the stored value (shown only through invShown)');
});
t('no neighbourhood inference: no neighbourhood or sub-area shows sales, inventory or months of supply', () => {
  setF();
  for (const l of P.LOCATIONS.filter((x) => x.type === 'nbhd' || x.type === 'sub')) {
    for (const x of [P.txShown(l), P.invShown(l), P.msShown(l)]) assert.equal(x.show, false, l.id);
  }
});
t('missing renders — on every board surface, and each surface goes through its gate', () => {
  setF();
  const kpi = fnBody('renderKPIs');
  assert.match(kpi, /\(x=>x\.show\?\{k:"tx",l:t\.tx,v:x\.v,f:\(\)=>x\.text,vc:x\.cls,s:x\.per,xp:"official_new_home_sales"\}:\{k:"tx",l:t\.tx,na:x\.why\}\)\(txShown\(l\)\)/);   /* + its ⓘ (audit 19.10.2026) */
  assert.match(kpi, /\(x=>x\.show\?\{k:"listings",l:t\.listings,v:x\.v,f:\(\)=>x\.text,vc:x\.cls,s:x\.per,xp:"unsold_inventory"\}:\{k:"listings",l:t\.listings,na:x\.why\}\)\(invShown\(l\)\)/);
  assert.match(kpi, /c\.na\?`<span class="na-v">\$\{t\.naShort\}<\/span>`/);
  assert.match(INDEX, /naShort:"—"/);
  const prof = fnBody('renderProfile');
  assert.match(prof, /\$\{x\.show\?x\.text:"—"\}[^]*\(txShown\(l\)\)/);
  assert.match(prof, /\$\{x\.show\?x\.text:"—"\}[^]*\(invShown\(l\)\)/);
  assert.match(prof, /r\.f==="tx"\|\|r\.f==="listings"\?\(x=>[^]*\(r\.f==="tx"\?txShown\(l\):invShown\(l\)\)/);
  assert.match(fnBody('renderTable'), /\(state\.mode==="sale"\?txShown\(r\.loc\):invShown\(r\.loc\)\)/);
  assert.match(INDEX, /\{f:"tx",label:\(\)=>T\(\)\.thTx,get:\(m,id\)=>\{const x=txShown\(LOC\[id\]\);return x\.show\?x\.v:null\}/);
  assert.match(fnBody('renderMap'), /\$\{x\.show\?x\.text:"—"\}[^]*\(txShown\(ll\)\)/);
  assert.match(fnBody('renderConfidence'), /f==="tx"\?txShown\(l\)\.cls:f==="listings"\?invShown\(l\)\.cls:vcOf\(l,f\)/);
  for (const bad of [/fmtInt\(m\.tx\)/, /fmtInt\(lm\.tx\)/, /fmtInt\(state\.mode==="sale"\?r\.m\.tx/, /fmtInt\(m\.listings\)/, /fmtInt\(r\.m\.listings\)/]) assert.ok(!bad.test(INDEX), 'raw value printed: ' + bad);
});
t('the evidence view (RAW · DERIVED · DISPLAY) states what the figure rests on', () => {
  setF();
  const o = P.txEvidence(P.LOC.ofakim);
  assert.match(o.raw, /0 תצפיות/); assert.equal(o.der, '—'); assert.match(o.disp, /^— \(/);
  assert.match(o.model, /מחקר ידני 30\.08\.2026 \(800 לשנה\) — ללא מקור או נוסחה שמורים; אינו מוצג ואינו נקרא במודל ההון/);
  const n = P.txEvidence(P.LOC['d-south']);
  assert.ok(n.official);
  assert.match(n.raw, /^למ״ס — .* · מחוז הדרום \(קוד 5075\) · סדרה \d+ · https:\/\/apis\.cbs\.gov\.il\/series\/data\/path\?id=44,10,2,1,5075 · 12 חודשים כפי שפורסמו: (\d{4}-\d\d [\d,]+ · ){12}עודכן במקור/);
  assert.match(n.der, /חודש אחרון: .* \| 3 חודשים: .* \| מתחילת השנה: /);
  setF({ type: 'garden' });
  assert.match(P.txEvidence(P.LOC.florentin).disp, /אין מקור שמפצל מכירות/);
  setF();
});

console.log('inventory — source, observation date, geography, population, class');
t('every shown inventory figure states its source, month, geography, population and class', () => {
  setF();
  const shown = P.LOCATIONS.filter((l) => P.invShown(l).show).map((l) => l.id).sort();
  assert.deepEqual(shown, ['beer-yaakov', 'd-center', 'd-ta', 'il', 'jerusalem', 'kiryat-gat', 'lod', 'netivot', 'ofakim', 'raanana', 'ramat-hasharon', 'tlv']);
  for (const id of shown) for (const run of [he, en]) {
    const x = run(() => P.invShown(P.LOC[id]));
    assert.ok(/20\d\d/.test(x.per), id + ' month: ' + x.per);
    assert.ok(x.src && x.geo && x.pop, id + ' source / geography / population');
    assert.ok(['raw', 'static'].includes(x.cls), id + ' class ' + x.cls);
  }
  const n = P.invShown(P.LOC.il);
  assert.equal(n.cls, 'raw'); assert.equal(n.v, PAY.inventory.latest.value); assert.equal(n.per, `סוף ${PAY.inventory.latest.label.he}`);
  const tl = P.invShown(P.LOC.tlv);
  assert.deepEqual([tl.cls, tl.v, tl.per], ['static', 9720, 'סוף יולי 2026']);
  assert.match(tl.src, /הודעה לתקשורת 283\/2026 \(10\.09\.2026\)/);
  for (const id of ['kiryat-ono', 'kiryat-ata', 'elad', 'kiryat-bialik', 'holon']) {
    const x = P.invShown(P.LOC[id]);
    assert.equal(x.show, false, id + ' no figure in the cited release'); assert.match(x.why, /אין נתון מלאי רשמי/);
  }
  const n0 = P0.invShown(P0.LOC.il);
  assert.deepEqual([n0.cls, n0.v, n0.per], ['static', 84990, 'סוף יולי 2026'], 'offline: the cited end-July figure');
});
t('months of supply: CBS\'s own national measure; elsewhere inventory ÷ sales with both periods named', () => {
  setF();
  const m = P.msShown(P.LOC.il);
  assert.equal(m.cls, 'raw'); assert.equal(plain(m.text), PAY.monthsSupply.latest.value.toFixed(1));
  assert.match(m.per, /ממוצע על סמך נתוני מגמה/);
  const d = P.msShown(P.LOC['d-ta']);
  assert.equal(d.cls, 'der'); assert.match(plain(d.per), /^מלאי סוף יולי 2026 ÷ \(מכירות \S+ 2025–\S+ 2026 ÷ 12\)$/);
  const tl = P.msShown(P.LOC.tlv);
  assert.equal(tl.cls, 'mod', 'Tel Aviv\'s sales are a MODEL rate — so is its months of supply');
  assert.equal(P.msShown(P.LOC['d-jm']).show, false, 'no district inventory published → no months of supply');
});

console.log('sales metrics — labels, periods, staleness');
t('the board never labels a figure "מכירות מקבלן N" without its basis — label names the population', () => {
  assert.match(INDEX, /tx:"מכירות דירות חדשות", y3:/);
  assert.match(INDEX, /tx:"New-home sales", y3:/);
  assert.ok(!/perTxEst|perTxH1|TX_H1_2026/.test(INDEX), 'the old undated "estimated annual pace" label is gone');
});
t('a stale static statement is marked stale and loses its trend arrow', () => {
  const asOf = P.BLT4_ASOF;
  assert.equal(asOf, '2026-05-31'); assert.equal(P.STALE_DAYS, 90);
  const at = (iso) => vm.runInNewContext(line(/const STALE_DAYS=[^\n]*\n/) + line(/const staleSince=[^\n]*\n/) + `;staleSince("${asOf}")`, { Date: { now: () => Date.parse(iso), parse: Date.parse } });
  assert.equal(at('2026-06-20'), false); assert.equal(at('2026-10-13'), true);
  assert.match(INDEX, /blt4vStale:"התאוששות", blt4sStale:"ישן — לא עודכן מאז מאי 2026 · /);
  assert.match(INDEX, /blt4vStale:"Recovery", blt4sStale:"Stale — not updated since May 2026 · /);
  assert.match(INDEX, /const stale4=staleSince\(BLT4_ASOF\);[^]*?const key=stale4&&\(node\.dataset\.i==="blt4v"\|\|node\.dataset\.i==="blt4s"\)\?node\.dataset\.i\+"Stale":node\.dataset\.i;/);
});
t('the sources panel no longer calls the deals register "developer sales"', () => {
  assert.ok(!/srcB1b:"מכירות קבלנים שנחתמו/.test(INDEX));
  assert.match(INDEX, /srcB1b:"עסקאות שנחתמו ודווחו למאגר רשות המסים — כל השוק \(חדשות ויד שנייה\); המאגר אינו מסמן מכירה מקבלן"/);
  assert.match(INDEX, /הלמ״ס אינה מפרסמת סדרת מכירות לפי עיר בפורמט קריא למכונה — בשאר הערים והשכונות מוצג —/);
});

console.log('sales metrics — observed deals');
t('new-home classification is source-supported: the register has no developer flag → "new" only by build year', () => {
  const { OverDealsProvider } = require('../lib/gov/providers/overDeals.js');
  const p = new OverDealsProvider({ fetch: async () => { throw new Error('offline'); } });
  const r = p.normalizeDeal({ date: '2026-03-01', amount: 2500000, nature: 'דירה בבית קומות', year_built: 2026, settlement: 'אופקים', area_sqm: 100, rooms: 4 }, {});
  assert.equal(r.sourceClassification, null);
  assert.equal(r.newness, 'probable_new', 'never confirmed without a source flag');
  const tx = fnBody('renderTx');
  assert.match(tx, /tabBtn\("new",nNew&&nConf===nNew\?t\.txTabNew:t\.txTabNewProb,nNew\)/);
  assert.match(INDEX, /txTabNewProb:"חדשות \(לפי שנת בנייה\)"/);
  assert.match(INDEX, /מתוכן \$\{nNew\} חדשות לפי שנת בנייה \(המאגר אינו מסמן מכירה מקבלן\)/);
});
t('every observed count has a period and the date range of the rows shown', () => {
  const tx = fnBody('renderTx');
  assert.match(tx, /\[t\.txSumNObs\(perLbl\),fmtInt\(statRows\.length\)/);
  assert.match(tx, /\[t\.txSumRange,first\?/);
  assert.match(INDEX, /txSumNObs:p=>`עסקאות שנצפו · \$\{p\}`/);
  assert.match(INDEX, /txSumNObs:p=>`Observed deals · \$\{p\}`/);
});
t('small samples: below 10 observed deals the count is marked and medians are de-emphasised', () => {
  assert.equal(P.TX_SMALL_N, 10);
  /* the documented reason, checked: a distribution-free 95% interval for a median (order statistics, Binomial(n,½))
     does not exist below n = 6, spans the whole sample at n = 6–8 and runs 2nd..2nd-last at n = 9–11 */
  const C = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; };
  const cdf = (n, k) => { let s = 0; for (let i = 0; i <= k; i++) s += C(n, i); return s / 2 ** n; };
  const lowRank = (n) => { let best = null; for (let r = 1; r <= n / 2; r++) if (1 - 2 * cdf(n, r - 1) >= 0.95) best = r; return best; };
  for (let n = 1; n <= 5; n++) assert.equal(lowRank(n), null, 'no 95% interval at n=' + n);
  for (const n of [6, 7, 8]) assert.equal(lowRank(n), 1, 'whole sample at n=' + n);
  for (const n of [9, 10, 11]) assert.equal(lowRank(n), 2, '2nd..2nd-last at n=' + n);
  const tx = fnBody('renderTx');
  assert.match(tx, /const small=prices\.length<TX_SMALL_N/);
  assert.match(tx, /small\?` <span class="tx-chip">\$\{t\.txSmallTag\}<\/span>`:""/);
  assert.match(tx, /else if\(small&&prices\.length\)el\("txWarn"\)\.textContent=t\.txSmall\(prices\.length\)/);
});
t('ALTARIS: an observed deal count in the risk score carries its period', () => {
  const E = require('../altaris/engine.js');
  const deal = { info: { startDate: '2026-11-01', constructionStatus: 'construction' }, value: { chosen: 'manual', manual: { value: 1e7 } }, buy: { price: 8e6 } };
  const R = E.run(deal, {}, { today: '2026-10-13', marketDepth: { deals: 40, from: '2025-10-01', to: '2026-09-15' } });
  const liq = R.strategies.buy.risk.components.find((c) => c.k === 'liquidity');
  assert.match(liq.why, /40 עסקאות מגורים בדגימת PROPX \(01\.10\.2025–15\.09\.2026\): 0/);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
