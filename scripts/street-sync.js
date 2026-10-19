#!/usr/bin/env node
// PROPX · STREET DIRECTORY — scheduled sync of the official Israel street registry and its synonyms.
//
//   data.gov.il (Population and Immigration Authority; CKAN datastore, every row, paged — a short read fails the run)
//     streets  9ad3862c-… (סמל_ישוב · שם_ישוב · סמל_רחוב · שם_רחוב)
//     synonyms bf185c7f-… (region · city · street code · name · "official" | "synonym of <code>" · official_code)
//   → schema guard → content hash → raw snapshot when the content changed (data/geo/streets/raw/<date>-<hash>.json.gz)
//   → normalize (kind from the official code: street / area / site / locality — lib/streets/directory.js)
//   → merge with the stored directory: NOTHING is deleted — a code that leaves the registry stays as status 'historical'
//     with retiredAt; a name change of the same code is RENAMED (old name kept in the history); identity is the code
//   → history.jsonl (append-only: ADDED · RENAMED · RETIRED · RESTORED) · directory.json · synonyms.json · meta · run log
//   First run only: the legacy mirror index (data/geo/streets-index.json, 2026-08-31) is reconciled — every id PROPX
//   served before maps to its official id (legacy-ids.json), a legacy coded street missing from the registry is kept
//   as 'historical' (source: legacy mirror), never re-coded silently.
//
//   node scripts/street-sync.js                  live (GitHub runner)
//   node scripts/street-sync.js --dry-run        fetch + normalize + report, write nothing
//   --summary-file <path>                        append a one-line summary (commit message)
//   --allow-shrink                               accept an answer under 90 % of the stored current rows
//   --rebuild-index                              offline: rebuild search-index.json from the committed directory
//   --reconcile-legacy                           offline: rebuild legacy-ids.json from the committed directory
//   After every write the search index (lib/streets/search-index.js) is rebuilt from the files just written.
// Exit: 0 ok · 1 failed (only the run log written).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const SD = require('../lib/streets/directory');
const SI = require('../lib/streets/search-index');
const { SOURCES, kindOf, normName, streetId } = SD;

const DIR = process.env.STREETS_DIR || path.join(__dirname, '..', 'data', 'geo', 'streets');
const LEGACY = path.join(__dirname, '..', 'data', 'geo', 'streets-index.json');
const CKAN = 'https://data.gov.il/api/3/action/';
const UA = 'PROPX-street-sync/1.0 (+https://github.com/kobi6061-hub/vizora)';
const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const today = () => new Date().toISOString().slice(0, 10);
const int = (v) => { const n = Number(String(v ?? '').trim()); return Number.isInteger(n) && n > 0 ? n : null; };
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function ck(action, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(CKAN + action + '?' + new URLSearchParams(params), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      const j = await r.json();
      if (!j || !j.success) throw new Error(`${action} HTTP ${r.status}`);
      return j.result;
    } catch (e) { if (attempt >= 4) throw e; await new Promise((ok) => setTimeout(ok, attempt * 4000)); }
  }
}
async function readAll(id, required) {
  const meta = await ck('resource_show', { id });
  const rows = []; let total = null;
  while (total == null || rows.length < total) {
    const r = await ck('datastore_search', { resource_id: id, limit: 32000, offset: rows.length });
    total = r.total;
    if (!r.records.length) break;
    rows.push(...r.records);
  }
  if (rows.length !== total) throw new Error(`${id}: read ${rows.length} of ${total} rows — incomplete, not applied`);
  const cols = new Set(Object.keys(rows[0] || {}));
  const lost = required.filter((c) => !cols.has(c));
  if (lost.length) throw new Error(`${id}: schema changed — missing column(s) ${lost.join(', ')}`);
  return { rows, total, lastModified: meta.last_modified || null, name: meta.name };
}
/** the official locality names of the fresh read: normName → code (a name shared by two codes maps to none) */
function cityNames(fresh) {
  const m = new Map();
  for (const f of fresh.values()) { const k = normName(f.cityName); if (m.has(k) && m.get(k) !== f.cityCode) m.set(k, null); else m.set(k, f.cityCode); }
  return m;
}
/**
 * The legacy mirror index (2026-08-31: May-2026 names + 2021 codes joined by name) → the official ids. A legacy coded id
 * keeps resolving; one the registry no longer lists is ADDED to `out` as 'historical' (origin legacy-mirror). A
 * provisional id (stp:) maps to the official id of the same locality (by code, or by its official name when the legacy
 * row had no code) and the same normalized street name — exactly one candidate, else null with the reason counted.
 */
