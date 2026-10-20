// PROPX · TRANSACTION EVENTS — the offline build (data/txevents/, bot-written; scripts/txevents-build.js).
//
// From the stores the syncs already commit — the register sweep (data/streets/evidence/), the recent layer's verbatim window and its
// reconciliation (data/streets/recent/), the national detector (data/txevents/national/) — and NOTHING fetched:
//   links.json          every register deal the GovMap layer also prints → that row (object id, deal id, date, amount, class) and every
//                       field the two copies print differently (kinds: the layer's documented format vs a SOURCE CONFLICT)
//   recent-extra.json   the recent window's rows the layer does not list as new because they MAY be a second print of a listed deal
//                       (POSSIBLE_DUPLICATE_IN_SOURCE · AMBIGUOUS_DUPLICATE · POSSIBLY_IN_REGISTER) — shown flagged, never counted
//   parcel-streets.json register parcels with no street link whose GovMap rows (the recent window) carry an address → the register's own
//                       street-matching rule over those addresses (the national file supersedes it when built)
//   latest.json         per locality / district / country: the latest event (union of the sources), the newest events, per-day counts
//   completeness.json   the completeness dashboard: sources, versions, latest events, new events (24 h / 7 d), unresolved, conflicts,
//                       possible duplicates, geography failures, and every source row's reconciliation state — the exact accounting
//                       with the KNOWN SOURCE EVENTS NOT SURFACED (target: 0 unexplained)
// The recent layer's classes are recomputed with its own engine and must equal the stored reconciliation row for row — else nothing is
// written (the build never contradicts the layer).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'txevents');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tally = (xs, f = (x) => x) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/** the recent layer's reconciliation, recomputed exactly as its build does (the same carried rows) — read-only */
function recentReconciliation() {
  const EV = require('../streets/evidence'), SD = require('../streets/directory'), M = require('../streets/match');
  const REC = require('../recent/reconcile'), W = require('../recent/window'), LC = require('../recent/lifecycle');
  const dir = path.join(ROOT, 'data', 'streets', 'recent');
  const idx = readJson(path.join(dir, 'raw', 'index.json'));
  const snap = idx && idx.snapshots.filter((x) => x.kind === 'window').pop();
  if (!snap) return { ok: false, error: 'no stored window snapshot' };
  const raw = readGz(path.join(dir, 'raw', snap.file));
  const S = EV.store();
  const win = W.windowOf(S.meta.source.lastDeal);
  const loadDay = String(snap.copy.loadedAt).slice(0, 10);
  const ledger = LC.fold(LC.read(dir));
  const inSnap = new Set(raw.map((g) => 'govmap:' + String(g.deal_id)));
  const carried = [], byFile = new Map();
  for (const c of ledger.values()) {
    if (c.closed || inSnap.has(c.key) || !c.observation || !c.observation.snapshotFile) continue;
    const f = c.observation.snapshotFile;
    if (!byFile.has(f)) { const fp = path.join(dir, 'raw', f); byFile.set(f, fs.existsSync(fp) ? new Map(readGz(fp).map((g) => ['govmap:' + String(g.deal_id), g])) : new Map()); }
    const g = byFile.get(f).get(c.key);
    if (g) carried.push(g);
  }
  const D = SD.load();
  const rec = REC.reconcile(raw, { window: win, loadDay, EV, D, M, carried });
  const stored = readJson(path.join(dir, 'reconciliation.json'));
  const storedCls = new Map((stored ? stored.rows : []).map((r) => [r[0], r[1]]));
  const rows = rec.rows.filter((r) => !r.carried);
  const mismatch = rows.filter((r) => storedCls.get(r.oid) !== rec.out.get(r.oid).cls);
  return { ok: mismatch.length === 0, error: mismatch.length ? `${mismatch.length} rows differ from the stored reconciliation` : null, rec, rows, raw, snap, win, loadDay, S, D, M, EV };
}

