// PROPX · CBS construction — the metrics PROPX derives from the official observations, per period kind.
//
//   OFFICIAL  latest period                   the published figure for one month / quarter (the kind the series has)
//   DERIVED   flow, monthly: T3 · T12         the sum of the published months — every month present, else none (month named)
//             flow, quarterly: T4             the sum of the published quarters — every quarter present, else none
//             YTD · prior-year YTD            Jan → the latest month (Q1 → the latest quarter), and the same periods a year earlier
//             change                          T12 vs the 12 months before · T4 vs the 4 quarters before · YTD vs prior YTD
//   STOCK     active construction             a level at period end: the latest level, vs the previous period and vs a year
//                                             earlier — NEVER summed over periods
// The month helpers (window sums, labels, reconciliation rows) are the sales lane's (lib/cbs-sales/metrics.js), reused;
// the quarter helpers, the stock view and the quarter-based freshness are this lane's. A missing period makes every
// window that needs it unavailable (with the period named); it is never filled or set to 0.

'use strict';

const SM = require('../cbs-sales/metrics');
const { SOURCE } = require('./series');
const { addM, idx, label, sumWindow, reconcile, monthName } = SM;

const NO_OBS = { he: 'אין תצפיות', en: 'no observations' };

/* ---------- quarters: "YYYY-Qn" ---------- */
const Q_RE = /^(\d{4})-Q([1-4])$/;
const qParts = (p) => { const m = Q_RE.exec(p); if (!m) throw new Error('not a quarter: ' + p); return { y: +m[1], q: +m[2] }; };
const qIdx = (p) => { const { y, q } = qParts(p); return y * 4 + q - 1; };
const qPer = (i) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
const addQ = (p, k) => qPer(qIdx(p) + k);
const ym = (p) => { const [y, m] = p.split('-').map(Number); return { y, m }; };
const quarterOfMonth = (p) => { const { y, m } = ym(p); return `${y}-Q${Math.ceil(m / 3)}`; };
const quarterEnd = (qp) => { const { y, q } = qParts(qp); return Date.UTC(y, q * 3, 0, 23, 59, 59); };   /* the last day of the quarter */
const qName = (p, L) => { const { y, q } = qParts(p); return L === 'he' ? `רבעון ${q} ${y}` : `Q${q} ${y}`; };
function qRangeLabel(from, to, L) {
  if (from === to) return qName(from, L);
  const a = qParts(from), b = qParts(to);
  if (a.y === b.y) return L === 'he' ? `רבעונים ${a.q}–${b.q} ${b.y}` : `Q${a.q}–Q${b.q} ${b.y}`;
  return `${qName(from, L)}–${qName(to, L)}`;
}
const qLabel = (from, to) => ({ he: qRangeLabel(from, to, 'he'), en: qRangeLabel(from, to, 'en') });
/** a bilingual label for one period or a range, by kind */
function periodLabel(freq, from, to = from) {
  if (freq === 'Q') return qLabel(from, to);
  if (freq === 'M') return label(from, to);
  return { he: from === to ? from : `${from}–${to}`, en: from === to ? from : `${from}–${to}` };
}
const pName = (freq, p, L) => (freq === 'Q' ? qName(p, L) : freq === 'M' ? monthName(p, L) : p);
const step = (freq, p, k) => (freq === 'Q' ? addQ(p, k) : addM(p, k));
const yearStep = (freq) => (freq === 'Q' ? 4 : 12);

/** the sum of n quarters ending at `to` — or why there is none (the quarter named) */
function sumQWindow(quarterly, to, n) {
  let s = 0;
  const from = addQ(to, -(n - 1));
  for (let i = 0; i < n; i++) {
    const p = addQ(from, i), v = quarterly[p];
    if (typeof v !== 'number') return { ok: false, from, to, quarters: n, why: { he: `חסר נתון ל${qName(p, 'he')}`, en: `${qName(p, 'en')} missing` }, missing: p };
    s += v;
  }
  return { ok: true, value: s, from, to, quarters: n, label: qLabel(from, to) };
}

const pct = (a, b) => (b > 0 ? +((a / b - 1) * 100).toFixed(1) : null);
const change = (now, before, basis) => (now.ok && before.ok
  ? { ok: true, pct: pct(now.value, before.value), abs: now.value - before.value, now, before, basis }
  : { ok: false, why: !now.ok ? now.why : before.why, basis });

