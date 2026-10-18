'use strict';
/* SPONSOR X-RAY — DEVELOPER GROUP INTELLIGENCE gates (19.10.2026): lib/group over the REAL synced data (lib/entities registry, data/dd),
   with the user's documents as the labelled TEST FIXTURE test/fixtures/group-fixture.js (fictional relations and figures).

   The 14 hard truths: BRAND ≠ LEGAL COMPANY · PARENT ≠ GUARANTOR · SUBSIDIARY ≠ SPV · LAND WINNER ≠ PROJECT COMPANY · CONTRACTOR ≠
   DEVELOPER · ACTIVE SITE ≠ COMPLETED · LAND PIPELINE ≠ ACTIVE CONSTRUCTION · AWARDED ≠ SOLD · PIPELINE SIZE ≠ FINANCIAL CAPACITY · HIGH
   LEVERAGE ≠ DEFAULT · CHARGE ≠ DISTRESS · NO FINANCIALS ≠ WEAKNESS · NO LATER EVIDENCE ≠ STALLED · POSSIBLE RELATION ≠ GROUP CONTROL.

   Review gates: no false parent-child link, no SPV leakage, no double-counted project or unit, no total from a POSSIBLE / SHARED link,
   no financial aggregation across entities, no capacity claim, no leverage / legal-event overstatement, no stage inflation, no speed
   label without a comparison basis, clustered evidence (one tender = one observation), determinism, the language gate, every emitted
   term / signal / missing id in the registry, the API, the page wiring, and zero regression of the due-diligence exports.

   The acceptance cases each record what PROPX knows / does not know / what is verified / derived / unresolved / what the user sees first
   / what to verify next (GROUP_ACCEPTANCE_OUT=<file> writes them as JSON). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/group');
const GM = require('../lib/group/model');
const GC = require('../lib/group/cohort');
const GI = require('../lib/group/identity');
const GF = require('../lib/group/finance');
const DD = require('../lib/dd');
const D = require('../lib/dd/data');
const R = require('../lib/entities/resolve');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const at = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const NOW = '2026-10-18T10:00:00.000Z';
const C = D.load();
if (!C.synced) { console.log('group: data/dd not synced — skipped'); process.exit(0); }
const nameOf = (num) => { const r = C.idx.companies.byNumber.get(String(num)); return r ? R.companyFacts(r).name : null; };
const FX = require('./fixtures/group-fixture').build(nameOf, NOW);
const grp = (q, opt = {}) => G.group(q, { now: NOW, ...opt });

/* real anchors (each re-checked below, never assumed) */
const DIMRI = '511399388', PERETZ = '511847337', AMRAM = '513201582', TRIO = '517256376', CONC = '514538917', LANDP = '514604222', OZEN = '511517237', SHVIRO = '512172651', MEGIDDO = '510966518', CONTRACTOR_ONLY = '510125057';
const ASHDAR = 'dev-2354bb806279', AMBIG = 'dev-a1276169dfd7', JOINT = 'dev-e49c53daa50b', NOT_IN = '512345678';
const DIMRI_LOT = 'ila:20250311:0000800032982';

const READ = new Map();
const read = (key, q, opt) => { if (!READ.has(key)) READ.set(key, grp(q, opt)); return READ.get(key); };
const dimri = () => read('dimri', { company: DIMRI });
const docsAll = [...FX.spvDeclarations, FX.ownershipChart, FX.mismatchChart, ...FX.statements, ...FX.statementsOtherEntity, ...FX.bonds, ...FX.litigation];
const dimriDocs = () => read('dimriDocs', { company: DIMRI }, { userDocs: docsAll });

