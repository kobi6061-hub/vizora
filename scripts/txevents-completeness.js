#!/usr/bin/env node
// PROPX · THE TRANSACTION COMPLETENESS AUDIT — every row of every accessible source, accounted for (closure P0, 20.10.2026)
// → data/txevents/completeness-audit.json. Offline, over the stored artifacts; no sampling.
//
//   UNIVERSE      the register copy (its own count, the names it files deals under, the stored window) + the GovMap-layer file (every row:
//                 the history before the stored window, the window, the invalid rows) — every row in ONE bucket: SURFACED · SURFACED
//                 FLAGGED (a possible duplicate, shown, never counted) · DUPLICATE OF SURFACED · UNPLACED (Israel's list, never a
//                 locality) · INVALID (kept in the evidence, never shown as a transaction)
//   REACHABILITY  each bucket proven reachable through a user path (a locality any user can open, Israel's list); a row no path reaches
//                 is DEFENSIBLE KNOWN SOURCE EVENT NOT SURFACED — the target is 0
//   RECOVERY      the unplaced rows' locality recovery (the window's 2,539 and the history's), by state and basis
//   STREETS       every published street string of both copies resolved in the official directory (exact · synonym · spelling ·
//                 normalized POSSIBLE · ambiguous · unresolved) + the register's parcel recovery
//   PARCELS       events with a block · parcel, parcels recovered to a street, by state
//   LATEST        the newest event the sources hold vs the newest the user sees, for Israel, every district, every locality, every street
//                 with an event (a stored-window union read; places whose newest deal is older than the window are checked live by
//                 scripts/txevents-all-check.js — its result is folded in when present)
//   node scripts/txevents-completeness.js [--streets-limit N]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const TX = require('../lib/txevents');
const HIST = require('../lib/txevents/history');
const U = require('../lib/txevents/unplaced');
const EV = require('../lib/streets/evidence');
const M = require('../lib/streets/match');
const RECENT = require('../lib/recent/read');

const ROOT = path.join(__dirname, '..');
const T = path.join(ROOT, 'data', 'txevents');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readGz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { return null; } };
const add = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const maxD = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b);
const today = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);
const streetsLimit = args.includes('--streets-limit') ? Number(args[args.indexOf('--streets-limit') + 1]) : Infinity;

const D = require('../lib/streets/directory').load();
const S = TX.stores();
const evm = EV.store().meta || {};
const nm = readJson(path.join(T, 'national', 'meta.json')) || {};
const hm = HIST.meta() || {};
const regSet = readJson(path.join(T, 'history', 'register-settlements.json'));
const regUnm = readJson(path.join(T, 'history', 'register-unmapped.json'));
const allCheck = readJson(path.join(T, 'all-check.json'));
const latestIx = readJson(path.join(T, 'latest.json')) || { localities: {}, districts: {}, national: {} };
const RL = RECENT.load();
const isLoc = (c) => c != null && D.localities.has(Number(c));

