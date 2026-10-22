#!/usr/bin/env node
// PROPX · the NATIONAL STRATIFIED COVERAGE AUDIT of the transaction events (lib/txevents) → data/txevents/coverage-audit.json.
//   node scripts/txevents-audit.js
// Offline. Every swept locality, stratified by district (Judea & Samaria included) and by size; a deterministic sample of streets per
// district — high-volume, low-volume, streets with official synonyms, streets with few known addresses, streets reached through parcel
// recovery; new construction and older housing by the register's build year. Measured: the latest event per source and of the union,
// events the GovMap layer holds that the register copy does not (source-only), duplicate rate, unresolved identity, events recovered
// through the parcel — and MISSED: GovMap rows of the locality / street that the union does not surface (must be 0). A GovMap row FOLDED
// into a register event the same read shows (the register's deals under unmapped settlement names, placed by parcel — lib/txevents/history.js
// fold) is that deal's source evidence: counted as `folded`, never as missed (lib/txevents/kit.js surfaceAccount, 22.10.2026).
// Population group (e.g. Arab localities) is NOT stratified: PROPX holds no official population-group field for a locality.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TX = require('../lib/txevents');
const EV = require('../lib/streets/evidence');
const RECENT = require('../lib/recent/read');
const KIT = require('../lib/txevents/kit');

const ROOT = path.join(__dirname, '..');
const today = process.argv.includes('--today') ? process.argv[process.argv.indexOf('--today') + 1] : new Date().toISOString().slice(0, 10);
const S = TX.stores();
const D = require('../lib/streets/directory').load();
const L = RECENT.load();
const nat = S.national;
const natAcc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'txevents', 'national', 'accounting.json'), 'utf8'));
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const max = (xs) => xs.filter(Boolean).sort().pop() || null;

/* every swept locality + every locality only the GovMap layer reaches (no register shard): their rows must surface too */
const codeSet = new Set(fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x)).map((x) => Number(x.replace('.json', ''))).filter((c) => EV.shardOf(c)));
for (const byCode of [L.layer && L.layer.byCode, nat && nat.byCode]) for (const k of Object.keys(byCode || {})) codeSet.add(Number(k));
const codes = [...codeSet].filter((c) => Number.isFinite(c) && c > 0).sort((a, b) => a - b);
const locs = [];
/* a row's event id by the union's own rule (lib/txevents/index.js gmEvent: the deal id, else the object id) */
const gmRowsOf = (code) => {
  const ids = [];
  if (L.layer) for (const i of L.layer.byCode[String(code)] || []) { const r = L.layer.rows[i]; ids.push({ id: KIT.gmIdOf({ dealId: r[1], oid: r[0] }), streetCode: r[15], cityCode: r[11] }); }
  if (nat) for (const i of nat.byCode[String(code)] || []) { const r = nat.rows[i]; ids.push({ id: KIT.gmIdOf({ dealId: r[1], oid: r[0] }), streetCode: r[15], cityCode: r[11] }); }
  return ids;
};
/* MISSED = a GovMap row that is neither an event of the read nor FOLDED into a register event the read shows (lib/txevents/kit.js
   surfaceAccount) — a folded row is that register deal's source evidence, never a lost deal */
