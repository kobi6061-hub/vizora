// PROPX · What Changed Here? — the stored evidence the change feed reads, memoised per file stamp (21.10.2026).
//
// Every path is a literal `path.join(__dirname, …)` so the deployment's file tracing bundles it. Nothing here fetches; a file that
// is absent reads as null / [] and the feed states the gap (never a default).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FILES = Object.freeze({
  evMeta: path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'meta.json'),
  evRuns: path.join(__dirname, '..', '..', 'data', 'streets', 'evidence', 'sync-runs.jsonl'),
  recentMeta: path.join(__dirname, '..', '..', 'data', 'streets', 'recent', 'meta.json'),
  recentRuns: path.join(__dirname, '..', '..', 'data', 'streets', 'recent', 'sync-runs.jsonl'),
  natMeta: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'meta.json'),
  natRuns: path.join(__dirname, '..', '..', 'data', 'txevents', 'national', 'runs.jsonl'),
  txLatest: path.join(__dirname, '..', '..', 'data', 'txevents', 'latest.json'),
  txFresh: path.join(__dirname, '..', '..', 'data', 'transactions', 'freshness.json'),
  tenders: path.join(__dirname, '..', '..', 'data', 'land', 'tenders.json'),
  landMeta: path.join(__dirname, '..', '..', 'data', 'land', 'meta.json'),
  landRuns: path.join(__dirname, '..', '..', 'data', 'land', 'sync-runs.jsonl'),
  radar: path.join(__dirname, '..', '..', 'data', 'radar', 'events.json'),
  radarMeta: path.join(__dirname, '..', '..', 'data', 'radar', 'meta.json'),
  complexes: path.join(__dirname, '..', '..', 'data', 'renewal', 'complexes.json'),
  renewalMeta: path.join(__dirname, '..', '..', 'data', 'renewal', 'meta.json'),
  renewalRuns: path.join(__dirname, '..', '..', 'data', 'renewal', 'sync-runs.jsonl'),
  renewalPlanRuns: path.join(__dirname, '..', '..', 'data', 'renewal', 'planning-runs.jsonl'),
  planMeta: path.join(__dirname, '..', '..', 'data', 'planning', 'national', 'meta.json'),
  planTiles: path.join(__dirname, '..', '..', 'data', 'planning', 'national', 'tiles'),
  planLarge: path.join(__dirname, '..', '..', 'data', 'planning', 'national', 'large.json.gz'),
  vatmalMeta: path.join(__dirname, '..', '..', 'data', 'planning', 'vatmal', 'meta.json'),
  vatmalRuns: path.join(__dirname, '..', '..', 'data', 'planning', 'vatmal', 'runs.jsonl'),
  lotteries: path.join(__dirname, '..', '..', 'data', 'housing', 'lotteries.json'),
  housingMeta: path.join(__dirname, '..', '..', 'data', 'housing', 'meta.json'),
  housingRuns: path.join(__dirname, '..', '..', 'data', 'housing', 'sync-runs.jsonl'),
  dira: path.join(__dirname, '..', '..', 'data', 'rental', 'dira-tenders.json'),
  rentalRuns: path.join(__dirname, '..', '..', 'data', 'rental', 'runs.jsonl'),
  cObs: path.join(__dirname, '..', '..', 'data', 'construction', 'observations.jsonl'),
  cRuns: path.join(__dirname, '..', '..', 'data', 'construction', 'sync-runs.jsonl'),
  sObs: path.join(__dirname, '..', '..', 'data', 'cbs-sales', 'observations.jsonl'),
  sLatest: path.join(__dirname, '..', '..', 'data', 'cbs-sales', 'latest.json'),
  sRuns: path.join(__dirname, '..', '..', 'data', 'cbs-sales', 'runs.jsonl'),
  tlv: path.join(__dirname, '..', '..', 'data', 'dd', 'tlv.json'),
  ddHist: path.join(__dirname, '..', '..', 'data', 'dd', 'history.jsonl'),
  ddLatest: path.join(__dirname, '..', '..', 'data', 'dd', 'latest.json'),
  ddRuns: path.join(__dirname, '..', '..', 'data', 'dd', 'sync-runs.jsonl'),
  localities: path.join(__dirname, '..', '..', 'data', 'geo', 'localities.json'),
});

