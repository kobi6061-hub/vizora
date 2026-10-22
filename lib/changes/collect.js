// PROPX · What Changed Here? — the collectors: one per change kind, each reading only stored evidence (21.10.2026).
//
// A collector turns the records of one kind into CANDIDATE change items for a geography — every item that can fall inside the
// longest period (365 days ending at the anchor) — and states its COVERAGE (which sources, how they are dated, since when PROPX
// keeps their history, whether they are stale, whether they reach this geography). The period, the newness and the filters are
// applied by lib/changes/index.js; nothing here is computed from a model, nothing is defaulted.
//
// DATED items carry the source's own date of the event (eventDate) and the date PROPX first held the record (observedAt). An
// observation in a source's FIRST ingestion is the BASELINE (`baseline: true`) — it can be a NEW_EVENT by its own date, never a
// "newly observed older event". STATE_CHANGE items are changes PROPX observed between two of its reads (the Market Radar's ledger
// events, the due-diligence history); REVISION items are figures a publisher replaced (the CBS ledgers, old value kept).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const RU = require('./rules');
const S = require('./stores');
const VERBS = require('../radar/verbs');

const bi = RU.bi;
const DAY = 864e5;
const day = (x) => (x ? String(x).slice(0, 10) : null);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const minusDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') - k * DAY).toISOString().slice(0, 10);
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const pk = (block, parcel) => `${num(block)}/${num(parcel)}`;
const GEO_DIR = path.join(__dirname, '..', '..', 'data', 'geo', 'street-geo', 'loc');

/** a candidate item of a rule (newness is decided later, per period) */
function mk(rule, o) {
  const r = RU.RULES[rule];
  return Object.assign({ kind: r.kind, rule, mode: r.mode, verb: r.verb, cls: r.cls, m: r.m, n: 1, baseline: false, eventDateBasis: 'SOURCE', placement: 'CERTAIN', relation: null, distanceM: null, values: null }, o, { verb: o.verb || r.verb, m: o.m || r.m });
}
const inWindow = (it, from, A) => {
  if (!it) return false;
  if (it.mode === 'DATED') return (it.eventDate && it.eventDate > from && it.eventDate <= A) || (!it.baseline && day(it.observedAt) > from && day(it.observedAt) <= A);
  return day(it.observedAt) > from && day(it.observedAt) <= A;
};

/* ───────────────────────── geometry of a street (its located points, its parcels, the plans around it) ───────────────────────── */
const M_LAT = 110574, M_LNG = (lat) => 111320 * Math.cos(lat * Math.PI / 180);
const GEO_LOC = new Map();
function locGeo(code) {
  const f = path.join(GEO_DIR, `${Number(code)}.json.gz`);
  const m = S.mtime(f), k = `${code}|${m}`;
  if (GEO_LOC.has(k)) return GEO_LOC.get(k);
  let v = null;
  if (m) { try { v = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { v = null; } }
  /* every parcel the GovMap-layer file places on any street of the locality → its point (the file's own coordinates) */
  const parcelPt = new Map();
  if (v && v.streets) for (const s of Object.values(v.streets)) for (const p of s.pts || []) { const key = pk(p[6], p[7]); if (!parcelPt.has(key)) parcelPt.set(key, [p[0], p[1]]); }
  const out = { doc: v, parcelPt };
  GEO_LOC.set(k, out); while (GEO_LOC.size > 16) GEO_LOC.delete(GEO_LOC.keys().next().value);
  return out;
}
const SPATIAL = new Map();
function spatialOf(street) {
  const k = `${street.id}|${S.stamp()}`;
  if (SPATIAL.has(k)) return SPATIAL.get(k);
  const RP = require('../streets/report'), ST = require('../streets/street'), SD = require('../streets/directory');
  const D = SD.load();
  const idn = ST.identity(street.id, D);
  const g = idn ? RP.streetGeo(idn) : { available: false, reason: 'unknown-street' };
  let pl = { available: false, reason: g.reason || 'street-not-located', plans: [], transit: [] };
  if (idn && g.available) { try { pl = RP.planning(idn, g, { coverage: idn.cityCode === 5000 ? 'TLV_MUNICIPAL' : 'NOT_COVERED', totals: { permits: 0, sites: 0 } }); } catch (e) { pl = { available: false, reason: 'planning-read-failed: ' + e.message, plans: [], transit: [] }; } }
  /* the street's parcels: the located points' own block · parcel + the register parcels whose addresses name this street */
  const parcels = new Set();
  if (g.available) for (const p of g.points) if (p.block != null && p.parcel != null) parcels.add(pk(p.block, p.parcel));
  const EV = require('../streets/evidence');
  const sh = idn ? EV.shardOf(idn.cityCode) : null;
  if (sh && Array.isArray(sh.parcels)) {
    const C = sh.parcelColumns || [], gi = C.indexOf('gush'), hi = C.indexOf('helka'), si = C.indexOf('streets');
    for (const r of sh.parcels) if ((r[si] || []).some((s) => s[0] === street.code)) parcels.add(pk(r[gi], r[hi]));
  }
  const lat0 = g.available ? g.centroid[1] : null;
  const P = g.available ? ([lng, lat]) => [lng * M_LNG(lat0), lat * M_LAT] : null;
  const pts = g.available ? g.points.map((p) => P([p.lng, p.lat])) : [];
  /** metres from a WGS84 point to the street's nearest located point */
  const distTo = (pt) => { if (!P || !pts.length || !pt) return null; const q = P(pt); let best = Infinity; for (const p of pts) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < best) best = d; } return Math.round(best); };
  const out = { street, idn, g, pl, parcels, distTo, located: !!g.available, reason: g.available ? null : g.reason };
  SPATIAL.set(k, out); while (SPATIAL.size > 12) SPATIAL.delete(SPATIAL.keys().next().value);
  return out;
}
/** where a record identified by parcels stands relative to the geography's streets → { scope, relation, distanceM, street } | null */
function parcelRelation(parcels, sps, cityCode) {
  let best = null;
  for (const sp of sps) {
    if (sp.idn && Number(sp.idn.cityCode) !== Number(cityCode)) continue;
    const keys = (parcels || []).map((x) => (typeof x === 'string' ? pk(...x.split('/')) : pk(x.block, x.parcel)));
    if (keys.some((x) => sp.parcels.has(x))) return { scope: 'EXACT_STREET', relation: 'ON_A_PARCEL_OF_THE_STREET', distanceM: 0, street: sp.street };
    if (!sp.located) continue;
    const L = locGeo(cityCode);
    for (const key of keys) { const pt = L.parcelPt.get(key); const d = sp.distTo(pt); if (d != null && d <= RU.NEAR_M && (!best || d < best.distanceM)) best = { scope: 'NEAR_STREET', relation: 'PARCEL_WITHIN_RADIUS', distanceM: d, street: sp.street }; }
  }
  return best;
}

/* ───────────────────────── shared context ───────────────────────── */
const SRC_LABEL = {
  'over:deals-register': bi('מאגר רשות המסים — עותק (over.org.il)', 'Tax Authority register — copy (over.org.il)'),
  'over:govmap-recent': bi('שכבת GovMap — חלון אחרון (עותק)', 'GovMap layer — recent window (copy)'),
  'over:govmap-national': bi('שכבת GovMap — הקובץ המלא (עותק)', 'GovMap layer — whole file (copy)'),
  'register-live': bi('מאגר רשות המסים — חיפוש חי', 'Tax Authority register — live search'),
  'rmi:michrazim': bi('רשות מקרקעי ישראל — אתר המכרזים', 'Israel Land Authority — tender site'),
  'datagov:moch:urban-renewal-complexes': bi('משרד הבינוי — מתחמי התחדשות עירונית', 'MoCH — urban-renewal complexes'),
  'iplan:xplan': bi('מינהל התכנון — XPlan', 'Planning Administration — XPlan'),
  'iplan:xplan:renewal': bi('מינהל התכנון — XPlan (תכניות מתחמי התחדשות)', 'Planning Administration — XPlan (renewal-complex plans)'),
  'iplan:vatmal': bi('מינהל התכנון — ותמ״ל', 'Planning Administration — VATMAL'),
  'datagov:moch:dira-behanacha-lotteries': bi('משרד הבינוי — הגרלות דירה בהנחה', 'MoCH — Dira Behanacha lotteries'),
  'dira-lehaskir:tenders': bi('דירה להשכיר — הודעות מכרזים', 'Dira Lehaskir — tender notices'),
  'cbs:construction': bi('הלמ״ס — נתוני בנייה', 'CBS — construction series'),
  'cbs:new-home-sales': bi('הלמ״ס — סדרות מכירות', 'CBS — sales series'),
  'tlv:iview2:permits-772': bi('עיריית תל אביב-יפו — היתרים (IView2)', 'Tel Aviv-Yafo — permits (IView2)'),
  'propx:trust': bi('מרכז האמון — יומני הריצה', 'Trust Center — run logs'),
};
const srcOf = (id, copyDate, publicationDate) => ({ id, label: SRC_LABEL[id] || bi(id, id), copyDate: copyDate || null, publicationDate: publicationDate || null });

let CAT = null;
function trust(A_at) {
  const st = S.stamp();
  if (CAT && CAT.st === st) return CAT.v;
  const by = new Map();
  try { for (const s of require('../trust/catalog').catalog({ now: Date.parse(A_at) || Date.now() }).sources || []) by.set(s.id, s); } catch { /* the catalogue is optional */ }
  CAT = { st, v: by };
  return by;
}
const trustState = (ctx, id) => { const s = ctx.trust.get(id); return s && s.sync ? s.sync.state || null : null; };

