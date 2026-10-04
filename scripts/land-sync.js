#!/usr/bin/env node
// PROPX · Land & Tender — scheduled sync of the Israel Land Authority tenders.
//
//   the whole tender list (SearchApi/Search, ~10k rows, one answer)
//     → schema guard → content hash → raw list snapshot when it changed
//     → detail fetch on a budget (lots, bids, winners, parcels, plan numbers):
//       forced ids → list rows whose status changed or are new → active
//       tenders not re-read for 7 days → decided in the last year, not re-read
//       for 30 days → never-read tenders (newest first) → the rest, oldest
//       read first. Every tender is re-read over time; provenance.detail says when.
//     → map fetch (polygon centroid) on a budget for tenders with detail and no position
//     → normalize (lib/land/normalize.js), carrying the stored detail forward
//       for tenders not re-read this run
//     → exact joins: xplan plans by plan number, RMI planning inventory (STALE,
//       state land only) by plan number, MoCH construction progress by block/parcel
//     → upsert-merge (never delete, firstSeenAt kept, history events)
//     → meta + run log → data/land/ (and the PROPX Supabase project when configured)
//
//   node scripts/land-sync.js                    live (GitHub runner; land.gov.il is reachable there)
//     --dry-run                                  fetch + normalize + report, write nothing
//     --detail-budget N (1500) --map-budget N (400) --max-minutes M (40) --joins-minutes M (15) --xplan-requests N (150)
//     --ids 20260158,20250516                    read these tenders' detail first
//     --no-joins                                 skip xplan / inventory / construction
//     --summary-file <path>                      append a one-line summary (commit message)
//     --from <list.json[.gz]>                    replay a saved list payload (only outside data/land, or --dry-run)
// Exit: 0 ok · 2 written, Supabase write failed · 1 failed (only the run log written).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { RmiClient } = require('../lib/land/rmi');
const { byId } = require('../lib/land/sources');
const { normalizeList, hashRows, planKey, NORMALIZER_VERSION, SOURCE_ID, LIST_ENDPOINT } = require('../lib/land/normalize');
const { mergeRecords, FileLandStore, SupabaseLandStore } = require('../lib/land/store');
const P = require('../lib/land/planning');
const { storeConfig, redact } = require('../lib/store-config');
const { coverageOf } = require('../lib/land/coverage');

const SOURCE = byId['rmi:michrazim'];
const PROD_DIR = path.join(__dirname, '..', 'data', 'land');
const DIR = process.env.LAND_DATA_DIR || PROD_DIR;
const IS_PROD = path.resolve(DIR) === path.resolve(PROD_DIR);
const argVal = (f, d = null) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes('--' + f);
const REQUIRED_COLUMNS = ['MichrazID', 'MichrazName', 'KodMerchav', 'StatusMichraz', 'KodYeudMichraz', 'KodYeshuv', 'KodSugMichraz', 'YechidotDiur', 'PirsumDate', 'SgiraDate'];
const DAY = 86400000;
const ageDays = (iso, now) => (iso ? (now - new Date(iso).getTime()) / DAY : Infinity);

/** which tenders' detail to read this run, in priority order (ids) */
function planDetails(rows, prevById, { forced = [], now = Date.now() }) {
  const tiers = { forced: [], changed: [], active: [], decided: [], unread: [], rolling: [] };
  const want = new Set(forced.map((x) => `rmi:${x}`));
  for (const row of rows) {
    const id = `rmi:${row.MichrazID}`, prev = prevById.get(id);
    const det = prev && prev.provenance && prev.provenance.detail;
    const err = prev && prev.provenance && prev.provenance.detailError;
    const age = ageDays(det && det.fetchedAt, now);
    const status = Number(row.StatusMichraz);
    if (want.has(id)) tiers.forced.push(id);
    else if (!prev || prev.statusCode !== status) tiers.changed.push(id);
    else if (!det && err && err.status === 404 && ageDays(err.at, now) < 60) tiers.rolling.push([id, err.at]);   // the site answered 404: lowest priority (behind every read tender) for 60 days
    else if (!det) tiers.unread.push(id);
    else if ((status === 1 || status === 2) && age > 7) tiers.active.push(id);
    else if (status === 5 && row.VaadaDate && ageDays(row.VaadaDate, now) < 365 && age > 30) tiers.decided.push(id);
    else tiers.rolling.push([id, det.fetchedAt]);
  }
  tiers.unread.sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  tiers.rolling.sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const order = [...tiers.forced, ...tiers.changed, ...tiers.active, ...tiers.decided, ...tiers.unread, ...tiers.rolling.map((x) => x[0])];
  return { order: [...new Set(order)], tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.length])) };
}

