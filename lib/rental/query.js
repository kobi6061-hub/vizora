// PROPX · long-term rental — the read model (served by api/land.js view=rental; shown in #land).
//
// Keeps apart what the sources keep apart:
//   PIPELINE      the Israel Land Authority's rental-track tenders (type 6 "דיור להשכרה" or purpose 20/21) — their
//                 YechidotDiur is the TENDER'S TOTAL units, never "long-term rental units"
//   TERMS         Dira Lehaskir's own notice for the same tender (exact key: the printed tender number → MichrazID):
//                 rental-designated units, units for sale, the rental period — only where the notice states them
//   PLANNING      Dira Lehaskir's planning-promotion sites (before any tender; no plan number → no XPlan join)
//   PROJECTS      Dira Lehaskir's project-status taxonomy counts (construction / available / occupied) and its public
//                 project pages — aggregate counts and links only (OFFICIAL_PAGE_ONLY: no per-project fields)
//   MARKET        the CBS rent component of the CPI — a GENERAL RENT MARKET BENCHMARK (all private, public and
//                 regulated long-term rentals, national, an index) — never a project's rent, never "institutional rent"
// Nothing is estimated: no project rent, no yield, no occupancy. A stage is reached only on direct evidence.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const LQ = require('../land/query');
const { SOURCE } = require('./dira');

const DIR = process.env.RENTAL_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'rental');
const MARKET = process.env.MARKET_DATA_FILE || path.join(__dirname, '..', '..', 'data', 'market', 'latest.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readLines = (f) => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } return t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); };

let CACHE = null;
function load(dir = DIR) {
  const stamp = ['dira-tenders.json', 'dira-planning.json', 'dira-terms.json', 'dira-projects.json', 'runs.jsonl'].map((f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } }).join('|');
  if (CACHE && CACHE.dir === dir && CACHE.stamp === stamp) return CACHE;
  const T = readJson(path.join(dir, 'dira-tenders.json')), P = readJson(path.join(dir, 'dira-planning.json'));
  const X = readJson(path.join(dir, 'dira-terms.json')), J = readJson(path.join(dir, 'dira-projects.json'));
  const runs = readLines(path.join(dir, 'runs.jsonl'));
  const tenders = T ? T.records : [], dev = tenders.filter((r) => r.kind === 'developer-tender');
  const byMichraz = new Map();
  for (const r of dev) if (r.tender && r.tender.michrazId && r.inLatestSource !== false) { const k = 'rmi:' + r.tender.michrazId; if (!byMichraz.has(k)) byMichraz.set(k, r); }
  CACHE = { dir, stamp, T, P, X, J, runs, tenders, dev, byMichraz, planning: P ? P.records : [], projects: J ? J.pages : [], terms: X ? X.taxonomies : {} };
  return CACHE;
}
/** Dira Lehaskir's notice for one ILA tender (exact key) — null when the company published none */
function diraFor(tenderId, opt = {}) { const C = load(opt.dir); const r = C.byMichraz.get(tenderId); return r ? brief(r) : null; }
const brief = (r) => ({ id: r.id, tenderNumber: r.tender ? r.tender.raw : null, michrazId: r.tender ? r.tender.michrazId : null, title: r.title, link: r.link,
  status: r.status, published: r.published, modified: r.modified, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, inLatestSource: r.inLatestSource !== false,
  totalUnits: r.terms ? r.terms.totalUnits : null, rentalUnits: r.terms ? r.terms.rentalUnits : null, rentalBasis: r.terms ? r.terms.rentalBasis : null,
  saleUnits: r.terms ? r.terms.saleUnits : null, rentalYears: r.terms ? r.terms.rentalYears : null, discountedShare: r.terms ? r.terms.discountedShare : null,
  discountedText: r.terms ? r.terms.discountedText : null, inconsistent: !!(r.terms && r.terms.inconsistent), evidence: r.terms ? r.terms.evidence : {},
  rentalPermanent: !!(r.terms && r.terms.rentalPermanent), totalApprox: !!(r.terms && r.terms.totalApprox), ambiguous: r.terms ? r.terms.ambiguous || null : null,
  rentalStatements: r.terms ? r.terms.rentalStatements || null : null, specialRental: r.terms ? r.terms.specialRental || null : null });

const sum = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const countBy = (xs, f) => { const m = {}; for (const x of xs) { const k = f(x); if (k == null) continue; m[k] = (m[k] || 0) + 1; } return m; };

