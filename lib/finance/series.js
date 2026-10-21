// PROPX · housing finance (Bank of Israel SDMX) — the measures PROPX reads, each defined by its DIMENSION CODES in the Bank of Israel's
// own data structure (never by a series number or a name), and the code NAMES that must stand behind those codes in the published
// codelists every run (the name verifies the code; a mismatch is SCHEMA_CHANGED and the measure is not read).
//
// Universe: the whole banking system (REP_ENTITY 99034), households, monthly. New housing loans = loans "for housing purposes" issued
// in the month (BIR_COVERAGE N); refinanced loans (RC) apart. Balances = the stock of housing credit at month end (BMB_99).
// Nothing here is a locality or district figure — national banking-system figures only.

'use strict';

const FLOWS = Object.freeze({
  BIR_MRTG_99: { id: 'BIR_MRTG_99', he: 'ריביות והיקפי פעילות — הלוואות לדיור (ביצועים חדשים)', en: 'Interest rates and business volume — housing loans (new loans)' },
  BMB_99: { id: 'BMB_99', he: 'יתרות אשראי לדיור', en: 'Balances — housing credit' },
});

/* the codes every new-loan measure shares unless it overrides them: banking system · all rates · all indexation · all LTV · all PTI ·
   all property values · new loans · housing credit */
const NEW = { REP_ENTITY: '99034', BIR_COVERAGE: 'N', BS_ITEM: 'A2C', IR_FV_TYPE: 'A', INDEXATION_TYPE: '_T', LTV: 'L0', PTI: 'P01', PROPERTY_VALUE: 'A', INT_CHN_PER: 'A' };
const BAL = { REP_ENTITY: '99034', BS_ITEM: 'A2C', IR_FV_TYPE: 'A', INDEXATION_TYPE: '_T', COUNTERPART_SECTOR: 'S14', COUNTERPART_AREA: 'W0', CURR_BAL_SETT: 'L0', EXP_TYPE: '_T', PTI: 'P01' };

