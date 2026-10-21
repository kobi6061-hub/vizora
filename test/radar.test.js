'use strict';
/* PROPX · Market Radar (lib/radar) — the gates.
 *
 * An event is a change between two PROPX reads of a source record, a new period a source published, a revision of
 * an official figure, or a change in a source's check state — never the first ingestion of a dataset, a first
 * detail read, or a parser upgrade. Every event carries its rule, class, source, PROPX observation date and the
 * source's own date. Materiality is a constant per rule. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const R = require('../lib/radar/events');
const Q = require('../lib/radar/query');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const w = (dir, rel, content) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content)); };
const lines = (arr) => arr.map((x) => JSON.stringify(x)).join('\n') + '\n';
const NOW = Date.parse('2026-10-16T12:00:00Z');

/* a synthetic data directory: two tenders, one with a real transition, one only first-read; a bulk ingestion day */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  w(dir, 'geo/localities.json', { meta: {}, localities: [{ code: 5000, he: 'תל אביב - יפו', en: 'TEL AVIV - YAFO', district: 'd-ta' }, { code: 7900, he: 'פתח תקווה', en: 'PETAH TIQWA', district: 'd-center' }] });
  const bulk = Array.from({ length: 60 }, (_, i) => ({ id: `rmi:2020${1000 + i}`, michrazId: 20201000 + i, name: `${1000 + i}/2020`, lifecycle: 'awarded', track: 'open-market', localityCode: 7900, units: 10, firstSeenAt: '2026-10-04T10:00:00Z', winners: [{ lotId: 'a', name: 'X', amount: 1 }] }));
  const tenders = bulk.concat([
    { id: 'rmi:20260101', michrazId: 20260101, name: '101/2026', lifecycle: 'awarded', track: 'subsidized', localityCode: 5000, units: 240, firstSeenAt: '2026-10-04T10:00:00Z', sourceUpdatedAt: '2026-10-14T08:00:00Z', winners: [{ lotId: 'L1', name: 'אלפא בנייה בע"מ', amount: 50000000 }] },
    { id: 'rmi:20260102', michrazId: 20260102, name: '102/2026', lifecycle: 'awarded', track: 'open-market', localityCode: 7900, units: 30, firstSeenAt: '2026-10-04T10:00:00Z', winners: [{ lotId: 'L2', name: 'בטא', amount: 1 }] },
    { id: 'rmi:20260103', michrazId: 20260103, name: '103/2026', lifecycle: 'published', track: 'rental', localityCode: 5000, units: 400, firstSeenAt: '2026-10-15T09:00:00Z', publishedDate: '2026-10-14' },
  ]);
  w(dir, 'land/tenders.json', tenders);
  w(dir, 'land/meta.json', { byLifecycle: { open: 2 }, records: tenders.length, checkedAt: '2026-10-16T08:00:00Z', snapshotFetchedAt: '2026-10-16T08:00:00Z' });
  w(dir, 'land/history.jsonl', lines([
    { id: 'rmi:20260101', field: 'lifecycle', from: null, to: 'open', observedAt: '2026-10-04T10:00:00Z' },              // first ingestion — not an event
    { id: 'rmi:20260101', field: 'lifecycle', from: 'open', to: 'closed', observedAt: '2026-10-09T10:00:00Z' },           // real
    { id: 'rmi:20260101', field: 'lifecycle', from: 'closed', to: 'awarded', observedAt: '2026-10-14T10:00:00Z' },        // real
    { id: 'rmi:20260101', field: 'winners', from: null, to: [{ lotId: 'L1', name: 'אלפא בנייה בע"מ', amount: 50000000 }], observedAt: '2026-10-14T10:00:00Z' },
    { id: 'rmi:20260102', field: 'lifecycle', from: 'decided', to: 'awarded', observedAt: '2026-10-12T10:00:00Z' },       // a first detail read — not an event
    { id: 'rmi:20260102', field: 'winners', from: null, to: [{ lotId: 'L2', name: 'בטא', amount: 1 }], observedAt: '2026-10-12T10:00:00Z' },
  ]));
  w(dir, 'renewal/complexes.json', [{ id: 'renewal:1', localityCode: 5000, city: 'תל אביב - יפו', name: 'מתחם א', declaration: 'declared', declarationDate: '2026-10-01', proposedUnits: 800, firstSeenAt: '2026-10-13T01:00:00Z', planKey: 'xplan:1' }]);
  w(dir, 'renewal/history.jsonl', lines([{ id: 'renewal:1', field: 'declaration', from: null, to: 'declared', observedAt: '2026-10-13T01:00:00Z' }, { id: 'renewal:1', field: 'declaration', from: 'not-yet-declared', to: 'declared', observedAt: '2026-10-15T01:00:00Z' }]));
  w(dir, 'renewal/planning.json', [{ id: 'xplan:1', planKey: 'xplan:1', planNumber: '507-1', name: 'תכנית א', firstSeenAt: '2026-10-13T01:00:00Z', lastUpdate: '2026-10-14' }]);
  w(dir, 'renewal/planning-history.jsonl', lines([{ id: 'xplan:1', field: 'station', from: 'הפקדה', to: 'אישור', observedAt: '2026-10-15T01:00:00Z' }]));
  w(dir, 'rental/dira-tenders.json', { meta: {}, records: [{ id: 'dira:michraz:1', kind: 'developer-tender', title: 'מכרז מספר ים/103/2026 – דירה להשכיר', tender: { michrazId: 20260103 }, terms: { rentalUnits: 300, totalUnits: 400, rentalYears: 20 }, published: '2026-10-14', firstSeenAt: '2026-10-15T10:00:00Z', link: 'https://www.renten.co.il/x' }] });
  w(dir, 'rental/dira-planning.json', { meta: {}, records: [] });
  w(dir, 'rental/history.jsonl', lines([{ id: 'dira:michraz:1', field: 'terms', from: null, to: { rentalUnits: 300 }, observedAt: '2026-10-15T10:00:00Z' }]));
  w(dir, 'cbs-sales/observations.jsonl', lines([
    { key: 'new_sold|5069|M|2026-07', measure: 'new_sold', cbs: 5069, period: '2026-07', freq: 'M', value: 3000, fetchedAt: '2026-10-01T00:00:00Z', revision: 0, sourceUpdate: '2026-09-02' },
    { key: 'new_sold|5069|M|2026-07', measure: 'new_sold', cbs: 5069, period: '2026-07', freq: 'M', value: 3120, fetchedAt: '2026-10-14T00:00:00Z', revision: 1, sourceUpdate: '2026-10-07' },
    { key: 'new_sold|5069|M|2026-08', measure: 'new_sold', cbs: 5069, period: '2026-08', freq: 'M', value: 3316, fetchedAt: '2026-10-14T00:00:00Z', revision: 0, sourceUpdate: '2026-10-07' },
    { key: 'new_sold|5074|M|2026-08', measure: 'new_sold', cbs: 5074, period: '2026-08', freq: 'M', value: 381, fetchedAt: '2026-10-14T00:00:00Z', revision: 0, sourceUpdate: '2026-10-07' },
  ]));
  w(dir, 'cbs-sales/latest.json', { schema: 1, sourceUpdate: '2026-10-07', checkedAt: '2026-10-15T17:00:00Z', freshness: { state: 'CURRENT' }, records: { revisions: 1 }, geos: { il: { cbs: 5069, level: 'national', name: { he: 'ארצי', en: 'national' }, metrics: { ok: true, latest: '2026-08', latestValue: 3316, t12: { value: 35721 }, ytd: { ok: true, value: 24000 }, prevYtd: { ok: true, value: 22000 }, ytdChange: { ok: true, pct: 9.1 }, momentum: { m3: { ok: true, pct: 4 } }, small: false } } }, inventory: { latest: { period: '2026-08', value: 85682 } }, monthsSupply: { latest: { period: '2026-08', value: 25.8 } } });
  w(dir, 'market/snapshots/indicators/2026-10-01T00-00-00-000Z-a.json', { at: '2026-10-01T00:00:00Z', payload: { boiRate: { value: 3.5, publishedAt: '2026-08-01' }, newHomesIndex: { yoy: -0.8, period: { year: 2026, month: 6 } } } });
  w(dir, 'market/snapshots/indicators/2026-10-16T08-00-00-000Z-b.json', { at: '2026-10-16T08:00:00Z', payload: { boiRate: { value: 3.25, publishedAt: '2026-09-01' }, newHomesIndex: { yoy: -0.4, mom: -0.4, period: { year: 2026, month: 7 } } } });
  w(dir, 'market/latest.json', { syncedAt: '2026-10-16T08:00:00Z', indicators: { boiRate: { value: 3.25, publishedAt: '2026-09-01' }, newHomesIndex: { yoy: -0.4, period: { year: 2026, month: 7 } }, constructionInputsIndex: { yoy: 3.6, period: { year: 2026, month: 9 } } } });
  w(dir, 'housing/lotteries.json', [{ id: 'ho:1', lotteryId: 1, projectName: 'פרויקט א', city: 'פתח תקווה', localityCode: 7900, program: 'mishtaken', unitsInLottery: 120, lotteryDate: '2026-10-20', firstSeenAt: '2026-10-15T07:00:00Z' }]);
  return dir;
}

