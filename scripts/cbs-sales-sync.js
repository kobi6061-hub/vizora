#!/usr/bin/env node
// PROPX · CBS new-home sales — sync of the official monthly series (national + 7 districts).
//
// Reads the CBS time-series API (lib/cbs-sales/series.js: new dwellings sold, of which subsidized, new dwellings
// remaining for sale, months of supply), keeps every published value in an append-only ledger with its revisions,
// stores each raw response bundle once per content hash, and writes the page payload. Runs on a GitHub runner
// (.github/workflows/cbs-sales-sync.yml) — the Claude sandbox cannot reach the CBS hosts.
//
//   node scripts/cbs-sales-sync.js                 fetch → merge → write data/cbs-sales/
//   node scripts/cbs-sales-sync.js --dry-run       fetch and print, write nothing
//   node scripts/cbs-sales-sync.js --validate      re-fetch from CBS and compare every stored current value of
//                                                  the latest 13 months with the original response (independent check)
//   --out <dir>   --summary-file <path>
//
// Status (runs.jsonl): SUCCESS (new or revised values) · UNCHANGED · PARTIAL (some requests failed — their series keep
// their last values, marked stale) · FAILED (nothing usable — nothing but the run log written).
// A failed request never becomes 0 and never removes a stored value.
// Exit: 0 SUCCESS / UNCHANGED · 2 PARTIAL · 1 FAILED or a validation mismatch.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { plan, UA, GEO_BY_CBS, MEASURES } = require('../lib/cbs-sales/series');
const { parseResponse } = require('../lib/cbs-sales/parse');
const { merge, currentOf } = require('../lib/cbs-sales/ledger');
const { buildPayload, toJs } = require('../lib/cbs-sales/snapshot');
const { addM } = require('../lib/cbs-sales/metrics');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const DIR = path.resolve(argVal('out') || path.join(__dirname, '..', 'data', 'cbs-sales'));
const TIMEOUT = 30000;

function readLines(f) {
  let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; }
  return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  const text = (await r.text()).replace(/^﻿/, '');
  try { return { json: JSON.parse(text), text }; } catch { throw new Error(`not JSON (${r.headers.get('content-type')}) from ${url}`); }
}

/** fetch every planned request, one at a time; never throws */
async function fetchAll(now) {
  const reqs = plan(now), results = [];
  for (const q of reqs) {
    try {
      const { json, text } = await getJson(q.url);
      const parsed = parseResponse(json, q);
      results.push({ ...q, ok: true, text, parsed });
    } catch (e) {
      results.push({ ...q, ok: false, error: e.message });
    }
  }
  return results;
}

async function validate() {
  /* independent validation: the stored current values against a fresh read of the original CBS responses */
  const records = readLines(path.join(DIR, 'observations.jsonl'));
  const cur = currentOf(records);
  if (!cur.size) { console.error('nothing stored to validate'); process.exitCode = 1; return; }
  const results = await fetchAll(new Date());
  let compared = 0, mismatched = 0, missing = 0;
  const bySeries = {};
  for (const r of results) {
    if (!r.ok) { console.log(`  REQUEST FAILED ${r.measure} ${r.cbs} ${r.window.join('-')}: ${r.error}`); continue; }
    for (const o of r.parsed.obs) {
      const k = `${o.measure}|${o.cbs}|${o.freq}|${o.period}`, s = cur.get(k);
      const latest = [...cur.values()].filter((x) => x.measure === o.measure && x.cbs === o.cbs && x.freq === 'M').map((x) => x.period).sort().pop();
      if (o.freq !== 'M' || !latest || o.period < addM(latest, -12)) continue;   /* the latest 13 months of each series */
      const tag = `${o.measure} ${GEO_BY_CBS[o.cbs].en}`;
      const b = bySeries[tag] = bySeries[tag] || { n: 0, bad: [] };
      compared++; b.n++;
      if (!s) { missing++; b.bad.push(`${o.period}: CBS ${o.value}, PROPX none`); continue; }
      if (s.value !== o.value) { mismatched++; b.bad.push(`${o.period}: CBS ${o.value}, PROPX ${s.value}`); }
    }
  }
  console.log(`\nVALIDATION — PROPX stored values vs a fresh read of the original CBS API responses (${new Date().toISOString()})`);
  for (const [tag, b] of Object.entries(bySeries)) console.log(`  ${b.bad.length ? 'MISMATCH' : 'MATCH   '}  ${tag.padEnd(48)} ${b.n} months${b.bad.length ? ' — ' + b.bad.join('; ') : ''}`);
  console.log(`  ${compared} values compared · ${mismatched} different · ${missing} not stored`);
  if (mismatched || missing) process.exitCode = 1;
}

