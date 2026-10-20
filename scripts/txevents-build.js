#!/usr/bin/env node
// PROPX · TRANSACTION EVENTS — the offline build (lib/txevents/build.js → data/txevents/). Nothing is fetched.
//   node scripts/txevents-build.js
'use strict';

const B = require('../lib/txevents/build');
const t0 = Date.now();
const r = B.build();
if (!r.ok) { console.error('txevents build FAILED: ' + r.error); process.exit(1); }
const c = r.completeness;
console.log(`txevents: links ${r.links} · possible duplicates (recent window) ${r.extra} · parcel recovery ${JSON.stringify(r.parcelRecovery.states)} · latest event ${r.latest.latest} · events ${r.latest.events}`);
console.log(`completeness: sources ${c.sources.monitored} (healthy ${c.sources.healthy}) · new 24h ${c.newEvents.last24h} / 7d ${c.newEvents.last7d} · unexplained ${c.notSurfaced.unexplained} · ${c.notSurfaced.statement} · ${Math.round((Date.now() - t0) / 1000)} s`);
