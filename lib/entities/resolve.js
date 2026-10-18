// PROPX · ENTITY RESOLUTION (18.10.2026) — the canonical entity model of the due-diligence layer and the deterministic
// resolution of a PROPX developer (an observed name) to a LEGAL COMPANY of the Registrar of Companies, of a construction
// site's executor to a REGISTERED CONTRACTOR, and of a contractor to its company — each with an EXPLICIT MATCH STATE and
// enumerated reasons. Pure: no fetch, no randomness, no similarity score, no "confidence %". A name alone is never VERIFIED.
//
//   ENTITY_MODEL                 every entity type the layer names, its id scheme, the sources that can establish it and
//                                what cannot be resolved in the current coverage (said plainly, never inferred)
//   MATCH                        VERIFIED · STRONG_MATCH · POSSIBLE_MATCH · AMBIGUOUS · UNRESOLVED (definitions, rank)
//   REASONS                      every reason code a resolution can carry (he / en)
//   regKey(name)                 the registered-name key (the Registrar's spelling and the tender / lottery spelling collapse)
//   buildIndex(companiesPayload) the lookup index over the rows the sync kept (data/dd/companies.json / partnerships.json)
//   resolveCompany(dev, index)   developer → legal company
//   resolveContractor(executorId, contractorsIndex) · contractorCompany(contractorRow, index)
//   companyFacts(row)            registered status (class + verbatim), type → financial-data coverage class, breach flag …
//   weakest(states)              a chain of links is as strong as its weakest link
//   parseParcel(text) · parseLotNumber(text)   official keys read from free text (the Labour sites' names, the TLV layers)
//
// Hard truths this module enforces: DEVELOPER NAME ≠ LEGAL COMPANY (a name resolves, it is not the company);
// NAME SIMILARITY ≠ VERIFIED MATCH (letters-only equality is POSSIBLE, exact normalized legal name is STRONG, only an
// official number is VERIFIED); DEVELOPER BRAND ≠ PROJECT SPV and PARENT ≠ SUBSIDIARY ≠ GUARANTOR (no public source
// carries the links — stated as NOT RESOLVABLE IN CURRENT COVERAGE, never guessed); CONTRACTOR ≠ DEVELOPER.
'use strict';

const { canonicalName, lettersKey, kindOf, isJoint } = require('./names');

const bi = (he, en) => ({ he, en });
const VERSION = Object.freeze({ id: 'propx-entity-resolution-v1', effective: '2026-10-18' });

/* ---- the registered-name key ------------------------------------------------------------------------------------- */
/** The Registrar writes the Hebrew quotation mark as "~" (בע~מ), keeps hyphens ("הנגב-אחים"), dots ("י.ק.") and runs of
    spaces that the tender / lottery strings do not. The key drops every quote, turns punctuation into spaces and
    collapses whitespace — so the SAME legal name spelled by two sources meets. It is NOT an identity: two distinct
    companies can collapse to one key (then the resolution is AMBIGUOUS, never a pick). */
