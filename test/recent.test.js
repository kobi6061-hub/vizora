// PROPX · RECENT TRANSACTIONS LAYER gates (20.10.2026): the newer GovMap-layer copy (over.org.il) read as a SEPARATE recent-evidence
// source beside the register copy — never a replacement. Over the stored data (data/streets/recent + data/streets/evidence):
//   THE 2,293 RECONCILE EXACTLY (the 19.10.2026 comparison replayed per city, every late deal mapped to one class) ·
//   EVERY FETCHED ROW EXACTLY ONE CLASS · A SHOWN ROW IS NOT IN THE REGISTER (any locality holding its parcel) · NO DEAL TWICE ·
//   FUTURE-DATED / UNPLACED / DUPLICATE ROWS NEVER SHOWN · THE REGISTER IS NEVER OVERWRITTEN · DETERMINISTIC (input order) ·
//   STALE AGAINST THE REGISTER → NOTHING LISTED · NEVER IN A MEDIAN, A SAMPLE STATE OR THE STREET VALUE MODEL
// Offline: node test/recent.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'streets', 'recent');
const R = require('../lib/recent/reconcile');
const RR = require('../lib/recent/read');
const W = require('../lib/recent/window');
const EV = require('../lib/streets/evidence');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const num = (v) => (v == null || v === '' ? null : Number(v));
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

const meta = readJson(path.join(DIR, 'meta.json'));
const layer = readJson(path.join(DIR, 'layer.json'));
const rec = readJson(path.join(DIR, 'reconciliation.json'));
const audit = readJson(path.join(DIR, 'audit-2293.json'));
const idx = readJson(path.join(DIR, 'raw', 'index.json'));
const snap = idx.snapshots.filter((x) => x.kind === 'window').pop();
const raw = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'raw', snap.file))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const S = EV.store();
const col = (k) => layer.columns.indexOf(k);
const rows = layer.rows.map((r) => Object.fromEntries(layer.columns.map((c, i) => [c, r[i]])));

console.log('recent: the stored copy and its reconciliation');

t('the GovMap-layer window is stored VERBATIM with its completeness proof: the hash of the rows is the recorded one; paging overlaps all agreed; the layer was built from it', () => {
  const body = raw.map((g) => JSON.stringify(g)).join('\n') + '\n';
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), snap.sha256);
  assert.equal(snap.rows, raw.length); assert.equal(snap.proof.overlapDisagreements, 0); assert.equal(snap.proof.firstPageRepeatIdentical, true);
  assert.equal(snap.proof.overlapChecks, snap.proof.pages - 1);
  assert.equal(meta.source.snapshot.sha256, snap.sha256); assert.equal(meta.inputs.snapshot, snap.sha256);
  assert.equal(new Set(raw.map((g) => g.objectid)).size, raw.length, 'one row per object id');
  /* the window: 75 days before the register copy's latest deal → the copy's load day; context rows 6 days before it */
  assert.equal(meta.window.from, W.minusDays(S.meta.source.lastDeal, W.RECENT_LAG_DAYS)); assert.equal(meta.window.to, String(meta.source.loadedAt).slice(0, 10));
  assert.ok(raw.every((g) => String(g.deal_date).slice(0, 10) >= snap.window.contextFrom || raw.indexOf(g) >= raw.length - 200), 'the read stops at the first page that ends before the context day');
});

t('THE 2,293 RECONCILE EXACTLY: the 19.10.2026 comparison replayed over its own stored input reproduces every city\'s late-reported count, and every late deal has exactly one class here', () => {
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'audit', `replay-v${meta.source.version}.jsonl.gz`))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const rp = readJson(path.join(DIR, 'audit', `replay-v${meta.source.version}.meta.json`));
  assert.equal(lines.length, rp.rows);
  let total = 0;
  const late = [];
  for (const [city, expected] of Object.entries(R.AUDIT.late)) {
    const res = R.auditClassify(lines.filter((x) => x.city === city).map((x) => x.row), EV, R.AUDIT_CODES[city]);
    const l = res.filter(([, c]) => c === 'MISSING_IN_PROPX_REPORTED_LATE').map(([oid]) => oid);
    assert.equal(l.length, expected, `${city}: replayed ${l.length}, the comparison found ${expected}`);
    total += l.length; late.push(...l);
  }
  assert.equal(total, 2293); assert.equal(new Set(late).size, 2293, 'no late deal counted twice');
  assert.equal(audit.replayedTotal, 2293); assert.equal(audit.exact, true);
  const cls = new Map(rec.rows.map((r) => [r[0], r[1]]));
  for (const oid of late) assert.ok(cls.has(oid), `late deal ${oid} is in the reconciled window`);
  const sum = Object.values(audit.newClasses).reduce((a, b) => a + b, 0);
  assert.equal(sum, 2293, 'the 2,293 split into classes without remainder');
  assert.ok(!audit.newClasses.NOT_IN_WINDOW_SNAPSHOT);
  /* every late deal now in the register says why the comparison called it missing */
  for (const r of audit.rows) if (/REGISTER/.test(r[2])) assert.ok(r[6], `${r[0]} needs its in-register reason`);
});