/* every string under a node — the English side of bilingual values and plain strings (source verbatims excluded by key) */
const VERBATIM_KEYS = new Set(['verbatim', 'name', 'label', 'city', 'cityEn', 'statedName', 'nameVerbatim', 'programHe', 'tender', 'kind', 'status', 'state', 'he', 'id', 'code', 'source', 'sources', 'number']);
function strings(o, out = [], key = '') {
  if (o == null) return out;
  if (typeof o === 'string') { if (!VERBATIM_KEYS.has(key)) out.push(o); return out; }
  if (Array.isArray(o)) { for (const x of o) strings(x, out, key); return out; }
  if (typeof o === 'object') { if (typeof o.en === 'string' && typeof o.he === 'string') { out.push(o.en); return out; } for (const [k, v] of Object.entries(o)) strings(v, out, k); }
  return out;
}
const FORBIDDEN = [/\bdistress(ed)?\b/i, /\binsolvent\b/i, /\bstalled\b/i, /\bdelayed\b/i, /probability of default/i, /\boverextended\b/i, /capacity utili[sz]ation/i, /financial health/i, /\bscore\b/i, /\brecommend(s|ed|ation)?\b/i, /\bfailed project/i, /\bweak developer/i];
const NEGATION = /\b(not|never|no|none|nor|without|isn't|does not|is not)\b|≠/i;
function languageGate(out, where) {
  for (const s of strings(out)) for (const re of FORBIDDEN) {
    if (!re.test(s)) continue;
    const sentences = s.split(/(?<=[.;:])\s+|\s—\s/).filter((x) => re.test(x));
    for (const x of sentences) assert.ok(NEGATION.test(x), `${where}: "${x.slice(0, 160)}" uses ${re} without a negation`);
  }
}
/* every term id / signal id / runtime missing id the read emits */
function emitted(out) {
  const terms = new Set(), sigs = new Set();
  (function walk(o, k) { if (o == null) return; if (Array.isArray(o)) return o.forEach((x) => walk(x, k)); if (typeof o === 'object') { for (const [kk, v] of Object.entries(o)) { if (kk === 'term' && typeof v === 'string') terms.add(v); walk(v, kk); } } })(out);
  for (const f of out.deep.formulas) terms.add(f);
  for (const s of out.signals) sigs.add(s.id);
  sigs.add(out.pipelineVsFinancial.statement.id);
  return { terms, sigs };
}

console.log('group: model · registry');
t('the model: version stamped, the 14 truths, 5 tiers (only CORE + DOCUMENTED counted), 8 stage buckets, documented rules — no score field anywhere', () => {
  assert.equal(GM.VERSION.id, 'propx-sponsor-xray-v1'); assert.match(GM.VERSION.effective, /^\d{4}-\d{2}-\d{2}$/);
  const truths = GM.TRUTHS.map((x) => x.en);
  for (const s of ['BRAND ≠ LEGAL COMPANY', 'PARENT ≠ GUARANTOR', 'SUBSIDIARY ≠ SPV', 'LAND WINNER ≠ PROJECT COMPANY', 'CONTRACTOR ≠ DEVELOPER', 'ACTIVE SITE ≠ COMPLETED PROJECT', 'LAND PIPELINE ≠ ACTIVE CONSTRUCTION', 'AWARDED UNITS ≠ SOLD UNITS', 'PIPELINE SIZE ≠ FINANCIAL CAPACITY', 'HIGH LEVERAGE ≠ DEFAULT', 'CHARGE ≠ DISTRESS', 'NO FINANCIALS ≠ FINANCIAL WEAKNESS', 'NO LATER EVIDENCE ≠ PROJECT STALLED', 'POSSIBLE RELATION ≠ GROUP CONTROL']) assert.ok(truths.includes(s), s);
  assert.equal(GM.TRUTHS.length, 14);
  assert.deepEqual(Object.keys(GM.TIERS), ['CORE', 'DOCUMENTED', 'SHARED', 'POSSIBLE', 'AMBIGUOUS']);
  assert.deepEqual(Object.entries(GM.TIERS).filter(([, v]) => v.inTotals).map(([k]) => k), ['CORE', 'DOCUMENTED']);
  assert.deepEqual(GM.BUCKET_IDS, ['LAND', 'MARKETED', 'PERMIT', 'CONSTRUCTION', 'ACTIVE_SITE', 'COMPLETION', 'OCCUPANCY', 'NO_LATER_EVIDENCE']);
  assert.equal(GM.RULES.noLaterEvidenceMonths, 18); assert.ok(GM.RULES.cohortMin >= 30 && GM.RULES.ownMin >= 3);
  const g = dimri(); const keys = new Set(); (function walk(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } })(g);
  for (const k of keys) assert.ok(!/score|rating$|probability|healthIndex|recommend/i.test(k), 'no score-like field: ' + k);
});
t('registry: group "group", source propx:group (alias lib/group), entity type group; every term / signal / missing id a read emits is documented (incl. the spec texts for leverage and high project load)', () => {
  assert.ok(X.GROUPS.some((g) => g.id === 'group'));
  assert.equal(X.canonicalSource('lib/group'), 'propx:group');
  assert.ok(X.ENTITY_TYPES.group && X.ENTITY_TYPES.group.label.en);
  const lev = X.term('understanding_leverage');
  assert.equal(lev.short.en, 'Leverage shows how much borrowed capital the company uses relative to its own capital.');
  assert.equal(lev.why.en, 'Debt can increase returns when projects perform well, but it can also increase downside and refinancing risk.');
  assert.match(lev.notAs.en, /prediction that the company will default/i);
  const load = X.term('high_project_load');
  assert.equal(load.short.en, 'PROPX observes a relatively large number of projects being executed at the same time.');
  assert.equal(load.why.en, 'A larger simultaneous pipeline may require more management, funding and execution capacity.');
  assert.match(load.notAs.en, /proof that the developer is overextended/i);
  for (const id of ['EXECUTION_TIME_IMPROVING', 'EXECUTION_TIME_LENGTHENING', 'HIGH_SIMULTANEOUS_PROJECT_LOAD', 'HIGH_EARLY_STAGE_PIPELINE', 'HIGH_UNFINISHED_OBSERVED_PIPELINE', 'COMPLETION_EVIDENCE_STRONG', 'LIMITED_COMPLETION_EVIDENCE', 'RECENT_PROJECT_ACTIVITY_ACCELERATING', 'RECENT_PROJECT_ACTIVITY_SLOWING', 'NO_LATER_PUBLIC_EVIDENCE_FOUND', 'GROUP_GEOGRAPHIC_CONCENTRATION', 'MATRIX_CELL_CONCENTRATION', 'LARGE_PIPELINE_NO_FINANCIALS', 'LIMITED_PIPELINE_NO_FINANCIALS', 'PIPELINE_WITH_RISING_LEVERAGE', 'PIPELINE_BESIDE_FINANCIAL_POSITION']) assert.ok(X.SIGNAL_RULES[id], 'signal rule ' + id);
  for (const id of ['group-ownership', 'urban-renewal-exposure', 'private-land', 'verified-project-company', 'group-financials', 'project-company-change', 'group-sales']) assert.ok(X.missing(id), 'missing ' + id);
  for (const g of [dimri(), dimriDocs(), read('shviro', { company: SHVIRO }), read('ashdar', { developer: ASHDAR }), read('conc', { company: CONC })]) {
    const E = emitted(g);
    for (const id of E.terms) assert.ok(X.term(id), 'term ' + id);
    for (const id of E.sigs) assert.ok(X.SIGNAL_RULES[id], 'signal ' + id);
    for (const s of g.matrix.observations) assert.ok(X.SIGNAL_RULES[s.id], 'matrix observation ' + s.id);
  }
});

