// PROPX · RECENT LAYER — ownership-share semantics, the promotion LIFECYCLE and the THREE COUNTS (20.10.2026).
// Offline: node test/recent-lifecycle.test.js
//
//   SHARE AUDIT     no field the GovMap-layer copy publishes (or pair of fields) tells a partial-share sale from a whole one
//   LEDGER          append-only, idempotent; every shown deal OBSERVED once, with its source, copy, first read and verbatim row hash
//   CONFIRMATION    (replayed: the register blinded, then arriving) only a NEWER register copy confirms; the semantics come from the
//                   register's portion; a price is used only for a WHOLE-PROPERTY sale; history is never rewritten; a closed deal
//                   takes no further event; the same copy never "confirms"
//   CARRIED         a deal awaiting confirmation that the copy no longer holds is carried, marked LEFT_COPY, never shown
//   THREE COUNTS    recorded events ≥ verified dwelling transactions ≥ priced transactions; the register parts are the street
//                   read's own figures; the recent part is the event rows; never one number
//   PAGE            the counts block, the price marker "PRICE NOT USED IN MARKET STATISTICS · OWNERSHIP SHARE NOT STATED", no ₪/m²
//                   on a price that is not used, the source-field detail

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'streets', 'recent');
const R = require('../lib/recent/reconcile');
const LC = require('../lib/recent/lifecycle');
const SIM = require('../lib/recent/simulate');
const C = require('../lib/recent/counts');
const EV = require('../lib/streets/evidence');
const W = require('../lib/recent/window');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); } };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const meta = readJson(path.join(DIR, 'meta.json'));
const layer = readJson(path.join(DIR, 'layer.json'));
const rows = layer.rows.map((r) => Object.fromEntries(layer.columns.map((c, i) => [c, r[i]])));
const ledger = LC.read(DIR);
const idx = readJson(path.join(DIR, 'raw', 'index.json'));
const snap = idx.snapshots.filter((x) => x.kind === 'window').pop();
const raw = gz(path.join(DIR, 'raw', snap.file));
/* a temp checkout of the recent store (the register store linked, read-only) */
function tmpStore() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-recent-'));
  fs.mkdirSync(path.join(d, 'data', 'streets'), { recursive: true });
  fs.cpSync(DIR, path.join(d, 'data', 'streets', 'recent'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'data', 'streets', 'evidence'), path.join(d, 'data', 'streets', 'evidence'));
  return d;
}

console.log('recent lifecycle: ownership share · late confirmation · three counts');

t('SHARE AUDIT: no permitted GovMap-layer field — and no pair of permitted fields — holds whole-property sales only; the only pure subsets use the unit\'s / parcel\'s activity (excluded by rule); not resolvable today', () => {
  const a = readJson(path.join(DIR, 'share-audit.json'));
  assert.ok(a.fieldTest.overlap.dwellingDealsBothCopiesHold > 2000 && a.fieldTest.overlap.partialInRegister > 200);
  for (const [k, f] of Object.entries(a.fieldTest.fields)) if (!f.excluded) assert.equal(f.pureWhole.length, 0, k + ' would be a discriminator');
  assert.equal(a.fieldTest.pairwise.pureLeavesWithoutExcludedFields.length, 0);
  for (const l of a.fieldTest.pairwise.pureLeaves) assert.ok(l.usesExcluded, JSON.stringify(l));
  assert.equal(a.conclusion.resolvableToday, false);
  const keys = new Set(raw.flatMap((g) => Object.keys(g)));
  for (const f of ['portion', 'portion_fraction', 'deal_part', 'share', 'part']) assert.ok(!keys.has(f), 'the copy has no ' + f);
  const reg = a.sources.find((s) => s.id === 'over:deals-register');
  assert.match(reg.status, /blocked/i); assert.match(reg.copies, /ONE scrape/);
});

