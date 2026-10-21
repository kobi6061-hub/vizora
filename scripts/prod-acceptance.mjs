// PROPX · Production acceptance (read-only) — Enterprise pilot, 21.10.2026.
//
// Signs in to each Production domain with the shared site password (runner secret PROPX_SITE_PASSWORD — never printed,
// never written) and checks, with live evidence only, the 14 acceptance items:
//   1 login + session · 2 street search incl. partial Hebrew · 3 picking a street opens its report · 4 latest transactions +
//   freshness · 5 historical tables · 6 Street Investment Intelligence · 7 valuations + comparison · 8 planning / infrastructure /
//   risk · 9 the investor-priority home + navigation · 10 desktop + phone · 11 Hebrew RTL + English LTR · 12 sources + data
//   availability · 13 API protection · 14 logout + session expiry.
// API checks use fetch (redirects not followed); UI checks use a real Chromium (Playwright). Output = status lines and counts /
// dates only: no cookie, no password, no screenshot, no price (the repository is public, and so are its run logs).
// env: HOSTS="propx=https://propx.live,kobix=https://kobix.online" · SITE_PW · OUT (JSON summary path, optional)
// Exit 0 = every check passed · 1 = a check failed · 2 = not signed in (no secret / refused).

import fs from 'node:fs';
import crypto from 'node:crypto';

const HOSTS = (process.env.HOSTS || 'propx=https://propx.live,kobix=https://kobix.online').split(',').map((x) => x.trim()).filter(Boolean)
  .map((x) => { const i = x.indexOf('='); return { name: x.slice(0, i), base: x.slice(i + 1).replace(/\/$/, '') }; });
const PW = process.env.SITE_PW || '';
const STREET = 'st:7900:213';   // הרצל, פתח תקווה — observed market, model, plans, transport, registers
const results = [];
let failed = 0, passed = 0;

function rec(host, item, name, ok, evidence) {
  results.push({ host, item, name, ok, evidence });
  if (ok === true) passed++; else if (ok === false) failed++;
  console.log(`${host.padEnd(6)} [${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO'}] ${String(item).padStart(2)} · ${name} — ${evidence}`);
}
async function req(base, path, { method = 'GET', cookie, body, accept = 'application/json' } = {}) {
  const t0 = Date.now();
  try {
    const headers = { accept };
    if (cookie) headers.cookie = cookie;
    if (body) headers['content-type'] = 'application/json';
    const r = await fetch(base + path, { method, redirect: 'manual', headers, body, signal: AbortSignal.timeout(60000) });
    const text = await r.text().catch(() => '');
    let json = null; if (/json/.test(r.headers.get('content-type') || '')) try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, type: r.headers.get('content-type') || '', location: r.headers.get('location') || '', vercel: (r.headers.get('x-vercel-id') || '').split('::')[0],
      setCookie: r.headers.getSetCookie ? r.headers.getSetCookie() : [], text, json, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, error: e.name, ms: Date.now() - t0 }; }
}
const cookieAttrs = (c) => c.split(';').slice(1).map((x) => x.trim().split('=')[0]).join(' · ');   // attribute NAMES only, never the value
const toLogin = (r) => (r.status === 302 || r.status === 307) && /\/login\.html/.test(r.location);

