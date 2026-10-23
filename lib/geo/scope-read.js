// PROPX · GEOGRAPHIC SCOPE READ MODEL (22.10.2026) — GET /api/intel?view=scope&id=<scope id>
//
// One geography of the official hierarchy (lib/geo/scope.js): its chain (Israel → district → subdistrict → locality → verified
// neighbourhood | statistical area | street), its children, and the intelligence PROPX can state AT THAT LEVEL — composed only from read
// models that already exist; it creates no fact:
//   · identity      lib/changes/geo.js (il · district · locality · verified neighbourhood · street) + the official street directory's
//                   locality → subdistrict (region_code / region_name) + the census 2022 table's statistical areas
//   · transactions  lib/txevents (the stored union): LATEST KNOWN TRANSACTION (the newest counted event of any state) and LATEST PRICED
//                   RESIDENTIAL TRANSACTION (the newest PRICED_IN_STATISTICS dwelling event) — never one figure; a price only when the
//                   event is priced in statistics
//   · demographics  lib/reference (census 2022 — one observation, never current; registered residents apart)
//   · official series per district (CBS new-home sales, construction starts — trailing 12 months as published)
//   · the module × level capability matrix (lib/geo/scope.js) — EXACT · AGGREGATED · CONTEXT · NOT_AVAILABLE · NOT_APPLICABLE
// An aggregate is a sum over the geography's own child records, each once, with its coverage; a level a source does not hold is
// NOT_AVAILABLE or the nearest wider geography, labelled — never a silent substitute.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SC = require('./scope');

const ROOT = path.join(__dirname, '..', '..', 'data');
const G = () => require('../changes/geo');
const SD = () => require('../streets/directory');
const TXM = () => require('../txevents');
const REF = () => require('../reference');

const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const bi = (he, en) => ({ he, en: en || he });

/* ── the memo key: the files the read depends on ── */
const FILES = {
  latest: path.join(ROOT, 'txevents', 'latest.json'),
  directory: path.join(ROOT, 'geo', 'streets', 'directory.json'),
  neighbourhoods: path.join(ROOT, 'geo', 'neighborhoods.json'),
  census: path.join(ROOT, 'reference', 'census-2022', 'meta.json'),
  residents: path.join(ROOT, 'reference', 'residents', 'meta.json'),
  sales: path.join(ROOT, 'cbs-sales', 'latest.json'),
  construction: path.join(ROOT, 'construction', 'latest.json'),
};
const stamp = () => Object.values(FILES).map(mtime).join('|');

let IDX = null;
/** the locality → subdistrict → district index from the official directory (every locality once) + the transaction / census tallies */
function index() {
  const k = stamp();
  if (IDX && IDX.k === k) return IDX;
  const D = SD().load();
  const napot = new Map(), locs = new Map(), byDistrict = new Map();
  for (const l of D.localities.values()) {
    const napa = l.region != null && l.region !== '' ? Number(l.region) : null;
    const loc = G().localityOf(l.code);
    const rec = { code: Number(l.code), name: loc ? loc.name : bi(l.he, l.he), district: l.district || null, napa };
    locs.set(rec.code, rec);
    if (rec.district) { if (!byDistrict.has(rec.district)) byDistrict.set(rec.district, []); byDistrict.get(rec.district).push(rec.code); }
    if (napa != null) {
      if (!napot.has(napa)) napot.set(napa, { code: napa, raw: l.regionName || null, district: rec.district, localities: [] });
      napot.get(napa).localities.push(rec.code);
    }
  }
  /* "נפת <name>": the directory's name is the subdistrict's seat ("פתח תקווה"), the same words as a locality — the prefix keeps them apart */
  for (const n of napot.values()) n.name = bi('נפת ' + SC.napaName(n.raw), (SC.NAPA_EN[n.code] || SC.napaName(n.raw)) + ' subdistrict');
  const streetsByCity = new Map();
  for (const s of D.streets) if (s.kind === 'street' && s.status === 'current') streetsByCity.set(s.cityCode, (streetsByCity.get(s.cityCode) || 0) + 1);
  const L = readJson(FILES.latest, null);
  /* coordinates (data/geo/localities.json): a POINT per locality where the registry has one — never a boundary */
  const pts = new Map(); for (const x of (readJson(path.join(ROOT, 'geo', 'localities.json'), { localities: [] }).localities || [])) if (x.code != null && x.lat != null && x.lng != null) pts.set(Number(x.code), { lat: x.lat, lng: x.lng });
  let census = null; try { census = REF().table('census-2022'); } catch { census = null; }
  IDX = { k, D, napot, locs, byDistrict, streetsByCity, L, census, pts, memo: new Map() };
  return IDX;
}
const memo = (key, fn) => { const I = index(); if (I.memo.has(key)) return I.memo.get(key); const v = fn(); if (I.memo.size > 400) I.memo.clear(); I.memo.set(key, v); return v; };

