// INFORMATION HIERARCHY (Enterprise pilot, 21.10.2026) — the page is ordered the way an investor / analyst works: search ·
// investment intelligence · latest transactions · valuation · planning opportunities · risks · detailed market evidence.
// Presentation only: these gates pin the ORDER and that nothing was dropped on the way (every section, rail item, report block
// and disclosure is still there). Run: node test/hierarchy.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let n = 0;
const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const before = (a, b, src = INDEX) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0, a); assert.ok(j >= 0, b); assert.ok(i < j, `${a} before ${b}`); };

at('the launchpad sits under the search and lists the priorities in order (+ What changed here · Deal Lab, live build only), each to an existing section and rail item', () => {
  before('id="searchInput"', 'id="launchpad"');
  const lp = INDEX.slice(INDEX.indexOf('id="launchpad"'), INDEX.indexOf('</nav>', INDEX.indexOf('id="launchpad"')));
  const targets = [...lp.matchAll(/data-lp="([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ['dossier', 'changes', 'txSection', 'prices', 'dealLab', 'land', 'pulse', 'sources']);
  for (const t of targets) {
    assert.match(INDEX, new RegExp(`<section class="blk" id="${t}"`), t);
    assert.match(INDEX, new RegExp(`class="ri[^"]*" data-sec="${t}"`), `${t}: the tile clicks its rail item`);
  }
  /* the two server features sit between live:begin / live:end (the offline build strips them, like their sections and rail items) */
  for (const t of ['changes', 'dealLab']) assert.match(lp, new RegExp(`<!-- live:begin --><a class="lp-t" href="#${t}" data-lp="${t}">[^]*?<!-- live:end -->`), `${t} tile is live-only`);
  for (const k of ['lpHint', 'lp1', 'lp2', 'lp3', 'lp4', 'lp5', 'lp6', 'lp7', 'lp7s', 'lp8', 'lp8s', 'grp1', 'grp2', 'grp3', 'grp4']) {
    assert.equal((INDEX.match(new RegExp(`\\b${k}:"[^"]+"`, 'g')) || []).length, 2, `${k} in Hebrew and English`);
  }
});

at('the page sections follow the same order, under four group headings — and every section is still there (+ What changed here · Deal Lab)', () => {
  const main = INDEX.slice(INDEX.indexOf('<main class="wrap">'), INDEX.indexOf('</main>'));
  const order = [...main.matchAll(/^ {2}<(?:section class="blk"(?: id="([A-Za-z]+)")?|div class="secgrp" id="(grp\d)")/gm)].map((m) => m[1] || m[2] || 'saleRent');
  assert.deepEqual(order, ['overview', 'geoView', 'grp1', 'dossier', 'pulse', 'changes', 'grp2', 'txSection', 'prices', 'saleRent', 'dealLab', 'map', 'table', 'rankings', 'compare',
    'insightsSec', 'capital', 'calc', 'grp3', 'intel', 'housing', 'land', 'grp4', 'guide', 'sources']);
});

at('the rail follows the groups; the scroll-spy set (18 live, the two server features stripped offline) and ALTARIS stays between Land and Guide', () => {
  const rail = INDEX.slice(INDEX.indexOf('<nav class="rail"'), INDEX.indexOf('</nav>', INDEX.indexOf('<nav class="rail"')));
  const items = [...rail.matchAll(/href="([^"]+)"|class="rail-div"/g)].map((m) => m[1] || '|');
  assert.deepEqual(items, ['#overview', '#dossier', '#pulse', '#changes', '|', '#txSection', '#prices', '#dealLab', '#map', '#table', '#compare', '#insightsSec', '#capital', '#calc', '|',
    '#intel', '#housing', '#land', '/altaris', '#guide', '#sources', '/api/logout']);
  assert.equal((rail.match(/class="ri[^"]*" data-sec=/g) || []).length, 18);   /* + What changed here · Deal Lab (live build only) */
});

at('a launchpad / rail jump stays on its section while the sections above it load (cold first load) — and lets the reader go', () => {
  const spy = INDEX.slice(INDEX.indexOf('(function railSpy(){'), INDEX.indexOf('/* ---------- breadcrumb ---------- */'));
  assert.match(INDEX, /#launchpad \[data-lp\]"\)\.forEach\(a=>a\.addEventListener\("click",e=>\{const r=document\.querySelector\(`\.rail \.ri\[data-sec=/, 'a tile clicks its rail link');
  assert.match(spy, /new ResizeObserver\(/, 'the target is re-anchored when the page above it grows');
  assert.match(spy, /performance\.now\(\)-t0<15000/, 'for at most 15 s after the jump');
  assert.match(spy, /\["wheel","touchstart","keydown","pointerdown"\]\.forEach/, 'the reader\'s own input ends it');
  assert.match(spy, /if\(!own&&H===h\)stop=true/, 'a scroll the page did not make ends it');
  assert.match(spy, /my===jump/, 'a newer jump ends the older one');
});

at('the street report: investment summary · latest transactions · valuation · planning · risks · map · sources — nothing dropped', () => {
  const r = INDEX.slice(INDEX.indexOf('function srHTML(g){'), INDEX.indexOf('function srSummaryText(R){'));
  const ids = [...r.matchAll(/\$\{sec\("([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['ov', 'tx', 'px', 'pl', 'risk', 'map', 'src']);
  assert.match(r, /sec\("ov",t\.nav\.ov,crumb\+latest\+kpis\+inv\+/, 'the assessment (supports · against) leads');
  assert.match(r, /sec\("px",t\.pxH,prices\+propForm,/, 'the user\'s own price test sits with the valuation');
  assert.match(r, /sec\("pl",t\.plH,plan\+trn,/, 'plans + transport');
  assert.match(r, /sec\("risk",t\.riskH,risk\+sur,/, 'what could change + due diligence + the surroundings registers');
  for (const k of ['A.supports', 'A.against', 'A.couldChange', 'A.dueDiligence', 't.noScore', 't.suNot', 'propForm', 'srTxTableHTML(R)', 'srMapSVG(R)']) assert.ok(r.includes(k), k);
  for (const lang of ['nav:{ov:"סיכום השקעה",tx:"עסקאות אחרונות",px:"שווי והשוואה",pl:"תכנון והזדמנויות",risk:"סיכונים ובדיקות"',
    'nav:{ov:"Investment summary",tx:"Latest transactions",px:"Valuation",pl:"Planning & opportunities",risk:"Risks & checks"']) assert.ok(INDEX.includes(lang), lang);
});

at('the offline build carries the same order (rebuilt from index.html) — the launchpad without the two server features', () => {
  const sa = fs.readFileSync(path.join(ROOT, 'standalone', 'israel-new-homes-v2.html'), 'utf8');
  before('id="launchpad"', 'id="grp1"', sa); before('id="grp1"', 'id="grp2"', sa); before('id="grp2"', 'id="grp3"', sa); before('id="grp3"', 'id="grp4"', sa);
  const lp = sa.slice(sa.indexOf('id="launchpad"'), sa.indexOf('</nav>', sa.indexOf('id="launchpad"')));
  assert.deepEqual([...lp.matchAll(/data-lp="([A-Za-z]+)"/g)].map((m) => m[1]), ['dossier', 'txSection', 'prices', 'land', 'pulse', 'sources']);
});

console.log(`hierarchy: ${n} passed`);
