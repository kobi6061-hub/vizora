// PROPX · tables — the one sorting and filtering standard (audit 14.10.2026).
// `node test/table.test.js`
//
// The shared core (lib/table/core.js), every server-backed table family over its whole filtered set (land tenders,
// cities, developers · housing lotteries · developers, projects, market entries · urban renewal), and the page module
// (header controls, filter popover, per-table state, client tables) run in a sandbox with the page's own source.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const TC = require('../lib/table/core');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };
const vals = (rows, k) => rows.map((r) => r[k]);

console.log('core: comparators and the click cycle');
t('numbers / currency / percent: high → low then low → high; missing always last (never 0)', () => {
  const rows = [{ v: 3 }, { v: null }, { v: '—' }, { v: 10 }, { v: 0 }, { v: undefined }, { v: NaN }, { v: '' }, { v: 'MISSING' }, { v: -2 }];
  for (const ty of ['number', 'currency', 'percent']) {
    assert.deepStrictEqual(vals(TC.sortRows(rows, (r) => r.v, ty, 'desc'), 'v').slice(0, 4), [10, 3, 0, -2]);
    assert.deepStrictEqual(vals(TC.sortRows(rows, (r) => r.v, ty, 'asc'), 'v').slice(0, 4), [-2, 0, 3, 10]);
    for (const dir of ['asc', 'desc']) assert.ok(TC.sortRows(rows, (r) => r.v, ty, dir).slice(4).every((r) => TC.isMissing(r.v)), ty + ' ' + dir + ': a missing value sorted among values');
  }
  assert.deepStrictEqual(TC.sortRows([{ v: '₪1,200' }, { v: '₪950' }, { v: '₪1.2M' }], (r) => r.v, 'currency', 'desc').map((r) => r.v), ['₪1.2M', '₪1,200', '₪950']);
  assert.deepStrictEqual(TC.sortRows([{ v: '3.1%' }, { v: '−0.4%' }, { v: '12%' }], (r) => r.v, 'percent', 'desc').map((r) => r.v), ['12%', '3.1%', '−0.4%']);
});
t('dates: newest first on the first click, from ISO or dd.mm.yyyy, months too; missing last', () => {
  const rows = [{ d: '2025-01-31' }, { d: '03.02.2026' }, { d: null }, { d: '2024-12' }, { d: '2026-02-02' }];
  assert.deepStrictEqual(vals(TC.sortRows(rows, (r) => r.d, 'date', TC.primaryDir('date')), 'd'), ['03.02.2026', '2026-02-02', '2025-01-31', '2024-12', null]);
});
t('text: Hebrew and English collation (א → ת, A → Z, case-insensitive, numeric-aware); missing last', () => {
  const he = TC.sortRows(['תל אביב', 'אשדוד', null, 'באר שבע', 'חיפה'].map((v) => ({ v })), (r) => r.v, 'text', 'asc', { lang: 'he' }).map((r) => r.v);
  assert.deepStrictEqual(he, ['אשדוד', 'באר שבע', 'חיפה', 'תל אביב', null]);
  const en = TC.sortRows(['tender 10', 'Tender 9', 'alpha', '—'].map((v) => ({ v })), (r) => r.v, 'text', 'asc', { lang: 'en' }).map((r) => r.v);
  assert.deepStrictEqual(en, ['alpha', 'Tender 9', 'tender 10', '—']);
  assert.equal(TC.primaryDir('text'), 'asc');
});
t('status: lifecycle order (unknown statuses after the known ones); booleans yes first', () => {
  const order = ['published', 'open', 'closed', 'awarded', 'cancelled'];
  const s = TC.sortRows(['awarded', 'zzz', 'open', null, 'published'].map((v) => ({ v })), (r) => r.v, 'status', 'asc', { order }).map((r) => r.v);
  assert.deepStrictEqual(s, ['published', 'open', 'awarded', 'zzz', null]);
  assert.deepStrictEqual(TC.sortRows([{ b: false }, { b: true }, { b: null }], (r) => r.b, 'bool', TC.primaryDir('bool')).map((r) => r.b), [true, false, null]);
});
t('the cycle: first click primary, second reverse, third the default; the default column is default → reverse → default', () => {
  const def = { key: 'date', dir: 'desc' };
  let s = TC.nextSort({ ...def, isDefault: true }, 'units', 'number', def); assert.deepStrictEqual([s.key, s.dir, s.isDefault], ['units', 'desc', false]);
  s = TC.nextSort(s, 'units', 'number', def); assert.deepStrictEqual([s.key, s.dir], ['units', 'asc']);
  s = TC.nextSort(s, 'units', 'number', def); assert.deepStrictEqual([s.key, s.dir, s.isDefault], ['date', 'desc', true]);
  s = TC.nextSort(s, 'date', 'date', def); assert.deepStrictEqual([s.key, s.dir], ['date', 'asc']);
  s = TC.nextSort(s, 'date', 'date', def); assert.equal(s.isDefault, true);
  s = TC.nextSort(s, 'name', 'text', def); assert.deepStrictEqual([s.key, s.dir], ['name', 'asc']);
});
t('stable: equal values keep their order, a tie-break applies before it', () => {
  const rows = [{ id: 1, v: 5 }, { id: 2, v: 5 }, { id: 3, v: 7 }, { id: 4, v: 5 }];
  assert.deepStrictEqual(vals(TC.sortRows(rows, (r) => r.v, 'number', 'desc'), 'id'), [3, 1, 2, 4]);
  assert.deepStrictEqual(vals(TC.sortRows(rows, (r) => r.v, 'number', 'desc', { tie: (a, b) => b.id - a.id }), 'id'), [3, 4, 2, 1]);
});

