'use strict';
/* INSTITUTIONAL DUE DILIGENCE gates (18.10.2026) — lib/dd over a labelled TEST FIXTURE (test/fixtures/dd-fixture.js) and over the
   real synced data. The test matrix of the build brief (§20): every case asserts the backend truth AND the user-facing words.
   Hard truths (§19): MISSING ≠ ZERO · NOT OBSERVED ≠ DOES NOT EXIST · NO LATER PUBLIC EVIDENCE ≠ PROJECT STOPPED · CHARGE ≠ DISTRESS ·
   LIEN / BREACH ≠ INSOLVENCY · PERMIT ≠ CONSTRUCTION START ≠ COMPLETION · ACTIVE SITE ≠ COMPLETED UNITS · DEVELOPER NAME ≠ LEGAL
   COMPANY · BRAND ≠ SPV · PARENT ≠ GUARANTOR · MARKETING NAME ≠ PLANNING IDENTITY · NAME SIMILARITY ≠ VERIFIED · MUNICIPAL ≠ NATIONAL ·
   PUBLIC COMPANY FINANCIALS ≠ SPV FINANCIALS · STALE ≠ CURRENT · SOURCE SILENCE ≠ NEGATIVE EVIDENCE. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../lib/dd/data');
const DEV = require('../lib/dd/developer');
const PRJ = require('../lib/dd/project');
const BR = require('../lib/dd/brief');
const W = require('../lib/dd/watch');
const EV = require('../lib/dd/evidence');
const R = require('../lib/entities/resolve');
const FIX = require('./fixtures/dd-fixture');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-dd-'));
for (const [f, o] of Object.entries(FIX)) fs.writeFileSync(path.join(dir, f), JSON.stringify(o));
const C = D.load({ dataDir: dir });
const NOW = '2026-10-18T10:00:00.000Z';
const dev = (id, name, kind = 'company', extra = {}) => ({ id, name, canonical: name, kind, joint: /,/.test(name), roles: ['ila-tender-winner'], aliases: [], possibleSame: [], sites: [], projects: [], ...extra });
const ddOf = (d, opt = {}) => DEV.developerDD(d, C, { now: NOW, ...opt });
const lot = (id, extra) => ({ id, kind: 'ila-awarded-lot', tenderId: 'rmi:1', tender: '1/2025', lotId: id, localityCode: 5000, city: 'תל אביב - יפו', track: 'open-market', units: 40, decisionDate: '2025-01-01', planLots: [], parcels: [], stage: { furthest: 'land-awarded', evidence: [{ stage: 'land-awarded', date: '2025-01-01', source: 'rmi:michrazim' }] }, ...extra });
const prj = (p, devDD, opt = {}) => PRJ.projectDD(p, C, { now: NOW, developerDD: devDD, ...opt });
const lotIdx = (pairs) => new Map(Object.entries(pairs).map(([k, v]) => [k, new Set(v)]));
/* the hard-truth language gate: a forbidden word may appear only right after a negation */
const FORBIDDEN = /\b(stalled|failed project|delayed|insolvent|bankrupt|distress(?:ed)?|probability of default|default probability|solvency score|creditworth\w*|improv(?:ing|ed) financ\w*|worsen\w*)\b/gi;
function languageGate(obj, label) {
  const s = JSON.stringify(obj);
  for (const m of s.matchAll(FORBIDDEN)) { const before = s.slice(Math.max(0, m.index - 48), m.index); assert.ok(/(not|never|no|≠|NOT|NEVER|isn't|not a|nor)\W*(?:[\w"'’-]+\W+){0,4}$/i.test(before), `${label}: "${m[0]}" used without a negation: …${before}${m[0]}`); }
  assert.ok(!/\b\d{1,3}\s?% (confidence|probability|likel)/i.test(s), label + ': no confidence percentages');
}