/* ── identity ── */
const node = (id, level, name) => ({ id, level, name });
function localityChain(code) {
  const I = index(), l = I.locs.get(Number(code));
  if (!l) return null;
  const out = [node('il', 'country', bi('ישראל', 'Israel'))];
  if (l.district && SC.DISTRICTS[l.district]) out.push(node(l.district, 'district', bi(SC.DISTRICTS[l.district].he, SC.DISTRICTS[l.district].en)));
  if (l.napa != null && I.napot.has(l.napa)) out.push(node('napa:' + l.napa, 'subdistrict', I.napot.get(l.napa).name));
  out.push(node('loc:' + l.code, 'locality', l.name));
  return out;
}

/**
 * @returns {{ok:true, scope}|{ok:false,status,error}} — scope = { id, level, name, chain, district, napa, locality, … }
 */
function resolve(raw) {
  const p = SC.parse(raw == null || raw === '' ? 'il' : raw);
  if (!p) return { ok: false, status: 400, error: 'bad-scope', detail: 'id must be il · d-<district> · js-area · napa:<code> · loc:<code> · nb:<id> · sa:<locality>:<area> · st:<locality>:<street>' };
  const I = index();
  if (p.level === 'country') return { ok: true, scope: { id: 'il', level: 'country', name: bi('ישראל', 'Israel'), chain: [node('il', 'country', bi('ישראל', 'Israel'))] } };
  if (p.level === 'district') {
    const d = SC.DISTRICTS[p.district];
    return { ok: true, scope: { id: p.id, level: 'district', name: bi(d.he, d.en), district: p.id, chain: [node('il', 'country', bi('ישראל', 'Israel')), node(p.id, 'district', bi(d.he, d.en))] } };
  }
  if (p.level === 'subdistrict') {
    const n = I.napot.get(p.napa);
    if (!n) return { ok: false, status: 404, error: 'unknown-subdistrict' };
    const d = n.district && SC.DISTRICTS[n.district];
    const chain = [node('il', 'country', bi('ישראל', 'Israel'))];
    if (d) chain.push(node(n.district, 'district', bi(d.he, d.en)));
    chain.push(node(p.id, 'subdistrict', n.name));
    return { ok: true, scope: { id: p.id, level: 'subdistrict', name: n.name, nameRaw: n.raw, district: n.district, napa: n.code, chain } };
  }
  if (p.level === 'locality') {
    const chain = localityChain(p.locality);
    if (!chain) return { ok: false, status: 404, error: 'unknown-locality' };
    const l = I.locs.get(p.locality);
    return { ok: true, scope: { id: p.id, level: 'locality', name: l.name, district: l.district, napa: l.napa, locality: l.code, point: I.pts.get(l.code) || null, chain } };
  }
  if (p.level === 'statArea') {
    const chain = localityChain(p.locality);
    const row = I.census ? I.census.byKey.get(`sa:${p.locality}:${p.statArea}`) : null;
    if (!chain || !row) return { ok: false, status: 404, error: 'unknown-statistical-area' };
    const l = I.locs.get(p.locality), name = bi(`אזור סטטיסטי ${p.statArea}`, `Statistical area ${p.statArea}`);
    chain.push(node(p.id, 'statArea', name));
    return { ok: true, scope: { id: p.id, level: 'statArea', name, district: l.district, napa: l.napa, locality: l.code, statArea: p.statArea, point: I.pts.get(l.code) || null, chain } };
  }
  /* a verified neighbourhood / a street — the change feed's resolver (one resolution for the whole product) */
  const r = G().resolve(p.id);
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  const g = r.geo, code = g.locality ? Number(g.locality.code) : null;
  const chain = code != null ? localityChain(code) : null;
  if (!chain) return { ok: false, status: 404, error: 'locality-not-resolved' };
  const l = I.locs.get(code);
  const level = g.kind === 'street' ? 'street' : 'neighbourhood';
  chain.push(node(p.id, level, g.name));
  return { ok: true, scope: { id: p.id, level, name: g.name, district: l.district, napa: l.napa, locality: code, point: I.pts.get(code) || null, chain, streets: g.streets || [], streetKind: g.streetKind || null,
    source: g.source || null, verified: level === 'neighbourhood' ? true : undefined } };
}

