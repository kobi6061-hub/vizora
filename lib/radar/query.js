// PROPX · Market Radar — the read model: the windowed, filtered event feed and the Market Pulse summary.
//
// Reads data/radar/events.json (written by scripts/radar-build.js at the end of every sync) and, when the file is
// absent (a fresh checkout), builds it in memory from the histories (lib/radar/events.js). Every figure in the pulse
// is read from a file a sync committed and carries its source, class and dates; nothing is computed from a model.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const R = require('./events');

const ROOT = path.join(__dirname, '..', '..', 'data');
const DAY = 86400e3;
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const WINDOWS = Object.freeze({ today: 1, '7d': 7, '30d': 30, '90d': 90, all: 100000 });
const WINDOW_LABEL = { today: { he: 'היום', en: 'today' }, '7d': { he: '7 ימים', en: '7 days' }, '30d': { he: '30 יום', en: '30 days' }, '90d': { he: '90 יום', en: '90 days' }, all: { he: 'הכול', en: 'all' } };
const GROUP_LABEL = { sales: { he: 'מכירות רשמיות', en: 'official sales' }, construction: { he: 'בנייה רשמית (למ״ס)', en: 'official construction (CBS)' }, land: { he: 'קרקע ומכרזים', en: 'land & tenders' }, developers: { he: 'יזמים', en: 'developers' }, planning: { he: 'תכנון והתחדשות', en: 'planning & renewal' }, rental: { he: 'דיור להשכרה', en: 'rental' }, housing: { he: 'דיור מסובסד', en: 'subsidized housing' }, macro: { he: 'מאקרו', en: 'macro' }, sources: { he: 'בריאות מקורות', en: 'source health' } };

let cache = { key: null, payload: null };
function load({ dataDir = ROOT, now = Date.now() } = {}) {
  const f = path.join(dataDir, 'radar', 'events.json');
  let st = null; try { st = fs.statSync(f); } catch { /* absent */ }
  const key = st ? `${f}|${st.mtimeMs}|${st.size}` : `build|${dataDir}`;
  if (cache.key === key && cache.payload) return cache.payload;
  const payload = st ? readJson(f) : null;
  cache = { key, payload: payload && payload.schema === 1 ? { ...payload, served: 'file' } : { ...R.build({ dataDir, now }), served: 'built-on-read' } };
  return cache.payload;
}

