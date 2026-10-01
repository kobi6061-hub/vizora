#!/usr/bin/env node
// PROPX · daily sync of official market indicators.
//
// Fetches the Bank of Israel policy rate and the CBS dwelling-price indices
// from their official APIs, merges them into data/market/latest.json (+ the
// latest.js the page loads), and appends a change-detected history under
// data/market/snapshots/. Scheduled daily by .github/workflows/market-sync.yml;
// runnable on any machine that can reach boi.org.il and api.cbs.gov.il
// (the Claude sandbox cannot — its egress policy blocks both).
//
//   node scripts/market-sync.js                fetch → merge → write
//   node scripts/market-sync.js --dry-run      fetch and print, write nothing
//   node scripts/market-sync.js --discover     also list CBS candidate series
//   --summary-file <path>                      write a one-line summary there
//   --out <dir>                                write somewhere other than data/market
//
// Exit: 0 every source OK · 2 partial (written; failed values kept + marked
// stale) · 1 nothing usable (nothing written).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fetchBoiRate, discoverCbsSeries, fetchCbsIndex } = require('../lib/market/sources');
const { mergeSnapshot, dataPayload, toJs, EMPTY } = require('../lib/market/snapshot');
const { FileStore } = require('../lib/gov/store');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const DIR = path.resolve(argVal('out') || path.join(__dirname, '..', 'data', 'market'));

const settle = (p) => p.then((data) => ({ ok: true, data }), (e) => ({ ok: false, error: e.message }));

function readPrev() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, 'latest.json'), 'utf8'));
    return j && j.indicators ? j : EMPTY;
  } catch { return EMPTY; }
}

const fmtPct = (x) => (x > 0 ? '+' : '') + x.toFixed(1) + '%';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// a CBS dwelling-price point is a two-month window dated by its first month
const per = (p) => (p.month < 12 ? `${MON[p.month - 1]}–${MON[p.month]} ${p.year}` : `Dec ${p.year}–Jan ${p.year + 1}`);

(async () => {
  const now = new Date();
  const fetchImpl = globalThis.fetch;
  const prev = readPrev();

  const [boi, disc] = await Promise.all([settle(fetchBoiRate({ fetchImpl, now })), settle(discoverCbsSeries({ fetchImpl, debug: has('discover') }))]);
  const results = { boiRate: boi };
  if (disc.ok) {
    const [nh, dw] = await Promise.all([
      settle(fetchCbsIndex('newHomesIndex', disc.data.picks.newHomesIndex, { fetchImpl, now, debug: has('dry-run') })),
      settle(fetchCbsIndex('dwellingsIndex', disc.data.picks.dwellingsIndex, { fetchImpl, now, debug: has('dry-run') })),
    ]);
    results.newHomesIndex = nh;
    results.dwellingsIndex = dw;
  } else {
    results.newHomesIndex = results.dwellingsIndex = { ok: false, error: disc.error };
  }

  const snap = mergeSnapshot(prev, results, now);
  const I = snap.indicators;
  const line = (k, txt) => console.log(`${results[k] && results[k].ok && !I[k].stale ? '✓' : '✗'} ${k.padEnd(15)} ${txt}`);

  console.log(`market sync · ${snap.syncedAt}`);
  if (disc.ok) console.log('  CBS discovery:', disc.data.tried.join(' · '));
  line('boiRate', I.boiRate
    ? `${I.boiRate.value}%` + (I.boiRate.nextDecision ? ` · next decision ${I.boiRate.nextDecision}` : '') +
      (I.boiRate.stale ? ` · STALE (${I.boiRate.lastError})` : '')
    : `unavailable · ${results.boiRate.error}`);
  for (const k of ['newHomesIndex', 'dwellingsIndex']) {
    const v = I[k];
    line(k, v
      ? `${per(v.period)} y/y ${fmtPct(v.yoy)}` + (v.mom !== null ? ` m/m ${fmtPct(v.mom)}` : '') +
        ` · series ${v.series.code} "${v.series.name}"` + (v.seriesChangedFrom ? ` (was ${v.seriesChangedFrom})` : '') +
        (v.stale ? ` · STALE (${v.lastError})` : '')
      : `unavailable · ${results[k].error}`);
  }

  if (has('discover') && disc.ok) {
    console.log('\nCBS response shapes:');
    for (const sh of disc.data.shapes) console.log('  ' + sh.slice(0, 1500));
    const rel = disc.data.candidates.filter((c) => /דיר|שכר|מחיר/.test(c.name));
    console.log(`\nCBS candidate series (${rel.length} of ${disc.data.candidates.length}):`);
    for (const c of rel.slice(0, 80)) console.log(`  ${c.code.padStart(7)}  ${c.name}`);
    console.log('picked:', JSON.stringify(disc.data.picks));
    for (const k of ['newHomesIndex', 'dwellingsIndex']) {
      if (results[k] && results[k].ok && results[k].data.recent) console.log(`recent ${k}: ${results[k].data.recent.join(' · ')}`);
    }
  }

  const usable = Object.keys(I).length > 0;
  const summary = `Market data sync ${snap.syncedAt.slice(0, 10)} — ` + [
    I.boiRate && `BoI ${I.boiRate.value}%${I.boiRate.stale ? ' (stale)' : ''}`,
    I.newHomesIndex && `new homes ${per(I.newHomesIndex.period)} ${fmtPct(I.newHomesIndex.yoy)} y/y${I.newHomesIndex.stale ? ' (stale)' : ''}`,
    I.dwellingsIndex && `all dwellings ${per(I.dwellingsIndex.period)} ${fmtPct(I.dwellingsIndex.yoy)} y/y${I.dwellingsIndex.stale ? ' (stale)' : ''}`,
    snap.failures.length && `${snap.failures.length} source(s) failed`,
  ].filter(Boolean).join(' · ');

  if (!has('dry-run') && usable) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(snap, null, 1) + '\n');
    fs.writeFileSync(path.join(DIR, 'latest.js'), toJs(snap));
    const h = new FileStore(path.join(DIR, 'snapshots')).snapshot('indicators', dataPayload(snap));
    console.log(`\nwrote ${path.relative(process.cwd(), DIR) || '.'}/latest.{json,js} · history ${h.changed ? 'APPENDED (data changed)' : 'unchanged'}`);
  } else {
    console.log(has('dry-run') ? '\n(dry run — nothing written)' : '\nnothing usable — nothing written');
  }
  console.log('SUMMARY:', summary);
  const sf = argVal('summary-file');
  if (sf) fs.writeFileSync(sf, summary + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = ['boiRate', 'newHomesIndex', 'dwellingsIndex'].map((k) => {
      const v = I[k];
      if (!v) return `| ${k} | — | ✗ ${results[k] && results[k].error} |`;
      const val = k === 'boiRate' ? `${v.value}%` : `${per(v.period)} · ${fmtPct(v.yoy)} y/y`;
      return `| ${k} | ${val} | ${v.stale ? '✗ stale: ' + v.lastError : '✓ fresh'} |`;
    });
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Official market indicators\n\n| indicator | value | status |\n|---|---|---|\n${rows.join('\n')}\n`);
  }
  process.exitCode = !usable ? 1 : snap.ok ? 0 : 2;
})().catch((e) => { console.error('market-sync crashed:', e.stack || e.message); process.exitCode = 1; });
