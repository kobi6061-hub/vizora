// PROPX · DUE-DILIGENCE EVIDENCE GRAPH (18.10.2026) — the per-entity evidence graph behind one due-diligence read: every
// node an entity of the canonical model (lib/entities/resolve.js ENTITY_MODEL), every edge an evidence link that carries
//   { type, from, to, source, sourceId, dates: { source, observed }, cls, matchState, reasons[], limitations[] }.
// Composed only from the DD read models (lib/dd/developer.js, lib/dd/project.js) — it creates no fact and joins nothing
// they did not join. A POSSIBLE / AMBIGUOUS link is an edge with that state (never promoted); PRIOR ACTIVITY on a parcel is
// an edge of its own type (PARCEL_HISTORY), never a project edge.
'use strict';

const R = require('../entities/resolve');
const bi = (he, en) => ({ he, en });
const EDGE_TYPES = Object.freeze({
  RESOLVED_TO: bi('נפתר לחברה רשומה', 'resolved to legal company'),
  CANDIDATE_OF: bi('מועמד (לא נבחר)', 'candidate (not chosen)'),
  PARTY_OF: bi('צד במחרוזת זוכה משותפת', 'party of a joint winner string'),
  POSSIBLY_SAME: bi('ייתכן שאותה ישות (לא מוזג)', 'possibly the same entity (not merged)'),
  REGISTERED_AS: bi('רשום כקבלן', 'registered as contractor'),
  EXECUTES: bi('מבצע באתר', 'executes site'),
  SUBJECT_OF: bi('נושא של תיק / רישום', 'subject of a case / listing'),
  HAS_FILINGS: bi('אירועי רישום (שעבודים, דוחות)', 'filing events (charges, reports)'),
  HAS_WINNER: bi('זוכה', 'has winner'),
  DEVELOPED_BY: bi('יזם (משב״ש)', 'developer (MoCH)'),
  CONTAINS: bi('מכיל', 'contains'),
  REFERENCES: bi('מפנה לתכנית', 'references plan'),
  ON_PARCEL: bi('על גוש/חלקה', 'on parcel'),
  LINKED_SITE: bi('אתר מקושר לפרויקט', 'site linked to the project'),
  SITE_ON_PARCEL: bi('אתר על החלקה', 'site on parcel'),
  PARCEL_HISTORY: bi('פעילות קודמת על החלקה (לא הפרויקט)', 'prior activity on the parcel (not the project)'),
  HAS_PERMIT: bi('היתר באתר', 'permit on site'),
  EXECUTED_BY: bi('מבוצע על ידי', 'executed by'),
  IN_LOCALITY: bi('ביישוב', 'in locality'),
});

