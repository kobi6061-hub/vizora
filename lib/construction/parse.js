// PROPX · CBS construction — one API response → observations, or a refusal.
//
// The response shape is the sales lane's (apis.cbs.gov.il/series/data/path, verified 13.10.2026 and again on the 17–18.10.2026
// reads of 44,2,3 / 44,3,3 / 44,4,3 / 44,11,2):
//   { DataSet: { Series: [ { id, time:{value,name}, data:{value,name}, unit:{value,name},
//       path:{ level1:{value:44}, level2:{value}, level3:{value}, level4:{value,name}|null, name_id:{value,name} },
//       update:"2026-09-10", obs:[ {TimePeriod:"2026-06", Value:6273.0}, … ] } ], paging:{…} } }
// One request returns several series for the same path — original / seasonally adjusted / trend, monthly, quarterly and
// annual — and the FIRST may be the seasonally adjusted one (seen for 44,11,2,,1): only data.value = 1 (original) is read.
// A series whose time or data kind is not one PROPX maps (TIME_KIND / DATA_KIND) is SKIPPED and listed with its raw kind
// (seen on the runner 18.10.2026: a third permits series 9538xx beside the monthly 5538xx and the annual 6538xx — its kind is
// printed by the dry-run and is never applied until it is mapped here on purpose).
// The period kind comes from the series itself (time.value 3 month / 4 quarter / 1 year) and is stored with every
// observation; a quarterly observation is dated by its quarter ("2026-06" → "2026-Q2"), never treated as a month.
// Every series is checked against what was asked — branch, geography code, leaf — AND the geography's NAME in the series'
// own path must say it is the district asked (GeoNameError otherwise): the name verifies the code, the code keys the data.
// A period the response does not carry is MISSING, never 0; a published 0 stays 0.

'use strict';

const { MEASURES, DATA_KIND, TIME_KIND, GEO_BY_KEY, nameFits } = require('./series');
const { SchemaError } = require('../cbs-sales/parse');

/** the series names its geography otherwise than the code asked — a mismatch, never applied */
class GeoNameError extends Error { constructor(msg) { super('geography name mismatch: ' + msg); this.name = 'GeoNameError'; } }

const YM = /^(\d{4})-(\d{2})$/, YEAR = /^(\d{4})$/, YQ = /^(\d{4})-Q([1-4])$/;
const num = (x) => typeof x === 'number' && Number.isFinite(x);

