// PROPX · PROJECT COMPANY / SPV RESOLUTION (Premium Diligence 2.0, 18.10.2026).
//
// For one project: who is who — developer brand · land winner · project company · permit holder · executing contractor ·
// parent company · guarantor — each from its own record, with its own state, and never one inferred from another.
//
// States (the project-company relation itself, not the company's identity):
//   VERIFIED      an official project-level record carries the company NUMBER (none in current public coverage)
//   STRONG_MATCH  independent records point to ONE legal company and its identity is resolved: the land winner (the ILA
//                 record) or the programme developer (the MoCH record) resolved to one registry company, and — when it
//                 exists — a second record (a Tel Aviv permit holder on a STRONG site, a user document) names the same
//                 company; still not a definitive identifier
//   POSSIBLE      a candidate without a resolved identity, or records that name different companies (both shown)
//   UNRESOLVED    joint winners (the project company may be a partnership of the parties), a private person, an unresolved
//                 name, or no record at all
// A user document (purchase agreement, permit, land-rights document, financing agreement, bank guarantee, developer
// declaration) can name the company: it raises the evidence to STRONG at most and is labelled USER_DOCUMENT; a document
// that names a different company than an official record is a CONFLICT, never an override.
//
// Truth rules: PUBLIC COMPANY ≠ PROJECT SPV · PARENT ≠ GUARANTOR · SUBSIDIARY ≠ PROJECT SPV · CONTRACTOR ≠ PROJECT COMPANY ·
// a guarantor is shown only from an explicit document (a bank guarantee or a declared parent guarantee), never inferred.
'use strict';

const R = require('../entities/resolve');
const UD = require('./userdocs');

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-project-company-v1', effective: '2026-10-18' });
const RANK = { VERIFIED: 4, STRONG_MATCH: 3, POSSIBLE_MATCH: 2, AMBIGUOUS: 1, UNRESOLVED: 0 };
/* a registry row OR already-composed facts (the developer read carries facts) → facts */
const facts = (row) => (row ? (row.id && row.number ? row : R.companyFacts(row)) : null);

/* the documents that resolve each role — what Next Best Evidence asks for */
const RESOLVING_DOCUMENTS = Object.freeze([
  { id: 'purchase-agreement', label: bi('הסכם הרכישה — המוכר ומספר החברה שלו', 'the purchase agreement — the seller and its company number'), resolves: 'projectCompany' },
  { id: 'bank-guarantee', label: bi('ערבות חוק המכר — החייב (חברת הפרויקט) והבנק', 'the Sale-Law bank guarantee — the obligor (the project company) and the bank'), resolves: 'projectCompany' },
  { id: 'permit', label: bi('היתר הבנייה — בעל ההיתר', 'the building permit — the permit holder'), resolves: 'permitHolder' },
  { id: 'company-number', label: bi('מספר החברה (ח.פ.) של חברת הפרויקט', 'the project company\'s number'), resolves: 'projectCompany' },
  { id: 'land-rights', label: bi('הסכם הפיתוח / החכירה עם רמ״י — בעל הזכויות', 'the ILA development / lease agreement — the rights holder'), resolves: 'projectCompany' },
  { id: 'financing-agreement', label: bi('הסכם הליווי — הלווה', 'the project-finance agreement — the borrower'), resolves: 'projectCompany' },
  { id: 'developer-declaration', label: bi('הצהרת היזם — חברת הפרויקט, חברת האם, ערבות', 'the developer\'s declaration — project company, parent, guarantee'), resolves: 'parent' },
]);
const NOT_A = [
  bi('חברה ציבורית ≠ חברת הפרויקט', 'PUBLIC COMPANY ≠ PROJECT SPV'), bi('חברת אם ≠ ערב', 'PARENT ≠ GUARANTOR'), bi('חברה בת ≠ חברת הפרויקט', 'SUBSIDIARY ≠ PROJECT SPV'),
  bi('קבלן מבצע ≠ חברת הפרויקט', 'EXECUTING CONTRACTOR ≠ PROJECT COMPANY'), bi('דמיון שם לעולם אינו מזהה חברת פרויקט', 'a name similarity never identifies a project company'),
];