/* ---------- flows ---------- */
function flowMonthly(monthly, annual = {}) {
  const periods = Object.keys(monthly).sort();
  if (!periods.length) return { ok: false, why: NO_OBS };
  const latest = periods[periods.length - 1], first = periods[0];
  const { y: Y, m: Mo } = ym(latest);
  const t3 = sumWindow(monthly, latest, 3), t12 = sumWindow(monthly, latest, 12), pT12 = sumWindow(monthly, addM(latest, -12), 12);
  const ytd = sumWindow(monthly, latest, Mo), pYtd = sumWindow(monthly, addM(latest, -12), Mo);
  const lastFullYear = String(Y - 1), yearSum = sumWindow(monthly, `${lastFullYear}-12`, 12);
  return { ok: true, freq: 'M', kind: 'flow', first, latest, periods: periods.length, latestValue: monthly[latest], latestLabel: label(latest, latest),
    t3, t12, prevT12: pT12, ytd, prevYtd: pYtd, change: { t12: change(t12, pT12, '12m'), ytd: change(ytd, pYtd, 'ytd') },
    lastYear: { year: lastFullYear, annual: typeof annual[lastFullYear] === 'number' ? annual[lastFullYear] : null, sumOfMonths: yearSum.ok ? yearSum.value : null } };
}
function flowQuarterly(quarterly, annual = {}) {
  const periods = Object.keys(quarterly).sort((a, b) => qIdx(a) - qIdx(b));
  if (!periods.length) return { ok: false, why: NO_OBS };
  const latest = periods[periods.length - 1], first = periods[0];
  const { y: Y, q } = qParts(latest);
  const t4 = sumQWindow(quarterly, latest, 4), pT4 = sumQWindow(quarterly, addQ(latest, -4), 4);
  const ytd = sumQWindow(quarterly, latest, q), pYtd = sumQWindow(quarterly, addQ(latest, -4), q);
  const lastFullYear = String(Y - 1), yearSum = sumQWindow(quarterly, `${lastFullYear}-Q4`, 4);
  return { ok: true, freq: 'Q', kind: 'flow', first, latest, periods: periods.length, latestValue: quarterly[latest], latestLabel: qLabel(latest, latest),
    t4, prevT4: pT4, ytd, prevYtd: pYtd, change: { t4: change(t4, pT4, '4q'), ytd: change(ytd, pYtd, 'ytd') },
    lastYear: { year: lastFullYear, annual: typeof annual[lastFullYear] === 'number' ? annual[lastFullYear] : null, sumOfQuarters: yearSum.ok ? yearSum.value : null } };
}
/* ---------- stocks: a level, compared — never summed ---------- */
function stock(series, freq) {
  const periods = Object.keys(series).sort((a, b) => (freq === 'Q' ? qIdx(a) - qIdx(b) : idx(a) - idx(b)));
  if (!periods.length) return { ok: false, why: NO_OBS };
  const latest = periods[periods.length - 1], first = periods[0], latestValue = series[latest];
  const vs = (p, basis) => (typeof series[p] === 'number'
    ? { ok: true, period: p, value: series[p], abs: latestValue - series[p], pct: pct(latestValue, series[p]), basis, label: periodLabel(freq, p) }
    : { ok: false, period: p, basis, why: { he: `חסר נתון ל${pName(freq, p, 'he')}`, en: `${pName(freq, p, 'en')} missing` } });
  return { ok: true, freq, kind: 'stock', first, latest, periods: periods.length, latestValue, latestLabel: periodLabel(freq, latest),
    vsPrevious: vs(step(freq, latest, -1), 'prev'), vsYearEarlier: vs(step(freq, latest, -yearStep(freq)), 'yoy'),
    note: { he: 'מלאי בסוף התקופה — רמה, לא זרם; לא מסוכם על פני תקופות', en: 'a stock at period end — a level, not a flow; never summed over periods' } };
}

/**
 * the metrics of one measure × geography from its stored series, on the finest period kind the source gives it
 * @param {'flow'|'stock'} kind
 * @param {{M?: object, Q?: object, Y?: object}} series   period → value per frequency
 */
function metricsFor(kind, series) {
  const M = (series && series.M) || {}, Q = (series && series.Q) || {}, Y = (series && series.Y) || {};
  const freq = Object.keys(M).length ? 'M' : Object.keys(Q).length ? 'Q' : null;
  if (!freq) return { ok: false, why: NO_OBS };
  const out = kind === 'stock' ? stock(freq === 'M' ? M : Q, freq) : freq === 'M' ? flowMonthly(M, Y) : flowQuarterly(Q, Y);
  if (freq === 'M' && Object.keys(Q).length) out.quarterly = kind === 'stock' ? stock(Q, 'Q') : flowQuarterly(Q, Y);   /* CBS's own quarterly series beside the monthly */
  return out;
}

