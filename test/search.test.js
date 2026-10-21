// PROPX · STREET SEARCH regression gates (21.10.2026, the founder's "הרב משה → לא נמצאו תוצאות"). Root cause: the page turned EVERY failed
// request — the session gate's redirect to /login.html (an HTML page read as JSON), a 5xx, a timeout, a network drop — into an empty list and
// printed "No results"; and the ranking read "הרב משה" as the honorific-stripped key "משה", so the 25 official names that hold BOTH words
// ("הרב אויערבך משה" …) never reached the list. Gates: the founder's queries on the real official directory; ALL WORDS ranking (every typed
// word in one official name or synonym — never an invented identity) without moving any exact match; search independent of transactions,
// street geography and the street report; the API's error contract (503 index · 500 search · errors never cached); the page's request
// classifier executed against every failure kind (a failed request is never "No results"), the retry and the sign-in link.
//   FAILED REQUEST ≠ NO RESULTS · AN HONORIFIC THE USER TYPED IS NOT NOISE · A NAME HOLDING EVERY TYPED WORD ≠ A GUESS

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const R = require('../lib/geo/registry');
const SD = require('../lib/streets/directory');

let passed = 0, failed = 0;
const pending = [];
const t = (name, fn) => pending.push([name, fn]);
const streets = (q, o) => R.searchGeo(q, 12, o || {}).matches.filter((m) => m.kind === 'street');
const words = (s) => s.split(/[ -]/).filter(Boolean);
const holds = (name, w) => words(name).some((x) => x === w || x === 'ה' + w || 'ה' + x === w);

/* the founder's queries */
t('the founder\'s queries: "הרב משה" is never empty and leads with official names holding both words; the listed street queries find their street first', () => {
  const r = streets('הרב משה');
  assert.ok(r.length >= 10, 'הרב משה returns streets');
  for (const m of r.slice(0, 8)) assert.ok([m.he, m.matchedName || ''].some((n) => holds(n, 'הרב') && holds(n, 'משה')), 'top hits hold both typed words: ' + m.he);
  const pt = streets('הרב משה', { near: 7900 }).slice(0, 4).map((m) => m.id).sort();
  assert.deepEqual(pt, ['st:7900:1027', 'st:7900:106', 'st:7900:328', 'st:7900:595'], 'the selected locality\'s four "הרב … משה" streets lead');
  assert.deepEqual(streets('הרב משה פתח תקווה').slice(0, 4).map((m) => m.id).sort(), pt, 'a locality named in the query scopes the same way');
  assert.equal(streets('הרצל פתח תקווה')[0].id, 'st:7900:213');
  assert.equal(streets('שחם פתח תקווה')[0].id, 'st:7900:156');
  assert.equal(streets('הרב אונטרמן משה פתח תקווה')[0].id, 'st:7900:546', 'the official name + a given name');
  assert.ok(streets('הרב אונטרמן').some((m) => m.id === 'st:7900:546'));
});

t('partial names, spelling variants and official synonyms: surname alone, any word order, final letters, ה optional, hyphen / double space, a synonym naming the given name, the last word still being typed', () => {
  assert.ok(streets('אויערבך').some((m) => m.id === 'st:7900:595'), 'the surname alone');
  for (const q of ['אויערבך משה', 'משה אויערבך', 'הרב אויערבך', 'אויערבכ משה']) assert.equal(streets(q)[0].id, 'st:7900:595', q);
  for (const q of ['רב משה', 'הרב  משה', 'הרב-משה']) assert.equal(streets(q, { near: 7900 })[0].inSelectedLocality, 'near', q);
  const syn = streets('הרב משה זאב פלדמן', { near: 7900 })[0];
  assert.equal(syn.id, 'st:7900:667'); assert.equal(syn.matchedName, 'הרב משה זאב פלדמן', 'found through its official synonym, which is named');
  const typing = streets('הרב מש');
  assert.ok(typing.length > 0 && typing.every((m) => m.tier === 6), 'an unfinished last word is discovery (tier 6) only');
  assert.ok(typing.slice(0, 5).every((m) => words(m.he).includes('הרב') && words(m.he).some((w) => w.startsWith('מש'))));
});

t('ALL WORDS never invents an identity: every hit is an official street of the directory, and an all-words hit holds every typed word in its official name or the synonym it names', () => {
  const D = SD.load(), ids = new Set(D.streets.map((s) => s.id));
  for (const q of ['הרב משה', 'הרב משה פתח תקווה', 'משה אויערבך', 'רב משה']) {
    for (const m of streets(q)) {
      assert.ok(ids.has(m.id) && R.resolveGeoId(m.id), 'an official street: ' + m.id);
      /* a partial reading (tier 2 / 5 since 21.10.2026) holds every typed content word — a title the name omits is the only word it may lack */
      const content = words(q.replace(/ פתח תקווה$/, '')).filter((w) => !/^(הרב|רב|ר|דר)$/.test(w));
      if ([1, 2, 4, 5].includes(m.tier)) assert.ok([m.he, m.matchedName || ''].some((n) => content.every((w) => holds(n, w)) || n === q), q + ' → ' + m.he);
    }
  }
});

