#!/usr/bin/env node
// PROPX · Market Radar — compile data/radar/events.json from the committed histories (lib/radar/events.js).
//
// Runs at the end of every sync workflow (and on demand): reads nothing from the network, writes one compact file
// of the last 120 days of events plus meta.json. Deterministic for a given data directory and clock.
//   node scripts/radar-build.js [--days 120] [--data <dir>] [--out <dir>] [--quiet]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../lib/radar/events');
const SCAN = require('../lib/radar/scan');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const dataDir = path.resolve(opt('--data', path.join(__dirname, '..', 'data')));
const outDir = path.resolve(opt('--out', path.join(dataDir, 'radar')));
const days = Math.max(7, Math.min(400, Number(opt('--days', 120)) || 120));
const quiet = args.includes('--quiet');

const t0 = Date.now();
const payload = build({ dataDir, days });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(payload));
const meta = { schema: 1, builtAt: payload.builtAt, since: payload.since, days, events: payload.events.length, counts: payload.counts, rules: payload.rules, ms: Date.now() - t0, generator: 'scripts/radar-build.js' };
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
/* the Opportunity / Risk scan over every geography (lib/radar/scan.js) — the same file set, read by view=scan */
const s0 = Date.now();
const scan = SCAN.build({ dataDir });
fs.writeFileSync(path.join(outDir, 'scan.json'), JSON.stringify(scan));
if (!quiet) console.log(`Opportunity / Risk scan: ${scan.counts.geographies} geographies · ${scan.counts.opportunities} opportunities · ${scan.counts.risks} risks · ${Date.now() - s0} ms`);
if (!quiet) console.log(`Market Radar: ${payload.events.length} events over ${days} days (${Object.entries(payload.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}) · ${meta.ms} ms → ${path.relative(process.cwd(), outDir)}/`);
