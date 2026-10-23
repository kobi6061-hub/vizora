// GEOGRAPHIC SCOPE (22.10.2026) — the hierarchy and the module × level matrix (lib/geo/scope.js), the read model behind the atlas
// (lib/geo/scope-read.js, GET /api/intel?view=scope), "Reset to Israel" and the page wiring. The DOM journey (reset from a street /
// a neighbourhood / a city, the drill-down, he / en × desktop / phone) is test/geo-scope.browser.js. Run: node test/geo-scope.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const S = require('../lib/geo/scope.js');
const R = require('../lib/geo/scope-read.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ATLAS = fs.readFileSync(path.join(ROOT, 'lib', 'geo', 'atlas-ui.js'), 'utf8');
let n = 0, failed = 0;
const at = (name, fn) => { try { fn(); n++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); } };
const read = (id) => { const r = R.read(id); assert.ok(r.ok, id + ' → ' + (r.error || '')); return r.body; };
const TXM = require('../lib/txevents');
const L = TXM.stores().latest;
const D = require('../lib/streets/directory').load();

console.log('geo-scope: the hierarchy and the matrix (lib/geo/scope.js)');
at('one UMD module shared by the page and the server; the seven districts are the dossier\'s, key for key', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/geo/scope.js'), 'utf8'), /root\.PropxScope = factory\(\)/);
  const DQ = require('../lib/dossier/query').DISTRICTS;
  assert.deepEqual(Object.keys(S.DISTRICTS).sort(), Object.keys(DQ).sort());
  for (const k of Object.keys(DQ)) { assert.equal(S.DISTRICTS[k].he, DQ[k].he, k); assert.equal(S.DISTRICTS[k].en, DQ[k].en, k); assert.equal(S.DISTRICTS[k].cbs, DQ[k].cbs, k); }
  assert.deepEqual(S.DISTRICT_ORDER.slice().sort(), Object.keys(DQ).sort());
});
at('ids: only official keys parse — never a guess', () => {
  for (const [id, lv] of [['il', 'country'], ['d-ta', 'district'], ['js-area', 'district'], ['napa:42', 'subdistrict'], ['loc:7900', 'locality'], ['sa:5000:1011', 'statArea'], ['nb:rhs-center', 'neighbourhood'], ['st:7900:213', 'street']]) assert.equal(S.parse(id).level, lv, id);
  for (const bad of ['', 'israel', 'd-xx', 'loc:abc', 'loc:7900:1', 'napa:', 'st:7900', 'nb:A B', '<script>', 'sa:1', 'loc:123456']) assert.equal(S.parse(bad), null, bad);
});
at('the levels in order; building / address / parcel and property are never navigable levels (evidence inside the street report, the Deal Lab)', () => {
  assert.deepEqual(S.LEVEL_IDS, ['country', 'district', 'subdistrict', 'locality', 'neighbourhood', 'statArea', 'street', 'address', 'property']);
  assert.equal(S.levelOf('address').navigable, false); assert.equal(S.levelOf('property').navigable, false);
  assert.deepEqual(S.NAV_LEVELS, ['country', 'district', 'subdistrict', 'locality', 'neighbourhood', 'statArea', 'street']);
});
at('every module states one mode at every level, with a basis in Hebrew and English; a CONTEXT cell names a WIDER level', () => {
  const rank = (lv) => ({ country: 0, district: 1, subdistrict: 2, locality: 3, neighbourhood: 4, statArea: 4, street: 5 })[lv];
  const modes = Object.keys(S.MODES);
  assert.deepEqual(modes, ['EXACT', 'AGGREGATED', 'CONTEXT', 'NOT_AVAILABLE', 'NOT_APPLICABLE']);
  for (const m of S.MODULES) for (const lv of S.NAV_LEVELS) {
    const c = m.levels[lv];
    assert.ok(c, m.id + ' @ ' + lv); assert.ok(modes.includes(c.mode), m.id + ' @ ' + lv);
    assert.ok(c.he && c.en, m.id + ' @ ' + lv + ' basis');
    if (c.mode === 'CONTEXT') { assert.ok(c.context, m.id + ' @ ' + lv + ' names its context'); assert.ok(rank(c.context) < rank(lv), `${m.id} @ ${lv}: context ${c.context} is not wider`); }
    else assert.equal(c.context, null, m.id + ' @ ' + lv);
  }
  const ids = S.MODULES.map((m) => m.id);
  for (const want of ['overview', 'transactions', 'prices', 'trends', 'supply', 'planning', 'transport', 'demographics', 'risks', 'changes', 'dealLab', 'map', 'sources']) assert.ok(ids.includes(want), want);
});
at('no invented precision: a statistical area is EXACT only for its census figures; transport only around a street; the Deal Lab only on a street; no subdistrict / neighbourhood boundary on a map', () => {
  for (const m of S.MODULES) {
    if (m.levels.statArea.mode === 'EXACT') assert.ok(['demographics', 'sources'].includes(m.id), m.id);
    if (m.id === 'transport') for (const lv of S.NAV_LEVELS) assert.equal(m.levels[lv].mode, lv === 'street' ? 'EXACT' : 'NOT_AVAILABLE', lv);
    if (m.id === 'dealLab') for (const lv of S.NAV_LEVELS) assert.equal(m.levels[lv].mode, lv === 'street' ? 'EXACT' : 'NOT_APPLICABLE', lv);
  }
  const map = S.MODULES.find((m) => m.id === 'map').levels;
  for (const lv of ['subdistrict', 'neighbourhood', 'statArea']) assert.equal(map[lv].mode, 'NOT_AVAILABLE', lv);
  /* a CBS series is never a locality's: trends below the district are CONTEXT */
  const tr = S.MODULES.find((m) => m.id === 'trends').levels;
  for (const lv of ['subdistrict', 'locality', 'neighbourhood']) assert.equal(tr[lv].mode, 'CONTEXT', lv);
});
at('every subdistrict code in the official directory has its English translation; the reversed bracket pair is shown normalized', () => {
  const codes = new Set([...D.localities.values()].map((l) => l.region).filter((x) => x != null));
  for (const c of codes) assert.ok(S.NAPA_EN[c], 'napa ' + c);
  assert.equal(S.napaName('ירדן )יריחו('), 'ירדן (יריחו)'); assert.equal(S.napaName('עכו'), 'עכו');
});

