// PROPX · SUPPLY PIPELINE — parallel universes of housing supply for one geography (national · district · locality).
//
// One read, six universes that are NEVER added together:
//   planning      XPlan plan units (the Planning Administration's online-plans layer): the plans of the geography's renewal
//                 complexes (exact join) and the plans its current tenders reference (exact plan number) — a plan's units are
//                 the plan's, usually wider than one lot or complex; units after the plan are DERIVED (lib/planning/xplan-units.js)
//   land          ILA tender units — four meanings kept apart (open · pending decision · awarded · failed) + decided-not-read
//   renewal       MoCH urban-renewal complexes — proposed / additional units as the Ministry publishes them (additional ≠ net)
//   rental        the ILA rental track — a tender's units are its TOTAL; rental units only as Dira Lehaskir wrote them
//   lotteries     MoCH subsidized-housing lotteries — units in FIRST lotteries; projects by their furthest evidenced stage
//   construction  MoCH construction-progress rows joined to awarded lots by exact block + parcel (STALE, as of 2024-03-01)
// The same homes can sit in several universes (a plan → a tender lot → a lottery → a construction row), so a sum across them
// would count them several times: the module exposes no figure across universes. Every figure carries its source id, its
// class (OFFICIAL / OBSERVED / DERIVED), its period or window and a bilingual basis; an unknown value is null, never 0.
// Nothing is fetched or modelled: the module only reads the committed files through the existing read models.
//
//   supply({ level: 'il' | 'district' | 'locality', code, now })  →  the pipeline (null for an unknown geography); memoized per
//                                                                    geography and data stamp (fresh: true recomputes)
//   UNIVERSES                                                      the six universes, in order, with what each counts
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const LQ = require('../land/query');
const RN = require('../renewal/query');
const RQ = require('../rental/query');
const EQ = require('../entities/query');
const PL = require('../renewal/planning');
const XU = require('../planning/xplan-units');
const { DISTRICTS } = require('../dossier/query');
const { STAGES: RENEWAL_STAGES } = require('../renewal/normalize');
const { STAGES: PROJECT_STAGES } = require('../entities/registry');
const { planKey } = require('../land/normalize');

