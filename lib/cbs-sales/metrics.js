// PROPX · CBS new-home sales — the metrics PROPX derives from the official monthly observations.
//
//   OFFICIAL  latest month                       the published count for one month
//   DERIVED   trailing 3 / 6 / 12 months         the sum of the published months — every month present, else none
//   DERIVED   YTD, prior-year YTD                Jan → the latest month, and the same months a year earlier
//   DERIVED   annualized pace                    YTD × 12 ÷ months (from 3 months of the year; earlier: T3 × 4) —
//                                                a rate, never shown as a count of sales
//   DERIVED   momentum                           T3 vs the 3 months before · T6 vs the 6 before · T12 vs a year earlier ·
//                                                YTD vs prior-year YTD · acceleration = momentum now − momentum 3 months ago ·
//                                                volatility = coefficient of variation of the last 12 months
// A missing month makes every sum that needs it unavailable (with the month named); it is never filled or set to 0.
// Small samples (fewer than SMALL_N sales in the window a signal is read from) keep the count and the period but
// lose the arrow — no percentage signal is computed from them.

'use strict';

const SMALL_N = 30;   /* a 3-month window below this is a small sample: show the count, no trend arrow */

const HE_M = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const EN_M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ym = (p) => { const [y, m] = p.split('-').map(Number); return { y, m }; };
const idx = (p) => { const { y, m } = ym(p); return y * 12 + m - 1; };
const per = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const addM = (p, k) => per(idx(p) + k);
const monthName = (p, L) => { const { y, m } = ym(p); return L === 'he' ? `${HE_M[m - 1]} ${y}` : `${EN_M[m - 1]} ${y}`; };
/** "ינואר–יולי 2026" · "אוגוסט 2025–יולי 2026" · "Jan–Jul 2026" */
function rangeLabel(from, to, L) {
  const a = ym(from), b = ym(to), M = L === 'he' ? HE_M : EN_M;
  if (from === to) return monthName(from, L);
  if (a.y === b.y) return `${M[a.m - 1]}–${M[b.m - 1]} ${b.y}`;
  return `${M[a.m - 1]} ${a.y}–${M[b.m - 1]} ${b.y}`;
}
const label = (from, to) => ({ he: rangeLabel(from, to, 'he'), en: rangeLabel(from, to, 'en') });

/** the sum of n months ending at `to` — or why there is none */
function sumWindow(monthly, to, n) {
  let s = 0;
  const from = addM(to, -(n - 1));
  for (let i = 0; i < n; i++) {
    const p = addM(from, i), v = monthly[p];
    if (typeof v !== 'number') return { ok: false, from, to, months: n, why: { he: `חסר נתון ל${monthName(p, 'he')}`, en: `${monthName(p, 'en')} missing` }, missing: p };
    s += v;
  }
  return { ok: true, value: s, from, to, months: n, label: label(from, to) };
}
const pct = (a, b) => (b > 0 ? +((a / b - 1) * 100).toFixed(1) : null);

/**
 * @param {Object<string,number>} monthly  period "YYYY-MM" → published count (original data)
 * @param {Object<string,number>} annual   year "YYYY" → the published annual figure
 */
