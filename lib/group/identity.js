// PROPX · SPONSOR X-RAY — the GROUP IDENTITY GRAPH, on top of the existing entity resolution (lib/entities/resolve.js, lib/dd).
//
// Who is in the group, and by what evidence — every node and every edge carries its match state, source, date, class, the reasons
// and what it does NOT prove. Membership rules (lib/group/model.js TIERS):
//   CORE        brands whose observed name resolves (VERIFIED / STRONG MATCH) to the core legal company — the same legal person
//   DOCUMENTED  companies a USER DOCUMENT relates to the core (holding chart, company extract, developer declaration) when BOTH parties
//               resolve in the registry by number (STRONG) — expanded through such edges only; the brands resolving to them follow
//   SHARED      joint awards where a group company is one named party (CO_WINNER) — never members, never in totals
//   POSSIBLE / AMBIGUOUS  candidates, same-letters names, documents' parties not found — listed with the evidence, never expanded
// Never a link from a shared brand, a shared address, a common director, a similar name, a shared contractor or a shared parcel.
'use strict';

const R = require('../entities/resolve');
const UD = require('../dd/userdocs');
const { bi, TIERS } = require('./model');

const OK = new Set(['VERIFIED', 'STRONG_MATCH']);
const NOT = {
  RESOLVES_TO: bi('השם שנצפה נפתר לחברה — הוא אינו החברה; אינו קובע בעלות, חברת אם או חברת פרויקט', 'the observed name resolves to the company — it is not the company; it establishes no ownership, parent or project company'),
  CANDIDATE: bi('מועמד בלבד — לא נבחר; אינו חבר בקבוצה', 'a candidate only — not chosen; not a group member'),
  POSSIBLY_SAME: bi('ייתכן שאותה ישות — לא מוזג; הספירות לעולם אינן מחוברות', 'possibly the same entity — not merged; counts are never combined'),
  HOLDS: bi('אחזקה ≠ ערבות ≠ תמיכה פיננסית ≠ אחריות לחובות; חברה בת ≠ חברת פרויקט', 'a holding ≠ a guarantee ≠ financial support ≠ liability for debts; a subsidiary ≠ a project SPV'),
  SHAREHOLDER_OF: bi('בעל מניות ≠ תמיכה בפרויקט ≠ ערב', 'a shareholder ≠ project support ≠ a guarantor'),
  GUARANTEES: bi('ערבות לפי מסמך — היקף, תוקף ותנאים כפי שבמסמך בלבד', 'a guarantee per a document — scope, validity and terms only as the document states'),
  JOINT_AWARD_PARTY: bi('זכייה משותפת ≠ קבוצה ≠ חברת אם ≠ ערבות; החלק בזכייה אינו מצוין', 'a joint award ≠ a group ≠ a parent ≠ a guarantee; the share of the award is not stated'),
  REGISTERED_AS_CONTRACTOR: bi('רישום כקבלן ≠ יזמות; אתרים כקבלן מבצע עשויים להיות של אחרים', 'a contractor registration ≠ development; sites as executor may belong to others'),
};

