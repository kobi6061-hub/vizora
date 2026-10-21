#!/usr/bin/env node
// PROPX · official reference datasets — sync (lib/reference). Reads every row of each source resource (complete or the run fails),
// guards the schema, normalizes on official codes and writes data/reference/<id>/ only when the content changed (+ a dated history copy).
//
//   node scripts/reference-sync.js                 every source (GitHub runner; data.gov.il answers there)
//   node scripts/reference-sync.js --source residents
//   node scripts/reference-sync.js --dry-run       fetch + normalize + report, write nothing
//   --summary-file <path>                          append a one-line summary (commit message)
// Exit: 0 every source ok · 1 any source failed (its last data kept; the run log says why).

'use strict';

const fs = require('node:fs');
const REF = require('../lib/reference');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
  const only = argVal('source');
  const ids = only ? [only] : Object.keys(REF.SOURCES);
  const lines = []; let failed = 0;
  for (const id of ids) {
    const src = REF.SOURCES[id];
    if (!src) { console.error('unknown source ' + id); process.exit(2); }
    const startedAt = new Date().toISOString();
    const run = { id: `${id}-${startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`, source: src.trustId, startedAt, status: 'failed' };
    try {
      const read = await REF.fetchAll(src);
      if (has('dry-run')) {
        const sample = read.rows.slice(0, 3).map((r) => src.normalize(r));
        console.log(JSON.stringify({ id, total: read.total, fields: read.fields, sourceUpdatedAt: read.sourceUpdatedAt, sample }, null, 1));
        continue;
      }
      const { meta, changed, rejected } = REF.write(src, read, { now: startedAt });
      Object.assign(run, { status: changed ? 'success' : 'unchanged', finishedAt: new Date().toISOString(), sourceRows: read.total, records: meta.records, rejected: rejected.length,
        sourceUpdatedAt: read.sourceUpdatedAt, contentHash: meta.contentHash, byLevel: meta.byLevel });
      lines.push(`${id}: ${changed ? 'changed' : 'unchanged'} · ${meta.records} records (${read.total} source rows, ${rejected.length} without an official code)`);
    } catch (e) {
      failed++;
      Object.assign(run, { finishedAt: new Date().toISOString(), error: String(e.message).slice(0, 300) });
      lines.push(`${id}: FAILED — ${run.error}`);
    }
    if (!has('dry-run')) REF.logRun(id, run);
  }
  const summary = 'Reference datasets: ' + lines.join(' · ');
  console.log(summary);
  const sf = argVal('summary-file'); if (sf) fs.appendFileSync(sf, summary + '\n');
  process.exit(failed ? 1 : 0);
})();
