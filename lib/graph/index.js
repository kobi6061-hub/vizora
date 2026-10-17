// PROPX · KNOWLEDGE GRAPH — a canonical, deterministic graph VIEW over the read models PROPX already holds.
//
// Nothing here is a new fact. The graph exposes the entities PROPX already stores and the relationships the stored
// records carry by an EXACT official key: every edge names the key it rests on, the value of that key and the source
// that delivered it. What no record carries is not an edge — it is counted (unmatched) or listed (conflicts).
//
//   ENTITY_TYPES  country · district · locality · developer · project (MoCH) · site (ILA lot) · tender · plan · parcel ·
//                 renewal_complex · rental_project · source
//   RELATIONS     each with the (from, to) pairs it links and the evidence key per pair
//   node(id)      the entity, slim · edges(id, {relation, limit}) the evidenced edges touching it (direction in/out) ·
//   neighbours(id, {relation, limit}) · degree(id, {relation}) · stats() counts, join coverage, unmatched, conflicts, basis
//
// Ids are the ones the read models already use: il · d-<district> (lib/dossier/query.js) · loc:<code> (geo registry) ·
// dev-<hash> (entities registry) · moch:<ProjectID> · ila:<MichrazID>:<lot file id> · rmi:<MichrazID> · plan:<plan key> ·
// parcel:<block>/<parcel> · renewal:<complex number> · rental:<MichrazID> · source:<trust id>.
//
// What is NEVER an edge: a name match of any kind (developers are linked only by the registry's own id on the record;
// two developers that may be one entity are flagged POSSIBLY_SAME — the registry's link — and never merged), geometry
// or distance, an ambiguous XPlan join (two keys naming different plans), a district figure on a locality, a join
// across sources that share no key (a MoCH lottery project is never attached to an ILA lot).
//
// The graph is memoised per data stamp (the entities, land, renewal and rental caches' stamps + the geo registry's
// mtime). Building is one linear pass over the stored records; node() and edges() are O(1) / O(degree) lookups.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const EQ = require('../entities/query');
const LQ = require('../land/query');
const RN = require('../renewal/query');
const RQ = require('../rental/query');
const { DISTRICTS } = require('../dossier/query');
const { canonicalName, kindOf, LISTED_KINDS } = require('../entities/names');
const { RELATION: LINEAGE } = require('../land/lineage');
const LAND_SOURCES = require('../land/sources').byId;
const RENEWAL_SOURCE = require('../renewal/source').SOURCE;
const XPLAN_RENEWAL_SOURCE = require('../renewal/planning').SOURCE;
const DIRA_SOURCE = require('../rental/dira').SOURCE;

const GEO_FILE = process.env.GEO_LOCALITIES_FILE || path.join(__dirname, '..', '..', 'data', 'geo', 'localities.json');
const bi = (he, en) => ({ he, en });
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const planKey = (p) => String(p == null ? '' : p).replace(/\s+/g, '').trim();
const ratio = (num, den) => (den ? Math.round((num / den) * 10000) / 10000 : null);

const BASIS = bi(
  'קריאה על רשומות שמורות בלבד: כל קשת נושאת את המפתח המדויק שעליו היא נשענת, את ערכו ואת המקור שסיפק אותו; דבר אינו מוסק — לא לפי שם, לא לפי גאומטריה, לא מצירוף דו-משמעי.',
  'a read over stored records; every edge carries the exact key it rests on, its value and the source that delivered it; nothing is inferred — not by name, not by geometry, not from an ambiguous join.');

/* ------------------------------------------------------------ the vocabulary */
const ENTITY_TYPES = Object.freeze({
  country: { id: 'country', label: bi('מדינה', 'country'), ids: 'il', from: 'lib/dossier/query.js' },
  district: { id: 'district', label: bi('מחוז', 'district'), ids: 'd-<district> · js-area (the CBS districts)', from: 'lib/dossier/query.js DISTRICTS' },
  locality: { id: 'locality', label: bi('יישוב', 'locality'), ids: 'loc:<CBS locality code>', from: 'data/geo/localities.json' },
  developer: { id: 'developer', label: bi('יזם', 'developer'), ids: 'dev-<sha1 of the canonical name>', from: 'lib/entities/registry.js (one canonical legal name; typographic variants only)' },
  project: { id: 'project', label: bi('פרויקט הגרלה (משרד הבינוי והשיכון)', 'MoCH lottery project'), ids: 'moch:<ProjectID>', from: 'lib/entities/registry.js over data/housing/lotteries.json' },
  site: { id: 'site', label: bi('מגרש (רמ"י)', 'ILA lot'), ids: 'ila:<MichrazID>:<lot file id (TikID)>', from: 'data/land/tenders.json lotRefs[] (+ the registry site when a listed developer won it)' },
  tender: { id: 'tender', label: bi('מכרז (רמ"י)', 'ILA tender'), ids: 'rmi:<MichrazID>', from: 'data/land/tenders.json (live records)' },
  plan: { id: 'plan', label: bi('תכנית', 'plan'), ids: 'plan:<plan number, whitespace removed>', from: 'the plan numbers the ILA lot files print · the XPlan records PROPX stores (land plans.json, renewal planning.json)' },
  parcel: { id: 'parcel', label: bi('גוש/חלקה', 'block / parcel'), ids: 'parcel:<block>/<parcel>', from: 'data/land/tenders.json parcels[] and lotRefs[].parcels' },
  renewal_complex: { id: 'renewal_complex', label: bi('מתחם התחדשות עירונית', 'urban-renewal complex'), ids: 'renewal:<complex number>', from: 'data/renewal/complexes.json (live records)' },
  rental_project: { id: 'rental_project', label: bi('מכרז דירה להשכיר (צמוד למכרז רמ"י)', 'Dira Lehaskir notice joined to an ILA tender'), ids: 'rental:<MichrazID>', from: 'data/rental/dira-tenders.json developer-tender notices with a printed tender number that names a live ILA record' },
  source: { id: 'source', label: bi('מקור', 'source'), ids: 'source:<trust id>', from: 'the source descriptors of the read models' },
});