/* the relations user documents state, between company numbers (each party checked against the registry by number) */
function docEdges(docs, index) {
  const out = [];
  const party = (number, name) => { const chk = UD.registryCheck(number, name, index, R.regKey); return { number: number ? String(number) : null, name: (chk.row && R.companyFacts(chk.row).name) || name || null, statedName: name || null, check: chk.state, company: chk.row ? R.companyFacts(chk.row) : null }; };
  const state = (a, b) => (a.check === 'REGISTRY_ROW_FOUND' && b.check === 'REGISTRY_ROW_FOUND' ? 'STRONG_MATCH' : a.number && b.number ? 'POSSIBLE_MATCH' : 'UNRESOLVED');
  for (const d of docs) {
    const doc = { id: d.id, type: d.type, typeLabel: d.typeLabel, date: d.docDate, provenance: d.provenance };
    if (d.type === 'ownership_chart') for (const r of d.fields.relations || []) { if (!r.parentNumber || !r.childNumber || r.parentNumber === r.childNumber) continue; const a = party(r.parentNumber, r.parentName), b = party(r.childNumber, r.childName);
      out.push({ type: 'HOLDS', parent: a, child: b, sharePct: r.sharePct ?? null, state: state(a, b), doc, date: d.docDate }); }
    if (d.type === 'company_extract') { const c = party(d.fields.entityNumber, d.fields.entityName);
      for (const s of d.fields.shareholders || []) { if (!s.number || s.number === d.fields.entityNumber) continue; const a = party(s.number, s.name); out.push({ type: 'SHAREHOLDER_OF', parent: a, child: c, sharePct: s.sharePct ?? null, state: state(a, c), doc, date: d.docDate }); } }
    if (d.type === 'developer_declaration' && d.fields.parentNumber && d.fields.projectCompanyNumber && d.fields.parentNumber !== d.fields.projectCompanyNumber) { const a = party(d.fields.parentNumber, d.fields.parentName), b = party(d.fields.projectCompanyNumber, d.fields.projectCompanyName);
      out.push({ type: 'HOLDS', parent: a, child: b, sharePct: null, state: state(a, b), doc, date: d.docDate, projectId: d.fields.projectId || null, spv: true });
      if (d.fields.guarantee === 'explicit-parent-guarantee') out.push({ type: 'GUARANTEES', parent: a, child: b, state: state(a, b), doc, date: d.docDate, projectId: d.fields.projectId || null }); }
  }
  return out;
}

/**
 * membership(anchor, K, resMap, { companyNumber, confirmedCandidate, docs })
 *   anchor   { type: 'developer' | 'company' | 'project', id }
 *   K        lib/dd/index.js ctx()
 *   resMap   number → [{ id, name, state, basis, candidate?, party? }] (lib/dd/index.js resolutionsByNumber)
 */
