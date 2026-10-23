'use strict';
/* PROPX · ISRAEL NATIONAL OVERVIEW & GEOGRAPHIC DRILL-DOWN — the browser journey (Playwright; NOT part of `node test/*.test.js`: it needs a
 * running dev server).
 *
 *   1 reset from a selected STREET to Israel · 2 reset from a NEIGHBOURHOOD and from a CITY (the button and the scope chip) · 3 the national
 *   level is Israel (board, dossier, transactions, change feed, pulse — and the atlas' figures are the API's) · 4 district → subdistrict →
 *   city → neighbourhood → street by the atlas, every section pointed at the scope · 5 missing / unverified relationships (Judea and
 *   Samaria without a board card, a subdistrict's context, a statistical area without transactions) stated in banners and chips · 6 the
 *   latest known vs the latest priced residential transaction nationally · 7 the existing features after the geography changes (search,
 *   the navigation editor, the Deal Lab on a street, one level up, no page error) · 8 Hebrew / English × desktop / phone (no horizontal
 *   page scroll), with screenshots. Kept by the reset: language, theme, the navigation order, every other browser key; no reload.
 *
 * Run (nothing secret is read from the repo — the password comes from the environment):
 *   PW_MODULE=<path to node_modules/playwright> PW_CHROMIUM=<chromium executable> GEO_BASE=http://127.0.0.1:4517 \
 *   GEO_PASSWORD=<the dev server's SITE_PASSWORD> GEO_SHOTS=<directory outside the repo> node test/geo-scope.browser.js
 */
const assert = require('node:assert');
const path = require('node:path');

const need = (k) => { const v = process.env[k]; if (!v) { console.log(`geo-scope.browser: skipped (${k} not set)`); process.exit(0); } return v; };
const PW = need('PW_MODULE'), BASE = need('GEO_BASE'), PASS = need('GEO_PASSWORD'), SHOTS = need('GEO_SHOTS');
if (path.resolve(SHOTS).startsWith(path.resolve(__dirname, '..'))) { console.log('geo-scope.browser: GEO_SHOTS must be outside the repository (it is public)'); process.exit(1); }
const { chromium } = require(PW);

const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

async function open(browser, lang, view) {
  const ctx = await browser.newContext({ viewport: { width: VIEWS[view].width, height: VIEWS[view].height }, isMobile: !!VIEWS[view].isMobile, hasTouch: !!VIEWS[view].hasTouch, deviceScaleFactor: 1 });
  const r = await ctx.request.post(BASE + '/api/login', { data: { password: PASS }, headers: { 'content-type': 'application/json', origin: BASE } });
  assert.ok(r.ok(), 'login ' + r.status());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 });
  if (lang === 'en') { await page.click('#langEn'); await page.waitForTimeout(400); }
  await page.waitForFunction(() => window.PropxAtlas && window.PropxAtlas.state().status === 'ok', null, { timeout: 90000 });
  return { ctx, page, errors };
}
const atlasAt = (page, id) => page.waitForFunction((id) => { const s = window.PropxAtlas.state(); return s.id === id && s.status === 'ok' && document.querySelector('#atlas .atl:not(.is-busy)'); }, id, { timeout: 90000 });
const shot = (page, name) => page.locator('#overview').screenshot({ path: path.join(SHOTS, name + '.png') });
/* what every geography-dependent section currently points at */
const where = (page) => page.evaluate(() => ({
  atlas: window.PropxAtlas.state().id, scope: state.scope || 'il', board: state.locId, geo: state.geo ? state.geo.id || ('loc:' + state.geo.code) : null, scopeArea: state.scopeArea ? state.scopeArea.id : null,
  dossier: dsState.level === 'il' ? 'il' : dsState.level === 'district' ? dsState.code : 'loc:' + dsState.code,
  changes: window.PropxChanges ? window.PropxChanges.state().geo : null,
  tx: (() => { const q = txQueryFor(); return q ? (q.area || q.sid || q.city) : null; })(),
  land: ldState.f.city || null, housing: hoState.f.city || null, intel: inState.city || null, pulseCity: puState.city || null, pulseDistrict: puState.district || null,
  banners: [...document.querySelectorAll('.scn')].map((b) => b.dataset.scn),
  geoView: !document.getElementById('geoView').hidden,
}));
const clickGo = async (page, id) => { await page.locator(`#atlas [data-atgo="${id}"]`).first().click(); await atlasAt(page, id); await page.waitForTimeout(700); };

