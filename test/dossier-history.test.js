'use strict';
/* PROPX · Market Dossier HISTORY / time machine (lib/dossier/history.js) — the gates.
 *
 * A snapshot is a PROPX read on one day: the dossier's own facts (value · class · source · period), signal ids, Radar 2.0 state
 * and evidence quality for every geography — APPEND-ONLY, one file per day, never rewritten, never deleted. A diff between two
 * snapshots is DERIVED and explainable (NEW · CHANGED · REMOVED · STATE with the radar verbs), never a verdict; no baseline → NO_SNAPSHOT,
 * never a fabricated one; a locality's sales keep the DISTRICT label verbatim; a missing value is null with its reason, never 0. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const H = require('../lib/dossier/history');
const D = require('../lib/dossier/query');
const S = require('../lib/radar/scan');
const V = require('../lib/radar/verbs');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = Date.parse('2026-10-18T03:17:00Z');
const AT = new Date(NOW).toISOString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'propx-dossier-history-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const J = (x) => JSON.stringify(x);

console.log('dossier history: the read model');
const SRC = fs.readFileSync(path.join(ROOT, 'lib/dossier/history.js'), 'utf8');
t('read-only and clock-free: no fetch / network / Math.random / Date.now in the module; nothing is deleted; the basis says a snapshot is a PROPX read and a difference between two reads is DERIVED', () => {
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random|Date\.now\(/.test(SRC));
  assert.ok(!/unlinkSync|rmSync|rmdirSync|truncate/.test(SRC), 'nothing is deleted');
  assert.match(SRC, /flag: 'wx'/, 'the day file is created exclusively — never overwritten');
  assert.match(H.BASIS.en, /A snapshot = a PROPX read on that day/); assert.match(H.BASIS.en, /DERIVED/); assert.match(H.BASIS.en, /never a recommendation/); assert.match(H.BASIS.he, /נגזר/);
  const affirmative = SRC.replace(/never a recommendation|not a probability|לא המלצה|לא הסתברות/g, '');
  assert.ok(!/recommend|probab|attractiveness|should buy|invest now|מומלץ|לקנות/i.test(affirmative), 'no verdict, probability or score wording beyond the negations');
  assert.throws(() => H.build({ now: undefined }), /`now`/, 'the read model never reads the clock itself');
});
const P = S.load({ now: NOW });
const sg = (l, c) => P.geographies.find((g) => g.level === l && String(g.code) === String(c)) || null;
const IL = D.dossier({ level: 'il', now: NOW }), DTA = D.dossier({ level: 'district', code: 'd-ta', now: NOW }), TLV = D.dossier({ level: 'locality', code: '5000', now: NOW });
const rIL = H.snapshotOf(IL, sg('il', 'il')), rDTA = H.snapshotOf(DTA, sg('district', 'd-ta')), rTLV = H.snapshotOf(TLV, sg('locality', '5000'));
t('snapshotOf: geo · at · facts { value · cls · source · period } in the level\'s registry order; every class OFFICIAL / OBSERVED / DERIVED; the signal ids and the Radar 2.0 state come from the dossier and the scan', () => {
  for (const [r, lvl] of [[rIL, 'il'], [rDTA, 'district'], [rTLV, 'locality']]) {
    assert.equal(r.geo.level, lvl); assert.ok(r.geo.code && r.geo.name.he && r.geo.name.en); assert.equal(r.at, AT);
    assert.deepEqual(Object.keys(r.facts), H.ORDER[lvl], lvl + ' order');
    for (const [id, f] of Object.entries(r.facts)) {
      assert.ok('value' in f && 'cls' in f && 'source' in f && 'period' in f, id); assert.ok(['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(f.cls), id + ' ' + f.cls); assert.ok(f.source, id);
      assert.ok(H.FACTS[id].levels.includes(lvl), id); if (f.missing) assert.ok(f.value === null && f.missing.he && f.missing.en, id);
    }
    assert.ok(Array.isArray(r.signals.watch) && Array.isArray(r.signals.risk)); assert.ok(r.radar && S.STATES[r.radar.signalState] && r.radar.stateReason.he && r.radar.stateReason.en, lvl + ' radar');
  }
  assert.deepEqual(rIL.signals.watch, [...new Set(IL.signals.filter((s) => s.kind === 'watch').map((s) => s.id))].sort()); assert.deepEqual(rIL.signals.risk, [...new Set(IL.signals.filter((s) => s.kind === 'risk').map((s) => s.id))].sort());
  assert.equal(rTLV.radar.tracked, sg('locality', '5000').tracked); assert.equal(rTLV.facts['radar.tracked'].value, sg('locality', '5000').tracked); assert.equal(rIL.radar.tracked, null);
  assert.equal(rIL.facts['sales.latest'].value, IL.sections.sales.latestValue); assert.equal(rIL.facts['sales.latest'].period, IL.sections.sales.latest);
  assert.equal(rIL.facts['land.tenders'].value, IL.sections.land.kpis.tenders); assert.equal(rIL.facts['renewal.complexes'].value, IL.sections.renewal.kpis.complexes); assert.equal(rIL.facts['housing.lotteries'].value, IL.sections.housing.kpis.lotteries);
  assert.equal(rIL.facts['developers.total'].value, IL.sections.developers.total); assert.deepEqual(rIL.facts['developers.top'].value, IL.sections.developers.top.slice(0, 5).map((x) => x.name));
  assert.equal(rIL.facts['quality.score'].value, IL.quality.score); assert.equal(rIL.facts['quality.level'].value, IL.quality.level);
  assert.equal(rIL.facts['macro.boiRate'].value, IL.sections.macro.boiRate.value); assert.equal(rIL.facts['macro.constructionInputsYoy'].value, IL.sections.macro.constructionInputsIndex.yoy);
  if (IL.sections.construction && IL.sections.construction.measures.starts && IL.sections.construction.measures.starts.latest) { assert.equal(rIL.facts['construction.starts'].value, IL.sections.construction.measures.starts.latest.value); assert.equal(rTLV.facts['construction.starts'].geoScope, 'district'); assert.match(rTLV.facts['construction.starts'].scope.en, /district level, not the locality's figure/); }
});
t('every fact id is stable and documented: class · source · kind · bilingual label · what its period means · levels; macro facts only nationally, the district dwellings index only on a district, tracked records only on a locality', () => {
  for (const [id, f] of Object.entries(H.FACTS)) { assert.match(id, /^[a-z]+\.[A-Za-z0-9]+$/); assert.ok(['OFFICIAL', 'OBSERVED', 'DERIVED'].includes(f.cls), id); assert.ok(f.source && f.label.he && f.label.en && f.period.he && f.period.en, id); assert.ok(['count', 'units', 'pct', 'rate', 'ils', 'months', 'score', 'text', 'list'].includes(f.kind), id); assert.ok(f.levels.length && f.levels.every((l) => ['il', 'district', 'locality'].includes(l)), id); }
  for (const id of ['macro.boiRate', 'macro.constructionInputsYoy', 'macro.newHomesIndexYoy']) { assert.deepEqual(H.FACTS[id].levels, ['il'], id); assert.ok(id in rIL.facts && !(id in rDTA.facts) && !(id in rTLV.facts), id + ' is national only'); }
  assert.deepEqual(H.FACTS['macro.dwellingsIndexYoy'].levels, ['district']); assert.deepEqual(H.FACTS['radar.tracked'].levels, ['locality']); assert.ok('radar.tracked' in rTLV.facts && !('radar.tracked' in rIL.facts) && !('radar.tracked' in rDTA.facts));
  assert.deepEqual(Object.keys(H.ORDER), ['il', 'district', 'locality']); for (const l of Object.keys(H.ORDER)) assert.deepEqual(H.ORDER[l], Object.keys(H.FACTS).filter((id) => H.FACTS[id].levels.includes(l)));
  assert.match(H.FACTS['land.medianPerUnit'].label.en, /not a land value/); assert.match(H.FACTS['rental.tenderUnits'].label.en, /not "rental units"/); assert.match(H.FACTS['renewal.proposedUnits'].label.en, /not construction/);
});
t('a locality\'s official sales are the DISTRICT series with the dossier\'s scope label verbatim (geoScope district) — never relabelled as the locality\'s; a district carries its own label; the values are the district\'s; nationally the scope is national', () => {
  const l = rTLV.facts['sales.latest'], d = rDTA.facts['sales.latest'];
  assert.deepEqual(l.scope, TLV.sections.sales.scope); assert.match(l.scope.en, /district level, not the locality's figure/); assert.match(l.scope.he, /רמת מחוז, לא נתון היישוב/); assert.equal(l.geoScope, 'district');
  assert.deepEqual(d.scope, DTA.sections.sales.scope); assert.match(d.scope.en, /the district series/); assert.equal(d.geoScope, 'own');
  assert.equal(l.value, d.value); assert.equal(l.period, d.period); assert.equal(rTLV.facts['sales.t12'].value, rDTA.facts['sales.t12'].value); assert.equal(rTLV.facts['sales.momentum3m'].value, rDTA.facts['sales.momentum3m'].value);
  for (const id of ['sales.latest', 'sales.t12', 'sales.momentum3m']) { assert.equal(rTLV.facts[id].geoScope, 'district', id); assert.equal(rTLV.facts[id].cls, 'OFFICIAL'); assert.equal(rTLV.facts[id].source, 'cbs:timeseries:44,10'); }
  assert.equal(rIL.facts['sales.latest'].geoScope, 'own'); assert.match(rIL.facts['sales.latest'].scope.en, /national/);
  /* on the real build no locality carries a national series as its own and none carries inventory */
  const recs = H.unpack(H.build({ now: NOW, localities: 5 }));
  for (const r of recs.filter((r) => r.geo.level === 'locality')) { for (const id of ['sales.latest', 'sales.t12', 'sales.momentum3m']) if (r.facts[id].value != null) assert.equal(r.facts[id].geoScope, 'district', r.geo.code + ' ' + id); assert.equal(r.facts['inventory.unsold'].value, null, r.geo.code); assert.ok(!('macro.boiRate' in r.facts), r.geo.code); }
});
t('missing ≠ 0: inventory on a district / locality is null with the dossier\'s own reason; a district\'s lottery units are null with the not-summed rule; a small momentum sample is null with its reason; an empty dossier yields nulls everywhere and never a 0; a value is copied, never computed', () => {
  for (const r of [rDTA, rTLV]) { const f = r.facts['inventory.unsold']; assert.equal(f.value, null, r.geo.code); assert.ok(f.missing && f.missing.id === 'inventory' && /national only/.test(f.missing.en), r.geo.code); assert.equal(r.facts['inventory.monthsSupply'].value, null); assert.equal(r.facts['inventory.monthsSupply'].missing.id, 'inventory'); }
  assert.ok(rIL.facts['inventory.unsold'].value > 0 && rIL.facts['inventory.monthsSupply'].value > 0 && !rIL.facts['inventory.unsold'].missing);
  assert.equal(rDTA.facts['housing.unitsFirst'].value, null); assert.match(rDTA.facts['housing.unitsFirst'].missing.en, /not summed across localities/); assert.equal(rDTA.facts['housing.applicantsPerUnit'].value, null); assert.equal(rDTA.facts['housing.projects'].value, null);
  assert.equal(rTLV.facts['housing.unitsFirst'].value, TLV.sections.housing.kpis.unitsFirst ?? null); assert.equal(rTLV.facts['housing.applicantsPerUnit'].value, TLV.sections.housing.kpis.applicantsPerUnit ?? null);
  const small = H.snapshotOf({ ...IL, sections: { ...IL.sections, sales: { ...IL.sections.sales, small: true } } }, sg('il', 'il')); assert.equal(small.facts['sales.momentum3m'].value, null); assert.equal(small.facts['sales.momentum3m'].missing.id, 'small-sample'); assert.equal(small.facts['sales.latest'].value, IL.sections.sales.latestValue, 'the latest month stays');
  const empty = H.snapshotOf({ geo: { level: 'locality', code: '1', name: { he: 'א', en: 'a' }, district: 'd-ta' }, generatedAt: AT, sections: {}, missing: [{ id: 'sales', he: 'אין', en: 'none' }], signals: [], quality: { score: 0, level: 'LOW' } }, null);
  for (const [id, f] of Object.entries(empty.facts)) if (!/^quality\./.test(id)) assert.equal(f.value, null, id + ' must be null, not ' + f.value);
  assert.equal(empty.facts['sales.latest'].missing.en, 'none'); assert.equal(empty.radar, null); assert.equal(empty.facts['radar.tracked'].missing.id, 'not-scanned'); assert.deepEqual(empty.signals, { watch: [], risk: [] });
  for (const [id, k] of [['land.unitsOpen', 'unitsOpen'], ['land.unitsAwarded', 'unitsAwarded'], ['land.unitsPendingDecision', 'unitsPendingDecision'], ['land.cancelled', 'cancelled'], ['land.frozen', 'frozen']]) assert.strictEqual(rTLV.facts[id].value, TLV.sections.land.kpis[k] ?? null, id);
  const cb = TLV.sections.landEconomics && TLV.sections.landEconomics.competitiveBid.current; if (cb) { assert.strictEqual(rTLV.facts['land.medianPerUnit'].value, cb.median ?? null); assert.equal(rTLV.facts['land.medianPerUnit'].n, cb.lots); if (cb.median == null) assert.ok(rTLV.facts['land.medianPerUnit'].missing); }
  assert.ok(!/\|\|\s*0\b|\?\?\s*0\b/.test(SRC), 'no `|| 0` / `?? 0` default anywhere in the read model');
});
t('pack / unpack round-trip exactly; two builds with the same `now` are byte-identical (deterministic); the file is positional per level with interned strings and carries the sources\' PROPX check dates and the scan it read', () => {
  const a = H.build({ now: NOW, localities: 2 }), b = H.build({ now: NOW, localities: 2 });
  assert.equal(J(a), J(b), 'deterministic');
  assert.equal(a.schema, 1); assert.equal(a.date, '2026-10-18'); assert.equal(a.at, AT); assert.equal(a.counts.geographies, 10); assert.deepEqual(a.counts.byLevel, { il: 1, district: 7, locality: 2 }); assert.ok(a.counts.states.SIGNALS >= 1);
  assert.deepEqual(a.order, H.ORDER); assert.deepEqual(Object.keys(a.facts), Object.keys(H.FACTS)); assert.deepEqual(a.basis, H.BASIS); assert.equal(a.generator, 'lib/dossier/history.js');
  const recs = H.unpack(a); assert.equal(recs.length, 10);
  assert.equal(J(recs.find((r) => r.geo.level === 'il')), J(rIL)); assert.equal(J(recs.find((r) => r.geo.code === 'd-ta')), J(rDTA)); assert.equal(J(recs.find((r) => r.geo.code === '5000')), J(rTLV));
  assert.ok(a.strings.length > 0 && a.geographies.every((g) => g.v.length === a.order[g.level].length && g.p.length === g.v.length));
  const locs = a.geographies.filter((g) => g.level === 'locality').map((g) => Number(g.code)); assert.deepEqual(locs, [...locs].sort((x, y) => x - y), 'localities in code order');
  assert.ok(a.sources && a.sources.sales && a.sources.sales.checked && a.sources.land, 'the PROPX check dates of the sources travel with the file'); assert.ok(a.scan && a.scan.builtAt && a.scan.geographies >= 8);
  assert.deepEqual(H.unpack({ schema: 2 }), []); assert.deepEqual(H.unpack(null), []);
});
t('APPEND-ONLY: the first write of a day creates <date>.json + index.json; a second write of the same day returns UNCHANGED and leaves the bytes identical; the index lists the days with sha256; dates / at / latestBefore / snapshots read the store', () => {
  const dir = tmp();
  const w1 = H.write({ now: NOW, outDir: dir, localities: 1 }); assert.equal(w1.status, 'SUCCESS'); assert.equal(w1.date, '2026-10-18'); assert.equal(w1.geographies, 9); assert.ok(w1.ms >= 0);
  const bytes1 = fs.readFileSync(path.join(dir, '2026-10-18.json')); assert.equal(w1.sha256, sha(bytes1)); assert.equal(w1.bytes, bytes1.length);
  const idx1 = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); assert.deepEqual(idx1.dates.map((e) => e.date), ['2026-10-18']); assert.equal(idx1.dates[0].sha256, w1.sha256); assert.equal(idx1.dates[0].geographies, 9); assert.equal(idx1.appendOnly, true); assert.deepEqual(idx1.facts, Object.keys(H.FACTS)); assert.equal(idx1.latest, '2026-10-18');
  const w2 = H.write({ now: NOW + 3600e3, outDir: dir, localities: 1 }); assert.equal(w2.status, 'UNCHANGED'); assert.ok(w2.reason.he && /never rewritten/.test(w2.reason.en)); assert.deepEqual(w2.dates, ['2026-10-18']);
  assert.ok(fs.readFileSync(path.join(dir, '2026-10-18.json')).equals(bytes1), 'bytes identical'); assert.equal(sha(fs.readFileSync(path.join(dir, 'index.json'))), sha(Buffer.from(JSON.stringify(idx1, null, 1) + '\n')), 'the index is untouched');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-10-18.json', 'index.json']);
  assert.deepEqual(H.dates({ outDir: dir }), ['2026-10-18']); assert.equal(H.latestBefore('2026-10-17', { outDir: dir }), null); assert.equal(H.latestBefore('2026-10-18', { outDir: dir }), '2026-10-18'); assert.equal(H.latestBefore('2027-01-01', { outDir: dir }), '2026-10-18');
  const snap = H.at('2026-10-18', { outDir: dir }); assert.equal(snap.records.length, 9); assert.equal(snap.at, AT); assert.equal(H.at('2026-10-17', { outDir: dir }), null); assert.equal(H.at('nonsense', { outDir: dir }), null);
  const list = H.snapshots({ outDir: dir }); assert.equal(list.count, 1); assert.equal(list.latest, '2026-10-18'); assert.equal(list.dates[0].geographies, 9); assert.equal(list.dates[0].bytes, bytes1.length); assert.ok(list.facts['sales.latest'].label.he && list.facts['sales.latest'].dataPeriod === true && list.facts['land.tenders'].dataPeriod === false); assert.equal(list.appendOnly, true);
  assert.deepEqual(H.dates({ outDir: path.join(dir, 'nowhere') }), []); assert.equal(H.snapshots({ outDir: path.join(dir, 'nowhere') }).count, 0);
});

