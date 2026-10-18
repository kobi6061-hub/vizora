// PROPX · PROJECT DUE DILIGENCE (18.10.2026) — one institutional read of ONE project (a MoCH lottery project or an ILA
// awarded lot): its IDENTITY and every link with an explicit match state, the developer's legal identity and corporate
// flags, a VERIFIED DATED TIMELINE (official dates only; a PROPX observation is labelled as such), the stage ladder with a
// COVERAGE label on every rung, the construction sites and permit records that join it by an exact key (Tel Aviv) or by an
// official key read from free text (national, stated), the executing contractors, the EXECUTION GAP rule and the honest
// "NO LATER PUBLIC EVIDENCE FOUND" statement. Pure, additive beside Project Intelligence 2.0 (nothing there changes).
//
//   projectDD(p, cache, { now, developerDD })  →  { version, identity, developer, timeline, lastDatedEvidence,
//                                                  noLaterEvidence, ladder, sites, permits, contractors, executionGap,
//                                                  summary, coverage, missing, hardTruths, freshness, basis }
//
// Never: STALLED / FAILED / DELAYED (no rule can establish them from public sources); a parcel match ≠ the same project
// when the parcel carries several records (flagged); a marketing name is never an identity; a permit ≠ a construction
// start ≠ a completion; a site missing from a list ≠ a stopped project.
'use strict';

const R = require('../entities/resolve');
const { STAGES } = require('../entities/registry');
const { COVERAGE, HARD_TRUTHS, monthsBetween } = require('./developer');
const { parcelKeyOf } = require('./data');

const VERSION = Object.freeze({ id: 'propx-project-dd-v1', effective: '2026-10-18' });
const bi = (he, en) => ({ he, en });
const day = (v) => (v ? String(v).slice(0, 10) : null);
const SRC = R.SRC;
const GAP_MONTHS = 18;   /* the execution-gap rule: ≥ 18 months since the last DATED public evidence while the ladder is below completion */
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');

const link = (type, id, state, codes, source, extra = {}) => ({ type, id, state, reasons: codes.map(R.reason), source, ...extra });