function reconcileLegacy(out, namesToCode, L, synonyms = []) {
  const byName = new Map();                           // cityCode|normName → [ids]
  for (const [id, r] of out) { if (r.origin === 'legacy-mirror') continue; const k = r.cityCode + '|' + normName(r.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(id); }
  /* an official synonym names the same street: used only when no official name matches */
  const bySyn = new Map();
  for (const [cityCode, , name, off] of synonyms) { const k = cityCode + '|' + normName(name), id = streetId(cityCode, off); if (!out.has(id)) continue; if (!bySyn.has(k)) bySyn.set(k, new Set()); bySyn.get(k).add(id); }
  const map = {}; const stats = { legacyRows: L.streets.length, coded: 0, codedCurrent: 0, codedHistorical: 0, provisional: 0, provisionalResolved: 0, provisionalAmbiguous: 0,
    provisionalUnmatched: 0, noCityCode: 0, cityResolvedByName: 0 };
  const unmatchedSample = [], nameDiffers = [];
  for (const [cityCode, code, name, city] of L.streets) {
    if (cityCode && code) {
      stats.coded++;
      const id = streetId(cityCode, code);
      if (out.has(id) && out.get(id).origin !== 'legacy-mirror') {
        stats.codedCurrent++;
        /* the code is the identity: a legacy name that differs from the official name (and from its synonyms) is recorded —
           a rename by the registry or a code the registry reused; PROPX cannot tell which, so the id resolves to the
           official row and the difference is listed, never hidden */
        const off = out.get(id), k = cityCode + '|' + normName(name);
        if (normName(off.name) !== normName(name) && !(bySyn.get(k) || new Set()).has(id)) {
          stats.codedNameDiffers = (stats.codedNameDiffers || 0) + 1;
          if (nameDiffers.length < 400) nameDiffers.push([id, name, off.name]);
        }
        continue;
      }
      /* a code PROPX served from the 2021 coded mirror that the current registry no longer lists: kept, historical */
      if (!out.has(id)) out.set(id, { cityCode, code, name, kind: kindOf(code), status: 'historical', firstSeen: null, retiredAt: null, origin: 'legacy-mirror' });
      stats.codedHistorical++;
      continue;
    }
    stats.provisional++;
    const legacyId = `stp:${cityCode || normName(city).replace(/\s/g, '_')}:${normName(name).replace(/\s/g, '_')}`;
    let cc = cityCode;
    if (!cc) { stats.noCityCode++; cc = namesToCode.get(normName(city)) || null; if (cc) stats.cityResolvedByName++; }
    let cand = cc ? byName.get(cc + '|' + normName(name)) || [] : [];
    if (!cand.length && cc && bySyn.has(cc + '|' + normName(name))) { cand = [...bySyn.get(cc + '|' + normName(name))]; if (cand.length === 1) stats.provisionalViaSynonym = (stats.provisionalViaSynonym || 0) + 1; }
    if (cand.length === 1) { map[legacyId] = cand[0]; stats.provisionalResolved++; }
    else if (cand.length > 1) { map[legacyId] = null; stats.provisionalAmbiguous++; }
    else { map[legacyId] = null; stats.provisionalUnmatched++; if (unmatchedSample.length < 60) unmatchedSample.push(`${city} | ${name}`); }
  }
  return { builtAt: L.meta && L.meta.builtAt, reconciledAt: new Date().toISOString(), stats, unmatchedSample, nameDiffers, map };
}

const hashOf = (arr) => crypto.createHash('sha256').update(JSON.stringify(arr)).digest('hex');
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
const appendRun = (run) => { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n'); };
/** the search index from the directory files as they are on disk now */
function rebuildIndex() {
  SD.reset();
  const ix = SI.build(SD.load({ dir: DIR }));
  SI.write(DIR, ix);
  return ix.counts;
}

(async () => {
  if (has('rebuild-index')) { console.log('search index', JSON.stringify(rebuildIndex())); return; }
  if (has('reconcile-legacy')) {
    /* offline: rebuild legacy-ids.json from the committed directory + the legacy index (no network) */
    const d = readJson('directory.json'); const c = Object.fromEntries(d.columns.map((x, i) => [x, i]));
    const out = new Map(d.rows.map((r) => [streetId(r[c.cityCode], r[c.streetCode]), { cityCode: r[c.cityCode], code: r[c.streetCode], name: r[c.name], kind: r[c.kind], status: r[c.status], origin: r[c.origin] }]));
    const fresh = new Map(); const locName = new Map(d.localities.map((l) => [l[0], l[1]]));
    for (const [id, r] of out) if (r.status === 'current') fresh.set(id, { cityCode: r.cityCode, cityName: locName.get(r.cityCode) });
    const legacy = reconcileLegacy(out, cityNames(fresh), JSON.parse(fs.readFileSync(LEGACY, 'utf8')), readJson('synonyms.json').rows);
    fs.writeFileSync(path.join(DIR, 'legacy-ids.json'), JSON.stringify(legacy) + '\n');
    console.log(JSON.stringify(legacy.stats), legacy.unmatchedSample.slice(0, 30));
    return;
  }
  const startedAt = new Date().toISOString();
  const run = { id: 'streets-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: 'datagov:streets', startedAt, status: 'failed', retrievalMethod: 'live-api' };
  try {
    const S = await readAll(SOURCES.streets.id, ['סמל_ישוב', 'שם_ישוב', 'סמל_רחוב', 'שם_רחוב']);
    const Y = await readAll(SOURCES.synonyms.id, ['region_code', 'region_name', 'city_code', 'city_name', 'street_code', 'street_name', 'street_name_status', 'official_code']);
    const fetchedAt = new Date().toISOString();

    /* ── normalize the official street rows ── */
    const rejected = [];
    const fresh = new Map();                          // id → {cityCode, code, name, cityName}
    for (const r of S.rows) {
      const cityCode = int(r['סמל_ישוב']), code = int(r['סמל_רחוב']), name = clean(r['שם_רחוב']), cityName = clean(r['שם_ישוב']);
      if (!cityCode || !code || !name) { rejected.push({ _id: r._id, why: 'missing code or name' }); continue; }
      const id = streetId(cityCode, code);
      if (fresh.has(id)) { rejected.push({ _id: r._id, why: 'duplicate locality × street code ' + id }); continue; }
      fresh.set(id, { cityCode, code, name, cityName });
    }
    /* ── synonyms (and the registry's own copy of the official rows, for reconciliation) ── */
    const region = new Map();                         // cityCode → [regionCode, regionName]
    const syn = [], officialInSyn = new Set(); let synRejected = 0;
    for (const r of Y.rows) {
      const cityCode = int(r.city_code), code = int(r.street_code), off = int(r.official_code), name = clean(r.street_name), status = clean(r.street_name_status);
      if (!cityCode || !code || !off || !name) { synRejected++; continue; }
      if (!region.has(cityCode)) region.set(cityCode, [int(r.region_code), clean(r.region_name)]);
      if (status === 'official') { officialInSyn.add(streetId(cityCode, code)); continue; }
      const m = /^synonym of (\d+)$/.exec(status);
      if (!m || int(m[1]) !== off) { synRejected++; continue; }
      syn.push([cityCode, code, name, off]);
    }
    /* a synonym whose official code is not a row of the street resource (the two resources update on different days) is
       kept and counted — it still resolves once the street appears; it is never attached to another street */
    const synTargetMissing = syn.filter((y) => !fresh.has(streetId(y[0], y[3]))).length;
    const reconcile = { officialRowsInSynonyms: officialInSyn.size,
      inStreetsNotInSynonyms: [...fresh.keys()].filter((k) => !officialInSyn.has(k)).length,
      inSynonymsNotInStreets: [...officialInSyn].filter((k) => !fresh.has(k)).length, synTargetMissing };

    /* ── merge with the stored directory (never delete; renames are history) ── */
    const prev = readJson('directory.json');
    const prevRows = new Map();
    if (prev) { const c = Object.fromEntries(prev.columns.map((x, i) => [x, i])); for (const r of prev.rows) prevRows.set(streetId(r[c.cityCode], r[c.streetCode]), { cityCode: r[c.cityCode], code: r[c.streetCode], name: r[c.name], kind: r[c.kind], status: r[c.status], firstSeen: r[c.firstSeen], retiredAt: r[c.retiredAt], origin: r[c.origin] }); }
    const day = today(), events = [];
    const out = new Map();
    for (const [id, f] of fresh) {
      const p = prevRows.get(id);
      const row = { cityCode: f.cityCode, code: f.code, name: f.name, kind: kindOf(f.code), status: 'current', firstSeen: p ? p.firstSeen : day, retiredAt: null, origin: 'registry' };
      if (!p && prev) events.push({ at: fetchedAt, event: 'ADDED', id, name: f.name });
      if (p && p.name !== f.name) events.push({ at: fetchedAt, event: 'RENAMED', id, from: p.name, to: f.name });
      if (p && p.status === 'historical') events.push({ at: fetchedAt, event: 'RESTORED', id, name: f.name });
      out.set(id, row);
    }
    for (const [id, p] of prevRows) {
      if (out.has(id)) continue;
      const retiredAt = p.status === 'historical' ? p.retiredAt : day;
      if (p.status !== 'historical') events.push({ at: fetchedAt, event: 'RETIRED', id, name: p.name });
      out.set(id, { ...p, status: 'historical', retiredAt });
    }

    /* ── first run: reconcile the legacy mirror index PROPX served before (ids keep resolving; nothing re-coded silently) ── */
    const legacy = !prev && fs.existsSync(LEGACY) ? reconcileLegacy(out, cityNames(fresh), JSON.parse(fs.readFileSync(LEGACY, 'utf8')), syn) : null;

    /* ── localities: the registry's own names + the synonyms registry's region (district) ── */
    const locs = new Map();
    for (const f of fresh.values()) if (!locs.has(f.cityCode)) locs.set(f.cityCode, f.cityName);
    const prevLocs = new Map(((prev && prev.localities) || []).map((l) => [l[0], l]));
    const localities = [...new Set([...locs.keys(), ...prevLocs.keys()])].sort((a, b) => a - b).map((c) => {
      const he = locs.get(c) || (prevLocs.get(c) || [])[1] || null; const rg = region.get(c) || [(prevLocs.get(c) || [])[2] || null, (prevLocs.get(c) || [])[3] || null];
      return [c, he, rg[0], rg[1]];
    });

    const rows = [...out.values()].sort((a, b) => a.cityCode - b.cityCode || a.code - b.code)
      .map((r) => [r.cityCode, r.code, r.name, r.kind, r.status, r.firstSeen, r.retiredAt, r.origin]);
    const synRows = syn.sort((a, b) => a[0] - b[0] || a[3] - b[3] || a[1] - b[1]);
    const contentHash = hashOf([[...fresh.values()].map((f) => [f.cityCode, f.code, f.name]), synRows]);
    const byKind = {}; for (const r of out.values()) if (r.status === 'current') byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const counts = { officialRows: S.total, current: [...out.values()].filter((r) => r.status === 'current').length, historical: [...out.values()].filter((r) => r.status === 'historical').length,
      byKind, localities: locs.size, synonymRows: Y.total, synonyms: syn.length, rejected: rejected.length, synRejected };
    const meta = { schema: 1, sources: { streets: { ...SOURCES.streets, lastModified: S.lastModified, rows: S.total }, synonyms: { ...SOURCES.synonyms, lastModified: Y.lastModified, rows: Y.total } },
      fetchedAt, checkedAt: fetchedAt, contentHash, counts, reconcile, kindRule: 'street 100–5999 & 9001–9999 · area 6000–6999 · site 7000–8999 · locality placeholder 9000' };
    const prevMeta = readJson('meta.json');
    const contentChanged = !prevMeta || prevMeta.contentHash !== contentHash;
    const prevCurrent = prev ? [...prevRows.values()].filter((r) => r.status === 'current').length : 0;
    if (prevCurrent && counts.current < prevCurrent * 0.9 && !has('allow-shrink')) throw new Error(`the registry answered ${counts.current} current rows, under 90 % of the ${prevCurrent} stored — not applied`);

    Object.assign(run, { status: contentChanged ? 'ok' : 'unchanged', fetchedAt, streetsLastModified: S.lastModified, synonymsLastModified: Y.lastModified, contentHash, contentChanged,
      counts, reconcile, events: events.length, eventTypes: events.reduce((a, e) => ((a[e.event] = (a[e.event] || 0) + 1), a), {}), legacy: legacy && legacy.stats });
    const summary = `Street directory: ${counts.current.toLocaleString('en')} official rows (${Object.entries(byKind).map(([k, v]) => `${k} ${v.toLocaleString('en')}`).join(' · ')}) · ${counts.historical} historical · ${syn.length.toLocaleString('en')} synonyms · ${events.length} history events · registry updated ${String(S.lastModified || '').slice(0, 10)}`;
    console.log(JSON.stringify({ ...run, rejectedSample: rejected.slice(0, 10), legacyUnmatchedSample: legacy && legacy.unmatchedSample.slice(0, 20) }, null, 1));
    if (has('dry-run')) { console.log('DRY RUN — nothing written.\n' + summary); return; }

    fs.mkdirSync(path.join(DIR, 'raw'), { recursive: true });
    /* raw snapshots, one per resource, written only when THAT resource's content changed. The synonyms resource repeats every
       official row of the streets resource (status "official"); those rows are reconciled in meta.reconcile and the raw keeps
       every other row verbatim */
    const sRaw = S.rows.map((r) => [r._id, r['סמל_ישוב'], r['שם_ישוב'], r['סמל_רחוב'], r['שם_רחוב']]);
    const yRaw = Y.rows.filter((r) => clean(r.street_name_status) !== 'official').map((r) => [r._id, r.region_code, r.region_name, r.city_code, r.city_name, r.street_code, r.street_name, r.street_name_status, r.official_code]);
    const sHash = hashOf(sRaw), yHash = hashOf(yRaw);
    if (!prevMeta || prevMeta.rawStreetsHash !== sHash) fs.writeFileSync(path.join(DIR, 'raw', `${day}-streets-${sHash.slice(0, 12)}.json.gz`), zlib.gzipSync(JSON.stringify({ fetchedAt, id: SOURCES.streets.id, lastModified: S.lastModified, columns: ['_id', 'סמל_ישוב', 'שם_ישוב', 'סמל_רחוב', 'שם_רחוב'], rows: sRaw }), { level: 9 }));
    if (!prevMeta || prevMeta.rawSynonymsHash !== yHash) fs.writeFileSync(path.join(DIR, 'raw', `${day}-synonyms-${yHash.slice(0, 12)}.json.gz`), zlib.gzipSync(JSON.stringify({ fetchedAt, id: SOURCES.synonyms.id, lastModified: Y.lastModified, note: 'rows with street_name_status "official" omitted — they repeat the streets resource (meta.reconcile)', columns: ['_id', 'region_code', 'region_name', 'city_code', 'city_name', 'street_code', 'street_name', 'street_name_status', 'official_code'], rows: yRaw }), { level: 9 }));
    meta.rawStreetsHash = sHash; meta.rawSynonymsHash = yHash;
    fs.writeFileSync(path.join(DIR, 'directory.json'), JSON.stringify({ meta, localities, columns: ['cityCode', 'streetCode', 'name', 'kind', 'status', 'firstSeen', 'retiredAt', 'origin'], rows }));
    fs.writeFileSync(path.join(DIR, 'synonyms.json'), JSON.stringify({ meta: { source: SOURCES.synonyms, lastModified: Y.lastModified, fetchedAt, rows: syn.length, targetMissing: synTargetMissing },
      columns: ['cityCode', 'code', 'name', 'officialCode'], rows: synRows }));
    fs.writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
    if (legacy) fs.writeFileSync(path.join(DIR, 'legacy-ids.json'), JSON.stringify(legacy) + '\n');
    if (events.length) fs.appendFileSync(path.join(DIR, 'history.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    run.searchIndex = rebuildIndex();
    appendRun(run);
    const sf = argVal('summary-file'); if (sf) fs.appendFileSync(sf, summary + '\n');
    console.log(summary);
  } catch (e) {
    run.error = e.message; run.finishedAt = new Date().toISOString();
    console.error('street sync failed:', e.message);
    if (!has('dry-run')) appendRun(run);
    process.exitCode = 1;
  }
})();
