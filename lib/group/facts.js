// PROPX · SPONSOR X-RAY — the facts of ONE project record (an ILA awarded lot or a MoCH lottery project), read with the SAME rule
// the project due diligence uses (lib/dd/project.js): the sites / permits that join it by an exact key, the stage ladder that only
// STRONG / VERIFIED links move, the timeline of official dates, the "no later public evidence" rule. One function serves the group's
// own rows AND the national cohort (lib/group/cohort.js), so a group is always compared with the same rule over every lot.
'use strict';

const PRJ = require('../dd/project');
const { monthsBetween } = require('../dd/developer');
const { RULES, TLV_ACTIVE_STATES, programmeOfTrack, marketOfTrack } = require('./model');

const day = (v) => (v ? String(v).slice(0, 10) : null);
const RANK = ['land-awarded', 'marketed', 'permitted', 'construction-started', 'completed', 'occupied'];
function addMonths(d, n) { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, x.getUTCDate())).toISOString().slice(0, 10); }

/* the plan approval date of a lot: the tender record's exact XPlan join for a plan the lot's own plan|lot keys name (latest
   approval among them); never by name or geometry */
function planApprovalOf(p, landById) {
  const rec = landById && p.tenderId ? landById.get(p.tenderId) : null; if (!rec || !Array.isArray(rec.plans)) return null;
  const mine = new Set((p.planLots || []).map((k) => String(k).split('|')[0].replace(/\s+/g, '')).filter(Boolean));
  const dates = rec.plans.filter((x) => x && x.xplan && mine.has(String(x.plan || '').replace(/\s+/g, '')) && x.xplan.approvalDate).map((x) => ({ plan: x.plan, date: day(x.xplan.approvalDate), station: x.xplan.station || null }));
  dates.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return dates[0] || null;
}

/**
 * recordFacts(p, K, { devLight, today, consAsOf, landById })
 *   p         a registry record (lib/entities/registry.js site or project)
 *   K         { c: the DD rows (lib/dd/data.js), lotIdx }
 *   devLight  { identity: { resolution: { state, chosen } } } of the record's developer (the second key of a site link)
 *   today     YYYY-MM-DD; consAsOf = the MoCH construction-progress rows' as-of date (the end of their coverage)
 */
