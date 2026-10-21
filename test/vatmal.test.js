// PROPX · VATMAL declared complexes (lib/planning/vatmal) — offline gates: the layer's own fields (number · name · locality TEXT · units ·
// dates) normalized from an ArcGIS feature, a feature without geometry or number skipped, the street relation INSIDE / NEARBY / AREA_WIDE
// from the street's own points, the declaration never called an approved plan, the page / registry / Trust / bundle / workflow wiring.
// Run: node test/vatmal.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../lib/planning/vatmal');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); } };

/* the shape the layer answered on the runner (verify.json.gz → arcgis "iplan vatmal sample", 21.10.2026) */
const sq = (lng, lat, d) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]];
const F = { attributes: { OBJECTID: 1, tamal_numb: 'תמל/ 1001', mitham: 'תל השומר מרכז', yeshuv: 'קרית אונו ורמת גן, שטח גלילי', mahoz: 'תל אביב', megish: 'רמ"י', area_plan: 1400, dunam_gis: 1356.14, yehidot: 10000, date_: 1411344000000, update_dat1: null, update_dat2: null, update_dat3: null, tama_deviation: 1450396800000 },
  geometry: { rings: [sq(34.85, 32.04, 0.01)] } };

t('NORMALIZE: the layer\'s own fields; dates from ArcGIS epoch milliseconds; the locality kept as printed TEXT (never a code); no geometry / no number → skipped', () => {
  const c = V.normalize(F);
  assert.equal(c.tamal, 'תמל/ 1001'); assert.equal(c.name, 'תל השומר מרכז'); assert.equal(c.localityText, 'קרית אונו ורמת גן, שטח גלילי'); assert.ok(!('localityCode' in c));
  assert.equal(c.units, 10000); assert.equal(c.declared, '2014-09-22'); assert.equal(c.tamaDeviationApproved, '2015-12-18'); assert.equal(c.gisDunam, 1356); assert.deepEqual(c.updates, []);
  assert.deepEqual(c.bbox, [34.85, 32.04, 34.86, 32.05]);
  assert.equal(V.normalize({ attributes: { ...F.attributes }, geometry: {} }), null); assert.equal(V.normalize({ attributes: { ...F.attributes, tamal_numb: null }, geometry: F.geometry }), null);
  assert.match(V.LAYER, /PlanningPublic\/vatmal_mitchamim_muchrazim\/MapServer\/0$/);
});
t('THE STREET RELATION (lib/streets/report.js): a located point inside → INTERSECTS (≥ 2,000 dunam → AREA_WIDE), ≤ 300 m → NEARBY, units the declaration\'s, never "approved"', () => {
  const rep = fs.readFileSync(path.join(ROOT, 'lib/streets/report.js'), 'utf8');
  assert.match(rep, /require\('\.\.\/planning\/vatmal'\)\.load\(\)/); assert.match(rep, /r\.distanceM > NEAR_M\) continue/);
  assert.match(rep, /relation: r\.inside \? \(area >= AREA_WIDE_DUNAM \? 'AREA_WIDE' : 'INTERSECTS'\) : 'NEARBY'/);
  assert.match(rep, /not an approved plan, not a permit, not construction; its declared units are the declaration\\'s, never the street\\'s/);
  assert.match(rep, /reason: 'vatmal-not-synced'/);
});
t('THE STORED LAYER (once synced): complete, every complex with a number and rings; units summed only as the declarations\' own', () => {
  const L = V.load(); if (!L) return; // before the first runner sync the report says vatmal-not-synced
  assert.equal(L.meta.complete, true); assert.equal(L.meta.stored + L.meta.skipped.noGeometryOrNumber, L.meta.layerCount);
  for (const c of L.complexes) { assert.ok(c.tamal && c.rings.length, c.oid); }
  assert.match(L.meta.note, /never an approved plan/);
});
t('WIRING: the page renders the declared complexes with an ⓘ; the registry, the Trust Center, the bundle and the workflow scope', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /xpBtn\("vatmal_declared_complex"\)/); assert.match(html, /vtNot:"A declaration is a planning track — not an approved plan/);
  assert.ok(require('../lib/explain/registry').term('vatmal_declared_complex'));
  assert.ok(require('../lib/trust/catalog').catalog().sources.some((s) => s.id === 'iplan:vatmal'));
  { const inc = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).functions['api/intel.js'].includeFiles; assert.ok(inc.length <= 256, 'Vercel caps includeFiles at 256 characters');
    assert.ok(['meta.json', 'complexes.json.gz'].every((f) => require('./helpers/vercel-include').matches(inc, `data/planning/vatmal/${f}`))); }
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/vatmal-sync.yml'), 'utf8');
  assert.match(wf, /git add data\/planning\/vatmal\n/); assert.match(wf, /node test\/vatmal\.test\.js/); assert.match(wf, /scripts\/vatmal-sync\.js/);
});
console.log(`vatmal: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
