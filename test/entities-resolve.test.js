'use strict';
/* ENTITY RESOLUTION gates (18.10.2026) — lib/entities/resolve.js: the canonical entity model, match states and reasons.
   Hard truths: a name alone is never VERIFIED; an identical normalized legal name with one registry row is STRONG; the same
   letters only is POSSIBLE; several candidates are AMBIGUOUS (never picked); no key → UNRESOLVED; a chain is as strong as
   its weakest link; PARENT / SUBSIDIARY / SPV / GUARANTOR are NOT resolvable (said, never inferred). */
const assert = require('node:assert/strict');
const R = require('../lib/entities/resolve');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const idx = R.buildIndex({ fetchedAt: '2026-10-18T05:00:00Z', sourceModified: '2026-10-18T01:22:42Z', rows: [
  { num: 511399388, name: 'י.ח. דמרי בניה ופיתוח בע~מ', status: 'פעילה', type: 'ישראלית חברה ציבורית', violating: '', lastReport: 2026, incorporated: '1989-07-09', city: 'נתיבות' },
  { num: 510865058, name: 'פרץ בוני הנגב-אחים פרץ בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית', violating: '', lastReport: 2026 },
  { num: 515384840, name: 'מגידו י.ק. יזום בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' },
  { num: 513201582, name: 'עמרם אברהם חברה לבנין   בע~מ', status: 'פעילה', type: 'ישראלית חברה ציבורית', lastReport: 2020 },
  { num: 1001, name: 'א.ב. יזמות בע~מ', status: 'מחוקה', type: 'ישראלית חברה פרטית' },
  { num: 1002, name: 'א.ב יזמות בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' },
  { num: 1003, name: 'גד השקעות בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' },
  { num: 1004, name: 'זרה לימיטד', status: 'פעילה', type: 'חו~ל חברה זרה', violating: 'מפרה' },
  { num: 1005, name: 'אפריקה ישראל מגורים ג\'י.פי בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' },
] }, { fetchedAt: '2026-10-18', rows: [{ num: 530000001, name: 'אחים כהן ש.מ', status: 'פעילה', type: 'ישראלית כללית', kind: 'partnership' }] });
const dev = (name, kind = 'company', extra = {}) => ({ id: 'dev-x', canonical: name, kind, joint: false, ...extra });

