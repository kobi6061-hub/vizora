'use strict';
/* PREMIUM INSTITUTIONAL DILIGENCE 2.0 gates (18.10.2026) — lib/dd premium read models (financial profile, corporate structure,
   project company / SPV, legal exposure, sales, execution coverage, municipal permit connectors, user evidence, the
   institutional diligence summary, the live registry lookup) over the REAL synced data, with the user's documents as labelled
   TEST FIXTURES built here (fictional figures — never a real company's filing).

   Truth gates: NO FINANCIALS ≠ FINANCIAL WEAKNESS · PUBLIC COMPANY ≠ PROJECT SPV · PARENT ≠ GUARANTOR · SHAREHOLDER ≠ PROJECT
   SUPPORT · DEVELOPER-REPORTED SALES ≠ OFFICIAL SALES · MARKETING CLAIM ≠ VERIFIED FACT · PARCEL MATCH ≠ PROJECT MATCH · ADDRESS
   MATCH ≠ COMPANY OWNERSHIP · MUNICIPAL PERMIT COVERAGE ≠ NATIONAL COVERAGE · DISTRICT CONSTRUCTION DATA ≠ PROJECT CONSTRUCTION
   DATA · NO COURT ROW ≠ NO LITIGATION · NO PUBLIC OWNERSHIP DATA ≠ NO OWNER · USER-UPLOADED DOCUMENT ≠ OFFICIAL SOURCE.

   The 20 acceptance cases of the brief each record what PROPX knows, what it does not know, the class of each fact, what the
   user sees, what PROPX refuses to infer and what to verify next (DD_PREMIUM_ACCEPTANCE_OUT=<file> writes them as JSON). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DD = require('../lib/dd');
const D = require('../lib/dd/data');
const UD = require('../lib/dd/userdocs');
const FIN = require('../lib/dd/financial');
const STR = require('../lib/dd/structure');
const PCO = require('../lib/dd/projectco');
const LEG = require('../lib/dd/legal');
const SAL = require('../lib/dd/sales');
const COV = require('../lib/dd/coverage');
const SUM = require('../lib/dd/summary');
const LIVE = require('../lib/dd/live');
const PC = require('../lib/permits/connectors');
const PRJ = require('../lib/dd/project');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const at = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const NOW = '2026-10-18T10:00:00.000Z';
const C = D.load();
if (!C.synced) { console.log('dd-premium: data/dd not synced — skipped'); process.exit(0); }

/* ---- labelled TEST FIXTURE documents (fictional values; provenance names the fixture) ---- */
let seq = 0;
const sha = () => (++seq).toString(16).padStart(8, '0').repeat(8);
const doc = (type, fields, prov = {}) => ({ type, fields, provenance: { fileName: `TEST-FIXTURE-${type}-${seq + 1}.pdf`, fileSize: 1000, mime: 'application/pdf', sha256: sha(), enteredAt: NOW, issuer: 'PROPX TEST FIXTURE', ...prov } });
const fs1 = (entityNumber, periodEnd, reportDate, figures, extra = {}) => doc('financial_statements', { entityNumber, periodEnd, periodKind: 'annual', reportDate, audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'thousands', ...figures, ...extra });
const nameOf = (num) => { const r = C.idx.companies.byNumber.get(String(num)); return r ? r.name : null; };
const dev = (id, opt = {}) => DD.developer(id, { now: NOW, ...opt });
const prj = (id, opt = {}) => DD.project(id, { now: NOW, ...opt });
const rowOf = (S, id) => S.rows.find((r) => r.id === id);
const CASES = [];
const kase = (o) => { for (const k of ['id', 'title', 'knows', 'unknown', 'classes', 'sees', 'refuses', 'verifyNext']) assert.ok(o[k] != null && (!Array.isArray(o[k]) || o[k].length || k === 'unknown'), `case ${o.id}: ${k}`); CASES.push(o); };

/* real entities (re-checked below, never assumed) */
const DEMRI = 'dev-69edd3ba1aec', DEMRI_NO = '511399388';           // a public company (registry type), STRONG name match
const NETANYA_LOT = 'ila:20210310:0000800008476';                     // land winner resolves STRONG; its contractor = the same company
const TLV_LOT = 'ila:20220398:0000800017316';                         // Tel Aviv, STRONG site with a construction start; developer unresolved
const LOTTERY = 'moch:34712';                                         // MoCH lottery project; developer unresolved
const HAIFA_LOT = 'ila:20230362:0000800007873';                       // Haifa — no machine-readable municipal permits
const MOCH_JOIN_LOT = 'ila:20180249:30403637א';                        // a lot joined to the MoCH construction-progress report
const DISTRICT_ONLY_LOT = 'ila:20260158:0000800034527';                // outside Tel Aviv, no project-level start evidence
const AMBIG = 'dev-a1276169dfd7';                                     // the resolver finds several registry rows — none picked

console.log('dd-premium: source audit, connectors, registry');
t('the premium source audit is committed: 32 candidates, each with a verdict and evidence; MAYA / TASE / MAGNA / XBRL / ratings are not integrated (no scraping)', () => {
  const A = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/trust/discovery/2026-10-18-premium.json'), 'utf8'));
  const cands = Array.isArray(A) ? A : (A.candidates || []);
  assert.ok(cands.length >= 30, 'candidates');
  const verdicts = new Set(cands.map((c) => c.verdict));
  for (const v of verdicts) assert.ok(['INTEGRATE', 'BROWSER-AUTOMATION ONLY', 'DOCUMENT-ONLY', 'DOCUMENT ONLY', 'BLOCKED', 'REJECT'].includes(v), 'verdict ' + v);
  for (const c of cands) assert.ok(c.evidence || c.why || c.reason, (c.id || '?') + ' evidence');
  const fin = cands.filter((c) => /maya|tase|magna|xbrl|maalot|midroog|rating/i.test(c.id || ''));
  assert.ok(fin.length >= 4, 'the financial channels are audited');
  assert.ok(fin.every((c) => c.verdict !== 'INTEGRATE'), 'no financial channel is integrated');
});
t('municipal permit connectors: 14 audited municipalities, ONE LIVE (Tel Aviv-Yafo), the rest classified with a reason; any other locality is NOT AUDITED — MUNICIPAL ≠ NATIONAL', () => {
  const S = PC.summary();
  assert.equal(S.municipalities.length, 14);
  assert.deepEqual(S.counts, { LIVE: 1, PARTIAL: 0, DOCUMENTED: 1, BLOCKED: 1, NO_MACHINE_ACCESS: 11 });
  assert.equal(PC.municipality(5000).state, 'LIVE'); assert.equal(PC.municipality(3000).state, 'BLOCKED'); assert.equal(PC.municipality(4000).state, 'NO_MACHINE_ACCESS');
  assert.equal(PC.municipality(1063).state, 'NOT_AUDITED');
  for (const m of S.municipalities) { assert.ok(m.why && m.why.he && m.why.en, m.slug + ' why'); assert.ok(m.evidence, m.slug + ' evidence'); }
  assert.match(S.notA.en, /MUNICIPAL PERMIT COVERAGE ≠ NATIONAL COVERAGE/);
  const tlv = PC.CONNECTORS[5000].normalize([{ request: 1, permit: 2, stage: 'היתר', opened: '2024-01-01', permitDate: '2024-06-01', units: 10, imported: '2026-10-01', type: 'בנייה חדשה' }]);
  for (const k of PC.SCHEMA) assert.ok(k in tlv, 'schema field ' + k);
  assert.equal(tlv.applicant, null, 'missing = null, never invented'); assert.equal(tlv.cls, 'OFFICIAL');
});
t('explainability: every premium term has level 1 + level 2 incl. what would strengthen it and what to verify next; every financial flag and ratio has its rule / term; the new classes exist', () => {
  const ids = ['public_financial_profile', 'no_financial_statements', 'net_debt_to_equity', 'debt_to_assets', 'current_ratio', 'cash_to_current_liabilities', 'ocf_to_debt', 'interest_coverage', 'near_term_debt_to_cash', 'financial_restatement', 'corporate_structure_graph', 'project_company_status', 'legal_exposure_public', 'strike_off_designation', 'municipal_permit_coverage', 'execution_coverage_map', 'sales_progress', 'user_document', 'institutional_diligence_summary', 'join_evidence_ladder', 'contractor_register_identity', 'live_registry_lookup'];
  for (const id of ids) { const l2 = X.level2(id, 'en'); assert.ok(l2, id); for (const k of ['short', 'why', 'period', 'methodology', 'interpretation', 'notAs', 'strengthen', 'verifyNext']) assert.ok(l2[k], id + '.' + k); assert.ok(X.level2(id, 'he').strengthen, id + ' he'); }
  for (const r of FIN.ratiosOf(FIN.statementsFromDocs([UD.normalize(fs1('500000001', '2025-12-31', '2026-03-01', { cash: 1 })).doc], '500000001')[0])) assert.ok(X.term(r.id), 'ratio term ' + r.id);
  for (const f of ['LEVERAGE_INCREASED', 'LIQUIDITY_WEAKENED', 'CASH_IMPROVED', 'NEAR_TERM_DEBT_CONCENTRATION', 'OPERATING_CASH_FLOW_NEGATIVE', 'GOING_CONCERN_LANGUAGE_PRESENT', 'RATING_DOWNGRADE', 'RATING_OUTLOOK_NEGATIVE', 'INSUFFICIENT_FINANCIAL_DATA']) assert.ok(X.SIGNAL_RULES[f], 'signal rule ' + f);
  assert.ok(X.CLASSES.USER_DOCUMENT && X.CLASSES.SELF_REPORTED);
  assert.ok(X.canonicalSource('user-document') === 'propx:user-documents' && X.canonicalSource('datagov:ica:designated-strike-off'));
  for (const id of ['net_debt_to_equity', 'project_company_status', 'sales_progress', 'no_financial_statements']) assert.ok(X.level2(id, 'en').notAs, id + ' do-not-interpret-as');
});