async function full(browser) {
  console.log('geo-scope.browser: Hebrew · desktop — the full journey');
  const { ctx, page, errors } = await open(browser, 'he', 'desktop');
  const api = async (id) => (await ctx.request.get(BASE + '/api/intel?view=scope&id=' + encodeURIComponent(id))).json();

  /* 3 + 6: Israel is Israel; the latest known ≠ the latest priced residential, as the API states them */
  const il = await api('il');
  let w = await where(page);
  assert.deepEqual([w.atlas, w.board, w.dossier, w.tx, w.geo], ['il', 'il', 'il', 'il', null]);
  const cards = await page.$$eval('#atlas .atl-ev', (els) => els.map((e) => e.innerText));
  const d = (s) => s.split('-').reverse().join('.');
  assert.ok(cards[0].includes(d(il.transactions.latestKnown.date)) && cards[1].includes(d(il.transactions.latestPriced.date)));
  assert.ok(cards[1].includes(il.transactions.latestPriced.price.toLocaleString('en-US')), 'the priced deal shows its price');
  if (!il.transactions.latestKnown.priceUsed) assert.ok(!cards[0].includes('₪'), 'an unreliable price is never shown');
  assert.equal(await page.$$eval('#atlas table[data-ptdom="atdist"] tbody tr', (r) => r.length), 7);
  assert.equal(await page.textContent('#kpiTitle'), 'תמונת שוק ארצית');
  await shot(page, 'he-desktop-1-israel');
  ok('3 · 6 the national level is Israel everywhere; latest known (' + il.transactions.latestKnown.date + ') and latest priced residential (' + il.transactions.latestPriced.date + ') shown apart, as the API states them');

  /* 4: district → subdistrict → city → neighbourhood → street */
  await clickGo(page, 'd-north');
  w = await where(page);
  assert.deepEqual([w.board, w.dossier, w.changes, w.pulseDistrict, w.tx], ['d-north', 'd-north', 'd-north', 'd-north', 'd-north']);
  await shot(page, 'he-desktop-2-district');
  const napa = await page.$eval('#atlas table[data-ptdom="atnapa"] tbody tr [data-atgo]', (b) => b.dataset.atgo);
  await clickGo(page, napa);
  w = await where(page);
  assert.equal(w.board, 'd-north'); assert.equal(w.dossier, 'd-north');
  for (const s of ['overview', 'dossier', 'changes']) assert.ok(w.banners.includes(s), 'a subdistrict: ' + s + ' states its district context');
  assert.ok(await page.$('#atlas .atl-mode.m-AGGREGATED'));
  await shot(page, 'he-desktop-3-subdistrict');
  const loc = await page.$eval('#atlas table[data-ptdom="atloc"] tbody tr [data-atgo]', (b) => b.dataset.atgo);
  await clickGo(page, loc);
  w = await where(page);
  const code = loc.slice(4);
  assert.deepEqual([w.dossier, w.land, w.housing, w.intel, w.pulseCity], [loc, code, code, code, code]);
  await shot(page, 'he-desktop-4-locality');
  ok(`4 district → subdistrict (${napa}) → locality (${loc}): board, dossier, change feed, pulse, land, housing, developers and transactions follow; the subdistrict's context is stated`);

  await page.evaluate(() => window.PropxAtlas.go('loc:7900')); await atlasAt(page, 'loc:7900'); await page.waitForTimeout(600);
  const nb = await page.$eval('#atlas .atl-chips [data-atgo^="nb:"]', (b) => b.dataset.atgo);
  await clickGo(page, nb);
  w = await where(page);
  assert.equal(w.changes, nb); assert.equal(w.board, nb.slice(3)); assert.ok(w.banners.includes('txSection') || w.tx === 'פתח תקווה');
  assert.ok(await page.$('#atlas .atl-mode.m-CONTEXT'), 'a neighbourhood\'s transactions are the locality\'s, labelled');
  await shot(page, 'he-desktop-5-neighbourhood');
  await page.evaluate(() => window.PropxAtlas.go('loc:7900')); await atlasAt(page, 'loc:7900');
  await page.fill('#atlas [data-atsq]', 'הרצל');
  await page.waitForSelector('#atlas .atl-chips [data-atgo="st:7900:213"]', { timeout: 30000 });
  await clickGo(page, 'st:7900:213');
  w = await where(page);
  assert.deepEqual([w.geo, w.changes, w.tx, w.dossier, w.land], ['st:7900:213', 'st:7900:213', 'st:7900:213', 'loc:7900', '7900']);
  assert.ok(w.geoView, 'the street report is open');
  const lab = await page.evaluate(() => { const s = document.querySelector('#dealLab'); return s ? s.innerText.includes('הרצל') : null; });
  assert.notEqual(lab, false, 'the Deal Lab follows the street');
  await shot(page, 'he-desktop-6-street');
  ok('4 neighbourhood (' + nb + ', the feed on its linked streets, transactions as the locality\'s context) → street (search inside the locality → the street report, the feed, the Deal Lab)');

  /* 7: one level up */
  await page.click('#atlas .atl-up'); await atlasAt(page, 'loc:7900');
  ok('7 one level up: street → its locality');

  /* 1: reset from a street — kept: language, theme, navigation order, every browser key; no reload */
  await page.evaluate(() => window.PropxAtlas.go('st:7900:213')); await atlasAt(page, 'st:7900:213'); await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__noReload = 1; document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('propx:nav:v1', JSON.stringify({ schema: 'propx-nav-v1', order: window.PropxNav.ui.order().slice().reverse() }));
    localStorage.setItem('propx:geo-test', 'kept');
  });
  const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  await page.click('#resetIL');
  await atlasAt(page, 'il'); await page.waitForTimeout(900);
  w = await where(page);
  assert.deepEqual([w.atlas, w.board, w.geo, w.scopeArea, w.dossier, w.changes, w.tx, w.land, w.housing, w.intel, w.pulseCity, w.pulseDistrict, w.geoView], ['il', 'il', null, null, 'il', 'il', 'il', null, null, null, null, null, false]);
  assert.deepEqual(w.banners, []);
  const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  assert.equal(after, before, 'the reset touches no browser key (navigation order, saved deals, watchlists …)');
  assert.deepEqual(await page.evaluate(() => [window.__noReload, document.documentElement.dataset.theme, state.lang]), [1, 'dark', 'he']);
  await shot(page, 'he-desktop-7-after-reset');
  ok('1 reset from a street → Israel in every section; theme, language, navigation order and every browser key kept; no reload');

  /* 2: reset from a city by the scope chip, and from a neighbourhood by the button */
  await page.evaluate(() => window.PropxAtlas.go('loc:4000')); await atlasAt(page, 'loc:4000'); await page.waitForTimeout(600);
  await page.click('#cmdScope'); await atlasAt(page, 'il'); await page.waitForTimeout(600);
  w = await where(page); assert.deepEqual([w.board, w.geo, w.dossier, w.land], ['il', null, 'il', null]);
  await page.evaluate(() => window.PropxAtlas.go('nb:rhs-center')); await atlasAt(page, 'nb:rhs-center'); await page.waitForTimeout(600);
  await page.click('#resetIL'); await atlasAt(page, 'il'); await page.waitForTimeout(600);
  w = await where(page); assert.deepEqual([w.board, w.changes, w.dossier, w.land], ['il', 'il', 'il', null]);
  ok('2 reset from a city (the scope chip) and from a neighbourhood (the button)');

  /* 5: missing / unverified relationships */
  await clickGo(page, 'js-area');
  w = await where(page);
  assert.deepEqual([w.board, w.scopeArea, w.tx, w.dossier, w.changes], ['il', 'js-area', 'js-area', 'js-area', 'js-area']);
  assert.ok(w.banners.includes('overview'), 'Judea and Samaria: the board has no card — stated');
  await shot(page, 'he-desktop-8-judea-samaria');
  await page.evaluate(() => window.PropxAtlas.go('loc:5000')); await atlasAt(page, 'loc:5000');
  const sa = await page.$eval('#atlas [data-atsa] option:nth-child(2)', (o) => o.value);
  await page.selectOption('#atlas [data-atsa]', sa); await atlasAt(page, sa); await page.waitForTimeout(500);
  assert.ok(await page.$('#atlas .atl-ctx .atl-mode.m-NOT_AVAILABLE'), 'a statistical area holds no transactions — stated');
  assert.equal(await page.$$eval('#atlas .atl-ev', (e) => e.length), 0);
  ok('5 Judea and Samaria (no board card · transactions by its own area), a statistical area (census only, transactions NOT AVAILABLE)');

  /* 7: the existing features after the changes */
  await page.click('#resetIL'); await atlasAt(page, 'il');
  await page.fill('#searchInput', 'חיפה'); await page.waitForSelector('#searchPop [role="option"], #searchPop .sr-item, #searchPop button', { timeout: 30000 });
  await page.keyboard.press('Escape');
  await page.click('#navEditBtn'); await page.waitForSelector('#nvEd:not([hidden])', { timeout: 10000 }); await page.keyboard.press('Escape');
  assert.deepEqual(errors, [], 'no page error');
  ok('7 search, the navigation editor and every section after the geography changes — no page error');
  await ctx.close();
}

