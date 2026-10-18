'use strict';
/* PROPX · CBS construction wiring (18.10.2026): the dossier's construction section, the three supply universes, the radar events,
 * the registry terms and the page — over a data directory that carries the construction lane's TEST FIXTURE output (never the
 * product's bundled data). National + district ONLY; a locality carries its district's figure labelled as context; never summed. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../lib/dossier/query');
const SUP = require('../lib/supply/pipeline');
const EV = require('../lib/radar/events');
const VB = require('../lib/radar/verbs');
const RQ = require('../lib/radar/query');
const X = require('../lib/explain/registry');
const { runSync } = require('../lib/construction/sync');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = new Date('2026-10-17T12:00:00Z');
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/cbs-construction-sample.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const fetchJson = async (url) => { const u = new URL(url); let id = u.searchParams.get('id');
  if (u.pathname.endsWith('/catalog/level')) id = `level:${id}:${u.searchParams.get('subject')}:${u.searchParams.get('Page') || 1}`;
  let body = null;
  if (u.pathname.endsWith('/catalog/path') || u.pathname.endsWith('/catalog/level')) body = FX.catalogue[id] ? clone(FX.catalogue[id]) : null;
  else if (u.pathname.endsWith('/data/path') && FX.data[id]) { body = clone(FX.data[id]); const [sm, sy] = u.searchParams.get('startperiod').split('-'), [em, ey] = u.searchParams.get('endperiod').split('-'); for (const s of body.DataSet.Series) s.obs = s.obs.filter((o) => o.TimePeriod >= `${sy}-${sm}` && o.TimePeriod <= `${ey}-${em}`); }
  if (!body) { const e = new Error('HTTP 404 ' + url); e.status = 404; throw e; }
  const text = JSON.stringify(body); return { json: JSON.parse(text), text, status: 200 }; };

(async () => {
/* a data dir = the real bundled stores (symlinked, read-only) + the fixture-built construction store */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-cst-'));
for (const d of fs.readdirSync(path.join(ROOT, 'data'))) if (d !== 'construction') fs.symlinkSync(path.join(ROOT, 'data', d), path.join(dataDir, d));
const cdir = path.join(dataDir, 'construction'); fs.mkdirSync(cdir);
const r1 = await runSync({ dir: cdir, fetchJson, now: NOW });
assert.equal(r1.status, 'SUCCESS');
const L = JSON.parse(fs.readFileSync(path.join(cdir, 'latest.json'), 'utf8'));
const IL = D.dossier({ level: 'il', dataDir }), DC = D.dossier({ level: 'district', code: 'd-center', dataDir }), LOC = D.dossier({ level: 'locality', code: '1200', dataDir });
/* a second data dir WITHOUT a construction store — the state before the first workflow run */
const noneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'propx-cst-none-'));
for (const d of fs.readdirSync(path.join(ROOT, 'data'))) if (d !== 'construction') fs.symlinkSync(path.join(ROOT, 'data', d), path.join(noneDir, d));
const NONE = D.dossier({ level: 'locality', code: '1200', dataDir: noneDir });

