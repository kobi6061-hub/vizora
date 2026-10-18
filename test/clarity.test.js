'use strict';
/* PRODUCT CLARITY (STEP 2A §8–§16, 19.10.2026) — one explanation system (lib/explain/registry.js), now also carrying the evidence
   LEGEND, each section's ORIENTATION and the ENTITY TYPES; the page wires them: an orientation line + "how to read this" on every
   major section, every evidence label opens its legend entry, a standard entity badge in every drawer, the entity drawer's trail
   (a POSSIBLE / AMBIGUOUS step marked, never a hierarchy), the five questions over the diligence summary, and the project-company
   statement that follows the actual evidence count with WHY PROPX THINKS THIS. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const X = require('../lib/explain/registry.js');

let n = 0; const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const bil = (v, what) => { assert.ok(v && typeof v.he === 'string' && v.he.trim() && typeof v.en === 'string' && v.en.trim(), what); };

console.log('clarity: registry');
at('ONE evidence legend: the seven classes and five match states the brief names, each with what it means and what it does NOT mean, in both languages', () => {
  const codes = X.LEGEND.map((x) => x.code);
  for (const c of ['OFFICIAL', 'OBSERVED', 'DERIVED', 'SELF_REPORTED', 'USER_DOCUMENT', 'MISSING', 'CONFLICT']) assert.equal(X.legend(c, 'en').group, 'class', c);
  for (const c of ['VERIFIED', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'AMBIGUOUS', 'UNRESOLVED']) assert.equal(X.legend(c, 'en').group, 'match', c);
  for (const c of Object.keys(X.CLASSES)) assert.ok(codes.includes(c), 'every registry class is in the legend: ' + c);
  for (const x of X.LEGEND) { bil(x.label, x.code + ' label'); bil(x.means, x.code + ' means'); bil(x.notMeans, x.code + ' notMeans'); assert.match(x.notMeans.en, /\bnot\b|≠/i, x.code); }
  assert.equal(new Set(codes).size, codes.length, 'no duplicate entry');
});
at('every label the page prints maps to a legend entry: the board chips, the diligence classes, the match states', () => {
  const boardMap = /const XP_LEG_OF=(\{[^}]*\})/.exec(INDEX); assert.ok(boardMap);
  const map = JSON.parse(boardMap[1].replace(/(\w+):/g, '"$1":'));
  for (const k of ['raw', 'static', 'der', 'obs', 'mod', 'na', 'usr']) assert.ok(X.legend(map[k], 'en'), 'board chip ' + k);
  for (const block of ['cls:{VERIFIED:"VERIFIED"', 'm:{VERIFIED:"VERIFIED"']) {
    const m = new RegExp(block.replace(/[{}]/g, '\\$&') + '([^}]*)\\}').exec(INDEX); assert.ok(m, block);
    for (const k of (block.slice(block.indexOf('{') + 1).split(':')[0] + ':' + m[1]).match(/([A-Z_]+):/g).map((s) => s.slice(0, -1))) assert.ok(X.legend(k, 'en'), 'diligence label ' + k);
  }
});
at('orientation for every major section: what · kind · helps · scope · how current · how to read — and each section exists on the page with a heading', () => {
  const ids = JSON.parse(/const ORIENT_IDS=(\[[^\]]*\])/.exec(INDEX)[1]);
  assert.ok(ids.length >= 12);
  for (const id of ids) {
    const S = X.SECTIONS[id]; assert.ok(S, id);
    for (const k of ['what', 'kind', 'helps', 'scope', 'current']) bil(S[k], id + '.' + k);
    assert.ok(S.read.length >= 1); S.read.forEach((r, i) => bil(r, id + '.read' + i));
    assert.match(INDEX, new RegExp(`id="${id}"`), id + ' on the page');
  }
});
at('a standard badge for every entity type the brief names (and every type a drawer shows), each saying what it is NOT', () => {
  const brief = ['developer', 'company', 'project', 'lot', 'tender', 'permit', 'locality', 'district', 'country'];
  const used = ['developer', 'project', 'lot', 'company', 'contractor', 'permit', 'renewal', 'lottery', 'tender', 'country', 'district', 'locality'];
  for (const id of new Set([...brief, ...used])) { const E = X.ENTITY_TYPES[id]; assert.ok(E, id); bil(E.label, id); bil(E.what, id); bil(E.notA, id); }
  assert.equal(X.entityType('developer', 'en').label, 'DEVELOPER — BRAND');
  assert.match(X.entityType('developer', 'en').notA, /not a legal entity/);
  assert.equal(X.entityType('company', 'en').label, 'LEGAL COMPANY');
});

console.log('clarity: page');
at('every major section gets its orientation line + "how to read this" (rendered after load and on every language switch)', () => {
  assert.match(INDEX, /function renderOrient\(\)\{[^\n]*X\.section/);
  assert.match(INDEX, /data-xpsec="\$\{id\}">\$\{xpT\(\)\.howToRead\} ⓘ<\/button>/);
  assert.match(INDEX, /\ninitDossier\(\);\nrenderOrient\(\);\n/);
  assert.match(INDEX, /function setLang\(lang\)\{[^}]*setStatics\(\);refresh\(false\);\n  if\(typeof renderOrient==="function"\)renderOrient\(\);/);
  assert.match(INDEX, /else if\(trigger\.dataset\.xpsec&&X\.section\)/);
});
at('the legend is reachable from the labels themselves (capture phase, before a row under the label acts) and from every orientation / badge panel', () => {
  assert.match(INDEX, /document\.addEventListener\("click",e=>\{const c=e\.target\.closest\("\.vc,\.dd-pc,\.dd-m"\);[^]{0,400}?\},true\);/);
  assert.match(INDEX, /else if\(trigger\.dataset\.xpleg&&X\.legend\)\{[^\n]*\n[^\n]*more=xpLegendAllHTML\(g\.code\)\}/);
  assert.match(INDEX, /function xpLegendAllHTML\(cur\)/);
  assert.match(INDEX, /data-cls="\$\{ldE\(c\)\}"/, 'a registry class chip names its class (USER DOCUMENT ≠ USER ASSUMPTION)');
});
at('standard entity badges: entity, lottery and tender drawers, and the dossier\'s geography', () => {
  assert.match(INDEX, /function renderInDrawer\(\)\{renderInDrawerBody\(\);inDecor\(\)\}/);
  assert.match(INDEX, /const inEntType=\(\)=>/);
  assert.match(INDEX, /entMark\(el\("hoPanel"\),"lottery"\)/);
  assert.match(INDEX, /entMark\(el\("ldPanel"\),"tender"\)/);
  assert.match(INDEX, /entBadge\(dsState\.level==="il"\?"country":dsState\.level==="district"\?"district":"locality"\)/);
});
at('the drawer trail reflects the navigation actually taken; a step through a POSSIBLE / AMBIGUOUS link is marked; opening from outside starts a new path', () => {
  assert.match(INDEX, /if\(inState\.trailNext\)inState\.trailNext=false;else\{inState\.trail=\[\];inState\.curRel=null\}/);
  assert.match(INDEX, /poss=b\.dataset\.rel==="possible"\|\|!!\(row&&row\.querySelector\("\.dd-m-POSSIBLE_MATCH,\.dd-m-AMBIGUOUS"\)\)/);
  assert.match(INDEX, /data-indev="\$\{inE\(x\.id\)\}" data-rel="possible"/, '"possibly the same" developers are POSSIBLE steps');
  assert.match(INDEX, /if\(b\.closest\("#inPanel"\)&&\(d\.indev\|\|d\.inproj\|\|d\.inrn\|\|\(d\.dd==="company"&&d\.ddco\)\|\|\(d\.dd==="permit"&&d\.ddp\)\)\)inTrailPush\(b\);/);
  assert.match(INDEX, /possTitle:"This step was reached through a POSSIBLE \/ AMBIGUOUS link — not the same entity and not a hierarchy"/);
});
at('the five questions organise the diligence summary: every fixed row belongs to one of them', () => {
  const rows = [...new Set([...fs.readFileSync(path.join(ROOT, 'lib/dd/summary.js'), 'utf8').matchAll(/row\('(\w+)'/g)].map((m) => m[1]))];
  const of = JSON.parse(/const DD_FIVEQ_OF=(\{[^}]*\})/.exec(INDEX)[1].replace(/(\w+):/g, '"$1":'));
  for (const r of rows) assert.ok(of[r] >= 1 && of[r] <= 5, 'summary row ' + r);
  for (const q of [1, 2, 3, 4, 5]) assert.ok(Object.values(of).includes(q), 'question ' + q + ' has rows');
  assert.match(INDEX, /en:\["What am I looking at\?","What does PROPX know\?","Why does it matter\?","What does PROPX not know\?","What should I verify next\?"\]/);
});
at('the project-company status follows the evidence count — "multiple" only when there are several INDEPENDENT records — and lists WHY PROPX THINKS THIS', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/dd/projectco.js'), 'utf8');
  assert.match(src, /independent: e\.independent !== false/);
  assert.match(src, /state === 'STRONG_MATCH' && nInd > 1 \?/);
  assert.ok(!/multiple independent records/.test(src), 'no fixed "multiple" wording');
  assert.ok(!/multiple independent/.test(X.level1('project_company_status', 'en').short));
  assert.match(X.level1('project_company_status', 'en').short, /WHY PROPX THINKS THIS/);
  assert.match(INDEX, /Why PROPX thinks this/); assert.match(INDEX, /למה PROPX חושבת כך/);
});

at('ⓘ on the headline tiles of every data section (land, housing, developers, the ticker), each id a registry term', () => {
  const ids = [...INDEX.matchAll(/class="xp tp-xp" data-xp="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['new_homes_price_index_change', 'unsold_inventory', 'official_new_home_sales', 'boi_rate', 'source_freshness']);
  const ld = /const LDXP=\{([^}]*)\}/.exec(INDEX)[1];
  for (const k of ['ldKTenders', 'ldKOpen', 'ldKClosed', 'ldKAwarded', 'ldKCancelled', 'ldKUnits', 'ldKUnique', 'ldKLand', 'ldKPsm', 'ldKBids', 'ldKWinners']) assert.match(ld, new RegExp('\\[t\\.' + k + '\\]:"\\w+"'), k);
  const all = [...ids, ...[...ld.matchAll(/:"(\w+)"/g)].map((m) => m[1]), 'gov_housing_lottery', 'applicants_per_unit', 'lottery_price_per_sqm', 'developer_observed_activity', 'tender_units_awarded'];
  for (const id of all) assert.ok(X.term(id), 'registry term ' + id);
  assert.match(INDEX, /const tile=\(l,v,sub,xp="gov_housing_lottery"\)=>`[^`]*typeof xpBtn==="function"\?xpBtn\(xp\):""/);
  assert.match(INDEX, /const tile=\(l,v,s,xp="developer_observed_activity"\)=>/);
});

console.log(`clarity: ${n} passed`);