/* ---- the project's links: every id with the match state of the key that carries it ------------------------------- */
function identityOf(p) {
  const L = [];
  if (p.kind === 'ila-awarded-lot') {
    L.push(link('TENDER', p.tenderId, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.ila, { key: bi('מספר מכרז (MichrazID)', 'MichrazID') }));
    L.push(link('LOT', p.id, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.ila, { key: bi('מספר תיק המגרש (TikID)', 'TikID (the lot file id)') }));
    for (const pl of p.planLots || []) { const [plan, lot] = String(pl).split('|'); L.push(link('PLAN', 'plan:' + String(plan).replace(/\s+/g, ''), 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.ila, { key: bi('מספר התוכנית בתיק המגרש', 'plan number printed on the lot file'), lotNumber: lot != null ? Number(lot) : null })); }
    for (const pc of p.parcels || []) { const k = parcelKeyOf(typeof pc === 'string' ? pc : `${pc.block}/${pc.parcel}`); if (k) L.push(link('BLOCK_PARCEL', k, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.ila, { key: bi('גוש/חלקה בתיק המגרש', 'GushHelka on the lot file') })); }
    if (p.developerId) L.push(link('LAND_WINNER', p.developerId, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.ila, { key: bi('שם הזוכה בתיק המגרש — המחרוזת עצמה; החברה הרשומה נפתרת בנפרד', 'winners[].name on the lot file — the string itself; the legal company behind it is resolved separately'), note: bi('הזוכה כפי שרמ״י רשמה; אינו בהכרח חברת הפרויקט', 'the winner as the Authority wrote it; not necessarily the project company') }));
  } else {
    L.push(link('PROJECT', p.id, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.moch, { key: bi('מספר פרויקט (ProjectID)', 'ProjectID') }));
    if (p.name) L.push({ type: 'MARKETING_NAME', id: null, value: p.name, state: null, reasons: [], source: SRC.moch, note: bi('שם שיווקי — תכונה של הפרויקט, לא זהות: אינו מצרף תוכנית, מגרש או היתר', 'a marketing name — an attribute, not an identity: it joins no plan, lot or permit') });
    for (const id of p.developerIds || []) L.push(link('PROJECT_OWNER', id, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], SRC.moch, { key: bi('שם היזם ברשומות ההגרלה', 'the developer string on the lottery rows'), note: bi('היזם כפי שמשב״ש רשם — שם, לא חברה', 'the developer as the Ministry lists it — a name, not a company') }));
    L.push({ type: 'BLOCK_PARCEL', id: null, state: 'UNRESOLVED', reasons: [R.reason('NO_REGISTRY_ROW_WITH_THIS_NAME')].map(() => ({ code: 'NO_KEY_ON_RECORD', he: 'רשומת ההגרלה אינה נושאת גוש/חלקה, תוכנית או מכרז', en: 'the lottery record carries no block/parcel, plan or tender' })), source: SRC.moch });
  }
  L.push(link('LOCALITY', 'loc:' + p.localityCode, 'VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], p.kind === 'ila-awarded-lot' ? SRC.ila : SRC.moch, { key: bi('סמל יישוב (למ״ס)', 'CBS locality code') }));
  return { ids: { project: p.id, tender: p.tenderId || null, lot: p.lotId || null, projectId: p.projectId || null }, kind: p.kind, marketingName: p.kind === 'moch-lottery-project' ? p.name || null : null, links: L,
    note: bi('שני עולמות ללא מפתח משותף: פרויקט הגרלה ומגרש שנזכה אינם מצורפים זה לזה', 'two universes without a shared key: a lottery project and an awarded lot are never joined to each other') };
}

/* ---- the sites and permits that join THIS project ------------------------------------------------------------------
   A parcel key identifies the LAND, not the project: the same parcel may carry an earlier building, an earlier tender's
   works or several buildings. A site / permit is linked to the project only:
     STRONG_MATCH   parcel key exact + every dated activity on / after the award decision + a second independent key: the
                    permit holder's (Tel Aviv) or the executor's company (national) = the developer's resolved legal company
                    or its exact normalized legal name
     POSSIBLE_MATCH parcel key exact + dates consistent (or undated) but no second key — shown, never on the stage ladder
     PRIOR ACTIVITY dated activity before the award decision — parcel history, never this project's evidence
   A lot number written in a site name (national list) fits ONE plan|lot pair in the locality → POSSIBLE; several → AMBIGUOUS. */
const holderKeys = (names) => new Set((names || []).map((h) => R.regKey(h)).filter(Boolean));
function devKeysOf(p, devDD) {
  const names = [p.developerName].concat((p.developers || []).map((d) => d.name)).filter(Boolean);
  const parts = names.flatMap((n) => [n, ...R.partiesOf(n)]);   /* the whole name always; the parties only where the string really splits */
  const company = devDD && devDD.identity.resolution.chosen && ['VERIFIED', 'STRONG_MATCH'].includes(devDD.identity.resolution.state) ? String(devDD.identity.resolution.chosen.number) : null;
  return { regKeys: new Set(parts.map((n) => R.regKey(n)).filter(Boolean)), company, companyState: devDD ? devDD.identity.resolution.state : null };
}
function sitesOf(p, cache, { devDD = null, lotIdx = null } = {}) {
  const parcelKeys = [...new Set((p.parcels || []).map((pc) => parcelKeyOf(typeof pc === 'string' ? pc : `${pc.block}/${pc.parcel}`)).filter(Boolean))];
  const lotNumbers = [...new Set((p.planLots || []).map((x) => Number(String(x).split('|')[1])).filter((n) => Number.isFinite(n)))];
  const isTlv = String(p.localityCode) === '5000';
  const award = p.decisionDate ? day(p.decisionDate) : null;
  const DK = devKeysOf(p, devDD);
  const tlv = [], labour = [], permits = [], parcelHistory = [], excluded = [];
  /* Tel Aviv: the sites layer by the exact parcel key (one site per supervision file), its permits by the permit numbers it lists */
  const seenTik = new Set();
  for (const k of parcelKeys) for (const site of cache.tlvSitesByParcel.get(k) || []) {
    if (seenTik.has(site.tik)) continue; seenTik.add(site.tik);
    const shared = (cache.tlvSitesByParcel.get(k) || []).length > 1;
    const prs = [...new Map([...(site.permits || []).flatMap((n) => cache.tlvPermitsByNumber.get(String(n)) || []), ...(site.file ? cache.tlvPermitsByFile.get(String(site.file)) || [] : [])].map((x) => [x.request, x])).values()];
    const dates = [site.start, ...prs.flatMap((x) => [x.opened, x.permitDate, x.start])].filter(Boolean).sort();
    const prior = award && dates.length && dates[dates.length - 1] < award;   /* every dated activity predates the award */
    const holderMatch = [...holderKeys(site.holderList)].some((h) => DK.regKeys.has(h));
    const reasons = [R.reason('EXACT_OFFICIAL_KEY_JOIN')]; if (shared) reasons.push(R.reason('PARCEL_SHARED_BY_SEVERAL_RECORDS'));
    const base = { id: 'site:tlv:' + site.tik, parcel: k, parcels: site.parcels, source: SRC.tlvSites, cls: 'OFFICIAL', coverage: COVERAGE.TLV_MUNICIPAL, state: site.state, start: site.start, supervision: site.supervision, supervisionDate: site.supervisionDate, use: site.use, address: site.address, holders: site.holderList, permitNumbers: site.permits, file: site.file || null, holderMatchesDeveloper: holderMatch };
    if (prior) {
      parcelHistory.push({ ...base, link: 'PRIOR_ACTIVITY', reasons: [R.reason('PRE_AWARD_ACTIVITY')], latestActivity: dates[dates.length - 1], award });
      for (const pr of prs) { const pd = [pr.opened, pr.permitDate, pr.start].filter(Boolean).sort(); parcelHistory.push({ id: 'permit:tlv:' + pr.request, parcel: k, link: 'PRIOR_ACTIVITY', reasons: [R.reason('PRE_AWARD_ACTIVITY')], viaSite: base.id, stage: pr.stage, permitDate: pr.permitDate, start: pr.start, latestActivity: pd[pd.length - 1] || null, award, source: SRC.tlvPermits, coverage: COVERAGE.TLV_MUNICIPAL }); }
      continue;
    }
    const before = award ? dates.filter((d) => d < award) : [];
    const state = holderMatch ? 'STRONG_MATCH' : 'POSSIBLE_MATCH';
    if (holderMatch) reasons.push(R.reason('HOLDER_IS_DEVELOPER_NAME')); else reasons.push(R.reason('NO_SECOND_KEY'));
    if (before.length) reasons.push(R.reason('SOME_ACTIVITY_PRE_AWARD'));
    tlv.push({ ...base, matchState: state, reasons, onLadder: state === 'STRONG_MATCH' });
    for (const pr of prs) {
      const pd = [pr.opened, pr.permitDate, pr.start].filter(Boolean).sort();
      if (award && pd.length && pd[pd.length - 1] < award) { parcelHistory.push({ id: 'permit:tlv:' + pr.request, parcel: k, link: 'PRIOR_ACTIVITY', reasons: [R.reason('PRE_AWARD_ACTIVITY')], viaSite: base.id, stage: pr.stage, permitDate: pr.permitDate, start: pr.start, latestActivity: pd[pd.length - 1], award, source: SRC.tlvPermits, coverage: COVERAGE.TLV_MUNICIPAL }); continue; }
      permits.push({ id: 'permit:tlv:' + pr.request, viaSite: base.id, matchState: state, onLadder: state === 'STRONG_MATCH', reasons: [R.reason('EXACT_OFFICIAL_KEY_JOIN')].concat(state === 'STRONG_MATCH' ? [] : [R.reason('NO_SECOND_KEY')]), key: bi('מספר ההיתר שהאתר מציין / תיק הבניין', 'the permit number the site lists (heterim) / the building file'), source: SRC.tlvPermits, cls: 'OFFICIAL', coverage: COVERAGE.TLV_MUNICIPAL,
        request: pr.request, permit: pr.permit, permitDate: pr.permitDate, expiry: pr.expiry, opened: pr.opened, units: pr.units, type: pr.type, stage: pr.stage, requestStage: pr.requestStage, start: pr.start, finished: pr.finished, occupation: pr.occupation, addresses: pr.addresses, imported: pr.imported });
    }
  }
  /* national (Ministry of Labour): a block/parcel written in the site name; a lot number + the locality */
  const seenW = new Set();
  for (const k of parcelKeys) for (const s of cache.sitesByParcel.get(k) || []) { if (seenW.has(s.workId)) continue; seenW.add(s.workId); labour.push(labourRow(s, null, ['OFFICIAL_KEY_FROM_FREE_TEXT'], cache, DK, k, null, null, award)); }
  for (const lot of lotNumbers) {
    const rows = cache.sitesByCityLot.get(`${p.localityCode}|${lot}`) || []; if (!rows.length) continue;
    const pairs = lotIdx ? (lotIdx.get(`${p.localityCode}|${lot}`) || new Set()) : new Set();
    for (const s of rows) {
      if (seenW.has(s.workId)) continue; seenW.add(s.workId);
      if (s.buildTypes && !/מגורים/.test(s.buildTypes) && p.track !== 'commercial' && p.track !== 'industrial') { excluded.push({ id: 'site:labor:' + s.workId, name: s.name, buildTypes: s.buildTypes, reasons: [R.reason('BUILD_TYPE_CONFLICT')] }); continue; }
      labour.push(labourRow(s, pairs.size > 1 ? 'AMBIGUOUS' : 'POSSIBLE_MATCH', pairs.size > 1 ? ['LOT_NUMBER_IN_FREE_TEXT', 'LOT_NUMBER_FITS_SEVERAL'] : ['LOT_NUMBER_IN_FREE_TEXT'], cache, DK, null, lot, pairs.size, award));
    }
  }
  return { tlv, labour, permits, parcelHistory, excluded, parcelKeys, lotNumbers, isTlv, award,
    coverage: { tlv: COVERAGE.TLV_MUNICIPAL, labour: COVERAGE.NATIONAL },
    note: isTlv ? bi('תל אביב-יפו: צירוף במפתח חלקה מדויק לשכבות האתרים וההיתרים העירוניות; פעילות שקדמה לזכייה היא היסטוריית החלקה', 'Tel Aviv-Yafo: joined by the exact parcel key to the municipal sites and permits layers; activity before the award is the parcel\'s history') : bi('מחוץ לתל אביב אין שכבת היתרים קריאה למכונה; אתרי משרד העבודה מצורפים רק במפתח שנקרא מטקסט חופשי', 'outside Tel Aviv there is no machine-readable permits layer; Ministry of Labour sites join only by a key read from free text') };
}
function labourRow(s, forced, codes, cache, DK, parcel, lot, pairs, award = null) {
  const ex = R.resolveContractor(s.executorId, cache.cidx); const co = ex.chosen ? R.contractorCompany(ex.chosen, cache.idx) : null;
  const exCompany = co && co.chosen ? String(co.chosen.num) : null;
  const sameCompany = !!(exCompany && DK.company && exCompany === DK.company), sameName = !!(s.executorName && DK.regKeys.has(R.regKey(s.executorName)));
  let state = forced, reasons = codes.slice();
  if (!state) { state = parcel && (sameCompany || sameName) ? 'STRONG_MATCH' : 'POSSIBLE_MATCH'; reasons.push(sameCompany ? 'EXECUTOR_IS_DEVELOPER_COMPANY' : sameName ? 'EXECUTOR_IS_DEVELOPER_NAME' : 'NO_SECOND_KEY'); }
  /* a site PROPX already saw listed BEFORE the award decision was active before this lot was awarded — never this project's
     construction evidence (the same rule as the municipal layers): POSSIBLE at most, off the ladder */
  if (award && s.firstSeen && String(s.firstSeen).slice(0, 10) < award) { if (state === 'STRONG_MATCH') state = 'POSSIBLE_MATCH'; reasons.push('LISTED_BEFORE_AWARD'); }
  return { id: 'site:labor:' + s.workId, name: s.name, city: s.city, buildTypes: s.buildTypes, cranes: s.cranes, firstSeen: s.firstSeen, lastSeen: s.lastSeen, sanctions: s.sanctions, warrants: s.warrants, parcel, lot: lot ?? null, lotPairs: pairs ?? null,
    matchState: state, onLadder: state === 'STRONG_MATCH', reasons: reasons.map(R.reason), source: SRC.sites, cls: 'OFFICIAL', coverage: COVERAGE.NATIONAL,
    executor: { name: s.executorName, id: s.executorId, resolution: ex.state, kablan: ex.chosen ? ex.chosen.kablan : null, company: co && co.chosen ? R.companyFacts(co.chosen) : null, companyState: co ? co.state : null, branches: ex.branches || [], isDeveloper: sameCompany || sameName },
    interpretation: bi('רישום אתר פעיל בפיקוח בטיחות — אין במקור תאריך התחלה; התאריכים הם תצפיות PROPX (נראה לראשונה / לאחרונה); אינו גמר', 'an active-site registration under safety supervision — the source publishes no start date; the dates are PROPX observations (first / last seen); not a completion') };
}

/* ---- the verified dated timeline -------------------------------------------------------------------------------- */
function timelineOf(p, S, cache) {
  /* an undated status (MoCH permit / project stage) is public evidence AS OF the source's update date — dated by that date, labelled */
  const own = p.intel && p.intel.timeline ? p.intel.timeline
    : ((p.stage && p.stage.evidence) || []).map((e) => ({ date: e.date || null, event: e.stage, label: bi(`ראיה לשלב: ${e.stage}`, `stage evidence: ${e.stage}`), source: e.source, cls: 'OFFICIAL', undated: !e.date }));   /* a bare registry record: its own dated stage evidence */
  const base = own.map((e) => ({ ...e, coverage: COVERAGE.PROJECT_LEVEL, dated: !!e.date, asOf: !!e.undated, onLadder: true, basis: e.undated ? 'the source\'s update date (the status itself is undated)' : 'official date' }));
  const ev = [...base];
  const add = (date, event, label, source, cls, extra = {}) => ev.push({ date: day(date), event, label, source, cls, dated: !!date, ...extra });
  const tag = (x) => (x.matchState === 'STRONG_MATCH' ? '' : bi(' — קישור אפשרי בלבד, לא בסולם', ' — possible link only, not on the ladder'));
  const award = S.award;
  const pre = (d) => !!(award && d && String(d).slice(0, 10) < award);
  const preTag = bi(' — לפני הזכייה: אינו ראיה לפרויקט, לא בסולם', ' — before the award: not this project\'s evidence, not on the ladder');
  const addL = (date, event, label, source, cls, extra) => { if (pre(date)) add(date, event, bi(label.he + preTag.he, label.en + preTag.en), source, cls, { ...extra, onLadder: false, preAward: true }); else add(date, event, label, source, cls, extra); };
  for (const s of S.tlv) {
    const t = tag(s);
    if (s.start) addL(s.start, 'work-start', bi(`תחילת עבודה בשכבת אתרי הבנייה של תל אביב (${s.id}; ${s.state || '—'})${t.he || ''}`, `work start on the Tel Aviv sites layer (${s.id}; ${s.state || '—'})${t.en || ''}`), SRC.tlvSites, 'OFFICIAL', { coverage: COVERAGE.TLV_MUNICIPAL, matchState: s.matchState, onLadder: s.onLadder, basis: 'official date', entity: s.id });
    if (s.supervisionDate) addL(s.supervisionDate, 'supervision-status', bi(`סטטוס פיקוח: ${s.supervision || '—'}${t.he || ''}`, `supervision status: ${s.supervision || '—'}${t.en || ''}`), SRC.tlvSites, 'OFFICIAL', { coverage: COVERAGE.TLV_MUNICIPAL, matchState: s.matchState, onLadder: s.onLadder, basis: 'official date', entity: s.id });
  }
  for (const pr of S.permits) {
    const t = tag(pr);
    if (pr.opened) addL(pr.opened, 'permit-request-opened', bi(`בקשת היתר ${pr.request} נפתחה (${pr.units != null ? fmt(pr.units) + ' יח״ד' : 'יח״ד —'})${t.he || ''}`, `permit request ${pr.request} opened (${pr.units != null ? fmt(pr.units) + ' units' : 'units —'})${t.en || ''}`), SRC.tlvPermits, 'OFFICIAL', { coverage: COVERAGE.TLV_MUNICIPAL, matchState: pr.matchState, onLadder: pr.onLadder, basis: 'official date', entity: pr.id });
    if (pr.permitDate) addL(pr.permitDate, 'permit-issued', bi(`היתר ${pr.permit || ''} ניתן${t.he || ''}`, `permit ${pr.permit || ''} issued${t.en || ''}`), SRC.tlvPermits, 'OFFICIAL', { coverage: COVERAGE.TLV_MUNICIPAL, matchState: pr.matchState, onLadder: pr.onLadder, basis: 'official date', entity: pr.id });
    if (pr.start) addL(pr.start, 'construction-start', bi(`תחילת בנייה לפי רשומת ההיתר (${pr.stage || '—'})${t.he || ''}`, `construction start per the permit record (${pr.stage || '—'})${t.en || ''}`), SRC.tlvPermits, 'OFFICIAL', { coverage: COVERAGE.TLV_MUNICIPAL, matchState: pr.matchState, onLadder: pr.onLadder, basis: 'official date', entity: pr.id });
  }
  const asOf = cache.freshness.sites && cache.freshness.sites.sourceModified ? day(cache.freshness.sites.sourceModified) : null;
  for (const s of S.labour) {
    add(s.firstSeen, 'site-first-seen', bi(`אתר פעיל נראה לראשונה ב-PROPX (${s.id}; מבצע: ${s.executor.name || '—'})${tag(s).he || ''}`, `active site first seen by PROPX (${s.id}; executor: ${s.executor.name || '—'})${tag(s).en || ''}`), SRC.sites, 'OBSERVED', { coverage: COVERAGE.NATIONAL, matchState: s.matchState, onLadder: false, basis: 'PROPX observation date — not a source date', propxObserved: true, entity: s.id });
    /* a STRONG-linked site still on the list is public evidence as of the list's own update date */
    if (s.onLadder && asOf && s.lastSeen && s.lastSeen >= day(cache.freshness.sites.checkedAt || '')) add(asOf, 'site-listed-active', bi(`האתר עדיין ברשימת האתרים הפעילים (נכון לעדכון המקור ${asOf})`, `the site is still on the active-sites list (as of the source update ${asOf})`), SRC.sites, 'OFFICIAL', { coverage: COVERAGE.NATIONAL, matchState: s.matchState, onLadder: true, asOf: true, basis: 'the source\'s update date (the list is undated)', entity: s.id });
  }
  return ev.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
}

/* ---- the stage ladder with a coverage label per rung — only STRONG / VERIFIED links move it ------------------------- */
/* the registry's own ladder when the record carries no Project Intelligence block (a raw registry record) */
function baseLadderOf(p) {
  if (p.intel && p.intel.ladder) return p.intel.ladder;
  const ev = (p.stage && p.stage.evidence) || [];
  return { furthest: p.stage ? p.stage.furthest : null, rungs: STAGES.map((s) => { const e = ev.find((x) => x.stage === s); return { stage: s, evidenced: !!e, date: e ? e.date || null : null, source: e ? e.source : null, partial: e ? !!e.partial : false, asOf: e && e.asOf ? e.asOf : null, reason: null }; }) };
}
function ladderOf(p, S) {
  const base = baseLadderOf(p);
  const isTlv = S.isTlv;
  const P = S.permits.filter((x) => x.onLadder), T = S.tlv.filter((x) => x.onLadder), W = S.labour.filter((x) => x.onLadder);
  const okD = (d) => !!d && (!S.award || String(d).slice(0, 10) >= S.award);   /* a date before the award is never this project's rung evidence */
  const firstOf = (xs) => xs.filter(okD).sort()[0] || null;
  const dd = {
    permitted: P.some((x) => okD(x.permitDate)) ? { date: firstOf(P.map((x) => x.permitDate)), source: SRC.tlvPermits } : null,
    'construction-started': (P.some((x) => okD(x.start)) || T.some((x) => okD(x.start))) ? { date: firstOf(P.map((x) => x.start).concat(T.map((x) => x.start))), source: P.some((x) => okD(x.start)) ? SRC.tlvPermits : SRC.tlvSites }
      : W.length ? { date: null, asOf: firstOf(W.map((x) => x.firstSeen)), source: SRC.sites, label: bi('אתר פעיל רשום (משרד העבודה) — תאריך ההתחלה אינו מתפרסם', 'a registered active site (Ministry of Labour) — the start date is not published') } : null,
    completed: P.some((x) => /גמר/.test(x.stage || '') || x.finished) ? { date: null, source: SRC.tlvPermits, label: bi('תעודת גמר לפחות לבניין אחד (לפי שלב ההיתר)', 'at least one completion certificate (per the permit stage)') } : null,
    occupied: P.some((x) => /אכלוס/.test(x.stage || '') || x.occupation) ? { date: null, source: SRC.tlvPermits, label: bi('קיים אכלוס (לפי שלב ההיתר)', 'occupancy recorded (per the permit stage)') } : null,
  };
  const covOf = (stage) => (stage === 'land-awarded' || stage === 'marketed' ? COVERAGE.NATIONAL : stage === 'construction-started' ? (isTlv ? COVERAGE.TLV_MUNICIPAL : COVERAGE.NATIONAL) : isTlv ? COVERAGE.TLV_MUNICIPAL : COVERAGE.NONE);
  const rungs = STAGES.map((s) => { const r = (base.rungs || []).find((x) => x.stage === s) || { stage: s, evidenced: false, date: null, source: null, reason: null }; const e = dd[s];
    return { ...r, ddEvidenced: !!e, evidenced: r.evidenced || !!e, date: r.date || (e ? e.date : null), ddSource: e ? e.source : null, ddAsOf: e && e.asOf ? e.asOf : null, ddLabel: e && e.label ? e.label : null, coverage: r.evidenced ? COVERAGE.PROJECT_LEVEL : covOf(s),
      coverageNote: !r.evidenced && !e && covOf(s) === COVERAGE.NONE ? bi('אין מקור קריא למכונה לשלב זה מחוץ לתל אביב', 'no machine-readable source for this rung outside Tel Aviv') : null }; });
  let furthest = base.furthest; for (const s of STAGES) if (rungs.find((r) => r.stage === s && r.evidenced)) furthest = s;
  const possible = S.tlv.filter((x) => !x.onLadder).length + S.permits.filter((x) => !x.onLadder).length + S.labour.filter((x) => !x.onLadder).length;
  return { furthest, rungs, possibleNotOnLadder: possible, basis: bi('הרונג הרחוק ביותר עם ראיה ישירה; רק קישור חזק / מאומת מזיז את הסולם; היתר ≠ תחילת בנייה ≠ גמר; רונג ללא ראיה אינו שלב שלא קרה', 'the furthest rung with direct evidence; only a STRONG / VERIFIED link moves the ladder; PERMIT ≠ CONSTRUCTION START ≠ COMPLETION; a rung without evidence is not a stage that did not happen') };
}

/* ---- "no later public evidence" + the execution-gap rule ------------------------------------------------------------ */
function gapOf(timeline, ladder, now, covered = true) {
  const dated = timeline.filter((e) => e.dated && !e.propxObserved && e.onLadder !== false && e.date && e.date <= day(now));   /* as-of statuses count (their date is the source's update date); PROPX observations and possible links do not */
  const last = dated.length ? dated[dated.length - 1] : null;
  const months = last ? monthsBetween(last.date, day(now)) : null;
  const fi = STAGES.indexOf(ladder.furthest), belowCompletion = fi < STAGES.indexOf('completed');
  /* the rule fires only where a source in coverage COULD show later evidence (a Tel Aviv lot; a MoCH project, whose statuses are
     re-published); elsewhere the silence is a coverage gap — a source limitation, never a signal */
  const over = last != null && months != null && months >= GAP_MONTHS && belowCompletion;
  const fires = over && covered;
  return { lastDatedEvidence: last ? { date: last.date, event: last.event, source: last.source, cls: last.cls, asOf: !!last.asOf, basis: last.basis || null } : null,
    coverageGap: over && !covered,
    noLaterEvidence: last ? { since: last.date, months, statement: bi('לא נמצאה ראיה ציבורית מאוחרת יותר במקורות PROPX', 'NO LATER PUBLIC EVIDENCE FOUND in PROPX sources'), notA: bi('אינו "תקוע", "נכשל" או "מתעכב" — אין כלל ציבורי שמבסס זאת', 'not "stalled", "failed" or "delayed" — no public rule establishes those') } : { since: null, months: null, statement: bi('אין ראיה מתוארכת כלל', 'no dated evidence at all') },
    executionGap: { rule: `EXECUTION_GAP: ≥ ${GAP_MONTHS} months since the last DATED public evidence while the ladder is below "completed"`, threshold: GAP_MONTHS, value: months, fires, cls: 'DERIVED', text: fires ? bi(`פער ראיות: ${months} חודשים מאז הראיה הציבורית המתוארכת האחרונה (${last.date}) והסולם מתחת לגמר`, `evidence gap: ${months} months since the last dated public evidence (${last.date}) and the ladder is below completion`) : null,
      limitations: [bi('פער ראיות ≠ עצירה: מחוץ לתל אביב אין מקור היתרים / התחלות ברמת הפרויקט — שתיקה היא פער כיסוי', 'an evidence gap ≠ a stop: outside Tel Aviv there is no project-level permits / starts source — silence is a coverage gap'), bi('תאריכי תצפית PROPX (אתר נראה לראשונה) אינם נספרים כראיה מתוארכת', 'PROPX observation dates (site first seen) do not count as dated evidence')] } };
}

/* ---- the first-minute summary: declarative sentences, each with its class ------------------------------------------- */
function summaryOf(p, X, devDD) {
  const S = [];
  const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : d);
  const add = (id, cls, he, en) => S.push({ id, cls, he, en });
  const who = p.developerName || (p.developers && p.developers[0] && p.developers[0].name) || null;
  if (p.kind === 'ila-awarded-lot') add('what', 'OFFICIAL', `מגרש רמ״י ${p.tender || p.michrazId} ב${p.city || ''}${p.units != null ? ` — ${fmt(p.units)} יח״ד` : ''}${p.decisionDate ? `, נזכה ${dmy(p.decisionDate)}` : ''}`, `ILA lot, tender ${p.tender || p.michrazId} in ${p.cityEn || p.city || ''}${p.units != null ? ` — ${fmt(p.units)} units` : ''}${p.decisionDate ? `, awarded ${p.decisionDate}` : ''}`);
  else add('what', 'OFFICIAL', `פרויקט הגרלה של משב״ש${p.name ? ` "${p.name}"` : ''} ב${p.city || ''}${p.unitsFirstLottery != null ? ` — ${fmt(p.unitsFirstLottery)} יח״ד בהגרלה הראשונה` : ''}${p.firstLotteryDate ? ` (${dmy(p.firstLotteryDate)})` : ''}`, `MoCH lottery project${p.name ? ` "${p.name}"` : ''} in ${p.cityEn || p.city || ''}${p.unitsFirstLottery != null ? ` — ${fmt(p.unitsFirstLottery)} units in the first lottery` : ''}${p.firstLotteryDate ? ` (${p.firstLotteryDate})` : ''}`);
  if (who) { const r = devDD ? devDD.identity.resolution : null; const st = r ? r.state : 'UNRESOLVED'; const co = r && r.chosen ? r.chosen : null;
    add('who', r ? 'OFFICIAL' : 'OBSERVED', `${p.kind === 'ila-awarded-lot' ? 'הזוכה' : 'היזם'}: ${who} — ${st === 'STRONG_MATCH' || st === 'VERIFIED' ? `חברה רשומה ${co.number} (${co.status.verbatim || '—'}; ${st === 'VERIFIED' ? 'מאומת' : 'התאמה חזקה לפי שם'})` : st === 'AMBIGUOUS' ? `${r.candidates.length} חברות רשומות באותו שם — לא נבחרה` : st === 'POSSIBLE_MATCH' ? `התאמה אפשרית בלבד לחברה ${r.candidates[0] ? r.candidates[0].number : '—'} (לא נבחרה)` : `חברה רשומה לא נפתרה (${r && r.reasons[0] ? r.reasons[0].he : '—'})`}`, `${p.kind === 'ila-awarded-lot' ? 'winner' : 'developer'}: ${who} — ${st === 'STRONG_MATCH' || st === 'VERIFIED' ? `legal company ${co.number} (${(co.status.label && co.status.label.en) || co.status.verbatim || '—'}; ${st === 'VERIFIED' ? 'VERIFIED' : 'STRONG MATCH by name'})` : st === 'AMBIGUOUS' ? `${r.candidates.length} registered companies under this name — none picked` : st === 'POSSIBLE_MATCH' ? `a POSSIBLE match only to company ${r.candidates[0] ? r.candidates[0].number : '—'} (not chosen)` : `legal company unresolved (${r && r.reasons[0] ? r.reasons[0].en : '—'})`}`); }
  if (devDD && devDD.corporate.state === 'RESOLVED') { const c = devDD.corporate; add('corporate', 'OFFICIAL', `רשומה תאגידית: ${c.filings.counts.chargeRegistered || 0} רישומי שעבוד / ${c.filings.counts.chargeRemoved || 0} סילוקים בחלון המקור (בטוחות, לא מצוקה); ${c.insolvency.statement.he}`, `corporate record: ${c.filings.counts.chargeRegistered || 0} charge registrations / ${c.filings.counts.chargeRemoved || 0} removals in the source window (collateral, not distress); ${c.insolvency.statement.en}`);
    add('financial', 'DERIVED', devDD.financial.label.he, devDD.financial.label.en); }
  const L = X.ladder; const furthestHe = { 'land-awarded': 'קרקע נזכתה', marketed: 'שווק', permitted: 'היתר', 'construction-started': 'תחילת בנייה', completed: 'גמר', occupied: 'אכלוס' };
  const furthestEn = { 'land-awarded': 'land awarded', marketed: 'marketed', permitted: 'permitted', 'construction-started': 'construction started', completed: 'completed', occupied: 'occupied' };
  add('stage', 'OFFICIAL', `השלב הרחוק ביותר עם ראיה ישירה: ${furthestHe[L.furthest] || L.furthest || '—'}${X.sites.isTlv ? ' (כיסוי עירוני תל אביב)' : ' (מחוץ לתל אביב אין מקור היתרים / התחלות ברמת הפרויקט)'}`, `furthest evidenced stage: ${furthestEn[L.furthest] || L.furthest || '—'}${X.sites.isTlv ? ' (Tel Aviv municipal coverage)' : ' (no project-level permits / starts source outside Tel Aviv)'}`);
  const st = (xs, k) => xs.filter((x) => x.matchState === k).length;
  const T = X.sites.tlv, W = X.sites.labour, H = X.sites.parcelHistory;
  if (T.length || W.length || H.length) add('sites', 'OFFICIAL',
    `תל אביב: ${st(T, 'STRONG_MATCH')} אתרים מקושרים (חלקה + מפתח שני) · ${st(T, 'POSSIBLE_MATCH')} אפשריים (חלקה בלבד) · ${H.length} רשומות היסטוריה של החלקה (לפני הזכייה); ארצי: ${st(W, 'STRONG_MATCH')} מקושרים · ${st(W, 'POSSIBLE_MATCH')} אפשריים · ${st(W, 'AMBIGUOUS')} רב-משמעיים; ${X.permits.filter((x) => x.onLadder).length} רשומות היתר בסולם`,
    `Tel Aviv: ${st(T, 'STRONG_MATCH')} linked sites (parcel + a second key) · ${st(T, 'POSSIBLE_MATCH')} possible (parcel only) · ${H.length} parcel-history records (before the award); national: ${st(W, 'STRONG_MATCH')} linked · ${st(W, 'POSSIBLE_MATCH')} possible · ${st(W, 'AMBIGUOUS')} ambiguous; ${X.permits.filter((x) => x.onLadder).length} permit records on the ladder`);
  else add('sites', 'DERIVED', 'לא נמצא אתר בנייה או רשומת היתר שמצטרפים לפרויקט במפתח — "לא נצפה" ≠ "לא קיים"', 'no construction site or permit record joins this project by a key — "not observed" ≠ "does not exist"');
  const le = X.lastDatedEvidence;
  add('evidence', 'DERIVED', le ? `הראיה הציבורית המתוארכת האחרונה: ${dmy(le.date)}${le.asOf ? ' (נכון לעדכון המקור)' : ''} — לפני ${X.noLaterEvidence.months} חודשים; לא נמצאה ראיה ציבורית מאוחרת יותר במקורות PROPX${X.executionGap.fires ? ` · פער ראיות ביצוע (≥ ${X.executionGap.threshold} חודשים מתחת לגמר)` : X.coverageGap ? ' · אין מקור בכיסוי שיכול להראות ראיה מאוחרת יותר למגרש מחוץ לתל אביב' : ''}` : 'אין ראיה ציבורית מתוארכת כלל',
    le ? `latest dated public evidence: ${le.date}${le.asOf ? ' (as of the source update)' : ''} — ${X.noLaterEvidence.months} months ago; NO LATER PUBLIC EVIDENCE FOUND in PROPX sources${X.executionGap.fires ? ` · EXECUTION EVIDENCE GAP (≥ ${X.executionGap.threshold} months below completion)` : X.coverageGap ? ' · no source in coverage can show later evidence for a lot outside Tel Aviv' : ''}` : 'no dated public evidence at all');
  return S;
}