const str = (v) => (v == null ? '' : String(v).trim());
const clampInt = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** the feed: window (today | 7d | 30d | 90d | all), group, kind, city (locality code), district, q, m (min materiality), page, size */
const VB = require('./verbs');
function feed(params = {}, opt = {}) {
  const P = load(opt), now = opt.now || Date.now();
  const verb = VB.ORDER.includes(String(params.verb || '').toUpperCase()) ? String(params.verb).toUpperCase() : null;
  const win = WINDOWS[params.window] ? params.window : '7d';
  const since = win === 'today' ? day(new Date(now).toISOString()) : null;
  const sinceT = now - WINDOWS[win] * DAY;
  const group = str(params.group), kind = str(params.kind), city = str(params.city), district = str(params.district), q = str(params.q).toLowerCase(), m = clampInt(params.m, 1, 1, 3);
  /* the window, text and materiality narrow the set; the group and city facets describe each other's choices (one filter at a time) */
  const base = P.events.filter((e) => (since ? day(e.at) === since : Date.parse(e.at) >= sinceT) && (!kind || e.kind === kind) && (!verb || VB.verbOf(e) === verb) && (!district || (e.geo && e.geo.district === district)) && e.m >= m
    && (!q || `${e.title.he} ${e.title.en} ${e.detail.he} ${e.detail.en} ${e.geo && e.geo.city || ''} ${e.entity && e.entity.name || ''}`.toLowerCase().includes(q)));
  const counts = {}; for (const e of base) if (!city || (e.geo && e.geo.localityCode === city)) counts[e.group] = (counts[e.group] || 0) + 1;
  const cities = {}; for (const e of base) if ((!group || e.group === group) && e.geo && e.geo.localityCode) { const c = cities[e.geo.localityCode] || { code: e.geo.localityCode, city: e.geo.city, cityEn: e.geo.cityEn, n: 0 }; c.n++; cities[e.geo.localityCode] = c; }
  let rows = base.filter((e) => (!group || e.group === group) && (!city || (e.geo && e.geo.localityCode === city))).map((e) => ({ ...e, verb: VB.verbOf(e) }));
  /* the verb facet counts over the same set the group facet describes (window · text · materiality · group · city), before the verb narrows it */
  const verbs = {}; for (const e of P.events) if ((since ? day(e.at) === since : Date.parse(e.at) >= sinceT) && (!kind || e.kind === kind) && (!district || (e.geo && e.geo.district === district)) && e.m >= m && (!group || e.group === group) && (!city || (e.geo && e.geo.localityCode === city)) && (!q || `${e.title.he} ${e.title.en} ${e.detail.he} ${e.detail.en} ${e.geo && e.geo.city || ''} ${e.entity && e.entity.name || ''}`.toLowerCase().includes(q))) { const v = VB.verbOf(e); verbs[v] = (verbs[v] || 0) + 1; }
  const size = clampInt(params.size, 40, 1, 200), pages = Math.max(1, Math.ceil(rows.length / size)), page = clampInt(params.page, 1, 1, pages);
  return { basis: BASIS, window: win, windowLabel: WINDOW_LABEL[win], since: since || new Date(sinceT).toISOString(), total: rows.length, counts, groups: GROUP_LABEL, verb, verbs, verbLabels: Object.fromEntries(VB.ORDER.map((k) => [k, VB.VERBS[k].label])), verbOrder: VB.ORDER, verbBasis: VB.BASIS,
    cities: Object.values(cities).sort((a, b) => b.n - a.n).slice(0, 60), page, pages, size, rows: rows.slice((page - 1) * size, page * size),
    rules: R.RULES, builtAt: P.builtAt, served: P.served, eventsSince: P.since };
}
const BASIS = { he: 'אירוע = שינוי שנצפה בין שתי קריאות של PROPX ברשומת מקור, תקופה חדשה שמקור פרסם, תיקון של נתון רשמי, או שינוי במצב הבדיקה של מקור. הקליטה הראשונה של מאגר, קריאת פרטים ראשונה או שדרוג של הניתוח ב-PROPX אינם אירועים. המשמעות (1–3) היא קבוע מתועד לכל כלל — לא מודל.',
  en: 'An event = a change observed between two PROPX reads of a source record, a new period a source published, a revision of an official figure, or a change in a source\'s check state. A dataset\'s first ingestion, a first detail read or a PROPX parser upgrade are not events. Materiality (1–3) is a documented constant per rule — not a model.' };