function metricsFor(monthly, annual = {}) {
  const periods = Object.keys(monthly).sort();
  if (!periods.length) return { ok: false, why: { he: 'אין תצפיות', en: 'no observations' } };
  const latest = periods[periods.length - 1], first = periods[0];
  const { y: Y, m: Mo } = ym(latest);
  const t3 = sumWindow(monthly, latest, 3), t6 = sumWindow(monthly, latest, 6), t12 = sumWindow(monthly, latest, 12);
  const ytd = sumWindow(monthly, latest, Mo), pYtd = sumWindow(monthly, addM(latest, -12), Mo);
  const pT3 = sumWindow(monthly, addM(latest, -3), 3), pT6 = sumWindow(monthly, addM(latest, -6), 6), pT12 = sumWindow(monthly, addM(latest, -12), 12);
  const t3Ago = sumWindow(monthly, addM(latest, -3), 3), pT3Ago = sumWindow(monthly, addM(latest, -6), 3);
  const small = t3.ok && t3.value < SMALL_N;
  const mom = (a, b, basis) => (a.ok && b.ok && !small && b.value >= SMALL_N ? { ok: true, pct: pct(a.value, b.value), now: a, before: b, basis } : { ok: false, why: small ? { he: 'מדגם קטן — ללא אות מגמה', en: 'small sample — no trend signal' } : (!a.ok ? a.why : b.why) });
  const m3 = mom(t3, pT3, '3m'), m6 = mom(t6, pT6, '6m'), m12 = mom(t12, pT12, '12m'), mYtd = mom(ytd, pYtd, 'ytd');
  const m3Ago = mom(t3Ago, pT3Ago, '3m');
  const accel = m3.ok && m3Ago.ok && m3.pct != null && m3Ago.pct != null ? { ok: true, pp: +(m3.pct - m3Ago.pct).toFixed(1), now: m3, before: m3Ago } : { ok: false };
  /* monthly volatility over the last 12 months: standard deviation ÷ mean */
  let vol = { ok: false };
  if (t12.ok && !small) {
    const xs = []; for (let i = 0; i < 12; i++) xs.push(monthly[addM(t12.from, i)]);
    const mean = xs.reduce((a, b) => a + b, 0) / 12, sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / 12);
    vol = mean > 0 ? { ok: true, cv: +(sd / mean * 100).toFixed(1), from: t12.from, to: t12.to, n: 12 } : { ok: false };
  }
  /* annualized pace: a rate, labelled with the months it is annualized from */
  const pace = ytd.ok && Mo >= 3 ? { ok: true, value: Math.round(ytd.value * 12 / Mo), basis: 'ytd', from: ytd.from, to: ytd.to, months: Mo, label: ytd.label, formula: `${ytd.value} × 12 ÷ ${Mo}` }
    : t3.ok ? { ok: true, value: t3.value * 4, basis: 't3', from: t3.from, to: t3.to, months: 3, label: t3.label, formula: `${t3.value} × 4` } : { ok: false };
  const lastFullYear = String(Y - 1);
  const yearSum = sumWindow(monthly, `${lastFullYear}-12`, 12);
  return {
    ok: true, first, latest, months: periods.length, latestValue: monthly[latest], latestLabel: label(latest, latest),
    t3, t6, t12, ytd, prevYtd: pYtd, ytdChange: mYtd, pace, momentum: { m3, m6, m12, ytd: mYtd }, acceleration: accel, volatility: vol, small,
    lastYear: { year: lastFullYear, annual: typeof annual[lastFullYear] === 'number' ? annual[lastFullYear] : null, sumOfMonths: yearSum.ok ? yearSum.value : null },
  };
}

/* ------------------------------------------------------------ freshness
   CBS publishes a month about 6 weeks after it ends (2026: Jan → 12.03 · Feb → 16.04 · Mar → 14.05 · Apr → 11.06 ·
   May → 13.07 · Jun → 13.08 · Jul → 10.09 · Aug → 14.10). So with the latest month M in hand:
     CURRENT                 the next month cannot normally be out yet (≤ 35 days after it ends)
     EXPECTED_REPORTING_LAG  the next month's release is due now (35–75 days after it ends) — a normal delay, not stale
     STALE                   more than 75 days after the next month ended and it is still not published */
const DAY = 86400e3;
const endOfMonth = (p) => { const { y, m } = ym(p); return Date.UTC(y, m, 0, 23, 59, 59); };
function freshness(latest, now = Date.now()) {
  if (!latest) return { state: 'STALE', why: 'no data' };
  const next = addM(latest, 1), age = (now - endOfMonth(next)) / DAY;
  const state = age <= 35 ? 'CURRENT' : age <= 75 ? 'EXPECTED_REPORTING_LAG' : 'STALE';
  return { state, latest, next, nextDueFrom: new Date(endOfMonth(next) + 35 * DAY).toISOString().slice(0, 10), staleAfter: new Date(endOfMonth(next) + 75 * DAY).toISOString().slice(0, 10) };
}

/* ------------------------------------------------------------ reconciliation
   national (5069, which CBS says includes an unknown district) vs the sum of its 7 districts, month by month */
function reconcile(national, districts, months) {
  const rows = [];
  for (const p of months) {
    const n = national[p];
    const parts = districts.map((d) => d[p]);
    if (typeof n !== 'number' || parts.some((v) => typeof v !== 'number')) { rows.push({ period: p, national: n ?? null, districtSum: null, residual: null }); continue; }
    const s = parts.reduce((a, b) => a + b, 0);
    rows.push({ period: p, national: n, districtSum: s, residual: n - s });
  }
  return rows;
}

module.exports = { SMALL_N, metricsFor, sumWindow, freshness, reconcile, rangeLabel, label, monthName, addM, idx, HE_M, EN_M };
