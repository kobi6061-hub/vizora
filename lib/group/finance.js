// PROPX · SPONSOR X-RAY — FINANCIAL LEVERAGE & RESILIENCE of the group's legal entities, the THEN → NOW change view, the leverage
// explainer and PIPELINE VS FINANCIAL POSITION.
//
// The statements are read ONLY per legal entity (lib/dd/financial.js — one company number, one statement, ratios within it, flags
// only against the comparable period). NOTHING is aggregated across entities: a parent's consolidated statements are the parent's
// own accounting as reported, a subsidiary's / an SPV's figures are theirs, and no SPV liability is rolled into a parent. No score,
// no probability of default, no "financial health" label, no hypothetical scenario on invented inputs — what an input would be
// needed for is named instead.
'use strict';

const FIN = require('../dd/financial');
const R = require('../entities/resolve');
const { bi, RULES } = require('./model');

const CHANGE_FIELDS = ['cash', 'totalFinancialDebt', 'netDebt', 'equity', 'operatingCashFlow', 'financeExpenses', 'nearTermDebt'];
const LABEL = {
  cash: bi('מזומנים', 'cash'), totalFinancialDebt: bi('חוב פיננסי', 'financial debt'), netDebt: bi('חוב נטו', 'net debt'), equity: bi('הון עצמי', 'equity'),
  operatingCashFlow: bi('תזרים מפעילות שוטפת', 'operating cash flow'), financeExpenses: bi('הוצאות מימון', 'finance costs'), nearTermDebt: bi('חוב לפירעון תוך 12 חודשים', 'debt due within 12 months'),
  currentAssets: bi('נכסים שוטפים', 'current assets'), currentLiabilities: bi('התחייבויות שוטפות', 'current liabilities'), totalAssets: bi('סך נכסים', 'total assets'), operatingProfit: bi('רווח תפעולי', 'operating profit'),
  inventoryWip: bi('מלאי / בנייה בתהליך', 'inventory / work in progress'), customerAdvances: bi('מקדמות מלקוחות', 'customer advances'), bondBalance: bi('יתרת אג״ח', 'bond balance'), shortTermDebt: bi('אשראי לזמן קצר', 'short-term debt'), longTermDebt: bi('חוב לזמן ארוך', 'long-term debt'),
};

/** PUBLIC / PRIVATE from the registry TYPE only — a statement about the registry record, not about listing or data availability */
function publicPrivateOf(facts) {
  const t = String((facts && facts.type) || '').replace(/~/g, '"');
  const cls = /ציבורית/.test(t) ? 'PUBLIC' : /אג"?ח/.test(t) ? 'BOND_COMPANY' : /חוץ|זרה/.test(t) ? 'FOREIGN' : /פרטית/.test(t) ? 'PRIVATE' : 'UNKNOWN';
  const L = { PUBLIC: bi('ציבורית (סוג התאגיד ברשם)', 'PUBLIC (registry type)'), BOND_COMPANY: bi('חברת אג״ח (סוג התאגיד ברשם)', 'BOND COMPANY (registry type)'), FOREIGN: bi('זרה (סוג התאגיד ברשם)', 'FOREIGN (registry type)'), PRIVATE: bi('פרטית (סוג התאגיד ברשם)', 'PRIVATE (registry type)'), UNKNOWN: bi('סוג התאגיד לא צוין', 'registry type not stated') };
  return { cls, label: L[cls], verbatim: facts ? facts.type || null : null, note: bi('לפי סוג התאגיד ברשם בלבד — אינו אומר אם יש דוחות זמינים', 'from the registry type only — it does not say whether statements are available') };
}

/* the statements of ONE entity, selected for the group view (independent review 19.10.2026): the MOST RECENT usable period end; a
   consolidated statement is preferred only WITHIN that period end (an older consolidated statement never displaces a newer one); the
   comparable on the same entity, kind, basis and currency; what was not used is said */
