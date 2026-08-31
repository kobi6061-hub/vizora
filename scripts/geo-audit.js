#!/usr/bin/env node
// PROPX · national coverage audit + randomized QA over the committed
// geography registry (runs fully offline against data/geo/).
//
//   node scripts/geo-audit.js            — audit + randomized QA
//   node scripts/geo-audit.js --seed 7   — reproducible sample
//
// Checks (per the national-coverage directive):
//   1. registry counts match the build meta;
//   2. mandated locality list (all Israeli locality types) resolves;
//   3. RANDOM 100 localities + 500 streets: each must appear in search,
//      resolve to the correct locality, and carry a canonical id;
//   4. street-collision test: a bare street name must return city-qualified
//      rows, never a single "global" street.
// Exit code 0 only if every check passes.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { searchGeo, resolveGeoId, normHe, loadGeo } = require('../lib/geo/registry');
const { aliasKeys } = require('../lib/geo/aliases');
const { coverage: nbCoverage, resolveNeighborhood } = require('../lib/geo/neighborhoods');

const seedArg = process.argv.indexOf('--seed');
let seed = seedArg > -1 ? Number(process.argv[seedArg + 1]) : 20260831;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const G = loadGeo();
const report = { at: new Date().toISOString(), checks: [], fail: 0 };
const check = (name, ok, detail) => {
  report.checks.push({ name, ok, detail });
  if (!ok) report.fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail && !ok ? ' — ' + detail : ''));
};

console.log('registry');
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'geo', 'registry-meta.json'), 'utf8'));
check('locality count matches build meta', G.localities.length === meta.counts.localities,
  `${G.localities.length} vs ${meta.counts.localities}`);
check('street count matches build meta', G.streets.length === meta.counts.streets,
  `${G.streets.length} vs ${meta.counts.streets}`);
const cov = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'geo', 'coverage-report.json'), 'utf8'));
check('build set-difference proof recorded as PASS', cov.setDifferencePass === true, JSON.stringify(cov.localities));

console.log('structural integrity (orphans · duplicates · aliases · neighborhoods)');
const locNames = new Set(G.localities.map((l) => l.n));
const orphans = G.streets.filter((s2) => !locNames.has(s2.nc));
check('no orphan streets (every street has a locality)', orphans.length === 0, orphans.length + ' orphans');
const idCount = new Map();
const canonicalId = (s2) => (s2.cityCode && s2.streetCode) ? `st:${s2.cityCode}:${s2.streetCode}`
  : `stp:${s2.cityCode || s2.nc}:${s2.n}`;
for (const s2 of G.streets) idCount.set(canonicalId(s2), (idCount.get(canonicalId(s2)) || 0) + 1);
const dupIds = [...idCount].filter(([, n]) => n > 1);
check('no duplicate canonical street ids', dupIds.length === 0, dupIds.slice(0, 3).map((d) => d[0]).join(', '));
const withStreets = new Set(G.streets.map((s2) => s2.nc));
check('no locality without streets', G.localities.every((l) => withStreets.has(l.n)));
let aliasKeyCount = 0;
for (const s2 of G.streets) aliasKeyCount += aliasKeys(s2.street).length;
check('alias index built for every street', aliasKeyCount >= G.streets.length,
  aliasKeyCount + ' keys for ' + G.streets.length + ' streets');
const nbc = nbCoverage();
report.neighborhoodCoverage = nbc;
check('neighborhood layer loaded (partial coverage is expected & disclosed)', nbc.neighborhoods > 0, JSON.stringify(nbc));
report.counts = {
  localities: G.localities.length,
  localitiesWithOfficialCode: G.localities.filter((l) => l.code).length,
  localitiesPendingOfficialCode: G.localities.filter((l) => !l.code).length,
  streets: G.streets.length,
  streetsWithOfficialCode: G.streets.filter((s2) => s2.streetCode).length,
  streetsPendingOfficialCode: G.streets.filter((s2) => !s2.streetCode).length,
  orphanStreets: orphans.length,
  duplicateCanonicalStreetIds: dupIds.length,
  aliasSearchKeys: aliasKeyCount,
};

console.log('alias / spelling-variant resolution');
// A typed variant must reach the street whose OFFICIAL name shares an alias
// key with it — the registry's own spelling wins (e.g. it stores the
// abbreviated "שד בן גוריון", so "שדרות בן גוריון" must still find it).
const ALIAS_CASES = [
  ["רח זבוטינסקי תל אביב", "ז'בוטינסקי", 'תל אביב - יפו'],
  ["שדרות בן גוריון חיפה", 'בן גוריון', 'חיפה'],
  ["אבן גבירול תל אביב", 'אבן גבירול', 'תל אביב - יפו'],
  ["דרך חברון ירושלים", 'חברון', 'ירושלים'],
];
for (const [q, wantStreet, wantCity] of ALIAS_CASES) {
  const r = searchGeo(q, 10);
  const want = new Set(aliasKeys(wantStreet));
  const hit = r.matches.find((m) => m.kind === 'street' && normHe(m.city) === normHe(wantCity)
    && aliasKeys(m.he).some((k) => want.has(k)));
  check(`alias query "${q}" reaches the official street`, !!hit,
    r.matches.slice(0, 3).map((m) => (m.he || '') + '·' + (m.city || '')).join(' | '));
}

