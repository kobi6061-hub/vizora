// PROPX · WHAT CHANGED HERE? — the geographic change feed (21.10.2026).
//
// One read of a geography — a street, a verified neighbourhood, a locality, a district or Israel — listing what changed in a
// period, composed ONLY from evidence PROPX already stores (lib/changes/collect.js: the transaction events union, the register
// sweep, the recent GovMap layer's first reads, the land tender list + the Market Radar's ledger events, urban-renewal complexes,
// the national plan layer + the renewal plans' history, VATMAL, housing lotteries, rental notices, the CBS sales / construction
// ledgers with their revisions, Tel Aviv-Yafo permits + the due-diligence history, the Trust run logs). Nothing is fetched,
// nothing estimated, nothing defaulted; no score, no probability, no recommendation.
//
// TWO DATES on every item: eventDate (the real-world date — the deal, the plan milestone, the tender decision, the publication) and
// observedAt (when PROPX first held it — a copy read, a first read, a change between two reads). The PERIOD (30 · 90 · 180 · 365
// days) ends at the ANCHOR — the newest PROPX observation in the stored data, never "today" when the data is older.
//
// NEWNESS: NEW_EVENT (the event's own date is inside the period) · NEWLY_OBSERVED_OLDER_EVENT (an older event PROPX first held
// inside the period, in a newer copy / a later read — a source's first ingestion is a baseline, never "newly observed") · REVISION
// (an official figure replaced, both values kept) · STATE_CHANGE (a state PROPX saw change between two reads).
//
// Every kind states its COVERAGE (COVERED · SNAPSHOT_ONLY · NOT_APPLICABLE · NOT_IN_COVERAGE · STALE, with the reason and the
// sources) and its STATEMENT for the period — CHANGES · NO_CHANGES_IN_PERIOD · NOT_COVERED · SOURCE_STALE, never interchangeable.
//
//   GET /api/intel?view=changes&geo=st:<loc>:<street>|nb:<id>|loc:<code>|d-…|il&period=30|90|180|365[&kinds=][&newness=][&scope=][&offset=][&limit=]
//   GET /api/intel?view=changesMeta     the vocabulary, the districts, the anchor
'use strict';

const RU = require('./rules');
const G = require('./geo');
const S = require('./stores');
const C = require('./collect');

const ENGINE = 'propx-changes-1';
const DAY = 864e5;
const day = (x) => (x ? String(x).slice(0, 10) : null);
const minusDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') - k * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const bi = RU.bi;

/* ───────────────────────── the anchor: the newest PROPX observation in the stored data ───────────────────────── */
function anchor() {
  return S.memo('anchor', Object.values(S.FILES).filter((f) => f !== S.FILES.planTiles), () => {
    const last = (f, pick) => S.runSpan(f, pick).last;
    const j = (f, k) => { const d = S.readJson(f); return d ? d[k] || null : null; };
    const checks = [
      ['over:street-evidence', last(S.FILES.evRuns, (r) => r.finishedAt || r.startedAt)],
      ['over:govmap-recent', last(S.FILES.recentRuns, (r) => r.finishedAt || r.startedAt)],
      ['over:govmap-national', last(S.FILES.natRuns, (r) => r.at)],
      ['propx:tx-freshness', j(S.FILES.txFresh, 'checkedAt')],
      ['rmi:michrazim', j(S.FILES.landMeta, 'checkedAt')],
      ['datagov:moch:urban-renewal-complexes', j(S.FILES.renewalMeta, 'checkedAt')],
      ['iplan:xplan', j(S.FILES.planMeta, 'fetchedAt')],
      ['iplan:vatmal', j(S.FILES.vatmalMeta, 'fetchedAt')],
      ['datagov:moch:dira-behanacha-lotteries', j(S.FILES.housingMeta, 'checkedAt')],
      ['dira-lehaskir:tenders', last(S.FILES.rentalRuns, (r) => r.finishedAt || r.startedAt)],
      ['cbs:construction', last(S.FILES.cRuns, (r) => r.finishedAt || r.startedAt)],
      ['cbs:new-home-sales', j(S.FILES.sLatest, 'checkedAt')],
      ['tlv:iview2:permits-772', j(S.FILES.ddLatest, 'generatedAt')],
      ['propx:radar', j(S.FILES.radarMeta, 'builtAt')],
    ].filter(([, at]) => at && Number.isFinite(Date.parse(at)));
    checks.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
    const top = checks[0] || null;
    return { day: top ? day(new Date(Date.parse(top[1])).toISOString()) : null, at: top ? new Date(Date.parse(top[1])).toISOString() : null, source: top ? top[0] : null,
      checks: checks.map(([id, at]) => ({ id, at })),
      basis: bi('סוף התקופה = התצפית החדשה ביותר של PROPX בנתונים השמורים (הבדיקה האחרונה של אחד המקורות) — לא "היום" כשהנתונים ישנים יותר', 'the period ends at the newest PROPX observation in the stored data (the latest check of any source) — never "today" when the data is older') };
  });
}

