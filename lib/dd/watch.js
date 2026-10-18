// PROPX · WATCH CONTRACT (18.10.2026) — what "WATCH THIS PROJECT / DEVELOPER" can honestly mean today. PROPX runs its
// syncs every working day on GitHub runners and appends what changed between two reads (data/dd/history.jsonl → the
// bundled recent window; the Market Radar). A watch is therefore a CONTRACT: the exact events PROPX can detect for this
// entity (by which key, from which source, at which cadence), the events it cannot detect (and why), the last check, and
// a deterministic "changes since <date>" over the ledger. There is no autonomous agent, no alert channel, no push: the
// user opens the entity (or the Pulse) and reads what changed. Browser-side watchlists keep the user's own list only.
'use strict';

const R = require('../entities/resolve');
const bi = (he, en) => ({ he, en });
const VERSION = { id: 'propx-dd-watch-v1', effective: '2026-10-18' };
const CADENCE = bi('כל יום עבודה (א׳–ה׳) · GitHub Actions · dd-sync.yml', 'every working day (Sun–Thu) · GitHub Actions · dd-sync.yml');

const DETECTABLE = Object.freeze({
  company: [
    { event: 'company-status-changed', key: 'co:<number>', source: 'datagov:ica:companies', text: bi('שינוי סטטוס הרשם (פעילה → בפירוק …)', 'registrar status change (active → in liquidation …)') },
    { event: 'company-breach-flag-changed', key: 'co:<number>', source: 'datagov:ica:companies', text: bi('דגל הפרה הוסף / הוסר', 'breach flag set / cleared') },
    { event: 'annual-report-year-advanced', key: 'co:<number>', source: 'datagov:ica:companies', text: bi('דוח שנתי חדש הוגש', 'a new annual report filed') },
    { event: 'charge-registered', key: 'co:<number>', source: 'datagov:ica:changes', text: bi('שעבוד נרשם', 'a charge registered') },
    { event: 'charge-removed', key: 'co:<number>', source: 'datagov:ica:changes', text: bi('שעבוד סולק', 'a charge removed') },
    { event: 'charge-removal-cancelled', key: 'co:<number>', source: 'datagov:ica:changes', text: bi('סילוק שעבוד בוטל (השעבוד עומד שוב)', 'a charge removal cancelled (the charge stands again)') },
    { event: 'company-sub-status-changed', key: 'co:<number>', source: 'datagov:ica:companies', text: bi('תת-הסטטוס ברשם השתנה (למשל צו לפתיחת הליכים)', 'the registrar sub-status changed (e.g. an order opening proceedings)') },
    { event: 'annual-report-update', key: 'co:<number>', source: 'datagov:ica:changes', text: bi('שינוי שדווח עם הדוח השנתי (בעל תפקיד, כתובת …)', 'a change reported with the annual report (an officer, an address …)') },
    { event: 'attachment-order-filing', key: 'co:<number>', source: 'datagov:ica:changes', text: bi('רישום / עדכון / הסרה של צו עיקול (עיקול ≠ חדלות פירעון)', 'an attachment order added / updated / removed (attachment ≠ insolvency)') },
    { event: 'liquidation-case-observed', key: 'co:<number>', source: 'datagov:moj:official-receiver:liquidation', text: bi('תיק פירוק חדש בקובץ הכונס', 'a new liquidation case in the Receiver\'s file') },
    { event: 'liquidation-status-changed', key: 'co:<number>', source: 'datagov:moj:official-receiver:liquidation', text: bi('סטטוס תיק פירוק השתנה', 'a liquidation case status changed') },
    { event: 'voluntary-liquidation-observed', key: 'co:<number>', source: 'datagov:ica:voluntary-liquidation-fast-track', text: bi('נרשמה לפירוק מרצון מזורז', 'listed for fast-track voluntary liquidation') },
  ],
  contractor: [
    { event: 'site-first-seen', key: 'executor_id = kablan:<number>', source: 'datagov:labor:active-construction-sites', text: bi('אתר פעיל חדש של הקבלן', 'a new active site of the contractor') },
    { event: 'site-no-longer-listed', key: 'executor_id', source: 'datagov:labor:active-construction-sites', text: bi('אתר אינו רשום עוד (≠ נעצר)', 'a site no longer listed (≠ stopped)') },
    { event: 'site-enforcement-changed', key: 'executor_id', source: 'datagov:labor:active-construction-sites', text: bi('עיצומים / צווי בטיחות השתנו', 'sanctions / safety warrants changed') },
    { event: 'site-closure-notice', key: 'executor name, normalized (exact)', source: 'datagov:labor:closed-construction-sites', text: bi('הודעת סגירת אתר', 'a site-closure notice') },
    { event: 'site-executor-changed', key: 'executor_id', source: 'datagov:labor:active-construction-sites', text: bi('הקבלן המבצע באתר הוחלף', 'the executing contractor of a site changed') },
  ],
  parcel: [
    { event: 'permit-stage-changed', key: 'parcel → site file → request_num', source: 'tlv:iview2:permits-772', text: bi('שלב ההיתר השתנה (תל אביב)', 'permit stage changed (Tel Aviv)') },
    { event: 'permit-issued', key: 'parcel → site file → request_num', source: 'tlv:iview2:permits-772', text: bi('היתר ניתן (תל אביב)', 'permit issued (Tel Aviv)') },
    { event: 'construction-start-dated', key: 'parcel → site file → request_num', source: 'tlv:iview2:permits-772', text: bi('תאריך תחילת בנייה נרשם (תל אביב)', 'a construction-start date recorded (Tel Aviv)') },
    { event: 'site-state-changed', key: 'parcel → tik', source: 'tlv:iview2:sites-499', text: bi('מצב האתר השתנה (תל אביב)', 'site state changed (Tel Aviv)') },
    { event: 'work-start-dated', key: 'parcel → tik', source: 'tlv:iview2:sites-499', text: bi('תאריך תחילת עבודה נרשם (תל אביב)', 'a work-start date recorded (Tel Aviv)') },
    { event: 'site-first-seen', key: 'block/parcel in the site name', source: 'datagov:labor:active-construction-sites', text: bi('אתר פעיל על החלקה (לפי טקסט חופשי)', 'an active site on the parcel (free text)') },
    { event: 'site-observed', key: 'parcel → tik (gush_chelka)', source: 'tlv:iview2:sites-499', text: bi('אתר פיקוח חדש על החלקה (תל אביב)', 'a new supervised site on the parcel (Tel Aviv)') },
  ],
  tender: [
    { event: 'tender lifecycle / winners', key: 'MichrazID', source: 'rmi:michrazim', text: bi('שינוי מחזור חיים / זוכים של המכרז (רדאר השוק)', 'tender lifecycle / winners change (Market Radar)') },
  ],
  project: [
    { event: 'lottery / status', key: 'ProjectID', source: 'datagov:moch:dira-behanacha-lotteries', text: bi('הגרלה חדשה / שינוי סטטוס היתר או שלב (לפי עדכון המקור)', 'a new lottery / permit or stage status change (per the source update)') },
  ],
});
const NOT_DETECTABLE = Object.freeze([
  bi('תחילת בנייה / גמר / אכלוס מחוץ לתל אביב — אין מקור קריא למכונה', 'construction start / completion / occupancy outside Tel Aviv — no machine-readable source'),
  bi('קצב מכירות, אכלוס, איחורים במסירה — אין מקור', 'sales pace, occupancy, delivery delays — no source'),
  bi('שעבודים והליכים של חברת הפרויקט כשמספרה אינו ידוע — נמסר על ידי המשתמש בלבד', 'the project company\'s charges / proceedings while its number is unknown — user-provided only'),
  bi('דוחות כספיים, דירוג, מחיר אג״ח — חסומים', 'financial statements, ratings, bond prices — blocked'),
  bi('הליכים משפטיים אזרחיים — אין מאגר ברמת הנתבע', 'civil litigation — no defendant-level dataset'),
  bi('שינוי בעלות / בעלי מניות — אינו במאגר הפתוח', 'ownership / shareholder changes — not in the open dataset'),
]);

