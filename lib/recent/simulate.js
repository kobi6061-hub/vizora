// PROPX · RECENT TRANSACTIONS LAYER — the UPGRADE-POTENTIAL SIMULATION (20.10.2026).
//
// How many recent-only deals would a later register copy confirm — and as what? Replayed on deals both copies hold, with the
// production engine itself (lib/recent/reconcile.js → promote.js → lifecycle.js), nothing re-implemented:
//
//   1 · BLIND   the register copy minus every deal dated on or after the window's first day: each GovMap-layer row of the window
//               is "first seen in the GovMap layer" — reconciled, promoted, and OBSERVED in a fresh ledger with its state
//   2 · ARRIVE  the full register copy (scraped 19.09.2026) is the "newer copy": the same rows are reconciled again and the lifecycle
//               step decides — CONFIRMED (WHOLE_PROPERTY · PARTIAL_SHARE · MULTI_UNIT · portion unknown), CONFLICTED (another
//               locality, not a dwelling, a duplicate or possible duplicate print), or no event (still not in the register)
//
// Two populations: HISTORICAL (a window a year back — the register has had ≥ 12 months to receive every deal: "eventually") and
// CURRENT (today's window — the register copy of 19.09.2026 holds only the deals reported by then: the early-reported deals).
// LIMITS, stated with the result: the blind removes the window's deals but keeps the register's parcel table (placement by parcel and
// the street crosswalk read it — no deal, price or share); rows without a settlement cannot be read per settlement (historical);
// a confirmation LAG cannot be measured — the register exists as one copy (built 18–19.09.2026), so any "lag" would only restate
// the gap between two copy dates.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const W = require('./window');

const STATE_ORDER = ['RECENT_OBSERVED_VERIFIED', 'RECENT_OBSERVED_LIMITED', 'RECENT_CONTEXT_ONLY', 'RECENT_CONFLICT', 'RECENT_UNRESOLVED'];
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

/** the register copy as if it held nothing dated on or after `cut` (the same module, its deal reader filtered) */
function blindEV(EV, cut) {
  const B = Object.create(EV);
  B.dealsOf = (sh) => EV.dealsOf(sh).filter((x) => !x.deal.date || x.deal.date < cut);
  return B;
}

/**
 * One population: rows (verbatim) of one window → { observed, outcomes, table }.
 * @param {object} o { raw, window: { from }, loadDay, lastDeal, label, snapshot: { sha256, file } }
 */
