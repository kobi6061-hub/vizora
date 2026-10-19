'use strict';
/* TEST FIXTURE — user documents for test/group.test.js (Sponsor X-Ray). FICTIONAL: every relation, figure, series and date below is
   invented for the test; none is a real filing, a real holding or a real guarantee of the companies whose registry numbers are used as
   parties. The numbers are used only so the parties resolve in the synced registry (data/dd) by number + registered name — the rule
   that makes a document edge STRONG. Never read by the product. Provenance names the fixture. */

/**
 * build(nameOf, NOW) → { spvDeclarations, ownershipChart, mismatchChart, statements, statementsOtherEntity, bonds, litigation }
 *   nameOf(number) → the REGISTERED name (lib/entities/resolve companyFacts) — a document party written with it resolves STRONG
 */
function build(nameOf, NOW) {
  let seq = 0;
  const sha = () => (++seq).toString(16).padStart(8, '0').repeat(8);
  const doc = (type, fields) => ({ type, fields, provenance: { fileName: `TEST-FIXTURE-group-${type}-${seq + 1}.pdf`, fileSize: 1000, mime: 'application/pdf', sha256: sha(), enteredAt: NOW, issuer: 'PROPX TEST FIXTURE' } });
  const CORE = '511399388';                                     // the core company of the "public / many SPVs / with financials" cases
  const SPV = ['516298809', '516989167', '511474553'];          // registry rows used as fictional project companies
  const LOTS = ['ila:20250311:0000800032982', 'ila:20260156:0000800034684', 'ila:20250087:0000800024499'];
  const CHILD = '517256376';                                    // a registry row with its own developer brand — a fictional subsidiary
  const OTHER = '512879172';                                    // a registry row named with a DIFFERENT name in a document → POSSIBLE

  /* three developer declarations: the core as the stated parent of three project companies (one with an explicit parent guarantee) */
  const spvDeclarations = SPV.map((num, i) => doc('developer_declaration', { projectId: LOTS[i], asOf: '2026-09-01', projectCompanyName: nameOf(num), projectCompanyNumber: num, parentName: nameOf(CORE), parentNumber: CORE, guarantee: i === 0 ? 'explicit-parent-guarantee' : 'not-stated' }));
  /* an ownership chart: the core holds a company that has its own developer brand (100 %) — a DOCUMENTED subsidiary, never a guarantee */
  const ownershipChart = doc('ownership_chart', { asOf: '2026-06-30', relations: [{ parentNumber: CORE, parentName: nameOf(CORE), childNumber: CHILD, childName: nameOf(CHILD), sharePct: 100 }] });
  /* a chart whose held party's stated name differs from its registered name → NAME_DIFFERS → POSSIBLE, never expanded */
  const mismatchChart = doc('ownership_chart', { asOf: '2026-06-30', relations: [{ parentNumber: CORE, parentName: nameOf(CORE), childNumber: OTHER, childName: 'חברה בשם אחר בע"מ', sharePct: 60 }] });
  /* two comparable annual statements of the core (consolidated, ILS thousands) — leverage rises, liquidity weakens, OCF negative */
  const fs1 = (num, periodEnd, reportDate, figures) => doc('financial_statements', { entityNumber: num, periodEnd, periodKind: 'annual', reportDate, audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'thousands', ...figures });
  const statements = [
    fs1(CORE, '2024-12-31', '2025-03-20', { cash: 900000, shortTermDebt: 700000, longTermDebt: 1300000, nearTermDebt: 600000, equity: 2600000, totalAssets: 6200000, currentAssets: 3400000, currentLiabilities: 1700000, operatingProfit: 420000, financeExpenses: 90000, operatingCashFlow: 150000, inventoryWip: 2500000, customerAdvances: 400000 }),
    fs1(CORE, '2025-12-31', '2026-03-20', { cash: 500000, shortTermDebt: 1200000, longTermDebt: 1900000, nearTermDebt: 1100000, equity: 2400000, totalAssets: 7000000, currentAssets: 3300000, currentLiabilities: 2300000, operatingProfit: 300000, financeExpenses: 140000, operatingCashFlow: -200000, inventoryWip: 3100000, customerAdvances: 300000 }),
  ];
  /* a statement of ONE project company — must stay that entity's own, never added to the core */
  const statementsOtherEntity = [fs1(SPV[0], '2025-12-31', '2026-03-25', { cash: 10000, shortTermDebt: 250000, longTermDebt: 0, equity: 20000, totalAssets: 300000 })];
  const bonds = [doc('bond_covenants', { entityNumber: CORE, series: 'TEST-SERIES-A', asOf: '2026-06-30', covenant: 'equity ≥ threshold (fixture)', threshold: '1,500,000', actual: '2,400,000', compliant: 'yes', maturities: [{ date: '2027-06-30', amount: 400000 }, { date: '2028-06-30', amount: 400000 }] })];
  const litigation = [doc('litigation_disclosure', { entityNumber: CORE, asOf: '2026-06-30', kind: 'lawsuit', court: 'TEST FIXTURE court', caseNumber: 'TEST-0001', amount: 1000, currency: 'ILS', status: 'pending', material: 'not-stated' })];
  return { CORE, SPV, LOTS, CHILD, OTHER, doc, fs1, spvDeclarations, ownershipChart, mismatchChart, statements, statementsOtherEntity, bonds, litigation };
}

module.exports = { build };