/* ═════ 1 · THE REGISTER COPY ═════ */
const shardCodes = fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x)).map((x) => Number(x.replace('.json', ''))).filter((c) => EV.shardOf(c));
let windowDeals = 0, windowRegisterEvents = 0;
const shardLatest = {};
for (const c of shardCodes) {
  const sh = EV.shardOf(c);
  const n = EV.dealsOf(sh).length;
  windowDeals += n;
  windowRegisterEvents += TX.registerEvents(sh, S).length;
  shardLatest[c] = EV.dealsOf(sh).reduce((a, x) => maxD(a, x.deal.date), null);
}
const register = {
  copy: { scrapedAt: (evm.source || {}).scrapedAt || null, deals: (evm.source || {}).deals || null, firstDeal: (evm.source || {}).firstDeal || null, lastDeal: (evm.source || {}).lastDeal || null },
  storedWindow: { from: evm.window && evm.window.from, to: evm.window && evm.window.to, localities: shardCodes.length, deals: windowDeals, events: windowRegisterEvents, equal: windowDeals === windowRegisterEvents },
  settlements: null, unmapped: null,
};
if (regSet) {
  const mapped = regSet.settlements.filter((s) => s.code != null), unm = regSet.settlements.filter((s) => s.code == null);
  register.settlements = { readAt: regSet.readAt, names: regSet.settlements.length, listedDeals: regSet.listedDeals, dealsUnderNoSettlement: regSet.dealsUnderNoSettlement,
    mapped: { names: mapped.length, localities: new Set(mapped.map((s) => s.code)).size, deals: sum(mapped.map((s) => s.deals)) },
    unmapped: { names: unm.length, deals: sum(unm.map((s) => s.deals)), largest: unm.sort((a, b) => (b.deals || 0) - (a.deals || 0)).slice(0, 15).map((s) => ({ settlement: s.settlement, deals: s.deals, lastDeal: s.lastDeal })) } };
}
if (regUnm) {
  const byState = {}, byBasis = {}, placed = {};
  const ci = regUnm.columns.indexOf('state'), bi = regUnm.columns.indexOf('basis'), ki = regUnm.columns.indexOf('code');
  for (const r of regUnm.rows) { add(byState, r[ci]); add(byBasis, r[bi]); if (/^RESOLVED/.test(r[ci])) add(placed, isLoc(r[ki]) ? 'official-locality' : 'NOT-A-LOCALITY'); }
  register.unmapped = { readAt: regUnm.readAt, scrapedAt: regUnm.scrapedAt, names: regUnm.settlements.length, rows: regUnm.rows.length, requests: regUnm.requests, failed: regUnm.failed, byState, byBasis, placed };
}

/* ═════ 2 · THE GOVMAP-LAYER FILE ═════ */
const file = nm.file || {};
const winTotals = nm.totals || {};
const winRows = sum(winTotals) - (winTotals['before-window'] || 0);      // the context rows before the window are history rows too
const histInvalid = (readJson(path.join(T, 'history', 'invalid.json')) || { rows: [] }).rows.length;
const govmap = {
  file: { version: nm.version, sha256: file.sha256, rowsTotal: file.rowsTotal, rowsRead: file.rowsRead, dates: file.dates },
  partition: { history: hm.historyRows || 0, window: winRows, invalidDate: histInvalid, sum: (hm.historyRows || 0) + winRows + histInvalid },
};
govmap.partition.equal = govmap.partition.sum === file.rowsTotal;

/* ═════ 3 · EVERY ROW IN ONE BUCKET ═════ */
const BUCKET = {
  RECENT_NEW: 'SURFACED', HISTORY_EVENT: 'SURFACED_OR_FOLDED',
  IN_REGISTER: 'DUPLICATE_OF_SURFACED', IN_REGISTER_OTHER_UNIT: 'DUPLICATE_OF_SURFACED', DUPLICATE_IN_SOURCE: 'DUPLICATE_OF_SURFACED',
  POSSIBLE_DUPLICATE_IN_SOURCE: 'SURFACED_FLAGGED', AMBIGUOUS_DUPLICATE: 'SURFACED_FLAGGED', POSSIBLY_IN_REGISTER: 'SURFACED_FLAGGED',
  NO_SETTLEMENT: 'UNPLACED', UNMAPPED_SETTLEMENT: 'UNPLACED', POSSIBLE_LOCATION: 'UNPLACED', UNPLACED: 'UNPLACED', FUTURE_DATED: 'INVALID',
};
const MEANING = {
  SURFACED: 'an event of its own in its locality (and its street when the address resolves), its district and Israel',
  SURFACED_OR_FOLDED: 'a history row of its locality: shown in ALL, or folded into the register deal it repeats as the page loads (that deal is shown)',
  SURFACED_FLAGGED: 'shown as POSSIBLE DUPLICATE, never counted',
  DUPLICATE_OF_SURFACED: 'the same deal as a surfaced event (its source evidence)',
  UNPLACED: 'UNPLACED TRANSACTION EVENT — in Israel\'s list and the unplaced view, never attributed to a locality, street or district',
  INVALID: 'INVALID / FUTURE-DATED SOURCE ROW — kept in the raw evidence and the accounting, never shown as a transaction',
};
const gm = { window: {}, history: {} };
const windowFinal = { ...(nm.recovery && nm.recovery.final ? {} : {}) };
for (const [per, o] of Object.entries(nm.classes || {})) {
  if (per === 'before-window') continue;
  for (const [k, n] of Object.entries(o)) add(windowFinal, k, n);
}
/* the window's unplaced rows after the recovery: the recovered ones moved to their final class */
if (nm.recovery) {
  const rec = nm.recovery.final || {};
  windowFinal.NO_SETTLEMENT = 0; windowFinal.UNMAPPED_SETTLEMENT = 0;
  for (const [k, n] of Object.entries(rec)) add(windowFinal, k, n);
}
for (const [k, n] of Object.entries(windowFinal)) if (n) add(gm.window, BUCKET[k] || 'UNEXPLAINED:' + k, n);
for (const [k, n] of Object.entries(hm.classes || {})) add(gm.history, BUCKET[k] || 'UNEXPLAINED:' + k, n);
add(gm.history, 'INVALID', histInvalid);
const bucketsAll = {};
for (const b of [gm.window, gm.history]) for (const [k, n] of Object.entries(b)) add(bucketsAll, k, n);

