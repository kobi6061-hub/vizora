// PROPX · Data & Trust Center — one catalogue of every source PROPX reads (or audited and does not read), with
// what PROPX's own run logs say about each: the last check, the outcome, the latest observation, the source's
// own update date, how far back it goes, what it covers and what it cannot say.
//
// Nothing here is fetched. Every live field comes from files the scheduled syncs commit:
//   data/land/meta.json + sync-runs.jsonl          (scripts/land-sync.js, daily)
//   data/housing/meta.json + sync-runs.jsonl       (scripts/housing-sync.js, daily)
//   data/market/latest.json                        (scripts/market-sync.js, daily)
//   data/cbs-sales/latest.json + runs.jsonl        (scripts/cbs-sales-sync.js, every working day)
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
const XU = require('../planning/xplan-units');
/* the XPlan housing-unit methodology, from the one definition (lib/planning/xplan-units.js) */
const XPLAN_UNITS_METHOD = [
  ...Object.entries(XU.SEMANTICS.fields).map(([f, x]) => `${f} ("${x.alias}") — ${x.meaning}; shown as "${XU.SEMANTICS.labels.en[x.as]}" / "${XU.SEMANTICS.labels.he[x.as]}"`),
  `Units After Plan / "${XU.SEMANTICS.labels.he.unitsAfterPlan}" — ${XU.SEMANTICS.derived.unitsAfterPlan}`,
  `evidence — audit ${XU.SEMANTICS.audited} over every plan of the layer (GitHub Actions run ${XU.SEMANTICS.run}): the plans' own objectives text agrees ("from X to Y units": X = authorised 265/312, Y = authorised + delta 267/312; "total N units": authorised + delta 956/1,235); cross-checked with MoCH urban renewal and the ILA planning inventory`,
  ...XU.SEMANTICS.limitations,
];

