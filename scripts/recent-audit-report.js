#!/usr/bin/env node
// PROPX · the same-parcel audit, printed (lib/recent/promote.js → data/streets/recent/promotion.json): every recent-only row with a
// register deal on its block · parcel within one day that no row of the copy prints — the case verdict against that register deal,
// the row's verdict over every register deal nearby, its promotion state. Offline: node scripts/recent-audit-report.js [--md]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'streets', 'recent', 'promotion.json'), 'utf8'));
const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'streets', 'recent', 'layer.json'), 'utf8'));
const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'recent-same-parcel-49.json'), 'utf8'));
const SD = require('../lib/streets/directory');
const D = SD.load();
const col = (c) => L.columns.indexOf(c);
const lay = new Map(L.rows.map((r) => [r[0], r]));
const RANK = ['CONFIRMED_SEPARATE_DEAL', 'LIKELY_SEPARATE_DEAL', 'POSSIBLE_DUPLICATE', 'UNRESOLVED'];
const orig = new Set(F.oids);
const rows = P.rows.filter((r) => r[4] === true).map((r) => {
  const x = lay.get(r[0]), cases = P.audits[r[0]] || [];
  const free = cases.filter((c) => c.heldBy == null);
  const caseVerdict = free.reduce((w, c) => (RANK.indexOf(c.verdict) > RANK.indexOf(w) ? c.verdict : w), RANK[0]);
  const loc = D.localities.get(x[col('cityCode')]) || {};
  return { oid: r[0], original49: orig.has(r[0]), city: loc.en || loc.he || x[col('cityCode')], date: x[col('date')], amount: x[col('amount')], area: x[col('areaSqm')], rooms: x[col('rooms')],
    series: x[col('series')], kind: x[col('kind')], free, caseVerdict, rowVerdict: r[3], state: r[1] };
}).sort((a, b) => Number(b.original49) - Number(a.original49) || a.oid - b.oid);
const tally = (k) => rows.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
if (process.argv.includes('--md')) {
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  console.log('| # | Row | Locality | Date | Amount | m² | Rooms | Series / type | Free register deal(s) | Case verdict | Row verdict (all nearby deals) | Promotion state |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((x, i) => console.log(`| ${x.original49 ? i + 1 : `+${i + 1 - F.oids.length}`} | ${x.oid} | ${x.city} | ${x.date} | ${fmt(x.amount)} | ${fmt(x.area)} | ${x.rooms ?? '—'} | ${x.series} · ${x.kind} | ${x.free.map((c) => `${c.date} ₪${fmt(c.amount)} ${fmt(c.areaSqm)} m² ${c.rooms ?? '—'}r — ${c.why}`).join('<br>')} | ${x.caseVerdict} | ${x.rowVerdict} | ${x.state} |`));
} else console.log(JSON.stringify({ rows: rows.length, original49: rows.filter((x) => x.original49).length, caseVerdicts49: rows.filter((x) => x.original49).reduce((m, x) => ((m[x.caseVerdict] = (m[x.caseVerdict] || 0) + 1), m), {}), caseVerdicts: tally('caseVerdict'), rowVerdicts: tally('rowVerdict'), states: tally('state') }, null, 1));