/** the stored period of one TimePeriod under a frequency — null when the string is not of that kind */
function periodOf(freq, tp) {
  const s = String(tp == null ? '' : tp).trim();
  if (freq === 'M') { const m = YM.exec(s); return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}` : null; }
  if (freq === 'Y') { const m = YM.exec(s) || YEAR.exec(s); return m ? m[1] : null; }
  if (freq === 'Q') {
    const q = YQ.exec(s); if (q) return `${q[1]}-Q${q[2]}`;
    const m = YM.exec(s); if (!m) return null;
    const mo = +m[2]; return [3, 6, 9, 12].includes(mo) ? `${m[1]}-Q${mo / 3}` : null;   /* CBS dates a quarter by its last month */
  }
  return null;
}
const noLevel4 = (p) => !p.level4 || p.level4.value === null || p.level4.value === undefined || p.level4.value === '' || p.level4.value === 0;
const kindOf = (k) => (k && typeof k === 'object' ? `${k.value} "${k.name || ''}"` : String(k));

/**
 * @param {object} json   the parsed response
 * @param {object} req    { measure, geo, cbs (the geography code), leaf (level-4 branches), pathId, url }
 * @returns {{series: object[], obs: object[], freqs: string[], names: string[]}}
 *   obs: { measure, cbs, geo, pathId, nameId, geoName, kind, freq, period, sourcePeriod, value, seriesId, dataKind, unit, update, url }
 *   names: the geography names the response's series carry (the verification evidence)
 */
function parseResponse(json, req) {
  const M = MEASURES[req.measure];
  if (!M) throw new Error('unknown measure ' + req.measure);
  const g = GEO_BY_KEY[req.geo];
  if (!g) throw new Error('unknown geography ' + req.geo);
  const S = json && json.DataSet && json.DataSet.Series;
  if (!Array.isArray(S)) throw new SchemaError('no DataSet.Series array');
  const series = [], obs = [], names = [];
  for (const s of S) {
    const p = s && s.path;
    if (!p || !p.level1 || !p.level2 || !p.level3 || !p.name_id) throw new SchemaError('series without a path');
    if (p.level1.value !== 44 || p.level2.value !== M.level2 || p.level3.value !== M.level3) throw new SchemaError(`series ${s.id} is not branch ${M.path}`);
    if (M.geoLevel === 'level4') {
      if (noLevel4(p) || p.level4.value !== req.cbs) throw new SchemaError(`series ${s.id} is geography ${p.level4 ? p.level4.value : 'none'}, asked ${req.cbs}`);
      if (req.leaf != null && p.name_id.value !== req.leaf) throw new SchemaError(`series ${s.id} is leaf ${p.name_id.value}, asked ${req.leaf}`);
    } else {
      if (!noLevel4(p)) throw new SchemaError(`series ${s.id} carries a level 4 (${p.level4.value}); ${M.path} has none`);
      if (p.name_id.value !== req.cbs) throw new SchemaError(`series ${s.id} is geography ${p.name_id.value}, asked ${req.cbs}`);
    }
    /* the name must say it is the geography asked — the code alone never suffices */
    const geoName = (M.geoLevel === 'level4' ? p.level4.name : p.name_id.name) || null;
    if (!geoName) throw new GeoNameError(`series ${s.id} carries no geography name for code ${req.cbs} (${g.en})`);
    if (!nameFits(g, geoName)) throw new GeoNameError(`series ${s.id} is named "${geoName}", not ${g.en} (${g.he}) — code ${req.cbs} on ${M.path} does not carry the expected geography`);
    if (!names.includes(geoName)) names.push(geoName);
    const freq = TIME_KIND[s.time && s.time.value], kind = DATA_KIND[s.data && s.data.value];
    if (!freq || !kind) { series.push({ id: s.id, skipped: `time ${kindOf(s.time)} / data ${kindOf(s.data)}`, time: s.time || null, data: s.data || null, n: Array.isArray(s.obs) ? s.obs.length : null }); continue; }
    if (!Array.isArray(s.obs)) throw new SchemaError(`series ${s.id} without obs`);
    const update = typeof s.update === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.update) ? s.update.slice(0, 10) : null;
    const unit = (s.unit && s.unit.name) || null;
    series.push({ id: s.id, freq, kind, unit, update, n: s.obs.length, name: geoName });
    if (s.data.value !== M.dataKind) continue;   /* only the original data — never the seasonally adjusted or trend series */
    for (const o of s.obs) {
      const tp = o && o.TimePeriod;
      const period = periodOf(freq, tp);
      if (!period) throw new SchemaError(`series ${s.id} ${freq} period "${tp}"`);
      if (o.Value === null || o.Value === undefined || o.Value === '') continue;   /* not published = missing, never 0 */
      const v = Number(o.Value);
      if (!num(v) || v < 0) throw new SchemaError(`series ${s.id} ${tp} value "${o.Value}"`);
      obs.push({ measure: req.measure, cbs: req.cbs, geo: g.key, pathId: req.pathId, nameId: p.name_id.value, geoName, kind: M.kind, freq, period, sourcePeriod: String(tp),
        value: v, seriesId: s.id, dataKind: kind, unit, update, url: req.url });
    }
  }
  /* a window before the series starts answers with no series at all — no data, not an error */
  if (S.length && !series.some((s) => !s.skipped && s.kind === DATA_KIND[M.dataKind])) throw new SchemaError(`no ${DATA_KIND[M.dataKind]} series for ${req.pathId}`);
  return { series, obs, freqs: [...new Set(obs.map((o) => o.freq))].sort(), names };
}

module.exports = { parseResponse, periodOf, SchemaError, GeoNameError };