t('EVERY FETCHED ROW EXACTLY ONE CLASS, from the documented list; only RECENT_NEW is shown; the class tally is the stored one', () => {
  assert.equal(rec.rows.length, raw.length);
  assert.equal(new Set(rec.rows.map((r) => r[0])).size, raw.length);
  for (const r of rec.rows) assert.ok(R.CLASSES.includes(r[1]), r[1]);
  const tally = {}; for (const r of rec.rows) tally[r[1]] = (tally[r[1]] || 0) + 1;
  assert.deepEqual(tally, meta.classes);
  assert.equal(layer.rows.length, meta.classes.RECENT_NEW); assert.equal(meta.shown.rows, layer.rows.length);
  const shown = new Set(layer.rows.map((r) => r[0]));
  for (const r of rec.rows) assert.equal(shown.has(r[0]), r[1] === 'RECENT_NEW', `${r[0]} ${r[1]}`);
});

t('UNSAFE ROWS ARE NEVER SHOWN: future-dated (after the copy\'s load day), unplaced (no / unmapped settlement), context, in-source duplicates, possibly-in-register', () => {
  const loadDay = meta.window.to;
  const byOid = new Map(raw.map((g) => [Number(g.objectid), g]));
  for (const r of rec.rows) {
    const d = String(byOid.get(r[0]).deal_date).slice(0, 10);
    if (r[1] === 'FUTURE_DATED') assert.ok(d > loadDay, `${r[0]} ${d}`);
    if (r[1] === 'CONTEXT_BEFORE_WINDOW') assert.ok(d < meta.window.from);
  }
  assert.ok(meta.classes.FUTURE_DATED > 0, 'the copy does publish future dates — they are classed, not shown');
  for (const x of rows) {
    assert.ok(x.date >= meta.window.from && x.date <= loadDay, `${x.oid} ${x.date} inside the window`);
    assert.ok(x.cityCode != null, `${x.oid} placed`);
  }
  assert.ok(rows.every((x) => x.date <= meta.source.lastDeal), 'no shown deal after the copy\'s own latest deal');
});

t('IN-SOURCE DUPLICATES: an untyped row pairs with ONE typed row of the same locality · block · parcel, amount within ₪1,000, area within 5 %, dated the same day or one day earlier — or with the row that holds the register deal of its exact amount', () => {
  const g = new Map(raw.map((x) => [Number(x.objectid), R.normalize(x)]));
  const recBy = new Map(rec.rows.map((r) => [r[0], r]));
  let n = 0, viaReg = 0, viaShare = 0;
  for (const r of rec.rows.filter((x) => x[1] === 'DUPLICATE_IN_SOURCE')) {
    const u = g.get(r[0]), tw = g.get(r[4]);
    assert.ok(tw, `${r[0]} names its twin`);
    assert.ok(tw.gush === u.gush && tw.parcel === u.parcel, `${r[0]} same block · parcel`);
    if (r[5] === 'register-share') {
      /* the whole-property value of a partial-sale register deal another row prints: "<date> <unit> <amount>" of that deal, its portion < 1 */
      viaShare++; assert.ok(/REGISTER/.test(recBy.get(r[4])[1]), 'the holder holds a register deal'); continue;
    }
    assert.ok(!u.typed, `${r[0]} is the untyped series`);
    if (r[5] === 'register-amount') { viaReg++; assert.ok(/REGISTER/.test(recBy.get(r[4])[1]), 'the holder holds a register deal'); continue; }
    assert.ok(tw.typed); assert.ok(Math.abs(tw.amount - u.amount) < 1000); assert.ok([0, 1].includes(dayDiff(tw.date, u.date)));
    assert.ok(Math.abs(tw.area - u.area) <= Math.max(1, 0.05 * Math.max(tw.area, u.area)));
    n++;
  }
  assert.ok(n > 1000 && viaReg >= 1 && viaShare >= 1, `${n} twins, ${viaReg} through the register's amount, ${viaShare} through a partial sale's whole value`);
  /* a typed row is the twin of at most one untyped row */
  const twins = rec.rows.filter((x) => x[1] === 'DUPLICATE_IN_SOURCE' && !/^register-/.test(x[5] || '')).map((x) => x[4]);
  assert.equal(new Set(twins).size, twins.length);
});