function build({ write = true, now = new Date() } = {}) {
  const R = recentReconciliation();
  if (!R.ok) return { ok: false, error: R.error };
  const { rec, rows, raw, snap, win, S, D, M, EV } = R;
  const out = rec.out;
  const rawBy = new Map(raw.map((g) => [Number(g.objectid), g]));
  const register = { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal };
  const builtAt = now.toISOString();
  const TX = require('./index');

  /* 1 · links: a register deal → its GovMap representations */
  const byKey = {};
  const kindsOf = (o) => (o.conflicts || []).map((c) => c.field + (c.kind ? ':' + c.kind : ''));
  let linked = 0;
  for (const r of rows) {
    const o = out.get(r.oid);
    if (!o.register || !['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT', 'POSSIBLY_IN_REGISTER', 'DUPLICATE_IN_SOURCE'].includes(o.cls)) continue;
    const [g, h, s] = String(o.register.unit).split('/');
    const key = TX.unitKey(o.register.code, o.register.date, g, h, s === '—' ? null : s, o.register.amount);
    (byKey[key] = byKey[key] || []).push(['over:govmap-recent', r.oid, r.dealId, r.date, r.amount, o.cls, (o.conflicts || []).map((c) => `${c.field}:${c.govmap}→${c.register}`).join(' · ') || null, kindsOf(o)]);
    linked++;
  }

  /* 2 · the recent window's possible duplicates (shown flagged) */
  const POSS = new Set(['POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER']);
  const COLS = ['oid', 'dealId', 'series', 'date', 'amount', 'areaSqm', 'rooms', 'floor', 'propertyType', 'dealNature', 'kind', 'cityCode', 'settlement', 'street', 'house',
    'streetCode', 'streetBasis', 'block', 'parcel', 'subParcel', 'priced', 'pricePerSqm', 'twinOid', 'placedBy', 'class', 'register', 'conflicts'];
  const extraRows = rows.filter((r) => POSS.has(out.get(r.oid).cls) && r.date >= win.from).map((r) => {
    const o = out.get(r.oid), st = r.code != null ? rec.streetOf(r) : { code: null, basis: 'no-locality' };
    const priced = r.amount != null && r.amount >= EV.MIN_MARKET;
    return [r.oid, r.dealId, r.series, r.date, r.amount, r.area, r.rooms, r.floor, r.type, r.nature, rec.kindOf(r), r.code, r.settlement, r.street, r.house,
      st.code, st.basis, r.gush, r.parcel, r.sub, priced, priced && r.area != null && r.area >= EV.MIN_AREA ? Math.round(r.amount / r.area) : null, r.twin ? r.twin.oid : null, r.placedBy, o.cls,
      o.register ? `${o.register.date} ${o.register.unit} ${o.register.amount}` : null, (o.conflicts || []).map((c) => `${c.field}:${c.govmap}→${c.register}`).join(' · ') || null];
  });
  const extraByCode = {};
  extraRows.forEach((x, i) => { if (x[11] != null) (extraByCode[x[11]] = extraByCode[x[11]] || []).push(i); });

  /* 3 · the parcel → street recovery from the recent window's addresses */
  const want = new Map();
  for (const f of fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x))) {
    const sh = EV.shardOf(Number(f.replace('.json', ''))); if (!sh) continue;
    for (const p of sh.parcels) if (p[4] === 'NO_ADDRESS' || p[4] === 'UNRESOLVED') want.set(`${sh.cityCode}|${num(p[0])}|${num(p[1])}`, p[4]);
  }
  const addrs = new Map();
  for (const r of rows) {
    if (r.code == null || !r.street || r.gush == null || r.parcel == null) continue;
    const k = `${r.code}|${r.gush}|${r.parcel}`;
    if (!want.has(k)) continue;
    const a = addrs.get(k) || { set: new Set(), rows: 0, last: null };
    a.set.add(`${String(r.street).trim()}${r.house ? ' ' + String(r.house).trim() : ''}`); a.rows++; if (!a.last || r.date > a.last) a.last = r.date;
    addrs.set(k, a);
  }
  const parcelStreets = {};
  const LIs = new Map(); const LI = (c) => { if (!LIs.has(c)) LIs.set(c, M.localityIndex(D, c)); return LIs.get(c); };
  const recState = {};
  for (const [k, a] of addrs) {
    const [code, gush, parcel] = k.split('|');
    const m = M.matchDeal(LI(Number(code)), [...a.set], a.set.size);
    recState[m.state] = (recState[m.state] || 0) + 1;
    if (!m.streets.length) continue;
    (parcelStreets[code] = parcelStreets[code] || {})[`${gush}|${parcel}`] = [m.state, m.streets.map((s) => [Number(String(s.id).split(':')[2]), s.via, s.houses]), m.reasons, a.rows, a.last];
  }

  if (write) {
    fs.mkdirSync(OUT, { recursive: true });
    const w = (f, o) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(o) + '\n');
    w('links.json', { schema: 1, builtAt, register, copy: snap.copy, columns: ['sourceId', 'oid', 'dealId', 'date', 'amount', 'class', 'differences', 'kinds'], byKey });
    w('recent-extra.json', { schema: 1, builtAt, register, copy: snap.copy, window: win, columns: COLS, rows: extraRows, byCode: extraByCode });
    w('parcel-streets.json', { schema: 1, builtAt, register, copy: snap.copy, columns: ['state', 'streets', 'reasons', 'layerRows', 'layerLastDate'], byCode: parcelStreets });
  }

  /* 4 · latest events per locality / district / country, and per-day counts (the union, read back through the read model) */
  const latest = latestIndex(TX, D, now);
  /* 5 · the completeness dashboard */
  const completeness = dashboard({ R, latest, linked, extraRows, parcelRecovered: Object.values(parcelStreets).reduce((a, o) => a + Object.keys(o).length, 0), recState, now, TX });
  if (write) {
    fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(latest) + '\n');
    fs.writeFileSync(path.join(OUT, 'completeness.json'), JSON.stringify(completeness, null, 1) + '\n');
  }
  return { ok: true, builtAt, links: linked, extra: extraRows.length, parcelRecovery: { candidates: addrs.size, states: recState }, latest: latest.national, completeness };
}

