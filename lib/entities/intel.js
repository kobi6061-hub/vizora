// PROPX · DEVELOPER INTELLIGENCE 2.0 — one institutional read of a developer entity, as a pure module.
//
//   devIntel(entity, cache, { now })  →  the `intel` block that query.js `developer(id)` adds to its answer
//   SIGNALS                           →  the deterministic rule table behind `intel.signals`
//
// Everything here is composed from what the registry (lib/entities/registry.js) already built — the entity, its
// sites (ila:<MichrazID>:<lot>, residential awarded lots) and its projects (moch:<ProjectID>) — plus two exact joins
// PROPX already stores: the tender record's XPlan plans (exact plan number) and Dira Lehaskir's notice for a tender
// (the printed tender number). Nothing is fetched, nothing is random, no name is ever merged: a "possible same
// entity" stays a link with its evidence. No score of any kind is computed; a risk signal is a fact about the
// observed activity, never a judgement on the company.
//
// Minimal cache shape (what the function reads — query.js `load()` provides a superset):
//   {
//     projById: Map<id, site | project>      the entity's `sites` / `projects` ids resolve here
//     landById: Map<tenderId, tender record>  optional — the stored ILA records (`plans[]` with `xplan`); empty → no XPlan joins
//     R: { entries: [...] }                   DEVELOPER MARKET ENTRY rows ({ developerId, localityCode, city, cityEn, date, via })
//   }
// `opt.diraFor(tenderId)` may replace the rental read model (tests); by default lib/rental/query.js answers.
//
// Every block states its source and class; a number appears only where the sources carry it, null otherwise.
// Basis: OBSERVED PROPX ACTIVITY — PROPX observes public channels only (ILA tenders, MoCH lotteries); private-land
// activity is not observed, so nothing here is a land bank, a total pipeline, a market share or a complete list.

'use strict';

const { RESIDENTIAL } = require('../land/query');
const { monthsBefore, BASIS } = require('./registry');

const bi = (he, en) => ({ he, en });
const SUBSIDIZED_TRACKS = new Set(['subsidized', 'residential-lottery', 'special-population']);
const SRC = { ila: 'rmi:michrazim', moch: 'datagov:moch:dira-behanacha-lotteries', cons: 'datagov:moch:construction-progress', xplan: 'rmi:michrazim · xplan (exact plan number)', dira: 'dira-lehaskir:wp', reg: 'lib/entities' };
const CONSTRUCTION_AS_OF = '2024-03-01';
const planKey = (p) => String(p || '').replace(/\s+/g, '').trim();
const planOfLotKey = (k) => planKey(String(k || '').split('|')[0]);
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const share = (num, den) => (den > 0 ? round(num / den) : null);
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = (s) => (s == null ? '—' : `${Math.round(s * 100)}%`);

/** the reference day (YYYY-MM-DD, UTC) from `now`: a timestamp, a Date, an ISO string or nothing (today) */
function dayOf(now) {
  if (now == null) return new Date().toISOString().slice(0, 10);
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}/.test(now)) return now.slice(0, 10);
  const d = new Date(now);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}
/** whole months from day a to day b (both YYYY-MM-DD); null when either is missing */
function monthsBetween(a, b) {
  if (!a || !b) return null;
  const [y1, m1, d1] = a.slice(0, 10).split('-').map(Number), [y2, m2, d2] = b.slice(0, 10).split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}
/* a window: from ≤ date < to, except the latest window whose `to` is the reference day itself (inclusive) */
const inWindow = (d, w) => !!d && d >= w.from && (w.inclusiveTo ? d <= w.to : d < w.to);
function windowsOf(today) {
  const m = (n) => monthsBefore(today, n);
  return { last6: { from: m(6), to: today, inclusiveTo: true }, last12: { from: m(12), to: today, inclusiveTo: true }, last24: { from: m(24), to: today, inclusiveTo: true },
    prior12: { from: m(24), to: m(12), inclusiveTo: false }, prior24to36: { from: m(36), to: m(24), inclusiveTo: false } };
}

let rentalQuery = null;
function defaultDiraFor(tenderId) {
  try { if (!rentalQuery) rentalQuery = require('../rental/query'); return rentalQuery.diraFor(tenderId); } catch { return null; }
}

