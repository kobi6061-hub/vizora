// PROPX · CBS construction — resolve the geography nodes of every measure from the CBS catalogue, at sync time.
//
// Why: the geography codes differ per branch (level-4 codes 1–8 for starts / completions / active construction, name_id
// 271–277 + 1 for permits) and the level-5 leaf under a district node was not read on the runner. So before any data
// request the sync walks `catalog/path?id=<branch>` (and `catalog/path?id=<branch>,<district>` for the leaf), finds the
// node whose NAME is the district, and VERIFIES that its code is the one lib/construction/series.js expects:
//   resolved    name found once, code = expected, leaf found → requested, keyed by the code
//   mismatch    name found but under another code → NOT requested (the table is wrong or CBS re-coded: a human checks)
//   unresolved  no node / several nodes carry the name, or no single leaf → NOT requested
// Nothing is guessed from a name alone: the name verifies the code, the code keys the data.
//
// Catalogue shape (scripts/cbs-sales-discover.js --list, 13–17.10.2026): { catalogs: { level, catalog: [ { path: [44,2,3,1], name,
// pathDesc } ], paging: { total_items, next_url } } }. Anything else is a schema change — nothing requested for that measure.

'use strict';

const { MEASURES, MEASURE_IDS, GEOS, catalogUrl, pathIdOf } = require('./series');
const { SchemaError } = require('../cbs-sales/parse');

