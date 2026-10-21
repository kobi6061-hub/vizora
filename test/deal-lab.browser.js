'use strict';
/* PROPX · DEAL DECISION LAB — the browser journey (Playwright; NOT part of `node test/*.test.js`: it needs a running dev server).
 *
 *   search a street → pick it with the keyboard → fill the deal → results → memo (print view + .html download) → saved deal,
 *   in Hebrew (RTL) and English (LTR), on desktop (1440×900) and phone (390×844); every page error fails the run; no horizontal
 *   page scroll on the phone; the street report's "Analyse this deal in the Deal Lab" button prefills the lab.
 *
 * Run (nothing secret is read from the repo — the password comes from the environment):
 *   PW_MODULE=<path to node_modules/playwright> PW_CHROMIUM=<chromium executable> DEAL_LAB_BASE=http://127.0.0.1:3303 \
 *   DEAL_LAB_PASSWORD=<the dev server's SITE_PASSWORD> DEAL_LAB_SHOTS=<directory outside the repo> node test/deal-lab.browser.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const need = (k) => { const v = process.env[k]; if (!v) { console.log(`deal-lab.browser: skipped (${k} not set)`); process.exit(0); } return v; };
const PW = need('PW_MODULE'), BASE = need('DEAL_LAB_BASE'), PASS = need('DEAL_LAB_PASSWORD'), SHOTS = need('DEAL_LAB_SHOTS');
if (path.resolve(SHOTS).startsWith(path.resolve(__dirname, '..'))) { console.log('deal-lab.browser: DEAL_LAB_SHOTS must be outside the repository (it is public)'); process.exit(1); }
const { chromium } = require(PW);

const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

async function journey(browser, lang, vp) {
  const ctx = await browser.newContext({ viewport: { width: VIEWS[vp].width, height: VIEWS[vp].height }, isMobile: !!VIEWS[vp].isMobile, hasTouch: !!VIEWS[vp].hasTouch, acceptDownloads: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const login = await page.request.post(BASE + '/api/login', { data: { password: PASS }, headers: { 'content-type': 'application/json', origin: BASE } });
  assert.equal(login.status(), 200, 'sign-in');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dlRoot .dl-pick', { timeout: 30000 });
  if (lang === 'en') await page.click('#langEn'); else await page.click('#langHe');
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  await page.locator('#dealLab').scrollIntoViewIfNeeded();
  const tag = `${lang}-${vp}`;

  /* 1 · search a street, pick it with the keyboard */
  await page.fill('#dl-q', lang === 'en' ? 'הרצל פתח תקווה' : 'הרצל פתח תקווה');
  await page.waitForSelector('#dl-list li[data-dlopt]', { timeout: 20000 });
  assert.equal(await page.getAttribute('#dl-q', 'aria-expanded'), 'true');
  await page.focus('#dl-q'); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#dl-q', 'aria-activedescendant'), 'dl-opt-0');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /st:7900:213/.test((document.getElementById('dlCur') || {}).textContent || ''), null, { timeout: 20000 });
  ok(`${tag}: search → keyboard pick → st:7900:213 הרצל, פתח תקווה`);

  /* 2 · fill the deal (the user's assumptions — nothing is defaulted) */
  const set = async (k, v) => page.fill(`[data-dl="${k}"]`, String(v));
  await set('sqm', 85); await set('rooms', 3.5); await set('price', 2100000);
  await page.selectOption('[data-dl="buyer"]', 'single');
  await set('legal', 10000); await set('broker', 40000); await set('renovation', 50000); await set('other', 0);
  await page.click('[data-dlact="tax"]');
  await page.check('input[name="dl-mode"][value="ltv"]');
  await set('ltvPct', 70); await set('ratePct', 4.5); await set('years', 25);
  await set('rent', 6500); await set('vacancyPct', 5); await set('maintenance', 200); await set('managementPct', 0); await set('insurance', 1200); await set('otherOpex', 0);
  await set('targetCocPct', 2);
  await page.click('[data-dlact="stress"]');
  await page.click('[data-dlact="analyse"]');
  await page.waitForFunction(() => { const r = document.getElementById('dl-comps'); return r && r.querySelectorAll('tbody tr').length > 3; }, null, { timeout: 30000 });
  await page.waitForFunction(() => !/…/.test((document.querySelector('#dl-risk') || {}).textContent || '…'), null, { timeout: 30000 });
  ok(`${tag}: the form filled; results loaded`);

  /* 3 · the results: real comparables, the model, the financing, the flags */
  const res = await page.evaluate(() => {
    const txt = (s) => (document.querySelector(s) || {}).textContent || '';
    return { price: txt('#dl-price'), comps: document.querySelectorAll('#dl-comps tbody tr').length, fin: txt('#dl-fin'), risk: txt('#dl-risk'), sens: document.querySelectorAll('#dl-sens tbody tr').length,
      scen: txt('#dl-scen'), tax: (document.querySelector('[data-dl="tax"]') || {}).value, cls: document.querySelectorAll('#dlForm .vc.usr').length };
  });
  assert.match(res.fin, /8,170\.74/, 'the monthly payment on ₪1,470,000 at 4.5 % over 25 years');
  assert.equal(res.tax, '4244', 'the purchase tax from the page\'s bracket table (₪2,100,000, single home)');
  assert.ok(res.comps > 3 && res.sens >= 15 && res.cls >= 20);
  assert.match(res.price, /24,690/, 'the street\'s median ₪/m² of the similar observed deals');
  assert.match(res.risk, lang === 'en' ? /Negative monthly cash flow/ : /תזרים חודשי שלילי/);
  assert.match(res.risk, lang === 'en' ? /Land-registry extract/ : /נסח טאבו/, 'the street report\'s due-diligence items');
  ok(`${tag}: price check 24,690 ₪/m² · payment ₪8,170.74 · tax ₪4,244 · ${res.comps} comparable rows · flags + due diligence`);

  /* sort the comparables by ₪/m² with the keyboard */
  await page.focus('[data-dlsort="pricePerSqm"]'); await page.keyboard.press('Enter');
  const sorted = await page.evaluate(() => document.querySelector('[data-dlsort="pricePerSqm"]').closest('th').getAttribute('aria-sort'));
  assert.equal(sorted, 'descending');
  ok(`${tag}: the comparables sort by keyboard (aria-sort ${sorted})`);

  /* an ⓘ opens the registry popover; Escape closes it */
  await page.locator('#dl-ret [data-xp="deal_dscr"]').first().click();
  await page.waitForSelector('#xpPop:not([hidden])');
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.getElementById('xpPop').hidden));
  ok(`${tag}: ⓘ deal_dscr opens and Escape closes`);

  /* phone: no horizontal page scroll */
  if (vp === 'phone') {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 1, 'horizontal page scroll ' + over);
    ok(`${tag}: no horizontal page scroll (${over}px)`);
  }
  await page.locator('#dealLab').screenshot({ path: path.join(SHOTS, `deal-lab-${tag}.png`) });
  await page.locator('#dl-price').screenshot({ path: path.join(SHOTS, `deal-lab-${tag}-price.png`) });

  /* 4 · the memo: the .html download and the print view */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-dlact="download"]')]);
  const file = path.join(SHOTS, `memo-${tag}.html`); await dl.saveAs(file);
  const memo = fs.readFileSync(file, 'utf8');
  assert.match(memo, lang === 'en' ? /not an appraisal and not investment advice/i : /לא שומה ולא ייעוץ השקעות/);
  assert.match(memo, /st:7900:213/); assert.match(memo, /8,170\.74/); assert.match(memo, lang === 'en' ? /USER ASSUMPTION/ : /הנחת משתמש/); assert.match(memo, /19\.09\.2026/);
  assert.ok(!/<button|<input/.test(memo), 'the memo carries no controls');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('[data-dlact="print"]');
  await page.waitForTimeout(150);
  const printed = await page.evaluate(() => ({ on: document.body.classList.contains('dl-printing'), memo: (document.getElementById('dlPrint') || {}).textContent || '' }));
  assert.ok(printed.memo.length > 1000);
  await page.screenshot({ path: path.join(SHOTS, `memo-print-${tag}.png`), fullPage: false });
  await page.emulateMedia({ media: 'screen' });
  ok(`${tag}: memo downloaded (${(memo.length / 1024).toFixed(0)} KB) and printed`);

  /* 5 · save the deal; it survives a reload */
  await page.waitForTimeout(800);
  await page.click('[data-dlact="save"]');
  const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('propx:deallab:v1')).deals.length; } catch (e) { return -1; } });
  assert.ok(saved >= 1);
  ok(`${tag}: saved in propx:deallab:v1 (${saved})`);

  assert.deepEqual(errors, [], 'page errors');
  await ctx.close();
}