const RELATIONS = Object.freeze({
  CONTAINS: { id: 'CONTAINS', label: bi('מכיל', 'contains'), pairs: [
    { from: 'country', to: 'district', evidence: 'DISTRICTS (lib/dossier/query.js — the CBS districts)', source: 'propx:districts' },
    { from: 'district', to: 'locality', evidence: 'localities.json district', source: 'geo:registry' },
    { from: 'tender', to: 'site', evidence: 'lotRefs[].id (TikID — the Authority\'s lot file id)', source: 'rmi:michrazim' } ] },
  IN: { id: 'IN', label: bi('שייך ל', 'in'), pairs: [
    { from: 'district', to: 'country', evidence: 'DISTRICTS (lib/dossier/query.js)', source: 'propx:districts' },
    { from: 'locality', to: 'district', evidence: 'localities.json district', source: 'geo:registry' } ] },
  LOCATED_IN: { id: 'LOCATED_IN', label: bi('ממוקם ב', 'located in'), pairs: [
    { from: 'tender', to: 'locality', evidence: 'localityCode (the Authority\'s CBS locality code)', source: 'rmi:michrazim' },
    { from: 'project', to: 'locality', evidence: 'localityCode (the Ministry\'s CBS locality code on the lottery rows)', source: 'datagov:moch:dira-behanacha-lotteries' },
    { from: 'renewal_complex', to: 'locality', evidence: 'localityCode (the Ministry\'s CBS locality code on the complex row)', source: 'datagov:moch:urban-renewal-complexes' } ] },
  HAS_WINNER: { id: 'HAS_WINNER', label: bi('זוכה', 'has winner'), pairs: [
    { from: 'site', to: 'developer', evidence: 'the registry site\'s developerId ← winners[].name (the Authority\'s winner string, canonical; listed legal names only)', source: 'rmi:michrazim' } ] },
  WON: { id: 'WON', label: bi('זכה ב', 'won'), pairs: [
    { from: 'developer', to: 'site', evidence: 'the registry site\'s developerId ← winners[].name (the inverse of HAS_WINNER)', source: 'rmi:michrazim' } ] },
  DEVELOPS: { id: 'DEVELOPS', label: bi('מפתח', 'develops'), pairs: [
    { from: 'developer', to: 'project', evidence: 'the registry project\'s developerIds ← the lottery rows\' developer string (canonical)', source: 'datagov:moch:dira-behanacha-lotteries' } ] },
  REFERENCES: { id: 'REFERENCES', label: bi('מפנה לתכנית', 'references plan'), pairs: [
    { from: 'tender', to: 'plan', evidence: 'plans[].plan with join \'exact-plan-number\' (the plan number printed on the lot file)', source: 'rmi:michrazim' },
    { from: 'renewal_complex', to: 'plan', evidence: 'the exact XPlan join: the plan number MoCH prints = pl_number, and / or the Mavat id in MoCH\'s own link = mp_id (lib/renewal/planning.js; an ambiguous match is not an edge)', source: 'iplan:xplan:renewal' } ] },
  ON_PARCEL: { id: 'ON_PARCEL', label: bi('על גוש/חלקה', 'on parcel'), pairs: [
    { from: 'tender', to: 'parcel', evidence: 'parcels[].block / parcel (GushHelka)', source: 'rmi:michrazim' } ] },
  AFFECTS: { id: 'AFFECTS', label: bi('חלה על גוש/חלקה', 'affects parcel'), pairs: [
    { from: 'plan', to: 'parcel', evidence: 'ONE stored lot file (lotRefs[]) carrying both keys (plan|lot) and parcels (block/parcel) — the only stored record that carries a plan and a parcel together; XPlan publishes no parcels', source: 'rmi:michrazim' } ] },
  RE_MARKETS: { id: 'RE_MARKETS', label: bi('שיווק חוזר של', 're-markets'), pairs: [
    { from: 'tender', to: 'tender', evidence: 'a lot file id (TikID) shared by the earlier and the later tender (lib/land/lineage.js); same-parcel (site-level only) and parallel-marketing (same publication date) links are not edges', source: 'rmi:michrazim' } ] },
  JOINED_TO: { id: 'JOINED_TO', label: bi('צמוד למכרז', 'joined to tender'), pairs: [
    { from: 'rental_project', to: 'tender', evidence: 'the tender number Dira Lehaskir prints (region/number/year) → MichrazID = year × 10000 + number', source: 'dira-lehaskir:wp' } ] },
  POSSIBLY_SAME: { id: 'POSSIBLY_SAME', label: bi('ייתכן שאותה ישות (לא מוזג)', 'possibly the same entity (not merged)'), pairs: [
    { from: 'developer', to: 'developer', evidence: 'the registry\'s possibleSame link: strict-prefix (a cut name that is a strict prefix of exactly one other listed name) or same-letters (the same letters in the same order, punctuation / spacing differ) — flagged, never merged', source: 'propx:entities-registry' } ] },
  SOURCED_FROM: { id: 'SOURCED_FROM', label: bi('מקור הרשומה', 'sourced from'), pairs: [
    { from: 'tender', to: 'source', evidence: 'the store\'s declared source (lib/land/sources.js rmi:michrazim) — the record id', source: 'rmi:michrazim' },
    { from: 'project', to: 'source', evidence: 'provenance.source of the lottery rows — the record id', source: 'datagov:moch:dira-behanacha-lotteries' },
    { from: 'renewal_complex', to: 'source', evidence: 'provenance.source of the complex row — the record id', source: 'datagov:moch:urban-renewal-complexes' },
    { from: 'rental_project', to: 'source', evidence: 'the store\'s declared source (lib/rental/dira.js) — the notice id', source: 'dira-lehaskir:wp' },
    { from: 'plan', to: 'source', evidence: 'provenance.source of the stored XPlan record — its mp_id', source: 'iplan:xplan · iplan:xplan:renewal' } ] },
});