function recordFacts(p, K, { devLight = null, today, consAsOf, landById = null } = {}) {
  const ila = p.kind === 'ila-awarded-lot';
  const S = PRJ.sitesOf(p, K.c, { devDD: devLight, lotIdx: K.lotIdx });
  const ladder = PRJ.ladderOf(p, S);
  const timeline = PRJ.timelineOf(p, S, K.c);
  const covered = S.isTlv || p.kind === 'moch-lottery-project';
  const gap = PRJ.gapOf(timeline, ladder, today, covered);
  const rung = (s) => (ladder.rungs || []).find((r) => r.stage === s) || null;
  const rStart = rung('construction-started'), rPermit = rung('permitted'), rDone = rung('completed'), rOcc = rung('occupied');
  const award = ila ? day(p.decisionDate) : null;
  const okD = (d) => !!d && (!award || day(d) >= award);
  const fi = RANK.indexOf(ladder.furthest);
  /* a CURRENT active site: a STRONG Ministry of Labour site still on the latest list, or a STRONG Tel Aviv site whose state says works are under way */
  const listDay = K.c.freshness && K.c.freshness.sites ? day(K.c.freshness.sites.checkedAt) : null;
  const curLabour = S.labour.filter((x) => x.onLadder && listDay && x.lastSeen && day(x.lastSeen) >= listDay);
  const curTlv = S.tlv.filter((x) => x.onLadder && TLV_ACTIVE_STATES.has(String(x.state || '')));
  const currentActive = curLabour.length + curTlv.length > 0 && fi < RANK.indexOf('completed');
  /* the stage's class: OFFICIAL only when the furthest rung rests on the project's own official record (as lib/dd/project.js summaryOf) */
  const fr = rung(ladder.furthest);
  const stageCls = fr && fr.evidenced && !fr.ddEvidenced && !/construction-progress/.test(String(fr.source || '')) ? 'OFFICIAL' : fr && fr.evidenced ? 'DERIVED' : 'OFFICIAL';
  const startDate = rStart && rStart.evidenced && okD(rStart.date) ? day(rStart.date) : null;
  const startAsOf = rStart && rStart.evidenced && !startDate ? day(rStart.ddAsOf || rStart.asOf) : null;
  const permitDate = rPermit && rPermit.evidenced && okD(rPermit.date) ? day(rPermit.date) : null;
  const doneDate = rDone && rDone.evidenced && rDone.date ? day(rDone.date) : null;
  const ref = ila ? award : day(p.lastLotteryDate || p.firstLotteryDate);
  const sinceRef = ref ? monthsBetween(ref, today) : null;
  let bucket;
  if (ladder.furthest === 'occupied') bucket = 'OCCUPANCY';
  else if (ladder.furthest === 'completed') bucket = 'COMPLETION';
  else if (ladder.furthest === 'construction-started') bucket = currentActive ? 'ACTIVE_SITE' : 'CONSTRUCTION';
  else if (ladder.furthest === 'permitted') bucket = 'PERMIT';
  else bucket = sinceRef != null && sinceRef < RULES.noLaterEvidenceMonths ? (ila ? 'LAND' : 'MARKETED') : 'NO_LATER_EVIDENCE';
  /* the end of the window in which a dated start / completion COULD be observed for this record: Tel Aviv lots are read live; elsewhere
     a dated start or completion comes only from the MoCH construction-progress rows (as of consAsOf) */
  const obsEnd = S.isTlv ? today : consAsOf;
  const plan = ila ? planApprovalOf(p, landById) : null;
  const dur = (a, b) => (a && b && b >= a ? monthsBetween(a, b) : null);
  const strongSites = S.tlv.filter((x) => x.onLadder).length + S.labour.filter((x) => x.onLadder).length;
  const possibleSites = S.tlv.length + S.labour.length - strongSites;
  const contractors = [...new Map(S.labour.filter((s) => s.executor && s.executor.kablan && s.matchState === 'STRONG_MATCH').map((s) => [s.executor.kablan, { kablan: s.executor.kablan, name: s.executor.name, company: s.executor.company, matchState: 'STRONG_MATCH', sites: [s.id] }])).values()];
  return {
    id: p.id, kind: p.kind, universe: ila ? 'ila' : 'moch', tender: ila ? String(p.tenderId || p.michrazId || '') || null : null, localityCode: p.localityCode != null ? String(p.localityCode) : null, isTlv: S.isTlv,
    track: ila ? p.track || null : null, programme: ila ? programmeOfTrack(p.track) : 'SUBSIDIZED', market: ila ? marketOfTrack(p.track) : 'subsidized',
    units: ila ? (p.units ?? null) : (p.unitsFirstLottery ?? null),
    award, firstLottery: ila ? null : day(p.firstLotteryDate), lastLottery: ila ? null : day(p.lastLotteryDate),
    furthest: ladder.furthest, bucket, stageCls,
    permit: { evidenced: !!(rPermit && rPermit.evidenced), date: permitDate, source: rPermit ? rPermit.ddSource || rPermit.source || null : null },
    start: { evidenced: !!(rStart && rStart.evidenced), date: startDate, asOf: startAsOf, source: rStart ? rStart.ddSource || rStart.source || null : null, current: currentActive, stale: !!(rStart && rStart.evidenced) && !currentActive && /construction-progress/.test(String(rStart.source || rStart.ddSource || '')) },
    completion: { evidenced: !!(rDone && rDone.evidenced), date: doneDate, source: rDone ? rDone.ddSource || rDone.source || null : null, partial: !!(rDone && rDone.partial) },
    occupied: { evidenced: !!(rOcc && rOcc.evidenced), source: rOcc ? rOcc.ddSource || rOcc.source || null : null },
    durations: { awardToStart: dur(award, startDate), awardToPermit: dur(award, permitDate), permitToStart: dur(permitDate, startDate), startToCompletion: dur(startDate, doneDate), planToStart: dur(plan && plan.date, startDate) },
    plan, obsEnd,
    startObservable: !!(award && addMonths(award, RULES.startHorizonMonths) <= obsEnd),
    startedWithinHorizon: !!(award && startDate && startDate <= addMonths(award, RULES.startHorizonMonths)),
    completionObservable: !!(award && addMonths(award, RULES.completionHorizonMonths) <= obsEnd),
    unfinishedObservable: !!(startDate && addMonths(startDate, RULES.unfinishedStartMonths) <= obsEnd),
    lastDatedEvidence: gap.lastDatedEvidence, noLaterEvidence: gap.noLaterEvidence, executionGap: gap.executionGap.fires, coverageGap: !!gap.coverageGap, covered,
    sinceReferenceMonths: sinceRef,
    sites: { strong: strongSites, possible: possibleSites, parcelHistory: S.parcelHistory.length, currentLabour: curLabour.map((x) => x.id), currentTlv: curTlv.map((x) => x.id), permitsOnLadder: S.permits.filter((x) => x.onLadder).length },
    contractors, permitHolders: [...new Set(S.tlv.filter((x) => x.onLadder).flatMap((x) => x.holders || []))],
    rungs: (ladder.rungs || []).filter((r) => r.evidenced).map((r) => ({ stage: r.stage, date: r.date || null, source: r.ddSource || r.source || null, asOf: r.ddAsOf || r.asOf || null, viaLink: !!r.ddEvidenced })),
    _S: S,
  };
}

module.exports = { recordFacts, addMonths, planApprovalOf, RANK };