/* ── transactions: latest known ≠ latest priced residential ── */
const counted = (e) => e && e.state !== 'POSSIBLE_DUPLICATE';
const pricedDwelling = (e) => e && e.state === 'PRICED_IN_STATISTICS' && e.kind === 'DWELLING';
/** the event as the atlas shows it: a price ONLY when it is priced in statistics — otherwise null with the state that says why */
function wireEvent(e) {
  if (!e) return null;
  const priced = e.state === 'PRICED_IN_STATISTICS';
  return { id: e.id, date: e.date, cityCode: e.cityCode != null ? Number(e.cityCode) : null, city: e.city || null, street: e.street || null, house: e.houseNumber || null,
    kind: e.kind || null, propertyType: e.propertyType || null, rooms: e.rooms != null ? e.rooms : null, areaSqm: e.areaSqm != null ? e.areaSqm : null,
    price: priced && e.price != null ? e.price : null, priceUsed: priced, state: e.state, notes: e.notes || [], sourceId: e.sourceId, snapshotDate: e.snapshotDate || null };
}
function localityTx(code) {
  return memo('tx:loc:' + code, () => {
    const TX = TXM();
    const r = TX.query({ code: Number(code), all: '1', unlimited: true });
    const ev = r.events || [];
    const p12 = TX.periodOf({ months: 12 });
    return { latestKnown: ev.find(counted) || null, latestPriced: ev.find(pricedDwelling) || null,
      events: ev.filter(counted).length, last12: ev.filter((e) => counted(e) && TX.inPeriod(e.date, p12)).length, recency: r.recency || null };
  });
}
/** the newest priced dwelling over a set of localities — each locality read only while its newest event could still be newer */
function newestPricedOver(codes) {
  const I = index(), L = I.L;
  const order = codes.map((c) => ({ c, d: L && L.localities[c] ? L.localities[c].latest : null })).filter((x) => x.d).sort((a, b) => b.d.localeCompare(a.d) || a.c - b.c);
  let best = null, read = 0;
  for (const x of order) {
    if (best && x.d < best.date) break;
    read++;
    const t = localityTx(x.c).latestPriced;
    if (t && (!best || t.date > best.date)) best = t;
  }
  return { event: best, localitiesRead: read };
}
const windowOf = (perDay) => { const ks = Object.keys(perDay || {}).sort(); return ks.length ? { from: ks[0], to: ks[ks.length - 1] } : null; };
function sumPeriod(perDay, months) { const TX = TXM(); const p = TX.periodOf({ months }); return Object.entries(perDay || {}).reduce((a, [k, v]) => a + (TX.inPeriod(k, p) ? v : 0), 0); }

