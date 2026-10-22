// CUSTOMIZABLE NAVIGATION (22.10.2026) — the pure order model of lib/nav/order.js and its wiring in index.html / the offline build.
// The DOM behaviour (drag, keyboard, Done / Reset, reload, scroll-spy, launchpad, lazy loading) is the browser journey
// test/nav-order.browser.js. Run: node test/nav-order.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const N = require('../lib/nav/order.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SA = fs.readFileSync(path.join(ROOT, 'standalone', 'israel-new-homes-v2.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'nav', 'order.js'), 'utf8');
let n = 0;
const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* the rail and the page as index.html ships them */
function railSeq(html) {
  const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
  return [...rail.matchAll(/<a href="([^"]+)" class="ri(?![^"]*\brt\b)[^"]*"(?: data-sec="([A-Za-z]+)")?/g)].map((m) => {
    const key = m[2] || (m[1] === '/altaris' ? 'altaris' : m[1]);
    return { key, fixed: !m[2] || N.FIXED.includes(m[2]) };
  });
}
function mainChildren(html) {
  const main = html.slice(html.indexOf('<main class="wrap">'), html.indexOf('</main>'));
  return [...main.matchAll(/^ {2}(?:<!-- live:begin -->(?:<!--[^]*?-->)?\n {2})?<(?:section class="blk"(?: id="([A-Za-z]+)")?|div class="secgrp" id="(grp\d)")/gm)]
    .map((m) => ({ id: m[1] || m[2] || null, heading: !!m[2] }));
}
const SEQ = railSeq(INDEX);
const MOVABLE = SEQ.filter((s) => !s.fixed).map((s) => s.key);

at('the rail as shipped: Overview + ALTARIS fixed, 17 movable items (the live build) in the default order', () => {
  assert.deepEqual(SEQ.filter((s) => s.fixed).map((s) => s.key), ['overview', 'altaris']);
  assert.deepEqual(MOVABLE, ['dossier', 'pulse', 'changes', 'txSection', 'prices', 'dealLab', 'map', 'table', 'compare', 'insightsSec', 'capital', 'calc', 'intel', 'housing', 'land', 'guide', 'sources']);
});

at('normalize: nothing usable → the default; unknown / repeated / non-string keys dropped; a missing key returns at its default place', () => {
  for (const bad of [null, undefined, 'x', {}, 42]) assert.deepEqual(N.normalize(bad, MOVABLE), MOVABLE);
  assert.deepEqual(N.normalize([], MOVABLE), MOVABLE);
  const o = N.normalize(['land', 'land', 'nope', 7, 'dossier'], MOVABLE);
  assert.equal(o.length, MOVABLE.length);
  assert.deepEqual([...o].sort(), [...MOVABLE].sort(), 'every movable key exactly once');
  assert.equal(o[0], 'land', 'the stored first item stays first');
  assert.ok(o.indexOf('dossier') < o.indexOf('intel'), 'the stored relative order is kept');
  /* 'pulse' follows its default predecessor 'dossier'; 'guide' follows 'land' */
  assert.equal(o.indexOf('pulse'), o.indexOf('dossier') + 1);
  assert.equal(o.indexOf('guide'), o.indexOf('land') + 1);
  /* the offline build carries neither live-only feature: a stored live order drops them, and they come back at their place */
  const offline = MOVABLE.filter((k) => k !== 'changes' && k !== 'dealLab');
  const stored = ['sources', ...MOVABLE.filter((k) => k !== 'sources')];
  assert.deepEqual(N.normalize(stored, offline), ['sources', ...offline.filter((k) => k !== 'sources')]);
  assert.deepEqual(N.normalize(N.normalize(stored, offline), MOVABLE).indexOf('changes'), N.normalize(stored, offline).indexOf('pulse') + 1);
});

at('layout: a fixed item keeps its default slot for ANY order; every key once', () => {
  const rev = MOVABLE.slice().reverse();
  const L = N.layout(SEQ, rev);
  assert.equal(L.length, SEQ.length);
  SEQ.forEach((s, i) => { if (s.fixed) assert.equal(L[i], s.key, `${s.key} at slot ${i}`); });
  assert.deepEqual([...L].sort(), SEQ.map((s) => s.key).sort());
  assert.deepEqual(N.layout(SEQ, MOVABLE), SEQ.map((s) => s.key), 'the default order is the shipped rail');
  assert.ok(N.isDefault(MOVABLE, MOVABLE) && !N.isDefault(rev, MOVABLE));
});

