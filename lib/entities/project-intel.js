'use strict';
/* PROPX · PROJECT INTELLIGENCE 2.0 (17.10.2026) — a deterministic, explainable read of ONE project / awarded lot.
 *
 *   projIntel(project, cache, { now })  →  { version, timeline, ladder, land, demand, signals, missing, freshness, basis }
 *
 * Additive on top of lib/entities/query.js `project(id)` (every existing field unchanged). Composes only what the stored
 * official records hold for THIS project: the ILA tender (published → closed → decided/awarded dates, the lot's winning
 * sum and units, the exact XPlan plan join and its dated approval), the MoCH lottery rows (every lottery with its
 * units / applicants / winners, the permit and project stage as published), the MoCH construction-progress join by
 * block/parcel (stale, 2024-03) — and puts them beside the locality's own figures of the SAME universe: land ₪/unit of
 * competitive-bid lots in the same locality and track (the land read model's own quartiles, this tender excluded), and
 * applicants per unit of other first lotteries in the same locality. Never a join by name or geometry, never an estimate,
 * never a project-level sales / occupancy / rent figure (no source). Every signal: trigger · value · threshold · period ·
 * source · class · limitations — a description, never a judgement on the project or the developer. */
const LQ = require('../land/query');
const HQ = require('../housing/query');
const { STAGES } = require('./registry');
let XU = null; try { XU = require('../planning/xplan-units'); } catch { /* the planning helper ships separately */ }

const VERSION = { id: 'propx-project-intel-v1', effective: '2026-10-17' };
const bi = (he, en) => ({ he, en });
const iso = (txt) => '⁦' + txt + '⁩';
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const day = (v) => (v ? String(v).slice(0, 10) : null);
const d1 = (v) => String(Math.round(v * 10) / 10);
const MS_DAY = 86400000;
const monthsBetween = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / (MS_DAY * 30.4375) : null);
const SRC = { ila: 'rmi:michrazim', moch: 'datagov:moch:dira-behanacha-lotteries', cons: 'datagov:moch:construction-progress', xplan: 'rmi:michrazim · xplan (exact plan number)', reg: 'lib/entities' };
const STALE_MONTHS = 24, CONTEXT_MONTHS = 36, MIN_N = 5, UNDERSUBSCRIBED_UNITS = 20;