console.log('dossier history: the diff (two synthetic snapshots in a temp store)');
const mkRec = (level, code, facts, signals, radar) => ({ geo: { level, code, name: { he: 'x', en: 'x' }, district: level === 'locality' ? 'd-ta' : level === 'district' ? code : null }, at: null,
  facts: Object.fromEntries(H.ORDER[level].map((id) => [id, Object.assign({ value: null, cls: H.FACTS[id].cls, source: H.FACTS[id].source, period: null }, facts[id] || {})])), signals, radar });
const store = tmp();
const dayFile = (date, recs) => fs.writeFileSync(path.join(store, `${date}.json`), JSON.stringify(H.pack(recs, { date, at: `${date}T03:17:00.000Z`, sources: null, scan: null })) + '\n');
const SC = { he: 'מחוז תל אביב — רמת מחוז, לא נתון היישוב', en: 'Tel Aviv district — district level, not the locality\'s figure' };
const A5000 = mkRec('locality', '5000', { 'sales.latest': { value: 300, period: '2026-08', scope: SC, geoScope: 'district' }, 'land.tenders': { value: 10, period: '2024-10-01..2026-10-01' }, 'land.unitsOpen': { value: 1000, period: '2024-10-01..2026-10-01' }, 'rental.tenders': { value: null, period: '2024-10-01..2026-10-01', missing: { id: 'rental', he: 'אין', en: 'none' } }, 'housing.lotteries': { value: 4, period: '2025-01-27' }, 'developers.top': { value: ['a', 'b'], period: '2026-10-01' }, 'quality.score': { value: 70, period: '2026-10-01' }, 'quality.level': { value: 'HIGH', period: '2026-10-01' }, 'radar.tracked': { value: 5, period: '2026-10-01' } },
  { watch: ['open-land'], risk: [] }, { signalState: 'SIGNALS', stateReason: { he: '1', en: '1 item' }, tracked: 5 });