/* kind: amount (₪, after the series' unit multiplier) · count · rate (% a year) · ratio (%) */
const M = (id, flow, filter, kind, he, en, extra = {}) => Object.freeze({ id, flow, filter: Object.freeze(filter), kind, he, en, ...extra });
const MEASURES = Object.freeze([
  M('newLoans', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B' }, 'amount', 'הלוואות לדיור חדשות — סכום', 'New housing loans — amount'),
  M('newLoansSA', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B_SA' }, 'amount', 'הלוואות לדיור חדשות — סכום, מנוכה עונתיות', 'New housing loans — amount, seasonally adjusted'),
  M('newLoansCount', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'N' }, 'count', 'הלוואות לדיור חדשות — מספר', 'New housing loans — number'),
  M('pti', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'PTI' }, 'ratio', 'שיעור החזר מהכנסה — ממוצע בהלוואות החדשות', 'Payment-to-income — average of new loans'),
  M('rateFixedUnindexed', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'R', IR_FV_TYPE: 'F', INDEXATION_TYPE: 'NI' }, 'rate', 'ריבית — קבועה לא צמודה', 'Interest — fixed, unindexed'),
  M('rateFixedCpi', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'R', IR_FV_TYPE: 'F', INDEXATION_TYPE: 'CPI' }, 'rate', 'ריבית — קבועה צמודה למדד', 'Interest — fixed, CPI-indexed'),
  M('rateCpi', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'R', INDEXATION_TYPE: 'CPI' }, 'rate', 'ריבית — צמודה למדד (כל הריביות)', 'Interest — CPI-indexed (all rate types)'),
  M('variableUnindexedAnchor', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'RB', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'NI' }, 'rate', 'ריבית עוגן — משתנה לא צמודה', 'Anchor rate — variable, unindexed'),
  M('variableUnindexedMargin', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'RM', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'NI' }, 'rate', 'מרווח מעל העוגן — משתנה לא צמודה', 'Margin over the anchor — variable, unindexed'),
  M('variableCpiAnchor', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'RB', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'CPI' }, 'rate', 'ריבית עוגן — משתנה צמודה למדד', 'Anchor rate — variable, CPI-indexed'),
  M('variableCpiMargin', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'RM', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'CPI' }, 'rate', 'מרווח מעל העוגן — משתנה צמודה למדד', 'Margin over the anchor — variable, CPI-indexed'),
  M('newLoansFixedUnindexed', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BS_ITEM: 'A2CX2', IR_FV_TYPE: 'F', INDEXATION_TYPE: 'NI' }, 'amount', 'סכום — קבועה לא צמודה (למעט קבוצות רכישה)', 'Amount — fixed, unindexed (excl. purchase groups)', { track: true }),
  M('newLoansVariableUnindexed', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BS_ITEM: 'A2CX2', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'NI' }, 'amount', 'סכום — משתנה לא צמודה (למעט קבוצות רכישה)', 'Amount — variable, unindexed (excl. purchase groups)', { track: true }),
  M('newLoansFixedCpi', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BS_ITEM: 'A2CX2', IR_FV_TYPE: 'F', INDEXATION_TYPE: 'CPI' }, 'amount', 'סכום — קבועה צמודה (למעט קבוצות רכישה)', 'Amount — fixed, CPI-indexed (excl. purchase groups)', { track: true }),
  M('newLoansVariableCpi', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BS_ITEM: 'A2CX2', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'CPI' }, 'amount', 'סכום — משתנה צמודה (למעט קבוצות רכישה)', 'Amount — variable, CPI-indexed (excl. purchase groups)', { track: true }),
  M('investmentLoans', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BS_ITEM: 'A2C5' }, 'amount', 'הלוואות לדירה להשקעה — סכום', 'Loans for an investment dwelling — amount'),
  M('investmentLoansCount', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'N', BS_ITEM: 'A2C5' }, 'count', 'הלוואות לדירה להשקעה — מספר', 'Loans for an investment dwelling — number'),
  M('reducedPriceLoans', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BS_ITEM: 'A2C1' }, 'amount', 'הלוואות לדיור במחיר מופחת — סכום', 'Loans for reduced-price housing — amount'),
  M('reducedPriceLoansCount', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'N', BS_ITEM: 'A2C1' }, 'count', 'הלוואות לדיור במחיר מופחת — מספר', 'Loans for reduced-price housing — number'),
  M('refinancedLoans', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', BIR_COVERAGE: 'RC' }, 'amount', 'הלוואות שמוחזרו (מחזור) — סכום', 'Refinanced loans — amount'),
  M('refinancedLoansCount', 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'N', BIR_COVERAGE: 'RC' }, 'count', 'הלוואות שמוחזרו (מחזור) — מספר', 'Refinanced loans — number'),
  ...[['L1', 'עד 30%', 'up to 30%'], ['L2', '30%–45%', '30%–45%'], ['L3', '45%–60%', '45%–60%'], ['L4', '60%–75%', '60%–75%'], ['L5', '75%–90%', '75%–90%'], ['L6', 'מעל 90%', 'over 90%'], ['L7', 'ללא בטוחה', 'computed without collateral']]
    .map(([c, he, en]) => M('ltv' + c, 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', LTV: c }, 'amount', `הלוואות חדשות בשיעור מימון ${he} — סכום`, `New loans at a loan-to-value of ${en} — amount`, { band: 'ltv' })),
  ...[['P10', 'עד 10%', 'up to 10%'], ['P11', '10%–20%', '10%–20%'], ['P03', '20%–30%', '20%–30%'], ['P04', '30%–40%', '30%–40%'], ['P12', '40%–50%', '40%–50%'], ['P13', '50%–60%', '50%–60%'], ['P14', '60%–80%', '60%–80%'], ['P15', 'מעל 80%', 'over 80%']]
    .map(([c, he, en]) => M('pti' + c, 'BIR_MRTG_99', { ...NEW, DATA_TYPE: 'B', PTI: c }, 'amount', `הלוואות חדשות בשיעור החזר מהכנסה ${he} — סכום`, `New loans at a payment-to-income of ${en} — amount`, { band: 'pti' })),
  M('balance', 'BMB_99', { ...BAL, DATA_TYPE: 'O' }, 'amount', 'יתרת האשראי לדיור — משקי בית', 'Outstanding housing credit — households'),
  M('balanceCount', 'BMB_99', { ...BAL, DATA_TYPE: 'N' }, 'count', 'מספר ההלוואות לדיור ביתרה', 'Housing loans outstanding — number'),
  M('balanceArrears90', 'BMB_99', { ...BAL, DATA_TYPE: 'O', EXP_TYPE: 'P6' }, 'amount', 'יתרה בפיגור של 90 יום ומעלה', 'Outstanding in arrears of 90 days or more'),
  M('balanceFixedUnindexed', 'BMB_99', { ...BAL, DATA_TYPE: 'O', IR_FV_TYPE: 'F', INDEXATION_TYPE: 'NI' }, 'amount', 'יתרה — קבועה לא צמודה', 'Outstanding — fixed, unindexed', { track: true }),
  M('balanceVariableUnindexed', 'BMB_99', { ...BAL, DATA_TYPE: 'O', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'NI' }, 'amount', 'יתרה — משתנה לא צמודה', 'Outstanding — variable, unindexed', { track: true }),
  M('balanceFixedCpi', 'BMB_99', { ...BAL, DATA_TYPE: 'O', IR_FV_TYPE: 'F', INDEXATION_TYPE: 'CPI' }, 'amount', 'יתרה — קבועה צמודה', 'Outstanding — fixed, CPI-indexed', { track: true }),
  M('balanceVariableCpi', 'BMB_99', { ...BAL, DATA_TYPE: 'O', IR_FV_TYPE: 'V', INDEXATION_TYPE: 'CPI' }, 'amount', 'יתרה — משתנה צמודה', 'Outstanding — variable, CPI-indexed', { track: true }),
]);

