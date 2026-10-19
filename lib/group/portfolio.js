// PROPX · SPONSOR X-RAY — the group's OBSERVED PORTFOLIO and what it carries: project rows (each project once), the furthest-verified
// stage distribution, the observed execution load, the historical execution record against the national cohort, the execution-trend
// signals, geographic and programme exposure, the land pipeline, the stage × geography / programme matrix and the project timeline.
//
// Every figure is a count / sum over rows of tiers CORE + DOCUMENTED (lib/group/model.js), per universe (ILA lots ≠ MoCH lottery
// projects — never added); SHARED (joint-award) rows are listed apart and never added. A comparison always names its basis (the same
// rule over the national cohort, lib/group/cohort.js); a label without a basis is never printed. Nothing here is a score.
'use strict';

const PCO = require('../dd/projectco');
const R = require('../entities/resolve');
const { recordFacts, addMonths } = require('./facts');
const { shares, dist, median, light, tendersOf, byTender } = require('./cohort');
const { bi, RULES, BUCKET_IDS, STAGE_BUCKETS, PROGRAMMES, UNIVERSE } = require('./model');
const { monthsBetween } = require('../dd/developer');

const DISTRICTS = (() => { try { return require('../dossier/query').DISTRICTS; } catch { return {}; } })();
const districtLabel = (d) => (d && DISTRICTS[d] ? { he: DISTRICTS[d].he, en: DISTRICTS[d].en } : { he: 'לא ידוע', en: 'unknown' });
const TIER_RANK = { CORE: 3, DOCUMENTED: 2, SHARED: 1 };
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const sh = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);
const inTotals = (r) => r.tier === 'CORE' || r.tier === 'DOCUMENTED';
/* the registry keeps English locality names in lower case ("be'er sheva") — shown title-cased */
const titleCase = (x) => (x == null ? x : String(x).replace(/(^|[\s\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase()));

/* ------------------------------------------------------------ rows */
/** one row per project record reached through the group's brands; members merged on the record id (never across sources) */
function rowsOf(M, K, C, { userDocs = [], today, anchorRes = null } = {}) {
  const byId = new Map();
  for (const b of M.brands.values()) {
    const dv = b.dev;
    const ids = (dv.sites || []).concat(dv.projects || []);
    for (const id of ids) {
      const p = K.L.projById.get(id); if (!p) continue;
      if (p.kind === 'moch-lottery-project' && Array.isArray(p.developerIds) && !p.developerIds.includes(dv.id)) continue;
      const m = { devId: dv.id, name: dv.name, tier: b.tier, state: b.state, companyNumber: b.companyNumber || null };
      if (byId.has(id)) { const r = byId.get(id); if (!r.members.some((x) => x.devId === dv.id)) r.members.push(m); if (TIER_RANK[b.tier] > TIER_RANK[r.tier]) { r.tier = b.tier; r.chainState = b.state; } continue; }
      byId.set(id, { p, members: [m], tier: b.tier, chainState: b.state });
    }
  }
  const rows = [];
  for (const { p, members, tier, chainState } of byId.values()) {
    const lead = M.brands.get(members[0].devId);
    const res = anchorRes && M.anchor.type !== 'company' && lead.dev.id === (M.anchor.devId || null) ? anchorRes : (C.resByDev.get(lead.dev.id) || R.resolveCompany({ id: lead.dev.id, canonical: lead.dev.canonical, kind: lead.dev.kind, joint: lead.dev.joint }, K.c.idx));
    const F = recordFacts(p, K, { devLight: light(res), today, consAsOf: C.consAsOf, landById: K.L.landById });
    const S = F._S; delete F._S;
    /* the project company / SPV roles — the due-diligence rule (lib/dd/projectco.js), from this record's own links and the user's documents */
    const devDD = { identity: { observedName: lead.dev.canonical || lead.dev.name, resolution: { ...res, chosen: res.chosen ? R.companyFacts(res.chosen) : null, candidates: (res.candidates || []).map(R.companyFacts) } } };
    const pco = PCO.projectCompany({ project: p, projectDD: { sites: S, contractors: F.contractors }, developerDD: devDD, userDocs, index: K.c.idx, now: today });
    const loc = K.c.localityByCode.get(String(p.localityCode));
    const dcode = loc && loc.district ? loc.district : null;
    const co = res.chosen && (res.state === 'STRONG_MATCH' || res.state === 'VERIFIED') ? R.companyFacts(res.chosen) : null;
    const others = (p.developerIds || []).filter((x) => !members.some((m) => m.devId === x)).map((x) => { const d = K.L.devById.get(x); return d ? { id: d.id, name: d.name } : null; }).filter(Boolean);
    rows.push({
      id: p.id, kind: p.kind, universe: F.universe, tier, chainState, members, coDevelopers: others,
      label: p.kind === 'ila-awarded-lot' ? `${p.tender || p.michrazId} · ${p.lotId}` : (p.name || String(p.projectId)),
      display: p.kind === 'ila-awarded-lot' ? bi(`מכרז ${p.tender || p.michrazId} · מגרש ${p.lotId} · ${p.city || '—'}`, `Tender ${p.tender || p.michrazId} · lot ${p.lotId} · ${titleCase(p.cityEn || p.city) || '—'}`)
        : bi(`פרויקט הגרלה ${p.projectId}${p.name ? ` (${p.name})` : ''} · ${p.city || '—'}`, `Lottery project ${p.projectId}${p.name ? ` (${p.name})` : ''} · ${titleCase(p.cityEn || p.city) || '—'}`),
      tender: p.tender || null, tenderId: p.tenderId || null, lotId: p.lotId || null, name: p.kind === 'moch-lottery-project' ? p.name || null : null,
      city: p.city || null, cityEn: p.cityEn || null, localityCode: F.localityCode, district: dcode,
      legalEntity: co ? { number: co.number, name: co.name, state: res.state, userProvided: !!res.userProvided } : { number: null, name: null, state: res.state, userProvided: false },
      /* IDENTIFIED only with ≥ 2 independent records (or VERIFIED): a land winner / programme developer of record alone is "not identified —
         land winner of record" (independent review 19.10.2026; LAND WINNER ≠ PROJECT COMPANY) */
      projectCompany: (() => { const ind = pco.whyThis ? pco.whyThis.independentRecords : 0, ok = pco.state === 'VERIFIED' || (pco.state === 'STRONG_MATCH' && ind >= 2);
        return { state: pco.state, number: pco.company ? pco.company.number : null, name: pco.company ? pco.company.name : null, cls: pco.cls || null, conflict: (pco.conflicts || []).length > 0, reasons: (pco.reasons || []).map((x) => x.code), independentRecords: ind, identified: ok, ofRecordOnly: !ok && pco.state === 'STRONG_MATCH' }; })(),
      roles: { landWinner: pco.roles.landWinner ? { name: pco.roles.landWinner.name, state: pco.roles.landWinner.resolution, number: pco.roles.landWinner.company ? pco.roles.landWinner.company.number : null } : null,
        programmeDeveloper: pco.roles.programmeDeveloper ? { name: pco.roles.programmeDeveloper.name, state: pco.roles.programmeDeveloper.resolution, number: pco.roles.programmeDeveloper.company ? pco.roles.programmeDeveloper.company.number : null } : null,
        permitHolders: pco.roles.permitHolder.map((h) => ({ name: h.name, state: h.resolution, number: h.company ? h.company.number : h.number || null, cls: h.cls })),
        contractors: F.contractors.map((c) => ({ name: c.name, kablan: c.kablan, number: c.company ? c.company.number : null, state: c.matchState })),
        parent: pco.roles.parent && pco.roles.parent.cls ? { name: pco.roles.parent.name, number: pco.roles.parent.number, cls: pco.roles.parent.cls, check: pco.roles.parent.registryCheck } : null,
        guarantor: pco.roles.guarantor && pco.roles.guarantor.cls ? { kind: pco.roles.guarantor.kind, name: pco.roles.guarantor.name, number: pco.roles.guarantor.number || null, expired: !!pco.roles.guarantor.expired, cls: pco.roles.guarantor.cls } : null },
      stage: F.furthest, bucket: F.bucket, stageCls: F.stageCls,
      units: F.units, unitsUniverse: F.universe === 'ila' ? 'ila-capacity' : 'moch-first-lottery',
      landAward: p.kind === 'ila-awarded-lot' ? { date: F.award, sum: p.landPrice ?? null, perUnit: p.landPerUnit ?? null, priceBasis: p.priceBasis || null, bidPerSqm: p.bidPerSqm ?? null } : null,
      lotteries: p.kind === 'moch-lottery-project' ? { first: F.firstLottery, last: F.lastLottery, count: (p.lotteries || []).length, programHe: p.programHe || null } : null,
      permit: F.permit, start: F.start, completion: F.completion, occupied: F.occupied,
      latestEvidence: F.lastDatedEvidence, noLaterEvidenceMonths: F.noLaterEvidence ? F.noLaterEvidence.months : null, executionGap: F.executionGap, coverageGap: F.coverageGap, covered: F.covered,
      programme: F.programme, market: F.market, track: F.track, durations: F.durations, plan: F.plan,
      sites: F.sites, rungs: F.rungs, _f: F,
    });
  }
  for (const r of rows) r.quality = qualityOf(r, today);
  rows.sort((a, b) => (TIER_RANK[b.tier] - TIER_RANK[a.tier]) || String(b.landAward ? b.landAward.date : b.lotteries ? b.lotteries.last : '').localeCompare(String(a.landAward ? a.landAward.date : a.lotteries ? a.lotteries.last : '')) || String(a.id).localeCompare(String(b.id)));
  return rows;
}

/* row evidence quality — documented deductions, each reason named; HIGH / MEDIUM / LOW is about the EVIDENCE, never the project */
const QUALITY_REASONS = {
  FRESH: bi('ראיה ציבורית מתוארכת ב-24 החודשים האחרונים', 'dated public evidence within the last 24 months'),
  AGED_24_60: bi('הראיה המתוארכת האחרונה בת 24–60 חודשים', 'the latest dated evidence is 24–60 months old'),
  AGED_60: bi('הראיה המתוארכת האחרונה בת יותר מ-60 חודשים', 'the latest dated evidence is more than 60 months old'),
  NO_DATED: bi('אין ראיה ציבורית מתוארכת', 'no dated public evidence'),
  STALE_SOURCE: bi('השלב נשען על מקור ישן (דיווחי משב״ש, נכון ל-2024-03) או על סטטוס ללא תאריך', 'the stage rests on a stale source (MoCH progress rows, as of 2024-03) or an undated status'),
  DERIVED_LINK: bi('השלב נשען על צירוף נגזר (גוש/חלקה / אתר בקישור חזק)', 'the stage rests on a derived join (block/parcel / a STRONG site link)'),
  DOCUMENT_CHAIN: bi('הפרויקט שייך לקבוצה דרך מסמך משתמש בלבד', 'the project belongs to the group through a user document only'),
};
function qualityOf(r, today) {
  const reasons = [];
  const le = r.latestEvidence; const age = le && le.date ? monthsBetween(le.date, today) : null;
  let level = 'HIGH';
  if (age == null) { level = 'LOW'; reasons.push('NO_DATED'); }
  else if (age > RULES.rowStaleMonths) { level = 'LOW'; reasons.push('AGED_60'); }
  else if (age > RULES.rowFreshMonths) { level = 'MEDIUM'; reasons.push('AGED_24_60'); }
  else reasons.push('FRESH');
  if (r.start.stale || (le && le.asOf)) { if (level === 'HIGH') level = 'MEDIUM'; reasons.push('STALE_SOURCE'); }
  if (r.stageCls === 'DERIVED' && level === 'HIGH') { level = 'MEDIUM'; reasons.push('DERIVED_LINK'); }
  if (r.tier === 'DOCUMENTED') { level = 'LOW'; reasons.push('DOCUMENT_CHAIN'); }
  return { level, reasons, age };
}

/* ------------------------------------------------------------ stage distribution */
function stagesOf(rows) {
  const T = rows.filter(inTotals);
  const out = {};
  for (const u of ['ila', 'moch']) {
    const xs = T.filter((r) => r.universe === u);
    out[u] = { records: xs.length, buckets: Object.fromEntries(BUCKET_IDS.map((b) => { const ys = xs.filter((r) => r.bucket === b); const known = ys.filter((r) => r.units != null); const e = { n: ys.length, units: known.length ? sum(known.map((r) => r.units)) : null, unitsKnown: known.length };
      /* "no later evidence" split: where a covered source could have shown later evidence (the gap rule) vs a coverage gap */
      if (b === 'NO_LATER_EVIDENCE') { e.inCoverage = ys.filter((r) => r.executionGap).length; e.coverageGap = ys.length - e.inCoverage; }
      return [b, e]; })) };
  }
  return { ...out, buckets: STAGE_BUCKETS, cls: 'DERIVED',
    basis: bi('כל פרויקט פעם אחת, בשלב הרחוק ביותר עם ראיה ישירה (רק קישור חזק / מאומת מזיז את הסולם); שני היקומים בנפרד — לעולם לא מחוברים', 'every project once, at its furthest stage with direct evidence (only a STRONG / VERIFIED link moves the ladder); the two universes apart — never added'),
    planningNote: bi('"תכנון" אינו שלב של מגרש: מכרז קרקע מדינה יוצא על תכנית מאושרת; מצב התכנית מוצג לכל מגרש בעומק (XPlan)', '"Planning" is not a stage of a lot: a state-land tender is issued on an approved plan; each lot\'s plan status is shown in the deep dive (XPlan)'),
    universes: UNIVERSE };
}

/* ------------------------------------------------------------ observed execution load */
function loadOf(rows, C, today) {
  const T = rows.filter(inTotals), ila = T.filter((r) => r.universe === 'ila'), moch = T.filter((r) => r.universe === 'moch');
  const ex = ila.filter((r) => r.bucket === 'CONSTRUCTION' || r.bucket === 'ACTIVE_SITE');
  const exU = ex.filter((r) => r.units != null);
  const early = ila.filter((r) => r.bucket === 'LAND'), earlyM = moch.filter((r) => r.bucket === 'MARKETED');
  const since = (n) => addMonths(today, -n);
  const rec = (n) => ila.filter((r) => r.landAward && r.landAward.date && r.landAward.date >= since(n));
  const r12 = rec(12), r24 = rec(24);
  const noLater = T.filter((r) => r.bucket === 'NO_LATER_EVIDENCE');
  const open = T.filter((r) => isOpen(r, today));
  const geos = new Set(open.map((r) => r.localityCode).filter(Boolean));
  const units = (xs) => { const k = xs.filter((r) => r.units != null); return k.length ? sum(k.map((r) => r.units)) : null; };
  return { cls: 'DERIVED', name: bi('עומס ביצוע שנצפה', 'OBSERVED EXECUTION LOAD'),
    executionEvidence: { lots: ex.length, tenders: tendersOf(ex.map((r) => r._f)), localities: new Set(ex.map((r) => r.localityCode)).size, current: ex.filter((r) => r.bucket === 'ACTIVE_SITE').length, startEvidenceOnly: ex.filter((r) => r.bucket === 'CONSTRUCTION').length, staleOnly: ex.filter((r) => r.start.stale).length, units: units(ex), unitsKnownLots: exU.length, ids: ex.map((r) => r.id) },
    earlyStage: { lots: early.length, lotteryProjects: earlyM.length, units: units(early), ids: early.map((r) => r.id).concat(earlyM.map((r) => r.id)) },
    recentlyAwarded: { m12: r12.length, units12: units(r12), m24: r24.length, units24: units(r24) },
    withoutLaterEvidence: { total: noLater.length, ila: noLater.filter((r) => r.universe === 'ila').length, moch: noLater.filter((r) => r.universe === 'moch').length, gapRuleFires: noLater.filter((r) => r.executionGap).length, coverageGap: noLater.filter((r) => !r.executionGap).length },
    simultaneousGeographies: geos.size, openRecords: { ila: open.filter((r) => r.universe === 'ila').length, moch: open.filter((r) => r.universe === 'moch').length },
    cohort: C.load,
    basis: bi('הצנרת הנראית במקורות ש-PROPX מכסה: מגרשים עם ראיה לתחילת בנייה וללא ראיה לגמר; אתר פעיל = ברשימה הנוכחית בקישור חזק', 'the visible pipeline in the sources PROPX covers: lots with construction-start evidence and no completion evidence; an active site = on the current list by a STRONG link'),
    notCapacity: bi('זהו עומס שנצפה — לא "ניצולת קיבולת": היכולת הפנימית של היזם אינה ידועה', 'this is OBSERVED load — not "capacity utilization": the developer\'s true internal capacity is not known'),
    openDefinition: bi(`פתוח = ללא ראיה לגמר / אכלוס, ועם ראיה לביצוע או זכייה / הגרלה ראשונה ב-${RULES.activeMonths} החודשים האחרונים`, `open = no completion / occupancy evidence, and execution evidence or an award / first lottery in the last ${RULES.activeMonths} months`) };
}
function isOpen(r, today) {
  if (r.completion.evidenced || r.occupied.evidenced) return false;
  if (r.bucket === 'CONSTRUCTION' || r.bucket === 'ACTIVE_SITE') return true;
  const d = r.landAward ? r.landAward.date : r.lotteries ? r.lotteries.first : null;
  return !!d && d >= addMonths(today, -RULES.activeMonths);
}

/* ------------------------------------------------------------ historical execution record */
const MEASURES = [
  ['awardToStart', bi('זכייה → תחילת בנייה', 'award → construction start')],
  ['awardToPermit', bi('זכייה → היתר', 'award → permit')],
  ['permitToStart', bi('היתר → תחילת בנייה', 'permit → construction start')],
  ['startToCompletion', bi('תחילת בנייה → גמר', 'construction start → completion')],
  ['planToStart', bi('אישור תכנית → תחילת בנייה', 'plan approval → construction start')],
];
/* a speed label only with a comparison basis: medians over TENDERS (one tender = one observation), own ≥ 3 tenders, comparison ≥ 30 */
const speed = (own, cmp, cmpMin = RULES.cohortMin) => { if (!own || !cmp || own.median == null || cmp.median == null || own.n < RULES.ownMin || cmp.n < cmpMin) return 'NO_COMPARISON_BASIS'; const r = own.median / cmp.median; return r <= RULES.fasterRatio ? 'SHORTER' : r >= RULES.slowerRatio ? 'LONGER' : 'SIMILAR'; };
function historyOf(rows, C, CX = C) {
  const ila = rows.filter(inTotals).filter((r) => r.universe === 'ila');
  const measures = MEASURES.map(([k, label]) => { const xs = ila.filter((r) => r.durations[k] != null); const d = dist(xs.map((r) => r.durations[k])); const awards = xs.map((r) => r.landAward && r.landAward.date).filter(Boolean).sort();
    return { id: k, label, ...d, tenders: tendersOf(xs.map((r) => r._f)), coverage: { withPair: xs.length, lots: ila.length }, period: awards.length ? { from: awards[0], to: awards[awards.length - 1] } : null, ids: xs.map((r) => r.id) }; });
  /* like for like: lots fully observable for the start horizon, the group vs every lot in coverage under the same rule */
  const own = shares(ila.map((r) => r._f));
  const cmpLabel = speed(own.start.monthsByTender, CX.start.monthsByTender);
  /* own prior history: the eligible TENDERS split at the median award date (each half ≥ 3 tenders with a start within the horizon);
     the half's median is over its tenders (each tender = the median of its lots) */
  const elig = ila.filter((r) => r._f.startObservable);
  const tmap = new Map(); for (const r of elig) { const k = r._f.tender || r.id; if (!tmap.has(k)) tmap.set(k, { date: r.landAward.date, rows: [] }); const t = tmap.get(k); t.rows.push(r); if (r.landAward.date < t.date) t.date = r.landAward.date; }
  const tl = [...tmap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let prior = null;
  if (tl.length >= 2 * RULES.ownMin) {
    const half = Math.floor(tl.length / 2), A = tl.slice(0, half), B = tl.slice(half);
    const s = (ts) => { const rs = ts.flatMap((t) => t.rows), st = rs.filter((r) => r._f.startedWithinHorizon); const stT = ts.filter((t) => t.rows.some((r) => r._f.startedWithinHorizon));
      return { eligible: rs.length, eligibleTenders: ts.length, started: st.length, startedTenders: stT.length, share: sh(stT.length, ts.length), months: dist(byTender(st.map((r) => r._f), (f) => f.durations.awardToStart)), from: ts[0].date, to: ts[ts.length - 1].date }; };
    const a = s(A), b = s(B);
    const ok = a.startedTenders >= RULES.ownMin && b.startedTenders >= RULES.ownMin;
    const ratio = ok && a.months.median ? b.months.median / a.months.median : null;
    prior = { earlier: a, later: b, comparable: ok, ratio: ratio != null ? Math.round(ratio * 100) / 100 : null,
      label: !ok ? 'NO_COMPARISON_BASIS' : ratio <= RULES.fasterRatio && b.share >= a.share - 0.1 ? 'IMPROVING' : ratio >= RULES.slowerRatio ? 'LENGTHENING' : 'SIMILAR' };
  }
  /* the locality cohort where it is meaningful: the group's locality with the most eligible lots, cohort ≥ 10 */
  const byLoc = new Map(); for (const r of ila) if (r._f.startObservable) byLoc.set(r.localityCode, (byLoc.get(r.localityCode) || 0) + 1);
  const topLoc = [...byLoc].sort((a, b) => b[1] - a[1])[0];
  let locality = null;
  if (topLoc) { const cmp = CX.localityOf ? CX.localityOf(topLoc[0]) : C.locality.get(String(topLoc[0]));   /* the locality WITHOUT the group's own lots */ const ownL = shares(ila.filter((r) => r.localityCode === topLoc[0]).map((r) => r._f)); const r0 = ila.find((r) => r.localityCode === topLoc[0]);
    if (cmp && cmp.start.eligible >= RULES.localityCohortMin) locality = { localityCode: topLoc[0], city: r0 ? r0.city : null, cityEn: r0 ? r0.cityEn : null, own: ownL.start, cohort: cmp.start, label: speed(ownL.start.monthsByTender, cmp.start.monthsByTender, RULES.localityCohortMin) }; }
  return { cls: 'DERIVED', measures, comparison: { own: own.start, cohort: CX.start, cohortExcludesGroup: CX !== C, label: cmpLabel, rule: `medians over tenders (each tender = the median of its lots): own median ≤ ${RULES.fasterRatio} × cohort → SHORTER · ≥ ${RULES.slowerRatio} × → LONGER · else SIMILAR; own ≥ ${RULES.ownMin} tenders, cohort ≥ ${RULES.cohortMin} tenders; only lots awarded ≥ ${RULES.startHorizonMonths} months before the end of the start evidence's coverage, starts within ${RULES.startHorizonMonths} months` },
    prior, locality, consAsOf: C.consAsOf,
    basis: bi('חודשים בין תאריכים רשמיים של אותו מגרש (הזכייה, ההיתר, תחילת הבנייה, הגמר, אישור התכנית); רק זוגות מתוארכים', 'months between official dates of the same lot (the award, the permit, the construction start, the completion, the plan approval); dated pairs only'),
    limitations: [bi('רק מגרשים עם תחילה מתוארכת נספרים: הטיית בחירה — ההשוואה נעשית רק על מגרשים שניתן היה לראות את תחילתם בחלון מלא', 'only lots with a DATED start count: a selection bias — comparisons use only lots whose start could have been observed over a full window'), bi(`דיווחי משב״ש נעצרים ב-${C.consAsOf}: מחוץ לתל אביב זכיות מאוחרות אינן נמדדות`, `MoCH progress rows stop at ${C.consAsOf}: outside Tel Aviv later awards are not measured`), bi('אינו מדד איכות ואינו דירוג', 'not a quality measure and not a ranking')] };
}

/* ------------------------------------------------------------ signals (deterministic; each with projects, dates, comparison, n, source, class, rule, limitation) */
const LIM = {
  observed: bi('נצפה במקורות ש-PROPX מכסה בלבד (ערוצים ציבוריים) — לא מצבת מלאה', 'observed in the sources PROPX covers only (public channels) — not a complete census'),
  stale: bi('ראיות הבנייה מחוץ לתל אביב נשענות על דיווחי משב״ש שנעצרים ב-2024-03', 'construction evidence outside Tel Aviv rests on MoCH progress rows that stop at 2024-03'),
  notJudgement: bi('תיאור של מה שנצפה — לא שיפוט על הקבוצה', 'a description of what is observed — not a judgement on the group'),
};
function sig(id, kind, cls, text, o) { return { id, kind, cls, text, rule: o.rule, value: o.value ?? null, valueLabel: o.valueLabel ?? null, threshold: o.threshold || null, comparison: o.comparison || null, sampleSize: o.n ?? null, period: o.period || null, projects: (o.projects || []).slice(0, 60), projectsTotal: (o.projects || []).length, source: o.source || 'rmi:michrazim · datagov:moch:construction-progress · lib/dd', limitations: o.limitations || [LIM.observed] }; }
function signalsOf({ rows, C, CX = C, load, history, geo, activity, today }) {
  const S = [];
  const T = rows.filter(inTotals), ila = T.filter((r) => r.universe === 'ila');
  const own = shares(ila.map((r) => r._f));
  const P = history.prior;
  if (P && P.comparable && P.label === 'IMPROVING') S.push(sig('EXECUTION_TIME_IMPROVING', 'info', 'DERIVED', bi(`הזמן מזכייה לתחילת בנייה התקצר: חציון ${P.earlier.months.median} → ${P.later.months.median} חודשים (מגרשים שנזכו ${P.earlier.from}–${P.earlier.to} מול ${P.later.from}–${P.later.to})`, `award → construction start shortened: median ${P.earlier.months.median} → ${P.later.months.median} months (lots awarded ${P.earlier.from}–${P.earlier.to} vs ${P.later.from}–${P.later.to})`),
    { rule: `later half median ≤ ${RULES.fasterRatio} × earlier half median, later started share ≥ earlier − 10 pp; tenders split at the median award date, each half ≥ ${RULES.ownMin} tenders with a start within ${RULES.startHorizonMonths} months; medians over tenders`, value: P.ratio, valueLabel: `×${P.ratio}`, threshold: `≤ ×${RULES.fasterRatio}`, comparison: { basis: 'own prior history', earlier: P.earlier, later: P.later }, n: P.earlier.startedTenders + P.later.startedTenders, period: { from: P.earlier.from, to: P.later.to }, projects: ila.filter((r) => r._f.startedWithinHorizon).map((r) => r.id), limitations: [LIM.observed, LIM.stale] }));
  if (P && P.comparable && P.label === 'LENGTHENING') S.push(sig('EXECUTION_TIME_LENGTHENING', 'watch', 'DERIVED', bi(`הזמן מזכייה לתחילת בנייה התארך: חציון ${P.earlier.months.median} → ${P.later.months.median} חודשים`, `award → construction start lengthened: median ${P.earlier.months.median} → ${P.later.months.median} months`),
    { rule: `later half median ≥ ${RULES.slowerRatio} × earlier half median; tenders split at the median award date, each half ≥ ${RULES.ownMin} tenders with a start within ${RULES.startHorizonMonths} months; medians over tenders`, value: P.ratio, valueLabel: `×${P.ratio}`, threshold: `≥ ×${RULES.slowerRatio}`, comparison: { basis: 'own prior history', earlier: P.earlier, later: P.later }, n: P.earlier.startedTenders + P.later.startedTenders, period: { from: P.earlier.from, to: P.later.to }, projects: ila.filter((r) => r._f.startedWithinHorizon).map((r) => r.id), limitations: [LIM.observed, LIM.stale, LIM.notJudgement] }));
  const E = load.executionEvidence.lots;
  if (E >= RULES.loadMin && load.executionEvidence.tenders >= 2 && C.load.p90 != null && E >= C.load.p90) S.push(sig('HIGH_SIMULTANEOUS_PROJECT_LOAD', 'watch', 'DERIVED', bi(`${E} מגרשים (${load.executionEvidence.tenders} מכרזים, ${load.executionEvidence.localities} יישובים) עם ראיה לתחילת בנייה וללא ראיה לגמר — באחוזון ה-90 ומעלה של הקבוצות (P90 = ${C.load.p90})`, `${E} lots (${load.executionEvidence.tenders} tenders, ${load.executionEvidence.localities} localities) with construction-start evidence and no completion evidence — at or above the 90th percentile of groups (P90 = ${C.load.p90})`),
    { rule: `lots with execution evidence ≥ ${RULES.loadMin}, from ≥ 2 tenders, and ≥ the cohort's P90`, value: E, valueLabel: fmt(E), threshold: `≥ ${RULES.loadMin} · ≥ P90`, comparison: { basis: 'every group with ≥ 1 such lot', p50: C.load.p50, p90: C.load.p90, groups: C.load.groups }, n: E, projects: load.executionEvidence.ids, limitations: [LIM.observed, LIM.stale, bi('עומס שנצפה ≠ ניצולת קיבולת; אינו הוכחה למתיחות יתר', 'observed load ≠ capacity utilization; not proof of over-extension')] }));
  const openL = own.early;
  if (openL.early >= RULES.earlyStageMin && openL.tenders >= 2 && openL.share != null && openL.share >= RULES.earlyStageShare && CX.early.share != null && openL.share >= CX.early.share + RULES.shareMarginPp) S.push(sig('HIGH_EARLY_STAGE_PIPELINE', 'watch', 'DERIVED', bi(`${pct(openL.share)} מהמגרשים הפתוחים (${openL.early} מתוך ${openL.open}) נזכו ב-${RULES.earlyStageMonths} החודשים האחרונים ואין להם ראיה מאוחרת — מול ${pct(CX.early.share)} בשאר המגרשים בכיסוי`, `${pct(openL.share)} of open lots (${openL.early} of ${openL.open}) were awarded in the last ${RULES.earlyStageMonths} months with no later evidence — vs ${pct(CX.early.share)} across the other lots in coverage`),
    { rule: `early (awarded ≤ ${RULES.earlyStageMonths} months, land stage only) ÷ lots without completion evidence ≥ ${RULES.earlyStageShare * 100}% of ≥ ${RULES.earlyStageMin}, and ≥ cohort + ${RULES.shareMarginPp * 100} pp`, value: openL.share, valueLabel: pct(openL.share), threshold: `≥ ${RULES.earlyStageShare * 100}% · ≥ cohort + ${RULES.shareMarginPp * 100} pp`, comparison: { basis: 'every awarded lot in coverage', share: CX.early.share, n: CX.early.open }, n: openL.open, projects: ila.filter((r) => r.stage === 'land-awarded' && r._f.sinceReferenceMonths != null && r._f.sinceReferenceMonths < RULES.earlyStageMonths && !r.completion.evidenced).map((r) => r.id), limitations: [LIM.observed, bi('קרקע שנזכתה ≠ בנייה; מוקדם ≠ בעייתי', 'land won ≠ construction; early ≠ problematic')] }));
  const U = own.unfinished;
  if (U.unfinished >= RULES.unfinishedMin && U.tenders >= 2 && U.share != null && U.share >= RULES.unfinishedShare && CX.unfinished.share != null && U.share >= CX.unfinished.share + RULES.shareMarginPp) S.push(sig('HIGH_UNFINISHED_OBSERVED_PIPELINE', 'watch', 'DERIVED', bi(`${U.unfinished} מגרשים (${pct(U.share)}) עם תחילת בנייה לפני ${RULES.unfinishedStartMonths}+ חודשים מסוף הכיסוי וללא ראיה לגמר — מול ${pct(CX.unfinished.share)} בשאר המגרשים המכוסים`, `${U.unfinished} lots (${pct(U.share)}) with a construction start ${RULES.unfinishedStartMonths}+ months before the end of coverage and no completion evidence — vs ${pct(CX.unfinished.share)} across the other covered lots`),
    { rule: `no completion evidence ÷ lots whose dated start is ≥ ${RULES.unfinishedStartMonths} months before the completion coverage end: ≥ ${RULES.unfinishedShare * 100}% of ≥ ${RULES.unfinishedMin}, and ≥ cohort + ${RULES.shareMarginPp * 100} pp`, value: U.share, valueLabel: pct(U.share), threshold: `≥ ${RULES.unfinishedShare * 100}%`, comparison: { basis: 'every awarded lot in coverage', share: CX.unfinished.share, n: CX.unfinished.eligible }, n: U.eligible, projects: ila.filter((r) => r._f.unfinishedObservable && !r.completion.evidenced).map((r) => r.id), limitations: [LIM.observed, LIM.stale, bi('אין ראיה לגמר ≠ לא הושלם', 'no completion evidence ≠ not completed')] }));
  /* completion — read over lots with a DATED start ≥ 36 months before the coverage end (start and completion from one source), the
     group vs every OTHER such lot; and a separate COVERAGE statement: how many of the group's older lots are in a source that could
     show a completion at all (independent review 19.10.2026 — a share over uncovered lots measures coverage, not execution) */
  const Cp = own.completion, Cc = CX.completion;
  if (Cp.eligible >= RULES.completionMin && Cp.eligibleTenders >= 3 && Cp.share != null && Cc.share != null && Cp.completed >= 3 && Cp.tenders >= 2 && Cp.share >= Math.max(RULES.completionStrongShare, Cc.share + RULES.shareMarginPp))
    S.push(sig('COMPLETION_EVIDENCE_STRONG', 'info', 'DERIVED', bi(`ראיה לגמר ב-${Cp.completed} מתוך ${Cp.eligible} מגרשים שתחילת הבנייה שלהם מתוארכת ${RULES.unfinishedStartMonths}+ חודשים לפני סוף הכיסוי (${pct(Cp.share)}) — מול ${pct(Cc.share)} בשאר המגרשים האלה`, `completion evidence on ${Cp.completed} of ${Cp.eligible} lots whose dated start is ${RULES.unfinishedStartMonths}+ months before the end of coverage (${pct(Cp.share)}) — vs ${pct(Cc.share)} across the other such lots`),
      { rule: `completed ÷ lots with a dated start ≥ ${RULES.unfinishedStartMonths} months before the coverage end ≥ max(${RULES.completionStrongShare * 100}%, the other lots + ${RULES.shareMarginPp * 100} pp); ≥ 3 completions from ≥ 2 tenders, ≥ ${RULES.completionMin} lots from ≥ 3 tenders`, value: Cp.share, valueLabel: pct(Cp.share), threshold: `≥ ${RULES.completionStrongShare * 100}%`, comparison: { basis: 'every other lot with a dated start ≥ 36 months before the coverage end', share: Cc.share, n: Cc.eligible }, n: Cp.eligible, projects: ila.filter((r) => r._f.completionObservable && (r.completion.evidenced || r.occupied.evidenced)).map((r) => r.id), limitations: [LIM.observed, LIM.stale] }));
  const Cv = own.coverage;
  if (Cv.oldLots >= RULES.completionMin && Cv.tenders >= 3 && Cv.share != null && Cv.share < 0.5)
    S.push(sig('LIMITED_COMPLETION_EVIDENCE', 'info', 'DERIVED', bi(`רקורד הגמר מוגבל בכיסוי: רק ${Cv.covered} מתוך ${Cv.oldLots} מגרשים שנזכו לפני ${RULES.oldLotMonths}+ חודשים נמצאים במקור שיכול להראות גמר`, `the completion record is limited by coverage: only ${Cv.covered} of ${Cv.oldLots} lots awarded ${RULES.oldLotMonths}+ months ago are in a source that could show a completion`),
      { rule: `lots awarded ≥ ${RULES.oldLotMonths} months before the read that are in a source able to show a completion (Tel Aviv-Yafo, or a MoCH construction-progress join) ÷ all such lots < 50 %, of ≥ ${RULES.completionMin} lots from ≥ 3 tenders`, value: Cv.share, valueLabel: pct(Cv.share), threshold: '< 50 %', comparison: { basis: 'the same share over every other lot', share: CX.coverage ? CX.coverage.share : null, n: CX.coverage ? CX.coverage.oldLots : null }, n: Cv.oldLots, projects: ila.filter((r) => r._f.oldLot && !r._f.execCovered).map((r) => r.id), limitations: [LIM.observed, bi('רקורד מוגבל ≠ לא הושלם — המקורות אינם יכולים להראות גמר לרוב המגרשים האלה', 'a limited record ≠ not completed — the sources cannot show a completion for most of these lots')] }));
  const A = activity;
  if (A && A.trend === 'accelerating') S.push(sig('RECENT_PROJECT_ACTIVITY_ACCELERATING', 'watch', 'DERIVED', bi(`מכרזים שבהם זכתה הקבוצה: ${A.tenders12} ב-12 החודשים עד תאריך הקריאה (${A.last12} מגרשים) מול ${A.tendersPrior} ב-12 הקודמים (${A.prior12} מגרשים)`, `tenders won: ${A.tenders12} in the 12 months to the read date (${A.last12} lots) vs ${A.tendersPrior} in the prior 12 (${A.prior12} lots)`), { rule: `distinct tenders won: last 12 ≥ 2 × prior 12, max ≥ ${RULES.activityTendersMin} (one tender = one observation; lottery projects shown apart, never added)`, value: A.tenders12, valueLabel: fmt(A.tenders12), threshold: '≥ 2 × prior 12', comparison: { basis: 'own prior 12 months', priorTenders: A.tendersPrior, prior12Lots: A.prior12 }, n: A.tenders12 + A.tendersPrior, period: { from: addMonths(today, -24), to: today }, projects: A.ids12, limitations: [LIM.observed] }));
  if (A && A.trend === 'slowing') S.push(sig('RECENT_PROJECT_ACTIVITY_SLOWING', 'info', 'DERIVED', bi(`מכרזים שבהם זכתה הקבוצה: ${A.tenders12} ב-12 החודשים עד תאריך הקריאה (${A.last12} מגרשים) מול ${A.tendersPrior} ב-12 הקודמים (${A.prior12} מגרשים)`, `tenders won: ${A.tenders12} in the 12 months to the read date (${A.last12} lots) vs ${A.tendersPrior} in the prior 12 (${A.prior12} lots)`), { rule: `distinct tenders won: last 12 ≤ prior 12 ÷ 2, max ≥ ${RULES.activityTendersMin} (one tender = one observation; lottery projects shown apart)`, value: A.tenders12, valueLabel: fmt(A.tenders12), threshold: '≤ prior 12 ÷ 2', comparison: { basis: 'own prior 12 months', priorTenders: A.tendersPrior, prior12Lots: A.prior12 }, n: A.tenders12 + A.tendersPrior, period: { from: addMonths(today, -24), to: today }, projects: A.idsPrior, limitations: [LIM.observed, bi('פחות פעילות בערוצים ציבוריים ≠ פחות פעילות בכלל (קרקע פרטית אינה נצפית)', 'less activity in public channels ≠ less activity overall (private land is not observed)')] }));
  const gapRows = T.filter((r) => r.executionGap);
  if (gapRows.length) S.push(sig('NO_LATER_PUBLIC_EVIDENCE_FOUND', 'info', 'DERIVED', bi(`${gapRows.length} פרויקטים בכיסוי שבו מקור יכול היה להראות ראיה מאוחרת, ולא נמצאה ראיה ציבורית מתוארכת ב-${RULES.noLaterEvidenceMonths}+ חודשים (מתחת לגמר)`, `${gapRows.length} projects where a source in coverage could show later evidence, and no dated public evidence was found for ${RULES.noLaterEvidenceMonths}+ months (below completion)`),
    { rule: `the project DD's evidence-gap rule (≥ ${RULES.noLaterEvidenceMonths} months, below completion, covered geography)`, value: gapRows.length, valueLabel: fmt(gapRows.length), threshold: `≥ ${RULES.noLaterEvidenceMonths} months`, n: T.length, projects: gapRows.map((r) => r.id), limitations: [bi('לא "תקוע", לא "נכשל", לא "מתעכב" — אין כלל ציבורי שמבסס זאת', 'not "stalled", "failed" or "delayed" — no public rule establishes those'), LIM.observed] }));
  if (geo.concentration && geo.concentration.fires) S.push(sig('GROUP_GEOGRAPHIC_CONCENTRATION', 'watch', 'DERIVED', bi(`${pct(geo.concentration.share)} ממגרשי הקבוצה (${geo.concentration.lots} מתוך ${geo.concentration.of}) ביישוב אחד: ${geo.concentration.city || '—'}`, `${pct(geo.concentration.share)} of the group's lots (${geo.concentration.lots} of ${geo.concentration.of}) in one locality: ${geo.concentration.cityEn || geo.concentration.city || '—'}`),
    { rule: `top locality ≥ ${RULES.concentrationShare * 100}% of ≥ ${RULES.concentrationMin} lots`, value: geo.concentration.share, valueLabel: pct(geo.concentration.share), threshold: `≥ ${RULES.concentrationShare * 100}% of ≥ ${RULES.concentrationMin}`, n: geo.concentration.of, projects: ila.filter((r) => r.localityCode === geo.concentration.localityCode).map((r) => r.id), limitations: [bi('ריכוז גבוה פירושו שהתיק הנצפה נשען יותר על שוק אחד; אינו כשלעצמו חולשה פיננסית', 'High concentration means the observed portfolio depends more heavily on one market. It does not by itself indicate financial weakness.'), LIM.observed] }));
  for (const s of S) if (s.valueLabel == null && s.value != null) s.valueLabel = String(s.value);
  return S;
}

/* new observed activity (lots won + first lotteries), last 12 vs prior 12 months — the Developer Intelligence 2.0 trend rule over the group */
function activityOf(rows, today) {
  /* new observed activity, last 12 vs prior 12 months — over DISTINCT ILA TENDERS won (one tender = one observation; independent review
     19.10.2026); first lotteries are counted apart and never added to lots */
  const T = rows.filter(inTotals), ila = T.filter((r) => r.universe === 'ila'), moch = T.filter((r) => r.universe === 'moch');
  const in12 = (d) => !!d && d >= addMonths(today, -12) && d <= today, inPrior = (d) => !!d && d >= addMonths(today, -24) && d < addMonths(today, -12);
  const a = ila.filter((r) => in12(r.landAward && r.landAward.date)), b = ila.filter((r) => inPrior(r.landAward && r.landAward.date));
  const ma = moch.filter((r) => in12(r.lotteries && r.lotteries.first)), mb = moch.filter((r) => inPrior(r.lotteries && r.lotteries.first));
  const x = tendersOf(a.map((r) => r._f)), y = tendersOf(b.map((r) => r._f));
  const trend = x === 0 && y === 0 ? (ma.length || mb.length ? 'insufficient' : 'inactive') : Math.max(x, y) < RULES.activityTendersMin ? 'insufficient' : x >= 2 * y ? 'accelerating' : x <= y / 2 ? 'slowing' : 'steady';
  return { last12: a.length, prior12: b.length, tenders12: x, tendersPrior: y, lotteries12: ma.length, lotteriesPrior: mb.length, trend, ids12: a.map((r) => r.id), idsPrior: b.map((r) => r.id),
    rule: 'distinct ILA tenders won: max(last 12, prior 12) < 3 → insufficient · last ≥ 2 × prior → accelerating · last ≤ prior ÷ 2 → slowing · else steady; first lotteries shown apart, never added', cls: 'DERIVED' };
}

/* ------------------------------------------------------------ geography */
function geographyOf(rows, today) {
  const T = rows.filter(inTotals);
  const agg = (keyOf, labelOf) => { const m = new Map(); for (const r of T) { const k = keyOf(r); if (k == null) continue; if (!m.has(k)) m.set(k, { key: k, label: labelOf(r), ila: { n: 0, units: 0, unitsKnown: 0 }, moch: { n: 0, units: 0, unitsKnown: 0 }, first: null, last: null }); const e = m.get(k), u = e[r.universe]; u.n++; if (r.units != null) { u.units += r.units; u.unitsKnown++; } const d = r.landAward ? r.landAward.date : r.lotteries ? r.lotteries.first : null; if (d) { if (!e.first || d < e.first) e.first = d; if (!e.last || d > e.last) e.last = d; } }
    return [...m.values()].map((e) => ({ ...e, ila: { ...e.ila, units: e.ila.unitsKnown ? e.ila.units : null }, moch: { ...e.moch, units: e.moch.unitsKnown ? e.moch.units : null } })).sort((a, b) => b.ila.n - a.ila.n || b.moch.n - a.moch.n || String(a.key).localeCompare(String(b.key))); };   /* ranked by lots, then lottery projects — never by their sum */
  const byLocality = agg((r) => r.localityCode, (r) => ({ he: r.city, en: titleCase(r.cityEn || r.city) }));
  const byDistrict = agg((r) => r.district || 'unknown', (r) => districtLabel(r.district));
  const ila = T.filter((r) => r.universe === 'ila');
  const ilaUnits = ila.filter((r) => r.units != null), totalUnits = sum(ilaUnits.map((r) => r.units));
  const topCityUnits = [...byLocality].filter((e) => e.ila.units != null).sort((a, b) => b.ila.units - a.ila.units)[0] || null;
  const topDistrict = [...byDistrict].sort((a, b) => b.ila.n - a.ila.n)[0] || null;
  const topLotsCity = [...byLocality].sort((a, b) => b.ila.n - a.ila.n)[0] || null;
  /* new locality entries: a locality whose first observed group activity falls inside the window, for a group active elsewhere before it */
  const firstEver = T.map((r) => (r.landAward ? r.landAward.date : r.lotteries ? r.lotteries.first : null)).filter(Boolean).sort()[0] || null;
  const entries = Object.fromEntries(RULES.entryWindows.map((n) => { const from = addMonths(today, -n); return ['m' + n, firstEver && firstEver < from ? byLocality.filter((e) => e.first && e.first >= from).map((e) => ({ localityCode: e.key, city: e.label.he, cityEn: e.label.en, date: e.first })) : []]; }));
  const conc = topLotsCity && ila.length ? { localityCode: topLotsCity.key, city: topLotsCity.label.he, cityEn: topLotsCity.label.en, lots: topLotsCity.ila.n, of: ila.length, share: sh(topLotsCity.ila.n, ila.length) } : null;
  if (conc) { conc.tenders = tendersOf(ila.map((r) => r._f)); conc.fires = conc.of >= RULES.concentrationMin && conc.share >= RULES.concentrationShare && conc.tenders >= RULES.concentrationTendersMin; }
  const topLottery = [...byLocality].filter((e) => e.moch.n).sort((a, b) => b.moch.n - a.moch.n)[0] || null;
  return { cls: 'DERIVED', byDistrict, byLocality, top3: byLocality.slice(0, 3).map((e) => ({ localityCode: e.key, city: e.label.he, cityEn: titleCase(e.label.en), ila: e.ila.n, moch: e.moch.n })),
    topLottery: topLottery ? { localityCode: topLottery.key, city: topLottery.label.he, cityEn: titleCase(topLottery.label.en), moch: topLottery.moch.n } : null,
    largestCityUnitsShare: topCityUnits && totalUnits ? { localityCode: topCityUnits.key, city: topCityUnits.label.he, cityEn: topCityUnits.label.en, units: topCityUnits.ila.units, of: totalUnits, share: sh(topCityUnits.ila.units, totalUnits), lotsWithUnits: ilaUnits.length } : null,
    largestDistrictProjectsShare: topDistrict && ila.length ? { district: topDistrict.key, label: topDistrict.label, lots: topDistrict.ila.n, of: ila.length, share: sh(topDistrict.ila.n, ila.length) } : null,
    concentration: conc, entries,
    statement: bi('ריכוז גבוה פירושו שהתיק הנצפה נשען יותר על שוק אחד; אינו כשלעצמו חולשה פיננסית', 'High concentration means the observed portfolio depends more heavily on one market. It does not by itself indicate financial weakness.'),
    basis: bi('מגרשי רמ״י לפי יח״ד ומספר; פרויקטי הגרלה בנפרד; כניסה ליישוב = פעילות ראשונה שנצפתה בחלון, לקבוצה שהייתה פעילה במקום אחר לפני כן', 'ILA lots by units and count; lottery projects apart; a locality entry = the first observed activity inside the window, for a group active elsewhere before it') };
}

/* ------------------------------------------------------------ programme / business-model exposure */
function programmeOf(rows) {
  const T = rows.filter(inTotals), ila = T.filter((r) => r.universe === 'ila'), moch = T.filter((r) => r.universe === 'moch');
  const blk = (xs, of) => { const k = xs.filter((r) => r.units != null); const ds = xs.map((r) => (r.landAward ? r.landAward.date : r.lotteries ? r.lotteries.first : null)).filter(Boolean).sort(); return { n: xs.length, units: k.length ? sum(k.map((r) => r.units)) : null, unitsKnown: k.length, share: sh(xs.length, of), period: ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null }; };
  const row = (id, ilaXs, mochXs, extra = {}) => ({ id, label: PROGRAMMES[id], ila: ilaXs ? blk(ilaXs, ila.length) : null, moch: mochXs ? blk(mochXs, moch.length) : null, available: true, ...extra });
  return { cls: 'OBSERVED', rows: [
    row('OPEN_MARKET', ila.filter((r) => r.programme === 'OPEN_MARKET'), null, { coverage: bi('מסלול השיווק של רמ״י', 'the ILA marketing track') }),
    row('SUBSIDIZED', ila.filter((r) => r.programme === 'SUBSIDIZED'), moch, { coverage: bi('מסלולי רמ״י המסובסדים + פרויקטי ההגרלה של משב״ש (מחיר למשתכן / מחיר מטרה)', 'the ILA subsidized tracks + MoCH lottery projects (subsidized-price programmes)') }),
    row('LONG_TERM_RENTAL', ila.filter((r) => r.programme === 'LONG_TERM_RENTAL'), null, { coverage: bi('מסלול השכרה של רמ״י — יח״ד המכרז הן סה״כ המכרז, לא "יחידות להשכרה"', 'the ILA rental track — tender units are the tender total, not "rental units"') }),
    { id: 'URBAN_RENEWAL', label: PROGRAMMES.URBAN_RENEWAL, ila: null, moch: null, available: false, reason: bi('מתחם התחדשות מוכרז אינו משויך ליזם במקור (משב״ש) — חשיפה להתחדשות עירונית אינה נצפית', 'a declared renewal complex is not attributed to a developer by the source (MoCH) — urban-renewal exposure is not observed') },
    row('STATE_LAND', ila, null, { coverage: bi('כל מגרש של רמ״י הוא קרקע מדינה; פרויקטי ההגרלה אינם מציינים את סוג הקרקע', 'every ILA lot is state land; lottery projects do not state the land type') }),
    { id: 'PRIVATE_LAND', label: PROGRAMMES.PRIVATE_LAND, ila: null, moch: null, available: false, reason: bi('PROPX צופה בערוצים ציבוריים בלבד — פעילות על קרקע פרטית אינה נצפית ולעולם אינה מוסקת', 'PROPX observes public channels only — private-land activity is not observed and never inferred') },
    row('OTHER', ila.filter((r) => r.programme === 'OTHER'), null, { coverage: bi('מסלולי רמ״י אחרים (שימוש מעורב ועוד)', 'other ILA tracks (mixed use and more)') }),
  ], basis: bi('המסלול כפי שהמקור רושם אותו — לעולם לא משם החברה; נתח = בתוך היקום (מגרשים / פרויקטי הגרלה)', 'the track as the source records it — never from the company name; share = within the universe (lots / lottery projects)') };
}

/* ------------------------------------------------------------ land pipeline */
function landOf(rows, K, today) {
  const T = rows.filter(inTotals), ila = T.filter((r) => r.universe === 'ila');
  const w = (n) => { const xs = ila.filter((r) => r.landAward.date && r.landAward.date >= addMonths(today, -n)); const u = xs.filter((r) => r.units != null); const comp = xs.filter((r) => r.landAward.priceBasis === 'competitive-bid' && r.landAward.sum != null); return { lots: xs.length, units: u.length ? sum(u.map((r) => r.units)) : null, competitiveSum: comp.length ? sum(comp.map((r) => r.landAward.sum)) : null, competitiveLots: comp.length }; };
  const lpu = (xs) => { const c = xs.filter((r) => r.landAward.priceBasis === 'competitive-bid' && r.landAward.sum != null && r.units); return c.length ? { value: Math.round(sum(c.map((r) => r.landAward.sum)) / sum(c.map((r) => r.units))), lots: c.length } : null; };
  const recent36 = ila.filter((r) => r.landAward.date && r.landAward.date >= addMonths(today, -36));
  const byMarket = Object.fromEntries(['open', 'subsidized', 'rental', 'other'].map((m) => { const xs = ila.filter((r) => r.market === m); const u = xs.filter((r) => r.units != null); return [m, { lots: xs.length, units: u.length ? sum(u.map((r) => r.units)) : null }]; }));
  /* re-tenders through the Authority's lot file id only (lib/land/lineage.js) — attributable to a lot the group won */
  const before = [], after = [];
  try {
    const LQ = require('../land/query'); const C = LQ.load(); const ln = LQ.lineageOf(C);
    for (const r of ila) {
      const me = ln.byTender.get(r.tenderId); if (!me) continue;
      for (const l of me.predecessors) if (['re-tender', 'unawarded-lot-re-marketed', 'round-after-closing'].includes(l.relation) && (l.sharedLots || []).map(String).includes(String(r.lotId))) before.push({ id: r.id, from: l.from, relation: l.relation, fromDate: l.fromDate });
      for (const l of me.successors) if (l.relation === 'awarded-lot-re-marketed' && (l.sharedLots || []).map(String).includes(String(r.lotId))) after.push({ id: r.id, to: l.to, relation: l.relation, toDate: l.toDate });
    }
  } catch { /* the land read model is not loadable here */ }
  const awards = ila.map((r) => r.landAward.date).filter(Boolean).sort();
  return { cls: 'OFFICIAL', source: 'rmi:michrazim', lotsWon: ila.length, unitsAwarded: ila.some((r) => r.units != null) ? sum(ila.filter((r) => r.units != null).map((r) => r.units)) : null, unitsKnownLots: ila.filter((r) => r.units != null).length,
    cities: new Set(ila.map((r) => r.localityCode).filter(Boolean)).size, latestAward: awards.length ? awards[awards.length - 1] : null, firstAward: awards[0] || null,
    windows: { m12: w(12), m24: w(24), m36: w(36) }, byMarket,
    landPerUnit: { all: lpu(ila), m36: lpu(recent36), basis: bi('Σ סכומי זכייה ÷ Σ יח״ד על אותם מגרשים במחיר תחרותי שמפרסמים יח״ד; מע״מ לא צוין במקור', 'Σ winning sums ÷ Σ units over the same competitive-bid lots that publish units; VAT not stated by the source'), cls: 'DERIVED' },
    perSqmLots: ila.filter((r) => r.landAward.priceBasis === 'price-per-sqm-bid').length, fixedPriceLots: ila.filter((r) => r.landAward.priceBasis === 'fixed-price-allocation').length,
    reTenders: { wonAfterEarlierMarketing: before, laterReMarketed: after, basis: bi('דרך מזהה תיק המגרש (TikID) בלבד; הסיבה אינה ידועה ולעולם אינה מיוחסת ליזם', 'through the lot file id (TikID) only; the reason is not known and is never attributed to the developer') },
    truths: [bi('קרקע שנזכתה ≠ פרויקט בבנייה', 'LAND WON ≠ PROJECT UNDER CONSTRUCTION'), bi('צנרת קרקע ≠ הכנסות', 'LAND PIPELINE ≠ REVENUE'), bi('יח״ד שנזכו ≠ יח״ד שנמכרו', 'UNITS AWARDED ≠ UNITS SOLD')] };
}

/* ------------------------------------------------------------ concentration matrix */
function matrixOf(rows) {
  const T = rows.filter(inTotals);
  const build = (keyOf, labelOf) => { const m = new Map(); for (const r of T) { const k = keyOf(r); if (!m.has(k)) m.set(k, { key: k, label: labelOf(r), cells: Object.fromEntries(BUCKET_IDS.map((b) => [b, { ila: 0, moch: 0 }])) }); m.get(k).cells[r.bucket][r.universe]++; } return [...m.values()].sort((a, b) => sum(BUCKET_IDS.map((x) => b.cells[x].ila + b.cells[x].moch)) - sum(BUCKET_IDS.map((x) => a.cells[x].ila + a.cells[x].moch))); };
  const geography = build((r) => r.district || 'unknown', (r) => districtLabel(r.district));
  const locality = build((r) => r.localityCode || 'unknown', (r) => ({ he: r.city, en: titleCase(r.cityEn || r.city) })).slice(0, 12);
  const programme = build((r) => r.programme, (r) => PROGRAMMES[r.programme] || { he: r.programme, en: r.programme });
  /* the one deterministic observation the matrix makes: a single locality × stage cell holding ≥ 50% of the group's records at that stage (≥ 5) */
  const observations = [];
  for (const b of BUCKET_IDS) for (const u of ['ila', 'moch']) { const tot = T.filter((r) => r.bucket === b && r.universe === u).length; if (tot < RULES.matrixCellMin) continue;
    const top = locality.map((e) => ({ e, n: e.cells[b][u] })).sort((x, y) => y.n - x.n)[0];
    if (top && top.n / tot >= RULES.matrixCellShare && top.n >= RULES.matrixCellMin) observations.push({ id: 'MATRIX_CELL_CONCENTRATION', bucket: b, universe: u, localityCode: top.e.key, label: top.e.label, n: top.n, of: tot, share: sh(top.n, tot), rule: bi(`יישוב אחד מחזיק ≥ ${RULES.matrixCellShare * 100}% מ${u === 'ila' ? 'מגרשי' : 'פרויקטי ההגרלה של'} הקבוצה בשלב "${STAGE_BUCKETS.find((x) => x.id === b).label.he}" (≥ ${RULES.matrixCellMin})`, `one locality holds ≥ ${RULES.matrixCellShare * 100}% of the group's ${u === 'ila' ? 'lots' : 'lottery projects'} at the "${STAGE_BUCKETS.find((x) => x.id === b).label.en}" stage (≥ ${RULES.matrixCellMin})`), cls: 'DERIVED' }); }
  return { cls: 'DERIVED', buckets: BUCKET_IDS, geography, locality, programme, observations, basis: bi('ספירות רשומות לפי שלב רחוק ביותר; מגרשים ופרויקטי הגרלה בנפרד; מסקנה רק מכלל דטרמיניסטי מתועד', 'record counts by furthest stage; lots and lottery projects apart; a conclusion only from a documented deterministic rule') };
}

/* ------------------------------------------------------------ the project part of the group timeline */
function projectEventsOf(rows, geo) {
  const ev = [];
  const add = (date, kind, label, o = {}) => { if (date) ev.push({ date: String(date).slice(0, 10), kind, label, ...o }); };
  const seenPlan = new Set();
  for (const r of rows.filter(inTotals)) {
    const where = { he: r.city || '', en: r.cityEn || r.city || '' };
    if (r.landAward) add(r.landAward.date, 'land-win', bi(`זכייה במגרש ${r.label} · ${where.he}${r.units != null ? ` · ${fmt(r.units)} יח״ד` : ''}`, `lot won ${r.label} · ${where.en}${r.units != null ? ` · ${fmt(r.units)} units` : ''}`), { id: r.id, cls: 'OFFICIAL', source: 'rmi:michrazim' });
    if (r.lotteries && r.lotteries.first) add(r.lotteries.first, 'first-lottery', bi(`הגרלה ראשונה · ${r.label} · ${where.he}`, `first lottery · ${r.label} · ${where.en}`), { id: r.id, cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries' });
    if (r.plan && r.plan.date && !seenPlan.has(r.plan.plan)) { seenPlan.add(r.plan.plan); add(r.plan.date, 'plan-approved', bi(`אישור תכנית ${r.plan.plan} (XPlan)`, `plan ${r.plan.plan} approved (XPlan)`), { id: r.id, cls: 'OFFICIAL', source: 'xplan' }); }
    if (r.permit.date) add(r.permit.date, 'permit', bi(`היתר · ${r.label}`, `permit · ${r.label}`), { id: r.id, cls: 'OFFICIAL', source: r.permit.source });
    if (r.start.date) add(r.start.date, 'construction-start', bi(`תחילת בנייה · ${r.label}${r.start.stale ? ' (דיווח משב״ש, ישן)' : ''}`, `construction start · ${r.label}${r.start.stale ? ' (MoCH report, STALE)' : ''}`), { id: r.id, cls: r.stageCls === 'OFFICIAL' ? 'OFFICIAL' : 'DERIVED', source: r.start.source });
    else if (r.start.asOf && r.start.evidenced) add(r.start.asOf, 'active-site', bi(`אתר פעיל נראה ב-PROPX · ${r.label} (תצפית PROPX, לא תאריך מקור)`, `active site seen by PROPX · ${r.label} (a PROPX observation, not a source date)`), { id: r.id, cls: 'OBSERVED', source: 'datagov:labor:active-construction-sites', propxObserved: true });
    if (r.completion.date) add(r.completion.date, 'completion', bi(`גמר · ${r.label}`, `completion · ${r.label}`), { id: r.id, cls: 'DERIVED', source: r.completion.source });
  }
  for (const e of [...geo.byLocality]) if (e.first) add(e.first, 'locality-entry', bi(`פעילות ראשונה שנצפתה ב${e.label.he || e.key}`, `first observed activity in ${e.label.en || e.key}`), { localityCode: e.key, cls: 'DERIVED', source: 'lib/group' });
  return ev;
}

module.exports = { DISTRICTS, districtLabel, rowsOf, qualityOf, QUALITY_REASONS, stagesOf, loadOf, historyOf, signalsOf, activityOf, geographyOf, programmeOf, landOf, matrixOf, projectEventsOf, isOpen, inTotals, MEASURES, median };
