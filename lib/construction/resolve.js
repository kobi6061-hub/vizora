// PROPX · CBS construction — resolve the geography nodes of every measure from the CBS catalogue, at sync time.
//
// Why: the geography codes differ per branch (level-4 codes 1–8 for starts / completions / active construction, name_id
// 271–277 + 1 for permits), and a code is never used unverified: a NAME must say it is the district. The name verifies
// the code, the code keys the data — a name alone never keys anything.
//
// What the real catalogue answers (first dry-run on the runner, 18.10.2026, workflow run 39080649194):
//   catalog/path?id=44,11,2   8 leaves `44,11,2,,<code>` NAMED: 1 "סך כולל" · 271 ירושלים · 272 הצפון · 273 חיפה · 274 המרכז ·
//                             275 תל אביב · 276 הדרום · 277 "אזור יהודה והשומרון (עד 2005 כולל חבל עזה)"
//   catalog/path?id=44,2,3    16 leaves and NO district names: `44,2,3,<k>,2` "סך הכל" + `44,2,3,<k>,4141` "------" (a separator)
//   catalog/path?id=44,3,3    the same 16 leaves;   catalog/path?id=44,4,3   8 leaves `44,4,3,<k>,2` "סך הכל"
// So for the by-district branches the district NAME comes from (a) the subject's level-4 listing
// (`catalog/level?id=4&subject=44`, the listing the discovery's "1 ירושלים … 8 סך הכל" came from) — status `resolved`,
// nameSource 'catalogue' — or, when that listing is unavailable or lacks the node, (b) the data response's own
// `path.level4.name`, which lib/construction/parse.js checks on every series — status `pending` until a response names it,
// then `resolved` (nameSource 'response') or `mismatch`. In every case the data response's name is checked too.
//   resolved    name found, code = expected, leaf found → requested, keyed by the code
//   pending     the leaf is listed, the catalogue did not name the district → requested, applied only once a response names it
//   mismatch    the name sits under another code, or the response names the code otherwise → NOT applied (a human checks series.js)
//   unresolved  no leaf for the code / several leaves and none is the total / the name is ambiguous or absent (permits) → not requested
//
// Catalogue shape: { catalogs: { level, catalog: [ { path: [44,2,3,1,2] | "44,11,2,,271", name, pathDesc } ], paging: { total_items,
// next_url } } }. Anything else is a schema change — nothing requested for that measure.

'use strict';

const { MEASURES, MEASURE_IDS, GEOS, TOTAL, SEPARATOR, nameFits, catalogUrl, levelUrl, pathIdOf } = require('./series');
const { SchemaError } = require('../cbs-sales/parse');

const MAX_PAGES = 10;
const SUBJECT = 44, DISTRICT_LEVEL = 4;