/* ---- the timeline: dated events from the sources, each with its class and source; undated statuses carry the source's update date */
function timelineOf(p, cache) {
  const ev = [];
  const add = (date, event, label, source, cls, data = {}) => ev.push({ date: day(date), event, label, source, cls, ...data });
  if (p.kind === 'ila-awarded-lot') {
    const T = cache.landById ? cache.landById.get(p.tenderId) : null;
    if (T) {
      if (T.publishedDate) add(T.publishedDate, 'tender-published', bi(`מכרז ${T.name || T.michrazId} פורסם`, `tender ${T.name || T.michrazId} published`), SRC.ila, 'OFFICIAL');
      if (T.closeDate) add(T.closeDate, 'tender-closed', bi('מועד אחרון להגשת הצעות', 'bid deadline'), SRC.ila, 'OFFICIAL');
      /* the full unit pair (authorised before · delta · after) lives in the land store's plan-units map (lib/planning/xplan-units.js), keyed by the plan number */
      let PU = null; try { PU = LQ.load().planUnits || null; } catch { PU = null; }
      for (const pl of T.plans || []) if (pl.xplan && pl.xplan.approvalDate) { let u = null; try { u = PU ? PU.get(String(pl.plan || '').replace(/\s+/g, '')) || null : null; if (!u && XU) u = XU.unitsOfStored(pl.xplan); } catch { u = null; }
        add(pl.xplan.approvalDate, 'plan-approved', bi(`תוכנית ${pl.plan} אושרה${u && Number.isFinite(u.unitsAfterPlan) ? ` — ${fmt(u.unitsAfterPlan)} יח״ד אחרי התוכנית (${fmt(u.planUnitDelta)} תוספת)` : ''}`, `plan ${pl.plan} approved${u && Number.isFinite(u.unitsAfterPlan) ? ` — ${fmt(u.unitsAfterPlan)} units after the plan (${fmt(u.planUnitDelta)} delta)` : ''}`), SRC.xplan, 'OFFICIAL', { plan: pl.plan, units: u }); }
    }
    if (p.decisionDate) add(p.decisionDate, 'land-awarded', bi(`המגרש נזכה — ${fmt(p.units)} יח״ד${p.landPrice != null ? `, ${fmt(p.landPrice)} ₪ (${p.priceBasis === 'competitive-bid' ? 'הצעה תחרותית' : p.priceBasis})` : ''}`, `lot awarded — ${fmt(p.units)} units${p.landPrice != null ? `, ₪${fmt(p.landPrice)} (${p.priceBasis})` : ''}`), SRC.ila, 'OFFICIAL', { units: p.units, landPrice: p.landPrice });
    if (p.construction) { if (p.construction.firstStart) add(p.construction.firstStart, 'construction-started', bi(`תחילת בנייה בדיווחי משב״ש (${fmt(p.construction.started)} מבנים; נכון ל-${p.construction.asOf})`, `construction start in MoCH progress reports (${fmt(p.construction.started)} ${p.construction.started === 1 ? 'building' : 'buildings'}; as of ${p.construction.asOf})`), SRC.cons, 'OFFICIAL', { asOf: p.construction.asOf, stale: true });
      if (p.construction.lastCompletion) add(p.construction.lastCompletion, 'completed', bi(`גמר בנייה בדיווחי משב״ש (${fmt(p.construction.completed)} מבנים; נכון ל-${p.construction.asOf})`, `completion in MoCH progress reports (${fmt(p.construction.completed)} ${p.construction.completed === 1 ? 'building' : 'buildings'}; as of ${p.construction.asOf})`), SRC.cons, 'OFFICIAL', { asOf: p.construction.asOf, stale: true }); }
  } else {
    for (const l of p.lotteries || []) add(l.date, 'lottery', bi(`הגרלה ${l.type === 'first' ? 'ראשונה' : 'המשך'} — ${fmt(l.units)} יח״ד, ${fmt(l.applicants)} נרשמים, ${fmt(l.winners)} זוכים (${l.status || '—'})`, `${l.type === 'first' ? 'first' : 'continuation'} lottery — ${fmt(l.units)} units, ${fmt(l.applicants)} applicants, ${fmt(l.winners)} winners (${l.status || '—'})`), SRC.moch, 'OFFICIAL', { type: l.type, units: l.units, applicants: l.applicants, winners: l.winners });
    const upd = p.provenance && p.provenance.sourceUpdatedAt ? day(p.provenance.sourceUpdatedAt) : null;
    if (p.permitStatusHe) add(upd, 'permit-status', bi(`היתר: ${p.permitStatusHe} (כפי שפורסם; ללא תאריך — נכון לעדכון המקור)`, `permit: ${p.permitStatusHe} (as published; undated — as of the source update)`), SRC.moch, 'OFFICIAL', { undated: true, stage: p.permitStage });
    if (p.projectStatusHe) add(upd, 'project-status', bi(`שלב הפרויקט: ${p.projectStatusHe} (כפי שפורסם; ללא תאריך)`, `project stage: ${p.projectStatusHe} (as published; undated)`), SRC.moch, 'OFFICIAL', { undated: true, stage: p.projectStage });
  }
  return ev.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
}