console.log('dd-premium: user evidence (USER DOCUMENT)');
t('validation: provenance required, a future date refused, a company number is 8–9 digits, enum values closed, lists validated per row, at most 60 documents; the id is the file fingerprint', () => {
  const bad = UD.normalize({ type: 'permit', fields: { projectId: 'x', municipality: 'חיפה', permitNumber: '1', issueDate: '2099-01-01' }, provenance: {} }, { today: '2026-10-18' });
  assert.equal(bad.ok, false); assert.ok(bad.errors.some((e) => /provenance/.test(e))); assert.ok(bad.errors.some((e) => /issueDate: in the future/.test(e)));
  assert.equal(UD.normalize(doc('financial_statements', { entityNumber: '12', periodEnd: '2025-12-31', periodKind: 'annual', reportDate: '2026-01-01', audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'units' })).ok, false);
  assert.equal(UD.normalize(doc('sales_report', { projectId: 'x', asOf: '2026-01-01', reportedBy: 'marketing' })).ok, false, 'reportedBy is a closed list');
  assert.equal(UD.normalize(doc('ownership_chart', { asOf: '2026-01-01', relations: [{ parentNumber: '1', childNumber: '2' }] })).ok, false, 'list rows validated');
  const ok = UD.normalize(doc('permit', { projectId: 'x', municipality: 'חיפה', permitNumber: '1', issueDate: '2025-01-01' }));
  assert.equal(ok.ok, true); assert.equal(ok.doc.cls, 'USER_DOCUMENT'); assert.match(ok.doc.id, /^udoc:[0-9a-f]{16}-[0-9a-f]{8}$/);
  assert.ok(ok.doc.limitations.some((l) => /never overrides an official record/.test(l.en)));
  const many = Array.from({ length: 70 }, (_, i) => doc('permit', { projectId: 'x' + i, municipality: 'm', permitNumber: String(i), issueDate: '2025-01-01' }));
  assert.equal(UD.normalizeAll(many).docs.length, UD.MAX_DOCS);
  const csv = UD.fromCsv('financial_statements', UD.template('financial_statements').replace('cash,', 'cash,1,234').replace('nope', ''));
  assert.equal(csv.errors.length, 0); assert.equal(csv.fields.cash, '1,234');
});
t('USER-UPLOADED DOCUMENT ≠ OFFICIAL SOURCE: no read model labels a document-derived fact OFFICIAL; a document never overrides the official record (a different company = CONFLICT)', () => {
  const nameNet = prj(NETANYA_LOT).premium.projectCompany.company;
  assert.ok(nameNet && nameNet.number, 'the land winner resolves');
  const other = [...C.idx.companies.byNumber.values()].find((r) => String(r.num) !== nameNet.number && r.name);
  const X1 = prj(NETANYA_LOT, { userDocs: [doc('purchase_agreement', { projectId: NETANYA_LOT, sellerName: other.name, sellerNumber: String(other.num), signDate: '2026-01-15' })] });
  const pc = X1.premium.projectCompany;
  assert.equal(pc.state, 'POSSIBLE_MATCH'); assert.equal(pc.conflicts.length, 1); assert.equal(pc.company, null, 'none picked');
  assert.deepEqual(pc.conflicts[0].companies.map((c) => c.number).sort(), [nameNet.number, String(other.num)].sort());
  assert.equal(rowOf(X1.summary, 'identity').cls, 'CONFLICT');
  const ev = pc.evidence.filter((e) => e.source === 'user-document'); assert.ok(ev.length && ev.every((e) => e.cls === 'USER_DOCUMENT'));
  /* an unverifiable number in a document → a candidate (POSSIBLE), never dropped and never official */
  const X2 = prj(NETANYA_LOT, { userDocs: [doc('purchase_agreement', { projectId: NETANYA_LOT, sellerName: 'חברה שאינה בכיסוי בע"מ', sellerNumber: '516999999', signDate: '2026-01-15' })] });
  assert.equal(X2.premium.projectCompany.state, 'POSSIBLE_MATCH');
  assert.ok(X2.premium.projectCompany.roles.perDocument.some((x) => x.number === '516999999' && x.registryCheck === 'NOT_IN_COVERAGE' && x.cls === 'USER_DOCUMENT'));
});
t('a document for ANOTHER company is never applied to this entity (financials are read only for the one resolved company number); an unresolved developer gets none', () => {
  const docs = [fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 500, equity: 1000 })];
  const A = prj(TLV_LOT, { userDocs: docs });
  assert.equal(A.premium.financial.latest, null, 'the unresolved project shows no other company\'s statements');
  assert.equal(rowOf(A.summary, 'financial').cls, 'MISSING');
  assert.ok(!/LEVERAGE|LIQUIDITY/.test(rowOf(A.summary, 'risks').en));
  assert.deepEqual(FIN.statementsFromDocs(docs.map((d) => UD.normalize(d).doc), null), []);
  const B = dev(DEMRI, { userDocs: docs }); assert.equal(B.premium.financial.latest.figures.cash.value, 500);
});

console.log('dd-premium: financial engine');
t('debt aggregation: the reported total wins; else short + long (DERIVED); the bond balance is a COMPONENT — never added; net debt = reported, else debt − cash (restricted cash not subtracted); derived values shown in the statement\'s units', () => {
  const s = (f) => FIN.statementsFromDocs([UD.normalize(fs1('500000002', '2025-12-31', '2026-03-01', f)).doc], '500000002')[0];
  const a = s({ shortTermDebt: 100, longTermDebt: 400, bondBalance: 300, cash: 50, restrictedCash: 20, equity: 1000, totalAssets: 2000 });
  assert.equal(FIN.debtOf(a).value, 500e3); assert.equal(FIN.debtOf(a).derived, true); assert.equal(FIN.netDebtOf(a).value, 450e3);
  const b = s({ totalFinancialDebt: 700, shortTermDebt: 100, longTermDebt: 400, cash: 50 });
  assert.equal(FIN.debtOf(b).value, 700e3, 'the reported total'); assert.equal(FIN.debtOf(b).derived, false);
  const P = FIN.profile({ statements: [a], entityNumber: '500000002' });
  assert.deepEqual([P.latest.derived.totalFinancialDebt.value, P.latest.derived.totalFinancialDebt.units, P.latest.derived.totalFinancialDebt.cls], [500, 'thousands', 'DERIVED']);
  const nde = P.ratios.find((r) => r.id === 'net_debt_to_equity'); assert.equal(nde.value, 0.45); assert.deepEqual(nde.inputs, ['shortTermDebt', 'longTermDebt', 'cash', 'equity']);
  assert.ok(nde.basis.he && nde.basis.en, 'the basis is bilingual');
  const neg = FIN.profile({ statements: [s({ shortTermDebt: 1, longTermDebt: 1, cash: 0, equity: -5 })], entityNumber: '500000002' });
  assert.equal(neg.ratios.find((r) => r.id === 'net_debt_to_equity').valid, false, 'equity ≤ 0 → no ratio, with the reason');
});
t('period discipline: ratios only within one statement; flags compare only with the comparable period (same kind, basis, currency, a year ± 45 days); a half-year never compared with an annual', () => {
  const st = (end, kind, f, cur = 'ILS') => FIN.statementsFromDocs([UD.normalize(doc('financial_statements', { entityNumber: '500000003', periodEnd: end, periodKind: kind, reportDate: '2026-04-01', audited: 'audited', basis: 'consolidated', currency: cur, units: 'units', ...f })).doc], '500000003')[0];
  const y25 = st('2025-12-31', 'annual', { cash: 200, currentAssets: 100, currentLiabilities: 100 }), h25 = st('2025-06-30', 'half', { cash: 100 }), y24 = st('2024-12-31', 'annual', { cash: 100, currentAssets: 200, currentLiabilities: 100 }), u24 = st('2024-12-31', 'annual', { cash: 100 }, 'USD');
  assert.equal(FIN.comparableOf(y25, [y25, h25]), null, 'a half-year is not comparable');
  assert.equal(FIN.comparableOf(y25, [y25, u24]), null, 'another currency is not comparable');
  assert.equal(FIN.comparableOf(y25, [y25, y24]), y24);
  const P = FIN.profile({ statements: [y25, h25, y24], entityNumber: '500000003' });
  assert.equal(P.comparable.period.end, '2024-12-31');
  const ids = P.flags.map((f) => f.id); assert.ok(ids.includes('CASH_IMPROVED') && ids.includes('LIQUIDITY_WEAKENED'));
  for (const f of P.flags) { assert.equal(f.cls, 'DERIVED'); assert.ok(f.rule && f.threshold && f.periods.length && f.inputs.length, f.id + ' exposes its data'); }
});
t('restatement: a later document marked restated supersedes the original (both kept, the changed fields listed); two different un-marked documents for one period = CONFLICT — none picked, no ratios', () => {
  const o = UD.normalize(fs1('500000004', '2025-12-31', '2026-03-01', { cash: 100, equity: 1000 })).doc, r = UD.normalize(fs1('500000004', '2025-12-31', '2026-06-01', { cash: 90, equity: 1000 }, { restated: true })).doc;
  const P = FIN.profile({ statements: FIN.statementsFromDocs([o, r], '500000004'), entityNumber: '500000004' });
  assert.equal(P.restatements.length, 1); assert.equal(P.latest.supersedes, o.id); assert.equal(P.latest.figures.cash.value, 90);
  assert.deepEqual(P.restatements[0].changed, [{ field: 'cash', original: 100, originalUnits: 'thousands', restated: 90, restatedUnits: 'thousands' }]);
  const u = UD.normalize(fs1('500000004', '2025-12-31', '2026-06-01', { cash: 80, equity: 1000 })).doc;
  const Q2 = FIN.profile({ statements: FIN.statementsFromDocs([o, u], '500000004'), entityNumber: '500000004' });
  assert.equal(Q2.conflicts.length, 1); assert.equal(Q2.latest, null, 'no pick'); assert.deepEqual(Q2.conflicts[0].fields, ['cash']);
});
t('NO FINANCIALS ≠ FINANCIAL WEAKNESS: without statements only INSUFFICIENT FINANCIAL DATA (info), never a negative flag; no score / probability anywhere in the profile', () => {
  const P = FIN.profile({ statements: [], entityNumber: '500000005' });
  assert.deepEqual(P.flags.map((f) => f.id), ['INSUFFICIENT_FINANCIAL_DATA']); assert.equal(X.SIGNAL_RULES.INSUFFICIENT_FINANCIAL_DATA.kind, 'info');
  assert.equal(P.statement.en, 'PROPX does not currently have machine-readable audited financial statements for this entity');
  assert.ok(P.notA.some((x) => x.en === 'NO FINANCIALS ≠ FINANCIAL WEAKNESS'));
  assert.ok(!/"(score|probability|probabilityOfDefault|grade)":/.test(JSON.stringify(P)), 'no score / probability field');
});

