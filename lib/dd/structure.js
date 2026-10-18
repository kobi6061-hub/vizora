// PROPX · CORPORATE STRUCTURE GRAPH (Premium Diligence 2.0, 18.10.2026).
//
// Source audit: no open source carries shareholders — the Registrar's extract (נסח חברה) is a paid, identified service;
// public-company holdings live in MAYA / MAGNA (blocked). The graph therefore holds only:
//   • relations a USER DOCUMENT states (an ownership chart, a company extract, a developer declaration) — each party's
//     identity checked against the registry by number, the relation itself the document's claim (class USER_DOCUMENT);
//   • relations an OFFICIAL record states that are NOT ownership: the parties of one joint award (CO_WINNER) — a joint
//     award is not a group, not a parent, not a guarantee.
// Never: an ownership edge from a name similarity, a shared address, a common director or a shared brand.
//
// Relation states: VERIFIED (an official disclosure with numbers — none in current coverage) · STRONG (both parties found
// in the registry by number and the names agree) · POSSIBLE (a party not found, or a name that differs) · UNRESOLVED.
'use strict';

const R = require('../entities/resolve');
const UD = require('./userdocs');

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-structure-v1', effective: '2026-10-18' });
const NOT_PROVES = Object.freeze({
  HOLDS: bi('אחזקה ≠ ערבות, ≠ תמיכה פיננסית, ≠ אחריות לחובות; חברה בת ≠ חברת הפרויקט', 'a holding ≠ a guarantee, ≠ financial support, ≠ liability for debts; a subsidiary ≠ the project SPV'),
  SHAREHOLDER_OF: bi('בעל מניות ≠ תמיכה בפרויקט, ≠ ערב', 'a shareholder ≠ project support, ≠ a guarantor'),
  GUARANTEES: bi('ערבות לפי מסמך — היקף, תוקף ותנאים כפי שבמסמך בלבד', 'a guarantee per a document — scope, validity and terms only as the document states'),
  CO_WINNER: bi('זכייה משותפת ≠ קבוצה, ≠ חברת אם, ≠ ערבות', 'a joint award ≠ a group, ≠ a parent, ≠ a guarantee'),
});
const RULES = [bi('חברת אם ≠ ערב', 'PARENT ≠ GUARANTOR'), bi('אותו מותג ≠ אותה ישות משפטית', 'SAME BRAND ≠ SAME LEGAL ENTITY'), bi('אותה כתובת ≠ בעלות', 'SAME ADDRESS ≠ OWNERSHIP'),
  bi('דירקטור משותף ≠ תמיכה פיננסית', 'COMMON DIRECTOR ≠ FINANCIAL SUPPORT'), bi('חברה בת ≠ חברת הפרויקט', 'SUBSIDIARY ≠ PROJECT SPV'), bi('היעדר נתוני בעלות ציבוריים ≠ אין בעלים', 'NO PUBLIC OWNERSHIP DATA ≠ NO OWNER')];

function party(number, name, index) {
  const chk = UD.registryCheck(number, name, index, R.regKey);
  return { id: number ? 'co:' + number : 'name:' + (name || '?'), number: number || null, name: (chk.row && R.companyFacts(chk.row).name) || name || null, statedName: name || null, registryCheck: chk.state, company: chk.row ? R.companyFacts(chk.row) : null };
}
const stateOf = (a, b) => (a.registryCheck === 'REGISTRY_ROW_FOUND' && b.registryCheck === 'REGISTRY_ROW_FOUND' ? 'STRONG_MATCH' : (a.number && b.number) ? 'POSSIBLE_MATCH' : 'UNRESOLVED');

