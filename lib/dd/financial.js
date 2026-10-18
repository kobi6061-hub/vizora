// PROPX · PUBLIC FINANCIAL PROFILE (Premium Diligence 2.0, 18.10.2026).
//
// Source audit (lib/trust/discovery/2026-10-18-premium.json): every machine channel to Israeli public-company filings —
// MAYA's API, TASE, the TASE Data Hub, ISA MAGNA, the Maalot rating site — refuses a non-browser client or needs a licence;
// no financial-statements dataset for companies exists on data.gov.il. PROPX therefore integrates NO public financial source
// today. This module is the deterministic engine that turns statements into a profile; its only input today is the user's
// own documents (class USER_DOCUMENT). A licensed feed would enter through the same `statements` shape (adapter contract
// in lib/dd/README.md) — never through scraping.
//
// Rules:
//   • every figure carries period · report date · source · filing / document id · currency · units · restated? · class ·
//     limitations; nothing is filled in, nothing is estimated;
//   • a ratio is computed only from inputs of ONE statement (same entity, period, basis, currency) — never across periods;
//   • total debt = the reported total, else short + long when both are stated; a bond balance is a COMPONENT, never added
//     (no double counting); net debt = the reported figure, else total debt − cash (restricted cash is not subtracted);
//   • two documents for the same period: a restated one (later report date, marked restated) supersedes the original, and
//     both are kept (RESTATEMENT); two different un-marked versions are a CONFLICT — no pick, no ratio for that period;
//   • flags compare a statement only with the comparable one (same kind and basis, a year earlier ± 45 days); every flag
//     exposes its inputs, threshold and periods; there is NO score, NO probability of default, NO "healthy / weak" label;
//   • NO FINANCIALS ≠ FINANCIAL WEAKNESS · PUBLIC COMPANY FINANCIALS ≠ PROJECT SPV FINANCIALS.
'use strict';

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-financial-profile-v1', effective: '2026-10-18' });
const MULT = { units: 1, thousands: 1e3, millions: 1e6 };
const BALANCE = ['cash', 'restrictedCash', 'shortTermDebt', 'longTermDebt', 'totalFinancialDebt', 'netDebt', 'nearTermDebt', 'bondBalance', 'equity', 'totalAssets', 'currentAssets', 'currentLiabilities', 'inventoryWip', 'customerAdvances'];
const FLOWS = ['revenue', 'grossProfit', 'operatingProfit', 'financeExpenses', 'operatingCashFlow', 'investingCashFlow', 'financingCashFlow'];
const FIELDS = [...BALANCE, ...FLOWS];
/* flag thresholds — documented conventions, shown with every flag; changing one changes the flag, never a hidden score */
const THRESHOLDS = Object.freeze({
  leverageNetDebtToEquityRise: 0.25, leverageDebtToAssetsRise: 0.05, liquidityCurrentRatioDrop: 0.2, liquidityCashCoverDropRel: 0.25,
  cashImprovedRel: 0.2, nearTermShareOfDebt: 0.5, nearTermDebtToCash: 2, comparableWindowDays: 45,
});
const NOT_A = [
  bi('לא ציון פיננסי, לא הסתברות כשל, לא דירוג', 'not a financial score, not a probability of default, not a rating'),
  bi('היעדר דוחות ≠ חולשה פיננסית', 'NO FINANCIALS ≠ FINANCIAL WEAKNESS'),
  bi('דוחות חברה ציבורית ≠ דוחות חברת הפרויקט', 'PUBLIC COMPANY FINANCIALS ≠ PROJECT SPV FINANCIALS'),
];
const NO_STATEMENTS = bi('ל-PROPX אין כרגע דוחות כספיים מבוקרים קריאים למכונה עבור ישות זו', 'PROPX does not currently have machine-readable audited financial statements for this entity');

const day = (d) => String(d || '').slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** user documents of type financial_statements (lib/dd/userdocs.js) → the statement shape this engine reads */
/* entityNumber is REQUIRED: statements are read only for the one legal entity named — without a resolved entity there are none
   (a statement of another company is never shown under this one) */
