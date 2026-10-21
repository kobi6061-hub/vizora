#!/usr/bin/env node
// PROPX · STREET SEARCH DISCOVERABILITY AUDIT (21.10.2026, the master data directive §4) — every current official searchable row of the
// directory (streets · address areas · sites; the locality placeholder 9000 excluded) and every official synonym, through the search the
// page uses (lib/geo/registry.js searchGeo, limit 12 — the dropdown shows the first 10 registry rows):
//   near   the official name with its locality selected (`near` = the locality code — what the page sends for the locality in view)
//   named  "<official name> <official locality name>" typed together
//   plain  the official name alone
//   syn    every official synonym with its locality selected, and "<synonym> <locality>"
//   place  every synonym the directory files under a locality's placeholder (9000 — a place in the locality, no street record): the
//          LOCALITY must be offered for the name alone and for "<name> <locality>"
// A row PASSES a form when it is among the first 10 rows shown. A form is LEGITIMATELY AMBIGUOUS when the list is full of answers at
// least as strong: more than 10 localities hold a row of exactly that name, or every row ranked ahead of the target is a locality or
// a street of the same or a stronger tier (the list cannot show them all; adding the locality resolves it — the named form is
// checked for every row). A one-letter name is never searched (the page needs two characters) — listed apart. Everything else is a
// FAILURE, listed.
//
//   node scripts/search-discoverability-audit.js --shard 0/4 --out /tmp/a0.json     one shard (run 4 in parallel)
//   node scripts/search-discoverability-audit.js --merge /tmp/a0.json … --out data/geo/streets/search-audit.json
// The merged artifact is pinned to the directory files' hashes and the ranking code's hash (test/search.test.js checks both).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const VISIBLE = 10;

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const codeHash = () => crypto.createHash('sha256').update(['lib/geo/registry.js', 'lib/geo/aliases.js', 'lib/streets/match.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')).digest('hex');

function shard() {
  const R = require('../lib/geo/registry'), SD = require('../lib/streets/directory');
  const D = SD.load();
  const [k, n] = (arg('--shard') || '0/1').split('/').map(Number);
  const rows = D.streets.filter((s) => s.kind !== SD.KIND.LOCALITY).sort((a, b) => (a.id < b.id ? -1 : 1));
  const city = new Map();
  const cityOf = (id) => { const r = R.resolveGeoId(id); return r ? r.city : null; };
  const rank = (q, id, near) => { const m = R.searchGeo(q, 12, near ? { near } : {}).matches; return m.findIndex((x) => x.id === id); };
  const out = { shard: k, of: n, rows: [], syn: [] };
  const t0 = Date.now();
  rows.forEach((s, i) => {
    if (i % n !== k) return;
    let c = city.get(s.cityCode); if (c === undefined) { c = cityOf(s.id); city.set(s.cityCode, c); }
    out.rows.push([s.id, s.status === 'historical' ? 1 : 0, rank(s.name, s.id, s.cityCode), c ? rank(s.name + ' ' + c, s.id) : -2, rank(s.name, s.id)]);
  });
  const rankLoc = (q, code) => { const m = R.searchGeo(q, 12).matches; return m.findIndex((x) => x.id === 'loc:' + code); };
  out.place = [];
  D.synonyms.forEach((y, i) => {
    if (i % n !== k) return;
    const id = `st:${y.cityCode}:${y.officialCode}`;
    if (y.officialCode === 9000) {
      let c = city.get(y.cityCode); if (c === undefined) { const l = R.resolveGeoId('loc:' + y.cityCode); c = l ? l.he : null; city.set(y.cityCode, c); }
      out.place.push([y.cityCode, y.name, c ? rankLoc(y.name, y.cityCode) : -3, c ? rankLoc(y.name + ' ' + c, y.cityCode) : -3]);
      return;
    }
    if (!D.byId.has(id)) { out.syn.push([id, y.name, -3, -3]); return; }
    let c = city.get(y.cityCode); if (c === undefined) { c = cityOf(id); city.set(y.cityCode, c); }
    out.syn.push([id, y.name, rank(y.name, id, y.cityCode), c ? rank(y.name + ' ' + c, id) : -2]);
  });
  out.ms = Date.now() - t0;
  fs.writeFileSync(arg('--out'), JSON.stringify(out));
  console.log(`shard ${k}/${n}: ${out.rows.length} rows · ${out.syn.length} synonyms · ${out.place.length} place names · ${Math.round(out.ms / 1000)} s`);
}