/* the sources an edge may rest on — each becomes a `source:<id>` node so that every evidence.source resolves */
const SOURCE_NODES = [
  ['rmi:michrazim', LAND_SOURCES['rmi:michrazim'].publisher, LAND_SOURCES['rmi:michrazim'].publisherEn, LAND_SOURCES['rmi:michrazim'].name, LAND_SOURCES['rmi:michrazim'].classification],
  ['iplan:xplan', LAND_SOURCES['iplan:xplan'].publisher, LAND_SOURCES['iplan:xplan'].publisherEn, LAND_SOURCES['iplan:xplan'].name, LAND_SOURCES['iplan:xplan'].classification],
  ['datagov:moch:dira-behanacha-lotteries', EQ.SOURCES['datagov:moch:dira-behanacha-lotteries'].publisher, EQ.SOURCES['datagov:moch:dira-behanacha-lotteries'].publisherEn, EQ.SOURCES['datagov:moch:dira-behanacha-lotteries'].name, EQ.SOURCES['datagov:moch:dira-behanacha-lotteries'].classification],
  ['datagov:moch:urban-renewal-complexes', RENEWAL_SOURCE.authority, RENEWAL_SOURCE.authorityEn, `${RENEWAL_SOURCE.dataset} — ${RENEWAL_SOURCE.resource} (data.gov.il)`, RENEWAL_SOURCE.classification],
  ['iplan:xplan:renewal', XPLAN_RENEWAL_SOURCE.authority, XPLAN_RENEWAL_SOURCE.authorityEn, XPLAN_RENEWAL_SOURCE.dataset, XPLAN_RENEWAL_SOURCE.classification],
  ['dira-lehaskir:wp', DIRA_SOURCE.owner, DIRA_SOURCE.ownerEn, DIRA_SOURCE.site, DIRA_SOURCE.classification],
  ['geo:registry', 'הלשכה המרכזית לסטטיסטיקה · משרד הפנים', 'Central Bureau of Statistics · Ministry of Interior', 'מרשם היישובים הרשמי (data/geo/localities.json, lib/geo)', 'OFFICIAL'],
  ['propx:districts', 'PROPX', 'PROPX', 'the seven CBS districts as a constant table (lib/dossier/query.js DISTRICTS)', 'CONSTANT'],
  ['propx:entities-registry', 'PROPX', 'PROPX', 'the deterministic developer registry rules over the official strings (lib/entities/registry.js)', 'DERIVED'],
];

