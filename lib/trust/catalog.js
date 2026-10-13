// PROPX · Data & Trust Center — one catalogue of every source PROPX reads (or audited and does not read), with
// what PROPX's own run logs say about each: the last check, the outcome, the latest observation, the source's
// own update date, how far back it goes, what it covers and what it cannot say.
//
// Nothing here is fetched. Every live field comes from files the scheduled syncs commit:
//   data/land/meta.json + sync-runs.jsonl          (scripts/land-sync.js, daily)
//   data/housing/meta.json + sync-runs.jsonl       (scripts/housing-sync.js, daily)
//   data/market/latest.json                        (scripts/market-sync.js, daily)
//   data/transactions/sync-runs.jsonl              (scripts/tx-sync.js, daily)
//   data/geo/registry-meta.json                    (scripts/build-geo-registry.py, on demand)
// and the source registries (lib/land/sources.js, lib/housing/source.js).
//
// RUN STATE vocabulary (one word per source, from its latest real check — a replay or a store-outcome entry is
// not a check of the source):
//   SUCCESS         the source answered and the data was read (content changed or re-derived)
//   UNCHANGED       the source answered; nothing changed
//   PARTIAL         the source answered part of what was asked (a budget, a cap, some requests failed)
//   REFUSED         the source refused this runner (HTTP 401 / 403 / 429) — never worked around
//   FAILED          the run failed; the last valid data stays, marked
//   SCHEMA_CHANGED  the source answered in a shape PROPX no longer recognizes — nothing applied
//   STALE           the last successful check is older than the cadence allows (shown over the run state)
//   NO_RUN          no recorded check (a source read only on request, or not automated yet)
// A source that is unavailable never becomes 0: its last valid data is kept and dated.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const LAND = require('../land/sources');
const { SOURCE: HOUSING } = require('../housing/source');
const { SOURCE: RENEWAL } = require('../renewal/source');
const { SOURCE: PLANNING } = require('../renewal/planning');

const ROOT = path.join(__dirname, '..', '..', 'data');
const STATES = ['SUCCESS', 'UNCHANGED', 'PARTIAL', 'REFUSED', 'FAILED', 'SCHEMA_CHANGED', 'STALE', 'NO_RUN'];
const HOUR = 3600e3;

const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function readRuns(f) {
  let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* torn line */ } }
  return out;
}

/** one run log entry → the vocabulary */
function stateOfRun(run) {
  if (!run) return 'NO_RUN';
  const status = String(run.status || '').toLowerCase(), err = String(run.error || run.lastError || '');
  if (/schema changed|missing column|not json|series not found|unrecognized shape/i.test(err)) return 'SCHEMA_CHANGED';
  if (status === 'refused' || /HTTP (401|403|429)\b/.test(err)) return 'REFUSED';
  if (status === 'failed' || status === 'error') return 'FAILED';
  if (status === 'partial') return 'PARTIAL';
  if (status === 'ok' || status === 'success') {
    if (run.detailStopped && /^(refused|budget|request-cap|time)/.test(run.detailStopped)) return 'PARTIAL';   // a refusal, budget, cap or deadline cut the read
    if (run.windowCheck === 'partial' || (Array.isArray(run.gaps) && run.gaps.length)) return 'PARTIAL';      // a window the sweep did not prove complete
    return run.contentChanged === false ? 'UNCHANGED' : 'SUCCESS';
  }
  return 'FAILED';
}
/** the state shown: STALE when the last good check is older than the cadence allows, else the run state */
function shownState(runState, lastGoodAt, staleAfterHours, now) {
  if (staleAfterHours && lastGoodAt && now - Date.parse(lastGoodAt) > staleAfterHours * HOUR) return 'STALE';
  return runState;                                    // never answered: the run state itself (REFUSED / FAILED …) says it
}
/* a check = a run that asked a source: never a store write, a replay, a run still in progress or one skipped before it asked */
const isCheck = (r) => r && !/:store$/.test(String(r.id || '')) && r.retrievalMethod !== 'replay' && r.retrievalMethod !== 'none'
  && !['running', 'skipped'].includes(String(r.status || '').toLowerCase());
