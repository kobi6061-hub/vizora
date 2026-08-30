#!/usr/bin/env node
// PROPX · government data sync CLI.
//
// Runs the GovDataService LIVE (on any machine that can reach gov.il —
// the Claude sandbox cannot; Vercel and a normal workstation can) and
// persists durable, timestamped snapshots under data/gov/snapshots/ so
// changes in source data are detectable over time (a snapshot is written
// only when the content hash changed).
//
// Usage:
//   node scripts/gov-sync.js --city "אזור" --street "ז'בוטינסקי" --house 7
//   node scripts/gov-sync.js --trends
//   node scripts/gov-sync.js --status

'use strict';

const path = require('node:path');
const { createDefaultService } = require('../lib/gov/service');
const { FileStore } = require('../lib/gov/store');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

(async () => {
  const store = new FileStore(path.join(__dirname, '..', 'data', 'gov', 'snapshots'));
  const svc = createDefaultService({ store });

  if (arg('status')) {
    console.log(JSON.stringify(svc.status(), null, 2));
    return;
  }

  // GATE-4 acceptance: live-retrieve ז'בוטינסקי 7, אזור from the authoritative
  // source and verify against the independently observed comparison records.
  // PASS requires the live source to return them — nothing is hard-coded.
  if (arg('verify-azor')) {
    const { verifyAgainstReference } = require('../lib/gov/verify');
    const fix = JSON.parse(require('node:fs').readFileSync(
      path.join(__dirname, '..', 'data', 'gov', 'fixtures', 'azor-jabotinsky7.json'), 'utf8'));
    const addr = fix.acceptanceAddress;
    const res = await svc.getTransactions(
      { city: addr.city, street: addr.street, houseNumber: addr.houseNumber }, { radiusM: 60 });
    console.log(`retrieved: ${res.transactions.length}` + (res.scope ? ` (scope: ${res.scope.description}, n=${res.scope.sampleSize})` : ''));
    for (const u of res.unavailable) console.log('  unavailable:', u.provider || '-', '·', u.reason);
    const report = verifyAgainstReference(res.transactions, fix.observedComparison.records);
    for (const r of report.results) {
      console.log(` ref ${r.reference.date} ₪${r.reference.price.toLocaleString()} → ` +
        (r.best.matched ? `MATCHED (${r.best.txId})` : `no match (best core fields: ${r.best.coreOk}/5)`));
      for (const [k, c] of Object.entries(r.best.checks || {})) {
        console.log(`   ${k}: ref=${c.ref} got=${c.got} ${c.notComparable ? '(' + c.notComparable + ')' : c.ok ? '✓' : '✗'}`);
      }
    }
    console.log('VERDICT:', report.verdict, `(${report.matched}/${report.total})`);
    process.exitCode = report.verdict === 'ALL_MATCHED' ? 0 : 1;
    return;
  }

  if (arg('trends')) {
    const t = await svc.getMarketTrends(null);
    console.log(`trends: ${t.points.length} points, scope=${t.scope}, series=${t.series && t.series.id}`);
    for (const u of t.unavailable) console.log('  unavailable:', u.provider, '-', u.reason);
    return;
  }

  const city = arg('city'), street = arg('street'), house = arg('house');
  if (!city) {
    console.log('usage: gov-sync --city <city> [--street <street>] [--house <n>] | --trends | --status');
    process.exitCode = 2;
    return;
  }

  const resolved = await svc.resolveAddress(city, street, house ? Number(house) : null);
  console.log('resolved:', JSON.stringify(resolved, null, 1));

  const tx = await svc.getTransactions({ city, street, houseNumber: house ? Number(house) : null });
  console.log(`transactions: ${tx.transactions.length}` + (tx.scope ? ` (scope: ${tx.scope.description})` : ''));
  console.log(`  confirmed_new=${tx.partitions.confirmed.length} probable_new=${tx.partitions.probable.length} unknown=${tx.partitions.unknown.length}`);
  for (const u of tx.unavailable) console.log('  unavailable:', u.provider || '-', '·', u.capability, '·', u.reason);
})().catch((e) => { console.error('gov-sync failed:', e.message); process.exitCode = 1; });