const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readGz = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { return null; } };
const readLines = (f) => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } const out = []; for (const l of t.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* a torn line */ } } return out; };
const arrOf = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? (x.records || x.tenders || x.complexes || x.lotteries || Object.values(x).find(Array.isArray) || []) : []);

/* one memo per key, invalidated when any of its files changes */
const MEMO = new Map();
function memo(key, files, fn) {
  const st = files.map(mtime).join('|');
  const c = MEMO.get(key);
  if (c && c.st === st) return c.v;
  const v = fn();
  MEMO.set(key, { st, v });
  return v;
}
/** the stamp of every file the feed reads — a changed file invalidates every cached feed */
const STAMP_FILES = Object.values(FILES).filter((f) => f !== FILES.planTiles);
const stamp = () => STAMP_FILES.map(mtime).join('|');

/** the first / last run of a run log (when PROPX first and last read a source) */
function runSpan(file, pick = (r) => r.startedAt || r.at || null) {
  const rs = readLines(file); const ds = rs.map(pick).filter(Boolean).sort();
  return { first: ds[0] || null, last: ds[ds.length - 1] || null, runs: rs.length };
}

/* a day on which a dataset gained more than 2 % of its records (at least 50) is a PROPX ingestion day, not a market day: a record
   first seen on such a day is the BASELINE (the radar's own rule, lib/radar/events.js bulkDays) */
function bulkDays(records, key = 'firstSeenAt') {
  const byDay = new Map(); for (const r of records) { const d = r && r[key] ? String(r[key]).slice(0, 10) : null; if (d) byDay.set(d, (byDay.get(d) || 0) + 1); }
  const lim = Math.max(50, records.length * 0.02); const out = new Set();
  for (const [d, n] of byDay) if (n > lim) out.add(d);
  return out;
}

/* ── the stores ── */
const tenders = () => memo('tenders', [FILES.tenders], () => {
  const all = arrOf(readJson(FILES.tenders));
  const byLoc = new Map(), byId = new Map();
  for (const t of all) { byId.set(t.id, t); const k = Number(t.localityCode); if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(t); }
  return { all, byLoc, byId, bulk: bulkDays(all) };
});
const radar = () => memo('radar', [FILES.radar], () => {
  const doc = readJson(FILES.radar) || { events: [] };
  const byEntity = new Map();
  for (const e of doc.events || []) { const k = e.entity && e.entity.id; if (!k) continue; if (!byEntity.has(k)) byEntity.set(k, []); byEntity.get(k).push(e); }
  return { doc, events: doc.events || [], byEntity, since: doc.since || null, builtAt: doc.builtAt || null };
});
const complexes = () => memo('complexes', [FILES.complexes], () => {
  const all = arrOf(readJson(FILES.complexes));
  const byLoc = new Map(), byId = new Map(), byPlan = new Map();
  for (const c of all) {
    byId.set(c.id, c); const k = Number(c.localityCode); if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(c);
    if (c.planKey) { const pk = String(c.planKey).replace(/\s+/g, ''); if (!byPlan.has(pk)) byPlan.set(pk, []); byPlan.get(pk).push(c); }
  }
  return { all, byLoc, byId, byPlan, bulk: bulkDays(all) };
});
const lotteries = () => memo('lotteries', [FILES.lotteries], () => {
  const all = arrOf(readJson(FILES.lotteries));
  const byLoc = new Map(); let newest = null;
  for (const l of all) { const k = Number(l.localityCode); if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(l); const d = l.lotteryDate ? String(l.lotteryDate).slice(0, 10) : null; if (d && (!newest || d > newest)) newest = d; }
  return { all, byLoc, bulk: bulkDays(all), newest };
});
const dira = () => memo('dira', [FILES.dira], () => {
  const doc = readJson(FILES.dira); const all = arrOf(doc).filter((n) => !n.kind || n.kind === 'developer-tender');
  return { all, bulk: bulkDays(arrOf(doc)), fetchedAt: doc && doc.fetchedAt || null };
});
const ledger = (file, key) => memo(key, [file], () => readLines(file));
const cbsSales = () => ledger(FILES.sObs, 'sObs');
const cbsConstruction = () => ledger(FILES.cObs, 'cObs');
const ddHistory = () => memo('ddHist', [FILES.ddHist], () => {
  let isRetracted = () => false; try { isRetracted = require('../dd/retractions').isRetracted; } catch { /* optional */ }
  return readLines(FILES.ddHist).filter((e) => e && e.lane === 'tlv' && !isRetracted(e));
});

