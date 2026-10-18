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
const { bi } = require('./model');

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

/* the latest usable statement and its comparable, exactly as lib/dd/financial.js profile() selects them */
function pick(statements) {
  const { periods, conflicts } = FIN.byPeriod(statements);
  const conflicted = new Set(conflicts.map((c) => c.key));
  const usable = periods.filter((p) => !conflicted.has([p.entityNumber, p.period.end, p.period.kind, p.basis, p.currency].join('|')));
  const latest = usable.find((p) => p.basis === 'consolidated') || usable[0] || null;
  return { latest, prior: FIN.comparableOf(latest, usable), usable };
}
const fig = (s, k) => (!s ? null : k === 'totalFinancialDebt' ? (FIN.debtOf(s) ? FIN.debtOf(s).value : null) : k === 'netDebt' ? (FIN.netDebtOf(s) ? FIN.netDebtOf(s).value : null) : s.figures[k] ? s.figures[k].nis : null);
const per = (s) => (s ? { end: s.period.end, kind: s.period.kind, basis: s.basis, currency: s.currency, reportDate: s.reportDate, audited: s.audited, id: s.id } : null);

/** THEN → NOW for one entity: matching periods only (same entity, kind, basis, currency, a year apart ± 45 days) */
function changeOf(latest, prior) {
  if (!latest) return { available: false, reason: bi('אין דוח כספי בכיסוי', 'no financial statement in coverage') };
  if (!prior) return { available: false, reason: bi('אין תקופה מקבילה (אותו סוג, בסיס ומטבע, כשנה קודם) — אין השוואה בין שנתי לרבעוני, מאוחד לסולו או מטבעות שונים', 'no comparable period (same kind, basis and currency, about a year earlier) — never annual vs quarterly, consolidated vs standalone or different currencies'), latest: per(latest) };
  const rows = CHANGE_FIELDS.map((k) => { const a = fig(prior, k), b = fig(latest, k); return { field: k, label: LABEL[k], then: a, now: b, delta: a != null && b != null ? Math.round((b - a) * 100) / 100 : null, deltaPct: a != null && b != null && a !== 0 ? Math.round(((b - a) / Math.abs(a)) * 1000) / 10 : null, missing: a == null || b == null }; });
  return { available: true, then: per(prior), now: per(latest), currency: latest.currency, rows, basis: bi('ערכים בש״ח (או במטבע הדוח) מנורמלים ליחידות; חוב = כפי שדווח, אחרת קצר + ארוך; חוב נטו = כפי שדווח, אחרת חוב − מזומנים', 'values in the statement currency normalized for units; debt = as reported, else short + long; net debt = as reported, else debt − cash'), cls: 'DERIVED' };
}

