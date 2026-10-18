// PROPX · CBS construction — one sync run (the core scripts/construction-sync.js wraps; the fetcher is injected so the
// whole run is tested offline on the fixture, test/construction.test.js).
//
//   1. resolve the geography nodes of every measure from the catalogue (lib/construction/resolve.js)
//   2. request every resolved geography (≤ 6-year windows from 2016), parse (lib/construction/parse.js)
//   3. merge into the append-only ledger (lib/construction/ledger.js), write the raw bundle once per content hash,
//      the payload (lib/construction/snapshot.js), the resolution evidence and the run-log line
//
// Run state (data/construction/sync-runs.jsonl):
//   SUCCESS         new or revised values               UNCHANGED  every request answered, nothing new
//   PARTIAL         some geographies not read (catalogue mismatch / unresolved, or a request failed) — their last data kept, marked
//   FAILED          nothing usable (nothing but the run log written)
//   REFUSED         every failure was HTTP 401 / 403 / 429 and nothing was read
//   SCHEMA_CHANGED  nothing read and the catalogue or a response came in a shape PROPX does not recognize — nothing applied
// A failed request never becomes 0 and never removes a stored value. Exit codes (the CLI): 0 SUCCESS / UNCHANGED ·
// 2 PARTIAL · 1 FAILED / REFUSED / SCHEMA_CHANGED.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { plan, GEOS, MEASURE_IDS } = require('./series');
const { resolveAll, finalize, summarize, errorKind } = require('./resolve');
const { parseResponse } = require('./parse');
const { merge } = require('./ledger');
const { buildPayload } = require('./snapshot');

const FILES = { ledger: 'observations.jsonl', runs: 'sync-runs.jsonl', latest: 'latest.json', resolution: 'geo-resolution.json', raw: 'raw' };

function readLines(f) {
  let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; }
  return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** the latest national period per measure among this run's observations, on the finest kind the source gave */
function latestByMeasure(obs) {
  const out = {};
  for (const m of MEASURE_IDS) {
    const nat = obs.filter((o) => o.measure === m && o.geo === 'il' && o.freq !== 'Y');
    const freq = nat.some((o) => o.freq === 'M') ? 'M' : nat.some((o) => o.freq === 'Q') ? 'Q' : null;
    out[m] = freq ? { freq, period: nat.filter((o) => o.freq === freq).map((o) => o.period).sort().pop() } : null;
  }
  return out;
}

/**
 * @param {object} o  { dir, fetchJson(url) → { json, text }, now?, dryRun?, log? }
 * @returns {{ status, summary, runEntry, resolution, results, merge, payload? }}
 */