/* ═════ 4 · REACHABILITY — the user path for every bucket ═════ */
const reach = { checks: [] };
const check = (id, rows, failing, how) => { reach.checks.push({ id, rows, notReachable: failing, how }); return failing; };
let notSurfaced = 0;
/* the register's stored window: every deal an event of its locality */
notSurfaced += check('register-window', windowDeals, windowDeals - windowRegisterEvents, 'every stored deal is an event of its locality (TX.registerEvents = the shard\'s rows)');
/* the GovMap window rows shown as events (national detector + the recent layer): their locality is an official one */
const natRows = S.national ? S.national.rows : [], natCols = S.national ? S.national.columns : [];
const nci = natCols.indexOf('cityCode');
notSurfaced += check('govmap-window-events', natRows.length, natRows.filter((r) => !isLoc(r[nci])).length, 'the locality of every GovMap-only event is an official locality (its events, its district, Israel)');
const rlRows = RL.layer ? RL.layer.rows : [], rci = RL.layer ? RL.layer.columns.indexOf('cityCode') : -1;
notSurfaced += check('govmap-recent-events', rlRows.length, rlRows.filter((r) => !isLoc(r[rci])).length, 'the recent layer\'s rows are events of an official locality');
/* the history rows: each locality's own partition, an official locality */
let histShown = 0, histNotLoc = 0;
for (const [c, x] of Object.entries(hm.localities || {})) { histShown += x.rows; if (!isLoc(c)) histNotLoc += x.rows; }
notSurfaced += check('govmap-history', histShown, histNotLoc + Math.abs(histShown - (hm.shown || 0)), 'every history row belongs to an official locality whose ALL read opens its partition');
const locIx = readJson(path.join(T, 'history', 'loc', 'index.json'));
notSurfaced += check('govmap-history-partitions', hm.shown || 0, locIx ? Math.abs((locIx.rows || 0) - (hm.shown || 0)) : (hm.shown || 0), 'the per-locality partitions hold exactly the year files\' rows');
/* the unplaced rows: Israel's list reads every one */
const uRows = U.load().rows.length;
const uExpected = (nm.unplaced || 0) + (hm.unplaced || 0);
notSurfaced += check('unplaced', uExpected, Math.max(0, uExpected - uRows), 'Israel\'s list and the unplaced view read data/txevents/{national/unplaced.json, history/unplaced.json.gz}');
/* the register's deals under unmapped names: resolved → their locality (an official one); the rest → Israel's list through the register's national search */
if (register.unmapped) notSurfaced += check('register-unmapped-placed', (register.unmapped.placed || {})['official-locality'] || 0, (register.unmapped.placed || {})['NOT-A-LOCALITY'] || 0, 'placed deals are listed with their locality\'s events');
/* localities without a district: reachable through Israel only (not a failure — stated) */
const noDistrict = [...D.localities.values()].filter((l) => !l.district).length;
reach.localitiesWithoutDistrict = noDistrict;
reach.notSurfaced = notSurfaced;