t('ranking is not damaged: exact names still lead; a variant that DROPS a typed word ("משה" for "הרב משה") ranks after the names holding every word; single words and type words unchanged', () => {
  assert.equal(streets('משה')[0].id, 'st:6400:341', 'the street named exactly "משה" still leads its own query');
  const r = streets('הרב משה'), drop = r.findIndex((m) => m.id === 'st:6400:341');
  assert.ok(drop === -1 || r.slice(0, drop).every((m) => holds(m.he, 'הרב') || holds(m.matchedName || '', 'הרב')), 'the dropped-word variant follows');
  assert.equal(streets('הרב קוק', { near: 5000 })[0].he, 'הרב קוק'); assert.equal(streets('הרב קוק', { near: 5000 })[0].cityCode, 5000);
  assert.equal(streets('שד רוטשילד', { near: 5000 })[0].id, 'st:5000:1103');
  assert.equal(streets('שדרות בן גוריון חיפה')[0].id, 'st:4000:399');
  assert.equal(streets("ז'בוטינסקי", { near: 5000 })[0].id, 'st:5000:456');
  assert.equal(streets('בן גוריון')[0].he, 'בן גוריון');
  assert.equal(streets('הרצל', { near: 7900 })[0].id, 'st:7900:213');
});

t('the directive\'s explicit cases (21.10.2026): a typed title the official name omits, a street with its locality, a street-type word before an honorific', () => {
  const a = streets('הרב ד"ר משה אויערבך פתח תקווה'); assert.equal(a[0].id, 'st:7900:595', 'every content word of the official name; the title ד"ר is not in it');
  assert.equal(a[0].tier, 2, 'a partial reading — after the exact names and synonyms of the locality');
  assert.equal(streets('הרב דר משה אויערבך', { near: 7900 })[0].id, 'st:7900:595');
  assert.equal(streets('דיזנגוף תל אביב')[0].id, 'st:5000:404'); assert.equal(streets('דיזנגוף', { near: 5000 })[0].id, 'st:5000:404');
  assert.equal(streets('רחוב הרב קוק תל אביב')[0].id, 'st:5000:1204');
  assert.ok(!streets('הרב משה').some((m) => m.id === 'st:7900:595' && m.tier < 5), 'a title alone with one other word never reads as every street of that word');
});

t('an EXACT synonym is never pushed out by names that merely contain its words, and the official partial reading follows the synonym partial reading of no other street', () => {
  const n = streets('נוה אפרים', { near: 9400 }); assert.equal(n[0].id, 'st:9400:6510', 'the address area whose official synonym is "נוה אפרים"'); assert.equal(n[0].matchedName, 'נוה אפרים'); assert.equal(n[0].tier, 2);
  assert.ok(n.slice(1, 6).every((m) => m.tier === 2 && words(m.he).includes('אפרים')), 'the streets containing both words follow');
  const t2 = streets('אל תורי', { near: 3000 }); assert.equal(t2[0].tier, 1, 'the official name of that spelling leads'); assert.equal(t2[1].id, 'st:3000:4138', 'the exact synonym right after it, before the names that only contain it');
  const pt = streets('הרב משה', { near: 7900 }); const syn = pt.findIndex((m) => m.via === 'synonym'), off = pt.findIndex((m) => m.via === 'official' && m.tier === 2);
  assert.ok(off > -1 && (syn === -1 || off < syn), 'an official partial reading precedes a synonym partial reading of the same strength');
});