/* ---- the stage ladder: every rung with its direct evidence, or the reason PROPX has none (a missing rung is not a missing stage) */
const NO_EVIDENCE = {
  ila: { 'marketed': bi('רשומות ההגרלה של משב״ש אינן נושאות מכרז / מגרש — אין צירוף', 'the MoCH lottery records carry no tender / lot — not joined'), 'permitted': bi('אין מקור היתרים קריא למכונה (דיווחי ההתקדמות של משב״ש אינם מפרסמים היתר)', 'no machine-readable permits source (MoCH progress reports do not publish a permit)'),
    'construction-started': bi('אין דיווח התקדמות מצורף בגוש/חלקה (או שאינו ב-2024-03)', 'no progress report joined by block/parcel (or none by 2024-03)'), 'completed': bi('אין דיווח גמר מצורף (דיווחי משב״ש נעצרים ב-2024-03)', 'no completion report joined (MoCH reports stop at 2024-03)'), 'occupied': bi('אין מקור אכלוס', 'no occupancy source') },
  moch: { 'land-awarded': bi('רשומת ההגרלה אינה נושאת מכרז, תוכנית או חלקה — אין צירוף למגרש רמ״י', 'the lottery record carries no tender, plan or parcel — not joined to an ILA lot'), 'permitted': bi('שדה ההיתר במקור אינו מציין היתר מלא', 'the permit field in the source does not state a full permit'),
    'construction-started': bi('רשומת ההגרלה אינה מדווחת תחילת בנייה', 'the lottery record does not report a construction start'), 'completed': bi('רשומת ההגרלה אינה מדווחת גמר', 'the lottery record does not report completion'), 'occupied': bi('אין מקור אכלוס', 'no occupancy source') },
};
function ladderOf(p) {
  const ev = (p.stage && p.stage.evidence) || [], kind = p.kind === 'ila-awarded-lot' ? 'ila' : 'moch';
  const furthest = p.stage ? p.stage.furthest : null, fi = STAGES.indexOf(furthest);
  return { furthest, rungs: STAGES.map((s, i) => { const e = ev.find((x) => x.stage === s); return { stage: s, evidenced: !!e, date: e ? e.date || null : null, source: e ? e.source : null, partial: e ? !!e.partial : false, asOf: e && e.asOf ? e.asOf : null, label: e && e.label ? e.label : null,
    reason: e ? null : (NO_EVIDENCE[kind][s] || bi('אין ראיה ישירה במקורות PROPX', 'no direct evidence in PROPX sources')), beyondFurthest: i > fi }; }),
    basis: bi('השלב הרחוק ביותר עם ראיה ישירה; שלב ללא ראיה אינו שלב שלא קרה — PROPX אינה מסיקה', 'the furthest stage with direct evidence; a rung without evidence is not a stage that did not happen — PROPX does not infer') };
}

/* ---- land ₪/unit beside the locality's competitive-bid lots of the same track (the land read model's own quartiles; this tender excluded) */
function landContext(p, cache, now) {
  if (p.kind !== 'ila-awarded-lot') return null;
  const base = { value: p.landPerUnit ?? null, basis: p.priceBasis || null, locality: null, position: null, reason: null };
  if (p.landPerUnit == null || p.priceBasis !== 'competitive-bid') return { ...base, reason: bi('אין ₪/יח״ד בבסיס הצעה תחרותית למגרש הזה', 'no competitive-bid ₪/unit for this lot') };
  let C; try { C = LQ.load(); } catch { return { ...base, reason: bi('מאגר המכרזים אינו זמין', 'the tender store is unavailable') }; }
  const from = day(new Date(now - CONTEXT_MONTHS * 30.4375 * MS_DAY).toISOString());
  const rows = C.live.filter((r) => String(r.localityCode) === String(p.localityCode) && r.id !== p.tenderId && r.track === p.track && r.decisionDate && day(r.decisionDate) >= from);
  const over = LQ.landPerUnitOver(rows, p.track === 'open-market' ? { from, to: day(new Date(now).toISOString()), dateField: 'decision' } : { track: [p.track], from, to: day(new Date(now).toISOString()), dateField: 'decision' });
  const locality = { lots: over.lots, tenders: over.tenders, median: over.medianLotPerUnit, p25: over.p25LotPerUnit, p75: over.p75LotPerUnit, unitWeighted: over.perUnit, period: { from, to: day(new Date(now).toISOString()), months: CONTEXT_MONTHS, dateField: 'decision' }, track: p.track, basis: over.basis, formula: over.formula, consideration: over.consideration, vat: over.vat, excluded: over.excluded };
  /* the lot's OWN award must be inside the same window — a 2001 nominal sum is never positioned against 2023–26 lots */
  const own = day(p.decisionDate);
  if (!own || own < from) return { ...base, locality, ownDate: own, reason: bi(`תאריך ההחלטה של המגרש עצמו (${own || '—'}) מחוץ לחלון ${CONTEXT_MONTHS} החודשים — ללא מיקום (סכום נומינלי מתקופה אחרת)`, `the lot's own decision date (${own || '—'}) is outside the ${CONTEXT_MONTHS}-month window — no position (a nominal sum from another period)`) };
  if (over.lots < MIN_N) return { ...base, locality, ownDate: own, reason: bi(`פחות מ-${MIN_N} מגרשים מקבילים ביישוב ב-${CONTEXT_MONTHS} חודשים — ללא מיקום`, `fewer than ${MIN_N} comparable lots in the locality in ${CONTEXT_MONTHS} months — no position`) };
  const position = p.landPerUnit >= over.p75LotPerUnit ? 'above-p75' : p.landPerUnit <= over.p25LotPerUnit ? 'below-p25' : 'within';
  return { ...base, locality, ownDate: own, position, reason: null };
}