async function light(browser, lang, view) {
  console.log(`geo-scope.browser: ${lang} · ${view}`);
  const { ctx, page, errors } = await open(browser, lang, view);
  /* a mobile browser WIDENS the layout viewport to fit wide content — so the layout width itself must stay the device width */
  const noHScroll = () => page.evaluate((w) => innerWidth === w && document.scrollingElement.scrollWidth <= innerWidth + 1, VIEWS[view].width);
  assert.ok(await noHScroll(), 'no horizontal page scroll at Israel');
  await shot(page, `${lang}-${view}-israel`);
  await page.evaluate(() => window.PropxAtlas.go('napa:42')); await atlasAt(page, 'napa:42'); await page.waitForTimeout(500);
  await page.evaluate(() => window.PropxAtlas.go('loc:7900')); await atlasAt(page, 'loc:7900'); await page.waitForTimeout(800);
  assert.ok(await noHScroll(), 'no horizontal page scroll at a locality');
  const head = await page.textContent('#atlas h3');
  assert.equal(head.trim(), lang === 'he' ? 'פתח תקווה' : 'Petah Tiqwa');
  await shot(page, `${lang}-${view}-locality`);
  await page.locator('#resetIL').scrollIntoViewIfNeeded(); await page.click('#resetIL'); await atlasAt(page, 'il'); await page.waitForTimeout(500);
  const w = await where(page); assert.deepEqual([w.board, w.geo, w.land], ['il', null, null]);
  assert.equal(await page.evaluate(() => state.lang), lang);
  assert.deepEqual(errors, []);
  ok(`8 ${lang} · ${view}: atlas, drill-down, reset, no horizontal scroll, no page error`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  try {
    await full(browser);
    await light(browser, 'en', 'desktop');
    await light(browser, 'he', 'phone');
    await light(browser, 'en', 'phone');
    console.log(`geo-scope.browser: ${passed} passed`);
  } catch (e) { console.error('geo-scope.browser: FAILED —', e && e.stack || e); process.exitCode = 1; }
  finally { await browser.close(); }
})();