function run(o, { EV, D, M } = {}) {
  EV = EV || require('../streets/evidence'); D = D || require('../streets/directory').load(); M = M || require('../streets/match');
  const R = require('./reconcile'), P = require('./promote'), LC = require('./lifecycle');
  const S = EV.store();
  const rawMap = new Map(o.raw.map((g) => [Number(g.objectid), g]));
  /* 1 · blind */
  const recB = R.reconcile(o.raw, { window: o.window, loadDay: o.loadDay, EV: blindEV(EV, o.window.from), D, M });
  const promB = P.promote(recB, { raw: rawMap, window: o.window, lastDeal: o.lastDeal, snapshotSha: o.snapshot.sha256 });
  const snapshot = { sha256: o.snapshot.sha256, file: o.snapshot.file, fetchedAt: o.loadDay + 'T00:00:00Z', copy: { loadedAt: o.loadDay + 'T00:00:00Z', version: 'simulated', lastDeal: o.lastDeal } };
  const observed = LC.step(new Map(), { rows: recB.rows, out: recB.out, prom: promB, regs: recB.regs, streetOf: recB.streetOf, kindOf: recB.kindOf, raw: rawMap, snapshot,
    register: { scrapedAt: 'BLIND (the register minus every deal from ' + o.window.from + ')', lastDeal: W.minusDays(o.window.from, 1) }, at: 'blind' });
  /* 2 · arrive */
  const recA = R.reconcile(o.raw, { window: o.window, loadDay: o.loadDay, EV, D, M });
  const promA = P.promote(recA, { raw: rawMap, window: o.window, lastDeal: o.lastDeal, snapshotSha: o.snapshot.sha256 });
  const arrived = LC.step(LC.fold(observed), { rows: recA.rows, out: recA.out, prom: promA, regs: recA.regs, streetOf: recA.streetOf, kindOf: recA.kindOf, raw: rawMap, snapshot,
    register: { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal }, at: 'arrive' });
  /* per deal: its first state, its blind event eligibility, what the arrival decided */
  const byKey = new Map();
  const oidOf = new Map(recB.rows.map((r) => [LC.keyOf(r), r.oid]));
  for (const e of observed) byKey.set(e.key, { first: e.to, event: (promB.get(oidOf.get(e.key)) || { eligible: {} }).eligible.event === true, outcome: null });
  const clsA = new Map(recA.rows.map((r) => [LC.keyOf(r), (recA.out.get(r.oid) || {}).cls]));
  for (const e of arrived) { const x = byKey.get(e.key); if (!x) continue; if (e.event === 'CONFIRMED' || e.event === 'CONFLICTED' || e.event === 'RESTATED') x.outcome = e; }
  const bucket = (x, key) => {
    const e = x.outcome;
    if (e && e.event === 'CONFIRMED') return e.semantics === 'WHOLE_PROPERTY' ? 'CONFIRMED_WHOLE_PROPERTY' : e.semantics === 'PARTIAL_SHARE' ? 'CONFIRMED_PARTIAL_SHARE' : e.semantics === 'MULTI_UNIT' ? 'CONFIRMED_MULTI_UNIT' : 'CONFIRMED_PORTION_UNKNOWN';
    if (e && e.event === 'CONFLICTED') return e.conflictWith && e.conflictWith.match ? ((e.reasons || []).includes('register-amount-does-not-fit') ? 'AMOUNT_DOES_NOT_FIT' : 'CONFLICT_WITH_REGISTER') : (e.reasons || [])[0] === 'possible-duplicate-of-register-deal' ? 'POSSIBLE_DUPLICATE' : 'DUPLICATE_PRINT';
    const c = clsA.get(key);
    return c === 'RECENT_NEW' ? 'NOT_IN_REGISTER' : 'OTHER:' + c;
  };
  const rows = [...byKey].map(([k, x]) => ({ key: k, first: x.first, event: x.event, bucket: bucket(x, k), final: x.outcome ? x.outcome.to : x.first, semantics: x.outcome ? x.outcome.semantics : 'UNKNOWN' }));
  const tab = (xs) => {
    const n = xs.length, c = (f) => xs.filter(f).length;
    const matched = c((r) => /^CONFIRMED|CONFLICT_WITH_REGISTER/.test(r.bucket));
    const whole = c((r) => r.bucket === 'CONFIRMED_WHOLE_PROPERTY'), partial = c((r) => r.bucket === 'CONFIRMED_PARTIAL_SHARE'), multi = c((r) => r.bucket === 'CONFIRMED_MULTI_UNIT');
    const unknownPortion = c((r) => r.bucket === 'CONFIRMED_PORTION_UNKNOWN'), conflict = c((r) => r.bucket === 'CONFLICT_WITH_REGISTER');
    const possibleDup = c((r) => r.bucket === 'POSSIBLE_DUPLICATE'), dupPrint = c((r) => r.bucket === 'DUPLICATE_PRINT'), notIn = c((r) => r.bucket === 'NOT_IN_REGISTER'), other = c((r) => /^OTHER/.test(r.bucket));
    const amountNoFit = c((r) => r.bucket === 'AMOUNT_DOES_NOT_FIT');
    const verified = c((r) => r.final === 'RECENT_OBSERVED_VERIFIED');
    const vWhole = c((r) => r.final === 'RECENT_OBSERVED_VERIFIED' && r.semantics === 'WHOLE_PROPERTY'), vPart = c((r) => r.final === 'RECENT_OBSERVED_VERIFIED' && r.semantics === 'PARTIAL_SHARE');
    const vMulti = c((r) => r.final === 'RECENT_OBSERVED_VERIFIED' && r.semantics === 'MULTI_UNIT'), stillLimited = c((r) => /^CONFIRMED/.test(r.bucket) && r.final === 'RECENT_OBSERVED_LIMITED');
    return { n, matched, matchedPct: pct(matched, n), wholeProperty: whole, wholePct: pct(whole, n), partialShare: partial, partialPct: pct(partial, n), multiUnit: multi, multiPct: pct(multi, n),
      portionUnknown: unknownPortion, conflictWithRegister: conflict, conflictPct: pct(conflict, n), amountDoesNotFit: amountNoFit, possibleDuplicate: possibleDup, duplicatePrint: dupPrint, notInRegister: notIn, other,
      unresolved: possibleDup + notIn + other + unknownPortion + amountNoFit, unresolvedPct: pct(possibleDup + notIn + other + unknownPortion + amountNoFit, n),
      finalVerified: verified, finalVerifiedPct: pct(verified, n), verifiedWholeProperty: vWhole, verifiedWholePct: pct(vWhole, n), verifiedPartialShare: vPart, verifiedMultiUnit: vMulti,
      confirmedButStillLimited: stillLimited, ofMatchedWholePct: pct(whole, matched), ofMatchedPartialPct: pct(partial, matched), ofMatchedConflictPct: pct(conflict, matched) };
  };
  const byFirst = Object.fromEntries(STATE_ORDER.map((s) => [s, tab(rows.filter((r) => r.first === s))]));
  return { label: o.label, window: { from: o.window.from, to: o.loadDay }, rows: o.raw.length, observedRecentOnly: rows.length, all: tab(rows), events: tab(rows.filter((r) => r.event)),
    byFirstState: byFirst, buckets: rows.reduce((m, r) => ((m[r.bucket] = (m[r.bucket] || 0) + 1), m), {}), transitions: rows.reduce((m, r) => { const k = `${r.first} → ${r.final}`; m[k] = (m[k] || 0) + 1; return m; }, {}) };
}