/* the union for every swept locality: latest event, latest per source, per-day counts; newest events per district and nationally */
function latestIndex(TX, D, now) {
  const EV = require('../streets/evidence');
  const today = now.toISOString().slice(0, 10);
  const codes = fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x)).map((x) => Number(x.replace('.json', ''))).sort((a, b) => a - b);
  const L = {}, byDistrict = {}, nationalTop = [], perDay = { il: {} };
  const keepTop = (arr, e, n) => { arr.push(e); if (arr.length > n * 2) { arr.sort((a, b) => b.date.localeCompare(a.date)); arr.length = n; } };
  const slim = (e) => ({ id: e.id, date: e.date, price: e.price, areaSqm: e.areaSqm, rooms: e.rooms, floor: e.floor || null, propertyType: e.propertyType, kind: e.kind, cityCode: e.cityCode, city: e.city,
    street: e.street || (e.parcelAddresses && e.parcelAddresses[0]) || null, houseNumber: e.houseNumber || null, block: e.block, parcel: e.parcel, subParcel: e.subParcel,
    sourceId: e.sourceId, snapshotDate: e.snapshotDate, state: e.state, notes: e.notes, inStatistics: e.inStatistics, partialSale: e.partialSale || null, conflict: e.conflict || false });
  for (const code of codes) {
    if (!EV.shardOf(code)) continue;
    const loc = D.localities.get(code);
    const district = loc ? loc.district : null;
    const allEv = TX.query({ code, all: true, unlimited: true, today }).events;
    const counted = allEv.filter((e) => e.state !== 'POSSIBLE_DUPLICATE');
    const lat = (src) => counted.filter((e) => !src || e.sourceId === src).map((e) => e.date).sort().pop() || null;
    L[code] = { name: loc ? loc.he : null, district, latest: lat(), register: lat('over:deals-register'), govmapRecent: lat('over:govmap-recent'), govmapNational: lat('over:govmap-national'),
      events: counted.length, possible: allEv.length - counted.length, govmapOnly: counted.filter((e) => e.source === 'govmap').length, conflicts: allEv.filter((e) => e.conflict).length };
    const dk = district || 'unknown';
    const B = (byDistrict[dk] = byDistrict[dk] || { latest: null, events: 0, top: [], perDay: {} });
    for (const e of counted) {
      B.events++; if (!B.latest || e.date > B.latest) B.latest = e.date;
      B.perDay[e.date] = (B.perDay[e.date] || 0) + 1; perDay.il[e.date] = (perDay.il[e.date] || 0) + 1;
      if (e.date >= '2026-01-01') { keepTop(B.top, slim(e), 300); keepTop(nationalTop, slim(e), 500); }
    }
  }
  for (const B of Object.values(byDistrict)) { B.top.sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id))); B.top.length = Math.min(B.top.length, 300); }
  nationalTop.sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id))); nationalTop.length = Math.min(nationalTop.length, 500);
  const natLatest = Object.values(L).map((x) => x.latest).filter(Boolean).sort().pop() || null;
  return { schema: 1, builtAt: now.toISOString(), today, localities: L, districts: byDistrict, national: { latest: natLatest, events: Object.values(L).reduce((a, x) => a + x.events, 0), top: nationalTop, perDay: perDay.il } };
}