const keyOf = (p) => [p.entityNumber, p.period.end, p.period.kind, p.basis, p.currency].join('|');
function select(statements) {
  const { periods, conflicts } = FIN.byPeriod(statements);
  const conflicted = new Set(conflicts.map((c) => c.key));
  const usable = periods.filter((p) => !conflicted.has(keyOf(p)));
  const notes = [];
  if (!usable.length) return { latest: null, prior: null, usable, notes, conflicts };
  const end = usable.reduce((m, p) => (p.period.end > m ? p.period.end : m), '');
  const atEnd = usable.filter((p) => p.period.end === end);
  const latest = atEnd.find((p) => p.basis === 'consolidated') || atEnd[0];
  const prior = FIN.comparableOf(latest, usable);
  const laterConflict = conflicts.filter((c) => c.period.end > end);
  if (laterConflict.length) notes.push(bi(`לתקופה מאוחרת יותר (${laterConflict.map((c) => c.period.end).join(', ')}) יש שתי גרסאות סותרות ללא סימון הצגה מחדש — לא נבחרה; "עכשיו" הוא ${end}`, `a later period (${laterConflict.map((c) => c.period.end).join(', ')}) has two conflicting versions with no restatement mark — none picked; "now" is ${end}`));
  const other = usable.filter((p) => p.basis !== latest.basis || p.currency !== latest.currency || p.period.kind !== latest.period.kind);
  if (other.length) notes.push(bi(`סופקו גם ${other.length} דוחות בבסיס / מטבע / סוג תקופה אחר — לעולם אינם מושווים לדוח זה`, `${other.length} more statement(s) on another basis / currency / period kind were provided — never compared with this one`));
  return { latest, prior, usable, notes, conflicts };
}
const fig = (s, k) => (!s ? null : k === 'totalFinancialDebt' ? (FIN.debtOf(s) ? FIN.debtOf(s).value : null) : k === 'netDebt' ? (FIN.netDebtOf(s) ? FIN.netDebtOf(s).value : null) : s.figures[k] ? s.figures[k].nis : null);
const per = (s) => (s ? { end: s.period.end, kind: s.period.kind, basis: s.basis, currency: s.currency, units: s.units, reportDate: s.reportDate, audited: s.audited, id: s.id } : null);
const has = (s, k) => !!(s && s.figures[k]);
const strip = (s, ks) => (ks.length ? { ...s, figures: Object.fromEntries(Object.entries(s.figures).filter(([k]) => !ks.includes(k))) } : s);

/** THEN → NOW on ONE calculation basis: debt and net debt are compared only when both sides are computed the same way — from the
    components on both sides, or as reported on both sides; otherwise the basis differs and no change (and no leverage flag) is shown */
function pairOf(latest, prior) {
  if (!latest || !prior) return null;
  const both = (k) => has(latest, k) && has(prior, k);
  const debt = both('shortTermDebt') && both('longTermDebt') ? 'COMPONENTS' : both('totalFinancialDebt') ? 'REPORTED' : FIN.debtOf(latest) || FIN.debtOf(prior) ? 'DIFFERS' : 'NONE';
  const net = (debt === 'COMPONENTS' || debt === 'REPORTED') && both('cash') ? 'DERIVED' : both('netDebt') ? 'REPORTED' : FIN.netDebtOf(latest) || FIN.netDebtOf(prior) ? 'DIFFERS' : 'NONE';
  const drop = [...(debt === 'COMPONENTS' ? ['totalFinancialDebt'] : []), ...(net === 'DERIVED' ? ['netDebt'] : [])];
  const L = strip(latest, drop), P = strip(prior, drop);
  const label = { COMPONENTS: bi('מהרכיבים בשני הצדדים (קצר + ארוך)', 'from the components on both sides (short + long)'), REPORTED: bi('כפי שדווח בשני הצדדים', 'as reported on both sides'), DERIVED: bi('חוב − מזומנים בשני הצדדים', 'debt − cash on both sides'), DIFFERS: bi('הבסיס שונה בין התקופות — אין השוואה', 'the basis differs between the periods — no comparison'), NONE: bi('אין נתון', 'no figure') };
  return { debtBasis: debt, netBasis: net, debtBasisLabel: label[debt], netBasisLabel: label[net], L, P, ratios: FIN.ratiosOf(L), priorRatios: FIN.ratiosOf(P), consistent: { debt: debt === 'COMPONENTS' || debt === 'REPORTED', net: net === 'DERIVED' || net === 'REPORTED' } };
}
function changeOf(latest, prior, pair) {
  if (!latest) return { available: false, reason: bi('אין דוח כספי בכיסוי', 'no financial statement in coverage') };
  if (!prior) return { available: false, reason: bi('אין תקופה מקבילה (אותו סוג, בסיס ומטבע, כשנה קודם) — אין השוואה בין שנתי לרבעוני, מאוחד לסולו או מטבעות שונים', 'no comparable period (same kind, basis and currency, about a year earlier) — never annual vs quarterly, consolidated vs standalone or different currencies'), latest: per(latest) };
  const rows = CHANGE_FIELDS.map((k) => {
    const debtRow = k === 'totalFinancialDebt' || k === 'netDebt';
    const ok = !debtRow || (k === 'totalFinancialDebt' ? pair.consistent.debt : pair.consistent.net);
    const a = debtRow ? fig(pair.P, k) : fig(prior, k), b = debtRow ? fig(pair.L, k) : fig(latest, k);
    return { field: k, label: LABEL[k], then: a, now: b, delta: ok && a != null && b != null ? Math.round((b - a) * 100) / 100 : null, deltaPct: ok && a != null && b != null && a !== 0 ? Math.round(((b - a) / Math.abs(a)) * 1000) / 10 : null, missing: a == null || b == null,
      basisDiffers: debtRow && !ok && (a != null || b != null), basis: debtRow ? (k === 'totalFinancialDebt' ? pair.debtBasisLabel : pair.netBasisLabel) : null };
  });
  return { available: true, then: per(prior), now: per(latest), currency: latest.currency, rows, debtBasis: pair.debtBasis, netBasis: pair.netBasis, basis: bi('ערכים במטבע הדוח, מנורמלים ליחידות; חוב וחוב נטו מושווים רק באותו בסיס חישוב בשני הצדדים (מהרכיבים או כפי שדווח) — בסיס שונה = ללא שינוי', 'values in the statement currency normalized for units; debt and net debt are compared only on the same calculation basis on both sides (from the components, or as reported) — a different basis = no change shown'), cls: 'DERIVED' };
}