async function apiChecks(H) {
  const n = H.name, b = H.base;
  /* 1 · login + session */
  const bad = await req(b, '/api/login', { method: 'POST', body: JSON.stringify({ password: 'wrong-' + crypto.randomBytes(9).toString('hex') }) });
  rec(n, 1, 'a wrong password is refused', bad.status === 401 && !bad.setCookie.some((c) => /kobix_session=[^;]/.test(c)), `HTTP ${bad.status}, no session cookie`);
  const ok = await req(b, '/api/login', { method: 'POST', body: JSON.stringify({ password: PW }) });
  const sc = ok.setCookie.find((c) => c.startsWith('kobix_session=')) || '';
  const cookie = sc ? sc.split(';')[0] : '';
  rec(n, 1, 'the shared password signs in', ok.status === 200 && !!cookie && /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Lax/i.test(sc),
    `HTTP ${ok.status} · cookie attributes ${sc ? cookieAttrs(sc) : '(none)'} · edge ${ok.vercel}`);
  if (!cookie) return null;
  const home = await req(b, '/', { cookie, accept: 'text/html' });
  rec(n, 1, 'the signed-in session opens the page', home.status === 200 && /text\/html/.test(home.type), `GET / → ${home.status} ${home.type.split(';')[0]} · ${Math.round(home.text.length / 1024)} KB`);
  const mode = await req(b, '/api/login?op=mode');
  rec(n, 13, 'the gate is the shared password (identity off)', mode.json && mode.json.mode === 'perimeter', `GET /api/login?op=mode → ${mode.status} ${mode.json ? JSON.stringify(mode.json) : ''}`);

  /* 2 · street search (partial Hebrew included) */
  const Q = [['הרב מש', null, (s) => s.length >= 5], ['הרב משה', '7900', (s) => s.some((m) => m.city === 'פתח תקווה')], ['אויערבך', null, (s) => s.some((m) => m.id === 'st:7900:595')],
    ['הרצל פתח תקווה', null, (s) => s[0] && s[0].id === STREET], ['קקקקקקק', null, (s) => s.length === 0]];
  for (const [q, near, test] of Q) {
    const r = await req(b, '/api/geo/search?limit=12&q=' + encodeURIComponent(q) + (near ? '&near=' + near : ''), { cookie });
    const st = r.json && Array.isArray(r.json.matches) ? r.json.matches.filter((m) => m.kind === 'street') : null;
    rec(n, 2, `search "${q}"${near ? ' near ' + near : ''}`, r.status === 200 && !!st && test(st), `HTTP ${r.status} · ${st ? st.length + ' streets · first ' + (st[0] ? st[0].he + ' · ' + st[0].city : '—') : r.error || 'no JSON'} · ${r.ms} ms`);
  }

  /* 3 · the street report (core first, then the full report) */
  const core = await req(b, '/api/intel?view=streetReport&part=core&id=' + STREET, { cookie });
  rec(n, 3, 'street report (core) for הרצל, פתח תקווה', core.status === 200 && core.json && core.json.id === STREET && core.json.part === 'core', `HTTP ${core.status} · ${core.ms} ms`);
  const R = await req(b, '/api/intel?view=streetReport&id=' + STREET, { cookie });
  const J = R.json || {};
  rec(n, 3, 'street report (full)', R.status === 200 && J.part === 'full', `HTTP ${R.status} · ${R.ms} ms · sections ${Object.keys(J).filter((k) => ['overview', 'transactions', 'comparison', 'planning', 'transport', 'surroundings', 'assessment', 'sources', 'missing'].includes(k)).length}/9`);

  /* 4 · latest transactions + freshness */
  const L = await req(b, '/api/intel?view=txLatest&months=12', { cookie });
  const rcy = L.json && L.json.recency;
  rec(n, 4, 'latest known transaction (Israel, every source)', L.status === 200 && !!(rcy && rcy.latestKnownEvent && rcy.latestKnownEvent.date),
    rcy ? `latest ${rcy.latestKnownEvent.date} (${rcy.latestKnownEvent.sourceId}) · evidence checked through ${rcy.evidenceCheckedThrough} · freshest snapshot ${rcy.freshestSourceSnapshot && rcy.freshestSourceSnapshot.date}` : `HTTP ${L.status}`);
  const F = await req(b, '/api/intel?view=txFreshness', { cookie });
  const f = F.json && F.json.freshness;
  const ageDays = f && f.snapshotDate ? Math.round((Date.now() - Date.parse(f.snapshotDate)) / 864e5) : null;
  rec(n, 4, 'register copy freshness is stated', F.status === 200 && !!(f && f.snapshotDate && f.latestTransactionDate && f.checkedAt),
    f ? `register copy ${f.snapshotDate} (${ageDays} days old) · latest deal ${f.latestTransactionDate} · source checked ${String(f.checkedAt).slice(0, 10)} · publication date ${f.publicationDate || 'not stated by the source'}` : `HTTP ${F.status}`);
  const E = await req(b, '/api/intel?view=txEvents&code=7900&days=90', { cookie });
  rec(n, 4, 'Petah Tikva, last 90 days (newest first)', E.status === 200 && E.json && Array.isArray(E.json.events) && E.json.events.length > 0,
    E.json && E.json.events ? `${E.json.events.length} events shown of ${E.json.total} · newest ${E.json.events[0] && E.json.events[0].date}` : `HTTP ${E.status}`);

  /* 5 · historical transaction tables */
  const T = await req(b, '/api/intel?view=streetTx&id=' + STREET + '&per=all&limit=5', { cookie });
  const Tj = T.json || {};
  rec(n, 5, 'the street\'s full transaction table (all periods)', T.status === 200 && Tj.total > 0 && Array.isArray(Tj.rows) && Tj.rows.length > 0,
    `HTTP ${T.status} · ${Tj.total} rows · ${Tj.historyRows} older than the 36-month window · newest ${Tj.rows && Tj.rows[0] && Tj.rows[0].date} · window from ${Tj.window && Tj.window.from}`);
  const C = await req(b, '/api/intel?view=streetTx&id=' + STREET + '&per=all&limit=50&format=csv', { cookie });
  rec(n, 5, 'the table exports as CSV', C.status === 200 && /text\/csv/.test(C.type), `HTTP ${C.status} · ${C.type.split(';')[0]} · ${C.text.split('\n').length - 1} lines`);

  /* 6 · Street Investment Intelligence */
  const A = J.assessment || {};
  rec(n, 6, 'investment assessment (rules, no score)', ['supports', 'against', 'couldChange', 'dueDiligence'].every((k) => Array.isArray(A[k])) && A.supports.length + A.against.length > 0,
    `supports ${(A.supports || []).length} · against ${(A.against || []).length} · could change ${(A.couldChange || []).length} · due diligence ${(A.dueDiligence || []).length}`);
  rec(n, 6, 'narrative + evidence latest deal', !!(J.overview && Array.isArray(J.overview.narrative) && J.overview.narrative.length && J.overview.latest),
    `${J.overview && J.overview.narrative ? J.overview.narrative.length : 0} narrative sentences · latest deal ${J.overview && J.overview.latest && J.overview.latest.date}`);

  /* 7 · valuations + comparison */
  const cmp = (J.comparison && J.comparison.rows) || [];
  rec(n, 7, 'fair comparison on the same population', cmp.some((r) => r.level === 'STREET') && cmp.some((r) => r.level === 'CITY'), `levels ${cmp.map((r) => r.level + (r.state ? ' ' + r.state : '')).join(' · ')}`);
  const M = await req(b, '/api/intel?view=streetModel&id=' + STREET, { cookie });
  rec(n, 7, 'Street Value Model (MODEL)', M.status === 200 && M.json && M.json.available === true && !!M.json.range, M.json ? `available · tier ${M.json.tier} · validation range present · ${Array.isArray(M.json.comparables) ? M.json.comparables.length + ' comparables' : M.json.comparables && Array.isArray(M.json.comparables.rows) ? M.json.comparables.rows.length + ' comparables' : 'comparables listed in the report'}` : `HTTP ${M.status}`);
  const P = await req(b, '/api/intel?view=streetProperty&id=' + STREET + '&askingPrice=2200000&sqm=90&rooms=4', { cookie });
  rec(n, 7, 'property test against the model and the street', !!(P.status === 200 && P.json && P.json.available === true && P.json.model && P.json.street),
    P.json ? `available · vs model ${P.json.model && P.json.model.askVsModelPct != null ? 'computed' : '—'} · vs street ${P.json.street && P.json.street.state}` : `HTTP ${P.status}`);

  /* 8 · planning, infrastructure, risk */
  const PL = J.planning || {}, TR = J.transport || {}, SU = J.surroundings || {};
  rec(n, 8, 'plans on / near the street', PL.available === true && !!PL.summary, PL.summary ? `on the street ${PL.summary.intersects} · within 300 m ${PL.summary.nearby} · rail transit ${PL.summary.transit} (nearest ${PL.summary.transitNearestM} m) · VATMAL ${PL.vatmal && PL.vatmal.available ? 'read' : '—'}` : 'not available');
  rec(n, 8, 'public-transport access', TR.available === true, TR.available ? `bus stops ${TR.busStops && TR.busStops.count} · light-rail stations ${TR.lrt && TR.lrt.stations ? TR.lrt.stations.length : 0}` : (TR.reason || 'not available'));
  rec(n, 8, 'surroundings registers (risk)', SU.available === true, SU.available ? `contaminated on the street's parcels ${SU.contaminated ? SU.contaminated.exact.length : '—'} · within 300 m ${SU.contaminated ? SU.contaminated.nearby.length : '—'} · schools within 500 m ${SU.education ? SU.education.institutions.length : '—'}` : (SU.reason || 'not available'));

  /* 12 · sources + data availability */
  rec(n, 12, 'the report names its sources and what is missing', Array.isArray(J.sources) && J.sources.length > 0 && Array.isArray(J.missing), `${(J.sources || []).length} sources · ${(J.missing || []).length} missing items stated`);
  const S = await req(b, '/api/intel?view=sources', { cookie });
  rec(n, 12, 'Trust Center catalogue', S.status === 200 && S.json && Array.isArray(S.json.sources) && S.json.sources.length > 0,
    S.json ? `${S.json.sources.length} sources · ${Object.entries(S.json.counts || {}).map(([k, v]) => k + ' ' + v).join(' · ')} · ${(S.json.alerts || []).length} alerts` : `HTTP ${S.status}`);
  const K = await req(b, '/api/intel?view=txCompleteness', { cookie });
  const ks = K.json && K.json.completeness && K.json.completeness.sources;
  rec(n, 12, 'transaction completeness monitor', K.status === 200 && !!ks, ks ? `${ks.monitored} sources monitored · ${ks.healthy} healthy · ${ks.stale} stale · ${ks.notRead} not read` : `HTTP ${K.status}`);

  /* 13 · API protection (no cookie, forged cookie, expired-looking cookie) */
  const paths = ['/', '/api/intel?view=status', '/api/intel?view=streetReport&part=core&id=' + STREET, '/api/geo/search?q=x', '/api/gov/transactions?settlement=5000',
    '/api/land?view=summary', '/api/housing?view=status', '/api/identity?op=status', '/altaris', '/data/market/latest.json', '/data/txevents/latest.json', '/api/login-x', '/login.html.bak'];
  for (const [label, ck] of [['no cookie', ''], ['forged cookie', 'kobix_session=' + (Date.now() + 864e5) + '.' + crypto.randomBytes(32).toString('hex')], ['expired cookie', 'kobix_session=' + (Date.now() - 864e5) + '.' + crypto.randomBytes(32).toString('hex')]]) {
    let held = 0; const leaks = [];
    for (const p of paths) { const r = await req(b, p, { cookie: ck || undefined }); if (toLogin(r)) held++; else leaks.push(`${p} → ${r.status}`); }
    rec(n, 13, `every page / API / data path is held (${label})`, leaks.length === 0, `${held}/${paths.length} → 302 /login.html${leaks.length ? ' · LEAK ' + leaks.join(', ') : ''}`);
  }
  const pub = await req(b, '/login.html', { accept: 'text/html' });
  rec(n, 13, 'the sign-in page itself is public', pub.status === 200, `GET /login.html → ${pub.status}`);

  /* 14 · logout + expiry */
  const out = await req(b, '/api/logout', { cookie, accept: 'text/html' });
  const cleared = out.setCookie.some((c) => /^kobix_session=;/.test(c) && /Max-Age=0/i.test(c));
  rec(n, 14, 'logout clears the session cookie and returns to sign-in', toLogin(out) && cleared, `GET /api/logout → ${out.status} → ${out.location} · session cookie cleared ${cleared}`);
  const after = await req(b, '/api/intel?view=status');
  rec(n, 14, 'after logout the browser is signed out', toLogin(after), `GET /api/intel without the cleared cookie → ${after.status} → ${after.location}`);
  const replay = await req(b, '/api/intel?view=status', { cookie });
  rec(n, 14, 'a COPY of the old cookie, replayed after logout', null, `→ ${replay.status} (shared-password mode: the cookie is stateless and valid until its 12-hour expiry; individual accounts in Stage 2 end the session on the server)`);
  return cookie;
}

