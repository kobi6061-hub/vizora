// PROPX · INSTITUTIONAL DILIGENCE SUMMARY (Premium Diligence 2.0, 18.10.2026) — the compact top section of every developer /
// project read. Twelve rows in a fixed order, each a declarative sentence with ONE evidence class:
//   VERIFIED (an official record, by an exact key) · DERIVED (computed or matched by a stated rule) · SELF_REPORTED (what the
//   developer reported, through a user document) · USER_DOCUMENT (a document the user provided) · MISSING (no source) ·
//   CONFLICT (sources disagree — both kept).
// Composed only from the read models already computed for the entity; it adds no fact and no score.
'use strict';

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-summary-v1', effective: '2026-10-18' });
const ROWS = Object.freeze(['identity', 'resolution', 'projectStage', 'execution', 'financial', 'corporateLegal', 'sales', 'risks', 'gaps', 'nextBest', 'watch']);
const LABEL = Object.freeze({
  identity: bi('זהות', 'IDENTITY'), resolution: bi('מצב זיהוי הישות', 'ENTITY RESOLUTION STATUS'), projectStage: bi('שלב הפרויקט', 'PROJECT STAGE'), execution: bi('ביצוע היזם', 'DEVELOPER EXECUTION'),
  financial: bi('חוסן פיננסי', 'FINANCIAL RESILIENCE'), corporateLegal: bi('תאגידי / משפטי', 'CORPORATE / LEGAL'), sales: bi('מכירות / מסחרי', 'SALES / COMMERCIAL'),
  risks: bi('סיכונים מרכזיים', 'KEY RISKS'), gaps: bi('פערים מרכזיים', 'KEY GAPS'), nextBest: bi('הראיה הבאה הטובה ביותר', 'NEXT BEST EVIDENCE'), watch: bi('מעקב', 'WATCH STATUS'),
});
const TERM = Object.freeze({ identity: 'legal_company', resolution: 'entity_match_state', projectStage: 'dd_stage_ladder', execution: 'execution_velocity', financial: 'public_financial_profile', corporateLegal: 'legal_exposure_public',
  sales: 'sales_progress', risks: 'risk_gap_brief', gaps: 'risk_gap_brief', nextBest: 'dd_next_best_evidence', watch: 'watch_contract' });
const STAGE = { 'land-awarded': bi('קרקע נזכתה', 'land awarded'), marketed: bi('שווק', 'marketed'), permitted: bi('היתר', 'permitted'), 'construction-started': bi('תחילת בנייה', 'construction started'), completed: bi('גמר', 'completed'), occupied: bi('אכלוס', 'occupied') };
const STATE = { VERIFIED: bi('מאומת', 'VERIFIED'), STRONG_MATCH: bi('התאמה חזקה', 'STRONG MATCH'), POSSIBLE_MATCH: bi('התאמה אפשרית', 'POSSIBLE'), AMBIGUOUS: bi('רב-משמעי', 'AMBIGUOUS'), UNRESOLVED: bi('לא נפתר', 'UNRESOLVED') };
const row = (id, cls, he, en, extra = {}) => ({ id, label: LABEL[id], cls, he, en, term: TERM[id], ...extra });
/* the roles a STRONG-MATCH project company rests on (projectco whyThis) — the identity row names them, so a land winner is never
   presented as a verified project company (UX acceptance review 19.10.2026) */
const ROLE = { LAND_WINNER: bi('זוכה הקרקע', 'land winner'), PROGRAMME_DEVELOPER: bi('יזם התכנית', 'programme developer'), PERMIT_HOLDER: bi('בעל ההיתר', 'permit holder'),
  PROJECT_COMPANY_PER_DOCUMENT: bi('לפי מסמך משתמש', 'per a user document') };
const rolesOf = (pc, L) => [...new Set(((pc.whyThis && pc.whyThis.support) || []).map((x) => x.role))].map((r) => (ROLE[r] || bi(r, r))[L]).join(' + ');