/* ═════ 5 · RECOVERY ═════ */
const recovery = {
  window: nm.recovery ? { rows: nm.recovery.rows, byState: nm.recovery.byState, byBasis: nm.recovery.byBasis, final: nm.recovery.final, unplacedAfter: nm.unplaced } : null,
  history: hm.recovery ? { rows: hm.recovery.rows, byState: hm.recovery.byState, byBasis: hm.recovery.byBasis, unplacedAfter: hm.unplaced } : null,
  registerUnmapped: register.unmapped ? { rows: register.unmapped.rows, byState: register.unmapped.byState, byBasis: register.unmapped.byBasis } : null,
  rule: 'only RESOLVED EXACTLY (the row\'s own official locality code, or its exact twin in the register) and RESOLVED STRONGLY (its parcel / polygon filed under exactly one locality by both copies) enter a geography; POSSIBLE LOCATION and UNPLACED stay national',
};

/* ═════ 6 · STREETS ═════ */
const LIs = new Map(); const LI = (c) => { if (!LIs.has(c)) LIs.set(c, M.localityIndex(D, c)); return LIs.get(c); };
const regStrings = new Map(), regRowsByVia = {};
for (const c of shardCodes) {
  for (const x of EV.dealsOf(EV.shardOf(c))) {
    for (const a of x.deal.parcelAddresses || []) {
      const p = M.parseAddress(String(a));
      const st = p && p.street ? p.street : null;
      if (!st) { add(regRowsByVia, 'no-street'); continue; }
      const k = `${c}|${st}`;
      let v = regStrings.get(k);
      if (!v) { const z = M.resolveStreet(LI(c), st); v = !z ? 'unresolved' : z.ambiguous ? 'ambiguous' : z.via; regStrings.set(k, v); }
      add(regRowsByVia, v);
    }
  }
}
const regStringsByVia = {}; for (const v of regStrings.values()) add(regStringsByVia, v);
const sa = hm.streetAudit || {};
const streets = {
  vias: sa.vias || null,
  register: { distinctStrings: regStrings.size, stringsByVia: regStringsByVia, addressesByVia: regRowsByVia, basis: 'the stored window\'s deals: every parcel address string, in its locality\'s official directory' },
  govmapWindow: sa.window ? { distinctStrings: sa.window.distinctStrings, stringsByVia: sa.window.stringsByVia, rowsByVia: sa.window.rowsByVia, codeAgreement: sa.window.codeAgreement } : null,
  govmapHistory: { distinctStrings: sa.distinctStrings, stringsByVia: sa.stringsByVia, rowsByVia: sa.rowsByVia, codeAgreement: sa.codeAgreement },
  historyStreetBasis: hm.streetBasis || null,
};
const allStrings = {}, allUnresolved = {};
for (const o of [streets.register.stringsByVia, (streets.govmapWindow || {}).stringsByVia, streets.govmapHistory.stringsByVia]) for (const [k, n] of Object.entries(o || {})) add(allStrings, k, n);
streets.total = { stringsByVia: allStrings, distinct: sum(allStrings), note: 'distinct (locality, string) pairs per source, added across the three sources (a string both copies print counts in each)' };

