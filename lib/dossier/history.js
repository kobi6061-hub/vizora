// PROPX · Market Dossier HISTORY / time machine (18.10.2026) — "what changed since <date>".
//
// A SNAPSHOT is a PROPX read on one day: for every geography the dossier describes (Israel, the seven districts, every
// locality in the Opportunity / Risk scan — `D.index({ limit: Infinity })` ∪ the scan's geographies) the decision-relevant
// FACTS the dossier already holds — each with its value, class, source and period, taken from the dossier sections as they
// are (no new computation, no estimate; a missing value is null with the dossier's own reason, never 0) — plus the signal
// ids that fired, the Radar 2.0 state (signalState · stateReason · tracked) and the evidence quality. One compact file per
// day under data/dossier/snapshots/<YYYY-MM-DD>.json, APPEND-ONLY: a day that exists is never rewritten, nothing is deleted.
// A DIFF between two snapshots lists what changed per fact (NEW · CHANGED · REMOVED · STATE, with the radar verbs of
// lib/radar/verbs.js where they fit) — a difference between two PROPX reads is DERIVED, never an event the source reported,
// never a verdict. A geography a snapshot does not cover is "not covered on <date>"; no baseline → NO_SNAPSHOT, never a
// fabricated one.
//
//   snapshotOf(dossier, scanGeo)                       → one geography's record (pure)
//   build({ dataDir, now, localities })                → the packed day file (pure given the data directory and `now`)
//   write({ dataDir, now, outDir, localities })        → writes the day file + index.json, or { status: 'UNCHANGED' } if the day exists
//   dates() · at(date) · latestBefore(date) · snapshots()
//   diff({ level, code, since, until })                → the changes of one geography between two PROPX reads
//   GET /api/intel?view=dossierHistory&city=|district=&since=YYYY-MM-DD[&until=]   ·   view=dossierSnapshots
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('./query');
const SCAN = require('../radar/scan');
const VERBS = require('../radar/verbs');

