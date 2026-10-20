#!/usr/bin/env node
// PROPX · the history's PER-LOCALITY partitions (closure P0, 20.10.2026) — derived from the year files, deterministically.
//
// A locality / street / parcel read of the ALL period needs the GovMap-layer history of ONE locality, every year; the year files
// (data/txevents/history/gm-<year>.json.gz) hold every locality of one year. This script regroups the same rows — nothing added,
// nothing dropped, the same columns and encoding — into data/txevents/history/loc/<code>.json.gz (newest first) and writes
// data/txevents/history/loc/index.json (rows · bytes · sha256 per locality, the year files it was derived from). The area reads
// (a district, Israel) keep reading the year files.
//   node scripts/txevents-history-index.js

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const DIR = process.env.TXEVENTS_HISTORY_DIR || path.join(__dirname, '..', 'data', 'txevents', 'history');
const OUT = path.join(DIR, 'loc');
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const DAY = 864e5;
const isoDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/* every shown row of every year, decoded to plain values (dates as day numbers) */
const byCode = new Map();
let COLS = null, total = 0;
for (const f of [...meta.files].sort((a, b) => a.year - b.year)) {
  const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, f.file))).toString('utf8'));
  if (!COLS) COLS = doc.columns;
  if (JSON.stringify(COLS) !== JSON.stringify(doc.columns)) throw new Error(`${f.file}: other columns`);
  const di = COLS.indexOf('date'), ci = COLS.indexOf('cityCode');
  let d = 0;
  for (let j = 0; j < doc.rows; j++) {
    const row = new Array(COLS.length);
    for (let i = 0; i < COLS.length; i++) {
      let v = doc.cols[i][j];
      if (i === di) { d = j ? d - v : v; v = d; } else if (doc.dict[COLS[i]] && v != null) v = doc.dict[COLS[i]][v];
      row[i] = v;
    }
    const c = row[ci];
    if (c == null) throw new Error(`${f.file}: a shown row without a locality (oid ${row[0]})`);
    if (!byCode.has(c)) byCode.set(c, []);
    byCode.get(c).push(row);
    total++;
  }
}

/* one file per locality, the year files' encoding: dictionaries for the repeated strings, dates as deltas, newest first */
const DICT = ['floor', 'propertyType', 'dealNature', 'kind', 'settlement', 'street', 'streetBasis', 'class', 'recovery'];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const di = COLS.indexOf('date');
const index = { schema: 1, engine: meta.engine, version: meta.version || null, derivedFrom: meta.files.map((f) => ({ file: f.file, sha256: f.sha256 })), columns: COLS, rows: total, localities: {} };
for (const c of [...byCode.keys()].sort((a, b) => a - b)) {
  const rows = byCode.get(c).sort((a, b) => b[di] - a[di] || a[0] - b[0]);
  const dict = {}, idx = {};
  for (const k of DICT) { dict[k] = []; idx[k] = new Map(); }
  const enc = (k, v) => { if (!idx[k] || v == null) return v; if (!idx[k].has(v)) { idx[k].set(v, dict[k].length); dict[k].push(v); } return idx[k].get(v); };
  const cols = COLS.map((k, i) => rows.map((x, j) => (i === di ? (j ? rows[j - 1][di] - x[di] : x[di]) : enc(k, x[i]))));
  const gz = zlib.gzipSync(JSON.stringify({ schema: 2, engine: meta.engine, code: c, rows: rows.length, columns: COLS, dict, cols }), { level: 9 });
  fs.writeFileSync(path.join(OUT, `${c}.json.gz`), gz);
  index.localities[c] = { rows: rows.length, latest: isoDay(rows[0][di]), earliest: isoDay(rows[rows.length - 1][di]), bytes: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex') };
}
if (total !== meta.shown) throw new Error(`the year files hold ${total} rows, meta.json says ${meta.shown}`);
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index) + '\n');
console.log(JSON.stringify({ ok: true, rows: total, localities: byCode.size, bytes: Object.values(index.localities).reduce((a, x) => a + x.bytes, 0) }));