/* the group's leverage flag (independent review 19.10.2026): net debt / equity decides — up ≥ 0.25 on one basis → LEVERAGE_INCREASED;
   debt / assets alone decides only when net debt / equity is not comparable; debt / assets up while net debt / equity did not rise
   (e.g. borrowed cash held) → GROSS_LEVERAGE_INCREASED (info); a basis that differs → no flag, said */
function leverageFlag(pair, prior, latest) {
  if (!pair) return null;
  const v = (list, id) => { const x = list.find((r) => r.id === id); return x && x.valid ? x.value : null; };
  const a = v(pair.ratios, 'net_debt_to_equity'), b = v(pair.priorRatios, 'net_debt_to_equity'), c = v(pair.ratios, 'debt_to_assets'), d = v(pair.priorRatios, 'debt_to_assets');
  const T = FIN.THRESHOLDS, periods = [`${prior.period.kind} ${prior.period.end}`, `${latest.period.kind} ${latest.period.end}`];
  const mk = (id, text, rule, threshold) => ({ id, cls: 'DERIVED', text, rule, threshold, periods, basis: { debt: pair.debtBasis, net: pair.netBasis }, notA: FIN.NOT_A[0] });
  if (pair.consistent.net && a != null && b != null) {
    if (a - b >= T.leverageNetDebtToEquityRise) return mk('LEVERAGE_INCREASED', bi(`המינוף עלה: חוב נטו להון ${b} → ${a}${c != null && d != null && pair.consistent.debt ? `; חוב לנכסים ${d} → ${c}` : ''}`, `leverage increased: net debt / equity ${b} → ${a}${c != null && d != null && pair.consistent.debt ? `; debt / assets ${d} → ${c}` : ''}`), 'net debt / equity up ≥ 0.25 against the comparable period, on one calculation basis', `≥ +${T.leverageNetDebtToEquityRise}`);
    if (pair.consistent.debt && c != null && d != null && c - d >= T.leverageDebtToAssetsRise) return mk('GROSS_LEVERAGE_INCREASED', bi(`החוב לנכסים עלה ${d} → ${c}, בעוד שחוב נטו להון לא עלה (${b} → ${a}) — חלק מהחוב מוחזק כמזומן`, `debt / assets rose ${d} → ${c} while net debt / equity did not rise (${b} → ${a}) — part of the debt is held as cash`), 'debt / assets up ≥ 5 pp while net debt / equity rose < 0.25, on one calculation basis', `≥ +${T.leverageDebtToAssetsRise * 100} pp`);
    return null;
  }
  if (pair.consistent.debt && c != null && d != null && c - d >= T.leverageDebtToAssetsRise) return mk('LEVERAGE_INCREASED', bi(`המינוף עלה: חוב לנכסים ${d} → ${c} (חוב נטו להון אינו בר השוואה)`, `leverage increased: debt / assets ${d} → ${c} (net debt / equity not comparable)`), 'debt / assets up ≥ 5 pp against the comparable period, on one calculation basis (net debt / equity not comparable)', `≥ +${T.leverageDebtToAssetsRise * 100} pp`);
  return null;
}