function membership(anchor, K, resMap, { companyNumber = undefined, confirmedCandidate = false, docs = [], resByDev = null } = {}) {
  const L = K.L, idx = K.c.idx;
  const out = { anchor: { type: anchor.type, id: anchor.id, name: null }, status: null, core: null, brands: new Map(), companies: new Map(), nodes: new Map(), edges: [], excluded: [], shared: [], otherDevelopers: [], contractor: null, docEdges: [], notes: [] };
  const node = (id, n) => { if (!out.nodes.has(id)) out.nodes.set(id, { id, ...n }); return id; };
  const edge = (e) => { e.id = `${e.type}:${e.from}>${e.to}${e.doc ? ':' + e.doc.id : ''}`; if (!out.edges.some((x) => x.id === e.id)) out.edges.push(e); };
  const resOf = (dv) => (resByDev && resByDev.get(dv.id)) || R.resolveCompany({ id: dv.id, canonical: dv.canonical, kind: dv.kind, joint: dv.joint }, idx);
  const brandNode = (dv, tier) => node('brand:' + dv.id, { kind: 'DEVELOPER_BRAND', label: dv.name, devId: dv.id, tier, joint: !!dv.joint, lots: dv.tenders ? dv.tenders.lots : 0, lotteryProjects: dv.lotteries ? dv.lotteries.projects : 0 });
  const coNode = (facts, role, tier) => { const id = 'co:' + facts.number; const n = node(id, { kind: 'LEGAL_COMPANY', label: facts.name, number: facts.number, company: facts, role, tier }); const cur = out.nodes.get(id); if (role && !cur.roles) cur.roles = [cur.role]; if (role && !cur.roles.includes(role)) cur.roles.push(role); return n; };

  /* 1 · the anchor */
  let anchorDev = null, res = null, N = null;
  if (anchor.type === 'project') {
    const p = L.projById.get(String(anchor.id)); if (!p) return null;
    const ids = (p.developerIds && p.developerIds.length ? p.developerIds : [p.developerId]).filter(Boolean);
    anchorDev = ids.length ? L.devById.get(ids[0]) : null;
    out.anchor.name = p.kind === 'ila-awarded-lot' ? [p.tender, p.lotId].filter(Boolean).join(' · ') : p.name || String(p.projectId);
    out.anchor.project = { id: p.id, kind: p.kind };
    out.otherDevelopers = ids.slice(1).map((x) => L.devById.get(x)).filter(Boolean).map((d) => ({ id: d.id, name: d.name, note: bi('יזם נוסף ברשומת הפרויקט — לקבוצה שלו יש קריאה משלה', 'another developer on the project record — its group has its own read') }));
    if (!anchorDev) { out.status = 'BRAND_ONLY'; out.notes.push(bi('לרשומת הפרויקט אין יזם רשום — אין קבוצה לקרוא', 'the project record names no listed developer — no group to read')); return finish(out); }
  } else if (anchor.type === 'developer') {
    anchorDev = L.devById.get(String(anchor.id)); if (!anchorDev) return null;
  } else {
    N = String(anchor.id || '').trim(); if (!/^\d{8,9}$/.test(N)) return null;
    const row = idx.companies.byNumber.get(N) || idx.partnerships.byNumber.get(N);
    out.anchor.name = row ? R.companyFacts(row).name : N;
    if (!row) { out.status = 'NOT_IN_COVERAGE'; out.core = { number: N, company: null, state: null }; return finish(out); }
  }
  if (anchorDev) {
    out.anchor.name = out.anchor.name || anchorDev.name; out.anchor.devId = anchorDev.id;
    res = anchor.type === 'developer' && companyNumber !== undefined ? R.resolveCompany({ id: anchorDev.id, canonical: anchorDev.canonical, kind: anchorDev.kind, joint: anchorDev.joint }, idx, { companyNumber, confirmedCandidate }) : resOf(anchorDev);
    out.anchor.resolution = { state: res.state, basis: res.basis || null, userProvided: !!res.userProvided, reasons: res.reasons || [] };
    out.anchorRes = res;   /* internal: the rows of the anchor brand read with the same resolution (a user-provided key included) */
    if (OK.has(res.state) && res.chosen) N = String(res.chosen.num);
  }

  /* 2 · the core */
  if (N) {
    const row = idx.companies.byNumber.get(N) || idx.partnerships.byNumber.get(N);
    const facts = R.companyFacts(row);
    const coreState = anchorDev ? res.state : 'VERIFIED';
    out.core = { number: N, company: facts, state: coreState, basis: anchorDev ? res.basis : 'exact-key', reasons: anchorDev ? res.reasons : [R.reason('REGISTRY_ROW_FOUND')], userProvided: !!(res && res.userProvided) };
    out.status = coreState === 'VERIFIED' ? 'LEGAL_CORE_VERIFIED' : 'LEGAL_CORE_STRONG';
    coNode(facts, 'CORE', 'CORE');
    out.companies.set(N, { number: N, company: facts, tier: 'CORE', role: 'CORE', state: coreState, path: [] });
    const entries = (resMap.get(N) || []).slice();   /* the memoised list is never mutated */
    if (anchorDev && !entries.some((x) => x.id === anchorDev.id && !x.candidate && !x.party)) entries.unshift({ id: anchorDev.id, name: anchorDev.name, state: res.state, basis: res.basis, userProvided: !!res.userProvided });
    for (const x of entries) {
      const dv = L.devById.get(x.id); if (!dv) continue;
      const isAnchor = !!(anchorDev && x.id === anchorDev.id && !x.candidate && !x.party);
      const st = isAnchor ? res.state : x.state, userProvided = isAnchor ? !!res.userProvided : !!x.userProvided;
      if (x.party) {
        /* a joint award string naming the group company as one party → SHARED (never a member) */
        const tier = OK.has(st) ? 'SHARED' : 'POSSIBLE';
        brandNode(dv, tier);
        edge({ type: 'JOINT_AWARD_PARTY', from: 'co:' + N, to: 'brand:' + dv.id, state: st, cls: 'OFFICIAL', source: R.SRC.ila, date: dv.lastActivity || null, reasons: [R.reason('JOINT_WINNER_STRING'), R.reason('JOINT_PARTIES_RESOLVED_SEPARATELY')], why: bi(`החברה היא אחד הצדדים הנקובים במחרוזת הזכייה המשותפת "${dv.name}"`, `the company is one of the parties named in the joint winner string "${dv.name}"`), notProves: NOT.JOINT_AWARD_PARTY, limitations: [bi('החלק של כל צד אינו מצוין במקור', 'each party\'s share is not stated by the source')] });
        const jr = resOf(dv);
        for (const pt of jr.parties || []) { if (!pt.chosen || String(pt.chosen.num) === N) continue; const f = R.companyFacts(pt.chosen); coNode(f, 'CO_WINNER_PARTY', 'SHARED'); edge({ type: 'JOINT_AWARD_PARTY', from: 'co:' + f.number, to: 'brand:' + dv.id, state: pt.state, cls: 'OFFICIAL', source: R.SRC.ila, date: null, reasons: [R.reason('JOINT_PARTIES_RESOLVED_SEPARATELY')], why: bi(`צד נוסף במחרוזת הזכייה המשותפת "${dv.name}"`, `another party of the joint winner string "${dv.name}"`), notProves: NOT.JOINT_AWARD_PARTY, limitations: [] }); }
        (tier === 'SHARED' ? out.shared : out.excluded).push({ devId: dv.id, name: dv.name, tier, state: st, relation: 'JOINT_AWARD_PARTY', parties: (jr.parties || []).map((pt) => ({ name: pt.name, state: pt.state, number: pt.chosen ? String(pt.chosen.num) : null })) });
        if (tier === 'SHARED') out.brands.set(dv.id, { dev: dv, tier: 'SHARED', state: st, via: 'joint-award', companyNumber: N });
        continue;
      }
      if (x.candidate) {
        const tier = st === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'POSSIBLE';
        brandNode(dv, tier);
        edge({ type: 'CANDIDATE_OF', from: 'brand:' + dv.id, to: 'co:' + N, state: st, cls: 'DERIVED', source: R.SRC.ica, date: null, reasons: resOf(dv).reasons || [], why: bi('החברה היא מועמד לזהות המשפטית של המותג — לא נבחרה', 'the company is a candidate for the brand\'s legal identity — not chosen'), notProves: NOT.CANDIDATE, limitations: [] });
        out.excluded.push({ devId: dv.id, name: dv.name, tier, state: st, relation: 'CANDIDATE_OF', basis: x.basis || null });
        continue;
      }
      if (!OK.has(st)) continue;
      brandNode(dv, 'CORE');
      edge({ type: 'RESOLVES_TO', from: 'brand:' + dv.id, to: 'co:' + N, state: st, cls: st === 'VERIFIED' && userProvided ? 'USER_ASSUMPTION' : st === 'VERIFIED' ? 'OFFICIAL' : 'DERIVED', source: R.SRC.ica, date: idx.fetchedAt || null, reasons: (isAnchor ? res.reasons : resOf(dv).reasons) || [], why: st === 'VERIFIED' ? bi('מספר חברה רשמי (ממקור / מהמשתמש) תואם לרשומת הרשם', 'an official company number (a source\'s / the user\'s) matches the registry row') : bi('השם הרשום הזהה לאחר נרמול טיפוגרפי, ורשומה אחת בלבד ברשם', 'the identical registered name after typographic normalization, and exactly one registry row'), notProves: NOT.RESOLVES_TO, limitations: [bi('שם בלבד לעולם אינו "מאומת"', 'a name alone is never VERIFIED')] });
      out.brands.set(dv.id, { dev: dv, tier: 'CORE', state: st, via: 'same-legal-company', companyNumber: N, userProvided });
    }
    /* the core company as a registered contractor (an exact number) — CONTEXT, a different universe from development */
    const kab = K.c.cidx && K.c.cidx.byCompany ? K.c.cidx.byCompany.get(N) || [] : [];
    if (kab.length) {
      const kablans = [...new Set(kab.map((r) => String(r.kablan)))];
      const sites = kablans.flatMap((k) => K.c.sitesByExecutor.get(k) || []);
      out.contractor = { kablan: kablans, branches: kab.length, activeSitesAsExecutor: sites.length, residentialSites: sites.filter((s) => /מגורים/.test(s.buildTypes || '')).length, cities: [...new Set(sites.map((s) => s.city).filter(Boolean))].length, source: R.SRC.contractors, sitesSource: R.SRC.sites, note: bi('אתרים שבהם החברה רשומה כקבלן מבצע — ביצוע ≠ ייזום; עשויים להיות פרויקטים של אחרים, ואינם נספרים בתיק הקבוצה', 'sites where the company is the registered executing contractor — execution ≠ development; they may be other parties\' projects and are not counted in the group\'s portfolio') };
      for (const k of kablans) { node('kablan:' + k, { kind: 'CONTRACTOR', label: (kab.find((r) => String(r.kablan) === k) || {}).name || k, kablan: k, tier: 'CONTEXT' }); edge({ type: 'REGISTERED_AS_CONTRACTOR', from: 'co:' + N, to: 'kablan:' + k, state: 'VERIFIED', cls: 'OFFICIAL', source: R.SRC.contractors, date: K.c.cidx.fetchedAt || null, reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')], why: bi('מספר הישות בפנקס הקבלנים = מספר החברה', 'the entity number in the contractors register = the company number'), notProves: NOT.REGISTERED_AS_CONTRACTOR, limitations: [] }); }
    }
  } else if (anchorDev) {
    /* no legal core: the brand alone (its candidates listed, never chosen); a joint string names its parties, each with its own group */
    out.status = 'BRAND_ONLY';
    brandNode(anchorDev, 'CORE');
    out.brands.set(anchorDev.id, { dev: anchorDev, tier: 'CORE', state: res.state, via: 'brand-only', companyNumber: null });
    for (const cand of res.candidates || []) { const f = R.companyFacts(cand); coNode(f, 'CANDIDATE', res.state === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'POSSIBLE'); edge({ type: 'CANDIDATE_OF', from: 'brand:' + anchorDev.id, to: 'co:' + f.number, state: res.state, cls: 'DERIVED', source: R.SRC.ica, date: null, reasons: res.reasons || [], why: bi('מועמד לזהות המשפטית של המותג — לא נבחר', 'a candidate for the brand\'s legal identity — not chosen'), notProves: NOT.CANDIDATE, limitations: [] }); out.excluded.push({ number: f.number, name: f.name, tier: res.state === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'POSSIBLE', state: res.state, relation: 'CANDIDATE_OF' }); }
    for (const pt of res.parties || []) { if (!pt.chosen) { out.notes.push(bi(`צד "${pt.name}" — לא נפתר (${pt.state})`, `party "${pt.name}" — not resolved (${pt.state})`)); continue; } const f = R.companyFacts(pt.chosen); coNode(f, 'JOINT_PARTY', 'SHARED'); edge({ type: 'JOINT_AWARD_PARTY', from: 'co:' + f.number, to: 'brand:' + anchorDev.id, state: pt.state, cls: 'OFFICIAL', source: R.SRC.ila, date: null, reasons: [R.reason('JOINT_PARTIES_RESOLVED_SEPARATELY')], why: bi('צד הנקוב במחרוזת הזכייה המשותפת', 'a party named in the joint winner string'), notProves: NOT.JOINT_AWARD_PARTY, limitations: [] }); out.shared.push({ number: f.number, name: f.name, tier: 'SHARED', state: pt.state, relation: 'JOINT_PARTY', note: bi('לצד זה קריאת קבוצה משלו', 'this party has its own group read') }); }
  }

  /* 3 · same-letters / cut-prefix brands of the core brands (the registry's own POSSIBLY_SAME links) — never merged */
  for (const [id, b] of [...out.brands]) {
    if (b.tier !== 'CORE') continue;
    for (const ps of b.dev.possibleSame || []) {
      if (out.brands.has(ps.id) && out.brands.get(ps.id).tier === 'CORE') continue;
      const dv = L.devById.get(ps.id); if (!dv) continue;
      brandNode(dv, 'POSSIBLE');
      edge({ type: 'POSSIBLY_SAME', from: 'brand:' + id, to: 'brand:' + ps.id, state: 'POSSIBLE_MATCH', cls: 'DERIVED', source: 'lib/entities', date: null, reasons: [{ code: String(ps.evidence || '').toUpperCase().replace(/-/g, '_'), he: ps.evidence === 'same-letters' ? 'אותן אותיות באותו סדר' : 'קידומת שנחתכה במקור', en: ps.evidence === 'same-letters' ? 'the same letters in the same order' : 'a prefix the source cut' }], why: bi('קשר "ייתכן שאותה ישות" של רישום PROPX', 'the PROPX registry\'s "possibly the same entity" link'), notProves: NOT.POSSIBLY_SAME, limitations: [] });
      if (!out.excluded.some((x) => x.devId === ps.id)) out.excluded.push({ devId: ps.id, name: dv.name, tier: 'POSSIBLE', state: 'POSSIBLE_MATCH', relation: 'POSSIBLY_SAME', basis: ps.evidence });
    }
  }

  /* 4 · DOCUMENTED companies — expanded only through STRONG document edges (both parties found by number) */
  const DE = docEdges(docs, idx); out.docEdges = DE;
  if (N) {
    const seen = new Set([N]); const queue = [{ num: N, depth: 0, path: [] }];
    while (queue.length) {
      const { num, depth, path } = queue.shift(); if (depth >= 4 || seen.size >= 40) continue;
      for (const e of DE) {
        const a = e.parent.number, b = e.child.number; if (a !== num && b !== num) continue;
        const other = a === num ? b : a, dir = a === num ? 'down' : 'up';
        if (e.state !== 'STRONG_MATCH') continue;
        if (seen.has(other)) continue; seen.add(other);
        const p2 = path.concat([{ dir, type: e.type, doc: e.doc, state: e.state, spv: !!e.spv }]);
        const f = (a === num ? e.child : e.parent).company;
        const role = p2.every((s) => s.dir === 'down') ? (p2[p2.length - 1].spv ? 'PROJECT_SPV' : 'SUBSIDIARY') : p2.every((s) => s.dir === 'up') ? 'PARENT' : 'AFFILIATE';
        coNode(f, role, 'DOCUMENTED');
        out.companies.set(other, { number: other, company: f, tier: 'DOCUMENTED', role, state: R.weakest(p2.map((s) => s.state)), path: p2.map((s) => ({ dir: s.dir, type: s.type, doc: { id: s.doc.id, type: s.doc.type, date: s.doc.date } })) });
        queue.push({ num: other, depth: depth + 1, path: p2 });
        for (const x of resMap.get(other) || []) {
          if (x.candidate || x.party || !OK.has(x.state) || out.brands.has(x.id)) continue;
          const dv = L.devById.get(x.id); if (!dv) continue;
          brandNode(dv, 'DOCUMENTED');
          edge({ type: 'RESOLVES_TO', from: 'brand:' + dv.id, to: 'co:' + other, state: x.state, cls: 'DERIVED', source: R.SRC.ica, date: idx.fetchedAt || null, reasons: resOf(dv).reasons || [], why: bi('השם הרשום הזהה, רשומה אחת ברשם', 'the identical registered name, one registry row'), notProves: NOT.RESOLVES_TO, limitations: [] });
          out.brands.set(dv.id, { dev: dv, tier: 'DOCUMENTED', state: R.weakest([x.state, ...p2.map((s) => s.state)]), via: 'documented-company', companyNumber: other, role });
        }
      }
    }
  }
  for (const e of DE) {
    const touches = out.companies.has(e.parent.number || '') || out.companies.has(e.child.number || '');
    if (!touches) continue;
    const from = e.parent.number ? 'co:' + e.parent.number : 'name:' + e.parent.statedName, to = e.child.number ? 'co:' + e.child.number : 'name:' + e.child.statedName;
    for (const [pid, P] of [[from, e.parent], [to, e.child]]) if (!out.nodes.has(pid)) { if (P.company) coNode(P.company, e.state === 'STRONG_MATCH' ? 'DOCUMENTED' : 'DOCUMENT_PARTY', e.state === 'STRONG_MATCH' ? 'DOCUMENTED' : 'POSSIBLE'); else node(pid, { kind: 'NAMED_PARTY', label: P.statedName || P.number, number: P.number, tier: 'POSSIBLE', check: P.check }); }
    edge({ type: e.type, from, to, state: e.state, cls: 'USER_DOCUMENT', source: 'user-document', date: e.date, doc: e.doc, sharePct: e.sharePct ?? null, reasons: [{ code: 'REGISTRY_CHECK_' + e.parent.check + '_' + e.child.check, he: `בדיקת רשם: ${e.parent.check} / ${e.child.check}`, en: `registry check: ${e.parent.check} / ${e.child.check}` }],
      why: bi(`לפי ${e.doc.typeLabel ? e.doc.typeLabel.he : 'מסמך'} מ-${e.date || '—'}`, `per the ${e.doc.typeLabel ? e.doc.typeLabel.en.toLowerCase() : 'document'} of ${e.date || '—'}`), notProves: NOT[e.type] || NOT.HOLDS, limitations: [bi('טענת המסמך — PROPX לא אימתה את המסמך עצמו', 'the document\'s claim — PROPX did not authenticate the document')] });
    if (e.state !== 'STRONG_MATCH') out.excluded.push({ number: e.parent.number === (out.core && out.core.number) ? e.child.number : e.parent.number, name: e.parent.number === (out.core && out.core.number) ? e.child.statedName : e.parent.statedName, tier: 'POSSIBLE', state: e.state, relation: e.type, note: bi('צד במסמך שלא נמצא ברשם לפי מספר, או ששמו שונה — לא הורחב', 'a document party not found in the registry by number, or whose name differs — not expanded') });
  }
  return finish(out);
}

function finish(out) {
  const members = [...out.brands.values()];
  /* the core's status is as strong as its WEAKEST brand link: one VERIFIED spelling does not make the others verified */
  if (out.core && out.core.company && out.status !== 'NOT_IN_COVERAGE' && out.status !== 'BRAND_ONLY') {
    const core = members.filter((b) => b.tier === 'CORE');
    out.status = !core.length ? 'COMPANY_ONLY' : core.every((b) => b.state === 'VERIFIED') ? 'LEGAL_CORE_VERIFIED' : 'LEGAL_CORE_STRONG';
    out.core.linkState = core.length ? R.weakest(core.map((b) => b.state)) : null;
  }
  out.structure = out.edges.some((e) => (e.type === 'HOLDS' || e.type === 'SHAREHOLDER_OF') && e.state === 'STRONG_MATCH') ? 'DOCUMENTED' : 'NOT_IN_COVERAGE';
  out.tiers = Object.fromEntries(Object.keys(TIERS).map((t) => [t, { brands: members.filter((b) => b.tier === t).length, companies: [...out.companies.values()].filter((c) => c.tier === t).length }]));
  return out;
}

module.exports = { membership, docEdges, NOT };
