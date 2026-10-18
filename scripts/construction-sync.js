#!/usr/bin/env node
// PROPX · CBS construction — sync of the official series (building permits · construction starts · completions · active
// construction; national + 7 districts) from the CBS time-series API, subject 44.
//
// Resolves the geography nodes from the catalogue every run (lib/construction/resolve.js — the code is verified against
// the node's name, the data is keyed by the code), reads every resolved series on the period kind the source gives it
// (month / quarter / year — never assumed), keeps every published value in an append-only ledger with its revisions,
// stores each raw response bundle once per content hash, and writes the payload. Runs on a GitHub runner
// (.github/workflows/construction-sync.yml) — the Claude sandbox cannot reach the CBS hosts.
//
//   node scripts/construction-sync.js                 resolve → fetch → merge → write data/construction/
//   node scripts/construction-sync.js --dry-run       resolve, fetch and print (the catalogue nodes, the resolution table,
//                                                     the series found) — write nothing
//   --out <dir>   --summary-file <path>
//
// Status (sync-runs.jsonl): SUCCESS · UNCHANGED · PARTIAL · FAILED · REFUSED · SCHEMA_CHANGED (lib/construction/sync.js).
// A failed request never becomes 0 and never removes a stored value.
// Exit: 0 SUCCESS / UNCHANGED · 2 PARTIAL · 1 FAILED / REFUSED / SCHEMA_CHANGED.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { UA, MEASURE_IDS } = require('../lib/construction/series');
const { runSync, exitCodeOf } = require('../lib/construction/sync');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const DIR = path.resolve(argVal('out') || path.join(__dirname, '..', 'data', 'construction'));
const TIMEOUT = 30000;

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${url}`); e.status = r.status; throw e; }
  const text = (await r.text()).replace(/^﻿/, '');
  try { return { json: JSON.parse(text), text, status: r.status }; } catch { throw new Error(`not JSON (${r.headers.get('content-type')}) from ${url}`); }
}

(async () => {
  const dryRun = has('dry-run');
  const out = await runSync({ dir: DIR, fetchJson, now: new Date(), dryRun, log: console.log });
  if (dryRun) {
    /* the evidence a first run must show: the level-4 listing, every catalogue node of every branch, the resolution, the series found */
    const L4 = out.resolution.level4;
    console.log(`\n== level-4 listing of subject 44: ${L4.ok ? `${L4.count} nodes over ${L4.pages} page(s)` : 'FAILED: ' + L4.error}`);
    for (const m of MEASURE_IDS) {
      const R = out.resolution.measures[m];
      console.log(`\n== ${m} (${R.path}) ${R.ok ? `${R.nodes} catalogue nodes (${R.separators} separators)` : 'CATALOGUE FAILED: ' + R.error}`);
      for (const n of R.listed || []) console.log(`   node ${n.path.padEnd(16)} ${n.name}${n.pathDesc ? `  ⟨${n.pathDesc}⟩` : ''}`);
      for (const [k, x] of Object.entries(R.geos || {})) console.log(`   ${x.status.padEnd(10)} ${k.padEnd(9)} code ${String(x.code).padEnd(4)} expected ${String(x.expected).padEnd(4)} ${(x.pathId || '').padEnd(14)} ${x.name ? `"${x.name}" (${x.nameSource})` : ''}${x.leafName ? ` leaf "${x.leafName}"` : ''}${x.reason ? ' — ' + x.reason : ''}`);
    }
    console.log('\n== series found (per request; a skipped series shows its raw time / data kind — map it in lib/construction/series.js on purpose or leave it ignored)');
    for (const r of out.results) console.log(`   ${r.ok ? 'OK    ' : 'FAILED'} ${r.measure.padEnd(12)} ${r.geo.padEnd(9)} ${r.pathId.padEnd(16)} ${r.window.join('-')} ${r.ok ? r.parsed.series.map((s) => (s.skipped ? `${s.id}:SKIPPED(${s.skipped}, ${s.n} obs)` : `${s.id}:${s.freq}/${s.kind}/${s.n}`)).join(' ') + (r.parsed.names.length ? ` · named "${r.parsed.names.join('" / "')}"` : '') : r.error}`);
  }
  if (argVal('summary-file')) fs.writeFileSync(argVal('summary-file'), out.summary + '\n');
  process.exitCode = exitCodeOf(out.status);
})().catch((e) => { console.error(e); process.exitCode = 1; });
