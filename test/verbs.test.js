'use strict';
/* PROPX · "What changed?" verbs (lib/radar/verbs.js) — the gates: every radar rule id maps to one of the seven verbs; a source-state
 * event is classified by its recorded transition; the feed carries the verb on every row and filters by it; the Pulse shows it. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../lib/radar/verbs');
const E = require('../lib/radar/events');
const R = require('../lib/radar/query');
const X = require('../lib/explain/registry');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };

console.log('verbs');
t('seven verbs, each bilingual with a definition; the order is fixed; the basis says the verb never judges', () => {
  assert.deepEqual(V.ORDER, ['NEW', 'ADVANCED', 'CHANGED', 'REVISED', 'STALE', 'RECOVERED', 'CONFLICT']);
  for (const k of V.ORDER) { assert.ok(V.VERBS[k].label.he && V.VERBS[k].label.en && V.VERBS[k].d.he && V.VERBS[k].d.en, k); }
  assert.match(V.BASIS.en, /never whether it is good or bad/);
  const src = fs.readFileSync(path.join(ROOT, 'lib/radar/verbs.js'), 'utf8'); assert.ok(!/fetch\(|Math\.random|https?\.request/.test(src));
});
t('every rule id of lib/radar/events.js maps to a verb explicitly (no silent default); source-state is decided by the transition', () => {
  for (const id of Object.keys(E.RULES)) { if (id === 'source-state') continue; assert.ok(V.BY_KIND[id], 'no verb for rule ' + id); assert.ok(V.ORDER.includes(V.BY_KIND[id]), id); assert.equal(V.verbOf({ kind: id }), V.BY_KIND[id]); }
  for (const id of Object.keys(V.BY_KIND)) assert.ok(E.RULES[id], 'verb for a rule that does not exist: ' + id);
  assert.equal(V.verbOf({ kind: 'source-state', values: { from: 'REFUSED', to: 'SUCCESS' } }), 'RECOVERED');
  assert.equal(V.verbOf({ kind: 'source-state', values: { from: 'FAILED', to: 'UNCHANGED' } }), 'RECOVERED');
  assert.equal(V.verbOf({ kind: 'source-state', values: { from: 'SUCCESS', to: 'SCHEMA_CHANGED' } }), 'CONFLICT');
  assert.equal(V.verbOf({ kind: 'source-state', values: { from: 'SUCCESS', to: 'STALE' } }), 'STALE');
  assert.equal(V.verbOf({ kind: 'source-state', values: { from: 'SUCCESS', to: 'UNCHANGED' } }), 'CHANGED');
  assert.equal(V.verbOf({ kind: 'source-state', values: { from: 'SUCCESS', to: 'REFUSED' } }), 'CHANGED');
  assert.equal(V.verbOf(null), null); assert.equal(V.verbOf({}), null);
  assert.equal(V.BY_KIND['cbs-revised'], 'REVISED'); assert.equal(V.BY_KIND['tender-awarded'], 'ADVANCED'); assert.equal(V.BY_KIND['tender-no-award'], 'CHANGED'); assert.equal(V.BY_KIND['tender-new'], 'NEW'); assert.equal(V.BY_KIND['source-stale'], 'STALE');
});
t('the feed carries a verb on every row, counts per verb over the same set the group facet describes, and narrows by verb=; the labels and the order travel with the response', () => {
  const all = R.feed({ window: '90d', size: 200 }); assert.ok(all.rows.length > 10);
  for (const e of all.rows) assert.ok(V.ORDER.includes(e.verb), e.kind + ' → ' + e.verb);
  assert.deepEqual(all.verbOrder, V.ORDER); assert.ok(all.verbLabels.NEW.he && all.verbLabels.CONFLICT.en); assert.equal(all.verb, null);
  const sum = Object.values(all.verbs).reduce((s, n) => s + n, 0); assert.equal(sum, all.total, 'verb counts cover the whole set');
  const rev = R.feed({ window: '90d', verb: 'revised', size: 200 }); assert.equal(rev.verb, 'REVISED'); assert.ok(rev.rows.length >= 1); for (const e of rev.rows) assert.equal(e.verb, 'REVISED'); assert.equal(rev.total, all.verbs.REVISED || 0);
  const adv = R.feed({ window: '90d', verb: 'ADVANCED', group: 'land', size: 200 }); for (const e of adv.rows) { assert.equal(e.verb, 'ADVANCED'); assert.equal(e.group, 'land'); }
  assert.equal(R.feed({ window: '90d', verb: 'nope' }).verb, null, 'an unknown verb does not narrow');
});
t('the Pulse shows the verb on every event and offers the verb filter; the registry documents the verb as a DERIVED term', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(page, /class="pu-verb v-\$\{ldE\(e\.verb\)\}"/); assert.match(page, /data-puverb/); assert.match(page, /puVerbAll:"כל סוגי השינוי"/); assert.match(page, /puVerbAll:"All change kinds"/); assert.match(page, /qs\.set\("verb",puState\.verb\)/);
  const T = X.term('change_verb'); assert.ok(T && T.cls === 'DERIVED' && T.formula); assert.match(T.notAs.en, /not a score/i);
});
console.log(`verbs: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`); process.exit(failed ? 1 : 0);
