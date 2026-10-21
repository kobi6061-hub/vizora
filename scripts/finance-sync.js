#!/usr/bin/env node
// PROPX · housing finance — sync (lib/finance). Reads the Bank of Israel's SDMX service (edge.boi.gov.il, keyless, GET only): the
// structure of each flow (the codelist names that verify every code PROPX filters on) and the data since 2016 as CSV; merges into the
// append-only ledger and writes data/finance/latest.json. A measure whose codes no longer carry their names, or that matches no / several
// series, is not read (its stored data kept); a failed flow never becomes 0.
//
//   node scripts/finance-sync.js                    (GitHub runner)
//   node scripts/finance-sync.js --dry-run          fetch + report, write nothing
//   --summary-file <path>                           append a one-line summary (commit message)
// Exit: 0 SUCCESS / UNCHANGED · 2 PARTIAL · 1 FAILED / REFUSED / SCHEMA_CHANGED.

'use strict';

const fs = require('node:fs');
const F = require('../lib/finance');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const UA = 'PROPX-data-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official statistics)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function fetchText(url, accept) {
  const wait = 1000 - (Date.now() - last); if (wait > 0) await sleep(wait);   // one request a second
  last = Date.now();
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 180000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: ac.signal });
    const text = await r.text();
    if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url.split('?')[0]}`);
    if (/radware|captcha|access denied/i.test(text.slice(0, 2000)) && !/^SERIES_CODE|^\{/.test(text.trim())) throw new Error(`refused: a challenge page for ${url.split('?')[0]}`);
    return text;
  } finally { clearTimeout(t); }
}

(async () => {
  const r = await F.runSync({ fetchText, dryRun: has('dry-run') });
  const R = r.run;
  const L = r.latest, nl = L.measures.newLoans && L.measures.newLoans.latest, rt = L.measures.rateFixedUnindexed && L.measures.rateFixedUnindexed.latest;
  const summary = `Housing finance (Bank of Israel): ${R.status} · ${R.read}/${R.measures} measures read${R.notPublished ? ` (${R.notPublished} not published)` : ''} · +${R.added} new, ${R.revised} revised`
    + (nl ? ` · new housing loans ${nl.period}` : '') + (rt ? ` · fixed unindexed rate ${rt.period} ${rt.value}%` : '') + (R.error ? ` · ${R.error.slice(0, 200)}` : '');
  console.log(summary);
  if (R.problems.length) console.log(R.problems.join('\n'));
  const sf = argVal('summary-file'); if (sf) fs.appendFileSync(sf, summary + '\n');
  process.exit(R.status === 'success' || R.status === 'unchanged' ? 0 : R.status === 'partial' ? 2 : 1);
})();
