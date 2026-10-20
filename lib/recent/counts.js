// PROPX · THE THREE TRANSACTION COUNTS (20.10.2026) — never collapsed into one number.
//
//   RECORDED TRANSACTION EVENTS              the register's observed dwelling deals (every deal its rules count — partial sales and
//                                            unpriced deals included) + the recent-only deals that pass every event gate
//                                            (lib/recent/promote.js EVENT_GATES — counted as transactions, their price never used)
//   VERIFIED DWELLING TRANSACTIONS           the register's observed dwelling deals + the recent-only deals VERIFIED (today none: the
//                                            recent copy states no ownership share)
//   PRICED TRANSACTIONS USED IN STATISTICS   the register's priced deals (whole property, ≥ ₪100,000 — what its median reads) + the
//                                            recent-only VERIFIED whole-property deals (today none)
//
// Each figure keeps its parts apart (register · recent) and its period. A recent-only deal is never counted twice: the reconciliation
// lists only deals the register copy does not hold, and a deal a newer register copy confirms leaves the layer and is counted through
// the register (lib/recent/lifecycle.js). Two periods: the register's window extended to the latest recent-only deal, and the recent
// window (where the two copies overlap). When the recent layer is not reconciled against the register copy PROPX holds, its part is
// null with the reason — the register's figures stand alone.

'use strict';

const RECENT = require('./read');
const EV = require('../streets/evidence');

const NOTE = 'Recent recorded transactions include transactions whose ownership share is not stated by the recent source. These transactions are excluded from price statistics until their pricing semantics can be verified.';
const NOTE_HE = 'עסקאות שנרשמו לאחרונה כוללות עסקאות שהמקור החדש אינו מציין בהן איזה חלק מהנכס נמכר. עסקאות אלה אינן נכללות בסטטיסטיקות המחיר עד שיהיה אפשר לאמת את משמעות המחיר שלהן.';
const TERMS = ['recorded_transaction_events', 'verified_dwelling_transactions', 'priced_transactions_in_statistics'];
const VERIFIED = 'RECENT_OBSERVED_VERIFIED';

const inP = (d, p) => d && d >= p.from && d <= p.to;

/**
 * @param register { deals: [{ date, priced, pricePerSqm }], window: { from, to }, scrapedAt, lastDeal } | null
 * @param recent   RECENT.allRows(…) for the same scope
 */
function compose(register, recent) {
  if (!register) return { available: false, reason: 'register-not-swept', note: NOTE, noteHe: NOTE_HE, terms: TERMS };
  const rows = recent && recent.available ? recent.rows : null;
  const latestRecent = rows ? rows.filter((r) => r.event === true || r.state === VERIFIED).map((r) => r.date).sort().pop() || null : null;
  const end = [register.window.to, latestRecent].filter(Boolean).sort().pop();
  const periods = [{ id: 'window', from: register.window.from, to: end }];
  if (recent && recent.window && recent.window.from) periods.push({ id: 'recent', from: recent.window.from, to: end });
  const out = periods.map((p) => {
    const R = register.deals.filter((d) => inP(d.date, p));
    const reg = { observed: R.length, priced: R.filter((d) => d.priced).length, withSqm: R.filter((d) => d.pricePerSqm != null).length };
    const X = rows ? rows.filter((r) => inP(r.date, p)) : null;
    const rec = X ? { events: X.filter((r) => r.event === true).length, verified: X.filter((r) => r.state === VERIFIED).length,
      priced: X.filter((r) => r.state === VERIFIED && r.priced).length, withSqm: X.filter((r) => r.state === VERIFIED && r.pricePerSqm != null).length,
      shownNotCounted: X.filter((r) => r.event !== true && r.state !== VERIFIED).length } : null;
    const add = (a, b) => (b == null ? a : a + b);
    return {
      id: p.id, from: p.from, to: p.to,
      recordedEvents: { total: add(reg.observed, rec && rec.events), register: reg.observed, recent: rec ? rec.events : null },
      verifiedDwelling: { total: add(reg.observed, rec && rec.verified), register: reg.observed, recent: rec ? rec.verified : null },
      pricedInStatistics: { total: add(reg.priced, rec && rec.priced), register: reg.priced, recent: rec ? rec.priced : null,
        withSqm: add(reg.withSqm, rec && rec.withSqm) },
      recentShownNotCounted: rec ? rec.shownNotCounted : null,
    };
  });
  return {
    available: true, periods: out,
    recentLayer: rows ? { available: true, copyLoadedAt: recent.copy.loadedAt, copyLastDeal: recent.copy.lastDeal } : { available: false, reason: recent ? recent.reason : 'not-read' },
    register: { scrapedAt: register.scrapedAt, lastDeal: register.lastDeal, window: register.window },
    note: NOTE, noteHe: NOTE_HE, terms: TERMS,
    basis: 'register: observed dwelling deals (OBSERVED street link · dwelling natures) — priced = whole property ≥ ₪100,000; recent: rows of the reconciled layer only (never a deal the register copy holds)',
  };
}

/** a street: the register's OBSERVED dwelling deals (the street read's own list) + the layer's rows on the street */
function forStreet(id, ev, { dir } = {}) {
  if (!ev || !ev.swept) return compose(null);
  const src = ev.source || {};
  const reg = { deals: ev.deals, window: ev.window, scrapedAt: src.scrapedAt || null, lastDeal: src.lastDeal || null };
  return compose(reg, dir ? { available: false, reason: 'not-read-for-this-evidence-store' } : RECENT.allRows({ street: id }));
}

/** a locality: every dwelling deal of its register shard (every address state — the locality is certain) + the layer's rows in it */
function forLocality(code, { dir } = {}) {
  const S = EV.store(dir || undefined);
  if (!S.available) return compose(null);
  const sh = EV.shardOf(Number(code), dir || undefined);
  if (!sh) return { ...compose(null), cityCode: Number(code) };
  const deals = EV.dealsOf(sh).map((x) => x.deal).filter((d) => d.dwelling);
  const reg = { deals, window: S.meta.window, scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal };
  return { cityCode: Number(code), ...compose(reg, dir ? { available: false, reason: 'not-read-for-this-evidence-store' } : RECENT.allRows({ code })),
    basis: 'register: every dwelling deal of the locality (every address state — the locality is certain), priced = whole property ≥ ₪100,000; recent: rows of the reconciled layer placed in the locality' };
}

module.exports = { NOTE, NOTE_HE, TERMS, compose, forStreet, forLocality };