/* the codelist NAME that must stand behind each code a measure uses (Hebrew names as the Bank of Israel publishes them) — checked
   every run against the structure the same response family carries; the name verifies the code, the code selects the data */
const VERIFY = Object.freeze({
  REP_ENTITY: { 99034: /סך מערכת בנקאית/ },
  BS_ITEM: { A2C: /^אשראי למטרת מגורים$/, A2CX2: /למעט קבוצות רכישה/, A2C5: /דירה להשקעה/, A2C1: /מחיר מופחת/ },
  DATA_TYPE: { B: /^סכום ביצועים$/, B_SA: /סכום ביצועים.*מנוכה עונתיות/, N: /^מספר הלוואות$/, R: /^ריבית$/, RB: /^ריבית עוגן$/, RM: /^ריבית - הוספה/, PTI: /^שיעור החזר מהכנסה$/, O: /^יתרה$/ },
  IR_FV_TYPE: { A: /כל הריביות/, F: /^קבועה$/, V: /^משתנה$/ },
  INDEXATION_TYPE: { _T: /סך מגזרי הצמדה/, NI: /^לא צמוד$/, CPI: /^צמוד מדד$/ },
  BIR_COVERAGE: { N: /^חדש$/, RC: /^מוחזר$/ },
  LTV: { L0: /^סה"כ$/, L1: /שיעור מימון עד 30%/, L2: /שיעור מימון מעל 30% עד 45%/, L3: /שיעור מימון מעל 45% עד 60%/, L4: /שיעור מימון מעל 60% עד 75%/, L5: /שיעור מימון מעל 75% עד 90%/, L6: /שיעור מימון מעל 90%/, L7: /ללא בטוחה/ },
  PTI: { P01: /^סה"כ$/, P10: /עד 10%/, P11: /מעל 10% עד 20%/, P03: /מעל 20% עד 30%/, P04: /מעל 30% עד 40%/, P12: /מעל 40% עד 50%/, P13: /מעל 50% עד 60%/, P14: /מעל 60% עד 80%/, P15: /מעל 80%/ },
  COUNTERPART_SECTOR: { S14: /^משקי בית$/ },
  /* the SDMX area list: W0 = the world / all counterparties (not W1 "rest of the world", not W2 "domestic") */
  COUNTERPART_AREA: { W0: /^(?!.*(rest of|שאר)).*(world|all entities|עולם|כל)/i },
  PROPERTY_VALUE: { A: /^סה"כ$/ },
  INT_CHN_PER: { A: /^סה"כ$/ },
  EXP_TYPE: { _T: /^סך הכל$/, P6: /בפיגור של 90 יום ומעלה/ },
  CURR_BAL_SETT: { L0: /^סה"כ$/ },
});

const SOURCE = Object.freeze({
  id: 'boi:housing-finance', publisher: 'בנק ישראל', publisherEn: 'Bank of Israel',
  dataset: 'נתוני הלוואות לדיור — מערכת הבנקאות (SDMX)', datasetEn: 'Housing loans — the banking system (SDMX)',
  base: 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/', agency: 'BOI.STATISTICS',
  page: 'https://www.boi.org.il/roles/statistics/', licence: 'Bank of Israel terms of use for statistical data (public, attribution)',
  cadence: 'monthly — new loans about 4–6 weeks after the month; balances with the monthly banking statistics',
  classification: 'OFFICIAL', geography: 'Israel — the whole banking system (REP_ENTITY 99034); no locality or district series',
  /* freshness on a documented lag assumption (not an official calendar): a month's figures appear ≈ 4–6 weeks after it ends */
  lag: { currentDays: 75, lagDays: 120, basis: 'the 21.10.2026 discovery read held August 2026 for every new-loan series and September 2026 for the total amount (run 39605350990) — about 3–7 weeks after the month' },
});

const DIMS_USED = [...new Set(MEASURES.flatMap((m) => Object.keys(m.filter)))];

module.exports = { FLOWS, MEASURES, VERIFY, SOURCE, DIMS_USED };