/* ------------------------------------------------------------ the blocks */
function activityOf(entity, sites, projects, W, today) {
  const tally = (w) => {
    const inS = sites.filter((s) => inWindow(s.decisionDate, w));
    const unitsKnown = inS.filter((s) => s.units != null);
    let lotteries = 0, firstLotteries = 0;
    for (const p of projects) for (const l of p.lotteries || []) if (inWindow(l.date, w)) { lotteries++; if (l.type === 'first') firstLotteries++; }
    return { lotsWon: inS.length, residentialUnits: unitsKnown.length ? unitsKnown.reduce((s, x) => s + x.units, 0) : null, unitsKnownLots: unitsKnown.length, lotteries, firstLotteries };
  };
  const last12 = tally(W.last12), prior12 = tally(W.prior12), prior24to36 = tally(W.prior24to36), last6 = tally(W.last6);
  const a = last12.lotsWon + last12.lotteries, b = prior12.lotsWon + prior12.lotteries;
  const trend = a === 0 && b === 0 ? 'inactive' : Math.max(a, b) < 3 ? 'insufficient' : a >= 2 * b ? 'accelerating' : a <= b / 2 ? 'slowing' : 'steady';   // 2-vs-0 is not a trend
  return { source: `${SRC.ila} · ${SRC.moch}`, cls: 'OBSERVED', windows: { last6, last12, prior12, prior24to36 },
    firstActivity: entity.firstActivity || null, lastActivity: entity.lastActivity || null, monthsSinceLast: monthsBetween(entity.lastActivity, today),
    lotsOutsideWindows: Math.max(0, (entity.tenders ? entity.tenders.lots : 0) - sites.length),
    trend, trendComponents: { last12: a, prior12: b },
    trendRule: bi('a = מגרשים + הגרלות ב-12 החודשים האחרונים, b = ב-12 הקודמים. inactive: a = b = 0 · insufficient: max(a, b) < 3 · accelerating: a ≥ 2b · slowing: a ≤ b/2 · steady: אחרת',
      'a = lots + lotteries in the last 12 months, b = in the prior 12. inactive: a = b = 0 · insufficient: max(a, b) < 3 · accelerating: a ≥ 2b · slowing: a ≤ b/2 · steady: otherwise'),
    basis: bi('חלונות לפי תאריך ההחלטה של מגרשי מגורים שנזכו (רמ״י) ותאריכי ההגרלות של פרויקטי היזם (משב״ש); מגרשים שלא במסלול מגורים אינם אתרים ולכן אינם בחלונות (lotsOutsideWindows). "inactive" = לא נצפתה פעילות בערוצים הציבוריים של PROPX — לא אמירה על החברה',
      'windows by the decision date of residential lots won (ILA) and the lottery dates of the developer\'s projects (MoCH); lots outside residential tracks are not sites and fall outside the windows (lotsOutsideWindows). "inactive" = nothing observed in PROPX\'s public channels — not a statement about the company') };
}

function marketsOf(entity, sites) {
  const ranked = (entity.markets || []).map((m) => ({ ...m, activity: (m.lotsWon || 0) + (m.lotteries || 0) }))
    .sort((a, b) => b.activity - a.activity || String(b.last || '').localeCompare(String(a.last || '')));
  const byCity = new Map();
  for (const s of sites) { const k = s.localityCode == null ? 'none' : String(s.localityCode); if (!byCity.has(k)) byCity.set(k, { localityCode: s.localityCode ?? null, city: s.city || null, cityEn: s.cityEn || null, lots: 0 }); byCity.get(k).lots++; }
  const groups = [...byCity.values()].sort((a, b) => b.lots - a.lots);
  const top = groups[0] || null;
  return { source: `${SRC.ila} · ${SRC.moch}`, cls: 'OBSERVED', ranked, rankBasis: 'lotsWon + lotteries, then latest activity',
    geographicConcentration: { topMarket: top ? { localityCode: top.localityCode, city: top.city, cityEn: top.cityEn } : null, share: top ? share(top.lots, sites.length) : null, lots: top ? top.lots : 0,
      residentialLots: sites.length, markets: groups.length, cls: 'DERIVED',
      basis: bi('מגרשי המגורים שנזכו ביישוב המוביל ÷ כל מגרשי המגורים שנזכו (רמ״י); הגרלות אינן נספרות — יקום אחר', 'residential lots won in the top market ÷ all residential lots won (ILA); lotteries are not counted — a different universe') } };
}

function programsOf(entity) {
  const tracks = entity.tracks || {};
  const total = Object.values(tracks).reduce((s, n) => s + (n || 0), 0);
  const shares = Object.fromEntries(Object.entries(tracks).map(([k, n]) => [k, share(n, total)]));
  const residentialLots = Object.entries(tracks).filter(([k]) => RESIDENTIAL.has(k)).reduce((s, [, n]) => s + (n || 0), 0);
  const subsidizedLots = Object.entries(tracks).filter(([k]) => SUBSIDIZED_TRACKS.has(k)).reduce((s, [, n]) => s + (n || 0), 0);
  const top = Object.entries(tracks).sort((a, b) => b[1] - a[1])[0] || null;
  return { source: SRC.ila, cls: 'OBSERVED', tracks, lots: total, shares, topTrack: top ? { track: top[0], lots: top[1], share: share(top[1], total) } : null,
    residentialLots, subsidizedLots, subsidizedShare: share(subsidizedLots, residentialLots),
    subsidizedShareBasis: bi('מגרשים במסלולים מסובסדים (מחיר למשתכן / הגרלה למגורים / אוכלוסייה מיוחדת) ÷ כל המגרשים במסלולי מגורים', 'lots in subsidized tracks (subsidized / residential-lottery / special-population) ÷ all lots in residential tracks'),
    observationChannel: bi('PROPX צופה בערוצים ציבוריים בלבד — מכרזי רשות מקרקעי ישראל והגרלות משרד הבינוי והשיכון. פעילות על קרקע פרטית אינה נצפית, ולכן "תלות בקרקע ציבורית" אינה ניתנת למדידה — רק לאמירה.',
      'PROPX observes public channels only — Israel Land Authority tenders and Ministry of Construction and Housing lotteries. Private-land activity is not observed, so "public-land dependence" cannot be measured — only stated.') };
}