const ROOT = path.join(__dirname, '..', '..', 'data');
const SCHEMA = 1;
const GENERATOR = 'lib/dossier/history.js';
const bi = (he, en) => ({ he, en });
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const num = (v) => (Number.isFinite(v) ? v : null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const snapDir = (dataDir) => path.join(dataDir, 'dossier', 'snapshots');
const LEVELS = ['il', 'district', 'locality'];
const ALL = LEVELS;

const BASIS = bi('תמונת מצב = קריאה של PROPX ביום הזה — לא תאריך פרסום של מקור; כל עובדה נלקחת מסעיפי התיק כפי שהם, עם מקורה, סיווגה ותקופתה; ערך חסר = null עם הסיבה (לעולם לא 0). ההבדל בין שתי קריאות של PROPX הוא נגזר (DERIVED) — לא אירוע שהמקור דיווח, ולא המלצה. קובץ יום שקיים לעולם אינו נכתב מחדש ואינו נמחק.',
  'A snapshot = a PROPX read on that day — not a source publication date; every fact is taken from the dossier sections as they are, with its source, class and period; a missing value = null with its reason (never 0). The difference between two PROPX reads is DERIVED — not an event the source reported, never a recommendation. A day file that exists is never rewritten or deleted.');

/* ------------------------------------------------------------ the facts (stable ids; cls / source as the dossier sections carry them) */
const SALES = { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10' }, LAND = { cls: 'OFFICIAL', source: 'rmi:michrazim' }, ECON = { cls: 'DERIVED', source: 'rmi:michrazim' };
const RENEWAL = { cls: 'OFFICIAL', source: 'datagov:moch:urban-renewal' }, HOUSING = { cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries' };
const RENTAL = { cls: 'OFFICIAL', source: 'rmi:michrazim · dira-lehaskir:wp' }, DEVS = { cls: 'OBSERVED', source: 'lib/entities (rmi:michrazim · datagov:moch)' };
const CONSTR = { cls: 'OFFICIAL', source: 'cbs:construction' }, QUAL = { cls: 'DERIVED', source: 'lib/dossier' }, RADAR = { cls: 'DERIVED', source: 'lib/radar' };
const P_MONTH = bi('החודש האחרון בסדרה', 'the latest month of the series'), P_WINDOW = bi('חלון התקופה (מ..עד)', 'the window (from..to)');
const P_CURRENT = bi('ההיקף הנוכחי של קריאת הקרקע — 24 חודשים עד יום התמונה', 'the land read model\'s current scope — 24 months to the snapshot day');
const P_SOURCE = bi('תאריך עדכון המקור של הרשומות שנקראו', 'the source update date of the records read'), P_COVER = bi('הכיסוי של הרשומות (עד)', 'the records\' coverage (to)');
const P_SNAP = bi('יום התמונה (קריאת PROPX)', 'the snapshot day (the PROPX read)'), P_PUB = bi('תאריך הפרסום של הערך', 'the value\'s publication date');
const P_ENTRIES = bi('פעילות ראשונה שנצפתה ב-24 החודשים עד יום התמונה (חלון lib/entities)', 'first observed activity in the 24 months to the snapshot day (the lib/entities window)');
const P_ECON = bi('מגרשים שנדונו ב-36 החודשים עד יום התמונה', 'lots decided in the 36 months to the snapshot day');
const P_LATEST = bi('התקופה האחרונה בסדרה (חודש / רבעון כפי שהסדרה)', 'the latest period of the series (month / quarter as the series has it)');
/** every fact: class · source · kind (count · units · pct · rate · ils · months · score · text · list) · label · what its period means · the levels it applies to */
const FACTS = Object.freeze({
  'sales.latest': { ...SALES, kind: 'count', label: bi('מכירות דירות חדשות — החודש האחרון', 'new-home sales — latest month'), period: P_MONTH, levels: ALL },
  'sales.t12': { ...SALES, kind: 'count', label: bi('מכירות דירות חדשות — 12 חודשים', 'new-home sales — trailing 12 months'), period: P_WINDOW, levels: ALL },
  'sales.momentum3m': { ...SALES, kind: 'pct', label: bi('מומנטום מכירות — 3 חודשים מול 3 הקודמים', 'sales momentum — last 3 months vs the prior 3'), period: bi('החלון הקודם→החלון הנוכחי', 'the prior window→the current window'), levels: ALL },
  'inventory.unsold': { ...SALES, kind: 'units', label: bi('מלאי דירות חדשות שטרם נמכרו (ארצי)', 'unsold new-dwelling inventory (national)'), period: P_MONTH, levels: ALL },
  'inventory.monthsSupply': { ...SALES, kind: 'months', label: bi('חודשי היצע (ארצי)', 'months of supply (national)'), period: P_MONTH, levels: ALL },
  'construction.permits': { ...CONSTR, kind: 'units', label: bi('היתרי בנייה — יח״ד, התקופה האחרונה', 'building permits — dwellings, latest period'), period: P_LATEST, levels: ALL },
  'construction.starts': { ...CONSTR, kind: 'units', label: bi('התחלות בנייה — יח״ד, התקופה האחרונה', 'construction starts — dwellings, latest period'), period: P_LATEST, levels: ALL },
  'construction.completions': { ...CONSTR, kind: 'units', label: bi('גמר בנייה — יח״ד, התקופה האחרונה', 'completions — dwellings, latest period'), period: P_LATEST, levels: ALL },
  'construction.active': { ...CONSTR, kind: 'units', label: bi('בנייה פעילה — יח״ד (מלאי בסוף התקופה)', 'active construction — dwellings (a stock at period end)'), period: P_LATEST, levels: ALL },
  'land.tenders': { ...LAND, kind: 'count', label: bi('מכרזי רמ״י נוכחיים', 'current ILA tenders'), period: P_CURRENT, levels: ALL },
  'land.published': { ...LAND, kind: 'count', label: bi('מכרזים שפורסמו (טרם נפתחו)', 'tenders published (not yet open)'), period: P_CURRENT, levels: ALL },
  'land.open': { ...LAND, kind: 'count', label: bi('מכרזים פתוחים', 'open tenders'), period: P_CURRENT, levels: ALL },
  'land.closed': { ...LAND, kind: 'count', label: bi('מכרזים שנסגרו וממתינים להחלטה', 'closed tenders awaiting a decision'), period: P_CURRENT, levels: ALL },
  'land.decided': { ...LAND, kind: 'count', label: bi('מכרזים שנדונו ללא זוכה', 'tenders decided without a winner'), period: P_CURRENT, levels: ALL },
  'land.awarded': { ...LAND, kind: 'count', label: bi('מכרזים שנזכו', 'awarded tenders'), period: P_CURRENT, levels: ALL },
  'land.frozen': { ...LAND, kind: 'count', label: bi('מכרזים מוקפאים', 'frozen tenders'), period: P_CURRENT, levels: ALL },
  'land.cancelled': { ...LAND, kind: 'count', label: bi('מכרזים שבוטלו', 'cancelled tenders'), period: P_CURRENT, levels: ALL },
  'land.unitsOpen': { ...LAND, kind: 'units', label: bi('יח״ד במכרזים פתוחים / שפורסמו', 'units in open / published tenders'), period: P_CURRENT, levels: ALL },
  'land.unitsPendingDecision': { ...LAND, kind: 'units', label: bi('יח״ד במכרזים שנסגרו וממתינים להחלטה', 'units in closed tenders awaiting a decision'), period: P_CURRENT, levels: ALL },
  'land.unitsAwarded': { ...LAND, kind: 'units', label: bi('יח״ד במגרשים שנזכו', 'units in awarded lots'), period: P_CURRENT, levels: ALL },
  'land.unitsFailed': { ...LAND, kind: 'units', label: bi('יח״ד במכרזים ללא זוכה / שבוטלו', 'units in tenders without a winner / cancelled'), period: P_CURRENT, levels: ALL },
  'land.medianPerUnit': { ...ECON, kind: 'ils', label: bi('חציון ₪ ליח״ד — מגרשי הצעה תחרותית בשוק החופשי (תמורה נומינלית, לא שווי קרקע)', 'median ₪ per unit — competitive-bid open-market lots (nominal consideration, not a land value)'), period: P_ECON, levels: ALL },
  'land.competitiveLots': { ...ECON, kind: 'count', label: bi('מגרשי הצעה תחרותית שנדונו בחלון', 'competitive-bid lots decided in the window'), period: P_ECON, levels: ALL },
  'renewal.complexes': { ...RENEWAL, kind: 'count', label: bi('מתחמי התחדשות עירונית', 'urban-renewal complexes'), period: P_SOURCE, levels: ALL },
  'renewal.proposedUnits': { ...RENEWAL, kind: 'units', label: bi('יח״ד מוצעות במתחמים (כפי שפורסם — לא בנייה)', 'proposed units in the complexes (as published — not construction)'), period: P_SOURCE, levels: ALL },
  'renewal.declared': { ...RENEWAL, kind: 'count', label: bi('מתחמים שהוכרזו', 'declared complexes'), period: P_SOURCE, levels: ALL },
  'housing.lotteries': { ...HOUSING, kind: 'count', label: bi('הגרלות דיור מסובסד', 'subsidized-housing lotteries'), period: P_COVER, levels: ALL },
  'housing.projects': { ...HOUSING, kind: 'count', label: bi('פרויקטי הגרלה', 'lottery projects'), period: P_COVER, levels: ALL },
  'housing.unitsFirst': { ...HOUSING, kind: 'units', label: bi('יח״ד בהגרלות ראשונות', 'units in first lotteries'), period: P_COVER, levels: ALL },
  'housing.applicantsPerUnit': { ...HOUSING, kind: 'rate', label: bi('מבקשים ליח״ד', 'applicants per unit'), period: P_COVER, levels: ALL },
  'rental.tenders': { ...RENTAL, kind: 'count', label: bi('מכרזי דיור להשכרה נוכחיים (מסלול רמ״י)', 'current rental-track tenders (ILA)'), period: P_CURRENT, levels: ALL },
  'rental.tenderUnits': { ...RENTAL, kind: 'units', label: bi('יח״ד במכרזי ההשכרה — סך המכרז, לא "יח״ד להשכרה"', 'units in the rental-track tenders — the tender total, not "rental units"'), period: P_CURRENT, levels: ALL },
  'developers.total': { ...DEVS, kind: 'count', label: bi('יזמים שנצפו בגאוגרפיה', 'developers observed in the geography'), period: P_SNAP, levels: ALL },
  'developers.lotsHere': { ...DEVS, kind: 'count', label: bi('מגרשים שנזכו כאן על ידי יזמים רשומים', 'lots won here by listed developers'), period: P_SNAP, levels: ALL },
  'developers.top': { ...DEVS, kind: 'list', label: bi('היזמים המובילים כאן (שם מדויק, לפי סדר התיק)', 'the leading developers here (exact name, the dossier\'s order)'), period: P_SNAP, levels: ALL },
  'developers.entries': { cls: 'DERIVED', source: 'lib/entities', kind: 'count', label: bi('כניסות יזמים (פעילות ראשונה שנצפתה)', 'developer entries (first observed activity)'), period: P_ENTRIES, levels: ALL },
  'macro.boiRate': { cls: 'OFFICIAL', source: 'boi:interest', kind: 'rate', label: bi('ריבית בנק ישראל (ארצי)', 'Bank of Israel policy rate (national)'), period: P_PUB, levels: ['il'] },
  'macro.constructionInputsYoy': { cls: 'OFFICIAL', source: 'cbs:constructionInputsIndex', kind: 'pct', label: bi('מדד תשומות הבנייה — שינוי שנתי (ארצי)', 'construction-inputs index — y/y (national)'), period: P_MONTH, levels: ['il'] },
  'macro.newHomesIndexYoy': { cls: 'OFFICIAL', source: 'cbs:price-index', kind: 'pct', label: bi('מדד מחירי דירות חדשות — שינוי שנתי (ארצי)', 'new-homes price index — y/y (national)'), period: P_MONTH, levels: ['il'] },
  'macro.dwellingsIndexYoy': { cls: 'OFFICIAL', source: 'cbs:price-index', kind: 'pct', label: bi('מדד מחירי הדירות — שינוי שנתי (רמת מחוז)', 'dwellings price index — y/y (district level)'), period: P_MONTH, levels: ['district'] },
  'quality.score': { ...QUAL, kind: 'score', label: bi('איכות ראיות — ניקוד (100 פחות ניכויים מתועדים; לא הסתברות)', 'evidence quality — score (100 minus documented deductions; not a probability)'), period: P_SNAP, levels: ALL },
  'quality.level': { ...QUAL, kind: 'text', label: bi('איכות ראיות — רמה', 'evidence quality — level'), period: P_SNAP, levels: ALL },
  'radar.tracked': { ...RADAR, kind: 'count', label: bi('רשומות במעקב ביישוב (מכרזים חיים + מתחמים + פרויקטי הגרלה + מכרזי השכרה)', 'tracked records in the locality (live tenders + complexes + lottery projects + rental tenders)'), period: P_SNAP, levels: ['locality'] },
});
const ORDER = Object.freeze(Object.fromEntries(LEVELS.map((l) => [l, Object.keys(FACTS).filter((id) => FACTS[id].levels.includes(l))])));
const NUMERIC = new Set(['count', 'units', 'pct', 'rate', 'ils', 'months', 'score']);
/* a SERIES fact's period is part of the datum (a month, a quarter, a publication): a moved period is a change — the source published a new
   period (radar verb NEW). A READ-WINDOW fact's period (the land model's 24-month scope, the economics window, the snapshot day) moves
   every day by construction and is never a change by itself. */
const DATA_PERIOD = (id) => /^(sales|inventory|construction|macro)\./.test(id);
const SMALL = { id: 'small-sample', he: 'מדגם קטן — המומנטום אינו נאמר (כלל התיק)', en: 'small sample — momentum not stated (the dossier\'s own rule)' };
const NOT_SUMMED = { id: 'district-not-summed', he: 'ברמת מחוז יח״ד ומבקשים אינם מסוכמים בין יישובים (כלל התיק)', en: 'at district level units and applicants are not summed across localities (the dossier\'s own rule)' };
const NO_LOTS = { id: 'no-lots', he: 'לא נדונו מגרשי הצעה תחרותית בשוק החופשי בחלון', en: 'no competitive-bid open-market lots decided in the window' };
const NOT_SCANNED = { id: 'not-scanned', he: 'הגאוגרפיה אינה בסריקת הרדאר של היום', en: 'the geography is not in the day\'s radar scan' };

/* ------------------------------------------------------------ one geography's record (pure) */
function snapshotOf(d, g) {
  if (!d || !d.geo || !LEVELS.includes(d.geo.level)) return null;
  const S = d.sections || {}, M = Array.isArray(d.missing) ? d.missing : [], level = d.geo.level;
  const at = d.generatedAt || null, today = at ? day(at) : null;
  const reason = (id) => { const m = M.find((x) => x.id === id); return m ? { id: m.id, he: m.he, en: m.en } : null; };
  const F = {};
  const put = (id, section, value, period, extra) => {
    const spec = FACTS[id]; if (!spec || !spec.levels.includes(level)) return;
    const v = Array.isArray(value) ? value : typeof value === 'string' ? value : num(value);
    const cls = section && section.cls && section.cls !== 'per event' ? section.cls : spec.cls, source = section && section.source ? section.source : spec.source;
    const f = { value: v, cls, source, period: period || null };
    if (extra) for (const k of ['scope', 'geoScope', 'n', 'missing']) if (extra[k] != null) f[k] = extra[k];
    if (f.value === null && !f.missing && extra && extra.fallback) f.missing = extra.fallback;
    F[id] = f;
  };
  /* official sales — the dossier's scope label verbatim (a locality carries its DISTRICT series labelled so, never relabelled) */
  const sl = S.sales || null, own = !!(sl && sl.latest != null);
  const sx = own ? { scope: sl.scope || null, geoScope: level === 'locality' ? 'district' : 'own' } : { missing: reason('sales') };
  put('sales.latest', sl, own ? sl.latestValue : null, own ? sl.latest : null, sx);
  put('sales.t12', sl, own && sl.t12 && sl.t12.ok ? sl.t12.value : null, own && sl.t12 && sl.t12.ok ? `${sl.t12.from}..${sl.t12.to}` : null, sx);
  const mo = own && sl.momentum && sl.momentum.ok && sl.momentum.now && sl.momentum.before ? sl.momentum : null;
  put('sales.momentum3m', sl, mo && !sl.small ? mo.pct : null, mo ? `${mo.before.from}..${mo.before.to}→${mo.now.from}..${mo.now.to}` : null, mo && sl.small ? { ...sx, missing: SMALL } : sx);
  /* inventory — national only; elsewhere null with the dossier's reason */
  const inv = S.inventory || null, ix = inv ? {} : { missing: reason('inventory') };
  put('inventory.unsold', inv || sl, inv ? inv.value : null, inv ? inv.period : null, ix);
  put('inventory.monthsSupply', inv || sl, inv ? inv.monthsSupply : null, inv ? inv.period : null, ix);
  /* construction (CBS 44,11 · 44,2 · 44,3 · 44,4) — the section's scope label verbatim; a measure without a value keeps its reason */
  const C = S.construction && S.construction.measures ? S.construction : null;
  for (const id of ['permits', 'starts', 'completions', 'active']) {
    const m = C ? C.measures[id] : null, L = m && m.latest && Number.isFinite(m.latest.value) ? m.latest : null;
    put('construction.' + id, C, L ? L.value : null, L ? L.period || null : null, C ? { scope: C.scope || null, geoScope: level === 'locality' ? 'district' : 'own', missing: L ? null : m && m.reason ? { id: 'construction:' + id, he: m.reason.he || String(m.reason), en: m.reason.en || String(m.reason) } : reason('construction-locality') || reason('construction') || { id: 'construction:' + id, he: 'אין תצפית', en: 'no observation' } } : { missing: reason('construction') });
  }
  /* land & tenders — the current scope window to the snapshot day */
  const K = S.land && S.land.kpis ? S.land.kpis : null, lp = S.land && S.land.scope && S.land.scope.currentFrom ? `${S.land.scope.currentFrom}..${today}` : null, lx = K ? {} : { missing: reason('land') };
  for (const [id, k] of [['land.tenders', 'tenders'], ['land.published', 'published'], ['land.open', 'open'], ['land.closed', 'closed'], ['land.decided', 'decided'], ['land.awarded', 'awarded'], ['land.frozen', 'frozen'], ['land.cancelled', 'cancelled'], ['land.unitsOpen', 'unitsOpen'], ['land.unitsPendingDecision', 'unitsPendingDecision'], ['land.unitsAwarded', 'unitsAwarded'], ['land.unitsFailed', 'unitsFailed']]) put(id, S.land, K ? K[k] : null, lp, lx);
  /* land economics — the module's own median (null below 5 lots, with its own reason) */
  const E = S.landEconomics || null, cb = E && E.competitiveBid && E.competitiveBid.current ? E.competitiveBid.current : null, ep = E && E.window ? `${E.window.from}..${E.window.to}` : null;
  const eSmall = E ? (E.missing || []).find((m) => m.id === 'small_sample') : null;
  put('land.medianPerUnit', E, cb ? cb.median : null, ep, cb ? { n: num(cb.lots), missing: cb.median == null ? (eSmall ? { id: eSmall.id, he: eSmall.he, en: eSmall.en } : cb.lots > 0 ? SMALL : NO_LOTS) : null } : { missing: reason('land-economics') });
  put('land.competitiveLots', E, cb ? cb.lots : null, ep, cb ? {} : { missing: reason('land-economics') });
  /* urban renewal — as published on the source update date */
  const R = S.renewal || null, RK = R && R.kpis ? R.kpis : null, rp = R && R.freshness && R.freshness.sourceUpdatedAt ? day(R.freshness.sourceUpdatedAt) : null, rx = RK ? {} : { missing: reason('renewal') };
  const pu = RK && RK.proposedUnits != null ? (typeof RK.proposedUnits === 'object' ? RK.proposedUnits : { sum: RK.proposedUnits, of: null }) : null;
  put('renewal.complexes', R, RK ? RK.complexes : null, rp, rx);
  put('renewal.proposedUnits', R, pu ? pu.sum : null, rp, pu ? { n: num(pu.of) } : rx);
  put('renewal.declared', R, R && R.declaration ? R.declaration.declared : null, rp, rx);
  /* subsidized housing — a district carries lottery counts only (units and applicants are not summed across localities) */
  const H = S.housing || null, HK = H && H.kpis ? H.kpis : null, hp = H && H.coverage && H.coverage.coveredTo ? H.coverage.coveredTo : null, hx = HK ? {} : { missing: reason('housing') };
  const hd = HK && HK.byLocalities ? { missing: NOT_SUMMED } : hx;
  put('housing.lotteries', H, HK ? HK.lotteries : null, hp, hx);
  put('housing.projects', H, HK ? HK.projects : null, hp, hd);
  put('housing.unitsFirst', H, HK ? HK.unitsFirst : null, hp, hd);
  put('housing.applicantsPerUnit', H, HK ? HK.applicantsPerUnit : null, hp, hd);
  /* long-term rental — the ILA rental-track pipeline (tender totals) */
  const RP = S.rental && S.rental.pipeline ? S.rental.pipeline : null, px = RP ? {} : { missing: reason('rental') };
  put('rental.tenders', S.rental, RP ? RP.tenders : null, lp, px);
  put('rental.tenderUnits', S.rental, RP ? RP.tenderUnits : null, lp, px);
  /* developers — observed activity, exact names */
  const DV = S.developers || null, dx = DV ? {} : { missing: reason('developers') };
  put('developers.total', DV, DV ? DV.total : null, today, dx);
  put('developers.lotsHere', DV, DV ? DV.lotsHereTotal : null, today, dx);
  put('developers.top', DV, DV && Array.isArray(DV.top) ? DV.top.slice(0, 5).map((x) => String(x.name)) : null, today, dx);
  put('developers.entries', null, DV && DV.entries ? DV.entries.total : null, today, dx);
  /* macro — national context, national level only; the district dwellings index at district level, labelled */
  const MK = S.macro || null, mp = (x) => (x && x.period && x.period.year ? `${x.period.year}-${String(x.period.month).padStart(2, '0')}` : null);
  put('macro.boiRate', { cls: 'OFFICIAL', source: 'boi:interest' }, MK && MK.boiRate ? MK.boiRate.value : null, MK && MK.boiRate ? day(MK.boiRate.publishedAt) : null, null);
  put('macro.constructionInputsYoy', { cls: 'OFFICIAL', source: 'cbs:constructionInputsIndex' }, MK && MK.constructionInputsIndex ? MK.constructionInputsIndex.yoy : null, MK ? mp(MK.constructionInputsIndex) : null, null);
  put('macro.newHomesIndexYoy', { cls: 'OFFICIAL', source: 'cbs:price-index' }, MK && MK.newHomesIndex ? MK.newHomesIndex.yoy : null, MK ? mp(MK.newHomesIndex) : null, null);
  put('macro.dwellingsIndexYoy', { cls: 'OFFICIAL', source: 'cbs:price-index' }, MK && MK.districtIndex ? MK.districtIndex.yoy : null, MK && MK.districtIndex ? mp(MK.districtIndex) : null, MK && MK.districtIndex ? { scope: MK.districtIndex.scope || null, geoScope: 'own' } : null);
  /* evidence quality · the radar state */
  put('quality.score', null, d.quality ? d.quality.score : null, today, null);
  put('quality.level', null, d.quality && d.quality.level ? d.quality.level : null, today, null);
  put('radar.tracked', null, g && Number.isFinite(g.tracked) ? g.tracked : null, today, g ? null : { missing: NOT_SCANNED });
  const sig = (kind) => [...new Set((d.signals || []).filter((s) => s.kind === kind).map((s) => s.id))].sort();
  return { geo: { level, code: String(d.geo.code), name: d.geo.name || null, district: d.geo.district || null }, at, facts: F, signals: { watch: sig('watch'), risk: sig('risk') },
    radar: g ? { signalState: g.signalState || null, stateReason: g.stateReason || null, tracked: Number.isFinite(g.tracked) ? g.tracked : null } : null };
}

/* ------------------------------------------------------------ the day file: packed (positional values per level, interned strings) */
function pack(records, meta) {
  const strings = [], seen = new Map();
  const intern = (v) => { if (v == null) return null; const k = JSON.stringify(v); if (seen.has(k)) return seen.get(k); seen.set(k, strings.length); strings.push(v); return strings.length - 1; };
  const geographies = records.map((r) => {
    const order = ORDER[r.geo.level], x = {};
    const v = order.map((id) => (r.facts[id] ? r.facts[id].value : null)), p = order.map((id) => (r.facts[id] ? intern(r.facts[id].period) : null));
    /* extras (scope · geoScope · n · missing · a class / source that differs from the registry) — interned as one object, keyed by the fact's index in the level's order */
    order.forEach((id, i) => { const f = r.facts[id]; if (!f) return; const e = {};
      if (f.scope) e.s = intern(f.scope); if (f.geoScope) e.g = f.geoScope; if (f.n != null) e.n = f.n; if (f.missing) e.m = intern(f.missing);
      if (f.cls !== FACTS[id].cls) e.c = f.cls; if (f.source !== FACTS[id].source) e.o = f.source;
      if (Object.keys(e).length) x[i] = intern(e); });
    const out = { level: r.geo.level, code: r.geo.code, name: r.geo.name, district: r.geo.district, v, p };
    if (Object.keys(x).length) out.x = x;
    out.signals = r.signals; out.radar = r.radar ? { signalState: r.radar.signalState, stateReason: intern(r.radar.stateReason), tracked: r.radar.tracked } : null;
    return out;
  });
  const states = {}; for (const g of geographies) if (g.radar && g.radar.signalState) states[g.radar.signalState] = states[g.radar.signalState] ? states[g.radar.signalState] + 1 : 1;   /* a tally of geographies by state — not a value */
  return { schema: SCHEMA, generator: GENERATOR, date: meta.date, at: meta.at, basis: BASIS, facts: FACTS, order: ORDER, sources: meta.sources || null, scan: meta.scan || null,
    counts: { geographies: geographies.length, byLevel: Object.fromEntries(LEVELS.map((l) => [l, geographies.filter((g) => g.level === l).length])), states }, strings, geographies };
}
function unpackOne(file, g) {
  const order = (file.order && file.order[g.level]) || ORDER[g.level], st = file.strings || [], specs = file.facts || FACTS, facts = {};
  order.forEach((id, i) => { const spec = specs[id] || FACTS[id] || {}, e = (g.x && g.x[i] != null ? st[g.x[i]] : null) || {};
    const f = { value: g.v[i] === undefined ? null : g.v[i], cls: e.c || spec.cls || null, source: e.o || spec.source || null, period: g.p[i] != null ? st[g.p[i]] : null };
    if (e.s != null) f.scope = st[e.s]; if (e.g) f.geoScope = e.g; if (e.n != null) f.n = e.n; if (e.m != null) f.missing = st[e.m];
    facts[id] = f; });
  return { geo: { level: g.level, code: String(g.code), name: g.name, district: g.district }, at: file.at, facts, signals: g.signals || { watch: [], risk: [] },
    radar: g.radar ? { signalState: g.radar.signalState, stateReason: g.radar.stateReason != null ? st[g.radar.stateReason] : null, tracked: g.radar.tracked } : null };
}
const unpack = (file) => (file && file.schema === SCHEMA && Array.isArray(file.geographies) ? file.geographies.map((g) => unpackOne(file, g)) : []);

/* ------------------------------------------------------------ build the day (pure given the data directory and the clock) */
function build({ dataDir = ROOT, now, localities = 'all' } = {}) {
  if (!Number.isFinite(now)) throw new Error('build: `now` (ms) is required — the read model never reads the clock itself');
  const ix = D.index({ dataDir, limit: Infinity });
  const P = SCAN.load({ dataDir, now });
  const byKey = new Map((P && P.geographies ? P.geographies : []).map((g) => [`${g.level}:${g.code}`, g]));
  const codes = []; const seen = new Set();
  for (const l of ix.localities) if (!seen.has(String(l.code))) { seen.add(String(l.code)); codes.push(String(l.code)); }
  for (const g of byKey.values()) if (g.level === 'locality' && !seen.has(String(g.code))) { seen.add(String(g.code)); codes.push(String(g.code)); }
  const want = Number(localities);
  const n = localities === 'all' || !Number.isFinite(want) ? codes.length : Math.max(0, Math.min(Math.floor(want), codes.length));
  const chosen = codes.slice(0, n).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const recs = [];
  const il = D.dossier({ level: 'il', dataDir, now }); if (il) recs.push(snapshotOf(il, byKey.get('il:il') || null));
  for (const x of ix.districts) { const d = D.dossier({ level: 'district', code: x.code, dataDir, now }); if (d) recs.push(snapshotOf(d, byKey.get(`district:${x.code}`) || null)); }
  for (const code of chosen) { const d = D.dossier({ level: 'locality', code, dataDir, now }); if (d) recs.push(snapshotOf(d, byKey.get(`locality:${code}`) || null)); }
  const sources = il && Array.isArray(il.freshness) ? Object.fromEntries(il.freshness.map((f) => [f.id, { observed: f.observed || null, published: f.published || null, checked: f.checked || null }])) : null;
  return pack(recs, { date: isoDay(now), at: new Date(now).toISOString(), sources, scan: P ? { builtAt: P.builtAt || null, served: P.served || null, geographies: P.counts ? P.counts.geographies : null } : null });
}

/* ------------------------------------------------------------ the store: append-only day files + index.json */
function dates({ dataDir = ROOT, outDir } = {}) {
  const dir = outDir || snapDir(dataDir);
  let names = []; try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
}
function at(date, { dataDir = ROOT, outDir } = {}) {
  if (!isDate(date)) return null;
  const file = readJson(path.join(outDir || snapDir(dataDir), `${date}.json`));
  return file && file.schema === SCHEMA ? { date: file.date || date, at: file.at, counts: file.counts, sources: file.sources || null, scan: file.scan || null, basis: file.basis, records: unpack(file) } : null;
}
function latestBefore(date, opt = {}) { const ds = dates(opt).filter((d) => d <= date); return ds.length ? ds[ds.length - 1] : null; }
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function indexEntry(dir, date) {
  const f = path.join(dir, `${date}.json`); let st = null; try { st = fs.statSync(f); } catch { return null; }
  const file = readJson(f); if (!file || file.schema !== SCHEMA) return null;
  return { date, at: file.at || null, geographies: file.counts ? file.counts.geographies : null, byLevel: file.counts ? file.counts.byLevel : null, states: file.counts ? file.counts.states : null, bytes: st.size, sha256: sha256(fs.readFileSync(f)) };
}
function writeIndex(dir) {
  const prev = readJson(path.join(dir, 'index.json')) || {}, had = new Map((Array.isArray(prev.dates) ? prev.dates : []).map((e) => [e.date, e]));
  const list = dates({ outDir: dir });
  const entries = list.map((d) => { const e = had.get(d); if (e && e.sha256) { let st = null; try { st = fs.statSync(path.join(dir, `${d}.json`)); } catch { /* gone */ } if (st && st.size === e.bytes) return e; } return indexEntry(dir, d); }).filter(Boolean);
  const idx = { schema: SCHEMA, generator: GENERATOR, basis: BASIS, appendOnly: true, facts: Object.keys(FACTS), count: entries.length, first: entries.length ? entries[0].date : null, latest: entries.length ? entries[entries.length - 1].date : null, dates: entries };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 1) + '\n');
  return idx;
}
/** writes <outDir>/<YYYY-MM-DD>.json for the day of `now` — APPEND-ONLY: an existing day is left exactly as it is (UNCHANGED) */
function write({ dataDir = ROOT, now, outDir, localities = 'all' } = {}) {
  if (!Number.isFinite(now)) throw new Error('write: `now` (ms) is required');
  const dir = outDir || snapDir(dataDir), date = isoDay(now), file = path.join(dir, `${date}.json`);
  if (fs.existsSync(file)) return { status: 'UNCHANGED', date, file, reason: bi(`תמונת המצב של ${date} כבר קיימת — קובץ יום לעולם אינו נכתב מחדש`, `the snapshot of ${date} already exists — a day file is never rewritten`), dates: dates({ outDir: dir }) };
  const t0 = process.hrtime.bigint();
  const payload = build({ dataDir, now, localities });
  const body = JSON.stringify(payload) + '\n';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body, { flag: 'wx' });   /* exclusive create: never overwrites, even in a race */
  const idx = writeIndex(dir);
  return { status: 'SUCCESS', date, file, geographies: payload.counts.geographies, byLevel: payload.counts.byLevel, states: payload.counts.states, bytes: Buffer.byteLength(body), sha256: sha256(body), ms: Number((process.hrtime.bigint() - t0) / 1000000n), index: { count: idx.count, first: idx.first, latest: idx.latest } };
}
/** the view: the days that exist, with their counts */
function snapshots({ dataDir = ROOT, outDir } = {}) {
  const dir = outDir || snapDir(dataDir), idx = readJson(path.join(dir, 'index.json')), list = dates({ outDir: dir });
  const fromIndex = idx && Array.isArray(idx.dates) ? new Map(idx.dates.map((e) => [e.date, e])) : new Map();
  const entries = list.map((d) => fromIndex.get(d) || indexEntry(dir, d)).filter(Boolean).map((e) => ({ date: e.date, at: e.at, geographies: e.geographies, byLevel: e.byLevel || null, states: e.states || null, bytes: e.bytes }));
  return { schema: SCHEMA, count: entries.length, first: entries.length ? entries[0].date : null, latest: entries.length ? entries[entries.length - 1].date : null, dates: entries, facts: Object.fromEntries(Object.entries(FACTS).map(([id, f]) => [id, { cls: f.cls, source: f.source, kind: f.kind, label: f.label, period: f.period, dataPeriod: DATA_PERIOD(id), levels: f.levels }])), appendOnly: true, basis: BASIS };
}