console.log('dd-premium: review findings (independent review, 18.10.2026)');
t('R1 · a document about ANOTHER project never lends this one a parent, a guarantor or a guarantee; a company is never its own parent; an expired guarantee is said', () => {
  const pcNo = prj(NETANYA_LOT).premium.projectCompany.company.number;
  const R = prj(NETANYA_LOT, { userDocs: [
    doc('developer_declaration', { projectId: 'ila:OTHER:PROJECT', asOf: '2026-01-01', parentNumber: pcNo, parentName: 'x', projectCompanyNumber: '516000001', guarantee: 'explicit-parent-guarantee' }),
    doc('bank_guarantee', { projectId: 'moch:99999', bank: 'בנק לבדיקה', kind: 'sale-law', applicantName: 'x', applicantNumber: pcNo, issueDate: '2024-01-01', expiryDate: '2025-06-01' }),
    doc('developer_declaration', { asOf: '2026-01-01', parentNumber: pcNo, projectCompanyNumber: pcNo, guarantee: 'explicit-parent-guarantee' })] });
  const roles = R.premium.projectCompany.roles;
  assert.equal(roles.parent.state, 'NOT_IN_COVERAGE'); assert.equal(roles.guarantor.state, 'NOT_VERIFIED');
  const own = prj(NETANYA_LOT, { now: '2026-10-18T00:00:00Z', userDocs: [doc('bank_guarantee', { projectId: NETANYA_LOT, bank: 'בנק לבדיקה', kind: 'sale-law', applicantName: 'x', applicantNumber: pcNo, issueDate: '2024-01-01', expiryDate: '2025-06-01' })] });
  assert.equal(own.premium.projectCompany.roles.guarantor.expired, true); assert.match(own.premium.projectCompany.roles.guarantor.note.en, /expired on 2025-06-01/);
  assert.ok(!R.premium.structure.edges.some((e) => e.from === e.to), 'no self-loop');
});
t('R3 · a STRONG project company is a DERIVED signal in the brief (never a verified fact); a user document\'s registry-found number makes the relation STRONG at most', () => {
  const pcNo = prj(NETANYA_LOT).premium.projectCompany.company.number;
  const R = prj(TLV_LOT, { userDocs: [doc('purchase_agreement', { projectId: TLV_LOT, sellerName: nameOf(pcNo), sellerNumber: pcNo, signDate: '2026-01-15' })] });
  const it = R.brief.items.find((i) => i.id === 'project-company'); assert.ok(it); assert.equal(it.category, 'DERIVED_SIGNAL');
  for (const e of R.premium.projectCompany.evidence) assert.notEqual(e.resolution, 'VERIFIED', 'no VERIFIED from a document');
  assert.equal(R.premium.projectCompany.cls, 'USER_DOCUMENT');
});
t('R4 · PUBLIC / GROUP COMPANY ≠ PROJECT SPV: a project read showing the statements of a STRONG (not verified) project company carries the SPV note; the project form never pre-fills a company number', () => {
  const pcNo = prj(NETANYA_LOT).premium.projectCompany.company.number;
  const R = prj(NETANYA_LOT, { userDocs: [fs1(pcNo, '2025-12-31', '2026-03-20', { cash: 1, equity: 2 })] });
  assert.ok(R.premium.financial.latest); assert.match(R.premium.financial.spvNote.en, /STRONG — not verified/);
  assert.match(R.premium.projectCompany.statement.en, /may sit in a different project company \(SPV\)/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.match(html, /const num=X\.kind==="developer"\?/); assert.ok(!/X\.premium\.projectCompany\.company\.number\);\s*if\(num\)pref\.entityNumber/.test(html));
});
t('R5 · the summary agrees with the read models: the LATEST sales report; a stage moved by a STRONG link is DERIVED; corporate / legal reads the project company\'s own record; all-conflicting statements are CONFLICT', () => {
  const R = prj(LOTTERY, { userDocs: [doc('sales_report', { projectId: LOTTERY, asOf: '2025-06-30', reportedBy: 'bank', unitsMarketed: 60, unitsSold: 20 }), doc('sales_report', { projectId: LOTTERY, asOf: '2026-06-30', reportedBy: 'developer', unitsMarketed: 100, unitsSold: 80 })] });
  assert.match(rowOf(R.summary, 'sales').en, /^80 units sold of 100/); assert.equal(rowOf(R.summary, 'sales').cls, 'SELF_REPORTED');
  const T = prj(TLV_LOT); assert.equal(rowOf(T.summary, 'projectStage').cls, 'DERIVED'); assert.match(rowOf(T.summary, 'projectStage').en, /through a STRONG link/);
  const pcNo = prj(NETANYA_LOT).premium.projectCompany.company.number;
  const U = prj(TLV_LOT, { userDocs: [doc('purchase_agreement', { projectId: TLV_LOT, sellerName: nameOf(pcNo), sellerNumber: pcNo, signDate: '2026-01-15' })] });
  assert.ok(U.premium.projectCompanyRecord); assert.equal(rowOf(U.summary, 'corporateLegal').cls, 'USER_DOCUMENT'); assert.match(rowOf(U.summary, 'corporateLegal').en, new RegExp('project company .*' + pcNo));
  assert.equal(rowOf(dev(DEMRI).summary, 'corporateLegal').cls, 'DERIVED', 'a name match is DERIVED, not VERIFIED');
  const C2 = dev(DEMRI, { userDocs: [fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 100 }), fs1(DEMRI_NO, '2025-12-31', '2026-03-21', { cash: 80 })] });
  assert.equal(rowOf(C2.summary, 'financial').cls, 'CONFLICT'); assert.match(C2.premium.financial.statement.en, /conflicting versions/);
});
t('R6 · a user-disclosed insolvency is said beside the official statement ("no OFFICIAL record of an open insolvency proceeding") and reaches the risks row', () => {
  const R = dev(DEMRI, { userDocs: [doc('litigation_disclosure', { entityNumber: DEMRI_NO, asOf: '2026-03-20', kind: 'insolvency', material: 'yes' })] });
  assert.match(R.premium.legal.statement.en, /no OFFICIAL record of an open insolvency proceeding/); assert.match(R.premium.legal.statement.en, /discloses an insolvency proceeding \(USER DOCUMENT\)/);
  assert.match(rowOf(R.summary, 'risks').en, /disclosed in a user document: an insolvency proceeding/);
});
t('R7 · several documents entered from ONE file stay distinct (the id = file fingerprint + the facts); the same facts twice are one document and the duplicate is listed', () => {
  const prov = { fileName: 'annual-report.pdf', sha256: 'ab'.repeat(32) };
  const a = { type: 'financial_statements', fields: { entityNumber: '500000009', periodEnd: '2025-12-31', periodKind: 'annual', reportDate: '2026-03-01', audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'thousands', cash: 1 }, provenance: prov };
  const b = { ...a, fields: { ...a.fields, basis: 'separate', cash: 2 } };
  const r = UD.normalizeAll([a, b, a]); assert.equal(r.docs.length, 2); assert.notEqual(r.docs[0].id, r.docs[1].id);
  assert.equal(r.rejected.length, 1); assert.match(r.rejected[0].errors[0], /duplicate/);
});
t('R8 · a lot number + the executor = the developer\'s company stays POSSIBLE (a lot number is plan-scoped; PROPX knows only ILA lots) — never on the ladder', () => {
  const R = prj('ila:20220231:0000800017561');
  const s = R.dd.sites.labour.find((x) => x.lot != null && x.executor && x.executor.isDeveloper);
  assert.ok(s, 'the Bat Yam lot-18 site is still found'); assert.equal(s.matchState, 'POSSIBLE_MATCH'); assert.equal(s.onLadder, false);
  assert.ok(s.reasons.some((r) => r.code === 'LOT_NUMBER_PLAN_SCOPED') && s.reasons.some((r) => r.code === 'EXECUTOR_IS_DEVELOPER_COMPANY'));
  assert.ok(R.dd.sites.labour.every((x) => x.lot == null || x.matchState !== 'STRONG_MATCH'));
});
t('R9 · the financial engine: the same figure in millions and in thousands is equal (no false conflict); an original, a restated and a third differing version — none dropped; leverage inputs include debt and cash', () => {
  const m = UD.normalize(doc('financial_statements', { entityNumber: '500000010', periodEnd: '2025-12-31', periodKind: 'annual', reportDate: '2026-03-01', audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'millions', cash: 2.01 })).doc;
  const k = UD.normalize(doc('financial_statements', { entityNumber: '500000010', periodEnd: '2025-12-31', periodKind: 'annual', reportDate: '2026-03-02', audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'thousands', cash: 2010 })).doc;
  const P = FIN.profile({ statements: FIN.statementsFromDocs([m, k], '500000010'), entityNumber: '500000010' }); assert.equal(P.conflicts.length, 0); assert.ok(P.latest);
  const v1 = UD.normalize(fs1('500000011', '2025-12-31', '2026-03-01', { cash: 100 })).doc, v2 = UD.normalize(fs1('500000011', '2025-12-31', '2026-04-01', { cash: 95 })).doc, v3 = UD.normalize(fs1('500000011', '2025-12-31', '2026-06-01', { cash: 90 }, { restated: true })).doc;
  const Q3 = FIN.profile({ statements: FIN.statementsFromDocs([v1, v2, v3], '500000011'), entityNumber: '500000011' });
  assert.equal(Q3.restatements.length, 2); assert.ok(Q3.restatements.every((r) => r.earlierVersionsDisagree)); assert.deepEqual(Q3.latest.supersedesAll.sort(), [v1.id, v2.id].sort());
  const L = FIN.profile({ statements: FIN.statementsFromDocs([UD.normalize(fs1('500000012', '2024-12-31', '2025-03-01', { shortTermDebt: 100, longTermDebt: 100, cash: 50, equity: 400, totalAssets: 1000 })).doc, UD.normalize(fs1('500000012', '2025-12-31', '2026-03-01', { shortTermDebt: 300, longTermDebt: 300, cash: 50, equity: 400, totalAssets: 1200 })).doc], '500000012'), entityNumber: '500000012' });
  const f = L.flags.find((x) => x.id === 'LEVERAGE_INCREASED'); assert.ok(f); assert.ok(['shortTermDebt', 'longTermDebt', 'cash', 'equity'].every((k2) => f.inputs.some((i) => i.field === k2)));
});
t('R10 · input parsing: "1,5" is refused (never 15); "1,234" is 1234; 2025-02-31 is not a date', () => {
  const base = (cash, periodEnd = '2025-12-31') => UD.normalize(doc('financial_statements', { entityNumber: '500000013', periodEnd, periodKind: 'annual', reportDate: '2026-03-01', audited: 'audited', basis: 'consolidated', currency: 'ILS', units: 'units', cash }));
  assert.equal(base('1,5').ok, false); assert.equal(base('1,234').doc.fields.cash, 1234); assert.equal(base('1.5').doc.fields.cash, 1.5);
  assert.equal(base('1', '2025-02-31').ok, false);
});
t('R12 · a Tel Aviv permit holder whose name linked the site is not an independent record (never INDEPENDENT_RECORDS_AGREE on its own)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/dd/projectco.js'), 'utf8');
  assert.match(src, /independent: false/); assert.match(src, /e\.independent !== false/);
});
t('R13 · an attachment-order filing is a filing (add / update / remove — the source does not say which), a DERIVED signal in the brief — never a verified attachment', () => {
  assert.match(LEG.KIND.ATTACHMENT_ORDER.en, /add \/ update \/ remove/);
  const src = fs.readFileSync(path.join(ROOT, 'lib/dd/brief.js'), 'utf8'); assert.match(src, /x\.kind === 'ATTACHMENT_ORDER' \? 'DERIVED_SIGNAL' : 'VERIFIED_FACT'/);
});
t('R14 · a shareholder without a number is scoped to its document (never merged with a same-name person elsewhere) and its edge is POSSIBLE', () => {
  const mk = (n) => UD.normalize(doc('company_extract', { entityNumber: DEMRI_NO, asOf: '2026-01-0' + n, shareholders: [{ name: 'ישראל ישראלי', sharePct: 10 }] })).doc;
  const S = STR.structure({ companyNumbers: [DEMRI_NO], userDocs: [mk(1), mk(2)], index: C.idx });
  const persons = S.nodes.filter((x) => /^person:/.test(x.id)); assert.equal(persons.length, 2);
  assert.ok(S.edges.filter((e) => e.type === 'SHAREHOLDER_OF').every((e) => e.state === 'POSSIBLE_MATCH'));
});