function landBasisOf(entity, sites) {
  const T = entity.tenders || {};
  const byTrack = {};
  for (const s of sites) {
    if (s.priceBasis !== 'competitive-bid' || s.landPrice == null || !s.units) continue;
    const e = (byTrack[s.track || 'unknown'] = byTrack[s.track || 'unknown'] || { lots: 0, units: 0, landTotal: 0 });
    e.lots++; e.units += s.units; e.landTotal += s.landPrice;
  }
  for (const e of Object.values(byTrack)) e.landPerUnit = Math.round(e.landTotal / e.units);
  return { source: SRC.ila, cls: 'OFFICIAL', landTotalCompetitive: T.landTotalCompetitive ?? null, landLots: T.landLots ?? 0, landPerUnit: T.landPerUnit ?? null, landPerUnitBasis: T.landPerUnitBasis || null,
    perSqmLots: T.perSqmLots ?? 0, fixedPriceLots: T.fixedPriceLots ?? 0, vat: 'not-stated-by-source', byTrack,
    byTrackBasis: bi('לפי מסלול: Σ סכומי זכייה ÷ Σ יח״ד על אותם מגרשי מגורים במחיר תחרותי שמפרסמים יח״ד (לפחות מגרש אחד)', 'per track: Σ winning sums ÷ Σ units over the same residential competitive-bid lots that publish units (≥ 1 lot)') };
}

function rentalOf(sites, W, diraFor) {
  const rental = sites.filter((s) => s.track === 'rental');
  const unitsKnown = rental.filter((s) => s.units != null);
  const tenderIds = [...new Set(rental.map((s) => s.tenderId).filter(Boolean))];
  const notices = [];
  for (const id of tenderIds) { let n = null; try { n = diraFor(id); } catch { n = null; } if (n) notices.push({ tenderId: id, tenderNumber: n.tenderNumber || null, totalUnits: n.totalUnits ?? null, rentalUnits: n.rentalUnits ?? null, rentalBasis: n.rentalBasis || null, saleUnits: n.saleUnits ?? null, rentalYears: n.rentalYears ?? null, status: n.status ? n.status.slug || null : null, published: n.published || null }); }
  const stated = notices.filter((n) => n.rentalUnits != null);
  return { source: `${SRC.ila} · ${SRC.dira}`, cls: 'OBSERVED', rentalTrackLots: rental.length, rentalTrackLots24: rental.filter((s) => inWindow(s.decisionDate, W.last24)).length,
    rentalTrackUnits: unitsKnown.length ? unitsKnown.reduce((s, x) => s + x.units, 0) : null, rentalTrackUnitsLabel: bi('סה״כ יח״ד במכרז — לא "יחידות להשכרה"', 'tender total units — not "rental units"'),
    noticesJoined: notices.length, statedRentalUnits: stated.length ? stated.reduce((s, n) => s + n.rentalUnits, 0) : null, statedRentalUnitsNotices: stated.length, notices,
    basis: bi('מגרש במסלול השכרה אינו פרויקט השכרה פעיל; יחידות המכרז = סה״כ המכרז; יחידות להשכרה נסכמות רק כשההודעה של דירה להשכיר (לפי מספר המכרז המודפס) מציינת אותן; אין שכר דירה, תפוסה או תשואה',
      'a rental-track lot is not an operating rental project; tender units = the tender total; rental units are summed only where Dira Lehaskir\'s notice (joined by the printed tender number) states them; no rent, occupancy or yield') };
}