function graph({ developer = null, project = null } = {}) {
  const N = new Map(), E = [];
  const node = (id, type, label, extra = {}) => { if (!id) return null; if (!N.has(id)) N.set(id, { id, type, label, ...extra }); return id; };
  const edge = (type, from, to, o = {}) => { if (!from || !to) return; E.push({ type, label: EDGE_TYPES[type] || bi(type, type), from, to, source: o.source || null, sourceId: o.sourceId || null, dates: o.dates || {}, cls: o.cls || 'OFFICIAL', matchState: o.matchState || null, reasons: o.reasons || [], limitations: o.limitations || [] }); };
  const coNode = (f) => node(f.id, 'LEGAL_COMPANY', bi(f.name, f.name), { number: f.number, status: f.status && f.status.verbatim, type: f.type });
  if (developer) {
    const D = developer, r = D.identity.resolution;
    const dev = node(D.generatedFor, 'DEVELOPER_BRAND', bi(D.identity.observedName, D.identity.observedName), { kind: D.identity.kind });
    if (r.chosen) edge('RESOLVED_TO', dev, coNode(r.chosen), { source: r.source, sourceId: r.chosen.id, dates: { observed: r.checkedAt, source: r.sourceModified }, cls: r.userProvided ? 'USER_ASSUMPTION' : 'OFFICIAL', matchState: r.state, reasons: r.reasons, limitations: r.limitations || [] });
    else for (const c of r.candidates || []) edge('CANDIDATE_OF', dev, coNode(c), { source: r.source, sourceId: c.id, dates: { observed: r.checkedAt }, cls: 'DERIVED', matchState: r.state, reasons: r.reasons });
    for (const pt of r.parties || []) { const pid = node('party:' + R.regKey(pt.name), 'LAND_WINNER', bi(pt.name, pt.name)); edge('PARTY_OF', pid, dev, { source: 'rmi:michrazim', cls: 'OFFICIAL', matchState: 'VERIFIED', reasons: [R.reason('JOINT_PARTIES_RESOLVED_SEPARATELY')] }); if (pt.chosen) edge('RESOLVED_TO', pid, coNode(R.companyFacts(pt.chosen)), { source: r.source, sourceId: 'co:' + pt.chosen.num, cls: 'OFFICIAL', matchState: pt.state, reasons: pt.reasons }); }
    for (const x of D.identity.possibleSame || []) edge('POSSIBLY_SAME', dev, node(x.id, 'DEVELOPER_BRAND', bi(x.name, x.name)), { source: 'lib/entities', cls: 'DERIVED', matchState: 'POSSIBLE_MATCH', reasons: [{ code: x.evidence, ...x.note }] });
    const co = D.corporate;
    if (co.state === 'RESOLVED') {
      const cid = co.company.id;
      if (co.filings.total) edge('HAS_FILINGS', cid, node(cid + ':filings', 'FILINGS', bi(`${co.filings.total} אירועי רישום`, `${co.filings.total} filing events`), { counts: co.filings.counts, window: co.filings.window }), { source: 'datagov:ica:changes', sourceId: cid, dates: { observed: co.filings.checkedAt, source: co.filings.window ? co.filings.window.to : null }, matchState: 'VERIFIED', reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')], limitations: [bi('שעבוד = בטוחה, לא מצוקה; חלון מתגלגל', 'a charge = collateral, not distress; a rolling window')] });
      for (const c of co.insolvency.liquidationCases) edge('SUBJECT_OF', cid, node('liq:' + c.caseId, 'LIQUIDATION_CASE', bi(`תיק פירוק ${c.caseId} (${c.status || '—'})`, `liquidation case ${c.caseId} (${c.status || '—'})`), { open: c.open }), { source: 'datagov:moj:official-receiver:liquidation', sourceId: String(c.caseId), dates: { source: c.requested || c.orderDate }, matchState: 'VERIFIED', reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')] });
      for (const v of co.insolvency.voluntary) edge('SUBJECT_OF', cid, node(cid + ':voluntary', 'VOLUNTARY_LIQUIDATION', bi('פירוק מרצון מזורז', 'fast-track voluntary liquidation')), { source: 'datagov:ica:voluntary-liquidation-fast-track', sourceId: cid, dates: { source: v.approved }, matchState: 'VERIFIED', reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')], limitations: [bi('פירוק מרצון ≠ חדלות פירעון', 'voluntary liquidation ≠ insolvency')] });
    }
    const K = D.contractor;
    if (K.state === 'REGISTERED') {
      const owner = co.state === 'RESOLVED' && K.via && K.via.basis === 'company-number' ? co.company.id : dev;
      for (const k of K.kablan) {
        const kid = node('kablan:' + k, 'CONTRACTOR', bi(`קבלן ${k}`, `contractor ${k}`), { branches: K.branches.filter((b) => b.kablan === k).length });
        edge('REGISTERED_AS', owner, kid, { source: 'datagov:moch:contractors-register', sourceId: String(k), dates: { observed: K.checkedAt, source: K.sourceModified }, matchState: K.via ? K.via.state : null, reasons: K.via ? K.via.reasons : [] });
      }
      for (const s of K.sites.list) edge('EXECUTES', 'kablan:' + K.kablan[0], node(s.id, 'BUILDING_SITE', bi(s.name || s.id, s.name || s.id), { city: s.city }), { source: 'datagov:labor:active-construction-sites', sourceId: s.id, dates: { observed: s.lastSeen, firstSeen: s.firstSeen }, matchState: 'VERIFIED', reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')], limitations: [bi('אתר פעיל ≠ יח״ד שהושלמו', 'an active site ≠ completed units')] });
    }
  }
  if (project) {
    const P = project, pid = node(P.generatedFor, P.kind === 'ila-awarded-lot' ? 'LOT' : 'PROJECT', bi(P.generatedFor, P.generatedFor), { kind: P.kind });
    for (const l of P.identity.links) {
      if (!l.id || l.id === P.generatedFor) continue;
      const tmap = { TENDER: 'CONTAINS', PLAN: 'REFERENCES', BLOCK_PARCEL: 'ON_PARCEL', LAND_WINNER: 'HAS_WINNER', PROJECT_OWNER: 'DEVELOPED_BY', LOCALITY: 'IN_LOCALITY' };
      const t = tmap[l.type]; if (!t) continue;
      const nid = node(l.id, l.type, bi(l.id, l.id));
      if (t === 'CONTAINS') edge(t, nid, pid, { source: l.source, sourceId: l.id, matchState: l.state, reasons: l.reasons }); else edge(t, pid, nid, { source: l.source, sourceId: l.id, matchState: l.state, reasons: l.reasons });
    }
    for (const s of P.sites.tlv) { const sid = node(s.id, 'BUILDING_SITE', bi(s.address || s.id, s.address || s.id), { coverage: 'TEL AVIV MUNICIPAL' }); edge('SITE_ON_PARCEL', sid, node(s.parcel, 'BLOCK_PARCEL', bi(s.parcel, s.parcel)), { source: s.source, sourceId: s.id, dates: { source: s.start || s.supervisionDate }, matchState: 'VERIFIED', reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')] }); edge('LINKED_SITE', pid, sid, { source: s.source, sourceId: s.id, dates: { source: s.start }, matchState: s.matchState, reasons: s.reasons, limitations: [bi('התאמת חלקה ≠ אותו פרויקט ללא מפתח שני', 'a parcel match ≠ the same project without a second key')] }); }
    for (const pr of P.permits) edge('HAS_PERMIT', pr.viaSite, node(pr.id, 'PERMIT_RECORD', bi(`היתר ${pr.request}`, `permit ${pr.request}`), { stage: pr.stage }), { source: pr.source, sourceId: String(pr.request), dates: { source: pr.permitDate || pr.opened }, matchState: pr.matchState, reasons: pr.reasons, limitations: [bi('היתר ≠ תחילת בנייה ≠ גמר', 'permit ≠ construction start ≠ completion')] });
    for (const h of P.sites.parcelHistory) edge('PARCEL_HISTORY', node(h.parcel, 'BLOCK_PARCEL', bi(h.parcel, h.parcel)), node(h.id, h.id.startsWith('permit') ? 'PERMIT_RECORD' : 'BUILDING_SITE', bi(h.id, h.id)), { source: h.source, sourceId: h.id, dates: { source: h.latestActivity }, cls: 'OFFICIAL', matchState: null, reasons: h.reasons, limitations: [bi('פעילות לפני הזכייה — אינה ראיה לפרויקט', 'activity before the award — not evidence of the project')] });
    for (const s of P.sites.labour) { const sid = node(s.id, 'BUILDING_SITE', bi(s.name || s.id, s.name || s.id), { city: s.city }); edge('LINKED_SITE', pid, sid, { source: s.source, sourceId: s.id, dates: { observed: s.lastSeen, firstSeen: s.firstSeen }, cls: 'OFFICIAL', matchState: s.matchState, reasons: s.reasons, limitations: [bi('מפתח שנקרא מטקסט חופשי', 'a key read from free text')] });
      if (s.executor.kablan) { const kid = node('kablan:' + s.executor.kablan, 'CONTRACTOR', bi(s.executor.name || s.executor.kablan, s.executor.name || s.executor.kablan)); edge('EXECUTED_BY', sid, kid, { source: 'datagov:labor:active-construction-sites', sourceId: String(s.executor.id), matchState: s.executor.resolution, reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')] }); if (s.executor.company) edge('REGISTERED_AS', coNode(s.executor.company), kid, { source: 'datagov:moch:contractors-register', sourceId: s.executor.company.number, matchState: s.executor.companyState, reasons: [R.reason('COMPANY_NUMBER_FROM_SOURCE')] }); } }
  }
  const counts = {}; for (const e of E) counts[e.matchState || 'n/a'] = (counts[e.matchState || 'n/a'] || 0) + 1;
  return { nodes: [...N.values()], edges: E, counts, edgeTypes: EDGE_TYPES, basis: bi('כל קשת נושאת סוג · מקור · מזהה מקור · תאריכים · סיווג · מצב התאמה · סיבות · מגבלות; קשת אפשרית / רב-משמעית לעולם אינה מקודמת', 'every edge carries type · source · source id · dates · class · match state · reasons · limitations; a possible / ambiguous edge is never promoted') };
}

module.exports = { graph, EDGE_TYPES };