t('LEDGER: every shown deal OBSERVED exactly once — its state, its source and copy, PROPX\'s first read, the register copy it was read against, the verbatim row\'s hash', () => {
  const obs = ledger.filter((e) => e.event === 'OBSERVED');
  const keys = new Set(obs.map((e) => e.key));
  assert.equal(keys.size, obs.length, 'one OBSERVED per deal');
  const rawBy = new Map(raw.map((g) => ['govmap:' + g.deal_id, g]));
  const cur = LC.fold(ledger);
  for (const r of rows) {
    const k = 'govmap:' + r.dealId, c = cur.get(k);
    assert.ok(c && c.observation, k);
    const o = c.observation;
    assert.equal(o.source, 'over:govmap-recent'); assert.ok(o.copyLoadedAt && o.firstReadAt && o.againstRegister.scrapedAt, k);
    assert.ok(idx.snapshots.some((s) => s.file === o.snapshotFile), 'the snapshot file is stored');
    assert.equal(o.rowSha, crypto.createHash('sha256').update(JSON.stringify(rawBy.get(k))).digest('hex').slice(0, 16), 'the verbatim row');
    assert.equal(c.state, r.state, k + ' ledger state = layer state'); assert.equal(r.firstReadAt, o.firstReadAt);
  }
  assert.ok(ledger.every((e) => LC.EVENTS.includes(e.event)));
});

