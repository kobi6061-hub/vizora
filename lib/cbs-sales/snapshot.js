// PROPX · CBS new-home sales — the page payload (data/cbs-sales/latest.json + latest.js) from the ledger.
//
// Everything on the page comes from the ledger's current records: the monthly counts as published, and the metrics
// lib/cbs-sales/metrics.js derives from them. A geography whose request failed in this run keeps its last payload,
// marked stale with the error — never zeroed, never dropped.

'use strict';

const { SOURCE, GEOS, MEASURES } = require('./series');
const { currentOf, seriesOf } = require('./ledger');
const { metricsFor, freshness, reconcile, addM, label } = require('./metrics');

const KEEP_MONTHS = 72;
/* the national figure the board showed before this source (Tax Authority / Chief Economist 2025 summary, transcribed) */
const TAX_AUTHORITY_2025 = 34000;

function lastMonths(monthly, n) {
  const ps = Object.keys(monthly).sort().slice(-n);
  return ps.map((p) => [p, monthly[p]]);
}

/**
 * @param {object[]} records   the whole ledger
 * @param {object}   run       { at, status, failed: Set("measure|cbs"), errors: {"measure|cbs": msg}, checkedAt }
 * @param {object}   prev      previous latest.json (or null)
 */
function buildPayload(records, run, prev) {
  const cur = currentOf(records);
  const failed = run.failed || new Set();
  const geos = {};
  let maxUpdate = null;
  for (const g of GEOS) {
    const monthly = seriesOf(cur, 'new_sold', g.cbs, 'M'), annual = seriesOf(cur, 'new_sold', g.cbs, 'Y');
    const recs = [...cur.values()].filter((r) => r.measure === 'new_sold' && r.cbs === g.cbs && r.freq === 'M');
    const upd = recs.map((r) => r.sourceUpdate).filter(Boolean).sort().pop() || null;
    if (upd && (!maxUpdate || upd > maxUpdate)) maxUpdate = upd;
    const k = `new_sold|${g.cbs}`;
    if (!Object.keys(monthly).length && prev && prev.geos && prev.geos[g.key]) { geos[g.key] = { ...prev.geos[g.key], stale: true, lastError: (run.errors || {})[k] || null }; continue; }
    geos[g.key] = {
      cbs: g.cbs, level: g.level, name: { he: g.he, en: g.en }, ...(g.note ? { note: g.note } : {}),
      seriesId: recs.length ? recs[recs.length - 1].seriesId : null, sourceUpdate: upd,
      monthly: lastMonths(monthly, KEEP_MONTHS), annual,
      metrics: metricsFor(monthly, annual),
      ...(failed.has(k) ? { stale: true, lastError: (run.errors || {})[k] || null } : {}),
    };
  }
  const one = (measure) => {
    const m = seriesOf(cur, measure, 5069, 'M'), ps = Object.keys(m).sort();
    if (!ps.length) return prev && prev[measure] ? { ...prev[measure], stale: true } : null;
    const recs = [...cur.values()].filter((r) => r.measure === measure && r.cbs === 5069 && r.freq === 'M');
    const last = ps[ps.length - 1];
    return { measure, what: { he: MEASURES[measure].he, en: MEASURES[measure].en }, latest: { period: last, value: m[last], label: label(last, last) },
      monthly: lastMonths(m, 24), sourceUpdate: recs.map((r) => r.sourceUpdate).filter(Boolean).sort().pop() || null,
      seriesId: recs.length ? recs[recs.length - 1].seriesId : null, ...(failed.has(`${measure}|5069`) ? { stale: true } : {}) };
  };
  const inventory = one('inventory'), monthsSupply = one('months_supply'), subsidized = one('new_sold_subsidized');
  /* reconciliation: national vs the sum of its 7 districts (CBS: the total includes an unknown district) */
  const nat = seriesOf(cur, 'new_sold', 5069, 'M');
  const dist = GEOS.filter((g) => g.level === 'district').map((g) => seriesOf(cur, 'new_sold', g.cbs, 'M'));
  const natM = geos.il && geos.il.metrics;
  let reconciliation = null;
  if (natM && natM.ok) {
    const months = []; for (let i = 11; i >= 0; i--) months.push(addM(natM.latest, -i));
    const rows = reconcile(nat, dist, months);
    const full = rows.every((r) => r.districtSum != null);
    const ann = natM.lastYear;
    reconciliation = {
      months: rows,
      t12: full ? { from: months[0], to: months[11], national: rows.reduce((a, r) => a + r.national, 0), districtSum: rows.reduce((a, r) => a + r.districtSum, 0) } : null,
      year: { year: ann.year, cbsAnnual: ann.annual, cbsSumOfMonths: ann.sumOfMonths, taxAuthority: ann.year === '2025' ? TAX_AUTHORITY_2025 : null },
      note: { he: 'הסך הארצי של הלמ״ס כולל עסקאות במחוז לא ידוע; ההפרש בין הסך הארצי לסכום המחוזות הוא אותו "לא ידוע" — לא נכפה איזון.',
        en: 'The CBS national total includes deals in an unknown district; the gap between the national total and the sum of the districts is that "unknown" — nothing is forced to balance.' },
    };
    if (reconciliation.t12) reconciliation.t12.residual = reconciliation.t12.national - reconciliation.t12.districtSum;
  }
  /* the WHOLE MARKET (21.10.2026): all dwellings sold, second-hand sold, subsidized new sold — per geography, each its own universe
     (never added to new_sold; a share is shown only within one month and one geography where both figures are published) */
  const market = {};
  const recsOf = (measure) => [...cur.values()].filter((r) => r.measure === measure && r.freq === 'M');
  for (const measure of Object.keys(MEASURES).filter((m) => MEASURES[m].market)) {
    const byGeo = new Map(); for (const r of recsOf(measure)) { const k = r.geo; if (!k) continue; const a = byGeo.get(k); if (a) a.push(r); else byGeo.set(k, [r]); }
    for (const [k, recs] of byGeo) {
      const codes = [...new Set(recs.map((r) => r.cbs))];
      if (codes.length !== 1) throw new Error(`${measure}: geography ${k} under two CBS codes (${codes.join(', ')}) — a name mapping changed`);
      const monthly = seriesOf(cur, measure, codes[0], 'M'), annual = seriesOf(cur, measure, codes[0], 'Y');
      const g = market[k] = market[k] || {};
      g[measure] = { cbs: codes[0], name: recs.map((r) => r.geoName).filter(Boolean).pop() || null, what: { he: MEASURES[measure].he, en: MEASURES[measure].en },
        seriesId: recs[recs.length - 1].seriesId, sourceUpdate: recs.map((r) => r.sourceUpdate).filter(Boolean).sort().pop() || null,
        monthly: lastMonths(monthly, 24), metrics: metricsFor(monthly, annual), ...(failed.has(`${measure}|${codes[0]}`) ? { stale: true } : {}) };
    }
  }
  for (const [k, g] of Object.entries(market)) {
    /* the second-hand share of all dwellings sold — the same month, the same geography, both published; else null with the reason */
    const T = g.total_sold && g.total_sold.metrics, H = g.second_hand_sold && g.second_hand_sold.metrics;
    g.secondHandShare = T && T.ok && H && H.ok && T.t12.ok && H.t12.ok && T.t12.to === H.t12.to && T.t12.value > 0
      ? { ok: true, pct: +(H.t12.value / T.t12.value * 100).toFixed(1), from: T.t12.from, to: T.t12.to, secondHand: H.t12.value, total: T.t12.value, formula: `${H.t12.value} ÷ ${T.t12.value}` }
      : { ok: false, why: { he: 'אין 12 חודשים חופפים של שתי הסדרות', en: 'no 12 overlapping months of both series' } };
  }
  const latest = natM && natM.ok ? natM.latest : (prev && prev.freshness && prev.freshness.latest) || null;
  const firsts = Object.values(geos).map((g) => g.metrics && g.metrics.first).filter(Boolean).sort();
  return {
    schema: 1, source: SOURCE, syncedAt: run.at, checkedAt: run.checkedAt || (prev && prev.checkedAt) || null, status: run.status,
    sourceUpdate: maxUpdate, freshness: freshness(latest, Date.parse(run.at)),
    depth: latest && firsts.length ? { from: firsts[0], to: latest } : null,
    records: { observations: records.length, current: cur.size, revisions: records.filter((r) => (r.revision || 0) > 0).length },
    geos, inventory, monthsSupply, subsidized, reconciliation,
    market: Object.keys(market).length ? market : (prev && prev.market ? Object.fromEntries(Object.entries(prev.market).map(([k, v]) => [k, { ...v, stale: true }])) : null),
  };
}

const toJs = (payload) => '/* generated by scripts/cbs-sales-sync.js — do not edit by hand */\nwindow.PROPX_CBS_SALES=' + JSON.stringify(payload).replace(/</g, '\\u003c') + ';\n';

module.exports = { buildPayload, toJs, TAX_AUTHORITY_2025, KEEP_MONTHS };