/* ═════ 7 · PARCELS ═════ */
const parcelStates = {}; for (const v of S.parcels.values()) add(parcelStates, v.state);
let regWithParcel = 0, regWithoutStreet = 0;
for (const c of shardCodes) for (const x of EV.dealsOf(EV.shardOf(c))) { if (x.deal.gush && x.deal.helka) regWithParcel++; if (!(x.streets || []).length) regWithoutStreet++; }
const parcels = {
  register: { deals: windowDeals, withBlockParcel: regWithParcel, withoutStreet: regWithoutStreet },
  recovery: { parcelsRecovered: S.parcels.size, byState: parcelStates, national: nm.parcelRecovery || null,
    rule: 'a register parcel with no street is placed on a street through the GovMap layer\'s own address of the same parcel: OBSERVED when one street holds every address, POSSIBLE otherwise, UNRESOLVED when none resolves — never priced' },
  govmapWindow: { rows: natRows.length + rlRows.length, withBlockParcel: natRows.filter((r) => r[natCols.indexOf('block')] != null).length + (RL.layer ? rlRows.filter((r) => r[RL.layer.columns.indexOf('block')] != null).length : 0) },
};

/* ═════ 8 · LATEST — the newest event the sources hold vs the newest the user sees ═════ */
const regByCode = new Map();
if (regSet) for (const s of regSet.settlements) if (s.code != null && s.lastDeal) { const x = regByCode.get(s.code) || { lastDeal: null, names: [] }; x.lastDeal = maxD(x.lastDeal, s.lastDeal); x.names.push(s.settlement); regByCode.set(s.code, x); }
/* a GovMap row counts as an event unless the reconciliation flagged it a possible duplicate (shown, never counted) */
const POSSIBLE = new Set(['POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER']);
const ndi = natCols.indexOf('date'), ncls = natCols.indexOf('class');
const rlc = RL.layer ? RL.layer.columns : [];
const rlCounted = (r) => !POSSIBLE.has(r[rlc.indexOf('class')]) && !(r[rlc.indexOf('reasons')] || []).includes('possible-duplicate-of-register-deal');
const natCounted = (r) => !POSSIBLE.has(r[ncls]);
const gmLatestByCode = {};
for (const r of natRows) if (natCounted(r)) gmLatestByCode[r[nci]] = maxD(gmLatestByCode[r[nci]], r[ndi]);
if (RL.layer) { const di = rlc.indexOf('date'); for (const r of rlRows) if (rlCounted(r)) gmLatestByCode[r[rci]] = maxD(gmLatestByCode[r[rci]], r[di]); }
const regxLatest = {};
if (regUnm) { const ci = regUnm.columns.indexOf('state'), ki = regUnm.columns.indexOf('code'), di = regUnm.columns.indexOf('date'); for (const r of regUnm.rows) if (/^RESOLVED/.test(r[ci]) && isLoc(r[ki])) regxLatest[r[ki]] = maxD(regxLatest[r[ki]], r[di]); }
const liveByCode = new Map(((allCheck && allCheck.latest && allCheck.latest.localities) || []).map((x) => [x.code, x]));
const locLatest = [];
for (const [code] of D.localities) {
  const L = latestIx.localities[code] || null;
  const reg = regByCode.get(code) || null;
  const h = (hm.localities || {})[code] || null;
  const source = [shardLatest[code], reg && reg.lastDeal, gmLatestByCode[code], regxLatest[code], h && h.latest].filter(Boolean).sort().pop() || null;
  let visible = L && L.latest ? L.latest : null, via = visible ? 'stored-union' : null;
  if (!visible) { const lc = liveByCode.get(code); if (lc) { visible = lc.visible; via = 'live-check'; } }
  const row = { code, source, visible, via };
  if (source && !visible && !via) row.reason = 'LIVE_CHECK_PENDING';
  else if (!source) row.reason = 'NO_TRANSACTION_IN_ANY_SOURCE';
  else if (source !== visible) row.reason = !visible ? 'NOTHING_VISIBLE' : visible > source ? 'VISIBLE_NEWER_THAN_SOURCE' : 'VISIBLE_OLDER_THAN_SOURCE';
  row.match = !!source && source === visible;
  row.parts = { registerWindow: shardLatest[code] || null, registerOwnLastDeal: reg ? reg.lastDeal : null, govmapWindow: gmLatestByCode[code] || null, registerUnmappedPlaced: regxLatest[code] || null, govmapHistory: h ? h.latest : null };
  locLatest.push(row);
}
const locMis = locLatest.filter((x) => x.source && !x.match);
/* districts and Israel: the newest of their localities' sources (Israel adds the unplaced events) vs the stored index / the live area read */
const areaLive = new Map(((allCheck && allCheck.latest && allCheck.latest.areas) || []).map((x) => [x.area, x]));
const districts = [...new Set([...D.localities.values()].map((l) => l.district).filter(Boolean))].sort();
const areaLatest = [];
const uLatest = U.load().rows.reduce((a, r) => maxD(a, r.date && r.date <= today ? r.date : null), null);
for (const a of ['il', ...districts]) {
  const rows = locLatest.filter((x) => a === 'il' || (D.localities.get(x.code) || {}).district === a);
  let source = rows.reduce((m, x) => maxD(m, x.source), null);
  if (a === 'il') source = maxD(source, uLatest);
  const stored = a === 'il' ? maxD(latestIx.national.latest, uLatest) : (latestIx.districts[a] || {}).latest || null;
  const live = areaLive.get(a);
  const visible = live && live.visible ? live.visible : stored;
  areaLatest.push({ area: a, source, visible, via: live && live.visible ? 'live-check' : 'stored-index', stored, match: source === visible });
}
/* streets: every street any stored row places an event on — the newest of its raw rows vs the union read of the street */
const streetSource = new Map();
const bump = (code, sc, d) => { if (code == null || sc == null || !d) return; const k = `${code}|${sc}`; streetSource.set(k, maxD(streetSource.get(k), d)); };
/* every rule PROPX applies to attach a row to a street: the register's own addresses; a register parcel with no street through the
   GovMap layer's address of the same parcel; a GovMap row's street (its official code, or its published name in the directory — a
   normalized-name match is POSSIBLE, shown); a GovMap row with no address on a register parcel recovered to a street */
