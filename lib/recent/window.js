// PROPX · recent transactions layer — the window (20.10.2026).
//
// The recent layer covers the deals the register copy cannot yet hold because of the register's REPORTING LAG: from
// RECENT_LAG_DAYS before the register copy's latest deal — the bound the 19.10.2026 audit used for "reported late" (the copy of
// 19.09.2026 held ≈ 82 % of June, ≈ 41 % of July and ≈ 13 % of August 2026: before the bound the register is nearly complete,
// after it a newer copy adds deals) — up to the newer copy's own load day (a later date is not a deal yet: FUTURE_DATED).
// When the register copy moves, the window moves with it.

'use strict';

const RECENT_LAG_DAYS = 75;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const minusDays = (d, k) => isoDay(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - k * 864e5);

/** the window for a register copy whose latest deal is `registerLastDeal` */
function windowOf(registerLastDeal) {
  if (!registerLastDeal) return null;
  return { from: minusDays(registerLastDeal, RECENT_LAG_DAYS), registerLastDeal: String(registerLastDeal).slice(0, 10), lagDays: RECENT_LAG_DAYS };
}

module.exports = { RECENT_LAG_DAYS, windowOf, minusDays, isoDay };