console.log('core: typed filters');
t('each type parses, formats back and matches; invalid input is ignored, never guessed', () => {
  assert.deepStrictEqual(TC.parseFilter('number', '100..500'), { min: 100, max: 500 });
  assert.deepStrictEqual(TC.parseFilter('currency', '..5000000'), { min: null, max: 5000000 });
  assert.equal(TC.parseFilter('number', '500..100'), null);
  assert.equal(TC.parseFilter('number', 'abc..'), null);
  assert.deepStrictEqual(TC.parseFilter('date', '2025-01-01..'), { from: '2025-01-01', to: null });
  assert.deepStrictEqual(TC.parseFilter('enum', 'rental,open-market'), { in: ['rental', 'open-market'] });
  assert.deepStrictEqual(TC.parseFilter('bool', 'no'), { is: 'no' });
  assert.deepStrictEqual(TC.parseFilter('text', '  רמת '), { q: 'רמת' });
  for (const [ty, raw] of [['number', '100..500'], ['date', '2025-01-01..2025-12-31'], ['enum', 'a,b'], ['bool', 'yes'], ['text', 'x'], ['geo', '5000']])
    assert.equal(TC.formatFilter(ty, TC.parseFilter(ty, raw)), raw);
  assert.equal(TC.matchFilter('text', 'רמת גן', { q: 'רמת' }), true);
  assert.equal(TC.matchFilter('text', '"רמת" השרון', { q: 'רמת' }), true);   /* geresh / quotes ignored */
  assert.equal(TC.matchFilter('date', '2025-06-30', { from: '2025-01-01', to: '2025-06-30' }), true);
  assert.equal(TC.matchFilter('percent', '3.1%', { min: 3, max: null }), true);
});
t('a missing value never satisfies an active filter (an unknown is not "between")', () => {
  for (const [ty, spec] of [['number', { min: 0, max: null }], ['date', { from: '2000-01-01', to: null }], ['text', { q: '' + 'a' }], ['enum', { in: ['x'] }], ['bool', { is: 'no' }]])
    for (const v of [null, undefined, '—', '', NaN]) assert.equal(TC.matchFilter(ty, v, spec), false, `${ty} ${v}`);
});
t('filters intersect; the sort applies to the filtered rows; clearing restores the full set', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, units: i % 7 === 0 ? null : i * 10, city: i % 2 ? 'אשדוד' : 'חיפה' }));
  const cols = { units: { type: 'number', filter: true }, city: { type: 'text', filter: true }, id: { type: 'number' } };
  const q = TC.query(rows, cols, { sort: 'units', order: 'desc', filters: { units: { min: 50, max: null }, city: { q: 'אשד' } }, size: 100, def: { key: 'id', dir: 'asc' } });
  assert.ok(q.rows.every((r) => r.units >= 50 && r.city === 'אשדוד'));
  assert.deepStrictEqual(vals(q.rows, 'units'), vals(q.rows, 'units').slice().sort((a, b) => b - a));
  const all = TC.query(rows, cols, { size: 100, def: { key: 'id', dir: 'asc' } });
  assert.equal(all.total, 30); assert.deepStrictEqual(vals(all.rows, 'id'), rows.map((r) => r.id));
});
t('pagination pages the whole sorted set: page n = the n-th slice of the full order (never a page-local sort)', () => {
  const rows = Array.from({ length: 97 }, (_, i) => ({ id: i, v: (i * 37) % 101 === 0 ? null : (i * 37) % 101 }));
  const cols = { v: { type: 'number' }, id: { type: 'number' } };
  const full = TC.sortRows(rows, (r) => r.v, 'number', 'desc').map((r) => r.id);
  const paged = [1, 2, 3, 4].flatMap((page) => TC.query(rows, cols, { sort: 'v', order: 'desc', size: 25, page, def: { key: 'id', dir: 'asc' } }).rows.map((r) => r.id));
  assert.deepStrictEqual(paged, full);
  assert.equal(TC.query(rows, cols, { size: 25, page: 99, def: { key: 'id', dir: 'asc' } }).page, 4);
});
t('URL round trip: f_<col> parameters ↔ filters, only for columns marked filterable', () => {
  const cols = { units: { type: 'number', filter: true }, secret: { type: 'number' } };
  const f = TC.filtersFromParams(new URLSearchParams('f_units=10..&f_secret=1..2&f_nope=3'), cols, 'f_');
  assert.deepStrictEqual(f, { units: { min: 10, max: null } });
  assert.deepStrictEqual(TC.filtersToParams(f, cols, 'f_'), [['f_units', '10..']]);
});