(async () => {
  if (has('validate')) return validate();
  const now = new Date(), at = now.toISOString();
  const records = readLines(path.join(DIR, 'observations.jsonl'));
  const prev = readJson(path.join(DIR, 'latest.json'));
  const results = await fetchAll(now);
  const ok = results.filter((r) => r.ok), bad = results.filter((r) => !r.ok);
  const failed = new Set(bad.map((r) => `${r.measure}|${r.cbs}`)), errors = {};
  for (const r of bad) errors[`${r.measure}|${r.cbs}`] = r.error;
  /* a series answered in full only when every window of it answered */
  const answered = new Set(ok.map((r) => `${r.measure}|${r.cbs}`).filter((k) => !failed.has(k)));
  const bundle = ok.map((r) => ({ url: r.url, body: r.text }));
  const sha = crypto.createHash('sha256').update(JSON.stringify(bundle.map((b) => [b.url, b.body]))).digest('hex');
  const incoming = ok.flatMap((r) => r.parsed.obs);
  const m = merge(records, incoming, { fetchedAt: at, snapshot: sha.slice(0, 16), answered });
  const status = !ok.length ? 'FAILED' : bad.length ? 'PARTIAL' : m.append.length ? 'SUCCESS' : 'UNCHANGED';
  const latestSeen = incoming.filter((o) => o.measure === 'new_sold' && o.cbs === 5069 && o.freq === 'M').map((o) => o.period).sort().pop() || null;
  const runEntry = { id: 'cbs-sales:' + at, startedAt: at, finishedAt: new Date().toISOString(), status: status.toLowerCase(), state: status,
    requests: results.length, answered: ok.length, failed: bad.length, added: m.added, revised: m.revised, unchanged: m.unchanged,
    missingInSource: m.missingInSource.length, latestPeriod: latestSeen, snapshot: ok.length ? sha.slice(0, 16) : null,
    contentChanged: m.append.length > 0, ...(bad.length ? { error: bad.map((r) => `${r.measure} ${r.cbs} ${r.window.join('-')}: ${r.error}`).slice(0, 5).join(' | ') } : {}) };
  const summary = `CBS new-home sales: ${status} — ${ok.length}/${results.length} requests · +${m.added} new · ${m.revised} revised · latest ${latestSeen || '—'}`;
  console.log(summary);
  for (const r of bad) console.log('  FAILED', r.measure, r.cbs, r.window.join('-'), r.error);
  for (const r of m.append.filter((x) => x.revision > 0)) console.log(`  REVISED ${r.key}: ${r.replaces} → ${r.value}`);
  if (m.missingInSource.length) console.log('  no longer in the source (kept):', m.missingInSource.slice(0, 10).join(', '));
  if (has('dry-run')) {
    for (const r of ok.slice(0, 3)) console.log('  ', r.url, r.parsed.series.map((s) => `${s.id}:${s.freq}/${s.kind}/${s.n}`).join(' '));
    /* the whole-market measures: how each code resolved (the district is read from the name the API returns) */
    for (const r of ok.filter((x) => MEASURES[x.measure].market)) { const o = r.parsed.obs.filter((x) => x.freq === 'M').sort((a, b) => (a.period < b.period ? -1 : 1)); const l = o[o.length - 1];
      console.log(`  MARKET ${r.measure} ${r.cbs} ${r.window.join('-')} → ${l ? `${l.geo} "${l.geoName || ''}" · ${o.length} months · latest ${l.period} = ${l.value}` : 'no monthly observations'}`); }
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(path.join(DIR, 'runs.jsonl'), JSON.stringify(runEntry) + '\n');
  if (status === 'FAILED') { process.exitCode = 1; if (argVal('summary-file')) fs.writeFileSync(argVal('summary-file'), summary + '\n'); return; }
  /* raw snapshot: the exact response bodies, once per content hash */
  const rawDir = path.join(DIR, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const rawFile = path.join(rawDir, `${at.slice(0, 10)}-${sha.slice(0, 16)}.json.gz`);
  if (!fs.readdirSync(rawDir).some((f) => f.includes(sha.slice(0, 16)))) fs.writeFileSync(rawFile, zlib.gzipSync(JSON.stringify({ fetchedAt: at, sha256: sha, responses: bundle })));
  if (m.append.length) fs.appendFileSync(path.join(DIR, 'observations.jsonl'), m.append.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const all = records.concat(m.append);
  const payload = buildPayload(all, { at, status, failed, errors, checkedAt: at }, prev);
  fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(payload, null, 1) + '\n');
  fs.writeFileSync(path.join(DIR, 'latest.js'), toJs(payload));
  if (argVal('summary-file')) fs.writeFileSync(argVal('summary-file'), summary + '\n');
  if (status === 'PARTIAL') process.exitCode = 2;
})().catch((e) => { console.error(e); process.exitCode = 1; });
