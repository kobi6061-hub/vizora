'use strict';
/* PROPX · Explainability & Context registry (lib/explain/registry.js) — the gates.
 *
 * One registry documents what the product shows. These tests refuse: a term without every level-2 field in both languages, an
 * invented source (a source id that exists neither in the Trust Center catalogue nor as a PROPX module alias), an invented
 * period (empty), a term without a do-not-interpret-as, a DERIVED / MODEL term without a formula, a signal id the product
 * emits (dossier, scan, developer intelligence) that has no rule here, a missing-data id a read model prints that has no
 * reason here, and any recommendation / probability wording. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const isBi = (v, what) => { assert.ok(v && typeof v === 'object' && typeof v.he === 'string' && typeof v.en === 'string' && v.he.trim() && v.en.trim(), what + ' must be bilingual'); assert.ok(/[\u0590-\u05FF]/.test(v.he) || !/[A-Za-z]/.test(v.he), what + ' he must be Hebrew (a unit or a dash may carry no letters)'); assert.ok(!/[\u0590-\u05FF]/.test(v.en), what + ' en must not contain Hebrew'); };
const HE_SIGN_FIX = /[⁦⁩]/;

console.log('explain: the registry');
t('a UMD module: Node and the page share one object; version stamped; the data classes are the one vocabulary', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/explain/registry.js'), 'utf8');
  assert.match(src, /root\.PropxExplain = api/); assert.ok(!/fetch\(|Math\.random|https?\.request/.test(src));
  assert.equal(X.VERSION.id, 'propx-explain-v1'); assert.match(X.VERSION.effective, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(X.CLASSES), ['OFFICIAL', 'OBSERVED', 'DERIVED', 'MODEL', 'USER_ASSUMPTION', 'USER_OVERRIDE', 'SELF_REPORTED', 'USER_DOCUMENT', 'MISSING']);
  for (const c of Object.values(X.CLASSES)) { isBi(c.label, c.code); isBi(c.d, c.code + ' definition'); }
  for (const k of ['observation', 'publication', 'check']) isBi(X.FRESHNESS[k], 'freshness ' + k);
});
t('every term carries every level-2 field in both languages: title, short, why, unit, geography, period, source, class, methodology, interpretation, do-not-interpret-as, evidence, the three freshness dates', () => {
  assert.ok(X.TERMS.length >= 30, 'at least 30 terms');
  const ids = new Set();
  for (const T of X.TERMS) {
    assert.match(T.id, /^[a-z0-9_]+$/, T.id); assert.ok(!ids.has(T.id), 'duplicate ' + T.id); ids.add(T.id);
    assert.ok(X.GROUPS.some((g) => g.id === T.group), T.id + ' group');
    for (const k of ['title', 'short', 'why', 'unit', 'geography', 'period', 'methodology', 'interpretation', 'notAs']) isBi(T[k], T.id + '.' + k);
    assert.ok(T.evidence && T.evidence.he && T.evidence.en, T.id + '.evidence (a path / route pointer — technical text in both languages)');
    assert.ok(T.short.en.length <= 260 && T.short.he.length <= 260, T.id + ' short is a sentence, not an essay');
    assert.ok(Object.keys(X.CLASSES).includes(T.cls), T.id + ' class');
    assert.ok(Array.isArray(T.source.ids) && T.source.ids.length, T.id + ' source');
    for (const k of ['observation', 'publication', 'check']) isBi(T.freshness[k], T.id + '.freshness.' + k);
    for (const l of T.limitations) isBi(l, T.id + ' limitation'); for (const i of T.inputs) isBi(i, T.id + ' input');
    if (T.formula) assert.ok(T.formula.he && T.formula.en, T.id + ' formula (symbols are language-free)');
  }
});
t('no invented source: every source id a term cites exists in the Trust Center catalogue or is a PROPX / ALTARIS module alias; the registry resolves the runtime aliases the read models print', () => {
  const TRUST = require('../lib/trust/catalog').catalog();
  const known = new Set(TRUST.sources.map((s) => s.id));
  for (const [id, s] of Object.entries(X.SOURCES)) assert.ok(known.has(id) || /^(propx|altaris):/.test(id), 'registry source not in the Trust Center: ' + id);
  for (const T of X.TERMS) for (const s of T.source.ids) assert.ok(X.canonicalSource(s), T.id + ' cites an unknown source ' + s);
  for (const alias of ['cbs:timeseries:44,10', 'datagov:moch:urban-renewal', 'dira-lehaskir:wp', 'lib/entities', 'boi:interest', 'cbs:price-index']) assert.ok(X.canonicalSource(alias), alias);
  assert.equal(X.canonicalSource('made-up:source'), null);
  assert.equal(X.canonicalSource('cbs:price-index'), 'propx:market-sync', 'the market sync umbrella id is not one index'); assert.match(X.sourceLabel('cbs:constructionInputsIndex', 'en'), /construction-inputs/);
  assert.ok(X.sourceLabel('cbs:timeseries:44,10', 'en').includes('CBS'));
});
t('a DERIVED or MODEL term states its formula and inputs; an OFFICIAL / OBSERVED term never claims a formula it does not have', () => {
  for (const T of X.TERMS) {
    if (T.cls === 'DERIVED' || T.cls === 'MODEL') { if (!['source_freshness', 'source_conflict', 'materiality', 'opportunity_signal', 'risk_signal', 'evidence_quality', 'decision_condition'].includes(T.id)) assert.ok(T.formula, T.id + ' needs a formula'); assert.ok(T.methodology, T.id); }
    if (T.cls === 'OFFICIAL' || T.cls === 'OBSERVED') assert.ok(!T.formula, T.id + ' is not computed');
  }
});
t('every signal id the product emits has a rule here (dossier signals, scan rules, developer-intelligence signals), with the term it belongs to and a bilingual rule', () => {
  const D = require('../lib/dossier/query'), S = require('../lib/radar/scan'), I = require('../lib/entities/intel');
  const emitted = new Set(Object.keys(S.RULES));
  /* a duplicate key inside the SIGNAL_RULES literal would silently win — refuse it at the source */
  const src = fs.readFileSync(path.join(ROOT, 'lib/explain/registry.js'), 'utf8'); const block = src.slice(src.indexOf('const SIGNAL_RULES'), src.indexOf('const MISSING')); const keys = [...block.matchAll(/^\s+'([A-Za-z0-9_\-]+)': \{ term:/gm)].map((m) => m[1]); const dup = keys.filter((k, i) => keys.indexOf(k) !== i); assert.deepEqual(dup, [], 'duplicate SIGNAL_RULES keys');
  for (const g of [{ level: 'il' }, { level: 'district', code: 'd-ta' }, { level: 'district', code: 'd-north' }, { level: 'district', code: 'd-center' }, { level: 'locality', code: '5000' }, { level: 'locality', code: '4000' }, { level: 'locality', code: '3000' }]) for (const s of D.dossier(g).signals) emitted.add(s.id);
  for (const s of I.SIGNALS) emitted.add(s.id);
  for (const s of require('../lib/entities/project-intel').SIGNALS) emitted.add(s.id);
  emitted.add('demand-with-supply'); emitted.add('inventory-plus-pipeline');
  for (const id of emitted) { const r = X.SIGNAL_RULES[id]; assert.ok(r, 'no rule for signal ' + id); assert.ok(X.term(r.term), id + ' → unknown term ' + r.term); isBi(r.rule, id + ' rule'); assert.ok(['watch', 'risk', 'info'].includes(r.kind), id); }
  const w = X.signal('failed-tenders', 'en', { text: { he: 'א', en: 'a' }, value: 0.4, valueLabel: '40%', threshold: '≥ 30% of ≥ 5 tenders', period: { he: 'היקף', en: 'current scope' }, source: 'rmi:michrazim', cls: 'OFFICIAL', evidence: { level: 'HIGH', score: 80 } });
  assert.equal(w.kind, 'risk'); assert.equal(w.value, '40%'); assert.equal(w.period, 'current scope'); assert.ok(w.sourceLabel && w.notAs && w.term.title);
  assert.equal(X.signal('nonexistent'), null);
  /* every source segment is labelled; the dossier and developer-intelligence signals carry a formatted value (never a raw fraction); dossier signals get the dossier's evidence on the page */
  assert.match(X.signal('demand-with-supply', 'en', { source: 'cbs:timeseries:44,10 · rmi:michrazim' }).sourceLabel, /CBS.*·.*Israel Land Authority/);
  for (const s of D.dossier({ level: 'il' }).signals) { assert.ok(typeof s.valueLabel === 'string', s.id + ' valueLabel'); assert.ok(!/^0\.\d/.test(s.valueLabel), s.id + ' raw fraction'); assert.equal(X.signal(s.id, 'en', s).value, s.valueLabel); }
  { const Q = require('../lib/entities/query'); const dev = Q.developers({ limit: 1 }).rows[0]; for (const s of Q.developer(dev.id).intel.signals) assert.ok(s.valueLabel === null || (typeof s.valueLabel === 'string' && !/^0\.\d/.test(s.valueLabel)), s.id); }
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); assert.match(page, /xpSig\(x\.id,Object\.assign\(\{evidence:\{level:D\.quality\.level,score:D\.quality\.score\}\},x\)\)/);
  assert.match(X.term('probable_new_transaction').formula.en, /second-hand/); assert.match(X.term('probable_new_transaction').formula.en, /= transaction year or transaction year − 1/);
});
t('every missing-data id a read model prints has a reason here (the dossier and the supply pipeline), with what would make the figure available', () => {
  const D = require('../lib/dossier/query'), SU = require('../lib/supply/pipeline');
  const ids = new Set();
  for (const g of [{ level: 'il' }, { level: 'district', code: 'd-ta' }, { level: 'locality', code: '5000' }]) { for (const m of D.dossier(g).missing) ids.add(m.id); for (const m of SU.supply(g).missing) ids.add(m.id); }
  { const Q = require('../lib/entities/query'); const c = Q.load(); const ila = [...c.projById.values()].find((p) => p.kind === 'ila-awarded-lot' && !p.construction), moch = [...c.projById.values()].find((p) => p.kind !== 'ila-awarded-lot'); for (const p of [ila, moch]) for (const m of Q.project(p.id).intel.missing) ids.add(m.id); }
  for (const id of ids) { const m = X.missing(id, 'he'); assert.ok(m, 'no missing-data reason for ' + id); assert.ok(m.label && m.why && m.unlock, id); }
  for (const [id, m] of Object.entries(X.MISSING)) { isBi(m.label, id); isBi(m.why, id); isBi(m.unlock, id); }
  assert.equal(X.missing('permits', 'en').id, 'no_permits_source'); assert.equal(X.missing('nope'), null);
});
t('HE / EN parity and the registry\'s own rules: no recommendation, no probability, no score, no "current because PROPX checked today"', () => {
  for (const T of X.TERMS) {
    const all = [T.title, T.short, T.why, T.interpretation, T.notAs, T.methodology].map((x) => x.en).join(' ');
    assert.ok(!/\b(you should buy|we recommend|invest now|buy now|is guaranteed)\b/i.test(all), T.id);
    assert.ok(!/\b\d{1,3}% (confidence|probability)\b/i.test(all), T.id + ' no probability wording');
  }
  for (const T of X.TERMS) assert.ok(/not|never|לא|≠/i.test(T.notAs.en + T.notAs.he), T.id + ' do-not-interpret-as must negate');
  /* RTL: every signed number in a Hebrew string is isolated (LRI … PDI) so its sign stays on its left; a Hebrew prefix hyphen (ב-12) is never wrapped */
  const heStrings = [];
  for (const T of X.TERMS) { for (const k of ['title', 'short', 'why', 'unit', 'geography', 'period', 'methodology', 'interpretation', 'notAs']) heStrings.push([T.id + '.' + k, T[k].he]); for (const l of T.limitations) heStrings.push([T.id + '.lim', l.he]); if (T.formula) heStrings.push([T.id + '.formula', T.formula.he]); }
  for (const [id, r] of Object.entries(X.SIGNAL_RULES)) heStrings.push(['rule ' + id, r.rule.he]);
  for (const [id, m] of Object.entries(X.MISSING)) heStrings.push(['missing ' + id, m.why.he + ' ' + m.unlock.he]);
  let signed = 0;
  for (const [id, s] of heStrings) { for (const m of s.matchAll(/[+\u2212]\d/g)) { signed++; assert.equal(s[m.index - 1], '\u2066', id + ' unisolated signed number: ' + s.slice(Math.max(0, m.index - 8), m.index + 6)); } assert.ok(!/[\u0590-\u05FF]\u2066-/.test(s), id + ' a prefix hyphen was wrapped'); }
  assert.ok(signed >= 10, 'the registry carries signed thresholds (' + signed + ')');
  assert.ok(HE_SIGN_FIX.test(X.SIGNAL_RULES['sales-momentum-up'].rule.he));
  const l1 = X.level1('months_of_supply', 'en'), l2 = X.level2('months_of_supply', 'he');
  assert.ok(l1.short.length < l2.methodology.length + l2.interpretation.length, 'level 1 is shorter than level 2');
  assert.equal(l2.cls, 'OFFICIAL', 'months of supply is the CBS series 44,10,5 — PROPX does not compute it'); assert.equal(l2.formula, null); assert.match(l2.methodology, /44,10,5/); assert.equal(l2.sources[0].id, 'cbs:new-home-sales'); assert.ok(l2.freshness.observation && l2.freshness.publication && l2.freshness.check);
  assert.equal(X.level1('nope'), null); assert.equal(X.level2('nope'), null);
  assert.ok(X.ids().includes('irr') && X.ids().includes('decision_verdict') && X.ids().includes('evidence_quality') && X.ids().includes('source_freshness'));
});
t('the page and ALTARIS load the registry; the offline build inlines it; the standalone embeds no credential', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), ax = fs.readFileSync(path.join(ROOT, 'altaris/index.html'), 'utf8'), build = fs.readFileSync(path.join(ROOT, 'scripts/build-standalone.py'), 'utf8');
  assert.match(page, /<script src="\/lib\/explain\/registry\.js"><\/script>/); assert.match(ax, /lib\/explain\/registry\.js/); assert.match(build, /lib\/explain\/registry\.js|explain\/registry/);
});

console.log(`explain: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