async function uiChecks(H, chromium) {
  const n = H.name;
  const browser = await chromium.launch();
  const LAYOUTS = [['desktop', 'he', 1440, 900], ['desktop', 'en', 1440, 900], ['phone', 'he', 390, 844], ['phone', 'en', 390, 844]];
  for (const [form, lang, w, h] of LAYOUTS) {
    const tag = `${form} ${lang}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: form === 'phone', hasTouch: form === 'phone', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    try {
      /* 1 · the sign-in form, as a person uses it */
      await page.goto(H.base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      const atLogin = /\/login\.html/.test(page.url());
      await page.waitForSelector('#pw', { state: 'visible', timeout: 30000 });
      await page.fill('#pw', PW);
      await Promise.all([page.waitForURL((u) => !/login\.html/.test(String(u)), { timeout: 60000 }), page.click('#go')]);
      await page.waitForSelector('#launchpad', { timeout: 60000 });
      rec(n, 1, `${tag}: sign-in form → the page`, atLogin, `unsigned visit landed on /login.html ${atLogin} · signed in to ${new URL(page.url()).pathname}`);
      if (lang === 'en') { await page.click('#langEn'); await page.waitForTimeout(600); }
      /* 11 · direction */
      const dir = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang }));
      rec(n, 11, `${tag}: document direction`, dir.dir === (lang === 'he' ? 'rtl' : 'ltr'), `dir=${dir.dir} lang=${dir.lang}`);
      /* 9 · home + navigation */
      const L = await page.evaluate(() => ({ lp: [...document.querySelectorAll('#launchpad [data-lp]')].map((a) => a.dataset.lp),
        grp: [...document.querySelectorAll('main > .secgrp')].map((g) => g.id), rail: document.querySelectorAll('.rail .ri[data-sec]').length,
        overflow: document.documentElement.scrollWidth > innerWidth + 1, lpText: (document.querySelector('#launchpad') || {}).innerText || '' }));
      rec(n, 9, `${tag}: launchpad + groups`, L.lp.join(',') === 'dossier,txSection,prices,land,pulse,sources' && L.grp.join(',') === 'grp1,grp2,grp3,grp4',
        `launchpad ${L.lp.length} tiles · groups ${L.grp.join(' ')} · rail ${L.rail} items`);
      rec(n, 10, `${tag}: no horizontal overflow on the home`, !L.overflow, `scrollWidth ${L.overflow ? '>' : '≤'} viewport ${w}px`);
      await page.click('#launchpad [data-lp="txSection"]'); await page.waitForTimeout(1500);
      const txTop = await page.evaluate(() => Math.round(document.getElementById('txSection').getBoundingClientRect().top));
      rec(n, 9, `${tag}: launchpad → latest transactions`, txTop >= 0 && txTop < h / 2, `section top at ${txTop}px`);
      /* 4 · the transactions section on the page */
      await page.waitForFunction(() => document.querySelectorAll('#txTbl tbody tr, #txCards > *').length > 0, null, { timeout: 90000 }).catch(() => null);
      const TX = await page.evaluate(() => ({ rows: document.querySelectorAll('#txTbl tbody tr').length, cards: document.querySelectorAll('#txCards > *').length, fresh: ((document.getElementById('txFresh') || {}).innerText || '').replace(/\s+/g, ' ').trim() }));
      rec(n, 4, `${tag}: transactions section`, TX.rows + TX.cards > 0 && TX.fresh.length > 20, `${TX.rows} table rows · ${TX.cards} cards · freshness line ${TX.fresh.length ? 'shown (' + TX.fresh.slice(0, 70) + '…)' : 'missing'}`);
      /* 2 + 3 · type a partial name, pick the street from the list, open its report */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.fill('#searchInput', 'הרב מש');
      await page.waitForFunction(() => document.querySelectorAll('#searchPop [data-geoi]').length > 0, null, { timeout: 30000 }).catch(() => null);
      const partial = await page.evaluate(() => document.querySelectorAll('#searchPop [data-geoi]').length);
      rec(n, 2, `${tag}: typing "הרב מש" lists streets`, partial > 0, `${partial} street options`);
      await page.fill('#searchInput', 'הרצל פתח תקווה');
      await page.waitForFunction(() => [...document.querySelectorAll('#searchPop [data-geoi]')].some((b) => /הרצל/.test(b.innerText) && /פתח תקווה/.test(b.innerText)), null, { timeout: 30000 });
      await page.locator('#searchPop [data-geoi]', { hasText: 'פתח תקווה' }).first().click();
      await page.waitForSelector('.sr[data-sr-part="full"]', { timeout: 150000 });
      const SR = await page.evaluate(() => ({ id: document.querySelector('.sr').dataset.sr, secs: [...document.querySelectorAll('.sr > details.sr-sec')].map((d) => d.id.replace('sr-', '')),
        txRows: document.querySelectorAll('#sr-tx tbody tr').length, model: !!document.querySelector('#sr-px .sv-mod'), prop: !!document.querySelector('#sr-px [data-srprop]'),
        plans: document.querySelectorAll('#sr-pl tbody tr').length, risk: /(סביבת הרחוב|Street surroundings)/.test((document.getElementById('sr-risk') || {}).innerText || ''),
        sources: document.querySelectorAll('#sr-src tbody tr').length, evidence: !!document.getElementById('sr-ev'), overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
      rec(n, 3, `${tag}: the picked street opens its full report`, SR.id === 'st:7900:213' && SR.secs.join(',') === 'ov,tx,px,pl,risk,map,src',
        `${SR.id} · sections ${SR.secs.join(' → ')} · full Street Intelligence below ${SR.evidence}`);
      rec(n, 5, `${tag}: report transaction table`, SR.txRows > 0, `${SR.txRows} rows rendered`);
      rec(n, 7, `${tag}: valuation section`, SR.model && SR.prop, `MODEL card ${SR.model} · price test form ${SR.prop}`);
      rec(n, 8, `${tag}: planning + risk sections`, SR.plans > 0 && SR.risk, `${SR.plans} plan / transit rows · surroundings registers ${SR.risk}`);
      rec(n, 12, `${tag}: report sources table`, SR.sources > 0, `${SR.sources} sources listed`);
      rec(n, 10, `${tag}: no horizontal overflow on the report`, !SR.overflow, `scrollWidth ${SR.overflow ? '>' : '≤'} viewport ${w}px`);
      /* 12 · the Trust Center renders */
      if (form === 'desktop') {
        await page.evaluate(() => document.getElementById('sources').scrollIntoView());
        await page.waitForFunction(() => ((document.getElementById('trust') || {}).innerText || '').length > 2000, null, { timeout: 90000 }).catch(() => null);
        const tc = await page.evaluate(() => ((document.getElementById('trust') || {}).innerText || '').length);
        rec(n, 12, `${tag}: Trust Center renders`, tc > 2000, `${tc} characters of source states`);
      }
      /* 14 · the visible logout */
      await page.evaluate(() => window.scrollTo(0, 0));
      await Promise.all([page.waitForURL(/login\.html/, { timeout: 30000 }), page.click('#logoutBtn')]);
      await page.goto(H.base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      rec(n, 14, `${tag}: logout button signs out`, /login\.html/.test(page.url()), `after logout, / → ${new URL(page.url()).pathname}`);
      rec(n, 10, `${tag}: no page errors`, errors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : 'none');
    } catch (e) {
      rec(n, '–', `${tag}: browser run`, false, String(e.message || e).split('\n')[0].slice(0, 200));
    } finally { await ctx.close(); }
  }
  await browser.close();
}

(async () => {
  if (!PW) { console.log('NOT SIGNED IN — the runner secret PROPX_SITE_PASSWORD is not configured; no authenticated check ran.'); process.exit(2); }
  let chromium = null;
  try { ({ chromium } = await import('playwright')); } catch { console.log('playwright not installed — UI checks skipped'); }
  for (const H of HOSTS) {
    console.log(`\n═══ ${H.name} · ${H.base}`);
    const signed = await apiChecks(H);
    if (!signed) { rec(H.name, 1, 'sign-in', false, 'no session — the remaining checks for this domain did not run'); continue; }
    if (chromium) await uiChecks(H, chromium); else rec(H.name, 10, 'browser checks', false, 'Playwright unavailable on the runner');
  }
  const verdict = failed ? `FAILED — ${failed} check(s) failed, ${passed} passed` : `PASSED — ${passed} checks with live evidence`;
  console.log('\n' + verdict);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ at: new Date().toISOString(), verdict, results }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`## Production acceptance · ${verdict}`, '', '| domain | item | check | result | evidence |', '|---|---|---|---|---|',
      ...results.map((r) => `| ${r.host} | ${r.item} | ${r.name.replace(/\|/g, '/')} | ${r.ok === true ? 'PASS' : r.ok === false ? '**FAIL**' : 'info'} | ${String(r.evidence).replace(/\|/g, '/')} |`)];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }
  process.exit(failed ? 1 : 0);
})();