const TOTAL = /^\s*(סך הכל|סה"כ|סה״כ|סך-הכל)\s*$/;
const MAX_PAGES = 10;

/** what kind of failure an error is, in the run-state vocabulary */
function errorKind(e) {
  if (e && e.name === 'SchemaError') return 'schema';
  if (/HTTP (401|403|429)\b/.test(String(e && e.message || ''))) return 'refused';
  return 'failed';
}

/** one catalogue page → its nodes; throws SchemaError on an unrecognized shape */
function catalogNodes(json) {
  const c = json && json.catalogs;
  if (!c || !Array.isArray(c.catalog)) throw new SchemaError('catalogue without catalogs.catalog');
  const nodes = [];
  for (const o of c.catalog) {
    if (!o || typeof o !== 'object') throw new SchemaError('catalogue node is not an object');
    let p = o.path;
    if (typeof p === 'string') p = p.split(',');
    if (!Array.isArray(p) || !p.length) throw new SchemaError('catalogue node without a path');
    const path = p.map((x) => (x === null || x === undefined || x === '' ? null : Number(x)));
    if (path.some((x) => x !== null && !Number.isFinite(x))) throw new SchemaError(`catalogue node path "${p.join(',')}"`);
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    nodes.push({ path, pathId: path.map((x) => (x === null ? '' : x)).join(','), depth: path.length, name, pathDesc: typeof o.pathDesc === 'string' ? o.pathDesc : null });
  }
  return { nodes, next: c.paging && c.paging.next_url ? String(c.paging.next_url) : null, level: c.level ?? null };
}

/** every node the catalogue lists under a path id (all pages); records the responses in `bundle` */
async function listPath(fetchJson, id, bundle) {
  let url = catalogUrl(id), nodes = [], level = null;
  for (let page = 1; page <= MAX_PAGES && url; page++) {
    const { json, text } = await fetchJson(url);
    if (bundle) bundle.push({ url, body: text });
    const c = catalogNodes(json);
    nodes = nodes.concat(c.nodes); level = c.level;
    url = c.next && c.next !== url ? c.next : null;
  }
  return { nodes, level };
}

const codeAt = (n, i) => (n.path[i] === null || n.path[i] === undefined ? null : n.path[i]);

/** the geography nodes of one measure: { ok, path, geos: { key → { status, code, expected, name, pathId, leaf, leafName, reason } } } */
async function resolveMeasure(measure, fetchJson, bundle) {
  const M = MEASURES[measure];
  const depth = M.path.split(',').length;   /* 3 */
  const out = { measure, path: M.path, geoLevel: M.geoLevel, ok: true, geos: {}, nodes: 0 };
  let listed;
  try { listed = await listPath(fetchJson, M.path, bundle); } catch (e) {
    return { ...out, ok: false, error: e.message, errorKind: errorKind(e) };
  }
  const nodes = listed.nodes;
  out.nodes = nodes.length;
  out.listed = nodes.map((n) => ({ path: n.pathId, name: n.name }));
  /* the candidates: level-4 branches → the branch's direct children; name_id branches → the leaf nodes (level 4 empty) */
  const cands = M.geoLevel === 'level4'
    ? nodes.filter((n) => n.depth === depth + 1 && codeAt(n, depth) !== null)
    : nodes.filter((n) => (n.depth === depth + 2 && codeAt(n, depth) === null && codeAt(n, depth + 1) !== null) || (n.depth === depth + 1 && codeAt(n, depth) !== null));
  for (const g of GEOS) {
    const expected = M.codes[g.key];
    const matches = cands.filter((n) => g.match.test(n.name) && (g.key === 'il' || !TOTAL.test(n.name)));
    const base = { key: g.key, expected, status: 'unresolved', code: null, name: null, pathId: null, leaf: null, leafName: null, reason: null };
    if (matches.length !== 1) {
      out.geos[g.key] = { ...base, reason: matches.length ? `ambiguous: ${matches.map((n) => `${n.pathId} "${n.name}"`).join(' · ')}` : `no node named like ${g.en} under ${M.path} (${cands.length} candidates)` };
      continue;
    }
    const n = matches[0];
    const code = M.geoLevel === 'level4' ? codeAt(n, depth) : codeAt(n, n.depth - 1);
    if (code !== expected) { out.geos[g.key] = { ...base, code, name: n.name, status: 'mismatch', reason: `catalogue code ${code} ("${n.name}") differs from the expected ${expected} — not read until the table is verified` }; continue; }
    if (M.geoLevel === 'name_id') { out.geos[g.key] = { ...base, code, name: n.name, status: 'resolved', pathId: pathIdOf(measure, code) }; continue; }
    /* the leaf under the district node: from the same listing when it is deep, else one more request */
    let leaves = nodes.filter((x) => x.depth === depth + 2 && codeAt(x, depth) === code && codeAt(x, depth + 1) !== null);
    if (!leaves.length) {
      try { leaves = (await listPath(fetchJson, n.pathId, bundle)).nodes.filter((x) => x.depth === depth + 2 && codeAt(x, depth) === code && codeAt(x, depth + 1) !== null); } catch (e) {
        out.geos[g.key] = { ...base, code, name: n.name, status: e.name === 'SchemaError' ? 'unresolved' : 'error', reason: `leaf listing ${n.pathId}: ${e.message}`, errorKind: errorKind(e) };
        continue;
      }
    }
    const leaf = leaves.length === 1 ? leaves[0] : leaves.filter((x) => TOTAL.test(x.name)).length === 1 ? leaves.find((x) => TOTAL.test(x.name)) : null;
    if (!leaf) { out.geos[g.key] = { ...base, code, name: n.name, reason: leaves.length ? `several leaves under ${n.pathId}, none is the total: ${leaves.map((x) => `${x.pathId} "${x.name}"`).join(' · ')}` : `no level-5 node under ${n.pathId}` }; continue; }
    const leafCode = codeAt(leaf, depth + 1);
    out.geos[g.key] = { ...base, code, name: n.name, status: 'resolved', leaf: leafCode, leafName: leaf.name, pathId: pathIdOf(measure, code, leafCode) };
  }
  return out;
}

/**
 * @param {object} o   { fetchJson(url) → { json, text }, measures?: string[], bundle?: [] }
 * @returns {{ at, measures: { [id]: resolveMeasure result }, requests: number }}
 */
async function resolveAll({ fetchJson, measures = MEASURE_IDS, bundle = null, now = new Date() }) {
  const out = { at: now.toISOString(), measures: {}, requests: 0 };
  const n0 = bundle ? bundle.length : 0;
  let count = 0;
  const counting = async (url) => { count++; return fetchJson(url); };
  for (const m of measures) out.measures[m] = await resolveMeasure(m, counting, bundle);
  out.requests = bundle ? bundle.length - n0 : count;
  return out;
}

/** the run-log line of a resolution: per measure, how many geographies were resolved / mismatched / unresolved */
function summarize(res) {
  const out = {};
  for (const [m, R] of Object.entries((res && res.measures) || {})) {
    if (!R.ok) { out[m] = { ok: false, error: R.error, kind: R.errorKind }; continue; }
    const st = Object.values(R.geos);
    out[m] = { ok: true, resolved: st.filter((x) => x.status === 'resolved').length, mismatch: st.filter((x) => x.status === 'mismatch').map((x) => `${x.key}: ${x.reason}`),
      unresolved: st.filter((x) => x.status === 'unresolved' || x.status === 'error').map((x) => `${x.key}: ${x.reason}`), paths: Object.fromEntries(st.filter((x) => x.status === 'resolved').map((x) => [x.key, x.pathId])) };
  }
  return out;
}

module.exports = { resolveAll, resolveMeasure, catalogNodes, listPath, summarize, errorKind, TOTAL };