t('NO DEAL LISTED TWICE: no shown row without a property type has a shown typed row of the same locality · block · parcel with the amount within ₪1,000 within three days (whatever the area), and no two shown rows share date · amount · area · parcel', () => {
  const typed = new Map();
  for (const x of rows) if (x.kind !== 'TYPE_NOT_STATED') { const k = `${x.cityCode}|${x.block}|${x.parcel}`; if (!typed.has(k)) typed.set(k, []); typed.get(k).push(x); }
  for (const u of rows.filter((x) => x.kind === 'TYPE_NOT_STATED')) {
    const hit = (typed.get(`${u.cityCode}|${u.block}|${u.parcel}`) || []).find((t) => t.amount != null && u.amount != null && Math.abs(t.amount - u.amount) < 1000 && Math.abs(dayDiff(t.date, u.date)) <= 3);
    assert.ok(!hit, `${u.oid} and ${hit && hit.oid} may be one deal — both shown`);
  }
  const keys = rows.map((x) => `${x.cityCode}|${x.date}|${x.amount}|${x.areaSqm}|${x.block}|${x.parcel}`);
  assert.equal(new Set(keys).size, keys.length);
});

t('A SHOWN ROW IS NOT IN THE REGISTER: no register deal on its unit or parcel within one day with an agreeing amount, in ANY locality whose register lists that parcel — and no register deal is claimed twice', () => {
  const codes = fs.readdirSync(EV.DIR).filter((f) => /^\d+\.json$/.test(f)).map((f) => Number(f.replace('.json', '')));
  const want = new Set(rows.map((x) => `${x.block}|${x.parcel}`));
  const byParcel = new Map();
  for (const c of codes) {
    const sh = EV.shardOf(c); if (!sh) continue;
    if (!sh.parcels.some((p) => want.has(`${num(p[0])}|${num(p[1])}`))) continue;
    for (const x of EV.dealsOf(sh)) { const k = `${num(x.deal.gush)}|${num(x.deal.helka)}`; if (!want.has(k)) continue; if (!byParcel.has(k)) byParcel.set(k, []); byParcel.get(k).push({ ...x.deal, code: c }); }
  }
  /* the register deals the reconciliation gave to a row (window or context) */
  const held = new Set(rec.rows.filter((r) => r[6]).map((r) => r[6]));
  let free = 0;
  for (const x of rows) {
    for (const d of byParcel.get(`${x.block}|${x.parcel}`) || []) {
      if (Math.abs(dayDiff(d.date, x.date)) > 1) continue;
      const agree = d.amount != null && x.amount != null && (d.amount === x.amount || (x.amount <= d.amount && d.amount - x.amount < 1000));
      const ref = `${d.date} ${num(d.gush)}/${num(d.helka)}/${num(d.subParcel) == null ? '—' : num(d.subParcel)} ${d.amount}`;
      if (agree && !held.has(ref)) assert.fail(`shown row ${x.oid} (${x.date} ${x.amount}) agrees with an unclaimed register deal ${ref} in ${d.code}`);
      if (agree) free++;
    }
  }
  /* each register deal held by at most one row */
  const refs = rec.rows.filter((r) => r[6] && r[1] !== 'DUPLICATE_IN_SOURCE').map((r) => `${r[3]}|${r[6]}`);
  assert.equal(new Set(refs).size, refs.length, 'a register deal absorbs at most one row');
  assert.ok(free >= 0);
});

