#!/usr/bin/env node
// PROPX · the upgrade-potential simulation (lib/recent/simulate.js) → data/streets/recent/simulation.json + a summary.
//   node scripts/recent-simulate.js
// Offline: the stored GovMap-layer windows (raw/ + history/) × the stored register copy. Nothing is fetched; nothing in the layer,
// the ledger or any statistic changes — the simulation runs on its own blind / arrive reconciliations.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SIM = require('../lib/recent/simulate');

const ROOT = path.join(__dirname, '..');
const out = SIM.simulate({ root: ROOT });
fs.writeFileSync(path.join(ROOT, 'data', 'streets', 'recent', 'simulation.json'), JSON.stringify(out, null, 1) + '\n');
const line = (x) => `n ${x.n} · matched ${x.matched} (${x.matchedPct} %) · whole ${x.wholeProperty} (${x.wholePct} %) · partial ${x.partialShare} (${x.partialPct} %) · multi-unit ${x.multiUnit} · conflict ${x.conflictWithRegister} · unresolved ${x.unresolved} (${x.unresolvedPct} %) · VERIFIED ${x.finalVerified} (whole ${x.verifiedWholeProperty})`;
for (const p of out.populations) {
  console.log(`\n${p.label}\n  window ${p.window.from} … ${p.window.to} · ${p.rows} rows · ${p.observedRecentOnly} first seen as recent-only`);
  console.log('  all recent-only      ' + line(p.all));
  console.log('  recorded events      ' + line(p.events));
  console.log('  first LIMITED        ' + line(p.byFirstState.RECENT_OBSERVED_LIMITED));
}
console.log(`\nlag: ${out.lag.measurable ? JSON.stringify(out.lag) : 'not measurable — ' + out.lag.reason}`);