t('a PLACE the directory files under a locality (synonym of the 9000 placeholder) offers the LOCALITY, labelled — never a street', () => {
  const all = (q, o) => R.searchGeo(q, 12, o || {}).matches;
  const k = all('כנרת הקבוצה'); assert.equal(k[0].id, 'loc:57'); assert.equal(k[0].kind, 'locality'); assert.equal(k[0].via, 'place-synonym'); assert.equal(k[0].matchedName, 'כנרת הקבוצה');
  const m = all('ש עולים מזכרת בתיה'); assert.equal(m[0].id, 'loc:28', 'the place typed with its locality'); assert.equal(m[0].matchedName, 'ש עולים');
  const near = all('ש עולים', { near: 28 }); assert.equal(near[0].id, 'loc:28', 'the selected locality, by its place name, first');
  const plain = all('ש עולים'); assert.ok(plain.findIndex((x) => x.kind === 'street') < plain.findIndex((x) => x.id === 'loc:28') || plain.findIndex((x) => x.id === 'loc:28') === -1, 'elsewhere: after the exact street names');
  for (const q of ['כנרת הקבוצה', 'ש עולים', 'חפציבה', 'עין חרוד אחוד']) for (const x of all(q)) assert.ok(!/:9000$/.test(x.id), 'never the placeholder as a street: ' + x.id);
  assert.ok(all('חפציבה').some((x) => x.id === 'loc:90' && x.matchedName === 'חפציבה'), 'a locality spelled as its official place name');
  const geo = page.slice(page.indexOf('function initSearch('), page.indexOf('function initSearch(') + 20000);
  assert.match(page, /geoPlaceOf:n=>`שם רשמי של מקום ביישוב \(ללא רשומת רחוב\): \$\{n\}`/); assert.match(page, /geoPlaceOf:n=>`official name of a place in this locality \(no street record\): \$\{n\}`/);
  assert.ok(page.includes('t.geoPlaceOf(g.matchedName)'), 'the page names the place a locality row was found by');
});

t('search is independent of transactions, street geography and the street report: a street with none of them is found in the top three of its locality (selected or named), and the search API loads none of those layers', () => {
  const D = SD.load();
  const geoMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/street-geo/meta.json'), 'utf8'));
  const located = new Set(Object.keys(geoMeta.localities || {}).map(Number));
  const S = require('../lib/streets/evidence').store();
  assert.ok(S.available && S.summary && S.summary.streets, 'the committed evidence summary');
  const observed = new Set(Object.keys(S.summary.streets));
  const bare = D.streets.filter((s) => s.kind === 'street' && s.status === 'current' && !located.has(s.cityCode) && !observed.has(`${s.cityCode}:${s.code}`));
  assert.ok(bare.length >= 1000, 'streets without deals or located points exist: ' + bare.length);
  const sample = bare.filter((_, i) => i % Math.floor(bare.length / 40) === 0).slice(0, 40);
  for (const s of sample) {
    assert.ok(streets(s.name, { near: s.cityCode }).slice(0, 3).some((m) => m.id === s.id), 'near ' + s.id + ' ' + s.name);
    assert.ok(streets(s.name + ' ' + R.resolveGeoId(s.id).city).slice(0, 3).some((m) => m.id === s.id), 'named ' + s.id + ' ' + s.name);
  }
  const api = fs.readFileSync(path.join(ROOT, 'api/geo/search.js'), 'utf8'), reg = fs.readFileSync(path.join(ROOT, 'lib/geo/registry.js'), 'utf8');
  for (const m of ['txevents', 'streets/report', 'streets/evidence', 'street-geo', 'value-read']) { assert.ok(!api.includes(m), 'api: ' + m); assert.ok(!reg.includes("require('../" + m), 'registry: ' + m); }
});

t('the API error contract: a missing index answers 503 geo-index-unavailable, a search failure 500 geo-search-failed, both no-store; a real answer (zero included) is 200 with a matches array', async () => {
  const handlerPath = require.resolve('../api/geo/search.js'), regPath = require.resolve('../lib/geo/registry');
  const run = (h, q) => new Promise((ok) => { const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, end(b) { ok({ status: this.statusCode, cache: this.h['cache-control'], type: this.h['content-type'], body: JSON.parse(b) }); } }; h({ method: 'GET', url: '/api/geo/search?q=' + encodeURIComponent(q) }, res); });
  const real = require(handlerPath);
  const zero = await run(real, 'קקקקקקק'); assert.equal(zero.status, 200); assert.ok(Array.isArray(zero.body.matches) && zero.body.matches.length === 0, 'a genuine zero is an answer'); assert.match(zero.cache, /max-age=3600/);
  const hit = await run(real, 'הרב משה'); assert.equal(hit.status, 200); assert.ok(hit.body.matches.length >= 10); assert.match(hit.type, /application\/json/);
  const saved = require.cache[regPath];
  try {
    for (const [load, search, status, code] of [[() => { const e = new Error('no index'); e.code = 'ENOENT'; throw e; }, null, 503, 'geo-index-unavailable'], [() => ({}), () => { throw new Error('boom'); }, 500, 'geo-search-failed']]) {
      require.cache[regPath] = { id: regPath, filename: regPath, loaded: true, exports: { ...saved.exports, loadGeo: load, searchGeo: search || saved.exports.searchGeo } };
      delete require.cache[handlerPath];
      const r = await run(require(handlerPath), 'הרב משה');
      assert.equal(r.status, status); assert.equal(r.body.error, code); assert.equal(r.cache, 'no-store', 'an error is never cached'); assert.ok(!('matches' in r.body), 'an error carries no empty result list');
    }
  } finally { require.cache[regPath] = saved; delete require.cache[handlerPath]; }
});