const ROOT = path.join(__dirname, '..', '..', 'data');
const DISCOVERY_DIR = path.join(__dirname, 'discovery');
const discoveryFiles = () => { try { return fs.readdirSync(DISCOVERY_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => path.join(DISCOVERY_DIR, f)); } catch { return []; } };
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
  if (status === 'unchanged') return 'UNCHANGED';   // a run that asked, was answered and found nothing new (cbs-sales, rental) — never a failure
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
const RECOVERY_WINDOW_DAYS = 7;   // a source shows RECOVERED for a week after a good check follows a failure
const ALERT_STATES = new Set(['REFUSED', 'FAILED', 'SCHEMA_CHANGED', 'STALE', 'PARTIAL']);
function runSummary(runs, { staleAfterHours, now }) {
  const checks = runs.filter(isCheck);
  const last = checks[checks.length - 1] || null;
  const lastGood = [...checks].reverse().find((r) => GOOD.has(stateOfRun(r))) || null;
  const at = (r) => (r ? r.finishedAt || r.startedAt || null : null);
  const runState = stateOfRun(last);
  /* Trust 2.0: the latest failure beside the latest success, a RECOVERED flag (a good check after a bad one within the
     recovery window), the state history and the check tally — all from the run log, never inferred */
  const lastBad = [...checks].reverse().find((r) => !GOOD.has(stateOfRun(r))) || null;
  const firstGoodAfterBad = lastBad && at(lastBad) ? checks.find((r) => GOOD.has(stateOfRun(r)) && at(r) && at(r) > at(lastBad)) || null : null;
  const recoveredAt = firstGoodAfterBad ? at(firstGoodAfterBad) : null;   // the moment of recovery — not the latest good check, which would keep the badge for ever
  const recovered = !!recoveredAt && now - Date.parse(recoveredAt) <= RECOVERY_WINDOW_DAYS * 24 * HOUR;
  const tally = { total: checks.length, good: checks.filter((r) => GOOD.has(stateOfRun(r))).length, bad: checks.filter((r) => !GOOD.has(stateOfRun(r))).length };
  return { runState, state: shownState(runState, at(lastGood), staleAfterHours, now), lastCheckAt: at(last), lastGoodAt: at(lastGood), lastRunId: last ? last.id || last.runKey || null : null,
    lastError: last && last.error ? String(last.error).slice(0, 240) : null, checksRecorded: checks.length,
    recent: checks.slice(-7).map((r) => ({ at: at(r), state: stateOfRun(r) })),
    latestSuccessAt: at(lastGood), latestFailureAt: at(lastBad), latestFailureState: lastBad ? stateOfRun(lastBad) : null, latestFailureError: lastBad && lastBad.error ? String(lastBad.error).slice(0, 240) : null,
    recovered, recoveredAt: recovered ? recoveredAt : null, expectedCadenceHours: staleAfterHours || null, history: checks.slice(-14).map((r) => ({ at: at(r), state: stateOfRun(r) })), tally };
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
      usedFor: { 'iplan:xplan': { he: 'סטטוס תכנית ויח"ד: מאושרות לפני התוכנית · תוספת בתוכנית · סה"כ לאחר התוכנית — צירוף לפי מספר תכנית מדויק', en: 'plan status and housing units: previously authorized · plan delta · after the plan — exact plan-number join' },
        'datagov:rmi:planning-inventory': { he: 'מלאי תכנוני (קרקעות מדינה בלבד, 2022)', en: 'planning inventory (state land only, 2022)' },
        'datagov:moch:construction-progress': { he: 'ראיית בנייה למגרש שנזכה — גוש וחלקה מדויקים', en: 'construction evidence for an awarded lot — exact block + parcel' },
        'datagov:moch:development-costs': { he: 'עלויות פיתוח לפי יישוב (הפניה בלבד)', en: 'development costs by locality (reference only)' } }[id],
      publisher: s.publisher, publisherEn: s.publisherEn, name: s.name, url: s.url, classification: s.classification, cadence: `${s.cadence} · re-read by the daily land sync`,
      geography: s.geographicCoverage, history: s.historicalCoverage, latestObservation: null, sourceUpdatedAt: sourceAsOf, sourceUpdatedKind: 'source content last modified',
      sourceStale: s.classification === 'STALE', limitations: s.limitations, sync: joinState(key),
      ...(id === 'iplan:xplan' ? { methodology: [...XPLAN_UNITS_METHOD,
        'correction 13.10.2026 — until then the land section showed pq_authorised_quantity_120 as the plans\' "approved units": it is the state BEFORE the plan; the stored raw values were not changed, only their reading (data/land keeps the raw value under its storage key approvedUnits)'] } : {}) });
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
      methodology: XPLAN_UNITS_METHOD, sync: runSummary(pr, daily) }); }

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
      sourceUpdatedAt: null, limitations: k === 'rentIndex'
        ? ['a GENERAL RENT MARKET BENCHMARK: the rent component of the CPI (private, public and regulated long-term rentals), national — an index, not a rent in ₪',
          'never a project\'s rent, never "institutional" or Dira Lehaskir rent, never a city or district rent', 'the observation period is the index month; PROPX shows its own check date beside it',
          'series found by name in the CBS catalogue; a renamed series fails visibly, never silently swaps']
        : ['a national index — never a city, neighbourhood or project price', 'series found by name in the CBS catalogue; a renamed series fails visibly, never silently swaps'], sync: mState(v) });
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

  /* new-home sales — the CBS monthly series (country + districts), and the city table CBS publishes only as a PDF */
  { const cs = readJson(path.join(dataDir, 'cbs-sales', 'latest.json')), cr = readRuns(path.join(dataDir, 'cbs-sales', 'runs.jsonl'));
    const S = (cs && cs.source) || {}, il = cs && cs.geos && cs.geos.il, nGeo = cs && cs.geos ? Object.keys(cs.geos).length : 0;
    const sum = runSummary(cr, { staleAfterHours: 100, now });   /* working days only: a weekend is not a missed check */
    add({ id: 'cbs:new-home-sales', vertical: 'market', usedFor: { he: 'מכירות דירות חדשות — ארצי ו-7 מחוזות (12 חודשים, מתחילת השנה, קצב, מומנטום) · מלאי וחודשי היצע ארציים', en: 'new-home sales — national and 7 districts (12 months, year to date, pace, momentum) · national inventory and months of supply' },
      publisher: S.publisher || 'הלשכה המרכזית לסטטיסטיקה', publisherEn: S.publisherEn || 'Central Bureau of Statistics', name: S.datasetEn || 'Real-estate transactions — new dwellings sold (time series, subject 44)',
      url: S.catalog || 'https://apis.cbs.gov.il/series/catalog/path?id=44,10', classification: 'CONFIRMED_STRUCTURED_API',
      cadence: 'source: monthly, about six weeks after the month ends · PROPX: every working day (cbs-sales-sync.yml)',
      geography: 'national + the 7 CBS districts, by CBS code (5069–5076) — CBS publishes no machine-readable city series',
      history: il && cs.depth ? `${cs.depth.from} → ${cs.depth.to} · ${nGeo} geographies · ${cs.records ? cs.records.observations : '?'} observations (${cs.records ? cs.records.revisions : 0} revisions)` : null,
      latestObservation: il ? il.metrics.latest : null, latestObservationKind: 'latest published month',
      sourceUpdatedAt: cs ? cs.sourceUpdate : null, sourceUpdatedKind: 'CBS series update date',
      freshness: cs && cs.freshness ? cs.freshness : null,
      coverage: il ? { geographies: nGeo, months: il.metrics.months, cities: 0 } : null,
      snapshots: 'every published value kept with its revisions (observations.jsonl, append-only) · raw responses per content hash (data/cbs-sales/raw) · nothing deleted',
      limitations: ['national and district only — never shown or allocated as a city or neighbourhood figure',
        'new dwellings sold (first sale), including government-subsidized sales — not developer price lists, not second-hand',
        'recent months are revised in later releases — PROPX appends each revision, the board shows the latest',
        'the national total includes an unknown district: national − Σ districts is that residual, not an error',
        'inventory and months of supply are national only in the API'],
      sync: sum });
    out.push({ id: 'cbs:new-home-sales-by-city-pdf', vertical: 'market', inProduct: false, channel: 'official',
      usedFor: { he: 'נבדק ולא נקרא — טבלת היישובים בהודעה לתקשורת', en: 'audited, not read — the localities table in the media release' },
      publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics', name: 'דירות בעסקאות נדל"ן — לוח ב (היישובים שבהם נמכרו יותר מ-150 דירות)',
      url: 'https://www.cbs.gov.il/he/mediarelease/DocLib/2026/283/04_26_283b.pdf', classification: 'NOT_MACHINE_READABLE',
      cadence: 'monthly media release (PDF)', geography: 'the localities above 150 sales in a rolling three-month window (≈20 for new dwellings)', history: null,
      latestObservation: null, limitations: ['PDF only — no dataset, API or table file found; the release pages are bot-gated, so attachments cannot be listed',
        'rolling three-month windows, not monthly counts; a locality appears only above 150 sales', 'locality names, not codes',
        'one figure is transcribed by hand and labelled: Tel Aviv-Yafo H1 2026 (release 252/2026)'],
      sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: '2026-10-13T20:31:37Z', note: 'audited on the runner 13.10.2026 (scripts/cbs-sales-discover.js) — not ingested' } }); }

  /* long-term rental — Dira Lehaskir (the government rental company's public CMS) */
  { const rRuns = readRuns(path.join(dataDir, 'rental', 'runs.jsonl')), rSum = runSummary(rRuns, { staleAfterHours: 100, now });   /* working days only (Sun–Thu): a weekend is not a missed check */
    const T = readJson(path.join(dataDir, 'rental', 'dira-tenders.json')), P = readJson(path.join(dataDir, 'rental', 'dira-planning.json')), J = readJson(path.join(dataDir, 'rental', 'dira-projects.json'));
    const dev = T ? T.records.filter((r) => r.kind === 'developer-tender') : [];
    const newest = (xs, k) => xs.map((x) => x[k]).filter(Boolean).sort().pop() || null;
    const owner = 'דירה להשכיר – החברה הממשלתית לדיור ולהשכרה בע"מ', ownerEn = 'Dira Lehaskir — the Government Company for Housing and Rental';
    add({ id: 'dira-lehaskir:tenders', vertical: 'land', usedFor: { he: 'תנאי ההשכרה לכל מכרז — יח״ד להשכרה ארוכת טווח, למכירה, תקופת ההשכרה (רק כשנכתבו במפורש)', en: 'rental terms per tender — long-term rental units, units for sale, the rental period (only where written out)' },
      publisher: owner, publisherEn: ownerEn, name: 'מכרזי יזמים (WordPress REST: wp-json/wp/v2/michraz)', url: 'https://www.renten.co.il/wp-json/wp/v2/michraz', classification: 'CMS_PUBLIC_API',
      cadence: 'as the company publishes · PROPX: every working day (rental-sync.yml)', geography: 'the tender sites (joined to ILA tenders by the printed tender number)',
      history: T ? `${T.records.length} notices (${dev.length} developer tenders) · upserted, never deleted · every changed field in history.jsonl` : null,
      latestObservation: newest(dev, 'published'), latestObservationKind: 'newest notice published', sourceUpdatedAt: newest(dev, 'modified'), sourceUpdatedKind: 'newest notice modified',
      snapshots: 'raw responses per content hash (data/rental/raw) · records upserted on the notice id, never deleted',
      limitations: ['explicit only: a figure is read only when the notice writes it in a recognised phrasing; the words are kept as evidence; anything else stays —',
        'the same content type also holds the company\'s services procurement — those notices are counted and never treated as tenders',
        'joined to an ILA tender only by the printed tender number (region/number/year → MichrazID); a different total-unit figure is shown beside the ILA one, never overwritten',
        'no rent, yield, occupancy or operator figure is published as data — none is shown or estimated'],
      sync: rSum });
    add({ id: 'dira-lehaskir:planning', vertical: 'land', usedFor: { he: 'אתרים בקידום תכנון של החברה (לפני מכרז) — לפי סטטוס', en: 'the company\'s sites in planning promotion (before a tender) — by status' },
      publisher: owner, publisherEn: ownerEn, name: 'קידום תכנון (wp-json/wp/v2/planning)', url: 'https://www.renten.co.il/wp-json/wp/v2/planning', classification: 'CMS_PUBLIC_API',
      cadence: 'PROPX: every working day (rental-sync.yml)', geography: 'site name + locality as written', history: P ? `${P.records.length} sites · upserted, never deleted` : null,
      latestObservation: P ? newest(P.records, 'modified') : null, latestObservationKind: 'newest site modified', sourceUpdatedAt: null,
      limitations: ['no plan number is published — never joined to XPlan', 'a planning site is not a tender, not construction, not supply'], sync: rSum });
    add({ id: 'dira-lehaskir:projects', vertical: 'land', usedFor: { he: 'פרויקטים של החברה — ספירה לפי סטטוס (בבנייה / זמינות / מאוכלס) וקישורים לדפים', en: 'the company\'s projects — counts by status (construction / available / occupied) and page links' },
      publisher: owner, publisherEn: ownerEn, name: 'פרויקטים (project-sitemap.xml + taxonomy tax_status)', url: 'https://www.renten.co.il/project-sitemap.xml', classification: 'OFFICIAL_PAGE_ONLY',
      cadence: 'PROPX: every working day (rental-sync.yml)', geography: 'project pages', history: J ? `${J.pages.length} public pages (URL + last modified only)` : null,
      latestObservation: J ? newest(J.pages, 'lastmod') : null, latestObservationKind: 'newest page modified', sourceUpdatedAt: null,
      limitations: ['the project type is not exposed by the REST API — pages only, no fields: no units, rent, occupancy or operator per project',
        'status counts are the company\'s own taxonomy counts — not linked to tenders, never presented as tender-level stages'], sync: rSum });
    out.push({ id: 'cbs:average-rent', vertical: 'market', inProduct: false, channel: 'official',
      usedFor: { he: 'נבדק ולא נקרא — שכר דירה ממוצע בש״ח לפי מחוז / עיר / חדרים', en: 'audited, not read — average rent in ₪ by district / city / rooms' },
      publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics', name: 'שכר דירה ממוצע (₪) — לא נמצא בממשקי ה-API של הלמ״ס',
      url: 'https://api.cbs.gov.il/index/catalog/catalog', classification: 'NOT_MACHINE_READABLE', cadence: '—', geography: '—', history: null, latestObservation: null,
      limitations: ['not found in the CBS price-index API catalogue (13 chapters, every subject listed — the only rent series is the CPI rent component, 120460; run 38474113942)',
        'not found in the CBS time-series catalogue (38 subjects, first level under each — the only match was "rent tribunals", a justice series; run 38476328680)',
        'the CPI rent component is read and shown as a general market benchmark — never as a rent level'],
      sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: '2026-10-13T22:17:14Z', note: 'audited on the runner 13.10.2026 (scripts/rental-discover.js --cbs-index / --cbs-series) — not ingested' } }); }

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

  /* ---- discovery: candidate sources audited read-only and NOT ingested (lib/trust/discovery/<date>.json) — classified, with a verdict, a join key and
     the evidence; listed so the Trust Center says what exists, what was rejected and why; never read at runtime */
  for (const f of discoveryFiles()) {
    const list = readJson(f, []);
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || !c.id || out.some((x) => x.id === 'discovery:' + c.id)) continue;
      const vertical = /^cbs:|^datagov:cbs/.test(c.id) ? 'market' : /labor|contractors|fire/.test(c.id) ? 'construction' : /iplan|tlv:gis|haifa|jerusalem|beer-sheva|muni:/.test(c.id) ? 'planning' : /moch/.test(c.id) ? 'housing' : /piba|census|socio|mot:|digital/.test(c.id) ? 'geo' : /rmi/.test(c.id) ? 'land' : 'derived';
      out.push({ id: 'discovery:' + c.id, vertical, inProduct: false, channel: 'official', publisher: c.owner || null, publisherEn: c.ownerEn || null, name: c.name || c.id, url: c.url || null, classification: c.classification || 'UNUSABLE',
        usedFor: { he: `נבדק ולא נקרא — ${c.verdict === 'INTEGRATE' ? 'מועמד לשילוב' : c.verdict === 'REJECT' ? 'נדחה' : 'תיעוד בלבד'}`, en: `audited, not read — ${c.verdict === 'INTEGRATE' ? 'candidate for integration' : c.verdict === 'REJECT' ? 'rejected' : 'documented only'}` },
        cadence: c.cadence || null, geography: c.geography || null, history: c.period || null, latestObservation: c.freshness || null, latestObservationKind: 'as audited', sourceUpdatedAt: null,
        limitations: [c.why ? `verdict: ${c.why}` : null, c.joinKey ? `join key: ${c.joinKey}` : null].concat(Array.isArray(c.limitations) ? c.limitations : c.limitations ? [c.limitations] : []).filter(Boolean),
        discovery: { verdict: c.verdict || null, priority: c.priority ?? null, target: c.target ?? null, joinKey: c.joinKey || null, accessMethod: c.accessMethod || null, contains: c.contains || null, identifiers: c.identifiers || null, licence: c.licence || null, evidence: c.evidence || null, auditedAt: c.auditedAt || null, auditedBy: c.auditedBy || null },
        sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: c.auditedAt || null, note: 'audited on the runner (read-only discovery) — not ingested' } });
    }
  }
  const counts = {}; for (const s of out) counts[s.sync.state] = (counts[s.sync.state] || 0) + 1;
  /* Trust 2.0 alerts: every source PROPX reads whose shown state is not good, and every source that recovered this week — from the run logs */
  const alerts = out.filter((s) => s.inProduct !== false && s.sync).flatMap((s) => {
    const a = [];
    if (ALERT_STATES.has(s.sync.state)) a.push({ id: s.id, kind: s.sync.state, vertical: s.vertical, publisher: s.publisher, publisherEn: s.publisherEn || null, name: s.name, at: s.sync.lastCheckAt || null, lastGoodAt: s.sync.lastGoodAt || null, error: s.sync.lastError || s.sync.latestFailureError || null, cadenceHours: s.sync.expectedCadenceHours || null });
    if (s.sync.recovered) a.push({ id: s.id, kind: 'RECOVERED', vertical: s.vertical, publisher: s.publisher, publisherEn: s.publisherEn || null, name: s.name, at: s.sync.recoveredAt, failedAt: s.sync.latestFailureAt, failedState: s.sync.latestFailureState, error: s.sync.latestFailureError || null });
    if (s.sourceStale) a.push({ id: s.id, kind: 'SOURCE_STALE', vertical: s.vertical, publisher: s.publisher, publisherEn: s.publisherEn || null, name: s.name, at: s.sourceUpdatedAt || null, note: 'the source content itself is old (its own last update), whatever PROPX\'s check says' });
    return a;
  });
  const order = { REFUSED: 0, SCHEMA_CHANGED: 1, FAILED: 2, STALE: 3, PARTIAL: 4, SOURCE_STALE: 5, RECOVERED: 6 };
  alerts.sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9) || String(y.at || '').localeCompare(String(x.at || '')));
  return { generatedAt: new Date(now).toISOString(), states: STATES, counts, sources: out, alerts, alertStates: [...ALERT_STATES, 'RECOVERED', 'SOURCE_STALE'], recoveryWindowDays: RECOVERY_WINDOW_DAYS,
    vocabulary: { SUCCESS: 'answered, data read', UNCHANGED: 'answered, nothing changed', PARTIAL: 'answered in part (budget, cap or some failures)', REFUSED: 'refused this runner (401/403/429) — not worked around',
      FAILED: 'the run failed — last valid data kept', SCHEMA_CHANGED: 'answered in an unrecognized shape — nothing applied', STALE: 'last good check older than the cadence allows', NO_RUN: 'no scheduled check (read on request, dated build, or audited only)' },
    principles: ['a source that is unavailable never becomes 0 — its last valid data is kept, dated and marked', 'raw snapshots are kept per content hash; history is appended; nothing is deleted',
      'OFFICIAL · THIRD_PARTY_REPUBLICATION · DERIVED · MODEL are never mixed without a label'] };
}

module.exports = { catalog, stateOfRun, shownState, runSummary, STATES };