function planningOf(sites, landById) {
  const plans = new Map();
  for (const s of sites) {
    const rec = landById.get(s.tenderId) || null;
    /* one lot counts once per plan, however many plan|lot keys of that plan it carries */
    for (const plan of new Set((s.planLots || []).map(planOfLotKey).filter(Boolean))) {
      if (!plans.has(plan)) plans.set(plan, { plan, lots: 0, xplan: false, station: null, shortStatus: null, approvalDate: null });
      const P = plans.get(plan); P.lots++;
      const j = rec && Array.isArray(rec.plans) ? rec.plans.find((p) => p && p.xplan && planKey(p.plan) === plan) : null;
      if (j) { P.xplan = true; P.station = j.xplan.station || null; P.shortStatus = j.xplan.shortStatus || null; P.approvalDate = j.xplan.approvalDate || null; }
    }
  }
  const items = [...plans.values()].sort((a, b) => b.lots - a.lots || a.plan.localeCompare(b.plan));
  const joined = items.filter((p) => p.xplan);
  const byStation = {};
  for (const p of joined) { const k = p.station || 'unknown'; byStation[k] = (byStation[k] || 0) + 1; }
  return { source: SRC.xplan, cls: 'OBSERVED', plans: items.length, xplanJoined: joined.length, byStation, items: items.slice(0, 40), itemsTruncated: Math.max(0, items.length - 40),
    basis: bi('מספר תכנית מדויק בלבד (מפתחות תכנית|מגרש של מגרשי היזם, מול תכניות XPlan ברשומת המכרז); מצב התכנית הוא של התכנית — לא של המגרש; לעולם לא לפי שם או גיאומטריה', 'exact plan number only (the plan|lot keys of the developer\'s lots against the tender record\'s XPlan plans); a plan\'s status is the plan\'s, not the lot\'s; never by name or geometry') };
}

function constructionOf(entity) {
  const K = entity.construction;
  if (!K || !K.lots) return null;
  return { source: SRC.cons, cls: 'OFFICIAL', stale: true, asOf: K.asOf || CONSTRUCTION_AS_OF, lots: K.lots, buildings: K.buildings ?? null, units: K.units || null, started: K.started ?? 0, completed: K.completed ?? 0,
    firstStart: K.firstStart || null, lastCompletion: K.lastCompletion || null, join: K.join || 'exact-block-parcel, awarded lots only',
    basis: bi(`דיווחי התקדמות הבנייה של משב״ש (נכון ל-${CONSTRUCTION_AS_OF}, ישן) מצורפים למגרש שנזכה לפי גוש וחלקה מדויקים בלבד`, `MoCH construction-progress rows (as of ${CONSTRUCTION_AS_OF}, STALE) joined to an awarded lot by exact block and parcel only`) };
}

function housingOf(entity, projects) {
  const L = entity.lotteries || {};
  let applicants = 0, units = 0, both = 0;
  for (const p of projects) { const f = (p.lotteries || []).find((l) => l.type === 'first'); if (f && f.applicants != null && f.units) { applicants += f.applicants; units += f.units; both++; } }
  const has = (p, st) => !!(p.stage && Array.isArray(p.stage.evidence) && p.stage.evidence.some((e) => e.stage === st));
  return { source: SRC.moch, cls: 'OFFICIAL', lotteries: L.lotteries ?? 0, firstLotteries: L.firstLotteries ?? 0, projects: L.projects ?? projects.length, unitsFirstLotteries: L.unitsFirstLotteries ?? null, applicantsFirstLotteries: L.applicantsFirstLotteries ?? null,
    applicantsPerUnit: units ? round(applicants / units, 1) : null, applicantsPerUnitProjects: both, applicantsPerUnitBasis: 'DERIVED: Σ applicants ÷ Σ units over first lotteries that publish both',
    permittedProjects: projects.filter((p) => has(p, 'permitted')).length, occupiedProjects: projects.filter((p) => has(p, 'occupied')).length, projectsResolved: projects.length,
    basis: bi('יח״ד = יח״ד שהוצעו בהגרלה הראשונה של הפרויקט (לא מחוברות ליח״ד של מגרשי רמ״י); היתר / אכלוס לפי שלב משב״ש כפי שפורסם', 'units = units offered in the project\'s first lottery (never added to ILA lot units); permitted / occupied from MoCH\'s published stage') };
}

/* ------------------------------------------------------------ the rule table */
const cityNames = (rows, lang) => [...new Set(rows.map((x) => (lang === 'en' ? x.cityEn || x.city : x.city) || String(x.localityCode)))].slice(0, 5).join(', ');
const OBS = bi('ערוצים ציבוריים בלבד (מכרזי רמ״י, הגרלות משב״ש) — פעילות על קרקע פרטית אינה נצפית', 'public channels only (ILA tenders, MoCH lotteries) — private-land activity is not observed');
const RES_ONLY = bi('מגרשים במסלולי מגורים בלבד (אתרים); מגרשים אחרים של היזם אינם בחלון', 'residential-track lots only (sites); the developer\'s other lots are outside the window');
const NOT_JUDGEMENT = bi('תיאור של הפעילות שנצפתה — לא שיפוט על החברה', 'a description of the observed activity — not a judgement on the company');