/* ───────────────────────── TRANSACTION ───────────────────────── */
const TX_STATE = {
  PRICED_IN_STATISTICS: bi('מתומחר בסטטיסטיקה', 'priced in statistics'), VERIFIED_DWELLING: bi('דירה מאומתת — לא מתומחרת', 'verified dwelling — not priced'),
  RECORDED_EVENT: bi('אירוע רשום', 'recorded event'), LIMITED_SHARE_NOT_STATED: bi('חלק הבעלות לא צוין — המחיר אינו בשימוש בסטטיסטיקה', 'share not stated — price not used in statistics'),
  CONFLICT: bi('סתירה בין המקורות', 'source conflict'),
};
function txReads() {
  return S.memo('txReads', [S.FILES.evRuns, S.FILES.recentMeta, S.FILES.natRuns, S.FILES.natMeta], () => {
    const ev = S.readLines(S.FILES.evRuns).filter((r) => r.sweep && r.sweep.status === 'COMPLETE').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    const sweeps = [...new Set(ev.map((r) => r.scrapedAt))];
    const rm = S.readJson(S.FILES.recentMeta), nm = S.readJson(S.FILES.natMeta);
    const vid = nm && nm.version ? nm.version.id : null;
    const natBuild = S.readLines(S.FILES.natRuns).filter((r) => r.kind === 'build' && r.status === 'SUCCESS' && r.version && r.version.id === vid).map((r) => r.at).sort()[0] || null;
    return {
      register: { sweepAt: ev.length ? ev[0].finishedAt || ev[0].startedAt : null, copies: sweeps.length },
      recent: { readAt: rm && rm.source && rm.source.snapshot ? rm.source.snapshot.fetchedAt : null, copyDate: rm && rm.source ? day(rm.source.loadedAt) : null },
      national: { readAt: natBuild, copyDate: nm && nm.version ? day(nm.version.detectedAt) : null },
    };
  });
}
const txRule = (sid) => (sid === 'over:govmap-recent' ? 'chg-tx-govmap-recent' : sid === 'over:govmap-national' ? 'chg-tx-govmap-national' : 'chg-tx-register');
function txItem(e, scopeOf, reads, regObservedAt) {
  const gm = e.source === 'govmap' || /^over:govmap/.test(e.sourceId || '');
  const sid = e.sourceId || 'over:deals-register';
  const observedAt = gm ? (sid === 'over:govmap-recent' ? e.firstReadAt || reads.recent.readAt : reads.national.readAt) : regObservedAt;
  const addr = [e.street, e.houseNumber].filter(Boolean).join(' ');
  const type = e.kind === 'TYPE_NOT_STATED' || !e.propertyType ? bi('סוג הנכס לא צוין', 'property type not stated') : bi(e.propertyType, e.propertyType);
  const st = TX_STATE[e.state] || bi(e.state || '—', e.state || '—');
  const sc = scopeOf(e);
  const where = addr || (e.block ? `${e.block}/${e.parcel}${e.subParcel ? '/' + e.subParcel : ''}` : e.city || '');
  return mk(txRule(sid), {
    id: 'tx:' + e.id, eventDate: day(e.date), observedAt, observedBasis: gm ? 'FIRST_READ_OF_A_NEWER_COPY' : 'BASELINE_READ', baseline: !gm,
    source: srcOf(sid, e.snapshotDate, null), cls: 'OBSERVED', scope: sc.scope, placement: sc.placement, relation: sc.relation || null, matchedStreet: sc.street || null,
    title: bi(`עסקה · ${type.he}${where ? ' · ' + where : ''}`, `Deal · ${type.en}${where ? ' · ' + where : ''}`),
    detail: bi([e.price != null ? `₪${fmtInt(e.price)}` : null, e.areaSqm ? `${fmtInt(e.areaSqm)} מ״ר` : null, e.rooms ? `${e.rooms} חד׳` : null, st.he].filter(Boolean).join(' · '),
      [e.price != null ? `₪${fmtInt(e.price)}` : null, e.areaSqm ? `${fmtInt(e.areaSqm)} m²` : null, e.rooms ? `${e.rooms} rooms` : null, st.en].filter(Boolean).join(' · ')),
    values: { price: e.price != null ? e.price : null, priceUsed: !!e.inStatistics, areaSqm: e.areaSqm || null, rooms: e.rooms || null, state: e.state, notes: e.notes || [], kind: e.kind,
      street: e.street || null, house: e.houseNumber || null, block: e.block || null, parcel: e.parcel || null, subParcel: e.subParcel || null, city: e.city || null, cityCode: e.cityCode || null, conflict: !!e.conflict,
      recentLayer: sid === 'over:govmap-recent', promotionState: e.promotionState || null, match: e.geo ? e.geo.match : null },
    link: sc.link,
  });
}
/** the street a transaction event names with certainty (its link target) */
function txStreetLink(e) {
  if (e.source === 'govmap' && e.streetCode != null && e.cityCode != null) return { type: 'street', id: `st:${e.cityCode}:${e.streetCode}` };
  const on = (e.streets || []).filter((s) => s && s.code != null);
  if (e.source === 'register' && on.length === 1 && e.parcelState === 'OBSERVED') return { type: 'street', id: `st:${e.cityCode}:${on[0].code}` };
  return e.cityCode != null ? { type: 'transactions', id: 'loc:' + e.cityCode } : null;
}
function collectTransactions(geo, ctx) {
  const TX = require('../txevents');
  const EV = require('../streets/evidence');
  const reads = txReads();
  const from = ctx.windowFrom, A = ctx.A;
  const items = [], excluded = { possibleDuplicates: 0 };
  /* the dates of the POSSIBLE DUPLICATE events (never listed, never counted): the feed states how many fall in the SELECTED period —
     kept off the wire (non-enumerable) */
  Object.defineProperty(excluded, 'dates', { value: [], enumerable: false });
  let coverage;
  const covParts = (cov) => cov.map((c) => ({ id: c.id, label: SRC_LABEL[c.id] || bi(c.id, c.id), read: !!c.read, reason: c.reason || null, copyDate: c.snapshotDate || null, coveredFrom: c.coveredFrom || null,
    coveredThrough: c.coveredThrough || null, checkedAt: c.checkedAt || null, freshness: c.state || null,
    dated: true, history: c.id === 'over:deals-register' ? { kept: false, copies: reads.register.copies, note: bi('עותק מרשם אחד נקלט — עסקה שנוספה בעותק מאוחר יותר עוד אינה ניתנת לזיהוי; העותק הראשון הוא קו הבסיס', 'one register copy swept — a deal added in a later copy cannot be detected yet; the first copy is the baseline') }
      : { kept: true, note: bi('קריאה ראשונה לכל שורה נשמרת; שורה שעותק המרשם אינו מחזיק = נצפתה לראשונה בעותק חדש יותר', 'the first read of every row is kept; a row the register copy does not hold = first observed in a newer copy') } }));
  const txCoverage = (cov, rec, scopeReason) => {
    const anyRead = cov.some((c) => c.read);
    const fresh = rec ? rec.state : null;
    const state = !anyRead ? 'NOT_IN_COVERAGE' : ['STALE', 'VERY_STALE', 'SOURCE_LAG_UNKNOWN'].includes(fresh) ? 'STALE' : 'COVERED';
    return { state, parts: covParts(cov), dated: true, coveredFrom: null, coveredThrough: rec ? rec.evidenceCheckedThrough : null, freshness: fresh,
      reason: state === 'NOT_IN_COVERAGE' ? (scopeReason || bi('אף מקור עסקאות אינו מחזיק את היישוב', 'no transaction source holds this locality')) : state === 'STALE' ? bi(`העותק העדכני ביותר במצב ${fresh}`, `the freshest copy is ${fresh}`) : null,
      excluded };
  };
  if (geo.kind === 'street' || geo.kind === 'neighbourhood') {
    const seen = new Set(); let cov = null, rec = null;
    for (const s of geo.streets) {
      const q = TX.query({ streetId: s.id, all: true, unlimited: true, today: A });
      cov = cov || q.coverage; rec = rec && q.recency && rec.evidenceCheckedThrough >= (q.recency.evidenceCheckedThrough || '') ? rec : q.recency;
      const sh = EV.shardOf(s.cityCode); const regAt = sh && sh.fetchedAt ? sh.fetchedAt : reads.register.sweepAt;
      for (const e of q.events) {
        if (e.state === 'POSSIBLE_DUPLICATE') { if (e.date > from && e.date <= A) { excluded.possibleDuplicates++; excluded.dates.push(e.date); } continue; }
        if (seen.has(e.id)) continue; seen.add(e.id);
        const certain = e.geo && (e.geo.match === 'STREET' || e.geo.match === 'BUILDING');
        const it = txItem(e, () => ({ scope: 'EXACT_STREET', placement: certain ? 'CERTAIN' : 'POSSIBLE', relation: e.geo ? e.geo.match : null, street: { id: s.id, name: s.name }, link: { type: 'street', id: s.id } }), reads, regAt);
        if (inWindow(it, from, A)) items.push(it);
      }
    }
    coverage = cov ? txCoverage(cov, rec) : { state: 'NOT_IN_COVERAGE', parts: [], reason: bi('לרחובות השכונה אין קישור מאומת', 'the neighbourhood has no verified street'), excluded };
    return { items, coverage };
  }
  if (geo.kind === 'locality') {
    const code = geo.locality.code;
    const q = TX.query({ code, all: true, unlimited: true, today: A });
    const sh = EV.shardOf(code); const regAt = sh && sh.fetchedAt ? sh.fetchedAt : reads.register.sweepAt;
    for (const e of q.events) {
      if (e.state === 'POSSIBLE_DUPLICATE') { if (e.date > from && e.date <= A) { excluded.possibleDuplicates++; excluded.dates.push(e.date); } continue; }
      const it = txItem(e, (x) => ({ scope: 'LOCALITY', placement: 'CERTAIN', relation: null, link: txStreetLink(x) }), reads, regAt);
      if (inWindow(it, from, A)) items.push(it);
    }
    return { items, coverage: txCoverage(q.coverage || [], q.recency, q.swept === false && !q.events.length ? bi('היישוב לא נסרק במאגר ואין לו שורות בשכבת GovMap', 'the locality is not swept in the register and has no GovMap-layer row') : null) };
  }
  /* a district / Israel: the newest events of the transaction-events index (exact per-day counts beside them) + the GovMap rows the
     register copy does not hold, per locality — the older ones become one batch per locality and source */
  const L = TX.stores().latest;
  if (!L) return { items, coverage: { state: 'NOT_IN_COVERAGE', parts: [], reason: bi('אינדקס אירועי העסקאות לא נבנה', 'the transaction-events index is not built'), excluded } };
  const dist = geo.kind === 'district' ? L.districts[geo.id] : null;
  const top = geo.kind === 'district' ? (dist ? dist.top : []) : L.national.top;
  const perDay = geo.kind === 'district' ? (dist ? dist.perDay : {}) : L.national.perDay;
  for (const e of top || []) {
    const it = txItem({ ...e, source: /^over:govmap/.test(e.sourceId) ? 'govmap' : 'register' }, (x) => ({ scope: 'LOCALITY', placement: 'CERTAIN', link: x.street && x.cityCode != null ? { type: 'transactions', id: 'loc:' + x.cityCode } : x.cityCode != null ? { type: 'transactions', id: 'loc:' + x.cityCode } : null }), reads, reads.register.sweepAt);
    it.baseline = true;   /* listed for their own date only: the newly observed older rows are counted in the per-locality batches below */
    if (it.eventDate > from && it.eventDate <= A) items.push(it);
  }
  const S0 = TX.stores();
  const codes = geo.kind === 'district' ? geo.localityCodes : [...new Set([...Object.keys((S0.national && S0.national.byCode) || {}), ...Object.keys((require('../recent/read').load().layer || {}).byCode || {})].map(Number))];
  const batches = [];
  for (const code of codes) {
    let evs; try { evs = TX.layerEventsOf(code, S0).events; } catch { evs = []; }
    if (!evs.length) continue;
    const by = new Map();
    for (const e of evs) { if (e.state === 'POSSIBLE_DUPLICATE') continue; const k = e.sourceId; if (!by.has(k)) by.set(k, []); by.get(k).push(e.date); }
    const loc = require('./geo').localityOf(code);
    for (const [sid, dates] of by) batches.push({ code, name: loc ? loc.name : bi(String(code), String(code)), sourceId: sid, dates: dates.filter(Boolean).sort(),
      observedAt: sid === 'over:govmap-recent' ? reads.recent.readAt : reads.national.readAt, copyDate: sid === 'over:govmap-recent' ? reads.recent.copyDate : reads.national.copyDate });
  }
  const cov = TX.coverageOf(5000, S0, A).map((c) => ({ ...c, read: c.id === 'over:deals-register' ? true : c.read }));
  const rec = TX.recencyOf(top || [], cov);
  const exact = (pf, pt) => Object.entries(perDay || {}).reduce((a, [d, v]) => a + (d > pf && d <= pt ? v : 0), 0);
  return { items, batches, exactNew: exact, coverage: { ...txCoverage(cov, rec), listing: bi('הרשימה = האירועים החדשים ביותר של האזור (מ-2026); הספירה מדויקת מספירה יומית', 'the list = the area\'s newest events (from 2026); the count is exact from a per-day tally') } };
}
/** the per-locality batches → items for one period (the GovMap rows dated before the period, first read inside it) */
function batchItems(batches, from, A) {
  const out = [];
  for (const b of batches || []) {
    if (!(day(b.observedAt) > from && day(b.observedAt) <= A)) continue;
    const older = b.dates.filter((d) => d <= from);
    if (!older.length) continue;
    out.push(mk('chg-tx-batch', { id: `txb:${b.code}:${b.sourceId}`, n: older.length, eventDate: older[older.length - 1], eventDateRange: { from: older[0], to: older[older.length - 1] }, observedAt: b.observedAt,
      observedBasis: 'FIRST_READ_OF_A_NEWER_COPY', baseline: false, source: srcOf(b.sourceId, b.copyDate, null), cls: 'OBSERVED', scope: 'LOCALITY',
      title: bi(`${b.name.he} · ${fmtInt(older.length)} עסקאות ישנות שנצפו לראשונה`, `${b.name.en} · ${fmtInt(older.length)} older deals first observed`),
      detail: bi(`עסקאות מ-${older[0]} עד ${older[older.length - 1]} שעותק המרשם אינו מחזיק — שכבה נפרדת, המחיר אינו בשימוש בסטטיסטיקה`, `deals dated ${older[0]} … ${older[older.length - 1]} the register copy does not hold — a separate layer, prices not used in statistics`),
      values: { cityCode: b.code, deals: older.length, sourceId: b.sourceId }, link: { type: 'changes', id: 'loc:' + b.code } }));
  }
  return out;
}