const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** both populations from the stored files → the simulation report */
function simulate({ root = path.join(__dirname, '..', '..') } = {}) {
  const dir = path.join(root, 'data', 'streets', 'recent');
  const out = { schema: 1, builtAt: new Date().toISOString(), engine: 'propx-recent-simulation-1', populations: [] };
  const EV = require('../streets/evidence'), S = EV.store();
  out.register = { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal, window: S.meta.window };
  /* HISTORICAL: every stored history window */
  const hdir = path.join(dir, 'history');
  for (const f of fs.existsSync(hdir) ? fs.readdirSync(hdir).filter((x) => /\.meta\.json$/.test(x)).sort() : []) {
    const m = JSON.parse(fs.readFileSync(path.join(hdir, f), 'utf8'));
    const file = f.replace(/\.meta\.json$/, '.jsonl.gz');
    const raw = readGz(path.join(hdir, file));
    const body = raw.map((g) => JSON.stringify(g)).join('\n') + '\n';
    if (crypto.createHash('sha256').update(body).digest('hex') !== m.sha256) throw new Error(file + ' does not match its hash');
    /* the window's first day = 75 days before a pseudo register end, as production places it (window.js) */
    const from = W.minusDays(m.window.from, -6);
    const lastDeal = raw.map((g) => String(g.deal_date).slice(0, 10)).filter((d) => d <= m.window.to).sort().pop();
    out.populations.push({ ...run({ raw, window: { from }, loadDay: m.window.to, lastDeal, label: 'HISTORICAL — a window a year back: the register has had at least 12 months to receive every deal',
      snapshot: { sha256: m.sha256, file } }), source: { copy: m.copy, settlementsRead: m.settlements && m.settlements.read, failed: (m.settlements && m.settlements.failed || []).length } });
  }
  /* CURRENT: today's window against the register copy of 19.09.2026 */
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'raw', 'index.json'), 'utf8'));
  const snap = idx.snapshots.filter((x) => x.kind === 'window').pop();
  const raw = readGz(path.join(dir, 'raw', snap.file));
  const win = W.windowOf(S.meta.source.lastDeal);
  out.populations.push({ ...run({ raw, window: win, loadDay: String(snap.copy.loadedAt).slice(0, 10), lastDeal: snap.copy.lastDeal,
    label: 'CURRENT — today\'s window: the register copy of 19.09.2026 holds only the deals reported by then', snapshot: { sha256: snap.sha256, file: snap.file } }), source: { copy: snap.copy } });
  out.lag = { measurable: false, median: null, p80: null, p90: null,
    reason: 'The register exists as ONE copy (five versions built 18–19.09.2026, city by city); its publisher reports the Tax Authority site blocked to its scraper and no update since 19.09.2026 (over.org.il /api/deals/log, 13.10.2026). No deal has ever been confirmed by a LATER register copy, so a lag distribution cannot be measured — any figure would only restate the gap between two copy dates. The lifecycle records the real lag (first read → confirming copy) from the first confirmation.',
    censored: 'every one of today\'s recent-only deals is still unconfirmed 12 days after the GovMap-layer copy loaded (08.10.2026) and 31 days after the register copy (19.09.2026)' };
  return out;
}

module.exports = { blindEV, run, simulate };