/** the keys a watch on this entity listens to, from the DD reads */
function keysOf({ project = null, developer = null } = {}) {
  const K = [];
  if (developer) {
    if (developer.identity.companyId) K.push({ key: developer.identity.companyId, kind: 'company', state: developer.identity.resolution.state });
    if (developer.contractor && developer.contractor.state === 'REGISTERED') for (const k of developer.contractor.kablan) K.push({ key: 'kablan:' + k, kind: 'contractor', state: developer.contractor.via ? developer.contractor.via.state : 'STRONG_MATCH', names: developer.contractor.names || [] });
    for (const s of (developer.contractor && developer.contractor.sites && developer.contractor.sites.list) || []) K.push({ key: s.id, kind: 'site', state: 'VERIFIED' });
  }
  if (project) {
    for (const l of project.identity.links) if (l.type === 'BLOCK_PARCEL' && l.id) K.push({ key: l.id, kind: 'parcel', state: l.state });
    if (project.identity.ids.tender) K.push({ key: project.identity.ids.tender, kind: 'tender', state: 'VERIFIED' });
    if (project.kind === 'moch-lottery-project') K.push({ key: project.identity.ids.project, kind: 'project', state: 'VERIFIED' });
    for (const s of project.sites.tlv) K.push({ key: s.id, kind: 'site', state: s.matchState });
    for (const s of project.sites.labour) K.push({ key: s.id, kind: 'site', state: s.matchState });
    for (const p of project.permits) K.push({ key: p.id, kind: 'permit', state: p.matchState });
    for (const k of project.contractors) K.push({ key: 'kablan:' + k.kablan, kind: 'contractor', state: k.matchState, names: k.name ? [k.name] : [] });
  }
  const seen = new Set(); return K.filter((k) => !seen.has(k.key) && seen.add(k.key));
}

