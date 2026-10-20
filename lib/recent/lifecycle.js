// PROPX · RECENT TRANSACTIONS LAYER — the PROMOTION LIFECYCLE (20.10.2026).
//
// A recent-only deal is first OBSERVED in the GovMap-layer copy with a promotion state (lib/recent/promote.js) — today never
// VERIFIED, because the copy states no ownership share. The share, the nature and the exact amount become known only when a
// NEWER primary-register copy holds the same transaction: the register states the portion sold (portion_fraction). Then, and
// only then, the deal's state is decided again — deterministically, from the register's own fields:
//
//   RECENT_OBSERVED_LIMITED ──(a newer register copy holds the same transaction, semantics stated)──▶ RECENT_OBSERVED_VERIFIED
//   RECENT_OBSERVED_LIMITED ──(the newer copy contradicts it: another locality, not a dwelling, a duplicate print)──▶ RECENT_CONFLICT
//   RECENT_OBSERVED_LIMITED ──(no newer copy, or the copy does not hold it)──▶ stays RECENT_OBSERVED_LIMITED
//
// THE SAME TRANSACTION = the reconciliation's own strong match (lib/recent/reconcile.js): IN_REGISTER (the same unit within one
// day, the amounts agreeing) or IN_REGISTER_OTHER_UNIT (the same block · parcel within one day, the amounts agreeing and the area to
// the metre) — AND the recent amount fitting one of the register deal's printed forms (equal / truncated to ₪1,000, or for a partial
// sale the share's amount or the whole value); a strong match whose amount fits none → CONFLICT (register-amount-does-not-fit). A
// weak match (POSSIBLY_IN_REGISTER) is a possible duplicate — a CONFLICT, never a confirmation.
// SEMANTICS from the register: portion 1 → WHOLE_PROPERTY (or MULTI_UNIT when the register prints one consideration on several
// sub-parcels of the parcel that day — counted, never priced) · portion < 1 → PARTIAL_SHARE (counted, never priced; "0.000" is a share
// rounded at source) · no portion
// → UNKNOWN (stays LIMITED). PRICE: a whole-property amount ≥ ₪100,000. AREA (for ₪/m²): the register's area ≥ 20 m².
// A confirmed deal is COUNTED THROUGH THE REGISTER DEAL that confirmed it (the register's own figures hold it) — never added a
// second time from the recent layer.
//
// HISTORY IS NEVER REWRITTEN: data/streets/recent/promotion-history.jsonl is append-only — one event per change of state, each with
// the original observation (source, copy, load date, PROPX's first read, the verbatim row's hash and fields) and, for a
// confirmation, the confirming source and copy, PROPX's confirmation date and both representations side by side. A deal confirmed
// on 03.12 was LIMITED from its first observation until 03.12; the ledger says exactly that.
// A register copy that is NOT newer than the one a deal was first observed against never "confirms" it: a reclassification by the
// same copy (an engine change) is recorded as RESTATED, its cause named.
//
// EVENTS: OBSERVED (first read as recent-only) · RESTATED (the state changed while still recent-only, or by the same register copy)
// · CONFIRMED (a newer register copy holds it — to VERIFIED, or LIMITED when the copy states no portion) · CONFLICTED (a newer copy
// contradicts it, or it is now a duplicate / possible duplicate print) · LEFT_COPY (no longer in the GovMap-layer copy) ·
// WITHDRAWN (no longer placed / dated as a recent deal).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MIN_MARKET, MIN_AREA, DWELLING_NATURES, natureKey } = require('../streets/evidence');

const ENGINE = 'propx-recent-lifecycle-1';
const FILE = 'promotion-history.jsonl';
const SEMANTICS = ['WHOLE_PROPERTY', 'PARTIAL_SHARE', 'MULTI_UNIT', 'UNKNOWN'];
const EVENTS = ['OBSERVED', 'RESTATED', 'CONFIRMED', 'CONFLICTED', 'LEFT_COPY', 'WITHDRAWN'];
const STRONG = new Set(['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT']);
const DUP = new Set(['DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLE_DUPLICATE_IN_SOURCE', 'POSSIBLY_IN_REGISTER']);
const STRONG_STREET = new Set(['address+parcel', 'parcel']);
const DAY = 864e5;
const near = (g, d) => g != null && d != null && (g === d || (g <= d && d - g < 1000));