/** the CBS rent component of the CPI, as the market sync stored it (data/market/latest.json) */
function marketBenchmark() {
  const M = readJson(MARKET), R = M && M.indicators && M.indicators.rentIndex;
  if (!R) return { state: 'not-synced' };
  return { state: R.stale ? 'stale' : 'ok', class: 'OFFICIAL', role: 'GENERAL RENT MARKET BENCHMARK',
    what: { he: 'מדד שכר הדירה (רכיב במדד המחירים לצרכן) — שכירות פרטית, ציבורית וארוכת טווח בפיקוח, ארצי', en: 'the rent component of the CPI — private, public and regulated long-term rentals, national' },
    series: R.series, level: R.level, base: R.base, mom: R.mom, yoy: R.yoy, yoyBasis: R.yoyBasis, period: R.period, periodKind: R.periodKind,
    history: (R.history || []).slice(-25), source: R.source, checkedAt: R.checkedAt || (M && M.syncedAt) || null, syncedAt: M ? M.syncedAt : null,
    notIs: ['the rent of any project', 'institutional or Dira Lehaskir rent', 'a city or district rent', 'a rent level in ₪'] };
}

/** the rental pipeline + terms + planning + projects + market benchmark for the land filters in force (track forced to rental) */
function summary(f, opt = {}) {
  const C = load(opt.dir);
  const L = LQ.load(opt.landDir);
  const ff = { ...f, track: ['rental'] };
  const rows = L.live.filter((r) => r.track === 'rental' && (ff.scope !== 'current' || LQ.isCurrent(r, ff)) && (!ff.city || String(r.localityCode) === String(ff.city) || r.city === ff.city));
  const life = countBy(rows, (r) => r.lifecycle);
  const joined = rows.map((r) => ({ r, d: C.byMichraz.get(r.id) || null }));
  const withD = joined.filter((x) => x.d);
  const stated = withD.filter((x) => x.d.terms && x.d.terms.rentalUnits != null && !x.d.terms.inconsistent);
  /* the sums compare like with like: only tenders that carry BOTH the ILA unit count and the company's stated rental units */
  const comparable = stated.filter((x) => x.r.units != null);
  const unitCheck = withD.filter((x) => x.d.terms && x.d.terms.totalUnits != null && x.r.units != null);
  const awarded = rows.filter((r) => r.lifecycle === 'awarded');
  const withPlan = rows.filter((r) => (r.plans || []).some((p) => p.via === 'lot' && p.xplanStatus === 'found'));
  const construction = awarded.filter((r) => r.construction && r.construction.links && r.construction.links.length);
  const years = countBy(stated.filter((x) => x.d.terms.rentalYears != null), (x) => x.d.terms.rentalYears);
  /* "in play" only by an old status: published more than 36 months ago and still closed / frozen / awaiting a lottery at
     the ILA — counted and shown, never reclassified (the Authority's status is kept); the company's own status beside it */
  const staleCut = LQ.monthsBefore(LQ.israelToday(), 36);
  const staleRows = joined.filter((x) => ['closed', 'frozen', 'lottery-pending'].includes(x.r.lifecycle) && x.r.publishedDate && x.r.publishedDate < staleCut);
  /* DL notices whose tender number is not among the ILA records PROPX holds (older, or not a land tender of the Authority) */
  const ilaIds = new Set(L.records.map((r) => r.id));
  const dlNoIla = C.dev.filter((r) => r.tender && !ilaIds.has('rmi:' + r.tender.michrazId)).length;
  const lastRun = C.runs.length ? C.runs[C.runs.length - 1] : null;
  const lastGood = [...C.runs].reverse().find((r) => r.state === 'SUCCESS' || r.state === 'UNCHANGED' || r.state === 'PARTIAL') || null;
  const projTerms = (C.terms.tax_status || []).map((t) => ({ name: t.name, slug: t.slug, count: t.count }));
  const planTerms = (C.terms.statuss || []).map((t) => ({ name: t.name, count: t.count }));
  const tenderTerms = (C.terms.tax_status_et || []).map((t) => ({ name: t.name, slug: t.slug, count: t.count }));
  return {
    scope: { mode: ff.scope, city: ff.city || null, basis: 'ILA rental track = tender type 6 "דיור להשכרה" or purpose 20 / 21 (lib/land/codes.js)' },
    pipeline: {
      class: 'OFFICIAL', source: 'rmi:michrazim',
      tenders: rows.length, lifecycle: life,
      tenderUnits: sum(rows.map((r) => r.units)), unitsLabel: 'total units of the tenders (YechidotDiur) — NOT long-term rental units: a rental-track tender may also sell units',
      awarded: awarded.length, awardedUnits: sum(awarded.map((r) => r.units)),
      withXplanPlan: withPlan.length, withConstructionEvidence: construction.length,
      staleStatus: { n: staleRows.length, before: staleCut, units: sum(staleRows.map((x) => x.r.units)), companyClosed: staleRows.filter((x) => x.d && x.d.status && x.d.status.slug === 'close').length,
        basis: 'ILA status still closed / frozen / awaiting a lottery although the tender was published more than 36 months ago — the status has not advanced at the source' },
    },
    terms: {
      class: 'OFFICIAL', source: SOURCE.id, joinKey: 'the tender number Dira Lehaskir prints (region/number/year) → ILA MichrazID = year × 10000 + number',
      ilaTenders: rows.length, withNotice: withD.length, withStatedRentalUnits: stated.length, comparable: comparable.length,
      sumsBasis: 'Σ over the same tenders on both sides: those with an ILA unit count AND stated rental units',
      tenderUnitsOfStated: sum(comparable.map((x) => x.r.units)), rentalUnitsStated: sum(comparable.map((x) => x.d.terms.rentalUnits)),
      saleUnitsStated: sum(comparable.map((x) => x.d.terms.saleUnits)), saleStatedIn: comparable.filter((x) => x.d.terms.saleUnits != null).length,
      specialRentalUnits: sum(comparable.flatMap((x) => (x.d.terms.specialRental || []).map((y) => y.units))),
      allRental: stated.filter((x) => x.d.terms.rentalBasis === 'stated-all').length, projectRental: stated.filter((x) => x.d.terms.rentalBasis === 'project-rental').length,
      partRental: stated.filter((x) => x.d.terms.rentalBasis === 'stated-part').length, permanent: stated.filter((x) => x.d.terms.rentalPermanent).length,
      ambiguous: withD.filter((x) => x.d.terms && x.d.terms.ambiguous).length, rentalYears: years,
      unitsAgree: unitCheck.filter((x) => x.d.terms.totalUnits === x.r.units).length, unitsDiffer: unitCheck.filter((x) => x.d.terms.totalUnits !== x.r.units).map((x) => ({ id: x.r.id, ila: x.r.units, dira: x.d.terms.totalUnits })),
      noticesWithoutIlaRecord: dlNoIla, notices: C.dev.length, noticesTotal: C.tenders.length, statusCounts: tenderTerms,
    },
    rows: joined.map(({ r, d }) => ({ id: r.id, name: r.name, city: r.city, cityEn: r.cityEn, localityCode: r.localityCode, lifecycle: r.lifecycle, publishedDate: r.publishedDate,
      closeDate: r.closeDate, committeeDate: r.committeeDate, tenderUnits: r.units, winners: r.winners ? r.winners.map((w) => w.name) : null,
      plan: (r.plans || []).filter((p) => p.via === 'lot' && p.xplanStatus === 'found').map((p) => ({ plan: p.plan, station: p.xplan ? p.xplan.station : null }))[0] || null,
      construction: r.construction && r.construction.links ? r.construction.links.length : 0, dira: d ? brief(d) : null })),
    planning: { class: 'OFFICIAL', source: SOURCE.id, sites: C.planning.filter((p) => p.inLatestSource !== false).length, statusCounts: planTerms, xplan: 'not joined — the company publishes no plan number',
      list: C.planning.filter((p) => p.inLatestSource !== false).map((p) => ({ id: p.id, title: p.title, site: p.site, place: p.placeText, status: p.status ? p.status.name : null, modified: p.modified, link: p.link })) },
    projects: { class: 'OFFICIAL_PAGE_ONLY', source: SOURCE.id, pages: C.projects.filter((x) => /\/project\/./.test(x.url)).length, statusCounts: projTerms,
      basis: 'the company\'s own project-status taxonomy (published counts); per-project fields are not published in a structured form' },
    market: marketBenchmark(),
    lifecycle: [
      { stage: 'TENDER_PUBLISHED', n: rows.filter((r) => ['published', 'open', 'closed', 'lottery-pending', 'frozen'].includes(r.lifecycle)).length, basis: 'ILA status code', level: 'tender' },
      { stage: 'AWARDED', n: awarded.length, basis: 'ILA: a winner name and an award sum', level: 'tender' },
      /* the lot's statutory plan in XPlan is the plan the land is marketed under — it precedes the tender, so it is never
         evidence of a post-award planning stage (shown as enrichment: pipeline.withXplanPlan) */
      { stage: 'PLANNING', n: null, basis: 'no post-award planning source joined (the lot\'s statutory plan precedes the tender — not this stage)', level: 'tender' },
      { stage: 'PERMIT', n: null, basis: 'no machine-readable permit source joined', level: 'tender' },
      { stage: 'CONSTRUCTION', n: construction.length, basis: 'MoCH construction-progress rows by exact block + parcel (awarded tenders)', level: 'tender',
        companyCount: (projTerms.find((t) => /בני/.test(t.name)) || {}).count ?? null },
      { stage: 'COMPLETED', n: null, basis: 'no tender-level completion source', level: 'tender' },
      { stage: 'OPERATING', n: null, basis: 'no tender-level occupancy source; the company\'s own count of occupied projects is shown separately', level: 'tender',
        companyCount: (projTerms.find((t) => /מאוכלס/.test(t.name)) || {}).count ?? null },
    ],
    freshness: { dira: { fetchedAt: C.T ? C.T.fetchedAt : null, lastRun: lastRun ? { state: lastRun.state, at: lastRun.startedAt } : null, lastGoodAt: lastGood ? lastGood.startedAt : null, synced: !!C.T },
      land: { checkedAt: (L.meta && L.meta.checkedAt) || null } },
    source: SOURCE,
  };
}

module.exports = { load, summary, diraFor, marketBenchmark, DIR };