/* ───────────────────────── the candidates of one geography (memoised per data stamp) ───────────────────────── */
const COLLECTORS = {
  TRANSACTION: (g, ctx) => C.collectTransactions(g, ctx),
  PLANNING: (g, ctx, sps) => C.collectPlanning(g, ctx, sps),
  LAND_TENDER: (g, ctx, sps) => C.collectLand(g, ctx, sps),
  URBAN_RENEWAL: (g, ctx, sps) => C.collectRenewal(g, ctx, sps),
  HOUSING: (g, ctx) => C.collectHousing(g, ctx),
  RENTAL: (g, ctx, sps) => C.collectRental(g, ctx, sps),
  CONSTRUCTION: (g, ctx) => C.collectConstruction(g, ctx),
  SALES: (g, ctx) => C.collectSales(g, ctx),
  SOURCE_REVISION: (g, ctx) => C.collectRevisions(g, ctx),
  SOURCE_STATE: (g, ctx) => C.collectSourceState(g, ctx),
};
const CAND = new Map();
function candidates(geo) {
  const st = S.stamp(), key = geo.id;
  const c = CAND.get(key);
  if (c && c.st === st) { CAND.delete(key); CAND.set(key, c); return c.v; }
  const A = anchor();
  const ctx = { A: A.day, A_at: A.at, windowFrom: minusDays(A.day, RU.MAX_PERIOD), trust: C.trust(A.at) };
  const sps = geo.kind === 'street' || geo.kind === 'neighbourhood' ? geo.streets.map((s) => C.spatialOf(s)) : [];
  const t0 = Date.now(), byKind = {}, ms = {};
  for (const k of RU.KINDS) {
    const t = Date.now();
    try { byKind[k] = COLLECTORS[k](geo, ctx, sps); }
    catch (e) { byKind[k] = { items: [], coverage: { state: 'NOT_IN_COVERAGE', reason: bi('קריאת המקור נכשלה: ' + e.message, 'the source read failed: ' + e.message), parts: [], error: true } }; }
    ms[k] = Date.now() - t;
  }
  const v = { anchor: A, ctx: { A: ctx.A, windowFrom: ctx.windowFrom }, byKind, located: sps.map((sp) => ({ id: sp.street.id, name: sp.street.name, located: sp.located, reason: sp.reason || null })), ms, builtMs: Date.now() - t0 };
  CAND.set(key, { st, v });
  while (CAND.size > 24) CAND.delete(CAND.keys().next().value);
  return v;
}