console.log('dd');
t('fixture loads; indexes: one Tel Aviv site per supervision file (rows merged), permits by permit number', () => {
  assert.equal(C.synced, true); assert.equal(C.tlvSitesByTik.size, 4); assert.deepEqual(C.tlvSitesByTik.get('T-1').parcels, ['parcel:6000/5', 'parcel:6000/6']);
  assert.equal((C.tlvPermitsByNumber.get('20250001') || []).length, 1); assert.equal((C.sitesByParcel.get('parcel:7000/1') || []).length, 1);
});
t('§20 company-ID match: a user-provided company number → VERIFIED on a user-provided key, labelled; a malformed one is refused', () => {
  const x = ddOf(dev('dev-g', 'גמא יזמות בע"מ'), { companyNumber: '510000005', confirmedCandidate: true });
  assert.equal(x.identity.resolution.state, 'VERIFIED'); assert.equal(x.identity.companyId, 'co:510000005'); assert.equal(x.identity.resolution.userProvided, true);
  assert.ok(x.identity.resolution.reasons.some((r) => r.code === 'USER_CONFIRMED_CANDIDATE'));
  assert.equal(ddOf(dev('dev-g', 'גמא יזמות בע"מ'), { companyNumber: 'abc' }).identity.resolution.state, 'UNRESOLVED');
});
t('§20 ambiguous: two registry rows under one normalized name → AMBIGUOUS, none picked, no corporate record composed, the brief asks for the number', () => {
  const x = ddOf(dev('dev-g', 'גמא יזמות בע"מ'));
  assert.equal(x.identity.resolution.state, 'AMBIGUOUS'); assert.equal(x.identity.companyId, null); assert.equal(x.corporate.state, 'UNRESOLVED');
  const b = BR.brief({ developer: x }); assert.ok(b.items.some((i) => i.category === 'ENTITY_AMBIGUITY' && /none picked/.test(i.text.en)));
  assert.equal(BR.nextBestEvidence({ developer: x }).items[0].id, 'company-number');
});
t('§20 brand vs legal companies · parent / subsidiary: the brand resolves to its own registered name only; a "(פרויקטים)" company is never attached; ownership NOT resolvable', () => {
  const x = ddOf(dev('dev-a', 'אלפא בנייה בע"מ'));
  assert.equal(x.identity.resolution.state, 'STRONG_MATCH'); assert.equal(x.identity.companyId, 'co:510000001');
  assert.ok(!JSON.stringify(x.identity).includes('510000002'), 'the "(פרויקטים)" company is not a candidate');
  assert.ok(x.missing.some((m) => m.id === 'ownership')); assert.ok(x.hardTruths.some((h) => /PARENT COMPANY ≠ PROJECT GUARANTOR/.test(h.en)) && x.hardTruths.some((h) => /BRAND ≠ PROJECT SPV/.test(h.en)));
  assert.match(x.identity.brandNote.en, /not resolvable/);
});
t('§20 matched by name only: STRONG MATCH, never VERIFIED, the reason says so (name similarity ≠ verified)', () => {
  const x = ddOf(dev('dev-a', 'אלפא בנייה בע"מ'));
  assert.notEqual(x.identity.resolution.state, 'VERIFIED'); assert.ok(x.identity.resolution.reasons.some((r) => r.code === 'NAME_ONLY_NEVER_VERIFIED'));
  assert.equal(ddOf(dev('dev-eta', 'אטא בניה והשקעות בע"מ')).identity.resolution.state, 'POSSIBLE_MATCH');
});
t('§20 private company, no financials: PRIVATE WITH LIMITED PUBLIC DATA — a coverage statement, no risk signal, nothing penalised', () => {
  const x = ddOf(dev('dev-a', 'אלפא בנייה בע"מ'));
  assert.equal(x.financial.cls, 'PRIVATE_WITH_LIMITED_PUBLIC_DATA'); assert.equal(x.financial.statementsAvailable, false);
  assert.match(x.financial.statement.en, /PUBLIC FINANCIAL DATA NOT AVAILABLE IN CURRENT COVERAGE/);
  assert.ok(!x.signals.some((s) => s.kind === 'risk'), 'being private fires no risk signal');
  for (const k of ['revenue', 'equity', 'leverage', 'rating']) assert.ok(x.financial.neverShown.includes(k));
});
t('§20 public company improving / worsening: the registry type only — no financial trend, no improving / worsening wording anywhere', () => {
  const x = ddOf(dev('dev-b', 'בטא נדל"ן בע"מ'));
  assert.equal(x.financial.cls, 'PUBLIC_COMPANY'); assert.equal(x.financial.statementsAvailable, false);
  languageGate(x, 'public company'); assert.ok(!/improv|worsen|trend/i.test(JSON.stringify(x.financial)));
});
t('§20 charge without distress: charge registrations / removals are dated filing events, an info signal, "collateral, not distress"', () => {
  const x = ddOf(dev('dev-e', 'אפסילון בניה בע"מ'));
  assert.equal(x.corporate.filings.counts.chargeRegistered, 1); assert.equal(x.corporate.filings.counts.chargeRemoved, 1);
  const s = x.signals.find((y) => y.id === 'CHARGE_ACTIVITY'); assert.equal(s.kind, 'info'); assert.match(s.text.en, /not distress/);
  assert.equal(x.signals.find((y) => y.id === 'BREACH_FLAG').kind, 'info', 'a breach flag is info, not risk'); assert.match(x.corporate.breach.label.en, /NOT insolvency/);
  assert.equal(x.signals.find((y) => y.id === 'ANNUAL_REPORT_LAG').value, 2021);
  languageGate(x, 'charge');
});
t('§20 insolvency evidence: a court-liquidation status + an open Official Receiver case → OFFICIAL risk signals, stated verbatim with dates', () => {
  const x = ddOf(dev('dev-d', 'דלתא הנדסה בע"מ'));
  assert.equal(x.corporate.registeredStatus.cls, 'IN_COURT_LIQUIDATION');
  assert.deepEqual(x.signals.filter((s) => s.kind === 'risk').map((s) => s.id).sort(), ['COURT_LIQUIDATION_PROCEEDING', 'COURT_LIQUIDATION_STATUS']);
  const c = x.corporate.insolvency.liquidationCases[0]; assert.equal(c.open, true); assert.equal(c.orderDate, '2026-03-01');
  assert.match(x.corporate.insolvency.statement.en, /a court liquidation proceeding is recorded/);
});
t('§19 SOURCE SILENCE ≠ NEGATIVE EVIDENCE: no Receiver row is "not evidence of solvency", never "solvent"', () => {
  const x = ddOf(dev('dev-a', 'אלפא בנייה בע"מ'));
  assert.match(x.corporate.insolvency.statement.en, /not evidence of solvency/); assert.ok(!/\bis solvent\b/i.test(JSON.stringify(x)));
});
t('§20 contractor: the developer registered as a contractor by its company number; its sites by the exact executor id; ACTIVE SITE ≠ COMPLETED UNITS', () => {
  const x = ddOf(dev('dev-a', 'אלפא בנייה בע"מ'));
  assert.equal(x.contractor.state, 'REGISTERED'); assert.deepEqual(x.contractor.kablan, ['1002']); assert.equal(x.contractor.via.basis, 'company-number'); assert.equal(x.contractor.via.state, 'STRONG_MATCH', 'the chain inherits the weakest link');
  assert.equal(x.contractor.sites.active, 1); assert.match(x.contractor.sites.interpretation.en, /not completed units/);
  const z = ddOf(dev('dev-z', 'זטא קבלנות בע"מ')); assert.equal(z.contractor.sites.enforcement.sanctions, 1); assert.equal(z.signals.find((s) => s.id === 'SITE_ENFORCEMENT').kind, 'watch');
});
t('§20 SPV / joint winner: a joint string is not one entity; each party resolved; the SPV is stated NOT resolvable', () => {
  const x = ddOf(dev('dev-j', 'אלפא בנייה בע"מ, בטא נדל"ן בע"מ'));
  assert.equal(x.identity.resolution.state, 'UNRESOLVED'); assert.deepEqual(x.identity.resolution.parties.map((p) => p.state), ['STRONG_MATCH', 'STRONG_MATCH']);
  assert.equal(R.ENTITY_MODEL.PROJECT_SPV.coverage, 'NONE');
});
t('§20 matched by tender / plan / official id: the lot\'s links are VERIFIED exact keys; MARKETING NAME ≠ PLANNING IDENTITY', () => {
  const p = prj(lot('ila:1:L1', { planLots: ['תא/1|12'], parcels: ['6000/5'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), ddOf(dev('dev-a', 'אלפא בנייה בע"מ')));
  assert.deepEqual(p.identity.links.filter((l) => ['TENDER', 'LOT', 'PLAN', 'BLOCK_PARCEL'].includes(l.type)).map((l) => l.state), ['VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED']);
  const m = prj({ id: 'moch:1', kind: 'moch-lottery-project', projectId: 1, name: 'LOFT', localityCode: 5000, developerIds: ['dev-a'], lotteries: [], stage: { furthest: 'marketed', evidence: [] } }, null);
  const mk = m.identity.links.find((l) => l.type === 'MARKETING_NAME'); assert.equal(mk.id, null); assert.equal(mk.state, null); assert.match(mk.note.en, /not an identity/);
  const m2 = prj({ id: 'moch:2', kind: 'moch-lottery-project', projectId: 2, name: 'LOFT', localityCode: 3000, developerIds: ['dev-a'], lotteries: [], stage: { furthest: 'marketed', evidence: [] } }, null);
  assert.notEqual(m.identity.ids.project, m2.identity.ids.project, 'the same marketing name in two cities is two projects');
});
t('§20 start + completion · PERMIT ≠ START: a STRONG Tel Aviv site (holder = developer, after the award) moves the ladder: permitted 2025-06-01 → started 2026-02-01; the 2015 site on the same parcel is parcel history', () => {
  const p = prj(lot('ila:1:L1', { parcels: ['6000/5'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), ddOf(dev('dev-a', 'אלפא בנייה בע"מ')));
  const r = Object.fromEntries(p.ladder.rungs.map((x) => [x.stage, x]));
  assert.equal(r.permitted.evidenced, true); assert.equal(r.permitted.date, '2025-06-01'); assert.equal(r['construction-started'].date, '2026-02-01'); assert.equal(r.completed.evidenced, false);
  assert.equal(p.ladder.furthest, 'construction-started');
  assert.deepEqual(p.sites.tlv.map((s) => [s.id, s.matchState]), [['site:tlv:T-1', 'STRONG_MATCH']]);
  assert.deepEqual(p.sites.parcelHistory.map((h) => h.id).sort(), ['permit:tlv:20140001', 'site:tlv:T-0']);
  assert.ok(p.sites.parcelHistory.every((h) => h.reasons[0].code === 'PRE_AWARD_ACTIVITY'));
  assert.ok(!p.timeline.some((e) => e.date === '2015-05-01'), 'parcel history never reaches the project timeline');
});
t('§20 permit without construction: a STRONG permit with no start date → "permitted" only; construction-started stays unevidenced', () => {
  const p = prj(lot('ila:1:L2', { parcels: ['6100/7'], developerId: 'dev-b', developerName: 'בטא נדל"ן בע"מ' }), ddOf(dev('dev-b', 'בטא נדל"ן בע"מ')));
  const r = Object.fromEntries(p.ladder.rungs.map((x) => [x.stage, x])); assert.equal(r.permitted.evidenced, true); assert.equal(r['construction-started'].evidenced, false); assert.equal(p.ladder.furthest, 'permitted');
});
t('§20 same parcel, no second key: a site by another holder after the award is POSSIBLE — on the timeline, labelled, never on the ladder', () => {
  const p = prj(lot('ila:1:L3', { parcels: ['6200/9'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), ddOf(dev('dev-a', 'אלפא בנייה בע"מ')));
  assert.equal(p.sites.tlv[0].matchState, 'POSSIBLE_MATCH'); assert.equal(p.ladder.furthest, 'land-awarded'); assert.equal(p.ladder.possibleNotOnLadder, 2);
  assert.ok(p.timeline.some((e) => e.entity === 'site:tlv:T-3' && e.onLadder === false && /possible link only/.test(e.label.en)));
});
t('§20 municipal permits in one city: every Tel Aviv record carries TEL AVIV MUNICIPAL COVERAGE; a lot elsewhere says no machine-readable permits source', () => {
  const p = prj(lot('ila:1:L1', { parcels: ['6000/5'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), ddOf(dev('dev-a', 'אלפא בנייה בע"מ')));
  assert.ok([...p.sites.tlv, ...p.permits].every((x) => x.coverage.en === 'TEL AVIV MUNICIPAL COVERAGE'));
  const q = prj(lot('ila:1:L9', { localityCode: 9000, city: 'באר שבע' }), null);
  assert.ok(q.missing.some((m) => m.id === 'permits-outside-tlv')); assert.equal(q.ladder.rungs.find((r) => r.stage === 'permitted').coverage.en, 'NO COVERAGE');
});
t('§20 multiple cities / same street: a lot number in a site name joins only inside the same locality; several plan|lot pairs → AMBIGUOUS; a non-residential site is excluded', () => {
  const one = prj(lot('ila:1:B1', { localityCode: 9000, city: 'באר שבע', planLots: ['תמל/1|12'] }), null, { lotIdx: lotIdx({ '9000|12': ['תמל/1|12'] }) });
  assert.deepEqual(one.sites.labour.map((s) => [s.id, s.matchState]), [['site:labor:2', 'POSSIBLE_MATCH']]); assert.deepEqual(one.sites.excluded.map((x) => x.reasons[0].code), ['BUILD_TYPE_CONFLICT']);
  const two = prj(lot('ila:1:B1', { localityCode: 9000, city: 'באר שבע', planLots: ['תמל/1|12'] }), null, { lotIdx: lotIdx({ '9000|12': ['תמל/1|12', 'במ/7|12'] }) });
  assert.equal(two.sites.labour[0].matchState, 'AMBIGUOUS'); assert.equal(two.contractors.length, 0, 'an ambiguous site names no contractor of the project');
  const other = prj(lot('ila:1:H1', { localityCode: 6600, city: 'חולון', planLots: ['חל/1|12'] }), null, { lotIdx: lotIdx({}) }); assert.equal(other.sites.labour.length, 0);
});
t('§20 executing contractor: a parcel in the site name + the executor\'s company = the developer\'s → STRONG; the executor is the developer, not merely "a contractor"', () => {
  const p = prj(lot('ila:1:L5', { parcels: ['7000/1'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), ddOf(dev('dev-a', 'אלפא בנייה בע"מ')));
  const s = p.sites.labour[0]; assert.equal(s.matchState, 'STRONG_MATCH'); assert.ok(s.reasons.some((r) => r.code === 'EXECUTOR_IS_DEVELOPER_COMPANY')); assert.equal(s.executor.isDeveloper, true);
  const st = p.ladder.rungs.find((r) => r.stage === 'construction-started'); assert.equal(st.evidenced, true); assert.equal(st.date, null, 'the source publishes no start date'); assert.equal(st.ddAsOf, '2026-09-01');
});
t('§20 stale evidence · NO LATER PUBLIC EVIDENCE ≠ STOPPED: an award in 2020 and nothing after → the EXECUTION GAP rule fires, the words never say stalled / failed / delayed', () => {
  const p = prj(lot('ila:1:OLD', { decisionDate: '2020-01-01', localityCode: 6600, stage: { furthest: 'land-awarded', evidence: [{ stage: 'land-awarded', date: '2020-01-01', source: 'rmi:michrazim' }] } }), null);
  assert.equal(p.executionGap.fires, true); assert.ok(p.executionGap.value >= 18); assert.match(p.noLaterEvidence.statement.en, /NO LATER PUBLIC EVIDENCE FOUND/); assert.match(p.noLaterEvidence.notA.en, /not "stalled", "failed" or "delayed"/);
  languageGate(p, 'stale project'); const b = BR.brief({ project: p }); assert.ok(b.items.some((i) => i.id === 'execution-gap' && i.category === 'DERIVED_SIGNAL'));
});
t('§19 MISSING ≠ ZERO: an unmeasured velocity has no median; an undated project has no gap value; never 0', () => {
  const x = ddOf(dev('dev-a', 'אלפא בנייה בע"מ')); assert.equal(x.execution.velocity.measurable, false); assert.equal(x.execution.velocity.medianMonths, undefined);
  const p = prj({ id: 'moch:9', kind: 'moch-lottery-project', projectId: 9, localityCode: 5000, developerIds: [], lotteries: [], stage: { furthest: null, evidence: [] } }, null);
  assert.equal(p.executionGap.value, null); assert.equal(p.lastDatedEvidence, null);
});
t('§20 conflicting ids · conflict: two candidates for one name stay side by side in the brief and the evidence graph (CANDIDATE_OF, never RESOLVED_TO)', () => {
  const x = ddOf(dev('dev-g', 'גמא יזמות בע"מ')); const g = EV.graph({ developer: x });
  assert.equal(g.edges.filter((e) => e.type === 'RESOLVED_TO').length, 0); assert.equal(g.edges.filter((e) => e.type === 'CANDIDATE_OF' && e.matchState === 'AMBIGUOUS').length, 2);
});
t('§7 evidence graph: every edge carries type · source · source id · dates · class · match state · reasons · limitations', () => {
  const d = ddOf(dev('dev-a', 'אלפא בנייה בע"מ')); const p = prj(lot('ila:1:L1', { parcels: ['6000/5'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), d);
  const g = EV.graph({ developer: d, project: p });
  for (const e of g.edges) { for (const k of ['type', 'from', 'to', 'source', 'sourceId', 'dates', 'cls', 'matchState', 'reasons', 'limitations']) assert.ok(k in e, e.type + ' missing ' + k); assert.ok(Array.isArray(e.reasons)); }
  assert.ok(g.edges.some((e) => e.type === 'PARCEL_HISTORY' && e.to === 'site:tlv:T-0'), 'prior activity is its own edge type');
  assert.ok(!g.edges.some((e) => e.type === 'LINKED_SITE' && e.to === 'site:tlv:T-0'));
});
t('§13 the RISK & GAP BRIEF: six separate categories; every item why · confirms · disproves · verify next; never a recommendation', () => {
  const d = ddOf(dev('dev-d', 'דלתא הנדסה בע"מ')); const p = prj(lot('ila:1:OLD', { decisionDate: '2020-01-01', developerId: 'dev-d', developerName: 'דלתא הנדסה בע"מ' }), d);
  const b = BR.brief({ project: p, developer: d });
  assert.deepEqual(Object.keys(b.categories), ['VERIFIED_FACT', 'DERIVED_SIGNAL', 'MISSING_EVIDENCE', 'SOURCE_LIMITATION', 'ENTITY_AMBIGUITY', 'SOURCE_CONFLICT']);
  for (const i of b.items) for (const k of ['why', 'confirms', 'disproves', 'verify']) assert.ok(i[k] && i[k].he != null && i[k].en != null, i.id + ' ' + k);
  assert.ok(b.items.some((i) => i.category === 'VERIFIED_FACT' && i.id === 'insolvency'), 'an open court case is a verified fact');
  assert.ok(!/\b(buy|sell|avoid|recommend)\b/i.test(JSON.stringify(b.items.map((i) => i.text.en))));
  languageGate(b, 'brief');
});
t('§14 NEXT BEST EVIDENCE: ranked by usefulness with the three flags; the user-provided company number leads an unverified identity', () => {
  const d = ddOf(dev('dev-a', 'אלפא בנייה בע"מ')); const p = prj(lot('ila:1:L9', { localityCode: 9000 }), d);
  const nb = BR.nextBestEvidence({ project: p, developer: d }); const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  for (let i = 1; i < nb.items.length; i++) assert.ok(rank[nb.items[i - 1].usefulness] >= rank[nb.items[i].usefulness]);
  for (const i of nb.items) assert.deepEqual(Object.keys(i.flags), ['retrievableByPropx', 'userProvided', 'monitorable']);
  assert.deepEqual(nb.items.slice(0, 3).map((i) => i.id), ['company-number', 'spv-identity', 'permit']);
});
t('§18 WATCH: no change → NO_CHANGE (said as "no change observed on these keys"); a registrar status change on the watched company → MATERIAL_CHANGE with old and new', () => {
  const a = W.watchContract({ developer: ddOf(dev('dev-a', 'אלפא בנייה בע"מ')), cache: C, since: '2026-10-01' }); assert.equal(a.state, 'NO_CHANGE'); assert.match(a.honest.en, /no autonomous agent/);
  const d = W.watchContract({ developer: ddOf(dev('dev-d', 'דלתא הנדסה בע"מ')), cache: C, since: '2026-10-01' }); assert.equal(d.state, 'MATERIAL_CHANGE'); assert.equal(d.changes[0].old, 'פעילה'); assert.equal(d.changes[0].new, 'בפרוק ע~י בימ~ש');
  assert.ok(d.notDetectable.some((x) => /outside Tel Aviv/.test(x.en))); assert.ok(d.detectable.every((x) => x.source && x.key));
  assert.equal(W.watchContract({ developer: ddOf(dev('dev-d', 'דלתא הנדסה בע"מ')), cache: C, since: '2026-10-20' }).state, 'NO_CHANGE', 'since after the event');
});
t('§20 missing source: no synced data → the resolution says REGISTRY_NOT_SYNCED; the developer read lists it as missing; nothing defaults', () => {
  const E = D.load({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'propx-dd-empty-')) });
  const x = DEV.developerDD(dev('dev-a', 'אלפא בנייה בע"מ'), E, { now: NOW });
  assert.equal(x.identity.resolution.reasons[0].code, 'REGISTRY_NOT_SYNCED'); assert.ok(x.missing.some((m) => m.id === 'dd-not-synced')); assert.equal(x.contractor.state, 'NOT_SYNCED');
  assert.equal(W.watchContract({ developer: x, cache: E }).state, 'NOT_AVAILABLE');
});
t('the summary sentences are declarative, classed, bilingual, and pass the language gate', () => {
  const d = ddOf(dev('dev-a', 'אלפא בנייה בע"מ')); const p = prj(lot('ila:1:L1', { parcels: ['6000/5'], developerId: 'dev-a', developerName: 'אלפא בנייה בע"מ' }), d);
  for (const s of p.summary) { assert.ok(s.he && s.en && s.cls, s.id); }
  assert.match(p.summary.find((s) => s.id === 'who').en, /legal company 510000001 .*STRONG MATCH by name/);
  assert.match(p.summary.find((s) => s.id === 'sites').en, /1 linked sites .* 0 possible .* 2 parcel-history records/);
  languageGate(p, 'summary');
});

t('sync history: the first read of a newly kept company is never an event; duplicate rows of one Tel Aviv request are compared as a group; retracted runs are skipped', () => {
  const SY = require('../lib/dd/sync'), RT = require('../lib/dd/retractions');
  const prev = { rows: [{ num: 1, kind: 'רישום שעבוד', kindCode: 68, date: '2026-01-01', chargeId: 1 }] };
  const next = { rows: prev.rows.concat([{ num: 1, kind: 'סילוק שעבוד', kindCode: 70, date: '2026-02-01', chargeId: 1 }, { num: 2, kind: 'רישום שעבוד', kindCode: 68, date: '2025-11-01', chargeId: 9 }]) };
  assert.deepEqual(SY.diffFilings(prev, next, 'T', new Set(['1'])).map((e) => [e.event, e.key]), [['charge-removed', 'co:1']], 'company 2 was not kept before — its filings are a baseline');
  const tp = (rows) => ({ permits: { rows }, sites: { rows: [] } });
  const dup = [{ request: 7, stage: 'בבניה', permitDate: '2025-01-01' }, { request: 7, stage: 'קיימת לפחות תעודת גמר אחת', permitDate: '2025-01-01' }];
  assert.deepEqual(SY.diffTlv(tp(dup), tp(dup.slice().reverse()), 'T'), [], 'the same rows in another order are no change');
  assert.equal(SY.diffTlv(tp(dup), tp([dup[0], { ...dup[1], stage: 'קיים אכלוס' }]), 'T')[0].event, 'permit-stage-changed');
  assert.equal(RT.isRetracted({ at: '2026-10-18T10:24:33.459Z', lane: 'filings' }), true); assert.equal(RT.isRetracted({ at: '2026-10-19T05:00:00.000Z', lane: 'filings' }), false);
  for (const r of RT.RETRACTED) { assert.ok(r.reason.he && r.reason.en && r.fix); }
});
t('§15 explainability: every DD signal id has a rule, every DD missing id a reason, every DD term a level-2 entry (lib/explain/registry.js)', () => {
  const X = require('../lib/explain/registry');
  const sig = ['ENTITY_AMBIGUOUS', 'ENTITY_UNRESOLVED', 'COURT_LIQUIDATION_STATUS', 'COMPANY_NOT_ACTIVE', 'COURT_LIQUIDATION_PROCEEDING', 'VOLUNTARY_LIQUIDATION_LISTED', 'BREACH_FLAG', 'ANNUAL_REPORT_LAG', 'CHARGE_ACTIVITY', 'NO_PUBLIC_FINANCIALS', 'REGISTERED_CONTRACTOR', 'SITE_ENFORCEMENT', 'SITE_CLOSURE_NOTICE', 'POSSIBLE_SAME_ENTITY', 'EXECUTION_GAP'];
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dd', 'developer.js'), 'utf8'); for (const m of src.matchAll(/add\('([A-Z_]+)'/g)) assert.ok(sig.includes(m[1]), 'unlisted DD signal ' + m[1]);
  for (const id of sig) { const r = X.SIGNAL_RULES[id]; assert.ok(r, 'no rule for ' + id); assert.ok(X.term(r.term), id + ' → ' + r.term); }
  const devMiss = ddOf(dev('dev-a', 'אלפא בנייה בע"מ')).missing.map((m) => m.id); const prjMiss = prj(lot('ila:1:L9', { localityCode: 9000 }), null).missing.map((m) => m.id);
  for (const id of new Set([...devMiss, ...prjMiss, 'dd-not-synced'])) assert.ok(X.missing(id, 'en'), 'no missing-data reason for ' + id);
  for (const id of ['entity_match_state', 'legal_company', 'developer_brand', 'project_spv', 'charge_lien', 'insolvency_proceeding', 'voluntary_liquidation', 'breach_flag', 'registry_status', 'financial_resilience_coverage', 'registered_contractor', 'active_construction_site', 'municipal_permit_record', 'parcel_match', 'parcel_history', 'dd_stage_ladder', 'no_later_public_evidence', 'execution_gap', 'execution_velocity', 'coverage_label', 'risk_gap_brief', 'dd_next_best_evidence', 'watch_contract', 'dd_evidence_graph']) assert.ok(X.level2(id, 'en'), id);
  assert.match(X.level2('charge_lien', 'en').notAs, /Not distress/); assert.match(X.level2('financial_resilience_coverage', 'en').short, /PUBLIC FINANCIAL DATA NOT AVAILABLE IN CURRENT COVERAGE/);
});

/* ---- the real synced data (skipped before the first sync) ---- */
const REAL = D.load();
if (REAL.synced) {
  const Q = require('../lib/entities/query'); const L = Q.load();
  t('real data: no developer is VERIFIED without a number (no PROPX source carries one); every STRONG MATCH has exactly one candidate', () => {
    const dist = {};
    for (const d of L.devById.values()) { const r = R.resolveCompany({ id: d.id, canonical: d.canonical, kind: d.kind, joint: d.joint }, REAL.idx); dist[r.state] = (dist[r.state] || 0) + 1; if (r.state === 'STRONG_MATCH') assert.equal(r.candidates.length, 1, d.canonical); }
    assert.equal(dist.VERIFIED || 0, 0); assert.ok((dist.STRONG_MATCH || 0) > 1000, 'the registry resolves a large share by name');
  });
  t('real data: no awarded lot moves its ladder on a POSSIBLE / AMBIGUOUS link, and no linked Tel Aviv site has every dated activity before the award', () => {
    const lotIdxR = D.lotIndex(L.landById.values(), L.stamp);
    for (const p of L.projById.values()) { if (p.kind !== 'ila-awarded-lot') continue; const S = PRJ.sitesOf(p, REAL, { lotIdx: lotIdxR });
      for (const x of [...S.tlv, ...S.labour, ...S.permits]) assert.equal(x.onLadder, x.matchState === 'STRONG_MATCH', p.id + ' ' + x.id);
      for (const s of S.tlv) { const ds = [s.start].filter(Boolean); if (p.decisionDate && ds.length && S.permits.filter((x) => x.viaSite === s.id).length === 0) assert.ok(ds[0] >= String(p.decisionDate).slice(0, 10) || s.matchState !== 'STRONG_MATCH', p.id); } }
  });
  t('real data: the developer and project reads pass the language gate (three developers, their lots)', () => {
    const X = require('../lib/dd');
    for (const id of ['dev-69edd3ba1aec', 'dev-d23c21a9650e', 'dev-2eda15c3a337']) { if (!L.devById.has(id)) continue; const a = X.developer(id); languageGate(a, id); const s = a.dd.identity.resolution.state; assert.ok(['STRONG_MATCH', 'POSSIBLE_MATCH', 'AMBIGUOUS', 'UNRESOLVED'].includes(s)); }
    const p = X.project('ila:20210310:0000800008476'); if (p) { languageGate(p, 'project'); assert.ok(p.dd.summary.length >= 5); }
  });
}
console.log(`dd: ${n} gates passed${REAL.synced ? '' : ' (real-data gates skipped: data/dd not synced)'}`);
