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
