// PROPX · Urban renewal — file store (data/renewal/): complexes.json (one record per line), meta.json, history.jsonl
// (every change of a source field), sync-runs.jsonl, raw/<date>-<hash>.json.gz (the source rows when their content
// changed). Upsert on the Ministry's complex number; firstSeenAt kept; a complex missing from the source is kept with
// inLatestSource:false — never deleted.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { HISTORY_FIELDS } = require('./normalize');

const NOT_FACTS = new Set(['provenance', 'missing', 'firstSeenAt', 'lastSeenAt', 'inLatestSource']);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function mergeRecords(prev, next, { fetchedAt, syncRunId = null, prevCheckedAt = null }) {
  const byId = new Map(prev.map((r) => [r.id, r]));
  const out = [], history = [], stats = { inserted: 0, updated: 0, unchanged: 0, missingFromSource: 0 };
  const seen = new Set();
  for (const rec of next) {
    seen.add(rec.id);
    const old = byId.get(rec.id);
    if (!old) { out.push({ ...rec, firstSeenAt: fetchedAt, inLatestSource: true }); stats.inserted++; continue; }
    for (const k of HISTORY_FIELDS) if (!same(old[k], rec[k])) history.push({ id: rec.id, field: k, from: old[k] ?? null, to: rec[k] ?? null, observedAt: fetchedAt, syncRunId });
    if (old.inLatestSource === false) history.push({ id: rec.id, field: 'inLatestSource', from: false, to: true, observedAt: fetchedAt, syncRunId });
    const facts = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !NOT_FACTS.has(k)).sort()));
    if (facts(old) !== facts(rec) || old.inLatestSource === false) { out.push({ ...rec, firstSeenAt: old.firstSeenAt, inLatestSource: true }); stats.updated++; }
    else { out.push({ ...old, provenance: { ...old.provenance, fetchedAt: rec.provenance.fetchedAt }, inLatestSource: true }); stats.unchanged++; }
  }
  for (const old of prev) {
    if (seen.has(old.id)) continue;
    stats.missingFromSource++;
    if (old.inLatestSource !== false) { history.push({ id: old.id, field: 'inLatestSource', from: true, to: false, observedAt: fetchedAt, syncRunId }); out.push({ ...old, inLatestSource: false, lastSeenAt: prevCheckedAt || null }); }
    else out.push(old);
  }
  out.sort((a, b) => a.complexId - b.complexId);
  return { records: out, history, stats };
}

const linesJson = (arr) => '[\n' + arr.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';

class FileRenewalStore {
  constructor(dir) { this.dir = dir; }
  p(f) { return path.join(this.dir, f); }
  read(f, d) { try { return JSON.parse(fs.readFileSync(this.p(f), 'utf8')); } catch { return d; } }
  readRecords() { return this.read('complexes.json', []); }
  readMeta() { return this.read('meta.json', null); }
  readLines(f) { let t = ''; try { t = fs.readFileSync(this.p(f), 'utf8'); } catch { return []; } return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  readRuns() { return this.readLines('sync-runs.jsonl'); }
  readHistory() { return this.readLines('history.jsonl'); }
  snapshotRaw(rows, hash, fetchedAt, extra = {}) {
    fs.mkdirSync(this.p('raw'), { recursive: true });
    const name = `${String(fetchedAt).slice(0, 10)}-${String(hash).slice(0, 12)}.json.gz`;
    if (fs.readdirSync(this.p('raw')).some((f) => f.includes(String(hash).slice(0, 12)))) return null;
    fs.writeFileSync(this.p('raw/' + name), zlib.gzipSync(JSON.stringify({ fetchedAt, hash, ...extra, rows })));
    return name;
  }
  write({ records, history = [], meta, run }) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (records) fs.writeFileSync(this.p('complexes.json'), linesJson(records));
    if (history.length) fs.appendFileSync(this.p('history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');
    if (meta) fs.writeFileSync(this.p('meta.json'), JSON.stringify(meta, null, 1) + '\n');
    if (run) fs.appendFileSync(this.p('sync-runs.jsonl'), JSON.stringify(run) + '\n');
  }
}

module.exports = { mergeRecords, FileRenewalStore, linesJson };