/* ------------------------------------------------------------ the diff: what changed between two PROPX reads of one geography */
const KINDS = Object.freeze({ NEW: bi('חדש', 'NEW'), CHANGED: bi('השתנה', 'CHANGED'), REMOVED: bi('הוסר', 'REMOVED'), STATE: bi('מצב', 'STATE') });
const verbLabel = (v) => (VERBS.VERBS[v] ? VERBS.VERBS[v].label : null);
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
let geoCache = null;
function knownGeo({ level, code, dataDir = ROOT }) {
  if (level === 'il' || !level) return { level: 'il', code: 'il', name: bi('ישראל', 'Israel'), district: null };
  if (level === 'district') { const d = D.DISTRICTS[code]; return d ? { level, code, name: bi(d.he, d.en), district: code } : null; }
  if (level !== 'locality') return null;
  if (!geoCache || geoCache.dir !== dataDir) { const g = readJson(path.join(dataDir, 'geo', 'localities.json')); geoCache = { dir: dataDir, by: new Map(((g && g.localities) || []).map((l) => [String(l.code), l])) }; }
  const l = geoCache.by.get(String(code)); return l ? { level, code: String(l.code), name: bi(l.he, l.en), district: l.district || null } : null;
}
/**
 * diff({ level, code, since, until, dataDir, outDir })
 *   from = the latest snapshot at or before `since` (none → NO_SNAPSHOT, never a fabricated baseline); to = the latest at or before `until` (default: the latest day)
 *   → { status: 'OK', geo, from, to, changes[], unchanged[], signals: { added, removed }, radarState, quality, counts, available, basis }
 *   a geography absent from one of the two reads → status NOT_COVERED ("not covered on <date>"); an unknown geography → null
 */
