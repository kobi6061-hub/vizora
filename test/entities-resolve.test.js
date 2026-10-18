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
  const ok = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ'), idx, { companyNumber: 511399388 }); assert.equal(ok.state, 'VERIFIED'); assert.equal(ok.userProvided, true);
  assert.ok(!ok.reasons.some((x) => x.code === 'USER_CONFIRMED_CANDIDATE'), 'a typed number is a user-provided key, not a confirmation');
  /* a user number whose registered name is NOT the observed name is shown as a candidate, never attached */
  const mm = R.resolveCompany(dev('משהו אחר בע"מ'), idx, { companyNumber: 511399388 }); assert.equal(mm.state, 'POSSIBLE_MATCH'); assert.equal(mm.chosen, null);
  assert.deepEqual(mm.reasons.map((x) => x.code), ['COMPANY_NUMBER_USER_PROVIDED', 'USER_KEY_NAME_MISMATCH']); assert.equal(mm.candidates[0].num, 511399388);
  assert.equal(R.resolveCompany(dev('משהו אחר בע"מ'), idx, { companyNumber: 511399388, confirmedCandidate: true }).state, 'POSSIBLE_MATCH', 'a confirmation flag never overrides the name check');
  assert.equal(R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ', 'company', { companyId: 511399388 }), idx).reasons[0].code, 'COMPANY_NUMBER_FROM_SOURCE');
  const u = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ'), idx, { companyNumber: 512345678 }); assert.equal(u.state, 'UNRESOLVED'); assert.ok(u.reasons.some((x) => x.code === 'REGISTRY_ROW_NOT_IN_COVERAGE'));
  const bad = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ'), idx, { companyNumber: '42' }); assert.equal(bad.state, 'UNRESOLVED', 'a malformed user number is refused, never replaced by the name'); assert.ok(bad.reasons.some((x) => x.code === 'INVALID_COMPANY_NUMBER'));
  const conf = R.resolveCompany(dev('א.ב. יזמות בע"מ'), idx, { companyNumber: '1002', confirmedCandidate: true }); assert.equal(conf.state, 'UNRESOLVED', '4-digit fixture numbers are not company numbers');
});
t('a plene / defective spelling variant (בניה / בנייה, פתוח / פיתוח) → POSSIBLE MATCH with the candidate, never chosen', () => {
  const I2 = R.buildIndex({ fetchedAt: '2026-10-18', rows: [{ num: 512000001, name: 'רמי שבירו הנדסה בנייה והשקעות בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' }, { num: 512000002, name: 'אביסרור משה ובניו עבודות בניין ופיתוח בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' }, { num: 512000003, name: 'אביסרור משה ובניו עבודות בנין ופיתוח בע~מ', status: 'מחוקה', type: 'ישראלית חברה פרטית' }] }, null);
  const a = R.resolveCompany(dev('רמי שבירו הנדסה בניה והשקעות בע"מ'), I2); assert.equal(a.state, 'POSSIBLE_MATCH'); assert.equal(a.chosen, null); assert.equal(a.candidates[0].num, 512000001); assert.ok(a.reasons.some((x) => x.code === 'SPELLING_VARIANT_ONE_ROW'));
  const b = R.resolveCompany(dev('אביסרור משה ובניו עבודות בנין ופתוח בע"מ'), I2); assert.equal(b.state, 'AMBIGUOUS'); assert.equal(b.candidates.length, 2);
});
t('a joint winner string is not one entity: UNRESOLVED as a whole, every party resolved on its own', () => {
  const r = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ, גד השקעות בע"מ', 'company', { joint: true }), idx);
  assert.equal(r.state, 'UNRESOLVED'); assert.equal(r.chosen, null); assert.ok(r.reasons.some((x) => x.code === 'JOINT_PARTIES_RESOLVED_SEPARATELY'));
  assert.deepEqual(r.parties.map((p) => [p.name, p.state]), [['י.ח. דמרי בניה ופיתוח בע"מ', 'STRONG_MATCH'], ['גד השקעות בע"מ', 'STRONG_MATCH']]);
  /* a part without a legal form (a private person — or a fragment of one name cut at a comma) is not guessed: the string is not split */
  const q = R.resolveCompany(dev('י.ח. דמרי בניה ופיתוח בע"מ, משה כהן', 'company', { joint: true }), idx);
  assert.equal(q.state, 'UNRESOLVED'); assert.ok(q.reasons.some((x) => x.code === 'JOINT_STRING_NOT_SPLITTABLE')); assert.equal((q.parties || []).length, 0);
});
t('resolved ambiguity: the user supplies the company number of one candidate → VERIFIED on a user-provided key (labelled), the other candidate untouched', () => {
  const r = R.resolveCompany(dev('א.ב. יזמות בע"מ'), R.buildIndex({ fetchedAt: '2026-10-18', rows: [{ num: 512000011, name: 'א.ב. יזמות בע~מ', status: 'מחוקה' }, { num: 512000012, name: 'א.ב יזמות בע~מ', status: 'פעילה' }] }, null), { companyNumber: '512000012', confirmedCandidate: true });
  assert.equal(r.state, 'VERIFIED'); assert.equal(r.chosen.num, 512000012); assert.equal(r.userProvided, true); assert.equal(r.basis, 'user-provided-key');
  assert.deepEqual(r.reasons.map((x) => x.code), ['COMPANY_NUMBER_USER_PROVIDED', 'USER_CONFIRMED_CANDIDATE', 'REGISTRY_ROW_FOUND']);
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
t('a comma inside ONE registered name: the whole name is resolved first (STRONG), never split into "parties"', () => {
  const I3 = R.buildIndex({ fetchedAt: '2026-10-18', rows: [{ num: 512000021, name: 'פרץ לוזון, בנין ופתוח בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' }, { num: 512000022, name: 'גמא בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' }, { num: 512000023, name: 'דלתא בע~מ', status: 'פעילה', type: 'ישראלית חברה פרטית' }] }, null);
  const a = R.resolveCompany(dev('פרץ לוזון, בנין ופתוח בע"מ', 'company', { joint: true }), I3);
  assert.equal(a.state, 'STRONG_MATCH'); assert.equal(a.chosen.num, 512000021); assert.ok(a.reasons.some((x) => x.code === 'COMMA_IN_REGISTERED_NAME'));
  /* a real joint string: every part carries a legal form → split, each party on its own */
  const b = R.resolveCompany(dev('גמא בע"מ, דלתא בע"מ', 'company', { joint: true }), I3); assert.equal(b.state, 'UNRESOLVED'); assert.deepEqual(b.parties.map((x) => x.state), ['STRONG_MATCH', 'STRONG_MATCH']);
  /* a part without a legal-form marker → the string is not splittable: nothing is guessed */
  const c = R.resolveCompany(dev('גמא בע"מ, בנין ופתוח', 'company', { joint: true }), I3); assert.equal(c.state, 'UNRESOLVED'); assert.ok(c.reasons.some((x) => x.code === 'JOINT_STRING_NOT_SPLITTABLE')); assert.equal((c.parties || []).length, 0);
});
t('status AND sub-status classify: an order opening proceedings / rehabilitation / an arrangement is said as the registrar writes it', () => {
  assert.equal(R.statusClassOf('פעילה', 'צו לפתיחת הליכים').cls, 'INSOLVENCY_PROCEEDINGS');
  assert.equal(R.statusClassOf('פעילה', 'צו לפתיחת הליכים - תאגיד בשיקום').cls, 'INSOLVENCY_PROCEEDINGS');
  assert.equal(R.statusClassOf('בפרוק ע~י בימ~ש', 'צו לפתיחת הליכים').cls, 'INSOLVENCY_PROCEEDINGS');
  assert.equal(R.statusClassOf('פעילה/בפירוק - הליך פשרה או הסדר/פירוק זמני', 'פעילה').cls, 'ARRANGEMENT_OR_PROVISIONAL_LIQUIDATION');
  assert.equal(R.statusClassOf('פעילה', 'בפרוק מרצון בהליך מזורז').cls, 'IN_VOLUNTARY_LIQUIDATION');
  assert.equal(R.statusClassOf('פעילה', 'בהליכי מחיקה').cls, 'STRIKE_OFF_PENDING');
  assert.equal(R.statusClassOf('פעילה', 'הוגשה בקשת מיזוג - מיועדת לקלוט').cls, 'ACTIVE', 'a merger application is not a distress status');
  const s = R.statusClassOf('פעילה', 'צו לפתיחת הליכים'); assert.equal(s.verbatim, 'פעילה'); assert.equal(s.sub, 'צו לפתיחת הליכים');
  const f = R.companyFacts({ num: 512000031, name: 'ק.מ. בע~מ', status: 'פעילה', sub: 'צו לפתיחת הליכים', type: 'ישראלית חברה פרטית' }); assert.equal(f.status.cls, 'INSOLVENCY_PROCEEDINGS'); assert.equal(f.status.sub, 'צו לפתיחת הליכים');
});
t('resolution lift without lowering the bar: the abbreviation "חב׳" = "חברה" only; the contractors register as a second official register (a name → ONE company number)', () => {
  const companies = { fetchedAt: '2026-10-18', rows: [{ num: 512000041, name: 'אחים אוזן חברה לבניה בע~מ', status: 'פעילה' }, { num: 512000042, name: 'שבירו הנדסה בניה והשקעות בע~מ', status: 'פעילה' }, { num: 512000043, name: 'כפולה בע~מ', status: 'פעילה' }, { num: 512000044, name: 'כפולה בע~מ', status: 'מחוקה' }, { num: 512000045, name: 'אחר בע~מ', status: 'פעילה' }] };
  const I = R.buildIndex(companies, null);
  I.contractors = R.buildContractorsIndex({ fetchedAt: '2026-10-18', rows: [{ kablan: '9001', company: '512000042', name: 'רמי שבירו הנדסה בניה והשקעות בע"מ' }, { kablan: '9002', company: '512000043', name: 'כפולה בע"מ' }, { kablan: '9003', company: '512000045', name: 'סתירה בע"מ' }, { kablan: '9004', company: '512000041', name: 'סתירה בע"מ' }, { kablan: '9005', company: null, name: 'יחיד קבלן' }] });
  const a = R.resolveCompany(dev(`אחים אוזן חב' לבניה בע"מ`), I); assert.equal(a.state, 'STRONG_MATCH'); assert.ok(a.reasons.some((x) => x.code === 'ABBREVIATION_NORMALIZED'));
  assert.equal(R.regKey('חבר הנדסה בע"מ').includes('חברה'), false, 'only the whole word חב expands');
  const b = R.resolveCompany(dev('רמי שבירו הנדסה בניה והשקעות בע"מ'), I); assert.equal(b.state, 'STRONG_MATCH'); assert.equal(b.chosen.num, 512000042); assert.equal(b.basis, 'contractor-register'); assert.ok(b.reasons.some((x) => x.code === 'CONTRACTOR_REGISTER_NAME_TO_NUMBER')); assert.ok(b.reasons.some((x) => x.code === 'NAME_ONLY_NEVER_VERIFIED'), 'still a name at the first link — never VERIFIED');
  const c = R.resolveCompany(dev('כפולה בע"מ'), I); assert.equal(c.state, 'STRONG_MATCH'); assert.equal(c.chosen.num, 512000043); assert.ok(c.reasons.some((x) => x.code === 'CONTRACTOR_REGISTER_DISAMBIGUATES')); assert.equal(c.candidates.length, 1);
  const d = R.resolveCompany(dev('סתירה בע"מ'), I); assert.equal(d.state, 'AMBIGUOUS'); assert.ok(d.reasons.some((x) => x.code === 'CONTRACTOR_REGISTER_SEVERAL_NUMBERS'), 'the register lists the name with two numbers — none chosen');
  const I2 = R.buildIndex(companies, null); I2.contractors = R.buildContractorsIndex({ rows: [{ kablan: '9006', company: '512000045', name: 'שבירו הנדסה בניה והשקעות בע"מ' }] });
  const e = R.resolveCompany(dev('שבירו הנדסה בניה והשקעות בע"מ'), I2); assert.equal(e.state, 'AMBIGUOUS'); assert.ok(e.reasons.some((x) => x.code === 'CONTRACTOR_REGISTER_NUMBER_CONFLICT'), 'the registry and the contractors register disagree — both shown, none chosen');
  assert.equal(R.resolveCompany(dev('יחיד קבלן'), I).state, 'UNRESOLVED', 'an individual contractor row carries no company number — no lift');
});
t('official keys from free text: a parcel parses, a lot number parses once, plurals do not', () => {
  assert.deepEqual(R.parseParcel('6979 / 3 '), { block: 6979, parcel: 3, key: 'parcel:6979/3' });
  assert.equal(R.parseParcel('בנייה גוש 6620 חלקה 21').key, 'parcel:6620/21'); assert.equal(R.parseParcel('רחוב התקוה 56'), null);
  assert.equal(R.parseLotNumber('בנייה מגרש 142-(שכ\' הפארק) באר שבע'), 142); assert.equal(R.parseLotNumber('מגרשים 101-105'), null); assert.equal(R.parseLotNumber('תיכון רעננה'), null);
});
console.log(`entities-resolve: ${n} gates passed`);