const foldsByCode = new Map();
const foldsOf = (code) => { if (!foldsByCode.has(code)) foldsByCode.set(code, KIT.foldsOf(TX.layerEventsOf(code, S).evidence)); return foldsByCode.get(code); };
for (const code of codes) {
  const q = TX.query({ code, all: true, unlimited: true, today });
  const ev = q.events, counted = ev.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
  const reg = counted.filter((e) => e.source === 'register'), gm = counted.filter((e) => e.source === 'govmap');
  const ids = new Set(ev.map((e) => e.id));
  const gmRows = gmRowsOf(code);
  const account = KIT.surfaceAccount(gmRows.map((r) => r.id), ids, foldsOf(code));
  const missed = account.missed, folded = account.folded;
  const acc = natAcc.byCode[String(code)] || {};
  const rows = Object.values(acc).reduce((a, b) => a + b, 0);
  const dup = (acc.IN_REGISTER || 0) + (acc.IN_REGISTER_OTHER_UNIT || 0) + (acc.DUPLICATE_IN_SOURCE || 0);
  const loc = D.localities.get(code);
  locs.push({ code, name: loc ? loc.he : null, district: loc ? loc.district || 'unknown' : 'unknown', registerEvents: reg.length, govmapOnly: gm.length,
    possibleDuplicates: ev.length - counted.length, conflicts: ev.filter((e) => e.conflict).length,
    latest: { union: max(counted.map((e) => e.date)), register: max(reg.map((e) => e.date)), govmap: max(gm.map((e) => e.date)) },
    govmapRows: rows, duplicateRate: rows ? Math.round((dup / rows) * 1000) / 10 : null, missed, folded, ...(missed ? { missedIds: account.missedIds } : {}),
    probableNew: reg.filter((e) => e.newness === 'probable_new').length, olderHousing: reg.filter((e) => e.yearBuilt && e.yearBuilt <= 1980).length });
}
const sizeOf = (n) => (n >= 5000 ? 'large' : n >= 1000 ? 'medium' : 'small');
const agg = (xs) => ({ localities: xs.length, registerEvents: xs.reduce((a, x) => a + x.registerEvents, 0), govmapOnly: xs.reduce((a, x) => a + x.govmapOnly, 0),
  possibleDuplicates: xs.reduce((a, x) => a + x.possibleDuplicates, 0), conflicts: xs.reduce((a, x) => a + x.conflicts, 0), missed: xs.reduce((a, x) => a + x.missed, 0),
  folded: xs.reduce((a, x) => a + (x.folded || 0), 0),
  latestUnion: max(xs.map((x) => x.latest.union)), latestRegister: max(xs.map((x) => x.latest.register)), latestGovmap: max(xs.map((x) => x.latest.govmap)),
  unionNewerThanRegister: xs.filter((x) => x.latest.union && x.latest.register && x.latest.union > x.latest.register).length,
  duplicateRate: (() => { const r = xs.reduce((a, x) => a + x.govmapRows, 0); const d = xs.reduce((a, x) => a + (x.duplicateRate != null ? x.duplicateRate * x.govmapRows / 100 : 0), 0); return r ? Math.round((d / r) * 1000) / 10 : null; })(),
  probableNew: xs.reduce((a, x) => a + x.probableNew, 0), olderHousing: xs.reduce((a, x) => a + x.olderHousing, 0) });