function transactions(scope) {
  const I = index(), L = I.L, TX = TXM();
  if (!L) return { mode: 'NOT_AVAILABLE', reason: bi('אינדקס העסקאות (data/txevents/latest.json) לא נבנה', 'the transaction index (data/txevents/latest.json) is not built') };
  const base = { builtAt: L.builtAt, definitions: {
    latestKnown: bi('העסקה הידועה האחרונה: אירוע העסקה החדש ביותר (לפי תאריך העסקה) מכל מקור, בכל מצב — כפילות אפשרית אינה נספרת', 'LATEST KNOWN TRANSACTION: the newest transaction event (by transaction date) of any source, in any state — a possible duplicate is not counted'),
    latestPriced: bi('עסקת המגורים המתומחרת האחרונה: אירוע הדירה החדש ביותר שמחירו משמש בסטטיסטיקה (נכס שלם, מחיר ≥ ₪100,000, מהמרשם)', 'LATEST PRICED RESIDENTIAL TRANSACTION: the newest dwelling event whose price is used in statistics (whole property, ≥ ₪100,000, from the register)'),
  } };
  if (scope.level === 'country' || scope.level === 'district') {
    const blk = scope.level === 'country' ? L.national : L.districts[scope.id];
    if (!blk) return { ...base, mode: 'NOT_AVAILABLE', reason: bi('אין אירועים שמתויקים במחוז הזה', 'no events are filed under this district') };
    const top = blk.top || [];
    let priced = top.find(pricedDwelling) || null, via = 'top';
    if (!priced) { const codes = scope.level === 'country' ? Object.keys(L.localities).map(Number) : (I.byDistrict.get(scope.id) || []); priced = newestPricedOver(codes).event; via = 'localities'; }
    return { ...base, mode: 'EXACT', latestKnown: wireEvent(top.find(counted) || null), latestPriced: wireEvent(priced), pricedVia: via,
      events: blk.events, last12: sumPeriod(blk.perDay, 12), window: windowOf(blk.perDay), countBasis: bi('ספירה יומית של האיחוד השמור', 'the stored union\'s per-day tally') };
  }
  if (scope.level === 'subdistrict') {
    const codes = I.napot.get(scope.napa).localities;
    const rows = codes.map((c) => ({ c, x: L.localities[c] })).filter((r) => r.x);
    const latestRow = rows.filter((r) => r.x.latest).sort((a, b) => b.x.latest.localeCompare(a.x.latest) || a.c - b.c)[0] || null;
    const known = latestRow ? localityTx(latestRow.c).latestKnown : null;
    const np = newestPricedOver(codes);
    return { ...base, mode: 'AGGREGATED', latestKnown: wireEvent(known), latestPriced: wireEvent(np.event), pricedVia: 'localities', localitiesRead: np.localitiesRead,
      events: rows.reduce((a, r) => a + (r.x.events || 0), 0), last12: null, last12Reason: bi('הספירה היומית נשמרת לישראל ולמחוזות; ספירת תקופה של יישוב נקראת לכל יישוב', 'the per-day tally is kept for Israel and the districts; a locality\'s period count is read per locality'),
      coverage: { localities: codes.length, withEvents: rows.filter((r) => r.x.events > 0).length }, countBasis: bi('סכום ספירות האירועים של יישובי הנפה, כל יישוב פעם אחת', 'the sum of its localities\' event counts, each locality once') };
  }
  const code = scope.locality;
  if (scope.level === 'locality') {
    const x = localityTx(code);
    return { ...base, mode: 'EXACT', latestKnown: wireEvent(x.latestKnown), latestPriced: wireEvent(x.latestPriced), events: x.events, last12: x.last12, countBasis: bi('הקריאה המאוחדת של היישוב', 'the locality\'s unified read') };
  }
  if (scope.level === 'street') {
    const r = memo('tx:' + scope.id, () => { const q = TX.query({ streetId: scope.id, all: '1', unlimited: true }); const ev = q.events || []; const p12 = TX.periodOf({ months: 12 });
      return { latestKnown: ev.find(counted) || null, latestPriced: ev.find(pricedDwelling) || null, events: ev.filter(counted).length, last12: ev.filter((e) => counted(e) && TX.inPeriod(e.date, p12)).length }; });
    return { ...base, mode: 'EXACT', latestKnown: wireEvent(r.latestKnown), latestPriced: wireEvent(r.latestPriced), events: r.events, last12: r.last12, countBasis: bi('הקריאה המאוחדת של הרחוב', 'the street\'s unified read') };
  }
  if (scope.level === 'neighbourhood') {
    const x = localityTx(code), ctx = SC.contextOf(scope, 'locality');
    return { ...base, mode: 'CONTEXT', of: ctx, reason: bi('עסקאות ממופות ליישוב / רחוב / חלקה, לעולם לא לגבול שכונה — מוצג היישוב', 'transactions are keyed to a locality / street / parcel, never to a neighbourhood boundary — the locality is shown'), latestKnown: wireEvent(x.latestKnown), latestPriced: wireEvent(x.latestPriced), events: x.events, last12: x.last12 };
  }
  return { ...base, mode: 'NOT_AVAILABLE', reason: bi('אין מפתח כתובת → אזור סטטיסטי ואין גבול אזור סטטיסטי', 'no address → statistical-area key and no statistical-area boundary is held') };
}

