// PROPX · KNOWLEDGE GRAPH (lib/graph) — gates over the committed data (read-only).
// `node test/graph.test.js`
//
// What the gates hold: every edge carries evidence (key · value · source that resolves to a source node); the module
// never calls a name-likeness helper; POSSIBLY_SAME edges are exactly the registry's possibleSame links and merge
// nothing; an ambiguous renewal join is a conflict, never an edge; coverage ratios are shares with the store's own
// denominators; a tender's REFERENCES edges equal its exact plan references; a site has exactly one HAS_WINNER edge
// mirrored by WON; the API views answer; building twice is identical; the build stays inside its time bound.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const planKey = (p) => String(p || '').replace(/\s+/g, '').trim();

(async () => {
  console.log('graph: module source');
  await t('the module never calls a name-likeness helper (no lettersKey / looksCut / similar in its source) and names its rule', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'graph', 'index.js'), 'utf8');
    assert.doesNotMatch(src, /lettersKey|looksCut|similar/);
    assert.match(src, /never merged/i);
  });

  /* the underlying read models are loaded once here so the graph build is timed on its own */
  const EQ = require('../lib/entities/query'); const LQ = require('../lib/land/query'); const RN = require('../lib/renewal/query'); const RQ = require('../lib/rental/query');
  const c = EQ.load(); const L = LQ.load(); LQ.lineageOf(L); const R = RN.load(); const T = RQ.load();
  const G = require('../lib/graph');
  const t0 = Date.now(); const S = G.stats(); const buildWall = Date.now() - t0;
  const have = L.live.length > 0 && c.R.developers.length > 0;
  if (!have) console.log('  (no bundled land / entities data — the data gates are skipped)');

  console.log('graph: vocabulary');
  await t('every entity type and relation is declared with bilingual labels; every relation pair names its evidence key and source', () => {
    for (const k of ['country', 'district', 'locality', 'developer', 'project', 'site', 'tender', 'plan', 'parcel', 'renewal_complex', 'rental_project', 'source']) { const e = G.ENTITY_TYPES[k]; assert.ok(e && e.id === k && e.label.he && e.label.en && e.ids, k); }
    for (const k of ['CONTAINS', 'IN', 'LOCATED_IN', 'HAS_WINNER', 'WON', 'DEVELOPS', 'REFERENCES', 'ON_PARCEL', 'AFFECTS', 'RE_MARKETS', 'JOINED_TO', 'POSSIBLY_SAME', 'SOURCED_FROM']) {
      const r = G.RELATIONS[k]; assert.ok(r && r.id === k && r.label.he && r.label.en && r.pairs.length, k);
      for (const p of r.pairs) { assert.ok(G.ENTITY_TYPES[p.from] && G.ENTITY_TYPES[p.to], `${k}: ${p.from}→${p.to}`); assert.ok(p.evidence && p.source, `${k}: evidence key + source`); }
    }
    assert.ok(S.basis.he && S.basis.en && /nothing is inferred/.test(S.basis.en));
    assert.ok(S.notEdges.en.includes('name matches') && S.notEdges.en.includes('geometry') && S.notEdges.en.includes('ambiguous'));
  });

  if (have) {
    console.log('graph: evidence on every edge');
    await t('every edge carries evidence with a key, a value and a source that resolves to a source node; from/to types match the declared pairs', () => {
      const g = G.load(); let n = 0;
      for (const e of g.E) {
        n++;
        assert.ok(e.evidence && typeof e.evidence.key === 'string' && e.evidence.key.length, `${e.relation} ${e.from}→${e.to}: key`);
        assert.notEqual(e.evidence.value, null, `${e.relation} ${e.from}→${e.to}: value`); assert.notEqual(e.evidence.value, undefined);
        assert.ok(g.N.has('source:' + e.evidence.source), `${e.relation} ${e.from}→${e.to}: source ${e.evidence.source} is a source node`);
        const a = g.N.get(e.from), b = g.N.get(e.to); assert.ok(a && b, 'both ends exist');
        assert.ok(G.RELATIONS[e.relation].pairs.some((p) => p.from === a.type && p.to === b.type), `${e.relation}: ${a.type}→${b.type} is a declared pair`);
      }
      assert.equal(n, S.edges.total); assert.equal(Object.values(S.edges.byRelation).reduce((s, x) => s + x, 0), n);
      assert.equal(Object.values(S.nodes.byType).reduce((s, x) => s + x, 0), S.nodes.total);
      assert.equal(new Set(g.E.map((e) => e.relation + '|' + e.from + '|' + e.to)).size, n, 'one edge per relation / from / to');
    });

    console.log('graph: identity — flagged, never merged');
    await t('POSSIBLY_SAME edges equal the registry\'s possibleSame links, carry its evidence and merge nothing', () => {
      const links = c.R.developers.flatMap((d) => d.possibleSame.map((x) => ({ from: d.id, to: x.id, evidence: x.evidence })));
      assert.equal(S.edges.byRelation.POSSIBLY_SAME, links.length); assert.equal(S.conflicts.possiblySameDevelopers.links, links.length);
      assert.equal(S.conflicts.possiblySameDevelopers.developers, c.R.developers.filter((d) => d.possibleSame.length).length);
      for (const l of links.slice(0, 200)) {
        const es = G.edges(l.from, { relation: 'POSSIBLY_SAME' }).filter((e) => e.direction === 'out' && e.to === l.to);
        assert.equal(es.length, 1); assert.equal(es[0].evidence.value, l.evidence); assert.ok(['strict-prefix', 'same-letters'].includes(es[0].evidence.value)); assert.equal(es[0].merged, false);
        assert.ok(G.node(l.from) && G.node(l.to) && l.from !== l.to, 'both developers stay separate nodes');
        assert.equal(G.node(l.from).attrs.merged, false);
      }
      assert.equal(S.nodes.byType.developer, c.R.developers.length, 'one node per registry developer — none combined');
    });
    await t('HAS_WINNER rests on the registry\'s developerId: a known site has exactly one, mirrored by WON; no site names an unlisted winner', () => {
      const site = c.R.sites[0];
      const hw = G.edges(site.id, { relation: 'HAS_WINNER' }); assert.equal(hw.length, 1); assert.equal(hw[0].to, site.developerId); assert.equal(hw[0].direction, 'out');
      assert.equal(hw[0].evidence.value, site.developerName); assert.equal(hw[0].evidence.source, 'rmi:michrazim');
      const won = G.edges(site.developerId, { relation: 'WON', limit: 1000 }).filter((e) => e.to === site.id); assert.equal(won.length, 1);
      assert.equal(S.edges.byRelation.HAS_WINNER, c.R.sites.length); assert.equal(S.edges.byRelation.WON, c.R.sites.length);
      assert.ok(G.neighbours(site.id).some((n) => n.id === site.developerId && n.relations.some((r) => r.relation === 'HAS_WINNER')));
      const g = G.load(); let unlistedNamed = 0;
      for (const n of g.N.values()) if (n.type === 'site' && !n.attrs.listedWinner && (n.attrs.developerId || n.attrs.developerName)) unlistedNamed++;
      assert.equal(unlistedNamed, 0, 'a lot without a listed developer carries no winner name');
      const tenderOf = G.node(site.tenderId); assert.ok(tenderOf && tenderOf.type === 'tender');
      assert.ok(G.edges(site.tenderId, { relation: 'CONTAINS', limit: 1000 }).some((e) => e.to === site.id), 'the tender CONTAINS the site through the lot file id');
    });

    console.log('graph: joins by exact key only');
    await t('a known tender\'s REFERENCES edges equal its exact plan references (distinct keys), none for not-a-plan-number entries', () => {
      const r = L.live.find((x) => (x.plans || []).some((p) => p.join === 'exact-plan-number') && (x.plans || []).some((p) => p.join === 'not-a-plan-number'));
      assert.ok(r, 'a tender with both kinds of plan entry');
      const keys = new Set(r.plans.filter((p) => p.join === 'exact-plan-number').map((p) => planKey(p.plan)));
      const es = G.edges(r.id, { relation: 'REFERENCES', limit: 1000 });
      assert.equal(es.length, keys.size); for (const e of es) { assert.ok(keys.has(e.to.slice(5)), e.to); assert.equal(e.evidence.source, 'rmi:michrazim'); assert.match(e.evidence.key, /exact-plan-number/); }
      const rejected = r.plans.filter((p) => p.join === 'not-a-plan-number').map((p) => 'plan:' + planKey(p.plan));
      for (const id of rejected) assert.ok(!es.some((e) => e.to === id), 'a site-link number is not a plan reference');
      const refs = L.live.reduce((s, x) => s + new Set((x.plans || []).filter((p) => p.join === 'exact-plan-number').map((p) => planKey(p.plan))).size, 0);
      const complexRefs = [...R.join.byComplex.values()].filter((j) => j.match.status === 'exact' && j.plan).length;
      assert.equal(S.edges.byRelation.REFERENCES, refs + complexRefs, 'tender references + exact renewal joins, nothing else');
    });
    await t('a renewal complex with an ambiguous XPlan join has no plan edge and is listed under conflicts; exact joins carry the join evidence', () => {
      const amb = [...R.join.byComplex.entries()].filter(([, j]) => j.match.status === 'ambiguous').map(([id]) => id);
      assert.deepEqual(S.conflicts.ambiguousRenewalJoins.map((x) => x.id).sort(), amb.slice().sort());
      for (const id of amb) { assert.ok(G.node(id)); assert.equal(G.edges(id, { relation: 'REFERENCES' }).length, 0); const k = S.conflicts.ambiguousRenewalJoins.find((x) => x.id === id); assert.ok(k.reason && Array.isArray(k.candidates)); }
      const ex = [...R.join.byComplex.entries()].find(([, j]) => j.match.status === 'exact' && j.plan);
      if (ex) { const es = G.edges(ex[0], { relation: 'REFERENCES' }); assert.equal(es.length, 1); assert.equal(es[0].to, 'plan:' + ex[1].plan.planKey); assert.equal(es[0].mpId, ex[1].plan.mpId); assert.deepEqual(es[0].joinEvidence, ex[1].match.evidence); assert.equal(es[0].evidence.source, 'iplan:xplan:renewal'); }
      assert.equal(S.coverage.complexesWithPlanEdge.num, [...R.join.byComplex.values()].filter((j) => j.match.status === 'exact' && j.plan).length);
      assert.equal(S.unmatched.complexesNoPlanJoin.total + S.coverage.complexesWithPlanEdge.num + amb.length, R.live.length, 'exact + ambiguous + unmatched = every live complex');
    });
    await t('RE_MARKETS = the lineage through the lot file, same-parcel and parallel-marketing excluded; JOINED_TO = the printed tender number', () => {
      const lin = LQ.lineageOf(L), kept = lin.links.filter((l) => l.relation !== 'same-parcel' && l.relation !== 'parallel-marketing');
      assert.equal(S.edges.byRelation.RE_MARKETS, kept.length); assert.equal(S.unmatched.lineageLinksExcluded['same-parcel'], lin.links.filter((l) => l.relation === 'same-parcel').length);
      const l0 = kept[0]; const es = G.edges(l0.from, { relation: 'RE_MARKETS', limit: 1000 }).filter((e) => e.to === l0.to); assert.equal(es.length, 1); assert.equal(es[0].kind, l0.relation); assert.match(es[0].evidence.key, /TikID/);
      const g = G.load(); const rentals = [...g.N.values()].filter((n) => n.type === 'rental_project');
      assert.equal(rentals.length, S.edges.byRelation.JOINED_TO || 0);
      for (const n of rentals.slice(0, 50)) { const es2 = G.edges(n.id, { relation: 'JOINED_TO' }); assert.equal(es2.length, 1); assert.equal(es2[0].to, n.attrs.tenderId); assert.equal(es2[0].evidence.value, n.attrs.tenderNumber); assert.equal(T.byMichraz.get(n.attrs.tenderId).id, n.attrs.noticeId); }
    });
    await t('plan AFFECTS parcel only through one lot file carrying both keys; districts / localities from the registry; nothing by name or geometry', () => {
      const g = G.load();
      let lots = 0; for (const r of L.live) for (const l of r.lotRefs || []) if (Array.isArray(l.keys) && l.keys.length && Array.isArray(l.parcels) && l.parcels.length) lots++;
      assert.equal(S.planAffectsParcel.lotsCarryingBoth, lots); assert.equal(S.planAffectsParcel.pairs, S.edges.byRelation.AFFECTS || 0);
      if (S.planAffectsParcel.pairs) { const e = g.E.find((x) => x.relation === 'AFFECTS'); assert.ok(e.lot && e.tender && /lotRefs/.test(e.evidence.key)); const lot = g.N.get(`ila:${g.N.get(e.tender).attrs.michrazId}:${e.lot}`); assert.ok(lot.attrs.planLotKeys.some((k) => planKey(k.split('|')[0]) === e.from.slice(5)) && lot.attrs.parcels.includes(e.to.slice(7)), 'the lot carries both keys'); }
      else assert.ok(S.planAffectsParcel.note, 'says so when no record carries both');
      const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'geo', 'localities.json'), 'utf8')).localities;
      const coded = geo.filter((l) => l.code != null);
      assert.equal(S.nodes.byType.locality, new Set(coded.map((l) => String(l.code))).size); assert.equal(S.unmatched.localitiesWithoutCode, geo.length - coded.length);
      assert.equal(S.coverage.localitiesInDistrict.num, new Set(coded.filter((l) => l.district && g.N.has(l.district)).map((l) => String(l.code))).size);
      const loc = G.node('loc:5000'); assert.ok(loc && loc.type === 'locality'); const inD = G.edges('loc:5000', { relation: 'IN' }); assert.equal(inD.length, 1); assert.equal(inD[0].to, 'd-ta'); assert.equal(inD[0].evidence.key, 'localities.json district');
      assert.ok(G.edges('il', { relation: 'CONTAINS' }).some((e) => e.to === 'd-ta'));
      for (const e of g.E) {
        assert.doesNotMatch(e.evidence.key, /substring|likeness|fuzzy|geometry|distance|centroid|overlap/i, e.evidence.key);
        if (e.relation === 'HAS_WINNER' || e.relation === 'WON') assert.match(e.evidence.key, /developerId/, 'identity through the registry id written on the site');
        if (e.relation === 'DEVELOPS') assert.match(e.evidence.key, /developerIds/, 'identity through the registry ids written on the project');
        if (e.relation === 'POSSIBLY_SAME') assert.match(e.evidence.key, /possibleSame/);
      }
    });

    console.log('graph: stats');
    await t('coverage ratios are shares in [0, 1] whose denominators equal the store counts; unmatched counts add up', () => {
      for (const [k, cv] of Object.entries(S.coverage)) { assert.ok(cv.num >= 0 && cv.den >= 0 && cv.num <= cv.den, k); assert.ok(cv.ratio === null ? cv.den === 0 : cv.ratio >= 0 && cv.ratio <= 1, k); assert.ok(cv.basis.he && cv.basis.en, k); }
      assert.equal(S.coverage.tendersWithPlanEdge.den, L.live.length); assert.equal(S.coverage.tendersLocated.den, L.live.length); assert.equal(S.coverage.tendersReMarketed.den, L.live.length);
      assert.equal(S.coverage.complexesWithPlanEdge.den, R.live.length); assert.equal(S.coverage.projectsWithDeveloper.den, c.R.projects.length);
      assert.equal(S.coverage.noticesJoined.den, T.dev.filter((x) => x.inLatestSource !== false).length);
      const awarded = L.live.filter((r) => r.lifecycle === 'awarded').reduce((s, r) => s + (r.winners || []).length, 0);
      assert.equal(S.coverage.sitesWithWinner.den, awarded); assert.equal(S.coverage.sitesWithWinner.den, c.R.coverage.ila.awardedLots); assert.equal(S.coverage.sitesWithWinner.num, c.R.sites.length);
      assert.equal(S.unmatched.winnersWithoutListedDeveloper.total + S.coverage.sitesWithWinner.num, awarded, 'listed sites + winners without a listed developer = every awarded lot');
      assert.equal(S.unmatched.winnersWithoutListedDeveloper.unlisted, c.R.coverage.ila.unmarkedLots, 'private persons = the registry\'s unmarked lots');
      assert.equal(S.coverage.tendersWithPlanEdge.num, L.live.filter((r) => (r.plans || []).some((p) => p.join === 'exact-plan-number' && planKey(p.plan))).length);
      assert.equal(S.unmatched.tendersPlanRefsNoXplan + S.coverage.tendersWithXplanPlan.num, S.coverage.tendersWithPlanEdge.num);
      assert.equal(S.coverage.tendersLocated.num + S.unmatched.tendersWithoutLocality.none + S.unmatched.tendersWithoutLocality.notInRegistry, L.live.length);
      assert.equal(S.coverage.projectsWithDeveloper.num + S.unmatched.projectsWithoutDeveloper, c.R.projects.length);
      assert.equal(S.coverage.noticesJoined.num + S.unmatched.noticesWithoutTenderNumber + S.unmatched.noticesWithoutIlaRecord + S.unmatched.noticesDuplicateTender, S.coverage.noticesJoined.den);
      assert.equal(S.nodes.byType.tender, L.live.length); assert.equal(S.nodes.byType.renewal_complex, R.live.length); assert.equal(S.nodes.byType.project, c.R.projects.length);
      assert.equal(S.store.tenders, L.live.length); assert.equal(S.store.lineageLinks, LQ.lineageOf(L).links.length);
      assert.ok(Array.isArray(S.conflicts.plansResolvedDifferently)); assert.ok(S.conflicts.planKeysInBothXplanStores >= S.conflicts.plansResolvedDifferently.length);
      assert.ok(S.build.stamp.startsWith('graph|') && S.build.at && S.build.ms >= 0);
    });
    await t('node() is O(1) with a degree; edges() respects relation and limit (default 200, max 1000) and says in / out; unknown ids answer null / []', () => {
      assert.equal(G.node('nope'), null); assert.deepEqual(G.edges('nope'), []); assert.deepEqual(G.neighbours('nope'), []); assert.equal(G.degree('nope'), 0);
      const src = G.node('source:rmi:michrazim'); assert.equal(src.type, 'source'); assert.equal(src.degree, S.edges.byRelation.SOURCED_FROM ? G.degree('source:rmi:michrazim') : 0);
      assert.equal(G.edges('source:rmi:michrazim').length, Math.min(200, src.degree)); assert.equal(G.edges('source:rmi:michrazim', { limit: 5000 }).length, Math.min(1000, src.degree)); assert.equal(G.edges('source:rmi:michrazim', { limit: 3 }).length, 3);
      for (const e of G.edges('source:rmi:michrazim', { limit: 10 })) assert.equal(e.direction, 'in');
      const d = G.node('d-ta'); assert.equal(d.degree, G.edges('d-ta', { limit: 1000 }).length); assert.equal(G.edges('d-ta', { relation: 'CONTAINS' }).length + G.edges('d-ta', { relation: 'IN' }).length, d.degree);
      assert.equal(G.edges('d-ta', { relation: 'NOPE' }).length, d.degree, 'an unknown relation is no filter at the module level (the API rejects it)');
      const n = G.neighbours('d-ta', { limit: 3 }); assert.equal(n.length, 3); for (const x of n) assert.ok(x.id && x.type && x.label && x.relations.length);
      const t1 = process.hrtime.bigint(); for (let i = 0; i < 2000; i++) G.node('rmi:' + L.live[i % L.live.length].michrazId); const us = Number(process.hrtime.bigint() - t1) / 1e3;
      assert.ok(us < 200000, `2000 node() reads took ${Math.round(us)} µs`);
    });
    await t('building twice is deterministic (same stats, same edges in the same order) and the build stays inside ~3 s', () => {
      const strip = (s) => { const { build, ...rest } = s; return JSON.stringify(rest); };
      const a = strip(S), e1 = G.edges('rmi:' + L.live[0].michrazId, { limit: 1000 }), n1 = G.neighbours('d-ta', { limit: 1000 });
      const t1 = Date.now(); const g2 = G.load({ force: true }); const ms = Date.now() - t1;
      const S2 = G.stats(); assert.equal(strip(S2), a); assert.notEqual(S2.build.at, undefined);
      assert.deepEqual(G.edges('rmi:' + L.live[0].michrazId, { limit: 1000 }), e1); assert.deepEqual(G.neighbours('d-ta', { limit: 1000 }), n1);
      assert.equal(g2.E.length, S.edges.total);
      console.log(`    build: ${S.build.ms} ms (first, loaders warm: ${buildWall} ms wall) · rebuild ${ms} ms · ${S.nodes.total} nodes · ${S.edges.total} edges`);
      assert.ok(S.build.ms < 3000 && ms < 3000, `build ${S.build.ms} / ${ms} ms`);
      assert.equal(G.load(), g2, 'memoised: the same stamp returns the same graph without a rebuild');
    });

    console.log('graph: api/intel views');
    await t('view=graph answers { node, edges, neighbours } with evidence, filters by relation, caps the limit, 404 for an unknown id, 400 without one; view=graphStats answers', async () => {
      const h = require('../api/intel');
      const call = (url, method = 'GET') => new Promise((r) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { r({ status: this.statusCode, headers: this.headers, body: b }); } }; h({ method, url }, res); });
      assert.equal((await call('/api/intel?view=graph&entity=d-ta', 'POST')).status, 405);
      assert.equal((await call('/api/intel?view=graph&entity=nope')).status, 404);
      assert.equal((await call('/api/intel?view=graph')).status, 400);
      assert.equal((await call('/api/intel?view=graph&entity=d-ta&relation=NOPE')).status, 400);
      const site = c.R.sites[0];
      const r1 = await call(`/api/intel?view=graph&entity=${encodeURIComponent(site.id)}`); assert.equal(r1.status, 200); assert.match(r1.headers['cache-control'], /no-store/);
      const b1 = JSON.parse(r1.body); assert.equal(b1.node.id, site.id); assert.ok(b1.edges.every((e) => e.evidence && e.evidence.key && e.evidence.source)); assert.ok(b1.edges.some((e) => e.relation === 'HAS_WINNER' && e.to === site.developerId));
      assert.ok(b1.neighbours.some((n) => n.id === site.developerId)); assert.equal(b1.edgesTotal, G.degree(site.id)); assert.ok(b1.basis.he && b1.basis.en);
      const r2 = JSON.parse((await call('/api/intel?view=graph&entity=source:rmi:michrazim&relation=SOURCED_FROM&limit=7')).body); assert.equal(r2.edges.length, 7); assert.equal(r2.relation, 'SOURCED_FROM'); assert.ok(r2.edgesTotal > 7);
      const r3 = JSON.parse((await call('/api/intel?view=graph&entity=source:rmi:michrazim&limit=99999')).body); assert.equal(r3.edges.length, 1000);
      const r4 = JSON.parse((await call('/api/intel?view=graph&entity=source:rmi:michrazim')).body); assert.equal(r4.edges.length, 200);
      const st = await call('/api/intel?view=graphStats'); assert.equal(st.status, 200); const b = JSON.parse(st.body);
      assert.equal(b.nodes.total, S.nodes.total); assert.ok(b.coverage && b.unmatched && b.conflicts && b.basis.en && b.vocabulary.relations.REFERENCES && b.vocabulary.entityTypes.site);
    });
  }

  console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();