console.log('geo-scope: the read model (lib/geo/scope-read.js)');
at('the chain of every level, one level up, the subdistrict named "נפת …" apart from its seat locality', () => {
  const st = read('st:7900:213').scope;
  assert.deepEqual(st.chain.map((c) => c.id), ['il', 'd-center', 'napa:42', 'loc:7900', 'st:7900:213']);
  assert.deepEqual(st.chain.map((c) => c.level), ['country', 'district', 'subdistrict', 'locality', 'street']);
  assert.equal(st.chain[2].name.he, 'נפת פתח תקווה'); assert.equal(st.chain[3].name.he, 'פתח תקווה');
  assert.equal(S.up(st), 'loc:7900'); assert.equal(read('loc:7900').up, 'napa:42'); assert.equal(read('napa:42').up, 'd-center'); assert.equal(read('d-center').up, 'il'); assert.equal(read('il').up, null);
  assert.deepEqual(read('nb:rhs-center').scope.chain.map((c) => c.level), ['country', 'district', 'subdistrict', 'locality', 'neighbourhood']);
  assert.deepEqual(read('sa:5000:1011').scope.chain.map((c) => c.id), ['il', 'd-ta', 'napa:51', 'loc:5000', 'sa:5000:1011']);
  assert.equal(read('js-area').scope.chain.length, 2);
});
at('400 for a malformed id, 404 for an id the official files do not hold — never a nearest guess', () => {
  assert.equal(R.read('x').status, 400); assert.equal(R.read('loc:abc').status, 400);
  assert.equal(R.read('napa:99').status, 404); assert.equal(R.read('loc:1').status, 404); assert.equal(R.read('st:7900:99999').status, 404); assert.equal(R.read('sa:5000:9').status, 404); assert.equal(R.read('nb:no-such-place').status, 404);
});
at('every official locality is in exactly one district; the districts\' children cover the directory once; a district\'s subdistricts cover its localities', () => {
  const il = read('il');
  assert.equal(il.children.rows.length, 7);
  assert.equal(il.children.rows.reduce((a, r) => a + r.localities, 0), D.localities.size);
  for (const r of il.children.rows) {
    const d = read(r.id);
    const inNapot = d.children.rows.reduce((a, x) => a + x.localities, 0);
    const withNapa = [...D.localities.values()].filter((l) => l.district === r.id && l.region != null).length;
    assert.equal(inNapot, withNapa, r.id);
  }
});
at('Israel is Israel: the latest known transaction is the stored union\'s national newest counted event; its price is shown only when priced in statistics', () => {
  const x = read('il').transactions;
  const top = L.national.top.find((e) => e.state !== 'POSSIBLE_DUPLICATE');
  assert.equal(x.mode, 'EXACT'); assert.equal(x.latestKnown.id, top.id); assert.equal(x.latestKnown.date, L.national.latest);
  assert.equal(x.events, L.national.events);
  if (top.state !== 'PRICED_IN_STATISTICS') { assert.equal(x.latestKnown.price, null, 'an unreliable price is never shown'); assert.equal(x.latestKnown.priceUsed, false); }
});
at('the latest PRICED RESIDENTIAL transaction is kept apart: a dwelling priced in statistics, never newer than the latest known', () => {
  for (const id of ['il', 'd-ta', 'js-area', 'napa:42', 'loc:7900', 'st:7900:213']) {
    const x = read(id).transactions, p = x.latestPriced, k = x.latestKnown;
    assert.ok(p, id); assert.equal(p.state, 'PRICED_IN_STATISTICS', id); assert.equal(p.kind, 'DWELLING', id); assert.ok(p.price > 0 && p.priceUsed, id);
    assert.ok(p.date <= k.date, id + ' priced ≤ known');
  }
  const il = read('il').transactions, first = L.national.top.find((e) => e.state === 'PRICED_IN_STATISTICS' && e.kind === 'DWELLING');
  assert.equal(il.latestPriced.id, first.id);
});
at('a subdistrict AGGREGATES its localities (each once) — and the pruned search finds the same newest priced deal as reading every locality', () => {
  const b = read('napa:75'), codes = [...D.localities.values()].filter((l) => l.region === 75).map((l) => l.code);
  assert.equal(b.transactions.mode, 'AGGREGATED');
  assert.equal(b.transactions.events, codes.reduce((a, c) => a + ((L.localities[c] || {}).events || 0), 0));
  let best = null;
  for (const c of codes) { const ev = TXM.query({ code: c, all: '1', unlimited: true }).events.find((e) => e.state === 'PRICED_IN_STATISTICS' && e.kind === 'DWELLING'); if (ev && (!best || ev.date > best.date)) best = ev; }
  assert.equal(b.transactions.latestPriced ? b.transactions.latestPriced.date : null, best ? best.date : null);
  assert.equal(b.transactions.last12, null, 'no per-day tally below the district — never a made-up period count');
  assert.equal(b.children.rows.length, codes.length);
});
at('a verified neighbourhood\'s transactions are its LOCALITY\'s, labelled CONTEXT; a statistical area holds none (NOT AVAILABLE) — only its census figures', () => {
  const nb = read('nb:rhs-center');
  assert.equal(nb.transactions.mode, 'CONTEXT'); assert.equal(nb.transactions.of.level, 'locality'); assert.equal(nb.transactions.of.id, 'loc:2650');
  assert.ok(nb.transactions.reason.he && nb.transactions.reason.en);
  const sa = read('sa:5000:1011');
  assert.equal(sa.transactions.mode, 'NOT_AVAILABLE'); assert.equal(sa.transactions.latestKnown, undefined);
  assert.equal(sa.demographics.mode, 'EXACT'); assert.equal(sa.demographics.population, require('../lib/reference').table('census-2022').byKey.get('sa:5000:1011').population);
  assert.equal(read('st:7900:213').demographics.mode, 'CONTEXT', 'a locality figure is never a street\'s');
});
at('demographics: Israel is the census national row; a district / subdistrict is a stated SUM over the localities the census lists (coverage n of N)', () => {
  const C = require('../lib/reference').table('census-2022');
  assert.equal(read('il').demographics.population, C.byKey.get('il').population);
  const d = read('d-north').demographics, codes = [...D.localities.values()].filter((l) => l.district === 'd-north').map((l) => l.code);
  const rows = codes.map((c) => C.byKey.get('loc:' + c)).filter((r) => r && r.population != null);
  assert.equal(d.mode, 'AGGREGATED'); assert.equal(d.population, rows.reduce((a, r) => a + r.population, 0)); assert.equal(d.listed, rows.length); assert.equal(d.of, codes.length);
});
at('the national read: districts with official CBS series (trailing 12 months as published), major cities ordered by census population, verified neighbourhoods, coverage per level', () => {
  const il = read('il');
  const S1 = require('../data/cbs-sales/latest.json');
  const jm = il.children.rows.find((r) => r.id === 'd-jm');
  assert.equal(jm.salesT12.value, S1.geos['d-jm'].metrics.t12.value);
  const js = il.children.rows.find((r) => r.id === 'js-area');
  assert.equal(js.salesT12.value, S1.geos.jsr.metrics.t12.value, 'Judea and Samaria reads the CBS "jsr" series');
  const pops = il.national.cities.rows.map((r) => r.population);
  assert.deepEqual(pops, pops.slice().sort((a, b) => b - a)); assert.equal(il.national.cities.rows[0].code, 3000);
  assert.equal(il.national.neighbourhoods.total, require('../lib/changes/geo').neighbourhoodsList().length);
  const cov = Object.fromEntries(il.national.coverage.map((c) => [c.level, c.n]));
  assert.equal(cov.district, 7); assert.equal(cov.locality, D.localities.size);
  assert.equal(cov.street, D.streets.filter((s) => s.kind === 'street' && s.status === 'current').length);
  assert.equal(cov.address, null); assert.equal(cov.property, null);
});
at('no boundary is invented: the read carries points (the registry\'s coordinates) only — no polygon, ring or boundary for a subdistrict, neighbourhood or statistical area', () => {
  for (const id of ['napa:42', 'nb:rhs-center', 'sa:5000:1011', 'loc:7900']) {
    const s = JSON.stringify(read(id));
    assert.ok(!/"(polygon|ring|rings|boundary|geometry)"/.test(s), id);
  }
  const lj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/localities.json'), 'utf8')).localities.find((l) => l.code === 7900);
  assert.deepEqual(read('loc:7900').scope.point, { lat: lj.lat, lng: lj.lng });
});
(async () => {
  const H = require('../api/intel.js');
  const call = (q) => new Promise((resolve) => { const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), h: this.h }); } }; H({ url: '/api/intel?' + q, method: 'GET', headers: {} }, res); });
  const ok = await call('view=scope&id=loc%3A7900'), bad = await call('view=scope&id=%3Cx%3E'), miss = await call('view=scope&id=loc%3A1'), def = await call('view=scope');
  at('the API answers: 200 with the chain, 400 bad id, 404 unknown, no id = Israel; never cached', () => {
    assert.equal(ok.status, 200); assert.equal(ok.body.scope.id, 'loc:7900'); assert.equal(ok.body.modules.length, S.MODULES.length);
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad-scope'); assert.equal(miss.status, 404);
    assert.equal(def.status, 200); assert.equal(def.body.scope.id, 'il');
    assert.match(ok.h['Cache-Control'], /no-store/);
  });

  console.log('geo-scope: the page');
  at('"Reset to Israel" sits at the top of the Overview, before its heading — the flag, the two languages', () => {
    const ov = INDEX.slice(INDEX.indexOf('<section class="blk" id="overview">'), INDEX.indexOf('</section>', INDEX.indexOf('<section class="blk" id="overview">')));
    assert.ok(ov.indexOf('id="resetIL"') > -1 && ov.indexOf('id="resetIL"') < ov.indexOf('class="blk-head"'));
    assert.match(ov, /🇮🇱/);
    assert.match(INDEX, /resetIL:"ישראל — חזרה למבט ארצי"/); assert.match(INDEX, /resetIL:"Israel — National Overview"/);
  });
  at('resetToIsrael clears the geography and every section\'s GEOGRAPHIC filters, points the dossier / feed / transactions at Israel — and keeps the language, theme, navigation order and saved work (no reload)', () => {
    const fn = INDEX.slice(INDEX.indexOf('function resetToIsrael('), INDEX.indexOf('function renderResetIL('));
    for (const s of ['state.geo=null', 'state.scopeArea=null', 'f.city=null', 'f.region=null', 'f.neighborhood=null', 'inState.city=""', 'puState.city=""', 'puState.district=""', 'selectLocation("il")', 'dsOpen("il",null)', 'setGeo("il"', 'propx:scope']) assert.ok(fn.includes(s), s);
    for (const s of ['localStorage', 'propx:nav', 'setLang', 'state.lang=', 'data-theme', 'location.reload', 'state.filters', 'state.mode=']) assert.ok(!fn.includes(s), 'touches ' + s);
    assert.match(INDEX, /el\("resetIL"\)\.addEventListener\("click",\(\)=>resetToIsrael\(/);
  });
  at('the scope chip leaves ANY selection — an opened street at the national anchor included (was: only when the board\'s place was not Israel)', () => {
    assert.match(INDEX, /el\("cmdScope"\)\.addEventListener\("click",\(\)=>\{if\(!atIsrael\(\)\)resetToIsrael/);
    assert.match(INDEX, /const atIsrael=\(\)=>state\.locId==="il"&&!state\.geo&&!state\.scopeArea/);
  });
  at('the transactions follow a district without a board card (Judea and Samaria) through the scope\'s area; the pulse reads a district', () => {
    assert.match(INDEX, /if\(state\.scopeArea&&state\.locId==="il"\)return\{city:null,district:state\.scopeArea\.he,did:state\.scopeArea\.id/);
    assert.match(INDEX, /else if\(puState\.district\)qs\.set\("district",puState\.district\)/);
  });
  at('the atlas is a live-build module after the change feed (the offline build strips it — the reset button stays); its tables use the one table standard', () => {
    const live = INDEX.slice(INDEX.lastIndexOf('<!-- live:begin --><script'), INDEX.lastIndexOf('<!-- live:end -->'));
    assert.ok(live.indexOf('/lib/changes/ui.js') < live.indexOf('/lib/geo/scope.js') && live.indexOf('/lib/geo/scope.js') < live.indexOf('/lib/geo/atlas-ui.js'));
    assert.match(INDEX, /<!-- live:begin --><div class="atl-host" id="atlas"><\/div><!-- live:end -->/);
    for (const k of ['atdist', 'atnapa', 'atloc', 'atcity']) { assert.match(INDEX, new RegExp(k + ':"')); assert.ok(ATLAS.includes(`data-ptdom="${k}"`), k); }
    const SA = fs.readFileSync(path.join(ROOT, 'standalone', 'israel-new-homes-v2.html'), 'utf8');
    assert.ok(!SA.includes('src="/lib/geo/atlas-ui.js"') && !SA.includes('src="/lib/geo/scope.js"') && !SA.includes('id="atlas"'), 'the offline build carries no atlas');
    assert.ok(SA.includes('id="resetIL"'), 'the offline build keeps the reset');
  });
  at('the atlas reads only the page\'s own APIs, escapes every value, stores nothing in the browser and states every non-own geography in a section banner', () => {
    const hosts = [...ATLAS.matchAll(/fetch\((['`])([^'`]+)/g)].map((m) => m[2].split('?')[0]);
    for (const h of hosts) assert.ok(['/api/intel', '/api/geo/search'].includes(h), h);
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(ATLAS));
    assert.ok(!/innerHTML\s*=\s*[^`]*\$\{(?!esc\()/.test(ATLAS.replace(/\$\{esc\([^}]*\)\}/g, '')), 'raw interpolation into innerHTML');
    for (const sec of ['overview', 'txSection', 'dossier', 'pulse', 'changes', 'land', 'housing', 'intel']) assert.ok(ATLAS.includes(`'${sec}'`), sec);
    assert.match(ATLAS, /scnSel/); assert.match(ATLAS, /scnShown/);
  });
  at('the registry explains the two transactions and the scope modes, each with plain words and an example in both languages', () => {
    const X = require('../lib/explain/registry.js');
    for (const id of ['latest_known_transaction', 'latest_priced_residential_transaction', 'geographic_scope_mode']) {
      const t = X.term(id); assert.ok(t, id); assert.equal(t.group, 'geography');
      for (const k of ['simple', 'example', 'short', 'why']) { assert.ok(t[k] && t[k].he && t[k].en, id + ' ' + k); }
    }
  });
  console.log(`geo-scope: ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed) process.exit(1);
})();