t('THE REGISTER IS NEVER OVERWRITTEN: the engine writes only data/streets/recent; register fields stand beside the copy\'s as conflicts (both values kept)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'recent', 'reconcile.js'), 'utf8');
  for (const m of src.matchAll(/(writeFileSync|appendFileSync)\(([^,]+),/g)) assert.equal(m[2], 'path.join(dir', 'writes only into the recent folder: ' + m[0]);
  assert.ok(!/require\(['"]\.\.\/recent/.test(fs.readFileSync(path.join(ROOT, 'lib', 'streets', 'evidence.js'), 'utf8')), 'evidence.js never reads the recent layer');
  for (const f of ['value-model.js', 'value-validate.js', 'value-read.js', 'evidence.js', 'match.js']) assert.ok(!/require\([^)]*recent/.test(fs.readFileSync(path.join(ROOT, 'lib', 'streets', f), 'utf8')), f + ' never reads the recent layer');
  assert.ok(!/lib\/recent|recent\/read|recent\/reconcile/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'street-model-build.js'), 'utf8')), 'the model build never reads the recent layer');
  const withConflicts = rec.rows.filter((r) => /REGISTER/.test(r[1]) && r[7]);
  assert.ok(withConflicts.length > 1000);
  for (const r of withConflicts.slice(0, 200)) assert.match(r[7], /→/, 'each conflict keeps the copy\'s value → the register\'s value');
  assert.ok(meta.conflictFields['sub-parcel'] > 0 && meta.conflictFields['amount:truncated'] > 0);
});

t('THE STREET VALUE MODEL IS UNTOUCHED: none of the dependencies it reads moved (lib/streets/model-deps.js — code closure, evidence, directory, neighbourhood links, subsidized parcels); no recent-layer file is model code or a model input', () => {
  const MD = require('../lib/streets/model-deps');
  const c = MD.check();
  assert.equal(c.stale, false, 'moved: ' + (c.moved || []).join(', '));
  assert.ok(!MD.codeClosure().some((f) => /recent/.test(f)), 'the recent layer is not in the model\'s code closure');
  const model = readJson(path.join(ROOT, 'data', 'streets', 'model', 'model.json'));
  assert.ok(!/recent/.test(JSON.stringify(model.inputs || {})), 'no recent-layer file among the model inputs');
  assert.equal(S.meta.source.scrapedAt, model.inputs.evidence.scrapedAt, 'the model rests on the register copy only');
});

