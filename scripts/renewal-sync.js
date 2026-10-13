#!/usr/bin/env node
// PROPX · Urban renewal — scheduled sync of the Ministry of Construction and Housing's declared complexes.
//
//   official CKAN datastore (every row, paged; an incomplete read fails)
//     → schema guard (the columns the normalizer needs must exist) → content hash → raw snapshot when changed
//     → normalize (lib/renewal/normalize.js; malformed rows rejected and logged)
//     → upsert-merge: never delete, firstSeenAt kept, every change of a source field appended to the history
//     → meta (source update time, PROPX check time, coverage) + run log → data/renewal/
//
//   node scripts/renewal-sync.js                 live (GitHub runner; data.gov.il is reachable there)
//   node scripts/renewal-sync.js --dry-run       fetch + normalize + report, write nothing
//   --summary-file <path>                        append a one-line summary (commit message)
//   --allow-shrink                               accept an answer under half the listed complexes
// Fixtures are written only to a separate RENEWAL_DATA_DIR (tests). Exit: 0 ok · 1 failed (only the run log written).

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { SOURCE, fetchComplexes } = require('../lib/renewal/source');
const { normalizeAll, hashRows, REQUIRED_COLUMNS, NORMALIZER_VERSION, STAGES } = require('../lib/renewal/normalize');
const { mergeRecords, FileRenewalStore } = require('../lib/renewal/store');

const PROD_DIR = path.join(__dirname, '..', 'data', 'renewal');
const DIR = process.env.RENEWAL_DATA_DIR || PROD_DIR;
const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
  const startedAt = new Date().toISOString();
  const store = new FileRenewalStore(DIR);
  const run = { id: 'renewal-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: SOURCE.id, startedAt, status: 'failed', retrievalMethod: 'live-api' };
  let summary = '';
  try {
    const src = await fetchComplexes({ fetchImpl: globalThis.fetch });
    const cols = new Set(src.rows.flatMap((r) => Object.keys(r)));
    const lost = REQUIRED_COLUMNS.filter((c) => !cols.has(c));
    if (lost.length) throw new Error('schema changed — missing column(s): ' + lost.join(', '));
    const prev = store.readRecords(), prevMeta = store.readMeta();
    const listed = prev.filter((r) => r.inLatestSource !== false).length;
    if (listed && src.rows.length < listed * 0.5 && !has('allow-shrink')) throw new Error(`the source answered ${src.rows.length} rows, under half of the ${listed} listed last time — not applied`);
    const fetchedAt = new Date().toISOString(), hash = hashRows(src.rows);
    const ctx = { fetchedAt, sourceUpdatedAt: src.sourceUpdatedAt, snapshotHash: hash, retrievalMethod: 'live-api' };
    const { records: fresh, rejected } = normalizeAll(src.rows, ctx);
    if (!fresh.length) throw new Error('no row passed normalization');
    const { records, history, stats } = mergeRecords(prev, fresh, { fetchedAt, syncRunId: run.id, prevCheckedAt: prevMeta && prevMeta.checkedAt });
    const live = records.filter((r) => r.inLatestSource !== false);
    const dates = live.map((r) => r.declarationDate).filter(Boolean).sort();
    const byStage = {}; for (const r of live) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    const contentChanged = !prevMeta || prevMeta.snapshotHash !== hash;
    const meta = { source: SOURCE, endpoint: src.endpoint, sourceUpdatedAt: src.sourceUpdatedAt, snapshotHash: hash, snapshotFetchedAt: contentChanged ? fetchedAt : prevMeta.snapshotFetchedAt,
      checkedAt: fetchedAt, normalizerVersion: NORMALIZER_VERSION, rows: src.rows.length, records: records.length, inLatestSource: live.length, notInLatestSource: records.length - live.length, rejected: rejected.length,
      coverage: { declarationFrom: dates[0] || null, declarationTo: dates[dates.length - 1] || null, localities: new Set(live.map((r) => r.localityCode).filter(Boolean)).size },
      byStage, stages: STAGES };
    Object.assign(run, { status: 'ok', fetched: src.rows.length, sourceUpdatedAt: src.sourceUpdatedAt, snapshotHash: hash, contentChanged, normalizerVersion: NORMALIZER_VERSION,
      rejected: rejected.length, rejectedSample: rejected.slice(0, 5), ...stats, historyEvents: history.length, finishedAt: new Date().toISOString() });
    const declared = live.filter((r) => r.declaration === 'declared').length;
    summary = `Urban renewal: ${live.length} complexes (${declared} declared) · ${stats.inserted} new · ${stats.updated} changed · ${history.length} history events · source updated ${String(src.sourceUpdatedAt || '—').slice(0, 10)}`;
    if (!has('dry-run')) {
      const raw = contentChanged ? store.snapshotRaw(src.rows, hash, fetchedAt, { sourceUpdatedAt: src.sourceUpdatedAt, endpoint: src.endpoint }) : null;
      run.rawSnapshot = raw;
      store.write({ records, history, meta, run });
    }
    console.log(JSON.stringify(run));
    console.log('SUMMARY:', summary, has('dry-run') ? '(dry run — nothing written)' : '');
  } catch (e) {
    run.error = String(e.message).slice(0, 300); run.finishedAt = new Date().toISOString();
    if (/HTTP (401|403|429)\b/.test(run.error)) run.status = 'refused';
    if (!has('dry-run')) store.write({ run });
    console.error('renewal-sync failed:', run.error);
    summary = 'Urban renewal sync failed: ' + run.error;
    process.exitCode = 1;
  }
  const sf = argVal('summary-file');
  if (sf) fs.appendFileSync(sf, summary + '\n');
})();