/* ------------------------------------------------------------ freshness (quarter-based)
   ASSUMPTION (SOURCE.lagAssumption — documented, not an official release calendar): CBS's quarterly construction release
   appears about 10 weeks after the quarter ends, and the monthly figures appear with it (observed once: Q2 2026 → series
   update 2026-09-10, 72 days). With the latest observation's quarter Qn in hand, the next quarter Qn+1 ends at E:
     CURRENT                 now ≤ E + 60 days  — the next release cannot normally be out yet
     EXPECTED_REPORTING_LAG  E + 60 < now ≤ E + 120 days — the release is due; a normal delay, not stale
     STALE                   later, and the next quarter is still not published */
const DAY = 86400e3, CURRENT_DAYS = 60, STALE_DAYS = 120;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const quarterOf = (period, freq) => (freq === 'Q' ? period : freq === 'M' ? quarterOfMonth(period) : `${period}-Q4`);
function freshness(latest, freq, now = Date.now()) {
  if (!latest || !freq) return { state: 'STALE', why: 'no data', basis: 'quarterly release', assumption: SOURCE.lagAssumption };
  const lq = quarterOf(latest, freq), next = addQ(lq, 1), end = quarterEnd(next), age = (now - end) / DAY;
  const state = age <= CURRENT_DAYS ? 'CURRENT' : age <= STALE_DAYS ? 'EXPECTED_REPORTING_LAG' : 'STALE';
  return { state, latest, freq, latestQuarter: lq, nextQuarter: next, nextQuarterEnds: iso(end), nextDueFrom: iso(end + CURRENT_DAYS * DAY), staleAfter: iso(end + STALE_DAYS * DAY),
    basis: 'quarterly release', thresholds: { currentDays: CURRENT_DAYS, staleDays: STALE_DAYS }, assumption: SOURCE.lagAssumption };
}
const FRESH_RANK = { CURRENT: 0, EXPECTED_REPORTING_LAG: 1, STALE: 2 };

/* ------------------------------------------------------------ reconciliation
   the national row as published vs the sum of the 7 district rows as published, period by period; the residual is
   reported, never forced and never explained by PROPX. A flow is compared over the window (12 months / 4 quarters);
   a stock only at each period (levels are not summed over time). */
function reconcileMeasure(national, districts, freq, kind, n = freq === 'Q' ? 4 : 12) {
  const periods0 = Object.keys(national || {});
  if (!periods0.length) return null;
  const latest = periods0.sort((a, b) => (freq === 'Q' ? qIdx(a) - qIdx(b) : idx(a) - idx(b)))[periods0.length - 1];
  const periods = []; for (let i = n - 1; i >= 0; i--) periods.push(step(freq, latest, -i));
  const rows = reconcile(national, districts, periods);
  const full = rows.every((r) => r.districtSum != null);
  const last = rows[rows.length - 1];
  const window = kind === 'stock'
    ? (last.districtSum != null ? { period: latest, label: periodLabel(freq, latest), national: last.national, districtSum: last.districtSum, residual: last.residual, basis: 'latest period (a stock is not summed)' } : null)
    : (full ? { from: periods[0], to: latest, label: periodLabel(freq, periods[0], latest), national: rows.reduce((a, r) => a + r.national, 0), districtSum: rows.reduce((a, r) => a + r.districtSum, 0) } : null);
  if (window && window.residual === undefined) window.residual = window.national - window.districtSum;
  return { freq, kind, periods: n, rows, window, districts: 7,
    note: { he: 'הסך הארצי כפי שפורסם מול סכום 7 שורות המחוז כפי שפורסמו; ההפרש מדווח ולא נכפה — PROPX אינו מסביר אותו.', en: 'The national row as published vs the sum of the 7 district rows as published; the residual is reported, never forced — PROPX does not explain it.' } };
}

module.exports = { metricsFor, flowMonthly, flowQuarterly, stock, freshness, FRESH_RANK, reconcileMeasure, sumQWindow, sumWindow, addQ, addM, qIdx, idx, quarterOfMonth, quarterEnd, qLabel, qName, qRangeLabel, periodLabel, pName, step, pct, CURRENT_DAYS, STALE_DAYS };