at('move: one step among the VISIBLE items; boundaries are no-ops; a hidden item keeps its place', () => {
  assert.deepEqual(N.move(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(N.move(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.deepEqual(N.move(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(N.move(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(N.move(['a', 'b', 'c'], 'x', 1), ['a', 'b', 'c']);
  /* the capital model hidden: Deal calculator up one = above Insights, capital stays right after Insights */
  const vis = new Set(MOVABLE.filter((k) => k !== 'capital'));
  const o = N.move(MOVABLE, 'calc', -1, vis);
  assert.deepEqual(o.slice(o.indexOf('compare'), o.indexOf('intel')), ['compare', 'calc', 'insightsSec', 'capital']);
});

at('dropAt: first / middle / last among the visible others — the same results as repeated moves', () => {
  assert.deepEqual(N.dropAt(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(N.dropAt(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(N.dropAt(['a', 'b', 'c', 'd'], 'b', 99), ['a', 'c', 'd', 'b']);
  assert.deepEqual(N.dropAt(['a', 'b', 'c', 'd'], 'b', 1), ['a', 'b', 'c', 'd'], 'its own place is a no-op');
  let o = MOVABLE.slice(); for (let i = 0; i < 3; i++) o = N.move(o, 'land', -1);
  assert.deepEqual(N.dropAt(MOVABLE, 'land', MOVABLE.indexOf('land') - 3), o);
});

at('the page: Overview + the geography view lead; each block keeps its unlabelled sections (Sale vs rent → Prices, rankings → Neighbourhoods); headings apart; every child once', () => {
  const ch = mainChildren(INDEX);
  const plan = N.mainPlan(ch, MOVABLE);
  assert.deepEqual(plan.lead.map((i) => ch[i].id), ['overview', 'geoView']);
  assert.deepEqual(plan.headings.map((i) => ch[i].id), ['grp1', 'grp2', 'grp3', 'grp4']);
  assert.deepEqual(plan.blocks.prices.map((i) => ch[i].id), ['prices', null]);
  assert.deepEqual(plan.blocks.table.map((i) => ch[i].id), ['table', 'rankings']);
  assert.deepEqual(N.mainSequence(plan, MOVABLE, MOVABLE), ch.map((_, i) => i), 'the default is index.html as shipped');
  const custom = ['sources', 'land', ...MOVABLE.filter((k) => k !== 'sources' && k !== 'land')];
  const s = N.mainSequence(plan, custom, MOVABLE).map((i) => ch[i].id);
  assert.equal(new Set(N.mainSequence(plan, custom, MOVABLE)).size, ch.length);
  assert.deepEqual(s.slice(0, 4), ['overview', 'geoView', 'sources', 'land']);
  assert.deepEqual(s.slice(-4), ['grp1', 'grp2', 'grp3', 'grp4'], 'the group headings are kept (hidden while customized)');
  assert.equal(s[s.indexOf('prices') + 1], null);
  assert.equal(s[s.indexOf('table') + 1], 'rankings');
});

at('storage: one versioned key, a schema check, nothing but strings read back', () => {
  assert.equal(N.KEY, 'propx:nav:v1');
  assert.equal(N.SCHEMA, 'propx-nav-v1');
  const raw = N.serialize(['land', 'dossier'], '2026-10-22T00:00:00.000Z');
  assert.deepEqual(JSON.parse(raw), { schema: 'propx-nav-v1', order: ['land', 'dossier'], savedAt: '2026-10-22T00:00:00.000Z' });
  assert.deepEqual(N.parse(raw), ['land', 'dossier']);
  for (const bad of ['', '{', 'null', '[]', '{"schema":"propx-nav-v0","order":["land"]}', '{"schema":"propx-nav-v1","order":"land"}']) assert.equal(N.parse(bad), null, bad);
  assert.deepEqual(N.parse('{"schema":"propx-nav-v1","order":["land",3,null,"guide"]}'), ['land', 'guide']);
});

at('wiring: the module loads before every other script (the stored order applies before anything renders); the offline build inlines it', () => {
  const i = INDEX.indexOf('<script src="/lib/nav/order.js"></script>');
  assert.ok(i > INDEX.indexOf('</main>'), 'after the page sections it moves');
  for (const s of ['/lib/table/core.js', '/lib/explain/registry.js', '/data/market/latest.js', '/lib/explain/attach.js']) assert.ok(i < INDEX.indexOf(`<script src="${s}"`), s);
  assert.ok(i < INDEX.indexOf('<script>\n', i), 'before the main script');
  assert.ok(!SA.includes('<script src="/lib/nav/order.js">') && SA.includes("const KEY = 'propx:nav:v1'"), 'inlined offline');
  assert.deepEqual(railSeq(SA).filter((s) => !s.fixed).map((s) => s.key), MOVABLE.filter((k) => k !== 'changes' && k !== 'dealLab'));
});

at('the rail button: a real button (dialog popup, expanded state), named in Hebrew and English, among the utility buttons', () => {
  const b = INDEX.match(/<button type="button" class="ri rt nv-btn" id="navEditBtn"[^>]*>/);
  assert.ok(b, 'button');
  assert.match(b[0], /aria-haspopup="dialog"/); assert.match(b[0], /aria-expanded="false"/); assert.match(b[0], /data-ia="aNavEdit"/);
  assert.ok(INDEX.indexOf('id="navEditBtn"') > INDEX.indexOf('class="rail-sp"') && INDEX.indexOf('id="navEditBtn"') < INDEX.indexOf('id="themeBtnRail"'));
  for (const k of ['navEdit', 'aNavEdit']) assert.equal((INDEX.match(new RegExp(`\\b${k}:"[^"]+"`, 'g')) || []).length, 2, `${k} he + en`);
  for (const k of Object.keys(N.STR.he)) assert.ok(k in N.STR.en, `editor string ${k} in English`);
});

at('presentation only: no network, no API, no data file, no credential — and nothing but its own key in storage', () => {
  for (const bad of ['fetch(', 'XMLHttpRequest', '/api/', '/data/', 'sendBeacon', 'document.cookie', 'sessionStorage']) assert.ok(!SRC.includes(bad), bad);
  assert.deepEqual([...SRC.matchAll(/localStorage\.(\w+)\(/g)].map((m) => m[1]).sort(), ['getItem', 'removeItem', 'setItem']);
  assert.ok(!/localStorage\.\w+\((?!KEY)/.test(SRC), 'only propx:nav:v1');
});

at('scroll-spy: at the bottom of the page the LAST section on the page is marked (the reader\'s order may differ from the rail\'s)', () => {
  const spy = INDEX.slice(INDEX.indexOf('(function railSpy(){'), INDEX.indexOf('/* ---------- breadcrumb ---------- */'));
  assert.ok(!spy.includes('links[links.length-1]'), 'not the rail\'s last link');
  assert.match(spy, /compareDocumentPosition\(s\)&Node\.DOCUMENT_POSITION_FOLLOWING/);
});

console.log(`nav-order: ${n} passed`);