console.log('server tables: full-dataset sort and column filters');
const LQ = require('../lib/land/query'), HQ = require('../lib/housing/query'), EQ = require('../lib/entities/query'), RQ = require('../lib/renewal/query');
const sortedLike = (arr, dir) => { const v = arr.filter((x) => x != null); const s = v.slice().sort((a, b) => (dir === 'asc' ? a - b : b - a)); return JSON.stringify(v) === JSON.stringify(s); };
const collect = (fn, pages) => { let out = []; for (let p = 1; p <= pages; p++) out = out.concat(fn(p).rows); return out; };
t('land tenders: every page in order across the whole set, missing last; the ₪/m² bid rows never mix with ₪ totals', () => {
  const { filters } = LQ.parseFilters(new URLSearchParams('scope=all'));
  const first = LQ.records(filters, { sort: 'landPerUnit', order: 'desc', size: 100, page: 1 });
  const all = collect((p) => LQ.records(filters, { sort: 'landPerUnit', order: 'desc', size: 100, page: p }), first.pages).map((r) => r.landPerUnit);
  const firstNull = all.indexOf(null);
  assert.ok(firstNull > 0 && all.slice(firstNull).every((x) => x == null), 'a missing land per unit sorted among values');
  assert.ok(sortedLike(all, 'desc'));
  const land = LQ.records(filters, { sort: 'awardedLandTotal', order: 'desc', size: 100 });
  assert.ok(land.rows.every((r) => !(r.priceBasis === 'price-per-sqm-bid' && r.pricePerSqmMin != null)), 'a ₪/m² bid ranked among ₪ totals');
  const f = LQ.records(filters, { size: 100, filters: LQ.columnFilters(new URLSearchParams('f_units=500..&f_publishedDate=2024-01-01..')) });
  assert.ok(f.total > 0 && f.total < f.beforeColumnFilters && f.rows.every((r) => r.units >= 500 && r.publishedDate >= '2024-01-01'));
});
t('land cities and developers: sorted over the whole list before the page limit', () => {
  const { filters } = LQ.parseFilters(new URLSearchParams('scope=all'));
  const S = LQ.summary(filters, { limit: 40, ...LQ.listTables(new URLSearchParams('cs=landPerUnit&co=asc&ds=lastWin&do=desc'), 'he') });
  assert.equal(S.citiesTable.sort, 'landPerUnit'); assert.ok(S.citiesTable.all > S.cities.length);
  assert.ok(sortedLike(S.cities.map((c) => c.landPerUnit), 'asc'));
  const mins = Object.values(require('../lib/land/query').summary(filters, { limit: 2000, ...LQ.listTables(new URLSearchParams('cs=landPerUnit&co=asc'), 'he') }).cities).map((c) => c.landPerUnit).filter((x) => x != null);
  assert.equal(S.cities[0].landPerUnit, Math.min(...mins), 'the first city is not the lowest of the whole list');
});
t('housing lotteries: price per m² over the whole set, missing last; a filter narrows before paging', () => {
  const { filters } = HQ.parseFilters(new URLSearchParams(''));
  const first = HQ.records(filters, { sort: 'pricePerSqm', order: 'asc', size: 100, page: 1 });
  const all = collect((p) => HQ.records(filters, { sort: 'pricePerSqm', order: 'asc', size: 100, page: p }), first.pages).map((r) => r.pricePerSqm);
  assert.ok(sortedLike(all, 'asc')); const i = all.indexOf(null); assert.ok(i < 0 || all.slice(i).every((x) => x == null));
  const f = HQ.records(filters, { size: 100, filters: HQ.columnFilters(new URLSearchParams('f_unitsInLottery=100..200')) });
  assert.ok(f.rows.every((r) => r.unitsInLottery >= 100 && r.unitsInLottery <= 200));
});
t('developers / projects / market entries: missing never 0; a mixed-measure column does not sort across sources', () => {
  const d = EQ.developers({ sort: 'land', order: 'asc', size: 100, page: 1 });
  const land = collect((p) => EQ.developers({ sort: 'land', order: 'asc', size: 100, page: p }), d.pages).map((r) => r.tenders.landTotalCompetitive);
  const i = land.indexOf(null); assert.ok(i > 0 && land.slice(i).every((x) => x == null), 'a developer without a competitive sum sorted as 0');
  assert.equal(EQ.projects({ sort: 'price', order: 'desc', size: 5 }).sort, 'date', 'price sorted across MoCH ₪/m² and ILA land values');
  assert.equal(EQ.projects({ kind: 'moch', sort: 'price', order: 'desc', size: 5 }).sort, 'price');
  const e = EQ.signals({ sort: 'earlier', order: 'asc', page: 1, size: 10 });
  assert.ok(e.pages >= 1 && sortedLike(e.rows.map((r) => Date.parse(r.earlierActivityFrom)), 'asc'));
});
t('urban renewal: proposed units missing last (never −1); the planning column sorts in stage order; legacy keys still work', () => {
  const r = RQ.records({ sort: 'proposedUnits', order: 'asc', size: 100, page: 1 });
  const all = collect((p) => RQ.records({ sort: 'proposedUnits', order: 'asc', size: 100, page: p }), r.pages).map((x) => x.proposedUnits);
  const i = all.indexOf(null); assert.ok(i > 0 && all.slice(i).every((x) => x == null)); assert.ok(sortedLike(all, 'asc'));
  assert.equal(RQ.records({ sort: 'proposed', order: 'desc', size: 5 }).sort, 'proposedUnits');
  assert.equal(RQ.records({ sort: 'maturity', size: 5 }).sort, 'declarationDate', 'a hidden value still ranks the table');
});