console.log('entities-resolve');
t('the model names every entity type of the brief with an id scheme; ownership types are NOT resolvable in coverage', () => {
  for (const k of ['LEGAL_COMPANY', 'DEVELOPER_BRAND', 'PARENT_COMPANY', 'SUBSIDIARY', 'PROJECT_SPV', 'LAND_WINNER', 'PROJECT_OWNER', 'CONTRACTOR', 'EXECUTING_CONTRACTOR', 'PROJECT', 'MARKETING_NAME', 'PLAN', 'TENDER', 'LOT', 'BLOCK_PARCEL', 'ADDRESS', 'BUILDING_SITE', 'PERMIT_RECORD']) assert.ok(R.ENTITY_MODEL[k] && R.ENTITY_MODEL[k].idScheme, k);
  for (const k of ['PARENT_COMPANY', 'SUBSIDIARY', 'PROJECT_SPV']) { assert.equal(R.ENTITY_MODEL[k].coverage, 'NONE'); assert.equal(R.ENTITY_MODEL[k].establishedBy.length, 0); assert.match(R.ENTITY_MODEL[k].note.en, /not resolvable/i); }
});
t('five match states, ranked; a chain is as strong as its weakest link', () => {
  assert.deepEqual(Object.keys(R.MATCH), ['VERIFIED', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'AMBIGUOUS', 'UNRESOLVED']);
  assert.equal(R.weakest(['VERIFIED', 'STRONG_MATCH']), 'STRONG_MATCH'); assert.equal(R.weakest(['VERIFIED', 'VERIFIED']), 'VERIFIED'); assert.equal(R.weakest(['STRONG_MATCH', 'UNRESOLVED']), 'UNRESOLVED'); assert.equal(R.weakest(['POSSIBLE_MATCH', 'AMBIGUOUS']), 'AMBIGUOUS');
});
t('regKey: the Registrar\'s ~, hyphens, dots and spacing meet the tender spelling; it is a key, not an identity', () => {
  assert.equal(R.regKey('י.ח. דמרי בניה ופיתוח בע"מ'), R.regKey('י.ח. דמרי בניה ופיתוח בע~מ'));
  assert.equal(R.regKey('פרץ בוני הנגב אחים פרץ בע"מ'), R.regKey('פרץ בוני הנגב-אחים פרץ בע~מ'));
  assert.equal(R.regKey('מגידו י.ק יזום בע"מ'), R.regKey('מגידו י.ק. יזום בע~מ'));
  assert.equal(R.regKey('עמרם אברהם חברה לבנין בע"מ'), R.regKey('עמרם אברהם חברה לבנין   בע~מ'));
  assert.notEqual(R.regKey('אפריקה ישראל מגורים בע"מ'), R.regKey('אפריקה ישראל מגורים ג\'י.פי בע~מ'));
});
t('exact normalized legal name + one row → STRONG MATCH, never VERIFIED; the reasons say so', () => {
  const r = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ'), idx);
  assert.equal(r.state, 'STRONG_MATCH'); assert.equal(r.chosen.num, 511399388); assert.equal(r.basis, 'normalized-name');
  assert.ok(r.reasons.some((x) => x.code === 'NAME_ONLY_NEVER_VERIFIED')); assert.ok(r.reasons.some((x) => x.code === 'EXACT_NORMALIZED_LEGAL_NAME_ONE_ROW'));
  for (const nm of ['פרץ בוני הנגב אחים פרץ בע"מ', 'מגידו י.ק יזום בע"מ', 'עמרם אברהם חברה לבנין בע"מ']) assert.equal(R.resolveCompany(dev(nm), idx).state, 'STRONG_MATCH', nm);
});
t('two registry rows under one normalized name (a struck-off and an active) → AMBIGUOUS with both candidates, none chosen', () => {
  const r = R.resolveCompany(dev('א.ב. יזמות בע"מ'), idx);
  assert.equal(r.state, 'AMBIGUOUS'); assert.equal(r.chosen, null); assert.equal(r.candidates.length, 2); assert.ok(r.reasons.some((x) => x.code === 'SAME_NORMALIZED_NAME_MULTIPLE_ROWS'));
});
t('the same letters with different spacing ("ג.ד." vs "גד") → POSSIBLE MATCH (one row), never chosen', () => {
  const r = R.resolveCompany(dev('ג.ד. השקעות בע"מ'), idx);
  assert.equal(r.state, 'POSSIBLE_MATCH'); assert.equal(r.chosen, null); assert.equal(r.candidates[0].num, 1003);
});
t('a brand fragment of another company\'s name is NOT a match (sub-string / similarity never used)', () => {
  assert.equal(R.resolveCompany(dev('אפריקה ישראל מגורים בע"מ'), idx).state, 'UNRESOLVED');
});
t('no legal form (a private person) / a joint string / a missing registry → UNRESOLVED with the reason', () => {
  assert.equal(R.resolveCompany(dev('משה כהן', 'unmarked'), idx).reasons[0].code, 'NAME_WITHOUT_LEGAL_FORM');
  assert.equal(R.resolveCompany(dev('א בע"מ, ב בע"מ', 'company', { joint: true }), idx).reasons[0].code, 'JOINT_WINNER_STRING');
  assert.equal(R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ'), R.buildIndex(null, null)).reasons[0].code, 'REGISTRY_NOT_SYNCED');
});
t('a company number from a source or the user → VERIFIED; an unknown number → UNRESOLVED (not in coverage), never a name fallback', () => {
  assert.equal(R.resolveCompany(dev('משהו אחר בע"מ'), idx, { companyNumber: 511399388 }).state, 'VERIFIED');
  assert.equal(R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ', 'company', { companyId: 511399388 }), idx).reasons[0].code, 'COMPANY_NUMBER_FROM_SOURCE');
  const u = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ'), idx, { companyNumber: 42 }); assert.equal(u.state, 'UNRESOLVED'); assert.ok(u.reasons.some((x) => x.code === 'REGISTRY_ROW_NOT_IN_COVERAGE'));
});
t('partnership-kind names resolve against the partnerships register only', () => {
  assert.equal(R.resolveCompany(dev('אחים כהן ש.מ', 'partnership'), idx).state, 'STRONG_MATCH');
  assert.equal(R.resolveCompany(dev('אחים כהן ש.מ', 'company'), idx).state, 'UNRESOLVED');
});
t('contractor: executor_id = MISPAR_KABLAN → VERIFIED; its company number → VERIFIED company; an individual → no company', () => {
  const C = R.buildContractorsIndex({ fetchedAt: '2026-10-18', rows: [{ kablan: '8011', company: '510865058', name: 'פרץ בוני הנגב אחים פרץ בע', branch: 'בניה', group: 'ג', sivug: '5' }, { kablan: '8011', company: '510865058', name: 'פרץ בוני הנגב אחים פרץ בע', branch: 'כבישים', group: 'ג', sivug: '3' }, { kablan: '100', company: null, name: 'משה לוי', branch: 'שיפוצים' }] });
  const a = R.resolveContractor(8011, C); assert.equal(a.state, 'VERIFIED'); assert.equal(a.branches.length, 2);
  assert.equal(R.contractorCompany(a.chosen, idx).state, 'VERIFIED'); assert.equal(R.contractorCompany(a.chosen, idx).chosen.num, 510865058);
  assert.equal(R.resolveContractor(null, C).reasons[0].code, 'NO_EXECUTOR_ID'); assert.equal(R.resolveContractor(777, C).state, 'UNRESOLVED');
  assert.equal(R.contractorCompany(R.resolveContractor(100, C).chosen, idx).reasons[0].code, 'NO_COMPANY_NUMBER_ON_ROW');
  assert.equal(R.resolveByName('פרץ בוני הנגב אחים פרץ בע"מ', C.byRegKey, { entity: 'CONTRACTOR' }).state, 'UNRESOLVED', 'the register wrote "בע" — a different normalized name is not a match');
  assert.equal(R.resolveByName('פרץ בוני הנגב אחים פרץ בע', C.byRegKey, { entity: 'CONTRACTOR' }).state, 'STRONG_MATCH', 'two branch rows of one contractor are one entity');
});
t('company facts: status class + verbatim; the registry TYPE alone sets the financial-data coverage class; breach ≠ insolvency', () => {
  const f = R.companyFacts(idx.companies.byNumber.get('511399388'));
  assert.equal(f.id, 'co:511399388'); assert.equal(f.status.cls, 'ACTIVE'); assert.equal(f.financialCoverage.cls, 'PUBLIC_COMPANY'); assert.equal(f.financialCoverage.statementsAvailable, false); assert.equal(f.violating.flag, false);
  const z = R.companyFacts(idx.companies.byNumber.get('1004')); assert.equal(z.financialCoverage.cls, 'FOREIGN_COMPANY'); assert.equal(z.violating.flag, true); assert.match(z.violating.label.en, /NOT insolvency/);
  assert.equal(R.statusClassOf('בפרוק ע~י בימ~ש').cls, 'IN_COURT_LIQUIDATION'); assert.equal(R.statusClassOf('מחוקה').cls, 'STRUCK_OFF'); assert.equal(R.statusClassOf('בפרוק מרצון').cls, 'IN_VOLUNTARY_LIQUIDATION'); assert.equal(R.statusClassOf('').cls, 'UNKNOWN');
  assert.equal(R.financialCoverageOf('ישראלית חברה פרטית').cls, 'PRIVATE_WITH_LIMITED_PUBLIC_DATA'); assert.equal(R.financialCoverageOf(null).cls, 'UNKNOWN');
});
t('official keys from free text: a parcel parses, a lot number parses once, plurals do not', () => {
  assert.deepEqual(R.parseParcel('6979 / 3 '), { block: 6979, parcel: 3, key: 'parcel:6979/3' });
  assert.equal(R.parseParcel('בנייה גוש 6620 חלקה 21').key, 'parcel:6620/21'); assert.equal(R.parseParcel('רחוב התקוה 56'), null);
  assert.equal(R.parseLotNumber('בנייה מגרש 142-(שכ\' הפארק) באר שבע'), 142); assert.equal(R.parseLotNumber('מגרשים 101-105'), null); assert.equal(R.parseLotNumber('תיכון רעננה'), null);
});
console.log(`entities-resolve: ${n} gates passed`);