const B5000 = mkRec('locality', '5000', { 'sales.latest': { value: 310, period: '2026-09', scope: SC, geoScope: 'district' }, 'sales.t12': { value: 7000, period: '2025-10..2026-09', scope: SC, geoScope: 'district' }, 'land.tenders': { value: 12, period: '2024-10-10..2026-10-10' }, 'land.unitsOpen': { value: 1000, period: '2024-10-10..2026-10-10' }, 'rental.tenders': { value: 3, period: '2024-10-10..2026-10-10' }, 'housing.lotteries': { value: null, period: '2025-01-27', missing: { id: 'housing', he: 'נפל', en: 'the source failed' } }, 'developers.top': { value: ['a', 'c'], period: '2026-10-10' }, 'quality.score': { value: 60, period: '2026-10-10' }, 'quality.level': { value: 'MEDIUM', period: '2026-10-10' }, 'radar.tracked': { value: 5, period: '2026-10-10' } },
  { watch: ['awarded-pipeline'], risk: ['failed-tenders'] }, { signalState: 'NO_SIGNAL', stateReason: { he: '0', en: 'no threshold crossed' }, tracked: 5 });
const IL_A = mkRec('il', 'il', { 'sales.latest': { value: 3000, period: '2026-08' }, 'inventory.unsold': { value: 85000, period: '2026-08' } }, { watch: [], risk: ['months-of-supply'] }, { signalState: 'SIGNALS', stateReason: { he: '1', en: '1' }, tracked: null });
const IL_B = mkRec('il', 'il', { 'sales.latest': { value: 3000, period: '2026-09' }, 'inventory.unsold': { value: 85000, period: '2026-08' } }, { watch: [], risk: ['months-of-supply'] }, { signalState: 'SIGNALS', stateReason: { he: '1', en: '1' }, tracked: null });
dayFile('2026-10-01', [IL_A, A5000]);
dayFile('2026-10-10', [IL_B, B5000, mkRec('locality', '4000', { 'land.tenders': { value: 1, period: 'x' } }, { watch: [], risk: [] }, null)]);
const OPT = { outDir: store };
t('diff: NEW (null → value) · CHANGED (value → value, delta on numeric facts) · REMOVED (value → null, with the reason) · STATE (the Radar 2.0 state moved); unchanged listed; a list fact has no delta; every change carries class · source · period · the verb of lib/radar/verbs.js', () => {
  const d = H.diff({ level: 'locality', code: '5000', since: '2026-10-01', ...OPT });
  assert.equal(d.status, 'OK'); assert.equal(d.from.date, '2026-10-01'); assert.equal(d.to.date, '2026-10-10'); assert.equal(d.from.at, '2026-10-01T03:17:00.000Z'); assert.ok(d.from.covered && d.to.covered); assert.equal(d.sameSnapshot, false);
  const by = Object.fromEntries(d.changes.map((c) => [c.fact, c]));
  assert.equal(by['land.tenders'].kind, 'CHANGED'); assert.equal(by['land.tenders'].from, 10); assert.equal(by['land.tenders'].to, 12); assert.equal(by['land.tenders'].delta, 2); assert.equal(by['land.tenders'].verb, 'CHANGED'); assert.deepEqual(by['land.tenders'].period, { from: '2024-10-01..2026-10-01', to: '2024-10-10..2026-10-10', moved: false });
  assert.equal(by['rental.tenders'].kind, 'NEW'); assert.equal(by['rental.tenders'].verb, 'NEW'); assert.equal(by['rental.tenders'].to, 3); assert.equal(by['rental.tenders'].wasMissing.en, 'none'); assert.equal(by['rental.tenders'].delta, null);
  assert.equal(by['housing.lotteries'].kind, 'REMOVED'); assert.equal(by['housing.lotteries'].from, 4); assert.equal(by['housing.lotteries'].to, null); assert.equal(by['housing.lotteries'].missing.en, 'the source failed'); assert.equal(by['housing.lotteries'].verb, 'CHANGED');
  assert.equal(by['developers.top'].kind, 'CHANGED'); assert.deepEqual(by['developers.top'].from, ['a', 'b']); assert.deepEqual(by['developers.top'].to, ['a', 'c']); assert.equal(by['developers.top'].delta, null); assert.equal(by['developers.top'].unit, 'list');
  assert.equal(by['quality.score'].delta, -10); assert.equal(by['quality.level'].from, 'HIGH'); assert.equal(by['quality.level'].to, 'MEDIUM'); assert.equal(by['quality.level'].delta, null);
  assert.equal(by['radar.signalState'].kind, 'STATE'); assert.equal(by['radar.signalState'].from, 'SIGNALS'); assert.equal(by['radar.signalState'].to, 'NO_SIGNAL'); assert.equal(by['radar.signalState'].reason.to.en, 'no threshold crossed');
  assert.ok(d.unchanged.includes('land.unitsOpen'), 'a moving read window with the same value is not a change'); assert.ok(d.unchanged.includes('radar.tracked')); assert.ok(!d.unchanged.includes('land.tenders'));
  for (const c of d.changes) { assert.ok(['NEW', 'CHANGED', 'REMOVED', 'STATE'].includes(c.kind), c.fact); assert.ok(['NEW', 'CHANGED'].includes(c.verb), c.fact); assert.deepEqual(c.verbLabel, V.VERBS[c.verb].label, c.fact); assert.deepEqual(c.kindLabel, H.KINDS[c.kind]); assert.ok(c.cls && c.source && c.period && 'from' in c.period && 'to' in c.period, c.fact); if (c.kind !== 'STATE') assert.ok(c.label.he && c.label.en && c.periodKind.he, c.fact); }
  assert.deepEqual(d.counts, { changes: d.changes.length, new: 2, changed: d.changes.filter((c) => c.kind === 'CHANGED').length, removed: 1, state: 1, unchanged: d.unchanged.length, signalsAdded: 2, signalsRemoved: 1 });
  assert.deepEqual(d.changes.filter((c) => c.kind === 'NEW').map((c) => c.fact), ['sales.t12', 'rental.tenders'], 'NEW in registry order');
  assert.equal(d.changes.length + d.unchanged.length, H.ORDER.locality.length + 1, 'every fact of the level is either changed or unchanged (+ the state row)');
});
t('a series fact whose period moved is CHANGED with the verb NEW (a new month published), even with the same value — and keeps the dossier\'s district scope; the radar / signal / quality blocks say from → to', () => {
  const d = H.diff({ level: 'locality', code: '5000', since: '2026-10-01', ...OPT }), by = Object.fromEntries(d.changes.map((c) => [c.fact, c]));
  assert.equal(by['sales.latest'].kind, 'CHANGED'); assert.equal(by['sales.latest'].verb, 'NEW'); assert.equal(by['sales.latest'].delta, 10); assert.deepEqual(by['sales.latest'].period, { from: '2026-08', to: '2026-09', moved: true }); assert.equal(by['sales.latest'].dataPeriod, true); assert.deepEqual(by['sales.latest'].scope, SC); assert.equal(by['sales.latest'].geoScope, 'district');
  assert.equal(by['sales.t12'].kind, 'NEW'); assert.equal(by['sales.t12'].verb, 'NEW');
  const il = H.diff({ level: 'il', code: 'il', since: '2026-10-01', ...OPT }), ilBy = Object.fromEntries(il.changes.map((c) => [c.fact, c]));
  assert.equal(ilBy['sales.latest'].kind, 'CHANGED'); assert.equal(ilBy['sales.latest'].verb, 'NEW'); assert.equal(ilBy['sales.latest'].delta, 0); assert.ok(il.unchanged.includes('inventory.unsold')); assert.equal(il.changes.length, 1); assert.equal(il.radarState.changed, false);
  assert.deepEqual(d.signals.added.map((s) => s.kind + ':' + s.id).sort(), ['risk:failed-tenders', 'watch:awarded-pipeline']); assert.deepEqual(d.signals.removed.map((s) => s.id), ['open-land']); assert.equal(d.signals.added[0].verb, 'NEW'); assert.equal(d.signals.removed[0].verb, 'CHANGED');
  assert.deepEqual(d.radarState.from, { signalState: 'SIGNALS', stateReason: { he: '1', en: '1 item' }, tracked: 5 }); assert.equal(d.radarState.to.signalState, 'NO_SIGNAL'); assert.equal(d.radarState.changed, true);
  assert.deepEqual(d.quality, { from: { score: 70, level: 'HIGH' }, to: { score: 60, level: 'MEDIUM' } });
  assert.ok(d.basis.he && d.basis.en && /DERIVED/.test(d.basis.en)); assert.deepEqual(d.verbs, V.BASIS); assert.deepEqual(d.available, ['2026-10-01', '2026-10-10']); assert.equal(d.geo.code, '5000'); assert.equal(d.geo.level, 'locality');
  assert.ok(!/recommend|verdict|probab|attractiveness|מומלץ|לקנות/i.test(J(d).replace(/never a recommendation|not a probability|לא המלצה|לא הסתברות/g, '')), 'never a verdict');
});
t('since / until resolve to the latest snapshot at or before each date; no since = the previous snapshot; the same snapshot on both sides is an empty, honest diff; NO_SNAPSHOT (with the available dates) when nothing exists at or before since — never a fabricated baseline', () => {
  const d = H.diff({ level: 'locality', code: '5000', since: '2026-10-05', until: '2026-10-12', ...OPT }); assert.equal(d.status, 'OK'); assert.equal(d.from.date, '2026-10-01'); assert.equal(d.to.date, '2026-10-10'); assert.equal(d.since, '2026-10-05'); assert.equal(d.until, '2026-10-12');
  const p = H.diff({ level: 'locality', code: '5000', ...OPT }); assert.equal(p.status, 'OK'); assert.equal(p.from.date, '2026-10-01'); assert.equal(p.to.date, '2026-10-10'); assert.equal(p.since, null);
  const s = H.diff({ level: 'locality', code: '5000', since: '2026-10-01', until: '2026-10-05', ...OPT }); assert.equal(s.status, 'OK'); assert.equal(s.sameSnapshot, true); assert.equal(s.changes.length, 0); assert.equal(s.unchanged.length, H.ORDER.locality.length); assert.deepEqual(s.signals.added, []); assert.equal(s.radarState.changed, false);
  const n = H.diff({ level: 'locality', code: '5000', since: '2026-09-01', ...OPT }); assert.equal(n.status, 'NO_SNAPSHOT'); assert.deepEqual(n.available, ['2026-10-01', '2026-10-10']); assert.match(n.reason.en, /no snapshot at or before 2026-09-01 — the first is 2026-10-01/); assert.ok(n.reason.he); assert.ok(!('changes' in n));
  const r = H.diff({ level: 'locality', code: '5000', since: '2026-10-10', until: '2026-10-01', ...OPT }); assert.equal(r.status, 'NO_SNAPSHOT');
  const e = H.diff({ level: 'il', code: 'il', since: '2026-10-01', outDir: path.join(store, 'empty') }); assert.equal(e.status, 'NO_SNAPSHOT'); assert.deepEqual(e.available, []);
  assert.equal(H.diff({ level: 'locality', code: '5000', since: 'yesterday', ...OPT }).from.date, '2026-10-01', 'an invalid since reads as none');
});
t('a geography missing from one of the two reads is NOT_COVERED ("not covered on <date>"), never diffed against nothing; an unknown geography is null (the API answers 404)', () => {
  const d = H.diff({ level: 'locality', code: '4000', since: '2026-10-01', ...OPT }); assert.equal(d.status, 'NOT_COVERED'); assert.equal(d.from.covered, false); assert.equal(d.from.note.en, 'not covered on 2026-10-01'); assert.match(d.from.note.he, /2026-10-01/); assert.equal(d.to.covered, true); assert.deepEqual(d.notCovered, ['2026-10-01']); assert.ok(!('changes' in d));
  const dd = H.diff({ level: 'district', code: 'd-ta', since: '2026-10-01', ...OPT }); assert.equal(dd.status, 'NOT_COVERED'); assert.deepEqual(dd.notCovered, ['2026-10-01', '2026-10-10']); assert.equal(dd.geo.name.he, 'מחוז תל אביב');
  assert.equal(H.diff({ level: 'locality', code: '999999', since: '2026-10-01', ...OPT }), null); assert.equal(H.diff({ level: 'district', code: 'd-nowhere', since: '2026-10-01', ...OPT }), null); assert.equal(H.diff({ level: 'street', code: '1', ...OPT }), null);
});