console.log('page: the shared table module');
const slice = (a, b) => INDEX.slice(INDEX.indexOf(a), INDEX.indexOf(b));
const PT_SRC = slice('const PTC=window.PropxTable;', 'const PT_DOM=');
const I18N_SRC = (() => { const i = INDEX.indexOf('const I18N={'); let d = 0; for (let k = INDEX.indexOf('{', i); k < INDEX.length; k++) { if (INDEX[k] === '{') d++; else if (INDEX[k] === '}' && --d === 0) return INDEX.slice(i, k + 1); } return ''; })();
const mkPage = (search = '') => {
  const store = {}, hist = [];
  const ctx = { window: { PropxTable: TC }, state: { lang: 'he' }, MKT: { nh: null, boi: null }, URLSearchParams, Intl,
    location: { search, pathname: '/', hash: '', protocol: 'https:' }, history: { state: null, replaceState: (s, _t, u) => { hist.push(u); ctx.location.search = u.includes('?') ? u.slice(u.indexOf('?')) : ''; } },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  vm.createContext(ctx);
  vm.runInContext(I18N_SRC + ';const T=()=>I18N[state.lang];const nf=new Intl.NumberFormat("en-US");const fmtInt=n=>nf.format(Math.round(n));' + PT_SRC +
    ';this.PT=PT;this.ptLoad=ptLoad;this.ptSave=ptSave;this.ptHead=ptHead;this.ptBar=ptBar;this.ptRows=ptRows;this.ptSort=ptSort;', ctx);
  return { ctx, store, hist };
};
const COLS = [{ k: 'name', label: 'שם', type: 'text', sort: true, filter: true }, { k: 'units', label: 'יח״ד', type: 'number', sort: true, filter: true, num: true },
  { k: 'note', label: 'הערה', type: 'text', sort: false, why: 'x' }];
t('header: ↕ on sortable columns, ↓/↑ and aria-sort on the active one, a labelled filter button, no control on others', () => {
  const { ctx } = mkPage(), st = ctx.ptLoad('x');
  let h = ctx.ptHead('x', COLS, st);
  assert.equal((h.match(/aria-sort="none"/g) || []).length, 2); assert.match(h, /data-pts="units"[^>]*>יח״ד<span class="pt-a" aria-hidden="true">↕<\/span>/);
  assert.match(h, /data-ptf="units" aria-haspopup="dialog" aria-expanded="false" aria-label="סינון: יח״ד"/);
  assert.doesNotMatch(h, /data-pts="note"|data-ptf="note"/);
  st.sort = { key: 'units', dir: 'desc', isDefault: false }; h = ctx.ptHead('x', COLS, st);
  assert.match(h, /aria-sort="descending" class="pt-n"><span class="pt-h"><button type="button" class="pt-s" data-pts="units"[^>]*>יח״ד<span class="pt-a" aria-hidden="true">↓<\/span>/);
});
t('state: per table in the URL (<key>.s / .p / .f.<col>) and the session — one table never reads another\'s', () => {
  const { ctx } = mkPage();
  const a = ctx.ptLoad('ld'); a.sort = { key: 'units', dir: 'asc', isDefault: false }; a.page = 3; a.f.units = '100..'; ctx.ptSave('ld');
  const b = ctx.ptLoad('ho'); b.f.city = '5000'; ctx.ptSave('ho');
  assert.match(ctx.location.search, /ld\.s=units%7Ea/); assert.match(ctx.location.search, /ld\.p=3/); assert.match(ctx.location.search, /ld\.f\.units=100\.\./); assert.match(ctx.location.search, /ho\.f\.city=5000/);
  const fresh = mkPage(ctx.location.search).ctx;           /* a reload / a shared link */
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fresh.ptLoad('ld'))), { sort: { key: 'units', dir: 'asc', isDefault: false }, page: 3, f: { units: '100..' }, x: {} });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fresh.ptLoad('ho').f)), { city: '5000' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(fresh.ptLoad('ind'))), { sort: null, page: 1, f: {}, x: {} });
});
t('client rows: filter then sort over every row held; the default order is the rows\' own; a reset clears both', () => {
  const { ctx } = mkPage(), rows = [{ name: 'גדרה', units: 30 }, { name: 'אילת', units: null }, { name: 'בני ברק', units: 300 }, { name: 'אשדוד', units: 120 }];
  const st = ctx.ptLoad('c'); st.f.units = '100..'; st.sort = { key: 'name', dir: 'asc', isDefault: false };
  assert.deepStrictEqual(ctx.ptRows('c', rows, COLS, { key: '', dir: 'asc' }).map((r) => r.name), ['אשדוד', 'בני ברק']);
  st.f = {}; st.sort = { key: 'units', dir: 'desc', isDefault: false };
  assert.deepStrictEqual(ctx.ptRows('c', rows, COLS, { key: '', dir: 'asc' }).map((r) => r.name), ['בני ברק', 'אשדוד', 'גדרה', 'אילת']);
  st.sort = null; assert.deepStrictEqual(ctx.ptRows('c', rows, COLS, { key: '', dir: 'asc' }).map((r) => r.name), rows.map((r) => r.name));
});
t('active filters show as removable chips (every width); the card view gets a compact sort select + filter button (narrow screens)', () => {
  const { ctx } = mkPage(), st = ctx.ptLoad('m'); st.f.units = '100..500';
  const bar = ctx.ptBar('m', COLS, st, { cards: true });
  assert.match(bar, /class="pt-chip"><b>יח״ד<\/b> 100 – 500<button type="button" data-ptx="units"/);
  assert.match(bar, /<label class="pt-m"><span>מיון<\/span><select class="ho-sel" data-ptsel/);
  assert.match(bar, /<option value="units~desc">יח״ד ↓<\/option><option value="units~asc">יח״ד ↑<\/option>/);
  assert.match(bar, /data-ptfm aria-haspopup="dialog"/);
  assert.match(INDEX, /@media\(max-width:719px\)\{\.pt-m\{display:inline-flex\}\}/);
});
t('the popover is an accessible dialog: labelled fields, Escape closes, focus returns, Tab stays inside, Enter applies; RTL placement', () => {
  const src = slice('function ptOpen(', '/**\n * Wire one table');
  assert.match(src, /setAttribute\("role","dialog"\)/); assert.match(src, /aria-labelledby/);
  assert.match(src, /e\.key==="Escape"\)\{e\.preventDefault\(\);ptClose\(true\)/); assert.match(src, /e\.key==="Tab"/); assert.match(src, /e\.key==="Enter"/);
  assert.match(src, /state\.lang==="he"\?r\.right-W:r\.left/); assert.match(src, /vw<560\)\{el\.classList\.add\("sheet"\)/);
  const ctl = slice('function ptCtl(', 'function ptRead(');
  for (const k of ['ptContains', 'ptAnyOf', 'ptFrom', 'ptTo', 'ptMin', 'ptMax']) assert.match(ctl, new RegExp(`t\\.${k}`), k);
  assert.match(ctl, /<label class="pt-fl" for="\$\{id\}0">/);
});
t('drawer-return: opening or closing a drawer never touches a table\'s state; a re-render keeps keyboard focus', () => {
  for (const fn of ['ldOpen', 'hoOpen', 'ldClose', 'hoClose']) {
    const i = INDEX.indexOf(`function ${fn}(`); if (i < 0) continue;
    const body = INDEX.slice(i, INDEX.indexOf('\n}', i));
    assert.doesNotMatch(body, /ptLoad|ptSave|\.page=1|sort=/, fn + ' resets a table');
  }
  assert.match(INDEX, /function ptRefocus\(\)/); assert.match(INDEX, /PT\.focus=\{key:cfg\.key,sel:`\[data-pts="\$\{c\.k\}"\]`\}/);
});
t('every table family is wired: server tables send sort / order / lang / f_* and read their state from the URL', () => {
  assert.match(INDEX, /view:"tenders",sort:so\.key,order:so\.dir,page:ldState\.page,size:LD_PAGE,lang:state\.lang,\.\.\.ptParams\("ld","f_",ldCols\(\)\)/);
  assert.match(INDEX, /view:"records",sort:so\.key,order:so\.dir,page:hoState\.page,size:HO_PAGE,lang:state\.lang,\.\.\.ptParams\("ho","f_",hoCols\(\)\)/);
  assert.match(INDEX, /p\.set\("sort",so\.key\);p\.set\("order",so\.dir\);p\.set\("lang",state\.lang\)/);
  for (const k of ['"board"', '"ld"', '"ldc"', '"ldd"', '"ldr"', '"ho"', '"tx"', '"tc"', 'IN_KEY[tab]']) assert.ok(INDEX.includes(`key:${k}`), 'no binding for ' + k);
  for (const k of ['ldlots', 'ldplans', 'hoproj', 'indm', 'inds', 'indp', 'inpl', 'inrc', 'dist']) assert.ok(INDEX.includes(`data-ptdom="${k}"`), 'small table not enhanced: ' + k);
  assert.doesNotMatch(INDEX, /data-ldsort|data-hosort|data-insort/, 'an old one-off sort control remains');
});
t('the board still ranks only official values; the deals table says when it sorts the loaded deals only', () => {
  const rt = INDEX.slice(INDEX.indexOf('function renderTable(){'), INDEX.indexOf('/* ---------- market rankings ---------- */'));
  assert.match(rt, /const canSort=c=>c\.key==="name"\|\|rankable\(c\.f,rows\)/); assert.match(rt, /filter:sortable/);
  assert.match(rt, /const shownTx=r=>\{const x=sale\?txShown\(r\.loc\):invShown\(r\.loc\);return x\.show\?x\.v:null\}/);
  assert.doesNotMatch(rt, /r\.m\.tx\b/, 'the board sorts on the research base.tx');
  assert.match(INDEX, /const more=\(reg\|\|uniM\)&&\(txState\.more\|\|txState\.olderMore\),note=/); assert.match(INDEX, /async function txLoadAll\(\)/);
});