/* ───────────────────────── newness, statement ───────────────────────── */
/** an item's newness in a period (from, A] — or null when it is not a change of this period */
function newnessOf(it, from, A) {
  const obs = day(it.observedAt);
  if (it.mode === 'REVISION') return obs > from && obs <= A ? 'REVISION' : null;
  if (it.mode === 'STATE_CHANGE') return obs > from && obs <= A ? 'STATE_CHANGE' : null;
  if (!it.eventDate || it.eventDate > A) return null;                               /* a future-dated record is not an event yet */
  if (it.eventDate > from) return 'NEW_EVENT';
  if (!it.baseline && obs > from && obs <= A) return 'NEWLY_OBSERVED_OLDER_EVENT';  /* older, first held inside the period, not the baseline */
  return null;
}
/** what a kind's period means — CHANGES · NO_CHANGES_IN_PERIOD · NOT_COVERED · SOURCE_STALE (never interchangeable) */
function statementOf(n, cov, period, scopeOk, scopes) {
  const T = (code, reason, extra) => Object.assign({ code, text: RU.STATEMENTS[code], reason: reason || null }, extra || {});
  const through = cov.coveredThrough && cov.coveredThrough < period.to ? cov.coveredThrough : period.to;
  const start = cov.coveredFrom && cov.coveredFrom > period.from ? cov.coveredFrom : period.from;
  const coveredDays = Math.max(0, Math.min(period.days, daysBetween(start, through)));
  const tail = through < period.to ? { from: through, to: period.to, days: daysBetween(through, period.to) } : null;
  if (n > 0) return T('CHANGES', null, { coveredDays, uncoveredTail: tail });
  if (scopeOk === false) return T('NOT_COVERED', cov.scopeReason || bi(`מגיע לכאן רק כ: ${(scopes || []).map((x) => RU.SCOPE_LABEL[x].he).join(' · ')} — היקף שלא נבחר`, `reaches this place only as: ${(scopes || []).map((x) => RU.SCOPE_LABEL[x].en).join(' · ')} — a scope not selected`), { coveredDays: 0, scopeExcluded: true });
  if (['NOT_APPLICABLE', 'NOT_IN_COVERAGE', 'SNAPSHOT_ONLY'].includes(cov.state)) return T('NOT_COVERED', cov.reason, { coveredDays: 0 });
  if (cov.state === 'STALE') return T('SOURCE_STALE', cov.reason, { coveredDays, uncoveredTail: tail });
  if (coveredDays < period.days / 2) return T('NOT_COVERED', bi(`הראיות מכסות ${coveredDays} מתוך ${period.days} ימי התקופה (עד ${through})`, `the evidence covers ${coveredDays} of the period's ${period.days} days (through ${through})`), { coveredDays, uncoveredTail: tail });
  return T('NO_CHANGES_IN_PERIOD', null, { coveredDays, uncoveredTail: tail });
}
/** the scopes a kind can reach a geography in — a statement for a scope selection the kind never reaches is NOT_COVERED */
function scopesOf(kind, geo) {
  const street = geo.kind === 'street' || geo.kind === 'neighbourhood';
  const tlv = (geo.locality && geo.locality.code === 5000) || geo.kind === 'il' || (geo.kind === 'district' && geo.id === 'd-ta');
  const cbs = (C.cbsGeoOf(geo) || {}).scope;
  switch (kind) {
    case 'TRANSACTION': return street ? ['EXACT_STREET'] : ['LOCALITY'];
    case 'LAND_TENDER': case 'RENTAL': case 'URBAN_RENEWAL': case 'PLANNING': return street ? ['EXACT_STREET', 'NEAR_STREET', 'LOCALITY'] : geo.kind === 'il' ? ['LOCALITY', 'NATIONAL'] : ['LOCALITY'];
    case 'HOUSING': return ['LOCALITY'];
    case 'CONSTRUCTION': return [cbs, ...(tlv ? (street ? ['EXACT_STREET', 'LOCALITY'] : ['LOCALITY']) : [])].filter(Boolean);
    case 'SALES': case 'SOURCE_REVISION': return cbs ? [cbs] : [];
    case 'SOURCE_STATE': return [geo.kind === 'il' ? 'NATIONAL' : 'NATIONAL_CONTEXT'];
    default: return [];
  }
}

/* ───────────────────────── params ───────────────────────── */
const listParam = (v, allowed, name) => {
  if (v == null || v === '') return { ok: true, value: null };
  const xs = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  const bad = xs.filter((x) => !allowed.includes(x));
  return bad.length || !xs.length ? { ok: false, error: `bad-${name}`, detail: `${name} must be a comma list of ${allowed.join(' · ')}` } : { ok: true, value: new Set(xs) };
};
const intParam = (v, d, lo, hi, name) => {
  if (v == null || v === '') return { ok: true, value: d };
  if (!/^\d{1,6}$/.test(String(v))) return { ok: false, error: `bad-${name}` };
  const n = Number(v); return n < lo || n > hi ? { ok: false, error: `bad-${name}`, detail: `${name} must be ${lo}…${hi}` } : { ok: true, value: n };
};
function parse(p) {
  const geoRaw = p.geo != null ? p.geo : p.street != null ? p.street : p.nb != null ? p.nb : p.city != null ? 'loc:' + p.city : p.district != null ? p.district : 'il';
  if (String(geoRaw).length > 80) return { ok: false, status: 400, error: 'bad-geo' };
  const period = p.period == null || p.period === '' ? RU.DEFAULT_PERIOD : RU.PERIODS.includes(Number(p.period)) && /^\d+$/.test(String(p.period)) ? Number(p.period) : null;
  if (period == null) return { ok: false, status: 400, error: 'bad-period', detail: `period must be one of ${RU.PERIODS.join(' · ')}` };
  const kinds = listParam(p.kinds, RU.KINDS, 'kinds'); if (!kinds.ok) return { ...kinds, status: 400 };
  const newness = listParam(p.newness, RU.NEWNESS, 'newness'); if (!newness.ok) return { ...newness, status: 400 };
  const scope = listParam(p.scope, RU.SCOPES, 'scope'); if (!scope.ok) return { ...scope, status: 400 };
  const offset = intParam(p.offset, 0, 0, 200000, 'offset'); if (!offset.ok) return { ...offset, status: 400 };
  const limit = intParam(p.limit, 60, 1, 200, 'limit'); if (!limit.ok) return { ...limit, status: 400 };
  if (p.batch != null && p.batch !== '' && p.batch !== '0' && p.batch !== '1') return { ok: false, status: 400, error: 'bad-batch', detail: 'batch must be 0 or 1' };
  let source = null;
  if (p.source != null && p.source !== '') { const xs = String(p.source).split(',').map((x) => x.trim()).filter(Boolean); if (!xs.length || xs.length > 12 || xs.some((x) => !/^[a-z0-9][a-z0-9:.\-]{1,63}$/.test(x))) return { ok: false, status: 400, error: 'bad-source' }; source = new Set(xs); }
  return { ok: true, geo: geoRaw, period, kinds: kinds.value, newness: newness.value, scope: scope.value, offset: offset.value, limit: limit.value, batch: p.batch === '1', source };
}