console.log('dd-premium: structure, legal, sales, coverage');
t('structure: ownership only from a user document (both parties checked by number); a joint award is CO_WINNER — not ownership; rules PARENT ≠ GUARANTOR · SAME ADDRESS ≠ OWNERSHIP · NO PUBLIC OWNERSHIP DATA ≠ NO OWNER', () => {
  const S0 = STR.structure({ companyNumbers: [DEMRI_NO], userDocs: [], index: C.idx });
  assert.equal(S0.coverage, 'NOT_IN_COVERAGE'); assert.match(S0.statement.en, /NO PUBLIC OWNERSHIP DATA ≠ NO OWNER/); assert.equal(S0.edges.length, 0);
  for (const r of ['PARENT ≠ GUARANTOR', 'SAME ADDRESS ≠ OWNERSHIP', 'COMMON DIRECTOR ≠ FINANCIAL SUPPORT', 'SUBSIDIARY ≠ PROJECT SPV']) assert.ok(STR.RULES.some((x) => x.en === r), r);
  assert.ok(!/address/i.test(JSON.stringify(Object.keys(STR.NOT_PROVES))), 'no ADDRESS edge type exists');
  const ex = UD.normalize(doc('company_extract', { entityNumber: DEMRI_NO, asOf: '2026-01-01', shareholders: [{ name: 'בעל מניות פרטי', sharePct: 60 }] })).doc;
  const S1 = STR.structure({ companyNumbers: [DEMRI_NO], userDocs: [ex], index: C.idx });
  assert.equal(S1.edges[0].type, 'SHAREHOLDER_OF'); assert.match(S1.edges[0].notProves.en, /a shareholder ≠ project support/);
});
t('legal exposure: publicly disclosed only — liquidation / insolvency / strike-off / attachment by company number; civil and regulatory NOT IN COVERAGE; NO COURT ROW ≠ NO LITIGATION; a strike-off designation ≠ insolvency', () => {
  const L0 = LEG.legalExposure({ companyNumber: '500000006', corporate: null, cache: C, userDocs: [] });
  assert.deepEqual(L0.items, []); assert.match(L0.statement.en, /ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION/);
  assert.equal(L0.coverage.civil.state, 'NOT_IN_COVERAGE');
  const so = [...(C.strikeOffByNum || new Map()).keys()][0];
  if (so) { const L1 = LEG.legalExposure({ companyNumber: so, corporate: null, cache: C, userDocs: [] }); const it = L1.items.find((i) => i.kind === 'STRIKE_OFF_DESIGNATION'); assert.ok(it && it.cls === 'OFFICIAL'); assert.match(it.label.en, /not insolvency/); }
  const none = LEG.legalExposure({ companyNumber: null, corporate: null, cache: C });
  assert.match(none.statement.en, /no resolved legal company/);
});
t('sales: OFFICIAL programme rows (offered ≠ sold) and tender capacity apart from reported figures; DEVELOPER-REPORTED ≠ OFFICIAL; a rate only between two dated reports; inconsistency flagged', () => {
  const p = { id: 'moch:x', kind: 'moch-lottery-project', lotteries: [{ date: '2025-01-01', units: 100, applicants: 900, winners: 100 }] };
  const r1 = UD.normalize(doc('sales_report', { projectId: 'moch:x', asOf: '2025-06-30', reportedBy: 'developer', unitsMarketed: 80, unitsSold: 40 })).doc, r2 = UD.normalize(doc('sales_report', { projectId: 'moch:x', asOf: '2025-12-31', reportedBy: 'developer', unitsMarketed: 80, unitsSold: 64 })).doc;
  const S = SAL.salesProgress({ project: p, userDocs: [r1, r2] });
  assert.equal(S.rows.filter((r) => r.cls === 'OFFICIAL').length, 1); assert.equal(S.rows.filter((r) => r.kind === 'SALES_REPORT').length, 2);
  assert.ok(S.rows.filter((r) => r.kind === 'SALES_REPORT').every((r) => r.cls === 'USER_DOCUMENT' && r.classLabel.en === 'DEVELOPER-REPORTED · USER DOCUMENT'));
  assert.equal(S.rate.cls, 'DERIVED'); assert.equal(S.rate.value, 4);
  for (const k of ['DEVELOPER-REPORTED SALES ≠ OFFICIAL SALES', 'MARKETING CLAIM ≠ VERIFIED FACT', 'A LOTTERY ≠ A SALE']) assert.ok(S.notA.some((x) => x.en === k), k);
  const bad = SAL.salesProgress({ project: p, userDocs: [UD.normalize(doc('sales_report', { projectId: 'moch:x', asOf: '2025-06-30', reportedBy: 'developer', unitsMarketed: 10, unitsSold: 40 })).doc] });
  assert.ok(bad.rows.find((r) => r.kind === 'SALES_REPORT').consistency);
});
t('execution coverage: DISTRICT CONSTRUCTION DATA ≠ PROJECT CONSTRUCTION DATA — the CBS district cell is labelled district-only and never fills a project\'s "found"; Tel Aviv is project-level LIVE', () => {
  const A = COV.forLocality(1063, { district: 'צפון' });
  assert.equal(A.start.level, 'PROJECT_STALE'); assert.equal(A.start.district.level, 'DISTRICT_ONLY'); assert.equal(A.permit.level, 'NONE'); assert.equal(A.municipality.state, 'NOT_AUDITED');
  assert.equal(COV.forLocality(5000).start.level, 'PROJECT_LIVE');
  const P = prj(DISTRICT_ONLY_LOT).premium.coverage;
  assert.equal(P.found.start.found, false, 'no project start from a district series');
  assert.ok(A.notA.some((x) => x.en === 'DISTRICT CONSTRUCTION DATA ≠ PROJECT CONSTRUCTION DATA'));
});
t('PARCEL MATCH ≠ PROJECT MATCH: the join ladder keeps a place key alone POSSIBLE (off the ladder); STRONG needs a second independent key and a sound chronology', () => {
  const lv = Object.fromEntries(PRJ.JOIN_LADDER.map((x) => [x.level, x.rule.en]));
  assert.match(lv.POSSIBLE_MATCH, /a place key only/); assert.match(lv.POSSIBLE_MATCH, /never on the ladder/);
  assert.match(lv.STRONG_MATCH, /independent second key/); assert.match(lv.STRONG_MATCH, /chronology/); assert.match(lv.PARCEL_HISTORY, /precedes the award/);
});