console.log('dossier history: wiring');
t('the workflow: daily cron + dispatch, Node 22, this test suite BEFORE the snapshot, commits ONLY data/dossier/snapshots, skips when nothing changed, pulls --rebase before push, never rebuilds the radar, never deletes', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/dossier-snapshot.yml'), 'utf8');
  assert.match(y, /cron: '17 3 \* \* \*'/); assert.match(y, /workflow_dispatch/); assert.match(y, /node-version: '22'/); assert.match(y, /permissions:\s*\n\s*contents: write/);
  assert.ok(y.indexOf('node test/dossier-history.test.js') > 0 && y.indexOf('node test/dossier-history.test.js') < y.indexOf('node scripts/dossier-snapshot.js'), 'the tests run first');
  assert.deepEqual([...y.matchAll(/git add ([^\n]+)/g)].map((m) => m[1].trim()), ['data/dossier/snapshots'], 'only the snapshot path is staged');
  assert.match(y, /git diff --cached --quiet/); assert.match(y, /git pull -q --rebase origin "\$GITHUB_REF_NAME" && git push -q origin "HEAD:\$GITHUB_REF_NAME"/); assert.match(y, /github-actions\[bot\]/);
  assert.ok(!/radar-build/.test(y)); assert.ok(!/git rm|rm -rf/.test(y)); assert.match(y, /--summary-file/);
});
t('the CLI exists, documents --data / --date / --quiet, refuses a future --date, and writes a real snapshot into a temp dir with the summary line "Dossier snapshot: <date> — <n> geographies"', () => {
  const cli = path.join(ROOT, 'scripts/dossier-snapshot.js'), src = fs.readFileSync(cli, 'utf8');
  assert.match(src, /^#!\/usr\/bin\/env node/); for (const f of ['--data', '--date', '--quiet', '--summary-file', '--out']) assert.ok(src.includes(f), f); assert.match(src, /require\('\.\.\/lib\/dossier\/history'\)/); assert.match(src, /process\.exit\(1\)/);
  const dir = tmp(), sum = path.join(dir, 'summary.txt');
  const out = execFileSync('node', [cli, '--out', dir, '--localities', '1', '--date', '2026-10-18', '--summary-file', sum], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /^Dossier snapshot: 2026-10-18 — 9 geographies/); assert.match(fs.readFileSync(sum, 'utf8'), /^Dossier snapshot: 2026-10-18 — 9 geographies\n/); assert.ok(fs.existsSync(path.join(dir, '2026-10-18.json')) && fs.existsSync(path.join(dir, 'index.json')));
  const again = execFileSync('node', [cli, '--out', dir, '--localities', '1', '--date', '2026-10-18'], { cwd: ROOT, encoding: 'utf8' }); assert.match(again, /UNCHANGED/);
  assert.throws(() => execFileSync('node', [cli, '--out', dir, '--date', '2999-01-01'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }), /in the future/);
});
t('the API routes dossierHistory (404 unknown geography; 200 NO_SNAPSHOT or OK) and dossierSnapshots behind a guarded require; the header documents both views', () => {
  const api = fs.readFileSync(path.join(ROOT, 'api/intel.js'), 'utf8');
  assert.match(api, /let HIST = null; try \{ HIST = require\('\.\.\/lib\/dossier\/history'\); \} catch/);
  assert.match(api, /if \(view === 'dossierHistory'\) \{ if \(!HIST\) return send\(res, 404, \{ error: 'dossier history not available' \}\); const level = p\.city \? 'locality' : p\.district \? 'district' : 'il'; const out = HIST\.diff\(\{ level, code: p\.city \|\| p\.district \|\| 'il', since: p\.since, until: p\.until \}\); return out \? send\(res, 200, out\) : send\(res, 404, \{ error: 'unknown geography' \}\); \}/);
  assert.match(api, /if \(view === 'dossierSnapshots'\) \{ if \(!HIST\) return send\(res, 404, \{ error: 'dossier history not available' \}\); return send\(res, 200, HIST\.snapshots\(\)\); \}/);
  assert.match(api, /\/\/   view=dossierHistory /); assert.match(api, /\/\/   view=dossierSnapshots /);
  const handler = require('../api/intel');
  const call = (url) => { const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; handler({ method: 'GET', url }, res).catch(() => {}); return { code: res.statusCode, json: res.body ? JSON.parse(res.body) : null }; };
  const u = call('/api/intel?view=dossierHistory&city=999999&since=2026-10-01'); assert.equal(u.code, 404); assert.equal(u.json.error, 'unknown geography');
  const h = call('/api/intel?view=dossierHistory&city=5000&since=2026-10-01'); assert.equal(h.code, 200); assert.ok(['OK', 'NO_SNAPSHOT', 'NOT_COVERED'].includes(h.json.status)); assert.ok(Array.isArray(h.json.available) && h.json.basis.he);
  const n = call('/api/intel?view=dossierHistory&since=1999-01-01'); assert.equal(n.code, 200); assert.equal(n.json.status, 'NO_SNAPSHOT'); assert.equal(n.json.geo.level, 'il');
  const l = call('/api/intel?view=dossierSnapshots'); assert.equal(l.code, 200); assert.ok(Number.isInteger(l.json.count) && l.json.facts['sales.latest'] && l.json.appendOnly === true);
});
t('the README section and the CLAUDE.md bullet exist; no first snapshot is committed by hand (the workflow writes data/dossier/snapshots/)', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/dossier/README.md'), 'utf8'), /## Dossier history \/ time machine \(18\.10\.2026\)/);
  const cl = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'); assert.ok(cl.includes('`lib/dossier/history.js`') && cl.includes('dossier-snapshot.yml') && cl.includes('view=dossierHistory'));
  const dir = path.join(ROOT, 'data/dossier/snapshots'); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { assert.match(f, /^(\d{4}-\d{2}-\d{2}|index)\.json$/, f); if (f !== 'index.json') assert.equal(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).generator, 'lib/dossier/history.js', f + ' is bot-written by the read model'); }
});
console.log(`dossier history: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
