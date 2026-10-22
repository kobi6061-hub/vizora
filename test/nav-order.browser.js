'use strict';
/* PROPX · CUSTOMIZABLE NAVIGATION — the browser journey (Playwright; NOT part of `node test/*.test.js`: it needs a running dev server).
 *
 *   default state → open "Customize navigation" → keyboard (handle arrows · Home) → Up / Down buttons → drag (mouse on desktop,
 *   a real touch drag on the phone) with the drop indicator → focus kept inside → Done → the rail AND the page sections in the
 *   new order (Overview first, ALTARIS in its slot, Sale vs rent with Prices, rankings with Neighbourhoods, group headings and
 *   dividers hidden) → saved in localStorage "propx:nav:v1" → a rail jump and a launchpad jump land on their (moved) sections,
 *   lazy sections still load, the scroll-spy marks the last section at the bottom → reload restores the order → Reset to default
 *   puts every element back → Escape closes; Hebrew (RTL) and English (LTR), desktop (1440×900) and phone (390×844); every page
 *   error fails the run; no horizontal page scroll on the phone.
 *
 * Run (nothing secret is read from the repo — the password comes from the environment):
 *   PW_MODULE=<path to node_modules/playwright> PW_CHROMIUM=<chromium executable> NAV_BASE=http://127.0.0.1:3411 \
 *   NAV_PASSWORD=<the dev server's SITE_PASSWORD> NAV_SHOTS=<directory outside the repo> node test/nav-order.browser.js
 */
const assert = require('node:assert');
const path = require('node:path');

const need = (k) => { const v = process.env[k]; if (!v) { console.log(`nav-order.browser: skipped (${k} not set)`); process.exit(0); } return v; };
const PW = need('PW_MODULE'), BASE = need('NAV_BASE'), PASS = need('NAV_PASSWORD'), SHOTS = need('NAV_SHOTS');
if (path.resolve(SHOTS).startsWith(path.resolve(__dirname, '..'))) { console.log('nav-order.browser: NAV_SHOTS must be outside the repository (it is public)'); process.exit(1); }
const { chromium } = require(PW);
const N = require('../lib/nav/order.js');

const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

/* the page as it stands: visible rail items, rail tail, main children with their display */
const snapshot = (page) => page.evaluate(() => {
  const vis = (e) => getComputedStyle(e).display !== 'none' && !e.hidden;
  const rail = [...document.getElementById('rail').children];
  const key = (e) => e.dataset.sec || (e.id === 'railAltaris' ? 'altaris' : e.id || (e.classList.contains('rail-div') ? '|' : e.classList.contains('rail-sp') ? 'sp' : e.getAttribute('href') || e.tagName));
  return {
    rail: rail.filter(vis).map(key),
    railAll: rail.map(key),
    main: [...document.querySelector('main').children].map((e) => ({ id: e.id || (e.querySelector('#svrGrid') ? 'saleRent' : e.className), shown: vis(e) })),
    custom: document.documentElement.classList.contains('nv-custom'),
    dot: document.getElementById('navEditBtn').classList.contains('nv-on'),
    order: window.PropxNav.ui.order(),
    stored: localStorage.getItem('propx:nav:v1'),
  };
});
const visibleOrder = (page) => page.evaluate(() => [...document.querySelectorAll('#nvList li.nv-it:not(.nv-fx)')].map((li) => li.dataset.key));

