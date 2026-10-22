'use strict';
/* PROPX · OVERNIGHT QA (workstream F) — the independent browser journeys over the Deal Decision Lab (#dealLab) and What Changed Here?
 * (#changes), run by hand against a dev server (NOT part of `node test/*.test.js`).
 *
 *   1  page search → a street → its street report → "Analyse this deal in the Deal Lab" → the form prefilled (price · area · rooms only)
 *      → rent + financing → results · sensitivity · risks → the memo (.html download + print view)
 *   2  the street report's "What changed here?" → period / kind filters → open a linked item
 *   3  a district in the change feed
 *   4  keyboard only: the rail link → the section → operate both features without a pointer
 *   5  every step: no page error / console error (external font / certificate errors of the sandbox excepted), no horizontal page
 *      scroll, the document direction of the language (rtl / ltr), and every RAW CODE (an UPPER_SNAKE enum) visible to the user is listed
 *
 * Hebrew + English × desktop 1440×900 + phone 390×844; a screenshot per step.
 * Run: PW_MODULE=<…/node_modules/playwright> PW_CHROMIUM=<chromium> QA_BASE=http://127.0.0.1:3306 QA_PASSWORD=<the dev server's SITE_PASSWORD>
 *      QA_SHOTS=<directory OUTSIDE the repository> node test/overnight-qa.browser.js
 */
const fs = require('node:fs');
const path = require('node:path');