/** project DD (lib/dd/project.js) + its developer DD + the user's documents + the registry index → the roles */
function projectCompany({ project, projectDD, developerDD = null, userDocs = [], index = null, now = null }) {
  const p = project || {}, X = projectDD || {}, today = String(now || new Date().toISOString()).slice(0, 10);
  const docs = UD.concerning(userDocs, { projectId: p.id });
  const evidence = [], conflicts = [];
  const res = developerDD ? developerDD.identity.resolution : null;
  const winnerRole = p.kind === 'ila-awarded-lot' ? 'LAND_WINNER' : 'PROGRAMME_DEVELOPER';
  /* 1. the official project record's party: the ILA land winner / the MoCH programme developer */
  if (res) {
    const official = { role: winnerRole, source: p.kind === 'ila-awarded-lot' ? R.SRC.ila : R.SRC.moch, cls: 'OFFICIAL', name: developerDD.identity.observedName, resolution: res.state, company: facts(res.chosen),
      key: p.kind === 'ila-awarded-lot' ? bi('שם הזוכה בתיק המגרש', 'the winner name on the lot file') : bi('שם היזם ברשומת ההגרלה', 'the developer name on the lottery record'), reasons: res.reasons };
    if (res.reasons && res.reasons.some((r) => r.code === 'JOINT_WINNER_STRING' || r.code === 'JOINT_PARTIES_RESOLVED_SEPARATELY' || r.code === 'JOINT_STRING_NOT_SPLITTABLE')) official.joint = (res.parties || []).map((x) => ({ name: x.name, state: x.state, company: facts(x.chosen) }));
    evidence.push(official);
  }
  /* 2. Tel Aviv permit holders on STRONG sites (a second, independent official record) */
  for (const s of (X.sites && X.sites.tlv) || []) {
    if (s.matchState !== 'STRONG_MATCH') continue;
    for (const h of s.holders || []) {
      if (!/בע"?מ|בע~מ|בעמ|ltd|שותפות|ש\.מ/i.test(h)) continue;
      const r = index ? R.resolveCompany({ canonical: h, kind: 'company', joint: false }, index) : { state: 'UNRESOLVED', reasons: [] };
      /* the holder's name is part of what linked the site to the project — the same evidence, never an independent second record */
      evidence.push({ role: 'PERMIT_HOLDER', source: R.SRC.tlvSites, cls: 'OFFICIAL', name: h, resolution: r.state, company: facts(r.chosen), site: s.id, independent: false, key: bi('בעל ההיתר באתר שצורף במפתח חזק (תל אביב) — שמו הוא חלק מהקישור', 'the permit holder of a STRONG-linked site (Tel Aviv) — its name is part of the link') });
    }
  }
  /* 3. user documents that name the project company (each checked against the registry; class USER_DOCUMENT) */
  const DOC_NAMES = { purchase_agreement: ['sellerName', 'sellerNumber'], permit: ['holderName', 'holderNumber'], land_rights: ['holderName', 'holderNumber'], financing_agreement: ['borrowerName', 'borrowerNumber'], bank_guarantee: ['applicantName', 'applicantNumber'], developer_declaration: ['projectCompanyName', 'projectCompanyNumber'] };
  for (const d of docs) {
    const k = DOC_NAMES[d.type]; if (!k) continue; const name = d.fields[k[0]] || null, number = d.fields[k[1]] || null; if (!name && !number) continue;
    const chk = UD.registryCheck(number, name, index, R.regKey);
    evidence.push({ role: d.type === 'permit' ? 'PERMIT_HOLDER' : 'PROJECT_COMPANY_PER_DOCUMENT', source: 'user-document', cls: 'USER_DOCUMENT', name, number, document: { id: d.id, type: d.type, typeLabel: d.typeLabel, date: d.docDate, provenance: d.provenance },
      /* a number PROPX cannot check (not in the kept rows, the live lookup did not find it) is a CANDIDATE — POSSIBLE, never dropped */
      /* REGISTRY_ROW_FOUND checks the company's identity by number; the relation itself is the document's claim — STRONG at most */
      resolution: chk.state === 'REGISTRY_ROW_FOUND' ? 'STRONG_MATCH' : chk.state === 'NAME_DIFFERS' || (number && chk.state === 'NOT_IN_COVERAGE') ? 'POSSIBLE_MATCH' : 'UNRESOLVED', registryCheck: chk.state, company: facts(chk.row), note: chk.note || null,
      key: bi(`${d.typeLabel.he} שסיפק המשתמש (${d.docDate || '—'})`, `the user's ${d.typeLabel.en.toLowerCase()} (${d.docDate || '—'})`) });
  }
  /* the companies the evidence points to (resolved identities only) */
  const byNum = new Map();
  for (const e of evidence) { if (!e.company || RANK[e.resolution] < RANK.STRONG_MATCH) continue; const k = e.company.number; if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(e); }
  const official = evidence.filter((e) => e.cls === 'OFFICIAL'), userEv = evidence.filter((e) => e.cls === 'USER_DOCUMENT');
  let state = 'UNRESOLVED', company = null, reasons = [], cls = null;
  const winner = evidence.find((e) => e.role === winnerRole);
  /* a user document naming a company NUMBER that is not among the resolved companies: a different company per the document —
     a conflict with the official record (never an override), whether or not PROPX can check the number */
  const docOther = evidence.filter((e) => e.cls === 'USER_DOCUMENT' && e.number && !byNum.has(String(e.number)));
  if (byNum.size >= 1 && docOther.length) {
    state = 'POSSIBLE_MATCH'; reasons = ['RECORDS_NAME_DIFFERENT_COMPANIES'];
    conflicts.push({ kind: 'PROJECT_COMPANY', companies: [...[...byNum].map(([n, es]) => ({ number: n, name: es[0].company.name, by: es.map((e) => ({ role: e.role, cls: e.cls, source: e.source })) })),
      ...docOther.map((e) => ({ number: String(e.number), name: e.company ? e.company.name : e.name, registryCheck: e.registryCheck, by: [{ role: e.role, cls: e.cls, source: e.source, document: e.document.id }] }))],
      statement: bi('מסמך שסיפק המשתמש נוקב בחברה אחרת מזו שברשומה הרשמית — לא נבחרה; ייתכן שהזוכה העביר את הזכויות לחברת פרויקט (SPV)', 'a document the user provided names a different company than the official record — none picked; the winner may have transferred the rights to a project company (SPV)') });
  } else if (byNum.size > 1) {
    state = 'POSSIBLE_MATCH'; reasons = ['RECORDS_NAME_DIFFERENT_COMPANIES'];
    conflicts.push({ kind: 'PROJECT_COMPANY', companies: [...byNum].map(([n, es]) => ({ number: n, name: es[0].company.name, by: es.map((e) => ({ role: e.role, cls: e.cls, source: e.source })) })),
      statement: bi('רשומות שונות מצביעות על חברות שונות — לא נבחרה; ייתכן שהזוכה העביר את הזכויות לחברת פרויקט (SPV)', 'different records point to different companies — none picked; the winner may have transferred the rights to a project company (SPV)') });
  } else if (byNum.size === 1) {
    const [[num, es]] = [...byNum]; company = es[0].company;
    const officialHits = es.filter((e) => e.cls === 'OFFICIAL'), userHits = es.filter((e) => e.cls === 'USER_DOCUMENT');
    state = 'STRONG_MATCH'; cls = officialHits.length ? 'OFFICIAL' : 'USER_DOCUMENT';
    const independent = officialHits.filter((e) => e.independent !== false).length + userHits.length;
    reasons = [officialHits.some((e) => e.role === winnerRole) ? (p.kind === 'ila-awarded-lot' ? 'LAND_WINNER_RESOLVED' : 'PROGRAMME_DEVELOPER_RESOLVED') : null,
      officialHits.some((e) => e.role === 'PERMIT_HOLDER') ? 'PERMIT_HOLDER_SAME_COMPANY' : null, userHits.length ? 'USER_DOCUMENT_NAMES_COMPANY' : null,
      independent > 1 ? 'INDEPENDENT_RECORDS_AGREE' : 'ONE_RECORD_ONLY', 'NO_OFFICIAL_PROJECT_COMPANY_IDENTIFIER'].filter(Boolean);
    void num;
  } else if (evidence.some((e) => e.resolution === 'POSSIBLE_MATCH' || e.resolution === 'AMBIGUOUS')) { state = 'POSSIBLE_MATCH'; reasons = ['CANDIDATE_IDENTITY_NOT_RESOLVED']; }
  else if (winner && winner.joint) { state = 'UNRESOLVED'; reasons = ['JOINT_WINNERS_PROJECT_COMPANY_UNKNOWN']; }
  else reasons = evidence.length ? ['NO_RESOLVED_COMPANY'] : ['NO_RECORD'];
  const REASON_TEXT = {
    LAND_WINNER_RESOLVED: bi('הזוכה ברמ״י הוא בעל הזכויות במגרש; זהותו נפתרה לחברה רשומה אחת', 'the ILA winner holds the lot\'s rights; its identity resolves to one registered company'),
    PROGRAMME_DEVELOPER_RESOLVED: bi('היזם ברשומת התכנית נפתר לחברה רשומה אחת', 'the programme developer resolves to one registered company'),
    PERMIT_HOLDER_SAME_COMPANY: bi('בעל ההיתר בתל אביב (אתר בקישור חזק) הוא אותה חברה — שמו הוא חלק מהקישור, ולכן אינו אישור בלתי תלוי', 'the Tel Aviv permit holder (a STRONG-linked site) is the same company — its name is part of the link, so it is not an independent confirmation'),
    USER_DOCUMENT_NAMES_COMPANY: bi('מסמך שסיפק המשתמש נוקב באותה חברה (מספרה נמצא ברשם)', 'a document the user provided names the same company (its number is in the registry)'),
    INDEPENDENT_RECORDS_AGREE: bi('כמה רשומות בלתי תלויות מצביעות על אותה חברה', 'several independent records point to the same company'),
    ONE_RECORD_ONLY: bi('רשומה אחת בלבד', 'one record only'),
    NO_OFFICIAL_PROJECT_COMPANY_IDENTIFIER: bi('אין ל-PROPX מזהה רשמי מכריע (מספר חברה ברשומת הפרויקט) — לכן לא "מאומת"', 'PROPX has no definitive official identifier (a company number on the project record) — hence not VERIFIED'),
    RECORDS_NAME_DIFFERENT_COMPANIES: bi('רשומות שונות נוקבות בחברות שונות', 'records name different companies'),
    CANDIDATE_IDENTITY_NOT_RESOLVED: bi('יש מועמד, אך זהותו המשפטית לא נפתרה', 'there is a candidate, but its legal identity is not resolved'),
    JOINT_WINNERS_PROJECT_COMPANY_UNKNOWN: bi('זוכים במשותף — חברת הפרויקט עשויה להיות שותפות / חברה משותפת של הצדדים; אינה ידועה', 'joint winners — the project company may be a partnership / joint company of the parties; not known'),
    NO_RESOLVED_COMPANY: bi('אף רשומה אינה נפתרת לחברה רשומה', 'no record resolves to a registered company'),
    NO_RECORD: bi('אין רשומה שנוקבת בצד לפרויקט', 'no record names a party to the project'),
  };
  /* roles — each from its own record */
  const subj = company ? company.number : null;
  /* a document about another project never lends this one a parent, a guarantor or a guarantee: only documents carrying THIS
     project's id, or — with no project id — whose SUBJECT is this project company (the declaration's project company, the
     guarantee's applicant, a chart row whose held company is it) */
  const aboutThis = (d) => (d.fields.projectId ? d.fields.projectId === p.id : !!subj && ((d.type === 'developer_declaration' && d.fields.projectCompanyNumber === subj) || (d.type === 'bank_guarantee' && d.fields.applicantNumber === subj) || d.type === 'ownership_chart'));
  const parentDocs = docs.concat(UD.concerning(userDocs, { companyNumbers: subj ? [subj] : [] })).filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i).filter(aboutThis);
  const parent = (() => {
    for (const d of parentDocs) {
      if (d.type === 'developer_declaration' && (d.fields.parentNumber || d.fields.parentName) && !(subj && d.fields.parentNumber === subj)) return { name: d.fields.parentName || null, number: d.fields.parentNumber || null, cls: 'USER_DOCUMENT', document: { id: d.id, type: d.type, date: d.docDate }, registryCheck: UD.registryCheck(d.fields.parentNumber, d.fields.parentName, index, R.regKey).state };
      if (d.type === 'ownership_chart' && company) { const rel = (d.fields.relations || []).find((r) => r.childNumber === company.number && r.parentNumber !== company.number); if (rel) return { name: rel.parentName || null, number: rel.parentNumber, sharePct: rel.sharePct ?? null, cls: 'USER_DOCUMENT', document: { id: d.id, type: d.type, date: d.docDate }, registryCheck: UD.registryCheck(rel.parentNumber, rel.parentName, index, R.regKey).state }; }
    }
    return null;
  })();
  const guarantor = (() => {
    const found = [];
    for (const d of parentDocs) {
      if (d.type === 'developer_declaration' && d.fields.guarantee === 'explicit-parent-guarantee' && !(subj && d.fields.parentNumber === subj)) found.push({ kind: 'PARENT_GUARANTEE_DECLARED', name: d.fields.parentName || null, number: d.fields.parentNumber || null, cls: 'USER_DOCUMENT', document: { id: d.id, type: d.type, date: d.docDate } });
      if (d.type === 'bank_guarantee' && (d.fields.guarantorName || d.fields.bank)) { const expired = !!(d.fields.expiryDate && d.fields.expiryDate < today);
        found.push({ kind: d.fields.guarantorName ? 'NAMED_GUARANTOR' : 'BANK_GUARANTEE', name: d.fields.guarantorName || d.fields.bank, number: d.fields.guarantorNumber || null, guaranteeKind: d.fields.kind, expiry: d.fields.expiryDate || null, expired,
          note: expired ? bi(`פג תוקף ב-${d.fields.expiryDate} לפי המסמך — אינו בתוקף`, `expired on ${d.fields.expiryDate} per the document — not in force`) : null, cls: 'USER_DOCUMENT', document: { id: d.id, type: d.type, date: d.docDate } }); }
    }
    return found.find((g) => !g.expired) || found[0] || null;
  })();
  const contractors = (X.contractors || []).map((c) => ({ name: c.name, kablan: c.kablan, company: c.company, matchState: c.matchState, cls: 'OFFICIAL' }));
  const missingRoles = [];
  if (!company) missingRoles.push('projectCompany');
  if (!evidence.some((e) => e.role === 'PERMIT_HOLDER')) missingRoles.push('permitHolder');
  if (!parent) missingRoles.push('parent');
  if (!guarantor) missingRoles.push('guarantor');
  if (!contractors.length) missingRoles.push('executingContractor');
  const resolvingDocuments = RESOLVING_DOCUMENTS.filter((d) => missingRoles.includes(d.resolves) || (state !== 'VERIFIED' && d.resolves === 'projectCompany'));
  return {
    version: VERSION, state, cls, company, reasons: reasons.map((c) => ({ code: c, ...(REASON_TEXT[c] || bi(c, c)) })), evidence, conflicts,
    roles: {
      developerBrand: developerDD ? { name: developerDD.identity.observedName, cls: 'OBSERVED', note: bi('שם המותג כפי שנצפה ברשומות — לא ישות משפטית', 'the brand as observed on the records — not a legal entity') } : null,
      landWinner: p.kind === 'ila-awarded-lot' && winner ? { name: winner.name, resolution: winner.resolution, company: winner.company, joint: winner.joint || null, cls: 'OFFICIAL' } : null,
      programmeDeveloper: p.kind === 'moch-lottery-project' && winner ? { name: winner.name, resolution: winner.resolution, company: winner.company, cls: 'OFFICIAL' } : null,
      projectCompany: company ? { state, company, cls } : { state, company: null },
      permitHolder: evidence.filter((e) => e.role === 'PERMIT_HOLDER').map((e) => ({ name: e.name, number: e.number || null, resolution: e.resolution, registryCheck: e.registryCheck || null, company: e.company, cls: e.cls, site: e.site || null, document: e.document || null })),
      perDocument: evidence.filter((e) => e.role === 'PROJECT_COMPANY_PER_DOCUMENT').map((e) => ({ name: e.name, number: e.number || null, resolution: e.resolution, registryCheck: e.registryCheck, company: e.company, cls: e.cls, document: e.document, note: e.note })),
      executingContractor: contractors,
      parent: parent || { state: 'NOT_IN_COVERAGE', note: bi('אין מקור ציבורי לבעלות — חברת אם אינה נקבעת (ניתן להוסיף תרשים אחזקות / הצהרת יזם)', 'no public ownership source — a parent is not determined (an ownership chart / a developer declaration can be added)') },
      guarantor: guarantor || { state: 'NOT_VERIFIED', note: bi('לא הוצג מסמך ערבות מפורש — חברת אם אינה ערב', 'no explicit guarantee document — a parent is not a guarantor') },
    },
    resolvingDocuments, notA: NOT_A,
    statement: state === 'STRONG_MATCH' && reasons.some((r) => r === 'INDEPENDENT_RECORDS_AGREE') ? bi('כמה רשומות בלתי תלויות מצביעות על חברה משפטית זו כחברת הפרויקט, אך ל-PROPX אין עדיין מזהה רשמי מכריע שמוכיח זאת', 'multiple independent records point to this legal company as the project company, but PROPX does not yet have a definitive official identifier proving it')
      : state === 'STRONG_MATCH' ? bi('רשומה אחת מצביעה על חברה משפטית זו כחברת הפרויקט (זהותה נפתרה), אך ל-PROPX אין עדיין מזהה רשמי מכריע שמוכיח זאת; הפרויקט עשוי להתנהל בחברת פרויקט (SPV) אחרת', 'one record points to this legal company as the project company (its identity is resolved), but PROPX does not yet have a definitive official identifier proving it; the project may sit in a different project company (SPV)')
      : state === 'POSSIBLE_MATCH' ? bi('יש מועמד לחברת הפרויקט, אך הראיות אינן מספיקות או סותרות', 'there is a project-company candidate, but the evidence is insufficient or conflicting')
      : bi('חברת הפרויקט אינה מזוהה במקורות PROPX', 'the project company is not identified in PROPX sources'),
  };
}

module.exports = { VERSION, RESOLVING_DOCUMENTS, NOT_A, projectCompany };