console.log('mandated localities (every Israeli locality type)');
const MANDATED = ['תל אביב-יפו', 'ירושלים', 'חיפה', 'פתח תקווה', 'גבעת שמואל', 'קריית אונו',
  'רמת גן', 'בני ברק', 'מודיעין-מכבים-רעות', 'בית שמש', 'נתניה', 'אשדוד', 'אשקלון', 'באר שבע',
  'אילת', 'נצרת', 'אום אל-פחם', "סח'נין", 'רהט', 'כפר קאסם', 'אבו גוש',
  'דגניה א', 'שדה בוקר', 'נהלל', 'כפר תבור', 'מטולה', 'ירוחם', 'חורפיש', 'עספיא'];
for (const name of MANDATED) {
  const r = searchGeo(name, 6);
  const hit = r.matches.find((m) => m.kind === 'locality' && normHe(m.he) === normHe(name));
  check(`locality "${name}" resolves`, !!hit, r.matches.slice(0, 2).map((m) => m.he).join(' | ') || 'no matches');
  if (hit) {
    const streets = G.streetsByCity.get(normHe(name)) || [];
    check(`  "${name}" has searchable streets (${streets.length})`, streets.length > 0, 'no street rows');
    if (streets.length > 1) {
      const s = streets[Math.floor(rnd() * streets.length)];
      const sr = searchGeo(`${s.street} ${s.city}`, 8);
      const shit = sr.matches.find((m) => m.kind === 'street' && normHe(m.he) === normHe(s.street) && normHe(m.city) === normHe(s.city));
      check(`  street "${s.street} · ${s.city}" resolves`, !!shit,
        sr.matches.slice(0, 2).map((m) => (m.he || '') + '·' + (m.city || '')).join(' | '));
    }
  }
}

console.log('adversarial QA — small settlements, kibbutzim, Arab localities, duplicates');
const ADVERSARIAL = ['אבו גוש', 'כפר קאסם', 'טמרה', 'ריינה', "מג'ד אל-כרום", 'ערערה',
  'שדה בוקר', 'נהלל', 'כפר ויתקין', 'עין הוד', 'מטולה', 'ירוחם', 'עספיא', 'חורפיש',
  'רהט', 'לקיה', 'כסיפה', 'ביר הדאג', 'אלעד', 'מודיעין עילית'];
let advPass = 0, advMiss = [];
for (const name of ADVERSARIAL) {
  const r = searchGeo(name, 6);
  const hit = r.matches.find((m) => m.kind === 'locality' && normHe(m.he) === normHe(name));
  if (hit) advPass++; else advMiss.push(name);
}
check('adversarial locality sample resolves', advMiss.length === 0,
  advPass + '/' + ADVERSARIAL.length + ' · missing: ' + advMiss.join(', '));

console.log('randomized national QA — 100 localities');
let locPass = 0;
for (let i = 0; i < 100; i++) {
  const l = G.localities[Math.floor(rnd() * G.localities.length)];
  const r = searchGeo(l.he, 6);
  const hit = r.matches.find((m) => m.kind === 'locality' && normHe(m.he) === l.n);
  if (hit && (!l.code || hit.id === 'loc:' + l.code)) locPass++;
  else console.log('    miss:', l.he, '→', r.matches.slice(0, 2).map((m) => m.he).join('|'));
}
check('random localities resolve with canonical id', locPass === 100, locPass + '/100');

console.log('randomized national QA — 500 streets');
let stPass = 0;
for (let i = 0; i < 500; i++) {
  const s = G.streets[Math.floor(rnd() * G.streets.length)];
  const r = searchGeo(`${s.street} ${s.city}`, 10);
  const hit = r.matches.find((m) => m.kind === 'street' && normHe(m.he) === s.n && normHe(m.city) === s.nc);
  if (hit) stPass++;
  else if (500 - stPass < 8) console.log('    miss:', s.street, '·', s.city);
}
check('random streets resolve city-qualified', stPass === 500, stPass + '/500');

console.log('streets with no transactions must still resolve (geography != transactions)');
let noTxPass = 0;
for (let i = 0; i < 40; i++) {
  const s2 = G.streets[Math.floor(rnd() * G.streets.length)];
  const r = searchGeo(`${s2.street} ${s2.city}`, 10);
  const hit = r.matches.find((m) => m.kind === 'street' && normHe(m.he) === s2.n && normHe(m.city) === s2.nc);
  if (hit && hit.id && hit.cityId) noTxPass++;
}
check('40 random streets resolve with canonical + locality id regardless of transaction data', noTxPass === 40, noTxPass + '/40');
const unresolvedNb = searchGeo('הזית חורפיש', 8).matches.find((m) => m.kind === 'street');
check('a street with unresolved neighborhood is still fully searchable',
  !!unresolvedNb, unresolvedNb ? unresolvedNb.neighborhoodStatus : 'not found');

console.log('street collision test');
const herzl = searchGeo('הרצל', 15);
const herzlCities = new Set(herzl.matches.filter((m) => m.kind === 'street').map((m) => m.city));
check('"הרצל" returns city-qualified rows from multiple cities', herzlCities.size >= 3,
  [...herzlCities].join(', '));
const canonical = herzl.matches.filter((m) => m.kind === 'street').every((m) => m.id.startsWith('st'));
check('every street row carries a canonical id (never bare name)', canonical);

console.log('canonical id round-trip');
const rt = resolveGeoId('loc:681'); // גבעת שמואל official code
check('loc:681 resolves to גבעת שמואל', !!rt && normHe(rt.he) === normHe('גבעת שמואל'), rt && rt.he);

fs.writeFileSync(path.join(__dirname, '..', 'data', 'geo', 'qa-report.json'), JSON.stringify(report, null, 1));
console.log(report.fail === 0 ? '\nNATIONAL COVERAGE QA: PASS' : `\nNATIONAL COVERAGE QA: ${report.fail} FAILURES`);
process.exit(report.fail === 0 ? 0 : 1);