/** the leverage explainer's data: what is there, and exactly which inputs are missing for each part */
function leverageOf(profile, latest, prior, bonds) {
  const r = (list, id) => (list || []).find((x) => x.id === id) || null;
  const miss = (s, ks) => ks.filter((k) => fig(s, k) == null);
  const debt = latest ? FIN.debtOf(latest) : null, ntd = latest ? fig(latest, 'nearTermDebt') : null;
  return {
    intro: { short: bi('המינוף מראה כמה הון לווה החברה משתמשת ביחס להון העצמי שלה.', 'Leverage shows how much borrowed capital the company uses relative to its own capital.'),
      why: bi('חוב יכול להגדיל תשואות כשהפרויקטים מצליחים, אבל הוא גם מגדיל את הסיכון בתרחיש שלילי ואת סיכון המיחזור.', 'Debt can increase returns when projects perform well, but it can also increase downside and refinancing risk.'),
      mechanism: bi('הון לווה יכול להגדיל את התשואה על ההון העצמי, אבל גם את ההפסדים, את סיכון המיחזור, את הרגישות לעיכובים ואת הרגישות לירידה בשווי המכירה.', 'Borrowed capital can increase equity returns, but it can also increase losses, refinancing risk, sensitivity to delays, and sensitivity to lower sale values.'),
      notAs: bi('אינו תחזית שהחברה תיכשל בתשלום', 'Not a prediction that the company will default.') },
    current: latest ? { netDebtToEquity: r(profile.ratios, 'net_debt_to_equity'), debtToAssets: r(profile.ratios, 'debt_to_assets'), period: per(latest), missing: miss(latest, ['equity', 'totalAssets']).concat(debt ? [] : ['totalFinancialDebt|shortTermDebt+longTermDebt']) } : null,
    change: latest && prior ? { netDebtToEquity: { then: r(profile.priorRatios, 'net_debt_to_equity'), now: r(profile.ratios, 'net_debt_to_equity') }, debtToAssets: { then: r(profile.priorRatios, 'debt_to_assets'), now: r(profile.ratios, 'debt_to_assets') }, then: per(prior), now: per(latest) } : null,
    maturity: latest ? { nearTermDebt: ntd, totalDebt: debt ? debt.value : null, nearTermShare: ntd != null && debt && debt.value > 0 ? Math.round((ntd / debt.value) * 1000) / 1000 : null, nearTermToCash: r(profile.ratios, 'near_term_debt_to_cash'), bonds, missing: miss(latest, ['nearTermDebt', 'cash']) } : { bonds },
    cashCoverage: latest ? { cashToCurrentLiabilities: r(profile.ratios, 'cash_to_current_liabilities'), currentRatio: r(profile.ratios, 'current_ratio'), missing: miss(latest, ['cash', 'currentAssets', 'currentLiabilities']) } : null,
    ifCashGenerationWeakens: latest ? { ocfToDebt: r(profile.ratios, 'ocf_to_debt'), interestCoverage: r(profile.ratios, 'interest_coverage'), missing: miss(latest, ['operatingCashFlow', 'operatingProfit', 'financeExpenses']),
      statement: bi('תזרים מפעילות נמוך יותר מקטין את שני היחסים: פחות חוב מכוסה מהתזרים, ופחות כיסוי להוצאות המימון. PROPX אינה מסמלצת בכמה — אין קלט לכך.', 'Weaker operating cash generation lowers both ratios: less debt covered by cash flow, and less cover for finance costs. PROPX does not simulate by how much — there is no input for it.') } : null,
    ifProjectsTakeLonger: latest ? { nearTermDebt: ntd, cash: fig(latest, 'cash'), customerAdvances: fig(latest, 'customerAdvances'), inventoryWip: fig(latest, 'inventoryWip'), missing: miss(latest, ['nearTermDebt', 'cash', 'customerAdvances', 'inventoryWip']),
      statement: bi('כשפרויקטים מתארכים, ההון נשאר כבול במלאי ובבנייה בתהליך, המקדמות מגיעות מאוחר יותר והחוב לטווח קצר צריך מיחזור או מזומן. אלה הערכים בדוח — ללא תרחיש.', 'When projects take longer, capital stays tied up in inventory and work in progress, customer advances arrive later and near-term debt needs refinancing or cash. These are the statement\'s values — no scenario.') } : null,
    noScenario: bi('PROPX אינה מריצה תרחיש היפותטי על קלטים מומצאים; כשקלט חסר — שמו מוצג', 'PROPX runs no hypothetical scenario on invented inputs; when an input is missing — its name is shown'),
  };
}

/** bond maturities from the user's bond covenant schedules, per series — never summed across entities or currencies */
function bondsOf(docs, number) {
  return docs.filter((d) => d.type === 'bond_covenants' && d.fields.entityNumber === String(number)).map((d) => {
    const byYear = {}; for (const m of d.fields.maturities || []) { const y = String(m.date).slice(0, 4); byYear[y] = (byYear[y] || 0) + (m.amount || 0); }
    return { series: d.fields.series, asOf: d.fields.asOf, covenant: d.fields.covenant, threshold: d.fields.threshold || null, actual: d.fields.actual || null, compliant: d.fields.compliant, maturitiesByYear: byYear, document: { id: d.id, date: d.docDate }, cls: 'USER_DOCUMENT', note: bi('הסכומים כפי שהוזנו מהמסמך — ביחידות ובמטבע שלו', 'amounts as entered from the document — in its own units and currency') };
  });
}

