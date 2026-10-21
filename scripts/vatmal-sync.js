#!/usr/bin/env node
// PROPX · VATMAL declared complexes — sync (lib/planning/vatmal.js). Reads every feature of the Planning Administration's declared-complexes
// layer (ArcGIS REST query, GET, outSR 4326, ~10 m generalization) on a GitHub runner (ags.iplan.gov.il is not reachable from the sandbox).
// The read is COMPLETE only when the stored complexes + the features skipped for a stated reason equal the layer's own count — otherwise
// nothing is written and the previous file stands. Writes data/planning/vatmal/{complexes.json.gz, meta.json, history/, runs.jsonl}.
//
//   node scripts/vatmal-sync.js [--dry-run] [--summary-file <path>]
// Exit: 0 written / unchanged · 1 failed (the previous data kept; the run log says why).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const V = require('../lib/planning/vatmal');

const UA = 'PROPX-vatmal/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(params) {
  const u = new URL(V.LAYER + '/query');
  for (const [k, v] of Object.entries({ f: 'json', ...params })) u.searchParams.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
      const j = JSON.parse(await r.text());
      if (j.error) throw new Error(`HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`);
      await sleep(1000);
      return j;
    } catch (e) { if (attempt >= 4) throw e; await sleep(5000 * attempt); }
  }
}

(async () => {
  const startedAt = new Date().toISOString();
  const run = { id: 'vatmal-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: V.SOURCE.id, startedAt, status: 'failed' };
  try {
    const count = (await query({ where: '1=1', returnCountOnly: 'true' })).count;
    if (!Number.isFinite(count) || count < 50) throw new Error('implausible layer count: ' + count);
    const feats = [];
    for (let offset = 0; offset < count; offset += 500) {
      const j = await query({ where: '1=1', outFields: V.FIELDS.join(','), returnGeometry: 'true', outSR: 4326, maxAllowableOffset: 0.0001, geometryPrecision: 5, orderByFields: 'OBJECTID', resultOffset: offset, resultRecordCount: 500 });
      if (!Array.isArray(j.features)) throw new Error('no features array');
      feats.push(...j.features);
      if (!j.features.length) break;
    }
    const oids = new Set(feats.map((f) => f.attributes && f.attributes.OBJECTID));
    if (feats.length !== count || oids.size !== count) throw new Error(`incomplete read: ${feats.length} features (${oids.size} distinct) of ${count}`);
    const complexes = [], skipped = { noGeometryOrNumber: 0 };
    for (const f of feats) { const c = V.normalize(f); if (c) complexes.push(c); else skipped.noGeometryOrNumber++; }
    if (complexes.length + skipped.noGeometryOrNumber !== count) throw new Error('accounting mismatch');
    complexes.sort((a, b) => a.oid - b.oid);
    const body = JSON.stringify(complexes), hash = crypto.createHash('sha256').update(body).digest('hex');
    if (has('dry-run')) { console.log(JSON.stringify({ count, stored: complexes.length, skipped, sample: complexes.slice(0, 2).map((c) => ({ ...c, rings: `${c.rings.length} ring(s)` })) }, null, 1)); return; }
    fs.mkdirSync(path.join(V.DIR, 'history'), { recursive: true });
    let prev = null; try { prev = JSON.parse(fs.readFileSync(path.join(V.DIR, 'meta.json'), 'utf8')); } catch { /* first run */ }
    const changed = !prev || prev.contentHash !== hash;
    if (changed) { const gz = zlib.gzipSync(body); fs.writeFileSync(path.join(V.DIR, 'complexes.json.gz'), gz); fs.writeFileSync(path.join(V.DIR, 'history', `${startedAt.slice(0, 10)}-${hash.slice(0, 8)}.json.gz`), gz); }
    const units = complexes.reduce((a, c) => a + (c.units || 0), 0);
    const meta = { schema: 1, engine: 'propx-vatmal-1', source: V.SOURCE, fetchedAt: startedAt, readAt: changed ? startedAt : prev.readAt, layerCount: count, stored: complexes.length, skipped, complete: true,
      contentHash: hash, declaredUnitsSum: units, declared: [complexes.map((c) => c.declared).filter(Boolean).sort()[0] || null, complexes.map((c) => c.declared).filter(Boolean).sort().pop() || null],
      latestUpdate: complexes.flatMap((c) => c.updates).sort().pop() || null, history: fs.readdirSync(path.join(V.DIR, 'history')).sort(),
      note: 'declared complexes — a planning-track designation, never an approved plan, a permit or construction; the declared units are the declaration\'s' };
    fs.writeFileSync(path.join(V.DIR, 'meta.json'), JSON.stringify(meta, null, 1));
    Object.assign(run, { status: changed ? 'success' : 'unchanged', finishedAt: new Date().toISOString(), layerCount: count, stored: complexes.length, contentHash: hash });
    const summary = `VATMAL declared complexes: ${changed ? 'changed' : 'unchanged'} · ${complexes.length} / ${count} complexes · ${units.toLocaleString('en')} declared units (the declarations' own)`;
    console.log(summary); const sf = argVal('summary-file'); if (sf) fs.appendFileSync(sf, summary + '\n');
  } catch (e) {
    Object.assign(run, { finishedAt: new Date().toISOString(), error: String(e.message).slice(0, 300) });
    console.error('VATMAL sync FAILED — ' + run.error); process.exitCode = 1;
  }
  if (!has('dry-run')) { fs.mkdirSync(V.DIR, { recursive: true }); fs.appendFileSync(path.join(V.DIR, 'runs.jsonl'), JSON.stringify(run) + '\n'); }
})();
