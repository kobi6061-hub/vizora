#!/usr/bin/env node
// PROPX · street surroundings — sync (lib/surroundings). Reads every row of the Ministry of Environmental Protection's contaminated-land
// register and the Ministry of Education's institution coordinates + characteristics on data.gov.il (keyless CKAN datastore; complete or the
// source fails; schema-guarded — lib/reference's reader and store) and writes data/surroundings/<id>/ only when the content changed
// (+ a dated history copy and a run log).
//
//   node scripts/surroundings-sync.js [--source contaminated] [--dry-run] [--summary-file <path>]
// Exit: 0 every source ok · 1 any source failed (its last data kept; the run log says why).

'use strict';

const fs = require('node:fs');
const REF = require('../lib/reference');
const TR = require('../lib/surroundings');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };

(async () => {
  const only = argVal('source');
  const ids = only ? [only] : Object.keys(TR.SOURCES);
  const lines = []; let failed = 0;
  for (const id of ids) {
    const src = TR.SOURCES[id];
    if (!src) { console.error('unknown source ' + id); process.exit(2); }
    const startedAt = new Date().toISOString();
    const run = { id: `${id}-${startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`, source: src.trustId, startedAt, status: 'failed' };
    try {
      const read = await REF.fetchAll(src);
      if (has('dry-run')) { console.log(JSON.stringify({ id, total: read.total, fields: read.fields, sourceUpdatedAt: read.sourceUpdatedAt, sample: read.rows.slice(0, 3).map((r) => src.normalize(r)) }, null, 1)); continue; }
      const { meta, changed, rejected } = REF.write(src, read, { now: startedAt, dir: TR.DIR });
      Object.assign(run, { status: changed ? 'success' : 'unchanged', finishedAt: new Date().toISOString(), sourceRows: read.total, records: meta.records, rejected: rejected.length, sourceUpdatedAt: read.sourceUpdatedAt, contentHash: meta.contentHash, byLevel: meta.byLevel });
      lines.push(`${id}: ${changed ? 'changed' : 'unchanged'} · ${meta.records} records (${read.total} source rows, ${rejected.length} not kept — no usable point / key, or before the kept school years)`);
    } catch (e) {
      failed++;
      Object.assign(run, { finishedAt: new Date().toISOString(), error: String(e.message).slice(0, 300) });
      lines.push(`${id}: FAILED — ${run.error}`);
    }
    if (!has('dry-run')) REF.logRun(id, run, TR.DIR);
  }
  const summary = 'Street surroundings: ' + lines.join(' · ');
  console.log(summary);
  const sf = argVal('summary-file'); if (sf) fs.appendFileSync(sf, summary + '\n');
  process.exit(failed ? 1 : 0);
})();