/* ───────────────────────── the feed ───────────────────────── */
const KIND_ORDER = Object.fromEntries(RU.KINDS.map((k, i) => [k, i]));
function feed(p) {
  const t0 = Date.now();
  const q = parse(p || {});
  if (!q.ok) return { status: q.status, body: { error: q.error, detail: q.detail || null } };
  const r = G.resolve(q.geo);
  if (!r.ok) return { status: r.status, body: { error: r.error, detail: r.detail || null } };
  const geo = r.geo;
  const Cd = candidates(geo);
  const A = Cd.anchor.day;
  if (!A) return { status: 503, body: { error: 'no-anchor', detail: 'no PROPX observation date is stored' } };
  const period = { days: q.period, from: minusDays(A, q.period), to: A, fromExclusive: true };
  /* a street's LOCALITY-context plans decode the whole plan layer: read once, and only when that scope is asked for */
  const PLK = Cd.byKind.PLANNING;
  if (PLK && PLK.lazyLocality && (!q.scope || q.scope.has('LOCALITY'))) { PLK.items = PLK.items.concat(PLK.lazyLocality()); PLK.lazyLocality = null; }
  const notComputed = PLK && PLK.lazyLocality ? ['LOCALITY'] : [];
  /* every item of the period with its newness */
  const all = [];
  for (const k of RU.KINDS) {
    const K = Cd.byKind[k];
    for (const it of K.items) { const nw = newnessOf(it, period.from, A); if (nw) all.push({ ...it, newness: nw }); }
    if (K.batches) for (const it of C.batchItems(K.batches, period.from, A)) all.push({ ...it, newness: 'NEWLY_OBSERVED_OLDER_EVENT' });
  }
  for (const it of all) it.changeDate = it.newness === 'NEW_EVENT' ? it.eventDate : day(it.observedAt);
  /* counts over the period in the selected SCOPES (the geography asked about), before the kind / newness facets — in events (a batch counts its deals) */
  const inScope = (it) => !q.scope || q.scope.has(it.scope);
  const scoped = all.filter(inScope);
  const z = () => Object.fromEntries(RU.NEWNESS.map((n) => [n, 0]));
  const byKind = Object.fromEntries(RU.KINDS.map((k) => [k, { total: 0, items: 0, ...z() }]));
  const byNewness = z(), byScope = Object.fromEntries(RU.SCOPES.map((s) => [s, 0]));
  for (const it of all) byScope[it.scope] = (byScope[it.scope] || 0) + it.n;
  for (const it of scoped) { const B = byKind[it.kind]; B.total += it.n; B.items++; B[it.newness] += it.n; byNewness[it.newness] += it.n; }
  /* an area's transaction count is the per-day tally of the events index (exact), not the listed newest events */
  const tx = Cd.byKind.TRANSACTION;
  let txListing = null;
  if (tx.exactNew) {
    const exact = tx.exactNew(period.from, A), listedAll = all.filter((it) => it.kind === 'TRANSACTION' && it.newness === 'NEW_EVENT').reduce((a, it) => a + it.n, 0);
    byScope.LOCALITY += exact - listedAll;
    if (inScope({ scope: 'LOCALITY' })) { byKind.TRANSACTION.total += exact - listedAll; byNewness.NEW_EVENT += exact - listedAll; byKind.TRANSACTION.NEW_EVENT = exact; }
    txListing = { listed: listedAll, exact, truncated: listedAll < exact, basis: tx.coverage.listing || null };
  }
  /* coverage and statement per kind */
  const kinds = {};
  for (const k of RU.KINDS) {
    const cov = Cd.byKind[k].coverage || { state: 'NOT_IN_COVERAGE', parts: [] };
    const scopes = scopesOf(k, geo);
    const scopeOk = !q.scope || scopes.some((x) => q.scope.has(x));
    kinds[k] = { label: RU.KIND_LABEL[k], counts: byKind[k], scopes, coverage: { ...cov, label: RU.COVERAGE_LABEL[cov.state] }, statement: statementOf(byKind[k].total, cov, period, scopeOk, scopes) };
    if (k === 'TRANSACTION' && txListing) kinds[k].listing = txListing;
  }
  /* the facets, the batches, the order, the months, the page */
  let sel = scoped.filter((it) => (!q.kinds || q.kinds.has(it.kind)) && (!q.newness || q.newness.has(it.newness)) && (!q.source || (it.source && q.source.has(it.source.id))));
  if (q.batch) sel = batchOlder(sel, geo);
  sel.sort((a, b) => (b.changeDate || '').localeCompare(a.changeDate || '') || b.m - a.m || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || String(a.id).localeCompare(String(b.id)));
  const months = []; for (const it of sel) { const mo = String(it.changeDate || '').slice(0, 7); const L = months[months.length - 1]; if (L && L.month === mo) { L.items++; L.n += it.n; } else months.push({ month: mo, items: 1, n: it.n }); }
  const page = sel.slice(q.offset, q.offset + q.limit).map(wire);
  return { status: 200, body: {
    engine: ENGINE, generatedAt: new Date().toISOString(), geo: geoOut(geo, Cd), anchor: { day: A, at: Cd.anchor.at, source: Cd.anchor.source, basis: Cd.anchor.basis }, period,
    filters: { kinds: q.kinds ? [...q.kinds] : null, newness: q.newness ? [...q.newness] : null, scope: q.scope ? [...q.scope] : null, source: q.source ? [...q.source] : null, batch: q.batch },
    counts: { total: Object.values(byKind).reduce((a, x) => a + x.total, 0), items: scoped.length, byNewness, byScope, possibleDuplicatesExcluded: (tx.coverage && tx.coverage.excluded && tx.coverage.excluded.possibleDuplicates) || 0,
      basis: bi('ספירה = אירועים (קבוצה סופרת את עסקאותיה) בהיקפים שנבחרו, לפני סינון לפי סוג וחדשות', 'count = events (a batch counts its deals) in the selected scopes, before the kind and newness facets'),
      byScopeNotComputed: notComputed },
    kinds, months, total: sel.length, offset: q.offset, limit: q.limit, more: q.offset + q.limit < sel.length, items: page,
    vocabulary: vocabulary(), terms: TERMS, timings: { candidatesMs: Cd.builtMs, kindMs: Cd.ms, totalMs: Date.now() - t0 },
  } };
}
/** batch=1: the older deals first observed in a newer copy, one row per source copy read (a street / locality lists hundreds) — the
 *  rows themselves stay one request away (newness=NEWLY_OBSERVED_OLDER_EVENT&kinds=TRANSACTION&source=<id>) */