async function journey(browser, lang, vp) {
  const ctx = await browser.newContext({ viewport: { width: VIEWS[vp].width, height: VIEWS[vp].height }, isMobile: !!VIEWS[vp].isMobile, hasTouch: !!VIEWS[vp].hasTouch, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const login = await page.request.post(BASE + '/api/login', { data: { password: PASS }, headers: { 'content-type': 'application/json', origin: BASE } });
  assert.equal(login.status(), 200, 'sign-in');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PropxNav && window.PropxNav.ui && document.getElementById('launchpad'));
  await page.click(lang === 'en' ? '#langEn' : '#langHe');
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  const tag = `${lang}-${vp}`, T = N.STR[lang];

  /* 1 · the default */
  const D = await snapshot(page);
  assert.equal(D.custom, false); assert.equal(D.dot, false); assert.equal(D.stored, null);
  assert.equal(D.rail[0], 'overview');
  assert.deepEqual(D.main.filter((m) => /^grp/.test(m.id)).map((m) => m.shown), [true, true, true, true]);
  const defaultRail = D.railAll, defaultMain = D.main.map((m) => m.id), DEF = D.order;
  assert.equal(await page.getAttribute('#navEditBtn', 'aria-expanded'), 'false');
  ok(`${tag}: default order — ${DEF.length} movable items, 4 group headings shown, nothing stored`);

  /* 2 · open the editor */
  await page.locator('#navEditBtn').scrollIntoViewIfNeeded();
  await page.click('#navEditBtn');
  await page.waitForSelector('#nvEd:not([hidden])');
  assert.equal(await page.getAttribute('#nvEd', 'role'), 'dialog');
  assert.equal(await page.getAttribute('#nvEd', 'aria-modal'), 'true');
  assert.equal(await page.getAttribute('#navEditBtn', 'aria-expanded'), 'true');
  assert.equal((await page.textContent('#nvT')).trim(), T.title);
  assert.equal((await page.textContent('#nvDone')).trim(), T.done);
  assert.equal((await page.textContent('#nvReset')).trim(), T.reset);
  assert.ok(await page.$eval('#nvReset', (b) => b.disabled), 'Reset is disabled on the default order');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'nv-grip', 'focus on the first handle');
  const rows = await page.$$eval('#nvList li.nv-it', (l) => l.map((x) => ({ key: x.dataset.key, fixed: x.classList.contains('nv-fx'), buttons: x.querySelectorAll('button').length, label: x.querySelector('.nv-lb').textContent })));
  assert.deepEqual(rows.filter((r) => r.fixed).map((r) => r.key), ['overview', 'altaris']);
  assert.ok(rows.filter((r) => r.fixed).every((r) => r.buttons === 0), 'fixed rows carry no controls');
  assert.deepEqual(rows.filter((r) => !r.fixed).map((r) => r.key), DEF.filter((k) => D.rail.includes(k)));
  const railLabels = await page.$$eval('#rail .ri[data-sec] > span', (l) => Object.fromEntries(l.map((s) => [s.parentElement.dataset.sec, s.textContent.trim()])));
  for (const r of rows.filter((x) => !x.fixed)) assert.equal(r.label, railLabels[r.key], `${r.key} label in ${lang}`);
  if (vp === 'phone') {
    const box = await page.$eval('#nvEd', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
    assert.ok(box.l <= 1 && box.r >= box.w - 1 && Math.abs(box.b - box.h) <= 1, 'a bottom sheet');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page scroll');
  }
  await page.screenshot({ path: path.join(SHOTS, `${tag}-1-editor.png`) });
  ok(`${tag}: editor open — dialog, labels in ${lang}, focus on the first handle, Overview + ALTARIS fixed, Reset disabled`);

  /* 3 · keyboard: the handle's Up arrow ×3, then Home */
  const v0 = await visibleOrder(page);
  await page.focus('#nvList li[data-key="land"] .nv-grip');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  const v1 = await visibleOrder(page);
  assert.equal(v1.indexOf('land'), v0.indexOf('land') - 3);
  assert.equal(await page.evaluate(() => document.activeElement.closest('li').dataset.key), 'land', 'focus stays on the moved item');
  await page.waitForFunction((t) => document.getElementById('nvLive').textContent.includes(t), railLabels.land);
  await page.focus('#nvList li[data-key="sources"] .nv-grip');
  await page.keyboard.press('Home');
  assert.equal((await visibleOrder(page))[0], 'sources');
  ok(`${tag}: keyboard — Up ×3 moves Land three places, Home moves Sources first, focus kept, position announced`);

  /* 4 · buttons */
  assert.ok(await page.$eval('#nvList li[data-key="sources"] .nv-up', (b) => b.disabled), 'the first item cannot move up');
  await page.click('#nvList li[data-key="sources"] .nv-dn');
  const v2 = await visibleOrder(page);
  assert.equal(v2[1], 'sources');
  assert.ok(!(await page.$eval('#nvReset', (b) => b.disabled)), 'Reset enabled once customized');
  ok(`${tag}: Up / Down buttons — boundary disabled, Sources down one`);

  /* 5 · drag the 6th visible row above the 2nd: mouse on desktop, a real touch on the phone */
  await page.$eval('#nvList', (l) => { l.scrollTop = 0; });
  const vBefore = await visibleOrder(page);
  const src = vBefore[5], dst = vBefore[1];
  const g = await page.$eval(`#nvList li[data-key="${src}"] .nv-grip`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const t = await page.$eval(`#nvList li[data-key="${dst}"]`, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 6 }; });
  let mid;
  if (vp === 'phone') {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.x, y: g.y }] });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: g.x, y: g.y + (t.y - g.y) * i / 12 }] });
    mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.nv-ghost'), drop: !!document.querySelector('#nvList .nv-drop'), dragging: !!document.querySelector('.nv-dragging') }));
    await page.screenshot({ path: path.join(SHOTS, `${tag}-2-drag.png`) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 12 });
    mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.nv-ghost'), drop: !!document.querySelector('#nvList .nv-drop'), dragging: !!document.querySelector('.nv-dragging') }));
    await page.screenshot({ path: path.join(SHOTS, `${tag}-2-drag.png`) });
    await page.mouse.up();
  }
  assert.deepEqual(mid, { ghost: true, drop: true, dragging: true }, 'ghost + drop indicator while dragging');
  const v3 = await visibleOrder(page);
  assert.equal(v3.indexOf(src), v3.indexOf(dst) - 1, `${src} dropped right above ${dst}`);
  assert.equal(await page.evaluate(() => !!document.querySelector('.nv-ghost,.nv-drop,.nv-dragging')), false, 'nothing left behind');
  ok(`${tag}: ${vp === 'phone' ? 'touch' : 'mouse'} drag — ${src} dropped above ${dst}, indicator + ghost shown while dragging`);

  /* 6 · focus stays inside the dialog */
  await page.focus('#nvDone');
  for (let i = 0; i < 70; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('#nvEd')))) assert.fail('focus left the dialog'); }
  ok(`${tag}: Tab ×70 stays inside the editor`);

  /* 7 · Done → the rail and the page in the new order */
  await page.click('#nvDone');
  await page.waitForSelector('#nvEd', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'navEditBtn', 'focus back on the button');
  assert.equal(await page.getAttribute('#navEditBtn', 'aria-expanded'), 'false');
  const C = await snapshot(page);
  assert.ok(C.custom && C.dot);
  assert.deepEqual(JSON.parse(C.stored).order, C.order);
  assert.equal(JSON.parse(C.stored).schema, 'propx-nav-v1');
  const railItems = C.rail.filter((k) => k !== '|' && k !== 'sp' && k !== 'navEditBtn' && k !== 'themeBtnRail' && !k.startsWith('/api') && k !== 'A');
  assert.equal(railItems[0], 'overview');
  assert.deepEqual(railItems.filter((k) => k !== 'overview' && k !== 'altaris'), C.order.filter((k) => D.rail.includes(k)));
  assert.equal(C.railAll.indexOf('altaris'), defaultRail.indexOf('altaris') - defaultRail.slice(0, defaultRail.indexOf('altaris')).filter((k) => k === '|').length, 'ALTARIS keeps its slot');
  assert.deepEqual(C.railAll.slice(-3), defaultRail.slice(-3), 'the utility buttons stay last');
  const mainIds = C.main.map((m) => m.id);
  assert.deepEqual(mainIds.slice(0, 2), ['overview', 'geoView']);
  assert.deepEqual(mainIds.filter((id) => C.order.includes(id)), C.order, 'the page sections follow the order');
  assert.equal(mainIds[mainIds.indexOf('prices') + 1], 'saleRent');
  assert.equal(mainIds[mainIds.indexOf('table') + 1], 'rankings');
  assert.deepEqual(C.main.filter((m) => /^grp/.test(m.id)).map((m) => m.shown), [false, false, false, false]);
  assert.ok(!C.rail.includes('|'), 'dividers hidden');
  assert.deepEqual([...mainIds].sort(), [...defaultMain].sort(), 'every section still on the page');
  await page.screenshot({ path: path.join(SHOTS, `${tag}-3-custom.png`) });
  ok(`${tag}: Done — rail + page in the new order, ALTARIS in its slot, blocks intact, headings hidden, saved (propx-nav-v1)`);

  /* 8 · a rail jump and a launchpad jump land on their moved sections; lazy sections still load; the spy follows */
  const near = (id) => page.waitForFunction((x) => { const s = document.getElementById(x); const m = parseFloat(getComputedStyle(s).scrollMarginTop) || 0; return Math.abs(s.getBoundingClientRect().top - m) <= 14; }, id, { timeout: 20000 });
  await page.locator('#rail .ri[data-sec="land"]').scrollIntoViewIfNeeded();
  await page.click('#rail .ri[data-sec="land"]');
  await near('land'); await page.waitForTimeout(1500); await near('land');
  await page.waitForFunction(() => typeof ldState !== 'undefined' && ldState.started, null, { timeout: 30000 });   /* Land's own lazy loader fired */
  await page.waitForFunction(() => document.querySelector('#rail .ri.on') && document.querySelector('#rail .ri.on').dataset.sec === 'land', null, { timeout: 5000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#launchpad [data-lp="txSection"]');
  await near('txSection'); await page.waitForTimeout(1500); await near('txSection');
  ok(`${tag}: rail → Land and launchpad → Transactions land on their moved sections; Land loads lazily; the spy marks Land`);
  /* the reader's own input ends the jump's 15-second re-anchoring (a programmatic scroll alone is not reader input) */
  await page.keyboard.press('Shift');
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(700); }
  await page.evaluate(() => window.scrollBy(0, -3)); await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
  const lastOn = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#rail .ri[data-sec]')].map((a) => document.getElementById(a.dataset.sec)).filter((s) => s && !s.hidden);
    const last = secs.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
    const on = document.querySelector('#rail .ri.on');
    return { last: last.id, on: on && on.dataset.sec };
  });
  assert.equal(lastOn.on, lastOn.last, `the spy marks the last section ON THE PAGE (order ${JSON.stringify(await page.evaluate(() => window.PropxNav.ui.order()))})`);
  ok(`${tag}: page bottom — the spy marks ${lastOn.last}, the last section in the custom order`);

  /* 9 · reload: the stored order is applied as the page is parsed */
  const saved = C.order;
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const R = await page.evaluate(() => ({ custom: document.documentElement.classList.contains('nv-custom'), main: [...document.querySelector('main').children].map((e) => e.id).filter(Boolean) }));
  assert.ok(R.custom, 'custom at DOMContentLoaded');
  assert.deepEqual(R.main.filter((id) => saved.includes(id)), saved);
  await page.waitForFunction(() => window.PropxNav && window.PropxNav.ui);
  assert.deepEqual(await page.evaluate(() => window.PropxNav.ui.order()), saved);
  await page.waitForSelector('#dlRoot .dl-pick', { timeout: 30000 });
  ok(`${tag}: reload — the order is back at DOMContentLoaded, the Deal Lab still mounts`);

  /* 10 · Escape closes; Reset to default puts every element back */
  await page.click(lang === 'en' ? '#langEn' : '#langHe');
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  await page.locator('#navEditBtn').scrollIntoViewIfNeeded();
  await page.click('#navEditBtn');
  await page.waitForSelector('#nvEd:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#nvEd', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'navEditBtn');
  await page.click('#navEditBtn');
  await page.waitForSelector('#nvEd:not([hidden])');
  await page.click('#nvReset');
  await page.waitForFunction((t) => document.getElementById('nvLive').textContent === t, T.resetDone);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'nvDone', 'focus on Done after Reset');
  await page.click('#nvDone');
  const Z = await snapshot(page);
  assert.equal(Z.custom, false); assert.equal(Z.dot, false); assert.equal(Z.stored, null, 'the key is removed');
  assert.deepEqual(Z.railAll, defaultRail, 'the rail exactly as shipped');
  assert.deepEqual(Z.main.map((m) => m.id), defaultMain, 'the page exactly as shipped');
  assert.deepEqual(Z.main.filter((m) => /^grp/.test(m.id)).map((m) => m.shown), [true, true, true, true]);
  ok(`${tag}: Escape closes; Reset to default restores the shipped rail + page, removes the stored key, shows the headings`);

  assert.deepEqual(errors, [], 'no page errors');
  if (vp === 'phone') assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page scroll');
  ok(`${tag}: no page errors`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const lang of ['he', 'en']) for (const vp of ['desktop', 'phone']) await journey(browser, lang, vp);
  } finally { await browser.close(); }
  console.log(`nav-order.browser: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