function diff({ level = 'il', code = 'il', since, until, dataDir = ROOT, outDir } = {}) {
  const geo = knownGeo({ level, code, dataDir }); if (!geo) return null;
  const opt = { dataDir, outDir }, available = dates(opt);
  const common = { geo, available, basis: BASIS, verbs: VERBS.BASIS, kinds: KINDS };
  if (!available.length) return { status: 'NO_SNAPSHOT', ...common, reason: bi('אין תמונות מצב עדיין', 'no snapshots yet') };
  const sinceD = isDate(since) ? since : null;
  const fromDate = sinceD ? latestBefore(sinceD, opt) : available.length > 1 ? available[available.length - 2] : available[0];
  if (!fromDate) return { status: 'NO_SNAPSHOT', ...common, since: sinceD, reason: bi(`אין תמונת מצב ב-${sinceD} או לפניו — הראשונה היא ${available[0]}`, `no snapshot at or before ${sinceD} — the first is ${available[0]}`) };
  const toDate = isDate(until) ? latestBefore(until, opt) : available[available.length - 1];
  if (!toDate || toDate < fromDate) return { status: 'NO_SNAPSHOT', ...common, since: sinceD, until: until || null, reason: bi('אין תמונת מצב בטווח המבוקש', 'no snapshot in the requested range') };
  const A = at(fromDate, opt), B = at(toDate, opt);
  const find = (snap) => (snap ? snap.records.find((r) => r.geo.level === geo.level && r.geo.code === geo.code) || null : null);
  const a = find(A), b = find(B);
  const cov = (snap, d, rec) => ({ date: d, at: snap ? snap.at : null, covered: !!rec, ...(rec ? {} : { note: bi(`לא מכוסה ב-${d}`, `not covered on ${d}`) }) });
  const from = cov(A, fromDate, a), to = cov(B, toDate, b);
  if (!a || !b) return { status: 'NOT_COVERED', ...common, from, to, notCovered: [!a ? fromDate : null, !b ? toDate : null].filter(Boolean) };
  const ids = [...new Set([...Object.keys(a.facts), ...Object.keys(b.facts)])].sort((x, y) => Object.keys(FACTS).indexOf(x) - Object.keys(FACTS).indexOf(y));
  const changes = [], unchanged = [];
  for (const id of ids) {
    const fa = a.facts[id] || null, fb = b.facts[id] || null, va = fa ? fa.value : null, vb = fb ? fb.value : null, spec = FACTS[id] || {};
    const pa = fa ? fa.period : null, pb = fb ? fb.period : null;
    const periodMoved = DATA_PERIOD(id) && (va != null || vb != null) && !same(pa, pb);   /* a series published a new period */
    if (same(va, vb) && !periodMoved) { unchanged.push(id); continue; }
    const kind = va == null ? 'NEW' : vb == null ? 'REMOVED' : 'CHANGED', verb = kind === 'NEW' || (kind === 'CHANGED' && periodMoved) ? 'NEW' : 'CHANGED', f = fb || fa;
    const numeric = NUMERIC.has(spec.kind) && Number.isFinite(va) && Number.isFinite(vb);
    const c = { fact: id, label: spec.label || null, kind, kindLabel: KINDS[kind], verb, verbLabel: verbLabel(verb), from: va, to: vb, delta: numeric ? Math.round((vb - va) * 100) / 100 : null, unit: spec.kind || null, cls: f.cls, source: f.source,
      period: { from: pa, to: pb, moved: periodMoved }, periodKind: spec.period || null, dataPeriod: DATA_PERIOD(id) };
    if (f.scope) c.scope = f.scope; if (f.geoScope) c.geoScope = f.geoScope; if (vb == null && fb && fb.missing) c.missing = fb.missing; if (va == null && fa && fa.missing) c.wasMissing = fa.missing;
    changes.push(c);
  }
  const rs = (r) => (r.radar ? { signalState: r.radar.signalState, stateReason: r.radar.stateReason, tracked: r.radar.tracked } : null);
  const radarState = { from: rs(a), to: rs(b), changed: !same(a.radar && a.radar.signalState, b.radar && b.radar.signalState) };
  if (radarState.changed) changes.push({ fact: 'radar.signalState', label: bi('מצב הרדאר (Radar 2.0)', 'radar state (Radar 2.0)'), kind: 'STATE', kindLabel: KINDS.STATE, verb: 'CHANGED', verbLabel: verbLabel('CHANGED'), from: a.radar ? a.radar.signalState : null, to: b.radar ? b.radar.signalState : null, delta: null, unit: 'state', cls: 'DERIVED', source: 'lib/radar', period: { from: fromDate, to: toDate }, periodKind: P_SNAP, reason: { from: a.radar ? a.radar.stateReason : null, to: b.radar ? b.radar.stateReason : null } });
  const sigs = (r, kind) => (r.signals && Array.isArray(r.signals[kind]) ? r.signals[kind] : []);
  const added = [], removed = [];
  for (const kind of ['watch', 'risk']) { const sa = new Set(sigs(a, kind)), sb = new Set(sigs(b, kind)); for (const id of sb) if (!sa.has(id)) added.push({ id, kind, verb: 'NEW', verbLabel: verbLabel('NEW') }); for (const id of sa) if (!sb.has(id)) removed.push({ id, kind, verb: 'CHANGED', verbLabel: verbLabel('CHANGED') }); }
  const q = (r) => ({ score: r.facts['quality.score'] ? r.facts['quality.score'].value : null, level: r.facts['quality.level'] ? r.facts['quality.level'].value : null });
  const counts = { changes: changes.length, new: changes.filter((c) => c.kind === 'NEW').length, changed: changes.filter((c) => c.kind === 'CHANGED').length, removed: changes.filter((c) => c.kind === 'REMOVED').length, state: changes.filter((c) => c.kind === 'STATE').length, unchanged: unchanged.length, signalsAdded: added.length, signalsRemoved: removed.length };
  return { status: 'OK', ...common, since: sinceD, until: until || null, from, to, sameSnapshot: fromDate === toDate, changes, unchanged, signals: { added, removed, from: a.signals, to: b.signals }, radarState, quality: { from: q(a), to: q(b) }, counts };
}

module.exports = { snapshotOf, build, write, dates, at, latestBefore, snapshots, diff, pack, unpack, FACTS, ORDER, KINDS, BASIS, SCHEMA, GENERATOR };