console.log('radar: rules');
t('every rule is bilingual, grouped and carries a class and a materiality constant', () => {
  for (const [k, r] of Object.entries(R.RULES)) { assert.ok(r.he && r.en, k); assert.ok(R.GROUPS.includes(r.group), k); assert.ok(['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(r.cls), k); assert.ok([1, 2, 3].includes(r.m), k); }
  assert.ok(Object.keys(R.RULES).length >= 24);
  const src = fs.readFileSync(path.join(ROOT, 'lib/radar/events.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random/.test(src), 'the radar fetches nothing and rolls no dice');
});
const DIR = fixture();
const P = R.build({ dataDir: DIR, now: NOW, days: 60 });
const kinds = (list) => list.map((e) => e.kind);
t('a real lifecycle transition is an event; the first ingestion and a first detail read (decided → awarded) are not', () => {
  const t101 = P.events.filter((e) => e.entity && (e.entity.id === 'rmi:20260101' || e.entity.tenderId === 'rmi:20260101'));
  assert.deepEqual(kinds(t101).sort(), ['developer-wins-land', 'tender-awarded', 'tender-closed'].sort(), JSON.stringify(kinds(t101)));
  assert.ok(!P.events.some((e) => e.entity && e.entity.id === 'rmi:20260102'), 'the detail-read tender produced an event');
  const aw = t101.find((e) => e.kind === 'tender-awarded'); assert.equal(aw.values.from, 'closed'); assert.equal(aw.m, 3, '240 units → materiality 3'); assert.equal(aw.geo.city, 'תל אביב - יפו'); assert.equal(aw.geo.district, 'd-ta');
  assert.equal(aw.sourceDate, '2026-10-14T08:00:00Z'); assert.equal(aw.at, '2026-10-14T10:00:00Z');
});
t('a developer win names the developer as published (never merged) beside a real award; a bulk ingestion day yields no "new" events', () => {
  const win = P.events.find((e) => e.kind === 'developer-wins-land'); assert.equal(win.entity.name, 'אלפא בנייה בע"מ'); assert.equal(win.values.lots, 1); assert.match(win.detail.en, /never merged/);
  assert.equal(P.events.filter((e) => e.kind === 'tender-new').length, 1, 'only the tender first seen on an ordinary day');
  assert.equal(P.events.find((e) => e.kind === 'tender-new').entity.id, 'rmi:20260103');
});
t('renewal: the first-ingestion declaration is skipped; the later not-yet-declared → declared is an event; a plan station change is a planning event with its complexes', () => {
  const d = P.events.filter((e) => e.kind === 'renewal-declared'); assert.equal(d.length, 1); assert.equal(d[0].at, '2026-10-15T01:00:00Z'); assert.equal(d[0].values.from, 'not-yet-declared');
  const ps = P.events.find((e) => e.kind === 'plan-status'); assert.ok(ps); assert.equal(ps.entity.name, '507-1'); assert.deepEqual(ps.entity.complexes, ['renewal:1']); assert.equal(ps.geo.localityCode, '5000');
});
t('rental: a new notice joins its ILA tender by the printed number; a PROPX terms re-parse is not an event', () => {
  const r = P.events.filter((e) => e.group === 'rental'); assert.equal(r.length, 1); assert.equal(r[0].kind, 'rental-notice-new'); assert.equal(r[0].entity.tenderId, 'rmi:20260103'); assert.match(r[0].detail.en, /300 long-term rental units of 400 · 20 years/);
});
t('CBS: a new month is an event with its district breakdown; a revision keeps the old value beside the new with its change', () => {
  const m = P.events.find((e) => e.kind === 'cbs-month-published'); assert.ok(m); assert.equal(m.values.period, '2026-08'); assert.match(m.detail.he, /מחוז תל אביב 381/);
  const rv = P.events.find((e) => e.kind === 'cbs-revised'); assert.ok(rv); assert.deepEqual(rv.values.rows, [{ period: '2026-07', from: 3000, to: 3120 }]); assert.match(rv.detail.en, /3,000 → 3,120 \(\+4\.0%\)/); assert.equal(rv.m, 2);
});
t('macro: a rate change and a new index period come from consecutive dated snapshots', () => {
  const b = P.events.find((e) => e.kind === 'boi-rate-changed'); assert.ok(b); assert.deepEqual(b.values, { from: 3.5, to: 3.25 });
  const i = P.events.find((e) => e.kind === 'index-published'); assert.ok(i); assert.equal(i.values.period, '2026-07'); assert.equal(i.values.yoy, -0.4);
});
t('housing: a lottery first seen on an ordinary day is new; a lottery dated within 14 days is due', () => {
  assert.ok(P.events.some((e) => e.kind === 'lottery-new' && e.geo.city === 'פתח תקווה'));
  assert.ok(P.events.some((e) => e.kind === 'lottery-due' && e.sourceDate === '2026-10-20'));
});
t('every event: unique id, rule, bilingual title/detail, class from its rule, PROPX date and source date kept apart, newest first', () => {
  const ids = new Set(); let prev = null;
  for (const e of P.events) { assert.ok(!ids.has(e.id), e.id); ids.add(e.id); assert.ok(R.RULES[e.kind]); assert.equal(e.cls, R.RULES[e.kind].cls); assert.ok(e.title.he && e.title.en); assert.ok('sourceDate' in e); assert.ok(e.at); if (prev) assert.ok(e.at <= prev, 'order'); prev = e.at; }
  assert.equal(P.schema, 1); assert.ok(P.counts.land >= 3);
});
t('build is deterministic for a data directory and a clock', () => { const P2 = R.build({ dataDir: DIR, now: NOW, days: 60 }); assert.equal(JSON.stringify(P2.events), JSON.stringify(P.events)); });

console.log('radar: the feed and the pulse');
t('feed: windows, group / kind / city / district / text filters intersect; counts and cities describe the filtered set; paging', () => {
  const f = Q.feed({ window: '30d' }, { dataDir: DIR, now: NOW });
  assert.equal(f.total, P.events.filter((e) => Date.parse(e.at) >= NOW - 30 * 86400e3).length); assert.equal(f.served, 'built-on-read');
  const g = Q.feed({ window: '30d', group: 'land', city: '5000' }, { dataDir: DIR, now: NOW }); assert.ok(g.total >= 2 && g.rows.every((e) => e.group === 'land' && e.geo.localityCode === '5000'));
  const d = Q.feed({ window: '30d', district: 'd-center' }, { dataDir: DIR, now: NOW }); assert.ok(d.rows.every((e) => e.geo.district === 'd-center'));
  const q = Q.feed({ window: '30d', q: 'אלפא' }, { dataDir: DIR, now: NOW }); assert.equal(q.total, 1);
  const today = Q.feed({ window: 'today' }, { dataDir: DIR, now: NOW }); assert.ok(today.rows.every((e) => e.at.startsWith('2026-10-16')));
  const pg = Q.feed({ window: '30d', size: 2, page: 2 }, { dataDir: DIR, now: NOW }); assert.equal(pg.rows.length, 2); assert.equal(pg.page, 2);
  assert.ok(f.basis.he && f.basis.en && f.rules && f.groups.land.en === 'land & tenders');
});
t('the file written by scripts/radar-build.js is served when present, and the live repository builds without error', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-out-'));
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/radar-build.js'), '--data', DIR, '--out', out, '--days', '60', '--now', new Date(NOW).toISOString(), '--quiet']);
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8')); assert.equal(meta.events, P.events.length);
  const live = R.build({ dataDir: path.join(ROOT, 'data'), days: 120 }); assert.ok(live.events.length > 0 && live.events.length < 5000, 'a sane number of events over the live histories: ' + live.events.length);
  assert.ok(fs.existsSync(path.join(ROOT, 'data/radar/events.json')), 'the committed radar file');
  const f = Q.feed({ window: '90d' }); assert.equal(f.served, 'file');
});
t('pulse: official sales / inventory / land / developers / planning / rental / housing / macro / sources, each with its source and class; headline facts are one-liners from those sections', () => {
  const p = Q.pulse({ dataDir: DIR, now: NOW });
  for (const k of ['sales', 'inventory', 'land', 'developers', 'planning', 'rental', 'housing', 'macro', 'sources']) assert.ok(p.sections[k], k);
  assert.equal(p.sections.sales.cls, 'OFFICIAL'); assert.equal(p.sections.sales.latestValue, 3316); assert.equal(p.sections.inventory.value, 85682); assert.equal(p.sections.inventory.monthsSupply, 25.8);
  assert.match(p.sections.inventory.scope.en, /national only/);
  assert.ok(p.facts.length >= 7 && p.facts.every((f) => f.he && f.en && f.k));
  assert.match(p.facts.find((f) => f.k === 'sales').en, /2026-08 — 3,316 national · 12 months 35,721 · YTD \+9\.1%/);
  assert.match(p.facts.find((f) => f.k === 'inventory').en, /85,682 \(2026-08\) · 25\.8 months of supply — national/);
  assert.ok(p.sections.land.week.awarded >= 1); assert.equal(p.sections.developers.month.wins, 1);
  assert.ok(!/estimat|forecast|תחזית/i.test(JSON.stringify(p.facts)), 'facts only');
});
t('the intel API routes radar and pulse; the Vercel bundle carries data/radar; every sync workflow builds the radar before it commits', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8');
  assert.match(api, /if \(view === 'radar'\) return send\(res, 200, RADAR\.feed\(p\)\);/); assert.match(api, /if \(view === 'pulse'\) return send\(res, 200, RADAR\.pulse\(\)\);/);
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); assert.ok(['events.json', 'meta.json', 'scan.json'].every((f) => require('./helpers/vercel-include').matches(v.functions['api/intel.js'].includeFiles, 'data/radar/' + f))); assert.ok(v.functions['api/intel.js'].includeFiles.length <= 256);
  for (const wf of ['land-sync', 'renewal-sync', 'rental-sync', 'cbs-sales-sync', 'market-sync', 'data-sync']) assert.match(fs.readFileSync(path.join(ROOT, '.github/workflows', wf + '.yml'), 'utf8'), /node scripts\/radar-build\.js && git add data\/radar/, wf);
});

console.log(`radar: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