console.log('construction wiring: the dossier');
t('national and district dossiers carry their OWN construction section (OFFICIAL, cbs:construction): four measures with the latest published value, period, metrics and freshness; nothing is 0 for missing', () => {
  for (const [d, key] of [[IL, 'il'], [DC, 'd-center']]) { const C = d.sections.construction; assert.ok(C && C.cls === 'OFFICIAL' && C.source === 'cbs:construction' && C.ownGeography === true, key);
    for (const id of ['permits', 'starts', 'completions', 'active']) { const M = C.measures[id]; assert.ok(M && M.state === 'OK' && M.available, key + ' ' + id); assert.equal(M.latest.value, L.measures[id].geos[key].latest.value, key + ' ' + id); assert.ok(M.latest.period && M.latest.label.he && M.latest.label.en); assert.ok(M.metrics && M.metrics.ok); assert.notEqual(M.latest.value, 0); }
    assert.equal(C.measures.active.kind, 'stock'); assert.equal(C.measures.active.freq, 'Q'); assert.equal(C.measures.starts.kind, 'flow');
    assert.ok(C.freshness && C.basis.he && C.basis.en && C.scope.he && C.scope.en); assert.ok(d.freshness.some((f) => f.id === 'construction' && f.observed)); assert.ok(!d.missing.some((m) => /construction/.test(m.id)), key + ' nothing missing'); }
  assert.match(DC.sections.construction.scope.en, /district series/);
});
t('a locality shows its DISTRICT\'s figures labelled "district level, not the locality\'s figure" — never allocated, never re-keyed — and prints the construction-locality missing reason', () => {
  const C = LOC.sections.construction; assert.ok(C && C.ownGeography === false); assert.match(C.scope.en, /district level, not the locality's figure/); assert.match(C.scope.he, /לא נתון היישוב/);
  assert.equal(C.measures.starts.latest.value, L.measures.starts.geos['d-center'].latest.value); assert.equal(C.measures.permits.latest.value, L.measures.permits.geos['d-center'].latest.value);
  assert.ok(LOC.missing.some((m) => m.id === 'construction-locality')); assert.ok(X.missing('construction-locality', 'en'));
  const src = fs.readFileSync(path.join(ROOT, 'lib/dossier/query.js'), 'utf8'); assert.ok(!/localityShare|\/ *localities\.length|\* *share|perLocality/.test(src.slice(src.indexOf('construction (CBS'), src.indexOf('land & tenders (ILA)'))), 'no allocation arithmetic');
});
t('without a construction store (the state before the first workflow run) the section is absent and the missing reason says the first sync is pending — never a default', () => {
  assert.equal(NONE.sections.construction, undefined); assert.ok(NONE.missing.some((m) => m.id === 'construction-series')); assert.ok(X.missing('construction-series', 'en'));
});
t('the dossier\'s evidence quality and signals are unchanged by the construction section (additive: no new signal, no new deduction)', () => {
  const a = D.dossier({ level: 'il', dataDir: noneDir }), b = IL; assert.equal(a.quality.score, b.quality.score); assert.deepEqual(a.signals.map((s) => s.id), b.signals.map((s) => s.id));
});

console.log('construction wiring: the supply pipeline');
t('three more parallel universes — permits, starts (with completions beside them), activeConstruction — in the ONE order; own figures for the country and a district; NEVER summed (no total across universes, no sum in the source)', () => {
  const s = SUP.supply({ level: 'il', dataDir, fresh: true }), U = s.universes;
  assert.deepEqual(s.universeOrder.slice(-3), ['permits', 'starts', 'activeConstruction']);
  assert.equal(U.permits.value, L.measures.permits.geos.il.latest.value); assert.equal(U.starts.value, L.measures.starts.geos.il.latest.value); assert.equal(U.activeConstruction.value, L.measures.active.geos.il.latest.value);
  assert.equal(U.starts.kind, 'flow'); assert.equal(U.activeConstruction.kind, 'stock'); assert.ok(U.starts.t12 && U.starts.t12.ok && U.starts.completions && U.starts.completions.value != null); assert.equal(U.activeConstruction.t12, null, 'a stock has no trailing sum');
  for (const id of ['permits', 'starts', 'activeConstruction']) { assert.equal(U[id].cls, 'OFFICIAL'); assert.equal(U[id].source, 'cbs:construction'); assert.ok(U[id].scope.he && U[id].scope.en && U[id].basis.he); assert.equal(U[id].ownGeography, true); }
  const js = JSON.stringify(s); assert.ok(!/"total"|allUnits|pipelineUnits/.test(js));
  const src = fs.readFileSync(path.join(ROOT, 'lib/supply/pipeline.js'), 'utf8'); assert.ok(!/U\.starts\.value \+|U\.permits\.value \+|\+ U\.activeConstruction/.test(src));
});
t('for a locality the three universes carry value null with the reason and the district figure as CONTEXT (districtContext, labelled) — the missing reason is printed and mapped in the registry', () => {
  const s = SUP.supply({ level: 'locality', code: '1200', dataDir, fresh: true }), U = s.universes;
  for (const id of ['permits', 'starts', 'activeConstruction']) { assert.equal(U[id].value, null, id); assert.equal(U[id].ownGeography, false); assert.ok(U[id].reason.he && U[id].reason.en); assert.ok(U[id].districtContext && U[id].districtContext.district === 'd-center' && U[id].districtContext.latest.value === L.measures[id === 'activeConstruction' ? 'active' : id].geos['d-center'].latest.value, id); assert.match(U[id].districtContext.basis.en, /context only/); }
  assert.ok(s.missing.some((m) => m.id === 'construction-locality')); assert.ok(X.missing('construction-locality', 'en'));
  const none = SUP.supply({ level: 'il', dataDir: noneDir, fresh: true }); assert.equal(none.universes.starts.value, null); assert.ok(none.missing.some((m) => m.id === 'construction-cbs')); assert.ok(X.missing('construction-cbs', 'en'));
});

console.log('construction wiring: the radar');
t('a new construction period published after the first ingestion is a NEW event (group construction, OFFICIAL, m 3, national value + districts in the detail); a revision is a REVISED event with the old value kept; the first ingestion itself produces no event', () => {
  const none = EV.build({ dataDir, days: 120, now: NOW.getTime() + 3600e3 }); assert.equal(none.events.filter((e) => /cbs-construction/.test(e.kind)).length, 0, 'first ingestion → no event');
  const obsFile = path.join(cdir, 'observations.jsonl'); const rows = fs.readFileSync(obsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const il = rows.find((o) => o.measure === 'starts' && o.geo === 'il' && o.freq === 'M' && o.period === '2026-06'), dj = rows.find((o) => o.measure === 'starts' && o.geo === 'd-jm' && o.freq === 'M' && o.period === '2026-06'), pj = rows.find((o) => o.measure === 'permits' && o.geo === 'd-jm' && o.freq === 'M' && o.period === '2026-05');
  const later = '2026-10-20T06:00:00.000Z';
  const add = [{ ...il, key: il.key.replace('2026-06', '2026-07'), period: '2026-07', value: 4810, fetchedAt: later, revision: 0 }, { ...dj, key: dj.key.replace('2026-06', '2026-07'), period: '2026-07', value: 1230, fetchedAt: later, revision: 0 }, { ...pj, value: pj.value + 40, fetchedAt: later, revision: 1 }];
  fs.appendFileSync(obsFile, add.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const b = EV.build({ dataDir, days: 120, now: Date.parse(later) + 3600e3 }); const ev = b.events.filter((e) => /cbs-construction/.test(e.kind));
  const pub = ev.find((e) => e.kind === 'cbs-construction-published'), rev = ev.find((e) => e.kind === 'cbs-construction-revised');
  assert.ok(pub && pub.group === 'construction' && pub.cls === 'OFFICIAL' && pub.m === 3 && pub.at === later, 'published'); assert.match(pub.title.en, /construction starts 2026-07 — 4,810 national/); assert.match(pub.detail.he, /1,230/); assert.equal(pub.source, 'cbs:construction');
  assert.ok(rev && rev.group === 'construction' && rev.cls === 'OFFICIAL', 'revised'); assert.match(rev.detail.en, new RegExp(`2026-05: ${pj.value.toLocaleString('en-US')} → ${(pj.value + 40).toLocaleString('en-US')}`)); assert.match(rev.detail.en, /old value is kept/);
  assert.equal(VB.verbOf(pub), 'NEW'); assert.equal(VB.verbOf(rev), 'REVISED'); assert.ok(RQ.GROUP_LABEL.construction && RQ.GROUP_LABEL.construction.he && RQ.GROUP_LABEL.construction.en); assert.ok(EV.GROUPS ? EV.GROUPS.includes('construction') : true);
});

console.log('construction wiring: the registry and the page');
t('registry terms building_permits · construction_starts · construction_completions · active_construction (OFFICIAL, group construction, cbs:construction) with the lag assumption in their limitations; the source resolves its runtime aliases', () => {
  for (const id of ['building_permits', 'construction_starts', 'construction_completions', 'active_construction']) { const T = X.term(id); assert.ok(T && T.cls === 'OFFICIAL' && T.group === 'construction', id); assert.deepEqual(T.source.ids, ['cbs:construction']); assert.ok(T.limitations.some((l) => /lag/.test(l.en))); assert.match(T.geography.en, /never allocated/); }
  assert.ok(X.SOURCES['cbs:construction'] && X.SOURCES['cbs:construction'].aliases.includes('cbs:timeseries:44,2')); assert.ok(X.GROUPS.some((g) => g.id === 'construction'));
});
t('the page renders the dossier construction tile and the three supply cards with their he/en labels, never a sum; the Pulse group label exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/S\.construction&&S\.construction\.measures/.test(html) && /xpBtn\("construction_starts"\)|"construction_starts"\)/.test(html));
  assert.ok(/for\(const id of \["permits","starts","activeConstruction"\]\)/.test(html)); assert.ok(/districtCtx/.test(html));
  for (const k of ['cst:"בנייה (למ״ס)', 'cst:"Construction (CBS)', 'permits:"היתרי בנייה', 'permits:"Building permits', 'activeConstruction:"בנייה פעילה', 'activeConstruction:"Active construction']) assert.ok(html.includes(k), k);
  assert.ok(!/שישה יקומים|six parallel universes/.test(html), 'the universe count is no longer hard-coded');
});
console.log(`construction wiring: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
