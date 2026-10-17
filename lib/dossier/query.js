// PROPX · Market Dossier — one institutional read of a geography (national · district · locality) composed from the
// read models PROPX already serves, each figure with its source, class and dates. Nothing here is fetched or modelled:
// the dossier only aggregates what the committed files say, keeps the universes apart (ILA tender units ≠ lottery units ≠
// renewal units ≠ rental units — never added), names what it does not know, and states the evidence quality from rules.
//
//   dossier({ level: 'il' | 'district' | 'locality', code })  →  the dossier
//   GET /api/intel?view=dossier&city=<locality code> | &district=<d-ta …> | (none) = national
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const LQ = require('../land/query');
const HQ = require('../housing/query');
const RN = require('../renewal/query');
const RQ = require('../rental/query');
const EQ = require('../entities/query');
const RADAR = require('../radar/query');
const { catalog } = require('../trust/catalog');

const ROOT = path.join(__dirname, '..', '..', 'data');
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const bi = (he, en) => ({ he, en });
/* the geo registry stores English locality names in lower case — the dossier shows them title-cased (display only) */
const enName = (v) => String(v || '').replace(/(^|[\s\-(\/])(\p{Ll})/gu, (m, p, c) => p + c.toUpperCase());
const num = (v) => (Number.isFinite(v) ? v : null);
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const DAY = 86400e3;
const DISTRICTS = { 'd-jm': { cbs: 'd-jm', he: 'מחוז ירושלים', en: 'Jerusalem district' }, 'd-north': { cbs: 'd-north', he: 'מחוז הצפון', en: 'Northern district' }, 'd-haifa': { cbs: 'd-haifa', he: 'מחוז חיפה', en: 'Haifa district' }, 'd-center': { cbs: 'd-center', he: 'מחוז המרכז', en: 'Central district' }, 'd-ta': { cbs: 'd-ta', he: 'מחוז תל אביב', en: 'Tel Aviv district' }, 'd-south': { cbs: 'd-south', he: 'מחוז הדרום', en: 'Southern district' }, 'js-area': { cbs: 'jsr', he: 'יהודה ושומרון', en: 'Judea and Samaria Area' } };

let locCache = null;
function localities(dataDir) {
  if (locCache && locCache.dir === dataDir) return locCache;
  const g = readJson(path.join(dataDir, 'geo', 'localities.json'));
  const arr = g && Array.isArray(g.localities) ? g.localities : [];
  const by = new Map(); for (const l of arr) by.set(String(l.code), l);
  locCache = { dir: dataDir, by, arr };
  return locCache;
}

/* ------------------------------------------------------------ the dossier */
function dossier({ level, code, dataDir = ROOT, now = Date.now() } = {}) {
  const L = localities(dataDir);
  let geo;
  if (level === 'locality') { const l = L.by.get(String(code)); if (!l) return null; geo = { level, code: String(l.code), name: bi(l.he, enName(l.en)), district: l.district || null, districtName: l.district && DISTRICTS[l.district] ? bi(DISTRICTS[l.district].he, DISTRICTS[l.district].en) : null }; }
  else if (level === 'district') { const d = DISTRICTS[code]; if (!d) return null; geo = { level, code, name: bi(d.he, d.en), district: code, districtName: bi(d.he, d.en), localities: L.arr.filter((l) => l.district === code).length }; }
  else if (!level || level === 'il') geo = { level: 'il', code: 'il', name: bi('ישראל', 'Israel'), district: null, districtName: null };
  else return null;

  const S = {}, missing = [], freshness = [];
  const fresh = (id, label, observed, published, checked, state) => freshness.push({ id, label, observed: observed || null, published: published || null, checked: checked || null, state: state || null });
  const districtCodes = level === 'district' ? new Set(L.arr.filter((l) => l.district === code).map((l) => String(l.code))) : null;
  const inGeo = (localityCode) => (level === 'il' ? true : level === 'locality' ? String(localityCode) === geo.code : districtCodes.has(String(localityCode)));

  /* ---- official sales: CBS national + the district series (never a locality figure) */
  const cbs = readJson(path.join(dataDir, 'cbs-sales', 'latest.json'));
  if (cbs && cbs.geos && cbs.geos.il && cbs.geos.il.metrics && cbs.geos.il.metrics.ok) {
    const dk = geo.district && DISTRICTS[geo.district] ? DISTRICTS[geo.district].cbs : null;
    const g = level === 'il' ? cbs.geos.il : dk && cbs.geos[dk] && cbs.geos[dk].metrics && cbs.geos[dk].metrics.ok ? cbs.geos[dk] : null;
    const M = g ? g.metrics : null;
    S.sales = { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10', scope: g ? (g.level === 'district' ? (level === 'locality' ? bi(`${g.name.he} — רמת מחוז, לא נתון היישוב`, `${g.name.en} — district level, not the locality's figure`) : bi(`${g.name.he} — סדרת המחוז (למ״ס)`, `${g.name.en} — the district series (CBS)`)) : bi('ארצי', 'national')) : null,
      latest: M ? M.latest : null, latestValue: M ? M.latestValue : null, t12: M ? M.t12 : null, ytd: M ? M.ytd : null, prevYtd: M ? M.prevYtd : null, ytdChange: M ? M.ytdChange : null, momentum: M && M.momentum ? M.momentum.m3 : null, pace: M ? M.pace : null, small: M ? !!M.small : null,
      national: { latest: cbs.geos.il.metrics.latest, t12: cbs.geos.il.metrics.t12 && cbs.geos.il.metrics.t12.value },
      sourceUpdate: cbs.sourceUpdate, checkedAt: cbs.checkedAt, freshness: cbs.freshness && cbs.freshness.state };
    if (!g) missing.push({ id: 'sales', he: 'מכירות דירות חדשות לפי יישוב: הלמ״ס מפרסמת ארצי ולפי מחוז בלבד — אין נתון רשמי ליישוב', en: 'new-home sales by locality: CBS publishes national and district series only — no official locality figure' });
    fresh('sales', bi('מכירות דירות חדשות · למ״ס', 'new-home sales · CBS'), M ? M.latest : cbs.geos.il.metrics.latest, cbs.sourceUpdate, cbs.checkedAt, cbs.freshness && cbs.freshness.state);
    if (level === 'il' && cbs.inventory && cbs.inventory.latest) S.inventory = { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10', value: cbs.inventory.latest.value, period: cbs.inventory.latest.period, monthsSupply: cbs.monthsSupply && cbs.monthsSupply.latest ? cbs.monthsSupply.latest.value : null, checkedAt: cbs.checkedAt };
    else missing.push({ id: 'inventory', he: 'מלאי שטרם נמכר: ארצי בלבד בסדרה הרשמית — אין נתון רשמי למחוז או ליישוב בפורמט קריא למכונה', en: 'unsold inventory: national only in the official series — no machine-readable district or locality figure' });
  } else missing.push({ id: 'sales', he: 'סדרת המכירות של הלמ״ס לא נטענה', en: 'the CBS sales series is not loaded' });

  /* ---- land & tenders (ILA): current scope, this geography */
  try {
    const p = new URLSearchParams({ scope: 'current', period: 'all' }); if (level === 'locality') p.set('city', geo.code);
    const { filters } = LQ.parseFilters(p);
    const sum = LQ.summary(filters, { limit: 12 });
    const K = sum.kpis;
    let dk = K;
    if (level === 'district') { /* the land read model filters by locality — a district is the same KPI function over the live records of its localities (one source, one universe) */
      const C = LQ.load();
      const rowsD = C.live.filter((r) => inGeo(r.localityCode) && LQ.isCurrent(r, filters));
      dk = Object.assign(LQ.kpis(rowsD, filters, C), { byLocalities: true });
    }
    S.land = { cls: 'OFFICIAL', source: 'rmi:michrazim', scope: sum.scope, kpis: dk, cities: level === 'il' ? (sum.cities || []).slice(0, 8) : null, developers: level === 'locality' ? (sum.developers || []).slice(0, 8) : null, detailCoverage: sum.detailCoverage, freshness: sum.freshness, stateLand: sum.stateLand };
    /* observation = the latest tender publication date in the list; the ILA site is continuous (no release date) → publication null; check = the daily sync */
    fresh('land', bi('מכרזי רמ״י', 'ILA tenders'), sum.coverage && sum.coverage.coveredTo ? sum.coverage.coveredTo : null, null, sum.freshness && sum.freshness.checkedAt, null);
  } catch (e) { missing.push({ id: 'land', he: `מכרזי רמ״י: ${e.message}`, en: `ILA tenders: ${e.message}` }); }

  /* ---- subsidized housing (MoCH lotteries) */
  try {
    const p = new URLSearchParams({ period: 'all' }); if (level === 'locality') p.set('city', geo.code);
    const { filters } = HQ.parseFilters(p);
    const hs = HQ.summary(filters);
    let K = hs.kpis;
    if (level === 'district') { const fc = (hs.facets && hs.facets.city) || []; const rowsC = fc.filter((c) => inGeo(c.value)); K = { lotteries: rowsC.reduce((s, c) => s + (c.n || 0), 0), localities: rowsC.length, unitsFirst: null, applicantsPerUnit: null, byLocalities: true, basis: 'lottery counts per locality from the city facet; units and applicants are not summed across localities here' }; }
    S.housing = { cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries', kpis: K, coverage: hs.coverage, freshness: hs.freshness };
    fresh('housing', bi('הגרלות דיור מסובסד · משב״ש', 'subsidized-housing lotteries · MoCH'), hs.coverage && hs.coverage.coveredTo, hs.freshness && hs.freshness.sourceUpdatedAt, hs.freshness && hs.freshness.checkedAt, null);
  } catch (e) { missing.push({ id: 'housing', he: `דיור מסובסד: ${e.message}`, en: `subsidized housing: ${e.message}` }); }

  /* ---- urban renewal (MoCH) + its exact XPlan join */
  try {
    const rs = RN.summary(level === 'locality' ? { city: geo.code } : {});
    let K = rs.kpis, decl = rs.declaration;
    if (level === 'district') { const cx = readJson(path.join(dataDir, 'renewal', 'complexes.json'), []); const arr = (Array.isArray(cx) ? cx : (cx && cx.records) || []).filter((c) => c.inLatestSource !== false && inGeo(c.localityCode));
      const pu = arr.filter((c) => Number.isFinite(c.proposedUnits)); K = { complexes: arr.length, proposedUnits: { sum: pu.reduce((s, c) => s + c.proposedUnits, 0), of: pu.length }, byLocalities: true }; decl = { declared: arr.filter((c) => c.declaration === 'declared').length, 'not-yet-declared': arr.filter((c) => c.declaration === 'not-yet-declared').length, 'not-stated': arr.filter((c) => c.declaration === 'not-stated').length }; }
    S.renewal = { cls: 'OFFICIAL', source: 'datagov:moch:urban-renewal', kpis: K, declaration: decl, stages: level === 'locality' || level === 'il' ? rs.stages : null, planning: level !== 'district' && rs.planning ? { coverage: rs.planning.coverage, pipeline: rs.planning.pipeline, freshness: rs.planning.freshness } : null, freshness: rs.freshness };
    fresh('renewal', bi('התחדשות עירונית · משב״ש', 'urban renewal · MoCH'), rs.freshness && rs.freshness.sourceUpdatedAt, rs.freshness && rs.freshness.sourceUpdatedAt, rs.freshness && rs.freshness.checkedAt, null);
  } catch (e) { missing.push({ id: 'renewal', he: `התחדשות עירונית: ${e.message}`, en: `urban renewal: ${e.message}` }); }

  /* ---- long-term rental: the ILA rental track + Dira Lehaskir's stated terms */
  try {
    const p = new URLSearchParams({ scope: 'current', period: 'all', track: 'rental' }); if (level === 'locality') p.set('city', geo.code);
    const { filters } = LQ.parseFilters(p);
    const r = RQ.summary(filters);
    const rowsG = level === 'district' ? (r.rows || []).filter((x) => inGeo(x.localityCode)) : null;
    S.rental = { cls: 'OFFICIAL', source: 'rmi:michrazim · dira-lehaskir:wp', pipeline: level === 'district' ? { tenders: rowsG.length, tenderUnits: rowsG.reduce((s, x) => s + (x.tenderUnits || 0), 0), byLocalities: true } : { tenders: r.pipeline.tenders, tenderUnits: r.pipeline.tenderUnits, lifecycle: r.pipeline.lifecycle, staleStatus: r.pipeline.staleStatus },
      terms: level === 'district' ? null : { withNotice: r.terms.withNotice, comparable: r.terms.comparable, rentalUnitsStated: r.terms.rentalUnitsStated, tenderUnitsOfStated: r.terms.tenderUnitsOfStated, saleUnitsStated: r.terms.saleUnitsStated, rentalYears: r.terms.rentalYears }, market: r.market ? { yoy: r.market.yoy, period: r.market.period, role: r.market.role } : null, freshness: r.freshness,
      basis: bi('יח״ד של מכרז = סך המכרז; יח״ד להשכרה רק כפי שדירה להשכיר כתבה; מדד שכר הדירה = רף שוק כללי, לא שכר דירה של פרויקט', 'tender units = the tender total; rental units only as Dira Lehaskir wrote them; the rent index = a general market benchmark, not a project rent') };
  } catch (e) { missing.push({ id: 'rental', he: `דיור להשכרה: ${e.message}`, en: `rental: ${e.message}` }); }

  /* ---- developers observed in this geography (the activity registry — exact names, never merged): per-locality markets give
     the figures HERE; the entity's totals stay beside them */
  try {
    const c = EQ.load();
    const here = (e) => (e.markets || []).filter((m) => inGeo(m.localityCode));
    const all = c.R.developers.map((e) => { const ms = here(e); if (!ms.length) return null; return { id: e.id, name: e.name, kind: e.kind, lotsHere: ms.reduce((s, m) => s + (m.lotsWon || 0), 0), unitsHere: ms.reduce((s, m) => s + (m.residentialUnitsWon || 0), 0), projectsHere: ms.reduce((s, m) => s + (m.projects || 0), 0), lastHere: ms.map((m) => m.last).filter(Boolean).sort().pop() || null, localitiesHere: ms.length,
      lots: e.tenders ? e.tenders.lots : null, units: e.tenders ? e.tenders.residentialUnits : null, projects: e.lotteries ? e.lotteries.projects : null, cities: e.cities, lastActivity: e.lastActivity, active: e.active, construction: e.construction ? { buildings: e.construction.buildings, started: e.construction.started, completed: e.construction.completed, asOf: e.construction.asOf } : null, possibleSame: (e.possibleSame || []).length }; }).filter(Boolean)
      .sort((a, b) => (b.lotsHere + b.projectsHere) - (a.lotsHere + a.projectsHere) || (b.unitsHere - a.unitsHere));
    S.developers = { cls: 'OBSERVED', source: 'lib/entities (rmi:michrazim · datagov:moch)', total: all.length, top: all.slice(0, 8), lotsHereTotal: all.reduce((s, d) => s + (d.lotsHere || 0), 0), basis: bi('פעילות שנצפתה במקורות PROPX בלבד — מגרשים שנזכו (רמ״י) ופרויקטי הגרלה (משב״ש) ביישובי הגאוגרפיה; שם משפטי מדויק, ללא מיזוג; לא מאגר קרקעות', 'observed PROPX activity only — lots won (ILA) and lottery projects (MoCH) in the geography\'s localities; exact legal name, never merged; not a land bank'), freshness: c.R.freshness || null };
    const sig = EQ.signals(level === 'locality' ? { city: geo.code, limit: 20 } : { limit: 300 });
    const ent = (sig.rows || []).filter((x) => level === 'il' || inGeo(x.localityCode));
    S.developers.entries = { total: level === 'district' ? ent.length : (sig.total != null ? sig.total : ent.length), recent: ent.slice(0, 6), definition: sig.definition };
  } catch (e) { missing.push({ id: 'developers', he: `יזמים: ${e.message}`, en: `developers: ${e.message}` }); }

  /* ---- macro context (national — never a local figure) */
  const mk = readJson(path.join(dataDir, 'market', 'latest.json'));
  if (mk && mk.indicators) { const I = mk.indicators, pick = (k) => (I[k] ? { value: num(I[k].value), yoy: num(I[k].yoy), period: I[k].period || null, publishedAt: I[k].publishedAt || null, stale: !!I[k].stale } : null);
    S.macro = { cls: 'OFFICIAL', source: 'boi:interest · cbs:price-index', scope: bi('ארצי — הקשר, לא נתון מקומי', 'national — context, not a local figure'), boiRate: pick('boiRate'), newHomesIndex: pick('newHomesIndex'), dwellingsIndex: pick('dwellingsIndex'), constructionInputsIndex: pick('constructionInputsIndex'), rentIndex: pick('rentIndex'), checkedAt: mk.syncedAt || null };
    if (geo.district && I.dwellingsByDistrict && I.dwellingsByDistrict.districts) { const d = I.dwellingsByDistrict.districts[geo.district] || I.dwellingsByDistrict.districts[DISTRICTS[geo.district] && DISTRICTS[geo.district].cbs]; if (d) S.macro.districtIndex = { yoy: num(d.yoy), period: I.dwellingsByDistrict.period, scope: bi('מדד מחירי הדירות — רמת מחוז', 'dwellings price index — district level') }; }
  }

  /* ---- recent changes (the radar) */
  const feed = RADAR.feed(level === 'locality' ? { window: '30d', city: geo.code, size: 12 } : level === 'district' ? { window: '30d', district: geo.district, size: 12 } : { window: '7d', size: 12 }, { dataDir, now });
  S.changes = { cls: 'per event', source: 'lib/radar', window: feed.window, total: feed.total, counts: feed.counts, rows: feed.rows };

  /* ---- transactions: a live republication, not a committed file — the dossier never fetches */
  missing.push({ id: 'transactions', he: 'עסקאות: נקראות חי מהפרסום של גרסאות לעם בסעיף העסקאות — אינן חלק מהתיק (לא נשלפות כאן)', en: 'transactions: read live from the over.org.il republication in the Transactions section — not part of the dossier (never fetched here)' });
  if (level === 'locality') missing.push({ id: 'permits', he: 'היתרים, התחלות בנייה וגמר ברמת יישוב: אין מקור רשמי קריא למכונה שהצטרף — מוצג רק מה שרמ״י / משב״ש מפרסמים', en: 'permits, starts and completions by locality: no joined machine-readable official source — only what ILA / MoCH publish is shown' });

  /* ---- deterministic signals: what to watch / what could go wrong — each with its trigger, value, period, source, class */
  const signals = signalsOf(S, geo, now);
  const quality = evidenceQuality(S, missing, freshness, now, geo);
  return { schema: 1, generatedAt: new Date(now).toISOString(), geo, sections: S, signals, missing, freshness, quality,
    basis: bi('התיק מצרף קריאות קיימות של PROPX בלבד: כל נתון עם מקורו, סיווגו ותאריכיו; יקומים שונים של יחידות (מכרז, הגרלה, התחדשות, השכרה) לעולם אינם מחוברים; מה שאין — נאמר.',
      'The dossier composes PROPX\'s existing read models only: every figure with its source, class and dates; unit universes (tender, lottery, renewal, rental) are never added together; what is missing is said.') };
}

/* ---- signals: explainable triggers (trigger · value · threshold · period · source · class). Never a recommendation. */
const iso = (txt) => '\u2066' + txt + '\u2069';   // LRI … PDI: a signed number keeps its sign on the left inside Hebrew text
function signalsOf(S, geo, now) {
  const out = [];
  /* how a signal's raw value reads in the "why am I seeing this?" popover: a percent change, a percent share, months, or a count */
  const VALUE_KIND = { 'sales-momentum-up': 'pct', 'sales-momentum-down': 'pct', 'construction-inputs': 'pct', 'failed-tenders': 'ratio', 'developer-concentration': 'ratio', 'months-of-supply': 'months' };
  const valueLabel = (id, v) => (!Number.isFinite(v) ? null : VALUE_KIND[id] === 'pct' ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : VALUE_KIND[id] === 'ratio' ? Math.round(v * 100) + '%' : VALUE_KIND[id] === 'months' ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));
  const add = (kind, id, text, data) => out.push({ kind, id, text, ...data, valueLabel: valueLabel(id, data.value) });
  if (S.sales && S.sales.momentum && S.sales.momentum.ok && !S.sales.small) {
    const m = S.sales.momentum.pct;
    const geoScope = geo.level === 'locality' ? 'district' : 'own';
    if (m >= 10) add('watch', 'sales-momentum-up', bi(`מכירות דירות חדשות (${S.sales.scope.he}) — מומנטום 3 חודשים ${iso((m > 0 ? '+' : '') + m.toFixed(1) + '%')}`, `new-home sales (${S.sales.scope.en}) — 3-month momentum ${m > 0 ? '+' : ''}${m.toFixed(1)}%`), { value: m, threshold: '≥ +10%', period: S.sales.latest, source: 'cbs:timeseries:44,10', cls: 'OFFICIAL', geoScope });
    if (m <= -10) add('risk', 'sales-momentum-down', bi(`מכירות דירות חדשות (${S.sales.scope.he}) — מומנטום 3 חודשים ${iso(m.toFixed(1) + '%')}`, `new-home sales (${S.sales.scope.en}) — 3-month momentum ${m.toFixed(1)}%`), { value: m, threshold: '≤ −10%', period: S.sales.latest, source: 'cbs:timeseries:44,10', cls: 'OFFICIAL', geoScope });
  }
  if (S.inventory && Number.isFinite(S.inventory.monthsSupply) && S.inventory.monthsSupply >= 18) add('risk', 'months-of-supply', bi(`${S.inventory.monthsSupply} חודשי היצע ארצי (${S.inventory.period})`, `${S.inventory.monthsSupply} months of supply, national (${S.inventory.period})`), { value: S.inventory.monthsSupply, threshold: '≥ 18', period: S.inventory.period, source: 'cbs:timeseries:44,10', cls: 'OFFICIAL' });
  const K = S.land && S.land.kpis;
  if (K) {   /* a district's KPIs are the same function over its own live records — its land signals are its own */
    const noAward = K.tenders ? (K.decided - (K.decidedWithoutDetail || 0)) + (K.cancelled || 0) : 0;
    if (K.tenders >= 5 && noAward / K.tenders >= 0.3) add('risk', 'failed-tenders', bi(`${noAward} מתוך ${K.tenders} מכרזים נוכחיים נדונו ללא זוכה / בוטלו (${Math.round(100 * noAward / K.tenders)}%)`, `${noAward} of ${K.tenders} current tenders decided without a winner / cancelled (${Math.round(100 * noAward / K.tenders)}%)`), { value: noAward / K.tenders, threshold: bi('≥ 30% מתוך ≥ 5 מכרזים', '≥ 30% of ≥ 5 tenders'), period: bi('היקף נוכחי', 'current scope'), source: 'rmi:michrazim', cls: 'OFFICIAL' });
    if (K.unitsOpen >= 500) add('watch', 'open-land', bi(`${K.unitsOpen.toLocaleString('en-US')} יח״ד במכרזים פתוחים / שפורסמו (קרקע מדינה)`, `${K.unitsOpen.toLocaleString('en-US')} units in open / published tenders (state land)`), { value: K.unitsOpen, threshold: bi('≥ 500 יח״ד', '≥ 500 units'), period: bi('היקף נוכחי', 'current scope'), source: 'rmi:michrazim', cls: 'OFFICIAL' });
    if (K.unitsAwarded >= 1000) add('watch', 'awarded-pipeline', bi(`${K.unitsAwarded.toLocaleString('en-US')} יח״ד במגרשים שנזכו (24 חודשים) — היצע עתידי על קרקע מדינה`, `${K.unitsAwarded.toLocaleString('en-US')} units in awarded lots (24 months) — future supply on state land`), { value: K.unitsAwarded, threshold: bi('≥ 1,000 יח״ד', '≥ 1,000 units'), period: bi('היקף נוכחי', 'current scope'), source: 'rmi:michrazim', cls: 'OFFICIAL' });
    if (K.unitsPendingDecision >= 500) add('watch', 'pending-decision', bi(`${K.unitsPendingDecision.toLocaleString('en-US')} יח״ד במכרזים שנסגרו וממתינים להחלטה`, `${K.unitsPendingDecision.toLocaleString('en-US')} units in closed tenders awaiting a decision`), { value: K.unitsPendingDecision, threshold: bi('≥ 500 יח״ד', '≥ 500 units'), period: bi('היקף נוכחי', 'current scope'), source: 'rmi:michrazim', cls: 'OFFICIAL' });
  }
  const R = S.renewal && S.renewal.kpis;
  const pu = R && R.proposedUnits != null ? (typeof R.proposedUnits === 'object' ? R.proposedUnits.sum : R.proposedUnits) : null;
  if (R && Number.isFinite(pu) && pu >= 2000) add('watch', 'renewal-pipeline', bi(`${pu.toLocaleString('en-US')} יח״ד מוצעות ב-${R.complexes} מתחמי התחדשות (כפי שפורסם — לא בנייה)`, `${pu.toLocaleString('en-US')} proposed units in ${R.complexes} renewal complexes (as published — not construction)`), { value: pu, threshold: bi('≥ 2,000 יח״ד', '≥ 2,000 units'), period: bi('כפי שפורסם', 'as published'), source: 'datagov:moch:urban-renewal', cls: 'OFFICIAL' });
  if (S.rental && S.rental.pipeline && S.rental.pipeline.tenders >= 3) add('watch', 'rental-pipeline', bi(`${S.rental.pipeline.tenders} מכרזי דיור להשכרה נוכחיים (${(S.rental.pipeline.tenderUnits || 0).toLocaleString('en-US')} יח״ד סה״כ במכרזים)`, `${S.rental.pipeline.tenders} current rental-track tenders (${(S.rental.pipeline.tenderUnits || 0).toLocaleString('en-US')} tender units in total)`), { value: S.rental.pipeline.tenders, threshold: bi('≥ 3 מכרזים', '≥ 3 tenders'), period: bi('היקף נוכחי', 'current scope'), source: 'rmi:michrazim', cls: 'OFFICIAL' });
  if (S.rental && S.rental.pipeline && S.rental.pipeline.staleStatus && S.rental.pipeline.staleStatus.n >= 3) add('risk', 'stale-rental-status', bi(`${S.rental.pipeline.staleStatus.n} מכרזי השכרה נספרים "בתהליך" רק בגלל סטטוס ישן מ-36 חודשים`, `${S.rental.pipeline.staleStatus.n} rental tenders count as in play only through a status older than 36 months`), { value: S.rental.pipeline.staleStatus.n, threshold: '≥ 3', period: bi('היקף נוכחי', 'current scope'), source: 'rmi:michrazim', cls: 'DERIVED' });
  if (S.developers && S.developers.entries && S.developers.entries.total >= 2) add('watch', 'developer-entries', bi(`${S.developers.entries.total} יזמים נכנסו ליישוב ב-24 חודשים (פעילות ראשונה שנצפתה)`, `${S.developers.entries.total} developers entered in 24 months (first observed activity)`), { value: S.developers.entries.total, threshold: '≥ 2', period: bi('24 חודשים', '24 months'), source: 'lib/entities', cls: 'DERIVED' });
  if (S.developers && S.developers.top && S.developers.top.length) { const top = S.developers.top[0]; const lots = (d) => (d.lotsHere != null ? d.lotsHere : d.lots || 0); const tot = S.developers.lotsHereTotal != null ? S.developers.lotsHereTotal : S.developers.top.reduce((s, d) => s + lots(d), 0); if (lots(top) >= 5 && tot && lots(top) / tot >= 0.5) add('risk', 'developer-concentration', bi(`${top.name} מחזיק ${lots(top)} מתוך ${tot} המגרשים שנזכו כאן על ידי יזמים רשומים (${Math.round(100 * lots(top) / tot)}%)`, `${top.name} holds ${lots(top)} of ${tot} lots won here by listed developers (${Math.round(100 * lots(top) / tot)}%)`), { value: lots(top) / tot, threshold: bi('≥ 50% מתוך ≥ 5 מגרשים', '≥ 50% of ≥ 5 lots'), period: bi('פעילות שנצפתה', 'observed activity'), source: 'rmi:michrazim', cls: 'OBSERVED' }); }
  if (S.changes && S.changes.total === 0) add('risk', 'no-recent-changes', bi(`אין אירועים שנצפו ב-${S.changes.window} — צנרת שקטה או מקור שלא התעדכן`, `no observed events in ${S.changes.window} — a quiet pipeline or a source that did not update`), { value: 0, threshold: bi('0 אירועים', '0 events'), period: S.changes.window, source: 'lib/radar', cls: 'DERIVED' });
  if (S.macro && S.macro.constructionInputsIndex && S.macro.constructionInputsIndex.yoy >= 3) add('risk', 'construction-inputs', bi(`מדד תשומות הבנייה ${iso('+' + S.macro.constructionInputsIndex.yoy + '%')} שנתי (ארצי)`, `construction-inputs index +${S.macro.constructionInputsIndex.yoy}% y/y (national)`), { value: S.macro.constructionInputsIndex.yoy, threshold: '≥ +3%', period: S.macro.constructionInputsIndex.period ? `${S.macro.constructionInputsIndex.period.year}-${String(S.macro.constructionInputsIndex.period.month).padStart(2, '0')}` : null, source: 'cbs:constructionInputsIndex', cls: 'OFFICIAL', geoScope: geo.level === 'il' ? 'own' : 'national' });
  return out;
}

/* ---- evidence quality: HIGH / MEDIUM / LOW from rules — source quality, freshness, geography, missingness. Never a probability. */
function evidenceQuality(S, missing, freshness, now, geo) {
  let score = 100; const items = [];
  const hit = (id, d, he, en) => { score += d; items.push({ id, delta: d, he, en }); };
  if (!S.sales || !S.sales.latest) hit('sales', -15, 'אין סדרת מכירות רשמית לגאוגרפיה הזו (−15)', 'no official sales series for this geography (−15)');
  else if ((!geo || geo.level === 'locality') && S.sales.scope && /district|מחוז/.test(S.sales.scope.en + S.sales.scope.he) && S.sales.national) hit('salesGeo', -8, 'מכירות ברמת מחוז בלבד — לא היישוב (−8)', 'sales at district level only — not the locality (−8)');
  if (S.sales && S.sales.freshness === 'STALE') hit('salesStale', -8, 'סדרת המכירות ישנה (−8)', 'the sales series is stale (−8)');
  if (!S.inventory) hit('inventory', -5, 'אין מלאי רשמי לגאוגרפיה הזו (−5)', 'no official inventory for this geography (−5)');
  if (S.land && S.land.detailCoverage && Number.isFinite(S.land.detailCoverage.pct) && S.land.detailCoverage.pct < 70) hit('landDetail', -8, `פרטי מכרזים נקראו ל-${Math.round(S.land.detailCoverage.pct)}% מהרשימה (−8)`, `tender details read for ${Math.round(S.land.detailCoverage.pct)}% of the list (−8)`);
  if (!S.land || !S.land.kpis || !S.land.kpis.tenders) hit('land', -6, 'אין מכרזי רמ״י נוכחיים כאן (−6)', 'no current ILA tenders here (−6)');
  if (!S.developers || !S.developers.top || !S.developers.top.length) hit('developers', -5, 'לא נצפו יזמים (−5)', 'no developers observed (−5)');
  if (!S.renewal || !S.renewal.kpis || !S.renewal.kpis.complexes) hit('renewal', -3, 'אין מתחמי התחדשות (−3)', 'no renewal complexes (−3)');
  for (const f of freshness) { const chk = f.checked ? (now - Date.parse(f.checked)) / DAY : null; if (Number.isFinite(chk) && chk > 7) hit('checked:' + f.id, -4, `${f.label.he}: נבדק לפני ${Math.round(chk)} ימים (−4)`, `${f.label.en}: checked ${Math.round(chk)} days ago (−4)`); }
  hit('transactions', -5, 'עסקאות אינן חלק מהתיק — מקור חי (−5)', 'transactions are not in the dossier — a live source (−5)');
  if (missing.some((m) => m.id === 'permits')) hit('permits', -6, 'אין מקור היתרים / התחלות / גמר (−6)', 'no permits / starts / completions source (−6)');
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';
  return { score, level, label: { HIGH: bi('גבוהה', 'HIGH'), MEDIUM: bi('בינונית', 'MEDIUM'), LOW: bi('נמוכה', 'LOW') }[level], items, basis: bi('איכות ראיות = 100 פחות ניכויים מתועדים (מקור, רעננות, גאוגרפיה, חסרים). לא הסתברות.', 'evidence quality = 100 minus documented deductions (source, freshness, geography, missingness). Not a probability.') };
}

/* ---- the geographies the page can ask for: districts and the localities with any observed activity */
function index({ dataDir = ROOT } = {}) {
  const L = localities(dataDir);
  const tenders = readJson(path.join(dataDir, 'land', 'tenders.json'), []);
  const arr = Array.isArray(tenders) ? tenders : (tenders && tenders.records) || [];
  const counts = new Map(); for (const t of arr) if (t.localityCode && t.inLatestSource !== false) counts.set(String(t.localityCode), (counts.get(String(t.localityCode)) || 0) + 1);
  const locs = [...counts.entries()].map(([code, n]) => { const l = L.by.get(code); return l ? { code, he: l.he, en: enName(l.en), district: l.district, tenders: n } : null; }).filter(Boolean).sort((a, b) => b.tenders - a.tenders);
  return { districts: Object.entries(DISTRICTS).map(([code, d]) => ({ code, he: d.he, en: d.en })), localities: locs.slice(0, 400), basis: bi('יישובים עם מכרזי רמ״י ברשימה החיה', 'localities with ILA tenders in the live list') };
}

module.exports = { dossier, index, DISTRICTS, signalsOf, evidenceQuality };