function readReplay(file) {
  const buf = fs.readFileSync(file);
  const j = JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8'));
  return Array.isArray(j) ? j : j.rows;
}

(async () => {
  const dry = has('dry-run');
  if (argVal('from') && IS_PROD && !dry) {
    /* into data/land only an official raw list snapshot a live run wrote (name = date + content hash, recorded in sync-runs.jsonl) may be replayed —
       to restate the stored records under a new normalizer; no fixture can reach the production directory */
    const abs = path.resolve(argVal('from')), m = /^\d{4}-\d{2}-\d{2}-([0-9a-f]{12})\.json\.gz$/.exec(path.basename(abs));
    const runs = new FileLandStore(PROD_DIR).readRuns();
    const ok = abs.startsWith(path.resolve(PROD_DIR, 'raw') + path.sep) && m && hashRows(readReplay(abs)).startsWith(m[1]) && runs.some((r) => r.rawSnapshot === path.basename(abs) && r.retrievalMethod === 'live-api');
    if (!ok) { console.error('refused: into data/land --from replays only an official raw list snapshot from data/land/raw/ recorded by a live run'); process.exitCode = 1; return; }
  }
  const startedAt = new Date().toISOString(), t0 = Date.now();
  const store = new FileLandStore(DIR);
  const run = { id: 'land-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: SOURCE_ID, startedAt, status: 'failed' };
  const budget = { detail: Number(argVal('detail-budget', 1500)), map: Number(argVal('map-budget', 400)), minutes: Number(argVal('max-minutes', 40)) };
  const forced = String(argVal('ids', '')).split(',').map((s) => s.trim()).filter(Boolean);
  const client = new RmiClient({ delayMs: Number(process.env.RMI_DELAY_MS || 150) });
  let code = 0, summary = '';
  const outOfTime = () => (Date.now() - t0) / 60000 > budget.minutes;
  try {
    /* 1 · the list */
    /* the site's full list answers only tenders past their active stage; the active list (published / open) is a second call — merged on MichrazID */
    let rows;
    if (argVal('from')) rows = readReplay(argVal('from'));
    else {
      const full = await client.search(), active = await client.search({ activeOnly: true });
      if (!active.length && !full.some((r) => Number(r.StatusMichraz) === 1 || Number(r.StatusMichraz) === 2)) throw new Error('the active list answered no rows — not applied (every active tender would be marked delisted)');
      const byId = new Map(full.map((r) => [r.MichrazID, r]));
      for (const r of active) byId.set(r.MichrazID, r);
      rows = [...byId.values()];
      run.listCalls = { full: full.length, active: active.length, merged: rows.length };
    }
    const fetchedAt = new Date().toISOString();
    if (!rows.length) throw new Error('the list answered no rows');
    const cols = new Set(rows.flatMap((r) => Object.keys(r)));
    const lost = REQUIRED_COLUMNS.filter((c) => !cols.has(c));
    if (lost.length) throw new Error('schema changed — missing column(s): ' + lost.join(', '));
    const prevMeta = store.readMeta(), prev = store.readRecords(), prevById = new Map(prev.map((r) => [r.id, r]));
    const listed = prev.filter((r) => r.inLatestSource !== false).length;
    if (listed && rows.length < listed * 0.5 && !has('allow-shrink')) throw new Error(`the list answered ${rows.length} rows, under half of the ${listed} listed last time — not applied`);
    const hash = hashRows(rows), listChanged = !prevMeta || prevMeta.snapshotHash !== hash;
    Object.assign(run, { endpoint: LIST_ENDPOINT, retrievalMethod: argVal('from') ? 'replay' : 'live-api', fetched: rows.length, snapshotHash: hash, listChanged, budget });

    /* 2 · details on a budget */
    const plan = planDetails(rows, prevById, { forced });
    const details = new Map(), maps = new Map(), rawDetails = [], errors = [], detailErrors = new Map();
    let detailStopped = null;
    for (const id of plan.order) {
      if (details.size >= budget.detail) { detailStopped = 'budget'; break; }
      if (outOfTime()) { detailStopped = 'time'; break; }
      const mid = id.slice(4);
      try { const d = await client.detail(mid); if (d && d.MichrazID) { details.set(id, d); rawDetails.push(d); } else errors.push({ id, error: 'empty detail' }); }
      catch (e) { errors.push({ id, error: e.message }); if (e.status) detailErrors.set(id, { status: e.status, at: new Date().toISOString() }); if (e.status === 403 || e.status === 429) { detailStopped = 'refused:' + e.status; break; } }
    }
    const detailFetchedAt = new Date().toISOString();
    /* 3 · maps for tenders that have a detail and no position yet (new detail first, then stored ones, newest first) */
    const needMap = [...details.keys()].filter((id) => !(prevById.get(id) && prevById.get(id).geometry))
      .concat(prev.filter((r) => r.lotsCount != null && !r.geometry && !details.has(r.id) && !(r.provenance.map && ageDays(r.provenance.map.fetchedAt) < 90)).sort((a, b) => b.michrazId - a.michrazId).map((r) => r.id));
    let mapStopped = null;
    for (const id of needMap) {
      if (maps.size >= budget.map) { mapStopped = 'budget'; break; }
      if (outOfTime()) { mapStopped = 'time'; break; }
      try { const m = await client.map(id.slice(4)); maps.set(id, m || {}); }
      catch (e) { errors.push({ id, error: 'map: ' + e.message }); if (e.status === 403 || e.status === 429) { mapStopped = 'refused:' + e.status; break; } }
    }
    Object.assign(run, { detailPlan: plan.tiers, detailsFetched: details.size, detailStopped, mapsFetched: maps.size, mapStopped, requests: client.requests,
      errors: errors.length, errorSample: errors.slice(0, 5) });
    if (plan.order.length && details.size === 0 && !argVal('from')) throw new Error('no tender detail could be read: ' + (errors[0] ? errors[0].error : 'unknown'));

    /* 4 · normalize (stored detail carried forward where none was read this run) */
    const ctx = { snapshotHash: hash, fetchedAt, retrievalMethod: run.retrievalMethod, detailFetchedAt, mapFetchedAt: detailFetchedAt };
    const { records: freshRaw, rejected } = normalizeList(rows, ctx, { details, maps, prior: prevById, detailErrors });
    Object.assign(run, { rejected: rejected.length, rejectedSample: rejected.slice(0, 5) });
    if (!freshRaw.length) throw new Error('no row passed normalization');

    /* 5 · exact joins */
    const plans = store.readPlans(); const joins = {};
    const xplanByKey = new Map((plans.xplan || []).map((p) => [p.planKey, p]));
    const invByKey = new Map((plans.inventory || []).map((p) => [p.planKey, p]));
    let plansChanged = false, progressByParcel = null, reference = null;
    const joinsT0 = Date.now(), joinsMinutes = Number(argVal('joins-minutes', 15));
    if (!has('no-joins')) {
      const lotKeys = [...new Set(freshRaw.flatMap((r) => (r.plans || []).filter((p) => p.via === 'lot').map((p) => planKey(p.plan))))];
      const misses = new Map((plans.xplanMisses || []).map((m) => [m.planKey, m.askedAt]));
      const ask = lotKeys.filter((k) => { const x = xplanByKey.get(k); if (x) return ageDays(x.provenance.fetchedAt) > 30; const m = misses.get(k); return !m || ageDays(m) > 90; });
      try {
        const got = await P.fetchXplanPlans(ask, { maxRequests: Number(argVal('xplan-requests', 150)), deadline: joinsT0 + joinsMinutes * 60000 });
        for (const [k, p] of got.found) { xplanByKey.set(k, p); misses.delete(k); plansChanged = true; }
        for (const k of got.askedKeys) if (!got.found.has(k)) { misses.set(k, detailFetchedAt); plansChanged = true; }
        joins.xplan = { asked: ask.length, requests: got.requests, found: got.found.size, complete: got.complete, known: xplanByKey.size, errors: got.errors };
        plans.xplanMisses = [...misses].map(([planKey, askedAt]) => ({ planKey, askedAt }));
      } catch (e) { joins.xplan = { error: e.message }; }
      try {
        const inv = await P.fetchResource('planningInventory');
        const ictx = { sourceUpdatedAt: inv.sourceUpdatedAt, fetchedAt: detailFetchedAt, snapshotHash: hashRows(inv.rows).slice(0, 12) };
        const normalized = inv.rows.map((r) => P.normalizeInventoryRow(r, ictx)).filter(Boolean);
        if (JSON.stringify(normalized.map((p) => [p.id, p.potentialUnits, p.stage])) !== JSON.stringify((plans.inventory || []).map((p) => [p.id, p.potentialUnits, p.stage]))) plansChanged = true;
        invByKey.clear(); normalized.forEach((p) => invByKey.set(p.planKey, p));
        plans.inventory = normalized; plans.inventoryMeta = { rows: inv.rows.length, sourceUpdatedAt: inv.sourceUpdatedAt, fetchedAt: detailFetchedAt, resourceId: inv.resourceId, stale: true, stateLandOnly: true };
        joins.inventory = { rows: inv.rows.length, sourceUpdatedAt: inv.sourceUpdatedAt };
      } catch (e) { joins.inventory = { error: e.message }; }
      try {
        const prog = await P.fetchResource('constructionProgress');
        const pctx = { sourceUpdatedAt: prog.sourceUpdatedAt, fetchedAt: detailFetchedAt };
        progressByParcel = new Map();
        for (const r of prog.rows) { const p = P.normalizeProgressRow(r, pctx); if (!p.joinable) continue; const k = p.block + '/' + p.parcel; if (!progressByParcel.has(k)) progressByParcel.set(k, []); progressByParcel.get(k).push(p); }
        joins.construction = { rows: prog.rows.length, joinableParcels: progressByParcel.size, sourceUpdatedAt: prog.sourceUpdatedAt };
      } catch (e) { joins.construction = { error: e.message }; }
      try {
        const dc = await P.fetchResource('developmentCosts');
        reference = { developmentCosts: { source: P.RESOURCES.developmentCosts.source, resourceId: dc.resourceId, sourceUpdatedAt: dc.sourceUpdatedAt, fetchedAt: detailFetchedAt, basis: 'MoCH-approved development costs per project (by locality); no exact key to a tender — never attached to one',
          rows: dc.rows.map((r) => ({ projectId: r.ProjectID, project: String(r.ProjectName || '').trim(), localityCode: r.LamasCode, locality: String(r.LamasName || '').trim(), site: String(r.AtarName || '').trim(), units: r.LivingUnits,
            status: String(r.StatusDescription || '').trim(), indexDate: r.TenderIndexDate, developmentPay: r.DevelopPay, tenderDevelopmentPay: r.TenderDevPay })) } };
        joins.developmentCosts = { rows: dc.rows.length, sourceUpdatedAt: dc.sourceUpdatedAt };
      } catch (e) { joins.developmentCosts = { error: e.message }; }
    }
    run.joins = joins;
    const missKeys = new Set((plans.xplanMisses || []).map((m) => m.planKey));
    /* no progress answer this run: each tender keeps the construction evidence of its last successful join (never re-labelled) */
    const fresh = freshRaw.map((r) => { let x = P.joinPlans(r, { xplan: xplanByKey, inventory: invByKey, misses: missKeys }); if (progressByParcel) x = P.joinConstruction(x, progressByParcel); return x; });

    /* 6 · merge */
    const presentIds = new Set(rows.map((r) => `rmi:${r.MichrazID}`));
    const { records: merged, history, stats } = mergeRecords(prev, fresh, { fetchedAt, syncRunId: run.id, prevCheckedAt: prevMeta && prevMeta.checkedAt, presentIds });
    const contentChanged = listChanged || details.size > 0 || maps.size > 0 || stats.updated + stats.inserted + stats.rederived + stats.missingFromSource > 0;
    Object.assign(run, { status: errors.length > Math.max(10, details.size * 0.2) ? 'partial' : 'ok', contentChanged, normalizerVersion: NORMALIZER_VERSION, ...stats, historyEvents: history.length });
    const all = merged;
    const live = all.filter((r) => r.inLatestSource !== false);
    const byKey = (arr, k) => arr.reduce((o, r) => { const v = r[k] == null ? 'null' : r[k]; o[v] = (o[v] || 0) + 1; return o; }, {});
    const detailAges = live.filter((r) => r.provenance.detail).map((r) => r.provenance.detail.fetchedAt).sort();
    const pub = live.map((r) => r.publishedDate).filter(Boolean).sort(), close = live.map((r) => r.closeDate).filter(Boolean).sort(), comm = live.map((r) => r.committeeDate).filter(Boolean).sort();
    const meta = {
      source: { id: SOURCE.id, publisher: SOURCE.publisher, name: SOURCE.name, url: SOURCE.url, classification: SOURCE.classification, cadence: SOURCE.cadence },
      endpoint: LIST_ENDPOINT, snapshotHash: hash, snapshotFetchedAt: listChanged ? fetchedAt : prevMeta.snapshotFetchedAt, checkedAt: argVal('from') ? (prevMeta && prevMeta.checkedAt) || fetchedAt : fetchedAt,
      normalizerVersion: NORMALIZER_VERSION, rows: rows.length, records: all.length, inLatestSource: live.length, notInLatestSource: all.length - live.length,
      coverage: coverageOf(live),
      detail: { withDetail: live.filter((r) => r.lotsCount != null).length, withGeometry: live.filter((r) => r.geometry).length, oldestDetailFetchedAt: detailAges[0] || null, newestDetailFetchedAt: detailAges[detailAges.length - 1] || null,
        activeWithDetail: live.filter((r) => (r.statusCode === 1 || r.statusCode === 2) && r.lotsCount != null).length, active: live.filter((r) => r.statusCode === 1 || r.statusCode === 2).length,
        detailUnavailable: live.filter((r) => r.lotsCount == null && r.provenance.detailError).length, budget, lastRunFetched: details.size },
      byLifecycle: byKey(live, 'lifecycle'), byTrack: byKey(live, 'track'),
      coverage: { publishedFrom: pub[0] || null, publishedTo: pub[pub.length - 1] || null, closeFrom: close[0] || null, closeTo: close[close.length - 1] || null,
        committeeFrom: comm[0] || null, committeeTo: comm[comm.length - 1] || null },
      plans: { xplan: xplanByKey.size, inventory: invByKey.size, inventoryAsOf: plans.inventoryMeta ? plans.inventoryMeta.sourceUpdatedAt : null, tendersWithJoinedPlan: live.filter((r) => r.planning && r.planning.joined).length,
        xplanMisses: (plans.xplanMisses || []).length },
      construction: { tendersWithLinks: live.filter((r) => r.construction && r.construction.links && r.construction.links.length).length, source: joins.construction || null },
      joins, historyEvents: store.readHistory().length + history.length, lastRun: run.id,
    };
    summary = `Land & tenders: ${rows.length} tenders listed · ${details.size} details read${detailStopped ? ` (stopped: ${detailStopped})` : ''} · ${maps.size} maps · `
      + `+${stats.inserted} new, ${stats.updated} changed, ${stats.missingFromSource} no longer listed · detail coverage ${meta.detail.withDetail}/${live.length}`
      + (joins.xplan && joins.xplan.found != null ? ` · xplan +${joins.xplan.found}` : '') + (errors.length ? ` · ${errors.length} errors` : '');
    if (!dry) {
      run.rawSnapshot = listChanged ? store.snapshotRaw(rows, hash, fetchedAt, { endpoint: LIST_ENDPOINT }) : null;
      if (reference) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'reference.json'), JSON.stringify(reference, null, 0).replace(/\},\{/g, '},\n{') + '\n'); }
      run.finishedAt = new Date().toISOString();
      store.write({ records: contentChanged ? merged : null, plans: plansChanged ? { xplan: [...xplanByKey.values()], inventory: plans.inventory || [], xplanMisses: plans.xplanMisses || [], inventoryMeta: plans.inventoryMeta || null } : null, history, meta, run });
      const cfg = storeConfig(process.env);
      if (cfg.ok) {
        try {
          const changedIds = new Set([...history.map((h) => h.id), ...details.keys(), ...maps.keys()]);
          const changedRecords = contentChanged ? merged.filter((r) => changedIds.has(r.id) || !prevById.has(r.id)) : null;
          await new SupabaseLandStore({ url: cfg.url, key: cfg.key }).write({ records: changedRecords, all: merged, history, allHistory: store.readHistory(), run, source: SOURCE, meta,
            plans: plansChanged ? { xplan: [...xplanByKey.values()], inventory: plans.inventory || [] } : null, raw: listChanged ? { hash, rows, fetchedAt } : null,
            rawDetails: rawDetails.length ? { hash: hashRows(rawDetails), rows: rawDetails, fetchedAt: detailFetchedAt } : null });
          summary += ' · Supabase ✓'; run.store = 'supabase-written';
        } catch (e) { code = 2; summary += ' · Supabase write failed'; run.store = 'supabase-write-failed'; console.error('supabase:', redact(e.message)); }
      } else if (cfg.reason === 'store-misconfigured') { code = 2; summary += ' · Supabase misconfigured'; run.store = 'supabase-misconfigured'; }
      else run.store = 'not-configured';
      store.appendRun({ id: run.id + ':store', source: SOURCE_ID, startedAt, finishedAt: new Date().toISOString(), status: 'ok', note: 'store outcome of ' + run.id, store: run.store, retrievalMethod: 'none' });
    }
    console.log(JSON.stringify({ run: { ...run, rejectedSample: undefined, errorSample: run.errorSample }, meta }, null, 1));
  } catch (e) {
    run.error = e.message; run.finishedAt = new Date().toISOString(); code = 1;
    summary = 'Land sync failed: ' + e.message;
    console.error('land-sync failed:', e.message);
    if (!dry) store.appendRun(run);
  }
  console.log(summary);
  if (argVal('summary-file')) fs.appendFileSync(argVal('summary-file'), summary + '\n');
  process.exitCode = code;
})();
