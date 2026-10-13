// PROPX · Urban renewal × XPlan — file store (data/renewal/):
//   planning.json            {meta, lookups: {planKeys, mavatIds}, plans: [one XPlan plan per line]}
//   plan-geometry.json       {mpId: outline} — the plan boundaries (WGS84, generalized), read only for one complex
//   planning-history.jsonl   every change of a plan's stage / status / units / dates / number, as observed
//   planning-runs.jsonl      one line per run
// Upsert on the plan's main id (mp_id); a plan that a successful lookup no longer returns is kept with inLatestSource:false;
// a plan whose lookup failed this run is kept as it was. Nothing is deleted.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HISTORY_FIELDS = ['planNumber', 'name', 'station', 'event', 'stage', 'existingAuthorisedUnits', 'planUnitDelta', 'dates', 'lastUpdate', 'kind', 'url'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/* records stored before 13.10.2026 carry the same two raw values under unitsApprovedState / unitsChange — renamed, never a
   change of value (no history event); the raw pair is kept in raw */
function upgrade(p) {
  if (!p || 'existingAuthorisedUnits' in p || !('unitsApprovedState' in p || 'unitsChange' in p)) return p;
  const { unitsApprovedState, unitsChange, ...rest } = p;
  return { ...rest, raw: { pq_authorised_quantity_120: unitsApprovedState ?? null, quantity_delta_120: unitsChange ?? null }, existingAuthorisedUnits: unitsApprovedState ?? null, planUnitDelta: unitsChange ?? null };
}

/**
 * prev / fresh: plan records. askedKeys / askedIds: what this run's successful batches really looked up.
 * A previous plan absent from `fresh` is "gone" only when its own number or id was asked successfully.
 */
function mergePlans(prev, fresh, { fetchedAt, runId = null, askedKeys = [], askedIds = [] }) {
  prev = (prev || []).map(upgrade);
  const byId = new Map(prev.map((p) => [p.id, p])), seen = new Set(), out = [], history = [];
  const stats = { inserted: 0, updated: 0, unchanged: 0, gone: 0, keptUnchecked: 0 };
  for (const p of fresh) {
    seen.add(p.id);
    const old = byId.get(p.id);
    if (!old) { out.push({ ...p, firstSeenAt: fetchedAt, inLatestSource: true }); stats.inserted++; continue; }
    const changes = HISTORY_FIELDS.filter((k) => !same(old[k], p[k]));
    for (const k of changes) history.push({ id: p.id, mpId: p.mpId, field: k, from: old[k] ?? null, to: p[k] ?? null, observedAt: fetchedAt, runId });
    if (old.inLatestSource === false) history.push({ id: p.id, mpId: p.mpId, field: 'inLatestSource', from: false, to: true, observedAt: fetchedAt, runId });
    out.push({ ...p, firstSeenAt: old.firstSeenAt || fetchedAt, inLatestSource: true });
    if (changes.length || old.inLatestSource === false) stats.updated++; else stats.unchanged++;
  }
  const keys = new Set(askedKeys), ids = new Set(askedIds.map(Number));
  for (const old of prev || []) {
    if (seen.has(old.id)) continue;
    const asked = keys.has(old.planKey) || ids.has(Number(old.mpId));
    if (asked && old.inLatestSource !== false) {
      history.push({ id: old.id, mpId: old.mpId, field: 'inLatestSource', from: true, to: false, observedAt: fetchedAt, runId });
      out.push({ ...old, inLatestSource: false, lastSeenAt: old.provenance && old.provenance.fetchedAt || null }); stats.gone++;
    } else { out.push(old); if (!asked) stats.keptUnchecked++; }
  }
  out.sort((a, b) => a.mpId - b.mpId);
  return { plans: out, history, stats };
}

class FilePlanningStore {
  constructor(dir) { this.dir = dir; }
  p(f) { return path.join(this.dir, f); }
  read(f, d) { try { return JSON.parse(fs.readFileSync(this.p(f), 'utf8')); } catch { return d; } }
  readPlanning() { return this.read('planning.json', null); }
  readGeometry() { return this.read('plan-geometry.json', {}); }
  readLines(f) { let t = ''; try { t = fs.readFileSync(this.p(f), 'utf8'); } catch { return []; } return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  readRuns() { return this.readLines('planning-runs.jsonl'); }
  readHistory() { return this.readLines('planning-history.jsonl'); }
  write({ planning, geometry, history = [], run }) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (planning) {
      const { plans = [], ...rest } = planning;
      const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
      fs.writeFileSync(this.p('planning.json'), head + ',\n "plans": [\n' + plans.map((x) => JSON.stringify(x)).join(',\n') + '\n ]\n}\n');
    }
    if (geometry) fs.writeFileSync(this.p('plan-geometry.json'), '{\n' + Object.keys(geometry).sort((a, b) => a - b).map((k) => JSON.stringify(String(k)) + ':' + JSON.stringify(geometry[k])).join(',\n') + '\n}\n');
    if (history.length) fs.appendFileSync(this.p('planning-history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');
    if (run) fs.appendFileSync(this.p('planning-runs.jsonl'), JSON.stringify(run) + '\n');
  }
}

module.exports = { mergePlans, FilePlanningStore, HISTORY_FIELDS, upgrade };