/* the named inputs a withheld ratio lacks */
function missingOf(s, id) {
  if (!s) return [];
  const m = [], debt = FIN.debtOf(s);
  const needDebt = () => { if (!debt) m.push('totalFinancialDebt|shortTermDebt+longTermDebt'); };
  if (id === 'net_debt_to_equity') { if (!has(s, 'netDebt')) { needDebt(); if (!has(s, 'cash')) m.push('cash'); } if (!has(s, 'equity')) m.push('equity'); }
  if (id === 'debt_to_assets') { needDebt(); if (!has(s, 'totalAssets')) m.push('totalAssets'); }
  if (id === 'ocf_to_debt') { if (!has(s, 'operatingCashFlow')) m.push('operatingCashFlow'); needDebt(); }
  if (id === 'interest_coverage') for (const k of ['operatingProfit', 'financeExpenses']) if (!has(s, k)) m.push(k);
  return m;
}
const uniq = (xs) => [...new Set(xs)];

/** the leverage explainer's data: what is there, and exactly which inputs are missing for each part */
function leverageOf(profile, latest, prior, bonds, pair) {
  const r = (list, id) => (list || []).find((x) => x.id === id) || null;
  const miss = (s, ks) => ks.filter((k) => fig(s, k) == null);
  const debt = latest ? FIN.debtOf(latest) : null, ntd = latest ? fig(latest, 'nearTermDebt') : null;
  return {
    intro: { short: bi('המינוף מראה כמה הון לווה החברה משתמשת ביחס להון העצמי שלה.', 'Leverage shows how much borrowed capital the company uses relative to its own capital.'),
      why: bi('חוב יכול להגדיל תשואות כשהפרויקטים מצליחים, אבל הוא גם מגדיל את הסיכון בתרחיש שלילי ואת סיכון המיחזור.', 'Debt can increase returns when projects perform well, but it can also increase downside and refinancing risk.'),
      mechanism: bi('הון לווה יכול להגדיל את התשואה על ההון העצמי, אבל גם את ההפסדים, את סיכון המיחזור, את הרגישות לעיכובים ואת הרגישות לירידה בשווי המכירה.', 'Borrowed capital can increase equity returns, but it can also increase losses, refinancing risk, sensitivity to delays, and sensitivity to lower sale values.'),
      notAs: bi('אינו תחזית שהחברה תיכשל בתשלום', 'Not a prediction that the company will default.') },
    current: latest ? { netDebtToEquity: r(profile.ratios, 'net_debt_to_equity'), debtToAssets: r(profile.ratios, 'debt_to_assets'), period: per(latest), missing: uniq([...missingOf(latest, 'net_debt_to_equity'), ...missingOf(latest, 'debt_to_assets')]) } : null,
    change: latest && prior && pair ? { netDebtToEquity: { then: r(pair.priorRatios, 'net_debt_to_equity'), now: r(pair.ratios, 'net_debt_to_equity'), comparable: pair.consistent.net, basis: pair.netBasisLabel }, debtToAssets: { then: r(pair.priorRatios, 'debt_to_assets'), now: r(pair.ratios, 'debt_to_assets'), comparable: pair.consistent.debt, basis: pair.debtBasisLabel }, then: per(prior), now: per(latest) } : null,
    maturity: latest ? { nearTermDebt: ntd, totalDebt: debt ? debt.value : null, nearTermShare: ntd != null && debt && debt.value > 0 ? Math.round((ntd / debt.value) * 1000) / 1000 : null, nearTermToCash: r(profile.ratios, 'near_term_debt_to_cash'), bonds, missing: miss(latest, ['nearTermDebt', 'cash']).concat(debt ? [] : ['totalFinancialDebt|shortTermDebt+longTermDebt']) } : { bonds },
    cashCoverage: latest ? { cashToCurrentLiabilities: r(profile.ratios, 'cash_to_current_liabilities'), currentRatio: r(profile.ratios, 'current_ratio'), missing: miss(latest, ['cash', 'currentAssets', 'currentLiabilities']) } : null,
    ifCashGenerationWeakens: latest ? { ocfToDebt: r(profile.ratios, 'ocf_to_debt'), interestCoverage: r(profile.ratios, 'interest_coverage'), missing: uniq([...missingOf(latest, 'ocf_to_debt'), ...missingOf(latest, 'interest_coverage')]),
      statement: bi('תזרים מפעילות נמוך יותר מקטין את שני היחסים: פחות חוב מכוסה מהתזרים, ופחות כיסוי להוצאות המימון. PROPX אינה מסמלצת בכמה — אין קלט לכך.', 'Weaker operating cash generation lowers both ratios: less debt covered by cash flow, and less cover for finance costs. PROPX does not simulate by how much — there is no input for it.') } : null,
    ifProjectsTakeLonger: latest ? { nearTermDebt: ntd, cash: fig(latest, 'cash'), customerAdvances: fig(latest, 'customerAdvances'), inventoryWip: fig(latest, 'inventoryWip'), missing: miss(latest, ['nearTermDebt', 'cash', 'customerAdvances', 'inventoryWip']),
      statement: bi('כשפרויקטים מתארכים, ההון נשאר כבול במלאי ובבנייה בתהליך, המקדמות מגיעות מאוחר יותר והחוב לטווח קצר צריך מיחזור או מזומן. אלה הערכים בדוח — ללא תרחיש.', 'When projects take longer, capital stays tied up in inventory and work in progress, customer advances arrive later and near-term debt needs refinancing or cash. These are the statement\'s values — no scenario.') } : null,
    noScenario: bi('PROPX אינה מריצה תרחיש היפותטי על קלטים מומצאים; כשקלט חסר — שמו מוצג', 'PROPX runs no hypothetical scenario on invented inputs; when an input is missing — its name is shown'),
  };
}

