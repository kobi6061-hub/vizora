/* PROPX · What Changed Here? — the Playwright acceptance journey (not part of the node suite: it needs a running dev server and
   Playwright). Opens a street through the page's own search → "What changed here?" in the street report → period / kind / newness /
   scope filters → the geography combobox → a district; screenshots he / en × desktop (1440×900) / phone (390×844).

     SITE_PASSWORD=… SESSION_SECRET=… PORT=3304 node scripts/kobix-dev-server.mjs &
     PW=<path to the playwright package> CHROMIUM=<chromium executable> PASS=<the SITE_PASSWORD> OUT=<screenshot dir> node lib/changes/journey.js
*/
'use strict';
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3304';
const PASS = process.env.PASS;
const OUT = process.env.OUT || require('path').join(require('os').tmpdir(), 'propx-changes-shots');
if (!PASS) { console.error('PASS (the dev server\'s SITE_PASSWORD) is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra: extra || null }); log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };

async function signIn(ctx) {
  const r = await ctx.request.post(BASE + '/api/login', { data: { password: PASS }, headers: { 'x-propx-intent': '1', Origin: BASE } });
  if (!r.ok()) throw new Error('login ' + r.status());
}
async function waitFeed(page, geo) {
  await page.waitForFunction((g) => { const s = window.PropxChanges && window.PropxChanges.state(); return s && s.status === 'ok' && s.data && s.data.geo && s.data.geo.id === g; }, geo, { timeout: 60000 });
}
async function journey(lang, vp, tag) {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  await signIn(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: net::ERR_(CERT|NAME|CONNECTION|INTERNET|TUNNEL|PROXY)/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#chRoot', { state: 'attached' });
  if (lang === 'en') { await page.click('#langEn'); }
  /* 1 · open a street via the page's own search */
  await page.fill('#searchInput', 'הרצל פתח תקווה');
  await page.waitForSelector('.sp-item[data-geoi]', { timeout: 30000 });
  const items = await page.$$eval('.sp-item[data-geoi]', (xs) => xs.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const idx = items.findIndex((t) => /הרצל/.test(t) && /פתח תק/.test(t));
  check(`${tag}: search lists Herzl, Petah Tikva`, idx >= 0, items.slice(0, 3).join(' | '));
  await page.click(`.sp-item[data-geoi="${Math.max(0, idx)}"]`);
  /* the street report renders with the "What changed here?" link */
  await page.waitForSelector('[data-chgeo="st:7900:213"]', { timeout: 60000 });
  check(`${tag}: street report carries the What-changed-here link`, true);
  /* propx:geo already pointed the feed at the street; the link scrolls to it */
  await page.click('.sr-outs [data-chgeo="st:7900:213"]');
  await waitFeed(page, 'st:7900:213');
  const s1 = await page.evaluate(() => { const s = window.PropxChanges.state(); return { geo: s.data.geo.id, items: s.items.length, total: s.data.total, period: s.data.period, tx: s.data.kinds.TRANSACTION.counts, scopes: s.data.filters.scope }; });
  check(`${tag}: feed for the street (default scopes: street + near)`, s1.geo === 'st:7900:213' && s1.items > 0 && s1.scopes.join() === 'EXACT_STREET,NEAR_STREET', JSON.stringify(s1));
  const inView = await page.waitForFunction(() => { const r = document.getElementById('changes').getBoundingClientRect(); return r.top >= -4 && r.top < window.innerHeight * 0.5; }, null, { timeout: 6000 }).then(() => true).catch(() => false);
  check(`${tag}: #changes scrolled into view`, inView);
  /* every rendered item has an event date, a seen-by-PROPX date, a verb, a source, a scope chip and a class chip */
  const shape = await page.$$eval('#chRoot .ch-it', (xs) => xs.slice(0, 40).map((x) => ({ d: !!x.querySelector('.ch-date b'), seen: !!x.querySelector('.ch-seen b'), verb: !!x.querySelector('.pu-verb'), sc: !!x.querySelector('.ch-sc'), cls: !!x.querySelector('.vc') })));
  check(`${tag}: items carry both dates, verb, scope, class`, shape.length > 0 && shape.every((x) => x.d && x.seen && x.verb && x.sc && x.cls), shape.length + ' items checked');
  /* 2 · filters: period 365 */
  await page.click('#chRoot [data-chper="365"]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.period.days === 365; }, null, { timeout: 60000 });
  const s2 = await page.evaluate(() => { const s = window.PropxChanges.state(); return { total: s.data.total, from: s.data.period.from, to: s.data.period.to }; });
  check(`${tag}: period 365 reloads`, s2.total >= s1.total, JSON.stringify(s2));
  /* kind chip: transactions only */
  await page.click('#chRoot .ch-chips [data-chkind="TRANSACTION"]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.filters.kinds && s.data.filters.kinds.join() === 'TRANSACTION'; }, null, { timeout: 60000 });
  const kindsShown = await page.evaluate(() => [...new Set(window.PropxChanges.state().items.map((i) => i.kind))]);
  check(`${tag}: kind filter → transactions only`, kindsShown.length === 1 && kindsShown[0] === 'TRANSACTION', kindsShown.join(','));
  if (tag === 'he-desktop' || tag === 'en-desktop') await page.screenshot({ path: `${OUT}/${tag}-street-tx.png`, fullPage: false });
  /* newness chip: new events only */
  await page.click('#chRoot .ch-chips [data-chnew="NEW_EVENT"]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.filters.newness && s.data.filters.newness.join() === 'NEW_EVENT'; }, null, { timeout: 60000 });
  const nw = await page.evaluate(() => [...new Set(window.PropxChanges.state().items.map((i) => i.newness))]);
  check(`${tag}: newness filter → new events only`, nw.length <= 1 && (nw.length === 0 || nw[0] === 'NEW_EVENT'), nw.join(','));
  /* back to all kinds / all newness; scope chip: add the locality context */
  await page.click('#chRoot .ch-chips [data-chkind=""]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && !s.data.filters.kinds; }, null, { timeout: 60000 });
  await page.click('#chRoot .ch-chips [data-chnew=""]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && !s.data.filters.newness; }, null, { timeout: 60000 });
  const before = await page.evaluate(() => window.PropxChanges.state().data.total);
  await page.click('#chRoot [data-chscope="locality"]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.filters.scope.includes('LOCALITY'); }, null, { timeout: 60000 });
  const after = await page.evaluate(() => window.PropxChanges.state().data.total);
  check(`${tag}: locality-context scope adds items`, after > before, before + ' → ' + after);
  await page.click('#chRoot [data-chscope="locality"]');
  await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && !s.data.filters.scope.includes('LOCALITY'); }, null, { timeout: 60000 });
  /* the timeline groups by month; the coverage panel lists every kind */
  const months = await page.$$eval('#chRoot .ch-mo', (xs) => xs.length);
  const covRows = await page.$$eval('#chRoot .ch-cr', (xs) => xs.length);
  check(`${tag}: month groups + coverage rows`, months > 0 && covRows === 10, months + ' months, ' + covRows + ' coverage rows');
  /* an ⓘ opens the registry popover */
  const xpb = await page.$('#chRoot [data-xp]');
  if (xpb) { await xpb.click(); const pop = await page.waitForSelector('#xpPop:not([hidden])', { timeout: 5000 }).catch(() => null); check(`${tag}: ⓘ opens the explanation`, !!pop); await page.keyboard.press('Escape'); }
  /* keyboard: the geography search is a combobox (type, arrow, Enter) */
  await page.focus('#chRoot [data-chq]');
  await page.keyboard.type('פתח תקווה', { delay: 20 });
  await page.waitForSelector('#chRoot .ch-list li[data-chpick]', { timeout: 30000 });
  await page.keyboard.press('ArrowDown');
  const active = await page.$eval('#chRoot [data-chq]', (x) => x.getAttribute('aria-activedescendant'));
  check(`${tag}: combobox arrow selects an option`, active === 'chOpt0', active);
  /* screenshots of the street feed (365 days) */
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.PropxChanges.setGeo('st:7900:213', { force: true }));
  await waitFeed(page, 'st:7900:213');
  await page.evaluate(() => document.getElementById('changes').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${tag}-street.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/${tag}-street-section.png`, clip: await page.evaluate(() => { const r = document.getElementById('changes').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + window.scrollY), width: document.documentElement.clientWidth, height: Math.min(r.height, 3400) }; }), fullPage: true });
  /* horizontal overflow at phone width */
  const overflow = await page.evaluate(() => document.getElementById('changes').scrollWidth - document.getElementById('changes').clientWidth);
  check(`${tag}: no horizontal overflow in #changes`, overflow <= 1, String(overflow));
  /* 3 · a large city and a district through the district picker */
  await page.selectOption('#chRoot [data-chdist]', 'd-center');
  await waitFeed(page, 'd-center');
  const d = await page.evaluate(() => { const s = window.PropxChanges.state(); return { total: s.data.total, tx: s.data.kinds.TRANSACTION.counts.total, listing: s.data.kinds.TRANSACTION.listing }; });
  check(`${tag}: district feed`, d.total > 0, JSON.stringify(d));
  await page.evaluate(() => document.getElementById('changes').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${tag}-district.png`, fullPage: false });
  /* 4 · the dossier's header link opens the same geography here */
  await page.evaluate(() => { dsOpen('locality', '3000'); document.getElementById('dossier').scrollIntoView({ block: 'start' }); });
  const dl = await page.waitForSelector('#dossier .ds-head [data-chgeo="loc:3000"]', { timeout: 60000 }).catch(() => null);
  check(`${tag}: the dossier header links to What changed here`, !!dl);
  if (dl) { await dl.click(); await waitFeed(page, 'loc:3000'); const j = await page.evaluate(() => { const s = window.PropxChanges.state(); return { total: s.data.total, housing: s.data.kinds.HOUSING.statement.code }; }); check(`${tag}: Jerusalem from the dossier`, j.total > 0 && j.housing === 'SOURCE_STALE', JSON.stringify(j)); }
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}
(async () => {
  const ALL = [['he', { width: 1440, height: 900 }, 'he-desktop'], ['en', { width: 1440, height: 900 }, 'en-desktop'], ['he', { width: 390, height: 844 }, 'he-phone'], ['en', { width: 390, height: 844 }, 'en-phone']];
  const runs = process.env.ONLY ? ALL.filter((r) => r[2] === process.env.ONLY) : ALL;
  for (const [l, vp, tag] of runs) { try { await journey(l, vp, tag); } catch (e) { check(tag + ': journey', false, String(e && e.message || e).slice(0, 400)); } }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(OUT + '/journey-results.json', JSON.stringify(results, null, 1));
  log(`journey: ${results.length - failed.length} passed${failed.length ? ', ' + failed.length + ' FAILED' : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