function regKey(name) {
  return canonicalName(String(name ?? '').replace(/~/g, '"'))
    .replace(/["'`´]/g, '')
    .replace(/[.,\-–—/\\()[\]{}:;!?]+/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ---- the entity model -------------------------------------------------------------------------------------------- */
const SRC = {
  ica: 'datagov:ica:companies', icaChanges: 'datagov:ica:changes', partnerships: 'datagov:ica:partnerships',
  receiver: 'datagov:moj:official-receiver:liquidation', volFast: 'datagov:ica:voluntary-liquidation-fast-track',
  contractors: 'datagov:moch:contractors-register', sites: 'datagov:labor:active-construction-sites', sitesClosed: 'datagov:labor:closed-construction-sites',
  tlvPermits: 'tlv:iview2:permits-772', tlvSites: 'tlv:iview2:sites-499',
  ila: 'rmi:michrazim', moch: 'datagov:moch:dira-behanacha-lotteries', xplan: 'xplan', geo: 'geo:registry', user: 'user-provided',
};
const NOT_IN_COVERAGE = bi('לא ניתן לפתור במקורות הציבוריים שבכיסוי PROPX — אינו מוסק משם, מגיאומטריה או מדמיון', 'NOT RESOLVABLE IN CURRENT PUBLIC COVERAGE — never inferred from a name, geometry or similarity');

const ENTITY_MODEL = Object.freeze({
  LEGAL_COMPANY: { id: 'LEGAL_COMPANY', label: bi('חברה רשומה', 'legal company'), idScheme: 'co:<9-digit company number>', establishedBy: [SRC.ica], keys: ['company number (exact)', 'registered name (normalized — STRONG at best)'],
    note: bi('ישות משפטית במאגר רשם החברות: מספר, שם, סטטוס, סוג, דגל הפרה, שנת דוח אחרון, תאריך התאגדות', 'a legal person in the Registrar of Companies: number, registered name, status, type, breach flag, last annual report year, incorporation date') },
  DEVELOPER_BRAND: { id: 'DEVELOPER_BRAND', label: bi('מותג יזם (השם שנצפה)', 'developer brand (the observed name)'), idScheme: 'dev-<sha1 of the canonical observed name>', establishedBy: [SRC.ila, SRC.moch], keys: ['the winner / developer string as the source wrote it'],
    note: bi('השם כפי שרמ״י או משב״ש כתבו אותו — מזוהה עם חברה רשומה רק דרך פתרון מפורש; מותג ≠ חברה ≠ SPV', 'the name as the Authority or the Ministry wrote it — tied to a legal company only through an explicit resolution; a brand is not the company and not the project SPV') },
  PARENT_COMPANY: { id: 'PARENT_COMPANY', label: bi('חברת אם', 'parent company'), idScheme: 'co:<number> + relation', establishedBy: [], keys: [], note: NOT_IN_COVERAGE, coverage: 'NONE' },
  SUBSIDIARY: { id: 'SUBSIDIARY', label: bi('חברה בת', 'subsidiary'), idScheme: 'co:<number> + relation', establishedBy: [], keys: [], note: NOT_IN_COVERAGE, coverage: 'NONE' },
  PROJECT_SPV: { id: 'PROJECT_SPV', label: bi('חברת פרויקט ייעודית (SPV)', 'project SPV'), idScheme: 'co:<number> + relation to a project', establishedBy: [], keys: [], note: bi('לא ניתן לפתור: אף מקור ציבורי בכיסוי אינו קושר חברת פרויקט למותג או לפרויקט; זוכה במכרז הוא "זוכה" — לא נקבע אם הוא SPV', 'not resolvable: no public source in coverage links a project company to a brand or a project; a tender winner is a "land winner" — whether it is an SPV is not determined'), coverage: 'NONE' },
  LAND_WINNER: { id: 'LAND_WINNER', label: bi('זוכה במגרש (רמ״י)', 'land winner (ILA)'), idScheme: 'dev-… (listed legal names) · unlisted private persons counted, never named', establishedBy: [SRC.ila], keys: ['winners[].name on the lot file (exact string)'], note: bi('מי שרמ״י רשמה כזוכה במגרש — לא בהכרח היזם המשווק ולא בהכרח חברת הפרויקט', 'whom the Authority recorded as the lot winner — not necessarily the marketing developer nor the project company') },
  PROJECT_OWNER: { id: 'PROJECT_OWNER', label: bi('בעל הפרויקט', 'project owner'), idScheme: 'relation', establishedBy: [SRC.moch], keys: ['the developer string on the lottery rows (MoCH)'], note: bi('מי שמשב״ש רשם כיזם הפרויקט בהגרלה — שם, לא חברה; בעלות משפטית אינה נקבעת כאן', 'whom the Ministry lists as the lottery project\'s developer — a name, not a company; legal ownership is not determined here') },
  CONTRACTOR: { id: 'CONTRACTOR', label: bi('קבלן רשום', 'registered contractor'), idScheme: 'kablan:<MISPAR_KABLAN>', establishedBy: [SRC.contractors], keys: ['MISPAR_KABLAN (exact)', 'MISPAR_YESHUT = company number (exact, corporations only)'], note: bi('רישום בפנקס הקבלנים: ענף, קבוצה, סיווג — עובדת רישום, לא שיפוט איכות; קבלן ≠ יזם', 'a registration in the contractors register: branch, group, classification — a registration fact, not a quality judgement; a contractor is not a developer') },
  EXECUTING_CONTRACTOR: { id: 'EXECUTING_CONTRACTOR', label: bi('קבלן מבצע באתר', 'executing contractor on a site'), idScheme: 'kablan:<MISPAR_KABLAN> ← site.executor_id', establishedBy: [SRC.sites, SRC.tlvSites], keys: ['executor_id (exact)'], note: bi('מי שמשרד העבודה רשם כמבצע באתר פעיל — ביצוע ≠ בעלות ≠ ייזום', 'whom the Ministry of Labour lists as the executor of an active site — execution is not ownership or development') },
  PROJECT: { id: 'PROJECT', label: bi('פרויקט', 'project'), idScheme: 'moch:<ProjectID> · ila:<MichrazID>:<lot file id>', establishedBy: [SRC.moch, SRC.ila], keys: ['ProjectID (MoCH)', 'MichrazID + TikID (ILA)'], note: bi('שני עולמות שאינם מצורפים זה לזה בשום מפתח — פרויקט הגרלה ומגרש שנזכה נשארים שתי ישויות', 'two universes with no shared key — a lottery project and an awarded lot stay two entities') },
  MARKETING_NAME: { id: 'MARKETING_NAME', label: bi('שם שיווקי', 'marketing name'), idScheme: 'an attribute of moch:<ProjectID> (projectName) — never an identity', establishedBy: [SRC.moch], keys: [], note: bi('שם שיווקי ("LOFT & MORE") אינו זהות תכנונית: אינו מצרף תוכנית, מגרש או היתר', 'a marketing name is not a planning identity: it joins no plan, lot or permit') },
  PLAN: { id: 'PLAN', label: bi('תוכנית', 'plan'), idScheme: 'plan:<plan number, whitespace removed>', establishedBy: [SRC.ila, SRC.xplan], keys: ['plan number (exact)', 'Mavat id (exact)'], note: bi('מפתח רשמי; הצטרפות רק במספר מדויק', 'an official key; joins only on the exact number') },
  TENDER: { id: 'TENDER', label: bi('מכרז רמ״י', 'ILA tender'), idScheme: 'rmi:<MichrazID>', establishedBy: [SRC.ila], keys: ['MichrazID (exact)'], note: bi('רשומת מכרז חיה של רמ״י', 'the Authority\'s live tender record') },
  LOT: { id: 'LOT', label: bi('מגרש', 'lot'), idScheme: 'ila:<MichrazID>:<TikID>', establishedBy: [SRC.ila], keys: ['TikID (exact)'], note: bi('תיק המגרש של רמ״י; מספר מגרש בטקסט חופשי (״מגרש 142״) אינו מפתח', 'the Authority\'s lot file; a lot number in free text ("מגרש 142") is not a key') },
  BLOCK_PARCEL: { id: 'BLOCK_PARCEL', label: bi('גוש / חלקה', 'block / parcel'), idScheme: 'parcel:<block>/<parcel>', establishedBy: [SRC.ila, SRC.tlvSites, SRC.sites], keys: ['block + parcel (exact)'], note: bi('מפתח קדסטרי רשמי; חלקה משותפת לכמה רשומות היא התאמה של מיקום, לא של פרויקט', 'an official cadastral key; a parcel shared by several records is a match of place, not of project') },
  ADDRESS: { id: 'ADDRESS', label: bi('כתובת', 'address'), idScheme: 'addr:<locality code>/<street code>/<house>', establishedBy: [SRC.geo], keys: ['official locality + street codes', 'house number'], note: bi('כתובת בטקסט חופשי (היתרים, אתרים) מצטרפת רק דרך קודי הרישום הרשמיים — ובכל מקרה אינה זהות פרויקט', 'a free-text address (permits, sites) joins only through the official registry codes — and is never a project identity') },
  BUILDING_SITE: { id: 'BUILDING_SITE', label: bi('אתר בנייה', 'building site'), idScheme: 'site:labor:<work_id> · site:tlv:<tik_tipul>', establishedBy: [SRC.sites, SRC.tlvSites], keys: ['work_id (exact)', 'tik_tipul (exact)'], note: bi('אתר פעיל ≠ יח״ד שהושלמו; רישום בפיקוח בטיחות, ללא תאריכים (ארצי) או עם תאריך תחילת עבודה (תל אביב)', 'an active site is not completed units; a safety-supervision registration without dates (national) or with a work-start date (Tel Aviv)') },
  PERMIT_RECORD: { id: 'PERMIT_RECORD', label: bi('רשומת היתר', 'permit record'), idScheme: 'permit:tlv:<request_num>', establishedBy: [SRC.tlvPermits], keys: ['request_num (exact)', 'permission_num (exact)', 'ms_tik_binyan (exact → the site)'], note: bi('תל אביב-יפו בלבד (כיסוי עירוני); היתר ≠ תחילת בנייה ≠ גמר', 'Tel Aviv-Yafo only (municipal coverage); a permit is not a construction start nor a completion') },
});

/* ---- match states ------------------------------------------------------------------------------------------------ */
const MATCH = Object.freeze({
  VERIFIED: { id: 'VERIFIED', rank: 4, label: bi('מאומת', 'VERIFIED'), definition: bi('מפתח רשמי מדויק משני הצדדים (מספר חברה, מספר קבלן, גוש/חלקה, מספר מכרז) — לעולם לא משם', 'an exact official key on both sides (company number, contractor number, block/parcel, tender number) — never a name') },
  STRONG_MATCH: { id: 'STRONG_MATCH', rank: 3, label: bi('התאמה חזקה', 'STRONG MATCH'), definition: bi('שם משפטי רשום זהה לאחר נרמול טיפוגרפי, ובדיוק רשומה אחת במאגר; או מפתח רשמי שנקרא מתוך טקסט חופשי', 'the identical registered legal name after typographic normalization and exactly one registry row; or an official key read from free text') },
  POSSIBLE_MATCH: { id: 'POSSIBLE_MATCH', rank: 2, label: bi('התאמה אפשרית', 'POSSIBLE MATCH'), definition: bi('אותן אותיות וספרות בלבד (ריווח / פיסוק שונים) ורשומה אחת; או מספר מגרש בטקסט חופשי שמתאים למגרש אחד ביישוב', 'the same letters and digits only (spacing / punctuation differ) and one row; or a lot number in free text that fits one lot in the locality') },
  AMBIGUOUS: { id: 'AMBIGUOUS', rank: 1, label: bi('רב-משמעי', 'AMBIGUOUS'), definition: bi('יותר ממועמד אחד באותה רמה — אף אחד אינו נבחר; המועמדים מוצגים', 'more than one candidate at the same level — none is picked; the candidates are shown') },
  UNRESOLVED: { id: 'UNRESOLVED', rank: 0, label: bi('לא נפתר', 'UNRESOLVED'), definition: bi('אין מועמד, או שאין מפתח לנסות (שם ללא צורת התאגדות, מחרוזת משותפת, מקור שלא סונכרן)', 'no candidate, or no key to try (a name without a legal form, a joint string, a source not synced)') },
});
const RANK = Object.fromEntries(Object.values(MATCH).map((m) => [m.id, m.rank]));
const weakest = (states) => (states || []).filter((s) => RANK[s] != null).reduce((a, s) => (RANK[s] < RANK[a] ? s : a), 'VERIFIED');

/* ---- reasons ----------------------------------------------------------------------------------------------------- */
const REASONS = Object.freeze({
  COMPANY_NUMBER_FROM_SOURCE: bi('מספר החברה נמצא ברשומת מקור רשמי', 'the company number is carried by an official source record'),
  COMPANY_NUMBER_USER_PROVIDED: bi('מספר החברה סופק על ידי המשתמש', 'the company number was provided by the user'),
  REGISTRY_ROW_FOUND: bi('רשומה במאגר רשם החברות קיימת במספר זה', 'a Registrar row exists under that number'),
  REGISTRY_ROW_NOT_IN_COVERAGE: bi('המספר ידוע אך רשומת הרשם לא נשמרה בסנכרון', 'the number is known but the Registrar row was not kept by the sync'),
  EXACT_NORMALIZED_LEGAL_NAME_ONE_ROW: bi('שם משפטי רשום זהה (לאחר נרמול מרכאות / נקודות / מקפים / רווחים) ובדיוק רשומה אחת', 'the identical registered legal name (quotes / dots / hyphens / spacing normalized) and exactly one row'),
  REGISTRAR_NAME_UNIQUENESS: bi('רשם החברות אינו רושם שתי חברות בשם זהה — שם עם ציון צורת התאגדות מזהה חברה אחת', 'the Registrar does not register two companies under an identical name — a name with a legal-form marker names one company'),
  NAME_ONLY_NEVER_VERIFIED: bi('התאמה לפי שם בלבד — לעולם לא "מאומת"; אימות דורש מספר חברה ממקור או מהמשתמש', 'a name-only match — never VERIFIED; verification needs a company number from a source or the user'),
  SAME_NORMALIZED_NAME_MULTIPLE_ROWS: bi('יותר מרשומה אחת באותו שם מנורמל (למשל חברה מחוקה וחברה פעילה) — לא נבחר', 'more than one row under the same normalized name (e.g. a struck-off and an active company) — none picked'),
  LETTERS_ONLY_ONE_ROW: bi('אותן אותיות וספרות (ריווח / פיסוק שונים) ורשומה אחת — אפשרי בלבד', 'the same letters and digits (spacing / punctuation differ) and one row — possible only'),
  LETTERS_ONLY_MULTIPLE_ROWS: bi('אותן אותיות וספרות ביותר מרשומה אחת — רב-משמעי', 'the same letters and digits on more than one row — ambiguous'),
  NO_REGISTRY_ROW_WITH_THIS_NAME: bi('אין רשומה במאגר בשם זה (לא ברשם החברות / השותפויות כפי שסונכרנו)', 'no registry row under this name (companies / partnerships as synced)'),
  NAME_WITHOUT_LEGAL_FORM: bi('השם ללא ציון צורת התאגדות (בע"מ / ש.מ …) — לרוב אדם פרטי; לא מנסים', 'the name carries no legal-form marker (בע"מ / ש.מ …) — usually a private person; not attempted'),
  JOINT_WINNER_STRING: bi('מחרוזת זוכה משותפת (כמה גופים) — אינה ישות אחת', 'a joint winner string (several parties) — not one entity'),
  REGISTRY_NOT_SYNCED: bi('מאגר הרשם טרם סונכרן (data/dd) — אין על מה לפתור', 'the registry has not been synced (data/dd) — nothing to resolve against'),
  EXACT_OFFICIAL_KEY_JOIN: bi('צירוף במפתח רשמי מדויק', 'joined on an exact official key'),
  NO_EXECUTOR_ID: bi('רשומת האתר ללא מספר קבלן מבצע', 'the site row carries no executor number'),
  NO_CONTRACTOR_ROW_FOR_KEY: bi('אין רשומה בפנקס הקבלנים במספר זה', 'no contractors-register row under that number'),
  NO_COMPANY_NUMBER_ON_ROW: bi('רשומת הקבלן ללא מספר ישות (קבלן יחיד / רשומה ישנה)', 'the contractor row carries no entity number (an individual / an older row)'),
  OFFICIAL_KEY_FROM_FREE_TEXT: bi('מפתח רשמי (גוש/חלקה) שנקרא מתוך שדה טקסט חופשי', 'an official key (block/parcel) read from a free-text field'),
  LOT_NUMBER_IN_FREE_TEXT: bi('מספר מגרש בטקסט חופשי — אינו מפתח; מתאים למגרש אחד ביישוב', 'a lot number in free text — not a key; fits one lot in the locality'),
  LOT_NUMBER_FITS_SEVERAL: bi('מספר המגרש מתאים לכמה מגרשים ביישוב', 'the lot number fits several lots in the locality'),
  PARCEL_SHARED_BY_SEVERAL_RECORDS: bi('החלקה נושאת כמה רשומות — התאמת מיקום, לא זהות פרויקט', 'the parcel carries several records — a match of place, not a project identity'),
});
const reason = (code) => ({ code, ...(REASONS[code] || bi(code, code)) });

/* ---- the index over the synced rows ------------------------------------------------------------------------------ */
function buildIndex(companies, partnerships) {
  const mk = () => ({ byNumber: new Map(), byRegKey: new Map(), byLetters: new Map(), rows: 0 });
  const add = (I, row) => {
    if (!row || row.num == null) return;
    I.rows++; I.byNumber.set(String(row.num), row);
    const k = regKey(row.name), l = lettersKey(canonicalName(String(row.name || '').replace(/~/g, '"')));
    if (k) { if (!I.byRegKey.has(k)) I.byRegKey.set(k, []); I.byRegKey.get(k).push(row); }
    if (l) { if (!I.byLetters.has(l)) I.byLetters.set(l, []); I.byLetters.get(l).push(row); }
  };
  const C = mk(), P = mk();
  for (const r of (companies && companies.rows) || []) add(C, r);
  for (const r of (partnerships && partnerships.rows) || []) add(P, r);
  return { companies: C, partnerships: P, synced: !!(companies && companies.rows), fetchedAt: companies ? companies.fetchedAt || null : null,
    sourceModified: companies ? companies.sourceModified || null : null, partnershipsFetchedAt: partnerships ? partnerships.fetchedAt || null : null };
}

/* ---- company resolution ------------------------------------------------------------------------------------------ */
const LIMITS = {
  nameOnly: bi('פתרון לפי שם: המותג שנצפה ≠ חברת הפרויקט; שעבודים, הליכים ומצב רישום מתייחסים לחברה הרשומה הזו בלבד', 'a name resolution: the observed brand ≠ the project company; charges, proceedings and registered status refer to this legal company only'),
  noOwnership: bi('אין נתוני בעלות במקור: חברת אם / בת / SPV / ערב אינם נקבעים', 'no ownership data in the source: parent / subsidiary / SPV / guarantor are not determined'),
};
function resolveCompany(dev, index, opt = {}) {
  const name = dev && (dev.canonical || dev.name) || '';
  const kind = dev && dev.kind ? dev.kind : kindOf(canonicalName(name));
  const joint = dev && dev.joint != null ? !!dev.joint : isJoint(canonicalName(name));
  const keys = { regKey: regKey(name), lettersKey: lettersKey(canonicalName(name)) };
  const base = { entity: 'LEGAL_COMPANY', version: VERSION.id, developerId: dev && dev.id || null, name, kind, keys, source: kind === 'partnership' ? SRC.partnerships : SRC.ica, checkedAt: index && index.fetchedAt || null, sourceModified: index && index.sourceModified || null, chosen: null, candidates: [], basis: null, limitations: [LIMITS.nameOnly, LIMITS.noOwnership] };
  const done = (state, codes, extra = {}) => ({ ...base, state, reasons: codes.map(reason), ...extra });
  if (!index || !index.synced) return done('UNRESOLVED', ['REGISTRY_NOT_SYNCED']);
  /* 1. an official number (a source record or the user) → VERIFIED */
  const num = opt.companyNumber != null ? String(opt.companyNumber) : dev && dev.companyId != null ? String(dev.companyId) : null;
  if (num) {
    const row = index.companies.byNumber.get(num) || index.partnerships.byNumber.get(num) || null;
    if (row) return done('VERIFIED', [opt.companyNumber != null ? 'COMPANY_NUMBER_USER_PROVIDED' : 'COMPANY_NUMBER_FROM_SOURCE', 'REGISTRY_ROW_FOUND'], { chosen: row, candidates: [row], basis: 'exact-key', limitations: [LIMITS.noOwnership] });
    return done('UNRESOLVED', [opt.companyNumber != null ? 'COMPANY_NUMBER_USER_PROVIDED' : 'COMPANY_NUMBER_FROM_SOURCE', 'REGISTRY_ROW_NOT_IN_COVERAGE'], { basis: 'exact-key' });
  }
  if (joint) return done('UNRESOLVED', ['JOINT_WINNER_STRING']);
  if (kind !== 'company' && kind !== 'partnership') return done('UNRESOLVED', ['NAME_WITHOUT_LEGAL_FORM']);
  const I = kind === 'partnership' ? index.partnerships : index.companies;
  /* 2. the registered name, normalized → STRONG (one row) / AMBIGUOUS (several) */
  const exact = I.byRegKey.get(keys.regKey) || [];
  if (exact.length === 1) return done('STRONG_MATCH', ['EXACT_NORMALIZED_LEGAL_NAME_ONE_ROW', 'REGISTRAR_NAME_UNIQUENESS', 'NAME_ONLY_NEVER_VERIFIED'], { chosen: exact[0], candidates: exact, basis: 'normalized-name' });
  if (exact.length > 1) return done('AMBIGUOUS', ['SAME_NORMALIZED_NAME_MULTIPLE_ROWS', 'NAME_ONLY_NEVER_VERIFIED'], { candidates: exact.slice(0, 12), basis: 'normalized-name' });
  /* 3. letters only → POSSIBLE (one row) / AMBIGUOUS */
  const letters = (I.byLetters.get(keys.lettersKey) || []).filter((r) => regKey(r.name) !== keys.regKey);
  if (letters.length === 1) return done('POSSIBLE_MATCH', ['LETTERS_ONLY_ONE_ROW', 'NAME_ONLY_NEVER_VERIFIED'], { candidates: letters, basis: 'letters' });
  if (letters.length > 1) return done('AMBIGUOUS', ['LETTERS_ONLY_MULTIPLE_ROWS', 'NAME_ONLY_NEVER_VERIFIED'], { candidates: letters.slice(0, 12), basis: 'letters' });
  return done('UNRESOLVED', ['NO_REGISTRY_ROW_WITH_THIS_NAME']);
}

/* ---- contractor resolution --------------------------------------------------------------------------------------- */
function buildContractorsIndex(payload) {
  const byKablan = new Map(), byCompany = new Map(), byRegKey = new Map();
  for (const r of (payload && payload.rows) || []) {
    if (r.kablan != null) { const k = String(r.kablan); if (!byKablan.has(k)) byKablan.set(k, []); byKablan.get(k).push(r); }
    if (r.company) { const c = String(r.company); if (!byCompany.has(c)) byCompany.set(c, []); byCompany.get(c).push(r); }
    const rk = regKey(r.name); if (rk) { if (!byRegKey.has(rk)) byRegKey.set(rk, []); byRegKey.get(rk).push(r); }
  }
  return { byKablan, byCompany, byRegKey, synced: !!(payload && payload.rows), fetchedAt: payload ? payload.fetchedAt || null : null, sourceModified: payload ? payload.sourceModified || null : null, rows: payload && payload.rows ? payload.rows.length : 0 };
}
function resolveContractor(executorId, cIndex) {
  const base = { entity: 'CONTRACTOR', version: VERSION.id, key: executorId == null ? null : String(executorId), source: SRC.contractors, checkedAt: cIndex && cIndex.fetchedAt || null, sourceModified: cIndex && cIndex.sourceModified || null, chosen: null, candidates: [], basis: null };
  const done = (state, codes, extra = {}) => ({ ...base, state, reasons: codes.map(reason), ...extra });
  if (!cIndex || !cIndex.synced) return done('UNRESOLVED', ['REGISTRY_NOT_SYNCED']);
  if (executorId == null || String(executorId).trim() === '' || String(executorId) === '0') return done('UNRESOLVED', ['NO_EXECUTOR_ID']);
  const rows = cIndex.byKablan.get(String(executorId)) || [];
  if (!rows.length) return done('UNRESOLVED', ['NO_CONTRACTOR_ROW_FOR_KEY'], { basis: 'exact-key' });
  /* one contractor number — several branch rows of the same contractor are one entity */
  return done('VERIFIED', ['EXACT_OFFICIAL_KEY_JOIN'], { chosen: rows[0], candidates: rows, basis: 'exact-key', branches: rows.map((r) => ({ code: r.branchCode, branch: r.branch, group: r.group, sivug: r.sivug, hekef: r.hekef, recognized: r.recognized })) });
}
/** a contractor row → its legal company (MISPAR_YESHUT = the company number) */
function contractorCompany(row, index) {
  const base = { entity: 'LEGAL_COMPANY', version: VERSION.id, source: `${SRC.contractors} → ${SRC.ica}`, chosen: null, candidates: [], basis: null, checkedAt: index && index.fetchedAt || null, sourceModified: index && index.sourceModified || null };
  const done = (state, codes, extra = {}) => ({ ...base, state, reasons: codes.map(reason), ...extra });
  if (!row) return done('UNRESOLVED', ['NO_CONTRACTOR_ROW_FOR_KEY']);
  const num = row.company ? String(row.company).trim() : '';
  if (!/^\d{8,9}$/.test(num)) return done('UNRESOLVED', ['NO_COMPANY_NUMBER_ON_ROW']);
  if (!index || !index.synced) return done('UNRESOLVED', ['COMPANY_NUMBER_FROM_SOURCE', 'REGISTRY_NOT_SYNCED'], { number: num });
  const co = index.companies.byNumber.get(num) || index.partnerships.byNumber.get(num) || null;
  if (co) return done('VERIFIED', ['COMPANY_NUMBER_FROM_SOURCE', 'REGISTRY_ROW_FOUND'], { chosen: co, candidates: [co], basis: 'exact-key', number: num });
  return done('UNRESOLVED', ['COMPANY_NUMBER_FROM_SOURCE', 'REGISTRY_ROW_NOT_IN_COVERAGE'], { number: num, basis: 'exact-key' });
}
/** a name written by another source (a permit holder, a closed-site executor) → a contractor / company by exact normalized name (STRONG at best) */
function resolveByName(name, byRegKey, { entity = 'LEGAL_COMPANY', source = SRC.ica } = {}) {
  const k = regKey(name);
  const base = { entity, version: VERSION.id, name: canonicalName(name), keys: { regKey: k }, source, chosen: null, candidates: [], basis: 'normalized-name' };
  const done = (state, codes, extra = {}) => ({ ...base, state, reasons: codes.map(reason), ...extra });
  if (!byRegKey) return done('UNRESOLVED', ['REGISTRY_NOT_SYNCED']);
  /* a legal-form marker — or the contractors register's own truncation of it ("… בע") */
  const c = canonicalName(name), marked = kindOf(c) !== 'unmarked' || /\sבע$/.test(c);
  if (!marked && entity === 'LEGAL_COMPANY') return done('UNRESOLVED', ['NAME_WITHOUT_LEGAL_FORM']);
  const one = (rows) => (marked ? done('STRONG_MATCH', ['EXACT_NORMALIZED_LEGAL_NAME_ONE_ROW', 'NAME_ONLY_NEVER_VERIFIED'], { chosen: rows[0], candidates: rows })
    : done('POSSIBLE_MATCH', ['NAME_WITHOUT_LEGAL_FORM', 'NAME_ONLY_NEVER_VERIFIED'], { candidates: rows }));   /* a person's name: possible at most, never chosen */
  const rows = byRegKey.get(k) || [];
  if (rows.length === 1) return one(rows);
  if (rows.length > 1) {
    /* several branch rows of ONE contractor are one entity */
    const ids = new Set(rows.map((r) => String(r.kablan != null ? r.kablan : r.num)));
    if (ids.size === 1) return one(rows);
    return done('AMBIGUOUS', ['SAME_NORMALIZED_NAME_MULTIPLE_ROWS', 'NAME_ONLY_NEVER_VERIFIED'], { candidates: rows.slice(0, 12) });
  }
  return done('UNRESOLVED', ['NO_REGISTRY_ROW_WITH_THIS_NAME']);
}

/* ---- company facts ----------------------------------------------------------------------------------------------- */
const STATUS_CLASS = [
  [/^פעילה זמנית/, 'TEMPORARILY_ACTIVE', bi('פעילה זמנית', 'temporarily active')],
  [/^פעילה/, 'ACTIVE', bi('פעילה', 'active')],
  [/^מחוקה/, 'STRUCK_OFF', bi('מחוקה', 'struck off')],
  [/^מחוסלת מרצון/, 'DISSOLVED_VOLUNTARY', bi('מחוסלת מרצון', 'dissolved voluntarily')],
  [/^מחוסלת עקב מיזוג/, 'DISSOLVED_MERGER', bi('מחוסלת עקב מיזוג', 'dissolved by merger')],
  [/^בפרוק מרצון|^פורקה מרצון|מחוקה מרצון/, 'IN_VOLUNTARY_LIQUIDATION', bi('בפירוק מרצון', 'in voluntary liquidation')],
  [/^בפרוק ע|^פורקה ע/, 'IN_COURT_LIQUIDATION', bi('בפירוק על ידי בית משפט', 'in court liquidation')],
  [/^חיסול ע|על ידי בית משפט/, 'DISSOLVED_BY_COURT', bi('חוסלה על ידי בית משפט', 'dissolved by the court')],
];
function statusClassOf(status) {
  const s = String(status || '').replace(/~/g, '"').trim();
  if (!s) return { cls: 'UNKNOWN', label: bi('לא צוין', 'not stated'), verbatim: null };
  for (const [re, cls, label] of STATUS_CLASS) if (re.test(s)) return { cls, label, verbatim: s };
  return { cls: 'OTHER', label: bi(s, s), verbatim: s };
}
/** the financial-data coverage class — from the registered TYPE only (never from size, activity or a guess) */
function financialCoverageOf(type) {
  const t = String(type || '').replace(/~/g, '"');
  if (/ציבורית/.test(t)) return { cls: 'PUBLIC_COMPANY', label: bi('חברה ציבורית (סוג תאגיד ברשם) — דוחות כספיים אינם בכיסוי הנוכחי', 'PUBLIC COMPANY (registry type) — financial statements NOT in current coverage'), statementsAvailable: false };
  if (/פרטית/.test(t)) return { cls: 'PRIVATE_WITH_LIMITED_PUBLIC_DATA', label: bi('חברה פרטית — נתונים כספיים ציבוריים אינם זמינים בכיסוי הנוכחי', 'PRIVATE WITH LIMITED PUBLIC DATA — public financial data not available in current coverage'), statementsAvailable: false };
  if (/חו"ל|חול|זרה/.test(t)) return { cls: 'FOREIGN_COMPANY', label: bi('חברה זרה — נתונים כספיים ציבוריים אינם בכיסוי', 'FOREIGN COMPANY — public financial data not in coverage'), statementsAvailable: false };
  return { cls: 'UNKNOWN', label: bi('סוג התאגיד לא צוין — לא ניתן לסווג', 'registry type not stated — cannot be classified'), statementsAvailable: false };
}
function companyFacts(row) {
  if (!row) return null;
  const st = statusClassOf(row.status), fin = financialCoverageOf(row.type);
  const violating = /מפרה/.test(String(row.violating || ''));
  return { id: 'co:' + row.num, number: String(row.num), name: canonicalName(String(row.name || '').replace(/~/g, '"')), nameVerbatim: row.name || null,
    status: st, type: row.type || null, financialCoverage: fin, violating: { flag: violating, label: violating ? bi('חברה מפרה — הפרת חובות דיווח לפי הרשם (דוח שנתי / אגרה); אינה חדלות פירעון', 'a "violating company" — statutory filing breach per the Registrar (annual report / fee); NOT insolvency') : bi('ללא דגל הפרה', 'no breach flag') },
    lastAnnualReportYear: row.lastReport != null && String(row.lastReport) !== '' ? Number(row.lastReport) : null, incorporated: row.incorporated || null, city: row.city || null, subStatus: row.sub || null,
    source: row.kind === 'partnership' ? SRC.partnerships : SRC.ica, cls: 'OFFICIAL' };
}

/* ---- official keys read from free text --------------------------------------------------------------------------- */
/** "6979 / 3", "גוש 6979 חלקה 3", "גוש: 6979, חלקה: 3" → { block, parcel }; anything else → null */
function parseParcel(text) {
  const s = String(text || '');
  let m = s.match(/גוש\D{0,6}(\d{3,6})\D{1,12}?חלק(?:ה|ות)\D{0,6}(\d{1,5})/);
  if (!m) m = s.match(/^\s*(\d{3,6})\s*\/\s*(\d{1,5})\s*$/);
  return m ? { block: Number(m[1]), parcel: Number(m[2]), key: `parcel:${Number(m[1])}/${Number(m[2])}` } : null;
}
/** "מגרש 142", "מגרש 142-(שכ' הפארק)" → 142 (one number only; "מגרשים 1-5" → null) */
function parseLotNumber(text) {
  const s = String(text || ''); if (/מגרשים/.test(s)) return null;
  const m = s.match(/מגרש\D{0,4}(\d{1,5})(?!\d)/);
  return m ? Number(m[1]) : null;
}

module.exports = { VERSION, SRC, ENTITY_MODEL, MATCH, RANK, REASONS, reason, weakest, regKey, buildIndex, resolveCompany, buildContractorsIndex, resolveContractor, contractorCompany, resolveByName, statusClassOf, financialCoverageOf, companyFacts, parseParcel, parseLotNumber };
