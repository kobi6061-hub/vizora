// PROPX · CBS new-home sales — one API response → observations, or a refusal.
//
// The response shape (apis.cbs.gov.il/series/data/path, verified 13.10.2026):
//   { DataSet: { Series: [ { id, time:{value,name}, data:{value,name}, unit:{value,name},
//       path:{ level1:{value:44}, level2:{value:10}, level3:{value}, level4:{value}|null, name_id:{value,name} },
//       precis, update:"2026-09-02", obs:[ {TimePeriod:"2026-07", Value:485.0}, … ] } ], paging:{…} } }
// One request returns several series for the same path: original / seasonally adjusted / trend monthly, and the
// annual original. Every series is checked against what was asked (branch, geography) — a mismatch is a schema
// change, never a guess. A month the response does not carry is MISSING, never 0; a published 0 stays 0.

'use strict';

const { MEASURES, DATA_KIND, TIME_KIND, GEO_BY_CBS } = require('./series');

class SchemaError extends Error { constructor(msg) { super('unrecognized shape: ' + msg); this.name = 'SchemaError'; } }

const PERIOD = /^(\d{4})-(\d{2})$/;
const num = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * @param {object} json      the parsed response
 * @param {object} req       { measure, cbs, url }
 * @returns {{series: object[], obs: object[]}}  obs: { measure, cbs, geo, freq, period, value, seriesId, dataKind, unit, update, url }
 */
function parseResponse(json, req) {
  const M = MEASURES[req.measure];
  if (!M) throw new Error('unknown measure ' + req.measure);
  const geo = GEO_BY_CBS[req.cbs];
  if (!geo) throw new Error('unknown CBS geography ' + req.cbs);
  const S = json && json.DataSet && json.DataSet.Series;
  if (!Array.isArray(S)) throw new SchemaError('no DataSet.Series array');
  const series = [], obs = [];
  for (const s of S) {
    const p = s && s.path;
    if (!p || !p.level1 || !p.level2 || !p.level3 || !p.name_id) throw new SchemaError('series without a path');
    if (p.level1.value !== 44 || p.level2.value !== 10 || p.level3.value !== M.level3) throw new SchemaError(`series ${s.id} is not branch 44,10,${M.level3}`);
    if (M.level4 != null && (!p.level4 || p.level4.value !== M.level4)) throw new SchemaError(`series ${s.id} is not ${M.path}`);
    if (p.name_id.value !== req.cbs) throw new SchemaError(`series ${s.id} is geography ${p.name_id.value}, asked ${req.cbs}`);
    const freq = TIME_KIND[s.time && s.time.value], kind = DATA_KIND[s.data && s.data.value];
    if (!freq || !kind) { series.push({ id: s.id, skipped: `time ${s.time && s.time.value} / data ${s.data && s.data.value}` }); continue; }
    if (!Array.isArray(s.obs)) throw new SchemaError(`series ${s.id} without obs`);
    const update = typeof s.update === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.update) ? s.update.slice(0, 10) : null;
    series.push({ id: s.id, freq, kind, unit: s.unit && s.unit.name || null, update, n: s.obs.length, name: p.name_id.name || null });
    /* only the kind this measure is read in: original data (sales, inventory) / CBS's own months-of-supply measure */
    if (s.data.value !== M.dataKind) continue;
    for (const o of s.obs) {
      const m = PERIOD.exec(o && o.TimePeriod || '');
      if (!m) throw new SchemaError(`series ${s.id} period "${o && o.TimePeriod}"`);
      if (o.Value === null || o.Value === undefined || o.Value === '') continue;   /* not published = missing, never 0 */
      const v = Number(o.Value);
      if (!num(v) || v < 0) throw new SchemaError(`series ${s.id} ${o.TimePeriod} value "${o.Value}"`);
      /* an annual observation is dated by its year (CBS writes "2025-01") */
      const period = freq === 'Y' ? m[1] : `${m[1]}-${m[2]}`;
      obs.push({ measure: req.measure, cbs: req.cbs, geo: geo.key, freq, period, value: v, seriesId: s.id, dataKind: kind, unit: s.unit && s.unit.name || null, update, url: req.url });
    }
  }
  /* a window before the series starts answers with no series at all — no data, not an error */
  if (S.length && !series.some((s) => !s.skipped && s.kind === DATA_KIND[M.dataKind])) throw new SchemaError(`no ${DATA_KIND[M.dataKind]} series for ${M.path} ${req.cbs}`);
  return { series, obs };
}

module.exports = { parseResponse, SchemaError };