const GOOD = new Set(['SUCCESS', 'UNCHANGED', 'PARTIAL']);
function runSummary(runs, { staleAfterHours, now }) {
  const checks = runs.filter(isCheck);
  const last = checks[checks.length - 1] || null;
  const lastGood = [...checks].reverse().find((r) => GOOD.has(stateOfRun(r))) || null;
  const at = (r) => (r ? r.finishedAt || r.startedAt || null : null);
  const runState = stateOfRun(last);
  return { runState, state: shownState(runState, at(lastGood), staleAfterHours, now), lastCheckAt: at(last), lastGoodAt: at(lastGood), lastRunId: last ? last.id || last.runKey || null : null,
    lastError: last && last.error ? String(last.error).slice(0, 240) : null, checksRecorded: checks.length,
    recent: checks.slice(-7).map((r) => ({ at: at(r), state: stateOfRun(r) })) };
}

/* ------------------------------------------------------------ the catalogue */
function catalog({ dataDir = ROOT, now = Date.now() } = {}) {
  const landMeta = readJson(path.join(dataDir, 'land', 'meta.json'));
  const landRuns = readRuns(path.join(dataDir, 'land', 'sync-runs.jsonl'));
  const housingMeta = readJson(path.join(dataDir, 'housing', 'meta.json'));
  const housingRuns = readRuns(path.join(dataDir, 'housing', 'sync-runs.jsonl'));
  const market = readJson(path.join(dataDir, 'market', 'latest.json'));
  const txRuns = readRuns(path.join(dataDir, 'transactions', 'sync-runs.jsonl'));
  const geoMeta = readJson(path.join(dataDir, 'geo', 'registry-meta.json'));
  const daily = { staleAfterHours: 50, now };   // a daily job may slip a run; two missed days is stale
  const landSum = runSummary(landRuns, daily);
  const lastLandJoins = [...landRuns].reverse().find((r) => isCheck(r) && r.joins && Object.keys(r.joins).length) || null;
  const joinState = (k) => {
    const j = lastLandJoins && lastLandJoins.joins[k];
    if (!j) return { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null };
    const runState = j.error ? stateOfRun({ status: 'failed', error: j.error }) : 'SUCCESS';
    const at = lastLandJoins.finishedAt || lastLandJoins.startedAt;
    return { runState, state: shownState(runState, j.error ? null : at, 50, now), lastCheckAt: at, lastError: j.error || null };
  };
  const out = [];
  const add = (e) => out.push({ inProduct: true, channel: 'official', ...e });

  /* land & tenders */
  const L = LAND.byId;
  add({ id: 'rmi:michrazim', vertical: 'land', usedFor: { he: 'מכרזי קרקע, מגרשים, זוכים, סכומים, יח"ד · רישום יזמים ופרויקטים', en: 'land tenders, lots, winners, sums, units · developer & project registry' },
    publisher: L['rmi:michrazim'].publisher, publisherEn: L['rmi:michrazim'].publisherEn, name: L['rmi:michrazim'].name, url: L['rmi:michrazim'].url,
    classification: L['rmi:michrazim'].classification, cadence: 'daily (land-sync.yml) · detail on a budget', geography: L['rmi:michrazim'].geographicCoverage,
    history: landMeta && landMeta.coverage ? `${landMeta.coverage.publishedFrom} → ${landMeta.coverage.publishedTo} (${landMeta.inLatestSource} tenders listed)` : L['rmi:michrazim'].historicalCoverage,
    latestObservation: landMeta && landMeta.coverage ? landMeta.coverage.publishedTo : null, latestObservationKind: 'latest tender publication date',
    sourceUpdatedAt: landMeta ? landMeta.snapshotFetchedAt : null, sourceUpdatedKind: 'list content last changed (PROPX observed)',
    coverage: landMeta && landMeta.detailCoverage ? { detailRead: landMeta.detailCoverage.retrieved ?? null, of: landMeta.inLatestSource ?? null } : null,
    snapshots: 'raw list snapshot per content hash (data/land/raw) · history of every changed field (history.jsonl) · nothing deleted',
    limitations: L['rmi:michrazim'].limitations, sync: landSum });
  for (const [id, key] of [['iplan:xplan', 'xplan'], ['datagov:rmi:planning-inventory', 'inventory'], ['datagov:moch:construction-progress', 'construction'], ['datagov:moch:development-costs', 'developmentCosts']]) {
    const s = L[id];
    const sourceAsOf = id === 'datagov:rmi:planning-inventory' ? (landMeta && landMeta.plans && landMeta.plans.inventoryAsOf) || s.latestSourceUpdate : id === 'datagov:moch:construction-progress' ? '2024-03-01' : s.latestSourceUpdate;
    add({ id, vertical: id === 'iplan:xplan' || id === 'datagov:rmi:planning-inventory' ? 'planning' : 'construction',
      usedFor: { 'iplan:xplan': { he: 'סטטוס תכנית ויח"ד מאושרות — צירוף לפי מספר תכנית מדויק', en: 'plan status and approved units — exact plan-number join' },
        'datagov:rmi:planning-inventory': { he: 'מלאי תכנוני (קרקעות מדינה בלבד, 2022)', en: 'planning inventory (state land only, 2022)' },
        'datagov:moch:construction-progress': { he: 'ראיית בנייה למגרש שנזכה — גוש וחלקה מדויקים', en: 'construction evidence for an awarded lot — exact block + parcel' },
        'datagov:moch:development-costs': { he: 'עלויות פיתוח לפי יישוב (הפניה בלבד)', en: 'development costs by locality (reference only)' } }[id],
      publisher: s.publisher, publisherEn: s.publisherEn, name: s.name, url: s.url, classification: s.classification, cadence: `${s.cadence} · re-read by the daily land sync`,
      geography: s.geographicCoverage, history: s.historicalCoverage, latestObservation: null, sourceUpdatedAt: sourceAsOf, sourceUpdatedKind: 'source content last modified',
      sourceStale: s.classification === 'STALE', limitations: s.limitations, sync: joinState(key) });
  }
  for (const s of LAND.SOURCES.filter((x) => !x.productionEligible || ['datagov:moch:development-tenders', 'rmi:results-press', 'gov:tenders-portal'].includes(x.id))) {
    if (out.some((x) => x.id === s.id)) continue;
    out.push({ id: s.id, vertical: 'land', inProduct: false, channel: 'official', publisher: s.publisher, publisherEn: s.publisherEn || null, name: s.name, url: s.url, classification: s.classification,
      usedFor: { he: 'נבדק ולא נקרא', en: 'audited, not read' }, cadence: s.cadence || null, geography: s.geographicCoverage || null, history: s.historicalCoverage || null,
      limitations: s.limitations || [], sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: s.lastPropxCheck || null, note: 'audited on the runner, not ingested' } });
  }

  /* government housing */
  add({ id: HOUSING.id, vertical: 'housing', usedFor: { he: 'הגרלות מחיר למשתכן / מחיר מטרה · פרויקטים · יזמים', en: 'subsidized-housing lotteries · projects · developers' },
    publisher: HOUSING.authority, publisherEn: HOUSING.authorityEn, name: `${HOUSING.dataset} — ${HOUSING.resource}`, url: HOUSING.page, classification: 'CONFIRMED_STRUCTURED_API',
    cadence: `source: ${HOUSING.cadence} · PROPX: daily (data-sync.yml)`, geography: 'national — CBS locality code + neighbourhood text',
    history: housingMeta && housingMeta.coverage ? `${housingMeta.coverage.lotteryDateFrom} → ${housingMeta.coverage.lotteryDateTo} (${housingMeta.records} lotteries)` : null,
    latestObservation: housingMeta && housingMeta.coverage ? housingMeta.coverage.lotteryDateTo : null, latestObservationKind: 'latest lottery date in the source',
    sourceUpdatedAt: housingMeta ? housingMeta.sourceUpdatedAt : null, sourceUpdatedKind: 'resource last modified (data.gov.il)',
    snapshots: 'raw snapshot when the content changes (data/housing/raw) · status history · upsert on LotteryId, nothing deleted',
    limitations: ['lotteries only — not market sales, not all subsidized construction', 'no tender, plan or parcel: never joined to a land tender', 'developer names may be cut by the source (shown as possible same entity, never merged)',
      'the latest lottery in the source is older than its last modification — the resource itself lags'],
    sync: runSummary(housingRuns, daily) });

  /* urban renewal */
  { const rm = readJson(path.join(dataDir, 'renewal', 'meta.json')), rr = readRuns(path.join(dataDir, 'renewal', 'sync-runs.jsonl'));
    add({ id: RENEWAL.id, vertical: 'renewal', usedFor: { he: 'מתחמי התחדשות עירונית — סטטוס, יח״ד קיימות / מוצעות, הכרזה', en: 'urban-renewal complexes — status, existing / proposed units, declaration' },
      publisher: RENEWAL.authority, publisherEn: RENEWAL.authorityEn, name: `${RENEWAL.dataset} — ${RENEWAL.resource}`, url: RENEWAL.page, classification: RENEWAL.classification,
      cadence: 'source: not stated (last modified monthly-ish) · PROPX: daily (renewal-sync.yml)', geography: rm && rm.coverage ? `${rm.coverage.localities} localities (CBS code)` : 'national — CBS locality code',
      history: rm && rm.coverage ? `declarations ${rm.coverage.declarationFrom} → ${rm.coverage.declarationTo} (${rm.inLatestSource} complexes)` : null,
      latestObservation: rm && rm.coverage ? rm.coverage.declarationTo : null, latestObservationKind: 'latest declaration date',
      sourceUpdatedAt: rm ? rm.sourceUpdatedAt : null, sourceUpdatedKind: 'resource last modified (data.gov.il)',
      snapshots: 'raw snapshot per content hash (data/renewal/raw) · history of every changed field · upsert on the complex number, nothing deleted',
      limitations: [RENEWAL.scope, 'a declared complex is not construction — the status says how far planning / licensing went', 'the additional-units column is not net new units in every row (shown as published)'],
      sync: runSummary(rr, daily) }); }

  /* urban renewal × XPlan (the exact planning join) */
  { const pm = (readJson(path.join(dataDir, 'renewal', 'planning.json')) || {}).meta || null, pr = readRuns(path.join(dataDir, 'renewal', 'planning-runs.jsonl')), J = pm && pm.join;
    add({ id: PLANNING.id, vertical: 'renewal', usedFor: { he: 'מצב תכנוני של מתחמי ההתחדשות — צירוף מדויק לפי מספר תכנית / מזהה מבא״ת', en: 'planning status of the renewal complexes — exact join by plan number / Mavat id' },
      publisher: PLANNING.authority, publisherEn: PLANNING.authorityEn, name: PLANNING.dataset, url: PLANNING.layer, classification: PLANNING.classification,
      cadence: 'source: continuous (the planning system) · PROPX: daily, after the complexes (renewal-sync.yml)', geography: 'national — the plans managed online',
      history: J ? `${J.exact} of ${J.complexes} complexes joined exactly (${J.matchRate}%) · ${J.ambiguous} ambiguous · ${J.notFound} not found · ${J.noIdentifier} without an identifier · ${J.notChecked} not checked` : null,
      latestObservation: pm ? pm.checkedAt : null, latestObservationKind: 'last read of the layer',
      snapshots: 'every plan upserted on its main id (mp_id), a history of each change (planning-history.jsonl), boundaries (plan-geometry.json) · nothing deleted',
      limitations: [PLANNING.scope, 'joined only by an exact plan number or the Mavat id in MoCH\'s own link — never by name or geometry', 'the layer publishes no block / parcel: no parcel corroboration', 'planning approval is not a permit or construction'],
      sync: runSummary(pr, daily) }); }

  /* market indicators */
  const I = (market && market.indicators) || {};
  const ind = (k) => I[k] || null;
  const mState = (v) => { if (!v) return { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null };
    const runState = v.stale ? stateOfRun({ status: 'failed', error: v.lastError || 'stale' }) : 'SUCCESS';
    /* the snapshot keeps a stale value's checkedAt at its last good read and dates the failed attempt in lastAttemptAt */
    return { runState, state: shownState(runState, v.checkedAt || null, 50, now), lastCheckAt: (v.stale && v.lastAttemptAt) || v.checkedAt || null, lastGoodAt: v.checkedAt || null,
      lastError: v.lastError || null, ...(v.partial ? { partial: v.failedDistricts || true } : {}) }; };
  const boi = ind('boiRate');
  add({ id: 'boi:policy-rate', vertical: 'market', usedFor: { he: 'ריבית בנק ישראל — סרגל השוק', en: 'Bank of Israel rate — market tape' }, publisher: 'בנק ישראל', publisherEn: 'Bank of Israel',
    name: 'PublicApi/GetInterest', url: 'https://www.boi.org.il/PublicApi/GetInterest', classification: 'CONFIRMED_STRUCTURED_API', cadence: 'daily (market-sync.yml)', geography: 'national',
    history: 'current value + next decision date (history kept by PROPX snapshots)', latestObservation: boi ? `${boi.value}%` : null, latestObservationKind: 'current rate',
    sourceUpdatedAt: boi ? boi.publishedAt : null, sourceUpdatedKind: 'rate decision published', limitations: ['a reference rate — never a user loan rate or assumption'], sync: mState(boi) });
  for (const [k, he, en, optional] of [['newHomesIndex', 'מדד מחירי דירות חדשות — שינוי שנתי', 'new-homes price index — y/y'], ['dwellingsIndex', 'מדד מחירי דירות (כל הדירות)', 'dwelling-price index (all dwellings)'],
    ['constructionInputsIndex', 'מדד תשומות הבנייה למגורים — הפניה בכלי ההצמדה', 'residential construction-inputs index — reference in the indexation tool', true],
    ['cpi', 'מדד המחירים לצרכן — כללי', 'consumer price index — general', true], ['rentIndex', 'שכר דירה — רכיב במדד המחירים לצרכן (פרטי, ציבורי ושכירות ארוכת טווח בפיקוח) — מדד, לא רמת שכירות', 'rent — a CPI component (private, public and regulated long-term rental) — an index, not a rent level', true]]) {
    const v = ind(k);
    const fail = optional && (market && market.failures || []).find((f) => f.key === k);
    if (optional && !v) {
      add({ id: 'cbs:' + k, vertical: 'market', usedFor: { he, en }, publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics', name: en, url: 'https://api.cbs.gov.il/index/',
        classification: 'CONFIRMED_STRUCTURED_API', cadence: 'monthly · PROPX: daily check (optional series)', geography: 'national', history: null, latestObservation: null,
        limitations: ['an optional series: found by name in the CBS catalogue; until the first successful read nothing is shown — never 0'],
        sync: fail ? { runState: stateOfRun({ status: 'failed', error: fail.error }), state: stateOfRun({ status: 'failed', error: fail.error }), lastCheckAt: market.syncedAt, lastError: fail.error }
          : { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'added 13.10.2026 — first read on the next daily market sync' } });
      continue;
    }
    add({ id: 'cbs:' + k, vertical: 'market', usedFor: { he, en }, publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics',
      name: v && v.series ? `${v.series.name} (series ${v.series.code})` : en, url: v && v.source ? v.source.url : 'https://api.cbs.gov.il/index/', classification: 'CONFIRMED_STRUCTURED_API',
      cadence: 'monthly, two-month windows · PROPX: daily check', geography: 'national', history: 'series history in the CBS API; PROPX keeps change-detected snapshots',
      latestObservation: v && v.period ? `${v.period.year}-${String(v.period.month).padStart(2, '0')}${v.periodKind === 'monthly' ? '' : ' (window start)'}` : null, latestObservationKind: 'latest index period',
      sourceUpdatedAt: null, limitations: ['a national index — never a city, neighbourhood or project price', 'series found by name in the CBS catalogue; a renamed series fails visibly, never silently swaps'], sync: mState(v) });
  }

  { const D = ind('dwellingsByDistrict'), fail = (market && market.failures || []).find((f) => f.key === 'dwellingsByDistrict');
    const okN = D && Array.isArray(D.districts) ? D.districts.filter((d) => !d.error).length : 0;
    add({ id: 'cbs:dwellingsByDistrict', vertical: 'market', usedFor: { he: 'מדד מחירי דירות לפי מחוז (כל הדירות) — כרטיס מגמת המחירים', en: 'dwelling-price index by district (all dwellings) — the price-trend card' },
      publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics', name: 'מדד מחירי דירות לפי מחוזות', url: D && D.source ? D.source.url : 'https://api.cbs.gov.il/index/',
      classification: 'CONFIRMED_STRUCTURED_API', cadence: 'monthly, two-month windows · PROPX: daily check (optional)', geography: 'CBS districts — never a city or neighbourhood',
      history: D ? `${okN} of ${D.districts.length} districts read` : null, latestObservation: D && D.period ? `${D.period.year}-${String(D.period.month).padStart(2, '0')} (window start)` : null, latestObservationKind: 'latest index window',
      limitations: ['all dwellings, not new homes', 'a district index — never shown as a city figure', 'a district that fails is listed with its error, never dropped'],
      sync: D ? mState(D) : fail ? { runState: stateOfRun({ status: 'failed', error: fail.error }), state: stateOfRun({ status: 'failed', error: fail.error }), lastCheckAt: market.syncedAt, lastError: fail.error }
        : { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'added 13.10.2026 — first read on the next market sync' } }); }

  /* transactions */
  const byTarget = new Map(); for (const r of txRuns) byTarget.set(r.target, r);
  const txLast = txRuns[txRuns.length - 1] || null;
  add({ id: 'govmap:tax-authority-deals', vertical: 'transactions', usedFor: { he: 'עסקאות (ערוץ רשמי) — כשהמקור עונה', en: 'deals (official channel) — when it answers' }, publisher: 'רשות המסים (GovMap)', publisherEn: 'Tax Authority via GovMap',
    name: 'שכבת העסקאות ב-GovMap', url: 'https://www.govmap.gov.il/', classification: 'RESTRICTED', cadence: 'daily attempt (data-sync.yml)', geography: 'watched areas', history: '120-day rolling re-check window',
    latestObservation: null, limitations: ['refuses PROPX\'s runners (HTTP 403) — recorded as refused, never worked around', 'no deals are served from this channel while it refuses'],
    sync: { ...runSummary(txRuns.map((r) => ({ ...r, id: r.runKey, finishedAt: r.finishedAt, retrievalMethod: 'live-api' })), daily), targets: [...byTarget.values()].map((r) => ({ target: r.target, state: stateOfRun(r), at: r.finishedAt || r.startedAt })) } });
  out.push({ id: 'over:deals-republication', vertical: 'transactions', inProduct: true, channel: 'independent-republication',
    usedFor: { he: 'עסקאות לפי יישוב/רחוב/בית — עותק מתוארך של מאגר רשות המסים', en: 'deals by locality / street / house — a dated copy of the Tax Authority register' },
    publisher: 'גרסאות לעם (over.org.il)', publisherEn: 'over.org.il (independent republication)', name: 'deals API — republication of nadlan.taxes.gov.il', url: 'https://www.over.org.il/',
    classification: 'THIRD_PARTY_REPUBLICATION', cadence: 'read on request (each page view); the copy is refreshed by its publisher', geography: 'national, by locality / street / house (addresses via parcel crosswalk)',
    history: 'deals since 1998 in the copy', latestObservation: null, latestObservationKind: 'the copy\'s scraped_at — shown in the transactions section',
    limitations: ['not a government channel — labelled so, never "official source"', 'no address in the register: street / house only through the publisher\'s parcel crosswalk', 'a partial sale is never priced per m²', 'no new / second-hand flag: newness from year built vs deal year'],
    sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'read live on request; no scheduled copy is kept' } });

  /* geography */
  add({ id: 'datagov:geo-registry', vertical: 'geo', usedFor: { he: 'יישובים ורחובות רשמיים — חיפוש, קודים', en: 'official localities and streets — search, codes' }, publisher: 'data.gov.il (משרד הפנים / הלמ"ס)', publisherEn: 'data.gov.il registries',
    name: 'רשימת יישובים · רחובות (mirror snapshots)', url: 'https://data.gov.il/', classification: 'CONFIRMED_STRUCTURED_FILE', cadence: 'rebuilt on demand (scripts/build-geo-registry.py)', geography: 'national',
    history: geoMeta && geoMeta.counts ? `${geoMeta.counts.localities} localities · ${geoMeta.counts.streets} streets` : null, latestObservation: geoMeta ? geoMeta.builtAt : null, latestObservationKind: 'registry built',
    sourceUpdatedAt: geoMeta ? geoMeta.builtAt : null, limitations: ['street synonyms and CBS statistical areas not yet ingested', 'neighbourhoods are not official polygons for most localities — never inferred'],
    sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: geoMeta ? geoMeta.builtAt : null, note: 'a dated build, not a daily sync' } });

  /* derived layers (PROPX's own, from the sources above) */
  out.push({ id: 'propx:entities', vertical: 'derived', inProduct: true, channel: 'derived', usedFor: { he: 'רישום יזמים ופרויקטים — פעילות שנצפתה במקורות PROPX', en: 'developer & project registry — observed PROPX activity' },
    publisher: 'PROPX', publisherEn: 'PROPX', name: 'lib/entities — deterministic registry', url: null, classification: 'DERIVED', cadence: 'rebuilt from the stored records on every data change',
    geography: 'as its sources', history: 'as its sources', limitations: ['observed activity only — not a land bank, a total pipeline or a complete developer list', 'no similarity merge: possible same entities are linked, never combined'],
    sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'derived at read time from rmi:michrazim + the MoCH lotteries' } });

  const counts = {}; for (const s of out) counts[s.sync.state] = (counts[s.sync.state] || 0) + 1;
  return { generatedAt: new Date(now).toISOString(), states: STATES, counts, sources: out,
    vocabulary: { SUCCESS: 'answered, data read', UNCHANGED: 'answered, nothing changed', PARTIAL: 'answered in part (budget, cap or some failures)', REFUSED: 'refused this runner (401/403/429) — not worked around',
      FAILED: 'the run failed — last valid data kept', SCHEMA_CHANGED: 'answered in an unrecognized shape — nothing applied', STALE: 'last good check older than the cadence allows', NO_RUN: 'no scheduled check (read on request, dated build, or audited only)' },
    principles: ['a source that is unavailable never becomes 0 — its last valid data is kept, dated and marked', 'raw snapshots are kept per content hash; history is appended; nothing is deleted',
      'OFFICIAL · THIRD_PARTY_REPUBLICATION · DERIVED · MODEL are never mixed without a label'] };
}

module.exports = { catalog, stateOfRun, shownState, runSummary, STATES };