function batchOlder(items, geo) {
  const out = [], groups = new Map();
  for (const it of items) {
    if (it.kind !== 'TRANSACTION' || it.newness !== 'NEWLY_OBSERVED_OLDER_EVENT' || it.rule === 'chg-tx-batch') { out.push(it); continue; }
    const k = `${it.source && it.source.id}|${day(it.observedAt)}|${it.scope}`;
    const g = groups.get(k);
    if (g) { g.n += it.n; if (it.eventDate < g.eventDateRange.from) g.eventDateRange.from = it.eventDate; if (it.eventDate > g.eventDateRange.to) { g.eventDateRange.to = it.eventDate; g.eventDate = it.eventDate; } continue; }
    const b = { ...it, id: `txb:${geo.id}:${k}`, rule: 'chg-tx-batch', m: RU.RULES['chg-tx-batch'].m, n: it.n, eventDateRange: { from: it.eventDate, to: it.eventDate }, values: { sourceId: it.source && it.source.id, expand: { newness: 'NEWLY_OBSERVED_OLDER_EVENT', kinds: 'TRANSACTION', source: it.source && it.source.id, scope: it.scope } }, link: { type: 'expand' } };
    groups.set(k, b); out.push(b);
  }
  for (const b of groups.values()) {
    const sl = b.source ? b.source.label : bi('', '');
    b.title = bi(`${b.n.toLocaleString('en-US')} עסקאות ישנות שנצפו לראשונה ב-${day(b.observedAt)}`, `${b.n.toLocaleString('en-US')} older deals first observed on ${day(b.observedAt)}`);
    b.detail = bi(`${sl.he} · מתאריכים ${b.eventDateRange.from} … ${b.eventDateRange.to} · עותק המרשם שבידי PROPX אינו מחזיק אותן`, `${sl.en} · dated ${b.eventDateRange.from} … ${b.eventDateRange.to} · the register copy PROPX holds does not hold them`);
  }
  return out;
}
const TERMS = ['change_feed', 'change_event_vs_observed', 'change_newness', 'change_scope', 'change_coverage', 'change_statement', 'change_period_anchor', 'change_materiality'];
function wire(it) {
  return { id: it.id, kind: it.kind, rule: it.rule, verb: it.verb, newness: it.newness, cls: it.cls, m: it.m, n: it.n, title: it.title, detail: it.detail || null,
    eventDate: it.eventDate || null, eventDateBasis: it.eventDateBasis, eventDateRange: it.eventDateRange || null, observedAt: it.observedAt || null, observedBasis: it.observedBasis || null, baseline: !!it.baseline,
    changeDate: it.changeDate, source: it.source || null, scope: it.scope, placement: it.placement || 'CERTAIN', relation: it.relation || null, distanceM: it.distanceM != null ? it.distanceM : null,
    matchedStreet: it.matchedStreet || null, link: it.link || null, values: it.values || null };
}
function geoOut(geo, Cd) {
  const o = { kind: geo.kind, id: geo.id, name: geo.name, district: geo.district || null, districtName: geo.district && G.DISTRICTS[geo.district] ? { he: G.DISTRICTS[geo.district].he, en: G.DISTRICTS[geo.district].en } : null };
  if (geo.locality) o.locality = geo.locality;
  if (geo.streets && geo.streets.length) o.streets = geo.streets.map((s) => ({ id: s.id, name: s.name, located: (Cd.located.find((x) => x.id === s.id) || {}).located !== false }));
  if (geo.kind === 'neighbourhood') { o.verified = true; o.source = geo.source || null; }
  if (geo.kind === 'district') o.localities = geo.localityCodes.length;
  return o;
}
function vocabulary() {
  return { kinds: RU.KINDS.map((k) => ({ id: k, label: RU.KIND_LABEL[k] })), newness: RU.NEWNESS.map((n) => ({ id: n, label: RU.NEWNESS_LABEL[n] })), scopes: RU.SCOPES.map((s) => ({ id: s, label: RU.SCOPE_LABEL[s] })),
    coverage: RU.COVERAGE.map((c) => ({ id: c, label: RU.COVERAGE_LABEL[c] })), statements: Object.entries(RU.STATEMENTS).map(([id, label]) => ({ id, label })), periods: RU.PERIODS,
    rules: Object.fromEntries(Object.entries(RU.RULES).map(([id, r]) => [id, { kind: r.kind, mode: r.mode, verb: r.verb, cls: r.cls, m: r.m, label: r.label }])) };
}
function meta() {
  const A = anchor();
  return { status: 200, body: { engine: ENGINE, anchor: A, districts: G.districtsList(), neighbourhoods: G.neighbourhoodsList(), vocabulary: vocabulary(), terms: TERMS, defaultPeriod: RU.DEFAULT_PERIOD } };
}

/** GET /api/intel?view=changes… → { status, body } */
function view(name, params) {
  try {
    if (name === 'changes') return feed(params || {});
    if (name === 'changesMeta') return meta();
    return { status: 404, body: { error: 'unknown-view', view: name } };
  } catch (e) {
    return { status: 500, body: { error: 'changes-failed', detail: String(e && e.message || e) } };
  }
}

module.exports = { view, feed, meta, anchor, candidates, newnessOf, statementOf, parse, ENGINE, TERMS };