/* ------------------------------------------------------------ build */
function build({ c, L, R, T, geo }) {
  const N = new Map(), E = [], A = new Map(), seen = new Set();
  const addNode = (id, type, label, attrs, source) => { let n = N.get(id); if (!n) { n = { id, type, label, attrs, source }; N.set(id, n); } return n; };
  const touch = (id, i) => { let a = A.get(id); if (!a) { a = []; A.set(id, a); } a.push(i); };
  const ev = (key, value, source) => ({ key, value: value == null ? null : value, source });
  /** an edge exists only when both nodes exist; one edge per (relation, from, to) */
  const addEdge = (relation, from, to, evidence, extra) => {
    if (!N.has(from) || !N.has(to)) return false;
    const k = relation + '|' + from + '|' + to; if (seen.has(k)) return false; seen.add(k);
    const e = extra ? Object.assign({ relation, from, to, evidence }, extra) : { relation, from, to, evidence };
    const i = E.push(e) - 1; touch(from, i); if (to !== from) touch(to, i); return true;
  };
  const U = { /* unmatched — counted, never defaulted into an edge */
    localitiesWithoutCode: 0, localitiesWithoutDistrict: 0, localitiesDistrictNotInTable: 0,
    tendersWithoutLocality: { none: 0, notInRegistry: 0 }, tendersWithoutLotIndex: 0, lotsWithoutFileId: 0,
    tendersPlanRefsNoXplan: 0, planRefs: { found: 0, 'not-found': 0, 'not-checked': 0 },
    winnersWithoutListedDeveloper: { unlisted: 0, nonResidentialTrack: 0, emptyString: 0, total: 0 },
    projectsWithoutDeveloper: 0, projectsWithoutLocality: { none: 0, notInRegistry: 0 },
    complexesNoPlanJoin: { 'not-found': 0, 'no-identifier': 0, 'not-checked': 0, total: 0 }, complexesWithoutLocality: { none: 0, notInRegistry: 0 },
    noticesWithoutTenderNumber: 0, noticesWithoutIlaRecord: 0, noticesDuplicateTender: 0,
    lineageLinksExcluded: { 'same-parcel': 0, 'parallel-marketing': 0 } };
  const K = { ambiguousRenewalJoins: [], possiblySameDevelopers: { developers: 0, links: 0, byEvidence: {} }, plansResolvedDifferently: [], planKeysInBothXplanStores: 0 };
  const COV = { tendersWithPlanEdge: 0, tendersWithXplanPlan: 0, tendersLocated: 0, tendersWithParcel: 0, tendersReMarketed: new Set(), sitesWithWinner: 0, awardedLots: 0,
    projectsWithDeveloper: 0, projectsLocated: 0, complexesWithPlanEdge: 0, complexesLocated: 0, noticesJoined: 0, notices: 0, localitiesInDistrict: 0 };
  const AF = { lotsCarryingBoth: 0, pairs: 0 };

  /* ---- sources */
  for (const [id, publisher, publisherEn, name, classification] of SOURCE_NODES) addNode('source:' + id, 'source', bi(publisher, publisherEn), { sourceId: id, name, classification }, id);

  /* ---- geography: the country, the CBS districts (constant table), the official localities (geo registry) */
  addNode('il', 'country', bi('ישראל', 'Israel'), { code: 'il' }, 'propx:districts');
  for (const [code, d] of Object.entries(DISTRICTS)) {
    addNode(code, 'district', bi(d.he, d.en), { code, cbs: d.cbs || null }, 'propx:districts');
    addEdge('CONTAINS', 'il', code, ev('DISTRICTS', code, 'propx:districts'));
    addEdge('IN', code, 'il', ev('DISTRICTS', code, 'propx:districts'));
  }
  const LOC = new Map();   // locality code (string) → node id
  for (const l of geo) {
    if (l == null || l.code == null) { U.localitiesWithoutCode++; continue; }   // a registry row without an official code is no entity
    const id = l.id || 'loc:' + l.code;
    LOC.set(String(l.code), id);
    addNode(id, 'locality', bi(l.he || String(l.code), l.en || l.he || String(l.code)), { code: l.code, district: l.district || null, napa: l.napa || null, lat: l.lat ?? null, lng: l.lng ?? null }, 'geo:registry');
    if (!l.district) { U.localitiesWithoutDistrict++; continue; }
    if (!N.has(l.district)) { U.localitiesDistrictNotInTable++; continue; }
    addEdge('CONTAINS', l.district, id, ev('localities.json district', l.district, 'geo:registry'));
    addEdge('IN', id, l.district, ev('localities.json district', l.district, 'geo:registry'));
    COV.localitiesInDistrict++;
  }
  const locate = (fromId, code, source, tally) => {
    if (code == null || code === '') { tally.none++; return false; }
    const loc = LOC.get(String(code)); if (!loc) { tally.notInRegistry++; return false; }
    return addEdge('LOCATED_IN', fromId, loc, ev('localityCode', code, source));
  };

  /* ---- developers (the registry's entities) and the registry's own possible-same links — flagged, never merged */
  for (const e of c.R.developers) {
    addNode(e.id, 'developer', bi(e.name, e.name), { canonical: e.canonical, kind: e.kind, joint: e.joint, roles: e.roles, lotsWon: e.tenders.lots, tendersWon: e.tenders.tenders,
      residentialUnitsWon: e.tenders.residentialUnits, lotteryProjects: e.lotteries.projects, lotteries: e.lotteries.lotteries, markets: e.cities, firstActivity: e.firstActivity, lastActivity: e.lastActivity,
      possibleSame: e.possibleSame.length, merged: false, companyId: null }, 'propx:entities-registry');
  }
  for (const e of c.R.developers) {
    if (e.possibleSame.length) K.possiblySameDevelopers.developers++;
    for (const x of e.possibleSame) {
      if (addEdge('POSSIBLY_SAME', e.id, x.id, ev('possibleSame[].evidence', x.evidence, 'propx:entities-registry'), { merged: false, note: x.note || null })) {
        K.possiblySameDevelopers.links++; K.possiblySameDevelopers.byEvidence[x.evidence] = (K.possiblySameDevelopers.byEvidence[x.evidence] || 0) + 1;
      }
    }
  }

  /* ---- tenders (live ILA records) */
  for (const r of L.live) {
    const nm = r.name || String(r.michrazId);
    addNode(r.id, 'tender', bi(`מכרז ${nm}`, `Tender ${nm}`), { michrazId: r.michrazId, name: r.name || null, lifecycle: r.lifecycle || null, track: r.track || null, priceBasis: r.priceBasis || null,
      localityCode: r.localityCode ?? null, city: r.city || null, cityEn: r.cityEn || null, neighborhood: r.neighborhood || null, units: r.units ?? null, lots: r.lotsCount ?? null,
      publishedDate: r.publishedDate || null, closeDate: r.closeDate || null, committeeDate: r.committeeDate || null, decisionDate: r.decisionDate || r.committeeDate || r.lotteryDate || r.closeDate || null,
      winners: Array.isArray(r.winners) ? r.winners.length : 0, detailRead: r.lotsCount != null }, 'rmi:michrazim');
    addEdge('SOURCED_FROM', r.id, 'source:rmi:michrazim', ev('record id (lib/land/sources.js rmi:michrazim)', r.id, 'rmi:michrazim'));
    if (locate(r.id, r.localityCode, 'rmi:michrazim', U.tendersWithoutLocality)) COV.tendersLocated++;
  }

  /* ---- sites: every lot file of every detail-read tender; the registry site (a listed developer's residential lot) adds its fields */
  for (const r of L.live) {
    const refs = Array.isArray(r.lotRefs) ? r.lotRefs : null;
    if (!refs) { if (r.lotsCount != null) U.tendersWithoutLotIndex++; continue; }
    const nm = r.name || String(r.michrazId);
    for (const l of refs) {
      if (!l || !l.id) { U.lotsWithoutFileId++; continue; }
      const sid = `ila:${r.michrazId}:${l.id}`, S = c.projById.get(sid) || null;
      const attrs = { lotId: l.id, tenderId: r.id, michrazId: r.michrazId, won: !!l.won, units: l.units ?? null, planLotKeys: l.keys || [], parcels: l.parcels || [], localityCode: r.localityCode ?? null, track: r.track || null, listedWinner: !!S };
      if (S) Object.assign(attrs, { developerId: S.developerId, decisionDate: S.decisionDate, stage: S.stage ? S.stage.furthest : null, priceBasis: S.priceBasis, landPrice: S.landPrice, landPerUnit: S.landPerUnit, bidPerSqm: S.bidPerSqm, constructionBuildings: S.construction ? S.construction.buildings : null });
      addNode(sid, 'site', bi(`${nm} · מגרש ${l.id}`, `${nm} · lot ${l.id}`), attrs, 'rmi:michrazim');
      addEdge('CONTAINS', r.id, sid, ev('lotRefs[].id (TikID)', l.id, 'rmi:michrazim'));
    }
  }
  /* the registry's sites: HAS_WINNER / WON by the registry's developerId on the site (never by a name here) */
  for (const S of c.R.sites) {
    if (!N.has(S.id)) {   // a winner lot the lot index does not list (records stored before lotRefs): the site still exists through the winner entry
      addNode(S.id, 'site', bi(`${S.tender || S.michrazId} · מגרש ${S.lotId}`, `${S.tender || S.michrazId} · lot ${S.lotId}`), { lotId: S.lotId, tenderId: S.tenderId, michrazId: S.michrazId, won: true, units: S.units, planLotKeys: S.planLots || [], parcels: S.parcels || [],
        localityCode: S.localityCode, track: S.track, listedWinner: true, developerId: S.developerId, decisionDate: S.decisionDate, stage: S.stage ? S.stage.furthest : null, priceBasis: S.priceBasis, landPrice: S.landPrice, landPerUnit: S.landPerUnit, bidPerSqm: S.bidPerSqm }, 'rmi:michrazim');
      addEdge('CONTAINS', S.tenderId, S.id, ev('winners[].lotId', S.lotId, 'rmi:michrazim'));
    }
    const e = ev('site.developerId ← winners[].name (canonical)', S.developerName, 'rmi:michrazim');
    if (addEdge('HAS_WINNER', S.id, S.developerId, e, { decisionDate: S.decisionDate })) COV.sitesWithWinner++;
    addEdge('WON', S.developerId, S.id, e, { decisionDate: S.decisionDate });
  }
  /* the awarded lots the registry builds no site for: an unmarked winner string (a private person — counted, never listed) or a listed developer on a non-residential track */
  for (const r of L.live) {
    if (r.lifecycle !== 'awarded' || !Array.isArray(r.winners)) continue;
    for (const w of r.winners) {
      COV.awardedLots++;
      if (c.projById.has(`ila:${r.michrazId}:${w.lotId}`)) continue;
      const W = U.winnersWithoutListedDeveloper; W.total++;
      const cn = canonicalName(w.name);
      if (!cn) W.emptyString++; else if (!LISTED_KINDS.has(kindOf(cn))) W.unlisted++; else W.nonResidentialTrack++;
    }
  }

  /* ---- MoCH lottery projects */
  for (const p of c.R.projects) {
    addNode(p.id, 'project', bi(p.name || `פרויקט ${p.projectId}`, p.name || `Project ${p.projectId}`), { projectId: p.projectId, name: p.name || null, developerName: p.developerName || null, developerIds: p.developerIds,
      localityCode: p.localityCode ?? null, city: p.city || null, cityEn: p.cityEn || null, neighborhood: p.neighborhood || null, program: p.program || null, programHe: p.programHe || null,
      unitsFirstLottery: p.unitsFirstLottery ?? null, lotteries: p.lotteries.length, firstLotteryDate: p.firstLotteryDate, lastLotteryDate: p.lastLotteryDate, pricePerSqm: p.pricePerSqm ?? null,
      permitStatusHe: p.permitStatusHe || null, projectStatusHe: p.projectStatusHe || null, stage: p.stage ? p.stage.furthest : null }, 'datagov:moch:dira-behanacha-lotteries');
    addEdge('SOURCED_FROM', p.id, 'source:datagov:moch:dira-behanacha-lotteries', ev('provenance.source · record id', p.id, 'datagov:moch:dira-behanacha-lotteries'));
    if (locate(p.id, p.localityCode, 'datagov:moch:dira-behanacha-lotteries', U.projectsWithoutLocality)) COV.projectsLocated++;
    let any = false;
    for (const d of p.developerIds || []) { const D = c.devById.get(d); if (addEdge('DEVELOPS', d, p.id, ev('developerIds ← the lottery rows\' developer string (canonical)', D ? D.canonical : d, 'datagov:moch:dira-behanacha-lotteries'))) any = true; }
    if (any) COV.projectsWithDeveloper++; else U.projectsWithoutDeveloper++;
  }

  /* ---- plans: the numbers the ILA lot files print (exact-plan-number), the XPlan records the land store holds */
  const ensurePlan = (key, printed, source) => {
    const id = 'plan:' + key; let n = N.get(id);
    if (!n) n = addNode(id, 'plan', bi(`תכנית ${printed}`, `Plan ${printed}`), { planNumber: printed, planKey: key, xplan: null, referencedBy: { tenders: 0, complexes: 0, lots: 0 } }, source);
    return n;
  };
  for (const r of L.live) {
    let any = false, found = false;
    for (const p of r.plans || []) {
      if (!p || p.join !== 'exact-plan-number') continue;
      const key = planKey(p.plan); if (!key) continue;
      const n = ensurePlan(key, p.plan, 'rmi:michrazim'); n.attrs.referencedBy.tenders++;
      const xs = p.xplanStatus === 'found' || p.xplanStatus === 'not-found' ? p.xplanStatus : 'not-checked';
      U.planRefs[xs]++;
      const full = L.planByKey.get(key);
      if (full) { if (!n.attrs.xplan || n.attrs.xplan.status !== 'found') n.attrs.xplan = { status: 'found', mpId: full.mpId ?? null, planId: full.planId ?? null, name: full.name || null, station: full.station || null, event: full.shortStatus || null, lastUpdate: full.lastUpdate || null, store: 'land' }; n.source = 'iplan:xplan'; }
      else if (!n.attrs.xplan) n.attrs.xplan = { status: xs, store: 'land' };
      if (xs === 'found') found = true;
      if (addEdge('REFERENCES', r.id, n.id, ev("plans[].plan (join 'exact-plan-number', the lot file)", p.plan, 'rmi:michrazim'), { xplan: xs })) any = true;
    }
    if (any) COV.tendersWithPlanEdge++;
    if (any && found) COV.tendersWithXplanPlan++;
    if (any && !found) U.tendersPlanRefsNoXplan++;
  }

  /* ---- parcels: the tender's parcels (GushHelka) */
  for (const r of L.live) {
    let any = false;
    for (const p of r.parcels || []) {
      if (!p || !p.block) continue;
      const key = p.block + '/' + (p.parcel || ''), pid = 'parcel:' + key;
      addNode(pid, 'parcel', bi(`גוש ${p.block} חלקה ${p.parcel || '—'}`, `Block ${p.block} parcel ${p.parcel || '—'}`), { block: String(p.block), parcel: p.parcel ? String(p.parcel) : null }, 'rmi:michrazim');
      if (addEdge('ON_PARCEL', r.id, pid, ev('parcels[].block/parcel (GushHelka)', key, 'rmi:michrazim'))) any = true;
    }
    if (any) COV.tendersWithParcel++;
  }
  /* plan AFFECTS parcel — only where ONE stored lot file carries both a plan|lot key and a block/parcel (nothing else in PROPX carries both) */
  for (const r of L.live) {
    for (const l of r.lotRefs || []) {
      if (!l || !Array.isArray(l.keys) || !l.keys.length || !Array.isArray(l.parcels) || !l.parcels.length) continue;
      AF.lotsCarryingBoth++;
      for (const k of l.keys) {
        const printed = String(k).split('|')[0], pk = planKey(printed); if (!pk) continue;
        const pn = ensurePlan(pk, printed, 'rmi:michrazim'); pn.attrs.referencedBy.lots++;
        for (const pc of l.parcels) {
          const pid = 'parcel:' + pc;
          if (!N.has(pid)) { const [b, p] = String(pc).split('/'); addNode(pid, 'parcel', bi(`גוש ${b} חלקה ${p || '—'}`, `Block ${b} parcel ${p || '—'}`), { block: b, parcel: p || null }, 'rmi:michrazim'); }
          if (addEdge('AFFECTS', pn.id, pid, ev('lotRefs[] — one lot file carrying keys (plan|lot) and parcels (block/parcel)', `${r.id} · lot ${l.id}`, 'rmi:michrazim'), { tender: r.id, lot: l.id })) AF.pairs++;
        }
      }
    }
  }

  /* ---- urban-renewal complexes and their EXACT XPlan join (an ambiguous match is a conflict, not an edge) */
  for (const r of R.live) {
    addNode(r.id, 'renewal_complex', bi(r.name || `מתחם ${r.complexId}`, r.name || `Complex ${r.complexId}`), { complexId: r.complexId, name: r.name || null, city: r.city || null, localityCode: r.localityCode ?? null,
      track: r.track || null, declaration: r.declaration || null, declarationDate: r.declarationDate || null, statusHe: r.statusHe || null, stage: r.stage || null,
      existingUnits: r.existingUnits ?? null, additionalUnits: r.additionalUnits ?? null, proposedUnits: r.proposedUnits ?? null, unitsAddUp: r.unitsAddUp ?? null, planNumber: r.planNumber || null, approvalYear: r.approvalYear ?? null }, 'datagov:moch:urban-renewal-complexes');
    addEdge('SOURCED_FROM', r.id, 'source:datagov:moch:urban-renewal-complexes', ev('provenance.source · record id', r.id, 'datagov:moch:urban-renewal-complexes'));
    if (locate(r.id, r.localityCode, 'datagov:moch:urban-renewal-complexes', U.complexesWithoutLocality)) COV.complexesLocated++;
    const j = R.join && R.join.byComplex ? R.join.byComplex.get(r.id) : null, st = j ? j.match.status : 'not-checked';
    if (st === 'exact' && j.plan) {
      const key = j.plan.planKey || planKey(j.plan.planNumber), n = ensurePlan(key, j.plan.planNumber, 'iplan:xplan:renewal'); n.attrs.referencedBy.complexes++;
      if (n.attrs.xplan && n.attrs.xplan.status === 'found' && n.attrs.xplan.mpId != null && j.plan.mpId != null && n.attrs.xplan.mpId !== j.plan.mpId) K.plansResolvedDifferently.push({ planKey: key, land: n.attrs.xplan.mpId, renewal: j.plan.mpId, via: 'referenced by a tender and a complex' });
      if (!n.attrs.xplan || n.attrs.xplan.status !== 'found') { n.attrs.xplan = { status: 'found', mpId: j.plan.mpId, planId: j.plan.plId ?? null, name: j.plan.name || null, station: j.plan.station || null, event: j.plan.event || null, stage: j.plan.stage || null, lastUpdate: j.plan.lastUpdate || null, store: 'renewal' }; n.source = 'iplan:xplan:renewal'; }
      else { n.attrs.xplan.alsoIn = 'renewal'; if (n.attrs.xplan.stage == null && j.plan.stage) n.attrs.xplan.stage = j.plan.stage; }
      if (addEdge('REFERENCES', r.id, n.id, ev('XPlan join: ' + j.match.evidence.join(' + '), j.plan.planNumber, 'iplan:xplan:renewal'), { mpId: j.plan.mpId, joinEvidence: j.match.evidence })) COV.complexesWithPlanEdge++;
    } else if (st === 'ambiguous') {
      K.ambiguousRenewalJoins.push({ id: r.id, complexId: r.complexId, planNumber: r.planNumber || null, reason: j.match.reason, candidates: j.match.candidates || [], planNumberDiffers: j.match.planNumberDiffers || null });
    } else { U.complexesNoPlanJoin[st] = (U.complexesNoPlanJoin[st] || 0) + 1; U.complexesNoPlanJoin.total++; }
  }
  /* the two XPlan stores side by side: a plan key both hold must resolve to the same mp_id — anything else is a conflict */
  const renByKey = new Map();
  for (const p of (R.planning && Array.isArray(R.planning.plans) ? R.planning.plans : [])) { if (!p || p.inLatestSource === false || !p.planKey) continue; if (!renByKey.has(p.planKey)) renByKey.set(p.planKey, new Set()); renByKey.get(p.planKey).add(p.mpId); }
  for (const [key, p] of L.planByKey) {
    const ids = renByKey.get(key); if (!ids) continue; K.planKeysInBothXplanStores++;
    if (p.mpId != null && !ids.has(p.mpId) && !K.plansResolvedDifferently.some((x) => x.planKey === key)) K.plansResolvedDifferently.push({ planKey: key, land: p.mpId, renewal: [...ids], via: 'both XPlan stores hold the key' });
  }
  /* the plans with a stored XPlan record are sourced from the store(s) that hold it */
  for (const n of N.values()) {
    if (n.type !== 'plan' || !n.attrs.xplan || n.attrs.xplan.status !== 'found') continue;
    const mp = n.attrs.xplan.mpId != null ? 'xplan:' + n.attrs.xplan.mpId : n.id;
    if (n.attrs.xplan.store === 'land') addEdge('SOURCED_FROM', n.id, 'source:iplan:xplan', ev('provenance.source · mp_id', mp, 'iplan:xplan'));
    if (n.attrs.xplan.store === 'renewal' || n.attrs.xplan.alsoIn === 'renewal') addEdge('SOURCED_FROM', n.id, 'source:iplan:xplan:renewal', ev('provenance.source · mp_id', mp, 'iplan:xplan:renewal'));
  }

  /* ---- re-marketing: the lineage through the lot file id (same-parcel and parallel-marketing are not edges) */
  const lin = LQ.lineageOf(L);
  for (const l of lin.links) {
    if (l.relation === 'same-parcel' || l.relation === 'parallel-marketing') { U.lineageLinksExcluded[l.relation]++; continue; }
    const RL = LINEAGE[l.relation] || null;
    if (addEdge('RE_MARKETS', l.from, l.to, ev('lotRefs[].id (TikID) shared by both tenders', l.evidence, 'rmi:michrazim'), { kind: l.relation, kindHe: RL ? RL.he : l.relation, kindEn: RL ? RL.en : l.relation,
      sharedLots: l.sharedLots.length, sharedKeys: l.sharedKeys.length, fromStage: l.fromStage, fromDate: l.fromDate, toStage: l.toStage, toDate: l.toDate })) { COV.tendersReMarketed.add(l.from); COV.tendersReMarketed.add(l.to); }
  }

  /* ---- Dira Lehaskir notices joined to a live ILA tender by the printed tender number */
  for (const x of T.dev || []) {
    if (!x || x.inLatestSource === false) continue;
    COV.notices++;
    if (!x.tender || x.tender.michrazId == null) { U.noticesWithoutTenderNumber++; continue; }
    const tid = 'rmi:' + x.tender.michrazId; if (!N.has(tid)) { U.noticesWithoutIlaRecord++; continue; }
    const id = 'rental:' + x.tender.michrazId; if (N.has(id)) { U.noticesDuplicateTender++; continue; }
    const t = x.terms || {};
    addNode(id, 'rental_project', bi(x.title || `מכרז ${x.tender.raw}`, x.title || `Tender ${x.tender.raw}`), { noticeId: x.id, tenderNumber: x.tender.raw, michrazId: x.tender.michrazId, tenderId: tid, status: x.status ? x.status.name : null, statusSlug: x.status ? x.status.slug : null,
      published: x.published || null, modified: x.modified || null, totalUnits: t.totalUnits ?? null, rentalUnits: t.rentalUnits ?? null, rentalBasis: t.rentalBasis || null, saleUnits: t.saleUnits ?? null, rentalYears: t.rentalYears ?? null,
      rentalPermanent: !!t.rentalPermanent, inconsistent: !!t.inconsistent, link: x.link || null }, 'dira-lehaskir:wp');
    if (addEdge('JOINED_TO', id, tid, ev('tender.raw → MichrazID (year × 10000 + number)', x.tender.raw, 'dira-lehaskir:wp'), { michrazId: x.tender.michrazId })) COV.noticesJoined++;
    addEdge('SOURCED_FROM', id, 'source:dira-lehaskir:wp', ev('the store\'s declared source · notice id', x.id, 'dira-lehaskir:wp'));
  }

  /* ---- stats (deterministic: no timestamps here) */
  const byType = {}; for (const n of N.values()) byType[n.type] = (byType[n.type] || 0) + 1;
  const byRelation = {}; for (const e of E) byRelation[e.relation] = (byRelation[e.relation] || 0) + 1;
  const cov = (num, den, he, en) => ({ num, den, ratio: ratio(num, den), basis: bi(he, en) });
  const tenders = L.live.length, complexes = R.live.length, localities = LOC.size;
  const stats = {
    basis: BASIS,
    nodes: { total: N.size, byType },
    edges: { total: E.length, byRelation },
    coverage: {
      tendersWithPlanEdge: cov(COV.tendersWithPlanEdge, tenders, 'מכרזים עם ≥ 1 הפניה מדויקת לתכנית ÷ מכרזים חיים', 'tenders with ≥ 1 exact plan reference ÷ live tenders'),
      tendersWithXplanPlan: cov(COV.tendersWithXplanPlan, tenders, 'מכרזים שלפחות אחת מתכניותיהם נמצאה ב-XPlan ÷ מכרזים חיים', 'tenders with ≥ 1 plan found in XPlan ÷ live tenders'),
      tendersLocated: cov(COV.tendersLocated, tenders, 'מכרזים עם יישוב במרשם ÷ מכרזים חיים', 'tenders whose locality code is in the geo registry ÷ live tenders'),
      tendersWithParcel: cov(COV.tendersWithParcel, tenders, 'מכרזים עם גוש/חלקה ÷ מכרזים חיים', 'tenders with ≥ 1 block/parcel ÷ live tenders'),
      tendersReMarketed: cov(COV.tendersReMarketed.size, tenders, 'מכרזים עם קשת שיווק-חוזר (דרך תיק המגרש) ÷ מכרזים חיים', 'tenders on ≥ 1 RE_MARKETS edge (through the lot file) ÷ live tenders'),
      sitesWithWinner: cov(COV.sitesWithWinner, COV.awardedLots, 'מגרשים עם קשת זוכה (יזם רשום) ÷ מגרשים שהוכרז בהם זוכה', 'lots with a HAS_WINNER edge (a listed developer) ÷ awarded lots (lots with a recorded winner)'),
      projectsWithDeveloper: cov(COV.projectsWithDeveloper, c.R.projects.length, 'פרויקטי הגרלה עם קשת יזם ÷ פרויקטים', 'MoCH lottery projects with ≥ 1 DEVELOPS edge ÷ projects'),
      projectsLocated: cov(COV.projectsLocated, c.R.projects.length, 'פרויקטי הגרלה עם יישוב במרשם ÷ פרויקטים', 'MoCH lottery projects whose locality code is in the geo registry ÷ projects'),
      complexesWithPlanEdge: cov(COV.complexesWithPlanEdge, complexes, 'מתחמים עם צירוף XPlan מדויק ÷ מתחמים חיים', 'renewal complexes with an exact XPlan plan edge ÷ live complexes'),
      complexesLocated: cov(COV.complexesLocated, complexes, 'מתחמים עם יישוב במרשם ÷ מתחמים חיים', 'renewal complexes whose locality code is in the geo registry ÷ live complexes'),
      noticesJoined: cov(COV.noticesJoined, COV.notices, 'הודעות מכרז של דירה להשכיר שצורפו למכרז רמ"י חי ÷ הודעות', 'Dira Lehaskir developer-tender notices joined to a live ILA tender ÷ notices'),
      localitiesInDistrict: cov(COV.localitiesInDistrict, localities, 'יישובים עם מחוז ÷ יישובים במרשם', 'localities with a district ÷ localities in the registry'),
    },
    unmatched: U,
    conflicts: K,
    planAffectsParcel: { lotsCarryingBoth: AF.lotsCarryingBoth, pairs: AF.pairs,
      basis: bi('קשת תכנית→גוש/חלקה קיימת רק כשתיק מגרש אחד של רמ"י נושא גם מפתח תכנית|מגרש וגם גוש/חלקה; XPlan אינו מפרסם חלקות', 'a plan→parcel edge exists only where one ILA lot file carries both a plan|lot key and a block/parcel; XPlan publishes no parcels'),
      ...(AF.pairs ? {} : { note: bi('אף רשומה שמורה אינה נושאת תכנית וחלקה יחד — אין קשתות', 'no stored record carries a plan and a parcel together — no edges') }) },
    store: { tenders, awardedLots: COV.awardedLots, registryAwardedLots: c.R.coverage.ila.awardedLots, registrySites: c.R.sites.length, developers: c.R.developers.length, projects: c.R.projects.length, complexes, notices: COV.notices, localities, districts: Object.keys(DISTRICTS).length,
      lineageLinks: lin.links.length, xplanPlansLand: L.planByKey.size, xplanPlansRenewal: renByKey.size },
    sources: SOURCE_NODES.map(([id]) => id),
    notEdges: bi('התאמת שמות · גאומטריה · צירוף דו-משמעי · נתון מחוזי על יישוב · צירוף בין מקורות ללא מפתח משותף (פרויקט הגרלה ↔ מגרש רמ"י)', 'name matches · geometry · ambiguous joins · district data on a locality · a cross-source join with no shared key (MoCH lottery project ↔ ILA lot)'),
  };
  return { N, E, A, stats };
}

