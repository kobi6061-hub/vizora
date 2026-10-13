// PROPX · Developers & Projects registry, unified search, Data & Trust Center — offline tests.
// `node test/entities.test.js`
//
// Fixture records are built in memory in the stored shapes of data/land and data/housing, with names prefixed
// "TEST FIXTURE" and ids 99900001+ / project 9990001+, written only to temp directories. The last group runs the
// registry over the committed data (read-only) to hold the real build to the same rules.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const N = require('../lib/entities/names');
const { buildRegistry, monthsBefore } = require('../lib/entities/registry');
const Q = require('../lib/entities/query');
const TC = require('../lib/trust/catalog');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
};
const TODAY = '2026-10-13';

/* ---- fixtures (stored shapes) ---- */
let seq = 0;
const tender = (o = {}) => { const n = ++seq; return { id: `rmi:${99900000 + n}`, michrazId: 99900000 + n, name: `${n}/2026`, lifecycle: 'awarded', track: 'open-market', priceBasis: 'competitive-bid',
  localityCode: 9000, neighborhood: 'TEST FIXTURE שכונה', units: 100, publishedDate: '2026-03-01', committeeDate: '2026-05-01', inLatestSource: true,
  winners: [], lotRefs: [], plans: [], parcels: [], construction: null, ...o }; };
const win = (name, o = {}) => ({ lotId: 'L' + (++seq), name, amount: 10000000, units: 50, ...o });
const lottery = (o = {}) => ({ id: `lottery:${++seq}`, lotteryId: seq, projectId: 9990001, lotteryType: 'first', lotteryDate: '2025-01-10', localityCode: 9000, neighborhood: 'TEST FIXTURE',
  projectName: 'TEST FIXTURE פרויקט', developer: 'TEST FIXTURE יזם בע"מ', unitsInLottery: 40, applicants: 400, winners: 40, pricePerSqm: 9000, permitStage: 'full', permitStatusHe: 'היתר מלא',
  projectStage: 'lottery', projectStatusHe: 'בתהליכי הגרלה', program: 'mechir-lamishtaken', programHe: 'מחיר למשתכן', recordType: 'lottery',
  provenance: { source: 'datagov:moch:dira-behanacha-lotteries', resourceId: 'x', sourceUpdatedAt: '2026-08-16T00:00:00Z', fetchedAt: '2026-10-01T00:00:00Z' }, ...o });
const cityName = (c) => (c === 9000 ? { he: 'באר שבע', en: "be'er sheva" } : c === 5000 ? { he: 'תל אביב - יפו', en: 'tel aviv - yafo' } : null);
const build = (tenders, lotteries = []) => buildRegistry({ tenders, lotteries, cityName, today: TODAY });
const devNamed = (R, name) => R.developers.find((d) => d.canonical === N.canonicalName(name));
function fixtureDirs(tenders, lotteries) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'entities-test-')), land = path.join(base, 'land'), housing = path.join(base, 'housing');
  fs.mkdirSync(land); fs.mkdirSync(housing);
  fs.writeFileSync(path.join(land, 'tenders.json'), JSON.stringify(tenders));
  fs.writeFileSync(path.join(land, 'meta.json'), JSON.stringify({ checkedAt: '2026-10-12T10:00:00Z', coverage: { publishedTo: '2026-10-08' }, normalizerVersion: 5, inLatestSource: tenders.length, detailCoverage: { retrieved: tenders.length } }));
  fs.writeFileSync(path.join(housing, 'lotteries.json'), JSON.stringify(lotteries));
  fs.writeFileSync(path.join(housing, 'meta.json'), JSON.stringify({ checkedAt: '2026-10-12T09:00:00Z', sourceUpdatedAt: '2026-08-16T00:00:00Z', coverage: { lotteryDateTo: '2025-01-27' } }));
  return { landDir: land, housingDir: housing, today: TODAY };
}