/* ── demographics: census 2022 (one observation) ── */
function censusProvenance(I) { const m = I.census && I.census.meta; return m ? { id: m.id, title: m.title, titleEn: m.titleEn, publisher: m.publisher, publisherEn: m.publisherEn, period: m.period, sourceUpdatedAt: m.sourceUpdatedAt || null, readAt: m.readAt || null } : null; }
function populationOf(codes) {
  const I = index(); if (!I.census) return null;
  let sum = 0, n = 0;
  for (const c of codes) { const r = I.census.byKey.get('loc:' + c); if (r && r.population != null) { sum += r.population; n++; } }
  return { population: n ? sum : null, listed: n, of: codes.length };
}
function demographics(scope) {
  const I = index();
  if (!I.census) return { mode: 'NOT_AVAILABLE', reason: bi('טבלת המפקד לא סונכרנה', 'the census table is not synced') };
  const src = censusProvenance(I);
  if (scope.level === 'country') { const r = I.census.byKey.get('il'); return { mode: 'EXACT', population: r ? r.population : null, households: r ? r.households : null, ownPct: r ? r.ownPct : null, rentPct: r ? r.rentPct : null, source: src }; }
  if (scope.level === 'district' || scope.level === 'subdistrict') {
    const codes = scope.level === 'district' ? (I.byDistrict.get(scope.id) || []) : I.napot.get(scope.napa).localities;
    return { mode: 'AGGREGATED', ...populationOf(codes), source: src, basis: 'the sum of the census 2022 population of the localities the census table lists — smaller localities the table omits are not in it' };
  }
  if (scope.level === 'statArea') { const r = I.census.byKey.get(`sa:${scope.locality}:${scope.statArea}`); return { mode: 'EXACT', population: r.population, households: r.households, ageMedian: r.ageMedian, ownPct: r.ownPct, rentPct: r.rentPct, source: src }; }
  let loc = null; try { loc = REF().locality(scope.locality); } catch { loc = null; }
  const c = loc && loc.census;
  const out = { population: c ? c.population : null, households: c ? c.households : null, ageMedian: c ? c.ageMedian : null, ownPct: c ? c.ownPct : null, rentPct: c ? c.rentPct : null,
    statAreas: c ? c.statAreas : 0, residents: loc && loc.residents ? { residents: loc.residents.residents, readAt: loc.residents.source && loc.residents.source.readAt } : null, missing: loc ? loc.censusMissing : 'reference-not-read', source: src };
  if (scope.level === 'locality') return { mode: 'EXACT', ...out };
  return { mode: 'CONTEXT', of: SC.contextOf(scope, 'locality'), ...out };
}

/* ── official district series (CBS): trailing 12 months as the series publishes them ── */
function districtSeries() {
  return memo('series', () => {
    const S = readJson(FILES.sales, null), K = readJson(FILES.construction, null);
    const t12 = (m) => (m && m.t12 && m.t12.ok ? { value: m.t12.value, from: m.t12.from, to: m.t12.to, label: m.t12.label } : null);
    const out = {};
    for (const id of ['il'].concat(SC.DISTRICT_ORDER)) {
      const key = id === 'il' ? 'il' : SC.DISTRICTS[id].cbs === 'jsr' ? 'jsr' : id;
      out[id] = { sales: S && S.geos && S.geos[key] ? t12(S.geos[key].metrics) : null, starts: K && K.measures && K.measures.starts && K.measures.starts.geos[key] ? t12(K.measures.starts.geos[key].metrics) : null };
    }
    return { byGeo: out, sources: { sales: S ? { id: 'cbs:new-home-sales', checkedAt: S.checkedAt || null } : null, starts: K ? { id: 'cbs:construction', checkedAt: K.checkedAt || null } : null } };
  });
}

