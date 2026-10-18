#!/usr/bin/env node
// PROPX · Market Dossier HISTORY — write today's APPEND-ONLY snapshot of every geography's dossier (lib/dossier/history.js).
//
// Reads nothing from the network: one Market Dossier per geography (Israel, the 7 districts, every locality in the radar scan)
// over the committed data files and the committed radar scan → data/dossier/snapshots/<YYYY-MM-DD>.json + index.json.
// A day that exists is left exactly as it is (UNCHANGED); nothing is ever deleted. Runs nightly (dossier-snapshot.yml).
//   node scripts/dossier-snapshot.js [--data <dir>] [--out <dir>] [--date YYYY-MM-DD] [--localities <n>|all] [--summary-file <path>] [--quiet]
//   --date   labels AND clocks the read (never in the future) — for a re-run of a missed day on the same checkout; the data read is
//            whatever the checkout holds now, and the file says so through its `sources` check dates. The workflow never passes it.
//   --localities <n>   the top-n localities by live tenders instead of all (tests / dev only)
// Exit 0 on SUCCESS / UNCHANGED, 1 on an error.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const H = require('../lib/dossier/history');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const quiet = args.includes('--quiet');
const dataDir = path.resolve(opt('--data', path.join(__dirname, '..', 'data')));
const outDir = opt('--out', null) ? path.resolve(opt('--out', null)) : null;
const dateArg = opt('--date', null);
const loc = opt('--localities', 'all');
const summaryFile = opt('--summary-file', null);

try {
  const clock = Date.now();
  let now = clock;
  if (dateArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg) || Number.isNaN(Date.parse(dateArg + 'T00:00:00Z'))) throw new Error(`--date must be YYYY-MM-DD, got "${dateArg}"`);
    now = Date.parse(dateArg + 'T00:00:00Z');
    if (now > clock) throw new Error(`--date ${dateArg} is in the future — a snapshot is a read that happened`);
  }
  const r = H.write({ dataDir, now, outDir, localities: loc === 'all' ? 'all' : Number(loc) });
  const line = r.status === 'SUCCESS' ? `Dossier snapshot: ${r.date} — ${r.geographies} geographies` : `Dossier snapshot: ${r.date} — UNCHANGED (${r.reason.en})`;
  const detail = r.status === 'SUCCESS'
    ? `${r.byLevel.il} national · ${r.byLevel.district} districts · ${r.byLevel.locality} localities · states ${Object.entries(r.states).map(([k, v]) => `${k} ${v}`).join(' · ')} · ${(r.bytes / 1024).toFixed(0)} KB · ${(r.ms / 1000).toFixed(1)} s → ${path.relative(process.cwd(), r.file)}`
    : '';
  if (!quiet) console.log(detail ? `${line} · ${detail}` : line);
  if (summaryFile) fs.writeFileSync(summaryFile, `${line}\n${detail ? `\n${detail}\nsha256 ${r.sha256}\n` : ''}`);
  process.exit(0);
} catch (e) {
  console.error(`dossier-snapshot: ${e.message}`);
  process.exit(1);
}