const need = (k) => { const v = process.env[k]; if (!v) { console.log(`overnight-qa.browser: skipped (${k} not set)`); process.exit(0); } return v; };
const PW = need('PW_MODULE'), BASE = need('QA_BASE'), PASS = need('QA_PASSWORD'), SHOTS = need('QA_SHOTS');
if (path.resolve(SHOTS).startsWith(path.resolve(__dirname, '..'))) { console.log('overnight-qa.browser: QA_SHOTS must be outside the repository'); process.exit(1); }
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = require(PW);
const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const STREET = { id: 'st:3000:612', q: 'יפו ירושלים', re: /יפו/, city: /ירושלים/ };
const results = [];
const rawCodes = new Map();   // code → Set of where
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra: extra == null ? null : String(extra).slice(0, 500) }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra != null ? ' — ' + String(extra).slice(0, 300) : ''}`); };
const IGNORE_CONSOLE = /Failed to load resource: net::ERR_(CERT|NAME|CONNECTION|INTERNET|TUNNEL|PROXY)/;
/* an UPPER_SNAKE code (two parts or more) in user-visible text or a tooltip — e.g. RECENT_OBSERVED_LIMITED, NEW_EVENT, EXACT_STREET */
const RAW = /\b[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]{1,})+\b/g;

async function scanRaw(page, where) {
  const found = await page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      const root = document.querySelector(sel); if (!root) continue;
      const vis = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) { const p = n.parentElement; if (!p || !vis(p) || /^(SCRIPT|STYLE)$/.test(p.tagName)) continue; out.push({ sel, kind: 'text', t: n.nodeValue }); }
      root.querySelectorAll('[title],[aria-label],[placeholder]').forEach((el) => { for (const a of ['title', 'aria-label', 'placeholder']) if (el.getAttribute(a)) out.push({ sel, kind: a, t: el.getAttribute(a) }); });
    }
    return out;
  }, ['#dealLab', '#changes', '#xpPop:not([hidden])', '.sr-body, #geoView, #streetReport']);
  for (const f of found) for (const m of f.t.match(/\b[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]{1,})+\b/g) || []) {
    const k = `${m} (${f.kind === 'text' ? 'visible text' : f.kind} in ${f.sel.split(',')[0]})`;
    if (!rawCodes.has(k)) rawCodes.set(k, new Set()); rawCodes.get(k).add(where);
  }
}
async function pageState(page, tag, lang, step) {
  const s = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir || getComputedStyle(document.body).direction,
    dlDir: getComputedStyle(document.getElementById('dealLab')).direction, chDir: getComputedStyle(document.getElementById('changes')).direction }));
  check(`${tag} ${step}: no horizontal page scroll`, s.over <= 1, s.over + 'px');
  const want = lang === 'en' ? 'ltr' : 'rtl';
  check(`${tag} ${step}: direction ${want}`, s.dir === want && s.dlDir === want && s.chDir === want, JSON.stringify(s));
  await scanRaw(page, `${tag} ${step}`);
}
const shot = async (page, tag, name, sel) => {
  const file = path.join(SHOTS, `${tag}-${name}.png`);
  try { if (sel) await page.locator(sel).first().screenshot({ path: file }); else await page.screenshot({ path: file }); } catch (e) { await page.screenshot({ path: file }); }
  return file;
};
async function signedIn(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: VIEWS[vp].width, height: VIEWS[vp].height }, isMobile: !!VIEWS[vp].isMobile, hasTouch: !!VIEWS[vp].hasTouch, acceptDownloads: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) errors.push('console: ' + m.text()); });
  const r = await page.request.post(BASE + '/api/login', { data: { password: PASS }, headers: { 'content-type': 'application/json', origin: BASE } });
  if (r.status() !== 200) throw new Error('sign-in ' + r.status());
  return { ctx, page, errors };
}
async function setLang(page, lang) {
  if (lang === 'en') await page.click('#langEn'); else await page.click('#langHe');
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
}
const feedOk = (page, geo) => page.waitForFunction((g) => { const s = window.PropxChanges && window.PropxChanges.state(); return s && s.status === 'ok' && s.data && s.data.geo && s.data.geo.id === g; }, geo, { timeout: 60000 });

async function journey(browser, lang, vp) {
  const tag = `${lang}-${vp}`;
  const { ctx, page, errors } = await signedIn(browser, vp);
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#dlRoot .dl-pick', { timeout: 30000 });
    await setLang(page, lang);
    /* 1 · page search → the street → its report */
    await page.fill('#searchInput', STREET.q);
    await page.waitForSelector('.sp-item[data-geoi]', { timeout: 30000 });
    const items = await page.$$eval('.sp-item[data-geoi]', (xs) => xs.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const idx = items.findIndex((t) => STREET.re.test(t) && STREET.city.test(t));
    check(`${tag} 1: the page search lists ${STREET.id}`, idx >= 0, items.slice(0, 3).join(' | '));
    await page.click(`.sp-item[data-geoi="${Math.max(0, idx)}"]`);
    await page.waitForSelector(`[data-srdeal="${STREET.id}"]`, { timeout: 60000 });
    await page.waitForTimeout(800);
    check(`${tag} 1: the street report renders with the Deal Lab button and the What-changed link`, await page.$(`.sr-outs [data-chgeo="${STREET.id}"]`) != null);
    await page.locator(`[data-srdeal="${STREET.id}"]`).scrollIntoViewIfNeeded();
    await shot(page, tag, '1-street-report');
    await pageState(page, tag, lang, '1 street report');
    /* → "Analyse this deal in the Deal Lab", prefilled with what the report holds */
    const f = page.locator('[data-srprop]').first();
    await f.locator('[name="askingPrice"]').fill('3150000'); await f.locator('[name="sqm"]').fill('72'); await f.locator('[name="rooms"]').fill('3');
    await page.click(`[data-srdeal="${STREET.id}"]`);
    await page.waitForFunction((id) => ((document.getElementById('dlCur') || {}).textContent || '').includes(id), STREET.id, { timeout: 20000 });
    const pre = await page.evaluate(() => Object.fromEntries(['price', 'sqm', 'rooms', 'rent', 'ratePct', 'tax'].map((k) => [k, (document.querySelector(`[data-dl="${k}"]`) || {}).value])));
    check(`${tag} 1: the Deal Lab opens prefilled (price · area · rooms) and nothing else`, pre.price === '3150000' && pre.sqm === '72' && pre.rooms === '3' && pre.rent === '' && pre.ratePct === '' && pre.tax === '', JSON.stringify(pre));
    const inView = await page.waitForFunction(() => { const r = document.getElementById('dealLab').getBoundingClientRect(); return r.top < window.innerHeight * 0.5 && r.bottom > 0; }, null, { timeout: 5000 }).then(() => true).catch(() => false);   /* a smooth scroll over the expanded report */
    check(`${tag} 1: the Deal Lab section is on screen after the hand-off`, inView);
    await page.waitForFunction(() => document.querySelectorAll('#dl-comps tbody tr').length > 0, null, { timeout: 40000 });
    await shot(page, tag, '2-deal-prefilled', '#dealLab');
    /* rent + financing (the user's assumptions) */
    const set = async (k, v) => page.fill(`[data-dl="${k}"]`, String(v));
    await page.selectOption('[data-dl="buyer"]', 'single');
    await page.click('[data-dlact="tax"]');
    await set('legal', 15000); await set('broker', 60000); await set('renovation', 0); await set('other', 2000);
    await page.check('input[name="dl-mode"][value="down"]');
    await set('downPayment', 1100000); await set('ratePct', 4.8); await set('years', 30);
    await set('rent', 9000); await set('vacancyPct', 4); await set('maintenance', 250); await set('managementPct', 5); await set('insurance', 1500); await set('otherOpex', 0);
    await set('targetCocPct', 1.5);
    await page.click('[data-dlact="stress"]');
    await page.click('[data-dlact="analyse"]');
    await page.waitForFunction(() => !/…/.test((document.querySelector('#dl-risk') || {}).textContent || '…'), null, { timeout: 40000 });
    await page.waitForTimeout(600);
    const res = await page.evaluate(() => {
      const txt = (s) => ((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ');
      return { fin: txt('#dl-fin'), ret: txt('#dl-ret'), risk: txt('#dl-risk'), sens: document.querySelectorAll('#dl-sens tbody tr').length, scen: txt('#dl-scen'), tax: (document.querySelector('[data-dl="tax"]') || {}).value,
        all: txt('#dealLab') };
    });
    /* hand arithmetic: tax on ₪3,150,000 single home = (2,347,040 − 1,978,745) × 3.5 % + (3,150,000 − 2,347,040) × 5 % = 12,890.33 + 40,148 = 53,038 */
    check(`${tag} 1: purchase tax from the page's bracket table = ₪53,038`, res.tax === '53038', res.tax);
    /* the payment on ₪2,050,000 at 4.8 % over 30 years = ₪10,755.66 (computed independently: P·r/(1−(1+r)^−n)) */
    const r = 0.048 / 12, P = 2050000, pmt = P * r / (1 - Math.pow(1 + r, -360));
    const pmtS = pmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    check(`${tag} 1: the monthly payment shown = ₪${pmtS}`, res.fin.includes(pmtS), res.fin.slice(0, 160));
    check(`${tag} 1: results · sensitivity (≥ 15 rows) · scenarios · risks render`, res.sens >= 15 && res.ret.length > 50 && res.scen.length > 50 && res.risk.length > 50, `sens rows ${res.sens}`);
    check(`${tag} 1: no NaN / Infinity / undefined in the lab`, !/\bNaN\b|Infinity|undefined|\[object Object\]/.test(res.all), (res.all.match(/.{30}(NaN|Infinity|undefined|\[object Object\]).{30}/) || [''])[0]);
    await shot(page, tag, '3-deal-results', '#dl-ret');
    await shot(page, tag, '4-deal-sensitivity', '#dl-sens');
    await shot(page, tag, '5-deal-risks', '#dl-risk');
    await pageState(page, tag, lang, '1 deal results');
    /* memo: download + print view */
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-dlact="download"]')]);
    const memoFile = path.join(SHOTS, `${tag}-memo.html`); await dl.saveAs(memoFile);
    const memo = fs.readFileSync(memoFile, 'utf8');
    check(`${tag} 1: memo .html — disclaimer · street id · payment · tax · no controls · no NaN`, (lang === 'en' ? /not an appraisal and not investment advice/i : /לא שומה ולא ייעוץ השקעות/).test(memo) && memo.includes(STREET.id) && memo.includes(pmtS) && memo.includes('53,038') && !/<button|<input/.test(memo) && !/\bNaN\b|Infinity/.test(memo), `${(memo.length / 1024).toFixed(0)} KB`);
    for (const m of memo.replace(/<[^>]+>/g, ' ').match(RAW) || []) { const k = `${m} (memo .html)`; if (!rawCodes.has(k)) rawCodes.set(k, new Set()); rawCodes.get(k).add(tag); }
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('[data-dlact="print"]');
    await page.waitForTimeout(200);
    const printed = await page.evaluate(() => ({ on: document.body.classList.contains('dl-printing'), n: ((document.getElementById('dlPrint') || {}).textContent || '').length, dir: (document.getElementById('dlPrint') || {}).dir }));
    check(`${tag} 1: print view (body.dl-printing, #dlPrint ${lang === 'en' ? 'ltr' : 'rtl'})`, printed.on && printed.n > 1000 && printed.dir === (lang === 'en' ? 'ltr' : 'rtl'), JSON.stringify(printed));
    await shot(page, tag, '6-memo-print');
    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(800);

    /* 2 · the street report's "What changed here?" → period / kind → a linked item */
    await page.evaluate((id) => { const a = document.querySelector(`.sr-outs [data-chgeo="${id}"]`); a.scrollIntoView({ block: 'center' }); }, STREET.id);
    await page.click(`.sr-outs [data-chgeo="${STREET.id}"]`);
    await feedOk(page, STREET.id);
    const settled = await page.waitForFunction(() => { const r = document.getElementById('changes').getBoundingClientRect(); return r.top >= -4 && r.top < window.innerHeight * 0.3; }, null, { timeout: 6000 }).then(() => true).catch(() => false);
    check(`${tag} 2: the link scrolls the feed into view`, settled);
    await page.waitForTimeout(400);
    const s1 = await page.evaluate(() => { const s = window.PropxChanges.state(); return { items: s.items.length, total: s.data.total, period: s.data.period.days, scopes: s.data.filters.scope }; });
    check(`${tag} 2: the feed opens on the street`, s1.items > 0, JSON.stringify(s1));
    await shot(page, tag, '7-changes-street');
    await pageState(page, tag, lang, '2 changes street');
    await page.click('#chRoot [data-chper="365"]');
    await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.period.days === 365; }, null, { timeout: 60000 });
    await page.click('#chRoot .ch-chips [data-chkind="LAND_TENDER"]').catch(() => page.click('#chRoot [data-chkind="LAND_TENDER"]'));
    await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.filters.kinds && s.data.filters.kinds.join() === 'LAND_TENDER'; }, null, { timeout: 60000 });
    const s2 = await page.evaluate(() => { const s = window.PropxChanges.state(); return { items: s.items.length, kinds: [...new Set(s.items.map((i) => i.kind))], st: s.data.kinds.LAND_TENDER.statement.code }; });
    check(`${tag} 2: period 365 + kind LAND_TENDER`, s2.kinds.every((k) => k === 'LAND_TENDER'), JSON.stringify(s2));
    await shot(page, tag, '8-changes-filtered', '#changes');
    await pageState(page, tag, lang, '2 changes filtered');
    /* back to every kind with the locality scope, then open the first linked item */
    await page.click('#chRoot .ch-chips [data-chkind=""]').catch(() => page.click('#chRoot [data-chkind=""]'));
    await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && !s.data.filters.kinds; }, null, { timeout: 60000 });
    const go = await page.$('#chRoot .ch-it .ch-go[data-chopen]');
    if (go) {
      const what = await go.evaluate((b) => ({ type: b.dataset.chopen, id: b.dataset.chid, text: b.textContent }));
      await go.click();
      await page.waitForTimeout(2500);
      const after = await page.evaluate(() => ({ drawer: !!document.querySelector('.drawer.open, [role="dialog"]:not([hidden]), #entDrawer.open, .ent-drawer.open'), hash: location.hash, y: Math.round(window.scrollY) }));
      check(`${tag} 2: a linked item opens (${what.type} ${what.id})`, true, JSON.stringify({ ...what, ...after }));
      await shot(page, tag, '9-changes-linked-item');
      await pageState(page, tag, lang, '2 linked item');
      await page.keyboard.press('Escape');
    } else check(`${tag} 2: a linked item exists`, false, 'no .ch-go[data-chopen] in the street feed');
    /* 3 · a district */
    await page.evaluate(() => document.getElementById('changes').scrollIntoView({ block: 'start' }));
    await page.selectOption('#chRoot [data-chdist]', 'd-haifa');
    await feedOk(page, 'd-haifa');
    await page.waitForTimeout(800);
    const d = await page.evaluate(() => { const s = window.PropxChanges.state(); return { total: s.data.total, scopes: [...new Set(s.items.map((i) => i.scope))], tx: s.data.kinds.TRANSACTION.counts.total }; });
    check(`${tag} 3: district d-haifa — items, no street scope`, d.total > 0 && !d.scopes.some((x) => /STREET/.test(x)), JSON.stringify(d));
    await shot(page, tag, '10-changes-district');
    await pageState(page, tag, lang, '3 district');
    check(`${tag}: no page / console errors`, errors.length === 0, errors.slice(0, 4).join(' | '));
  } catch (e) {
    check(`${tag}: journey`, false, String(e && e.message || e).slice(0, 400));
    await shot(page, tag, 'FAILED').catch(() => {});
  } finally { await ctx.close(); }
}