/* ───────────────────────── LAND_TENDER ───────────────────────── */
const TRACK = { 'open-market': bi('שוק חופשי', 'open market'), subsidized: bi('דיור מסובסד', 'subsidized'), rental: bi('דיור להשכרה', 'rental'), 'residential-lottery': bi('הגרלה', 'lottery'), 'special-population': bi('אוכלוסייה ייעודית', 'special population'), 'mixed-use': bi('עירוב שימושים', 'mixed use'), 'commercial-other': bi('מסחר / אחר', 'commercial / other') };
const LIFE = { published: bi('פורסם', 'published'), open: bi('פתוח להצעות', 'open for bids'), closed: bi('נסגר — ממתין להחלטה', 'closed — decision pending'), 'lottery-pending': bi('ממתין להגרלה', 'awaiting lottery'), decided: bi('נדון', 'decided'), awarded: bi('הוכרזו זוכים', 'awarded'), 'decided-no-award': bi('נדון — ללא זוכה', 'decided — no winner'), frozen: bi('נדחה / מוקפא', 'postponed / frozen'), cancelled: bi('בוטל', 'cancelled') };
const locNameOf = (code) => { const l = require('./geo').localityOf(code); return l ? l.name : bi(String(code), String(code)); };
function scopeForRecord(geo, sps, parcels, code) {
  if (geo.kind === 'street' || geo.kind === 'neighbourhood') return parcelRelation(parcels, sps, code) || { scope: 'LOCALITY', relation: 'IN_THE_STREET_LOCALITY', distanceM: null };
  return { scope: 'LOCALITY', relation: null, distanceM: null };
}
function tendersInGeo(geo) {
  const T = S.tenders();
  if (geo.kind === 'il') return T.all;
  const codes = require('./geo').localityCodesOf(geo);
  const out = []; for (const c of codes) for (const t of T.byLoc.get(c) || []) out.push(t);
  return out;
}
function collectLand(geo, ctx, sps) {
  const T = S.tenders(), Rd = S.radar();
  const from = ctx.windowFrom, A = ctx.A, items = [];
  for (const t of tendersInGeo(geo)) {
    const sc = scopeForRecord(geo, sps, (t.parcels || []).map((p) => `${p.block}/${p.parcel}`), t.localityCode);
    if (!sc) continue;
    const ev = Rd.byEntity.get(t.id) || [];
    const loc = locNameOf(t.localityCode), tr = TRACK[t.track] || bi(t.track || '—', t.track || '—');
    const units = t.units ? bi(` · ${fmtInt(t.units)} יח״ד`, ` · ${fmtInt(t.units)} units`) : bi('', '');
    const base = { source: srcOf('rmi:michrazim', day(t.sourceUpdatedAt), day(t.sourceUpdatedAt)), scope: sc.scope, relation: sc.relation, distanceM: sc.distanceM, matchedStreet: sc.street ? { id: sc.street.id, name: sc.street.name } : null,
      link: { type: 'tender', id: t.id }, values: { tender: t.name, track: t.track, units: t.units || null, lifecycle: t.lifecycle, localityCode: t.localityCode } };
    const firstBase = !!t.firstSeenAt && T.bulk.has(day(t.firstSeenAt));
    const newEv = ev.find((e) => e.kind === 'tender-new');
    /* published — dated by the Authority's publication date */
    const pd = day(t.publishedDate);
    if (isDay(pd) && pd <= A) {
      const it = mk('chg-land-published', { ...base, id: `land:${t.id}:published`, eventDate: pd, observedAt: newEv ? newEv.at : t.firstSeenAt, observedBasis: newEv ? 'CHANGE_READ' : firstBase ? 'BASELINE_READ' : 'FIRST_READ', baseline: newEv ? false : firstBase,
        title: bi(`מכרז ${t.name} — פורסם · ${loc.he}`, `Tender ${t.name} — published · ${loc.en}`), detail: bi(`${tr.he}${units.he} · מצב נוכחי: ${(LIFE[t.lifecycle] || bi(t.lifecycle, t.lifecycle)).he}`, `${tr.en}${units.en} · current state: ${(LIFE[t.lifecycle] || bi(t.lifecycle, t.lifecycle)).en}`) });
      if (inWindow(it, from, A)) items.push(it);
    }
    /* decided — dated by the committee / decision date */
    const dd = day(t.committeeDate || t.decisionDate);
    const decided = t.lifecycle === 'awarded' || t.lifecycle === 'decided-no-award';
    const decEv = ev.find((e) => e.kind === 'tender-awarded' || e.kind === 'tender-no-award');
    if (decided && isDay(dd) && dd <= A) {
      const aw = t.lifecycle === 'awarded';
      const winners = Array.isArray(t.winners) ? [...new Set(t.winners.map((w) => w.name).filter(Boolean))] : [];
      const it = mk(aw ? 'chg-land-awarded' : 'chg-land-no-award', { ...base, id: `land:${t.id}:decided`, eventDate: dd, observedAt: decEv ? decEv.at : t.firstSeenAt, observedBasis: decEv ? 'CHANGE_READ' : firstBase ? 'BASELINE_READ' : 'FIRST_READ', baseline: decEv ? false : firstBase,
        title: bi(`מכרז ${t.name} — ${aw ? 'הוכרזו זוכים' : 'נדון ללא זוכה'} · ${loc.he}`, `Tender ${t.name} — ${aw ? 'winners declared' : 'decided, no winner'} · ${loc.en}`),
        detail: bi(`${tr.he}${units.he}${winners.length ? ` · זוכים כפי שפורסמו: ${winners.slice(0, 3).join(' · ')}${winners.length > 3 ? ` ועוד ${winners.length - 3}` : ''}` : ''}`, `${tr.en}${units.en}${winners.length ? ` · winners as published: ${winners.slice(0, 3).join(' · ')}${winners.length > 3 ? ` and ${winners.length - 3} more` : ''}` : ''}`),
        values: { ...base.values, winners: winners.length } });
      if (inWindow(it, from, A)) items.push(it);
    }
    /* every other lifecycle change PROPX observed between two reads (the radar's ledger events) */
    for (const e of ev) {
      if (!/^tender-/.test(e.kind) || e.kind === 'tender-new' || ((e.kind === 'tender-awarded' || e.kind === 'tender-no-award') && decided && isDay(dd))) continue;
      const v = e.values || {}, sd = day(e.sourceDate);
      /* the date the lifecycle step names (bids open · bids close · the decision), when it is on or before the read; else the record's source update */
      const md = day(v.to === 'open' ? t.openDate : v.to === 'closed' || v.to === 'lottery-pending' ? t.closeDate : v.to === 'awarded' || v.to === 'decided-no-award' ? t.committeeDate || t.decisionDate : null);
      const evd = isDay(md) && md <= day(e.at) ? md : isDay(sd) && sd <= day(e.at) ? sd : day(e.at);
      const it = mk('chg-land-transition', { ...base, id: `land:${e.id}`, verb: VERBS.verbOf(e), m: e.m, eventDate: evd, eventDateBasis: isDay(md) && md <= day(e.at) ? 'SOURCE' : isDay(sd) && sd <= day(e.at) ? 'SOURCE_UPDATE' : 'OBSERVED',
        observedAt: e.at, observedBasis: 'CHANGE_READ', title: bi(`מכרז ${t.name} — ${(LIFE[v.to] || bi(v.to || '—', v.to || '—')).he} · ${loc.he}`, `Tender ${t.name} — ${(LIFE[v.to] || bi(v.to || '—', v.to || '—')).en} · ${loc.en}`),
        detail: bi(`קודם: ${(LIFE[v.from] || bi(v.from || '—', v.from || '—')).he} · ${tr.he}${units.he}`, `before: ${(LIFE[v.from] || bi(v.from || '—', v.from || '—')).en} · ${tr.en}${units.en}`), values: { ...base.values, from: v.from || null, to: v.to || null } });
      if (inWindow(it, from, A)) items.push(it);
    }
  }
  const runs = S.runSpan(S.FILES.landRuns);
  const ts = trustState(ctx, 'rmi:michrazim');
  const spatialNote = geo.kind === 'street' || geo.kind === 'neighbourhood' ? bi('מכרז מגיע לרחוב רק דרך גוש/חלקה: חלקה של הרחוב (ברחוב) או חלקה שקובץ GovMap ממקם במרחק עד 300 מ׳ (ליד הרחוב)', 'a tender reaches a street only through block / parcel: a parcel of the street (on the street) or a parcel the GovMap file places within 300 m (near the street)') : null;
  return { items, coverage: { state: ts === 'STALE' ? 'STALE' : 'COVERED', dated: true, historySince: day(runs.first), coveredFrom: null, coveredThrough: ctx.A, trust: ts,
    reason: ts === 'STALE' ? bi('בדיקת אתר המכרזים לא עדכנית', 'the tender-site check is stale') : null, note: spatialNote,
    parts: [{ id: 'rmi:michrazim', label: SRC_LABEL['rmi:michrazim'], dated: true, history: { kept: true, since: day(runs.first) }, checkedAt: runs.last, trust: ts }] } };
}

