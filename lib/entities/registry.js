// PROPX · Developer & Project registry — OBSERVED PROPX ACTIVITY.
//
// Pure functions over records PROPX already stores (nothing is fetched here):
//   · the Israel Land Authority tenders (data/land/tenders.json — awarded lots with the Authority's winner string,
//     units, sum, plan / parcel keys, MoCH construction-progress links by exact block + parcel);
//   · the Ministry of Construction and Housing lottery records (data/housing/lotteries.json — project id, project
//     name, developer string, units, price per m², permit and project stage, applicants).
//
// IDENTITY (lib/entities/names.js): one developer = one canonical name (typographic variants only). Tender winners
// are listed only when the string carries a legal-form marker (בע"מ, Ltd, שותפות, אגודה, עמותה, public body); an
// unmarked string — usually a private person on a self-build lot — is counted, never listed. A MoCH lottery
// developer is listed by its source role. An identical canonical legal name in both sources is one entity
// (the Registrar of Companies does not register two companies under one name); anything weaker — a cut string
// that is a prefix of exactly one other name — is shown as a POSSIBLE same entity and never merged.
//
// PROJECTS keep their own official ids and are never joined across sources without a shared key:
//   moch:<ProjectID>               a MoCH lottery project (its lotteries, units, official ₪/m², permit and stage)
//   ila:<MichrazID>:<lot file id>   an awarded residential lot of an ILA tender (a land-stage site) won by a listed
//                                   developer, with construction evidence when the MoCH progress rows join it exactly
// The two sources share no key (the lottery records carry no tender, plan or parcel), so no lottery project is ever
// attached to a tender lot. Units are reported per source and never added across sources: a lot's planned units and
// the same homes' later lottery are often the same apartments.
//
// Nothing here is a land bank, a total pipeline or a market share: every count is what PROPX's sources show,
// labelled OBSERVED PROPX ACTIVITY, with the coverage it rests on.

'use strict';

const { canonicalName, devId, kindOf, LISTED_KINDS, isJoint, looksCut, lettersKey, searchKey } = require('./names');

const RESIDENTIAL = new Set(['open-market', 'subsidized', 'rental', 'special-population', 'residential-lottery', 'lottery', 'mixed-use']);
const BASIS = 'OBSERVED PROPX ACTIVITY';
const RECENT_MONTHS = 24;
/* the pipeline order of the evidence a project can carry (furthest evidenced stage wins; earlier ones may lack evidence) */
const STAGES = ['land-awarded', 'marketed', 'permitted', 'construction-started', 'completed', 'occupied'];

const decisionDate = (r) => r.committeeDate || r.lotteryDate || r.closeDate || null;
const minD = (a, b) => (!a ? b || null : !b ? a : a < b ? a : b);
const maxD = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b);
function monthsBefore(today, n) {
  const d = new Date(today + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, d.getUTCDate())).toISOString().slice(0, 10);
}

function newTally() {
  return { lots: 0, tenders: new Set(), units: 0, unitsLots: 0, landTotal: 0, landLots: 0, perUnitLand: 0, perUnitUnits: 0, psmLots: 0, fixedLots: 0, first: null, last: null,
    lotteries: 0, firstLotteries: 0, projects: new Set(), unitsFirst: 0, unitsFirstN: 0, applicantsFirst: 0, applicantsFirstN: 0, lotFirst: null, lotLast: null };
}
function newDev(canonical) {
  return { id: devId(canonical), name: canonical, kind: kindOf(canonical), joint: isJoint(canonical), variants: new Map(), roles: new Set(),
    all: newTally(), recent: newTally(), tracks: new Map(), cities: new Map(), sites: [], projects: [],
    construction: { lots: 0, buildings: 0, units: 0, started: 0, completed: 0, firstStart: null, lastCompletion: null, asOf: null } };
}
const cityOf = (D, code) => { if (!D.cities.has(code)) D.cities.set(code, { localityCode: code, lots: 0, units: 0, lotteries: 0, projects: new Set(), first: null, last: null }); return D.cities.get(code); };