/* the national plan layer — every plan's dates, locality field and boundary centroid (the boundaries themselves stay in the tiles,
   read by lib/streets/report.js for a street's spatial relation). Decoded once per stamp. */
const plans = () => memo('plans', [FILES.planMeta, FILES.planLarge, FILES.localities], () => {
  const byOid = new Map();
  let files = []; try { files = fs.readdirSync(FILES.planTiles).filter((f) => f.endsWith('.json.gz')); } catch { files = []; }
  for (const f of files) { const t = readGz(path.join(FILES.planTiles, f)); for (const p of (t && t.plans) || []) if (!byOid.has(p.oid)) byOid.set(p.oid, slimPlan(p)); }
  const large = readGz(FILES.planLarge); for (const p of (large && large.plans) || []) if (!byOid.has(p.oid)) byOid.set(p.oid, slimPlan(p));
  const N = names();
  const byLoc = new Map(); let resolved = 0, unresolved = 0;
  for (const p of byOid.values()) {
    const code = p.locality ? N.unique(p.locality) : null;
    p.localityCode = code; if (code != null) { resolved++; if (!byLoc.has(code)) byLoc.set(code, []); byLoc.get(code).push(p); } else unresolved++;
  }
  return { meta: readJson(FILES.planMeta), all: [...byOid.values()], byLoc, resolved, unresolved };
});
const slimPlan = (p) => ({ oid: p.oid, mpId: p.mpId, planNumber: p.planNumber, name: p.name, stage: p.stage, station: p.station, event: p.event, kind: p.kind, topic: p.topic,
  locality: p.locality || null, district: p.district || null, dates: p.dates || {}, lastUpdate: p.lastUpdate || null, url: p.url || null, planUnitDelta: p.planUnitDelta != null ? p.planUnitDelta : null });

/* official locality names → a code, only when exactly one locality carries the name: the exact normalized name, else the same
   letters with quotes / geresh / hyphens / spaces dropped and a doubled vav / yod single (the reconciliation's own rule,
   lib/txevents localityByName) — never a similarity match */
const names = () => memo('names', [FILES.localities], () => {
  const doc = readJson(FILES.localities) || { localities: [] };
  let normHe = (s) => String(s || '').trim(); try { normHe = require('../geo/registry').normHe; } catch { /* plain trim */ }
  const compact = (x) => String(x || '').replace(/["'״׳\s\-–]/g, '').replace(/וו/g, 'ו').replace(/יי/g, 'י');
  const exact = new Map(), loose = new Map();
  const add = (m, k, code) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(code); };
  /* only official codes: a provisional entry (code: null) would key as 0 and pool every such name into one phantom "locality 0" */
  for (const l of doc.localities || []) { if (l.code == null || l.code === '' || !Number.isFinite(Number(l.code))) continue; for (const n of [l.he, ...(l.aliases || [])]) { add(exact, normHe(n), Number(l.code)); add(loose, compact(n), Number(l.code)); } }
  const unique = (name) => { const a = exact.get(normHe(name)); if (a && a.size === 1) return [...a][0]; if (a && a.size > 1) return null; const b = loose.get(compact(name)); return b && b.size === 1 ? [...b][0] : null; };
  return { unique };
});

module.exports = { FILES, mtime, readJson, readGz, readLines, arrOf, memo, stamp, runSpan, bulkDays, tenders, radar, complexes, lotteries, dira, cbsSales, cbsConstruction, ddHistory, plans, names };