/** Market Pulse — what changed in the Israeli new-home market: deterministic facts from the committed files, per section */
function pulse(opt = {}) {
  const dataDir = opt.dataDir || ROOT, now = opt.now || Date.now();
  const P = load({ dataDir, now });
  const within = (d) => P.events.filter((e) => Date.parse(e.at) >= now - d * DAY);
  const e7 = within(7), e30 = within(30);
  const n = (list, kind) => list.filter((e) => e.kind === kind).length;
  const top = (list, pred, k = 5) => list.filter(pred).sort((a, b) => b.m - a.m || (b.at < a.at ? -1 : 1)).slice(0, k);
  const S = {};
  /* official sales — CBS series (national + districts), inventory, months of supply */
  const cbs = readJson(path.join(dataDir, 'cbs-sales', 'latest.json'));
  if (cbs && cbs.geos && cbs.geos.il && cbs.geos.il.metrics && cbs.geos.il.metrics.ok) {
    const M = cbs.geos.il.metrics;
    S.sales = { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10', latest: M.latest, latestValue: M.latestValue, t12: M.t12, ytd: M.ytd, prevYtd: M.prevYtd, ytdChange: M.ytdChange, momentum: M.momentum && M.momentum.m3, pace: M.pace, small: !!M.small,
      sourceUpdate: cbs.sourceUpdate, checkedAt: cbs.checkedAt, freshness: cbs.freshness && cbs.freshness.state, revisions: cbs.records ? cbs.records.revisions : null,
      districts: Object.values(cbs.geos).filter((g) => g.level === 'district' && g.metrics && g.metrics.ok).map((g) => ({ key: g.cbs, name: g.name, t12: g.metrics.t12 && g.metrics.t12.value, momentum: g.metrics.momentum && g.metrics.momentum.m3 && g.metrics.momentum.m3.ok ? g.metrics.momentum.m3.pct : null, small: !!g.metrics.small })),
      events: { monthPublished: n(e30, 'cbs-month-published'), revised: n(e30, 'cbs-revised') } };
    if (cbs.inventory && cbs.inventory.latest) S.inventory = { cls: 'OFFICIAL', source: 'cbs:timeseries:44,10', value: cbs.inventory.latest.value, period: cbs.inventory.latest.period, monthsSupply: cbs.monthsSupply && cbs.monthsSupply.latest ? cbs.monthsSupply.latest.value : null, monthsSupplyPeriod: cbs.monthsSupply && cbs.monthsSupply.latest ? cbs.monthsSupply.latest.period : null, sourceUpdate: cbs.inventory.sourceUpdate || cbs.sourceUpdate, checkedAt: cbs.checkedAt, scope: { he: 'ארצי בלבד — הלמ״ס אינה מפרסמת מלאי לפי יישוב בפורמט קריא למכונה', en: 'national only — CBS publishes no machine-readable inventory by locality' } };
  }
  /* land — the live tender list + the week's events */
  const meta = readJson(path.join(dataDir, 'land', 'meta.json'));
  if (meta) S.land = { cls: 'OFFICIAL', source: 'rmi:michrazim', byLifecycle: meta.byLifecycle || null, byTrack: meta.byTrack || null, records: meta.records, checkedAt: meta.checkedAt, sourceSnapshotAt: meta.snapshotFetchedAt,
    week: { published: n(e7, 'tender-published') + n(e7, 'tender-new'), open: n(e7, 'tender-open'), closed: n(e7, 'tender-closed'), awarded: n(e7, 'tender-awarded'), noAward: n(e7, 'tender-no-award'), cancelled: n(e7, 'tender-cancelled') },
    month: { published: n(e30, 'tender-published') + n(e30, 'tender-new'), open: n(e30, 'tender-open'), closed: n(e30, 'tender-closed'), awarded: n(e30, 'tender-awarded'), noAward: n(e30, 'tender-no-award'), cancelled: n(e30, 'tender-cancelled') },
    top: top(e30, (e) => e.group === 'land' && e.m >= 2, 6) };
  /* developers — wins and entries */
  S.developers = { cls: 'OFFICIAL / DERIVED', source: 'rmi:michrazim · lib/entities', week: { wins: n(e7, 'developer-wins-land'), entries: n(e7, 'developer-market-entry') }, month: { wins: n(e30, 'developer-wins-land'), entries: n(e30, 'developer-market-entry') },
    top: top(e30, (e) => e.group === 'developers', 6), basis: { he: 'שמות כפי שפורסמו — ללא מיזוג לפי דמיון; "כניסה ליישוב" = פעילות ראשונה שנצפתה ביישוב ליזם שפעל קודם במקום אחר (נגזר)', en: 'names as published — never merged by similarity; "market entry" = a developer\'s first observed activity in a locality after activity elsewhere (derived)' } };
  /* planning & renewal */
  const rmeta = readJson(path.join(dataDir, 'renewal', 'meta.json'));
  S.planning = { cls: 'OFFICIAL', source: 'datagov:moch:urban-renewal · iplan:xplan', complexes: rmeta ? rmeta.records || rmeta.complexes || null : null, declared: rmeta ? rmeta.declared ?? null : null, sourceUpdatedAt: rmeta ? rmeta.sourceUpdatedAt || null : null, checkedAt: rmeta ? rmeta.checkedAt || null : null,
    month: { declared: n(e30, 'renewal-declared'), stage: n(e30, 'renewal-stage'), newComplexes: n(e30, 'renewal-new'), planStatus: n(e30, 'plan-status') }, top: top(e30, (e) => e.group === 'planning', 6) };
  /* rental */
  S.rental = { cls: 'OFFICIAL', source: 'dira-lehaskir:wp · rmi:michrazim', month: { notices: n(e30, 'rental-notice-new'), updated: n(e30, 'rental-notice-updated') + n(e30, 'rental-planning-updated') }, top: top(e30, (e) => e.group === 'rental', 5),
    basis: { he: 'צנרת מכרזים והודעות החברה הממשלתית — לא פרויקטים מאוכלסים ולא שכר דירה', en: 'the tender pipeline and the government company\'s notices — not operating projects, not rents' } };
  /* housing lotteries */
  S.housing = { cls: 'OFFICIAL', source: 'datagov:moch:dira-behanacha-lotteries', month: { newLotteries: n(e30, 'lottery-new') }, due: P.events.filter((e) => e.kind === 'lottery-due').slice(0, 8) };
  /* macro */
  const mk = readJson(path.join(dataDir, 'market', 'latest.json'));
  if (mk && mk.indicators) { const I = mk.indicators; const pick = (k) => (I[k] ? { value: I[k].value ?? null, yoy: I[k].yoy ?? null, period: I[k].period || null, publishedAt: I[k].publishedAt || null, stale: !!I[k].stale } : null);
    S.macro = { cls: 'OFFICIAL', source: 'boi:interest · cbs:price-index', checkedAt: mk.syncedAt || null, boiRate: pick('boiRate'), newHomesIndex: pick('newHomesIndex'), dwellingsIndex: pick('dwellingsIndex'), cpi: pick('cpi'), constructionInputsIndex: pick('constructionInputsIndex'), rentIndex: pick('rentIndex'), month: { rateChanges: n(e30, 'boi-rate-changed'), indexReleases: n(e30, 'index-published') }, top: top(e30, (e) => e.group === 'macro', 4) }; }
  /* sources */
  S.sources = { cls: 'DERIVED', source: 'lib/trust/catalog', week: { stateChanges: n(e7, 'source-state'), stale: n(P.events, 'source-stale') }, top: top(e30, (e) => e.group === 'sources', 6) };
  /* the headline facts — deterministic one-liners, each tied to a section above */
  const facts = [];
  if (S.sales) facts.push({ k: 'sales', he: `מכירות דירות חדשות (למ״ס): ${S.sales.latest} — ${fmt(S.sales.latestValue)} ארצי · 12 חודשים ${fmt(S.sales.t12 && S.sales.t12.value)}${S.sales.ytdChange && S.sales.ytdChange.ok ? ` · מתחילת השנה ${sgn(S.sales.ytdChange.pct)} מול אשתקד` : ''}${S.sales.events.revised ? ` · ${S.sales.events.revised} סדרות עם תיקון רשמי ב-30 יום` : ''}`, en: `New-home sales (CBS): ${S.sales.latest} — ${fmt(S.sales.latestValue)} national · 12 months ${fmt(S.sales.t12 && S.sales.t12.value)}${S.sales.ytdChange && S.sales.ytdChange.ok ? ` · YTD ${sgn(S.sales.ytdChange.pct)} vs last year` : ''}${S.sales.events.revised ? ` · ${S.sales.events.revised} series with official revisions in 30 days` : ''}` });
  if (S.inventory) facts.push({ k: 'inventory', he: `מלאי דירות חדשות שטרם נמכרו: ${fmt(S.inventory.value)} (${S.inventory.period})${S.inventory.monthsSupply != null ? ` · ${S.inventory.monthsSupply} חודשי היצע` : ''} — ארצי`, en: `Unsold new-home inventory: ${fmt(S.inventory.value)} (${S.inventory.period})${S.inventory.monthsSupply != null ? ` · ${S.inventory.monthsSupply} months of supply` : ''} — national` });
  if (S.land) facts.push({ k: 'land', he: `קרקע (רמ״י, 7 ימים): ${S.land.week.published} פורסמו · ${S.land.week.open} נפתחו · ${S.land.week.awarded} הוכרזו זוכים · ${S.land.week.noAward} ללא זוכה · ${S.land.week.cancelled} בוטלו`, en: `Land (ILA, 7 days): ${S.land.week.published} published · ${S.land.week.open} opened · ${S.land.week.awarded} awarded · ${S.land.week.noAward} no winner · ${S.land.week.cancelled} cancelled` });
  facts.push({ k: 'developers', he: `יזמים (30 יום): ${S.developers.month.wins} זכיות בקרקע · ${S.developers.month.entries} כניסות ליישוב חדש (נגזר)`, en: `Developers (30 days): ${S.developers.month.wins} land wins · ${S.developers.month.entries} new-locality entries (derived)` });
  facts.push({ k: 'planning', he: `תכנון והתחדשות (30 יום): ${S.planning.month.declared} הכרזות · ${S.planning.month.planStatus} שינויי סטטוס תכנוני · ${S.planning.month.newComplexes} מתחמים חדשים`, en: `Planning & renewal (30 days): ${S.planning.month.declared} declarations · ${S.planning.month.planStatus} plan status changes · ${S.planning.month.newComplexes} new complexes` });
  facts.push({ k: 'rental', he: `דיור להשכרה (30 יום): ${S.rental.month.notices} הודעות מכרז חדשות · ${S.rental.month.updated} עדכונים`, en: `Rental (30 days): ${S.rental.month.notices} new tender notices · ${S.rental.month.updated} updates` });
  if (S.macro && S.macro.boiRate) facts.push({ k: 'macro', he: `ריבית בנק ישראל ${S.macro.boiRate.value}%${S.macro.newHomesIndex && S.macro.newHomesIndex.yoy != null ? ` · מדד דירות חדשות ${sgn(S.macro.newHomesIndex.yoy)} שנתי` : ''}${S.macro.constructionInputsIndex && S.macro.constructionInputsIndex.yoy != null ? ` · תשומות בנייה ${sgn(S.macro.constructionInputsIndex.yoy)}` : ''}`, en: `Bank of Israel rate ${S.macro.boiRate.value}%${S.macro.newHomesIndex && S.macro.newHomesIndex.yoy != null ? ` · new-homes index ${sgn(S.macro.newHomesIndex.yoy)} y/y` : ''}${S.macro.constructionInputsIndex && S.macro.constructionInputsIndex.yoy != null ? ` · construction inputs ${sgn(S.macro.constructionInputsIndex.yoy)}` : ''}` });
  facts.push({ k: 'sources', he: `מקורות: ${S.sources.week.stateChanges} שינויי מצב השבוע · ${S.sources.week.stale} לא עדכניים`, en: `Sources: ${S.sources.week.stateChanges} state changes this week · ${S.sources.week.stale} stale` });
  return { basis: BASIS, builtAt: P.builtAt, served: P.served, generatedAt: new Date(now).toISOString(), counts: { d7: e7.length, d30: e30.length, all: P.events.length }, sections: S, facts, latest: P.events.slice(0, 12), groups: GROUP_LABEL };
}
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
const sgn = (x) => (Number.isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(1) + '%' : '—');

module.exports = { load, feed, pulse, WINDOWS, GROUP_LABEL, BASIS };
