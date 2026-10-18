// PROPX · SPONSOR X-RAY — the NATIONAL COHORT: the same record facts (lib/group/facts.js) over EVERY awarded lot and lottery project
// PROPX holds, memoised per data stamp. It is the comparison basis of every group signal ("vs relevant cohort"), so a group is never
// labelled faster / slower / concentrated without the same rule over everyone else. Nothing here ranks a developer.
'use strict';

const R = require('../entities/resolve');
const { recordFacts } = require('./facts');
const { RULES } = require('./model');

const median = (xs) => { const s = xs.filter((x) => x != null).slice().sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : Math.round(((s[n / 2 - 1] + s[n / 2]) / 2) * 10) / 10) : null; };
const quantile = (xs, q) => { const s = xs.filter((x) => x != null).slice().sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 10) / 10; };
const dist = (xs) => { const s = xs.filter((x) => x != null); return s.length ? { n: s.length, median: median(s), p25: quantile(s, 0.25), p75: quantile(s, 0.75), min: Math.min(...s), max: Math.max(...s) } : { n: 0, median: null, p25: null, p75: null, min: null, max: null }; };
const light = (res) => ({ identity: { resolution: { state: res.state, chosen: res.chosen ? R.companyFacts(res.chosen) : null } } });

/* the as-of date of the MoCH construction-progress rows (the end of their coverage) — from the data, never assumed */
function consAsOfOf(sites) { let a = null; for (const s of sites) if (s.construction && s.construction.asOf && (!a || s.construction.asOf > a)) a = s.construction.asOf; return a ? String(a).slice(0, 10) : '2024-03-01'; }

let MEMO = null;
/** K = lib/dd/index.js ctx(): { L, c, lotIdx, now } — returns { facts: Map<id, facts>, resByDev, groupOf, consAsOf, start, early, unfinished, completion, load, today } */
function cohort(K) {
  const today = String(K.now).slice(0, 10);
  const key = `${K.L.stamp}|${K.c.stamp}|${today}`;
  if (!K.c.live && MEMO && MEMO.key === key) return MEMO.v;
  const consAsOf = consAsOfOf(K.L.R.sites);
  const resByDev = new Map();
  for (const dv of K.L.R.developers) resByDev.set(dv.id, R.resolveCompany({ id: dv.id, canonical: dv.canonical, kind: dv.kind, joint: dv.joint }, K.c.idx));
  const facts = new Map();
  for (const p of K.L.R.sites) { const r = resByDev.get(p.developerId); facts.set(p.id, recordFacts(p, K, { devLight: r ? light(r) : null, today, consAsOf, landById: K.L.landById })); }
  for (const p of K.L.R.projects) { const r = resByDev.get((p.developerIds || [])[0]); facts.set(p.id, recordFacts(p, K, { devLight: r ? light(r) : null, today, consAsOf, landById: K.L.landById })); }
  /* a "group" for the load distribution = the legal company a brand resolves to (STRONG / VERIFIED), else the brand itself — the same
     unit Sponsor X-Ray reads */
  const groupOf = (devId) => { const r = resByDev.get(devId); return r && r.chosen && (r.state === 'STRONG_MATCH' || r.state === 'VERIFIED') ? 'co:' + r.chosen.num : 'dev:' + devId; };
  const ila = [...facts.values()].filter((f) => f.universe === 'ila');
  const v = { key, today, consAsOf, facts, resByDev, groupOf, ...aggregates(ila, K.L.R.sites, groupOf) };
  for (const f of facts.values()) delete f._S;   /* the raw site objects are not kept in the memo */
  if (!K.c.live) MEMO = { key, v };
  return v;
}

/* lots of ONE tender are not independent observations (one tender often carries many lots with one start date): every comparison
   also counts the distinct tenders, and a duration's comparison median is taken over TENDERS (each tender = the median of its lots) */
const tendersOf = (xs) => new Set(xs.map((f) => f.tender).filter(Boolean)).size;
function byTender(xs, val) { const m = new Map(); for (const f of xs) { const v = val(f); if (v == null) continue; const k = f.tender || f.id; if (!m.has(k)) m.set(k, []); m.get(k).push(v); } return [...m.values()].map((vs) => median(vs)); }
/** the comparison statistics over a set of ILA lot facts (the cohort — or, called with a group's own facts, the group) */
function shares(ila) {
  const elig = ila.filter((f) => f.startObservable);
  const within = elig.filter((f) => f.startedWithinHorizon);
  const open = ila.filter((f) => !f.completion.evidenced && !f.occupied.evidenced);
  const early = open.filter((f) => f.furthest === 'land-awarded' && f.sinceReferenceMonths != null && f.sinceReferenceMonths < RULES.earlyStageMonths);
  const unfElig = ila.filter((f) => f.unfinishedObservable);
  const unf = unfElig.filter((f) => !f.completion.evidenced && !f.occupied.evidenced);
  const compElig = ila.filter((f) => f.completionObservable);
  const comp = compElig.filter((f) => f.completion.evidenced || f.occupied.evidenced);
  const sh = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    start: { eligible: elig.length, startedWithinHorizon: within.length, share: sh(within.length, elig.length), months: dist(within.map((f) => f.durations.awardToStart)), monthsByTender: dist(byTender(within, (f) => f.durations.awardToStart)), tenders: tendersOf(within), horizonMonths: RULES.startHorizonMonths },
    early: { open: open.length, early: early.length, share: sh(early.length, open.length), tenders: tendersOf(early), months: RULES.earlyStageMonths },
    unfinished: { eligible: unfElig.length, unfinished: unf.length, share: sh(unf.length, unfElig.length), tenders: tendersOf(unf), months: RULES.unfinishedStartMonths },
    completion: { eligible: compElig.length, completed: comp.length, share: sh(comp.length, compElig.length), tenders: tendersOf(comp), eligibleTenders: tendersOf(compElig), months: RULES.completionHorizonMonths },
  };
}
function aggregates(ila, sites, groupOf) {
  const all = shares(ila);
  /* by locality — the same statistics over the lots of each locality (for a locality cohort where it is meaningful) */
  const byLoc = new Map();
  for (const f of ila) { const k = f.localityCode || 'none'; if (!byLoc.has(k)) byLoc.set(k, []); byLoc.get(k).push(f); }
  const locality = new Map([...byLoc].map(([k, xs]) => [k, shares(xs)]));
  /* the observed execution load of every group (lots with construction-start evidence and no completion) — its distribution */
  const devOf = new Map(sites.map((s) => [s.id, s.developerId]));
  const load = new Map();
  for (const f of ila) { if (f.bucket !== 'CONSTRUCTION' && f.bucket !== 'ACTIVE_SITE') continue; const g = groupOf(devOf.get(f.id)); load.set(g, (load.get(g) || 0) + 1); }
  const L = [...load.values()];
  return { ...all, locality, load: { groups: L.length, p50: quantile(L, 0.5), p90: quantile(L, RULES.loadPercentile), max: L.length ? Math.max(...L) : null, basis: 'groups (a resolved legal company, else the brand) with ≥ 1 lot carrying construction-start evidence and no completion evidence' } };
}

module.exports = { cohort, shares, tendersOf, byTender, dist, median, quantile, light, consAsOfOf };