/* ---- applicants per unit beside the locality's other first lotteries (DERIVED, the housing read model's rows) */
function demandContext(p, now) {
  if (p.kind === 'ila-awarded-lot') return null;
  const base = { value: p.demand && p.demand.applicantsPerUnit != null ? p.demand.applicantsPerUnit : null, basis: p.demand ? p.demand.basis : null, locality: null, position: null, reason: null };
  if (base.value == null) return { ...base, reason: bi('אין נרשמים / יח״ד בהגרלה הראשונה', 'no applicants / units in the first lottery') };
  let L; try { L = HQ.load().lotteries; } catch { return { ...base, reason: bi('מאגר ההגרלות אינו זמין', 'the lottery store is unavailable') }; }
  const rows = L.filter((l) => l.inLatestSource !== false && l.lotteryType === 'first' && String(l.localityCode) === String(p.localityCode) && l.projectId !== p.projectId && Number.isFinite(l.applicants) && Number.isFinite(l.unitsInLottery) && l.unitsInLottery > 0);
  const ratios = rows.map((l) => l.applicants / l.unitsInLottery).sort((a, b) => a - b), q = (x) => (ratios.length ? Math.round(ratios[Math.min(ratios.length - 1, Math.floor(x * ratios.length))] * 10) / 10 : null);
  const dates = rows.map((l) => l.lotteryDate).filter(Boolean).sort();
  const locality = { lotteries: rows.length, projects: new Set(rows.map((l) => l.projectId)).size, median: q(0.5), p25: q(0.25), p75: q(0.75), period: { from: dates[0] || null, to: dates[dates.length - 1] || null }, formula: 'per first lottery: applicants ÷ units; the median of those ratios (this project excluded); lotteries of different years and programmes — the periods are printed' };
  const ownDate = p.firstLotteryDate || null;
  if (rows.length < MIN_N) return { ...base, locality, ownDate, reason: bi(`פחות מ-${MIN_N} הגרלות ראשונות אחרות ביישוב — ללא מיקום`, `fewer than ${MIN_N} other first lotteries in the locality — no position`) };
  return { ...base, locality, ownDate, position: base.value >= locality.p75 ? 'above-p75' : base.value <= locality.p25 ? 'below-p25' : 'within', reason: null };
}