/* ------------------------------------------------------------ load (memoised per data stamp) */
let CACHE = null;
function load(opt = {}) {
  const c = EQ.load(opt);
  const L = LQ.load(opt.landDir);
  const R = RN.load(opt.renewalDir);
  const T = RQ.load(opt.rentalDir);
  const geoFile = opt.geoFile || GEO_FILE;
  const stamp = ['graph', c.stamp, L.stamp, R.stamp, T.stamp, mtime(geoFile)].join('|');
  if (CACHE && CACHE.stamp === stamp && !opt.force) return CACHE;
  const t0 = process.hrtime.bigint();
  const geo = readJson(geoFile, null);
  const G = build({ c, L, R, T, geo: geo && Array.isArray(geo.localities) ? geo.localities : [] });
  G.stamp = stamp; G.buildMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100; G.builtAt = new Date().toISOString();
  CACHE = G;
  return G;
}

/* ------------------------------------------------------------ reads */
const clampLimit = (v, d = 200, max = 1000) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(max, n) : d; };
const relOf = (v) => (v && RELATIONS[v] ? v : null);

/** one entity, slim, with its degree — null for an unknown id */
function node(id, opt = {}) {
  const G = load(opt), n = G.N.get(String(id == null ? '' : id));
  if (!n) return null;
  const a = G.A.get(n.id);
  return { id: n.id, type: n.type, label: n.label, attrs: n.attrs, source: n.source, degree: a ? a.length : 0 };
}
/** the edges touching a node (direction out / in), optionally one relation, cut to the limit (default 200, max 1000) — [] for an unknown id */
function edges(id, { relation, limit } = {}, opt = {}) {
  const G = load(opt), key = String(id == null ? '' : id), a = G.A.get(key);
  if (!a || !G.N.has(key)) return [];
  const rel = relOf(relation), max = clampLimit(limit), out = [];
  for (const i of a) { const e = G.E[i]; if (rel && e.relation !== rel) continue; out.push({ ...e, direction: e.from === key ? 'out' : 'in' }); if (out.length >= max) break; }
  return out;
}
/** how many edges touch the node (optionally one relation) */
function degree(id, { relation } = {}, opt = {}) {
  const G = load(opt), key = String(id == null ? '' : id), a = G.A.get(key);
  if (!a) return 0;
  const rel = relOf(relation); if (!rel) return a.length;
  let n = 0; for (const i of a) if (G.E[i].relation === rel) n++; return n;
}
/** the distinct nodes one edge away, each with the relations (and directions) that reach it — [] for an unknown id */
function neighbours(id, { relation, limit } = {}, opt = {}) {
  const G = load(opt), key = String(id == null ? '' : id), a = G.A.get(key);
  if (!a || !G.N.has(key)) return [];
  const rel = relOf(relation), max = clampLimit(limit), by = new Map();
  for (const i of a) {
    const e = G.E[i]; if (rel && e.relation !== rel) continue;
    const other = e.from === key ? e.to : e.from, dir = e.from === key ? 'out' : 'in';
    let x = by.get(other);
    if (!x) { if (by.size >= max) continue; const n = G.N.get(other); x = { id: other, type: n.type, label: n.label, relations: [] }; by.set(other, x); }
    if (!x.relations.some((r) => r.relation === e.relation && r.direction === dir)) x.relations.push({ relation: e.relation, direction: dir });
  }
  return [...by.values()];
}
/** counts per type and relation, join coverage, unmatched, conflicts, the basis — plus the build stamp and timing */
function stats(opt = {}) {
  const G = load(opt);
  return { ...G.stats, build: { stamp: G.stamp, at: G.builtAt, ms: G.buildMs } };
}
/** the vocabulary for clients */
const vocabulary = () => ({ basis: BASIS, entityTypes: ENTITY_TYPES, relations: RELATIONS });

module.exports = { ENTITY_TYPES, RELATIONS, BASIS, load, node, edges, degree, neighbours, stats, vocabulary, planKey };