t('DETERMINISTIC: the stored layer is what the engine builds from the stored inputs, and shuffling the source rows changes nothing', () => {
  const res = R.build({ write: false });
  assert.equal(res.ok, true);
  assert.deepEqual(res.layer.rows, layer.rows); assert.deepEqual(res.meta.classes, meta.classes);
  const D = require('../lib/streets/directory').load(), M = require('../lib/streets/match');
  const win = W.windowOf(S.meta.source.lastDeal);
  const shuffled = raw.map((x, i) => [((i * 2654435761) >>> 0) % 1000003, x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const a = R.reconcile(shuffled, { window: win, loadDay: meta.window.to, EV, D, M });
  const cls = new Map(rec.rows.map((r) => [r[0], r[1]]));
  for (const [oid, o] of a.out) assert.equal(o.cls, cls.get(oid), `${oid} keeps its class whatever the input order`);
});

t('THE STREET LINK: a shown row is on a street only by its published address (an official match) and / or the register\'s parcel crosswalk; an address contradicting the parcel is not attached', () => {
  const ok = new Set(['address', 'address+parcel', 'parcel']);
  for (const x of rows) {
    if (x.streetCode != null) assert.ok(ok.has(x.streetBasis), `${x.oid} ${x.streetBasis}`);
    else assert.ok(!ok.has(x.streetBasis), `${x.oid} has no street but basis ${x.streetBasis}`);
  }
  assert.ok(rows.some((x) => x.streetBasis === 'conflict' && x.streetCode == null), 'conflicting address / parcel → not attached');
  for (const [id, ix] of Object.entries(layer.byStreet)) for (const i of ix) assert.equal(`st:${layer.rows[i][col('cityCode')]}:${layer.rows[i][col('streetCode')]}`, id);
});

console.log('recent: the promotion of every shown row');

const PR = require('../lib/recent/promote');
const promo = readJson(path.join(DIR, 'promotion.json'));
const pcol = (k) => promo.columns.indexOf(k);
const prows = promo.rows.map((r) => Object.fromEntries(promo.columns.map((c, i) => [c, r[i]])));

t('EVERY SHOWN ROW HAS EXACTLY ONE PROMOTION STATE from the five, stored beside it in the layer; the tally is the stored one', () => {
  assert.equal(prows.length, rows.length);
  const st = new Map(prows.map((r) => [r.oid, r.state]));
  for (const x of rows) { assert.ok(PR.STATES.includes(x.state), x.state); assert.equal(st.get(x.oid), x.state, `${x.oid} layer state = promotion state`); }
  const tally = Object.fromEntries(PR.STATES.map((s) => [s, prows.filter((r) => r.state === s).length]));
  assert.deepEqual(tally, meta.promotion.byState);
});

t('THE RULES, on synthetic rows: every criterion met (share stated) → VERIFIED; then each single failure lands in its state with its reason', () => {
  const reg = { code: 1, byParcel: new Map() };
  const base = { oid: 1, typed: true, code: 1, placedBy: 'settlement', date: '2026-08-01', amount: 2000000, area: 100, areaM: 100, rooms: 4, gush: 10, parcel: 20, sub: 1, nature: 'דירה בבית קומות' };
  const run = (r, o, extra = {}) => {
    const res = { rows: [r], out: new Map([[r.oid, { cls: 'RECENT_NEW', kind: 'DWELLING', street: { code: 5, basis: 'address+parcel' }, ...o }]]), consumed: new Map(),
      registersOf: () => [reg], parcelCodes: new Map([['10|20', [1]]]) };
    return PR.promote(res, { raw: new Map([[r.oid, { objectid: r.oid, ...extra }]]), window: { from: '2026-07-04' }, lastDeal: '2026-09-28', snapshotSha: 'x' }).get(r.oid);
  };
  assert.equal(run(base, {}, { deal_part: 1 }).state, 'RECENT_OBSERVED_VERIFIED');
  const v = run(base, {}, { deal_part: 1 });
  assert.deepEqual(v.eligible, { event: true, eventFailed: [], count: true, median: true, pricePerSqm: true, change: false, model: false });
  const L = run(base, {}); assert.equal(L.state, 'RECENT_OBSERVED_LIMITED'); assert.deepEqual(L.reasons, ['share-not-stated']); assert.equal(L.eligible.median, false); assert.equal(L.eligible.event, true);
  assert.equal(L.semantics, 'UNKNOWN', 'a recent-only row never states its semantics');
  assert.deepEqual(run(base, { street: { code: 5, basis: 'address' } }, { deal_part: 1 }).reasons, ['street-single-key']);
  assert.deepEqual(run(base, { street: { code: 5, basis: 'address' } }).eligible.eventFailed, ['state', 'street'], 'a one-key street is never counted');
  assert.deepEqual(run(base, { kind: 'NON_DWELLING' }).eligible.eventFailed, ['state', 'dwelling']);
  assert.equal(run(base, { street: { code: null, basis: 'conflict' } }).state, 'RECENT_CONFLICT');
  assert.equal(run({ ...base, typed: false }, { kind: 'TYPE_NOT_STATED' }).state, 'RECENT_UNRESOLVED');
  assert.equal(run(base, { kind: 'NON_DWELLING' }).state, 'RECENT_CONTEXT_ONLY');
  assert.equal(run(base, { street: { code: null, basis: 'no-address' } }).state, 'RECENT_CONTEXT_ONLY');
  assert.equal(run(base, { street: { code: null, basis: 'unresolved' } }).state, 'RECENT_UNRESOLVED');
  assert.equal(run({ ...base, amount: 50000 }, {}, { deal_part: 1 }).reasons.includes('below-market-amount'), true);
  /* a register deal on the parcel the same day at a fitting amount → possible duplicate → CONFLICT; far apart in amount and area → separate */
  reg.byParcel.set('10|20', [{ i: 0, date: '2026-08-01', amount: 2000500, areaSqm: 100, rooms: 4, portionFraction: 1, gushN: 10, helkaN: 20, subN: 3 }]);
  const c = run(base, {}, { deal_part: 1 }); assert.equal(c.state, 'RECENT_CONFLICT'); assert.equal(c.audit.verdict, 'POSSIBLE_DUPLICATE');
  reg.byParcel.set('10|20', [{ i: 0, date: '2026-08-01', amount: 1400000, areaSqm: 70, rooms: 3, portionFraction: 1, gushN: 10, helkaN: 20, subN: 3 }]);
  assert.equal(run(base, {}, { deal_part: 1 }).audit.verdict, 'CONFIRMED_SEPARATE_DEAL');
  reg.byParcel.set('10|20', [{ i: 0, date: '2026-08-01', amount: 1400000, areaSqm: 100, rooms: 4, portionFraction: 1, gushN: 10, helkaN: 20, subN: 3 }]);
  assert.equal(run(base, {}, { deal_part: 1 }).audit.verdict, 'LIKELY_SEPARATE_DEAL');
  reg.byParcel.set('10|20', [{ i: 0, date: '2026-08-01', amount: 1010000, areaSqm: 100, rooms: 4, portionFraction: 0.5, gushN: 10, helkaN: 20, subN: 3 }]);
  assert.equal(run(base, {}, { deal_part: 1 }).audit.verdict, 'POSSIBLE_DUPLICATE', 'the whole-property value of a partial sale fits');
  reg.byParcel.set('10|20', []);
  /* a settlement name placing the row in a locality the register never lists for its parcel → CONFLICT */
  const res2 = { rows: [base], out: new Map([[1, { cls: 'RECENT_NEW', kind: 'DWELLING', street: { code: 5, basis: 'address+parcel' } }]]), consumed: new Map(), registersOf: () => [reg], parcelCodes: new Map([['10|20', [2]]]) };
  assert.deepEqual(PR.promote(res2, { raw: new Map([[1, { objectid: 1, deal_part: 1 }]]), window: { from: '2026-07-04' }, lastDeal: '2026-09-28', snapshotSha: 'x' }).get(1).reasons, ['locality-name-vs-parcel']);
});

t('SHARE: the copy states no share sold (no such field in any stored row), and over the deals both copies hold it prints partial sales both as the share and as the whole value — so nothing is VERIFIED and no price enters a statistic', () => {
  const fields = new Set(raw.flatMap((g) => Object.keys(g)));
  for (const f of PR.SHARE_FIELDS) assert.ok(!fields.has(f), f);
  const e = meta.promotion.shareEvidence;
  assert.ok(e.partial > 100 && e.printedShare > 0 && e.printedWhole > 0, JSON.stringify(e));
  assert.equal(meta.promotion.byState.RECENT_OBSERVED_VERIFIED, 0);
  for (const r of prows) {
    if (r.state !== 'RECENT_OBSERVED_VERIFIED') { assert.equal(r.count, false); assert.equal(r.median, false); assert.equal(r.pricePerSqmEligible, false); }
    assert.equal(r.change, false); assert.equal(r.model, false);
    if (r.event) { assert.ok(['RECENT_OBSERVED_VERIFIED', 'RECENT_OBSERVED_LIMITED'].includes(r.state)); assert.ok(r.reasons.every((x) => ['share-not-stated', 'below-market-amount', 'several-units-one-consideration'].includes(x)), r.oid); assert.deepEqual(r.eventFailed, []); }
    else assert.ok(r.eventFailed.length > 0, r.oid + ' names the gate it failed');
  }
});

t('THE PROMOTED SET IS CLEAN: every LIMITED / VERIFIED row is a placed dwelling deal on an official street, in the window, with a block · parcel, its locality coherent with the register\'s parcel list, no conflict, no possible duplicate', () => {
  const byOid = new Map(rows.map((x) => [x.oid, x]));
  const recBy = new Map(rec.rows.map((r) => [r[0], r[1]]));
  for (const p of prows.filter((r) => ['RECENT_OBSERVED_VERIFIED', 'RECENT_OBSERVED_LIMITED'].includes(r.state))) {
    const x = byOid.get(p.oid);
    assert.equal(x.kind, 'DWELLING'); assert.ok(x.streetCode != null); assert.ok(x.block != null && x.parcel != null);
    assert.ok(x.date >= meta.window.from && x.date <= meta.source.lastDeal);
    assert.equal(recBy.get(p.oid), 'RECENT_NEW');
    assert.ok(p.audit == null || ['CONFIRMED_SEPARATE_DEAL', 'LIKELY_SEPARATE_DEAL'].includes(p.audit), `${p.oid} audit ${p.audit}`);
    assert.ok(!p.reasons.some((r) => /conflict|duplicate|unresolved|not-stated$|no-street|not-a-dwelling/.test(r) && r !== 'share-not-stated'), p.oid + ' ' + p.reasons);
  }
  /* a register deal of a partial sale printed twice by the copy (share + whole value) is never shown twice */
  assert.ok(rec.rows.some((r) => r[1] === 'DUPLICATE_IN_SOURCE' && r[5] === 'register-share'));
});

t('THE SAME-PARCEL AUDIT: the 49 reported cases are each audited against the register deal no row prints; every verdict is one of four, from tolerances no same-deal pair exceeds; POSSIBLE DUPLICATE / UNRESOLVED never reach a statistic', () => {
  const F = readJson(path.join(ROOT, 'test', 'fixtures', 'recent-same-parcel-49.json'));
  const byOid = new Map(prows.map((r) => [r.oid, r]));
  assert.equal(F.oids.length, 49);
  for (const oid of F.oids) { const p = byOid.get(oid); assert.ok(p, `${oid} still shown`); assert.equal(p.freeRegisterDeal, true, `${oid} audited against a register deal no row prints`); }
  for (const [oid, cases] of Object.entries(promo.audits)) {
    assert.ok(cases.length > 0);
    for (const c of cases) assert.ok(PR.AUDIT.includes(c.verdict), c.verdict);
    const worst = cases.reduce((w, c) => (PR.AUDIT.indexOf(c.verdict) > PR.AUDIT.indexOf(w) ? c.verdict : w), PR.AUDIT[0]);
    assert.equal(byOid.get(Number(oid)).audit, worst, oid);
    if (['POSSIBLE_DUPLICATE', 'UNRESOLVED'].includes(worst)) assert.ok(['RECENT_CONFLICT', 'RECENT_UNRESOLVED'].includes(byOid.get(Number(oid)).state));
  }
  const cal = meta.promotion.calibration;
  assert.ok(cal.typed.pairs > 2000); assert.equal(cal.typed.overTol, 0); assert.equal(cal.untyped.overTol, 0);
  assert.ok(cal.typed.maxAmountPct <= cal.amountTolPct && cal.typed.maxAreaPct <= cal.areaTolPct);
});

console.log('recent: the read, the API, the page');

t('THE READ: a street\'s recent deals apart (DWELLING · TYPE NOT STATED · NON-DWELLING), the copy\'s dates apart, its state — and the register\'s street figures are byte-identical with or without it', () => {
  const id = Object.entries(layer.byStreet).sort((a, b) => b[1].length - a[1].length)[0][0];
  const r = RR.forStreet(id);
  assert.equal(r.available, true); assert.equal(r.counts.DWELLING + r.counts.TYPE_NOT_STATED + r.counts.NON_DWELLING, layer.byStreet[id].length);
  assert.ok(r.dwelling.every((d) => d.kind === 'DWELLING') && r.typeNotStated.every((d) => d.kind === 'TYPE_NOT_STATED'));
  assert.equal(r.source.id, 'over:govmap-recent'); assert.equal(r.source.snapshotAt, meta.source.loadedAt); assert.equal(r.source.publicationDate, null);
  assert.match(r.source.cls, /not a government channel/);
  assert.ok(r.dateNote && r.dateNote.verified > 0 && r.dateNote.oneDayLater === r.dateNote.verified, 'the untyped series\' date note rests on the verified pairs');
  const ST = require('../lib/streets/street');
  const s = ST.street(id);
  assert.deepEqual(s.evidence.stats, EV.street(id).stats, 'the register stats never take a recent deal');
  assert.equal(s.recent.available, true);
  const regDeals = new Set(s.evidence.deals.map((d) => `${d.date}|${d.amount}|${d.gush}/${d.helka}`));
  assert.ok(s.recent.dwelling.every((d) => !regDeals.has(`${d.date}|${d.amount}|${d.block}/${d.parcel}`)), 'no recent deal is also listed as a register deal');
});

t('STALE AGAINST THE REGISTER → NOTHING LISTED: a layer reconciled against another register copy shows no deal until the next reconciliation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-recent-'));
  try {
    const m2 = { ...meta, register: { ...meta.register, scrapedAt: '2026-01-01 00:00:00+00' } };
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(m2)); fs.copyFileSync(path.join(DIR, 'layer.json'), path.join(tmp, 'layer.json')); fs.copyFileSync(path.join(DIR, 'sync-runs.jsonl'), path.join(tmp, 'sync-runs.jsonl'));
    const id = Object.keys(layer.byStreet)[0];
    const r = RR.forStreet(id, { dir: tmp });
    assert.equal(r.available, false); assert.equal(r.reason, 'register-copy-changed'); assert.ok(!r.dwelling);
    assert.equal(RR.summary({ dir: tmp }).shown.rows, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

t('THE NEWER COPY IS READ, NOT REPLACING: the freshness strip names it as read (a separate layer); the register\'s freshness block is unchanged; the monitor raises no lag alert for the copy it reads', () => {
  const F = require('../lib/gov/freshness').fromDisk();
  const n = (F.newerCopies || []).find((x) => x.id === 'over:govmap-layer');
  if (n && String(n.snapshotAt) === String(meta.source.loadedAt)) assert.equal(n.readByPropx, true);
  assert.equal(F.sourceId, 'over:deals-register'); assert.equal(F.snapshotAt, S.meta.source.scrapedAt, 'the register copy stays the primary universe');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'tx-freshness.js'), 'utf8');
  assert.match(src, /!n\.readByPropx && n\.daysNewerLatestDeal >= LAG_ALERT_DAYS/);
});