/* ---- signals: fixed rules, each explainable; a description of the observed records — never a judgement */
const NOT_JUDGEMENT = bi('תיאור הרשומות שנצפו — לא שיפוט על הפרויקט או היזם', 'a description of the observed records — not a judgement on the project or the developer');
const SIGNALS = [
  { id: 'LAND_COST_ABOVE_LOCALITY', kind: 'risk', cls: 'DERIVED', source: SRC.ila, threshold: bi('≥ הרבעון העליון של ≥ 5 מגרשים מקבילים', '≥ the upper quartile of ≥ 5 comparable lots'), period: bi(`${CONTEXT_MONTHS} חודשים לפי תאריך החלטה`, `${CONTEXT_MONTHS} months by decision date`),
    trigger: bi('₪/יח״ד של המגרש ≥ p75 של מגרשי הצעה תחרותית באותו יישוב ומסלול', 'the lot\'s ₪/unit ≥ p75 of competitive-bid lots in the same locality and track'), fires: (x) => x.land && x.land.position === 'above-p75', value: (x) => x.land.value, valueLabel: (x) => '₪' + fmt(x.land.value),
    text: (x) => bi(`₪/יח״ד ${fmt(x.land.value)} (נזכה ${x.land.ownDate}) — מעל הרבעון העליון ביישוב (${fmt(x.land.locality.p75)}; חציון ${fmt(x.land.locality.median)}, ${x.land.locality.lots} מגרשים שנדונו ${x.land.locality.period.from} → ${x.land.locality.period.to})`, `₪/unit ${fmt(x.land.value)} (awarded ${x.land.ownDate}) — above the locality's upper quartile (${fmt(x.land.locality.p75)}; median ${fmt(x.land.locality.median)}, ${x.land.locality.lots} lots decided ${x.land.locality.period.from} → ${x.land.locality.period.to})`),
    limitations: [bi('תמורת קרקע נומינלית של הזכייה, ללא הוצאות פיתוח ומע״מ; מגרשים שונים נושאים זכויות שונות', 'the nominal land consideration of the award, without development costs and VAT; different lots carry different rights'), NOT_JUDGEMENT] },
  { id: 'LAND_COST_BELOW_LOCALITY', kind: 'watch', cls: 'DERIVED', source: SRC.ila, threshold: bi('≤ הרבעון התחתון של ≥ 5 מגרשים מקבילים', '≤ the lower quartile of ≥ 5 comparable lots'), period: bi(`${CONTEXT_MONTHS} חודשים לפי תאריך החלטה`, `${CONTEXT_MONTHS} months by decision date`),
    trigger: bi('₪/יח״ד של המגרש ≤ p25 של מגרשי הצעה תחרותית באותו יישוב ומסלול', 'the lot\'s ₪/unit ≤ p25 of competitive-bid lots in the same locality and track'), fires: (x) => x.land && x.land.position === 'below-p25', value: (x) => x.land.value, valueLabel: (x) => '₪' + fmt(x.land.value),
    text: (x) => bi(`₪/יח״ד ${fmt(x.land.value)} (נזכה ${x.land.ownDate}) — מתחת לרבעון התחתון ביישוב (${fmt(x.land.locality.p25)}; חציון ${fmt(x.land.locality.median)}, ${x.land.locality.lots} מגרשים שנדונו ${x.land.locality.period.from} → ${x.land.locality.period.to})`, `₪/unit ${fmt(x.land.value)} (awarded ${x.land.ownDate}) — below the locality's lower quartile (${fmt(x.land.locality.p25)}; median ${fmt(x.land.locality.median)}, ${x.land.locality.lots} lots decided ${x.land.locality.period.from} → ${x.land.locality.period.to})`),
    limitations: [bi('מחיר נמוך יכול לשקף זכויות, מיקום או תנאי מכרז שונים — לא "מציאה"', 'a low price may reflect different rights, location or tender terms — not a bargain'), NOT_JUDGEMENT] },
  { id: 'LOTTERY_DEMAND_ABOVE_LOCALITY', kind: 'watch', cls: 'DERIVED', source: SRC.moch, threshold: bi('≥ הרבעון העליון של ≥ 5 הגרלות ראשונות אחרות ביישוב', '≥ the upper quartile of ≥ 5 other first lotteries in the locality'), period: bi('ההגרלה הראשונה מול הגרלות ראשונות אחרות ביישוב', 'the first lottery vs the locality\'s other first lotteries'),
    trigger: bi('נרשמים ליח״ד בהגרלה הראשונה ≥ p75 של ההגרלות הראשונות האחרות ביישוב', 'applicants per unit in the first lottery ≥ p75 of the locality\'s other first lotteries'), fires: (x) => x.demand && x.demand.position === 'above-p75', value: (x) => x.demand.value, valueLabel: (x) => String(Math.round(x.demand.value * 10) / 10),
    text: (x) => bi(`${d1(x.demand.value)} נרשמים ליח״ד (הגרלה ראשונה ${x.demand.ownDate || '—'}) — מעל הרבעון העליון ביישוב (${x.demand.locality.p75}; חציון ${x.demand.locality.median}, ${x.demand.locality.lotteries} הגרלות ${x.demand.locality.period.from} → ${x.demand.locality.period.to})`, `${d1(x.demand.value)} applicants per unit (first lottery ${x.demand.ownDate || '—'}) — above the locality's upper quartile (${x.demand.locality.p75}; median ${x.demand.locality.median}, ${x.demand.locality.lotteries} lotteries ${x.demand.locality.period.from} → ${x.demand.locality.period.to})`),
    limitations: [bi('ביקוש להגרלה מסובסדת — לא ביקוש בשוק החופשי; תנאי הזכאות משתנים בין תוכניות', 'demand for a subsidized lottery — not open-market demand; eligibility differs between programmes'), NOT_JUDGEMENT] },
  { id: 'LOTTERY_DEMAND_BELOW_LOCALITY', kind: 'watch', cls: 'DERIVED', source: SRC.moch, threshold: bi('≤ הרבעון התחתון של ≥ 5 הגרלות ראשונות אחרות ביישוב', '≤ the lower quartile of ≥ 5 other first lotteries in the locality'), period: bi('ההגרלה הראשונה מול הגרלות ראשונות אחרות ביישוב', 'the first lottery vs the locality\'s other first lotteries'),
    trigger: bi('נרשמים ליח״ד בהגרלה הראשונה ≤ p25 של ההגרלות הראשונות האחרות ביישוב', 'applicants per unit in the first lottery ≤ p25 of the locality\'s other first lotteries'), fires: (x) => x.demand && x.demand.position === 'below-p25', value: (x) => x.demand.value, valueLabel: (x) => String(Math.round(x.demand.value * 10) / 10),
    text: (x) => bi(`${d1(x.demand.value)} נרשמים ליח״ד (הגרלה ראשונה ${x.demand.ownDate || '—'}) — מתחת לרבעון התחתון ביישוב (${x.demand.locality.p25}; חציון ${x.demand.locality.median}, ${x.demand.locality.lotteries} הגרלות ${x.demand.locality.period.from} → ${x.demand.locality.period.to})`, `${d1(x.demand.value)} applicants per unit (first lottery ${x.demand.ownDate || '—'}) — below the locality's lower quartile (${x.demand.locality.p25}; median ${x.demand.locality.median}, ${x.demand.locality.lotteries} lotteries ${x.demand.locality.period.from} → ${x.demand.locality.period.to})`),
    limitations: [bi('ביקוש להגרלה מסובסדת — לא ביקוש בשוק החופשי; הגרלות מתקופות שונות ובתוכניות שונות', 'demand for a subsidized lottery — not open-market demand; lotteries of different periods and programmes'), NOT_JUDGEMENT] },
  { id: 'LOTTERY_UNDERSUBSCRIBED', kind: 'risk', cls: 'DERIVED', source: SRC.moch, threshold: bi(`< 1 נרשם ליח״ד ב-≥ ${UNDERSUBSCRIBED_UNITS} יח״ד`, `< 1 applicant per unit over ≥ ${UNDERSUBSCRIBED_UNITS} units`), period: bi('ההגרלה הראשונה', 'the first lottery'),
    trigger: bi('נרשמים ליח״ד < 1 בהגרלה ראשונה של ≥ 20 יח״ד', 'applicants per unit < 1 in a first lottery of ≥ 20 units'), fires: (x) => x.demand && x.demand.value != null && x.demand.value < 1 && x.p.demand && x.p.demand.unitsFirst >= UNDERSUBSCRIBED_UNITS, value: (x) => x.demand.value, valueLabel: (x) => String(Math.round(x.demand.value * 100) / 100),
    text: (x) => bi(`${Math.round(x.demand.value * 100) / 100} נרשמים ליח״ד בהגרלה הראשונה (${fmt(x.p.demand.unitsFirst)} יח״ד)`, `${Math.round(x.demand.value * 100) / 100} applicants per unit in the first lottery (${fmt(x.p.demand.unitsFirst)} units)`),
    limitations: [bi('כפי שהמקור מדווח; הגרלות המשך אינן בחשבון', 'as the source reports; continuation lotteries are not counted'), NOT_JUDGEMENT] },
  { id: 'PLAN_JOINED', kind: 'info', cls: 'OFFICIAL', source: SRC.xplan, threshold: '≥ 1', period: bi('כפי שפורסם בשכבת התוכניות', 'as published in the plans layer'),
    trigger: bi('תוכנית מאושרת ומתוארכת מצורפת למכרז במספר תוכנית מדויק', 'a dated approved plan joined to the tender by exact plan number'), fires: (x) => x.plans.length >= 1, value: (x) => x.plans.length, valueLabel: (x) => String(x.plans.length),
    text: (x) => bi(`${x.plans.length} תוכניות מצורפות במספר מדויק: ${x.plans.map((e) => `${e.plan} (${e.date})`).join(', ')}`, `${x.plans.length} plans joined by exact number: ${x.plans.map((e) => `${e.plan} (${e.date})`).join(', ')}`),
    limitations: [bi('יח״ד של תוכנית = כל התוכנית, לא המגרש', 'plan units = the whole plan, not the lot')] },
  { id: 'PROJECT_CONSTRUCTION_REPORT', kind: 'info', cls: 'OFFICIAL', source: SRC.cons, threshold: '≥ 1', period: bi('נכון ל-2024-03 (ישן)', 'as of 2024-03 (stale)'),
    trigger: bi('דיווח התקדמות של משב״ש מצורף בגוש/חלקה מדויקים', 'a MoCH progress report joined by exact block/parcel'), fires: (x) => !!(x.p.construction && (x.p.construction.started || x.p.construction.completed)), value: (x) => x.p.construction.started, valueLabel: (x) => String(x.p.construction.started),
    text: (x) => bi(`${fmt(x.p.construction.started)} מבנים החלו, ${fmt(x.p.construction.completed)} הושלמו (נכון ל-${x.p.construction.asOf})`, `${fmt(x.p.construction.started)} ${x.p.construction.started === 1 ? 'building' : 'buildings'} started, ${fmt(x.p.construction.completed)} completed (as of ${x.p.construction.asOf})`),
    limitations: [bi('המקור נעצר ב-2024-03 — ישן', 'the source stops at 2024-03 — stale')] },
  { id: 'RE_TENDERED_LOT', kind: 'info', cls: 'OFFICIAL', source: SRC.ila, threshold: '≥ 1', period: bi('הרשימה החיה', 'the live list'),
    trigger: bi('מכרז קודם שיווק את אותו תיק מגרש (TikID) — שיווק חוזר', 'an earlier tender marketed the same lot file (TikID) — a re-tender'), fires: (x) => x.predecessors.length >= 1, value: (x) => x.predecessors.length, valueLabel: (x) => String(x.predecessors.length),
    text: (x) => bi(`המגרש שווק לפני כן ב-${x.predecessors.map((l) => `${l.name || l.from} (${l.priorStage || '—'}, ${l.fromDate || '—'})`).join(', ')}`, `the lot was marketed before in ${x.predecessors.map((l) => `${l.name || l.from} (${l.priorStage || '—'}, ${l.fromDate || '—'})`).join(', ')}`),
    limitations: [bi('קישור רק דרך מזהה תיק המגרש של רמ״י — לא לפי שם או גאומטריה', 'linked only through the Authority\'s lot file id — never by name or geometry')] },
];

