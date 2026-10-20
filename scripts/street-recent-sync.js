#!/usr/bin/env node
// PROPX · RECENT TRANSACTIONS LAYER — fetch + reconcile (P0, 20.10.2026).
//
// A SEPARATE recent-evidence source beside the primary register copy (lib/streets/evidence.js), never a replacement for it:
// the GovMap deals layer (lay=16 — the deals the government real-estate site shows) as republished by over.org.il, read for
// the recent window only, kept VERBATIM, and reconciled deterministically against the register copy (lib/recent/reconcile.js).
// A deal the register copy already holds stays the register's (its fields never overwritten); only a placed, valid, recent
// deal the register copy does not hold enters the layer, labelled with its own source and copy date.
//
//   node scripts/street-recent-sync.js --fetch [--force]     GitHub runner: the copy's identity (1 request); when it changed (or
//                                                              --force / the window moved), every row of the recent window,
//                                                              newest first, 200 a page with a 50-row OVERLAP (each overlap must
//                                                              agree, the first page is read again at the end and must be
//                                                              identical — else nothing is replaced); raw rows stored verbatim
//                                                              (data/streets/recent/raw/<sha256>.jsonl.gz + raw/index.json)
//   node scripts/street-recent-sync.js --audit-replay         GitHub runner, once: the 8 audited cities' rows exactly as the
//                                                              19.10.2026 comparison read them (per settlement spelling, newest
//                                                              first) down to 28.06.2026 — the input of the 2,293 reconciliation
//   node scripts/street-recent-sync.js --reconcile            offline: raw rows × the stored register copy → data/streets/recent/
//                                                              layer.json · reconciliation.json · meta.json (+ sync-runs.jsonl)
//
// GET only, one request a second, an honest User-Agent; any date filter makes the source answer HTTP 500, so the window is read by
// paging newest first and stopping at the first page that ends before it.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'streets', 'recent');
const RAW = path.join(DIR, 'raw');
const UA = 'PROPX-recent-sync/1.0 (+https://github.com/kobi6061-hub/vizora; read-only)';
const OVER = process.env.GOV_OVER_BASE || 'https://www.over.org.il';
const PAGE = 200, STEP = 150;                 // 50-row overlap between consecutive pages
const CONTEXT_DAYS = 6;                       // rows this many days before the window are read as matching context
const args = process.argv.slice(2);
const has = (k) => args.includes('--' + k);
const argVal = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
let requests = 0;

const pause = () => new Promise((ok) => setTimeout(ok, 1000));
async function get(p) {
  requests++;
  const r = await fetch(OVER + p, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  await pause();
  if (r.status !== 200 || !json) throw new Error(`HTTP ${r.status} from ${p.split('?')[0]}`);
  return json;
}
const rowsOf = (j) => (Array.isArray(j) ? j : j.data || j.results || []);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o) + '\n'); };
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const minusDays = (d, k) => isoDay(Date.parse(d + 'T00:00:00Z') - k * 864e5);
const dayOf = (g) => String(g.deal_date || '').slice(0, 10);

/** newest first with a 50-row overlap; returns the rows (verbatim, API order, unique by objectid) and the completeness proof */
async function pageNewestFirst(query, stopBefore) {
  const seen = new Map(), order = [];
  let offset = 0, pages = 0, overlapChecks = 0, prev = null, first = null;
  for (;;) {
    const rows = rowsOf(await get(`/api/deals/govmap/search?${query}sort=date_desc&limit=${PAGE}&offset=${offset}`));
    pages++;
    if (pages === 1) first = rows.map((g) => g.objectid).join(',');
    if (prev) {
      overlapChecks++;
      const a = prev.slice(STEP).map((g) => g.objectid).join(','), b = rows.slice(0, PAGE - STEP).map((g) => g.objectid).join(',');
      if (a !== b) throw new Error(`paging is not stable: the overlap at offset ${offset} disagrees — nothing replaced`);
    }
    for (const g of rows) if (!seen.has(g.objectid)) { seen.set(g.objectid, g); order.push(g); }
    const last = rows[rows.length - 1];
    if (rows.length < PAGE || !last || dayOf(last) < stopBefore) break;
    if (offset + STEP > 100000 - PAGE) throw new Error('the window does not fit the source\'s offset limit — nothing replaced');
    prev = rows; offset += STEP;
  }
  const again = rowsOf(await get(`/api/deals/govmap/search?${query}sort=date_desc&limit=${PAGE}&offset=0`)).map((g) => g.objectid).join(',');
  if (again !== first) throw new Error('the first page changed while reading — nothing replaced');
  return { rows: order, proof: { pages, overlapChecks, overlapDisagreements: 0, firstPageRepeatIdentical: true, pageSize: PAGE, step: STEP } };
}

function storeRaw(rows, meta) {
  const body = rows.map((g) => JSON.stringify(g)).join('\n') + '\n';
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  fs.mkdirSync(RAW, { recursive: true });
  const file = `${sha.slice(0, 16)}.jsonl.gz`;
  if (!fs.existsSync(path.join(RAW, file))) fs.writeFileSync(path.join(RAW, file), zlib.gzipSync(body, { level: 9 }));
  const idx = readJson(path.join(RAW, 'index.json')) || { schema: 1, snapshots: [] };
  if (!idx.snapshots.some((x) => x.sha256 === sha && x.kind === meta.kind)) idx.snapshots.push({ ...meta, sha256: sha, file, rows: rows.length });
  writeJson(path.join(RAW, 'index.json'), idx);
  return { sha, file };
}