/**
 * financialOf({ M, docs, K })  →  { entities: [per legal entity], reporting, change, leverage, coverage, statement }
 * The REPORTING entity of the group view: a documented PARENT with statements (its consolidated accounts as it reports them), else the
 * core company with statements, else none — every other entity's profile stays its own.
 */
function financialOf({ M, docs, K }) {
  const entities = [];
  for (const c of M.companies.values()) {
    if (c.tier !== 'CORE' && c.tier !== 'DOCUMENTED') continue;
    const statements = FIN.statementsFromDocs(docs, c.number);
    const profile = FIN.profile({ statements, entityNumber: c.number, companyType: c.company && c.company.financialCoverage ? c.company.financialCoverage.cls : null });
    const { latest, prior } = pick(statements);
    const bonds = bondsOf(docs, c.number);
    const financing = docs.filter((d) => d.type === 'financing_agreement' && d.fields.borrowerNumber === c.number).map((d) => ({ lender: d.fields.lender, facility: d.fields.facilityAmount ?? null, currency: d.fields.currency || null, signDate: d.fields.signDate, maturity: d.fields.maturityDate || null, projectId: d.fields.projectId || null, document: { id: d.id, date: d.docDate }, cls: 'USER_DOCUMENT' }));
    entities.push({ number: c.number, name: c.company ? c.company.name : null, role: c.role, tier: c.tier, publicPrivate: publicPrivateOf(c.company), registryFinancialCoverage: c.company ? c.company.financialCoverage : null,
      profile, change: changeOf(latest, prior), leverage: leverageOf(profile, latest, prior, bonds), bonds, financing, hasStatements: !!latest });
  }
  const withSt = entities.filter((e) => e.hasStatements);
  const reporting = withSt.find((e) => e.role === 'PARENT') || withSt.find((e) => e.role === 'CORE') || withSt[0] || null;
  const core = entities.find((e) => e.role === 'CORE') || null;
  return { cls: reporting ? 'USER_DOCUMENT' : 'MISSING',
    entities, reporting: reporting ? { number: reporting.number, name: reporting.name, role: reporting.role, basis: reporting.profile.latest ? reporting.profile.latest.basis : null } : null,
    publicPrivate: core ? core.publicPrivate : null,
    coverage: reporting ? 'USER_DOCUMENT' : 'NOT_IN_COVERAGE',
    statement: reporting ? bi(`דוחות של ${reporting.name || reporting.number} (${reporting.profile.latest.basis === 'consolidated' ? 'מאוחדים — כפי שהחברה מדווחת' : 'סולו'}) — מסמך שסיפק המשתמש; ישויות אחרות בקבוצה מוצגות כל אחת בנפרד`, `statements of ${reporting.name || reporting.number} (${reporting.profile.latest.basis === 'consolidated' ? 'consolidated — as the company reports them' : 'standalone'}) — a document the user provided; other group entities are shown each on its own`)
      : bi('ל-PROPX אין כרגע דוחות כספיים מבוקרים קריאים למכונה עבור ישויות הקבוצה; המקורות הציבוריים (מאיה / הבורסה / מגנא) חסומים ללקוח שאינו דפדפן', 'PROPX does not currently have machine-readable audited financial statements for the group\'s entities; the public sources (MAYA / TASE / MAGNA) refuse a non-browser client'),
    rules: [bi('אין צבירה בין ישויות: כל ישות משפטית בנפרד', 'no aggregation across entities: each legal entity on its own'), bi('התחייבויות SPV אינן מגולגלות לחברת האם', 'SPV liabilities are not rolled into the parent'), bi('אין דוחות ≠ חולשה פיננסית', 'NO FINANCIALS ≠ FINANCIAL WEAKNESS'), bi('מינוף גבוה ≠ כשל', 'HIGH LEVERAGE ≠ DEFAULT')],
    notA: FIN.NOT_A };
}