/** bond maturities from the user's bond covenant schedules, per series — never summed across entities or series; maturities before the
    schedule's as-of date or today are listed apart; an older schedule of the same series is marked superseded; the schedule records
    no currency or units, so the amounts are shown as entered */
function bondsOf(docs, number, today) {
  const list = docs.filter((d) => d.type === 'bond_covenants' && d.fields.entityNumber === String(number));
  const latestOf = new Map(); for (const d of list) { const k = String(d.fields.series); if (!latestOf.has(k) || String(d.fields.asOf) > String(latestOf.get(k).fields.asOf)) latestOf.set(k, d); }
  return list.map((d) => {
    const cut = [String(d.fields.asOf || ''), String(today || '')].sort().pop();
    const upcoming = {}, past = []; for (const m of d.fields.maturities || []) { const dt = String(m.date); if (dt >= cut) { const y = dt.slice(0, 4); upcoming[y] = (upcoming[y] || 0) + (m.amount || 0); } else past.push({ date: dt, amount: m.amount ?? null }); }
    const sup = latestOf.get(String(d.fields.series)) !== d;
    return { series: d.fields.series, asOf: d.fields.asOf, covenant: d.fields.covenant, threshold: d.fields.threshold || null, actual: d.fields.actual || null, compliant: d.fields.compliant, maturitiesByYear: upcoming, pastMaturities: past, superseded: sup, supersededBy: sup ? latestOf.get(String(d.fields.series)).id : null, document: { id: d.id, date: d.docDate }, cls: 'USER_DOCUMENT',
      note: bi('הסכומים כפי שהוזנו מהמסמך — לוח אמות המידה אינו רושם מטבע או יחידות; לא להשוות לנתוני הדוחות בלי לבדוק את היחידות', 'amounts as entered from the document — the covenant schedule records no currency or units; do not compare with statement figures without checking the units') };
  });
}

/* a covenant reported as not met (current schedule of its series only) — a flag of the entity, USER_DOCUMENT, never a default */
function covenantFlags(bonds) {
  return bonds.filter((b) => !b.superseded && b.compliant === 'no').map((b) => ({ id: 'COVENANT_NOT_MET', cls: 'USER_DOCUMENT', text: bi(`אמת מידה שדווחה כלא מקוימת: סדרה ${b.series} · ${b.covenant} (נכון ל-${b.asOf})`, `a covenant reported as not met: series ${b.series} · ${b.covenant} (as of ${b.asOf})`), rule: 'compliance = no in the latest covenant schedule of the series (as entered)', threshold: 'not met', periods: [b.asOf], notA: bi('אי-עמידה באמת מידה ≠ כשל פירעון; ההשלכות לפי שטר הנאמנות', 'a covenant not met ≠ a payment default; the consequences follow the trust deed') }));
}

/**
 * financialOf({ M, docs, K, today })  →  { entities: [per legal entity], reporting, coverage, statement }
 * The REPORTING entity of the group view (independent review 19.10.2026): a documented PARENT (control > 50 % or a declared parent)
 * whose latest statement is CONSOLIDATED, else the CORE company with statements, else NONE — a subsidiary's / an SPV's / an
 * affiliate's statements are never the group's; every other entity's profile stays its own.
 */