const pnum = (v) => { if (v == null || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const viaParcel = (c, b, p, d) => { const rec = S.parcels.get(`${c}|${pnum(b)}|${pnum(p)}`); if (rec) for (const s of rec.streets) bump(c, s[0], d); };
for (const c of shardCodes) for (const x of EV.dealsOf(EV.shardOf(c))) {
  if ((x.streets || []).length) for (const st of x.streets) bump(c, st.code, x.deal.date);
  else viaParcel(c, x.deal.gush, x.deal.helka, x.deal.date);
}
const gmStreet = (c, sc, text, b, p, d) => {
  if (sc != null) return bump(c, sc, d);
  if (text) { const z = M.resolveStreet(LI(c), String(text)); if (z && z.id) return bump(c, Number(String(z.id).split(':')[2]), d); return; }
  if (b != null) viaParcel(c, b, p, d);
};
const nsc = natCols.indexOf('streetCode'), nst = natCols.indexOf('street'), nbl = natCols.indexOf('block'), npa = natCols.indexOf('parcel');
for (const r of natRows) if (natCounted(r)) gmStreet(r[nci], r[nsc], r[nst], r[nbl], r[npa], r[ndi]);
if (RL.layer) { const sci = rlc.indexOf('streetCode'), sti = rlc.indexOf('street'), bli = rlc.indexOf('block'), pai = rlc.indexOf('parcel'), di = rlc.indexOf('date'); for (const r of rlRows) if (rlCounted(r)) gmStreet(r[rci], r[sci], r[sti], r[bli], r[pai], r[di]); }
const streetRows = [];
let n = 0;
const t0 = Date.now();
for (const [k, source] of [...streetSource.entries()].sort()) {
  if (n++ >= streetsLimit) break;
  const [code, sc] = k.split('|').map(Number);
  const q = TX.query({ streetId: `st:${code}:${sc}`, all: true, unlimited: true, today });
  const ev = q.events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
  const visible = ev.length ? ev.map((e) => e.date).sort().pop() : null;
  if (visible !== source) streetRows.push({ street: `st:${code}:${sc}`, source, visible, reason: !visible ? 'NOTHING_VISIBLE' : visible > source ? 'VISIBLE_NEWER_THAN_SOURCE' : 'VISIBLE_OLDER_THAN_SOURCE',
    newestVisible: ev.slice().sort((a, b) => b.date.localeCompare(a.date))[0] ? (({ id, date, source: s, geo }) => ({ id, date, source: s, match: geo && geo.match }))(ev.slice().sort((a, b) => b.date.localeCompare(a.date))[0]) : null });
}
const latest = {
  rule: 'source = the newest valid event any source holds for the geography (the register sweep, the register\'s own last deal per settlement name, the GovMap layer\'s events, the register deals placed by parcel, the GovMap history); visible = the first event the user\'s ALL read shows (the stored union, or the live check for places whose newest deal is older than the stored window); POSSIBLE DUPLICATE rows excluded on both sides; future-dated rows are INVALID',
  israel: areaLatest.find((x) => x.area === 'il'),
  districts: areaLatest.filter((x) => x.area !== 'il'),
  localities: { total: locLatest.length, withTransactions: locLatest.filter((x) => x.source).length, match: locLatest.filter((x) => x.match).length,
    mismatch: locMis.length, pendingLive: locLatest.filter((x) => x.reason === 'LIVE_CHECK_PENDING').length, noTransaction: locLatest.filter((x) => !x.source).length,
    byVia: locLatest.reduce((m, x) => add(m, x.via || 'none'), {}), mismatches: locMis.slice(0, 200) },
  streets: { checked: Math.min(streetSource.size, streetsLimit), withTransactions: streetSource.size, mismatch: streetRows.length, ms: Date.now() - t0,
    byReason: streetRows.reduce((m, x) => add(m, x.reason), {}), mismatches: streetRows.slice(0, 300) },
};

const out = {
  schema: 1, builtAt: new Date().toISOString(), today, engine: TX.ENGINE,
  universe: { accessibleSourceRows: (register.copy.deals || 0) + (file.rowsTotal || 0), register, govmap },
  buckets: { meaning: MEANING, govmapWindow: gm.window, govmapHistory: gm.history, govmapAll: bucketsAll,
    register: regSet ? { SURFACED: register.settlements.mapped.deals, PLACED_BY_PARCEL: register.unmapped ? (register.unmapped.placed || {})['official-locality'] || 0 : null,
      UNPLACED: register.unmapped ? register.unmapped.rows - ((register.unmapped.placed || {})['official-locality'] || 0) + (regSet.dealsUnderNoSettlement || 0) : null,
      note: 'the register\'s deals under official localities are listed in their locality\'s ALL (the stored window, then the live search, date-paged); deals under unmapped names are placed by parcel or stay in Israel\'s list; deals the copy counts under no settlement name are in Israel\'s list through the national search' } : null },
  reachability: reach,
  defensibleKnownSourceEventsNotSurfaced: notSurfaced,
  recovery, streets, parcels, latest,
  liveCheck: allCheck ? { ranAt: allCheck.ranAt, pass: allCheck.pass, full: (allCheck.full || []).map((x) => ({ id: x.id, pass: x.pass, register: x.register, registerExpected: x.registerExpected, govmapHistoryRows: x.govmapHistoryRows, govmapHistoryAccounted: x.govmapHistoryAccounted, pages: x.pages, oldest: x.oldest, duplicateIds: x.duplicateIds })),
    partial: (allCheck.partial || []).map((x) => ({ id: x.id, pass: x.pass, first: x.head.firstCounted, oldest: x.tail.oldest })), periods: allCheck.periods, latest: allCheck.latest && allCheck.latest.summary } : null,
};
fs.writeFileSync(path.join(T, 'completeness-audit.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ universe: out.universe.accessibleSourceRows, partitionEqual: govmap.partition.equal, buckets: bucketsAll, notSurfaced, reach: reach.checks.map((c) => [c.id, c.rows, c.notReachable]),
  latest: { israel: latest.israel, districtsMismatch: latest.districts.filter((x) => !x.match).length, localities: { ...latest.localities, mismatches: undefined }, streets: { ...latest.streets, mismatches: undefined } } }, null, 1));
