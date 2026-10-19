#!/usr/bin/env node
// PROPX · street coverage audit (lib/streets/coverage.js) — national, by district and by locality, reconciled. Offline.
//
//   node scripts/street-coverage.js              the table (national · districts · the 25 largest localities)
//   node scripts/street-coverage.js --json       the whole audit as JSON (every locality)
//   node scripts/street-coverage.js --city 7900  one locality
// Exit 1 when a reconciliation fails.

'use strict';

const { coverage } = require('../lib/streets/coverage');

const args = process.argv.slice(2);
const c = coverage();
if (args.includes('--json')) { console.log(JSON.stringify(c, null, 1)); process.exit(Object.values(c.reconcile).every(Boolean) ? 0 : 1); }
const cols = ['canonical', 'searchable', 'withTransactions', 'SUPPORTED', 'LIMITED', 'INSUFFICIENT', 'NONE', 'NOT_SWEPT', 'possibleOnly'];
const fmt = (n) => String(n).padStart(11);
const row = (label, o) => console.log(label.padEnd(26).slice(0, 26) + cols.map((k) => fmt(o[k])).join(''));
console.log('as of', JSON.stringify(c.asOf));
console.log(''.padEnd(26) + cols.map((k) => fmt(k.slice(0, 10))).join(''));
row('NATIONAL', c.totals);
for (const [d, o] of Object.entries(c.byDistrict).sort()) row('  ' + d, o);
const city = args.includes('--city') ? Number(args[args.indexOf('--city') + 1]) : null;
for (const l of c.byLocality.filter((x) => (city ? x.code === city : true)).slice(0, city ? 1 : 25)) row(`  ${l.code} ${l.name || ''}`, l);
console.log('official rows', c.totals.officialRows, '· placeholders (9000)', c.totals.placeholders, '· historical', c.totals.historical,
  '· synonyms', JSON.stringify(c.synonyms), '· localities', c.localities);
console.log('reconcile', JSON.stringify(c.reconcile));
process.exit(Object.values(c.reconcile).every(Boolean) ? 0 : 1);