console.log('group: the 14 truths');
t('BRAND ≠ LEGAL COMPANY: brands and the company are separate nodes joined by RESOLVES_TO (with what it does not prove); a name match is STRONG, never VERIFIED; the core status is as strong as its weakest brand link', () => {
  const g = dimri();
  const brands = g.structure.nodes.filter((x) => x.kind === 'DEVELOPER_BRAND'), co = g.structure.nodes.find((x) => x.id === 'co:' + DIMRI);
  assert.ok(brands.length >= 2 && co && co.kind === 'LEGAL_COMPANY');
  const rt = g.structure.edges.filter((e) => e.type === 'RESOLVES_TO');
  assert.equal(rt.length, g.identity.members.filter((m) => m.tier === 'CORE').length);
  for (const e of rt) { assert.equal(e.notProvesKey, 'RESOLVES_TO'); assert.ok(g.structure.notProves.RESOLVES_TO.en); assert.ok(e.reasons.length); assert.equal(e.state, 'STRONG_MATCH'); assert.equal(e.cls, 'DERIVED'); }
  assert.equal(g.identity.status, 'LEGAL_CORE_STRONG');
  assert.equal(g.identity.core.linkState, 'STRONG_MATCH');
  /* a user-provided number makes the anchor brand VERIFIED, labelled USER_ASSUMPTION; the other spellings stay STRONG → status stays STRONG */
  const dev = g.identity.members.find((m) => m.tier === 'CORE').devId;
  const u = grp({ developer: dev }, { companyNumber: DIMRI });
  const ue = u.structure.edges.find((e) => e.type === 'RESOLVES_TO' && e.from === 'brand:' + dev);
  assert.equal(ue.state, 'VERIFIED'); assert.equal(ue.cls, 'USER_ASSUMPTION'); assert.equal(u.identity.core.userProvided, true);
  assert.equal(u.identity.status, 'LEGAL_CORE_STRONG');
  /* a brand that resolves to no company stays a brand: no core, candidates excluded, nothing invented */
  const a = read('ashdar', { developer: ASHDAR });
  assert.equal(a.identity.status, 'BRAND_ONLY'); assert.equal(a.identity.core, null);
  assert.ok(a.portfolio.rows.every((r) => r.legalEntity.number == null));
});
t('PARENT ≠ GUARANTOR: a holding (chart / declaration) creates no GUARANTEES edge; only an explicit parent guarantee in a declaration does, labelled USER_DOCUMENT; the row\'s guarantor is set only there', () => {
  const g = dimriDocs();
  const holds = g.structure.edges.filter((e) => e.type === 'HOLDS' && e.state === 'STRONG_MATCH');
  const gua = g.structure.edges.filter((e) => e.type === 'GUARANTEES');
  assert.ok(holds.length >= 4); assert.equal(gua.length, 1);
  assert.equal(gua[0].to, 'co:' + FX.SPV[0]); assert.equal(gua[0].cls, 'USER_DOCUMENT');
  assert.ok(!gua.some((e) => e.to === 'co:' + FX.CHILD), 'the 100 % holding is not a guarantee');
  assert.match(g.structure.notProves.HOLDS.en, /holding ≠ a guarantee/);
  const rows = g.portfolio.rows.filter((r) => FX.LOTS.includes(r.id));
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.roles.guarantor).length, 1);
  assert.equal(rows.find((r) => r.roles.guarantor).id, FX.LOTS[0]);
  assert.ok(g.structure.rules.some((x) => x.en === 'PARENT ≠ GUARANTOR'));
});
t('SUBSIDIARY ≠ SPV: a held company is SUBSIDIARY; only a declaration naming a project makes PROJECT_SPV; the SPV view counts project companies by the DD rule (never a subsidiary because it is held)', () => {
  const g = dimriDocs();
  const co = new Map(g.identity.companies.map((c) => [c.number, c]));
  assert.equal(co.get(FX.CHILD).role, 'SUBSIDIARY');
  for (const s of FX.SPV) assert.equal(co.get(s).role, 'PROJECT_SPV');
  assert.ok(!g.spv.groups.some((x) => FX.SPV.includes(x.number) && x.state === 'VERIFIED'));
  assert.equal(g.spv.verified, 0);
  assert.ok(g.structure.rules.some((x) => x.en === 'SUBSIDIARY ≠ SPV'));
});
t('LAND WINNER ≠ PROJECT COMPANY: no row has a VERIFIED project company (no official project-level number in coverage); a document naming another company is a CONFLICT, never adopted', () => {
  for (const g of [dimri(), dimriDocs(), read('ozen', { company: OZEN })]) {
    assert.ok(g.portfolio.rows.every((r) => r.projectCompany.state !== 'VERIFIED'));
    assert.equal(g.spv.verified, 0);
    for (const r of g.portfolio.rows) if (r.roles.landWinner) assert.ok(r.roles.landWinner.name, 'the land winner is a role apart');
  }
  const rows = dimriDocs().portfolio.rows.filter((r) => FX.LOTS.includes(r.id));
  for (const r of rows) { assert.notEqual(r.projectCompany.state, 'STRONG_MATCH'); assert.ok(r.projectCompany.conflict, r.id + ' conflict kept'); assert.ok(!FX.SPV.includes(r.projectCompany.number)); }
  assert.ok(dimriDocs().spv.conflicts.length >= 3);
});
t('CONTRACTOR ≠ DEVELOPER: a company registered only as a contractor has no portfolio (COMPANY_ONLY); its executor sites are context, never rows; the core\'s own executor sites are not counted', () => {
  const k = read('contractor', { company: CONTRACTOR_ONLY });
  assert.equal(k.identity.status, 'COMPANY_ONLY'); assert.equal(k.portfolio.total, 0);
  assert.ok(k.identity.contractor && k.identity.contractor.activeSitesAsExecutor >= 0);
  assert.match(k.identity.contractor.note.en, /execution ≠ development/);
  const g = dimri();
  assert.ok(g.identity.contractor.activeSitesAsExecutor > 0);
  assert.ok(g.structure.edges.filter((e) => e.type === 'REGISTERED_AS_CONTRACTOR').every((e) => e.notProvesKey === 'REGISTERED_AS_CONTRACTOR'));
  assert.equal(g.portfolio.total, g.portfolio.byUniverse.ila + g.portfolio.byUniverse.moch, 'rows = projects only');
});
t('ACTIVE SITE ≠ COMPLETED: across the national cohort an ACTIVE_SITE / CONSTRUCTION record never carries completion evidence; a stale MoCH start is never "active"', () => {
  const K = DD.ctx({ now: NOW }); const Co = GC.cohort(K);
  let active = 0;
  for (const f of Co.facts.values()) {
    if (f.bucket === 'ACTIVE_SITE' || f.bucket === 'CONSTRUCTION') { assert.ok(!f.completion.evidenced && !f.occupied.evidenced, f.id); }
    if (f.bucket === 'ACTIVE_SITE') { active++; assert.ok(f.start.current && !f.start.stale, f.id + ' current'); assert.ok(f.sites.currentLabour.length + f.sites.currentTlv.length > 0); }
    if (f.start.stale) assert.notEqual(f.bucket, 'ACTIVE_SITE');
  }
  assert.ok(active >= 0);
});
t('LAND PIPELINE ≠ ACTIVE CONSTRUCTION · AWARDED ≠ SOLD: lots won and execution evidence are separate quantities; a LAND row has no start evidence; no "sold" figure exists without a document', () => {
  const g = dimri();
  assert.ok(g.land.lotsWon >= g.load.executionEvidence.lots);
  for (const r of g.portfolio.rows.filter((x) => x.bucket === 'LAND')) assert.ok(!r.start.evidenced && !r.permit.evidenced);
  const lt = g.land.truths.map((x) => x.en).join(' | ');
  for (const s of ['LAND WON ≠ PROJECT UNDER CONSTRUCTION', 'LAND PIPELINE ≠ REVENUE', 'UNITS AWARDED ≠ UNITS SOLD']) assert.ok(lt.includes(s), s);
  assert.ok(!JSON.stringify(g.top).match(/"sold"|unitsSold/));
  assert.ok(!JSON.stringify(g.land).match(/"sold"|unitsSold|revenue":/));
});
t('PIPELINE SIZE ≠ FINANCIAL CAPACITY: without statements the comparison says coverage is insufficient; no ratio across official land sums and document cash; never "can / cannot carry"', () => {
  const g = dimri();
  assert.equal(g.pipelineVsFinancial.statement.id, 'LARGE_PIPELINE_NO_FINANCIALS');
  assert.equal(g.pipelineVsFinancial.statement.text.en, 'Large visible pipeline; current public financial coverage is insufficient to assess funding capacity.');
  assert.equal(g.pipelineVsFinancial.financial, null);
  const keys = JSON.stringify(Object.keys(g.pipelineVsFinancial.pipeline)) + JSON.stringify(Object.keys(dimriDocs().pipelineVsFinancial.financial));
  assert.ok(!/ratio|coverage|capacity|months/i.test(keys), 'no cross-universe ratio: ' + keys);
  assert.match(g.pipelineVsFinancial.notA.en, /not a solvency model/);
  assert.equal(read('trio', { company: TRIO }).pipelineVsFinancial.statement.id, 'LIMITED_PIPELINE_NO_FINANCIALS');
});
t('HIGH LEVERAGE ≠ DEFAULT: rising leverage in the fixture statements is a flag with the comparable period, the leverage explainer carries the spec texts and the "not a prediction" line; no scenario on invented inputs', () => {
  const g = dimriDocs();
  const core = g.financial.entities.find((e) => e.number === DIMRI);
  assert.ok(core.profile.flags.some((f) => f.id === 'LEVERAGE_INCREASED'));
  assert.equal(core.change.available, true); assert.equal(core.change.then.end, '2024-12-31'); assert.equal(core.change.now.end, '2025-12-31');
  assert.equal(core.leverage.intro.short.en, 'Leverage shows how much borrowed capital the company uses relative to its own capital.');
  assert.equal(core.leverage.intro.notAs.en, 'Not a prediction that the company will default.');
  assert.match(core.leverage.noScenario.en, /no hypothetical scenario on invented inputs/);
  assert.ok(g.financial.rules.some((x) => x.en === 'HIGH LEVERAGE ≠ DEFAULT'));
  /* a period without its comparable shows no change, and says why */
  const one = grp({ company: DIMRI }, { userDocs: [FX.statements[1]] }).financial.entities.find((e) => e.number === DIMRI);
  assert.equal(one.change.available, false); assert.match(one.change.reason.en, /no comparable period/);
});
t('CHARGE ≠ DISTRESS: every charge event carries the CHARGE ≠ DISTRESS statement; charges never enter the risk brief as distress; the legal timeline is the exact entity only', () => {
  const g = dimri();
  const ch = g.legal.events.filter((e) => /^charge-(registered|updated|removal-cancelled)$/.test(e.kind));   /* a removal is not a charge standing */
  assert.ok(ch.length > 0);
  for (const e of ch) assert.match(JSON.stringify(e.notA), /CHARGE ≠ DISTRESS/);
  for (const e of g.legal.events) assert.equal(String(e.entity && (e.entity.number || e.entity)).replace(/\D/g, '').slice(0, 9) || DIMRI, DIMRI);
  assert.ok(!g.brief.items.some((i) => /charge/i.test(i.id) && i.category === 'DERIVED_SIGNAL'));
  assert.match(g.legal.exactEntityOnly.en, /exact entity/);
});
t('NO FINANCIALS ≠ WEAKNESS: a group without statements reads financial coverage MISSING with the reason (public sources refuse a non-browser client), never a weakness flag or a negative signal', () => {
  const g = read('peretz', { company: PERETZ });
  assert.equal(g.financial.cls, 'MISSING'); assert.equal(g.financial.coverage, 'NOT_IN_COVERAGE');
  assert.match(g.financial.statement.en, /does not currently have machine-readable audited financial statements/);
  assert.ok(g.financial.rules.some((x) => x.en === 'NO FINANCIALS ≠ FINANCIAL WEAKNESS'));
  for (const e of g.financial.entities) assert.ok(!e.profile.flags.some((f) => /WEAK|INCREASED|NEGATIVE/.test(f.id)), 'no flag without statements');
  assert.ok(!g.signals.some((s) => /FINANC|LEVERAGE/.test(s.id)));
  const gap = g.brief.items.find((i) => /financ/i.test(i.id));
  assert.ok(gap && gap.category === 'MISSING_EVIDENCE', 'missing financials are a missing-evidence item');
});
t('NO LATER EVIDENCE ≠ STALLED: the evidence-gap signal is informational, names its projects and the 18-month rule, and says it is not stalled / failed / delayed', () => {
  const g = dimri();
  const s = g.signals.find((x) => x.id === 'NO_LATER_PUBLIC_EVIDENCE_FOUND');
  assert.ok(s); assert.equal(s.kind, 'info'); assert.equal(s.cls, 'DERIVED');
  assert.ok(s.projects.length && s.projectsTotal === s.value);
  assert.match(s.threshold, /18 months/);
  assert.ok(s.limitations.some((l) => /not "stalled"/i.test(l.en) || /never stalled/i.test(l.en) || /not stalled/i.test(l.en)), 'the limitation says it is not stalled');
  assert.ok(g.truths.some((x) => x.en === 'NO LATER EVIDENCE ≠ PROJECT STALLED'));
});
t('POSSIBLE RELATION ≠ GROUP CONTROL: POSSIBLE / AMBIGUOUS spellings, candidates and a document party whose name differs are excluded — never members, never expanded, never in totals', () => {
  const g = dimriDocs();
  const possible = g.identity.excluded;
  assert.ok(possible.length >= 6);
  assert.ok(possible.some((x) => x.number === FX.OTHER && x.relation === 'HOLDS' && x.tier === 'POSSIBLE'));
  assert.ok(!g.identity.companies.some((c) => c.number === FX.OTHER), 'the mismatched party is not a group company');
  const other = read('other', { company: FX.OTHER });
  const otherIds = new Set(other.portfolio.rows.map((r) => r.id));
  assert.ok(otherIds.size > 0);
  assert.ok(!g.portfolio.rows.some((r) => otherIds.has(r.id)), 'none of its projects enter the totals');
  const excludedDevs = new Set(possible.map((x) => x.devId).filter(Boolean));
  for (const r of g.portfolio.rows) assert.ok(r.members.every((m) => !excludedDevs.has(m.devId)));
  const amb = read('ambig', { developer: AMBIG });
  assert.equal(amb.identity.status, 'BRAND_ONLY'); assert.equal(amb.identity.core, null);
  assert.ok(amb.identity.excluded.length >= 2 && amb.identity.excluded.every((x) => x.tier === 'AMBIGUOUS' || x.tier === 'POSSIBLE'));
});

console.log('group: review gates');
t('no double counting: every project once (unique record ids), stage buckets sum to the records per universe, units per bucket sum to the known units, the two universes never added; the headline equals the portfolio', () => {
  for (const g of [dimri(), dimriDocs(), read('amram', { company: AMRAM }), read('shviro', { company: SHVIRO }), read('ozen', { company: OZEN })]) {
    const ids = g.portfolio.rows.map((r) => r.id); assert.equal(new Set(ids).size, ids.length);
    for (const u of ['ila', 'moch']) {
      const xs = g.portfolio.rows.filter((r) => r.universe === u);
      assert.equal(g.stages[u].records, xs.length);
      assert.equal(Object.values(g.stages[u].buckets).reduce((s, b) => s + b.n, 0), xs.length);
      const known = xs.filter((r) => r.units != null).reduce((s, r) => s + r.units, 0);
      assert.equal(Object.values(g.stages[u].buckets).reduce((s, b) => s + (b.units || 0), 0), known);
      assert.equal(g.top.observedProjects[u], xs.length);
    }
    assert.ok(!('total' in g.top.observedUnits) && !('all' in g.top.observedUnits), 'units are never added across universes');
    const sharedIds = new Set(g.shared.rows.map((r) => r.id));
    assert.ok(!ids.some((id) => sharedIds.has(id)), 'a SHARED row is never in the portfolio');
    assert.ok(g.portfolio.rows.every((r) => r.tier === 'CORE' || r.tier === 'DOCUMENTED'));
  }
});
t('SHARED joint awards are listed apart with every party, never added; a group read anchored on a project equals the read of its developer\'s group', () => {
  const s = read('shviro', { company: SHVIRO });
  assert.ok(s.shared.total > 0 && s.shared.rows.every((r) => r.tier === 'SHARED'));
  assert.ok(s.identity.shared.every((x) => x.relation === 'JOINT_AWARD_PARTY' && Array.isArray(x.parties)));
  assert.ok(s.structure.edges.filter((e) => e.type === 'JOINT_AWARD_PARTY').every((e) => e.notProvesKey === 'JOINT_AWARD_PARTY'));
  const p = grp({ project: DIMRI_LOT }); const d = dimri();
  assert.equal(p.identity.core.number, DIMRI);
  assert.deepEqual(p.portfolio.rows.map((r) => r.id).sort(), d.portfolio.rows.map((r) => r.id).sort());
  assert.equal(p.anchor.project.id, DIMRI_LOT);
});
t('the furthest verified stage never inflates: a row\'s bucket matches its evidenced rungs; only rungs with evidence are listed; COMPLETION needs completion evidence', () => {
  const g = read('ozen', { company: OZEN });
  for (const r of g.portfolio.rows) {
    const st = new Set(r.rungs.map((x) => x.stage));
    if (r.bucket === 'COMPLETION') assert.ok(r.completion.evidenced && st.has('completed'), r.id);
    if (r.bucket === 'OCCUPANCY') assert.ok(r.occupied.evidenced, r.id);
    if (r.bucket === 'CONSTRUCTION' || r.bucket === 'ACTIVE_SITE') assert.ok(r.start.evidenced, r.id);
    if (r.bucket === 'PERMIT') assert.ok(r.permit.evidenced, r.id);
    if (r.bucket === 'LAND' || r.bucket === 'MARKETED' || r.bucket === 'NO_LATER_EVIDENCE') assert.ok(!r.start.evidenced && !r.completion.evidenced, r.id);
  }
});
t('clustered evidence: one tender = one observation — Shviro\'s lots from one tender fire no load / unfinished / lengthening signal; every load / trend signal names ≥ 2 tenders', () => {
  const s = read('shviro', { company: SHVIRO });
  const ids = s.signals.map((x) => x.id);
  for (const no of ['HIGH_SIMULTANEOUS_PROJECT_LOAD', 'HIGH_UNFINISHED_OBSERVED_PIPELINE', 'EXECUTION_TIME_LENGTHENING']) assert.ok(!ids.includes(no), no);
  assert.ok(s.load.executionEvidence.tenders <= s.load.executionEvidence.lots);
  for (const g of READ.values()) for (const x of g.signals) {
    for (const k of ['rule', 'threshold', 'source', 'cls']) assert.ok(x[k], `${x.id} ${k}`);
    assert.ok(x.limitations.length && Array.isArray(x.projects), x.id);
    if (x.id === 'HIGH_SIMULTANEOUS_PROJECT_LOAD') assert.ok(g.load.executionEvidence.tenders >= 2);
  }
});
t('a speed label is printed only with a comparison basis: SHORTER / LONGER / SIMILAR need ≥ 3 own observations and ≥ 30 in the cohort (≥ 10 for a locality); otherwise NO_COMPARISON_BASIS', () => {
  for (const g of READ.values()) {
    const H = g.history; if (!H.comparison) continue;
    const c = H.comparison;
    if (c.label !== 'NO_COMPARISON_BASIS') { assert.ok(c.own.monthsByTender.n >= GM.RULES.ownMin && c.cohort.monthsByTender.n >= GM.RULES.cohortMin, g.anchor.name); }
    if (H.locality && H.locality.label !== 'NO_COMPARISON_BASIS') assert.ok(H.locality.cohort.monthsByTender.n >= GM.RULES.localityCohortMin);
    if (H.prior && H.prior.label !== 'NO_COMPARISON_BASIS') assert.ok(H.prior.comparable && H.prior.earlier.startedTenders >= GM.RULES.ownMin && H.prior.later.startedTenders >= GM.RULES.ownMin);
    for (const m of H.measures) assert.ok(m.n === 0 ? m.median == null : m.median != null, m.id);
  }
});
t('OBSERVED EXECUTION LOAD — never "capacity utilization": the load names its basis, the cohort distribution and the not-capacity statement', () => {
  const g = dimri();
  assert.equal(g.load.name.en, 'OBSERVED EXECUTION LOAD');
  assert.match(g.load.notCapacity.en, /not "capacity utilization"/);
  assert.ok(g.load.cohort.groups > 0 && g.load.cohort.p90 != null);
  assert.equal(g.load.executionEvidence.lots, g.load.executionEvidence.current + g.load.executionEvidence.startEvidenceOnly);
});
t('geography / programme: the exact concentration statement; programme from the source\'s track only (urban renewal and private land "not observed", never inferred from a name)', () => {
  const c = read('conc', { company: CONC });
  assert.equal(c.geography.statement.en, 'High concentration means the observed portfolio depends more heavily on one market. It does not by itself indicate financial weakness.');
  assert.ok(c.signals.some((s) => s.id === 'GROUP_GEOGRAPHIC_CONCENTRATION'));
  assert.ok(!read('amram', { company: AMRAM }).signals.some((s) => s.id === 'GROUP_GEOGRAPHIC_CONCENTRATION'));
  const p = dimri().programme.rows;
  for (const id of ['URBAN_RENEWAL', 'PRIVATE_LAND']) { const r = p.find((x) => x.id === id); assert.ok(r && r.available === false && r.ila == null, id); }
  /* OPEN MARKET · SUBSIDIZED · LONG-TERM RENTAL · OTHER partition the lots; STATE LAND is an overlay (every ILA lot is state land) */
  const counted = p.filter((x) => ['OPEN_MARKET', 'SUBSIDIZED', 'LONG_TERM_RENTAL', 'OTHER'].includes(x.id)).reduce((s, x) => s + (x.ila ? x.ila.n : 0), 0);
  assert.equal(counted, dimri().portfolio.byUniverse.ila, 'every lot in exactly one programme');
  assert.equal(p.find((x) => x.id === 'STATE_LAND').ila.n, dimri().portfolio.byUniverse.ila);
});
t('no financial aggregation across entities: each legal entity carries its own profile; the project company\'s statement stays its own; the reporting entity is one company', () => {
  const g = dimriDocs();
  const spv = g.financial.entities.find((e) => e.number === FX.SPV[0]), core = g.financial.entities.find((e) => e.number === DIMRI);
  assert.ok(spv.hasStatements && core.hasStatements);
  assert.equal(g.financial.reporting.number, DIMRI);
  assert.equal(g.pipelineVsFinancial.financial.cash, 500000, 'the core\'s own cash — the SPV\'s 10,000 never added');
  assert.equal(g.pipelineVsFinancial.financial.financialDebt, 3100000);
  assert.ok(!('total' in g.financial) && !('group' in g.financial) && !('consolidated' in g.financial));
  assert.ok(g.financial.rules.some((x) => /no aggregation across entities/.test(x.en)));
  assert.ok(g.financial.rules.some((x) => /SPV liabilities are not rolled into the parent/.test(x.en)));
  const b = core.bonds[0]; assert.equal(b.cls, 'USER_DOCUMENT'); assert.deepEqual(b.maturitiesByYear, { 2027: 400000, 2028: 400000 });
});
t('the language gate: no distress / insolvent / stalled / delayed / probability of default / overextended / capacity utilization / financial health / score / recommend unless negated', () => {
  for (const [k, g] of READ) languageGate(g, k);
});
t('determinism: the same query twice → byte-identical output; the cohort is memoised per data stamp and never mutated by a read', () => {
  const a = JSON.stringify(grp({ company: SHVIRO })), b = JSON.stringify(grp({ company: SHVIRO }));
  assert.equal(a, b);
  const K = DD.ctx({ now: NOW }); const before = DD.resolutionsByNumber(K).get(DIMRI).length;
  grp({ developer: dimri().identity.members[0].devId }); grp({ project: DIMRI_LOT });
  assert.equal(DD.resolutionsByNumber(K).get(DIMRI).length, before, 'the memoised resolution list is not mutated');
  const c1 = GC.cohort(K), c2 = GC.cohort(K); assert.equal(c1, c2);
  assert.ok([...c1.facts.values()].every((f) => !('_S' in f)));
});
t('the risk & gap brief: six categories; every item answers why · what it does not mean · confirms · disproves · verify next; the next-best evidence says whether PROPX can retrieve it or the user must provide it', () => {
  for (const g of [dimri(), dimriDocs(), read('ashdar', { developer: ASHDAR })]) {
    assert.deepEqual(g.brief.categories, ['VERIFIED_FACT', 'DERIVED_SIGNAL', 'MISSING_EVIDENCE', 'SOURCE_LIMITATION', 'ENTITY_AMBIGUITY', 'SOURCE_CONFLICT']);
    for (const i of g.brief.items) for (const k of ['why', 'notMean', 'confirms', 'disproves', 'verify']) assert.ok(i[k] && i[k].en && i[k].he, `${i.id} ${k}`);
    for (const x of g.nextBest.items) { for (const k of ['why', 'couldChange']) assert.ok(x[k] && x[k].en, `${x.id} ${k}`); assert.equal(typeof x.userProvides, 'boolean'); assert.ok(['NO', 'PARTIAL', 'YES'].includes(x.propxRetrieves), x.id); }
    assert.equal(g.firstRead.length, 6); assert.equal(g.oneMinute.length, 9);
    for (const q of g.oneMinute) assert.ok(q.q.en && q.a.en && q.cls, 'one-minute answer');
  }
  assert.equal(read('ashdar', { developer: ASHDAR }).top.verifyNext.id, 'company-extract');
});
t('group timeline windows 12m / 24m / 5y / all are nested; every event is dated and classed', () => {
  const T = dimri().timeline;
  assert.ok(T.counts.m12 <= T.counts.m24 && T.counts.m24 <= T.counts.y5 && T.counts.y5 <= T.counts.all);
  for (const e of T.events) { assert.match(String(e.date), /^\d{4}-\d{2}-\d{2}/); assert.ok(e.cls, e.kind); }
  const sorted = T.events.map((e) => e.date); assert.deepEqual(sorted, sorted.slice().sort().reverse());
});

console.log('group: API · page · zero regression');
const apiGate = at('API view=group: GET by company / developer / project; 400 without an anchor; 404 for an unknown developer; POST with user documents; PUT 405', async () => {
  const H = require('../api/intel');
  const call = (method, url, body) => new Promise((resolve) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); } };
    H({ method, url, body, headers: {}, on() {} }, res); });
  const ok = await call('GET', '/api/intel?view=group&company=' + DIMRI); assert.equal(ok.status, 200);
  const j = JSON.parse(ok.body); assert.equal(j.kind, 'group'); assert.equal(j.identity.core.number, DIMRI);
  assert.equal((await call('GET', '/api/intel?view=group&project=' + encodeURIComponent(DIMRI_LOT))).status, 200);
  assert.equal((await call('GET', '/api/intel?view=group&developer=' + ASHDAR)).status, 200);
  assert.equal((await call('GET', '/api/intel?view=group')).status, 400);
  assert.equal((await call('GET', '/api/intel?view=group&developer=dev-000000000000')).status, 404);
  const p = await call('POST', '/api/intel?view=group&company=' + DIMRI, { userDocs: [FX.statements[0], FX.statements[1], { type: 'nope' }] });
  assert.equal(p.status, 200); const pj = JSON.parse(p.body); assert.equal(pj.userDocs.used, 2); assert.equal(pj.userDocs.rejected.length, 1);
  assert.equal((await call('PUT', '/api/intel?view=group&company=' + DIMRI)).status, 405);
  const src = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8'); assert.ok(!/console\.(log|error)\([^)]*userDocs/.test(src), 'the documents are never logged');
});
t('the page: the Sponsor X-Ray drawer, the entry points (developer · project · company drawers, search hits), every gx table registered in PT_DOM, the ⓘ terms from the registry only — inlined in the offline build', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const s of ['function gxDrawerHTML(', 'function gxFetch(', 'view=group', 'data-ingroup="developer:', 'data-ingroup="project:', 'data-ingroup="company:', 'class="in-kid gx-hit" data-ingroup=', 'if(o.kind==="group")']) assert.ok(html.includes(s), s);
  const pt = [...html.matchAll(/(gx[a-z]+):"([a-z,\-]+)"/g)].map((m) => m[1]).filter((k) => k !== 'gxe');
  assert.ok(pt.length >= 6);
  for (const k of pt) assert.ok(html.includes(`data-ptdom="${k}"`) || html.includes(`"${k}"`), 'table ' + k);
  const gx = html.slice(html.indexOf('const GX_I18N'), html.indexOf('function initIntel(){'));
  assert.ok(gx.length > 10000);
  for (const m of gx.matchAll(/xpBtn\("([a-z0-9_]+)"/g)) assert.ok(X.term(m[1]), 'ⓘ ' + m[1]);
  assert.ok(!/title="[^"]*"\s*data-tip/.test(gx), 'no standalone tooltip system');
  const sa = fs.readFileSync(path.join(ROOT, 'standalone/israel-new-homes-v2.html'), 'utf8');
  assert.ok(sa.includes('function gxDrawerHTML('));
});
t('zero regression: the due-diligence exports are unchanged (the group layer only reads them); the developer DD read is the same with and without a group read in between', () => {
  for (const k of ['VERSION', 'developer', 'project', 'company', 'permit', 'searchHits', 'status', 'coverage', 'prepare', 'overlay']) assert.ok(k in DD, k);
  const id = dimri().identity.members[0].devId;
  const a = JSON.stringify(DD.developer(id, { now: NOW })); grp({ company: DIMRI }, { userDocs: docsAll }); const b = JSON.stringify(DD.developer(id, { now: NOW }));
  assert.equal(a, b);
  const pa = JSON.stringify(DD.project(DIMRI_LOT, { now: NOW })); grp({ project: DIMRI_LOT }); assert.equal(JSON.stringify(DD.project(DIMRI_LOT, { now: NOW })), pa);
  /* the group modules never write: no fs write, no network */
  for (const f of fs.readdirSync(path.join(ROOT, 'lib/group')).filter((x) => x.endsWith('.js'))) { const s = fs.readFileSync(path.join(ROOT, 'lib/group', f), 'utf8'); assert.ok(!/writeFileSync|appendFileSync|fetch\(|https?\.request|Math\.random/.test(s), f); }
});

/* ------------------------------------------------------------ acceptance cases */
console.log('group: acceptance cases');
const CASES = [];
const L = (b) => (b && b.en) || b;
function kase(id, title, g, extra = {}) {
  assert.ok(g, id + ' read');
  const derived = g.signals.map((s) => `${s.id}: ${L(s.text)}`).concat([`stages (ILA): ${Object.entries(g.stages.ila.buckets).filter(([, b]) => b.n).map(([k, b]) => `${k} ${b.n}`).join(' · ') || '—'}`]);
  const verified = [g.identity.core && g.identity.core.company ? `legal core ${g.identity.core.number} ${g.identity.core.company.name} (${g.identity.core.state}; brand links ${g.identity.core.linkState || '—'})` : 'no legal core',
    `${g.portfolio.byUniverse.ila} ILA lots · ${g.portfolio.byUniverse.moch} MoCH lottery projects (OFFICIAL records, CORE + DOCUMENTED only)`].concat(g.legal.entities.map((e) => `registry status of ${e.number}: ${e.status ? L(e.status.label) || e.status.verbatim || '—' : '—'}`));
  const unresolved = g.identity.excluded.map((x) => `${x.name || x.number} — ${x.tier} (${x.relation})`).concat(g.identity.shared.map((x) => `${x.name || x.number} — SHARED joint award`));
  const o = { id, title, anchor: g.anchor, status: g.identity.status, structure: g.identity.structure,
    knows: g.firstRead.map((x) => L(x.text)),
    doesNotKnow: [L(g.top.mainEvidenceGap && g.top.mainEvidenceGap.text), g.financial.cls === 'MISSING' ? L(g.financial.statement) : null].concat(g.brief.items.filter((i) => i.category === 'MISSING_EVIDENCE').map((i) => L(i.text))).filter(Boolean),
    verified, derived, unresolved, seesFirst: L(g.firstRead[0].text), verifyNext: g.nextBest.items.slice(0, 3).map((x) => `${x.id}: ${L(x.text)}`), ...extra };
  for (const k of ['knows', 'doesNotKnow', 'verified', 'derived', 'seesFirst', 'verifyNext']) assert.ok(o[k] && (!Array.isArray(o[k]) || o[k].length), `${id}: ${k}`);
  CASES.push(o); return o;
}
t('A01 public group (registry type PUBLIC): the public status is the registry type only; financial coverage still MISSING without documents', () => {
  const g = dimri(); assert.equal(g.top.publicPrivate.cls, 'PUBLIC'); assert.match(g.top.publicPrivate.note.en, /registry type only/); assert.equal(g.financial.cls, 'MISSING');
  kase('A01', 'public group', g);
});
t('A02 private group: PRIVATE from the registry type; no financial flag', () => { const g = read('peretz', { company: PERETZ }); assert.equal(g.top.publicPrivate.cls, 'PRIVATE'); kase('A02', 'private group', g); });
t('A03 large nationwide group: projects in ≥ 6 districts, both universes, no concentration signal', () => {
  const g = read('amram', { company: AMRAM }); assert.ok(g.geography.byDistrict.length >= 6); assert.ok(g.portfolio.byUniverse.ila > 30 && g.portfolio.byUniverse.moch > 10); kase('A03', 'large nationwide group', g);
});
t('A04 small group: ≤ 3 projects; a limited pipeline statement; no signal from a tiny sample', () => {
  const g = read('trio', { company: TRIO }); assert.ok(g.portfolio.total <= 3); assert.equal(g.signals.filter((s) => s.kind === 'watch').length, 0); kase('A04', 'small group', g);
});
t('A05 group with many SPVs (fixture declarations): three DOCUMENTED project companies, one explicit parent guarantee, conflicts kept against the land winner — no SPV verified, nothing rolled into the parent', () => {
  const g = grp({ company: DIMRI }, { userDocs: FX.spvDeclarations });
  assert.equal(g.identity.companies.filter((c) => c.role === 'PROJECT_SPV').length, 3);
  assert.equal(g.structure.edges.filter((e) => e.type === 'GUARANTEES').length, 1);
  assert.equal(g.spv.verified, 0); assert.ok(g.spv.conflicts.length >= 3);
  kase('A05', 'many SPVs (TEST FIXTURE declarations — fictional relations)', g, { fixture: true });
});
t('A06 unresolved SPVs (brand only): no legal company, every project company unresolved; the next step is the company extract', () => {
  const g = read('ashdar', { developer: ASHDAR }); assert.equal(g.identity.status, 'BRAND_ONLY');
  assert.ok(g.portfolio.rows.every((r) => r.projectCompany.state !== 'STRONG_MATCH' && r.projectCompany.state !== 'VERIFIED'));
  kase('A06', 'unresolved SPVs (brand only)', g);
});
t('A07 concentrated group: one locality holds every lot → GROUP_GEOGRAPHIC_CONCENTRATION with its rule, never a weakness', () => {
  const g = read('conc', { company: CONC }); const s = g.signals.find((x) => x.id === 'GROUP_GEOGRAPHIC_CONCENTRATION');
  assert.ok(s && s.value >= GM.RULES.concentrationShare && s.sampleSize >= GM.RULES.concentrationMin); kase('A07', 'concentrated group', g);
});
t('A08 diversified group: the largest locality and district shares are low; no concentration signal', () => {
  const g = read('amram', { company: AMRAM }); assert.ok(g.geography.concentration.share < 0.5 && g.geography.largestDistrictProjectsShare.share < 0.5); kase('A08', 'diversified group', g);
});
t('A09 high land pipeline: ≥ 5 lots won in 36 months; recent activity named with its window; awarded ≠ sold', () => {
  const g = read('landp', { company: LANDP }); assert.ok(g.land.windows.m36.lots >= 5); kase('A09', 'high land pipeline', g);
});
t('A10 completion history: completion evidence on ≥ 5 records, each a COMPLETION / OCCUPANCY bucket with the evidence', () => {
  const g = read('ozen', { company: OZEN }); const c = g.portfolio.rows.filter((r) => r.bucket === 'COMPLETION' || r.bucket === 'OCCUPANCY');
  assert.ok(c.length >= 5); kase('A10', 'completion history', g);
});
t('A11 limited later evidence (clustered lots): the evidence-gap signal, no load signal from one tender', () => {
  const g = read('shviro', { company: SHVIRO }); assert.ok(g.signals.some((s) => s.id === 'NO_LATER_PUBLIC_EVIDENCE_FOUND')); kase('A11', 'limited later evidence · clustered lots', g);
});
t('A12 group with financials (fixture statements + bonds): the change view on the comparable period, flags, maturities by year, the main exposure named', () => {
  const g = grp({ company: DIMRI }, { userDocs: [...FX.statements, ...FX.bonds] });
  assert.equal(g.financial.cls, 'USER_DOCUMENT'); assert.ok(g.financial.entities[0].change.available);
  assert.match(g.top.mainExposure.id, /^fin-/);
  kase('A12', 'with financials (TEST FIXTURE statements — fictional figures)', g, { fixture: true });
});
t('A13 group without financials: MISSING with the reason; the joint award listed as SHARED', () => {
  const g = read('megiddo', { company: MEGIDDO }); assert.equal(g.financial.cls, 'MISSING'); assert.ok(g.shared.total >= 1); kase('A13', 'without financials · a joint award', g);
});
t('A14 legal events: an Official Receiver liquidation case of the exact entity, dated and labelled with its source status', () => {
  const g = read('ozen', { company: OZEN }); const lq = g.legal.events.filter((e) => /liquidation/.test(e.kind));
  assert.ok(lq.length >= 1 && lq.every((e) => e.date && e.cls && e.source)); kase('A14', 'legal events', g);
});
t('A15 ambiguous structure: several registry candidates, none chosen; no core; counts kept apart', () => {
  const g = read('ambig', { developer: AMBIG }); assert.equal(g.identity.status, 'BRAND_ONLY'); assert.ok(g.identity.excluded.some((x) => x.tier === 'AMBIGUOUS' || x.tier === 'POSSIBLE'));
  kase('A15', 'ambiguous structure', g);
});
t('A16 joint brand: every party resolved separately, each with its own group — never a group of the joint string', () => {
  const g = read('joint', { developer: JOINT }); assert.equal(g.identity.status, 'BRAND_ONLY'); assert.ok(g.identity.shared.length >= 1 || g.identity.notes.length >= 1);
  assert.ok(g.identity.shared.every((x) => x.relation === 'JOINT_PARTY')); kase('A16', 'joint brand', g);
});
t('A17 contractor-only company: COMPANY_ONLY, no portfolio, executor context only', () => {
  const g = read('contractor', { company: CONTRACTOR_ONLY }); assert.equal(g.portfolio.total, 0); kase('A17', 'contractor-only company', g);
});
t('A18 company not in coverage: NOT_IN_COVERAGE — says nothing about the company', () => {
  const g = read('notin', { company: NOT_IN }); assert.equal(g.identity.status, 'NOT_IN_COVERAGE'); assert.equal(g.portfolio.total, 0); assert.equal(g.financial.cls, 'MISSING');
  kase('A18', 'company not in coverage', g);
});
t('A19 a documented subsidiary with its own brand (fixture chart): its projects join as DOCUMENTED rows, evidence quality LOW (document chain), the mismatched party stays POSSIBLE', () => {
  const g = grp({ company: DIMRI }, { userDocs: [FX.ownershipChart, FX.mismatchChart] });
  const doc = g.portfolio.rows.filter((r) => r.tier === 'DOCUMENTED');
  assert.ok(doc.length >= 1 && doc.every((r) => r.quality.level === 'LOW' && r.quality.reasons.includes('DOCUMENT_CHAIN')));
  assert.equal(g.identity.structure, 'DOCUMENTED');
  kase('A19', 'documented subsidiary (TEST FIXTURE ownership chart — fictional relation)', g, { fixture: true });
});
t('the acceptance set: ≥ 15 cases, every one answers knows / does not know / verified / derived / unresolved / sees first / verify next', () => {
  assert.ok(CASES.length >= 15);
  if (process.env.GROUP_ACCEPTANCE_OUT) fs.writeFileSync(process.env.GROUP_ACCEPTANCE_OUT, JSON.stringify({ schema: 'propx-sponsor-xray-acceptance-v1', version: G.VERSION, generatedFor: NOW.slice(0, 10), note: 'Cases marked fixture use TEST FIXTURE documents (fictional relations and figures); every other case is a read of the synced public data.', cases: CASES }, null, 1) + '\n');
});

apiGate.then(() => console.log(`group: ${n} passed`), (e) => { console.error(e); process.exit(1); });