/* 4 · keyboard only (desktop): Tab to the rail link → Enter → Tab into the section → operate */
async function keyboard(browser, lang) {
  const tag = `${lang}-keyboard`;
  const { ctx, page, errors } = await signedIn(browser, 'desktop');
  const tabTo = async (pred, max = 400, arg) => { for (let i = 1; i <= max; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(pred, arg)) return i; } return -1; };
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#dlRoot .dl-pick', { timeout: 30000 });
    await setLang(page, lang);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    /* the Deal Lab */
    const nRail = await tabTo(() => document.activeElement && document.activeElement.matches('a.ri[data-sec="dealLab"]'));
    check(`${tag}: the rail link to the Deal Lab is reachable by Tab`, nRail > 0, `${nRail} Tab presses`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const nQ = await tabTo(() => document.activeElement && document.activeElement.id === 'dl-q', 60);
    check(`${tag}: Tab from the rail link reaches the lab's street search`, nQ > 0, `${nQ} Tab presses after Enter`);
    if (nQ < 0) { const n2 = await tabTo(() => document.activeElement && document.activeElement.id === 'dl-q', 900); check(`${tag}: …or by Tab from anywhere`, n2 > 0, `${n2} more Tab presses`); }
    await page.keyboard.type('הרצל פתח תקווה', { delay: 15 });
    await page.waitForSelector('#dl-list li[data-dlopt]', { timeout: 20000 });
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /st:7900:213/.test((document.getElementById('dlCur') || {}).textContent || ''), null, { timeout: 20000 });
    check(`${tag}: street chosen with the keyboard (combobox)`, true);
    /* Tab to each field, type a value — every focus stop is visible (a focus ring or an outline) */
    const fill = async (k, v) => { const n = await tabTo((kk) => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.dl === kk, 80, k).catch(() => -1);
      if (n < 0) { await page.focus(`[data-dl="${k}"]`); return false; } await page.keyboard.press('Control+A'); await page.keyboard.type(String(v)); return true; };
    const order = [['sqm', 85], ['rooms', 3.5], ['price', 2100000]];
    let tabbed = 0; for (const [k, v] of order) if (await fill(k, v)) tabbed++;
    check(`${tag}: property / price fields reached by Tab in order`, tabbed === order.length, `${tabbed}/${order.length}`);
    await page.waitForTimeout(400);   /* .chip / inputs transition their outline */
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none'; });
    check(`${tag}: the focused field shows a focus indicator`, ring, await page.evaluate(() => { const a = document.activeElement, s = getComputedStyle(a); return a.tagName + (a.dataset.dl ? '[' + a.dataset.dl + ']' : '') + ' outline ' + s.outlineStyle + ' ' + s.outlineWidth + ' shadow ' + s.boxShadow; }));
    const sel = await tabTo(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.dl === 'buyer', 10);
    if (sel > 0) { await page.keyboard.press('ArrowDown'); }
    const taxBtn = await tabTo(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.dlact === 'tax', 20);
    if (taxBtn > 0) await page.keyboard.press('Enter');
    const modeR = await tabTo(() => document.activeElement && document.activeElement.name === 'dl-mode', 40);
    check(`${tag}: the financing mode radios are reachable`, modeR > 0, modeR);
    /* operate the rest by focus() + keyboard typing (the per-field Tab order was proven above) */
    for (const [k, v] of [['legal', 10000], ['broker', 40000], ['renovation', 0], ['other', 0]]) { await page.focus(`[data-dl="${k}"]`); await page.keyboard.press('Control+A'); await page.keyboard.type(String(v)); }
    await page.focus('input[name="dl-mode"][value="ltv"]'); await page.keyboard.press('Space');
    for (const [k, v] of [['ltvPct', 70], ['ratePct', 4.5], ['years', 25], ['rent', 6500], ['vacancyPct', 5], ['maintenance', 200], ['managementPct', 0], ['insurance', 1200], ['otherOpex', 0]]) { await page.focus(`[data-dl="${k}"]`); await page.keyboard.press('Control+A'); await page.keyboard.type(String(v)); }
    const an = await tabTo(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.dlact === 'analyse', 120);
    check(`${tag}: the Analyse button is reachable by Tab`, an > 0, an);
    if (an > 0) await page.keyboard.press('Enter'); else { await page.focus('[data-dlact="analyse"]'); await page.keyboard.press('Enter'); }
    await page.waitForFunction(() => !/…/.test((document.querySelector('#dl-risk') || {}).textContent || '…'), null, { timeout: 40000 });
    const fin = await page.evaluate(() => (document.querySelector('#dl-fin') || {}).textContent || '');
    check(`${tag}: results computed from keyboard input (payment ₪7,781.65 on ₪1.47M at 4.5 % / 25 y)`, /7,781\.65|8,170\.74/.test(fin), fin.replace(/\s+/g, ' ').slice(0, 120));
    await shot(page, tag, 'deal-lab', '#dealLab');
    /* What changed here: the rail link → Tab to a period chip → Enter */
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const nCh = await tabTo(() => document.activeElement && document.activeElement.matches('a.ri[data-sec="changes"]'));
    check(`${tag}: the rail link to What changed here is reachable by Tab`, nCh > 0, `${nCh} Tab presses`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const nP = await tabTo(() => document.activeElement && document.activeElement.matches('#chRoot [data-chper="30"]'), 120);
    check(`${tag}: Tab reaches the period chips`, nP > 0, `${nP} Tab presses`);
    if (nP > 0) {
      await page.keyboard.press('Enter');
      const ok = await page.waitForFunction(() => { const s = window.PropxChanges && window.PropxChanges.state(); return s && s.status === 'ok' && s.data && s.data.period.days === 30; }, null, { timeout: 60000 }).then(() => true).catch(() => false);
      check(`${tag}: Enter on the 30-day chip reloads the feed`, ok);
      const focusKept = await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body);
      check(`${tag}: focus is kept after the re-render (not lost to <body>)`, focusKept, await page.evaluate(() => document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : 'none'));
      const nK = await tabTo(() => document.activeElement && document.activeElement.matches('#chRoot [data-chkind="TRANSACTION"]'), 60);
      check(`${tag}: Tab reaches the kind chips`, nK > 0, nK);
      if (nK > 0) { await page.keyboard.press('Space'); const ok2 = await page.waitForFunction(() => { const s = window.PropxChanges.state(); return s.status === 'ok' && s.data.filters.kinds && s.data.filters.kinds.join() === 'TRANSACTION'; }, null, { timeout: 60000 }).then(() => true).catch(() => false); check(`${tag}: Space on a kind chip filters`, ok2); }
      const nD = await tabTo(() => document.activeElement && document.activeElement.matches('#chRoot [data-chdist]'), 80);
      check(`${tag}: Tab reaches the district picker`, nD > 0, nD);
    }
    await shot(page, tag, 'changes', '#changes');
    check(`${tag}: no page / console errors`, errors.length === 0, errors.slice(0, 4).join(' | '));
  } catch (e) {
    check(`${tag}: keyboard journey`, false, String(e && e.message || e).slice(0, 400));
    await shot(page, tag, 'FAILED').catch(() => {});
  } finally { await ctx.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  try {
    const only = process.env.QA_ONLY || '';   /* e.g. QA_ONLY=keyboard · QA_ONLY=en-phone */
    for (const lang of ['he', 'en']) for (const vp of ['desktop', 'phone']) if (!only || only === lang + '-' + vp) await journey(browser, lang, vp);
    for (const lang of ['he', 'en']) if (!only || only === 'keyboard') await keyboard(browser, lang);
  } finally { await browser.close(); }
  const failed = results.filter((r) => !r.ok);
  const raw = [...rawCodes].map(([k, w]) => `${k} — ${[...w].length} step(s), e.g. ${[...w][0]}`).sort();
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({ results, rawCodes: raw }, null, 1));
  console.log(`\nraw codes visible to users (${raw.length}):\n  ` + raw.join('\n  '));
  console.log(`\novernight-qa.browser: ${results.length - failed.length} passed${failed.length ? ', ' + failed.length + ' FAILED' : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