async function copyIdentity() {
  const s = await get('/api/deals/govmap/stats');
  if (!s.loaded_at || !s.dataset_id) throw new Error('the GovMap-layer copy states no load date / dataset — nothing read');
  return { datasetId: s.dataset_id, loadedAt: String(s.loaded_at), version: s.version ?? null, lastDeal: s.last_deal ? String(s.last_deal).slice(0, 10) : null,
    deals: Number(s.deals) || null, sourceUrl: s.source_url || null, table: s.table || null };
}

/* the window: RECENT_LAG_DAYS before the register copy's latest deal (the audit's "reported late" bound) → the GovMap copy's load day */
function windowFor() {
  const W = require('../lib/recent/window');
  const ev = readJson(path.join(ROOT, 'data', 'streets', 'evidence', 'meta.json'));
  if (!ev || !ev.source || !ev.source.lastDeal) throw new Error('no stored register copy — the window cannot be placed');
  return W.windowOf(ev.source.lastDeal);
}

async function fetchMode() {
  const startedAt = new Date().toISOString();
  const run = { id: 'recent-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: 'over:govmap-recent', startedAt, status: 'failed' };
  try {
    const copy = await copyIdentity();
    const win = windowFor();
    const idx = readJson(path.join(RAW, 'index.json'));
    const lastSnap = idx && idx.snapshots.filter((x) => x.kind === 'window').pop();
    if (!has('force') && lastSnap && lastSnap.copy.loadedAt === copy.loadedAt && lastSnap.copy.version === copy.version && lastSnap.window.from <= win.from) {
      Object.assign(run, { status: 'unchanged', copy, finishedAt: new Date().toISOString(), requests });
      fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n');
      console.log(`the GovMap-layer copy is unchanged (${copy.loadedAt}, v${copy.version}) — nothing read`);
      return 0;
    }
    const stopBefore = minusDays(win.from, CONTEXT_DAYS);
    const { rows, proof } = await pageNewestFirst('', stopBefore);
    const { sha, file } = storeRaw(rows, { kind: 'window', copy, window: { ...win, contextFrom: stopBefore }, fetchedAt: new Date().toISOString(), proof });
    Object.assign(run, { status: 'ok', copy, window: win, rows: rows.length, sha256: sha, file, proof, finishedAt: new Date().toISOString(), requests });
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n');
    console.log(`read ${rows.length} rows of the GovMap-layer copy (${copy.loadedAt}, v${copy.version}) back to ${stopBefore} in ${proof.pages} pages — stored ${file}`);
    return 0;
  } catch (e) {
    Object.assign(run, { error: String(e.message).slice(0, 240), finishedAt: new Date().toISOString(), requests });
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n');
    console.error('recent fetch failed:', e.message);
    return 1;
  }
}

/* the 19.10.2026 comparison's input, replayed: per city, per settlement spelling, newest first (the order its matching consumed) */
const AUDIT_CITIES = ['פתח תקווה', 'תל אביב-יפו', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'נתניה', 'אשדוד'];
/* the comparison read from 18.09.2025; a row it read matches only register deals within ONE day of its own date, so rows dated
   before 28.06.2026 (six days before the late cut 04.07.2026) can never take a deal a late row needs — they cannot change a
   late row's class, and the replay stops there */
const AUDIT_DOWN_TO = '2026-06-28';
async function auditReplay() {
  const copy = await copyIdentity();
  const names = rowsOf(await get('/api/deals/govmap/settlements')).map((x) => x.settlement);
  const R = require('../lib/recent/reconcile');
  const out = [];
  const proofs = [];
  for (const city of AUDIT_CITIES) {
    const spell = names.filter((n) => R.normCity(n) === R.normCity(city));
    for (const name of spell) {
      const { rows, proof } = await pageNewestFirst(`settlement=${encodeURIComponent(name)}&`, AUDIT_DOWN_TO);
      rows.forEach((g, i) => out.push({ city, spelling: name, order: i, row: g }));
      proofs.push({ city, spelling: name, rows: rows.length, ...proof });
    }
  }
  const body = out.map((x) => JSON.stringify(x)).join('\n') + '\n';
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const dir = path.join(DIR, 'audit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `replay-v${copy.version}.jsonl.gz`), zlib.gzipSync(body, { level: 9 }));
  writeJson(path.join(dir, `replay-v${copy.version}.meta.json`), { schema: 1, purpose: 'the input of the 19.10.2026 comparison (run 39329664397) for the 8 audited cities, replayed in its order — the basis of the exact 2,293 reconciliation',
    copy, downTo: AUDIT_DOWN_TO, cities: AUDIT_CITIES, fetchedAt: new Date().toISOString(), sha256: sha, rows: out.length, proofs, requests });
  console.log(`audit replay: ${out.length} rows for ${AUDIT_CITIES.length} cities (copy v${copy.version}) — ${requests} requests`);
  return 0;
}

function reconcileMode() {
  const R = require('../lib/recent/reconcile');
  const res = R.build({ root: ROOT });
  console.log(R.summaryLine(res));
  return res.ok ? 0 : 1;
}

if (require.main === module) {
  const go = has('fetch') ? fetchMode : has('audit-replay') ? auditReplay : has('reconcile') ? async () => reconcileMode() : null;
  if (!go) { console.error('usage: --fetch [--force] | --audit-replay | --reconcile'); process.exit(2); }
  go().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { pageNewestFirst, storeRaw };