/* ── children ── */
function txOfLocality(c) { const L = index().L, x = L && L.localities[c]; return x ? { events: x.events || 0, latest: x.latest || null } : { events: 0, latest: null }; }
function children(scope) {
  const I = index(), L = I.L;
  if (scope.level === 'country') {
    const S = districtSeries().byGeo;
    return { level: 'district', order: 'official district order', rows: SC.DISTRICT_ORDER.map((id) => {
      const codes = I.byDistrict.get(id) || [], blk = L && L.districts[id];
      const napot = [...I.napot.values()].filter((n) => n.district === id).length;
      return { id, name: bi(SC.DISTRICTS[id].he, SC.DISTRICTS[id].en), localities: codes.length, subdistricts: napot, ...populationOf(codes),
        events: blk ? blk.events : null, latest: blk ? blk.latest : null, latestPriced: blk ? ((blk.top || []).find(pricedDwelling) || {}).date || null : null,
        salesT12: S[id] ? S[id].sales : null, startsT12: S[id] ? S[id].starts : null };
    }) };
  }
  if (scope.level === 'district') {
    return { level: 'subdistrict', order: 'official subdistrict code', rows: [...I.napot.values()].filter((n) => n.district === scope.id).sort((a, b) => a.code - b.code).map((n) => {
      const tx = n.localities.map(txOfLocality);
      return { id: 'napa:' + n.code, name: n.name, nameRaw: n.raw, localities: n.localities.length, ...populationOf(n.localities), events: tx.reduce((a, x) => a + x.events, 0),
        latest: tx.map((x) => x.latest).filter(Boolean).sort().pop() || null };
    }) };
  }
  if (scope.level === 'subdistrict') {
    const rows = I.napot.get(scope.napa).localities.map((c) => { const l = I.locs.get(c), r = I.census ? I.census.byKey.get('loc:' + c) : null; return { id: 'loc:' + c, code: c, name: l.name, population: r ? r.population : null, point: I.pts.get(c) || null, ...txOfLocality(c) }; });
    rows.sort((a, b) => (a.population == null) - (b.population == null) || (b.population || 0) - (a.population || 0) || a.code - b.code);
    return { level: 'locality', order: 'census 2022 population, largest first (localities the census table omits last)', rows };
  }
  if (scope.level === 'locality') {
    const nbs = G().neighbourhoodsList().filter((n) => n.localityCode === scope.locality).map((n) => ({ id: n.id, name: bi(n.he, n.en), streetLinks: !!n.streetLinks }));
    const sas = I.census ? (I.census.byLocality.get(scope.locality) || []).slice().sort((a, b) => a.statArea - b.statArea).map((r) => ({ id: `sa:${scope.locality}:${r.statArea}`, statArea: r.statArea, name: bi(`אזור סטטיסטי ${r.statArea}`, `Statistical area ${r.statArea}`), population: r.population })) : [];
    return { level: 'neighbourhood', neighbourhoods: nbs, statAreas: sas, streets: { current: I.streetsByCity.get(scope.locality) || 0, search: 'GET /api/geo/search?q=…&near=' + scope.locality } };
  }
  if (scope.level === 'neighbourhood') return { level: 'street', rows: (scope.streets || []).map((s) => ({ id: s.id, name: bi(s.name, s.name), linkedAs: s.linkedAs || null })), basis: 'the verified neighbourhood\'s street links (a street may run through several neighbourhoods; it is never placed in one)' };
  return { level: null, rows: [] };
}