function projIntel(p, cache = {}, opt = {}) {
  if (!p) return null;
  const now = opt.now ? (typeof opt.now === 'number' ? opt.now : Date.parse(opt.now)) : Date.now();
  const timeline = timelineOf(p, cache), ladder = ladderOf(p), land = landContext(p, cache, now), demand = demandContext(p, now);
  const dated = timeline.filter((e) => e.date && !e.undated).map((e) => e.date).sort();
  const lastEvidenceDate = dated[dated.length - 1] || null, lastEvidenceMonths = lastEvidenceDate ? monthsBetween(lastEvidenceDate, new Date(now).toISOString()) : null;
  const plans = timeline.filter((e) => e.event === 'plan-approved').map((e) => ({ plan: e.plan, date: e.date, units: e.units }));
  let predecessors = [];
  if (p.kind === 'ila-awarded-lot') { try { const C = LQ.load(); const ln = LQ.lineageOf(C), me = ln.byTender.get(p.tenderId); if (me) predecessors = me.predecessors.filter((l) => l.relation !== 'same-parcel' && l.relation !== 'parallel-marketing' && (l.sharedLots || []).map(String).includes(String(p.lotId))).map((l) => ({ from: l.from, name: (C.live.find((r) => r.id === l.from) || {}).name || null, relation: l.relation, fromDate: l.fromDate, priorStage: l.fromStage, evidence: l.evidence })); } catch { predecessors = []; } }
  const x = { p, ladder, land, demand, lastEvidenceDate, lastEvidenceMonths, plans, predecessors };
  const signals = SIGNALS.filter((r) => { try { return r.fires(x); } catch { return false; } }).map((r) => ({ id: r.id, kind: r.kind, cls: r.cls, source: r.source, text: r.text(x), trigger: r.trigger, value: r.value(x), valueLabel: r.valueLabel(x), threshold: r.threshold, period: r.period, limitations: r.limitations }));
  const missing = [];
  const miss = (id, he, en) => missing.push({ id, he, en });
  if (p.kind === 'ila-awarded-lot') { miss('permits', 'היתר בנייה: אין מקור רשמי קריא למכונה מצורף', 'building permit: no joined machine-readable official source');
    /* a lot awarded > 24 months ago whose furthest stage is before completion: no PROPX source CAN carry a later stage (permits — no source; MoCH construction reports stop at 2024-03) — a gap in the sources, never a halted project */
    if (lastEvidenceMonths != null && lastEvidenceMonths > STALE_MONTHS && STAGES.indexOf(ladder.furthest) < STAGES.indexOf('completed')) miss('later-evidence', `שלב מאוחר יותר: הראיה המתוארכת האחרונה לפני ${Math.round(lastEvidenceMonths)} חודשים (${lastEvidenceDate}); אף מקור מצורף אינו יכול לשאת שלב חדש יותר (היתרים — אין מקור; דיווחי הבנייה נעצרים ב-2024-03)`, `a later stage: the latest dated evidence is ${Math.round(lastEvidenceMonths)} months old (${lastEvidenceDate}); no joined source can carry a newer stage (permits — no source; construction reports stop at 2024-03)`); if (!p.construction) miss('construction', 'התקדמות בנייה: אין דיווח משב״ש מצורף בגוש/חלקה (והמקור נעצר ב-2024-03)', 'construction progress: no MoCH report joined by block/parcel (and the source stops at 2024-03)'); miss('lottery-join', 'הגרלות משב״ש: אין מפתח רשמי משותף למגרש — לא מצורף', 'MoCH lotteries: no shared official key with the lot — not joined'); }
  else { miss('tender-join', 'מגרש רמ״י: רשומת ההגרלה אינה נושאת מכרז / תוכנית / חלקה — לא מצורף', 'ILA lot: the lottery record carries no tender / plan / parcel — not joined'); miss('permit-date', 'תאריך היתר: המקור מציין שלב היתר ללא תאריך', 'permit date: the source states a permit stage without a date'); }
  miss('project-sales', 'מכירות הפרויקט: אין מקור (הלמ״ס מפרסמת ארצי ומחוז בלבד; המרשם אינו מצרף פרויקט)', 'project sales: no source (CBS publishes national and district only; the register does not join a project)');
  miss('occupancy', 'אכלוס / שכר דירה: אין מקור', 'occupancy / rent: no source');
  const freshness = { land: cache.landMeta ? { checkedAt: cache.landMeta.checkedAt || null, latestPublished: (cache.landMeta.coverage && cache.landMeta.coverage.publishedTo) || cache.landMeta.latestPublished || null } : null, housing: cache.housingMeta ? { checkedAt: cache.housingMeta.checkedAt || null, sourceUpdatedAt: cache.housingMeta.sourceUpdatedAt || null } : null, construction: p.construction ? { asOf: p.construction.asOf, stale: true } : null, lastEvidenceDate, lastEvidenceMonths: lastEvidenceMonths != null ? Math.round(lastEvidenceMonths * 10) / 10 : null };
  return { version: VERSION, timeline, ladder, land, demand, signals, missing, freshness,
    basis: bi('קריאה דטרמיניסטית של הרשומות הרשמיות של הפרויקט הזה בלבד; הקשר יישובי מאותו יקום (₪/יח״ד של מגרשי הצעה תחרותית, נרשמים ליח״ד בהגרלות ראשונות) עם n ותקופה; ללא צירוף לפי שם או גאומטריה; ללא אומדן; ללא מכירות / אכלוס / שכר דירה של פרויקט (אין מקור). תיאור — לא שיפוט.',
      'A deterministic read of this project\'s official records only; locality context from the same universe (₪/unit of competitive-bid lots, applicants per unit of first lotteries) with n and period; no join by name or geometry; no estimate; no project sales / occupancy / rent (no source). A description — not a judgement.') };
}

module.exports = { projIntel, SIGNALS, timelineOf, ladderOf, landContext, demandContext, VERSION };