/** the structure around a set of companies (the developer's, the project company's) */
function structure({ companyNumbers = [], developerDD = null, userDocs = [], index = null } = {}) {
  const nums = [...new Set(companyNumbers.filter(Boolean).map(String))];
  const docs = UD.concerning(userDocs, { companyNumbers: nums });
  const nodes = new Map(), edges = [];
  const node = (p) => { if (!nodes.has(p.id)) nodes.set(p.id, p); return p.id; };
  for (const d of docs) {
    const doc = { id: d.id, type: d.type, typeLabel: d.typeLabel, date: d.docDate, provenance: d.provenance };
    if (d.type === 'ownership_chart') for (const r of d.fields.relations || []) {
      const a = party(r.parentNumber, r.parentName, index), b = party(r.childNumber, r.childName, index);
      edges.push({ type: 'HOLDS', from: node(a), to: node(b), sharePct: r.sharePct ?? null, state: stateOf(a, b), cls: 'USER_DOCUMENT', proves: bi(`לפי ${d.typeLabel.he} מ-${d.docDate}: ${a.name || a.number} מחזיקה ${r.sharePct != null ? r.sharePct + '% ב-' : 'ב-'}${b.name || b.number}`, `per the ${d.typeLabel.en.toLowerCase()} of ${d.docDate}: ${a.name || a.number} holds ${r.sharePct != null ? r.sharePct + '% of ' : ''}${b.name || b.number}`), source: 'user-document', document: doc, date: d.docDate, scope: bi('נכון למועד המסמך', 'as of the document date'), notProves: NOT_PROVES.HOLDS });
    }
    if (d.type === 'company_extract') { const c = party(d.fields.entityNumber, d.fields.entityName, index);
      for (const s of d.fields.shareholders || []) { const a = s.number ? party(s.number, s.name, index) : { id: 'person:' + s.name, number: null, name: s.name, statedName: s.name, registryCheck: 'NOT_A_COMPANY', company: null };
        edges.push({ type: 'SHAREHOLDER_OF', from: node(a), to: node(c), sharePct: s.sharePct ?? null, state: s.number ? stateOf(a, c) : (c.registryCheck === 'REGISTRY_ROW_FOUND' ? 'STRONG_MATCH' : 'POSSIBLE_MATCH'), cls: 'USER_DOCUMENT', proves: bi(`לפי נסח החברה מ-${d.docDate}: ${a.name} בעל ${s.sharePct != null ? s.sharePct + '% מ' : ''}מניות ${c.name || c.number}`, `per the company extract of ${d.docDate}: ${a.name} holds ${s.sharePct != null ? s.sharePct + '% of ' : ''}the shares of ${c.name || c.number}`), source: 'user-document', document: doc, date: d.docDate, scope: bi('נכון למועד הנסח', 'as of the extract date'), notProves: NOT_PROVES.SHAREHOLDER_OF }); } }
    if (d.type === 'developer_declaration' && d.fields.parentNumber && d.fields.projectCompanyNumber) { const a = party(d.fields.parentNumber, d.fields.parentName, index), b = party(d.fields.projectCompanyNumber, d.fields.projectCompanyName, index);
      edges.push({ type: 'HOLDS', from: node(a), to: node(b), sharePct: null, state: stateOf(a, b), cls: 'USER_DOCUMENT', proves: bi(`לפי הצהרת היזם מ-${d.docDate}: ${a.name || a.number} היא חברת האם של ${b.name || b.number}`, `per the developer's declaration of ${d.docDate}: ${a.name || a.number} is the parent of ${b.name || b.number}`), source: 'user-document', document: doc, date: d.docDate, scope: bi('נכון למועד ההצהרה', 'as of the declaration date'), notProves: NOT_PROVES.HOLDS });
      if (d.fields.guarantee === 'explicit-parent-guarantee') edges.push({ type: 'GUARANTEES', from: node(a), to: node(b), state: stateOf(a, b), cls: 'USER_DOCUMENT', proves: bi('ההצהרה מציינת ערבות חברת אם מפורשת', 'the declaration states an explicit parent guarantee'), source: 'user-document', document: doc, date: d.docDate, scope: bi('כפי שבהצהרה בלבד', 'only as the declaration states'), notProves: NOT_PROVES.GUARANTEES }); }
  }
  /* official, NOT ownership: the parties of a joint award */
  const res = developerDD && developerDD.identity && developerDD.identity.resolution;
  if (res && (res.parties || []).length > 1) { const ps = res.parties.map((x) => (x.chosen ? party(String(x.chosen.num), x.name, index) : { id: 'name:' + x.name, number: null, name: x.name, statedName: x.name, registryCheck: x.state, company: null }));
    for (let i = 1; i < ps.length; i++) edges.push({ type: 'CO_WINNER', from: node(ps[0]), to: node(ps[i]), state: R.weakest(res.parties.map((x) => x.state)), cls: 'OFFICIAL', proves: bi('שני הצדדים נקובים יחד כזוכים באותה מחרוזת זכייה של רמ״י', 'both parties are named together in one ILA winner string'), source: R.SRC.ila, date: null, scope: bi('הזכייה המסוימת בלבד', 'that award only'), notProves: NOT_PROVES.CO_WINNER }); }
  for (const n of nums) if (!nodes.has('co:' + n)) node(party(n, null, index));
  const ownershipEdges = edges.filter((e) => e.type === 'HOLDS' || e.type === 'SHAREHOLDER_OF');
  return { version: VERSION, nodes: [...nodes.values()], edges, rules: RULES,
    coverage: ownershipEdges.length ? 'USER_DOCUMENT' : 'NOT_IN_COVERAGE',
    statement: ownershipEdges.length ? bi('קשרי בעלות מתוך מסמכים שסיפק המשתמש — זהות הצדדים נבדקה מול הרשם; הקשר עצמו הוא טענת המסמך', 'ownership relations from documents the user provided — the parties\' identities checked against the registry; the relation itself is the document\'s claim')
      : bi('אין נתוני בעלות ציבוריים בכיסוי (נסח חברה הוא שירות בתשלום; אחזקות חברות ציבוריות במאיה / מגנא — חסומים). היעדר נתוני בעלות ≠ אין בעלים', 'no public ownership data in coverage (the company extract is a paid service; public-company holdings are in MAYA / MAGNA — blocked). NO PUBLIC OWNERSHIP DATA ≠ NO OWNER'),
    unlock: bi('נסח חברה עדכני, תרשים אחזקות, או הצהרת יזם', 'a current company extract, an ownership chart, or a developer declaration') };
}

module.exports = { VERSION, RULES, NOT_PROVES, structure };