(async () => {
  console.log('entities: names & identity rules');
  await t('canonical name removes typographic variants only — never suffixes, spelling or punctuation', () => {
    assert.equal(N.canonicalName('  י.א. אבי   בע״מ '), N.canonicalName('י.א. אבי בע"מ'));
    assert.equal(N.canonicalName("X בע''מ"), 'X בע"מ');
    assert.equal(N.canonicalName('a‏b’'), "ab'");
    assert.notEqual(N.canonicalName('קרן פז בע"מ'), N.canonicalName('קרן פז בעמ'));
    assert.notEqual(N.canonicalName('י.ח. דמרי בע"מ'), N.canonicalName('י.ח.דמרי בע"מ'));
    assert.notEqual(N.canonicalName('בניה בע"מ'), N.canonicalName('בנייה בע"מ'));
    assert.equal(N.devId(N.canonicalName('X בע"מ')), N.devId('X בע"מ'));
    assert.match(N.devId('X'), /^dev-[0-9a-f]{12}$/);
  });
  await t('legal form comes from markers with Hebrew-safe edges; an unmarked string is a person until proven otherwise', () => {
    const k = (s) => N.kindOf(N.canonicalName(s));
    assert.equal(k('TEST FIXTURE חברה לבנין בע"מ'), 'company'); assert.equal(k('TEST FIXTURE בעמ'), 'company'); assert.equal(k('TEST FIXTURE Ltd.'), 'company');
    assert.equal(k('TEST FIXTURE שותפות מוגבלת'), 'partnership'); assert.equal(k('קיבוץ TEST'), 'cooperative'); assert.equal(k('TEST FIXTURE (ע"ר)'), 'nonprofit');
    assert.equal(k('עיריית TEST'), 'public-body');
    assert.equal(k('כהן משה'), 'unmarked'); assert.equal(k('בעמי שמואל'), 'unmarked', 'a marker inside a word is not a marker');
    assert.equal(N.looksCut('רמי שבירו הנדסה בניה והשקעות ב'), true); assert.equal(N.looksCut('X בע"מ'), false);
    assert.equal(N.lettersKey('י.ח. דמרי - בניה בע"מ'), N.lettersKey('י.ח.דמרי בניה בעמ'));
  });

  console.log('entities: developer registry');
  await t('only status-coded awards count; unmarked winners are counted and never listed; identical legal names across sources are one entity', () => {
    const co = 'TEST FIXTURE חברה לבנין בע"מ';
    const R = build([
      tender({ winners: [win(co), win('כהן TEST FIXTURE')] }),
      tender({ lifecycle: 'open', winners: [win(co)] }),                                   // a stale winner column on an open tender
      tender({ lifecycle: 'decided-no-award', winners: [] }),
    ], [lottery({ developer: co })]);
    const d = devNamed(R, co);
    assert.ok(d); assert.deepEqual(d.roles, ['ila-tender-winner', 'moch-lottery-developer']);
    assert.equal(d.tenders.lots, 1, 'the open tender is not a win'); assert.equal(d.lotteries.projects, 1);
    assert.equal(R.developers.some((x) => /כהן/.test(x.name)), false);
    assert.equal(R.coverage.ila.unmarkedLots, 1); assert.equal(R.coverage.ila.unmarkedWinnerStrings, 1);
    assert.equal(d.basis, 'OBSERVED PROPX ACTIVITY'); assert.equal(d.companyId, null);
  });
  await t('no similarity merge: punctuation variants and cut names stay separate entities, linked as possible same', () => {
    const R = build([tender({ winners: [win('TEST FIXTURE י.ח. דמרי בניה בע"מ'), win('TEST FIXTURE י.ח.דמרי בניה בע"מ')] }), tender({ winners: [win('TEST FIXTURE אחים בניה בע"מ')] })],
      [lottery({ developer: 'TEST FIXTURE אחים בניה ב', projectId: 9990002 })]);
    const a = devNamed(R, 'TEST FIXTURE י.ח. דמרי בניה בע"מ'), b = devNamed(R, 'TEST FIXTURE י.ח.דמרי בניה בע"מ');
    assert.ok(a && b && a.id !== b.id);
    assert.equal(a.tenders.lots, 1); assert.equal(b.tenders.lots, 1);
    assert.ok(a.possibleSame.some((x) => x.id === b.id && x.evidence === 'same-letters'));
    const full = devNamed(R, 'TEST FIXTURE אחים בניה בע"מ'), cut = devNamed(R, 'TEST FIXTURE אחים בניה ב');
    assert.ok(full && cut && full.id !== cut.id);
    assert.ok(cut.possibleSame.some((x) => x.id === full.id && x.evidence === 'strict-prefix'));
    assert.equal(cut.roles.join(), 'moch-lottery-developer', 'a cut MoCH name is listed by its source role, its wins are not borrowed');
    assert.equal(cut.tenders.lots, 0);
  });
  await t('units stay per source and are never added; land totals are competitive bids only', () => {
    const co = 'TEST FIXTURE יזם בע"מ';
    const R = build([tender({ winners: [win(co, { amount: 12000000, units: 60 })] }), tender({ priceBasis: 'price-per-sqm-bid', winners: [win(co, { amount: 9500, units: 80 })] }),
      tender({ track: 'commercial-other', winners: [win(co, { units: null })] })], [lottery({ developer: co, unitsInLottery: 140 })]);
    const d = devNamed(R, co);
    assert.equal(d.tenders.residentialUnits, 140); assert.equal(d.lotteries.unitsFirstLotteries, 140);
    assert.equal(d.tenders.landTotalCompetitive, 12000000 + 10000000, 'every competitive lot with a sum; the ₪/m² bid is not a land sum'); assert.equal(d.tenders.landLots, 2); assert.equal(d.tenders.perSqmLots, 1);
    assert.equal(d.tenders.landPerUnit, 200000, 'per unit: numerator and denominator from the same lots (the lot without units is left out of both)');
    assert.equal(Object.keys(d).some((k) => /total.*units|units.*total/i.test(k)), false, 'no cross-source unit total');
  });
  await t('construction evidence attaches to the lot it was joined to, never to the other lots of the tender', () => {
    const a = win('TEST FIXTURE א בע"מ'), b = win('TEST FIXTURE ב בע"מ');
    const R = build([tender({ winners: [a, b], construction: { links: [{ lotId: a.lotId, block: '1', parcel: '2', units: 30, stages: { excavation: '2026-06-01' }, asOf: '2024-03-01' }] } })]);
    assert.equal(devNamed(R, 'TEST FIXTURE א בע"מ').construction.started, 1);
    assert.equal(devNamed(R, 'TEST FIXTURE ב בע"מ').construction, null);
    const site = R.sites.find((s) => s.lotId === a.lotId);
    assert.equal(site.stage.furthest, 'construction-started'); assert.equal(site.construction.join, 'exact-block-parcel');
    assert.equal(R.sites.find((s) => s.lotId === b.lotId).stage.furthest, 'land-awarded');
  });
  await t('market entry = first activity in a city inside the window, for a developer active elsewhere before it', () => {
    const co = 'TEST FIXTURE ותיק בע"מ', fresh = 'TEST FIXTURE חדש בע"מ';
    const R = build([tender({ committeeDate: '2019-02-01', localityCode: 5000, winners: [win(co)] }), tender({ committeeDate: '2026-04-01', winners: [win(co)] }),
      tender({ committeeDate: '2026-01-01', localityCode: 5000, winners: [win(fresh)] }), tender({ committeeDate: '2026-05-01', winners: [win(fresh)] })]);
    assert.deepEqual(R.entries.map((e) => [e.developer, e.city]), [[co, 'באר שבע']]);
    assert.equal(R.entries[0].earlierActivityFrom, '2019-02-01');
    assert.equal(monthsBefore('2026-10-13', 24), '2024-10-13');
  });

  console.log('entities: projects');
  await t('lottery projects and tender lots keep their own ids and are never joined; stage = the furthest evidenced stage', () => {
    const co = 'TEST FIXTURE יזם בע"מ';
    const R = build([tender({ track: 'subsidized', winners: [win(co)] }), tender({ track: 'commercial-other', winners: [win(co)] })],
      [lottery({ developer: co }), lottery({ developer: co, lotteryType: 'continuation', lotteryDate: '2025-06-01', unitsInLottery: 12, projectStage: 'post-occupancy', projectStatusHe: 'אכלוס' })]);
    assert.equal(R.projects.length, 1); assert.equal(R.sites.length, 1, 'commercial lots are not residential sites');
    const p = R.projects[0];
    assert.equal(p.id, 'moch:9990001'); assert.equal(p.unitsFirstLottery, 40); assert.equal(p.continuationLotteries, 1); assert.equal(p.lotteries.length, 2);
    assert.equal(p.stage.furthest, 'occupied'); assert.deepEqual(p.stage.evidence.map((e) => e.stage), ['marketed', 'permitted', 'occupied']);
    assert.equal(p.demand.applicantsPerUnit, 10); assert.match(p.demand.basis, /^DERIVED/);
    assert.ok(R.sites[0].id.startsWith('ila:')); assert.equal(R.coverage.projects.crossSourceJoins, 0);
    assert.equal('tenderId' in p, false); assert.equal('projectId' in R.sites[0], false);
  });

  console.log('entities: read model, search, api');
  const co = 'TEST FIXTURE אשטרומיקס בע"מ';
  const T = [tender({ name: '158/2026', winners: [win(co, { lotId: 'LOT1' })], lotRefs: [{ id: 'LOT1', keys: ['תמל/9999|210'], parcels: ['99999/7'], units: 50, won: true }],
    plans: [{ plan: 'תמל/ 9999', via: 'lot' }], parcels: [{ block: '99999', parcel: '7' }] })];
  const H = [lottery({ developer: co, projectName: 'TEST FIXTURE רקפות', neighborhood: 'רקפות' })];
  const opt = fixtureDirs(T, H);
  await t('developers / projects pages: filters, sort, paging, basis and coverage on every answer', () => {
    const d = Q.developers({ q: 'אשטרומיקס', size: 5 }, opt);
    assert.equal(d.total, 1); assert.equal(d.rows[0].name, co); assert.equal(d.basis, 'OBSERVED PROPX ACTIVITY'); assert.ok(d.coverage && d.methodology && d.freshness);
    assert.equal(Q.developers({ city: 'באר שבע' }, opt).total, 1); assert.equal(Q.developers({ city: 'חיפה' }, opt).total, 0);
    assert.equal(Q.developers({ size: 999 }, opt).size, 100);
    const one = Q.developer(d.rows[0].id, opt);
    assert.equal(one.sitesTotal, 1); assert.equal(one.projectsTotal, 1); assert.ok(one.sources.some((s) => s.id === 'rmi:michrazim'));
    assert.equal(Q.developer('dev-000000000000', opt), null);
    const p = Q.projects({ kind: 'moch', q: 'רקפות באר שבע' }, opt);
    assert.equal(p.total, 1); assert.equal(p.rows[0].kind, 'moch-lottery-project');
    assert.equal(Q.project('moch:9990001', opt).joins.tenderLot, null);
    const all = Q.projects({}, opt);
    for (const v of Object.values(all.pipeline)) assert.ok(!('units' in v) && Object.keys(v).every((k) => k === 'ila' || k === 'moch'), 'per source, never one summed figure');
    assert.equal(all.pipeline['land-awarded'].ila.n, 1); assert.equal(all.pipeline['land-awarded'].ila.units, 50); assert.equal(all.pipeline.permitted.moch.units, 40);
  });
  await t('search routes exact keys first: tender number, MichrazID, plan, block/parcel; names by substring; an address with a house number', () => {
    const s = (q) => Q.search(q, opt).results;
    assert.equal(s('מכרז 158/2026')[0].type, 'tender'); assert.equal(s('158/26')[0].route.tender, T[0].id);
    assert.equal(s(String(T[0].michrazId))[0].type, 'tender');
    const plan = s('תמל/9999')[0]; assert.equal(plan.type, 'plan'); assert.equal(plan.via, 'exact-plan-number');
    assert.equal(s('גוש 99999 חלקה 7')[0].type, 'parcel'); assert.equal(s('99999/7')[0].type, 'parcel');
    assert.ok(s('אשטרומיקס').some((r) => r.type === 'developer' && r.route.section === 'intel'));
    assert.ok(s('רקפות באר שבע').some((r) => r.type === 'project'));
    const addr = s('הרצל 35 תל אביב'); assert.equal(addr[0].type, 'address'); assert.equal(addr[0].route.house, '35'); assert.equal(addr[0].route.section, 'txSection');
    assert.equal(s('באר שבע')[0].type, 'locality', 'a locality named exactly by the query comes first');
    assert.deepEqual(Q.search('x', opt).results, [], 'one character is not a query');
  });
  await t('api/intel: GET only, no-store, 404 for an unknown entity, 400 for an unknown view', async () => {
    const h = require('../api/intel');
    const call = (url, method = 'GET') => new Promise((r) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { r({ status: this.statusCode, headers: this.headers, body: b }); } }; h({ method, url }, res); });
    assert.equal((await call('/api/intel?view=status', 'POST')).status, 405);
    const st = await call('/api/intel?view=status'); assert.equal(st.status, 200); assert.match(st.headers['cache-control'], /no-store/);
    assert.equal((await call('/api/intel?view=developer&id=nope')).status, 404);
    assert.equal((await call('/api/intel?view=project&id=moch:0')).status, 404);
    assert.equal((await call('/api/intel?view=nope')).status, 400);
    const src = JSON.parse((await call('/api/intel?view=sources')).body); assert.ok(src.sources.length >= 10);
  });

  await t('vercel.json: every includeFiles fits the platform schema (≤ 256 characters) and the intel bundle names its data', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    for (const [k, f] of Object.entries(v.functions)) if (f.includeFiles) assert.ok(f.includeFiles.length <= 256, `${k}: includeFiles is ${f.includeFiles.length} characters — Vercel rejects the whole deployment`);
    const inc = v.functions['api/intel.js'].includeFiles;
    for (const need of ['data/land/tenders.json', 'data/land/meta.json', 'data/housing/', 'data/market/latest.json', 'data/transactions/sync-runs.jsonl', 'data/geo/']) assert.ok(inc.includes(need), need);
    assert.ok(!/lots-|raw/.test(inc), 'the lot shards and raw snapshots are not bundled');
  });

  console.log('trust: run states, staleness, catalogue');
  await t('the run-state vocabulary: success, unchanged, partial, refused, failed, schema change; replays and store entries are not checks', () => {
    assert.equal(TC.stateOfRun(null), 'NO_RUN');
    assert.equal(TC.stateOfRun({ status: 'ok', contentChanged: true }), 'SUCCESS');
    assert.equal(TC.stateOfRun({ status: 'ok', contentChanged: false }), 'UNCHANGED');
    assert.equal(TC.stateOfRun({ status: 'partial' }), 'PARTIAL');
    assert.equal(TC.stateOfRun({ status: 'ok', detailStopped: 'refused:429' }), 'PARTIAL');
    assert.equal(TC.stateOfRun({ status: 'refused' }), 'REFUSED'); assert.equal(TC.stateOfRun({ status: 'failed', error: 'HTTP 403 from x' }), 'REFUSED');
    assert.equal(TC.stateOfRun({ status: 'failed', error: 'timeout' }), 'FAILED');
    assert.equal(TC.stateOfRun({ status: 'failed', error: 'schema changed — missing column(s): X' }), 'SCHEMA_CHANGED');
    const now = Date.parse('2026-10-13T00:00:00Z');
    const runs = [{ id: 'a', status: 'ok', contentChanged: true, retrievalMethod: 'live-api', finishedAt: '2026-10-12T10:00:00Z' }, { id: 'a:store', status: 'ok', retrievalMethod: 'none', finishedAt: '2026-10-12T10:01:00Z' },
      { id: 'b', status: 'ok', retrievalMethod: 'replay', finishedAt: '2026-10-13T00:00:00Z' }];
    const s = TC.runSummary(runs, { staleAfterHours: 50, now });
    assert.equal(s.lastRunId, 'a'); assert.equal(s.state, 'SUCCESS'); assert.equal(s.checksRecorded, 1);
    assert.equal(TC.runSummary(runs, { staleAfterHours: 50, now: now + 3 * 864e5 }).state, 'STALE');
    assert.equal(TC.runSummary([{ id: 'r', status: 'refused', retrievalMethod: 'live-api', finishedAt: '2026-10-12T10:00:00Z' }], { staleAfterHours: 50, now }).state, 'REFUSED', 'never answered: the refusal, not "stale"');
  });
  await t('the catalogue over the committed data: every source classified, unavailable never 0, the republication never official', () => {
    const c = TC.catalog();
    assert.ok(c.sources.length >= 15);
    for (const s of c.sources) {
      assert.ok(s.id && s.classification && s.sync && TC.STATES.includes(s.sync.state), s.id);
      assert.notEqual(s.latestObservation, 0, s.id);
    }
    const over = c.sources.find((s) => s.id === 'over:deals-republication');
    assert.equal(over.channel, 'independent-republication'); assert.equal(over.classification, 'THIRD_PARTY_REPUBLICATION');
    assert.ok(c.sources.find((s) => s.id === 'datagov:moch:construction-progress').sourceStale);
    assert.ok(c.sources.some((s) => s.inProduct === false), 'audited sources that are not read are listed too');
  });

  console.log('entities: the committed data');
  await t('the registry over data/land + data/housing: notes are never developers, unmarked winners never listed, basis on every entity', () => {
    const c = Q.status();
    assert.ok(c.coverage.developers > 1000 && c.coverage.projects.mochProjects > 1000 && c.coverage.projects.ilaSites > 1000);
    const all = Q.developers({ size: 100 }), names = new Set();
    for (let p = 1; p <= all.pages; p++) for (const r of Q.developers({ size: 100, page: p }).rows) names.add(r.name);
    for (const note of ['בחירת מגרש תערך במחוז', 'מכרז בוטל', 'לא נבחר מגרש', 'הצעות זהות']) assert.equal(names.has(note), false, note);
    const R = Q.load().R;
    for (const d of R.developers) {
      assert.equal(d.basis, 'OBSERVED PROPX ACTIVITY');
      if (!d.roles.includes('moch-lottery-developer')) assert.notEqual(d.kind, 'unmarked', d.name);
    }
    assert.equal(R.coverage.projects.crossSourceJoins, 0);
  });
  await t('no credential, store address or private-person listing path in the new modules', () => {
    for (const f of ['lib/entities/names.js', 'lib/entities/registry.js', 'lib/entities/query.js', 'lib/trust/catalog.js', 'api/intel.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.doesNotMatch(src, /SITE_PASSWORD|SESSION_SECRET|SERVICE_ROLE|supabase\.co|PROPX_JOB_TOKEN/, f);
      assert.doesNotMatch(src, /land bank'|total pipeline'|"All developers"|all projects in israel/i, f);
    }
  });

  console.log(`\nentities: ${passed} passed`);
})();