const ROOT = path.join(__dirname, '..', '..', 'data');
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
const bi = (he, en) => ({ he, en });
const enName = (v) => String(v || '').replace(/(^|[\s\-(\/])(\p{Ll})/gu, (m, p, c) => p + c.toUpperCase());
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const round1 = (v) => Math.round(v * 10) / 10;
const sumOrNull = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const sumOf = (rows, get) => { const v = rows.map(get).filter((x) => x != null); return { sum: v.length ? v.reduce((a, b) => a + b, 0) : null, of: v.length }; };
const maxD = (xs) => xs.filter(Boolean).sort().pop() || null;
const decisionDate = (r) => r.decisionDate || r.committeeDate || r.lotteryDate || r.closeDate || null;
const key = (p) => String(p || '').replace(/\s+/g, '').trim();

/* ------------------------------------------------------------ the universes (the ONE list; the output keys follow it) */
const UNIVERSES = Object.freeze([
  { id: 'planning', cls: 'OFFICIAL', source: 'iplan:xplan', label: bi('תכנון — יח״ד בתוכניות', 'planning — plan housing units'),
    counts: bi('יח״ד של תוכניות במערכת התכנון המקוונת: המצב המאושר לפני התוכנית, השינוי שהתוכנית עושה, וסה״כ אחרי התוכנית (נגזר)', 'housing units of plans in the online planning system: the authorised state before the plan, the plan\'s change, and units after the plan (DERIVED)'),
    notTheOthers: bi('שטח תוכנית רחב בדרך כלל ממגרש או ממתחם; תוכנית מאושרת אינה מכרז, היתר או בנייה', 'a plan\'s area is usually wider than one lot or complex; an approved plan is not a tender, a permit or construction') },
  { id: 'land', cls: 'OFFICIAL', source: 'rmi:michrazim', label: bi('קרקע — יח״ד במכרזי רמ״י', 'land — ILA tender units'),
    counts: bi('יח״ד שרמ״י פרסמה במכרזים על קרקע מדינה, בארבע משמעויות נפרדות: פתוחות · ממתינות להחלטה · שנזכו · שנכשלו', 'units the ILA published in tenders on state land, in four separate meanings: open · pending decision · awarded · failed'),
    notTheOthers: bi('קרקע מדינה בלבד; יח״ד שנזכו הן קיבולת מגרש, לא דירות שנבנו; אותן דירות יכולות להופיע גם בתוכנית, בהגרלה ובדיווח בנייה', 'state land only; awarded units are lot capacity, not homes built; the same homes may also appear in a plan, a lottery and a construction report') },
  { id: 'renewal', cls: 'OFFICIAL', source: 'datagov:moch:urban-renewal', label: bi('התחדשות עירונית — יח״ד מוצעות במתחמים', 'urban renewal — proposed units in complexes'),
    counts: bi('מתחמי התחדשות של משב״ש: יח״ד קיימות, תוספת ומוצעות כפי שפורסמו (התוספת אינה נטו בכל שורה)', 'MoCH renewal complexes: existing, additional and proposed units as published (the additional column is not net in every row)'),
    notTheOthers: bi('מתחם מוכרז אינו בנייה; התוכנית של המתחם נספרת ביקום התכנון, לא כאן', 'a declared complex is not construction; the complex\'s plan is counted in the planning universe, not here') },
  { id: 'rental', cls: 'OFFICIAL', source: 'rmi:michrazim · dira-lehaskir:wp', label: bi('השכרה ארוכת טווח — מסלול ההשכרה של רמ״י', 'long-term rental — the ILA rental track'),
    counts: bi('מכרזי מסלול ההשכרה: יח״ד של מכרז = סך המכרז; יח״ד להשכרה רק כפי שדירה להשכיר כתבה', 'rental-track tenders: a tender\'s units are its TOTAL; rental units only as Dira Lehaskir wrote them'),
    notTheOthers: bi('מכרזי ההשכרה כלולים גם ביקום הקרקע — אותם מכרזים, זווית אחרת; לעולם לא מחוברים', 'the rental tenders are also inside the land universe — the same tenders, another angle; never added') },
  { id: 'lotteries', cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries', label: bi('דיור מסובסד — הגרלות משב״ש', 'subsidized housing — MoCH lotteries'),
    counts: bi('יח״ד שהוצעו בהגרלות ראשונות; פרויקטים לפי השלב הרחוק ביותר שיש לו ראיה', 'units offered in first lotteries; projects by the furthest evidenced stage'),
    notTheOthers: bi('דירות ההגרלה הן לרוב אותן דירות של מגרש שנזכה במכרז — אין מפתח משותף, לעולם לא מצורפות', 'lottery homes are usually the same homes as an awarded tender lot — no shared key, never joined') },
  { id: 'construction', cls: 'OFFICIAL', source: 'datagov:moch:construction-progress', label: bi('בנייה — דיווחי התקדמות (משב״ש)', 'construction — MoCH progress reports'),
    counts: bi('מבנים בדיווחי ההתקדמות שהוצמדו למגרשים שנזכו בגוש/חלקה מדויקים: התחלות וגמר', 'buildings in the progress reports joined to awarded lots by exact block + parcel: starts and completions'),
    notTheOthers: bi('רק מגרשי רמ״י שנזכו ושיש להם גוש/חלקה; המקור נעצר ב-01.03.2024 (ישן)', 'only awarded ILA lots with a block/parcel; the source stops at 2024-03-01 (STALE)') },
]);

/* ------------------------------------------------------------ geography */
let locCache = null;
function localities(dataDir) {
  if (locCache && locCache.dir === dataDir) return locCache;
  const g = readJson(path.join(dataDir, 'geo', 'localities.json'));
  const arr = g && Array.isArray(g.localities) ? g.localities : [];
  const by = new Map(); for (const l of arr) by.set(String(l.code), l);
  locCache = { dir: dataDir, by, arr };
  return locCache;
}
function resolveGeo(level, code, L) {
  if (level === 'locality') { const l = L.by.get(String(code)); if (!l) return null; const d = l.district && DISTRICTS[l.district] ? DISTRICTS[l.district] : null;
    return { level, code: String(l.code), name: bi(l.he, enName(l.en)), district: l.district || null, districtName: d ? bi(d.he, d.en) : null }; }
  if (level === 'district') { const d = DISTRICTS[code]; if (!d) return null; return { level, code, name: bi(d.he, d.en), district: code, districtName: bi(d.he, d.en), localities: L.arr.filter((l) => l.district === code).length }; }
  if (level === 'il' || level == null) return { level: 'il', code: 'il', name: bi('ישראל', 'Israel'), district: null, districtName: null };
  return null;
}

/* ------------------------------------------------------------ windows and momentum */
const inWin = (d, w) => d != null && d > w.from && d <= w.to;
function windowsOf(today) {
  const m12 = LQ.monthsBefore(today, 12), m24 = LQ.monthsBefore(today, 24);
  return { today, last12: { from: m12, to: today }, prior12: { from: m24, to: m12 }, last24: { from: m24, to: today },
    basis: bi('חלונות מתוארכים מהיום (שעון ישראל): 12 החודשים האחרונים = (היום − 12 חודשים, היום]; 12 הקודמים = (היום − 24, היום − 12]', 'windows dated from today (Israel time): last 12 months = (today − 12 months, today]; prior 12 = (today − 24, today − 12]') };
}
/** last 12 vs prior 12 — pct = (last12 − prior12) ÷ prior12 × 100, rounded to 0.1. `small` (pct null) when the prior window holds
 *  fewer than minCount items or, for a unit figure, fewer than minUnits units. A window the source does not cover is null, never 0;
 *  inside coverage a window without items is a real 0. */
function momentum(items, { dateOf, unitsOf = null, minCount = 3, minUnits = 100, W, coveredFrom = null, coveredTo = null, what }) {
  const cover = (w) => (!coveredTo ? 'unknown' : w.from >= coveredTo || (coveredFrom && w.to < coveredFrom) ? 'none' : w.to > coveredTo || (coveredFrom && w.from < coveredFrom) ? 'partial' : 'within');
  const pick = (w) => items.filter((x) => inWin(dateOf(x), w));
  const L = pick(W.last12), P = pick(W.prior12), covL = cover(W.last12), covP = cover(W.prior12);
  const val = (xs, cov) => (cov === 'none' ? null : unitsOf ? (xs.length ? sumOrNull(xs.map(unitsOf)) : 0) : xs.length);
  const last12 = val(L, covL), prior12 = val(P, covP);
  const small = covP === 'none' || P.length < minCount || (!!unitsOf && (prior12 == null || prior12 < minUnits));
  const pct = !small && prior12 != null && last12 != null && prior12 > 0 ? round1(((last12 - prior12) / prior12) * 100) : null;
  return { last12, prior12, pct, small, unit: unitsOf ? 'units' : 'count', count: { last12: covL === 'none' ? null : L.length, prior12: covP === 'none' ? null : P.length },
    window: { last12: W.last12, prior12: W.prior12 }, coverage: { last12: covL, prior12: covP, coveredFrom, coveredTo },
    rule: bi(`אחוז = (12 אחרונים − 12 קודמים) ÷ 12 קודמים × 100; מדגם קטן (ללא אחוז) כשבחלון הקודם פחות מ-${minCount} ${what.he}${unitsOf ? ` או פחות מ-${minUnits} יח״ד` : ''}; חלון שהמקור אינו מכסה = חסר, לא 0`,
      `pct = (last 12 − prior 12) ÷ prior 12 × 100; small sample (no pct) when the prior window holds fewer than ${minCount} ${what.en}${unitsOf ? ` or fewer than ${minUnits} units` : ''}; a window the source does not cover is null, never 0`) };
}

/* ------------------------------------------------------------ stores (each cached per data stamp) */
let HOUSING = null;
function housing(dataDir) {
  const dir = path.join(dataDir, 'housing'), stamp = mtime(path.join(dir, 'meta.json'));
  if (HOUSING && HOUSING.dir === dir && HOUSING.stamp === stamp) return HOUSING;
  const records = readJson(path.join(dir, 'lotteries.json'), []);
  HOUSING = { dir, stamp, meta: readJson(path.join(dir, 'meta.json')), lotteries: (Array.isArray(records) ? records : []).filter((r) => (!r.recordType || r.recordType === 'lottery') && r.inLatestSource !== false) };
  return HOUSING;
}
let CBS = null;
function cbsSales(dataDir) {
  const f = path.join(dataDir, 'cbs-sales', 'latest.json'), stamp = mtime(f);
  if (CBS && CBS.f === f && CBS.stamp === stamp) return CBS;
  CBS = { f, stamp, data: readJson(f) };
  return CBS;
}
const MEMO = new Map();

/* ------------------------------------------------------------ helpers over plans */
const PLAN_STAGES = PL.STAGES.concat(PL.TERMINAL, PL.OTHER);
/** plans → one row per stage, each plan once: count, Σ units after the plan, Σ plan unit delta, Σ existing authorised (with how many plans carry each) */
function stageTable(plans, stageOf, unitsOf) {
  return PLAN_STAGES.map((stage) => { const ps = plans.filter((p) => stageOf(p) === stage); if (!ps.length) return null; const U = ps.map(unitsOf);
    return { stage, plans: ps.length, unitsAfterPlan: sumOf(U, (u) => u.unitsAfterPlan), planUnitDelta: sumOf(U, (u) => u.planUnitDelta), existingAuthorisedUnits: sumOf(U, (u) => u.existingAuthorisedUnits) }; }).filter(Boolean);
}
const UNITS_BASIS = bi('יח״ד מאושרות לפני התוכנית (pq_authorised_quantity_120) · תוספת יח״ד בתוכנית (quantity_delta_120) · סה״כ אחרי התוכנית = סכומן (נגזר); כל תוכנית נספרת פעם אחת; יח״ד של תוכנית הן של התוכנית, לא של המגרש או המתחם',
  'units authorised before the plan (pq_authorised_quantity_120) · the plan\'s unit delta (quantity_delta_120) · units after the plan = their sum (DERIVED); each plan once; a plan\'s units are the plan\'s, never the lot\'s or the complex\'s');

/* ------------------------------------------------------------ the pipeline */
function supply({ level = 'il', code = null, dataDir = ROOT, now = Date.now(), fresh: noMemo = false } = {}) {
  const L = localities(dataDir);
  const geo = resolveGeo(level, code, L); if (!geo) return null;
  const today = LQ.israelToday(new Date(now));
  const C = LQ.load(), R = RN.load(), E = EQ.load(), H = housing(dataDir), cbs = cbsSales(dataDir).data;
  const stamp = [dataDir, C.stamp, R.stamp, H.stamp, cbsSales(dataDir).stamp, RQ.load().stamp, E.stamp, today].join('|');
  const memoKey = geo.level + '|' + geo.code;
  if (MEMO.get('stamp') !== stamp) { MEMO.clear(); MEMO.set('stamp', stamp); }
  if (!noMemo && MEMO.has(memoKey)) return { ...MEMO.get(memoKey), generatedAt: new Date(now).toISOString() };

  const W = windowsOf(today);
  const districtCodes = geo.level === 'district' ? new Set(L.arr.filter((l) => l.district === geo.code).map((l) => String(l.code))) : null;
  const inGeo = (localityCode) => (geo.level === 'il' ? true : geo.level === 'locality' ? String(localityCode) === geo.code : localityCode != null && districtCodes.has(String(localityCode)));
  const { filters: f } = LQ.parseFilters(new URLSearchParams({ scope: 'current', period: 'all' }), new Date(now));
  const U = {}, missing = [], freshness = [];
  const fresh = (id, label, observed, published, checked, state) => freshness.push({ id, label, observed: observed || null, published: published || null, checked: checked || null, state: state || null });
  const miss = (id, he, en) => missing.push({ id, he, en });
  const landMeta = C.meta || {}, landCov = landMeta.coverage || {};
  const liveGeo = C.live.filter((r) => inGeo(r.localityCode));
  const current = liveGeo.filter((r) => LQ.isCurrent(r, f));
  const resLive = liveGeo.filter((r) => LQ.RESIDENTIAL.has(r.track));

  /* ---- 1 · planning: the plans of this geography's renewal complexes (exact join) and the plans its current tenders reference */
  const cx = R.live.filter((c) => inGeo(c.localityCode));
  const rSeen = new Map(); let rJoined = 0;
  for (const c of cx) { const j = R.join.byComplex.get(c.id); if (j && j.plan) { rJoined++; if (!rSeen.has(j.plan.mpId)) rSeen.set(j.plan.mpId, j.plan); } }
  const rPlans = [...rSeen.values()];
  const tp = new Map(), planStatus = { found: 0, 'not-found': 0, 'not-checked': 0 };
  for (const r of current) for (const p of r.plans || []) { if (p.via !== 'lot') continue; planStatus[p.xplanStatus || 'not-checked'] = (planStatus[p.xplanStatus || 'not-checked'] || 0) + 1;
    if (p.xplanStatus !== 'found') continue; const k = planKey(p.plan), full = C.planByKey.get(k); if (!full) continue;
    if (!tp.has(k)) tp.set(k, { key: k, plan: full, units: C.planUnits.get(k) || XU.unitsOfStored(full), stage: PL.stageOf(full.station, full.shortStatus), tenders: 0 }); tp.get(k).tenders++; }
  const tPlans = [...tp.values()];
  const rKeys = new Set(rPlans.map((p) => key(p.planKey || p.planNumber)));
  const overlap = tPlans.filter((x) => rKeys.has(x.key)).length;
  const inv = C.inventory.filter((p) => inGeo(p.localityCode)), invMeta = C.plans.inventoryMeta || null;
  const invStages = new Map(); for (const p of inv) { const e = invStages.get(p.stage) || { stage: p.stage, plans: 0, potentialUnits: { sum: null, of: 0 } }; e.plans++; if (p.potentialUnits != null) { e.potentialUnits.sum = (e.potentialUnits.sum || 0) + p.potentialUnits; e.potentialUnits.of++; } invStages.set(p.stage, e); }
  U.planning = { cls: 'OFFICIAL', source: 'iplan:xplan', scope: bi('תוכניות שPROPX מחזיקה לגאוגרפיה: תוכניות מתחמי ההתחדשות (צירוף מדויק) ותוכניות שמכרזים נוכחיים מפנים אליהן — לא כל התוכניות בגאוגרפיה', 'the plans PROPX holds for the geography: the renewal complexes\' plans (exact join) and the plans current tenders reference — not every plan in the geography'),
    renewalPlans: { plans: rPlans.length, complexes: cx.length, complexesJoined: rJoined, byStage: stageTable(rPlans, (p) => p.stage, (p) => XU.unitsOfStored(p)), unitsBasis: UNITS_BASIS,
      join: bi('מספר התוכנית שמשב״ש מדפיס, ואז מזהה מבא״ת בקישור של משב״ש — לעולם לא לפי שם או גאומטריה', 'the plan number MoCH prints, then the Mavat id in MoCH\'s own link — never by name or geometry'), source: 'iplan:xplan:renewal' },
    tenderPlans: { plans: tPlans.length, tenders: current.length, planReferences: planStatus, byStage: stageTable(tPlans, (x) => x.stage, (x) => x.units), unitsBasis: UNITS_BASIS,
      join: bi('מספר תוכנית מדויק מתיק המגרש של רמ״י; כל תוכנית פעם אחת גם אם כמה מכרזים מפנים אליה', 'exact plan number from the ILA lot file; each plan once however many tenders reference it'), source: 'iplan:xplan' },
    overlap: { plans: overlap, note: bi('תוכניות שמופיעות בשתי הרשימות — אותה תוכנית, שתי דרכים אליה; לא מחוברות', 'plans in both lists — the same plan reached two ways; not added') },
    stateLandInventory: { cls: 'OFFICIAL', source: 'datagov:rmi:planning-inventory', stale: true, asOf: invMeta ? day(invMeta.sourceUpdatedAt) : null, plans: inv.length, potentialUnits: sumOf(inv, (p) => p.potentialUnits),
      byStage: [...invStages.values()].sort((a, b) => (b.potentialUnits.sum || 0) - (a.potentialUnits.sum || 0)),
      basis: bi('פוטנציאל יח״ד לשיווק על קרקע מדינה בלבד, כפי שרמ״י פרסמה ב-17.02.2022 — ישן; לא כל הקרקע למגורים', 'potential units for marketing on STATE LAND ONLY as the ILA published on 2022-02-17 — STALE; not all residential land') },
    limitations: [
      bi('רק תוכניות שהצטרפו במפתח מדויק — תוכניות שלא הועברו למערכת המקוונת אינן בשכבה', 'only plans joined by an exact key — plans never moved to the online system are not in the layer'),
      bi('שטח תוכנית רחב בדרך כלל ממגרש או ממתחם: יח״ד של התוכנית אינן יח״ד של המגרש', 'a plan\'s area is usually wider than one lot or complex: the plan\'s units are not the lot\'s'),
      bi('תוכנית שרק מסדרת מצב מאושר — תוספת 0: סה״כ אחרי התוכנית אינו היצע חדש', 'a plan that only re-arranges an approved state has delta 0: units after the plan are not new supply'),
      bi('אישור תכנוני אינו היתר ואינו בנייה', 'planning approval is not a permit and not construction'),
    ] };

  /* ---- 2 · land: the same KPI function over the live records in the geography, current scope */
  const K = LQ.kpis(current, f, C);
  const resAwarded = resLive.filter((r) => r.lifecycle === 'awarded');
  U.land = { cls: 'OFFICIAL', source: 'rmi:michrazim', scope: bi('היקף נוכחי: כל מכרז שעדיין בתהליך וכל החלטה של 24 החודשים האחרונים; מסלולי מגורים לספירת יח״ד', 'current scope: every tender still in play and every decision of the last 24 months; residential tracks for the unit counts'),
    byLocalities: geo.level === 'district', basis: geo.level === 'district' ? bi('אותה פונקציית KPI על הרשומות החיות של יישובי המחוז — לא נתון ארצי', 'the same KPI function over the live records of the district\'s localities — never a national fallback') : bi('אותה פונקציית KPI של מודל הקרקע (lib/land/query kpis)', 'the land read model\'s own KPI function (lib/land/query kpis)'),
    kpis: { tenders: K.tenders, residentialTenders: K.residentialTenders, localities: K.cities,
      lifecycle: { published: K.published, open: K.open, closed: K.closed, lotteryPending: K.lotteryPending, decided: K.decided, awarded: K.awarded, frozen: K.frozen, cancelled: K.cancelled, decidedWithoutDetail: K.decidedWithoutDetail },
      unitsOpen: K.unitsOpen, unitsPendingDecision: K.unitsPendingDecision, unitsAwarded: K.unitsAwarded, unitsFailed: K.unitsFailed, unitsDecidedNotRead: K.unitsDecidedNotRead, unitsPublishedResidential: K.unitsResidential,
      unique: K.unique ? { lots: K.unique.lots, units: K.unique.units, byLatestStage: K.unique.byLatestStage, tendersNotDeduplicable: K.unique.tendersNotDeduplicable, basis: K.unique.basis } : null,
      detailCoverage: K.detailCoverage,
      unitsMeaning: bi('ארבע משמעויות של יח״ד שלעולם אינן מחוברות: פתוחות (פורסם / פתוח) · ממתינות להחלטה (נסגר / ממתין להגרלה) · שנזכו (מגרשים עם זוכה רשום) · שנכשלו (בוטל / הוקפא / ללא זוכה); "נדון, פרטים לא נקראו" בנפרד; הצנרת הייחודית סופרת מגרש פעם אחת לפי תיק', 'four meanings of units, never added: open (published / open) · pending decision (closed / awaiting lottery) · awarded (lots with a recorded winner) · failed (cancelled / frozen / no award); "decided, detail not read" apart; the unique pipeline counts a lot once by its file id') },
    momentum: {
      published: momentum(resLive, { dateOf: (r) => r.publishedDate, unitsOf: (r) => r.units, W, coveredFrom: landCov.publishedFrom || null, coveredTo: landCov.publishedTo || null, what: bi('מכרזים', 'tenders') }),
      awarded: momentum(resAwarded, { dateOf: decisionDate, unitsOf: (r) => (r.economics ? r.economics.awardedUnits : null), W, coveredFrom: landCov.committeeFrom || null, coveredTo: landCov.committeeTo || null, what: bi('מכרזים', 'tenders') }),
      basis: bi('פורסם = יח״ד שפורסמו למכרז (מסלולי מגורים) לפי תאריך הפרסום; נזכה = יח״ד של מגרשים עם זוכה רשום לפי תאריך ההחלטה (ועדה / הגרלה / סגירה); כל הרשומות החיות, לא רק ההיקף הנוכחי', 'published = units published to tender (residential tracks) by publication date; awarded = units of lots with a recorded winner by decision date (committee / lottery / close); every live record, not only the current scope') },
    freshness: { checkedAt: landMeta.checkedAt || null, snapshotFetchedAt: landMeta.snapshotFetchedAt || null, latestPublished: landCov.publishedTo || null, detailCoverage: C.coverage ? { pct: C.coverage.pct, state: C.coverage.state } : null } };
  fresh('land', bi('מכרזי רמ״י', 'ILA tenders'), landCov.publishedTo, day(landMeta.snapshotFetchedAt), landMeta.checkedAt, null);

  /* ---- 3 · renewal: the Ministry's complexes in the geography */
  const rMeta = R.meta || {}, rCov = rMeta.coverage || {};
  const declared = cx.filter((c) => c.declaration === 'declared');
  U.renewal = { cls: 'OFFICIAL', source: 'datagov:moch:urban-renewal', scope: bi('מתחמי ההתחדשות של משב״ש (מסלול רשויות ומיסוי) ביישובי הגאוגרפיה, כפי שפורסמו', 'MoCH renewal complexes (municipal and tax tracks) in the geography\'s localities, as published'),
    complexes: cx.length, declared: declared.length, declaration: { declared: declared.length, 'not-yet-declared': cx.filter((c) => c.declaration === 'not-yet-declared').length, 'not-stated': cx.filter((c) => c.declaration === 'not-stated').length },
    byStage: RENEWAL_STAGES.concat(['unknown']).map((stage) => { const rs = cx.filter((c) => c.stage === stage); return rs.length ? { stage, complexes: rs.length, proposedUnits: sumOf(rs, (c) => c.proposedUnits), existingUnits: sumOf(rs, (c) => c.existingUnits), additionalUnits: sumOf(rs, (c) => c.additionalUnits) } : null; }).filter(Boolean),
    proposedUnits: sumOf(cx, (c) => c.proposedUnits), existingUnits: sumOf(cx, (c) => c.existingUnits),
    additionalUnits: { ...sumOf(cx, (c) => c.additionalUnits), note: bi('תוספת ≠ נטו: עמודת התוספת של משב״ש שווה למוצע − קיים רק בחלק מהשורות (unitsAddUp)', 'additional ≠ net: MoCH\'s additional column equals proposed − existing in only part of the rows (unitsAddUp)') },
    unitsAddUp: { yes: cx.filter((c) => c.unitsAddUp === true).length, no: cx.filter((c) => c.unitsAddUp === false).length },
    planningJoin: { exact: rJoined, unmatched: cx.length - rJoined, plans: rPlans.length, note: bi('התוכניות עצמן נספרות ביקום התכנון', 'the plans themselves are counted in the planning universe') },
    momentum: {
      declarations: momentum(cx, { dateOf: (c) => c.declarationDate, W, minCount: 3, coveredFrom: rCov.declarationFrom || null, coveredTo: day(rMeta.sourceUpdatedAt), what: bi('מתחמים', 'complexes') }),
      declaredProposedUnits: momentum(cx, { dateOf: (c) => c.declarationDate, unitsOf: (c) => c.proposedUnits, W, minCount: 3, minUnits: 100, coveredFrom: rCov.declarationFrom || null, coveredTo: day(rMeta.sourceUpdatedAt), what: bi('מתחמים', 'complexes') }),
      basis: bi('לפי תאריך ההכרזה של משב״ש; המקור מכסה עד תאריך הפרסום שלו', 'by MoCH\'s declaration date; the source covers up to its own publication date') },
    basis: bi('סכום יח״ד רק על המתחמים שמפרסמים את העמודה (of); מתחם מוכרז אינו בנייה; הסטטוס הוא של משב״ש', 'a unit sum only over the complexes that publish that column (of); a declared complex is not construction; the status is the Ministry\'s'),
    freshness: { checkedAt: rMeta.checkedAt || null, sourceUpdatedAt: rMeta.sourceUpdatedAt || null, declarationTo: rCov.declarationTo || null } };
  fresh('renewal', bi('התחדשות עירונית · משב״ש', 'urban renewal · MoCH'), rCov.declarationTo, day(rMeta.sourceUpdatedAt), rMeta.checkedAt, null);
  const pMeta = (R.planning && R.planning.meta) || {};
  const planUpd = (ps) => maxD(ps.map((p) => p.lastUpdate));
  fresh('planning', bi('תוכניות · מינהל התכנון (XPlan)', 'plans · Planning Administration (XPlan)'), planUpd(rPlans.concat(tPlans.map((x) => x.plan))), planUpd(((R.planning && R.planning.plans) || []).concat(C.plans.xplan || [])), pMeta.checkedAt, pMeta.status || null);
  if (invMeta) fresh('inventory', bi('מלאי תכנוני · רמ״י (קרקע מדינה)', 'planning inventory · ILA (state land)'), day(invMeta.sourceUpdatedAt), day(invMeta.sourceUpdatedAt), invMeta.fetchedAt, 'STALE');

  /* ---- 4 · rental: the ILA rental track + Dira Lehaskir's stated terms (locality / national: the read model; district: its rows over the localities) */
  const rp = new URLSearchParams({ scope: 'current', period: 'all', track: 'rental' }); if (geo.level === 'locality') rp.set('city', geo.code);
  const rq = RQ.summary(LQ.parseFilters(rp, new Date(now)).filters);
  const rowsG = geo.level === 'district' ? (rq.rows || []).filter((x) => inGeo(x.localityCode)) : null;
  U.rental = { cls: 'OFFICIAL', source: 'rmi:michrazim · dira-lehaskir:wp', scope: bi('מסלול ההשכרה של רמ״י (סוג 6 או ייעוד 20/21), היקף נוכחי', 'the ILA rental track (type 6 or purpose 20 / 21), current scope'),
    tenders: rowsG ? rowsG.length : rq.pipeline.tenders, tenderUnits: rowsG ? sumOrNull(rowsG.map((x) => x.tenderUnits)) : rq.pipeline.tenderUnits,
    tenderUnitsLabel: bi('סך יח״ד של המכרזים (YechidotDiur) — לא יח״ד להשכרה: מכרז השכרה יכול גם למכור', 'TOTAL units of the tenders (YechidotDiur) — not rental units: a rental-track tender may also sell'),
    lifecycle: rowsG ? null : rq.pipeline.lifecycle, awarded: rowsG ? rowsG.filter((x) => x.lifecycle === 'awarded').length : rq.pipeline.awarded,
    rentalUnitsStated: rowsG ? null : rq.terms.rentalUnitsStated, tenderUnitsOfStated: rowsG ? null : rq.terms.tenderUnitsOfStated, withNotice: rowsG ? rowsG.filter((x) => x.dira).length : rq.terms.withNotice, comparable: rowsG ? null : rq.terms.comparable,
    byLocalities: geo.level === 'district',
    basis: bi('יח״ד של מכרז = סך המכרז; יח״ד להשכרה רק כפי שדירה להשכיר כתבה, ורק על אותם מכרזים משני הצדדים (ברמת יישוב / ארצי); מדד שכר הדירה = רף שוק כללי, לא שכר דירה של פרויקט', 'tender units = the tender total; rental units only as Dira Lehaskir wrote them, over the same tenders on both sides (locality / national only); the rent index = a general market benchmark, not a project rent'),
    freshness: rq.freshness };
  if (geo.level === 'district') miss('rental-stated', 'יח״ד להשכרה כפי שנכתבו: מחושב ברמת יישוב / ארצי בלבד (אותם מכרזים משני הצדדים)', 'stated rental units: computed at locality / national level only (the same tenders on both sides)');
  const RL = RQ.load();
  fresh('rental', bi('דירה להשכיר · הודעות מכרז', 'Dira Lehaskir · tender notices'), day(maxD((RL.dev || []).map((x) => x.modified))), day(maxD((RL.dev || []).map((x) => x.published))), rq.freshness && rq.freshness.dira ? (rq.freshness.dira.lastRun ? rq.freshness.dira.lastRun.at : rq.freshness.dira.fetchedAt) : null, rq.freshness && rq.freshness.dira && rq.freshness.dira.lastRun ? rq.freshness.dira.lastRun.state : null);

  /* ---- 5 · lotteries: MoCH first lotteries in the geography + the registry's projects by furthest evidenced stage */
  const hMeta = H.meta || {}, hCov = hMeta.coverage || {};
  const lots = H.lotteries.filter((l) => inGeo(l.localityCode)), first = lots.filter((l) => l.lotteryType === 'first');
  const projects = E.R.projects.filter((p) => inGeo(p.localityCode));
  const firstMom = momentum(first, { dateOf: (l) => l.lotteryDate, unitsOf: (l) => l.unitsInLottery, W, minCount: 3, minUnits: 100, coveredFrom: hCov.lotteryDateFrom || null, coveredTo: hCov.lotteryDateTo || null, what: bi('הגרלות', 'lotteries') });
  U.lotteries = { cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries', scope: bi('הגרלות דירה בהנחה / מחיר מטרה ביישובי הגאוגרפיה, כל ההיסטוריה שבמקור', 'Dira Behanacha / Mechir Matara lotteries in the geography\'s localities, the whole source history'),
    lotteries: lots.length, firstLotteries: first.length, projects: new Set(lots.map((l) => l.projectId).filter((x) => x != null)).size,
    unitsFirstLotteries: sumOf(first, (l) => l.unitsInLottery), firstLotteryUnits: firstMom,
    projectsByStage: PROJECT_STAGES.concat(['no-evidence']).map((stage) => { const n = projects.filter((p) => (p.stage && p.stage.furthest) === (stage === 'no-evidence' ? null : stage)).length; return n ? { stage, projects: n } : null; }).filter(Boolean),
    projectStageBasis: bi('השלב הרחוק ביותר שיש לו ראיה ישירה (lib/entities): שווק = הגרלה ראשונה; היתר = היתר מלא / מלא-חלקי; אוכלס = אחרי אכלוס; שלב מוקדם יכול פשוט להיות ללא ראיה', 'the furthest stage with direct evidence (lib/entities): marketed = first lottery; permitted = full / full-partial permit; occupied = post-occupancy; an earlier stage may simply lack evidence'),
    basis: bi('יח״ד בהגרלות ראשונות בלבד (המשך מציע מחדש אותן דירות); הרשמות אינן אנשים; זוכים אינם קונים; חלון אחרי ההגרלה האחרונה במקור = חסר, לא 0', 'units in FIRST lotteries only (a continuation re-offers the same homes); registrations are not people; winners are not buyers; a window after the source\'s newest lottery is null, never 0'),
    freshness: { checkedAt: hMeta.checkedAt || null, sourceUpdatedAt: hMeta.sourceUpdatedAt || null, lotteryDateTo: hCov.lotteryDateTo || null } };
  fresh('housing', bi('הגרלות דיור מסובסד · משב״ש', 'subsidized-housing lotteries · MoCH'), hCov.lotteryDateTo, day(hMeta.sourceUpdatedAt), hMeta.checkedAt, null);
  if (firstMom.coverage.last12 === 'none') miss('lotteries-window', `הגרלות: ההגרלה האחרונה במקור היא ${hCov.lotteryDateTo || '—'} — 12 החודשים האחרונים אינם מכוסים (חסר, לא 0)`, `lotteries: the source's newest lottery is ${hCov.lotteryDateTo || '—'} — the last 12 months are not covered (null, not 0)`);

  /* ---- 6 · construction: MoCH progress rows joined to awarded lots by exact block + parcel (every live awarded tender in the geography) */
  const links = [];
  for (const r of liveGeo) if (r.lifecycle === 'awarded' && r.construction && Array.isArray(r.construction.links)) for (const l of r.construction.links) links.push({ tender: r.id, ...l });
  const started = links.filter((l) => l.stages && (l.stages.excavation || l.stages.foundations)), completed = links.filter((l) => l.stages && (l.stages.completion || l.stages['form-4']));
  const consMeta = (landMeta.construction && landMeta.construction.source) || {};
  U.construction = { cls: 'OFFICIAL', source: 'datagov:moch:construction-progress', stale: true, asOf: maxD(links.map((l) => l.asOf)) || '2024-03-01',
    scope: bi('כל מכרז שנזכה ברשימה החיה של הגאוגרפיה (לא רק ההיקף הנוכחי) — דיווחי ההתקדמות נעצרים ב-01.03.2024', 'every awarded tender in the geography\'s live list (not only the current scope) — the progress reports stop at 2024-03-01'),
    tenders: new Set(links.map((l) => l.tender)).size, lots: new Set(links.map((l) => l.tender + '|' + l.lotId)).size, buildings: links.length, units: sumOf(links, (l) => l.units),
    started: started.length, completed: completed.length, firstStart: started.map((l) => l.stages.excavation || l.stages.foundations).sort()[0] || null, lastCompletion: maxD(completed.map((l) => l.stages.completion || l.stages['form-4'])),
    basis: bi('צירוף גוש/חלקה מדויק למגרשים שנזכו בלבד; התחלה = חפירה או יסודות; גמר = גמר או טופס 4; מבנה = שורת דיווח; ישן', 'exact block/parcel joins to awarded lots only; started = excavation or foundations; completed = completion or form 4; a building = one progress row; STALE'),
    limitations: [bi('רק מגרשים עם גוש/חלקה בתיק המגרש ושורה תואמת בדיווחים — לא כל הבנייה בגאוגרפיה', 'only lots with a block/parcel in the lot file and a matching progress row — not all construction in the geography'),
      bi('המקור אינו מתעדכן מאז 01.03.2024', 'the source has not been updated since 2024-03-01')] };
  fresh('construction', bi('התקדמות בנייה · משב״ש', 'construction progress · MoCH'), U.construction.asOf, day(consMeta.sourceUpdatedAt), landMeta.checkedAt, 'STALE');

  /* ---- official sales: national or the district series (never a locality figure) — only for the pressure indicator and freshness */
  const dk = geo.level === 'il' ? 'il' : geo.district && DISTRICTS[geo.district] ? DISTRICTS[geo.district].cbs : null;
  const g = cbs && cbs.geos && dk && cbs.geos[dk] && cbs.geos[dk].metrics && cbs.geos[dk].metrics.ok ? cbs.geos[dk] : null;
  const M = g ? g.metrics : null;
  if (cbs) fresh('sales', bi('מכירות דירות חדשות · למ״ס', 'new-home sales · CBS'), M ? M.latest : cbs.geos && cbs.geos.il && cbs.geos.il.metrics ? cbs.geos.il.metrics.latest : null, cbs.sourceUpdate, cbs.checkedAt, cbs.freshness && cbs.freshness.state);

  /* ---- indicators: DERIVED, each explainable; null when inputs are missing or the sample is small */
  const indicators = [];
  const ind = (id, label, value, unit, formula, inputs, period, limitations, reason = null) => indicators.push({ id, label, value, unit, cls: 'DERIVED', formula, inputs, period, limitations, reason });
  const win12 = bi(`12 החודשים האחרונים (${W.last12.from} → ${W.last12.to}) מול 12 הקודמים (${W.prior12.from} → ${W.prior12.to})`, `last 12 months (${W.last12.from} → ${W.last12.to}) vs the prior 12 (${W.prior12.from} → ${W.prior12.to})`);
  const momInputs = (m) => ({ last12: m.last12, prior12: m.prior12, count: m.count, small: m.small, coverage: m.coverage, window: m.window });
  const smallReason = (m, what) => (m.coverage.last12 === 'none' || m.coverage.prior12 === 'none' ? bi('המקור אינו מכסה את החלון', 'the source does not cover the window') : m.small ? bi(`מדגם קטן בחלון הקודם (${what.he})`, `small sample in the prior window (${what.en})`) : m.prior12 === 0 ? bi('אין בסיס בחלון הקודם (0)', 'no base in the prior window (0)') : null);

  /* planning momentum: plan units whose plan was approved in the window — the plans PROPX holds for the geography, each once */
  const allPlans = new Map();
  for (const p of rPlans) { const k = key(p.planKey || p.planNumber); const a = PL.approvalRef(p); allPlans.set(k, { key: k, stage: p.stage, approvalDate: a.date, dateBasis: a.basis, units: XU.unitsOfStored(p), store: 'renewal' }); }
  for (const x of tPlans) if (!allPlans.has(x.key)) allPlans.set(x.key, { key: x.key, stage: x.stage, approvalDate: x.stage === 'APPROVED' || x.stage === 'EFFECTIVE' ? x.plan.approvalDate || null : null, dateBasis: x.plan.approvalDate ? 'approvalDate (pl_date_8, gazette publication)' : null, units: x.units, store: 'land' });
  const plansAll = [...allPlans.values()], approvedPlans = plansAll.filter((p) => p.stage === 'APPROVED' || p.stage === 'EFFECTIVE'), datedPlans = approvedPlans.filter((p) => p.approvalDate);
  const landPlansFetched = day(maxD((C.plans.xplan || []).map((p) => p.provenance && p.provenance.fetchedAt)));
  const planCovTo = [landPlansFetched, day(pMeta.checkedAt)].filter(Boolean).sort()[0] || null;
  const pm = datedPlans.length ? momentum(datedPlans, { dateOf: (p) => p.approvalDate, unitsOf: (p) => p.units.planUnitDelta, W, minCount: 3, minUnits: 100, coveredTo: planCovTo, what: bi('תוכניות', 'plans') }) : null;
  const pmAfter = datedPlans.length ? momentum(datedPlans, { dateOf: (p) => p.approvalDate, unitsOf: (p) => p.units.unitsAfterPlan, W, minCount: 3, minUnits: 100, coveredTo: planCovTo, what: bi('תוכניות', 'plans') }) : null;
  ind('planning-momentum', bi('מומנטום תכנוני', 'planning momentum'), pm ? pm.pct : null, '%',
    bi('Σ תוספת יח״ד (quantity_delta_120) של תוכניות שאושרו ב-12 החודשים האחרונים מול 12 הקודמים: (אחרונים − קודמים) ÷ קודמים × 100', 'Σ plan unit delta (quantity_delta_120) of plans approved in the last 12 months vs the prior 12: (last − prior) ÷ prior × 100'),
    { plans: plansAll.length, approvedOrEffective: approvedPlans.length, dated: datedPlans.length, planUnitDelta: pm ? momInputs(pm) : null, unitsAfterPlan: pmAfter ? { last12: pmAfter.last12, prior12: pmAfter.prior12, pct: pmAfter.pct } : null,
      dateBasis: bi('תאריכי השכבה עצמה: תוכניות המתחמים — תאריך פרסום ברשומות (pl_date_8) של תוכנית בתוקף, אחרת תאריך דיון באישור (pl_date7); תוכניות המכרזים — תאריך פרסום ברשומות (pl_date_8) בלבד; תוכנית מאושרת ללא תאריך אינה נספרת', 'the layer\'s own dates: renewal plans — the gazette date (pl_date_8) of an effective plan, else the approval hearing date (pl_date7); tender plans — the gazette date (pl_date_8) only; an approved plan without a date is not counted'), datedBy: { renewal: datedPlans.filter((p) => p.store === 'renewal').length, land: datedPlans.filter((p) => p.store === 'land').length } },
    win12, [bi('רק התוכניות שPROPX מחזיקה לגאוגרפיה (מתחמי התחדשות ומכרזים נוכחיים) — לא כל אישורי התכנון בה', 'only the plans PROPX holds for the geography (renewal complexes and current tenders) — not every planning approval in it'),
      bi('תוספת יכולה להיות 0 או שלילית; סה״כ אחרי התוכנית מוצג בנפרד', 'the delta may be 0 or negative; units after the plan are shown apart'), bi('אין מעברי שלב מתוארכים מעבר לתאריכי השכבה: היסטוריית השלבים של PROPX מתחילה ב-13.10.2026', 'no dated stage transitions beyond the layer\'s own dates: PROPX\'s stage history starts on 2026-10-13')],
    !datedPlans.length ? bi('אין תוכניות מאושרות מתוארכות בגאוגרפיה', 'no dated approved plans in the geography') : smallReason(pm, bi('פחות מ-3 תוכניות או מ-100 יח״ד', 'fewer than 3 plans or 100 units')));
  const LM = U.land.momentum;
  ind('land-marketing-momentum', bi('מומנטום שיווק קרקע', 'land-marketing momentum'), LM.published.pct, '%',
    bi('Σ יח״ד שפורסמו למכרז (מסלולי מגורים) ב-12 החודשים האחרונים מול 12 הקודמים: (אחרונים − קודמים) ÷ קודמים × 100', 'Σ units published to tender (residential tracks) in the last 12 months vs the prior 12: (last − prior) ÷ prior × 100'),
    momInputs(LM.published), win12, [bi('קרקע מדינה בלבד; יח״ד שפורסמו אינן יח״ד שנמכרו או שנבנו; מכרז שפורסם מחדש נספר שוב', 'state land only; published units are not sold or built units; a re-tendered lot counts again')], smallReason(LM.published, bi('פחות מ-3 מכרזים או מ-100 יח״ד', 'fewer than 3 tenders or 100 units')));
  ind('tender-award-momentum', bi('מומנטום זכיות במכרזים', 'tender-award momentum'), LM.awarded.pct, '%',
    bi('Σ יח״ד של מגרשים עם זוכה רשום לפי תאריך ההחלטה, 12 החודשים האחרונים מול 12 הקודמים: (אחרונים − קודמים) ÷ קודמים × 100', 'Σ units of lots with a recorded winner by decision date, last 12 months vs the prior 12: (last − prior) ÷ prior × 100'),
    momInputs(LM.awarded), win12, [bi('זכייה אינה חוזה, היתר או בנייה; רק מכרזים שפרטיהם נקראו', 'an award is not a contract, a permit or construction; detail-read tenders only')], smallReason(LM.awarded, bi('פחות מ-3 מכרזים או מ-100 יח״ד', 'fewer than 3 tenders or 100 units')));
  const RM = U.renewal.momentum.declarations;
  ind('renewal-declaration-momentum', bi('מומנטום הכרזות התחדשות', 'renewal-declaration momentum'), RM.pct, '%',
    bi('מתחמים שהוכרזו ב-12 החודשים האחרונים מול 12 הקודמים: (אחרונים − קודמים) ÷ קודמים × 100', 'complexes declared in the last 12 months vs the prior 12: (last − prior) ÷ prior × 100'),
    { ...momInputs(RM), proposedUnits: { last12: U.renewal.momentum.declaredProposedUnits.last12, prior12: U.renewal.momentum.declaredProposedUnits.prior12, pct: U.renewal.momentum.declaredProposedUnits.pct, small: U.renewal.momentum.declaredProposedUnits.small } }, win12,
    [bi('הכרזה אינה אישור, היתר או בנייה; המקור מכסה עד תאריך הפרסום שלו', 'a declaration is not an approval, a permit or construction; the source covers up to its publication date')], smallReason(RM, bi('פחות מ-3 מתחמים', 'fewer than 3 complexes')));
  ind('lottery-momentum', bi('מומנטום הגרלות', 'lottery momentum'), firstMom.pct, '%',
    bi('Σ יח״ד בהגרלות ראשונות ב-12 החודשים האחרונים מול 12 הקודמים: (אחרונים − קודמים) ÷ קודמים × 100', 'Σ units in first lotteries in the last 12 months vs the prior 12: (last − prior) ÷ prior × 100'),
    momInputs(firstMom), win12, [bi('הגרלות ראשונות בלבד; חלון אחרי ההגרלה האחרונה במקור = חסר', 'first lotteries only; a window after the source\'s newest lottery is null')], smallReason(firstMom, bi('פחות מ-3 הגרלות או מ-100 יח״ד', 'fewer than 3 lotteries or 100 units')));
  /* supply pressure — national / district only: awarded residential units of the last 24 months ÷ the official monthly sales pace */
  const awarded24 = resAwarded.filter((r) => inWin(decisionDate(r), W.last24));
  const unitsAwarded24 = awarded24.length ? sumOrNull(awarded24.map((r) => (r.economics ? r.economics.awardedUnits : null))) : 0;
  const t12 = M && M.t12 && M.t12.ok ? M.t12.value : null, salesSmall = M ? !!M.small : null;
  const pace = t12 != null ? t12 / 12 : null;
  const pressure = geo.level !== 'locality' && pace && !salesSmall && unitsAwarded24 != null ? round1(unitsAwarded24 / pace) : null;
  ind('supply-pressure', bi('לחץ היצע — חודשי קרקע מדינה שנזכתה', 'supply pressure — months of awarded state land'), pressure, 'months',
    bi('יח״ד מגורים שנזכו ב-24 החודשים האחרונים ÷ (מכירות דירות חדשות רשמיות ב-12 החודשים האחרונים ÷ 12) = חודשי קרקע מדינה שנזכתה בקצב המכירות הרשמי הנוכחי', 'residential units awarded in the last 24 months ÷ (official new-home sales of the last 12 months ÷ 12) = months of awarded state land at the current official sales pace'),
    { unitsAwarded24: unitsAwarded24, awardedTenders24: awarded24.length, salesT12: t12, salesPeriod: M && M.t12 ? M.t12.label : null, salesScope: g ? (g.level === 'district' ? bi(`${g.name.he} — סדרת המחוז`, `${g.name.en} — the district series`) : bi('ארצי', 'national')) : null, salesSmall, monthlyPace: pace != null ? round1(pace) : null, window: { awarded: W.last24, sales: M && M.t12 ? { from: M.t12.from, to: M.t12.to } : null } },
    bi(`זכיות ${W.last24.from} → ${W.last24.to}; מכירות ${M && M.t12 ? M.t12.from + ' → ' + M.t12.to : '—'}`, `awards ${W.last24.from} → ${W.last24.to}; sales ${M && M.t12 ? M.t12.from + ' → ' + M.t12.to : '—'}`),
    [bi('קרקע מדינה בלבד — לא כל ההיצע', 'state land only — not all supply'), bi('נזכה ≠ נבנה: יח״ד שנזכו הן קיבולת מגרש', 'awarded ≠ built: awarded units are lot capacity'), bi('שני יקומים שונים (מכרזים מול מכירות) — יחס, לא מלאי', 'two different universes (tenders vs sales) — a ratio, not an inventory'), bi('ארצי / מחוזי בלבד: אין סדרת מכירות רשמית ליישוב', 'national / district only: no official locality sales series')],
    geo.level === 'locality' ? bi('אין סדרת מכירות רשמית ליישוב', 'no official locality sales series') : !M ? bi('סדרת המכירות של הלמ״ס לא נטענה לגאוגרפיה', 'the CBS sales series is not loaded for the geography') : salesSmall ? bi('מדגם מכירות קטן', 'small sales sample') : unitsAwarded24 == null ? bi('יח״ד שנזכו לא פורסמו', 'awarded units not published') : null);

  /* ---- what is missing */
  miss('permits', 'היתרים, התחלות בנייה וגמר לפי יישוב: אין מקור רשמי קריא למכונה שהצטרף — רק דיווחי ההתקדמות הישנים על מגרשים שנזכו', 'permits, starts and completions by locality: no joined machine-readable official source — only the stale progress reports on awarded lots');
  if (geo.level === 'locality') { miss('supply-pressure', 'לחץ היצע ברמת יישוב: אין סדרת מכירות רשמית ליישוב (הלמ״ס מפרסמת ארצי ולפי מחוז)', 'supply pressure at locality level: no official locality sales series (CBS publishes national and district)');
    miss('sales', 'מכירות דירות חדשות לפי יישוב: אין נתון רשמי', 'new-home sales by locality: no official figure'); }
  if (geo.level !== 'il') miss('inventory', 'מלאי שטרם נמכר: ארצי בלבד בסדרה הרשמית', 'unsold inventory: national only in the official series');
  miss('private-land', 'תוכניות וקרקע פרטית שאינן בהתחדשות ואינן מכרז רמ״י: אין מקור מצורף', 'private-land plans outside renewal and ILA tenders: no joined source');

  const out = { schema: 1, geo, generatedAt: new Date(now).toISOString(), today, windows: { last12: W.last12, prior12: W.prior12, last24: W.last24, basis: W.basis },
    basis: bi('יקומי היצע מקבילים — יח״ד בתוכניות ≠ יח״ד במכרזים ≠ יח״ד במתחמי התחדשות ≠ יח״ד בהגרלות ≠ יח״ד להשכרה ≠ מבנים בדיווחי בנייה: אותן דירות יכולות להופיע בכמה יקומים, ולכן הם לעולם אינם מחוברים לנתון צנרת אחד; כל נתון עם מקורו, סיווגו, תקופתו ובסיסו; מה שאין — חסר (null), לא 0.',
      'parallel supply universes — plan units ≠ tender units ≠ renewal complex units ≠ lottery units ≠ rental units ≠ construction buildings: the same homes can appear in several universes, so they are never added together into one pipeline figure; every figure with its source, class, period and basis; what is unknown is null, never 0.'),
    universes: U, indicators, freshness, missing, universeOrder: UNIVERSES.map((u) => u.id) };
  MEMO.set(memoKey, out);
  return out;
}

module.exports = { supply, UNIVERSES, momentum, windowsOf, resolveGeo };
