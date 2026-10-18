// PROPX · PROJECT EXECUTION COVERAGE MAP (Premium Diligence 2.0, 18.10.2026) — for a geography or a project, what PROPX can
// and cannot observe: permits · construction start · active site · completion · occupancy. Universes stay apart:
//   • municipal permits — the municipality's own channel (lib/permits/connectors.js; Tel Aviv-Yafo LIVE, the rest audited);
//   • MoCH construction-progress reports — project-level, state-land programme projects only, last updated 2024-03 (STALE);
//   • the Ministry of Labour's active / closed sites — national, no start / completion dates (PROPX first / last seen);
//   • CBS construction series — DISTRICT level only: a district start never becomes a city or project start.
// DISTRICT CONSTRUCTION DATA ≠ PROJECT CONSTRUCTION DATA · MUNICIPAL PERMIT COVERAGE ≠ NATIONAL COVERAGE.
'use strict';

const PC = require('../permits/connectors');
const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-dd-execution-coverage-v1', effective: '2026-10-18' });
const LEVELS = Object.freeze({
  PROJECT_LIVE: bi('ברמת הפרויקט — מקור פעיל', 'project level — a live source'),
  PROJECT_PARTIAL: bi('ברמת הפרויקט — חלקי', 'project level — partial'),
  PROJECT_STALE: bi('ברמת הפרויקט — מקור לא מעודכן', 'project level — a stale source'),
  NATIONAL_NO_DATES: bi('ארצי — ללא תאריכים במקור', 'national — the source carries no dates'),
  DISTRICT_ONLY: bi('ברמת המחוז בלבד — לעולם לא פרויקט', 'district level only — never a project'),
  NONE: bi('אין מקור', 'no source'),
});
const cell = (level, source, note, extra = {}) => ({ level, label: LEVELS[level], source, note, ...extra });

/** what PROPX can observe in a locality */
function forLocality(localityCode, { district = null } = {}) {
  const m = PC.municipality(localityCode), tlv = m.state === 'LIVE';
  return { version: VERSION, localityCode: localityCode == null ? null : Number(localityCode), municipality: m,
    permit: tlv ? cell('PROJECT_LIVE', 'tlv:iview2:permits-772', bi('בקשות והיתרים עם תאריכים', 'requests and permits with dates')) : cell('NONE', null, m.why, { municipalState: m.state }),
    start: tlv ? cell('PROJECT_LIVE', 'tlv:iview2:permits-772 · tlv:iview2:sites-499', bi('תאריך תחילת בנייה / עבודה מרשומת ההיתר והאתר', 'construction / work start from the permit and site records'))
      : cell('PROJECT_STALE', 'datagov:moch:construction-progress', bi('רק מגרשי תכניות על קרקע מדינה שהצטרפו לדיווחי משב״ש (עדכון אחרון 2024-03); אחרת — מחוז בלבד (למ״ס)', 'only state-land programme lots joined to the MoCH progress reports (last update 2024-03); otherwise district level only (CBS)'), { district: cell('DISTRICT_ONLY', 'cbs:construction', bi(`התחלות בנייה של המחוז${district ? ' ' + district : ''} — לא של היישוב ולא של הפרויקט`, `the district's construction starts${district ? ' (' + district + ')' : ''} — not the locality's, not the project's`)) }),
    activeSite: cell('NATIONAL_NO_DATES', 'datagov:labor:active-construction-sites', bi('אתר רשום פעיל (משרד העבודה) — אין במקור תאריך התחלה; התאריכים הם תצפיות PROPX', 'a registered active site (Ministry of Labour) — no start date in the source; the dates are PROPX observations')),
    completion: tlv ? cell('PROJECT_LIVE', 'tlv:iview2:permits-772', bi('שלב "תעודת גמר" ברשומת ההיתר', 'the "completion certificate" stage on the permit record')) : cell('PROJECT_STALE', 'datagov:moch:construction-progress', bi('רק מגרשי תכניות שהצטרפו לדיווחי משב״ש (2024-03); אחרת — מחוז בלבד', 'only programme lots joined to the MoCH reports (2024-03); otherwise district only'), { district: cell('DISTRICT_ONLY', 'cbs:construction', bi('גמר בנייה של המחוז — לא של הפרויקט', 'the district\'s completions — not the project\'s')) }),
    occupancy: tlv ? cell('PROJECT_LIVE', 'tlv:iview2:permits-772', bi('שלב "אכלוס" ברשומת ההיתר', 'the "occupancy" stage on the permit record')) : cell('NONE', null, bi('אין מקור אכלוס קריא למכונה מחוץ לתל אביב', 'no machine-readable occupancy source outside Tel Aviv')),
    notA: [bi('כיסוי היתרים עירוני ≠ כיסוי ארצי', 'MUNICIPAL PERMIT COVERAGE ≠ NATIONAL COVERAGE'), bi('נתוני בנייה מחוזיים ≠ נתוני בנייה של פרויקט', 'DISTRICT CONSTRUCTION DATA ≠ PROJECT CONSTRUCTION DATA')] };
}

/** the same map for one project — with what PROPX actually found for it */
function forProject({ project, projectDD = null, districtName = null } = {}) {
  const p = project || {}, X = projectDD || {};
  const base = forLocality(p.localityCode, { district: districtName });
  const tl = X.sites || { tlv: [], labour: [], permits: [] };
  const strongPermits = (X.permits || []).filter((x) => x.onLadder), strongTlv = (tl.tlv || []).filter((x) => x.onLadder), strongLab = (tl.labour || []).filter((x) => x.onLadder);
  const rung = (st) => ((X.ladder && X.ladder.rungs) || []).find((r) => r.stage === st) || null;
  const fromRung = (st, extra = {}) => { const r = rung(st); return r && r.evidenced ? { found: true, date: r.date || r.ddAsOf || null, asOf: !r.date && !!r.ddAsOf, source: r.ddSource || r.source || null, coverage: r.coverage || null, ...extra } : { found: false, ...extra }; };
  const found = {
    permit: fromRung('permitted', { strongPermits: strongPermits.length }),
    start: p.construction && p.construction.firstStart ? { found: true, source: 'datagov:moch:construction-progress', date: p.construction.firstStart, asOf: p.construction.asOf, join: p.construction.join, stale: true } : fromRung('construction-started'),
    activeSite: strongLab.length ? { found: true, n: strongLab.length, matchState: 'STRONG_MATCH' } : { found: false, possible: (tl.labour || []).filter((x) => !x.onLadder).length },
    completion: p.construction && p.construction.completed ? { found: true, source: 'datagov:moch:construction-progress', date: p.construction.lastCompletion, asOf: p.construction.asOf, stale: true } : fromRung('completed'),
    occupancy: fromRung('occupied'),
  };
  void strongTlv;
  return { ...base, project: p.id || null, found };
}

module.exports = { VERSION, LEVELS, forLocality, forProject };