/** what kind of failure an error is, in the run-state vocabulary */
function errorKind(e) {
  if (e && e.name === 'GeoNameError') return 'geo-name';
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

/** every node a paged listing returns (all pages, ≤ MAX_PAGES); records the responses in `bundle` */
async function listAll(fetchJson, firstUrl, bundle) {
  let url = firstUrl, nodes = [], pages = 0;
  while (url && pages < MAX_PAGES) {
    const { json, text } = await fetchJson(url);
    pages++;
    if (bundle) bundle.push({ url, body: text });
    const c = catalogNodes(json);
    nodes = nodes.concat(c.nodes);
    url = c.next && c.next !== url ? c.next : null;
  }
  return { nodes, pages };
}
const listPath = (fetchJson, id, bundle) => listAll(fetchJson, catalogUrl(id), bundle);
const listLevel = (fetchJson, level, subject, bundle) => listAll(fetchJson, levelUrl(level, subject, 1), bundle);

const codeAt = (n, i) => (n.path[i] === null || n.path[i] === undefined ? null : n.path[i]);
const isSeparator = (n) => !n.name || SEPARATOR.test(n.name);

/** the names of every level-4 node of subject 44 (pathId → name) — the catalogue's only naming of a by-district node */
async function level4Names(fetchJson, bundle) {
  try {
    const { nodes, pages } = await listLevel(fetchJson, DISTRICT_LEVEL, SUBJECT, bundle);
    return { ok: true, pages, count: nodes.length, names: Object.fromEntries(nodes.filter((n) => n.depth === DISTRICT_LEVEL && !isSeparator(n)).map((n) => [n.pathId, n.name])) };
  } catch (e) { return { ok: false, error: e.message, errorKind: errorKind(e), pages: 0, count: 0, names: {} }; }
}

/** the geography nodes of one measure: { ok, path, geos: { key → { status, code, expected, name, nameSource, pathId, leaf, leafName, reason } } } */
async function resolveMeasure(measure, fetchJson, bundle, l4 = { ok: false, names: {} }) {
  const M = MEASURES[measure];
  const depth = M.path.split(',').length;   /* 3 */
  const out = { measure, path: M.path, geoLevel: M.geoLevel, ok: true, geos: {}, nodes: 0, separators: 0, listed: [] };
  let listed;
  try { listed = await listPath(fetchJson, M.path, bundle); } catch (e) {
    return { ...out, ok: false, error: e.message, errorKind: errorKind(e) };
  }
  const nodes = listed.nodes;
  out.nodes = nodes.length;
  out.listed = nodes.map((n) => ({ path: n.pathId, name: n.name, ...(n.pathDesc ? { pathDesc: n.pathDesc } : {}) }));
  const real = nodes.filter((n) => !isSeparator(n));
  out.separators = nodes.length - real.length;
  if (M.geoLevel === 'name_id') {
    /* permits: the listing names its leaves `44,11,2,,<code>` — the name finds the node, the code is verified against the table */
    const cands = real.filter((n) => (n.depth === depth + 2 && codeAt(n, depth) === null && codeAt(n, depth + 1) !== null) || (n.depth === depth + 1 && codeAt(n, depth) !== null));
    for (const g of GEOS) {
      const expected = M.codes[g.key];
      const base = { key: g.key, expected, status: 'unresolved', code: null, name: null, nameSource: null, pathId: null, leaf: null, leafName: null, reason: null };
      const matches = cands.filter((n) => nameFits(g, n.name));
      if (matches.length !== 1) { out.geos[g.key] = { ...base, reason: matches.length ? `ambiguous: ${matches.map((n) => `${n.pathId} "${n.name}"`).join(' · ')}` : `no node named like ${g.en} under ${M.path} (${cands.length} candidates: ${cands.map((n) => `"${n.name}"`).join(' · ')})` }; continue; }
      const n = matches[0], code = codeAt(n, n.depth - 1);
      if (code !== expected) { out.geos[g.key] = { ...base, code, name: n.name, status: 'mismatch', reason: `catalogue code ${code} ("${n.name}") differs from the expected ${expected} — not read until the table is verified` }; continue; }
      out.geos[g.key] = { ...base, code, name: n.name, nameSource: 'catalogue', status: 'resolved', pathId: pathIdOf(measure, code) };
    }
    return out;
  }
  /* by-district branches: the listing holds the level-5 leaves `<branch>,<k>,<leaf>` (+ "----" separators) and no district name */
  const leaves = real.filter((n) => n.depth === depth + 2 && codeAt(n, depth) !== null && codeAt(n, depth + 1) !== null);
  for (const g of GEOS) {
    const code = M.codes[g.key];
    const base = { key: g.key, expected: code, status: 'unresolved', code: null, name: null, nameSource: null, pathId: null, leaf: null, leafName: null, reason: null };
    const mine = leaves.filter((n) => codeAt(n, depth) === code);
    const leaf = mine.length === 1 ? mine[0] : mine.filter((n) => TOTAL.test(n.name)).length === 1 ? mine.find((n) => TOTAL.test(n.name)) : null;
    if (!leaf) { out.geos[g.key] = { ...base, reason: mine.length ? `several leaves under ${M.path},${code}, none is the total: ${mine.map((n) => `${n.pathId} "${n.name}"`).join(' · ')}` : `no leaf ${M.path},${code},* in the listing (${leaves.length} leaves)` }; continue; }
    const leafCode = codeAt(leaf, depth + 1);
    const node = { ...base, code, leaf: leafCode, leafName: leaf.name, pathId: pathIdOf(measure, code, leafCode) };
    const l4Name = l4.names[`${M.path},${code}`];
    if (l4Name !== undefined) {
      if (nameFits(g, l4Name)) { out.geos[g.key] = { ...node, status: 'resolved', name: l4Name, nameSource: 'catalogue' }; continue; }
      const other = Object.entries(l4.names).find(([pid, nm]) => pid.startsWith(M.path + ',') && nameFits(g, nm));
      out.geos[g.key] = { ...node, status: 'mismatch', name: l4Name, nameSource: 'catalogue', reason: `level-4 node ${M.path},${code} is named "${l4Name}", not ${g.en}${other ? `; "${other[1]}" is ${other[0]}` : ''} — not read until the table is verified` };
      continue;
    }
    out.geos[g.key] = { ...node, status: 'pending', reason: l4.ok ? `no level-4 node ${M.path},${code} in the level listing (${l4.count} nodes) — the data response must name it` : `level-4 listing failed (${l4.error}) — the data response must name it` };
  }
  return out;
}

/**
 * @param {object} o   { fetchJson(url) → { json, text }, measures?: string[], bundle?: [] }
 * @returns {{ at, level4: { ok, pages, count, error? }, measures: { [id]: resolveMeasure result }, requests: number }}
 */
async function resolveAll({ fetchJson, measures = MEASURE_IDS, bundle = null, now = new Date() }) {
  const out = { at: now.toISOString(), level4: null, measures: {}, requests: 0 };
  let count = 0;
  const counting = async (url) => { count++; return fetchJson(url); };
  const l4 = measures.some((m) => MEASURES[m].geoLevel === 'level4') ? await level4Names(counting, bundle) : { ok: false, names: {}, pages: 0, count: 0, skipped: true };
  out.level4 = { ok: l4.ok, pages: l4.pages, count: l4.count, ...(l4.error ? { error: l4.error, errorKind: l4.errorKind } : {}) };
  for (const m of measures) out.measures[m] = await resolveMeasure(m, counting, bundle, l4);
  out.requests = count;
  return out;
}

/**
 * After the data requests: a `pending` geography a response named becomes `resolved` (nameSource 'response'); a geography a
 * response named otherwise (GeoNameError) becomes `mismatch` — and stays so whatever another window answered.
 * @param {object}   resolution   from resolveAll (mutated)
 * @param {object[]} results      the data requests: { measure, geo, ok, parsed: { names }, error, kind }
 */
function finalize(resolution, results) {
  for (const r of results) {
    const R = resolution.measures[r.measure]; const x = R && R.geos && R.geos[r.geo];
    if (!x) continue;
    if (!r.ok) { if (r.kind === 'geo-name') { x.status = 'mismatch'; x.reason = r.error; x.nameSource = 'response'; } continue; }
    if (x.status === 'pending' && r.parsed && r.parsed.names && r.parsed.names.length) { x.status = 'resolved'; x.name = r.parsed.names[0]; x.nameSource = 'response'; x.reason = null; }
  }
  for (const R of Object.values(resolution.measures)) for (const x of Object.values(R.geos || {})) if (x.status === 'pending') x.reason = `the source never named this geography (no series answered for ${x.pathId}) — nothing applied`;
  return resolution;
}

/** the run-log line of a resolution: per measure, how many geographies were resolved / pending / mismatched / unresolved */
function summarize(res) {
  const out = { level4: res && res.level4 ? res.level4 : null };
  for (const [m, R] of Object.entries((res && res.measures) || {})) {
    if (!R.ok) { out[m] = { ok: false, error: R.error, kind: R.errorKind }; continue; }
    const st = Object.values(R.geos);
    out[m] = { ok: true, resolved: st.filter((x) => x.status === 'resolved').length, byCatalogue: st.filter((x) => x.status === 'resolved' && x.nameSource === 'catalogue').length,
      byResponse: st.filter((x) => x.status === 'resolved' && x.nameSource === 'response').length, pending: st.filter((x) => x.status === 'pending').map((x) => x.key),
      mismatch: st.filter((x) => x.status === 'mismatch').map((x) => `${x.key}: ${x.reason}`), unresolved: st.filter((x) => x.status === 'unresolved').map((x) => `${x.key}: ${x.reason}`),
      separators: R.separators, paths: Object.fromEntries(st.filter((x) => x.status === 'resolved').map((x) => [x.key, x.pathId])) };
  }
  return out;
}

module.exports = { resolveAll, resolveMeasure, finalize, catalogNodes, listPath, listLevel, level4Names, summarize, errorKind, isSeparator, TOTAL };