t('LEDGER: append-only and idempotent — a forced rebuild with the same inputs appends nothing and never edits a line', () => {
  const d = tmpStore();
  try {
    const f = path.join(d, 'data', 'streets', 'recent', LC.FILE);
    const before = fs.readFileSync(f, 'utf8');
    const res = R.build({ root: d, force: true });
    assert.ok(res.ok, res.error); assert.equal(res.newEvents.length, 0);
    assert.equal(fs.readFileSync(f, 'utf8'), before);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

/* the replay: the register blinded from the window's first day, then arriving (the production engine, lib/recent/simulate.js) */
const S = EV.store();
const win = W.windowOf(S.meta.source.lastDeal);
const D = require('../lib/streets/directory').load(), M = require('../lib/streets/match');
const rawMap = new Map(raw.map((g) => [Number(g.objectid), g]));
const P = require('../lib/recent/promote');
const recB = R.reconcile(raw, { window: win, loadDay: String(snap.copy.loadedAt).slice(0, 10), EV: SIM.blindEV(EV, win.from), D, M });
const promB = P.promote(recB, { raw: rawMap, window: win, lastDeal: snap.copy.lastDeal, snapshotSha: snap.sha256 });
const snapshot = { sha256: snap.sha256, file: snap.file, fetchedAt: snap.fetchedAt, copy: snap.copy };
const BLIND = { scrapedAt: 'BLIND', lastDeal: W.minusDays(win.from, 1) };
const obs = LC.step(new Map(), { rows: recB.rows, out: recB.out, prom: promB, regs: recB.regs, streetOf: recB.streetOf, kindOf: recB.kindOf, raw: rawMap, snapshot, register: BLIND, at: '2026-10-01T00:00:00Z' });
const recA = R.reconcile(raw, { window: win, loadDay: String(snap.copy.loadedAt).slice(0, 10), EV, D, M });
const promA = P.promote(recA, { raw: rawMap, window: win, lastDeal: snap.copy.lastDeal, snapshotSha: snap.sha256 });
const ctxA = { rows: recA.rows, out: recA.out, prom: promA, regs: recA.regs, streetOf: recA.streetOf, kindOf: recA.kindOf, raw: rawMap, snapshot, register: { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal }, at: '2026-10-02T00:00:00Z' };
const arr = LC.step(LC.fold(obs), ctxA);
const all = [...obs, ...arr];

t('CONFIRMATION: only a NEWER register copy confirms; the semantics are the register\'s portion; a price is used only for a WHOLE-PROPERTY sale; VERIFIED comes only from a confirmation', () => {
  const conf = arr.filter((e) => e.event === 'CONFIRMED');
  assert.ok(conf.length > 1000, conf.length);
  for (const e of conf) {
    const c = e.confirmation, reg = c.representations.register;
    assert.ok(['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT'].includes(c.match.cls), 'a strong match');
    assert.equal(c.registerScrapedAt, S.meta.source.scrapedAt); assert.equal(c.confirmedAt, '2026-10-02T00:00:00Z'); assert.equal(c.countedVia, 'register');
    assert.ok(c.representations.recent && reg, 'both representations kept');
    if (reg.portion == null) assert.equal(e.semantics, 'UNKNOWN');
    else if (reg.portion < 1) { assert.equal(e.semantics, 'PARTIAL_SHARE', 'a share — "0.000" too (rounded at source)'); assert.equal(c.priced, false); assert.equal(c.pricePerSqm, null); }
    else assert.ok(['WHOLE_PROPERTY', 'MULTI_UNIT'].includes(e.semantics));
    if (c.priced) { assert.equal(e.semantics, 'WHOLE_PROPERTY'); assert.ok(reg.amount >= EV.MIN_MARKET); }
    if (e.semantics === 'UNKNOWN') assert.notEqual(e.to, 'RECENT_OBSERVED_VERIFIED', 'no portion → never VERIFIED');
  }
  assert.ok(obs.every((e) => e.to !== 'RECENT_OBSERVED_VERIFIED'), 'nothing is VERIFIED at first observation');
  assert.ok(conf.some((e) => e.semantics === 'WHOLE_PROPERTY' && e.to === 'RECENT_OBSERVED_VERIFIED') && conf.some((e) => e.semantics === 'PARTIAL_SHARE'));
  for (const e of all.filter((x) => x.to === 'RECENT_OBSERVED_VERIFIED')) assert.equal(e.event, 'CONFIRMED');
});

t('CONFIRMATION never rewrites history: the observation of a confirmed deal is the one first recorded; LIMITED → VERIFIED is a new event dated at the confirmation', () => {
  const cur = LC.fold(all), first = LC.fold(obs);
  let n = 0;
  for (const e of arr.filter((x) => x.event === 'CONFIRMED')) {
    const c = cur.get(e.key);
    assert.deepEqual(c.observation, first.get(e.key).observation); assert.equal(e.from, first.get(e.key).state);
    assert.ok(e.at > obs.find((x) => x.key === e.key).at); n++;
  }
  assert.ok(n > 0);
  assert.ok(arr.filter((x) => x.event === 'CONFIRMED' && x.from === 'RECENT_OBSERVED_LIMITED' && x.to === 'RECENT_OBSERVED_VERIFIED').length > 500);
});

t('the SAME register copy never "confirms" (an engine reclassification is RESTATED, cause ENGINE); a closed deal takes no further event; a rerun is silent', () => {
  const same = LC.step(LC.fold(obs), { ...ctxA, register: BLIND });
  assert.ok(!same.some((e) => e.event === 'CONFIRMED'), 'never a confirmation from the copy the deal was read against');
  const byEngine = same.filter((e) => e.event === 'RESTATED' && /same register copy/.test(e.reasons[0]));
  assert.ok(byEngine.length > 0 && byEngine.every((e) => e.cause === 'ENGINE'));
  assert.equal(LC.step(LC.fold(all), ctxA).length, 0, 'a rerun on the same copy appends nothing');
});

t('CONFLICT: a newer copy that files the deal under another locality, or calls it not a dwelling, or prints it as a duplicate / possible duplicate → RECENT_CONFLICT with its reason', () => {
  const cf = arr.filter((e) => e.event === 'CONFLICTED');
  assert.ok(cf.length > 0);
  for (const e of cf) { assert.equal(e.to, 'RECENT_CONFLICT'); assert.ok(e.reasons.length); assert.ok(e.conflictWith); }
  assert.ok(cf.some((e) => e.reasons.includes('register-files-it-under-another-locality')));
});

t('CARRIED: a deal awaiting confirmation that a newer GovMap-layer copy no longer holds is carried from the copy that first showed it — LEFT_COPY, evaluated, never shown', () => {
  const d = tmpStore();
  try {
    const dir = path.join(d, 'data', 'streets', 'recent');
    const drop = new Set(rows.filter((r) => r.state === 'RECENT_OBSERVED_LIMITED').slice(0, 25).map((r) => String(r.dealId)));
    const kept = raw.filter((g) => !drop.has(String(g.deal_id)));
    const body = kept.map((g) => JSON.stringify(g)).join('\n') + '\n';
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    fs.writeFileSync(path.join(dir, 'raw', sha.slice(0, 16) + '.jsonl.gz'), zlib.gzipSync(body));
    const ix = readJson(path.join(dir, 'raw', 'index.json'));
    ix.snapshots.push({ ...snap, sha256: sha, file: sha.slice(0, 16) + '.jsonl.gz', rows: kept.length, fetchedAt: '2026-10-21T08:00:00Z' });
    fs.writeFileSync(path.join(dir, 'raw', 'index.json'), JSON.stringify(ix));
    const res = R.build({ root: d, force: true });
    assert.ok(res.ok, res.error);
    assert.equal(res.meta.lifecycle.carried, 25);
    const left = res.newEvents.filter((e) => e.event === 'LEFT_COPY');
    assert.equal(left.length, 25); assert.ok(left.every((e) => drop.has(e.dealId)));
    assert.equal(res.layer.rows.length, rows.length - 25);
    assert.ok(!res.layer.rows.some((r) => drop.has(String(r[1]))), 'never shown');
    assert.deepEqual(res.meta.classes, Object.fromEntries(Object.entries(meta.classes).map(([k, v]) => [k, k === 'RECENT_NEW' ? v - 25 : v])), 'the carried rows are in no class tally');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

t('THREE COUNTS: recorded events ≥ verified dwelling transactions ≥ priced; the register parts are the street read\'s own figures; the recent part is the event rows; never one number', () => {
  const ST = require('../lib/streets/street');
  const evIdx = layer.columns.indexOf('event');
  const withEvents = Object.entries(layer.byStreet).filter(([, ix]) => ix.some((i) => layer.rows[i][evIdx])).slice(0, 40);
  assert.ok(withEvents.length >= 40);
  for (const [id, ix] of withEvents) {
    const o = ST.street(id);
    const TC = o.transactionCounts.street;
    assert.ok(TC.available, id);
    const w = TC.periods.find((p) => p.id === 'window');
    assert.deepEqual(Object.keys(w).filter((k) => /Events|Dwelling|InStatistics/.test(k)).sort(), ['pricedInStatistics', 'recordedEvents', 'verifiedDwelling']);
    assert.ok(w.recordedEvents.total >= w.verifiedDwelling.total && w.verifiedDwelling.total >= w.pricedInStatistics.total, id);
    if (o.evidence.swept) { assert.equal(w.verifiedDwelling.register, o.evidence.stats.observed, id); assert.equal(w.pricedInStatistics.register, o.evidence.stats.priced, id); }
    assert.equal(w.recordedEvents.recent, ix.filter((i) => layer.rows[i][evIdx]).length, id);
    assert.equal(w.verifiedDwelling.recent, 0); assert.equal(w.pricedInStatistics.recent, 0);
    assert.equal(o.evidence.stats.observed + w.recordedEvents.recent, w.recordedEvents.total);
    assert.equal(TC.note, C.NOTE);
  }
  assert.equal(rows.filter((r) => r.event).length, meta.promotion.eligible.event);
  /* the 20.10.2026 build (this snapshot × this register copy): exactly the 967 rows reported */
  if (snap.sha256.startsWith('aa7267d12488c51e') && /^2026-09-19/.test(meta.register.scrapedAt)) assert.equal(meta.promotion.eligible.event, 967, 'the 967 rows, each through every event gate');
});

t('THE PAGE: the three counts with their ⓘ, the user-facing sentence; a recent price marked "PRICE NOT USED IN MARKET STATISTICS · OWNERSHIP SHARE NOT STATED"; no ₪/m² on a price that is not used; the source fields — he / en and the offline build', () => {
  for (const f of ['index.html', 'standalone/israel-new-homes-v2.html']) {
    const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const s of ['Recorded transaction events', 'Verified dwelling transactions', 'Priced transactions used in market statistics', 'עסקאות שנרשמו', 'עסקאות דירה מאומתות', 'עסקאות עם מחיר בסטטיסטיקה',
      'PRICE NOT USED IN MARKET STATISTICS', 'OWNERSHIP SHARE NOT STATED', 'המחיר אינו משמש בסטטיסטיקות השוק', 'החלק הנמכר בנכס לא צוין', 'countsHTML(D.transactionCounts)',
      '"recorded_transaction_events"', '"verified_dwelling_transactions"', '"priced_transactions_in_statistics"', 'xpBtn("recent_promotion_lifecycle")', 'Source fields', 'שדות המקור']) assert.ok(h.includes(s) || h.includes(s.replace(/"/g, '\\"')), f + ': ' + s);
    assert.match(h, /used\(d\)&&d\.pricePerSqm!=null\?fmtNIS\(d\.pricePerSqm\):"—"/, f + ': ₪/m² only for a price that is used');
  }
  assert.match(C.NOTE, /^Recent recorded transactions include transactions whose ownership share is not stated by the recent source\. These transactions are excluded from price statistics until their pricing semantics can be verified\.$/);
});

t('MODEL / STATISTICS untouched: the street read\'s observed figures and the Street Value Model read no recent row', () => {
  const src = ['lib/streets/evidence.js', 'lib/streets/value-model.js', 'lib/streets/value-validate.js', 'scripts/street-model-build.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/recent\/|promotion|lifecycle|counts\.js/.test(src));
  const MD = require('../lib/streets/model-deps');
  assert.equal(MD.check().stale, false, 'the model is not stale');
});

console.log(`recent lifecycle: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