/** construction evidence of ONE lot: the MoCH progress rows joined to its tender by exact block + parcel, for this lot */
function lotConstruction(r, lotId) {
  const links = ((r.construction && r.construction.links) || []).filter((l) => l.lotId === lotId);
  if (!links.length) return null;
  const starts = links.map((l) => l.stages && (l.stages.excavation || l.stages.foundations)).filter(Boolean).sort();
  const ends = links.map((l) => l.stages && (l.stages.completion || l.stages['form-4'])).filter(Boolean).sort();
  return { buildings: links.length, units: links.reduce((s, l) => s + (l.units || 0), 0) || null, started: starts.length, completed: ends.length,
    firstStart: starts[0] || null, lastCompletion: ends[ends.length - 1] || null, asOf: links.map((l) => l.asOf).filter(Boolean).sort().pop() || null,
    join: 'exact-block-parcel', source: 'datagov:moch:construction-progress' };
}

/**
 * Build the registry.
 *   tenders    the stored ILA tender records (slim shape, winners with lotId / name / amount / units)
 *   lotteries  the stored MoCH lottery records
 *   cityName   (localityCode) → {he, en} | null
 *   today      YYYY-MM-DD (the "recent" window is the RECENT_MONTHS before it)
 */
function buildRegistry({ tenders = [], lotteries = [], cityName = () => null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const since = monthsBefore(today, RECENT_MONTHS);
  const devs = new Map();
  const dev = (canonical) => { if (!devs.has(canonical)) devs.set(canonical, newDev(canonical)); return devs.get(canonical); };
  const cov = { ila: { awardedTenders: 0, awardedLots: 0, residentialAwardedLots: 0, winnerStrings: new Set(), listedStrings: new Set(), unmarkedStrings: new Set(), unmarkedLots: 0 },
    moch: { lotteries: 0, projects: new Set(), developerStrings: new Set(), noDeveloper: 0, lotteryDateFrom: null, lotteryDateTo: null } };
  const sites = [];

  /* ---- 1 · ILA awarded lots (status-coded awards only — a published tender's stale winner column is never a win) */
  for (const r of tenders) {
    if (r.inLatestSource === false || r.lifecycle !== 'awarded' || !Array.isArray(r.winners) || !r.winners.length) continue;
    cov.ila.awardedTenders++;
    const date = decisionDate(r), isRecent = !!date && date >= since, residential = RESIDENTIAL.has(r.track);
    const refs = new Map((r.lotRefs || []).map((x) => [x.id, x]));
    for (const w of r.winners) {
      cov.ila.awardedLots++; if (residential) cov.ila.residentialAwardedLots++;
      const canonical = canonicalName(w.name);
      if (!canonical) continue;
      cov.ila.winnerStrings.add(canonical);
      if (!LISTED_KINDS.has(kindOf(canonical))) { cov.ila.unmarkedStrings.add(canonical); cov.ila.unmarkedLots++; continue; }
      cov.ila.listedStrings.add(canonical);
      const D = dev(canonical);
      D.roles.add('ila-tender-winner');
      D.variants.set(w.name, (D.variants.get(w.name) || 0) + 1);
      D.tracks.set(r.track || 'unknown', (D.tracks.get(r.track || 'unknown') || 0) + 1);
      for (const T of isRecent ? [D.all, D.recent] : [D.all]) {
        T.lots++; T.tenders.add(r.id);
        if (residential && w.units) { T.units += w.units; T.unitsLots++; }
        if (r.priceBasis === 'competitive-bid' && w.amount != null) { T.landTotal += w.amount; T.landLots++; if (residential && w.units) { T.perUnitLand += w.amount; T.perUnitUnits += w.units; } }   // per unit: residential lots only, the same lots on both sides
        else if (r.priceBasis === 'price-per-sqm-bid') T.psmLots++;
        else if (r.priceBasis === 'fixed-price-allocation') T.fixedLots++;
        T.first = minD(T.first, date); T.last = maxD(T.last, date);
      }
      if (r.localityCode) { const C = cityOf(D, r.localityCode); C.lots++; if (residential && w.units) C.units += w.units; C.first = minD(C.first, date); C.last = maxD(C.last, date); }
      const cons = lotConstruction(r, w.lotId);
      if (cons) {
        const K = D.construction; K.lots++; K.buildings += cons.buildings; K.units += cons.units || 0; K.started += cons.started; K.completed += cons.completed;
        K.firstStart = minD(K.firstStart, cons.firstStart); K.lastCompletion = maxD(K.lastCompletion, cons.lastCompletion); K.asOf = maxD(K.asOf, cons.asOf);
      }
      if (!residential) continue;
      const ref = refs.get(w.lotId) || null;
      const site = { id: `ila:${r.michrazId}:${w.lotId}`, kind: 'ila-awarded-lot', tenderId: r.id, michrazId: r.michrazId, tender: r.name || null, lotId: w.lotId,
        developerId: D.id, developerName: w.name, localityCode: r.localityCode || null, neighborhood: r.neighborhood || null, track: r.track || null,
        units: w.units ?? null, priceBasis: r.priceBasis || null,
        landPrice: r.priceBasis === 'competitive-bid' || r.priceBasis === 'fixed-price-allocation' ? w.amount ?? null : null,
        landPerUnit: (r.priceBasis === 'competitive-bid' || r.priceBasis === 'fixed-price-allocation') && w.amount != null && w.units ? Math.round(w.amount / w.units) : null,
        bidPerSqm: r.priceBasis === 'price-per-sqm-bid' ? w.amount ?? null : null,
        decisionDate: date, publishedDate: r.publishedDate || null,
        planLots: ref ? ref.keys || [] : [], parcels: ref ? ref.parcels || [] : [],
        construction: cons, lat: r.geometry ? r.geometry.lat ?? null : null, lng: r.geometry ? r.geometry.lng ?? null : null,
        provenance: { source: 'rmi:michrazim', detailFetchedAt: r.provenance && r.provenance.detail ? r.provenance.detail.fetchedAt : null } };
      site.stage = stageOf(site);
      sites.push(site); D.sites.push(site.id);
    }
  }

  /* ---- 2 · MoCH lottery projects (grouped on the Ministry's ProjectID) */
  const byProject = new Map();
  for (const h of lotteries) {
    if (h.recordType && h.recordType !== 'lottery') continue;
    cov.moch.lotteries++;
    cov.moch.lotteryDateFrom = minD(cov.moch.lotteryDateFrom, h.lotteryDate); cov.moch.lotteryDateTo = maxD(cov.moch.lotteryDateTo, h.lotteryDate);
    if (h.projectId == null) continue;
    if (!byProject.has(h.projectId)) byProject.set(h.projectId, []);
    byProject.get(h.projectId).push(h);
  }
  const projects = [];
  for (const [pid, rows] of byProject) {
    cov.moch.projects.add(pid);
    rows.sort((a, b) => String(a.lotteryDate || '').localeCompare(String(b.lotteryDate || '')) || a.lotteryId - b.lotteryId);
    const first = rows.find((x) => x.lotteryType === 'first') || rows[0], latest = rows[rows.length - 1];
    const names = [...new Set(rows.map((x) => canonicalName(x.developer)).filter(Boolean))];
    const p = { id: `moch:${pid}`, kind: 'moch-lottery-project', projectId: pid, name: latest.projectName || null,
      developerName: latest.developer || null, developerNames: names, developerIds: [],
      localityCode: latest.localityCode || null, neighborhood: latest.neighborhood || null, program: latest.program || null, programHe: latest.programHe || null,
      marketingBodyHe: latest.marketingBodyHe || null,
      lotteries: rows.map((x) => ({ lotteryId: x.lotteryId, type: x.lotteryType, date: x.lotteryDate || null, units: x.unitsInLottery ?? null, applicants: x.applicants ?? null, winners: x.winners ?? null, status: x.lotteryStatus || null })),
      firstLotteryDate: first.lotteryDate || null, lastLotteryDate: latest.lotteryDate || null, continuationLotteries: rows.filter((x) => x.lotteryType === 'continuation').length,
      unitsFirstLottery: first.unitsInLottery ?? null, unitsLatestOffered: latest.unitsInLottery ?? null,
      pricePerSqm: latest.pricePerSqm ?? null,
      permitStage: latest.permitStage || null, permitStatusHe: latest.permitStatusHe || null, projectStage: latest.projectStage || null, projectStatusHe: latest.projectStatusHe || null,
      demand: { applicantsFirst: first.applicants ?? null, unitsFirst: first.unitsInLottery ?? null,
        applicantsPerUnit: first.applicants != null && first.unitsInLottery ? Math.round((first.applicants / first.unitsInLottery) * 10) / 10 : null, basis: 'DERIVED: first-lottery applicants ÷ first-lottery units' },
      provenance: { source: (latest.provenance && latest.provenance.source) || 'datagov:moch:dira-behanacha-lotteries', resourceId: latest.provenance ? latest.provenance.resourceId : null,
        sourceUpdatedAt: latest.provenance ? latest.provenance.sourceUpdatedAt : null, fetchedAt: latest.provenance ? latest.provenance.fetchedAt : null } };
    p.stage = stageOf(p);
    projects.push(p);
    for (const canonical of names) {
      cov.moch.developerStrings.add(canonical);
      const D = dev(canonical);
      D.roles.add('moch-lottery-developer');
      p.developerIds.push(D.id);
      D.projects.push(p.id);
      for (const x of rows) if (canonicalName(x.developer) === canonical) D.variants.set(x.developer, (D.variants.get(x.developer) || 0) + 1);
      const own = rows.filter((x) => canonicalName(x.developer) === canonical);
      const firstOwn = own.find((x) => x.lotteryType === 'first') || null;
      for (const x of own) {
        const isRecent = !!x.lotteryDate && x.lotteryDate >= since;
        for (const T of isRecent ? [D.all, D.recent] : [D.all]) {
          T.lotteries++; T.projects.add(pid); T.lotFirst = minD(T.lotFirst, x.lotteryDate); T.lotLast = maxD(T.lotLast, x.lotteryDate);
          if (x === firstOwn) { T.firstLotteries++; if (x.unitsInLottery != null) { T.unitsFirst += x.unitsInLottery; T.unitsFirstN++; } if (x.applicants != null) { T.applicantsFirst += x.applicants; T.applicantsFirstN++; } }
        }
        if (p.localityCode) { const C = cityOf(D, p.localityCode); C.lotteries++; C.projects.add(pid); C.first = minD(C.first, x.lotteryDate); C.last = maxD(C.last, x.lotteryDate); }
      }
    }
    if (!names.length) cov.moch.noDeveloper++;
  }

  /* ---- 3 · entities out, possible-same links, market entries */
  const listed = [...devs.values()].filter((D) => LISTED_KINDS.has(D.kind) || D.roles.has('moch-lottery-developer'));
  const byCanonical = new Map(listed.map((D) => [D.name, D]));
  const possible = [];
  for (const D of listed) {
    if (!looksCut(D.name)) continue;
    const longer = listed.filter((x) => x !== D && x.name.length > D.name.length && x.name.startsWith(D.name));
    if (longer.length === 1) possible.push([D, longer[0]]);
  }
  const out = listed.map((D) => entityOut(D, cityName, since)).sort((a, b) => (b.tenders.residentialUnits || 0) - (a.tenders.residentialUnits || 0) || b.tenders.lots - a.tenders.lots || a.name.localeCompare(b.name, 'he'));
  const outById = new Map(out.map((e) => [e.id, e]));
  const link = (a, b, ev) => { if (!outById.get(a.id).possibleSame.some((x) => x.id === b.id)) outById.get(a.id).possibleSame.push({ id: b.id, name: outById.get(b.id).name, ...ev }); };
  for (const [a, b] of possible) {
    const ev = { evidence: 'strict-prefix', note: 'this name is a strict prefix of exactly one other listed name and its text looks cut by the source — a possible same entity, NOT merged' };
    link(a, b, ev); link(b, a, ev);
  }
  const byLetters = new Map();
  for (const D of listed) { const k = lettersKey(D.name); if (!byLetters.has(k)) byLetters.set(k, []); byLetters.get(k).push(D); }
  let letterGroups = 0;
  for (const g of byLetters.values()) {
    if (g.length < 2) continue;
    letterGroups++;
    const ev = { evidence: 'same-letters', note: 'the same letters in the same order, written with different punctuation or spacing — a possible same entity, NOT merged' };
    for (const a of g) for (const b of g) if (a !== b) link(a, b, ev);
  }
  for (const x of [...sites, ...projects]) { const nm = cityName(x.localityCode); x.city = nm ? nm.he : null; x.cityEn = nm ? nm.en : null; }
  /* DEVELOPER MARKET ENTRY (DERIVED): a city where a developer's first observed activity falls inside the recent window,
     for a developer already active elsewhere BEFORE that window — an established developer seen in a new market */
  const entries = [];
  for (const e of out) {
    const firstEver = e.firstActivity;
    if (!firstEver || firstEver >= since) continue;
    for (const m of e.markets) if (m.first && m.first >= since) entries.push({ developerId: e.id, developer: e.name, localityCode: m.localityCode, city: m.city, cityEn: m.cityEn, date: m.first, via: m.via, earlierActivityFrom: firstEver });
  }
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const coverage = {
    basis: BASIS, builtFor: today, recentFrom: since, recentMonths: RECENT_MONTHS,
    ila: { awardedTenders: cov.ila.awardedTenders, awardedLots: cov.ila.awardedLots, residentialAwardedLots: cov.ila.residentialAwardedLots, winnerStrings: cov.ila.winnerStrings.size,
      listedWinnerStrings: cov.ila.listedStrings.size, unmarkedWinnerStrings: cov.ila.unmarkedStrings.size, unmarkedLots: cov.ila.unmarkedLots,
      note: 'awarded lots of detail-read tenders only; a winner string without a legal-form marker (usually a private person) is counted, never listed' },
    moch: { lotteries: cov.moch.lotteries, projects: cov.moch.projects.size, developerStrings: cov.moch.developerStrings.size, projectsWithoutDeveloper: cov.moch.noDeveloper,
      lotteryDateFrom: cov.moch.lotteryDateFrom, lotteryDateTo: cov.moch.lotteryDateTo },
    developers: out.length, inBothSources: out.filter((e) => e.roles.length > 1).length, possibleSamePrefixPairs: possible.length, possibleSameLetterGroups: letterGroups,
    projects: { mochProjects: projects.length, ilaSites: sites.length, crossSourceJoins: 0, crossSourceNote: 'no shared official key between the lottery records and the tender lots — never joined' },
  };
  return { developers: out, projects, sites, entries, coverage };
}

function stageOf(p) {
  const ev = [];
  if (p.kind === 'ila-awarded-lot') {
    ev.push({ stage: 'land-awarded', date: p.decisionDate, source: 'rmi:michrazim' });
    if (p.construction && p.construction.started) ev.push({ stage: 'construction-started', date: p.construction.firstStart, source: p.construction.source, asOf: p.construction.asOf });
    if (p.construction && p.construction.completed) ev.push({ stage: 'completed', date: p.construction.lastCompletion, source: p.construction.source, asOf: p.construction.asOf, partial: p.construction.completed < p.construction.buildings });
  } else {
    if (p.firstLotteryDate) ev.push({ stage: 'marketed', date: p.firstLotteryDate, source: p.provenance.source });
    if (p.permitStage === 'full' || p.permitStage === 'full-partial') ev.push({ stage: 'permitted', date: null, source: p.provenance.source, partial: p.permitStage === 'full-partial', label: p.permitStatusHe });
    if (p.projectStage === 'post-occupancy') ev.push({ stage: 'occupied', date: null, source: p.provenance.source, label: p.projectStatusHe });
  }
  ev.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  return { furthest: ev.length ? ev[ev.length - 1].stage : null, evidence: ev, basis: 'the furthest stage with direct evidence in PROPX sources; an earlier stage may simply lack evidence' };
}

function entityOut(D, cityName, since) {
  const t = (T) => ({ lots: T.lots, tenders: T.tenders.size, residentialUnits: T.unitsLots ? T.units : null, unitsKnownLots: T.unitsLots,
    landTotalCompetitive: T.landLots ? T.landTotal : null, landLots: T.landLots,
    landPerUnit: T.perUnitUnits ? Math.round(T.perUnitLand / T.perUnitUnits) : null, landPerUnitBasis: 'Σ winning sums ÷ Σ units over the same residential competitive-bid lots that publish units',
    perSqmLots: T.psmLots, fixedPriceLots: T.fixedLots, firstWin: T.first, lastWin: T.last });
  const l = (T) => ({ lotteries: T.lotteries, firstLotteries: T.firstLotteries, projects: T.projects.size, unitsFirstLotteries: T.unitsFirstN ? T.unitsFirst : null,
    applicantsFirstLotteries: T.applicantsFirstN ? T.applicantsFirst : null, firstLottery: T.lotFirst, lastLottery: T.lotLast });
  const markets = [...D.cities.values()].map((C) => {
    const nm = cityName(C.localityCode);
    return { localityCode: C.localityCode, city: nm ? nm.he : null, cityEn: nm ? nm.en : null, lotsWon: C.lots, residentialUnitsWon: C.lots ? C.units || null : null,
      lotteries: C.lotteries, projects: C.projects.size, first: C.first, last: C.last, via: C.lots && C.lotteries ? 'both' : C.lots ? 'ila-win' : 'moch-lottery' };
  }).sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : 0));
  const firstActivity = [D.all.first, D.all.lotFirst].filter(Boolean).sort()[0] || null;
  const lastActivity = [D.all.last, D.all.lotLast].filter(Boolean).sort().pop() || null;
  const variants = [...D.variants.entries()].sort((a, b) => b[1] - a[1]);
  return { id: D.id, name: variants.length ? variants[0][0] : D.name, canonical: D.name, kind: D.kind, joint: D.joint, roles: [...D.roles].sort(),
    aliases: variants.map(([name, n]) => ({ name, occurrences: n, evidence: name === D.name ? 'source-string' : 'typographic-variant' })),
    companyId: null, companyIdNote: 'not published by these sources',
    tenders: t(D.all), tendersRecent: t(D.recent), lotteries: l(D.all), lotteriesRecent: l(D.recent),
    tracks: Object.fromEntries([...D.tracks.entries()].sort((a, b) => b[1] - a[1])),
    construction: D.construction.lots ? { ...D.construction, source: 'datagov:moch:construction-progress', join: 'exact-block-parcel, awarded lots only', stale: true } : null,
    markets, cities: markets.length, firstActivity, lastActivity, active: !!lastActivity && lastActivity >= since,
    sites: D.sites, projects: D.projects, possibleSame: [], search: searchKey(D.name), basis: BASIS };
}

module.exports = { buildRegistry, stageOf, RESIDENTIAL, STAGES, BASIS, RECENT_MONTHS, monthsBefore };