/* the street sample: per district, deterministic (by id hash) */
const streetStrata = {};
const byDistrict = tally(locs, (x) => x.district);
for (const district of Object.keys(byDistrict)) {
  const dl = locs.filter((x) => x.district === district);
  const cand = [];
  for (const l of dl) {
    const sh = EV.shardOf(l.code);
    if (!sh) continue;
    const bySt = new Map();
    for (const x of EV.dealsOf(sh)) for (const st of x.streets) { if (!bySt.has(st.code)) bySt.set(st.code, []); bySt.get(st.code).push(x); }
    for (const [sc, xs] of bySt) cand.push({ id: `st:${l.code}:${sc}`, code: l.code, sc, n: xs.length, houses: new Set(xs.flatMap((x) => (x.streets.find((s) => s.code === sc) || {}).houses || [])).size, synonyms: (D.synByStreet.get(`st:${l.code}:${sc}`) || []).length });
  }
  const pick = (f, k = 12) => cand.filter(f).sort((a, b) => hash(a.id).localeCompare(hash(b.id))).slice(0, k);
  const sets = { highVolume: pick((c) => c.n >= 50), lowVolume: pick((c) => c.n >= 1 && c.n <= 4), withSynonyms: pick((c) => c.synonyms > 0), fewAddresses: pick((c) => c.houses > 0 && c.houses <= 2) };
  const out = {};
  for (const [k, list] of Object.entries(sets)) {
    out[k] = list.map((c) => {
      const q = TX.query({ streetId: c.id, all: true, unlimited: true, today });
      const counted = q.events.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
      const ids = new Set(q.events.map((e) => e.id));
      const gmOnStreet = gmRowsOf(c.code).filter((r) => r.streetCode === c.sc);
      return { id: c.id, registerDeals: c.n, events: counted.length, govmapOnly: counted.filter((e) => e.source === 'govmap').length, viaParcel: counted.filter((e) => /VIA_PARCEL/.test(e.geo.match)).length,
        latestUnion: max(counted.map((e) => e.date)), latestRegister: max(counted.filter((e) => e.source === 'register').map((e) => e.date)),
        ...(({ missed, folded }) => ({ missed, folded }))(KIT.surfaceAccount(gmOnStreet.map((r) => r.id), ids, foldsOf(c.code))) };
    });
  }
  streetStrata[district] = Object.fromEntries(Object.entries(out).map(([k, xs]) => [k, { streets: xs.length, events: xs.reduce((a, x) => a + x.events, 0), govmapOnly: xs.reduce((a, x) => a + x.govmapOnly, 0),
    viaParcel: xs.reduce((a, x) => a + x.viaParcel, 0), missed: xs.reduce((a, x) => a + x.missed, 0), folded: xs.reduce((a, x) => a + (x.folded || 0), 0), unionNewerThanRegister: xs.filter((x) => x.latestUnion && x.latestRegister && x.latestUnion > x.latestRegister).length, sample: xs }]));
}

/* parcel-only matches nationally (events placed on a street through the GovMap layer's parcel address) */
const parcelOnly = { parcelsRecovered: Object.values(Object.fromEntries([...S.parcels.entries()])).length };
const out = {
  schema: 1, builtAt: new Date().toISOString(), today, engine: TX.ENGINE,
  national: agg(locs), withoutRegisterSweep: agg(locs.filter((x) => !EV.shardOf(x.code))),
  byDistrict: Object.fromEntries(Object.keys(byDistrict).sort().map((d) => [d, agg(locs.filter((x) => x.district === d))])),
  bySize: Object.fromEntries(['large', 'medium', 'small'].map((s) => [s, agg(locs.filter((x) => sizeOf(x.registerEvents) === s))])),
  sizeBands: { large: '≥ 5,000 register events in the window', medium: '1,000 – 4,999', small: '< 1,000' },
  streets: streetStrata, parcelOnly,
  notStratified: [{ stratum: 'Arab localities (population group)', why: 'PROPX holds no official population-group field for a locality (the CBS locality file\'s field is not ingested) — never guessed from a name' }],
  majorCities: Object.fromEntries([5000, 3000, 4000, 7900, 8300, 9000, 7400, 70, 6100, 8600, 6600, 7100].map((c) => { const x = locs.find((l) => l.code === c); return [c, x ? { name: x.name, ...x.latest, govmapOnly: x.govmapOnly, missed: x.missed, folded: x.folded } : null]; })),
  localities: locs,
};
fs.writeFileSync(path.join(ROOT, 'data', 'txevents', 'coverage-audit.json'), JSON.stringify(out) + '\n');
console.log(JSON.stringify({ national: out.national, byDistrict: Object.fromEntries(Object.entries(out.byDistrict).map(([k, v]) => [k, { localities: v.localities, latestUnion: v.latestUnion, latestRegister: v.latestRegister, govmapOnly: v.govmapOnly, missed: v.missed, folded: v.folded, unionNewer: v.unionNewerThanRegister }])),
  bySize: Object.fromEntries(Object.entries(out.bySize).map(([k, v]) => [k, { localities: v.localities, govmapOnly: v.govmapOnly, missed: v.missed, dupRate: v.duplicateRate }])) }, null, 1));
