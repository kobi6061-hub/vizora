// PROPX · STREET EVIDENCE SWEEP — the pure parts of scripts/street-evidence-sync.js (also driven by test/streets.test.js with an
// in-memory register): the 36-month window, the provably complete split of a settlement's window, the normalization of the
// register rows and the locality shard with its match to the official street directory.
//
// sweepWindow(name, from, to, first, st, search) — `search(name, from, to, offset)` answers {data, total, capped} like
// GET /api/deals/search (≤ 200 rows a page, total counted to 10,000). A window answers in ONE page (fetched = total) or is
// split by date into parts expected to hold ~120 rows, and the parts must add up to the window's total; a single day above a
// page is paged again until its distinct rows reach the total (offset pages over tied rows may overlap) — or it throws.

'use strict';

const SD = require('./directory');
const M = require('./match');
const EV = require('./evidence');

const PAGE = 200;

/* ── dates (YYYY-MM-DD, UTC days) ── */
const dayOf = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400e3);
const dateOf = (d) => new Date(d * 86400e3).toISOString().slice(0, 10);
function windowOf(lastDeal) {
  const to = String(lastDeal).slice(0, 10);
  const t = new Date(to + 'T00:00:00Z'); t.setUTCFullYear(t.getUTCFullYear() - EV.WINDOW_MONTHS / 12);
  return { from: dateOf(dayOf(t.toISOString().slice(0, 10)) + 1), to, months: EV.WINDOW_MONTHS };
}

/* ── one settlement over [from, to], provably complete ── */
async function sweepWindow(name, from, to, first, st, search) {
  const r = first || await search(name, from, to);
  if (!r.capped && r.total != null && r.total <= PAGE) {
    if (r.data.length !== r.total) throw new Error(`${name} ${from}…${to}: ${r.data.length} rows of ${r.total}`);
    st.leaves++; return r.data;
  }
  const a = dayOf(from), z = dayOf(to);
  if (a === z) {
    /* one day with more than a page. Every row of the day ties on the sort key, so offset pages may overlap and skip:
       the day is paged again until the DISTINCT rows reach the day's total, or two consecutive passes return the same
       multiset adding up to it (rows the register itself repeats are stable across passes; overlaps are not) */
    if (r.capped || r.total == null) throw new Error(`${name} ${from}: a single day beyond the count cap`);
    const union = new Map();
    let prev = null;
    for (let pass = 1; pass <= 8; pass++) {
      const rows = pass === 1 ? [...r.data] : [];
      while (rows.length < r.total) { const p = await search(name, from, to, rows.length); if (!p.data.length) break; rows.push(...p.data); }
      const ms = new Map();
      for (const d of rows) { const k = JSON.stringify(d); ms.set(k, (ms.get(k) || 0) + 1); if (!union.has(k)) union.set(k, d); }
      if (union.size === r.total) { st.pagedDays++; st.dayPasses = (st.dayPasses || 0) + pass; return [...union.values()]; }
      const sig = [...ms].sort().join('\n');
      if (prev === sig && rows.length === r.total) { st.pagedDays++; st.dayPasses = (st.dayPasses || 0) + pass; return rows; }
      prev = sig;
    }
    throw new Error(`${name} ${from}: the day's pages do not add up to its ${r.total} rows`);
  }
  /* split into parts expected to hold ~120 rows each (at least 2) */
  const span = z - a + 1;
  const parts = Math.min(span, Math.max(2, r.capped || r.total == null ? 36 : Math.ceil(r.total / 120)));
  const out = []; let sum = 0;
  for (let i = 0; i < parts; i++) {
    const f = a + Math.floor((span * i) / parts), t = a + Math.floor((span * (i + 1)) / parts) - 1;
    if (t < f) continue;
    const child = await search(name, dateOf(f), dateOf(t));
    const rows = await sweepWindow(name, dateOf(f), dateOf(t), child, st, search);
    sum += rows.length; out.push(...rows);
  }
  if (!r.capped && r.total != null && sum !== r.total) throw new Error(`${name} ${from}…${to}: the parts hold ${sum} rows, the window ${r.total}`);
  st.splits++;
  return out;
}