console.log('dd-premium: the live registry lookup');
(async () => {
  await at('a live lookup is exact-number only (CKAN filters, no full text), at most 3 numbers, labelled with its time; a refusal says "did not answer" — never "no company"; the memoised cache is never mutated', async () => {
    const urls = [];
    const stub = async (u) => { urls.push(u); const q = new URL(u); const f = JSON.parse(q.searchParams.get('filters')); const num = Object.values(f)[0];
      if (q.searchParams.get('resource_id') === LIVE.RES.companies.resource) return { result: { records: [{ 'מספר חברה': num, 'שם חברה': 'חברת בדיקה חיה בע"מ', 'סטטוס חברה': 'פעילה', 'סוג תאגיד': 'ישראלית חברה פרטית' }] } };
      return { result: { records: [] } }; };
    const live = await LIVE.lookup(['516999999', '516999998', '516999997', '516999996', 'abc'], { fetchJson: stub, now: NOW });
    assert.equal(live.size, LIVE.MAX_NUMBERS);
    assert.ok(urls.every((u) => /filters=/.test(u) && !/[?&]q=/.test(u)));
    const rec = live.get('516999999'); assert.equal(rec.company.name, 'חברת בדיקה חיה בע"מ'); assert.equal(rec.company.live, true);
    const before = C.idx.companies.byNumber.size;
    const ready = await DD.prepare({ now: NOW, userDocs: [doc('purchase_agreement', { projectId: LOTTERY, sellerName: 'חברת בדיקה חיה בע"מ', sellerNumber: '516999999', signDate: '2026-01-15' })], liveFetchJson: stub });
    const P = DD.project(LOTTERY, ready);
    assert.equal(P.premium.projectCompany.state, 'STRONG_MATCH'); assert.ok(P.premium.projectCompany.reasons.some((r) => r.code === 'USER_DOCUMENT_NAMES_COMPANY'));
    assert.equal(P.premium.projectCompany.cls, 'USER_DOCUMENT', 'a document-only project company is USER_DOCUMENT, never OFFICIAL');
    assert.ok(P.live.length && P.live[0].found); assert.equal(D.load().idx.companies.byNumber.size, before, 'the cache is untouched');
    assert.ok(P.premium.projectCompanyRecord && P.premium.projectCompanyRecord.liveRead);
    const down = await LIVE.lookup(['516999999'], { fetchJson: async () => { throw new Error('HTTP 403'); }, now: NOW });
    assert.match(LIVE.statementOf(down.get('516999999')).en, /did not answer — not to be read as "no company"/);
  });
  await at('R2 · a live lookup whose lanes did not answer says NOT CHECKED in the legal read and the corporate record — never "no record"; R11 · an answer for another number is ignored; the typed number and THIS project\'s documents get the lookup budget first; the shared memos never hold live rows', async () => {
    const stub = async (u) => { const q = new URL(u); const f = JSON.parse(q.searchParams.get('filters')); const num = Object.values(f)[0];
      if (q.searchParams.get('resource_id') === LIVE.RES.companies.resource) return { result: { records: [{ 'מספר חברה': num, 'שם חברה': 'חברת בדיקה חיה בע"מ', 'סטטוס חברה': 'פעילה' }, { 'מספר חברה': '512345678', 'שם חברה': 'אחרת בע"מ' }] } };
      throw new Error('HTTP 503'); };
    const ready = await DD.prepare({ now: NOW, userDocs: [doc('purchase_agreement', { projectId: LOTTERY, sellerName: 'חברת בדיקה חיה בע"מ', sellerNumber: '516999999', signDate: '2026-01-15' })], liveFetchJson: stub, projectId: LOTTERY });
    const rec = ready.live.get('516999999'); assert.equal(rec.company.num, 516999999, 'the row for another number is never used');
    const P = DD.project(LOTTERY, ready);
    assert.deepEqual(P.premium.legal.notChecked.sort(), ['filings', 'liquidation', 'strikeOff', 'voluntaryFast']); assert.match(P.premium.legal.statement.en, /some sources were not checked/);
    assert.equal(P.premium.projectCompanyRecord.corporate.insolvency.notChecked, true); assert.match(P.premium.projectCompanyRecord.corporate.insolvency.statement.en, /not checked/);
    assert.equal(P.premium.projectCompanyRecord.corporate.filings.total, null);
    const many = [1, 2, 3, 4].map((i) => doc('purchase_agreement', { projectId: 'moch:other' + i, sellerName: 'x', sellerNumber: '51699990' + i, signDate: '2026-01-15' }));
    const asked = []; await DD.prepare({ now: NOW, userDocs: many.concat([doc('purchase_agreement', { projectId: LOTTERY, sellerName: 'x', sellerNumber: '516999988', signDate: '2026-01-15' })]), projectId: LOTTERY, liveFetchJson: async (u) => { asked.push(JSON.parse(new URL(u).searchParams.get('filters'))); return { result: { records: [] } }; } });
    assert.ok(asked.some((f) => Object.values(f)[0] === '516999988'), 'this project\'s document is looked up first');
    const memo = DD.company('511399388'); assert.ok(memo.inCoverage);
  });
  await at('the API: POST is accepted ONLY for view=dd (405 elsewhere); a body over 256 KB is refused (413); the documents are used for that read and appear in userDocs.used / rejected', async () => {
    const H = require('../api/intel');
    const call = (method, url, body) => new Promise((resolve) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); } };
      H({ method, url, body, headers: {}, on() {} }, res); });
    assert.equal((await call('POST', '/api/intel?view=land')).status, 405);
    assert.equal((await call('POST', '/api/intel?view=dd&developer=' + DEMRI, { userDocs: [fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 1 }), { type: 'nope' }] })).status, 200);
    const r = JSON.parse((await call('POST', '/api/intel?view=dd&developer=' + DEMRI, { userDocs: [fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 1 }), { type: 'nope' }] })).body);
    assert.equal(r.userDocs.used.length, 1); assert.equal(r.userDocs.rejected.length, 1);
    const { Readable } = require('node:stream');
    const big = Readable.from([Buffer.alloc(300 * 1024, 32)]); Object.assign(big, { method: 'POST', url: '/api/intel?view=dd&developer=' + DEMRI, headers: {} });
    const r413 = await new Promise((resolve) => { const res = { statusCode: 200, setHeader() {}, end(b) { resolve({ status: this.statusCode, body: b }); } }; H(big, res); });
    assert.equal(r413.status, 413);
    const src = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8'); assert.match(src, /MAX_BODY = 256 \* 1024/); assert.ok(!/console\.(log|error)\([^)]*userDocs/.test(src), 'the documents are never logged');
  });

  console.log('dd-premium: the 20 acceptance cases');
  const NUM_NET = prj(NETANYA_LOT).premium.projectCompany.company.number;
  /* 1 · public developer with financial statements */
  t('case 1 · public developer with financial statements', () => {
    const R = dev(DEMRI, { userDocs: [fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 500000, shortTermDebt: 800000, longTermDebt: 1500000, bondBalance: 900000, equity: 2000000, totalAssets: 6000000, currentAssets: 3000000, currentLiabilities: 1800000, operatingProfit: 300000, financeExpenses: 100000 })] });
    assert.match(R.dd.identity.resolution.chosen.type, /ציבורית/);
    const F = R.premium.financial; assert.ok(F.latest);
    for (const [k, v] of Object.entries(F.latest.figures)) for (const f of ['value', 'units', 'currency', 'period', 'reportDate', 'source', 'filingId', 'restated', 'cls']) assert.ok(v[f] !== undefined, `${k}.${f}`);
    assert.equal(F.latest.figures.cash.cls, 'USER_DOCUMENT'); assert.equal(F.ratios.find((r) => r.id === 'interest_coverage').value, 3);
    assert.equal(F.latest.derived.totalFinancialDebt.value, 2300000, 'the bond balance is not added');
    assert.equal(rowOf(R.summary, 'financial').cls, 'USER_DOCUMENT'); assert.match(rowOf(R.summary, 'financial').en, new RegExp(DEMRI_NO));
    assert.match(F.publicSourceStatus.en, /blocked/);
    kase({ id: 1, title: 'public developer with financial statements', knows: ['the registry company (511399388, public company per the registry type) — STRONG name match', 'the statement figures as entered, each with period / report date / currency / units / document id', 'ratios from that one statement (e.g. interest cover 3.0)'], unknown: ['whether the figures match the published filing (MAYA / MAGNA not machine-readable to PROPX)'], classes: { identity: 'DERIVED (STRONG)', figures: 'USER_DOCUMENT', ratios: 'DERIVED', publicFilingSource: 'BLOCKED' }, sees: 'FINANCIAL RESILIENCE · USER DOCUMENT — "company 511399388: profile from the 2025-12-31 statement (user document)"', refuses: ['a score, a rating, a probability of default', 'adding the bond balance to debt', 'calling the user\'s figures official'], verifyNext: ['reconcile the entered figures with the audited filing'] });
  });
  /* 2 · leverage worsening */
  t('case 2 · public developer with leverage worsening', () => {
    const R = dev(DEMRI, { userDocs: [fs1(DEMRI_NO, '2024-12-31', '2025-03-25', { cash: 350, shortTermDebt: 700, longTermDebt: 1200, equity: 2100, totalAssets: 5500 }), fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 500, shortTermDebt: 800, longTermDebt: 1500, equity: 1600, totalAssets: 6000 })] });
    const f = R.premium.financial.flags.find((x) => x.id === 'LEVERAGE_INCREASED'); assert.ok(f);
    assert.deepEqual(f.periods, ['annual 2024-12-31', 'annual 2025-12-31']); assert.ok(f.inputs.length >= 4 && f.threshold);
    assert.match(f.text.en, /0\.74 → 1\.13/);
    assert.ok(rowOf(R.summary, 'risks').en.includes('leverage increased'));
    kase({ id: 2, title: 'public developer with leverage worsening', knows: ['net debt / equity 0.74 → 1.13 between the comparable annual statements (both user documents)'], unknown: ['the drivers (dividend, losses, acquisitions) unless the user enters them'], classes: { flag: 'DERIVED', inputs: 'USER_DOCUMENT' }, sees: 'flag "watch" — "leverage increased: net debt / equity 0.74 → 1.13" with "Why am I seeing this?" (rule · inputs · threshold · periods)', refuses: ['a credit verdict', 'comparing a half-year with an annual', 'mixing currencies or bases'], verifyNext: ['the debt maturity table and covenant headroom'] });
  });
  /* 3 · liquidity improving */
  t('case 3 · public developer with liquidity improving', () => {
    const R = dev(DEMRI, { userDocs: [fs1(DEMRI_NO, '2024-12-31', '2025-03-25', { cash: 300, currentAssets: 2000, currentLiabilities: 1600, equity: 2000 }), fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 600, currentAssets: 2600, currentLiabilities: 1500, equity: 2100 })] });
    const ids = R.premium.financial.flags.map((x) => x.id);
    assert.ok(ids.includes('CASH_IMPROVED')); assert.ok(!ids.includes('LIQUIDITY_WEAKENED')); assert.ok(!ids.includes('LEVERAGE_INCREASED'));
    assert.equal(R.premium.financial.ratios.find((r) => r.id === 'current_ratio').value, 1.73);
    kase({ id: 3, title: 'public developer with liquidity improving', knows: ['cash 300 → 600 (thousands, ILS)', 'current ratio 1.25 → 1.73'], unknown: ['whether cash is restricted / pledged beyond what the statement states'], classes: { flag: 'DERIVED (info)', inputs: 'USER_DOCUMENT' }, sees: 'flag "info" — "cash rose by at least 20 %"; no negative flag', refuses: ['calling the company "strong" or "healthy"'], verifyNext: ['restricted cash and project-account balances'] });
  });
  /* 4 · private developer with no financials */
  t('case 4 · private developer with no financials', () => {
    const R = dev(prj(NETANYA_LOT).developer.id);
    assert.match(R.dd.identity.resolution.chosen.type, /פרטית/);
    assert.equal(R.premium.financial.latest, null); assert.equal(R.premium.financial.statement.en, FIN.NO_STATEMENTS.en);
    const row = rowOf(R.summary, 'financial'); assert.equal(row.cls, 'MISSING'); assert.match(row.en, /not "weakness"/);
    assert.ok(R.nextBest.items.some((i) => i.doc === 'financial_statements'));
    kase({ id: 4, title: 'private developer with no financials', knows: ['the registry company, its status and charges'], unknown: ['every financial figure — private companies do not publish statements'], classes: { financial: 'MISSING' }, sees: 'FINANCIAL RESILIENCE · MISSING — "no machine-readable financial statements in coverage … not \\"weakness\\""; NEXT BEST EVIDENCE: audited statements (Add a document)', refuses: ['reading the absence as weakness', 'estimating any figure'], verifyNext: ['the audited statements of the company and of the project company'] });
  });
  /* 5 · verified project company */
  t('case 5 · verified project company — the company identity verified by number, the project-company RELATION stays STRONG (no official project-level identifier exists in coverage)', () => {
    const R = prj(NETANYA_LOT, { userDocs: [doc('purchase_agreement', { projectId: NETANYA_LOT, sellerName: nameOf(NUM_NET), sellerNumber: NUM_NET, signDate: '2026-01-15' })] });
    const pc = R.premium.projectCompany;
    assert.equal(pc.state, 'STRONG_MATCH'); assert.equal(pc.company.number, NUM_NET);
    assert.ok(pc.reasons.some((r) => r.code === 'INDEPENDENT_RECORDS_AGREE') && pc.reasons.some((r) => r.code === 'NO_OFFICIAL_PROJECT_COMPANY_IDENTIFIER'));
    assert.ok(pc.evidence.some((e) => e.cls === 'USER_DOCUMENT' && e.registryCheck === 'REGISTRY_ROW_FOUND'));
    assert.equal(pc.statement.en, 'multiple independent records point to this legal company as the project company, but PROPX does not yet have a definitive official identifier proving it');
    kase({ id: 5, title: 'verified project company', knows: [`the land winner (ILA record) resolves to ${NUM_NET}`, 'the user\'s purchase agreement names the same company; its number is in the registry with a consistent name'], unknown: ['an official project-level record carrying the company number (none exists in public coverage)'], classes: { landWinner: 'OFFICIAL', document: 'USER_DOCUMENT', relation: 'STRONG MATCH (DERIVED)' }, sees: 'PROJECT COMPANY · STRONG MATCH — "multiple independent records point to this legal company … but PROPX does not yet have a definitive official identifier proving it"', refuses: ['VERIFIED from a user document', 'a parent or a guarantor'], verifyNext: ['the Sale-Law guarantee (obligor)', 'the ILA development agreement (rights holder)'] });
  });
  /* 6 · strong but unverified project company */
  t('case 6 · strong but unverified project company', () => {
    const pc = prj(NETANYA_LOT).premium.projectCompany;
    assert.equal(pc.state, 'STRONG_MATCH'); assert.equal(pc.cls, 'OFFICIAL');
    assert.deepEqual(pc.reasons.map((r) => r.code), ['LAND_WINNER_RESOLVED', 'ONE_RECORD_ONLY', 'NO_OFFICIAL_PROJECT_COMPANY_IDENTIFIER']);
    assert.match(pc.statement.en, /^one record points to this legal company/);
    assert.equal(pc.roles.guarantor.state, 'NOT_VERIFIED');
    kase({ id: 6, title: 'strong but unverified project company', knows: ['one official record (the ILA land winner) resolved to one registry company'], unknown: ['whether the rights moved to an SPV after the award'], classes: { relation: 'STRONG MATCH', identity: 'DERIVED (name match)' }, sees: 'PROJECT COMPANY · STRONG MATCH — "one record points to this legal company … no definitive official identifier"', refuses: ['VERIFIED', 'a guarantor from the parent'], verifyNext: ['the purchase agreement seller', 'the Sale-Law guarantee obligor'] });
  });
  /* 7 · unresolved project company */
  t('case 7 · unresolved project company', () => {
    const R = prj(LOTTERY); const pc = R.premium.projectCompany;
    assert.equal(pc.state, 'UNRESOLVED'); assert.equal(pc.company, null);
    assert.ok(pc.resolvingDocuments.some((d) => d.id === 'purchase-agreement') && pc.resolvingDocuments.some((d) => d.id === 'bank-guarantee'));
    assert.ok(R.nextBest.items.some((i) => i.doc === 'purchase_agreement'));
    assert.equal(rowOf(R.summary, 'identity').cls, 'MISSING');
    kase({ id: 7, title: 'unresolved project company', knows: ['the programme developer name on the MoCH record'], unknown: ['the legal company behind the name; the project company'], classes: { relation: 'UNRESOLVED', identity: 'MISSING' }, sees: 'IDENTITY · MISSING — "the project company is not identified"; "Documents that would resolve it" with Add-a-document buttons', refuses: ['picking a company by a similar name'], verifyNext: ['the purchase agreement', 'the Sale-Law guarantee', 'the developer declaration'] });
  });
  /* 8 · public-company parent but no guarantee */
  t('case 8 · public-company parent but no guarantee (PARENT ≠ GUARANTOR; parent financials never become the project company\'s)', () => {
    const chart = doc('ownership_chart', { asOf: '2026-01-01', relations: [{ parentNumber: DEMRI_NO, parentName: nameOf(DEMRI_NO), childNumber: NUM_NET, childName: nameOf(NUM_NET), sharePct: 100 }] });
    const R = prj(NETANYA_LOT, { userDocs: [chart, fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 1, equity: 2 })] });
    const pc = R.premium.projectCompany;
    assert.equal(pc.roles.parent.number, DEMRI_NO); assert.equal(pc.roles.parent.cls, 'USER_DOCUMENT'); assert.equal(pc.roles.parent.registryCheck, 'REGISTRY_ROW_FOUND');
    assert.equal(pc.roles.guarantor.state, 'NOT_VERIFIED');
    const e = R.premium.structure.edges.find((x) => x.type === 'HOLDS'); assert.equal(e.state, 'STRONG_MATCH'); assert.match(e.notProves.en, /a holding ≠ a guarantee/);
    assert.ok(!R.premium.structure.edges.some((x) => x.type === 'GUARANTEES'));
    assert.equal(R.premium.financial.latest, null, 'the parent\'s statements are not the project company\'s');
    kase({ id: 8, title: 'public-company parent but no guarantee', knows: ['per the user\'s ownership chart, 511399388 holds 100 % of the project company (both numbers found in the registry)'], unknown: ['any guarantee or support from the parent'], classes: { holding: 'USER_DOCUMENT (STRONG — both parties by number)', guarantor: 'MISSING (NOT VERIFIED)' }, sees: 'Parent company row (USER DOCUMENT) · Guarantor "not verified — a parent is not a guarantor"', refuses: ['a guarantee from ownership', 'the parent\'s financials as the SPV\'s'], verifyNext: ['an explicit parent guarantee or the Sale-Law guarantee'] });
  });
  /* 9 · developer-reported sales */
  t('case 9 · developer-reported sales', () => {
    const R = prj(LOTTERY, { userDocs: [doc('sales_report', { projectId: LOTTERY, asOf: '2025-06-30', reportedBy: 'developer', unitsPlanned: 196, unitsMarketed: 120, unitsSold: 60 }), doc('sales_report', { projectId: LOTTERY, asOf: '2025-12-31', reportedBy: 'developer', unitsPlanned: 196, unitsMarketed: 150, unitsSold: 96 })] });
    const S = R.premium.sales; assert.equal(S.rate.value, 6);
    assert.equal(rowOf(R.summary, 'sales').cls, 'SELF_REPORTED');
    assert.ok(S.rows.some((r) => r.kind === 'PROGRAMME_LOTTERY' && r.cls === 'OFFICIAL'));
    assert.ok(!S.rows.some((r) => r.kind === 'SALES_REPORT' && r.cls === 'OFFICIAL'));
    kase({ id: 9, title: 'developer-reported sales', knows: ['the developer reported 96 of 150 marketed units sold as of 2025-12-31', 'the official lottery: units offered, applicants, winners'], unknown: ['signed contracts in any official register'], classes: { report: 'SELF-REPORTED (USER DOCUMENT)', lottery: 'OFFICIAL', pace: 'DERIVED' }, sees: 'SALES · SELF-REPORTED — "96 units sold of 150 marketed (DEVELOPER-REPORTED · USER DOCUMENT)"; pace 6 units / month (DERIVED)', refuses: ['mixing the report with official transactions', 'reading lottery winners as sales'], verifyNext: ['the lender\'s monitoring report'] });
  });
  /* 10 · no sales data */
  t('case 10 · no sales data', () => {
    const R = prj(TLV_LOT); const S = R.premium.sales;
    assert.ok(S.missing.some((m) => m.id === 'sales-progress')); assert.equal(rowOf(R.summary, 'sales').cls, 'MISSING');
    assert.ok(S.rows.every((r) => r.kind === 'TENDER_UNITS'), 'only tender capacity'); assert.match(S.rows[0].note.en, /capacity — not units marketed or sold/);
    kase({ id: 10, title: 'no sales data', knows: ['the tender capacity (units) — capacity, not sales'], unknown: ['units marketed / sold, presales, delivery'], classes: { capacity: 'OFFICIAL', sales: 'MISSING' }, sees: 'SALES · MISSING — "no project-level sales data in public sources"', refuses: ['0 sold', 'a pace from district sales'], verifyNext: ['a sales report from the developer or the lender'] });
  });
  /* 11 · municipal permit outside Tel Aviv */
  t('case 11 · municipal permit outside Tel Aviv', () => {
    const base = prj(HAIFA_LOT);
    const R = prj(HAIFA_LOT, { userDocs: [doc('permit', { projectId: HAIFA_LOT, municipality: 'חיפה', permitNumber: 'TEST-1', issueDate: '2025-09-01', holderName: 'בעל היתר לבדיקה בע"מ' })] });
    assert.equal(R.premium.coverage.municipality.state, 'NO_MACHINE_ACCESS'); assert.equal(R.premium.coverage.permit.level, 'NONE');
    const h = R.premium.projectCompany.roles.permitHolder.find((x) => x.document); assert.ok(h && h.cls === 'USER_DOCUMENT');
    assert.deepEqual(R.dd.ladder.rungs.map((r) => r.evidenced), base.dd.ladder.rungs.map((r) => r.evidenced), 'a user permit never moves the official ladder');
    kase({ id: 11, title: 'municipal permit outside Tel Aviv', knows: ['Haifa publishes no permits through an open machine channel (audited)', 'the user\'s permit document (number, date, holder)'], unknown: ['the municipal permit record itself'], classes: { coverage: 'NO MACHINE ACCESS', permit: 'USER_DOCUMENT' }, sees: 'Execution coverage map: Permit NONE · Haifa NO_MACHINE_ACCESS; Permit holder row (USER DOCUMENT)', refuses: ['moving the stage ladder on a user document', 'national permit coverage'], verifyNext: ['the permit in the municipal engineering viewer'] });
  });
  /* 12 · city without permit coverage */
  t('case 12 · city without permit coverage', () => {
    const J = COV.forLocality(3000), N = COV.forLocality(1063);
    assert.equal(J.municipality.state, 'BLOCKED'); assert.equal(N.municipality.state, 'NOT_AUDITED'); assert.equal(N.permit.level, 'NONE');
    kase({ id: 12, title: 'city without permit coverage', knows: ['Jerusalem\'s GIS answers "Access Denied" (BLOCKED)', 'locality 1063 was not audited'], unknown: ['every permit in those cities'], classes: { permit: 'MISSING' }, sees: 'The municipality\'s permit channel: BLOCKED / NOT AUDITED — with the reason', refuses: ['"no permit" from no source'], verifyNext: ['the permit number from the developer'] });
  });
  /* 13 · exact construction-start evidence */
  t('case 13 · exact construction-start evidence', () => {
    const A = prj(TLV_LOT).premium.coverage; assert.equal(A.start.level, 'PROJECT_LIVE'); assert.equal(A.found.start.found, true); assert.match(A.found.start.date, /^\d{4}-\d{2}-\d{2}$/);
    const B = prj(MOCH_JOIN_LOT).premium.coverage; assert.equal(B.found.start.source, 'datagov:moch:construction-progress'); assert.equal(B.found.start.stale, true);
    kase({ id: 13, title: 'exact construction-start evidence', knows: [`Tel Aviv: a dated construction start on a STRONG-linked site (${A.found.start.date})`, `MoCH progress report: first start ${B.found.start.date} (exact block + parcel, after the award; source last updated 2024-03 — STALE)`], unknown: ['completion and occupancy after the source\'s last update'], classes: { tlv: 'OFFICIAL (municipal)', moch: 'OFFICIAL (stale)' }, sees: 'Coverage map: Construction start ✓ date · PROJECT_LIVE / ✓ STALE', refuses: ['completion from a start'], verifyNext: ['the site\'s current state (Form 4 / occupancy)'] });
  });
  /* 14 · only district-level construction evidence */
  t('case 14 · only district-level construction evidence', () => {
    const R = prj(DISTRICT_ONLY_LOT); const C2 = R.premium.coverage;
    assert.equal(C2.found.start.found, false); assert.equal(C2.start.district.level, 'DISTRICT_ONLY');
    assert.ok(!R.dd.ladder.rungs.find((r) => r.stage === 'construction-started').evidenced);
    kase({ id: 14, title: 'only district-level construction evidence', knows: ['the district\'s CBS construction starts (context)'], unknown: ['whether THIS project started'], classes: { district: 'OFFICIAL (district)', project: 'MISSING' }, sees: 'Construction start: "district level only — never a project"; found: no', refuses: ['allocating a district start to the project'], verifyNext: ['the work-start notice / site registration'] });
  });
  /* 15 · civil litigation disclosed in filing */
  t('case 15 · civil litigation disclosed in a filing (via the user\'s document)', () => {
    const R = dev(DEMRI, { userDocs: [doc('litigation_disclosure', { entityNumber: DEMRI_NO, asOf: '2026-03-20', kind: 'class-action', court: 'TEST FIXTURE court', caseNumber: 'TEST-1', amount: 1000, currency: 'ILS', material: 'not-stated' })] });
    const it = R.premium.legal.items.find((i) => i.kind === 'DISCLOSED_LITIGATION'); assert.ok(it && it.cls === 'USER_DOCUMENT' && it.subKind === 'class-action');
    assert.equal(R.premium.legal.coverage.civil.state, 'NOT_IN_COVERAGE');
    kase({ id: 15, title: 'civil litigation disclosed in filing', knows: ['a class action disclosed in the document (court, case number, amount as stated)'], unknown: ['other proceedings; the outcome'], classes: { disclosure: 'USER_DOCUMENT', civilCoverage: 'NOT IN COVERAGE' }, sees: 'LEGAL EXPOSURE — "a proceeding disclosed in a document" (USER DOCUMENT)', refuses: ['a probability of loss', 'materiality not stated by the document'], verifyNext: ['the court record by case number'] });
  });
  /* 16 · no litigation source */
  t('case 16 · no litigation source', () => {
    const R = dev(DEMRI); assert.match(R.premium.legal.statement.en, /ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION/);
    kase({ id: 16, title: 'no litigation source', knows: ['no liquidation / insolvency / strike-off / attachment row by company number'], unknown: ['civil, class-action and regulatory proceedings (no open defendant-level source)'], classes: { legal: 'OFFICIAL (by number) + MISSING (civil)' }, sees: 'CORPORATE / LEGAL — "no row in the open sources … ABSENCE OF A PUBLIC ROW ≠ NO LITIGATION"', refuses: ['"no litigation"'], verifyNext: ['a court-system search by company number'] });
  });
  /* 17 · user uploads a permit */
  t('case 17 · user uploads a permit', () => {
    const d = UD.normalize(doc('permit', { projectId: TLV_LOT, municipality: 'תל אביב-יפו', permitNumber: 'TEST-2', issueDate: '2025-01-01', holderNumber: NUM_NET })).doc;
    assert.equal(d.cls, 'USER_DOCUMENT'); assert.ok(d.provenance.sha256 && d.provenance.fileName);
    const R = prj(TLV_LOT, { userDocs: [d] });
    const h = R.premium.projectCompany.roles.permitHolder.find((x) => x.document); assert.equal(h.cls, 'USER_DOCUMENT');
    assert.ok(R.userDocs.used.includes(d.id));
    kase({ id: 17, title: 'user uploads a permit', knows: ['the permit facts the user entered, the file fingerprint (SHA-256)'], unknown: ['the authenticity of the file (PROPX reads no PDF)'], classes: { permit: 'USER_DOCUMENT' }, sees: 'Permit holder row "per the user\'s document · date"; the document listed under Evidence you provided with its fingerprint', refuses: ['OFFICIAL', 'moving the ladder'], verifyNext: ['the municipal permit record (Tel Aviv: read live)'] });
  });
  /* 18 · user uploads financials */
  t('case 18 · user uploads financials (restatement and a conflicting version kept apart)', () => {
    const R = dev(DEMRI, { userDocs: [fs1(DEMRI_NO, '2025-12-31', '2026-03-20', { cash: 100 }), fs1(DEMRI_NO, '2025-12-31', '2026-06-01', { cash: 90 }, { restated: true })] });
    assert.equal(R.premium.financial.restatements.length, 1); assert.equal(R.premium.financial.latest.restated, true);
    kase({ id: 18, title: 'user uploads financials', knows: ['two versions of FY2025; the later is marked restated and supersedes (both kept)'], unknown: ['the reason for the restatement unless entered'], classes: { figures: 'USER_DOCUMENT', restatement: 'USER_DOCUMENT' }, sees: 'Restatements: 31.12.2025 · report 20.03.2026 → 01.06.2026 · cash 100 → 90', refuses: ['picking a version when neither is marked restated (CONFLICT)'], verifyNext: ['the restatement note'] });
  });
  /* 19 · user uploads ownership chart */
  t('case 19 · user uploads an ownership chart (each party checked by number)', () => {
    const chart = doc('ownership_chart', { asOf: '2026-01-01', relations: [{ parentNumber: DEMRI_NO, childNumber: NUM_NET, sharePct: 60 }, { parentNumber: '516999999', parentName: 'בעל מניות לבדיקה בע"מ', childNumber: NUM_NET, sharePct: 40 }] });
    const S = prj(NETANYA_LOT, { userDocs: [chart] }).premium.structure;
    const st = S.edges.filter((e) => e.type === 'HOLDS').map((e) => e.state).sort();
    assert.deepEqual(st, ['POSSIBLE_MATCH', 'STRONG_MATCH']); assert.equal(S.coverage, 'USER_DOCUMENT');
    kase({ id: 19, title: 'user uploads ownership chart', knows: ['two holdings per the chart; one holder found in the registry by number, one not in coverage'], unknown: ['the chart\'s accuracy; any guarantee'], classes: { holdings: 'USER_DOCUMENT (STRONG / POSSIBLE)' }, sees: 'Corporate structure table: relation · from · to · share · state · class · what it proves · what it does NOT prove', refuses: ['ownership from a name / address / director', 'a guarantee from a holding'], verifyNext: ['a current Registrar extract'] });
  });
  /* 20 · ambiguous company match */
  t('case 20 · ambiguous company match', () => {
    const R = dev(AMBIG); const res = R.dd.identity.resolution;
    assert.equal(res.state, 'AMBIGUOUS'); assert.equal(res.chosen, null); assert.ok(res.candidates.length >= 2);
    assert.equal(rowOf(R.summary, 'resolution').cls, 'CONFLICT'); assert.equal(rowOf(R.summary, 'identity').cls, 'CONFLICT');
    const R2 = dev(AMBIG, { userDocs: [fs1(res.candidates[0].number, '2025-12-31', '2026-03-20', { cash: 1 })] });
    assert.equal(R2.premium.financial.latest, null, 'a candidate\'s statements are not applied while the match is ambiguous');
    kase({ id: 20, title: 'ambiguous company match', knows: [`${res.candidates.length} registry companies carry the same normalized name`], unknown: ['which one is the developer'], classes: { identity: 'CONFLICT (AMBIGUOUS)' }, sees: 'ENTITY RESOLUTION STATUS · CONFLICT — the candidates listed, none picked; "use this number" needs the user', refuses: ['picking a candidate', 'applying a candidate\'s documents'], verifyNext: ['the company number from a contract'] });
  });

  t('the institutional diligence summary: fixed rows, one class each from the closed vocabulary, every row with an explainability term; no score', () => {
    for (const R of [dev(DEMRI), prj(TLV_LOT)]) {
      assert.deepEqual(R.summary.rows.map((r) => r.id), SUM.ROWS);
      for (const r of R.summary.rows) { if (r.cls) assert.ok(R.summary.classes.includes(r.cls), r.id + ' ' + r.cls); assert.ok(X.term(r.term), r.id + ' term ' + r.term); assert.ok(r.he && r.en); }
      assert.ok(!/score|probability|recommend/i.test(JSON.stringify(R.summary.rows.map((r) => r.en))));
    }
  });
  t('the page: the summary, premium sections and the user-evidence panel are wired; the file never leaves the browser (only its SHA-256); documents travel only by POST view=dd', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const f of ['function ddSumHTML', 'function ddPcoHTML', 'function ddFinProfileHTML', 'function ddStructHTML', 'function ddLegalHTML', 'function ddSalesHTML', 'function ddCovMapHTML', 'function ddUdPanelHTML', 'async function inPost']) assert.ok(html.includes(f), f);
    assert.match(html, /crypto\.subtle\.digest\("SHA-256",buf\)/); assert.ok(!/FormData|readAsDataURL|readAsText\(f/.test(html.slice(html.indexOf('function ddUdFile'), html.indexOf('function ddUdCollect'))), 'the file content is never read into the page');
    assert.match(html, /<script src="\/lib\/dd\/userdocs\.js"><\/script>/);
    const sa = fs.readFileSync(path.join(ROOT, 'standalone/israel-new-homes-v2.html'), 'utf8'); assert.ok(!sa.includes('<script src="/lib/dd/userdocs.js">') && sa.includes('PropxUserDocs'));
  });

  assert.equal(CASES.length, 20, 'twenty acceptance cases');
  if (process.env.DD_PREMIUM_ACCEPTANCE_OUT) fs.writeFileSync(process.env.DD_PREMIUM_ACCEPTANCE_OUT, JSON.stringify(CASES, null, 1));
  console.log(`dd-premium: ${n} gates passed`);
})().catch((e) => { console.log('  ✗ ' + (e && e.stack || e)); console.log('dd-premium: SOME FAILED'); process.exit(1); });