const SIGNALS = [
  { id: 'NEW_MARKET_ENTRY', kind: 'watch', cls: 'DERIVED', source: SRC.reg, threshold: '≥ 1', period: bi('24 חודשים', '24 months'),
    trigger: bi('כניסה ליישוב: פעילות ראשונה שנצפתה ביישוב בתוך 24 חודשים, אצל יזם שהיה פעיל במקום אחר לפני כן', 'market entry: first observed activity in a locality within 24 months, for a developer already active elsewhere before'),
    limitations: [bi('"ראשונה" = ראשונה במקורות PROPX — לא בהכרח הפעילות הראשונה של החברה ביישוב', '"first" = first in PROPX\'s sources — not necessarily the company\'s first activity in the locality'), OBS],
    fires: (x) => x.entries.length >= 1, value: (x) => x.entries.length,
    text: (x) => bi(`${x.entries.length === 1 ? 'כניסה ליישוב אחד' : `${x.entries.length} כניסות ליישובים`} ב-24 חודשים: ${cityNames(x.entries, 'he')}`, `${x.entries.length} market ${x.entries.length === 1 ? 'entry' : 'entries'} in 24 months: ${cityNames(x.entries, 'en')}`),
    components: (x) => ({ entries: x.entries.map((e) => ({ localityCode: e.localityCode, city: e.city, date: e.date, via: e.via })) }) },
  { id: 'ACCELERATING_LAND_ACTIVITY', kind: 'watch', cls: 'DERIVED', source: SRC.ila, threshold: bi('≥ 3 מגרשים ב-12 החודשים האחרונים ולפחות פי 2 מ-12 הקודמים', '≥ 3 lots in the last 12 months and ≥ 2 × the prior 12'), period: bi('12 חודשים אחרונים מול 12 הקודמים', 'last 12 months vs the prior 12'),
    trigger: bi('מגרשי מגורים שנזכו ב-12 החודשים האחרונים ≥ 3 וגם ≥ 2 × 12 החודשים הקודמים', 'residential lots won in the last 12 months ≥ 3 and ≥ 2 × the prior 12 months'),
    limitations: [RES_ONLY, OBS],
    fires: (x) => x.activity.windows.last12.lotsWon >= 3 && x.activity.windows.last12.lotsWon >= 2 * x.activity.windows.prior12.lotsWon, value: (x) => x.activity.windows.last12.lotsWon,
    text: (x) => bi(`${x.activity.windows.last12.lotsWon} מגרשי מגורים ב-12 החודשים האחרונים מול ${x.activity.windows.prior12.lotsWon} ב-12 הקודמים`, `${x.activity.windows.last12.lotsWon} residential lots in the last 12 months vs ${x.activity.windows.prior12.lotsWon} in the prior 12`),
    components: (x) => ({ last12: x.activity.windows.last12.lotsWon, prior12: x.activity.windows.prior12.lotsWon }) },
  { id: 'RECENT_WIN_MOMENTUM', kind: 'watch', cls: 'OBSERVED', source: SRC.ila, threshold: '≥ 3', period: bi('6 חודשים', '6 months'),
    trigger: bi('≥ 3 מגרשי מגורים שנזכו ב-6 החודשים האחרונים', '≥ 3 residential lots won in the last 6 months'), limitations: [RES_ONLY, OBS],
    fires: (x) => x.activity.windows.last6.lotsWon >= 3, value: (x) => x.activity.windows.last6.lotsWon,
    text: (x) => bi(`${x.activity.windows.last6.lotsWon} מגרשי מגורים נזכו ב-6 החודשים האחרונים (${fmt(x.activity.windows.last6.residentialUnits)} יח״ד)`, `${x.activity.windows.last6.lotsWon} residential lots won in the last 6 months (${fmt(x.activity.windows.last6.residentialUnits)} units)`) },
  { id: 'HIGH_GEOGRAPHIC_CONCENTRATION', kind: 'risk', cls: 'DERIVED', source: SRC.ila, threshold: bi('≥ 70% מתוך ≥ 5 מגרשי מגורים', '≥ 70% of ≥ 5 residential lots'), period: bi('פעילות שנצפתה', 'observed activity'),
    trigger: bi('היישוב המוביל מחזיק ≥ 70% ממגרשי המגורים שנזכו, מתוך ≥ 5 מגרשים', 'the top market holds ≥ 70% of the residential lots won, out of ≥ 5 lots'),
    limitations: [NOT_JUDGEMENT, OBS, bi('מגרשי רמ״י בלבד; הגרלות אינן נספרות', 'ILA lots only; lotteries are not counted')],
    fires: (x) => x.geo.residentialLots >= 5 && x.geo.share != null && x.geo.share >= 0.7, value: (x) => x.geo.share,
    text: (x) => bi(`${pct(x.geo.share)} ממגרשי המגורים שנזכו (${x.geo.lots} מתוך ${x.geo.residentialLots}) ביישוב אחד: ${x.geo.topMarket ? x.geo.topMarket.city || x.geo.topMarket.localityCode : '—'}`, `${pct(x.geo.share)} of residential lots won (${x.geo.lots} of ${x.geo.residentialLots}) in one market: ${x.geo.topMarket ? x.geo.topMarket.cityEn || x.geo.topMarket.city || x.geo.topMarket.localityCode : '—'}`),
    components: (x) => ({ topMarket: x.geo.topMarket, lots: x.geo.lots, residentialLots: x.geo.residentialLots, markets: x.geo.markets }) },
  { id: 'PROGRAM_CONCENTRATION', kind: 'info', cls: 'DERIVED', source: SRC.ila, threshold: bi('≥ 70% מתוך ≥ 5 מגרשים', '≥ 70% of ≥ 5 lots'), period: bi('פעילות שנצפתה', 'observed activity'),
    trigger: bi('מסלול שיווק אחד מחזיק ≥ 70% מהמגרשים שנזכו, מתוך ≥ 5 מגרשים', 'one marketing track holds ≥ 70% of the lots won, out of ≥ 5 lots'), limitations: [OBS, NOT_JUDGEMENT],
    fires: (x) => x.programs.lots >= 5 && !!x.programs.topTrack && x.programs.topTrack.share >= 0.7, value: (x) => (x.programs.topTrack ? x.programs.topTrack.share : null),
    text: (x) => bi(`${pct(x.programs.topTrack.share)} מהמגרשים שנזכו (${x.programs.topTrack.lots} מתוך ${x.programs.lots}) במסלול ${x.programs.topTrack.track}`, `${pct(x.programs.topTrack.share)} of lots won (${x.programs.topTrack.lots} of ${x.programs.lots}) on the ${x.programs.topTrack.track} track`),
    components: (x) => ({ track: x.programs.topTrack.track, lots: x.programs.topTrack.lots, total: x.programs.lots }) },
  { id: 'LOW_RECENT_PUBLIC_ACTIVITY', kind: 'info', cls: 'DERIVED', source: `${SRC.ila} · ${SRC.moch}`, threshold: bi('≥ 3 מגרשים + הגרלות לאורך זמן ואפס ב-24 חודשים', '≥ 3 lifetime lots + lotteries and none in 24 months'), period: bi('24 חודשים', '24 months'),
    trigger: bi('≥ 3 מגרשים + הגרלות במצטבר, ולא נצפתה פעילות בערוצים הציבוריים של PROPX ב-24 החודשים האחרונים', '≥ 3 lifetime lots + lotteries, and no activity observed in PROPX\'s public channels in the last 24 months'),
    limitations: [bi('היעדר תצפית אינו היעדר פעילות: PROPX אינו צופה בקרקע פרטית, בהיתרים או במכירות', 'absence of observation is not absence of activity: PROPX does not observe private land, permits or sales'), OBS],
    fires: (x) => x.lifetime >= 3 && (!x.entity.lastActivity || x.entity.lastActivity < x.windows.last24.from), value: () => 0,
    text: (x) => bi(`לא נצפתה פעילות בערוצים הציבוריים של PROPX ב-24 חודשים (אחרונה: ${x.entity.lastActivity || '—'}; ${x.lifetime} מגרשים + הגרלות במצטבר)`, `no activity observed in PROPX's public channels in 24 months (last: ${x.entity.lastActivity || '—'}; ${x.lifetime} lifetime lots + lotteries)`),
    components: (x) => ({ lifetime: x.lifetime, lastActivity: x.entity.lastActivity || null, monthsSinceLast: x.activity.monthsSinceLast }) },
  { id: 'RENTAL_EXPANSION', kind: 'watch', cls: 'OBSERVED', source: SRC.ila, threshold: '≥ 1', period: bi('24 חודשים', '24 months'),
    trigger: bi('≥ 1 מגרש במסלול דיור להשכרה שנזכה ב-24 החודשים האחרונים', '≥ 1 rental-track lot won in the last 24 months'),
    limitations: [bi('יחידות המכרז = סה״כ המכרז, לא "יחידות להשכרה"; מגרש במסלול השכרה אינו פרויקט השכרה פעיל', 'tender units = the tender total, not "rental units"; a rental-track lot is not an operating rental project'), OBS],
    fires: (x) => x.rental.rentalTrackLots24 >= 1, value: (x) => x.rental.rentalTrackLots24,
    text: (x) => bi(`${x.rental.rentalTrackLots24} מגרשים במסלול השכרה ב-24 חודשים (${x.rental.noticesJoined} הודעות דירה להשכיר מצורפות; יח״ד להשכרה שצוינו: ${fmt(x.rental.statedRentalUnits)})`, `${x.rental.rentalTrackLots24} rental-track lots in 24 months (${x.rental.noticesJoined} Dira Lehaskir notices joined; stated rental units: ${fmt(x.rental.statedRentalUnits)})`),
    components: (x) => ({ rentalTrackLots24: x.rental.rentalTrackLots24, rentalTrackLots: x.rental.rentalTrackLots, noticesJoined: x.rental.noticesJoined, statedRentalUnits: x.rental.statedRentalUnits }) },
  { id: 'PLANNING_EVIDENCE', kind: 'info', cls: 'OBSERVED', source: SRC.xplan, threshold: '≥ 2', period: bi('כל הפעילות שנצפתה', 'all observed activity'),
    trigger: bi('≥ 2 תכניות שונות של מגרשי היזם מצורפות ל-XPlan במספר תכנית מדויק', '≥ 2 distinct plans of the developer\'s lots joined to XPlan by exact plan number'),
    limitations: [bi('מספר תכנית מדויק בלבד; מצב התכנית הוא של התכנית, לא של המגרש; תכנית ללא צירוף אינה "ללא תכנון"', 'exact plan number only; a plan\'s status is the plan\'s, not the lot\'s; an unjoined plan is not "no planning"')],
    fires: (x) => x.planning.xplanJoined >= 2, value: (x) => x.planning.xplanJoined,
    text: (x) => bi(`${x.planning.xplanJoined} תכניות מצורפות ל-XPlan מתוך ${x.planning.plans} תכניות שמגרשי היזם מפנים אליהן`, `${x.planning.xplanJoined} plans joined to XPlan out of ${x.planning.plans} plans the developer's lots reference`),
    components: (x) => ({ plans: x.planning.plans, xplanJoined: x.planning.xplanJoined, byStation: x.planning.byStation }) },
  { id: 'CONSTRUCTION_EVIDENCE', kind: 'info', cls: 'OBSERVED', source: SRC.cons, threshold: '≥ 1', period: null,
    trigger: bi('≥ 1 מגרש שנזכה עם תחילת בנייה בדיווחי משב״ש (צירוף גוש/חלקה מדויק)', '≥ 1 awarded lot with a construction start in MoCH\'s progress rows (exact block/parcel join)'),
    limitations: [bi(`המקור ישן — נכון ל-${CONSTRUCTION_AS_OF}; מגרשים ללא צירוף אינם "ללא בנייה"`, `the source is STALE — as of ${CONSTRUCTION_AS_OF}; unjoined lots are not "no construction"`)],
    fires: (x) => !!x.construction && x.construction.started >= 1, value: (x) => (x.construction ? x.construction.started : null), periodOf: (x) => (x.construction ? x.construction.asOf : CONSTRUCTION_AS_OF),
    /* started / completed count BUILDINGS (MoCH progress rows), over x.construction.lots joined lots — the unit is said (UX review 19.10.2026) */
    text: (x) => bi(`תחילת בנייה ב-${x.construction.started} מבנים ב-${x.construction.lots} מגרשים מצורפים (${x.construction.completed} מבנים הושלמו) לפי דיווחי משב״ש נכון ל-${x.construction.asOf} — ישן`, `construction started on ${x.construction.started} buildings in ${x.construction.lots} joined lots (${x.construction.completed} buildings completed) per MoCH's rows as of ${x.construction.asOf} — STALE`),
    components: (x) => ({ lots: x.construction.lots, started: x.construction.started, completed: x.construction.completed, asOf: x.construction.asOf, stale: true }) },
  { id: 'POSSIBLE_SAME_ENTITY', kind: 'info', cls: 'DERIVED', source: SRC.reg, threshold: '≥ 1', period: bi('הרישום הנוכחי', 'the current registry'),
    trigger: bi('≥ 1 שם רשום אחר שייתכן שהוא אותה ישות (אותן אותיות / קידומת חתוכה) — לא מוזג', '≥ 1 other listed name that is possibly the same entity (same letters / cut prefix) — not merged'),
    limitations: [bi('קישור עם ראיה בלבד; הספירות לעולם אינן מחוברות', 'a link with its evidence only; counts are never combined')],
    fires: (x) => (x.entity.possibleSame || []).length >= 1, value: (x) => (x.entity.possibleSame || []).length,
    text: (x) => bi(`ייתכן שאותה ישות — לא מוזג: ${x.entity.possibleSame.map((p) => p.name).slice(0, 3).join(' · ')}`, `possibly the same entity — not merged: ${x.entity.possibleSame.map((p) => p.name).slice(0, 3).join(' · ')}`),
    components: (x) => ({ possibleSame: x.entity.possibleSame.map((p) => ({ id: p.id, name: p.name, evidence: p.evidence })) }) },
];