function financialOf({ M, docs, K, today = null }) {
  const entities = [];
  for (const c of M.companies.values()) {
    if (c.tier !== 'CORE' && c.tier !== 'DOCUMENTED') continue;
    const all = FIN.statementsFromDocs(docs, c.number);
    const { latest, prior, notes } = select(all);
    /* the due-diligence profile over the statements of the selected basis (and anything at the selected period end) — so its "latest"
       is the group's selection; ratios within one statement; the leverage flag replaced by the one-basis rule */
    const base = latest ? all.filter((s) => (s.basis === latest.basis && s.currency === latest.currency && s.period.kind === latest.period.kind) || s.period.end === latest.period.end) : all;
    const profile = FIN.profile({ statements: base, entityNumber: c.number, companyType: c.company && c.company.financialCoverage ? c.company.financialCoverage.cls : null });
    const pair = pairOf(latest, prior);
    const bonds = bondsOf(docs, c.number, today);
    const lf = latest && prior ? leverageFlag(pair, prior, latest) : null;
    profile.flags = (profile.flags || []).filter((f) => f.id !== 'LEVERAGE_INCREASED').concat(lf ? [lf] : []).concat(covenantFlags(bonds));
    const financing = docs.filter((d) => d.type === 'financing_agreement' && d.fields.borrowerNumber === c.number).map((d) => ({ lender: d.fields.lender, facility: d.fields.facilityAmount ?? null, currency: d.fields.currency || null, signDate: d.fields.signDate, maturity: d.fields.maturityDate || null, projectId: d.fields.projectId || null, document: { id: d.id, date: d.docDate }, cls: 'USER_DOCUMENT' }));
    const ageMonths = latest && today ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(latest.period.end + 'T00:00:00Z')) / (30.44 * 86400e3)) : null;
    entities.push({ number: c.number, name: c.company ? c.company.name : null, role: c.role, tier: c.tier, publicPrivate: publicPrivateOf(c.company), registryFinancialCoverage: c.company ? c.company.financialCoverage : null,
      profile, change: changeOf(latest, prior, pair), leverage: leverageOf(profile, latest, prior, bonds, pair), bonds, financing, hasStatements: !!latest, latestBasis: latest ? latest.basis : null, ageMonths, selectionNotes: notes });
  }
  const withSt = entities.filter((e) => e.hasStatements);
  const reporting = withSt.find((e) => e.role === 'PARENT' && e.latestBasis === 'consolidated') || withSt.find((e) => e.role === 'CORE') || null;
  const others = withSt.filter((e) => !reporting || e.number !== reporting.number);
  const core = entities.find((e) => e.role === 'CORE') || null;
  const name = (e) => e.name || e.number;
  const ROLE = { PARENT: bi('חברת אם', 'parent'), SUBSIDIARY: bi('חברה בת', 'subsidiary'), PROJECT_SPV: bi('חברת פרויקט', 'project SPV'), AFFILIATE: bi('קשורה', 'affiliate'), CORE: bi('ליבה', 'core') };
  const othersNote = others.length ? bi(` דוחות של ישויות אחרות (${others.map((e) => `${name(e)} — ${(ROLE[e.role] || ROLE.AFFILIATE).he}`).join('; ')}) מוצגים כל אחד בנפרד — אינם דוחות הקבוצה.`, ` Statements of other entities (${others.map((e) => `${name(e)} — ${(ROLE[e.role] || ROLE.AFFILIATE).en}`).join('; ')}) are shown each on its own — they are not the group's.`) : bi('', '');
  const age = reporting && reporting.ageMonths != null && reporting.ageMonths > 15 ? bi(` הדוח האחרון לסוף ${reporting.profile.latest.period.end} — לפני ${reporting.ageMonths} חודשים.`, ` The latest statement ends ${reporting.profile.latest.period.end} — ${reporting.ageMonths} months ago.`) : bi('', '');
  return { cls: reporting ? 'USER_DOCUMENT' : 'MISSING',
    entities, reporting: reporting ? { number: reporting.number, name: reporting.name, role: reporting.role, basis: reporting.profile.latest ? reporting.profile.latest.basis : null, periodEnd: reporting.profile.latest ? reporting.profile.latest.period.end : null, ageMonths: reporting.ageMonths } : null,
    others: others.map((e) => ({ number: e.number, name: e.name, role: e.role })),
    publicPrivate: core ? core.publicPrivate : null,
    coverage: reporting ? 'USER_DOCUMENT' : 'NOT_IN_COVERAGE',
    statement: reporting ? bi(`דוחות של ${name(reporting)} (${reporting.profile.latest.basis === 'consolidated' ? 'מאוחדים — כפי שהחברה מדווחת' : 'סולו'}) — מסמך שסיפק המשתמש.${age.he}${othersNote.he}`, `statements of ${name(reporting)} (${reporting.profile.latest.basis === 'consolidated' ? 'consolidated — as the company reports them' : 'standalone'}) — a document the user provided.${age.en}${othersNote.en}`)
      : others.length ? bi(`לישות המדווחת של הקבוצה (חברת אם בשליטה עם דוחות מאוחדים, או חברת הליבה) אין דוחות בכיסוי.${othersNote.he}`, `The group's reporting entity (a controlling parent with consolidated statements, or the core company) has no statements in coverage.${othersNote.en}`)
      : core && (core.publicPrivate.cls === 'PUBLIC' || core.publicPrivate.cls === 'BOND_COMPANY') ? bi('ל-PROPX אין כרגע דוחות כספיים מבוקרים קריאים למכונה עבור ישויות הקבוצה; לחברה ציבורית / מנפיקת אג״ח דוחות קיימים במאיה, אך המקורות (מאיה / הבורסה / מגנא) חסומים ללקוח שאינו דפדפן — ניתן להעלות אותם כמסמך משתמש', 'PROPX does not currently have machine-readable audited financial statements for the group\'s entities; a public / bond-issuing company\'s reports exist on MAYA, but the sources (MAYA / TASE / MAGNA) refuse a non-browser client — they can be uploaded as a user document')
      : core && core.publicPrivate.cls === 'PRIVATE' ? bi('ל-PROPX אין כרגע דוחות כספיים מבוקרים קריאים למכונה עבור ישויות הקבוצה; חברה פרטית אינה מפרסמת דוחות — יש לבקש דוחות מבוקרים מהיזם (מסמך משתמש)', 'PROPX does not currently have machine-readable audited financial statements for the group\'s entities; a private company does not publish its statements — request audited statements from the sponsor (a user document)')
      : bi('ל-PROPX אין כרגע דוחות כספיים מבוקרים קריאים למכונה עבור ישויות הקבוצה (מסמך משתמש בלבד)', 'PROPX does not currently have machine-readable audited financial statements for the group\'s entities (a user document only)'),
    rules: [bi('אין צבירה בין ישויות: כל ישות משפטית בנפרד', 'no aggregation across entities: each legal entity on its own'), bi('התחייבויות SPV אינן מגולגלות לחברת האם', 'SPV liabilities are not rolled into the parent'), bi('ישות מדווחת = חברת אם בשליטה (> 50% או מוצהרת) עם דוחות מאוחדים, אחרת חברת הליבה — לעולם לא חברה בת / SPV', 'reporting entity = a controlling parent (> 50 % or declared) with consolidated statements, else the core company — never a subsidiary / SPV'), bi('אין דוחות ≠ חולשה פיננסית', 'NO FINANCIALS ≠ FINANCIAL WEAKNESS'), bi('מינוף גבוה ≠ כשל', 'HIGH LEVERAGE ≠ DEFAULT')],
    notA: FIN.NOT_A };
}