/* ── normalization: the source's fields verbatim, in columns; identical copies of one deal collapsed only where the copy
      repeats a coded row without its settlement code (observed 19.10.2026) ── */
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const txt = (v) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim() || null);
function normalize(rows) {
  const fp = (d) => [d.date, d.amount, d.nature, d.area_sqm, d.rooms, d.year_built, d.portion_fraction, d.gush, d.helka, d.sub_parcel].join('|');
  const coded = new Set(rows.filter((d) => d.settlement_code != null && d.settlement_code !== '').map(fp));
  let duplicates = 0;
  const kept = rows.filter((d) => { if ((d.settlement_code == null || d.settlement_code === '') && coded.has(fp(d))) { duplicates++; return false; } return true; });
  return { kept, duplicates };
}

/** the shard of one locality from its settlements' rows (match against the directory included) */
function buildShard(code, names, rows, meta, D) {
  const LI = M.localityIndex(D, code);
  const natures = [], natIdx = new Map(), parcels = [], parIdx = new Map(), setNames = [...names];
  const nat = (n) => { const k = n || ''; if (!natIdx.has(k)) { natIdx.set(k, natures.length); natures.push(k); } return natIdx.get(k); };
  const par = (d) => {
    const addrs = (Array.isArray(d.addresses) ? d.addresses : []).map(txt).filter(Boolean);
    const total = num(d.addresses_total);
    const k = [d.gush, d.helka, total, addrs.join('|')].join('#');
    if (!parIdx.has(k)) {
      const m = M.matchDeal(LI, addrs, total);
      parIdx.set(k, parcels.length);
      parcels.push([txt(d.gush), txt(d.helka), m.addressesTotal, addrs, m.state, m.streets.map((s) => [SD.parseId(s.id).streetCode, s.via, s.houses]), m.reasons]);
    }
    return parIdx.get(k);
  };
  const out = rows.map((d) => [
    String(d.date || '').slice(0, 10) || null, num(d.amount), nat(txt(d.nature)), num(d.area_sqm), num(d.rooms), num(d.year_built),
    num(d.portion_fraction), txt(d.sub_parcel), par(d),
    num(d.declared_amount) != null && num(d.declared_amount) !== num(d.amount) ? num(d.declared_amount) : null,
    Math.max(0, setNames.indexOf(txt(d.settlement))),
  ]);
  /* canonical order (independent of the order the source returned tied rows): parcels by their key, rows by date (newest
     first) then by their full content — an unchanged register gives a byte-identical shard */
  const nk = natures.map((n, i) => [n, i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const nre = new Array(natures.length); nk.forEach(([, i], j) => { nre[i] = j; });
  for (const r of out) r[2] = nre[r[2]];
  natures.splice(0, natures.length, ...nk.map(([n]) => n));
  const pk = parcels.map((x, i) => [JSON.stringify([x[0], x[1], x[2], x[3]]), i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const remap = new Array(parcels.length); pk.forEach(([, i], j) => { remap[i] = j; });
  const sortedParcels = pk.map(([, i]) => parcels[i]);
  for (const r of out) r[8] = remap[r[8]];
  const key = (r) => JSON.stringify(r);
  out.sort((x, y) => (y[0] || '').localeCompare(x[0] || '') || (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
  parcels.length = 0; parcels.push(...sortedParcels);
  return { schema: EV.SHARD_SCHEMA, cityCode: code, settlements: setNames, window: meta.window, scrapedAt: meta.scrapedAt, fetchedAt: meta.fetchedAt,
    directory: D.fileHash, natures, parcelColumns: EV.PARCEL_COLUMNS, parcels, columns: EV.ROW_COLUMNS, rows: out };
}

/** re-match a stored shard to the directory as it is now (offline) */
function rematch(shard, D) {
  const LI = M.localityIndex(D, shard.cityCode);
  for (const p of shard.parcels) {
    const m = M.matchDeal(LI, p[3], p[2]);
    p[4] = m.state; p[5] = m.streets.map((s) => [SD.parseId(s.id).streetCode, s.via, s.houses]); p[6] = m.reasons;
  }
  shard.directory = D.fileHash;
  return shard;
}

module.exports = { PAGE, dayOf, dateOf, windowOf, sweepWindow, normalize, buildShard, rematch };
