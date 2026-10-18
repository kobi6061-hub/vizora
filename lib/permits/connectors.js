// PROPX · MUNICIPAL PERMIT CONNECTORS (Premium Diligence 2.0, 18.10.2026).
//
// One registry of the municipal building-permit channels PROPX audited (lib/trust/discovery/2026-10-18-premium.json, runs
// 39130709010 + 39130975687), each classified separately — never "national coverage":
//   LIVE              a documented machine channel, synced, normalized to the common schema below
//   PARTIAL           a machine channel covering part of the municipality's permits
//   DOCUMENTED        machine-readable rows exist but are not the municipality's own publication (not integrated)
//   BLOCKED           the municipality's channel refuses a machine client
//   NO MACHINE ACCESS no open dataset / service found — the permits exist in a viewer only
//   NOT AUDITED       every other locality
// The common permit schema every LIVE connector maps to: applicationId · permitId · address · block · parcel · applicant ·
// permitHolder · status · submitted · approved · issued · description · units · sourceUpdated (missing = null, never 0).
// MUNICIPAL PERMIT COVERAGE ≠ NATIONAL COVERAGE.
'use strict';

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-permit-connectors-v1', effective: '2026-10-18' });
const SCHEMA = Object.freeze(['applicationId', 'permitId', 'address', 'block', 'parcel', 'applicant', 'permitHolder', 'status', 'submitted', 'approved', 'issued', 'description', 'units', 'sourceUpdated']);
const STATES = Object.freeze({
  LIVE: bi('פעיל — נקרא ומנורמל', 'LIVE — read and normalized'), PARTIAL: bi('חלקי', 'PARTIAL'), DOCUMENTED: bi('מתועד — לא שולב', 'DOCUMENTED — not integrated'),
  BLOCKED: bi('חסום', 'BLOCKED'), NO_MACHINE_ACCESS: bi('אין גישת מכונה', 'NO MACHINE ACCESS'), NOT_AUDITED: bi('לא נבדק', 'NOT AUDITED'),
});
const EVIDENCE = 'lib/trust/discovery/2026-10-18-premium.json · runs 39130709010 + 39130975687';
const M = (code, slug, he, en, state, why) => Object.freeze({ code, slug, he, en, state, why, evidence: state === 'LIVE' ? 'lib/dd/sync.js lane tlv (daily)' : EVIDENCE });
const MUNICIPALITIES = Object.freeze([
  M(5000, 'tel-aviv-yafo', 'תל אביב-יפו', 'Tel Aviv-Yafo', 'LIVE', bi('IView2: בקשות והיתרים (שכבה 772) + אתרי בנייה (שכבה 499) — נקראים בכל יום עבודה', 'IView2: permit requests and permits (layer 772) + construction sites (layer 499) — read every working day')),
  M(3000, 'jerusalem', 'ירושלים', 'Jerusalem', 'BLOCKED', bi('ה-GIS העירוני עונה "Access Denied"; פורטל הנתונים הפתוחים אינו כולל היתרים', 'the municipal GIS answers "Access Denied"; the open-data portal carries no permits')),
  M(4000, 'haifa', 'חיפה', 'Haifa', 'NO_MACHINE_ACCESS', bi('פורטל הנתונים הפתוחים עונה — אין מאגר היתרים; נתיבי ה-GIS החזירו 404', 'the open-data portal answers — no permit dataset; the GIS paths returned 404')),
  M(8300, 'rishon-lezion', 'ראשון לציון', 'Rishon LeZion', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS; מידע הנדסי בצפיין בלבד', 'no open portal or GIS service found; engineering information in a viewer only')),
  M(7900, 'petah-tikva', 'פתח תקוה', 'Petah Tikva', 'NO_MACHINE_ACCESS', bi('הארגון ב-data.gov.il: 4 מאגרים, אף אחד לא היתרים', 'its data.gov.il organization: 4 datasets, none on permits')),
  M(9000, 'beer-sheva', 'באר שבע', 'Be\'er Sheva', 'NO_MACHINE_ACCESS', bi('44 מאגרים ב-data.gov.il (תב״עות, ייעודי קרקע, מבנים, רישוי עסקים) — ללא היתרי בנייה; תיקי בניין בצפיין (Complot)', '44 datasets on data.gov.il (plans, land designations, buildings, business licensing) — no building permits; building files in a viewer (Complot)')),
  M(7400, 'netanya', 'נתניה', 'Netanya', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS', 'no open portal or GIS service found')),
  M(70, 'ashdod', 'אשדוד', 'Ashdod', 'NO_MACHINE_ACCESS', bi('שרת ה-GIS עונה (גבולות, אורתופוטו, חינוך, גושים וחלקות) — אין שכבת היתרים', 'the GIS server answers (borders, orthophoto, education, blocks and parcels) — no permit layer')),
  M(6600, 'holon', 'חולון', 'Holon', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS; צפיין הנדסי בלבד', 'no open portal or GIS service found; an engineering viewer only')),
  M(8600, 'ramat-gan', 'רמת גן', 'Ramat Gan', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS; צפיין הנדסי בלבד', 'no open portal or GIS service found; an engineering viewer only')),
  M(6400, 'herzliya', 'הרצליה', 'Herzliya', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS; צפיין הנדסי בלבד', 'no open portal or GIS service found; an engineering viewer only')),
  M(6200, 'bat-yam', 'בת ים', 'Bat Yam', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS; צפיין הנדסי בלבד', 'no open portal or GIS service found; an engineering viewer only')),
  M(6900, 'kfar-saba', 'כפר סבא', 'Kfar Saba', 'DOCUMENTED', bi('רק תמונת מצב של צד שלישי ב-ArcGIS Online (תמ״א 38, 2021) — לא פרסום העירייה; לא שולב', 'only a third-party ArcGIS Online snapshot (TAMA 38, 2021) — not the municipality\'s publication; not integrated')),
  M(8700, 'raanana', 'רעננה', 'Ra\'anana', 'NO_MACHINE_ACCESS', bi('לא נמצא פורטל פתוח או שירות GIS; צפיין הנדסי בלבד', 'no open portal or GIS service found; an engineering viewer only')),
]);
const byCode = new Map(MUNICIPALITIES.map((m) => [String(m.code), m]));
function municipality(code) {
  return byCode.get(String(code)) || { code: code == null ? null : Number(code), slug: null, he: null, en: null, state: 'NOT_AUDITED', why: bi('רשות זו לא נבדקה — היתרים אינם בכיסוי', 'this municipality was not audited — permits are not in coverage'), evidence: null };
}

/* ---- the LIVE connector: Tel Aviv-Yafo (rows as lib/dd/sync.js keeps them) → the common schema ---- */
const tlv = {
  code: 5000, source: 'tlv:iview2:permits-772',
  /** one request's rows (several buildings) → one normalized record; the site's parcels / holders come from the sites layer */
  normalize(rows, site = null) {
    const list = Array.isArray(rows) ? rows : [rows]; if (!list.length) return null;
    const first = (k) => list.map((r) => r[k]).filter(Boolean).sort()[0] || null;
    const permits = [...new Set(list.map((r) => r.permit).filter(Boolean))];
    const units = [...new Set(list.map((r) => r.units).filter((v) => v != null))];
    return { municipality: 5000, applicationId: list[0].request != null ? String(list[0].request) : null, permitId: permits.length ? permits.join(', ') : null, address: list[0].addresses || null,
      block: site && site.parcels && site.parcels[0] ? Number(String(site.parcels[0]).replace(/^parcel:/, '').split('/')[0]) : null, parcel: site && site.parcels && site.parcels[0] ? Number(String(site.parcels[0]).split('/')[1]) : null,
      applicant: null, permitHolder: site && site.holderList && site.holderList.length ? site.holderList.join(', ') : null,
      status: [...new Set(list.map((r) => r.stage).filter(Boolean))].join(' · ') || null, submitted: first('opened'), approved: null, issued: first('permitDate'),
      description: list[0].type || null, units: units.length === 1 ? units[0] : null, unitsPerRow: units.length > 1 ? units : null, sourceUpdated: list[0].imported || null, cls: 'OFFICIAL', coverage: 'TEL AVIV MUNICIPAL COVERAGE' };
  },
};
const CONNECTORS = Object.freeze({ 5000: tlv });

function summary() {
  const n = (s) => MUNICIPALITIES.filter((m) => m.state === s).length;
  return { version: VERSION, schema: SCHEMA, states: STATES, municipalities: MUNICIPALITIES, counts: { LIVE: n('LIVE'), PARTIAL: n('PARTIAL'), DOCUMENTED: n('DOCUMENTED'), BLOCKED: n('BLOCKED'), NO_MACHINE_ACCESS: n('NO_MACHINE_ACCESS') },
    statement: bi('היתרי בנייה נקראים כיום מעירייה אחת (תל אביב-יפו); 13 הרשויות הגדולות האחרות נבדקו — אף אחת אינה מפרסמת היתרים בערוץ מכונה פתוח', 'building permits are read today from ONE municipality (Tel Aviv-Yafo); the 13 other large municipalities were audited — none publishes permits through an open machine channel'),
    notA: bi('כיסוי היתרים עירוני ≠ כיסוי ארצי', 'MUNICIPAL PERMIT COVERAGE ≠ NATIONAL COVERAGE') };
}

module.exports = { VERSION, SCHEMA, STATES, MUNICIPALITIES, CONNECTORS, municipality, summary };