function signalsOf(x) {
  const out = [];
  for (const r of SIGNALS) {
    if (!r.fires(x)) continue;
    const v = r.value(x), valueLabel = !Number.isFinite(v) ? null : /CONCENTRATION/.test(r.id) ? Math.round(v * 100) + '%' : Math.round(v).toLocaleString('en-US');
    out.push({ id: r.id, kind: r.kind, text: r.text(x), trigger: r.trigger, value: v, valueLabel, threshold: r.threshold, period: r.periodOf ? r.periodOf(x) : r.period, source: r.source, cls: r.cls,
      limitations: r.limitations, components: r.components ? r.components(x) : undefined });
  }
  return out;
}

/* ------------------------------------------------------------ the read */
function devIntel(entity, cache = {}, opt = {}) {
  if (!entity) return null;
  const today = dayOf(opt.now);
  const W = windowsOf(today);
  const projById = cache.projById instanceof Map ? cache.projById : new Map();
  const landById = cache.landById instanceof Map ? cache.landById : new Map();
  const allEntries = (cache.R && Array.isArray(cache.R.entries)) ? cache.R.entries : [];
  const diraFor = typeof opt.diraFor === 'function' ? opt.diraFor : typeof cache.diraFor === 'function' ? cache.diraFor : defaultDiraFor;
  const sites = (entity.sites || []).map((id) => projById.get(id)).filter((s) => s && s.kind === 'ila-awarded-lot');
  const projects = (entity.projects || []).map((id) => projById.get(id)).filter((p) => p && p.kind === 'moch-lottery-project' && (!Array.isArray(p.developerIds) || p.developerIds.includes(entity.id)));
  const entries = allEntries.filter((e) => e.developerId === entity.id && inWindow(e.date, W.last24)).sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const identity = { id: entity.id, name: entity.name, canonical: entity.canonical, kind: entity.kind, joint: !!entity.joint, roles: entity.roles || [], aliases: entity.aliases || [],
    possibleSame: (entity.possibleSame || []).map((p) => ({ ...p, merged: false })), companyId: null, companyIdNote: entity.companyIdNote || 'not published by these sources',
    rule: bi('ישות אחת = שם קנוני אחד (וריאנטים טיפוגרפיים בלבד); "ייתכן שאותה ישות" הוא קישור עם ראיה — לעולם לא מיזוג', 'one entity = one canonical name (typographic variants only); "possibly the same" is a link with its evidence — never a merge'), source: SRC.reg, cls: 'OBSERVED' };
  const activity = activityOf(entity, sites, projects, W, today);
  const markets = marketsOf(entity, sites);
  const programs = programsOf(entity);
  const landBasis = landBasisOf(entity, sites);
  const rental = rentalOf(sites, W, diraFor);
  const planning = planningOf(sites, landById);
  const construction = constructionOf(entity);
  const housing = housingOf(entity, projects);
  const lifetime = ((entity.tenders && entity.tenders.lots) || 0) + ((entity.lotteries && entity.lotteries.lotteries) || 0);
  const x = { entity, sites, projects, entries, activity, geo: markets.geographicConcentration, programs, landBasis, rental, planning, construction, housing, lifetime, today, windows: W };
  const signals = signalsOf(x);
  return { schema: 1, generatedFor: today, basis: bi(`${BASIS} — מה שמקורות PROPX הציבוריים מראים (מכרזי רמ״י, הגרלות משב״ש, צירופים מדויקים ל-XPlan, לדיווחי הבנייה ולהודעות דירה להשכיר); לא מאגר קרקעות, לא צנרת כוללת, לא רשימה מלאה, לא נתח שוק; ללא ציון; אות סיכון מתאר פעילות שנצפתה — לא שיפוט על החברה`,
      `${BASIS} — what PROPX's public sources show (ILA tenders, MoCH lotteries, exact joins to XPlan, construction rows and Dira Lehaskir notices); never a land bank, a total pipeline, a complete list or a market share; no score; a risk signal describes observed activity — not a judgement on the company`),
    windows: { last6: { from: W.last6.from, to: W.last6.to }, last12: { from: W.last12.from, to: W.last12.to }, last24: { from: W.last24.from, to: W.last24.to }, prior12: { from: W.prior12.from, to: W.prior12.to }, prior24to36: { from: W.prior24to36.from, to: W.prior24to36.to } },
    identity, activity, markets, programs, landBasis, rental, planning, construction, housing,
    entries: { source: SRC.reg, cls: 'DERIVED', period: bi('24 חודשים', '24 months'), rows: entries, definition: 'DEVELOPER MARKET ENTRY: a city whose first observed activity of the developer falls in the window, for a developer already active elsewhere before it' },
    signals, signalsBasis: bi('כללים דטרמיניסטיים: טריגר · ערך · סף · תקופה · מקור · סיווג · מגבלות; לעולם לא המלצה ולא ציון', 'deterministic rules: trigger · value · threshold · period · source · class · limitations; never a recommendation, never a score') };
}

module.exports = { devIntel, SIGNALS, signalsOf, windowsOf, monthsBetween, dayOf, SUBSIDIZED_TRACKS };