function projectDD(p, cache, { now = new Date().toISOString(), developerDD = null, lotIdx = null } = {}) {
  if (!p) return null;
  const X = { version: VERSION, generatedFor: p.id, generatedAt: now, kind: p.kind, basis: bi('מקורות רשמיים בלבד; כל קישור עם מצב התאמה; תאריכים רשמיים בלבד בציר הזמן (תצפית PROPX מסומנת); ללא שיפוט', 'official sources only; every link with a match state; official dates only on the timeline (a PROPX observation is labelled); no judgement') };
  X.identity = identityOf(p);
  X.developer = developerDD ? { id: developerDD.generatedFor, name: developerDD.identity.observedName, resolution: developerDD.identity.resolution.state, companyId: developerDD.identity.companyId, company: developerDD.identity.resolution.chosen, registeredStatus: developerDD.corporate.state === 'RESOLVED' ? developerDD.corporate.registeredStatus : null, financial: developerDD.financial.cls, insolvency: developerDD.corporate.state === 'RESOLVED' ? developerDD.corporate.insolvency.statement : null, charges: developerDD.corporate.state === 'RESOLVED' ? { registered: developerDD.corporate.filings.counts.chargeRegistered || 0, removed: developerDD.corporate.filings.counts.chargeRemoved || 0, window: developerDD.corporate.filings.window } : null, signals: developerDD.signals.map((s) => s.id), note: bi('עובדות החברה שנפתרה — לא של חברת הפרויקט (SPV), שאינה נפתרת', 'facts of the resolved company — not of the project company (SPV), which is not resolvable') } : { id: p.developerId || (p.developerIds || [])[0] || null, name: p.developerName || null, resolution: 'NOT_COMPUTED' };
  X.sites = sitesOf(p, cache, { devDD: developerDD, lotIdx });
  X.permits = X.sites.permits;
  X.possibleContractors = [...new Map(X.sites.labour.filter((s) => s.executor.kablan && s.matchState === 'POSSIBLE_MATCH').map((s) => [s.executor.kablan, { kablan: s.executor.kablan, name: s.executor.name, matchState: 'POSSIBLE_MATCH', company: s.executor.company, sites: [s.id] }])).values()];
  X.contractors = [...new Map(X.sites.labour.filter((s) => s.executor.kablan && s.matchState === 'STRONG_MATCH').map((s) => [s.executor.kablan, { kablan: s.executor.kablan, name: s.executor.name, resolution: s.executor.resolution, company: s.executor.company, companyState: s.executor.companyState, branches: s.executor.branches, sites: X.sites.labour.filter((x) => x.executor.kablan === s.executor.kablan).map((x) => x.id), matchState: s.matchState, note: bi('קבלן מבצע באתר שצורף — ביצוע ≠ בעלות ≠ ייזום', 'the executing contractor of a joined site — execution ≠ ownership ≠ development') }])).values()];
  X.timeline = timelineOf(p, X.sites, cache);
  X.ladder = ladderOf(p, X.sites);
  Object.assign(X, gapOf(X.timeline, X.ladder, now, X.sites.isTlv || p.kind === 'moch-lottery-project'));
  X.summary = summaryOf(p, X, developerDD);
  X.coverage = { ladder: X.sites.isTlv ? COVERAGE.TLV_MUNICIPAL : COVERAGE.PARTIAL, sites: COVERAGE.NATIONAL, permits: COVERAGE.TLV_MUNICIPAL, corporate: COVERAGE.DEVELOPER_LEVEL, construction: p.construction ? COVERAGE.STALE : COVERAGE.NONE };
  X.missing = [...((p.intel && p.intel.missing) || [])];
  if (!X.sites.isTlv) X.missing.push({ id: 'permits-outside-tlv', he: 'רשומת היתר / תחילת בנייה מתוארכת — אין מקור עירוני קריא למכונה מחוץ לתל אביב', en: 'a permit record / dated construction start — no machine-readable municipal source outside Tel Aviv' });
  if (!X.contractors.length) X.missing.push({ id: 'executing-contractor', he: 'הקבלן המבצע — נראה רק באתר שמצטרף במפתח', en: 'the executing contractor — visible only on a site that joins by a key' });
  X.missing.push({ id: 'spv', he: 'חברת הפרויקט (SPV) — אף מקור ציבורי אינו קושר אותה לפרויקט', en: 'the project company (SPV) — no public source links it to the project' });
  X.missing.push({ id: 'sales-progress', he: 'קצב מכירות / אכלוס ברמת הפרויקט — אין מקור', en: 'project-level sales pace / occupancy — no source' });
  X.hardTruths = HARD_TRUTHS.concat([bi('היתר ≠ תחילת בנייה ≠ גמר; אתר פעיל ≠ יח״ד שהושלמו', 'PERMIT ≠ CONSTRUCTION START ≠ COMPLETION; ACTIVE SITE ≠ COMPLETED UNITS'), bi('התאמת חלקה ≠ אותו פרויקט כשהחלקה נושאת כמה רשומות', 'a parcel match ≠ the same project when the parcel carries several records'), bi('שם שיווקי ≠ זהות תכנונית', 'MARKETING NAME ≠ PLANNING IDENTITY'), bi('"אין ראיה מאוחרת" ≠ "הפרויקט נעצר"', '"no later evidence" ≠ "the project stopped"')]);
  X.freshness = { project: p.freshness || (p.intel && p.intel.freshness) || null, dd: cache.freshness };
  return X;
}

module.exports = { projectDD, VERSION, GAP_MONTHS, identityOf, sitesOf, timelineOf, ladderOf, baseLadderOf, gapOf, summaryOf };