function statementsFromDocs(docs, entityNumber) {
  if (!entityNumber) return [];
  return (docs || []).filter((d) => d.type === 'financial_statements' && d.fields.entityNumber === String(entityNumber)).map((d) => {
    const f = d.fields, m = MULT[f.units] || 1;
    /* shekels rounded to the agora: the same figure entered in millions or in thousands compares equal (2.01 m = 2,010 k) */
    const figures = {}; for (const k of FIELDS) if (f[k] != null) figures[k] = { value: f[k], nis: Math.round(f[k] * m * 100) / 100 };
    return { id: d.id, entityNumber: f.entityNumber, entityName: f.entityName || null, period: { end: f.periodEnd, kind: f.periodKind }, reportDate: f.reportDate, basis: f.basis, audited: f.audited,
      currency: f.currency, units: f.units, restated: !!f.restated, cls: 'USER_DOCUMENT', source: 'user-document', filingId: d.id, provenance: d.provenance,
      figures, notes: { goingConcern: !!f.goingConcern, goingConcernText: f.goingConcernText || null, auditorEmphasis: f.auditorEmphasis || null, covenantNotes: f.covenantNotes || null, refinancingNotes: f.refinancingNotes || null },
      rating: f.creditRating ? { rating: f.creditRating, agency: f.ratingAgency || null, outlook: f.ratingOutlook || null, date: f.ratingDate || null } : null,
      limitations: d.limitations };
  });
}