/* ───────────────────────── URBAN_RENEWAL ───────────────────────── */
function renewalScope(geo, sps, c) {
  if (geo.kind !== 'street' && geo.kind !== 'neighbourhood') return { scope: 'LOCALITY' };
  const k = c.planKey ? String(c.planKey).replace(/\s+/g, '') : null;
  const ctxLoc = { scope: 'LOCALITY', relation: 'IN_THE_STREET_LOCALITY' };
  if (!k) return ctxLoc;
  let best = null;
  for (const sp of sps) for (const p of (sp.pl && sp.pl.plans) || []) {
    if (String(p.planNumber || '').replace(/\s+/g, '') !== k) continue;
    const r = p.relation === 'INTERSECTS' ? { scope: 'EXACT_STREET', relation: 'PLAN_INCLUDES_A_PARCEL_OF_THE_STREET', distanceM: 0 } : { scope: 'NEAR_STREET', relation: p.relation === 'AREA_WIDE' ? 'AREA_WIDE_PLAN' : 'PLAN_WITHIN_RADIUS', distanceM: p.distanceM };
    if (!best || (r.scope === 'EXACT_STREET' && best.scope !== 'EXACT_STREET') || (r.scope === best.scope && r.distanceM < best.distanceM)) best = { ...r, street: sp.street };
  }
  return best || ctxLoc;
}
function collectRenewal(geo, ctx, sps) {
  const C = S.complexes(), Rd = S.radar();
  const from = ctx.windowFrom, A = ctx.A, items = [];
  const codes = require('./geo').localityCodesOf(geo);
  const list = codes == null ? C.all : [...codes].flatMap((c) => C.byLoc.get(c) || []);
  for (const c of list) {
    const sc = renewalScope(geo, sps, c); if (!sc) continue;
    const ev = Rd.byEntity.get(c.id) || [];
    const loc = locNameOf(c.localityCode);
    const base = { source: srcOf('datagov:moch:urban-renewal-complexes', day(c.provenance && c.provenance.sourceUpdatedAt), day(c.provenance && c.provenance.sourceUpdatedAt)), scope: sc.scope, relation: sc.relation || null, distanceM: sc.distanceM != null ? sc.distanceM : null,
      matchedStreet: sc.street ? { id: sc.street.id, name: sc.street.name } : null, link: { type: 'renewal', id: c.id }, values: { complex: c.name, plan: c.planNumber || null, proposedUnits: c.proposedUnits || null, statusHe: c.statusHe || null, localityCode: c.localityCode } };
    const units = c.proposedUnits ? bi(` · ${fmtInt(c.proposedUnits)} יח״ד מוצעות`, ` · ${fmtInt(c.proposedUnits)} proposed units`) : bi('', '');
    const dd = day(c.declarationDate), decl = ev.find((e) => e.kind === 'renewal-declared');
    if (c.declaration === 'declared' && isDay(dd) && dd <= A) {
      const firstBase = !!c.firstSeenAt && C.bulk.has(day(c.firstSeenAt));
      const it = mk('chg-renewal-declared', { ...base, id: `renewal:${c.id}:declared`, eventDate: dd, observedAt: decl ? decl.at : c.firstSeenAt, observedBasis: decl ? 'CHANGE_READ' : firstBase ? 'BASELINE_READ' : 'FIRST_READ', baseline: decl ? false : firstBase,
        title: bi(`${c.name} (${loc.he}) — הוכרז מתחם התחדשות`, `${c.name} (${loc.en}) — renewal complex declared`), detail: bi(`${c.statusHe || ''}${units.he}${c.planNumber ? ` · תכנית ${c.planNumber}` : ''}`, `${c.statusHe || ''}${units.en}${c.planNumber ? ` · plan ${c.planNumber}` : ''}`) });
      if (inWindow(it, from, A)) items.push(it);
    }
    for (const e of ev) {
      if (e.kind === 'renewal-declared' && c.declaration === 'declared' && isDay(dd)) continue;
      if (!/^renewal-/.test(e.kind)) continue;
      const v = e.values || {};
      const it = mk('chg-renewal-transition', { ...base, id: `renewal:${e.id}`, verb: VERBS.verbOf(e), m: e.m, eventDate: day(e.at), eventDateBasis: 'OBSERVED', observedAt: e.at, observedBasis: 'CHANGE_READ',
        title: e.title, detail: bi(`קודם: ${v.from == null ? '—' : v.from}`, `before: ${v.from == null ? '—' : v.from}`), values: { ...base.values, from: v.from == null ? null : v.from, to: v.to == null ? null : v.to } });
      if (inWindow(it, from, A)) items.push(it);
    }
  }
  const runs = S.runSpan(S.FILES.renewalRuns), ts = trustState(ctx, 'datagov:moch:urban-renewal-complexes');
  const street = geo.kind === 'street' || geo.kind === 'neighbourhood';
  const located = !street || sps.some((sp) => sp.located);
  return { items, coverage: { state: !located ? 'NOT_IN_COVERAGE' : ts === 'STALE' ? 'STALE' : 'COVERED', dated: true, historySince: day(runs.first), coveredFrom: null, coveredThrough: ctx.A, trust: ts,
    reason: !located ? bi('הרחוב אינו ממוקם בקובץ GovMap — אי אפשר לחשב יחס מרחבי לתכניות', 'the street is not located in the GovMap file — no spatial relation to plans can be computed') : null,
    note: street ? bi('מתחם מגיע לרחוב רק דרך התכנית שלו (מספר תכנית): גבול התכנית כולל חלקה של הרחוב, או במרחק עד 300 מ׳', 'a complex reaches a street only through its plan (plan number): the plan boundary includes a parcel of the street, or lies within 300 m') : null,
    parts: [{ id: 'datagov:moch:urban-renewal-complexes', label: SRC_LABEL['datagov:moch:urban-renewal-complexes'], dated: true, history: { kept: true, since: day(runs.first) }, checkedAt: runs.last, trust: ts }] } };
}