/** the deal's identity across copies: the source's own deal id (unique in every stored snapshot) */
const keyOf = (r) => 'govmap:' + r.dealId;
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const days = (a, b) => (a && b ? Math.round((Date.parse(String(a).replace(' ', 'T')) - Date.parse(String(b).replace(' ', 'T'))) / DAY) : null);
/* the row as the copy published it (the fields the reconciliation reads; a missing field is left out, never filled) */
const compact = (r) => Object.fromEntries(Object.entries({ oid: r.oid > 0 ? r.oid : null, series: r.series, date: r.date, amount: r.amount, areaSqm: r.area, rooms: r.rooms,
  floor: r.floor, type: r.type, nature: r.nature, settlement: r.settlement, street: r.street, house: r.house, block: r.gush, parcel: r.parcel, sub: r.sub }).filter(([, v]) => v != null));

/** the ledger file → its events (oldest first) */
function read(dir) {
  try { return fs.readFileSync(path.join(dir, FILE), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** the append-only ledger → the current record of every deal it tracks */
function fold(events) {
  const m = new Map();
  for (const e of events) {
    let c = m.get(e.key);
    if (!c) { c = { key: e.key, dealId: e.dealId, observation: null, state: null, semantics: 'UNKNOWN', reasons: [], inCopy: true, closed: false, confirmation: null, events: 0 }; m.set(e.key, c); }
    if (e.event === 'OBSERVED' && !c.observation) c.observation = e.observation;
    if (e.to) c.state = e.to;
    if (e.semantics) c.semantics = e.semantics;
    if (e.reasons) c.reasons = e.reasons;
    if (e.event === 'LEFT_COPY') c.inCopy = false;
    if (e.event === 'CONFIRMED') { c.confirmation = e.confirmation; c.closed = true; }
    if (e.event === 'CONFLICTED' && e.closes) c.closed = true;
    c.lastAt = e.at; c.events++;
  }
  return m;
}

/** the register's semantics of one register deal: the portion it states (rounded to three decimals at source — "0.000" is a share
    below 0.0005, a partial sale by the register's own rule); several sub-parcels at one consideration that day → MULTI_UNIT */
function semanticsOf(d, regs) {
  const p = d.portion;
  if (p == null || !Number.isFinite(p) || p < 0) return 'UNKNOWN';
  if (p < 1) return 'PARTIAL_SHARE';
  const [g, h] = String(d.unit).split('/').map(Number);
  const R = regs && regs.get(d.code);
  const same = R ? (R.byParcel.get(`${g}|${h}`) || []).filter((x) => x.date === d.date && x.amount === d.amount) : [];
  return new Set(same.map((x) => x.subN || 0)).size > 1 ? 'MULTI_UNIT' : 'WHOLE_PROPERTY';
}

/**
 * The state a register match decides for a tracked deal: identity re-checked against the register's own fields, the semantics read
 * from its portion. Returns { to, semantics, reasons, priced, pricePerSqm }.
 */
function decide(r, m, ctx) {
  const d = m.register;
  const reasons = [];
  const regDwelling = DWELLING_NATURES.has(natureKey(d.nature));
  /* THE SAME TRANSACTION prints its amount one of the register deal's ways: equal, or truncated to ₪1,000 (the typed series) — or, for a
     partial sale, the share's amount or the whole property's value (amount ÷ portion; the portion is rounded to three decimals at source,
     so within ₪1,000 + value × 0.0005 ÷ portion). The reconciliation's own match accepts any amount beside a partial-sale register deal of
     the same area; a confirmation does not: an amount that fits none of these forms is not shown to be this deal → CONFLICT */
  const amts = [r.amount, r.twin && r.twin.amount].filter((x) => x != null);
  const whole = d.amount != null && d.portion > 0 && d.portion < 1 ? d.amount / d.portion : null;
  const printedAs = d.amount == null ? null : amts.some((a) => near(a, d.amount)) ? (d.portion != null && d.portion < 1 ? 'share-amount' : 'register-amount')
    : whole != null && amts.some((a) => Math.abs(a - whole) <= 1000 + (whole * 0.0005) / d.portion) ? 'whole-value' : null;
  if (!printedAs) reasons.push('register-amount-does-not-fit');
  /* identity contradicted by the register → CONFLICT */
  if ((m.conflicts || []).some((c) => c.field === 'locality')) reasons.push('register-files-it-under-another-locality');
  if (r.typed && ctx.kindOf(r) === 'DWELLING' && !regDwelling) reasons.push('register-nature-not-a-dwelling');
  const semantics = semanticsOf(d, ctx.regs);
  if (reasons.length) return { to: 'RECENT_CONFLICT', semantics, reasons, priced: false, pricePerSqm: null, printedAs };
  /* the street: the address as published and the register's parcel crosswalk (the reconciliation's own rule) */
  const st = ctx.streetOf(r) || {};
  if (!regDwelling) reasons.push('not-a-dwelling');
  if (st.code == null) reasons.push('no-street-key');
  if (reasons.length) return { to: 'RECENT_CONTEXT_ONLY', semantics, reasons, priced: false, pricePerSqm: null, street: st, printedAs };
  if (!STRONG_STREET.has(st.basis)) reasons.push('street-single-key');
  if (semantics === 'UNKNOWN') reasons.push('share-not-stated-by-the-register');
  const priced = semantics === 'WHOLE_PROPERTY' && d.amount != null && d.amount >= MIN_MARKET;
  const pricePerSqm = priced && d.areaSqm != null && d.areaSqm >= MIN_AREA ? Math.round(d.amount / d.areaSqm) : null;
  return { to: reasons.length ? 'RECENT_OBSERVED_LIMITED' : 'RECENT_OBSERVED_VERIFIED', semantics, reasons, priced, pricePerSqm, street: st, printedAs };
}

/**
 * One build's lifecycle step: what the ledger says vs what this reconciliation says → the NEW events (the ledger is never edited).
 * @param ledger  fold(events)
 * @param ctx     { rows, out (reconcile), prom (Map oid → promotion), regs, streetOf(r), kindOf(r), raw: Map oid → verbatim row,
 *                  snapshot: { sha256, file, fetchedAt, copy }, register: { scrapedAt, lastDeal }, at }
 */
function step(ledger, ctx) {
  const events = [];
  const seen = new Set();
  const emit = (r, e) => events.push({ at: ctx.at, engine: ENGINE, key: keyOf(r), dealId: r.dealId, ...e });
  for (const r of ctx.rows) {
    const key = keyOf(r);
    if (seen.has(key)) continue;
    seen.add(key);
    const o = ctx.out.get(r.oid);
    if (!o) continue;
    const cur = ledger.get(key);
    const w = o.cls === 'CONTEXT_BEFORE_WINDOW' && o.asWindow ? o.asWindow : o;          // a context row: what it would be in the window
    if (!cur) {
      if (o.cls !== 'RECENT_NEW' || r.carried) continue;                                 // only a deal shown as recent-only is tracked
      const p = ctx.prom.get(r.oid);
      const g = ctx.raw.get(r.oid);
      emit(r, { event: 'OBSERVED', from: null, to: p.state, semantics: 'UNKNOWN', reasons: p.reasons,
        /* the copy's own metadata (version, latest deal, proof) stays in raw/index.json under the snapshot file — referenced, not repeated */
        observation: { source: 'over:govmap-recent', copyLoadedAt: ctx.snapshot.copy.loadedAt, snapshotFile: ctx.snapshot.file, firstReadAt: ctx.snapshot.fetchedAt,
          againstRegister: { scrapedAt: ctx.register.scrapedAt }, rowSha: g ? sha16(JSON.stringify(g)) : null, row: compact(r) } });
      continue;
    }
    if (cur.closed) continue;                                                           // confirmed or settled as a duplicate: final
    if (r.carried && cur.inCopy) emit(r, { event: 'LEFT_COPY', from: cur.state, to: cur.state, note: 'no longer in the GovMap-layer copy PROPX read last; evaluated from the copy that first showed it' });
    const newerRegister = String(ctx.register.scrapedAt) !== String(cur.observation && cur.observation.againstRegister ? cur.observation.againstRegister.scrapedAt : '');
    if (STRONG.has(w.cls)) {
      const dcs = decide(r, w, ctx);
      const confirmation = { source: 'over:deals-register', registerScrapedAt: ctx.register.scrapedAt, registerLastDeal: ctx.register.lastDeal, confirmedAt: ctx.at, match: { cls: w.cls, via: w.via },
        representations: { recent: compact(r), recentTwin: r.twin ? compact(r.twin) : null, register: w.register }, printedAs: dcs.printedAs, conflicts: w.conflicts || [], priced: dcs.priced, pricePerSqm: dcs.pricePerSqm,
        countedVia: 'register', lagDays: { fromFirstRead: days(ctx.register.scrapedAt, cur.observation && cur.observation.firstReadAt), fromCopyLoad: days(ctx.register.scrapedAt, cur.observation && cur.observation.copyLoadedAt),
          fromDeal: days(ctx.register.scrapedAt, r.date), propxFromFirstRead: days(ctx.at, cur.observation && cur.observation.firstReadAt) } };
      if (newerRegister && dcs.to === cur.state && dcs.semantics === cur.semantics) continue;               // already decided this way — nothing new
      if (newerRegister) emit(r, { event: dcs.to === 'RECENT_CONFLICT' ? 'CONFLICTED' : 'CONFIRMED', from: cur.state, to: dcs.to, semantics: dcs.semantics, reasons: dcs.reasons,
        ...(dcs.to === 'RECENT_CONFLICT' ? { closes: !dcs.reasons.includes('register-amount-does-not-fit'), conflictWith: confirmation } : { confirmation }) });
      else if (dcs.to !== cur.state) emit(r, { event: 'RESTATED', from: cur.state, to: dcs.to, semantics: cur.semantics, reasons: ['the same register copy now holds it (engine change) — not a later confirmation', ...dcs.reasons], cause: 'ENGINE' });
      continue;
    }
    if (DUP.has(w.cls)) {
      const why = w.cls === 'POSSIBLY_IN_REGISTER' ? 'possible-duplicate-of-register-deal' : w.via === 'register-share' ? 'second-print-of-a-partial-sale' : w.via === 'register-amount' ? 'second-print-of-a-register-deal' : 'duplicate-in-source';
      if (cur.state !== 'RECENT_CONFLICT') emit(r, { event: 'CONFLICTED', from: cur.state, to: 'RECENT_CONFLICT', semantics: cur.semantics, reasons: [why], closes: w.cls !== 'POSSIBLY_IN_REGISTER' && w.cls !== 'POSSIBLE_DUPLICATE_IN_SOURCE',
        conflictWith: w.register ? { source: 'over:deals-register', registerScrapedAt: ctx.register.scrapedAt, register: w.register, via: w.via || null } : { source: 'over:govmap-recent', twinOf: w.twinOf ?? null, candidates: w.candidates || null } });
      continue;
    }
    if (w.cls === 'RECENT_NEW') {
      const p = ctx.prom.get(r.oid);
      if (p && p.state !== cur.state) emit(r, { event: 'RESTATED', from: cur.state, to: p.state, semantics: 'UNKNOWN', reasons: p.reasons, cause: newerRegister ? 'REGISTER_COPY_CHANGED' : 'ENGINE_OR_REFERENCE_DATA' });
      continue;
    }
    /* no longer a placed, dated recent deal (an exclusion rule now applies) */
    if (cur.state !== 'RECENT_UNRESOLVED' && !(o.cls === 'CONTEXT_BEFORE_WINDOW' && !o.asWindow)) emit(r, { event: 'WITHDRAWN', from: cur.state, to: 'RECENT_UNRESOLVED', semantics: cur.semantics, reasons: ['reclassified:' + w.cls] });
  }
  return events;
}

const q = (xs, p) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

/** the lifecycle summary over the whole ledger (what the meta and the report print) */
function summary(events) {
  const cur = fold(events);
  const byState = {}, transitions = {}, byEvent = {};
  for (const e of events) { byEvent[e.event] = (byEvent[e.event] || 0) + 1; if (e.event !== 'OBSERVED' && e.from !== e.to) { const k = `${e.from} → ${e.to}`; transitions[k] = (transitions[k] || 0) + 1; } }
  for (const c of cur.values()) byState[c.state] = (byState[c.state] || 0) + 1;
  const conf = [...cur.values()].filter((c) => c.confirmation);
  const sem = conf.reduce((m, c) => ((m[c.semantics] = (m[c.semantics] || 0) + 1), m), {});
  const lag = conf.map((c) => c.confirmation.lagDays && c.confirmation.lagDays.fromFirstRead).filter((x) => x != null);
  /* the confirmation-lag bands the report states (days from PROPX's first read of the recent row to the confirming register copy) */
  const BANDS = [['0–7', 0, 7], ['8–21', 8, 21], ['22–45', 22, 45], ['46–90', 46, 90], ['90+', 91, Infinity]];
  const bands = Object.fromEntries(BANDS.map(([k, a, b]) => [k, lag.filter((x) => x >= a && x <= b).length]));
  return { engine: ENGINE, file: FILE, events: events.length, byEvent, deals: cur.size, byState, transitions,
    open: [...cur.values()].filter((c) => !c.closed).length, openLimited: [...cur.values()].filter((c) => !c.closed && c.state === 'RECENT_OBSERVED_LIMITED').length,
    confirmed: conf.length, confirmedSemantics: sem,
    lag: lag.length ? { basis: 'days from PROPX\'s first read of the recent row to the confirming register copy', n: lag.length, median: q(lag, 0.5), p80: q(lag, 0.8), p90: q(lag, 0.9), max: Math.max(...lag), bands }
      : { n: 0, median: null, p80: null, p90: null, max: null, bands, reason: 'no deal has been confirmed by a newer register copy yet' } };
}

module.exports = { ENGINE, FILE, SEMANTICS, EVENTS, keyOf, read, fold, step, decide, semanticsOf, summary };
