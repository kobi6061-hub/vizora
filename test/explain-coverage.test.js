'use strict';
/* PROPX · Explain Everything — the gates.
 *
 * MEASURED coverage (scripts/explain-coverage.js): every label the page can show, by fixed extraction rules, classified by an
 * explicit reviewable list; the meaningful ones must be explained — at least 95 %, never fewer than the committed measurement
 * (lib/explain/coverage.json: no NEW uncovered label without regenerating it), and the committed file is not stale. TERM
 * COMPLETENESS: every term has plain words, an example, why it matters and its source, in Hebrew and English. ANCHORS: every
 * target exists, every anchored label exists on the page and resolves to its words in both languages, and two anchors that share
 * their words with different terms carry different scopes. The dialog and the attacher keep their accessibility contract. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const X = require('../lib/explain/registry.js');
const COV = require('../scripts/explain-coverage.js');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ATTACH = fs.readFileSync(path.join(ROOT, 'lib/explain/attach.js'), 'utf8');
const COMMITTED = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/explain/coverage.json'), 'utf8'));

let n = 0, failed = 0;
const t = (name, fn) => { try { fn(); n++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); } };
const R = COV.analyze();
const page = COV.loadPage();
const termOf = (v) => (Array.isArray(v) ? v[0] : v);
const scopeOf = (v) => (Array.isArray(v) ? v[1] : null);
const bil = (v, what) => { assert.ok(v && typeof v.he === 'string' && v.he.trim() && typeof v.en === 'string' && v.en.trim(), what + ' must be bilingual'); assert.ok(!/[֐-׿]/.test(v.en), what + ' en must not contain Hebrew'); assert.ok(/[֐-׿]/.test(v.he), what + ' he must be Hebrew'); };

console.log('explain-coverage: measured label coverage');
t('the label universe is measured from the page by fixed rules (no sample): every rule finds labels, every label is classified', () => {
  assert.ok(R.labels > 900 && R.sites > 1000, `labels ${R.labels} · sites ${R.sites}`);
  const kinds = new Set(R.rows.flatMap((r) => r.kinds));
  for (const k of ['markup', 'th', 'col', 'kpi', 'helper', 'heading', 'summary', 'dt']) assert.ok(kinds.has(k), 'rule finds ' + k);
  for (const r of R.rows) assert.ok(['MEANINGFUL', 'CHROME'].includes(r.cls), r.ref);
  for (const r of R.rows.filter((x) => x.cls === 'CHROME')) assert.ok(COV.CHROME_REASONS[r.chrome], r.ref + ' chrome reason ' + r.chrome);
  assert.ok(R.computedLabelSites.count < 60, 'computed label sites stay few and listed (' + R.computedLabelSites.count + ')');
});
t('coverage of meaningful labels ≥ 95 % and no new uncovered label beyond the committed measurement', () => {
  assert.ok(R.coverage.pct >= 95, `coverage ${R.coverage.pct} % (${R.coverage.covered} / ${R.coverage.total})`);
  const before = new Set(COMMITTED.uncovered.map((u) => u.ref));
  const fresh = R.uncovered.filter((u) => !before.has(u.ref)).map((u) => u.ref);
  assert.deepEqual(fresh, [], 'new uncovered labels — explain them (ANCHORS + a term) or classify them, then run node scripts/explain-coverage.js');
  for (const e of R.exclusions) assert.ok(e.reason && e.reason.length > 10, 'an intentional exclusion states its reason: ' + e.ref);
});
t('the committed coverage.json is the current measurement (not stale) and records the before / after', () => {
  for (const k of ['labels', 'meaningful', 'chrome', 'excluded']) assert.equal(COMMITTED[k], R[k], k);
  assert.deepEqual(COMMITTED.coverage, R.coverage);
  assert.deepEqual(COMMITTED.baseline, R.baseline);
  assert.ok(COMMITTED.baseline.covered < COMMITTED.coverage.covered, 'the attacher adds coverage');
  assert.equal(COMMITTED.labelsList.length, R.labels);
  assert.equal(COMMITTED.terms.total, X.TERMS.length);
});

console.log('explain-coverage: terms');
t('every term is complete: plain words, an example, why it matters and a known source — Hebrew and English', () => {
  assert.equal(R.terms.complete, R.terms.total, 'incomplete: ' + R.terms.incomplete.map((x) => x.id + ' ' + x.missing.join('/')).join(' · '));
  for (const T of X.TERMS) { bil(T.simple, T.id + '.simple'); bil(T.example, T.id + '.example'); bil(T.why, T.id + '.why'); assert.ok(T.source.ids.every((s) => X.canonicalSource(s)), T.id + ' source'); }
});
t('an example is labelled as one ("For example" / "לדוגמה"), uses round illustrative numbers and never types in a headline figure the page shows from data', () => {
  const REAL = ['2,435,000', '2,730,000', '84,990', '2,731,500', '2,727,200', '26,500', '29,700', '342,471', '371,786', '33,854', '9.7%', '26.7', '3.25%'];
  for (const T of X.TERMS) {
    assert.match(T.example.en, /^For example/, T.id); assert.match(T.example.he, /^לדוגמה/, T.id);
    for (const v of REAL) { assert.ok(!T.example.en.includes(v) && !T.example.he.includes(v), `${T.id} example quotes a real figure ${v}`); assert.ok(!T.simple.en.includes(v), `${T.id} simple quotes ${v}`); }
    assert.ok(T.simple.en.length <= 360 && T.simple.he.length <= 360, T.id + ' simple is one or two sentences');
  }
});
t('plain words carry no recommendation or probability, and a signed number inside Hebrew keeps its sign (isolated)', () => {
  for (const T of X.TERMS) {
    const en = [T.simple.en, T.example.en].join(' ');
    assert.ok(!/\b(you should (buy|sell|invest)|we recommend|buy now|invest now|is guaranteed|guaranteed return)\b/i.test(en), T.id);
    assert.ok(!/\b\d{1,3} ?% (confidence|probability|chance)\b/i.test(en), T.id);
    for (const s of [T.simple.he, T.example.he]) for (const m of s.matchAll(/[+−]\d/g)) assert.equal(s[m.index - 1], '⁦', T.id + ' unisolated signed number');
  }
});
t('every evidence-legend entry and every section orientation has a plain sentence', () => {
  for (const g of X.LEGEND) bil(g.simple, 'legend ' + g.code);
  for (const [id, s] of Object.entries(X.SECTIONS)) bil(s.simple, 'section ' + id);
  assert.ok(X.legend('MODEL', 'en').simple && X.section('txSection', 'he').simple);
});

console.log('explain-coverage: anchors');
t('every ANCHORS target is a registry term; every anchored label exists on the page; no label is both CHROME and anchored', () => {
  assert.ok(Object.keys(X.ANCHORS).length >= 500);
  const labels = new Map(R.rows.map((r) => [r.ref, r]));
  for (const [ref, v] of Object.entries(X.ANCHORS)) {
    assert.ok(X.term(termOf(v)), ref + ' → unknown term ' + termOf(v));
    assert.ok(labels.has(ref), 'anchor to a label the page does not show: ' + ref);
    assert.equal(labels.get(ref).cls, 'MEANINGFUL', ref + ' is classified CHROME and anchored');
    if (scopeOf(v) != null) assert.ok(typeof scopeOf(v) === 'string' && /^[#.[a-z]/i.test(scopeOf(v).trim()) && !/[{};]/.test(scopeOf(v)), ref + ' scope is a CSS selector');
    assert.equal(X.anchor(ref).term, termOf(v));
  }
  assert.equal(X.anchor('no.such.label'), null);
  assert.deepEqual(R.anchorProblems, []);
});
t('every text anchor resolves to its words in both languages through the page\'s own string tables (what the attacher matches)', () => {
  const valueAt = (ref, L) => { const [tb, ...p] = ref.split('.'); let v = page.TBL[tb] && page.TBL[tb][L]; for (const k of p) v = v == null ? undefined : v[k]; return v; };
  let fns = 0;
  for (const ref of Object.keys(X.ANCHORS)) {
    if (ref.startsWith('i:')) { assert.ok(new RegExp(`data-i="${ref.slice(2)}"`).test(INDEX), ref); continue; }
    if (ref.startsWith('lit:')) { const [en, he] = ref.slice(4).split('|'); assert.ok(en && he, ref); continue; }
    for (const L of ['he', 'en']) {
      const v = valueAt(ref, L);
      if (typeof v === 'function') { fns++; let p = ''; try { p = String(v('␟', '␟', '␟')).split('␟')[0]; } catch (e) { p = ''; } assert.ok(p.trim().length >= 3, `${ref} (${L}) computed label without a usable prefix`); }
      else assert.ok(typeof v === 'string' && v.trim(), `${ref} (${L}) has no text`);
    }
  }
  assert.ok(fns >= 1, 'computed labels are matched by their fixed prefix');
});
t('two anchors that share their words with different terms carry different scopes (the attacher never guesses)', () => {
  const norm = (s) => String(s || '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim().replace(/[\s:·•\-–—…]+$/u, '').trim().toLowerCase();
  const rows = new Map(R.rows.map((r) => [r.ref, r]));
  const by = new Map();
  for (const [ref, v] of Object.entries(X.ANCHORS)) { if (ref.startsWith('i:')) continue; const r = rows.get(ref); for (const w of [r.he, r.en]) { const k = norm(w); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push({ ref, term: termOf(v), scope: scopeOf(v) }); } }
  for (const [w, as] of by) {
    if (new Set(as.map((a) => a.term)).size < 2) continue;
    const per = new Map(); for (const a of as) { const k = a.scope || '*'; if (!per.has(k)) per.set(k, new Set()); per.get(k).add(a.term); }
    for (const [sc, terms] of per) assert.equal(terms.size, 1, `"${w}" maps to ${[...terms].join(' / ')} in the same scope ${sc}`);
  }
});

console.log('explain-coverage: the dialog and the attacher');
t('the explanation dialog: role=dialog labelled by its title, the reader\'s order, focus in and back, Escape, Tab cycle, a phone bottom sheet', () => {
  assert.match(INDEX, /pop\.setAttribute\("role","dialog"\);pop\.setAttribute\("aria-labelledby","xpPopT"\)/);
  assert.match(INDEX, /<h2 class="xp-t" id="xpPopT" tabindex="-1">/);
  const a0 = INDEX.indexOf('function xpTermHTML(id,main){'), a1 = INDEX.indexOf('function xpL2HTML(', a0); assert.ok(a0 > 0 && a1 > a0, 'xpTermHTML'); const body = [INDEX.slice(a0, a1)];
  const order = ['t.simple', 't.whyMatters', 't.calc', 't.example', 't.srcDate', 't.limits', 't.notRead'].map((k) => body[0].indexOf(k));
  assert.ok(order.every((i) => i > 0) && order.every((i, j) => !j || i > order[j - 1]), 'simple · why · how calculated · example · source & date · limitations · do not read it as');
  assert.match(INDEX, /<details class="xp-full"><summary>\$\{moreLab\}<\/summary>\$\{more\}<\/details>/, 'full methodology collapsible');
  assert.match(INDEX, /full:"Full methodology \(for analysts\)"/); assert.match(INDEX, /full:"מתודולוגיה מלאה \(לאנליסטים\)"/);
  assert.match(INDEX, /const h=pop\.querySelector\("#xpPopT"\);if\(h\)h\.focus\(\{preventScroll:true\}\)/, 'focus moves into the dialog');
  assert.match(INDEX, /function xpClose\(\)\{[^\n]*const r=xpRet;[^\n]*r\.focus\(\)\}/, 'focus returns to the trigger');
  assert.match(INDEX, /function xpKey\(e\)\{if\(e\.key==="Escape"\)\{e\.preventDefault\(\);e\.stopPropagation\(\);xpClose\(\);return\}/, 'Escape closes the explanation only');
  assert.match(INDEX, /if\(e\.key!=="Tab"\)return;e\.stopPropagation\(\)/, 'Tab cycles inside');
  assert.match(INDEX, /@media\(max-width:759\.98px\)\{\n  \.xp-pop\{left:0!important;right:0!important;top:auto!important;bottom:0/, 'phone bottom sheet');
  assert.match(INDEX, /\.xp-x\{width:44px;height:44px/, 'a large close button on the phone');
  assert.match(INDEX, /pop\.setAttribute\("dir",L==="en"\?"ltr":"rtl"\)/, 'RTL / LTR');
});
t('source & date: the Trust catalogue is read once and cached; offline or failed → the registry\'s own dates, never a made-up one', () => {
  assert.match(INDEX, /function xpCatLoad\(\)\{if\(xpCatSt!=="idle"\)return;/);
  assert.match(INDEX, /function xpOpen\(trigger\)\{[^\n]*xpCatLoad\(\);let title=/, 'the catalogue state is settled before the body is built (offline shows the registry\'s dates on the first open)');
  assert.match(INDEX, /inGet\("view=sources"\)/);
  assert.match(INDEX, /location\.protocol==="file:"\|\|!location\.host\)\{xpCatSt="offline";return\}/);
  assert.match(INDEX, /srcOffline:"Live check dates are not available here; the registry describes the figure's dates:"/);
  assert.match(INDEX, /`\$\{t\.srcChk\}: \$\{sy\.lastCheckAt\?`<bdi class="num">\$\{ldE\(xpDay\(sy\.lastCheckAt\)\)\}<\/bdi>`:t\.srcNoRun\}/, 'no check recorded → said so');
});
t('every ⓘ is named by what it explains ("Explain: <title>"); the page keeps one ALTARIS mention', () => {
  assert.match(INDEX, /const xpBtn=id=>\{const X=XP\(\),x=X&&X\.level1\(id,xpL\(\)\);if\(!x\)return"";const nm=ldE\(`\$\{xpT\(\)\.info\}: \$\{x\.title\}`\)/);
  assert.match(ATTACH, /setAttribute\('aria-label', nm\)/);
  assert.equal(INDEX.split('\n').filter((l) => /altaris/i.test(l)).length, 1);
});
t('the attacher: loaded after the main script and inlined offline; idempotent, debounced, observer-driven, re-run on language change; builds no HTML strings', () => {
  assert.match(INDEX, /<\/script>\n<script src="\/lib\/explain\/attach\.js"><\/script>/);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/build-standalone.py'), 'utf8'), /lib" \/ "explain" \/ "attach\.js"/);
  assert.match(ATTACH, /new MutationObserver\(onMutations\)/);
  assert.match(ATTACH, /setTimeout\(flush, 80\)/);
  assert.match(ATTACH, /document\.addEventListener\('propx:lang'/);
  assert.match(ATTACH, /const explained = \(el\) =>/);
  assert.match(ATTACH, /classList\.contains\('xp-auto'\)/, 'its own insertions never re-trigger it');
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function/.test(ATTACH), 'no HTML strings, no eval');
  assert.ok(!/altaris/i.test(ATTACH));
});

console.log(`explain-coverage: ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