/** PIPELINE VS FINANCIAL POSITION — factual quantities side by side, never a ratio across universes, never a solvency verdict */
function pipelineVsFinancial({ load, land, fin, activity }) {
  const rep = fin.reporting ? fin.entities.find((e) => e.number === fin.reporting.number) : null;
  const L = rep && rep.profile.latest ? rep.profile.latest : null;
  const v = (k) => (L && L.figures[k] ? L.figures[k].value : null);
  const pipeline = { executionLots: load.executionEvidence.lots, executionUnits: load.executionEvidence.units, openIla: load.openRecords.ila, openMoch: load.openRecords.moch, awarded36: land.windows.m36, awarded24: land.windows.m24, cls: 'DERIVED' };
  const financial = L ? { entity: { number: rep.number, name: rep.name, role: rep.role }, period: L.period, basis: L.basis, currency: L.currency, units: L.units, cash: v('cash'), financialDebt: rep.profile.latest.derived && rep.profile.latest.derived.totalFinancialDebt ? rep.profile.latest.derived.totalFinancialDebt.value : null, nearTermDebt: v('nearTermDebt'), equity: v('equity'), operatingCashFlow: v('operatingCashFlow'), cls: 'USER_DOCUMENT' } : null;
  const big = pipeline.executionLots >= 1 || (pipeline.awarded36 && pipeline.awarded36.lots >= 3);
  const levUp = !!(rep && rep.profile.flags.some((f) => f.id === 'LEVERAGE_INCREASED'));
  const rising = !!(activity && activity.trend === 'accelerating') || !!(land.windows.m24 && land.windows.m24.lots >= 3 && land.windows.m12 && land.windows.m12.lots * 2 >= land.windows.m24.lots);
  let id, text;
  if (!L) { id = big ? 'LARGE_PIPELINE_NO_FINANCIALS' : 'LIMITED_PIPELINE_NO_FINANCIALS'; text = big ? bi('צנרת נראית גדולה; הכיסוי הפיננסי הציבורי הנוכחי אינו מספיק כדי להעריך יכולת מימון.', 'Large visible pipeline; current public financial coverage is insufficient to assess funding capacity.') : bi('צנרת נראית מוגבלת; אין דוחות כספיים בכיסוי.', 'Limited visible pipeline; no financial statements in coverage.'); }
  else if (levUp && rising && big) { id = 'PIPELINE_WITH_RISING_LEVERAGE'; text = bi('צנרת נצפית גבוהה לצד מינוף עולה.', 'High observed pipeline alongside increasing leverage.'); }
  else { id = 'PIPELINE_BESIDE_FINANCIAL_POSITION'; text = bi('הצנרת הנראית מוצגת לצד המצב הפיננסי המדווח — PROPX אינה מעריכה יכולת מימון.', 'The visible pipeline is shown beside the reported financial position — PROPX does not assess funding capacity.'); }
  return { pipeline, financial, statement: { id, text, cls: 'DERIVED' },
    rule: bi('ללא דוחות → "הכיסוי אינו מספיק"; דגל עליית מינוף + פעילות עולה + צנרת ≥ סף → "צנרת גבוהה לצד מינוף עולה"; אחרת — זה לצד זה, ללא הערכה', 'no statements → "coverage insufficient"; a leverage-increased flag + rising activity + a pipeline ≥ the floor → "high pipeline alongside increasing leverage"; else side by side, no assessment'),
    notA: bi('אינו מודל כושר פירעון ואינו קובע שהיזם "יכול" או "אינו יכול" לשאת את הצנרת; אין יחס בין סכומי קרקע רשמיים לבין מזומנים ממסמך', 'not a solvency model, and never says the developer "can" or "cannot" carry the pipeline; no ratio between official land sums and cash from a document'),
    question: bi('כמה פעילות פיתוח נראית הקבוצה נושאת ביחס למשאבים הפיננסיים הנצפים שלה?', 'How much visible development activity is the group carrying relative to its observable financial resources?') };
}

module.exports = { financialOf, pipelineVsFinancial, publicPrivateOf, changeOf, leverageOf, bondsOf, CHANGE_FIELDS, LABEL };