t('API: view=recentLayer (summary · city=) and view=street → `recent`; the Trust Center lists over:govmap-recent (integrating the audited candidate); the registry explains it', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api', 'intel.js'), 'utf8');
  assert.match(api, /view === 'recentLayer'/); assert.match(api, /RR\.forLocality\(p\.city/);
  const T = require('../lib/trust/catalog').catalog().sources;
  const e = T.find((x) => x.id === 'over:govmap-recent');
  assert.ok(e && e.inProduct && e.channel === 'independent-republication' && e.discovery.integrates === 'discovery:over:govmap-layer');
  assert.equal(e.reconciliation.audit.exact, true);
  const d = T.find((x) => x.id === 'discovery:over:govmap-layer');
  if (d) assert.match(d.usedFor.en, /integrated as over:govmap-recent/);
  const X = require('../lib/explain/registry');
  for (const k of ['recent_transaction_layer', 'recent_transaction_type_not_stated']) assert.ok(X.term(k), k);
  assert.ok(X.MISSING.recent_layer_unavailable);
  const L = RR.forLocality(5000, { limit: 5 });
  assert.equal(L.available, true); assert.ok(L.total >= L.onStreets);
});

t('THE PAGE: a dashed SEPARATE LAYER line under the freshness strip; its deals in the ONE transaction-events table (lib/txevents — every row with its source and state; P0 20.10.2026) and its own table as a deep-dive source view — never in the tiles, the observed card or the model card; no "official" label', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('function siHTML('), html.indexOf('let _geoNav=false;'));
  assert.match(fn, /\$\{txFreshHTML\(D\.freshness,\{locality:true\}\)\}\s*\$\{recentLineHTML\(D\.recent\)\}/);
  assert.match(fn, /five\+=eventsTableHTML\(D\.events\);/);
  assert.match(fn, /deep\+=recentTableHTML\(D\.recent\);/);
  assert.ok(!/D\.recent/.test(fn.slice(fn.indexOf('const tiles=['), fn.indexOf('const hist='))), 'the tiles never read the recent layer');
  assert.ok(!/D\.recent/.test(fn.slice(fn.indexOf('const obsCard='), fn.indexOf('/* why this estimate'))), 'the observed / model cards never read it');
  const rct = html.slice(html.indexOf('const RCT={'), html.indexOf('function recentTableHTML('));
  assert.match(rct, /SEPARATE LAYER/); assert.match(rct, /שכבה נפרדת/); assert.match(rct, /Not a government channel/); assert.ok(!/OFFICIAL|רשמי/.test(rct));
  assert.match(html, /strecent:"date,/);
});

t('AUTOMATION: a daily read-only check; the reconciliation and these gates before any commit (the previous layer kept on failure); a new register sweep reconciles the layer the same run', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'street-recent-sync.yml'), 'utf8');
  assert.match(wf, /cron: '7 4 \* \* \*'/); assert.match(wf, /node test\/recent\.test\.js/); assert.match(wf, /git checkout -- data\/streets\/recent\/layer\.json/);
  const ev = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'street-evidence-sync.yml'), 'utf8');
  assert.match(ev, /street-recent-sync\.js --reconcile/); assert.match(ev, /git add data\/streets\/evidence data\/streets\/model data\/streets\/recent/);
  const sync = fs.readFileSync(path.join(ROOT, 'scripts', 'street-recent-sync.js'), 'utf8');
  assert.match(sync, /pause = \(\) => new Promise\(\(ok\) => setTimeout\(ok, 1000\)\)/, 'one request a second');
  assert.ok(!/method:\s*'(POST|PUT|DELETE)'/.test(sync), 'GET only');
});

console.log(`recent: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