async function hook(browser) {
  /* the street report's valuation section → the lab, prefilled */
  const ctx = await browser.newContext({ viewport: VIEWS.desktop, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.request.post(BASE + '/api/login', { data: { password: PASS }, headers: { 'content-type': 'application/json', origin: BASE } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dlRoot .dl-pick');
  await page.evaluate(() => openGeoView({ kind: 'street', id: 'st:5000:813', he: 'אנטיגונוס', city: 'תל אביב - יפו', cityCode: 5000, streetCode: 813, district: 'd-ta' }));
  await page.waitForSelector('[data-srdeal]', { timeout: 40000 });
  const f = page.locator('[data-srprop]').first();
  await f.locator('[name="askingPrice"]').fill('3900000'); await f.locator('[name="sqm"]').fill('70'); await f.locator('[name="rooms"]').fill('3');
  await page.click('[data-srdeal]');
  await page.waitForFunction(() => /st:5000:813/.test((document.getElementById('dlCur') || {}).textContent || ''), null, { timeout: 20000 });
  const v = await page.evaluate(() => ['price', 'sqm', 'rooms', 'rent'].map((k) => document.querySelector(`[data-dl="${k}"]`).value));
  assert.deepEqual(v, ['3900000', '70', '3', ''], 'prefilled with what the report holds — nothing else');
  await page.waitForFunction(() => document.querySelectorAll('#dl-comps tbody tr').length > 0, null, { timeout: 30000 });
  await page.locator('#dl-price').screenshot({ path: path.join(SHOTS, 'deal-lab-hook-st-5000-813.png') });
  ok('the street report\'s "Analyse this deal in the Deal Lab" opens st:5000:813 אנטיגונוס prefilled (price · area · rooms only)');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  try {
    for (const lang of ['he', 'en']) for (const vp of ['desktop', 'phone']) await journey(browser, lang, vp);
    await hook(browser);
  } finally { await browser.close(); }
  console.log(`deal-lab.browser: ${passed} passed`);
})().catch((e) => { console.error(e); console.log('deal-lab.browser: FAILED'); process.exit(1); });
