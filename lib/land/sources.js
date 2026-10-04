// PROPX · Land & Tender — the source registry.
//
// Every public source of residential land, marketing and tenders that the
// vertical reads, or audited and does not read, with what was verified about
// it on the GitHub runner (scripts/land-discover.js, 04.10.2026). The
// classification decides production eligibility; nothing below it is
// softened on the page.
//
// Classes: CONFIRMED_STRUCTURED_API · CONFIRMED_STRUCTURED_FILE · CONFIRMED_GIS ·
//          OFFICIAL_SEMI_STRUCTURED · OFFICIAL_PAGE_ONLY · STALE · UNJOINABLE · RESTRICTED · UNUSABLE

'use strict';

const SOURCES = Object.freeze([
  {
    id: 'rmi:michrazim',
    publisher: 'רשות מקרקעי ישראל', publisherEn: 'Israel Land Authority',
    name: 'מכרזי מקרקעין — אתר המכרזים (MichrazimSite)',
    url: 'https://apps.land.gov.il/MichrazimSite/',
    endpoints: {
      search: 'POST https://apps.land.gov.il/MichrazimSite/api/SearchApi/Search',
      detail: 'GET https://apps.land.gov.il/MichrazimSite/api/MichrazDetailsApi/Get?michrazID=',
      map: 'GET https://apps.land.gov.il/MichrazimSite/api/MichrazDetailsApi/GetMichrazMapaDetails?michrazID=',
      tables: 'GET https://apps.land.gov.il/MichrazimSite/api/GeneralTablesApi/Get',
      settlements: 'GET https://apps.land.gov.il/MichrazimSite/api/YeshuvimApi/Get',
    },
    sourceType: 'json-api (the public site\'s own API; no key; not formally documented as a stable contract)',
    cadence: 'continuous — the site is the Authority\'s operational tender system; UpdateDate per tender',
    geographicCoverage: 'national — every Authority tender; KodYeshuv (CBS code) + neighbourhood/site text',
    historicalCoverage: 'tenders published 2000-01-08 → present (10,192 on 04.10.2026; 439 active)',
    stableIds: { tender: 'MichrazID (e.g. 20260158; MichrazName "158/2026")', lot: 'TikID (per lot/compound)', bid: 'HatzaaID', parcel: 'GushHelka.id' },
    tenderIdentifiers: 'MichrazID, MichrazName', planIdentifiers: 'Tik[].TochnitMigrash[].Tochnit (plan number) + TabaSearch planNumber ids in MichrazLinks',
    parcelIdentifiers: 'Tik[].GushHelka[] (gush, helka)',
    pagination: 'none — the search answers the whole list in one response (~10k rows)',
    caps: 'none observed; one detail call per tender (lots, bids, winners); map call only for tenders with a published polygon',
    latestSourceUpdate: 'per tender: UpdateDate (detail); list: PirsumDate max 2026-08-17, SgiraDate max 2027-01-11 on 04.10.2026',
    lastPropxCheck: '2026-10-04',
    structure: 'structured',
    classification: 'CONFIRMED_STRUCTURED_API',
    productionEligible: true,
    limitations: [
      'VAT basis of amounts (winning sum, appraisal, minimum, development expenses) is not stated by the API — labelled "not stated by the source"',
      'מחיר למשתכן tenders compete on a price per m² of the apartment (SchumZchiya is ₪/m², MechirMaximum the ceiling), not on land consideration',
      'lottery / priority types (הרשמה והגרלה, מגרש בלתי מסוים, קדימות) allocate by lottery / priority; whether the price competes is the detail\'s SugTacharut (1 = price competition — seen on types 2 and 3), otherwise a fixed lot price',
      'MechirSaf = 1 is a token minimum; a premium over it is meaningless and is not computed',
      'no contract-signing, permit or construction stage: those come only from exact joins to other sources',
      'bids (mpHatzaaotMitcham) are published for recent tenders; an empty list is not evidence of zero bids',
      'map polygons exist for a subset (mostly recent) of tenders; others get locality-level presentation',
    ],
  },
  {
    id: 'datagov:rmi:planning-inventory',
    publisher: 'רשות מקרקעי ישראל', publisherEn: 'Israel Land Authority',
    name: 'מלאי תכנוני למגורים (housingunits-planning-inventory)',
    url: 'https://data.gov.il/dataset/housingunits-planning-inventory',
    endpoints: { datastore: 'https://data.gov.il/api/3/action/datastore_search?resource_id=99aad98f-2b54-4eea-834d-650b56389bf3' },
    resourceId: '99aad98f-2b54-4eea-834d-650b56389bf3',
    sourceType: 'ckan-datastore (XLS upload)', cadence: 'not stated; last modified 2022-02-17',
    geographicCoverage: 'national — state land only (רמ"י / משרד הבינוי / רשות מקומית initiated plans); סמל יישוב per plan',
    historicalCoverage: '1,112 plans; stages תוקף 940 · תנאי סף 111 · הפקדה 61; 436,744 potential units for marketing',
    stableIds: { plan: 'מספר תוכנית (plan number) + מפתח לפוליגון תכנית (tochnitId of apps.land.gov.il/IturTabot2)' },
    tenderIdentifiers: null, planIdentifiers: 'מספר תוכנית (e.g. תמל/1064, ג/14742, 607-0359828)', parcelIdentifiers: null,
    pagination: 'CKAN datastore, 1,000 rows per page', caps: 'none',
    latestSourceUpdate: '2022-02-17T10:59:42', lastPropxCheck: '2026-10-04',
    structure: 'structured',
    classification: 'STALE',   // a confirmed structured file, but its content stops in February 2022
    productionEligible: true,  // shown with its date and the STATE LAND ONLY limitation, never as current supply
    limitations: [
      'STATE LAND ONLY: not private plans, not urban renewal, not all housing construction in Israel',
      'content last modified 17.02.2022 — plan stages and unit counts are as of then',
      '"יח"ד פוטנציאל לשיווק" are potential units for marketing, not available or marketed units',
      'GIS layer is a ZIP shapefile (2018) — not read; no coordinates are used from it',
    ],
  },
  {
    id: 'datagov:moch:development-tenders',
    publisher: 'משרד הבינוי והשיכון', publisherEn: 'Ministry of Construction and Housing',
    name: 'פיתוח ותשתית — תוצאות מכרזי פיתוח ותשתית (tichnun-pituah)',
    url: 'https://data.gov.il/dataset/tichnun-pituah',
    endpoints: { tenders: 'https://data.gov.il/api/3/action/datastore_search?resource_id=04e375ef-08a6-4327-8044-7bd595c4d106',
      bids: 'https://data.gov.il/api/3/action/datastore_search?resource_id=722aebc6-5541-46fa-abcf-15b06e02c70c' },
    resourceId: '04e375ef-08a6-4327-8044-7bd595c4d106', bidsResourceId: '722aebc6-5541-46fa-abcf-15b06e02c70c',
    sourceType: 'ckan-datastore (CSV)', cadence: 'not stated; re-uploaded 2026-08-01',
    geographicCoverage: 'national — Ministry development sites; LamasCode (CBS) + AtarCode/AtarName (site)',
    historicalCoverage: '594 tenders, publication 2014-01-09 → 2024-09-01 (decisions to 2022-12-21); 5,815 bids',
    stableIds: { tender: 'TenderNumber + TenderYear (TenderID is empty in 593 of 594 rows)', bid: '_id' },
    tenderIdentifiers: 'TenderNumber, TenderYear', planIdentifiers: null, parcelIdentifiers: null,
    pagination: 'CKAN datastore', caps: 'none',
    latestSourceUpdate: '2026-08-01', lastPropxCheck: '2026-10-04',
    structure: 'structured',
    classification: 'CONFIRMED_STRUCTURED_FILE',
    productionEligible: true,   // as an enabling-development signal per locality / site — never as a land sale
    limitations: [
      'infrastructure / development works (drainage, roads, systems) — NOT residential land sales',
      'the bids table (722aebc6: ProposalAmount, ProposalStatus זוכה/נפסל, ProviderName) carries a TenderID (4117–7981) that matches nothing in the tenders table (TenderID empty, TenderNumber 11611…): UNJOINABLE — winners and amounts cannot be attached to a tender',
      'bulk of the rows are 2014–2018; 2023: 4, 2024: 1',
    ],
  },
  {
    id: 'datagov:moch:development-bids',
    publisher: 'משרד הבינוי והשיכון', publisherEn: 'Ministry of Construction and Housing',
    name: 'סכומי ההצעות למכרזי הפיתוח והתשתית', url: 'https://data.gov.il/dataset/tichnun-pituah',
    resourceId: '722aebc6-5541-46fa-abcf-15b06e02c70c', sourceType: 'ckan-datastore (CSV)', cadence: 'with the tenders table',
    geographicCoverage: 'none in the table', historicalCoverage: '5,815 bids over 596 TenderIDs; 596 זוכה, 275 נפסל',
    stableIds: { bid: '_id', tender: 'TenderID (foreign, unresolved)' }, pagination: 'CKAN datastore', caps: 'none',
    latestSourceUpdate: '2026-08-01', lastPropxCheck: '2026-10-04', structure: 'structured',
    classification: 'UNJOINABLE', productionEligible: false,
    limitations: ['its TenderID joins neither TenderID, _id nor TenderNumber of the tenders table (0 of 594 matches): not used'],
  },
  {
    id: 'datagov:moch:development-costs',
    publisher: 'משרד הבינוי והשיכון', publisherEn: 'Ministry of Construction and Housing',
    name: 'עלויות פיתוח בבניה העירונית (aluyot-pituach)', url: 'https://data.gov.il/dataset/aluyot-pituach',
    resourceId: 'bf164a03-55c7-4bea-8740-66ce60a51a2c', sourceType: 'ckan-datastore (CSV)', cadence: 'not stated; re-uploaded 2026-08-01',
    geographicCoverage: 'Ministry urban-construction projects: district, LamasCode, AtarCode/AtarName',
    historicalCoverage: '1,454 projects, all status "במכרז"; TenderIndexDate 2018 → 06/2026 (742 in 2025, 442 in 2026); 26,679 units',
    stableIds: { project: 'ProjectID' }, pagination: 'CKAN datastore', caps: 'none',
    latestSourceUpdate: '2026-08-01', lastPropxCheck: '2026-10-04', structure: 'structured',
    classification: 'CONFIRMED_STRUCTURED_FILE', productionEligible: true,
    limitations: ['development charges (DevelopPay, TenderDevPay, MosdotDevPay) per Ministry project — a Ministry cost schedule, not a tender result; no tender id, no parcel',
      'joins to tenders only by locality + site name when both carry them (none exact to an Authority lot)'],
  },
  {
    id: 'datagov:moch:construction-progress',
    publisher: 'משרד הבינוי והשיכון', publisherEn: 'Ministry of Construction and Housing',
    name: 'דיווחי התקדמות הבניה - בניה רוויה (hitkadmuthabnia)', url: 'https://data.gov.il/dataset/hitkadmuthabnia',
    resourceId: '1ec45809-5927-430a-9b30-77f77f528ce3', sourceType: 'ckan-datastore (CSV)', cadence: 'not stated; last modified 2024-03-01',
    geographicCoverage: 'Ministry-supervised sites: district, locality, site, compound, lot, gush/helka (3,408 rows with a gush), building',
    historicalCoverage: '10,371 buildings; contract years 1996 → 2021; stage dates as spreadsheet serials (stages 5, 7, 8, 16, 18, 29, 39, 42)',
    stableIds: { building: 'MISPAR_MITHAM + MISPAR_BINYAN' }, parcelIdentifiers: 'GUSH, HELKA', pagination: 'CKAN datastore', caps: 'none',
    latestSourceUpdate: '2024-03-01', lastPropxCheck: '2026-10-04', structure: 'structured',
    classification: 'STALE', productionEligible: true,   // as construction evidence for exact gush/helka + locality joins only
    limitations: ['content ends with contracts of 2021 and was last modified 01.03.2024', 'stage codes 5…42 are not glossed by the source; dates are kept as the source gives them',
      'marketing method (ר.מ.י קרקע / מחיר למשתכן) is the Ministry\'s label, kept verbatim'],
  },
  {
    id: 'iplan:xplan',
    publisher: 'מינהל התכנון', publisherEn: 'Planning Administration',
    name: 'Xplan — קוים כחולים / תכניות מקוונות (ArcGIS REST)',
    url: 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1',
    endpoints: { query: 'GET https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1/query?where=pl_number=…&outFields=*&f=pjson' },
    sourceType: 'ArcGIS REST MapServer', cadence: 'continuous (last_update_date per plan)',
    geographicCoverage: 'national', historicalCoverage: '37,453 plans submitted online since 2011 (layer 1)',
    stableIds: { plan: 'pl_number (e.g. 607-0359828, "תמל/ 1057"), mp_id, pl_id' }, planIdentifiers: 'pl_number',
    pagination: 'ArcGIS query (resultRecordCount)', caps: 'server limits per query',
    latestSourceUpdate: 'per plan', lastPropxCheck: '2026-10-04', structure: 'structured',
    classification: 'CONFIRMED_GIS', productionEligible: true,
    fields: { status: 'station_desc (תיאור סטטוס) + internet_short_status', unitsApproved: 'pq_authorised_quantity_120 (מגורים מאושר יח"ד)',
      unitsDelta: 'quantity_delta_120 (שינוי מס\' יח\' דיור)', landUse: 'pl_landuse_string', areaDunam: 'pl_area_dunam', gazette: 'pl_date_8 (תאריך פרסום ברשומות)' },
    limitations: ['pl_number may carry a space after the prefix ("תמל/ 1057"): joins compare the number with whitespace removed, nothing else',
      'legacy plan numbers of the Authority\'s lots (ג/19636, ג/14742 …) are not pl_number values of this layer — they do not join and are not guessed',
      'plans submitted before 2011 are absent'],
  },
  {
    id: 'rmi:results-press',
    publisher: 'רשות מקרקעי ישראל', name: 'הודעות תוצאות מכרזים (gov.il / land.gov.il pages)', url: 'https://www.gov.il/he/departments/israel_land_authority',
    sourceType: 'html pages', classification: 'OFFICIAL_PAGE_ONLY', productionEligible: false,
    limitations: ['the same results are served structured by rmi:michrazim (lots, winners, sums) — pages are not scraped'],
    lastPropxCheck: '2026-10-04',
  },
  {
    id: 'gov:tenders-portal',
    publisher: 'מינהל הרכש הממשלתי', name: 'מערכת המכרזים הממשלתית (mr.gov.il)', url: 'https://mr.gov.il/ilgstorefront/he/search/?s=TENDER',
    sourceType: 'html', classification: 'OFFICIAL_PAGE_ONLY', productionEligible: false,
    limitations: ['government procurement (services, works) — not land marketing; a procurement record is never classified as a land tender'],
    lastPropxCheck: '2026-10-04',
  },
]);

const byId = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
module.exports = { SOURCES, byId };
