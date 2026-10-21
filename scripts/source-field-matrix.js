// PROPX · SOURCE-TO-FIELD COVERAGE MATRIX (21.10.2026, the master data directive M4 / §9) — every field of the directive's data universe
// (§6.1–6.12) against the current PROPX system, in ONE of the directive's eight classes, with the catalogue sources that hold it
// (ids of lib/trust/discovery/2026-10-21-source-universe.json — the builder refuses an id that is not there) and where PROPX stores and
// shows it (a stored path must exist — the builder checks it). Written by hand from the code and the catalogue; nothing here is measured
// — the measured improvements are in the universe file's `improvements` block.

'use strict';

const CLASSES = Object.freeze({
  STORED_DISPLAYED: 'Already stored and correctly displayed',
  STORED_NOT_DISPLAYED: 'Stored but not displayed',
  IN_SOURCE_NOT_INGESTED: 'Present in an existing source but not ingested',
  NEW_SOURCE_AVAILABLE: 'Available from a newly discovered source',
  NEEDS_NORMALIZATION: 'Available but needs normalization',
  GEO_AMBIGUOUS: 'Available but geographically ambiguous',
  ACCESS_RESTRICTED: 'Unavailable under current access restrictions',
  UNRELIABLE_OR_UNUSABLE: 'Unreliable or legally unusable',
});

const F = (domain, field, cls, sources, propx, note) => ({ domain, field, class: cls, sources, propx, note });
const P = (stored, shown) => ({ stored: stored || null, shown: shown || null });