/** what changed for these keys since a date, from the bundled history window (deterministic; never a prediction) */
/* an event belongs to a watched entity by an exact key only: its own key; a contractor's registry number on a site event
   (executor_id, or the previous executor of a site whose executor changed); a watched parcel written on a site event
   ("parcel:<block>/<parcel>" from the free-text site name or the municipal gush/chelka); a closure notice whose executor
   name, normalized, equals a watched contractor's registered name. Never a similarity, never a locality. */
function changesSince(keys, history, since) {
  const set = new Set(keys.map((k) => k.key));
  const kab = new Set(keys.filter((k) => k.kind === 'contractor').map((k) => k.key.replace(/^kablan:/, '')));
  const parcels = new Set(keys.filter((k) => k.kind === 'parcel').map((k) => k.key));
  const names = new Set(keys.filter((k) => k.kind === 'contractor').flatMap((k) => (k.names || []).map((n) => R.regKey(n))).filter(Boolean));
  const hit = (e) => set.has(e.key)
    || (e.executorId != null && kab.has(String(e.executorId))) || (e.oldExecutorId != null && kab.has(String(e.oldExecutorId)))
    || (e.parcel && parcels.has(e.parcel)) || (Array.isArray(e.parcels) && e.parcels.some((p) => parcels.has(p)))
    || (e.executorKey && names.has(e.executorKey));
  const out = (history || []).filter((e) => e.at && (!since || e.at >= since) && hit(e));
  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return out;
}

function watchContract({ project = null, developer = null, cache = null, since = null } = {}) {
  const keys = keysOf({ project, developer });
  const kinds = [...new Set(keys.map((k) => k.kind))];
  const detectable = kinds.flatMap((k) => (DETECTABLE[k] || []).map((d) => ({ ...d, kind: k })));
  const lastCheck = cache && cache.latest ? { at: cache.latest.generatedAt, status: cache.latest.run && cache.latest.run.status, lanes: cache.latest.run && cache.latest.run.lanes } : null;
  const windowDays = cache && cache.history ? 180 : null;
  const changes = cache ? changesSince(keys, cache.history, since) : [];
  const material = changes.filter((e) => /liquidation|status-changed|charge-registered|charge-removal-cancelled|attachment-order|closure|enforcement|executor-changed|permit-issued|construction-start|work-start|no-longer-listed/.test(e.event));
  return { version: VERSION, cadence: CADENCE, keys, detectable, notDetectable: NOT_DETECTABLE, lastCheck, historyWindowDays: windowDays, since, changes, material: material.length,
    state: !cache || !cache.synced ? 'NOT_AVAILABLE' : changes.length ? (material.length ? 'MATERIAL_CHANGE' : 'CHANGE') : 'NO_CHANGE',
    honest: bi('אין סוכן אוטונומי ואין התראות: PROPX קוראת את המקורות בכל יום עבודה ורושמת מה השתנה; המשתמש פותח את הישות (או את הדופק) וקורא. "אין שינוי" = לא נצפה שינוי במפתחות אלה במקורות אלה, לא "לא קרה דבר"', 'no autonomous agent and no alerts: PROPX reads the sources every working day and records what changed; the user opens the entity (or the Pulse) and reads. "no change" = no change observed on these keys in these sources, not "nothing happened"') };
}

module.exports = { VERSION, CADENCE, DETECTABLE, NOT_DETECTABLE, keysOf, changesSince, watchContract };