/* the page */
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fnSrc = (name) => { const i = page.indexOf('async function ' + name + '('); assert.ok(i > 0, name); let d = 0, j = page.indexOf('{', i); for (; j < page.length; j++) { if (page[j] === '{') d++; else if (page[j] === '}' && --d === 0) break; } return page.slice(i, j + 1); };
t('the page classifies every request outcome — network · auth (the gate\'s sign-in page) · server · timeout · index · invalid — and only a real JSON answer is data (zero matches included)', async () => {
  const srchFetch = new Function('fetch', 'location', fnSrc('srchFetch') + '\nreturn srchFetch;');
  const hdr = (o) => ({ get: (k) => o[k.toLowerCase()] || null });
  const resp = (o) => async () => ({ ok: o.status >= 200 && o.status < 300, status: o.status, url: o.url || 'https://x/api/geo/search?q=a', redirected: !!o.redirected, headers: hdr(o.headers || {}), json: async () => { if (o.body === undefined) throw new SyntaxError('Unexpected token <'); return o.body; } });
  const loc = { href: 'https://x/' }, isAns = (d) => Array.isArray(d.matches);
  const cases = [
    ['network', async () => { throw new TypeError('Failed to fetch'); }],
    ['auth', resp({ status: 200, redirected: true, url: 'https://x/login.html', headers: { 'content-type': 'text/html; charset=utf-8' } })],
    ['auth', resp({ status: 401, headers: { 'content-type': 'application/json' }, body: { ok: false } })],
    ['server', resp({ status: 500, headers: { 'content-type': 'application/json' }, body: { error: 'geo-search-failed' } })],
    ['timeout', resp({ status: 504, headers: { 'content-type': 'text/plain' } })],
    ['index', resp({ status: 503, headers: { 'content-type': 'application/json' }, body: { error: 'geo-index-unavailable' } })],
    ['invalid', resp({ status: 200, headers: { 'content-type': 'text/html' } })],
    ['invalid', resp({ status: 200, headers: { 'content-type': 'application/json' }, body: { results: [] } })],
  ];
  for (const [kind, f] of cases) { const r = await srchFetch(f, loc)('/api/geo/search?q=a', isAns); assert.equal(r.err && r.err.kind, kind, kind); assert.ok(!r.data); }
  const ok = await srchFetch(resp({ status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: { matches: [], meta: {} } }), loc)('/api/geo/search?q=a', isAns);
  assert.ok(ok.data && !ok.err, 'zero matches is an answer, not an error');
});

t('the page never prints "No results" for a failed request: the error line names what failed, says it is not an empty result, offers a retry (and sign-in when the session ended); he + en', () => {
  const geo = page.slice(page.indexOf('function geoSug('), page.indexOf('function geoKindTag('));
  assert.match(geo, /srchFetch\("\/api\/geo\/search/); assert.ok(!/catch\(e\)\{\/\*/.test(geo), 'no silent catch'); assert.match(geo, /geoLast=\{q:qq,near,list,more,house,err\}/);
  const intel = page.slice(page.indexOf('function intelSug('), page.indexOf('function intelPick('));
  assert.match(intel, /srchFetch\("\/api\/intel\?view=search/); assert.match(intel, /intelLast=\{q:qq,list,err\}/);
  const render = page.slice(page.indexOf('function initSearch('), page.indexOf('const item=l=>'));
  assert.match(render, /gErr\|\|iErr\?/, 'an error replaces the empty message'); assert.match(render, /busy\?t\.geoSearching:t\.searchEmpty/, '"No results" only after both searches answered');
  assert.match(render, /data-retry/); assert.match(render, /href="\/login\.html"/); assert.match(render, /geoLast=\{\.\.\.geoLast,q:"",err:null\}/);
  const he = page.slice(page.indexOf('srchErr:{geo:"החיפוש'), page.indexOf('srchErr:{geo:"החיפוש') + 900), en = page.slice(page.indexOf('srchErr:{geo:"The national'), page.indexOf('srchErr:{geo:"The national') + 900);
  for (const k of ['geo:', 'intel:', 'network:', 'auth:', 'server:', 'timeout:', 'index:', 'invalid:', 'offline:', 'notEmpty:', 'retry:', 'signIn:']) { assert.ok(he.includes(k), 'he ' + k); assert.ok(en.includes(k), 'en ' + k); }
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  console.log(`search: ${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})();