async function runSync({ dir, fetchJson, now = new Date(), dryRun = false, log = () => {} }) {
  const at = now.toISOString();
  const records = readLines(path.join(dir, FILES.ledger));
  const prev = readJson(path.join(dir, FILES.latest));
  const bundle = [];
  /* 1 · the catalogue */
  const resolution = await resolveAll({ fetchJson, bundle, now });
  /* 2 · the data */
  const reqs = plan(resolution, now), results = [];
  for (const q of reqs) {
    try {
      const { json, text } = await fetchJson(q.url);
      bundle.push({ url: q.url, body: text });
      results.push({ ...q, ok: true, parsed: parseResponse(json, q) });
    } catch (e) { results.push({ ...q, ok: false, error: e.message, kind: errorKind(e) }); }
  }
  /* the responses finish the resolution: a pending geography a response named is resolved; a name mismatch disqualifies it */
  finalize(resolution, results);
  const statusOf = (r) => resolution.measures[r.measure].geos[r.geo].status;
  const ok = results.filter((r) => r.ok && statusOf(r) === 'resolved'), bad = results.filter((r) => !r.ok);
  /* what did not answer, by measure|geo: unresolved / mismatched / never-named geographies and failed requests */
  const failed = new Set(), errors = {}, kinds = [];
  for (const m of MEASURE_IDS) {
    const R = resolution.measures[m];
    if (!R.ok) { kinds.push(R.errorKind); for (const g of GEOS) { failed.add(`${m}|${g.key}`); errors[`${m}|${g.key}`] = `catalogue ${R.path}: ${R.error}`; } continue; }
    for (const g of GEOS) { const x = R.geos[g.key]; if (x.status !== 'resolved') { failed.add(`${m}|${g.key}`); errors[`${m}|${g.key}`] = x.reason; if (x.errorKind) kinds.push(x.errorKind); } }
  }
  for (const r of bad) { failed.add(`${r.measure}|${r.geo}`); errors[`${r.measure}|${r.geo}`] = r.error; kinds.push(r.kind); }
  /* a series answered in full only when every window of it answered */
  const badKeys = new Set(bad.map((r) => `${r.measure}|${r.cbs}`));
  const answered = new Set(ok.map((r) => `${r.measure}|${r.cbs}`).filter((k) => !badKeys.has(k)));
  const sha = crypto.createHash('sha256').update(JSON.stringify(bundle.map((b) => [b.url, b.body]))).digest('hex');
  const incoming = ok.flatMap((r) => r.parsed.obs);   /* only geographies a name verified — pending / mismatched ones are never applied */
  const m = merge(records, incoming, { fetchedAt: at, snapshot: sha.slice(0, 16), answered });
  const status = !ok.length
    ? (kinds.length && kinds.every((k) => k === 'refused') ? 'REFUSED' : kinds.some((k) => k === 'schema') ? 'SCHEMA_CHANGED' : 'FAILED')
    : failed.size ? 'PARTIAL' : m.append.length ? 'SUCCESS' : 'UNCHANGED';
  const latest = latestByMeasure(incoming);
  const errText = [...Object.entries(errors)].map(([k, v]) => `${k}: ${v}`);
  const runEntry = { id: 'construction:' + at, startedAt: at, finishedAt: new Date().toISOString(), status: status.toLowerCase(), state: status,
    requests: resolution.requests + reqs.length, catalogueRequests: resolution.requests, dataRequests: reqs.length, answered: results.filter((r) => r.ok).length, applied: ok.length, failed: bad.length,
    added: m.added, revised: m.revised, unchanged: m.unchanged, missingInSource: m.missingInSource.length, latest, resolution: summarize(resolution),
    snapshot: bundle.length ? sha.slice(0, 16) : null, contentChanged: m.append.length > 0, ...(errText.length ? { error: errText.slice(0, 6).join(' | ') } : {}) };
  const per = MEASURE_IDS.map((x) => `${x} ${latest[x] ? `${latest[x].freq} ${latest[x].period}` : '—'}`).join(' · ');
  const summary = `CBS construction: ${status} — ${per} · ${ok.length}/${reqs.length} requests · +${m.added} new · ${m.revised} revised`;
  log(summary);
  for (const [k, v] of Object.entries(errors)) log('  NOT READ', k, v);
  for (const r of m.append.filter((x) => x.revision > 0)) log(`  REVISED ${r.key}: ${r.replaces} → ${r.value}`);
  if (m.missingInSource.length) log('  no longer in the source (kept):', m.missingInSource.slice(0, 10).join(', '));
  const out = { status, summary, runEntry, resolution, results, merge: m, bundle };
  if (dryRun) return out;
  /* 3 · write — the run log always; data only when something was read */
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, FILES.runs), JSON.stringify(runEntry) + '\n');
  if (!ok.length) return out;
  const rawDir = path.join(dir, FILES.raw);
  fs.mkdirSync(rawDir, { recursive: true });
  if (!fs.readdirSync(rawDir).some((f) => f.includes(sha.slice(0, 16)))) {
    fs.writeFileSync(path.join(rawDir, `${at.slice(0, 10)}-${sha.slice(0, 16)}.json.gz`), zlib.gzipSync(JSON.stringify({ fetchedAt: at, sha256: sha, responses: bundle })));
  }
  if (m.append.length) fs.appendFileSync(path.join(dir, FILES.ledger), m.append.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const all = records.concat(m.append);
  const payload = buildPayload(all, { at, status, failed, errors, checkedAt: at }, prev, resolution);
  fs.writeFileSync(path.join(dir, FILES.latest), JSON.stringify(payload, null, 1) + '\n');
  fs.writeFileSync(path.join(dir, FILES.resolution), JSON.stringify({ at, note: 'the catalogue nodes resolved for this run — evidence of the code ↔ name verification; the codes key the data, the names are labels', measures: resolution.measures }, null, 1) + '\n');
  return { ...out, payload };
}

const exitCodeOf = (status) => (status === 'SUCCESS' || status === 'UNCHANGED' ? 0 : status === 'PARTIAL' ? 2 : 1);

module.exports = { runSync, latestByMeasure, exitCodeOf, readLines, readJson, FILES };