const MATRIX = [
  /* 6.1 geographic identity and addresses */
  F('6.1 geography', 'Country · district · locality (CBS code)', 'STORED_DISPLAYED', ['datagov:pkg:citiesandsettelments'], P('data/geo/localities.json', 'geo search · dossier · every geography card'), 'keyed by the official code, never a name'),
  F('6.1 geography', 'Verified neighbourhood links', 'STORED_DISPLAYED', ['datagov:pkg:citiesandsettelments'], P('data/geo/neighborhoods.json', 'Street Intelligence (VERIFIED NEIGHBOURHOOD only through a verified link)'), 'a source label is printed as such, never promoted to verified'),
  F('6.1 geography', 'Municipal neighbourhood boundaries (Haifa · Netanya · Beer Sheva crosswalk)', 'GEO_AMBIGUOUS', ['muni:haifa:planning-preservation', 'datagov:pkg:stat_n-hoods_table-br7'], P(null, null), 'single cities, municipal definitions — not a national neighbourhood layer; read only with a verified crosswalk'),
  F('6.1 geography', 'Official street identity (st:<locality>:<code>)', 'STORED_DISPLAYED', ['datagov:pkg:321'], P('data/geo/streets/directory.json', 'search · Street Intelligence · street report'), 'registry-wide discoverability audit: data/geo/streets/search-audit.json'),
  F('6.1 geography', 'Street aliases / synonyms', 'STORED_DISPLAYED', ['datagov:pkg:israel-streets-synom'], P('data/geo/streets/synonyms.json', 'search (tier 2 / 5 synonym ranks)'), null),
  F('6.1 geography', 'House numbers and street points', 'STORED_DISPLAYED', ['ledger:over:govmap-layer:file', 'ledger:over:deals-register'], P('data/geo/street-geo', 'street report geometry · transport distances'), 'points of the GovMap-layer file (11,900 / 11,900 validated); a house number in a search is read and ignored'),
  F('6.1 geography', 'National address points (house-level geocoding)', 'ACCESS_RESTRICTED', ['govmap:api', 'datagov:pkg:addresses-br7'], P(null, null), 'GovMap refuses the runner (403); only Beer Sheva publishes address points openly'),
  F('6.1 geography', 'Building footprints / locations', 'GEO_AMBIGUOUS', ['datagov:pkg:buildings-br7', 'muni:jerusalem:cadastre-buildings'], P(null, null), 'single cities only; no national building layer is open'),
  F('6.1 geography', 'Census statistical areas (figures)', 'STORED_NOT_DISPLAYED', ['datagov:pkg:2022'], P('data/reference/census-2022/rows.json.gz', null), '2,193 statistical-area rows stored; no official stat-area boundary is open, so a street is never placed in one — locality context only is shown'),
  F('6.1 geography', 'Cadastral block / parcel / sub-parcel ids', 'STORED_DISPLAYED', ['ledger:over:deals-register', 'ledger:over:nadlan-crosswalk'], P('data/streets/evidence', 'street deal table (block / parcel / sub)'), null),
  F('6.1 geography', 'Cadastral parcel and block polygons', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:shape', 'datagov:pkg:subgushallshape', 'datagov:pkg:modern-cadaster'], P(null, null), 'Survey of Israel files on data.gov.il — state per the verify pass (file host / licence); 667 MB parcels ZIP'),
  F('6.1 geography', 'Land-use areas (designations)', 'NEW_SOURCE_AVAILABLE', ['iplan:land-use'], P(null, null), '564,018 polygons answer — not ingested'),
  F('6.1 geography', 'Administrative / planning boundaries (jurisdictions, local committees)', 'NEW_SOURCE_AVAILABLE', ['iplan:boundaries'], P('lib/geo/boundaries.js', 'map: the six CBS district outlines only'), 'municipal jurisdiction polygons answer — not ingested'),

  /* 6.2 transactions */
  F('6.2 transactions', 'Latest recorded transactions (union of every source PROPX reads)', 'STORED_DISPLAYED', ['ledger:over:deals-register', 'ledger:over:govmap-layer', 'ledger:over:govmap-layer:file'], P('data/txevents', 'transactions section · Street Intelligence (newest event of every source)'), 'the official channels themselves are refused (below)'),
  F('6.2 transactions', 'Official Tax Authority register (direct)', 'ACCESS_RESTRICTED', ['misim:svinfonadlan', 'nadlan.gov.il:site', 'govil:tax-authority-real-estate-service', 'ledger:taxes:nadlan-register'], P(null, null), 'identification screen / reCAPTCHA / bot screen — never bypassed'),
  F('6.2 transactions', 'Full defensible history (ALL)', 'STORED_DISPLAYED', ['ledger:over:deals-register', 'ledger:over:govmap-layer:file'], P('data/txevents/history', 'transactions ALL (paged by date span)'), null),
  F('6.2 transactions', 'Date · price · property type · rooms · area · floor · build year', 'STORED_DISPLAYED', ['ledger:over:deals-register'], P('data/streets/evidence', 'street deal table · transactions table'), 'fields as the register prints them'),
  F('6.2 transactions', 'Ownership share (portion sold)', 'STORED_DISPLAYED', ['ledger:over:deals-register'], P('data/streets/evidence', 'partial sales never priced'), 'the register states the portion; the GovMap-layer copy does not (below)'),
  F('6.2 transactions', 'Ownership share in the newer GovMap-layer copy', 'UNRELIABLE_OR_UNUSABLE', ['ledger:over:govmap-layer'], P('data/streets/recent', 'PRICE NOT USED IN MARKET STATISTICS · OWNERSHIP SHARE NOT STATED'), 'no share field; partial and whole sales indistinguishable — never priced'),
  F('6.2 transactions', 'New versus second-hand (per deal)', 'NEEDS_NORMALIZATION', ['ledger:over:deals-register'], P('data/streets/evidence', 'PROBABLE NEW by build year, tagged'), 'inferred from the build year — never a source flag'),
  F('6.2 transactions', 'Duplicates · source conflicts · corrections', 'STORED_DISPLAYED', ['ledger:over:govmap-layer', 'ledger:over:deals-register'], P('data/txevents', 'event states CONFLICT · POSSIBLE_DUPLICATE'), null),
  F('6.2 transactions', 'Source snapshot · reporting lag · PROPX check (five dates)', 'STORED_DISPLAYED', ['ledger:over:deals-register'], P('data/transactions', 'freshness line on every transaction surface'), null),
  F('6.2 transactions', 'Monthly dwellings sold — new (national + district)', 'STORED_DISPLAYED', ['cbs:series-api'], P('data/cbs-sales/latest.json', 'board · dossier'), null),
  F('6.2 transactions', 'Monthly dwellings sold — ALL and SECOND-HAND (national + district)', 'STORED_DISPLAYED', ['cbs:series-api', 'ledger:cbs:series:second-hand-sales-by-district'], P('data/cbs-sales/latest.json', 'dossier "All dwellings sold" + "Second-hand sold" (21.10.2026)'), 'integrated in this mission'),
  F('6.2 transactions', 'Monthly sales by CITY', 'ACCESS_RESTRICTED', ['cbs:new-home-sales-by-city'], P(null, 'Tel Aviv-Yafo transcription only'), 'published only in a release PDF'),

  /* 6.3 values and prices */
  F('6.3 prices', 'Comparable transactions · ₪/m² · street statistics with sample state', 'STORED_DISPLAYED', ['ledger:over:deals-register'], P('data/streets/evidence', 'Street Intelligence (SUPPORTED / LIMITED / INSUFFICIENT / NONE)'), null),
  F('6.3 prices', 'Official dwelling price indices (all dwellings, districts, new dwellings)', 'STORED_DISPLAYED', ['cbs:price-index-api'], P('data/market', 'market tape · price history card'), null),
  F('6.3 prices', 'Average transaction price by district / big city (Table 2.2)', 'STORED_DISPLAYED', ['cbs:average-prices-table-2-2'], P(null, 'price card 1 (TRANSCRIBED, OFFICIAL)'), 'no API — a labelled transcription in index.html'),
  F('6.3 prices', 'Street Value Model estimate + validation range', 'STORED_DISPLAYED', ['ledger:over:deals-register'], P('data/streets/model', 'MODEL card beside OBSERVED'), 'a model layer — never an appraisal'),
  F('6.3 prices', 'Decisive-appraisal records (שמאות מכריעה)', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:samay-dataset'], P(null, null), 'contents verified in the verify pass — not ingested; an appraisal decision is not a transaction'),

  /* 6.4 rental */
  F('6.4 rental', 'Rent market index (CPI rent component)', 'STORED_DISPLAYED', ['cbs:price-index-api'], P('data/market', 'land section rental panel · dossier'), 'a general benchmark — never project rent'),
  F('6.4 rental', 'Average rent in ₪ by area', 'ACCESS_RESTRICTED', ['ledger:cbs:average-rent-shekel'], P(null, null), 'not machine-readable'),
  F('6.4 rental', 'Rental asking prices (listings)', 'UNRELIABLE_OR_UNUSABLE', ['ledger:listings:madlan-yad2'], P(null, null), 'competitors\' asking prices — forbidden by the directive, never transaction or rent evidence'),
  F('6.4 rental', 'Long-term rental tenders and stated terms', 'STORED_DISPLAYED', ['ila:michrazim'], P('data/rental', 'land section rental panel'), null),
  F('6.4 rental', 'Public-housing vacancies / stock', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:diurtziburi'], P(null, null), 'MoCH public-housing files — not ingested'),

  /* 6.5 building and construction */
  F('6.5 construction', 'Permits · starts · completions · active construction (national + district)', 'STORED_DISPLAYED', ['ledger:cbs:series:construction-by-district'], P('data/construction/latest.json', 'dossier construction tiles · supply pipeline'), null),
  F('6.5 construction', 'Building permits per request with stages', 'STORED_DISPLAYED', ['ledger:tlv:iview2:permits-772', 'muni:tel-aviv:gis'], P('data/dd', 'project / developer due diligence (Tel Aviv-Yafo only)'), 'MUNICIPAL COVERAGE — one city'),
  F('6.5 construction', 'Building permits nationwide', 'ACCESS_RESTRICTED', ['ledger:iplan:rishuy-zamin'], P(null, null), 'no open national permit dataset; the licensing system is refused'),
  F('6.5 construction', 'Active / closed construction sites (safety notifications)', 'STORED_DISPLAYED', ['datagov:pkg:b072e36c-a53b-49e1-be08-4a608fcf4638', 'datagov:pkg:closed-construction-sites'], P('data/dd', 'due diligence'), null),
  F('6.5 construction', 'Green-building certified projects (SI 5281)', 'UNRELIABLE_OR_UNUSABLE', ['datagov:pkg:greenbuildings'], P(null, null), 'licence not stated — usable only after the founder\'s licence decision'),
  F('6.5 construction', 'New-home inventory (national) · months of supply', 'STORED_DISPLAYED', ['cbs:series-api'], P('data/cbs-sales/latest.json', 'board ticker · dossier (national)'), null),
  F('6.5 construction', 'MoCH construction progress per building', 'STORED_DISPLAYED', ['datagov:pkg:hitkadmuthabnia'], P('data/land', 'land drawer construction evidence'), 'STALE at source (2024-03)'),

  /* 6.6 planning and land */
  F('6.6 planning', 'Statutory plans · stages · boundaries · unit change', 'STORED_DISPLAYED', ['iplan:xplan'], P('data/planning/national', 'street report plans (INTERSECTS / NEARBY / AREA-WIDE) · renewal planning'), null),
  F('6.6 planning', 'Building rights / plan instructions', 'ACCESS_RESTRICTED', ['iplan:xplan'], P(null, null), 'the layer carries unit quantities, not rights; the instructions are documents on Mavat'),
  F('6.6 planning', 'VATMAL declared complexes', 'NEW_SOURCE_AVAILABLE', ['iplan:vatmal'], P(null, null), '203 complexes answer — not ingested'),
  F('6.6 planning', 'Conservation designations', 'NEW_SOURCE_AVAILABLE', ['iplan:shimour', 'muni:haifa:planning-preservation'], P(null, null), 'national points / polygons answer — not ingested'),
  F('6.6 planning', 'Land tenders · lots · winners · bids', 'STORED_DISPLAYED', ['ila:michrazim'], P('data/land', 'land & tenders section'), null),
  F('6.6 planning', 'State-land planning inventory', 'STORED_DISPLAYED', ['datagov:pkg:housingunits-planning-inventory'], P('data/land', 'land pipeline (STALE 2022, state land only)'), null),

  /* 6.7 urban renewal */
  F('6.7 renewal', 'Declared complexes · status · units', 'STORED_DISPLAYED', ['datagov:pkg:urban_renewal'], P('data/renewal', 'renewal tab · dossier'), null),
  F('6.7 renewal', 'Declared complex BOUNDARIES', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:gis_urban_renewal'], P(null, null), 'MoCH ZIP layers — state per the verify pass'),
  F('6.7 renewal', 'Municipal renewal layers (Jerusalem TAMA 38 / evacuation-construction)', 'GEO_AMBIGUOUS', ['muni:jerusalem:urban-renewal'], P(null, null), 'one city; municipal definitions'),

  /* 6.8 transport */
  F('6.8 transport', 'Public-transport stops within 300 m', 'STORED_DISPLAYED', ['datagov:pkg:bus_stops'], P('data/transport/bus-stops', 'street report "Public-transport access" (21.10.2026)'), 'integrated in this mission'),
  F('6.8 transport', 'Light-rail stations (status verbatim + layer month) + stop-registry evidence', 'STORED_DISPLAYED', ['datagov:pkg:lrt_stat', 'datagov:pkg:bus_stops'], P('data/transport/lrt', 'street report light-rail table'), 'a planned station is never shown as operating'),
  F('6.8 transport', 'Heavy-rail stations (located through the stop registry)', 'STORED_DISPLAYED', ['datagov:pkg:bus_stops', 'datagov:pkg:rail_stat'], P('data/transport/rail', 'street report rail tile'), 'the station layer itself has no accessible coordinates'),
  F('6.8 transport', 'Metro stations — locations', 'ACCESS_RESTRICTED', ['datagov:pkg:metro_stat', 'mot:shapefile-host'], P('data/transport/metro', 'named as not located'), 'names stored; the shapefile host answers 403'),
  F('6.8 transport', 'Rail / light-rail / metro line geometry', 'ACCESS_RESTRICTED', ['mot:shapefile-host', 'datagov:pkg:lrt_line', 'datagov:pkg:metro_line'], P(null, null), 'ZIP downloads answer 403 to the runner'),
  F('6.8 transport', 'Service frequency per stop (GTFS)', 'NEW_SOURCE_AVAILABLE', ['mot:gtfs'], P(null, null), 'the daily GTFS archive answers — not ingested'),
  F('6.8 transport', 'Statutory transport plans near a street', 'STORED_DISPLAYED', ['iplan:xplan', 'iplan:statutory-transport'], P('data/planning/national', 'street report rail-transit plans (1,000 m) — never an operating line'), null),
  F('6.8 transport', 'Five-year transport investment workplan', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:workplan'], P(null, null), 'state per the verify pass'),

  /* 6.9 neighbourhood and environment */
  F('6.9 environment', 'Population · households · tenure · wages · age (census 2022, locality)', 'STORED_DISPLAYED', ['datagov:pkg:2022'], P('data/reference/census-2022', 'dossier context · street report locality context (21.10.2026)'), 'integrated in this mission'),
  F('6.9 environment', 'Registered residents by age (weekly)', 'STORED_DISPLAYED', ['datagov:pkg:residents_in_israel_by_communities_and_age_groups'], P('data/reference/residents', 'dossier context (21.10.2026)'), 'integrated in this mission'),
  F('6.9 environment', 'Socio-economic cluster', 'UNRELIABLE_OR_UNUSABLE', ['datagov:pkg:social_economic_cluster'], P(null, null), '2019 edition — stale'),
  F('6.9 environment', 'Schools and kindergartens (locations)', 'UNRELIABLE_OR_UNUSABLE', ['datagov:pkg:mosdot_edu', 'datagov:pkg:mosdot'], P(null, null), 'the coordinates resource states no licence — licence review'),
  F('6.9 environment', 'Contaminated-land register (block / parcel, coordinates)', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:contaminatedterrains'], P(null, null), '3,798 rows, Other (Open) — not ingested'),
  F('6.9 environment', 'Cellular antennas', 'UNRELIABLE_OR_UNUSABLE', ['datagov:pkg:antennaactive'], P(null, null), 'licence not stated'),
  F('6.9 environment', 'Noise exposure', 'UNRELIABLE_OR_UNUSABLE', ['datagov:pkg:ap'], P(null, null), 'airport noise only (2019 data); no road / rail noise map exists in the catalogue'),
  F('6.9 environment', 'Flood risk', 'ACCESS_RESTRICTED', [], P(null, null), 'no flood-hazard layer in any examined catalogue'),

  /* 6.10 economic and financial */
  F('6.10 finance', 'Bank of Israel rate', 'STORED_DISPLAYED', ['boi:sdmx:BR'], P('data/market', 'market tape'), 'read through the market sync; the SDMX flow is redundant'),
  F('6.10 finance', 'Mortgage rates by track · new-loan volumes · LTV / PTI bands · outstanding balances · arrears', 'STORED_DISPLAYED', ['boi:sdmx:BIR_MRTG_99', 'boi:sdmx:BMB_99'], P('data/finance/latest.json', 'dossier "Housing finance" (21.10.2026)'), 'integrated in this mission; national only'),
  F('6.10 finance', 'Household debt aggregates', 'NEW_SOURCE_AVAILABLE', ['boi:sdmx:DEBT_AGG'], P(null, null), 'answers — not ingested (lower value)'),
  F('6.10 finance', 'CPI · construction-inputs index', 'STORED_DISPLAYED', ['cbs:price-index-api'], P('data/market', 'market tape · dossier macro'), null),

  /* 6.11 legal and regulatory */
  F('6.11 legal', 'Asset ownership type in the Land Registry', 'NEW_SOURCE_AVAILABLE', ['datagov:pkg:tabu_asset'], P(null, null), 'state per the verify pass — never a title record'),
  F('6.11 legal', 'Title extracts / owners', 'ACCESS_RESTRICTED', ['ledger:ica:company-extract'], P(null, null), 'paid, identified services only — not available'),

  /* 6.12 other */
  F('6.12 other', 'Company registry · filings · liquidation · contractors', 'STORED_DISPLAYED', ['datagov:pkg:ica_companies', 'datagov:pkg:ica-changes', 'datagov:pkg:pr2018', 'datagov:pkg:pinkashakablanim'], P('data/dd', 'due diligence · Sponsor X-Ray'), null),
  F('6.12 other', 'Project-level sales by developers', 'ACCESS_RESTRICTED', ['ledger:sales:project-level'], P(null, null), 'no open dataset exists'),
];

module.exports = { CLASSES, MATRIX };
