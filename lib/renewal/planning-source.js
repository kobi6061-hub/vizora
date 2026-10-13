// PROPX · Urban renewal × XPlan — the reads (GitHub runner only; ags.iplan.gov.il is not reachable from the sandbox).
//
//   1. every plan number the live complexes print, exactly (pl_number IN …), each also in the layer's own spacing
//      ("תמל/2022" is written "תמל/ 2022" in the layer) — a returned plan is kept only when its number equals an asked
//      number after whitespace removal;
//   2. every Mavat main-plan id in MoCH's links (mp_id IN …);
//   3. the boundary of every plan found (WGS84, generalized ~5 m).
// A batch that fails is recorded and its keys stay "not checked" — never "not found". Three failures in a row stop the read.

'use strict';

const { LAYER, FIELDS, planKey, mavatIdOf, normalizePlan, outlineOf } = require('./planning');

const UA = 'PROPX-renewal-planning/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const BASE = process.env.IPLAN_RENEWAL_LAYER || LAYER;

/* POST (the layer's /query accepts it): a batch of Hebrew plan numbers URL-encoded in a GET overran the server's URL limit (HTTP 404, 13.10.2026) */
async function query(fetchImpl, params, timeoutMs) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ f: 'pjson', returnGeometry: 'false', ...params })) body.set(k, String(v));
  const r = await fetchImpl(BASE + '/query', { method: 'POST', body: body.toString(), signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
  const text = await r.text(); let j;
  try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status}, not JSON`); }
  if (j.error) throw new Error(`HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`);
  if (!Array.isArray(j.features)) throw new Error(`HTTP ${r.status}, unrecognized shape (no features)`);
  if (j.exceededTransferLimit) throw new Error('exceededTransferLimit — batch too large, not applied');
  return j.features;
}
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** the plan number as asked + the layer's own spacing after every slash — equal after whitespace removal, nothing else */
const variants = (n) => [...new Set([n, n.replace(/\/\s*/g, '/ ')])];

async function fetchPlanning(complexes, { fetchImpl = globalThis.fetch, batch = 40, timeoutMs = 90000, deadline = Infinity, fetchedAt = new Date().toISOString() } = {}) {
  const live = complexes.filter((c) => c.inLatestSource !== false);
  const numbers = [...new Set(live.map((c) => c.planNumber).filter(Boolean))];
  const ids = [...new Set(live.map(mavatIdOf).filter((x) => x != null))];
  const plans = new Map(), askedKeys = new Set(), askedIds = new Set(), errors = [];
  let requests = 0, failedBatches = 0, streak = 0;
  const keep = (attrs) => { const p = normalizePlan(attrs, { fetchedAt }); if (p && !plans.has(p.id)) plans.set(p.id, p); return p; };
  const stop = () => streak >= 3 || Date.now() > deadline;

  for (let i = 0; i < numbers.length && !stop(); i += batch) {
    const slice = numbers.slice(i, i + batch), keys = new Set(slice.map(planKey));
    requests++;
    try {
      const feats = await query(fetchImpl, { where: 'pl_number IN (' + slice.flatMap(variants).map(sq).join(',') + ')', outFields: FIELDS.join(',') }, timeoutMs);
      for (const f of feats) if (keys.has(planKey(f.attributes && f.attributes.pl_number))) keep(f.attributes);
      for (const k of keys) askedKeys.add(k); streak = 0;
    } catch (e) { failedBatches++; streak++; errors.push('plan numbers: ' + e.message); }
  }
  for (let i = 0; i < ids.length && !stop(); i += batch) {
    const slice = ids.slice(i, i + batch);
    requests++;
    try {
      const feats = await query(fetchImpl, { where: 'mp_id IN (' + slice.join(',') + ')', outFields: FIELDS.join(',') }, timeoutMs);
      for (const f of feats) keep(f.attributes);
      for (const id of slice) askedIds.add(id); streak = 0;
    } catch (e) { failedBatches++; streak++; errors.push('Mavat ids: ' + e.message); }
  }
  const geometry = {}; let geometryFailed = 0;
  const mpIds = [...new Set([...plans.values()].map((p) => p.mpId))];
  for (let i = 0; i < mpIds.length && !stop(); i += batch) {
    const slice = mpIds.slice(i, i + batch);
    requests++;
    try {
      const feats = await query(fetchImpl, { where: 'mp_id IN (' + slice.join(',') + ')', outFields: 'mp_id', returnGeometry: 'true', outSR: 4326, maxAllowableOffset: 0.00005, geometryPrecision: 5 }, timeoutMs);
      for (const f of feats) { const id = Number(f.attributes && f.attributes.mp_id), o = outlineOf(f.geometry); if (o && Number.isFinite(id) && !geometry[id]) geometry[id] = o; }
      streak = 0;
    } catch (e) { geometryFailed++; streak++; errors.push('geometry: ' + e.message); }
  }
  const complete = askedKeys.size >= new Set(numbers.map(planKey)).size && askedIds.size >= ids.length;
  return { plans: [...plans.values()], geometry, askedKeys: [...askedKeys], askedIds: [...askedIds], numbers: numbers.length, ids: ids.length,
    requests, failedBatches, geometryFailed, complete, errors: errors.slice(0, 5), endpoint: BASE };
}

module.exports = { fetchPlanning, variants, BASE };