/** PIPELINE VS FINANCIAL POSITION — factual quantities side by side, never a ratio across universes, never a solvency verdict.
    "Large" only against the cohort (independent review 19.10.2026): ≥ 5 lots with execution evidence at or above the cohort's P90, or
    ≥ 5 lots awarded in 36 months at or above the cohort's P90; "rising" only when the activity trend rule says accelerating */
function pipelineVsFinancial({ load, land, fin, activity, cohort = null }) {
  const rep = fin.reporting ? fin.entities.find((e) => e.number === fin.reporting.number) : null;
  const L = rep && rep.profile.latest ? rep.profile.latest : null;
  const v = (k) => (L && L.figures[k] ? L.figures[k].value : null);
  const pipeline = { executionLots: load.executionEvidence.lots, executionUnits: load.executionEvidence.units, openIla: load.openRecords.ila, openMoch: load.openRecords.moch, awarded36: land.windows.m36, awarded24: land.windows.m24, cls: 'DERIVED' };
  const MULT = { units: 1, thousands: 1e3, millions: 1e6 }, m = L ? MULT[L.units] || 1 : 1, x = (n) => (n == null ? null : Math.round(n * m));
  const fd = L && rep.profile.latest.derived && rep.profile.latest.derived.totalFinancialDebt ? rep.profile.latest.derived.totalFinancialDebt.value : null;
  /* the figures as entered (in the statement's units) AND in whole currency units — the page prints the latter, so a "thousands"
     statement never sits beside a shekel land sum at 1/1000 of its size (independent review 19.10.2026) */
  const financial = L ? { entity: { number: rep.number, name: rep.name, role: rep.role }, period: L.period, basis: L.basis, currency: L.currency, units: L.units, cash: v('cash'), financialDebt: fd, nearTermDebt: v('nearTermDebt'), equity: v('equity'), operatingCashFlow: v('operatingCashFlow'),
    whole: { cash: x(v('cash')), financialDebt: x(fd), nearTermDebt: x(v('nearTermDebt')), equity: x(v('equity')), operatingCashFlow: x(v('operatingCashFlow')) }, ageMonths: rep.ageMonths, cls: 'USER_DOCUMENT' } : null;
  const cl = cohort && cohort.load, ca = cohort && cohort.awards36;
  const bigExec = pipeline.executionLots >= RULES.loadMin && load.executionEvidence.tenders >= 2 && cl && cl.p90 != null && pipeline.executionLots >= cl.p90;
  const a36 = pipeline.awarded36 ? pipeline.awarded36.lots : 0;
  const bigLand = a36 >= RULES.loadMin && ca && ca.p90 != null && a36 >= ca.p90;
  const big = !!(bigExec || bigLand);
  const levUp = !!(rep && rep.profile.flags.some((f) => f.id === 'LEVERAGE_INCREASED'));
  const rising = !!(activity && activity.trend === 'accelerating');
  let id, text;
  if (!L) { id = big ? 'LARGE_PIPELINE_NO_FINANCIALS' : 'LIMITED_PIPELINE_NO_FINANCIALS'; text = big ? bi('צנרת נראית גדולה; הכיסוי הפיננסי הציבורי הנוכחי אינו מספיק כדי להעריך יכולת מימון.', 'Large visible pipeline; current public financial coverage is insufficient to assess funding capacity.') : bi('צנרת נראית שאינה בעשירון העליון של הקבוצה הארצית; אין דוחות של הישות המדווחת בכיסוי.', 'A visible pipeline outside the cohort\'s top decile; no statements of the reporting entity in coverage.'); }
  else if (levUp && rising && big) { id = 'PIPELINE_WITH_RISING_LEVERAGE'; text = bi('צנרת נצפית גבוהה לצד מינוף עולה.', 'High observed pipeline alongside increasing leverage.'); }
  else { id = 'PIPELINE_BESIDE_FINANCIAL_POSITION'; text = bi('הצנרת הנראית מוצגת לצד המצב הפיננסי המדווח — PROPX אינה מעריכה יכולת מימון.', 'The visible pipeline is shown beside the reported financial position — PROPX does not assess funding capacity.'); }
  return { pipeline, financial, statement: { id, text, cls: 'DERIVED' },
    comparison: { large: big, executionLots: pipeline.executionLots, executionP90: cl ? cl.p90 : null, awarded36Lots: a36, awarded36P90: ca ? ca.p90 : null, groups: { execution: cl ? cl.groups : null, awarded36: ca ? ca.groups : null }, activityTrend: activity ? activity.trend : null, leverageIncreased: levUp },
    rule: bi(`ללא דוחות של הישות המדווחת → "הכיסוי אינו מספיק" (צנרת "גדולה" רק אם ≥ ${RULES.loadMin} מגרשים בביצוע ובאחוזון ה-90 של הקבוצות, או ≥ ${RULES.loadMin} מגרשים שנזכו ב-36 חודשים ובאחוזון ה-90); "צנרת גבוהה לצד מינוף עולה" רק כשהמינוף עלה (חוב נטו להון, באותו בסיס), הפעילות מואצת לפי כלל המגמה והצנרת גדולה; אחרת — זה לצד זה, ללא הערכה`, `no statements of the reporting entity → "coverage insufficient" ("large" only with ≥ ${RULES.loadMin} lots in execution at or above the groups' P90, or ≥ ${RULES.loadMin} lots awarded in 36 months at or above the P90); "high pipeline alongside increasing leverage" only when leverage rose (net debt / equity, one basis), activity is accelerating by the trend rule and the pipeline is large; else side by side, no assessment`),
    notA: bi('אינו מודל כושר פירעון ואינו קובע שהיזם "יכול" או "אינו יכול" לשאת את הצנרת; אין יחס בין סכומי קרקע רשמיים לבין מזומנים ממסמך', 'not a solvency model, and never says the developer "can" or "cannot" carry the pipeline; no ratio between official land sums and cash from a document'),
    question: bi('כמה פעילות פיתוח נראית הקבוצה נושאת ביחס למשאבים הפיננסיים הנצפים שלה?', 'How much visible development activity is the group carrying relative to its observable financial resources?') };
}

module.exports = { financialOf, pipelineVsFinancial, publicPrivateOf, changeOf, leverageOf, bondsOf, select, pairOf, leverageFlag, covenantFlags, CHANGE_FIELDS, LABEL };
