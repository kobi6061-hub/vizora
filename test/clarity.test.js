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

/* ── the two-persona UX acceptance review (19.10.2026): the substantive comprehension failures it found, each pinned ── */
console.log('clarity: persona-review fixes');
const vm = require('node:vm');
at('the land developers table has its own header names (no function rendered as text, no "Tender number" over developer names)', () => {
  const cols = /function ldDevCols\(\)\{const t=T\(\);return \[\n  \{k:"name",label:t\.ldDvName,[^\n]*\{k:"lotsWon",label:t\.ldDvLots,/.exec(INDEX); assert.ok(cols, 'ldDevCols uses its own keys');
  for (const [k, he, en] of [['ldDvName', 'זוכה (כפי שפורסם)', 'Winner (as published)'], ['ldDvLots', 'מגרשים', 'Lots']]) {
    assert.ok(INDEX.includes(`${k}:"${he}"`) && INDEX.includes(`${k}:"${en}"`), k + ' is a plain string in both languages');
  }
  assert.match(INDEX, /ldDLots:n=>`Lots \(\$\{n\}\)`/, 'the drawer keeps its own function key');
});
at('"PARTIAL DETAIL" only while detail is partial: every listed tender checked and none pending → "DETAIL 100%"', () => {
  const fn = vm.runInNewContext('(' + /const ldDetailTagK=(DC=>[^;]+);/.exec(INDEX)[1] + ')');
  assert.equal(fn({ listed: 10649, checked: 10649, pending: 0 }), 'complete');
  assert.equal(fn({ listed: 10649, checked: 10600, pending: 49 }), 'partial');
  assert.equal(fn({ listed: 10, checked: 10, pending: 2 }), 'partial');
  assert.equal(fn(null), 'partial');
  assert.match(INDEX, /ldTagN:\{full:"FULL LIST",partial:"PARTIAL DETAIL",complete:"DETAIL 100%"/);
  assert.match(INDEX, /PD=ldDetailTagK\(S\.detailCoverage\)/); assert.match(INDEX, /\$\{ldTag\(ldDetailTagK\(DC\)\)\} \$\{t\.ldCvDetail\(/);
});
at('the diligence summary never says "nothing fired" above the watch items it summarises; a STRONG-MATCH project company names its records and is "not verified"', () => {
  const SUM = require('../lib/dd/summary.js');
  const dev = SUM.summarize({ kind: 'developer', dd: { identity: { resolution: null, observedName: 'X' }, execution: {}, signals: [{ kind: 'watch', text: { he: 'סגירה', en: '3 site-closure notices (matched by contractor name)' } }] } });
  const risks = dev.rows.find((r) => r.id === 'risks');
  assert.match(risks.en, /^no risk rule fired in the sources in coverage · watch items: 1 \(3 site-closure notices \(matched by contractor name\)\) \(≠ "no risk"\)$/);
  assert.equal(risks.cls, 'DERIVED'); assert.equal(risks.watch, 1);
  const none = SUM.summarize({ kind: 'developer', dd: { identity: { resolution: null, observedName: 'X' }, execution: {}, signals: [] } }).rows.find((r) => r.id === 'risks');
  assert.equal(none.cls, 'MISSING'); assert.match(none.en, /^no risk rule fired in the sources in coverage \(≠ "no risk"\)$/);
  const proj = SUM.summarize({ kind: 'project', devDD: null, dd: { identity: { ids: { project: 'ila:1:2' } }, ladder: { furthest: null, rungs: [] } },
    premium: { projectCompany: { state: 'STRONG_MATCH', cls: 'DERIVED', company: { name: 'Co Ltd', number: '510000001' }, whyThis: { support: [{ role: 'LAND_WINNER' }] } } } });
  const id = proj.rows.find((r) => r.id === 'identity');
  assert.equal(id.en, 'ila:1:2 · land winner: Co Ltd (510000001) — STRONG MATCH · project company not verified (the project may sit in an SPV)');
  assert.match(id.he, /זוכה הקרקע: Co Ltd \(510000001\) — התאמה חזקה · חברת הפרויקט לא אומתה/);
});
at('one class per fact across views: name-matched site closures are DERIVED; the project stage is OFFICIAL only on the project\'s own record', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/dd/developer.js'), 'utf8'), /add\('SITE_CLOSURE_NOTICE', 'watch', 'DERIVED',[^\n]*matched by contractor name/);
  const prj = fs.readFileSync(path.join(ROOT, 'lib/dd/project.js'), 'utf8');
  assert.match(prj, /const stageCls = fr && fr\.evidenced && !fr\.ddEvidenced && !\/construction-progress\/\.test\(String\(fr\.source \|\| ''\)\) \? 'OFFICIAL' : 'DERIVED';\n  add\('stage', stageCls,/);
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/dd/summary.js'), 'utf8'), /const official = !!\(r && r\.evidenced && !r\.ddEvidenced && !\/construction-progress\/\.test/, 'the same rule as the summary row');
});
at('counts carry their unit: the construction signal says buildings in joined lots', () => {
  const I = require('../lib/entities/intel.js');
  const rule = (I.RULES || I.SIGNALS || []).find ? (I.RULES || I.SIGNALS).find((r) => r.id === 'CONSTRUCTION_EVIDENCE') : null;
  const src = fs.readFileSync(path.join(ROOT, 'lib/entities/intel.js'), 'utf8');
  assert.match(src, /`construction started on \$\{x\.construction\.started\} buildings in \$\{x\.construction\.lots\} joined lots \(\$\{x\.construction\.completed\} buildings completed\)/);
  if (rule) assert.match(rule.text({ construction: { started: 72, completed: 68, lots: 3, asOf: '2022-01-01' } }).en, /72 buildings in 3 joined lots \(68 buildings completed\)/);
});
at('the stage ladder never reads a listing date as a start date, and an empty rung says it was checked', () => {
  assert.match(INDEX, /r\.ddAsOf\?`\$\{t\.seenActive\} \$\{ddDate\(r\.ddAsOf\)\}`/);
  assert.match(INDEX, /:`· \$\{r\.coverageNote\?"":t\.checkedNone\}`\} \$\{ddCov\(r\.coverage\)\}/);
  assert.match(INDEX, /seenActive:"seen active",checkedNone:"checked — nothing found in:"/);
});
at('tender economics: ⓘ on "premium over minimum" and "vs appraisal", and the note says not a market value, not a discount', () => {
  assert.match(INDEX, /kv\(`\$\{t\.ldDE\.prem\} \$\{xpBtn\("tender_bid_vs_minimum_appraisal"\)\}`,ldPct\(E\.premiumVsMinimum\)\)\+kv\(`\$\{t\.ldDE\.app\} \$\{xpBtn\("tender_bid_vs_minimum_appraisal"\)\}`/);
  const T2 = X.level2('tender_bid_vs_minimum_appraisal', 'en');
  assert.equal(T2.cls, 'DERIVED'); assert.match(T2.notAs, /Not a market value[^]*not a "discount"/);
  assert.match(INDEX, /ldDEconNote:"Minimum and appraisal as the ILA defines them for the tender's terms — not a market value, not a discount\./);
});
at('the supply-universe ⓘ names as many universes as the dossier shows; evidence quality leads with its level, the number explained', () => {
  const U = require('../lib/supply/pipeline.js').UNIVERSES;
  assert.equal(U.length, 9);
  assert.match(X.level1('supply_universes', 'en').short, /^Nine separate "units" universes/);
  assert.ok(!INDEX.includes('${D.quality.score}/100'), 'no bare "95/100"');
  assert.ok(!INDEX.includes('· <span class="num">${D.quality.score}</span>'), 'the dossier head shows the level, not a bare number');
  assert.match(INDEX, /100 − deductions = \$\{D\.quality\.score\}; not a probability/);
});
at('a stale trend statement on the ticker loses its "rising" colour', () => {
  assert.match(INDEX, /const b4=document\.querySelector\('\[data-i="blt4v"\]'\);if\(b4\)b4\.classList\.toggle\("up-t",!stale4\);/);
});

console.log(`clarity: ${n} passed`);
