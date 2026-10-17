// PROPX · CBS construction — the payload (data/construction/latest.json) from the ledger.
//
// Everything comes from the ledger's current records: the figures as published, per measure × geography × period kind,
// and the metrics lib/construction/metrics.js derives from them. A geography whose request failed in this run keeps its
// last payload, marked stale with the error — never zeroed, never dropped. A measure with no observations at all says
// MISSING with the reason — never 0. Nothing here is allocated to a locality: the keys are the 8 geographies only.
//
// Shape (the hook the dossier / supply pipeline / pulse will read later — see lib/construction/README.md):
//   { schema: 1, source, syncedAt, checkedAt, status, sourceUpdate, freshness: { state, byMeasure }, geos: [labels],
//     measures: { permits | starts | completions | active: { id, what, semantics, kind, path, state: 'OK'|'MISSING', reason?,
//       freq, sourceUpdate, geos: { il | d-jm | … : { cbs, pathId, nameId, level, name, sourceName, sourceUpdate, freq,
//         series: { M: [[period, value]…], Q: [[period, value]…], Y: { year: value } }, latest: { freq, period, value, label },
//         metrics, stale?, lastError? } }, reconciliation, freshness } },
//     records: { observations, current, revisions }, missing: [{ measure, geo, reason }], notes }

'use strict';

const { SOURCE, GEOS, GEO_BY_KEY, DISTRICT_KEYS, MEASURES, MEASURE_IDS } = require('./series');
const { currentOf, seriesByGeo } = require('./ledger');
const { metricsFor, freshness, FRESH_RANK, reconcileMeasure, qIdx, idx } = require('./metrics');

const KEEP = { M: 72, Q: 24 };

const sortedPairs = (obj, freq) => Object.keys(obj).sort((a, b) => (freq === 'Q' ? qIdx(a) - qIdx(b) : idx(a) - idx(b))).map((p) => [p, obj[p]]);
const lastN = (obj, freq) => sortedPairs(obj, freq).slice(-KEEP[freq]);
const maxDate = (xs) => xs.filter(Boolean).sort().pop() || null;

/** why a measure × geography has nothing: from the resolution, the run's errors, or the fact of a first sync */
function reasonFor(resolution, measure, geo, err) {
  const R = resolution && resolution.measures && resolution.measures[measure];
  if (R && !R.ok) return { he: `הקטלוג לא נקרא: ${R.error}`, en: `catalogue not read: ${R.error}`, kind: 'catalogue' };
  const x = R && R.geos && R.geos[geo];
  if (x && x.status === 'mismatch') return { he: `קוד הקטלוג שונה מהצפוי — לא נקרא עד אימות הטבלה (${x.reason})`, en: x.reason, kind: 'mismatch' };
  if (x && x.status !== 'resolved') return { he: `הגאוגרפיה לא זוהתה בקטלוג (${x.reason})`, en: `geography not resolved in the catalogue (${x.reason})`, kind: 'unresolved' };
  if (err) return { he: `הבקשה נכשלה: ${err}`, en: `request failed: ${err}`, kind: 'request' };
  return { he: 'אין תצפיות שמורות עדיין — הסנכרון הראשון טרם רץ', en: 'no observations stored yet — the first sync has not run', kind: 'no-run' };
}

/**
 * @param {object[]} records     the whole ledger
 * @param {object}   run         { at, status, failed: Set("measure|geo"), errors: {"measure|geo": msg}, checkedAt }
 * @param {object}   prev        previous latest.json (or null)
 * @param {object}   resolution  this run's catalogue resolution (lib/construction/resolve.js) or null
 */
