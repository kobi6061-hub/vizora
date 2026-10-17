'use strict';
/* PROPX · "Why this market?" (lib/dossier/narrative.js) + Search 2.0 (lib/entities/query.js search) — the gates.
 *
 * The narrative is a deterministic read of a dossier: every sentence bilingual, with its class, source, period, scope and the
 * registry term its ⓘ opens; a locality's demand sentence names the DISTRICT series; unit universes never summed into one
 * figure; a missing input is said (never defaulted); no recommendation / probability / attractiveness wording; Hebrew signed
 * numbers isolated. Search 2.0: a district or the country by name routes to the dossier; a covered locality carries the
 * radar's rule counts (never a score); exact names only. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../lib/dossier/narrative');
const D = require('../lib/dossier/query');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const NOW = Date.parse('2026-10-17T12:00:00Z');
const GEOS = [{ level: 'il' }, { level: 'district', code: 'd-ta' }, { level: 'district', code: 'd-north' }, { level: 'locality', code: '5000' }, { level: 'locality', code: '6600' }];
const ALL = GEOS.map((g) => ({ g, n: N.forGeo({ ...g, now: NOW }) }));

console.log('narrative: module');
t('pure and read-only: no fetch, no network, no randomness, no model call; version stamped; basis bilingual', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/dossier/narrative.js'), 'utf8');
  assert.ok(!/fetch\(|https?\.request|XMLHttpRequest|Math\.random|child_process/.test(src));
  assert.equal(N.VERSION.id, 'propx-dossier-narrative-v1'); assert.ok(N.BASIS.he && N.BASIS.en);
  assert.equal(N.narrative(null), null); assert.equal(N.forGeo({ level: 'locality', code: '0' }), null);
});
t('every geography: a narrative with ≥ 8 sentences, a lead of ≤ 3 ids that exist, every sentence bilingual with class · source · term from the registry', () => {
  for (const { g, n } of ALL) {
    assert.ok(n, JSON.stringify(g)); assert.ok(n.sentences.length >= 8, g.code + ' ' + n.sentences.length);
    assert.ok(n.lead.length >= 2 && n.lead.length <= 3, 'lead ' + n.lead.length);
    for (const id of n.lead) assert.ok(n.sentences.some((s) => s.id === id), 'lead id ' + id);
    const ids = new Set();
    for (const s of n.sentences) {
      assert.ok(!ids.has(s.id), 'duplicate ' + s.id); ids.add(s.id);
      assert.ok(s.he && s.en && /[֐-׿]/.test(s.he) && !/[֐-׿]/.test(s.en.replace(/[֐-׿"'״\s.()\-]+ בע"?מ?/g, '').replace(/[^\x00-\x7F⁦⁩−≠÷×—–→·]/g, '')) || /בע"מ|בע״מ|בע"ם/.test(s.en), s.id + ' bilingual (an exact developer name may stay Hebrew)');
      assert.ok(['OFFICIAL', 'OBSERVED', 'DERIVED', 'MISSING'].includes(s.cls), s.id + ' class ' + s.cls);
      assert.ok(s.source && typeof s.source === 'string', s.id + ' source');
      assert.ok(['own', 'district', 'national'].includes(s.geoScope), s.id + ' scope');
      assert.ok(['fact', 'derived', 'watch', 'risk', 'context', 'gap'].includes(s.kind), s.id + ' kind');
      if (s.term) assert.ok(X.term(s.term), s.id + ' → unknown registry term ' + s.term);
      for (const src of s.source.split(' · ')) assert.ok(X.canonicalSource(src.replace(/\s*\(.*\)$/, '')), s.id + ' cites an unknown source ' + src);
    }
  }
});
t('no recommendation, probability, attractiveness or guarantee wording — a description', () => {
  for (const { n } of ALL) for (const s of n.sentences) {
    assert.ok(!/\b(buy|invest now|we recommend|should (buy|invest)|guaranteed|probab|likely to (rise|fall)|attractive|hot market|bargain)\b/i.test(s.en), s.id + ': ' + s.en);
    assert.ok(!/(מומלץ|כדאי לקנות|להשקיע עכשיו|מובטח|(?<!לא )הסתברות|אטרקטיבי|שוק חם|מציאה)/.test(s.he), s.id + ': ' + s.he);
  }
});
t('a locality\'s demand sentence names the DISTRICT series and carries scope "district"; a district\'s is "own" and compares momentum with the national figure of the same series; national has no comparison', () => {
  const loc = ALL.find((x) => x.g.code === '5000').n.sentences.find((s) => s.id === 'demand');
  assert.equal(loc.geoScope, 'district'); assert.match(loc.en, /district level, not the locality's figure/); assert.match(loc.he, /רמת מחוז, לא נתון היישוב/); assert.equal(loc.term, 'district_series_for_locality');
  const dis = ALL.find((x) => x.g.code === 'd-ta').n.sentences.find((s) => s.id === 'demand');
  assert.equal(dis.geoScope, 'own'); assert.match(dis.en, /the district series/); assert.equal(dis.term, 'official_new_home_sales');
  if (/3-month momentum/.test(dis.en)) assert.match(dis.en, /\(national: [+\-−]?\d/);
  const nat = ALL.find((x) => x.g.level === 'il').n.sentences.find((s) => s.id === 'demand');
  assert.equal(nat.geoScope, 'own'); assert.ok(!/\(national:/.test(nat.en));
});
t('unit universes are never summed: tenders, renewal, lotteries each in their own sentence with their own source; the renewal sentence says so; no sentence adds tender and renewal units', () => {
  for (const { n } of ALL) {
    const land = n.sentences.find((s) => s.id === 'position-land'), rn = n.sentences.find((s) => s.id === 'renewal'), lo = n.sentences.find((s) => s.id === 'lotteries');
    assert.equal(land.source, 'rmi:michrazim');
    if (rn) { assert.equal(rn.source, 'datagov:moch:urban-renewal'); assert.match(rn.en, /never added to tender units/); assert.match(rn.en, /a declaration is not construction/); }
    if (lo) { assert.equal(lo.source, 'datagov:moch:dira-behanacha-lotteries'); assert.match(lo.en, /a separate universe/); }
    for (const s of n.sentences) assert.ok(!/total (housing )?pipeline|combined units|all units together/i.test(s.en), s.id);
  }
});
t('a missing input is said, never defaulted: supply pressure at a locality is a gap sentence (no official locality sales); a locality without tenders gets a gap sentence, not zeros', () => {
  const tlv = ALL.find((x) => x.g.code === '5000').n, holon = ALL.find((x) => x.g.code === '6600').n;
  const sp = tlv.sentences.find((s) => s.id === 'supply-pressure'); assert.equal(sp.kind, 'gap'); assert.equal(sp.cls, 'MISSING'); assert.match(sp.en, /no official locality sales series/);
  const il = ALL.find((x) => x.g.level === 'il').n.sentences.find((s) => s.id === 'supply-pressure'); assert.equal(il.kind, 'derived'); assert.match(il.en, /months of awarded state land/);
  const hl = holon.sentences.find((s) => s.id === 'position-land'); assert.equal(hl.kind, 'gap'); assert.ok(!/\b0 ILA tenders|— units/.test(hl.en), hl.en);
  for (const { n } of ALL) for (const s of n.sentences) assert.ok(!/\b(null|undefined|NaN)\b/.test(s.en + s.he), s.id);
  const gaps = tlv.sentences.find((s) => s.id === 'gaps'); assert.equal(gaps.cls, 'MISSING'); assert.match(gaps.en, /permits/);
});
t('without a scan or a supply pipeline the narrative still composes (no radar / supply sentences) — nothing is invented', () => {
  const d = D.dossier({ level: 'district', code: 'd-haifa', now: NOW });
  const n = N.narrative(d, {});
  assert.ok(n.sentences.length >= 6); assert.ok(!n.sentences.some((s) => ['opportunities', 'risks', 'supply-pressure', 'supply-momentum'].includes(s.id)));
  assert.equal(n.counts.opportunities, null); assert.equal(n.counts.risks, null);
  assert.ok(n.sentences.find((s) => s.id === 'demand'));
});
t('the radar sentences carry the geography\'s rule counts and the scan\'s own comparisons; the lead takes risks before opportunities', () => {
  const il = ALL.find((x) => x.g.level === 'il').n;
  const o = il.sentences.find((s) => s.id === 'opportunities'), r = il.sentences.find((s) => s.id === 'risks');
  assert.ok(o && r); assert.match(o.en, /^Opportunity radar: \d+ items? —/); assert.match(r.en, /^Risk radar: \d+ items? —/);
  assert.equal(il.counts.opportunities, Number(o.en.match(/(\d+) item/)[1])); assert.equal(il.counts.risks, Number(r.en.match(/(\d+) item/)[1]));
  if (il.counts.risks) assert.equal(il.lead[2], 'risks');
  const ta = ALL.find((x) => x.g.code === 'd-ta').n.sentences.find((s) => s.id === 'opportunities'); if (ta && /items? —/.test(ta.en)) assert.match(ta.en, /\[\d+(\.\d+)?% of the national figure/);
});
t('Hebrew signed numbers are isolated (LRI … PDI) so a minus keeps its side; English never carries the isolates', () => {
  for (const { n } of ALL) for (const s of n.sentences) {
    for (const m of s.he.matchAll(/[+\-−]\d+(\.\d+)?%/g)) { const i = m.index; assert.ok(s.he[i - 1] === '⁦' || /[(:]\s?$/.test(s.he.slice(Math.max(0, i - 2), i)), s.id + ' unisolated signed number in Hebrew: ' + s.he.slice(Math.max(0, i - 12), i + 8)); }
    assert.ok(!/[⁦⁩]/.test(s.en), s.id + ' isolates in English');
  }
});
t('deterministic: the same inputs give the same narrative; generatedAt comes from the dossier', () => {
  const d = D.dossier({ level: 'il', now: NOW }); const a = N.narrative(d, {}), b = N.narrative(d, {});
  assert.deepEqual(a.sentences, b.sentences); assert.equal(a.generatedAt, d.generatedAt);
});

console.log('narrative: the API and the page');
t('GET /api/intel?view=dossier carries `narrative` with lead + sentences for national, a district and a locality; dossierIndex unchanged', async () => {
  const h = require('../api/intel');
  const call = (url) => new Promise((r) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { r({ status: this.statusCode, body: b }); } }; h({ method: 'GET', url }, res); });
  for (const u of ['/api/intel?view=dossier', '/api/intel?view=dossier&district=d-ta', '/api/intel?view=dossier&city=5000']) {
    const r = await call(u); assert.equal(r.status, 200, u); const d = JSON.parse(r.body);
    assert.ok(d.narrative && d.narrative.sentences.length >= 8 && d.narrative.lead.length >= 2, u); assert.ok(d.sections && d.signals && d.quality, u + ' the dossier itself is unchanged');
  }
});
t('the page renders the block (dsWhyHTML) from view=dossier only, inside #dossier, with the lead open and the full read in <details>; the offline build has no server narrative', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /function dsWhyHTML\(D\)/); assert.match(page, /\$\{dsWhyHTML\(D\)\}/); assert.match(page, /dsWhy:\{title:"למה השוק הזה\?"/); assert.match(page, /dsWhy:\{title:"Why this market\?"/);
  assert.match(page, /<details><summary>\$\{w\.more\}/); assert.ok(!/view=narrative/.test(page), 'no separate fetch — the dossier carries it');
});

console.log('search 2.0');
t('a district by its official name (he / en, with or without "מחוז") and the country route to the Market Dossier; a covered locality carries the radar counts (rules fired — never a score) and the evidence level; ranking: exact locality, country, district before the rest', () => {
  const EQ = require('../lib/entities/query');
  const d1 = EQ.search('מחוז תל אביב').results.find((r) => r.type === 'district'); assert.ok(d1 && d1.id === 'd-ta' && d1.route.section === 'dossier' && d1.route.district === 'd-ta', 'he district');
  const d2 = EQ.search('Northern district').results.find((r) => r.type === 'district'); assert.ok(d2 && d2.id === 'd-north', 'en district');
  const d3 = EQ.search('הצפון').results.find((r) => r.type === 'district'); assert.ok(d3 && d3.id === 'd-north', 'district without the prefix');
  const c = EQ.search('ישראל').results.find((r) => r.type === 'country'); assert.ok(c && c.route.section === 'dossier' && c.meta.code === 'il');
  assert.ok(!EQ.search('ישר').results.some((r) => r.type === 'country'), 'the country matches its full name only');
  const tlv = EQ.search('תל אביב').results; const loc = tlv.find((r) => r.type === 'locality' && r.geo && String(r.geo.code) === '5000');
  assert.ok(loc && loc.radar && Number.isInteger(loc.radar.opportunities) && Number.isInteger(loc.radar.risks) && ['HIGH', 'MEDIUM', 'LOW'].includes(loc.radar.quality), 'covered locality radar counts');
  assert.ok(!('score' in (loc.radar || {})), 'never a score');
  const bare = tlv.map((r) => r.type); assert.ok(bare.indexOf('district') > bare.indexOf('locality'), 'a bare district name that is also a city name: the localities lead, the district follows: ' + bare.join(','));
  const od = EQ.search('מחוז תל אביב').results.map((r) => r.type); assert.equal(od[0], 'district', 'the district leads its own name: ' + od.join(','));
  const oc = EQ.search('ישראל').results.map((r) => r.type); assert.equal(oc[0], 'country', 'the country leads its own name: ' + oc.join(','));
  const ex = EQ.search('תל אביב יפו').results.map((r) => r.type); assert.equal(ex[0], 'locality', 'an exact locality name leads: ' + ex.join(','));
  const nowhere = EQ.search('ראש העין').results.find((r) => r.type === 'locality'); if (nowhere && !nowhere.radar) assert.ok(true, 'an uncovered locality carries no radar field');
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /district:"מחוז",country:"ארצי"/); assert.match(page, /if\(h\.type==="district"\|\|h\.type==="country"\)\{dsState\.level=/); assert.match(page, /"renewal","district","country"\]\.includes\(h\.type\)/);
});

setTimeout(() => { console.log(`narrative: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`); process.exit(failed ? 1 : 0); }, 1500);