/* ── Israel only: major cities, verified neighbourhoods, the coverage of every level ── */
function national() {
  return memo('national', () => {
    const I = index(), L = I.L;
    const cities = I.census ? [...I.locs.values()].map((l) => ({ l, r: I.census.byKey.get('loc:' + l.code) })).filter((x) => x.r && x.r.population != null)
      .sort((a, b) => b.r.population - a.r.population || a.l.code - b.l.code).slice(0, 15)
      .map(({ l, r }) => ({ id: 'loc:' + l.code, code: l.code, name: l.name, district: l.district, population: r.population, ...txOfLocality(l.code) })) : [];
    const nbs = G().neighbourhoodsList();
    const byLoc = new Map(); for (const n of nbs) { const k = n.localityCode; if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push({ id: n.id, name: bi(n.he, n.en) }); }
    const nbLocalities = [...byLoc.entries()].map(([code, list]) => ({ id: 'loc:' + code, code, name: (I.locs.get(code) || { name: bi(String(code)) }).name, neighbourhoods: list })).sort((a, b) => b.neighbourhoods.length - a.neighbourhoods.length || a.code - b.code);
    let streets = 0; for (const n of I.streetsByCity.values()) streets += n;
    const withEvents = L ? Object.values(L.localities).filter((x) => x.events > 0).length : null;
    const censusLoc = I.census ? [...I.census.byKey.values()].filter((r) => r.level === 'locality').length : null;
    const sas = I.census ? [...I.census.byKey.values()].filter((r) => r.level === 'statArea').length : null;
    const noNapa = [...I.locs.values()].filter((l) => l.napa == null).length;
    return {
      cities: { order: 'census 2022 population, largest first — an order of an official figure, never a score', rows: cities },
      neighbourhoods: { total: nbs.length, localities: byLoc.size, byLocality: nbLocalities, basis: 'PROPX curated registry of verified neighbourhood names (municipality / CBS naming); no neighbourhood boundary is held' },
      coverage: [
        { level: 'country', n: 1, note: bi('ישראל', 'Israel') },
        { level: 'district', n: SC.DISTRICT_ORDER.length, note: bi('7 מחוזות למ״ס (כולל יהודה ושומרון); גבולות לשישה', '7 CBS districts (incl. Judea and Samaria); boundaries for six') },
        { level: 'subdistrict', n: I.napot.size, note: bi(`נפות מקובץ הרחובות הרשמי; ${noNapa} יישובים בלי נפה`, `subdistricts from the official street directory; ${noNapa} localities without one`) },
        { level: 'locality', n: I.locs.size, withEvents, census: censusLoc, note: bi('יישובים רשמיים (קובץ הרחובות)', 'official localities (the street directory)') },
        { level: 'neighbourhood', n: nbs.length, localities: byLoc.size, note: bi('שכונות מאומתות — שמות בלבד, ללא גבולות', 'verified neighbourhoods — names only, no boundaries') },
        { level: 'statArea', n: sas, note: bi('שורות אזור סטטיסטי בטבלת מפקד 2022 — ללא גבולות וללא מפתח כתובת', 'statistical-area rows in the census 2022 table — no boundaries and no address key') },
        { level: 'street', n: streets, note: bi('רחובות נוכחיים בקובץ הרחובות הרשמי', 'current streets in the official street directory') },
        { level: 'address', n: null, note: bi('ראיות בתוך דוח הרחוב בלבד', 'evidence inside the street report only') },
        { level: 'property', n: null, note: bi('מעבדת העסקה — הנחות המשתמש', 'the Deal Lab — the user\'s assumptions') },
      ],
      series: districtSeries().sources,
    };
  });
}

/** the whole read of one geography */
function read(raw) {
  const r = resolve(raw);
  if (!r.ok) return r;
  const s = r.scope;
  const body = { schema: SC.SCHEMA, scope: s, up: SC.up(s), levels: SC.LEVELS, modules: SC.matrix(s.level), modes: SC.MODES,
    transactions: transactions(s), demographics: demographics(s), children: children(s) };
  if (s.level === 'country') body.national = national();
  if (s.level === 'district' || s.level === 'country') body.series = districtSeries().byGeo[s.id] || null;
  return { ok: true, status: 200, body };
}

module.exports = { resolve, read, transactions, demographics, children, national, wireEvent, index, FILES };