/** group by period: restatement supersedes (kept), disagreement without a restatement mark = CONFLICT */
function byPeriod(statements) {
  const groups = new Map();
  for (const s of statements) { const k = [s.entityNumber, s.period.end, s.period.kind, s.basis, s.currency].join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const periods = [], restatements = [], conflicts = [];
  for (const [k, list] of groups) {
    if (list.length === 1) { periods.push(list[0]); continue; }
    const sorted = list.slice().sort((a, b) => (a.reportDate < b.reportDate ? -1 : a.reportDate > b.reportDate ? 1 : 0));
    const latest = sorted[sorted.length - 1];
    const same = (a, b) => FIELDS.every((f) => (a.figures[f] ? a.figures[f].nis : null) === (b.figures[f] ? b.figures[f].nis : null));
    if (sorted.every((s) => same(s, latest))) { periods.push(latest); continue; }
    if (latest.restated && latest.reportDate > sorted[0].reportDate) {
      /* the restated version supersedes EVERY earlier version of the period; each earlier version that differs is listed (kept),
         with each side's units — and earlier versions that also disagree among themselves are said, never dropped */
      const earlier = sorted.slice(0, -1).filter((o) => !same(o, latest));
      const earlierDisagree = sorted.length > 2 && new Set(sorted.slice(0, -1).map((o) => JSON.stringify(FIELDS.map((f) => (o.figures[f] ? o.figures[f].nis : null))))).size > 1;
      for (const original of earlier) restatements.push({ key: k, period: latest.period, original: { id: original.id, reportDate: original.reportDate, units: original.units, currency: original.currency }, restated: { id: latest.id, reportDate: latest.reportDate, units: latest.units, currency: latest.currency },
        earlierVersionsDisagree: earlierDisagree,
        changed: FIELDS.filter((f) => (original.figures[f] ? original.figures[f].nis : null) !== (latest.figures[f] ? latest.figures[f].nis : null)).map((f) => ({ field: f, original: original.figures[f] ? original.figures[f].value : null, originalUnits: original.units, restated: latest.figures[f] ? latest.figures[f].value : null, restatedUnits: latest.units })) });
      periods.push({ ...latest, supersedes: sorted[0].id, supersedesAll: sorted.slice(0, -1).map((o) => o.id) });
    } else {
      conflicts.push({ key: k, period: latest.period, documents: sorted.map((s) => ({ id: s.id, reportDate: s.reportDate, restated: s.restated })),
        fields: FIELDS.filter((f) => new Set(sorted.map((s) => (s.figures[f] ? s.figures[f].nis : null))).size > 1),
        statement: bi('שני מסמכים לאותה תקופה עם ערכים שונים, ואף אחד אינו מסומן כהצגה מחדש — לא נבחר; אין יחסים לתקופה זו', 'two documents for one period with different values, none marked restated — none picked; no ratios for this period') });
    }
  }
  periods.sort((a, b) => (a.period.end < b.period.end ? 1 : a.period.end > b.period.end ? -1 : 0));
  return { periods, restatements, conflicts };
}

const fig = (s, k) => (s && s.figures[k] ? s.figures[k].nis : null);
const BASIS = Object.freeze({
  reportedDebt: bi('סך החוב הפיננסי כפי שדווח', 'reported total financial debt'),
  sumDebt: bi('אשראי לזמן קצר + חוב לזמן ארוך (נגזר; יתרת האג״ח היא רכיב — לעולם לא מתווספת)', 'short-term + long-term debt (DERIVED; the bond balance is a component, never added)'),
  reportedNet: bi('חוב נטו כפי שדווח', 'reported net debt'),
});
/* values in shekels × units (`nis`) for ratios; `derived` marks a figure PROPX computed rather than read */
function debtOf(s) {
  if (fig(s, 'totalFinancialDebt') != null) return { value: fig(s, 'totalFinancialDebt'), derived: false, basis: BASIS.reportedDebt, inputs: ['totalFinancialDebt'] };
  if (fig(s, 'shortTermDebt') != null && fig(s, 'longTermDebt') != null) return { value: fig(s, 'shortTermDebt') + fig(s, 'longTermDebt'), derived: true, basis: BASIS.sumDebt, inputs: ['shortTermDebt', 'longTermDebt'] };
  return null;
}
function netDebtOf(s) {
  if (fig(s, 'netDebt') != null) return { value: fig(s, 'netDebt'), derived: false, basis: BASIS.reportedNet, inputs: ['netDebt'] };
  const d = debtOf(s); if (d && fig(s, 'cash') != null) return { value: d.value - fig(s, 'cash'), derived: true, basis: bi(`${d.basis.he} − מזומנים (נגזר; מזומנים מוגבלים אינם מנוכים)`, `${d.basis.en} − cash (DERIVED; restricted cash not subtracted)`), inputs: [...d.inputs, 'cash'] };
  return null;
}
/* a derived balance for display: in the statement's own currency and units (never re-scaled into shekels) */
const stated = (s, x) => (x ? { value: Math.round((x.value / (MULT[s.units] || 1)) * 100) / 100, currency: s.currency, units: s.units, derived: x.derived, basis: x.basis, inputs: x.inputs, cls: x.derived ? 'DERIVED' : s.cls } : null);
/** the ratios of ONE statement — every input from that statement, every reason a ratio is withheld */
function ratiosOf(s) {
  if (!s) return [];
  const R = [], add = (id, formula, num, den, why, extra = {}) => {
    if (num == null || den == null) { R.push({ id, formula, value: null, valid: false, reason: bi('קלט חסר בדוח', 'an input is not in the statement'), ...extra }); return; }
    if (why) { R.push({ id, formula, value: null, valid: false, reason: why, ...extra }); return; }
    R.push({ id, formula, value: r2(num / den), valid: true, ...extra });
  };
  const debt = debtOf(s), nd = netDebtOf(s), eq = fig(s, 'equity');
  add('net_debt_to_equity', 'net debt ÷ equity', nd ? nd.value : null, eq, eq != null && eq <= 0 ? bi('הון עצמי ≤ 0 — היחס אינו בעל משמעות', 'equity ≤ 0 — the ratio is not meaningful') : null, { inputs: nd ? nd.inputs.concat('equity') : ['netDebt', 'equity'], basis: nd ? nd.basis : null });
  add('debt_to_assets', 'total financial debt ÷ total assets', debt ? debt.value : null, fig(s, 'totalAssets'), fig(s, 'totalAssets') === 0 ? bi('סך נכסים 0', 'total assets 0') : null, { inputs: debt ? debt.inputs.concat('totalAssets') : ['totalFinancialDebt', 'totalAssets'], basis: debt ? debt.basis : null });
  add('current_ratio', 'current assets ÷ current liabilities', fig(s, 'currentAssets'), fig(s, 'currentLiabilities'), fig(s, 'currentLiabilities') === 0 ? bi('התחייבויות שוטפות 0', 'current liabilities 0') : null, { inputs: ['currentAssets', 'currentLiabilities'] });
  add('cash_to_current_liabilities', 'cash ÷ current liabilities', fig(s, 'cash'), fig(s, 'currentLiabilities'), fig(s, 'currentLiabilities') === 0 ? bi('התחייבויות שוטפות 0', 'current liabilities 0') : null, { inputs: ['cash', 'currentLiabilities'] });
  add('ocf_to_debt', 'operating cash flow ÷ total financial debt', fig(s, 'operatingCashFlow'), debt ? debt.value : null, debt && debt.value <= 0 ? bi('אין חוב פיננסי', 'no financial debt') : null,
    { inputs: ['operatingCashFlow'].concat(debt ? debt.inputs : ['totalFinancialDebt']), note: s.period.kind === 'annual' ? null : bi('תזרים של התקופה (לא מוכפל לשנה) מול יתרת חוב', 'a period flow (not annualized) against a debt balance') });
  add('interest_coverage', 'operating profit ÷ finance expenses', fig(s, 'operatingProfit'), fig(s, 'financeExpenses'), fig(s, 'financeExpenses') != null && fig(s, 'financeExpenses') <= 0 ? bi('הוצאות מימון ≤ 0 — היחס אינו בעל משמעות', 'finance expenses ≤ 0 — the ratio is not meaningful') : null, { inputs: ['operatingProfit', 'financeExpenses'] });
  const ntd = fig(s, 'nearTermDebt') != null ? fig(s, 'nearTermDebt') : fig(s, 'shortTermDebt');
  add('near_term_debt_to_cash', 'debt due within 12 months ÷ cash', ntd, fig(s, 'cash'), fig(s, 'cash') === 0 ? bi('מזומנים 0', 'cash 0') : null, { inputs: [fig(s, 'nearTermDebt') != null ? 'nearTermDebt' : 'shortTermDebt', 'cash'] });
  return R;
}
/** the comparable statement: same entity, kind, basis and currency, a year earlier (± the window) */
function comparableOf(s, periods) {
  if (!s) return null;
  return periods.find((p) => p !== s && p.entityNumber === s.entityNumber && p.period.kind === s.period.kind && p.basis === s.basis && p.currency === s.currency
    && Math.abs(daysBetween(p.period.end, s.period.end) - 365) <= THRESHOLDS.comparableWindowDays) || null;
}
/* rating scales — S&P-style (ilAAA … D) and Moody's-style (Aaa.il … C); compared only within one agency */
const SP = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
const MD = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'];
function ratingRank(r) {
  if (!r) return null; const t = String(r).replace(/^il/i, '').replace(/\.il$/i, '').trim();
  let i = SP.indexOf(t.toUpperCase()); if (i >= 0) return { scale: 'S&P', rank: i };
  i = MD.findIndex((x) => x.toLowerCase() === t.toLowerCase()); if (i >= 0) return { scale: 'Moody', rank: i };
  return null;
}
function flagsOf(latest, prior, ratios, priorRatios) {
  const F = [], val = (list, id) => { const x = (list || []).find((r) => r.id === id); return x && x.valid ? x.value : null; };
  const per = (s) => (s ? `${s.period.kind} ${s.period.end}` : null);
  const inp = (s, ks) => ks.map((k) => ({ field: k, value: s && s.figures[k] ? s.figures[k].value : null, units: s ? s.units : null, currency: s ? s.currency : null, period: per(s), source: s ? s.id : null, cls: s ? s.cls : null }));
  const add = (id, text, rule, threshold, inputs, periods) => F.push({ id, cls: 'DERIVED', text, rule, threshold, inputs, periods, notA: NOT_A[0] });
  if (!latest) { add('INSUFFICIENT_FINANCIAL_DATA', bi('אין דוח כספי בכיסוי — דגלים פיננסיים אינם מחושבים', 'no financial statement in coverage — financial flags are not computed'), 'no statement', null, [], []); return F; }
  if (prior) {
    const a = val(ratios, 'net_debt_to_equity'), b = val(priorRatios, 'net_debt_to_equity'), c = val(ratios, 'debt_to_assets'), d = val(priorRatios, 'debt_to_assets');
    if ((a != null && b != null && a - b >= THRESHOLDS.leverageNetDebtToEquityRise) || (c != null && d != null && c - d >= THRESHOLDS.leverageDebtToAssetsRise))
      add('LEVERAGE_INCREASED', bi(`המינוף עלה: חוב נטו להון ${b ?? '—'} → ${a ?? '—'}; חוב לנכסים ${d ?? '—'} → ${c ?? '—'}`, `leverage increased: net debt / equity ${b ?? '—'} → ${a ?? '—'}; debt / assets ${d ?? '—'} → ${c ?? '—'}`),
        'net debt / equity up ≥ 0.25, or debt / assets up ≥ 5 pp, against the comparable period', `≥ +${THRESHOLDS.leverageNetDebtToEquityRise} · ≥ +${THRESHOLDS.leverageDebtToAssetsRise * 100} pp`, [...inp(prior, ['totalFinancialDebt', 'shortTermDebt', 'longTermDebt', 'netDebt', 'cash', 'equity', 'totalAssets']), ...inp(latest, ['totalFinancialDebt', 'shortTermDebt', 'longTermDebt', 'netDebt', 'cash', 'equity', 'totalAssets'])].filter((x) => x.value != null), [per(prior), per(latest)]);
    const e = val(ratios, 'current_ratio'), f = val(priorRatios, 'current_ratio'), g = val(ratios, 'cash_to_current_liabilities'), h = val(priorRatios, 'cash_to_current_liabilities');
    if ((e != null && f != null && f - e >= THRESHOLDS.liquidityCurrentRatioDrop) || (g != null && h != null && h > 0 && (h - g) / h >= THRESHOLDS.liquidityCashCoverDropRel))
      add('LIQUIDITY_WEAKENED', bi(`הנזילות נחלשה: יחס שוטף ${f ?? '—'} → ${e ?? '—'}; מזומנים להתחייבויות שוטפות ${h ?? '—'} → ${g ?? '—'}`, `liquidity weakened: current ratio ${f ?? '—'} → ${e ?? '—'}; cash / current liabilities ${h ?? '—'} → ${g ?? '—'}`),
        'current ratio down ≥ 0.2, or cash / current liabilities down ≥ 25 % (relative), against the comparable period', `≥ −${THRESHOLDS.liquidityCurrentRatioDrop} · ≥ −${THRESHOLDS.liquidityCashCoverDropRel * 100} %`, [...inp(prior, ['currentAssets', 'currentLiabilities', 'cash']), ...inp(latest, ['currentAssets', 'currentLiabilities', 'cash'])], [per(prior), per(latest)]);
    if (fig(latest, 'cash') != null && fig(prior, 'cash') > 0 && fig(latest, 'cash') / fig(prior, 'cash') - 1 >= THRESHOLDS.cashImprovedRel)
      add('CASH_IMPROVED', bi('המזומנים עלו ב-20% לפחות מול התקופה המקבילה', 'cash rose by at least 20 % against the comparable period'), 'cash up ≥ 20 % against the comparable period', `≥ +${THRESHOLDS.cashImprovedRel * 100} %`, [...inp(prior, ['cash']), ...inp(latest, ['cash'])], [per(prior), per(latest)]);
    if (latest.rating && prior.rating && latest.rating.agency === prior.rating.agency) { const x = ratingRank(latest.rating.rating), y = ratingRank(prior.rating.rating);
      if (x && y && x.scale === y.scale && x.rank > y.rank) add('RATING_DOWNGRADE', bi(`הדירוג ירד: ${prior.rating.rating} → ${latest.rating.rating}`, `rating downgraded: ${prior.rating.rating} → ${latest.rating.rating}`), 'the same agency\'s rating is lower than in the comparable statement', 'one notch or more', [{ field: 'creditRating', value: prior.rating.rating, period: per(prior), source: prior.id }, { field: 'creditRating', value: latest.rating.rating, period: per(latest), source: latest.id }], [per(prior), per(latest)]); }
  }
  const debt = debtOf(latest), ntd = fig(latest, 'nearTermDebt') != null ? fig(latest, 'nearTermDebt') : null, ntc = val(ratios, 'near_term_debt_to_cash');
  if ((ntd != null && debt && debt.value > 0 && ntd / debt.value >= THRESHOLDS.nearTermShareOfDebt) || (ntc != null && ntc >= THRESHOLDS.nearTermDebtToCash))
    add('NEAR_TERM_DEBT_CONCENTRATION', bi('ריכוז חוב לטווח קצר: לפחות מחצית מהחוב לפירעון תוך 12 חודשים, או חוב קצר ≥ פי 2 מהמזומנים', 'near-term debt concentration: at least half of the debt due within 12 months, or near-term debt ≥ 2× cash'),
      'debt due within 12 months ≥ 50 % of total financial debt, or ≥ 2× cash', `≥ ${THRESHOLDS.nearTermShareOfDebt * 100} % · ≥ ${THRESHOLDS.nearTermDebtToCash}×`, inp(latest, ['nearTermDebt', 'shortTermDebt', 'totalFinancialDebt', 'cash']), [per(latest)]);
  if (fig(latest, 'operatingCashFlow') != null && fig(latest, 'operatingCashFlow') < 0)
    add('OPERATING_CASH_FLOW_NEGATIVE', bi('תזרים מפעילות שוטפת שלילי בתקופה (בחברות בנייה נובע לעיתים מהשקעה במלאי — לא לפרש לבד)', 'operating cash flow negative for the period (in developers often inventory investment — not to be read alone)'), 'operating cash flow < 0', '< 0', inp(latest, ['operatingCashFlow', 'inventoryWip']), [per(latest)]);
  if (latest.notes.goingConcern) add('GOING_CONCERN_LANGUAGE_PRESENT', bi('בדוח מופיעה הערת "עסק חי" / ספק להמשך פעילות', 'going-concern language appears in the statements'), 'the statement carries going-concern language (as entered)', 'present', [{ field: 'goingConcernText', value: latest.notes.goingConcernText, period: per(latest), source: latest.id }], [per(latest)]);
  if (latest.rating && /negative/.test(String(latest.rating.outlook || ''))) add('RATING_OUTLOOK_NEGATIVE', bi(`אופק דירוג שלילי (${latest.rating.agency || '—'} · ${latest.rating.rating})`, `negative rating outlook (${latest.rating.agency || '—'} · ${latest.rating.rating})`), 'outlook negative or watch negative', 'negative', [{ field: 'ratingOutlook', value: latest.rating.outlook, period: latest.rating.date, source: latest.id }], [per(latest)]);
  return F;
}

/** the profile of one legal entity (company number) from its statements */
const AUDIT_HE = { audited: 'מבוקר', reviewed: 'סקירה', unaudited: 'לא מבוקר' };
function profile({ statements = [], entityNumber = null, companyType = null, projectCompanyNumber = null, projectCompanyState = null, projectRead = false } = {}) {
  const S = entityNumber ? statements.filter((s) => s.entityNumber === String(entityNumber)) : [];
  const { periods, restatements, conflicts } = byPeriod(S);
  const conflicted = new Set(conflicts.map((c) => c.key));
  const usable = periods.filter((p) => !conflicted.has([p.entityNumber, p.period.end, p.period.kind, p.basis, p.currency].join('|')));
  /* prefer consolidated; never mix bases */
  const latest = usable.find((p) => p.basis === 'consolidated') || usable[0] || null;
  const prior = comparableOf(latest, usable);
  const ratios = ratiosOf(latest), priorRatios = ratiosOf(prior);
  const coverage = latest ? latest.cls : 'NOT_IN_COVERAGE';
  return {
    version: VERSION, entityNumber: entityNumber ? String(entityNumber) : null, coverage,
    statement: !latest && conflicts.length ? bi('סופקו דוחות, אך לכל תקופה יש שתי גרסאות סותרות ללא סימון הצגה מחדש — לא נבחרה גרסה', 'statements were provided, but every period has two conflicting versions with no restatement mark — no version picked')
      : latest ? bi(`פרופיל מדוח ${latest.period.kind === 'annual' ? 'שנתי' : latest.period.kind === 'half' ? 'חצי שנתי' : 'רבעוני'} ל-${latest.period.end} (${AUDIT_HE[latest.audited] || latest.audited}) — מסמך שסיפק המשתמש`, `profile from the ${latest.period.kind} statement for ${latest.period.end} (${latest.audited}) — a document the user provided`) : NO_STATEMENTS,
    publicSourceStatus: bi('מקורות ציבוריים לדוחות כספיים: חסומים (מאיה / הבורסה / מגנא / מעלות) — ראו מרכז האמון', 'public financial-statement sources: blocked (MAYA / TASE / MAGNA / Maalot) — see the Trust Center'),
    companyType, latest: latest ? { id: latest.id, period: latest.period, reportDate: latest.reportDate, basis: latest.basis, audited: latest.audited, currency: latest.currency, units: latest.units, restated: latest.restated, supersedes: latest.supersedes || null, supersedesAll: latest.supersedesAll || null, cls: latest.cls, provenance: latest.provenance,
      figures: Object.fromEntries(FIELDS.filter((k) => latest.figures[k]).map((k) => [k, { value: latest.figures[k].value, units: latest.units, currency: latest.currency, period: latest.period, reportDate: latest.reportDate, source: latest.source, filingId: latest.filingId, restated: latest.restated, cls: latest.cls }])),
      derived: { totalFinancialDebt: stated(latest, debtOf(latest)), netDebt: stated(latest, netDebtOf(latest)) }, notes: latest.notes, rating: latest.rating } : null,
    comparable: prior ? { id: prior.id, period: prior.period, reportDate: prior.reportDate } : null,
    ratios, priorRatios: prior ? priorRatios : [], flags: flagsOf(latest, prior, ratios, priorRatios), restatements, conflicts,
    /* PUBLIC / GROUP COMPANY ≠ PROJECT SPV: on a project read the note is shown unless the project company is VERIFIED */
    spvNote: !latest || !projectRead ? null
      : !projectCompanyNumber ? bi('הדוחות הם של חברת היזם — חברת הפרויקט אינה מזוהה; דוחות חברת היזם ≠ דוחות חברת הפרויקט', 'the statements are the developer company\'s — the project company is not identified; developer company financials ≠ project SPV financials')
      : String(projectCompanyNumber) !== String(entityNumber) ? bi('הדוחות הם של החברה המדווחת — לא של חברת הפרויקט; דוחות חברה ציבורית ≠ דוחות חברת הפרויקט', 'the statements are the reporting company\'s — not the project company\'s; public company financials ≠ project SPV financials')
      : projectCompanyState !== 'VERIFIED' ? bi('הדוחות הם של החברה שהרשומות מצביעות עליה כחברת הפרויקט (התאמה חזקה — לא מאומתת); אם הפרויקט מוחזק בחברת פרויקט (SPV), דוחותיה שונים — דוחות קבוצה / חברה ציבורית ≠ דוחות חברת הפרויקט', 'the statements are those of the company the records point to as the project company (STRONG — not verified); if the project sits in an SPV, its own statements differ — group / public-company financials ≠ project SPV financials')
      : null,
    thresholds: THRESHOLDS, notA: NOT_A,
    limitations: [bi('כל ערך כפי שהוזן מהמסמך — במטבע וביחידות שלו', 'every value as entered from the document — in its currency and units'), bi('יחסים רק מתוך דוח אחד; דגלים רק מול התקופה המקבילה', 'ratios only within one statement; flags only against the comparable period'), bi('אין ציון ואין הסתברות כשל', 'no score and no probability of default')],
  };
}

module.exports = { VERSION, FIELDS, BALANCE, FLOWS, THRESHOLDS, NOT_A, NO_STATEMENTS, BASIS, statementsFromDocs, byPeriod, debtOf, netDebtOf, ratiosOf, comparableOf, ratingRank, flagsOf, profile };