t('18.10.2026 — every remaining data table sorts: the dossier freshness + developers tables, the Pulse revisions, the developer drawer land by track and the capital bulk table carry data-ptdom with a PT_DOM spec; mixed period formats sort on a day key the cell carries (data-v), the shown text unchanged', () => {
  const specs = Object.fromEntries([...INDEX.matchAll(/^  (\w+):"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  for (const [k, n] of [['dsfresh', 5], ['dsdevs', 6], ['purev', 7], ['indl', 5], ['cibulk', 5]]) { assert.ok(specs[k], k); assert.equal(specs[k].split(',').length, n, k); assert.ok(INDEX.includes(`data-ptdom="${k}"`), k + ' table'); }
  assert.match(INDEX, /ptDomAll\(body\);/); assert.match(INDEX, /ptDomAll\(box\);/); assert.match(INDEX, /ptDomAll\(el\("capital"\)\);/); assert.match(INDEX, /ptDomAll\(el\("ciDetailIn"\)\);/);
  const fn = INDEX.match(/const ptDayKey=v=>\{[^\n]+\};/)[0]; const ptDayKey = new Function(fn + 'return ptDayKey;')();
  assert.equal(ptDayKey('2026-10-15T08:00:00Z'), '2026-10-15'); assert.equal(ptDayKey('2026-08'), '2026-08-31'); assert.equal(ptDayKey('2026-Q2'), '2026-06-31'); assert.equal(ptDayKey(null), '');
  assert.ok(['2026-06-31', '2026-08-31', '2026-10-15'].every((v, i, a) => !i || a[i - 1] < v), 'quarter < month < day keys order chronologically');
  assert.match(INDEX, /data-v="\$\{ptDayKey\(f\.observed\)\}">\$\{ldE\(f\.observed\?puDay\(f\.observed\):"—"\)\}/, 'the shown text is unchanged');
});

console.log(`\ntables: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