/* ───────────────────────── PLANNING ───────────────────────── */
const PLAN_MILESTONES = [['receivedDate', 'chg-plan-received', bi('נקלטה', 'received')], ['depositDate', 'chg-plan-deposited', bi('הופקדה', 'deposited')], ['approvalHearingDate', 'chg-plan-approval-hearing', bi('דיון באישור', 'approval hearing')], ['gazetteDate', 'chg-plan-in-force', bi('פורסמה ברשומות — בתוקף', 'published in the gazette — in force')]];
const REL_SCOPE = (p) => (p.relation === 'INTERSECTS' ? { scope: 'EXACT_STREET', relation: 'PLAN_INCLUDES_A_PARCEL_OF_THE_STREET', distanceM: 0 } : { scope: 'NEAR_STREET', relation: p.relation === 'AREA_WIDE' ? 'AREA_WIDE_PLAN' : p.topic === 'RAIL_TRANSIT' ? 'TRANSIT_PLAN_WITHIN_1000M' : 'PLAN_WITHIN_RADIUS', distanceM: p.distanceM });
function planItems(p, sc, ctx, observedAt, items) {
  const loc = p.localityCode != null ? locNameOf(p.localityCode) : null;
  for (const [field, rule, lab] of PLAN_MILESTONES) {
    const d = day(p.dates && p.dates[field]);
    if (!isDay(d) || d > ctx.A || d <= ctx.windowFrom) continue;
    items.push(mk(rule, { id: `plan:${p.oid}:${field}`, eventDate: d, observedAt, observedBasis: 'SNAPSHOT_READ', baseline: true, source: srcOf('iplan:xplan', day(observedAt), day(p.lastUpdate)),
      scope: sc.scope, relation: sc.relation || null, distanceM: sc.distanceM != null ? sc.distanceM : null, matchedStreet: sc.street ? { id: sc.street.id, name: sc.street.name } : null,
      title: bi(`תכנית ${p.planNumber}${p.name ? ` — ${p.name}` : ''}: ${lab.he}`, `Plan ${p.planNumber}${p.name ? ` — ${p.name}` : ''}: ${lab.en}`),
      detail: bi(`${p.kind || ''}${loc ? ` · ${loc.he}` : ''}${p.planUnitDelta ? ` · שינוי יח״ד בתכנית ${fmtInt(p.planUnitDelta)}` : ''} · שלב נוכחי: ${p.station || p.stage || '—'}`, `${p.kind || ''}${loc ? ` · ${loc.en}` : ''}${p.planUnitDelta ? ` · the plan's unit change ${fmtInt(p.planUnitDelta)}` : ''} · current stage: ${p.stage || '—'}`),
      link: { type: 'plan', id: p.planNumber, href: p.url || null }, values: { plan: p.planNumber, mpId: p.mpId || null, stage: p.stage || null, topic: p.topic || null, planUnitDelta: p.planUnitDelta != null ? p.planUnitDelta : null, milestone: field, localityCode: p.localityCode != null ? p.localityCode : null } }));
  }
}
function collectPlanning(geo, ctx, sps) {
  const from = ctx.windowFrom, A = ctx.A, items = [];
  let localityContext = null;
  const street = geo.kind === 'street' || geo.kind === 'neighbourhood';
  const meta = S.readJson(S.FILES.planMeta);
  const readAt = meta ? meta.fetchedAt : null;
  const parts = [{ id: 'iplan:xplan', label: SRC_LABEL['iplan:xplan'], dated: true, history: { kept: false, note: bi('השכבה נשמרת כתמונת מצב: אבני הדרך המתוארכות של התכנית מוצגות; שינויי סטטוס בין קריאות אינם נשמרים לשכבה הארצית', 'the layer is kept as a snapshot: a plan\'s dated milestones are shown; status changes between reads are not kept for the national layer') }, checkedAt: readAt, complete: meta ? !!meta.complete : false }];
  const seenPlan = new Set();
  if (street) {
    for (const sp of sps) {
      if (!sp.pl || !sp.pl.available) continue;
      for (const p of [...(sp.pl.plans || []), ...(sp.pl.transit || [])]) { if (seenPlan.has(p.oid)) continue; seenPlan.add(p.oid); planItems({ ...p, localityCode: null }, { ...REL_SCOPE(p), street: sp.street }, ctx, readAt, items); }
      /* VATMAL declared complexes — reach a street only spatially (never mapped to a locality code) */
      const V = sp.pl.vatmal;
      if (V && V.available) for (const c of V.complexes || []) {
        const sc = c.relation === 'INTERSECTS' ? { scope: 'EXACT_STREET', relation: 'VATMAL_INCLUDES_A_PARCEL_OF_THE_STREET', distanceM: 0 } : { scope: 'NEAR_STREET', relation: c.relation === 'AREA_WIDE' ? 'AREA_WIDE_VATMAL' : 'VATMAL_WITHIN_RADIUS', distanceM: c.distanceM };
        const dates = [['declared', 'chg-vatmal-declared', c.declared], ...(c.updates || []).map((u, i) => ['update' + (i + 1), 'chg-vatmal-updated', u])];
        for (const [f, rule, d0] of dates) { const d = day(d0); if (!isDay(d) || d > A || d <= from) continue;
          items.push(mk(rule, { id: `vatmal:${c.tamal}:${f}`, eventDate: d, observedAt: V.fetchedAt, observedBasis: 'SNAPSHOT_READ', baseline: true, source: srcOf('iplan:vatmal', day(V.fetchedAt), null), ...sc, matchedStreet: { id: sp.street.id, name: sp.street.name },
            title: bi(`ותמ״ל ${c.tamal} — ${c.name || ''}: ${rule === 'chg-vatmal-declared' ? 'הוכרז' : 'עודכן'}`, `VATMAL ${c.tamal} — ${c.name || ''}: ${rule === 'chg-vatmal-declared' ? 'declared' : 'updated'}`),
            detail: bi(`הכרזה — לא תכנית מאושרת${c.units ? ` · ${fmtInt(c.units)} יח״ד מוצהרות (של ההכרזה)` : ''}`, `a declaration — not an approved plan${c.units ? ` · ${fmtInt(c.units)} declared units (the declaration's)` : ''}`), link: { type: 'vatmal', id: c.tamal }, values: { tamal: c.tamal, units: c.units || null } })); }
      }
    }
    parts.push({ id: 'iplan:vatmal', label: SRC_LABEL['iplan:vatmal'], dated: true, history: { kept: false }, note: bi('מתחם מוכרז מגיע לרחוב רק ביחס מרחבי', 'a declared complex reaches a street only by a spatial relation') });
    /* locality context: the plans whose own locality field names the street's locality, not already related to the street — read only
       when the LOCALITY scope is asked for (it decodes the whole plan layer; lib/changes/index.js calls it lazily) */
    localityContext = () => {
      const PL = S.plans(), out = [];
      for (const p of PL.byLoc.get(Number(geo.locality && geo.locality.code)) || []) if (!seenPlan.has(p.oid)) planItems(p, { scope: 'LOCALITY', relation: 'PLAN_LOCALITY_FIELD' }, ctx, readAt, out);
      return out;
    };
  } else {
    const PL = S.plans();
    const codes = require('./geo').localityCodesOf(geo);
    const list = codes == null ? PL.all : [...codes].flatMap((c) => PL.byLoc.get(c) || []);
    for (const p of list) planItems(p, { scope: 'LOCALITY', relation: 'PLAN_LOCALITY_FIELD' }, ctx, readAt, items);
    parts[0].placement = bi(`תכנית ממוקמת ביישוב לפי שדה היישוב שלה — רק כששמו זהה לשם רשמי אחד (${fmtInt(PL.resolved)} תכניות; ${fmtInt(PL.unresolved)} ללא יישוב יחיד אינן ממוקמות)`, `a plan is placed in a locality by its own locality field — only when it is exactly one official name (${fmtInt(PL.resolved)} plans; ${fmtInt(PL.unresolved)} without a single locality are not placed)`);
    parts.push({ id: 'iplan:vatmal', label: SRC_LABEL['iplan:vatmal'], dated: true, notApplicable: true, note: bi('ותמ״ל מדפיס שמות יישובים כטקסט ולעולם אינו ממופה לקוד יישוב — מגיע לרחוב רק ביחס מרחבי', 'VATMAL prints locality names as text and is never mapped to a locality code — it reaches a street only spatially') });
  }
  /* plan status changes PROPX observed between two reads (the renewal-joined plans' history, the radar's plan-status events) */
  const Rd = S.radar(), codes = require('./geo').localityCodesOf(geo);
  const streetPlans = new Map();
  if (street) for (const sp of sps) for (const p of (sp.pl && sp.pl.plans) || []) streetPlans.set(String(p.planNumber || '').replace(/\s+/g, ''), { ...REL_SCOPE(p), street: sp.street });
  const groups = new Map();
  for (const e of Rd.events) {
    if (e.kind !== 'plan-status' || !e.entity) continue;
    const k = `${e.entity.id}|${day(e.at)}`;
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e);
  }
  const STAGE_HE = { PREPARATION: 'בהכנה', SUBMITTED: 'הוגשה / בבדיקה', PRE_DEPOSIT: 'לקראת הפקדה', DEPOSITED: 'הופקדה', OBJECTIONS: 'התנגדויות', APPROVAL_PROCESS: 'בהליך אישור', APPROVED: 'אושרה', EFFECTIVE: 'בתוקף', REJECTED: 'נדחתה', OTHER: 'אחר', UNKNOWN: 'לא ידוע' };
  for (const [k, evs] of groups) {
    const e = evs.find((x) => x.values && x.values.field === 'stage') || evs[0];
    const c = e.geo && e.geo.localityCode != null ? Number(e.geo.localityCode) : null;
    let sc;
    if (street) { const pkn = String(e.entity.name || '').replace(/\s+/g, ''); sc = streetPlans.get(pkn) || (c != null && geo.locality && c === Number(geo.locality.code) ? { scope: 'LOCALITY', relation: 'IN_THE_STREET_LOCALITY' } : null); if (!sc) continue; }
    else { if (codes != null && (c == null || !codes.has(c))) continue; sc = { scope: c == null ? 'NATIONAL' : 'LOCALITY' }; }
    const sd = evs.map((x) => day(x.sourceDate)).filter(isDay).sort().pop();
    const st = evs.find((x) => x.values && x.values.field === 'stage'), sta = evs.find((x) => x.values && (x.values.field === 'station' || x.values.field === 'event'));
    const toHe = sta ? sta.values.to : st ? STAGE_HE[st.values.to] || st.values.to : '—', toEn = st ? st.values.to : sta ? sta.values.to : '—';
    const name = e.title && e.title.he ? String(e.title.he).replace(/^תכנית\s+/, '').replace(/:\s*[^:]*$/, '') : e.entity.name;
    const fields = evs.map((x) => x.values || {}).map((v) => `${v.field}: ${v.from == null ? '—' : v.from} → ${v.to == null ? '—' : v.to}`).join(' · ');
    const it = mk('chg-plan-status', { id: `planst:${k}`, verb: 'CHANGED', eventDate: isDay(sd) && sd <= day(e.at) ? sd : day(e.at), eventDateBasis: isDay(sd) && sd <= day(e.at) ? 'SOURCE_UPDATE' : 'OBSERVED', observedAt: evs.map((x) => x.at).sort().pop(), observedBasis: 'CHANGE_READ',
      source: srcOf('iplan:xplan:renewal', day(e.at), isDay(sd) ? sd : null), scope: sc.scope, relation: sc.relation || null, distanceM: sc.distanceM != null ? sc.distanceM : null, matchedStreet: sc.street ? { id: sc.street.id, name: sc.street.name } : null,
      title: bi(`תכנית ${name}: ${toHe}`, `Plan ${name}: ${toEn}`), detail: bi(`לפי מינהל התכנון · ${fields}`, `per the Planning Administration · ${fields}`),
      link: { type: 'plan', id: e.entity.name || null, href: null }, values: { plan: e.entity.name || null, fields: evs.map((x) => x.values || {}), complexes: e.entity.complexes || [] } });
    if (inWindow(it, from, A)) items.push(it);
  }
  const pr = S.runSpan(S.FILES.renewalPlanRuns);
  parts.push({ id: 'iplan:xplan:renewal', label: SRC_LABEL['iplan:xplan:renewal'], dated: false, history: { kept: true, since: day(pr.first) }, checkedAt: pr.last, note: bi('שינויי סטטוס נשמרים רק לתכניות המצורפות למתחמי התחדשות', 'status changes are kept only for the plans joined to renewal complexes') });
  const located = !street || sps.some((sp) => sp.pl && sp.pl.available);
  return { items, lazyLocality: typeof localityContext === 'function' ? localityContext : null, coverage: { state: !located ? 'NOT_IN_COVERAGE' : 'COVERED', dated: true, coveredFrom: null, coveredThrough: A, historySince: day(pr.first),
    reason: !located ? bi('הרחוב אינו ממוקם — אי אפשר לחשב יחס מרחבי לתכניות', 'the street is not located — no spatial relation to plans can be computed') : null, parts } };
}

/* ───────────────────────── HOUSING ───────────────────────── */
function collectHousing(geo, ctx) {
  const street = geo.kind === 'street' || geo.kind === 'neighbourhood';
  const H = S.lotteries(), Rd = S.radar(), meta = S.readJson(S.FILES.housingMeta);
  const runs = S.runSpan(S.FILES.housingRuns), ts = trustState(ctx, 'datagov:moch:dira-behanacha-lotteries');
  const stale = H.newest && H.newest <= minusDays(ctx.A, 365);
  const coverage = { state: stale || ts === 'STALE' ? 'STALE' : 'COVERED', dated: true, coveredFrom: null, coveredThrough: H.newest || null, historySince: day(runs.first), trust: ts, newestRecord: H.newest,
    scopes: ['LOCALITY'], scopeReason: street ? bi('ההגרלות אינן נושאות כתובת או גוש/חלקה — אינן ממוקמות ברחוב; הן מוצגות כהקשר היישוב בלבד', 'lotteries carry no address or block / parcel — never placed on a street; shown as the locality\'s context only') : null,
    reason: stale ? bi(`ההגרלה החדשה ביותר במאגר היא מ-${H.newest} (עדכון המקור ${day(meta && meta.sourceUpdatedAt) || '—'}): אין במאגר הגרלה אחרי תאריך זה`, `the dataset's newest lottery is dated ${H.newest} (source updated ${day(meta && meta.sourceUpdatedAt) || '—'}): no lottery after that date is published in it`) : null,
    parts: [{ id: 'datagov:moch:dira-behanacha-lotteries', label: SRC_LABEL['datagov:moch:dira-behanacha-lotteries'], dated: true, history: { kept: true, since: day(runs.first), events: meta ? meta.historyEvents : null }, checkedAt: runs.last, trust: ts }] };
  const codes = require('./geo').localityCodesOf(geo);
  const list = codes == null ? H.all : [...codes].flatMap((c) => H.byLoc.get(c) || []);
  const items = [];
  for (const l of list) {
    const d = day(l.lotteryDate); if (!isDay(d) || d > ctx.A) continue;
    const ev = (Rd.byEntity.get(l.id) || []).find((e) => e.kind === 'lottery-new');
    const firstBase = !!l.firstSeenAt && H.bulk.has(day(l.firstSeenAt));
    const loc = locNameOf(l.localityCode);
    const it = mk('chg-lottery-held', { id: `lottery:${l.id}`, eventDate: d, observedAt: ev ? ev.at : l.firstSeenAt, observedBasis: ev ? 'CHANGE_READ' : firstBase ? 'BASELINE_READ' : 'FIRST_READ', baseline: ev ? false : firstBase,
      source: srcOf('datagov:moch:dira-behanacha-lotteries', day(l.provenance && l.provenance.sourceUpdatedAt), day(l.provenance && l.provenance.sourceUpdatedAt)), scope: 'LOCALITY', relation: street ? 'IN_THE_STREET_LOCALITY' : null,
      title: bi(`הגרלה: ${l.projectName || l.lotteryId} · ${loc.he}`, `Lottery: ${l.projectName || l.lotteryId} · ${loc.en}`),
      detail: bi(`${l.programHe || ''}${l.unitsInLottery ? ` · ${fmtInt(l.unitsInLottery)} דירות` : ''}${l.developer ? ` · ${l.developer}` : ''}`, `${l.program || ''}${l.unitsInLottery ? ` · ${fmtInt(l.unitsInLottery)} units` : ''}${l.developer ? ` · ${l.developer}` : ''}`),
      link: { type: 'housing', id: l.id }, values: { units: l.unitsInLottery || null, applicants: l.applicants || null, localityCode: l.localityCode } });
    if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
  }
  return { items, coverage };
}

/* ───────────────────────── RENTAL ───────────────────────── */
function collectRental(geo, ctx, sps) {
  const R0 = S.dira(), T = S.tenders(), Rd = S.radar();
  const codes = require('./geo').localityCodesOf(geo);
  const items = [];
  for (const n of R0.all) {
    const tn = n.tender && n.tender.michrazId ? T.byId.get(`rmi:${n.tender.michrazId}`) : null;
    const code = tn ? Number(tn.localityCode) : null;
    if (codes != null && (code == null || !codes.has(code))) continue;
    const sc = code == null ? { scope: 'NATIONAL' } : scopeForRecord(geo, sps, (tn.parcels || []).map((p) => `${p.block}/${p.parcel}`), code);
    if (!sc) continue;
    const loc = code != null ? locNameOf(code) : null;
    const base = { source: srcOf('dira-lehaskir:tenders', day(n.modified), day(n.published)), scope: sc.scope, relation: sc.relation || (tn ? 'JOINED_BY_TENDER_NUMBER' : null), distanceM: sc.distanceM != null ? sc.distanceM : null,
      matchedStreet: sc.street ? { id: sc.street.id, name: sc.street.name } : null, link: n.link ? { type: 'external', id: n.id, href: n.link } : null, values: { notice: n.id, tender: tn ? tn.id : null, localityCode: code } };
    const d = day(n.published);
    if (isDay(d) && d <= ctx.A) {
      const ev = (Rd.byEntity.get(n.id) || []).find((e) => e.kind === 'rental-notice-new');
      const firstBase = !!n.firstSeenAt && R0.bulk.has(day(n.firstSeenAt));
      const it = mk('chg-rental-notice', { ...base, id: `rental:${n.id}`, eventDate: d, observedAt: ev ? ev.at : n.firstSeenAt, observedBasis: ev ? 'CHANGE_READ' : firstBase ? 'BASELINE_READ' : 'FIRST_READ', baseline: ev ? false : firstBase,
        title: bi(`דירה להשכיר: ${n.title}`, `Dira Lehaskir: ${n.title}`), detail: bi(`${tn ? `מכרז רמ״י ${tn.name}${loc ? ` · ${loc.he}` : ''}` : 'מכרז רמ״י לא נמצא ברשימה — ללא יישוב'}`, `${tn ? `ILA tender ${tn.name}${loc ? ` · ${loc.en}` : ''}` : 'ILA tender not in the list — no locality'}`) });
      if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
    }
    for (const e of Rd.byEntity.get(n.id) || []) {
      if (e.kind !== 'rental-notice-updated') continue;
      const it = mk('chg-rental-transition', { ...base, id: `rental:${e.id}`, verb: VERBS.verbOf(e), m: e.m, eventDate: isDay(day(e.sourceDate)) && day(e.sourceDate) <= day(e.at) ? day(e.sourceDate) : day(e.at), eventDateBasis: isDay(day(e.sourceDate)) ? 'SOURCE_UPDATE' : 'OBSERVED',
        observedAt: e.at, observedBasis: 'CHANGE_READ', title: e.title, detail: e.detail });
      if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
    }
  }
  /* planning sites carry no locality code (title text only) — Israel only */
  if (geo.kind === 'il') for (const e of Rd.events) {
    if (e.kind !== 'rental-planning-updated') continue;
    const it = mk('chg-rental-transition', { id: `rental:${e.id}`, verb: VERBS.verbOf(e), m: e.m, eventDate: isDay(day(e.sourceDate)) && day(e.sourceDate) <= day(e.at) ? day(e.sourceDate) : day(e.at), eventDateBasis: isDay(day(e.sourceDate)) ? 'SOURCE_UPDATE' : 'OBSERVED',
      observedAt: e.at, observedBasis: 'CHANGE_READ', source: srcOf('dira-lehaskir:tenders', day(e.sourceDate), null), scope: 'NATIONAL', title: e.title, detail: e.detail, link: e.entity && e.entity.link ? { type: 'external', id: e.entity.id, href: e.entity.link } : null });
    if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
  }
  const runs = S.runSpan(S.FILES.rentalRuns), ts = trustState(ctx, 'dira-lehaskir:tenders');
  return { items, coverage: { state: ts === 'STALE' ? 'STALE' : 'COVERED', dated: true, historySince: day(runs.first), coveredFrom: null, coveredThrough: ctx.A, trust: ts,
    note: bi('הודעה ממוקמת רק דרך מספר מכרז רמ״י המודפס בה (MichrazID); אתרים בתכנון — ללא יישוב', 'a notice is placed only through the ILA tender number it prints (MichrazID); planning sites carry no locality'),
    parts: [{ id: 'dira-lehaskir:tenders', label: SRC_LABEL['dira-lehaskir:tenders'], dated: true, history: { kept: true, since: day(runs.first) }, checkedAt: runs.last, trust: ts }] } };
}

/* ───────────────────────── CBS series (SALES · CONSTRUCTION) and their REVISIONS ───────────────────────── */
const CBS_GEO = { il: bi('ארצי', 'national'), 'd-jm': bi('מחוז ירושלים', 'Jerusalem district'), 'd-north': bi('מחוז הצפון', 'Northern district'), 'd-haifa': bi('מחוז חיפה', 'Haifa district'), 'd-center': bi('מחוז המרכז', 'Central district'), 'd-ta': bi('מחוז תל אביב', 'Tel Aviv district'), 'd-south': bi('מחוז הדרום', 'Southern district'), jsr: bi('יהודה ושומרון', 'Judea & Samaria') };
const MEASURE = {
  new_sold: bi('דירות חדשות שנמכרו', 'new dwellings sold'), total_sold: bi('כלל הדירות שנמכרו', 'all dwellings sold'), second_hand_sold: bi('דירות יד שנייה שנמכרו', 'second-hand dwellings sold'),
  inventory: bi('מלאי דירות חדשות שטרם נמכרו', 'unsold new-dwelling inventory'), permits: bi('היתרי בנייה (יח״ד)', 'building permits (dwellings)'), starts: bi('התחלות בנייה (יח״ד)', 'construction starts (dwellings)'),
  completions: bi('גמר בנייה (יח״ד)', 'completions (dwellings)'), active: bi('בנייה פעילה (יח״ד, מלאי)', 'active construction (dwellings, a stock)'),
};
const SALES_MEASURES = new Set(['new_sold', 'total_sold', 'second_hand_sold', 'inventory']);
const CONSTR_MEASURES = new Set(['permits', 'starts', 'completions', 'active']);
/** which CBS geography a geography reads, and how it is labelled */
function cbsGeoOf(geo) {
  if (geo.kind === 'il') return { cbs: 'il', scope: 'NATIONAL' };
  const d = geo.kind === 'district' ? geo.id : geo.district;
  const G = require('./geo').DISTRICTS[d];
  if (!G) return null;
  return { cbs: G.cbs, scope: geo.kind === 'district' ? 'DISTRICT' : 'DISTRICT_CONTEXT' };
}
function seriesItems(rows, measures, rule, sourceId, geo, ctx) {
  const g = cbsGeoOf(geo); if (!g) return [];
  const series = new Map();
  for (const r of rows) {
    if (r.geo !== g.cbs || !measures.has(r.measure) || (r.freq !== 'M' && r.freq !== 'Q')) continue;
    const k = `${r.measure}|${r.freq}`; if (!series.has(k)) series.set(k, []); series.get(k).push(r);
  }
  const firstRun = rows.map((r) => r.fetchedAt).filter(Boolean).sort()[0];
  const out = [];
  for (const [k, arr] of series) {
    const [measure, freq] = k.split('|');
    if (freq === 'Q' && series.has(`${measure}|M`)) continue;   /* one frequency per measure: the monthly when it exists */
    /* the first record of every period (revision 0), grouped by the series update that brought it: the newest period of each update = a period published */
    const firsts = arr.filter((r) => !(r.revision > 0));
    const byUpd = new Map(); for (const r of firsts) { const u = day(r.sourceUpdate); if (!isDay(u)) continue; const x = byUpd.get(u); if (!x || r.period > x.period) byUpd.set(u, r); }
    for (const [u, r] of byUpd) {
      if (u > ctx.A) continue;
      const baseline = r.fetchedAt === firstRun || day(r.fetchedAt) === day(firstRun);
      const it = mk(rule, { id: `cbs:${rule}:${measure}|${g.cbs}|${freq}|${r.period}|${u}`, eventDate: u, observedAt: r.fetchedAt, observedBasis: baseline ? 'BASELINE_READ' : 'FIRST_READ', baseline,
        source: srcOf(sourceId, u, u), scope: g.scope, title: bi(`הלמ״ס: ${(MEASURE[measure] || bi(measure, measure)).he} ${r.period} — ${fmtInt(r.value)} · ${(CBS_GEO[g.cbs] || bi(g.cbs, g.cbs)).he}`, `CBS: ${(MEASURE[measure] || bi(measure, measure)).en} ${r.period} — ${fmtInt(r.value)} · ${(CBS_GEO[g.cbs] || bi(g.cbs, g.cbs)).en}`),
        detail: bi(`עדכון הסדרה ${u} · התקופה ${r.period}${g.scope === 'DISTRICT_CONTEXT' ? ' · נתון המחוז — לא נתון המקום' : ''}`, `series update ${u} · period ${r.period}${g.scope === 'DISTRICT_CONTEXT' ? ' · the district\'s figure — not this place\'s' : ''}`),
        link: { type: 'dossier', id: geo.kind === 'il' ? 'il' : (geo.kind === 'district' ? geo.id : geo.district) }, values: { measure, period: r.period, value: r.value, freq, cbsGeo: g.cbs } });
      if (inWindow(it, ctx.windowFrom, ctx.A)) out.push(it);
    }
  }
  return out;
}
function revisionItems(rows, measures, sourceId, geo, ctx) {
  const g = cbsGeoOf(geo); if (!g) return [];
  const prev = new Map(); for (const r of rows) if (!(r.revision > 0)) prev.set(r.key, r);
  const groups = new Map();
  for (const r of rows) {
    if (!(r.revision > 0) || r.geo !== g.cbs || !measures.has(r.measure)) continue;
    const old = r.replaces != null ? r.replaces : prev.get(r.key) ? prev.get(r.key).value : null;
    const k = `${r.measure}|${r.freq}|${day(r.sourceUpdate)}`;
    const G = groups.get(k) || { measure: r.measure, freq: r.freq, sourceUpdate: day(r.sourceUpdate), observedAt: r.fetchedAt, rows: [] };
    if (r.fetchedAt > G.observedAt) G.observedAt = r.fetchedAt;
    G.rows.push({ period: r.period, from: old, to: r.value, pct: old ? Math.round(((r.value - old) / old) * 1000) / 10 : null });
    groups.set(k, G);
  }
  const out = [];
  for (const G of groups.values()) {
    const big = G.rows.slice().sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));
    const maxAbs = big.length ? Math.abs(big[0].pct || 0) : 0;
    const ml = MEASURE[G.measure] || bi(G.measure, G.measure), gl = CBS_GEO[g.cbs] || bi(g.cbs, g.cbs);
    const sign = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + x + '%');
    const it = mk('chg-cbs-revision', { id: `rev:${G.measure}|${g.cbs}|${G.freq}|${G.sourceUpdate}`, m: RU.revisionMateriality(maxAbs), eventDate: G.sourceUpdate, observedAt: G.observedAt, observedBasis: 'CHANGE_READ',
      source: srcOf(sourceId, G.sourceUpdate, G.sourceUpdate), scope: g.scope,
      title: bi(`הלמ״ס תיקנה ${G.rows.length} תקופות — ${ml.he} · ${gl.he}`, `CBS revised ${G.rows.length} period${G.rows.length === 1 ? '' : 's'} — ${ml.en} · ${gl.en}`),
      detail: bi(big.slice(0, 3).map((r) => `${r.period}: ${fmtInt(r.from)} → ${fmtInt(r.to)} (⁦${sign(r.pct)}⁩)`).join(' · ') + ' · הערך הישן נשמר', big.slice(0, 3).map((r) => `${r.period}: ${fmtInt(r.from)} → ${fmtInt(r.to)} (${sign(r.pct)})`).join(' · ') + ' · the old value is kept'),
      link: { type: 'revisions', id: g.cbs }, values: { measure: G.measure, periods: G.rows.length, maxAbsPct: maxAbs, rows: big.slice(0, 12), cbsGeo: g.cbs } });
    if (inWindow(it, ctx.windowFrom, ctx.A)) out.push(it);
  }
  return out;
}
function cbsCoverage(geo, ctx, id, runsFile, contentFrom) {
  const g = cbsGeoOf(geo), runs = S.runSpan(runsFile), ts = trustState(ctx, id);
  const content = (ctx.trust.get(id) || {}).content || null;
  const stale = ts === 'STALE' || (content && content.state === 'STALE');
  return { state: !g ? 'NOT_IN_COVERAGE' : stale ? 'STALE' : 'COVERED', dated: true, historySince: day(runs.first), coveredFrom: null, coveredThrough: ctx.A, trust: ts, content,
    reason: !g ? bi('לגאוגרפיה אין מחוז', 'the geography has no district') : stale ? bi('סדרת הלמ״ס לא עדכנית', 'the CBS series is stale') : null,
    note: g && g.scope === 'DISTRICT_CONTEXT' ? bi('הלמ״ס מפרסמת ארצי ומחוזות בלבד — נתון המחוז מוצג כהקשר, לעולם לא כנתון המקום', 'CBS publishes national and district series only — the district\'s figure is shown as context, never as this place\'s') : null,
    parts: [{ id, label: SRC_LABEL[id], dated: true, history: { kept: true, since: day(runs.first), note: contentFrom }, checkedAt: runs.last, trust: ts }] };
}
function collectSales(geo, ctx) {
  const rows = S.cbsSales();
  return { items: seriesItems(rows, SALES_MEASURES, 'chg-cbs-sales-period', 'cbs:new-home-sales', geo, ctx), coverage: cbsCoverage(geo, ctx, 'cbs:new-home-sales', S.FILES.sRuns, bi('יומן תצפיות — כל גרסה נשמרת', 'an observation ledger — every version kept')) };
}
function collectRevisions(geo, ctx) {
  const items = [...revisionItems(S.cbsSales(), SALES_MEASURES, 'cbs:new-home-sales', geo, ctx), ...revisionItems(S.cbsConstruction(), CONSTR_MEASURES, 'cbs:construction', geo, ctx)];
  const c = cbsCoverage(geo, ctx, 'cbs:new-home-sales', S.FILES.sRuns, bi('תיקון = ערך שפורסם מחדש בערך אחר; הישן נשמר', 'a revision = a value re-published with another value; the old one is kept'));
  c.parts.push(...cbsCoverage(geo, ctx, 'cbs:construction', S.FILES.cRuns).parts);
  return { items, coverage: c };
}

/* ───────────────────────── CONSTRUCTION ───────────────────────── */
function tlvIndex() {
  return S.memo('tlvIndex', [S.FILES.tlv, S.FILES.ddHist], () => {
    const ST = require('../streets/street'), SD = require('../streets/directory');
    const T = ST.tlvLinks(SD.load());
    const streetsOfRequest = new Map(), streetsOfSite = new Map();
    for (const [code, recs] of T.byStreet) for (const r of recs) {
      if (r.kind === 'permit') { const k = String(r.request); if (!streetsOfRequest.has(k)) streetsOfRequest.set(k, new Set()); streetsOfRequest.get(k).add(code); }
      else if (r.kind === 'site') { const k = String(r.tik); if (!streetsOfSite.has(k)) streetsOfSite.set(k, new Set()); streetsOfSite.get(k).add(code); }
    }
    const doc = S.readJson(S.FILES.tlv);
    const permits = new Map(); for (const p of (doc && doc.permits && doc.permits.rows) || []) { const k = `${p.request}|${p.permit || ''}`; if (!permits.has(k)) permits.set(k, p); }
    const hist = S.ddHistory();
    const histByKey = new Map(); for (const e of hist) { if (!histByKey.has(e.key)) histByKey.set(e.key, []); histByKey.get(e.key).push(e); }
    const runs = S.readLines(S.FILES.ddRuns).filter((r) => r.lanes && r.lanes.tlv && ['SUCCESS', 'UNCHANGED'].includes(r.lanes.tlv)).map((r) => r.at).sort();
    return { T, streetsOfRequest, streetsOfSite, permits: [...permits.values()], hist, histByKey, firstRead: runs[0] || null, lastRead: runs[runs.length - 1] || null, fetchedAt: doc ? doc.fetchedAt : null };
  });
}
const TLV_STAGE_EVENTS = { 'permit-stage-changed': 'CHANGED', 'site-state-changed': 'CHANGED', 'permit-request-observed': 'NEW', 'site-observed': 'NEW' };
function collectConstruction(geo, ctx) {
  const items = seriesItems(S.cbsConstruction(), CONSTR_MEASURES, 'chg-cbs-construction-period', 'cbs:construction', geo, ctx);
  const cov = cbsCoverage(geo, ctx, 'cbs:construction', S.FILES.cRuns);
  const tlvGeo = (geo.kind === 'locality' && geo.locality.code === 5000) || ((geo.kind === 'street' || geo.kind === 'neighbourhood') && geo.locality && geo.locality.code === 5000) || geo.kind === 'il' || (geo.kind === 'district' && geo.id === 'd-ta');
  if (tlvGeo) {
    const X = tlvIndex(), street = geo.kind === 'street' || geo.kind === 'neighbourhood';
    const codes = street ? new Set(geo.streets.map((s) => s.code)) : null;
    const nameOf = (code) => (geo.streets.find((s) => s.code === code) || {}).name || null;
    const placed = (streetsSet) => { if (!street) return { scope: 'LOCALITY' }; if (!streetsSet) return null; for (const c of streetsSet) if (codes.has(c)) return { scope: 'EXACT_STREET', relation: 'NAMED_IN_THE_RECORD_ADDRESS', street: { id: `st:5000:${c}`, name: nameOf(c) } }; return null; };
    const MIL = [['permitDate', 'chg-tlv-permit-issued', 'permit-issued', bi('היתר הוצא', 'permit issued')], ['start', 'chg-tlv-construction-started', 'construction-start-dated', bi('תחילת עבודות', 'construction started')], ['finished', 'chg-tlv-completion', null, bi('גמר', 'completion')], ['occupation', 'chg-tlv-completion', null, bi('אכלוס', 'occupancy')]];
    for (const p of X.permits) {
      const sc = placed(X.streetsOfRequest.get(String(p.request))); if (!sc) continue;
      const key = 'permit:tlv:' + p.request, hist = X.histByKey.get(key) || [];
      for (const [f, rule, evName, lab] of MIL) {
        const d = day(p[f]); if (!isDay(d) || d > ctx.A) continue;
        const h = evName ? hist.find((e) => e.event === evName) : null;
        const it = mk(rule, { id: `tlv:${p.request}|${p.permit || ''}:${f}`, eventDate: d, observedAt: h ? h.at : X.firstRead, observedBasis: h ? 'CHANGE_READ' : 'BASELINE_READ', baseline: !h,
          source: srcOf('tlv:iview2:permits-772', day(X.fetchedAt), null), scope: sc.scope, relation: sc.relation || null, matchedStreet: sc.street || null,
          title: bi(`${lab.he} · ${p.addresses || 'בקשה ' + p.request}`, `${lab.en} · ${p.addresses || 'request ' + p.request}`), detail: bi(`${p.type || ''}${p.units != null ? ` · ${fmtInt(p.units)} יח״ד` : ''} · שלב: ${p.stage || '—'}`, `${p.type || ''}${p.units != null ? ` · ${fmtInt(p.units)} units` : ''} · stage: ${p.stage || '—'}`),
          link: { type: 'permit', id: key }, values: { request: p.request, permit: p.permit || null, stage: p.stage || null, units: p.units != null ? p.units : null, milestone: f } });
        if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
      }
    }
    for (const e of X.hist) {
      const verb = TLV_STAGE_EVENTS[e.event]; if (!verb) continue;
      const m = /^(permit|site):tlv:(.+)$/.exec(String(e.key || '')); if (!m) continue;
      const sc = placed(m[1] === 'permit' ? X.streetsOfRequest.get(m[2]) : X.streetsOfSite.get(m[2])); if (!sc) continue;
      const sd = day(e.sourceDate);
      const it = mk('chg-tlv-transition', { id: `tlvh:${e.key}:${e.event}:${e.at}`, verb, eventDate: isDay(sd) && sd <= day(e.at) ? sd : day(e.at), eventDateBasis: isDay(sd) && sd <= day(e.at) ? 'SOURCE' : 'OBSERVED', observedAt: e.at, observedBasis: 'CHANGE_READ',
        source: srcOf('tlv:iview2:permits-772', day(e.at), isDay(sd) ? sd : null), scope: sc.scope, relation: sc.relation || null, matchedStreet: sc.street || null,
        title: bi(`${m[1] === 'permit' ? 'בקשה' : 'אתר'} ${m[2]} — ${e.event === 'permit-request-observed' ? 'בקשה חדשה ברשומות העירייה' : e.event === 'site-observed' ? 'אתר חדש ברשומות העירייה' : 'שינוי שלב'}`, `${m[1] === 'permit' ? 'Request' : 'Site'} ${m[2]} — ${e.event === 'permit-request-observed' ? 'new request in the municipal records' : e.event === 'site-observed' ? 'new site in the municipal records' : 'stage changed'}`),
        detail: bi(e.old != null || e.new != null ? `${e.old == null ? '—' : e.old} → ${e.new == null ? '—' : e.new}` : 'רשומת העירייה', e.old != null || e.new != null ? `${e.old == null ? '—' : e.old} → ${e.new == null ? '—' : e.new}` : 'the municipal record'),
        link: { type: m[1] === 'permit' ? 'permit' : 'site', id: e.key }, values: { event: e.event, from: e.old == null ? null : e.old, to: e.new == null ? null : e.new } });
      if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
    }
    cov.parts.push({ id: 'tlv:iview2:permits-772', label: SRC_LABEL['tlv:iview2:permits-772'], dated: true, history: { kept: true, since: day(X.firstRead) }, checkedAt: X.lastRead, note: bi('כיסוי עירוני — תל אביב-יפו בלבד; רשומה מגיעה לרחוב רק כשהכתובת שלה נוקבת בו', 'municipal coverage — Tel Aviv-Yafo only; a record reaches a street only when its own address names it') });
  } else {
    cov.parts.push({ id: 'tlv:iview2:permits-772', label: SRC_LABEL['tlv:iview2:permits-772'], notApplicable: true, note: bi('היתרים עירוניים נקראים לתל אביב-יפו בלבד — אין כאן מקור היתרים', 'municipal permits are read for Tel Aviv-Yafo only — no permit source here') });
  }
  return { items, coverage: cov };
}

/* ───────────────────────── SOURCE_STATE ───────────────────────── */
const SOURCES_FOR_KINDS = ['over:street-evidence', 'over:govmap-recent', 'over:govmap-national', 'propx:tx-freshness', 'propx:transaction-events', 'rmi:michrazim', 'iplan:xplan', 'iplan:xplan:renewal', 'iplan:vatmal',
  'datagov:moch:urban-renewal-complexes', 'datagov:moch:dira-behanacha-lotteries', 'dira-lehaskir:tenders', 'dira-lehaskir:planning', 'cbs:new-home-sales', 'cbs:construction', 'tlv:iview2:permits-772'];
function collectSourceState(geo, ctx) {
  const Rd = S.radar(), items = [];
  const tlvGeo = (geo.locality && geo.locality.code === 5000) || geo.kind === 'il' || (geo.kind === 'district' && geo.id === 'd-ta');
  for (const e of Rd.events) {
    if (e.group !== 'sources') continue;
    if (!SOURCES_FOR_KINDS.includes(e.source) || (e.source === 'tlv:iview2:permits-772' && !tlvGeo)) continue;
    const sd = day(e.sourceDate);
    const it = mk('chg-source-state', { id: `src:${e.id}`, verb: VERBS.verbOf(e), m: e.m, eventDate: isDay(sd) && sd <= day(e.at) ? sd : day(e.at), eventDateBasis: isDay(sd) && sd <= day(e.at) ? 'SOURCE' : 'OBSERVED',
      observedAt: e.at, observedBasis: 'CHANGE_READ', source: srcOf('propx:trust', day(e.at), null), cls: 'DERIVED', scope: geo.kind === 'il' ? 'NATIONAL' : 'NATIONAL_CONTEXT',
      title: e.title, detail: e.detail, link: { type: 'sources', id: e.source }, values: { sourceId: e.source, from: e.values && e.values.from || null, to: e.values && e.values.to || null } });
    if (inWindow(it, ctx.windowFrom, ctx.A)) items.push(it);
  }
  return { items, coverage: { state: 'COVERED', dated: false, historySince: day(Rd.since), coveredFrom: day(Rd.since), coveredThrough: ctx.A,
    note: bi('מצב בדיקה של מקור הוא מצב המקור כולו — לא נתון של המקום', 'a source\'s check state is the whole source\'s — not a fact about this place'),
    parts: [{ id: 'propx:trust', label: SRC_LABEL['propx:trust'], dated: false, history: { kept: true, since: day(Rd.since) }, checkedAt: Rd.builtAt }] } };
}

module.exports = { mk, inWindow, spatialOf, parcelRelation, trust, collectTransactions, batchItems, collectLand, collectRenewal, collectPlanning, collectHousing, collectRental, collectConstruction, collectSales, collectRevisions, collectSourceState, cbsGeoOf, SRC_LABEL, TX_STATE, txReads };