function merge() {
  const files = process.argv.slice(process.argv.indexOf('--merge') + 1).filter((x) => !x.startsWith('--') && x !== arg('--out'));
  const parts = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const R = require('../lib/geo/registry'), SD = require('../lib/streets/directory');
  const D = SD.load();
  const rows = parts.flatMap((p) => p.rows), syn = parts.flatMap((p) => p.syn), place = parts.flatMap((p) => p.place || []);
  /* the list is FULL of answers at least as strong as the target: every row ahead of it is a locality, or a street whose tier is the
     target's or stronger (re-read with a long list — the order does not depend on the limit) */
  const crowded = (q, id, near) => {
    const m = R.searchGeo(q, 80, near ? { near } : {}).matches, j = m.findIndex((x) => x.id === id);
    if (j < 0) return { crowded: false, rank: -1 };
    const tgt = m[j].tier || 0;
    return { crowded: j >= VISIBLE && m.slice(0, j).every((x) => x.kind === 'locality' || (x.tier || 9) <= tgt), rank: j, tier: m[j].tier || null };
  };
  /* how many localities hold a current searchable row of exactly this (normalized) name */
  const sameName = new Map();
  for (const s of D.streets) if (s.kind !== SD.KIND.LOCALITY && s.status === 'current') { const n = R.normHe(s.name); const set = sameName.get(n) || new Set(); set.add(s.cityCode); sameName.set(n, set); }
  const byId = new Map(D.streets.map((s) => [s.id, s]));
  const T = (list, col) => ({ top1: list.filter((r) => r[col] === 0).length, top3: list.filter((r) => r[col] >= 0 && r[col] < 3).length, visible: list.filter((r) => r[col] >= 0 && r[col] < VISIBLE).length, absent: list.filter((r) => r[col] < 0).length });
  const cur = rows.filter((r) => r[1] === 0), hist = rows.filter((r) => r[1] === 1);
  const failures = [], ambiguous = { count: 0, byRule: { sameNameLocalities: 0, crowdedByEqualAnswers: 0 }, localitiesP50: null, examples: [], crowdedExamples: [] };
  const amb = [], ambOther = [], tooShort = [], defects = [];
  const cityName = (code) => { const l = R.resolveGeoId('loc:' + code); return l ? l.he : null; };
  for (const r of rows) {
    const s = byId.get(r[0]), info = { id: r[0], name: s.name, kind: s.kind, status: s.status };
    if (R.normHe(s.name).length < 2) { tooShort.push(info); continue; }
    if (!(r[2] >= 0 && r[2] < VISIBLE)) { const c = crowded(s.name, r[0], s.cityCode); if (c.crowded) ambOther.push({ ...info, form: 'near', rank: c.rank }); else failures.push({ ...info, form: 'near', rank: r[2] }); }
    if (!(r[3] >= 0 && r[3] < VISIBLE)) failures.push({ ...info, form: 'named', rank: r[3] });
    if (!(r[4] >= 0 && r[4] < VISIBLE)) {
      const n = (sameName.get(R.normHe(s.name)) || new Set()).size;
      if (n > VISIBLE) { amb.push(n); ambiguous.byRule.sameNameLocalities++; if (ambiguous.examples.length < 15) ambiguous.examples.push({ ...info, sameNameLocalities: n, rank: r[4] }); }
      else { const c = crowded(s.name, r[0]); if (c.crowded) { ambiguous.byRule.crowdedByEqualAnswers++; amb.push(n); if (ambiguous.crowdedExamples.length < 25) ambiguous.crowdedExamples.push({ ...info, sameNameLocalities: n, rank: c.rank, tier: c.tier }); } else failures.push({ ...info, form: 'plain', rank: r[4], sameNameLocalities: n }); }
    }
  }
  amb.sort((a, b) => a - b); ambiguous.count = amb.length; ambiguous.localitiesP50 = amb.length ? amb[amb.length >> 1] : null; ambiguous.localitiesMin = amb.length ? amb[0] : null;
  const synValid = syn.filter((y) => y[2] !== -3);
  for (const y of synValid) {
    if (R.normHe(y[1]).length < 2) { tooShort.push({ id: y[0], name: y[1], form: 'synonym' }); continue; }
    const near = Number(y[0].split(':')[1]);
    if (!(y[2] >= 0 && y[2] < VISIBLE)) { const c = crowded(y[1], y[0], near); if (c.crowded) ambOther.push({ id: y[0], name: y[1], form: 'synonym-near', rank: c.rank }); else failures.push({ id: y[0], name: y[1], form: 'synonym-near', rank: y[2] }); }
    if (!(y[3] >= 0 && y[3] < VISIBLE) && /-$/.test(y[1].trim())) { defects.push({ id: y[0], name: y[1], form: 'synonym-named', rank: y[3] }); continue; }
    if (!(y[3] >= 0 && y[3] < VISIBLE)) { const c = crowded(y[1] + ' ' + cityName(near), y[0]); if (c.crowded) ambOther.push({ id: y[0], name: y[1], form: 'synonym-named', rank: c.rank }); else failures.push({ id: y[0], name: y[1], form: 'synonym-named', rank: y[3] }); }
  }
  /* place names (synonyms of the locality placeholder): the locality is offered */
  const placeSame = new Map(); for (const p of place) { const n = R.normHe(p[1]); placeSame.set(n, (placeSame.get(n) || 0) + 1); }
  const placeValid = place.filter((p) => p[2] !== -3);
  const placeT = (col) => ({ top1: placeValid.filter((p) => p[col] === 0).length, visible: placeValid.filter((p) => p[col] >= 0 && p[col] < VISIBLE).length, absent: placeValid.filter((p) => p[col] < 0).length });
  for (const p of placeValid) {
    const id = 'loc:' + p[0];
    if (R.normHe(p[1]).length < 2) { tooShort.push({ id, name: p[1], form: 'place' }); continue; }
    if (!(p[2] >= 0 && p[2] < VISIBLE)) {
      const c = crowded(p[1], id);
      /* the name alone: crowded when the list ahead holds only localities and exact (tier ≤ 5) streets */
      const m = R.searchGeo(p[1], 80).matches, j = m.findIndex((x) => x.id === id);
      const ahead = j >= 0 ? m.slice(0, j) : m;   // not among 80 rows: every one of the 80 is ahead of it
      const full = (j >= VISIBLE || (j < 0 && m.length >= 80)) && ahead.every((x) => x.kind === 'locality' || (x.tier || 9) <= 5);
      if (full || placeSame.get(R.normHe(p[1])) > VISIBLE || c.crowded) ambOther.push({ id, name: p[1], form: 'place', rank: j }); else failures.push({ id, name: p[1], form: 'place', rank: p[2] });
    }
    if (!(p[3] >= 0 && p[3] < VISIBLE)) { if (/-$/.test(p[1].trim())) defects.push({ id, name: p[1], form: 'place-named', rank: p[3] }); else failures.push({ id, name: p[1], form: 'place-named', rank: p[3] }); }
  }
  const out = {
    engine: 'propx-search-audit-1', builtAt: new Date().toISOString(), visibleRows: VISIBLE,
    pinned: { directory: D.fileHash.directory, synonyms: D.fileHash.synonyms, searchIndex: sha('data/geo/streets/search-index.json'), code: codeHash() },
    universe: { searchableRows: rows.length, current: cur.length, historical: hist.length, byKind: Object.fromEntries(['street', 'area', 'site'].map((k) => [k, rows.filter((r) => byId.get(r[0]).kind === k).length])),
      synonyms: syn.length, synonymsWithoutCurrentStreet: syn.length - synValid.length, placeNames: place.length, placeNamesWithoutLocality: place.length - placeValid.length },
    forms: { near: T(rows, 2), named: T(rows, 3), plain: T(rows, 4), synonymNear: T(synValid, 2), synonymNamed: T(synValid, 3), place: placeT(2), placeNamed: placeT(3) },
    plainAmbiguous: ambiguous,
    otherAmbiguous: { total: ambOther.length, byForm: ambOther.reduce((a, f) => ((a[f.form] = (a[f.form] || 0) + 1), a), {}), list: ambOther },
    tooShort: { total: tooShort.length, rule: 'a name of one character is never searched (the page and the API need two)', list: tooShort },
    sourceDefects: { total: defects.length, rule: 'an official name the directory cut mid-word ending in "-": found by the name alone; typed before a locality the hyphen joins the locality name — a source defect, not a search miss', list: defects },
    failures: { total: failures.length, byForm: failures.reduce((a, f) => ((a[f.form] = (a[f.form] || 0) + 1), a), {}), list: failures },
    ms: parts.reduce((a, p) => a + p.ms, 0),
  };
  fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ universe: out.universe, forms: out.forms, ambiguous: ambiguous.count, byRule: ambiguous.byRule, otherAmbiguous: out.otherAmbiguous.byForm, tooShort: tooShort.length, sourceDefects: defects.length, failures: out.failures.byForm }, null, 1));
}

if (process.argv.includes('--merge')) merge(); else shard();