function dashboard({ R, latest, linked, extraRows, parcelRecovered, recState, now, TX }) {
  const { rec, rows, snap, win } = R;
  const out = rec.out;
  const classes = tally(rows, (r) => out.get(r.oid).cls);
  const L = require('../recent/read').load();
  const layerRows = L.layer ? L.layer.rows.length : 0;
  /* every recent-window row → its reconciliation state, and where it is surfaced */
  const SURFACE = {
    RECENT_NEW: 'SURFACED — a transaction event of its own (GovMap layer)',
    IN_REGISTER: 'DUPLICATE — surfaced as the register deal it repeats (the GovMap row is that event\'s source evidence)',
    IN_REGISTER_OTHER_UNIT: 'DUPLICATE — surfaced as the register deal it repeats under another sub-parcel (source evidence)',
    DUPLICATE_IN_SOURCE: 'DUPLICATE — the same deal printed twice by the layer; surfaced through its twin',
    POSSIBLE_DUPLICATE_IN_SOURCE: 'SURFACED FLAGGED — a possible second print; shown as POSSIBLE DUPLICATE, never counted',
    AMBIGUOUS_DUPLICATE: 'SURFACED FLAGGED — several candidate twins; shown as POSSIBLE DUPLICATE, never counted',
    POSSIBLY_IN_REGISTER: 'SURFACED FLAGGED — maybe a register deal; shown as POSSIBLE DUPLICATE, never counted',
    CONTEXT_BEFORE_WINDOW: 'HISTORICAL CONTEXT — dated before the window; covered by the register window and the national detector',
    FUTURE_DATED: 'INVALID — dated after the copy was loaded',
    NO_SETTLEMENT: 'UNRESOLVED GEOGRAPHY — no settlement and a block · parcel no single locality holds',
    UNMAPPED_SETTLEMENT: 'UNRESOLVED GEOGRAPHY — a settlement name no official locality carries',
  };
  const BUCKET = { RECENT_NEW: 'NEW_EVENT', IN_REGISTER: 'DUPLICATE', IN_REGISTER_OTHER_UNIT: 'DUPLICATE', DUPLICATE_IN_SOURCE: 'DUPLICATE', POSSIBLE_DUPLICATE_IN_SOURCE: 'POSSIBLE_DUPLICATE',
    AMBIGUOUS_DUPLICATE: 'POSSIBLE_DUPLICATE', POSSIBLY_IN_REGISTER: 'POSSIBLE_DUPLICATE', CONTEXT_BEFORE_WINDOW: 'HISTORICAL_CONTEXT', FUTURE_DATED: 'INVALID', NO_SETTLEMENT: 'UNRESOLVED', UNMAPPED_SETTLEMENT: 'UNRESOLVED' };
  const unexplained = rows.filter((r) => !SURFACE[out.get(r.oid).cls]).length;
  /* proofs that "surfaced" holds: every RECENT_NEW row is in the layer; every duplicate's register deal is in the register sweep */
  const EV = require('../streets/evidence');
  const regKeys = new Map();
  const keyOk = (code, k) => { if (!regKeys.has(code)) { const sh = EV.shardOf(code); regKeys.set(code, sh ? new Set(TX.registerEvents(sh, TX.stores()).map((e) => e.key)) : new Set()); } return regKeys.get(code).has(k); };
  let dupMissing = 0;
  for (const r of rows) {
    const o = out.get(r.oid);
    if (!['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT'].includes(o.cls) || !o.register) continue;
    const [g, h, s] = String(o.register.unit).split('/');
    if (!keyOk(o.register.code, TX.unitKey(o.register.code, o.register.date, g, h, s === '—' ? null : s, o.register.amount))) dupMissing++;
  }
  const recentAccounting = { snapshot: snap.sha256, copy: snap.copy, window: win, rows: rows.length, classes,
    buckets: tally(rows, (r) => BUCKET[out.get(r.oid).cls] || 'UNEXPLAINED'), surface: SURFACE,
    proofs: { recentNewInLayer: { classRows: classes.RECENT_NEW || 0, layerRows, equal: (classes.RECENT_NEW || 0) === layerRows },
      duplicatesWhoseRegisterDealIsMissing: dupMissing, possibleDuplicatesShown: extraRows.length },
    unexplained };
  /* the national detector (when built) */
  const nm = readJson(path.join(ROOT, 'data', 'txevents', 'national', 'meta.json'));
  const na = readJson(path.join(ROOT, 'data', 'txevents', 'national', 'accounting.json'));
  const national = nm ? { built: true, builtAt: nm.builtAt, version: nm.version, file: nm.file && { sha256: nm.file.sha256, bytes: nm.file.bytes, rowsTotal: nm.file.rowsTotal, dates: nm.file.dates },
    validation: nm.validation && { pass: nm.validation.pass, same: nm.validation.same, differs: nm.validation.differs, missing: nm.validation.missing, fileOnly: nm.validation.fileOnlyInApiWindow },
    totals: nm.totals, classes: nm.classes, shown: nm.shown, parcelRecovery: nm.parcelRecovery, diff: nm.diff, periods: na ? na.periods : null } : { built: false };
  /* the sources' health */
  const TXS = TX.stores();
  const cov = TX.coverageOf(5000, TXS, now.toISOString().slice(0, 10));
  const healthy = cov.filter((c) => c.read && (c.state === 'CURRENT' || c.state === 'RECENT')).length;
  /* new events: first read by PROPX in the last 24 hours / 7 days (the recent layer's first read per deal; the national build's time) */
  const firstReads = L.layer ? L.layer.rows.map((x) => x[L.layer.columns.indexOf('firstReadAt')]).filter(Boolean) : [];
  const since = (h) => firstReads.filter((t) => now - Date.parse(t) <= h * 3600e3).length + (nm && now - Date.parse(nm.builtAt) <= h * 3600e3 ? (nm.shown ? nm.shown.govmapOnly : 0) : 0);
  const lc = L.layer ? L.layer.columns : [];
  const layerObjs = L.layer ? L.layer.rows.map((x) => Object.fromEntries(lc.map((c, i) => [c, x[i]]))) : [];
  return {
    schema: 1, builtAt: now.toISOString(), engine: TX.ENGINE,
    sources: { monitored: cov.length, healthy, stale: cov.filter((c) => c.read && !(c.state === 'CURRENT' || c.state === 'RECENT')).length, notRead: cov.filter((c) => !c.read).length, list: cov },
    latestEvent: latest.national.latest, latestByDistrict: Object.fromEntries(Object.entries(latest.districts).map(([k, v]) => [k, v.latest])),
    newEvents: { last24h: since(24), last7d: since(24 * 7), basis: 'deals PROPX read for the first time in the period (the recent layer\'s first read per deal + the national detector\'s build)' },
    unresolved: { geography: (classes.NO_SETTLEMENT || 0) + (classes.UNMAPPED_SETTLEMENT || 0) + (national.built ? Object.entries(national.classes || {}).reduce((a, [, o]) => a + (o.NO_SETTLEMENT || 0) + (o.UNMAPPED_SETTLEMENT || 0), 0) : 0),
      streetInLocality: layerObjs.filter((r) => r.streetCode == null).length, typeNotStated: layerObjs.filter((r) => r.kind === 'TYPE_NOT_STATED').length },
    conflicts: { recentConflict: layerObjs.filter((r) => r.state === 'RECENT_CONFLICT').length, linksWithSourceConflict: Object.values(readJson(TX.FILES.links) ? readJson(TX.FILES.links).byKey : {}).flat().filter((x) => (x[7] || []).some((k) => !TX.FORMAT_ONLY.has(k))).length },
    possibleDuplicates: { recentWindow: extraRows.length, national: national.built && national.shown ? national.shown.possibleDuplicates : null },
    links: linked, parcelRecovery: { recentWindow: { recovered: parcelRecovered, states: recState }, national: national.built ? national.parcelRecovery : null },
    recentAccounting, national,
    notSurfaced: (() => {
      /* both snapshots: the recent window (its own read) + the national file's periods it alone covers (before the recent window, the
         future-dated rows); the national file's recent overlap is the recent window's rows again — counted once */
      const nat = {};
      let natUnexplained = 0;
      if (national.built && national.classes) for (const [per, o] of Object.entries(national.classes)) {
        if (per === 'recent-overlap' || per === 'after-register' || per === 'future') continue;   // the recent window's own rows (future-dated included)
        for (const [k, n] of Object.entries(o)) { const b = per === 'before-window' ? 'HISTORICAL_CONTEXT' : BUCKET[k]; if (!b) natUnexplained += n; else nat[b] = (nat[b] || 0) + n; }
      }
      const both = { ...recentAccounting.buckets };
      for (const [k, n] of Object.entries(nat)) both[k] = (both[k] || 0) + n;
      const total = unexplained + natUnexplained;
      return { unexplained: total, recentWindow: recentAccounting.buckets, nationalFile: nat, newEvents: both.NEW_EVENT || 0,
        explained: Object.fromEntries(Object.entries(both).filter(([k]) => k !== 'NEW_EVENT')), target: 0,
        statement: total === 0 && recentAccounting.proofs.recentNewInLayer.equal && dupMissing === 0
          ? 'Every source row PROPX read has one reconciliation state; none is unexplained.' : 'UNEXPLAINED ROWS EXIST — see recentAccounting.proofs' };
    })(),
  };
}

module.exports = { build, recentReconciliation, latestIndex, dashboard };
