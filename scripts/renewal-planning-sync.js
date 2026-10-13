#!/usr/bin/env node
// PROPX · Urban renewal × XPlan — scheduled read of the Planning Administration's record of every renewal complex's plan.
//
//   data/renewal/complexes.json (the MoCH complexes, written by scripts/renewal-sync.js)
//     → exact lookups in the xplan blue-lines layer: plan numbers, Mavat main-plan ids, boundaries (lib/renewal/planning-source.js)
//     → normalize (lib/renewal/planning.js) → upsert on mp_id, never delete, every change in planning-history.jsonl
//     → the join summary (exact / ambiguous / not found / no identifier / not checked) → data/renewal/planning*.json
//
//   node scripts/renewal-planning-sync.js               live (GitHub runner)
//   node scripts/renewal-planning-sync.js --dry-run     read + join + report, write nothing
//   --summary-file <path>                               append a one-line summary (commit message)
// A read that answered nothing keeps every stored plan and writes only the run log (exit 1). A partial read keeps the
// plans it could not check as they were (status partial). RENEWAL_DATA_DIR redirects everything (tests).

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { SOURCE, NORMALIZER_VERSION, joinAll } = require('../lib/renewal/planning');
const { fetchPlanning } = require('../lib/renewal/planning-source');
const { mergePlans, FilePlanningStore } = require('../lib/renewal/planning-store');
const { FileRenewalStore } = require('../lib/renewal/store');

const DIR = process.env.RENEWAL_DATA_DIR || path.join(__dirname, '..', 'data', 'renewal');
const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
  const startedAt = new Date().toISOString();
  const store = new FilePlanningStore(DIR), complexes = new FileRenewalStore(DIR).readRecords().filter((c) => c.inLatestSource !== false);
  const run = { id: 'renewal-planning-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: SOURCE.id, startedAt, status: 'failed', retrievalMethod: 'live-api' };
  let summary = '';
  try {
    if (!complexes.length) throw new Error('no stored renewal complexes to look up (run scripts/renewal-sync.js first)');
    const fetchedAt = new Date().toISOString();
    const got = await fetchPlanning(complexes, { fetchImpl: globalThis.fetch, fetchedAt, deadline: Date.now() + 15 * 60 * 1000 });
    if (!got.askedKeys.length && !got.askedIds.length) throw new Error('the layer answered no lookup: ' + got.errors.join(' | '));
    const prev = store.readPlanning();
    const { plans, history, stats } = mergePlans(prev ? prev.plans : [], got.plans, { fetchedAt, runId: run.id, askedKeys: got.askedKeys, askedIds: got.askedIds });
    const prevLookups = (prev && prev.lookups) || {};
    /* a key asked successfully before and not re-asked this run (a failed batch) stays asked — its earlier answer still stands */
    const lookups = { planKeys: [...new Set([...(prevLookups.planKeys || []), ...got.askedKeys])].sort(), mavatIds: [...new Set([...(prevLookups.mavatIds || []), ...got.askedIds])].sort((a, b) => a - b) };
    const geometry = { ...store.readGeometry(), ...got.geometry };
    const status = got.complete && !got.failedBatches ? 'ok' : 'partial';
    const meta = { source: SOURCE, endpoint: got.endpoint, normalizerVersion: NORMALIZER_VERSION, checkedAt: fetchedAt, status,
      asked: { planNumbers: got.numbers, mavatIds: got.ids, requests: got.requests, failedBatches: got.failedBatches, geometryFailed: got.geometryFailed },
      plans: plans.filter((p) => p.inLatestSource !== false).length, withGeometry: Object.keys(geometry).length };
    const planning = { meta, lookups, plans };
    const J = joinAll(complexes, planning, { today: fetchedAt.slice(0, 10) });
    meta.join = J.coverage;
    Object.assign(run, { status, finishedAt: new Date().toISOString(), requests: got.requests, failedBatches: got.failedBatches, geometryFailed: got.geometryFailed, errors: got.errors,
      plansFound: got.plans.length, ...stats, historyEvents: history.length, exact: J.coverage.exact, ambiguous: J.coverage.ambiguous, notFound: J.coverage.notFound,
      noIdentifier: J.coverage.noIdentifier, notChecked: J.coverage.notChecked, matchRate: J.coverage.matchRate, contentChanged: stats.inserted + stats.updated + stats.gone > 0 });
    summary = `Urban renewal × XPlan: ${J.coverage.exact} of ${J.coverage.complexes} complexes joined exactly (${J.coverage.matchRate}%) · ${J.coverage.ambiguous} ambiguous · ${J.coverage.unmatched} unmatched · ${stats.inserted} new / ${stats.updated} changed plans${status === 'partial' ? ' · PARTIAL read' : ''}`;
    if (!has('dry-run')) store.write({ planning, geometry, history, run });
    console.log(summary);
    console.log(JSON.stringify({ coverage: J.coverage, pipeline: J.pipeline, discrepancies: J.discrepancies, derived: J.derivedCounts, errors: got.errors }, null, 1));
    if (has('dry-run')) {
      /* the first comparisons, for the record of the run */
      let n = 0; for (const c of complexes) { const j = J.byComplex.get(c.id); if (!j.plan || n++ > 12) continue;
        console.log(JSON.stringify({ c: c.complexId, city: c.city, moch: [c.planNumber, c.existingUnits, c.additionalUnits, c.proposedUnits, c.approvalYear, c.statusHe], xplan: [j.plan.planNumber, j.plan.unitsApprovedState, j.plan.unitsChange, j.plan.stage, j.plan.dates.gazetteDate], differs: j.compare.filter((d) => d.differs).map((d) => d.field) })); }
    }
  } catch (e) {
    run.error = String(e.message || e).slice(0, 500); run.finishedAt = new Date().toISOString();
    summary = 'Urban renewal × XPlan: read failed — ' + run.error;
    if (!has('dry-run')) store.write({ run });
    console.error(summary);
  }
  if (argVal('summary-file')) fs.appendFileSync(argVal('summary-file'), summary + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### ' + summary + '\n'); } catch { /* not a runner */ } }
  process.exit(run.status === 'failed' ? 1 : 0);
})();
