// PROPX · Land & Tender — coverage accounting, shared by the sync (meta.json)
// and the read model (every API answer).
//
// The tender LIST is read whole on every sync (full coverage). The per-tender
// DETAIL (lots, bids, winners, parcels, plan numbers) is read on a daily
// budget, so at any moment the records split into:
//   retrieved    detail read at least once (lotsCount != null)
//   unavailable  the site answered 404 for the detail (remembered; re-asked after 60 days)
//   refused      the site answered 403 / 429 (remembered until re-asked)
//   pending      never read, or only transient errors so far
// "checked" = retrieved + unavailable + refused. Nothing here is estimated: every
// count is over the stored records.

'use strict';

const detailState = (r) => {
  if (r.lotsCount != null) return 'retrieved';
  const e = r.provenance && r.provenance.detailError;
  if (e && e.status === 404) return 'unavailable';
  if (e && (e.status === 403 || e.status === 429)) return 'refused';
  return 'pending';
};
const yearOf = (r) => String(r.michrazId).slice(0, 4);

/** coverage over a set of (live) records */
function coverageOf(records) {
  const c = { listed: records.length, retrieved: 0, unavailable: 0, refused: 0, pending: 0 };
  const years = new Map();
  for (const r of records) {
    const s = detailState(r); c[s]++;
    const y = yearOf(r), e = years.get(y) || { year: y, listed: 0, retrieved: 0, unavailable: 0, refused: 0, pending: 0 };
    e.listed++; e[s]++; years.set(y, e);
  }
  c.checked = c.retrieved + c.unavailable + c.refused;
  c.pct = c.listed ? Math.round((c.checked / c.listed) * 1000) / 10 : null;            // checked ÷ listed, one decimal
  c.retrievedPct = c.listed ? Math.round((c.retrieved / c.listed) * 1000) / 10 : null;
  c.byYear = [...years.values()].sort((a, b) => (a.year < b.year ? 1 : -1)).map((e) => ({ ...e, complete: e.pending === 0 }));
  /* the sweep reads unread tenders newest first: the completed range is the newest run of years with nothing pending */
  const complete = [];
  for (const e of c.byYear) { if (e.pending === 0) complete.push(e.year); else break; }
  c.completeYears = complete;                                                               // newest → oldest
  c.completeFrom = complete.length ? complete[complete.length - 1] : null;
  c.state = c.pending === 0 ? 'complete' : c.retrieved ? 'partial' : 'none';
  return c;
}

module.exports = { coverageOf, detailState };