function summarize(read) {
  const X = read || {}, P = X.premium || {}, isP = X.kind === 'project';
  const D = isP ? (X.devDD || null) : X.dd, PD = isP ? X.dd : null;
  const out = [];
  const res = D ? D.identity.resolution : null, company = res && res.chosen;
  /* identity */
  if (isP) { const pc = P.projectCompany; const conflict = pc && pc.conflicts && pc.conflicts.length;
    const cands = pc && !pc.company ? [...new Set(((pc.roles && pc.roles.perDocument) || []).concat(pc.evidence || []).filter((e) => e && (e.number || (e.company && e.company.number))).map((e) => (e.company && e.company.number) || e.number))] : [];
    out.push(row('identity', pc && pc.state === 'STRONG_MATCH' ? (pc.cls === 'USER_DOCUMENT' ? 'USER_DOCUMENT' : 'DERIVED') : pc && pc.state === 'VERIFIED' ? 'VERIFIED' : conflict ? 'CONFLICT' : 'MISSING',
    `${PD.identity.ids.project}${pc && pc.company && pc.state !== 'VERIFIED' ? ` · ${rolesOf(pc, 'he') || 'רשומות'}: ${pc.company.name} (${pc.company.number}) — ${STATE[pc.state].he} · חברת הפרויקט לא אומתה (ייתכן שהפרויקט בחברה ייעודית)` : pc && pc.company ? ` · חברת הפרויקט: ${pc.company.name} (${pc.company.number}) — ${STATE[pc.state].he}` : conflict ? ` · חברת הפרויקט: רשומות נוקבות בחברות שונות (${pc.conflicts[0].companies.map((c) => c.number).join(' / ')}) — לא נבחרה` : cands.length ? ` · חברת הפרויקט: מועמד בלבד (${cands.join(' / ')}) — ${STATE[pc.state].he}` : ' · חברת הפרויקט אינה מזוהה'}`,
    `${PD.identity.ids.project}${pc && pc.company && pc.state !== 'VERIFIED' ? ` · ${rolesOf(pc, 'en') || 'records'}: ${pc.company.name} (${pc.company.number}) — ${STATE[pc.state].en} · project company not verified (the project may sit in an SPV)` : pc && pc.company ? ` · project company: ${pc.company.name} (${pc.company.number}) — ${STATE[pc.state].en}` : conflict ? ` · project company: records name different companies (${pc.conflicts[0].companies.map((c) => c.number).join(' / ')}) — none picked` : cands.length ? ` · project company: a candidate only (${cands.join(' / ')}) — ${STATE[pc.state].en}` : ' · the project company is not identified'}`)); }
  else out.push(row('identity', res && res.state === 'VERIFIED' ? 'VERIFIED' : company ? 'DERIVED' : res && res.state === 'AMBIGUOUS' ? 'CONFLICT' : 'MISSING',
    company ? `${D.identity.observedName} → ${company.name} (${company.number})` : `${D.identity.observedName} — לא נקשר לחברה רשומה`,
    company ? `${D.identity.observedName} → ${company.name} (${company.number})` : `${D.identity.observedName} — not linked to a registered company`));
  /* resolution */
  if (res) { const basis = res.basis === 'contractor-register' ? bi(' · דרך פנקס הקבלנים', ' · through the contractors register') : res.basis === 'user-provided-key' ? bi(' · מספר שסיפק המשתמש', ' · a user-provided number') : bi('', '');
    out.push(row('resolution', res.state === 'VERIFIED' ? 'VERIFIED' : res.state === 'AMBIGUOUS' ? 'CONFLICT' : res.state === 'UNRESOLVED' ? 'MISSING' : 'DERIVED', `היזם: ${STATE[res.state].he}${basis.he}`, `developer: ${STATE[res.state].en}${basis.en}`, { state: res.state })); }
  else out.push(row('resolution', 'MISSING', 'אין יזם לפתור', 'no developer to resolve'));
  /* project stage */
  if (isP) { const f = PD.ladder && PD.ladder.furthest; const r = f ? (PD.ladder.rungs || []).find((x) => x.stage === f) : null;
    /* VERIFIED only when the rung rests on the project's own official record (exact keys); a rung moved by a STRONG site / permit
       link or by the MoCH progress report's block / parcel join is DERIVED — said so */
    const official = !!(r && r.evidenced && !r.ddEvidenced && !/construction-progress/.test(String(r.source || '')));
    const via = r && !official ? bi(' · דרך קישור חזק — לא רשומה רשמית של הפרויקט', ' · through a STRONG link — not the project\'s own official record') : bi('', '');
    out.push(row('projectStage', !f ? 'MISSING' : official ? 'VERIFIED' : 'DERIVED', f ? `השלב הרחוק עם ראיה ישירה: ${STAGE[f].he}${r && r.coverage ? ` (${r.coverage.he || ''})` : ''}${via.he}` : 'אין ראיה לשלב', f ? `furthest stage with direct evidence: ${STAGE[f].en}${r && r.coverage ? ` (${r.coverage.en || ''})` : ''}${via.en}` : 'no stage evidence')); }
  else out.push(row('projectStage', null, 'ראו את סולם השלבים של כל מגרש (בכרטיס הפרויקט)', 'see each lot\'s stage ladder (in the project card)'));
  /* execution */
  if (D) { const E = D.execution || {}, V = E.velocity || {}; out.push(row('execution', V.measurable ? 'DERIVED' : 'MISSING',
    V.measurable ? `חציון ${V.medianMonths} חודשים מזכייה לתחילת בנייה (n=${V.n})${V.comparison ? ` · כלל המגרשים ${V.comparison.medianMonths} (n=${V.comparison.n})` : ''}` : 'מהירות ביצוע אינה נמדדת (פחות מ-3 זוגות מתוארכים)',
    V.measurable ? `median ${V.medianMonths} months award → construction start (n=${V.n})${V.comparison ? ` · all lots ${V.comparison.medianMonths} (n=${V.comparison.n})` : ''}` : 'execution velocity not measured (fewer than 3 dated pairs)')); }
  /* financial */
  const F = P.financial;
  if (F && !F.latest && F.conflicts && F.conflicts.length) out.push(row('financial', 'CONFLICT', `ח.פ. ${F.entityNumber}: ${F.statement.he}`, `company ${F.entityNumber}: ${F.statement.en}`));
  else if (F && F.latest) out.push(row('financial', F.conflicts && F.conflicts.length ? 'CONFLICT' : 'USER_DOCUMENT', `ח.פ. ${F.entityNumber}: פרופיל מדוח ${F.latest.period.end} (מסמך משתמש) · ${F.flags.filter((x) => x.id !== 'INSUFFICIENT_FINANCIAL_DATA').length} דגלים${F.spvNote ? ' · ' + F.spvNote.he : ''}`, `company ${F.entityNumber}: profile from the ${F.latest.period.end} statement (user document) · ${F.flags.filter((x) => x.id !== 'INSUFFICIENT_FINANCIAL_DATA').length} flags${F.spvNote ? ' · ' + F.spvNote.en : ''}`));
  else out.push(row('financial', 'MISSING', 'אין דוחות כספיים קריאים למכונה בכיסוי (מקורות ציבוריים חסומים) — אינו "חולשה"', 'no machine-readable financial statements in coverage (public sources blocked) — not "weakness"'));
  /* corporate / legal */
  const L = P.legal;
  /* the record of the company the read is about: the project company's own when it is another company, else the developer's;
     VERIFIED only when that company's identity is verified by number — a name match is DERIVED, a document's company USER_DOCUMENT */
  const PCR = isP && P.projectCompanyRecord ? P.projectCompanyRecord : null;
  const CORP = PCR ? PCR.corporate : company && D.corporate && D.corporate.state === 'RESOLVED' ? D.corporate : null;
  if (CORP) { const st = CORP.registeredStatus; const c = CORP.filings && CORP.filings.counts || {}; const fc = CORP.filings && CORP.filings.notChecked;
    const whose = PCR ? bi(`חברת הפרויקט ${PCR.company.name} (${PCR.company.number}): `, `project company ${PCR.company.name} (${PCR.company.number}): `) : bi('', '');
    const cls = PCR ? (P.projectCompany && P.projectCompany.cls === 'USER_DOCUMENT' ? 'USER_DOCUMENT' : 'DERIVED') : res && res.state === 'VERIFIED' ? 'VERIFIED' : 'DERIVED';
    out.push(row('corporateLegal', cls, `${whose.he}${st.verbatim || '—'}${st.sub ? ' · ' + st.sub : ''} · ${fc ? 'שעבודים: לא נבדק' : `${c.chargeRegistered || 0} רישומי שעבוד`} · ${L ? L.statement.he : ''}`, `${whose.en}${(st.label && st.label.en) || st.verbatim || '—'}${st.sub ? ' · ' + st.sub : ''} · ${fc ? 'charges: not checked' : `${c.chargeRegistered || 0} charge registrations`} · ${L ? L.statement.en : ''}`)); }
  else out.push(row('corporateLegal', 'MISSING', 'אין חברה רשומה פתורה — רשומה תאגידית לא נבנתה', 'no resolved legal company — no corporate record composed'));
  /* sales */
  const S = P.sales;
  if (isP && S) { const rep = S.rows.filter((r) => r.kind === 'SALES_REPORT').slice(-1)[0], off = S.rows.find((r) => r.kind === 'PROGRAMME_LOTTERY');   /* the LATEST report (rows are by date) */
    out.push(rep ? row('sales', rep.reportedBy === 'developer' ? 'SELF_REPORTED' : 'USER_DOCUMENT', `${rep.unitsSold ?? '—'} יח״ד נמכרו מתוך ${rep.unitsMarketed ?? '—'} ששווקו (נכון ל-${rep.date}; ${rep.classLabel.he})`, `${rep.unitsSold ?? '—'} units sold of ${rep.unitsMarketed ?? '—'} marketed (as of ${rep.date}; ${rep.classLabel.en})`)
      : off ? row('sales', 'VERIFIED', `הגרלת התכנית: ${off.unitsOffered ?? '—'} יח״ד הוצעו · ${off.winners ?? '—'} זוכים (הגרלה ≠ מכירה)`, `programme lottery: ${off.unitsOffered ?? '—'} units offered · ${off.winners ?? '—'} winners (a lottery ≠ a sale)`)
      : row('sales', 'MISSING', 'אין נתוני מכירות ברמת הפרויקט במקורות הציבוריים', 'no project-level sales data in public sources')); }
  else out.push(row('sales', 'MISSING', 'מכירות נמדדות ברמת הפרויקט בלבד', 'sales are read at project level only'));
  /* risks */
  const risks = [].concat((D && D.signals || []).filter((s) => s.kind === 'risk').map((s) => s.text), (F && F.flags || []).filter((x) => /LEVERAGE|LIQUIDITY_WEAK|NEAR_TERM|NEGATIVE|GOING_CONCERN|DOWNGRADE/.test(x.id)).map((x) => x.text),
    (L && L.items || []).filter((i) => i.cls === 'OFFICIAL' && (i.kind === 'INSOLVENCY_PROCEEDING' || (i.kind === 'LIQUIDATION_CASE' && i.open))).map((i) => i.label),
    (L && L.items || []).filter((i) => i.kind === 'DISCLOSED_LITIGATION' && (i.subKind === 'insolvency' || i.subKind === 'receivership')).map((i) => bi(`גילוי במסמך משתמש: הליך ${i.subKind === 'insolvency' ? 'חדלות פירעון' : 'כינוס נכסים'}`, `disclosed in a user document: ${i.subKind === 'insolvency' ? 'an insolvency' : 'a receivership'} proceeding`)), isP && PD.executionGap && PD.executionGap.fires ? [PD.executionGap.text] : []).filter(Boolean);
  /* watch items are counted here too, so the row never reads "nothing fired" above the watch items it summarises (UX review 19.10.2026) */
  const watchItems = (D && D.signals || []).filter((s) => s.kind === 'watch').map((s) => s.text).filter(Boolean);
  const wHe = watchItems.length ? `פריטי מעקב: ${watchItems.length} (${watchItems.slice(0, 2).map((t) => t.he || t).join(' · ')})` : '', wEn = watchItems.length ? `watch items: ${watchItems.length} (${watchItems.slice(0, 2).map((t) => t.en || t).join(' · ')})` : '';
  out.push(row('risks', risks.length || watchItems.length ? 'DERIVED' : 'MISSING',
    risks.length ? risks.slice(0, 3).map((t) => t.he || t).join(' · ') + (wHe ? ' · ' + wHe : '') : `לא הופעל אף כלל סיכון במקורות הקיימים${wHe ? ' · ' + wHe : ''} (≠ "אין סיכון")`,
    risks.length ? risks.slice(0, 3).map((t) => t.en || t).join(' · ') + (wEn ? ' · ' + wEn : '') : `no risk rule fired in the sources in coverage${wEn ? ' · ' + wEn : ''} (≠ "no risk")`, { n: risks.length, watch: watchItems.length }));
  /* gaps */
  const gaps = (X.brief && X.brief.items || []).filter((i) => i.category === 'MISSING_EVIDENCE' || i.category === 'SOURCE_LIMITATION');
  out.push(row('gaps', 'MISSING', gaps.slice(0, 3).map((g) => g.text.he).join(' · ') || '—', gaps.slice(0, 3).map((g) => g.text.en).join(' · ') || '—', { n: gaps.length }));
  /* next best evidence */
  const nb = (X.nextBest && X.nextBest.items) || [];
  out.push(row('nextBest', null, nb.slice(0, 2).map((i) => i.text.he).join(' · ') || '—', nb.slice(0, 2).map((i) => i.text.en).join(' · ') || '—', { n: nb.length }));
  /* watch */
  const W = X.watch; out.push(row('watch', 'DERIVED', W ? `${W.state === 'NOT_AVAILABLE' ? 'לא זמין' : W.state === 'NO_CHANGE' ? 'לא נצפה שינוי' : W.state === 'MATERIAL_CHANGE' ? 'שינוי מהותי' : 'שינוי'} · בדיקה ${W.lastCheck ? String(W.lastCheck.at).slice(0, 10) : '—'} · ${W.keys.length} מפתחות` : '—',
    W ? `${W.state.replace(/_/g, ' ').toLowerCase()} · checked ${W.lastCheck ? String(W.lastCheck.at).slice(0, 10) : '—'} · ${W.keys.length} keys` : '—'));
  const counts = {}; for (const r of out) if (r.cls) counts[r.cls] = (counts[r.cls] || 0) + 1;
  return { version: VERSION, kind: X.kind, rows: out.filter((r) => isP || r.id !== 'projectStage' || true), counts,
    classes: ['VERIFIED', 'DERIVED', 'SELF_REPORTED', 'USER_DOCUMENT', 'MISSING', 'CONFLICT'],
    basis: bi('כל שורה משפט אחד עם סיווג ראיה אחד; אין ציון ואין המלצה', 'every row one sentence with one evidence class; no score and no recommendation') };
}

module.exports = { VERSION, ROWS, LABEL, summarize };