function buildPayload(records, run, prev, resolution = null) {
  const cur = currentOf(records);
  const failed = run.failed || new Set(), errors = run.errors || {};
  const now = Date.parse(run.at);
  const measures = {}, missing = [];
  let maxUpdate = null;
  for (const mid of MEASURE_IDS) {
    const M = MEASURES[mid];
    const prevM = prev && prev.measures && prev.measures[mid];
    const geos = {};
    let any = false, mUpdate = null;
    for (const g of GEOS) {
      const k = `${mid}|${g.key}`;
      const recs = [...cur.values()].filter((r) => r.measure === mid && r.geo === g.key);
      if (!recs.length) {
        if (prevM && prevM.geos && prevM.geos[g.key]) { geos[g.key] = { ...prevM.geos[g.key], stale: true, lastError: errors[k] || null }; any = true; }
        else missing.push({ measure: mid, geo: g.key, reason: reasonFor(resolution, mid, g.key, errors[k]) });
        continue;
      }
      any = true;
      const series = { M: seriesByGeo(cur, mid, g.key, 'M'), Q: seriesByGeo(cur, mid, g.key, 'Q'), Y: seriesByGeo(cur, mid, g.key, 'Y') };
      const metrics = metricsFor(M.kind, series);
      const upd = maxDate(recs.map((r) => r.sourceUpdate));
      if (upd && (!mUpdate || upd > mUpdate)) mUpdate = upd;
      const latestRec = recs.slice().sort((a, b) => String(a.fetchedAt).localeCompare(String(b.fetchedAt))).pop();
      geos[g.key] = {
        cbs: latestRec.cbs, pathId: latestRec.pathId || null, nameId: latestRec.nameId ?? null, level: g.level, name: { he: g.he, en: g.en }, ...(g.note ? { note: g.note } : {}),
        sourceName: latestRec.geoName || null, seriesIds: [...new Set(recs.map((r) => r.seriesId))].sort(), sourceUpdate: upd, freq: metrics.ok ? metrics.freq : null,
        series: { M: lastN(series.M, 'M'), Q: lastN(series.Q, 'Q'), Y: series.Y },
        latest: metrics.ok ? { freq: metrics.freq, period: metrics.latest, value: metrics.latestValue, label: metrics.latestLabel } : null,
        metrics, unit: latestRec.unit || null,
        ...(failed.has(k) ? { stale: true, lastError: errors[k] || null } : {}),
      };
    }
    if (mUpdate && (!maxUpdate || mUpdate > maxUpdate)) maxUpdate = mUpdate;
    const head = { id: mid, what: { he: M.he, en: M.en }, semantics: M.semantics, kind: M.kind, path: M.path, geoLevel: M.geoLevel, verified: M.verified };
    if (!any) {
      const reason = reasonFor(resolution, mid, 'il', errors[`${mid}|il`]);
      measures[mid] = { ...head, state: 'MISSING', reason, geos: {}, reconciliation: null, freshness: null };
      continue;
    }
    const il = geos.il;
    const freq = il && il.freq;
    const liveNat = il && !il.stale && freq ? seriesByGeo(cur, mid, 'il', freq) : null;
    const reconciliation = liveNat ? reconcileMeasure(liveNat, DISTRICT_KEYS.map((d) => seriesByGeo(cur, mid, d, freq)), freq, M.kind) : (prevM && prevM.reconciliation) || null;
    const fresh = il && il.latest ? freshness(il.latest.period, il.latest.freq, now) : (prevM && prevM.freshness) || null;
    measures[mid] = { ...head, state: 'OK', freq: freq || null, sourceUpdate: mUpdate || (prevM && prevM.sourceUpdate) || null, unit: il ? il.unit : null, geos, reconciliation, freshness: fresh };
  }
  /* overall freshness = the least fresh of the measures that have data, each listed */
  const byMeasure = Object.fromEntries(MEASURE_IDS.map((m) => [m, measures[m].freshness ? { state: measures[m].freshness.state, latest: measures[m].freshness.latest, freq: measures[m].freshness.freq, latestQuarter: measures[m].freshness.latestQuarter } : { state: 'MISSING' }]));
  const present = Object.values(byMeasure).filter((f) => f.state !== 'MISSING');
  const overall = present.length ? present.reduce((a, f) => (FRESH_RANK[f.state] > FRESH_RANK[a.state] ? f : a)) : null;
  const worst = overall ? MEASURE_IDS.find((m) => measures[m].freshness && measures[m].freshness.state === overall.state) : null;
  return {
    schema: 1, source: SOURCE, syncedAt: run.at, checkedAt: run.checkedAt || (prev && prev.checkedAt) || null, status: run.status,
    sourceUpdate: maxUpdate || (prev && prev.sourceUpdate) || null,
    freshness: overall ? { ...measures[worst].freshness, byMeasure } : { state: 'MISSING', why: 'no measure has observations', byMeasure, assumption: SOURCE.lagAssumption },
    geos: GEOS.map((g) => ({ key: g.key, level: g.level, he: g.he, en: g.en, codes: Object.fromEntries(MEASURE_IDS.map((m) => [m, MEASURES[m].codes[g.key]])) })),
    measures,
    records: { observations: records.length, current: cur.size, revisions: records.filter((r) => (r.revision || 0) > 0).length },
    missing,
    notes: {
      universes: { he: 'היתרים ≠ התחלות ≠ גמר ≠ בנייה פעילה — ארבעה יקומים, לעולם לא מסוכמים יחד', en: 'permits ≠ starts ≠ completions ≠ active — four universes, never summed together' },
      geography: { he: 'ארצי ולפי מחוז בלבד; נתון מחוז לעולם אינו מוקצה ליישוב', en: 'national and district only; a district figure is never allocated to a locality' },
      stock: { he: 'בנייה פעילה היא מלאי בסוף התקופה — לא מסוכמת על פני תקופות', en: 'active construction is a stock at period end — never summed over periods' },
    },
  };
}

const toJs = (payload) => '/* generated by scripts/construction-sync.js — do not edit by hand */\nwindow.PROPX_CBS_CONSTRUCTION=' + JSON.stringify(payload).replace(/</g, '\\u003c') + ';\n';

module.exports = { buildPayload, toJs, reasonFor, KEEP, GEO_BY_KEY };
