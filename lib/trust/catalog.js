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
//   data/geo/streets/meta.json + sync-runs.jsonl   (scripts/street-sync.js, weekly)
//   data/streets/evidence/meta.json + sync-runs.jsonl (scripts/street-evidence-sync.js, weekly check)
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
const FRESH = require('../gov/freshness');
/* the XPlan housing-unit methodology, from the one definition (lib/planning/xplan-units.js) */
const XPLAN_UNITS_METHOD = [
  ...Object.entries(XU.SEMANTICS.fields).map(([f, x]) => `${f} ("${x.alias}") — ${x.meaning}; shown as "${XU.SEMANTICS.labels.en[x.as]}" / "${XU.SEMANTICS.labels.he[x.as]}"`),
  `Units After Plan / "${XU.SEMANTICS.labels.he.unitsAfterPlan}" — ${XU.SEMANTICS.derived.unitsAfterPlan}`,
  `evidence — audit ${XU.SEMANTICS.audited} over every plan of the layer (GitHub Actions run ${XU.SEMANTICS.run}): the plans' own objectives text agrees ("from X to Y units": X = authorised 265/312, Y = authorised + delta 267/312; "total N units": authorised + delta 956/1,235); cross-checked with MoCH urban renewal and the ILA planning inventory`,
  ...XU.SEMANTICS.limitations,
];

const ROOT = path.join(__dirname, '..', '..', 'data');
const DISCOVERY_DIR = path.join(__dirname, 'discovery');
const discoveryFiles = () => { try { return fs.readdirSync(DISCOVERY_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}(-[a-z]+)?\.json$/.test(f)).sort().map((f) => path.join(DISCOVERY_DIR, f)); } catch { return []; } };
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
  if (status === 'schema_changed') return 'SCHEMA_CHANGED';
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
  && !['running', 'skipped', 'rebuilt'].includes(String(r.status || '').toLowerCase());   // 'rebuilt' = an offline re-match (no request) — not a check
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
    add({ id: 'cbs:new-home-sales', vertical: 'market', usedFor: { he: 'מכירות דירות חדשות — ארצי ו-7 מחוזות (12 חודשים, מתחילת השנה, קצב, מומנטום) · מלאי וחודשי היצע ארציים · (21.10.2026) השוק הכולל: כלל הדירות שנמכרו, יד שנייה, חדשות בסבסוד לפי מחוז — בתיק השוק, כל יקום בנפרד', en: 'new-home sales — national and 7 districts (12 months, year to date, pace, momentum) · national inventory and months of supply · (21.10.2026) the whole market: all dwellings sold, second-hand, subsidized new by district — in the market dossier, each universe apart' },
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
      ...(cs && cs.market ? { discovery: { integrates: 'discovery:cbs:series:second-hand-sales-by-district', auditedAt: '2026-10-17' } } : {}),
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

  /* construction — the CBS quarterly-release series (building permits · starts · completions · active construction; country + districts),
     lib/construction (17.10.2026; integrates discovery:cbs:series:construction-by-district). NO_RUN until the first construction-sync.yml run. */
  { const cc = readJson(path.join(dataDir, 'construction', 'latest.json')), ccr = readRuns(path.join(dataDir, 'construction', 'sync-runs.jsonl'));
    const CS = (cc && cc.source) || {}, ms = (cc && cc.measures) || {};
    const okM = Object.values(ms).filter((m) => m && m.state === 'OK');
    const il = okM.map((m) => m.geos && m.geos.il).filter(Boolean);
    /* the latest period by its END date across kinds ("2026-Q2" ends with "2026-06"); on a tie the monthly period is shown */
    const endKey = (p) => { const q = /^(\d{4})-Q([1-4])$/.exec(p); return q ? `${q[1]}-${String(+q[2] * 3).padStart(2, '0')}` : p; };
    const latestObs = il.map((g) => g.latest && g.latest.period).filter(Boolean).sort((a, b) => endKey(a).localeCompare(endKey(b)) || (/Q/.test(a) ? -1 : 1)).pop() || null;
    const nGeo = okM.length ? Math.max(...okM.map((m) => Object.keys(m.geos || {}).length)) : 0;
    const periods = il.map((g) => (g.metrics && g.metrics.periods) || 0);
    const sum = runSummary(ccr, { staleAfterHours: 100, now });   /* working days only: a weekend is not a missed check */
    add({ id: 'cbs:construction', vertical: 'market',
      usedFor: { he: 'היתרי בנייה, התחלות בנייה, גמר בנייה ובנייה פעילה — דירות, ארצי ו-7 מחוזות (תקופה אחרונה, 12 חודשים / 4 רבעונים, מתחילת השנה, שינוי) · טרם מחובר לתיק, לצנרת ההיצע ולדופק', en: 'building permits, construction starts, completions and active construction — dwellings, national and 7 districts (latest period, 12 months / 4 quarters, year to date, change) · not yet wired to the dossier, the supply pipeline or the pulse' },
      publisher: CS.publisher || 'הלשכה המרכזית לסטטיסטיקה', publisherEn: CS.publisherEn || 'Central Bureau of Statistics',
      name: CS.datasetEn || 'Construction — building permits, construction starts, completions and active construction: dwellings, national and by district (time series, subject 44)',
      url: CS.catalog || 'https://apis.cbs.gov.il/series/catalog/level?id=5&subject=44&format=json&download=false&lang=he', classification: 'CONFIRMED_STRUCTURED_API',
      cadence: 'source: a quarterly release about ten weeks after the quarter ends (the monthly figures appear with it) · PROPX: every working day (construction-sync.yml)',
      geography: 'national + the 7 CBS districts, by the CBS code of each branch (level-4 codes 1–8 for starts / completions / active construction; name_id 271–277 + 1 for permits), every code verified against the catalogue name every run — CBS publishes no locality series',
      history: latestObs ? `${okM.length}/4 measures · ${nGeo} geographies · up to ${Math.max(...periods)} periods · ${cc.records ? cc.records.observations : '?'} observations (${cc.records ? cc.records.revisions : 0} revisions)` : null,
      latestObservation: latestObs, latestObservationKind: 'latest published period (month or quarter — the kind of each series)',
      sourceUpdatedAt: cc ? cc.sourceUpdate : null, sourceUpdatedKind: 'CBS series update date',
      freshness: cc && cc.freshness ? cc.freshness : null,
      coverage: latestObs ? { geographies: nGeo, measures: okM.length, cities: 0 } : null,
      snapshots: 'every published value kept with its revisions (observations.jsonl, append-only) · raw responses per content hash (data/construction/raw) · the catalogue resolution of every run (geo-resolution.json) · nothing deleted',
      limitations: ['national and district only — never shown or allocated as a city or neighbourhood figure',
        'permits ≠ starts ≠ completions ≠ active construction: four universes, never summed; active construction is a stock at period end, never summed over periods',
        'the period kind is each series\' own (month / quarter / year), stored with every observation — a quarterly series is never shown as monthly',
        'recent periods are revised in later releases — PROPX appends each revision, the product shows the latest',
        'the freshness states rest on a documented lag assumption (about ten weeks after the quarter: CURRENT ≤ 60 days after the next quarter ends, EXPECTED_REPORTING_LAG ≤ 120, STALE beyond), not on an official release calendar',
        'the geography codes are verified against the catalogue names every run: a mismatch or an unresolved node is not read (PARTIAL) until the table is checked',
        'the national row vs the sum of the 7 districts: the residual is reported, never forced'],
      discovery: { integrates: 'discovery:cbs:series:construction-by-district', auditedAt: '2026-10-17' },
      sync: sum.checksRecorded ? sum : { ...sum, note: 'added 17.10.2026 — NO_RUN until the first construction-sync.yml run' } }); }

  /* official reference datasets (lib/reference, 21.10.2026; integrates the INTEGRATE verdicts discovery:datagov:cbs:census-2022-localities-statareas
     and discovery:datagov:piba:residents-by-locality of 17.10.2026) — whole-resource CKAN reads keyed on the CBS locality code */
  { const REFL = require('../reference');
    for (const [id, disc, used] of [['census-2022', 'discovery:datagov:cbs:census-2022-localities-statareas', { he: 'הקשר דמוגרפי ליישוב (מפקד 2022): אוכלוסייה, משקי בית, שיעור בעלות / שכירות, שכר חציוני, גיל, השכלה — בתיק השוק ובדוח הרחוב כהקשר ליישוב בלבד', en: 'locality demographic context (census 2022): population, households, owner / renter shares, median wages, age, education — in the market dossier and the street report as the LOCALITY\'s context only' }],
      ['residents', 'discovery:datagov:piba:residents-by-locality', { he: 'תושבים רשומים ליישוב לפי קבוצות גיל (מרשם האוכלוסין, שבועי) — בתיק השוק ובדוח הרחוב כהקשר ליישוב בלבד', en: 'registered residents per locality by age band (population register, weekly) — in the market dossier and the street report as the LOCALITY\'s context only' }]]) {
      const src = REFL.SOURCES[id], m = REFL.readMeta(id, path.join(dataDir, 'reference')), runs = readRuns(path.join(dataDir, 'reference', id, 'runs.jsonl')).map((r) => ({ ...r, contentChanged: r.status === 'success' }));
      const sum = runSummary(runs, { staleAfterHours: id === 'residents' ? 24 * 9 : 24 * 40, now });
      add({ id: src.trustId, vertical: 'geo', usedFor: used, publisher: src.publisher, publisherEn: src.publisherEn, name: src.titleEn, url: src.page, classification: 'CONFIRMED_STRUCTURED_API',
        cadence: `source: ${src.cadence} · PROPX: weekly (reference-sync.yml)`, geography: id === 'census-2022' ? 'national · every locality · every statistical area (CBS codes); a statistical area is listed by its number — PROPX holds no statistical-area geometry' : 'every locality (CBS code) + sub-district + regional council',
        history: m ? `${m.records} records (${Object.entries(m.byLevel || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}) · ${m.rejected} source row(s) without an official code rejected · ${m.history.length} content version(s) kept` : null,
        latestObservation: id === 'census-2022' ? 'census 2022' : m ? m.sourceUpdatedAt : null, latestObservationKind: id === 'census-2022' ? 'the census observation (one, 2022)' : 'the register snapshot the resource holds',
        sourceUpdatedAt: m ? m.sourceUpdatedAt : null, sourceUpdatedKind: 'data.gov.il resource last_modified',
        snapshots: 'data/reference/' + id + '/ — rows.json.gz + a dated copy per content change (history/) + runs.jsonl; nothing deleted',
        limitations: id === 'census-2022' ? ['one observation (2022, published 2024) — never "current"', 'a locality figure describes the locality, never one street', 'the census population (de-facto) ≠ the population register — never mixed with the residents count']
          : ['registered residents (the population register) ≠ CBS population estimates — two universes, never mixed', 'the resource is replaced in place: PROPX keeps its own dated history from 21.10.2026', 'licence not stated by the publisher (data.gov.il terms of use)'],
        discovery: { integrates: disc, auditedAt: '2026-10-17' },
        sync: sum.checksRecorded ? sum : { ...sum, note: 'added 21.10.2026 — NO_RUN until the first reference-sync.yml run' } });
    } }

  /* public-transport access (lib/transport, 21.10.2026): the Ministry of Transport's stop registry, light-rail entrances, rail / metro station
     lists (data.gov.il) — read whole weekly; the street report measures stops / stations within fixed radii of the street */
  { const TRL = require('../transport');
    for (const id of Object.keys(TRL.SOURCES)) {
      const src = TRL.SOURCES[id], m = require('../reference').readMeta(id, path.join(dataDir, 'transport')), runs = readRuns(path.join(dataDir, 'transport', id, 'runs.jsonl')).map((r) => ({ ...r, contentChanged: r.status === 'success' }));
      const sum = runSummary(runs, { staleAfterHours: 24 * 9, now });
      add({ id: src.trustId, vertical: 'geo', usedFor: id === 'bus-stops' ? { he: 'דוח הרחוב: תחנות תחבורה ציבורית ב-300 מ׳ ותחנות רכבת ישראל ב-1,500 מ׳ (מרשומות "רכבת ישראל" במרשם)', en: 'the street report: public-transport stops within 300 m and Israel Railways stations within 1,500 m (the registry\'s "רכבת ישראל" stops)' }
          : id === 'lrt' ? { he: 'דוח הרחוב: תחנות רכבת קלה ב-1,000 מ׳ עם הסטטוס (קיימת / מתוכננת) כלשונו', en: 'the street report: light-rail stations within 1,000 m with the status (existing / planned) verbatim' }
          : { he: 'רשימת שמות וסטטוס בלבד — אין קואורדינטות נגישות; לא ממוקם', en: 'names and status only — no accessible coordinates; not placed' },
        publisher: src.publisher, publisherEn: src.publisherEn, name: src.titleEn, url: src.page, classification: 'CONFIRMED_STRUCTURED_API',
        cadence: `source: ${src.cadence} · PROPX: weekly (transport-sync.yml)`, geography: id === 'bus-stops' ? 'every stop (WGS84 + CBS locality code)' : id === 'lrt' ? 'station entrances (ITM → WGS84)' : 'national list — no geometry',
        history: m ? `${m.records} records · ${m.rejected} source row(s) without usable coordinates / keys · ${m.history.length} content version(s)` : null,
        latestObservation: m ? m.sourceUpdatedAt : null, latestObservationKind: 'the data.gov.il resource update', sourceUpdatedAt: m ? m.sourceUpdatedAt : null, sourceUpdatedKind: 'data.gov.il resource last_modified',
        snapshots: 'data/transport/' + id + '/ — rows.json.gz + a dated copy per content change + runs.jsonl',
        limitations: ['a distance is straight-line from the street\'s located points, never a walking distance', 'proximity is context — never a value or a price effect', 'a planned station is never shown as operating',
          'the rail / metro / line shapefiles on aws-e.data.gov.il refuse the runner (HTTP 403) — not bypassed; the tables are read'].concat(id === 'rail' || id === 'metro' ? ['no coordinates in the table — the stations are listed, not placed'] : []),
        sync: sum.checksRecorded ? sum : { ...sum, note: 'added 21.10.2026 — NO_RUN until the first transport-sync.yml run' } });
    } }

  /* VATMAL declared complexes (lib/planning/vatmal, 21.10.2026; integrates discovery:iplan:vatmal-mitchamim-muchrazim of 17.10.2026) */
  { const VS = require('../planning/vatmal').SOURCE, VM = readJson(path.join(dataDir, 'planning', 'vatmal', 'meta.json')), VR = readRuns(path.join(dataDir, 'planning', 'vatmal', 'runs.jsonl')).map((r) => ({ ...r, contentChanged: r.status === 'success' }));
    const sum = runSummary(VR, { staleAfterHours: 24 * 9, now });
    add({ id: VS.id, vertical: 'planning', usedFor: { he: 'דוח הרחוב: מתחם ותמ״ל מוכרז שנקודה של הרחוב בתוכו או ב-300 מ׳ — יחידות ההכרזה ותאריכה, לעולם לא יחידות הרחוב', en: 'the street report: a declared VATMAL complex with a street point inside or within 300 m — the declaration\'s units and date, never the street\'s units' },
      publisher: VS.publisher, publisherEn: VS.publisherEn, name: VS.titleEn, url: VS.page, classification: 'CONFIRMED_GIS',
      cadence: 'source: as the Committee declares · PROPX: weekly (vatmal-sync.yml)', geography: 'declaration polygons (WGS84); the locality printed as text, never mapped to a code',
      history: VM ? `${VM.stored} / ${VM.layerCount} complexes · ${VM.declaredUnitsSum} declared units (the declarations' own) · declared ${VM.declared[0]} → ${VM.declared[1]}` : null,
      latestObservation: VM ? VM.latestUpdate || VM.declared[1] : null, latestObservationKind: 'the latest declaration / update date in the layer', sourceUpdatedAt: null, sourceUpdatedKind: 'the layer states no publication date',
      snapshots: 'data/planning/vatmal/ — complexes.json.gz + a dated copy per content change + runs.jsonl',
      limitations: ['a declaration is a planning track — not an approved plan, a permit or construction', 'the declared units are the declaration\'s, never the street\'s', 'the locality is printed as text (sometimes several) — never mapped to a locality code'],
      ...(VM && VM.complete ? { discovery: { integrates: 'discovery:iplan:vatmal-mitchamim-muchrazim', auditedAt: '2026-10-17' } } : {}),
      sync: sum.checksRecorded ? sum : { ...sum, note: 'added 21.10.2026 — NO_RUN until the first vatmal-sync.yml run' } }); }

  /* the street surroundings (lib/surroundings, 21.10.2026; integrates discovery datagov:pkg:contaminatedterrains · coordinates · mosdot of the
     21.10 source universe): the contaminated-land register and the education institutions (data.gov.il) — read whole weekly */
  { const SUL = require('../surroundings');
    const used = { contaminated: { he: 'דוח הרחוב: אתרים מהמאגר על חלקות הרחוב (גוש/חלקה) או ב-300 מ׳, במקרא ובמצב כלשונם', en: 'the street report: register sites on the street\'s parcels (block / parcel) or within 300 m, legend and status verbatim' },
      'edu-points': { he: 'דוח הרחוב: מוסדות חינוך ב-500 מ׳ (נקודות כניסה שפורסמו ב-2022)', en: 'the street report: education institutions within 500 m (entrance points published in 2022)' },
      'edu-info': { he: 'דוח הרחוב: סוג, מגזר, פיקוח ותלמידים של המוסד — מהשנה האחרונה, לפי סמל המוסד בלבד', en: 'the street report: the institution\'s type, sector, supervision and students — the latest school year, by the institution code only' } };
    for (const id of Object.keys(SUL.SOURCES)) {
      const src = SUL.SOURCES[id], m = require('../reference').readMeta(id, path.join(dataDir, 'surroundings')), runs = readRuns(path.join(dataDir, 'surroundings', id, 'runs.jsonl')).map((r) => ({ ...r, contentChanged: r.status === 'success' }));
      const sum = runSummary(runs, { staleAfterHours: 24 * 9, now });
      add({ id: src.trustId, vertical: 'geo', usedFor: used[id], publisher: src.publisher, publisherEn: src.publisherEn, name: src.titleEn, url: src.page, classification: 'CONFIRMED_STRUCTURED_API',
        cadence: `source: ${src.cadence} · PROPX: weekly (surroundings-sync.yml)`, geography: id === 'contaminated' ? 'sites with block / parcel and an ITM point' : id === 'edu-points' ? 'institution entrance points (ITM → WGS84)' : 'per institution and school year (no geometry)',
        history: m ? `${m.records} records · ${m.rejected} source row(s) not kept · ${m.history.length} content version(s)` : null,
        latestObservation: m ? m.sourceUpdatedAt : null, latestObservationKind: 'the data.gov.il resource update', sourceUpdatedAt: m ? m.sourceUpdatedAt : null, sourceUpdatedKind: 'data.gov.il resource last_modified',
        snapshots: 'data/surroundings/' + id + '/ — rows.json.gz + a dated copy per content change + runs.jsonl',
        limitations: id === 'contaminated' ? ['the register\'s legend and status words are shown verbatim — "potential" is never "contaminated"', 'a listed site is not a health finding; a nearby site says nothing about the street\'s soil', 'never a value or a price effect']
          : id === 'edu-points' ? ['published 04.2022 — an institution opened later has no point', 'a nearby institution is not a registration zone and not a quality grade'] : [`school years ${SUL.EDU_FROM_YEAR} → only`, 'joined to a point by the institution code only'],
        ...(m ? { discovery: { integrates: 'discovery:datagov:pkg:' + src.package, auditedAt: '2026-10-21' } } : {}),
        sync: sum.checksRecorded ? sum : { ...sum, note: 'added 21.10.2026 — NO_RUN until the first surroundings-sync.yml run' } });
    } }

  /* housing finance — the Bank of Israel's SDMX service (lib/finance, 21.10.2026): new housing loans and the housing-credit stock, the whole banking system */
  { const FL = readJson(path.join(dataDir, 'finance', 'latest.json')), FR = readRuns(path.join(dataDir, 'finance', 'sync-runs.jsonl')), FS = require('../finance/series').SOURCE;
    const ms = FL ? Object.values(FL.measures) : [], okN = ms.filter((m) => m.latest).length;
    const sum = runSummary(FR, { staleAfterHours: 100, now });
    add({ id: FS.id, vertical: 'market', usedFor: { he: 'מימון דיור (ארצי, כלל המערכת הבנקאית): היקף ומספר המשכנתאות החדשות, ריביות לפי מסלול, שיעור החזר מהכנסה, שיעורי מימון, הלוואות לדירה להשקעה ולמחיר מופחת, מחזור, יתרת האשראי לדיור ופיגורים — בתיק השוק (הקשר ארצי) ובמרכז האמון', en: 'housing finance (national, the whole banking system): new mortgage volume and number, rates by track, payment-to-income, loan-to-value bands, investment-dwelling and reduced-price loans, refinancing, the housing-credit stock and arrears — in the market dossier (national context) and the Trust Center' },
      publisher: FS.publisher, publisherEn: FS.publisherEn, name: FS.datasetEn + ' — flows BIR_MRTG_99 · BMB_99', url: FS.base + 'structure/dataflow/BOI.STATISTICS', classification: 'CONFIRMED_STRUCTURED_API',
      cadence: `source: ${FS.cadence} · PROPX: Sunday–Thursday (finance-sync.yml)`, geography: FS.geography,
      history: FL ? `${okN}/${ms.length} measures held · ${FL.records.observations} observations (${FL.records.revisions} revisions) since 2016` : null,
      latestObservation: FL && FL.freshness ? FL.freshness.latestPeriod : null, latestObservationKind: 'the latest month of new housing loans',
      sourceUpdatedAt: null, sourceUpdatedKind: 'the service states no publication date — the observation month and PROPX\'s read time are shown',
      freshness: FL ? FL.freshness : null,
      snapshots: 'observations.jsonl (append-only, every revision with the value it replaces) · raw CSV per content hash (data/finance/raw) · sync-runs.jsonl',
      limitations: ['national banking-system figures — never a locality or district figure', 'a rate is the average on loans issued in the month by track — never an offer to a borrower',
        'variable tracks are published as an anchor and a margin — shown apart, never summed', 'the variable UNINDEXED (prime) track rate is not published in this flow — shown as not published, never 0',
        'each code is verified against the Bank\'s codelist name every run — a changed name is not read (SCHEMA_CHANGED)', 'freshness on a documented lag assumption (CURRENT ≤ 75 days after the month), not an official calendar'],
      discovery: { integrates: 'discovery:boi:sdmx:housing-finance', auditedAt: '2026-10-21' },
      sync: sum.checksRecorded ? sum : { ...sum, note: 'added 21.10.2026 — NO_RUN until the first finance-sync.yml run' } }); }

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
      sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: '2026-10-13T22:17:14Z', note: 'audited on the runner 13.10.2026 (scripts/rental-discover.js --cbs-index / --cbs-series) — not ingested' } });
    // the national headline price (owner's decision 19.10.2026: OFFICIAL first, MODEL second) — one figure, transcribed by hand, not synced
    out.push({ id: 'cbs:average-dwelling-price', vertical: 'market', inProduct: false, channel: 'official',
      usedFor: { he: 'מחיר עסקה ממוצע — כלל הדירות: הכרטיס הראשון של לוח השוק לישראל, לששת המחוזות ול-18 הערים הגדולות (בשאר — "—"); ובסיס אומדן PROPX לדירה חדשה', en: 'average transaction price — all dwellings: the market board\'s first card for Israel, the six districts and the 18 big cities (elsewhere "—"); and the base of PROPX\'s new-home estimate' },
      publisher: 'הלשכה המרכזית לסטטיסטיקה', publisherEn: 'Central Bureau of Statistics', name: 'לוח 2.2 — מחירים ממוצעים של דירות לפי מחוז, עיר גדולה וגודל · רבעון ב׳ 2026 (ירחון סטטיסטיקה של מחירים 7/2026)',
      url: 'https://www.cbs.gov.il/he/publications/Madad/DocLib/2026/price09aa/aa2_2_e.pdf', classification: 'TRANSCRIBED', cadence: 'quarterly (CBS) · PROPX: by hand', geography: 'Israel — total (incl. Judea and Samaria) · 6 districts · 18 big cities (above 100,000 residents) — each its own row; no other locality', history: null,
      latestObservation: '2026-Q2', limitations: ['transcribed from the table as read on a PROPX runner (19.10.2026, cbs-sales-discover.yml run 39211103296) — not synced, no copy of the table is stored; the OFFICIAL label holds only while the shown value equals the cited figure',
        'all dwelling transactions, new and second-hand (1–6 rooms, the Dwellings Price Index sample; no government-subsidised deals since Q4 2022) — not a new-home price', 'the last quarter is provisional (CBS)', 'an average moves with the mix of dwellings sold; it is not a price index',
        'a geography without its own row shows "—" — never its district\'s row; Central District (₪2,731,500) is a different row from Israel (₪2,435,000)', 'the board\'s new-home figure is a PROPX MODEL (× 1.12), not this table'],
      sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'read and transcribed 19.10.2026 (Table 2.2, last produced for Price Statistics Monthly No. 7/2026) — check the latest quarter of the table by hand' } }); }

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
    sourceUpdatedAt: geoMeta ? geoMeta.builtAt : null, limitations: ['streets now come from the official directory + synonyms (datagov:streets, 19.10.2026); this entry is the locality layer', 'CBS statistical areas not ingested', 'neighbourhoods are not official polygons for most localities — never inferred'],
    sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: geoMeta ? geoMeta.builtAt : null, note: 'a dated build, not a daily sync' } });

  /* the official street directory + its synonyms (scripts/street-sync.js, weekly) and the street market evidence sweep
     (scripts/street-evidence-sync.js — the republished register joined to the directory; runs again only when the copy changes) */
  const stMeta = readJson(path.join(dataDir, 'geo', 'streets', 'meta.json'));
  const stRuns = readRuns(path.join(dataDir, 'geo', 'streets', 'sync-runs.jsonl'));
  add({ id: 'datagov:streets', vertical: 'geo', usedFor: { he: 'מרשם הרחובות הרשמי + שמות נרדפים — חיפוש כל רחוב, מזהה קנוני st:<יישוב>:<רחוב>', en: 'the official street directory + synonyms — every street searchable, canonical id st:<locality>:<street>' },
    publisher: 'רשות האוכלוסין וההגירה (data.gov.il)', publisherEn: 'Population and Immigration Authority (data.gov.il)',
    name: 'רשימת רחובות בישראל (9ad3862c…) + קובץ עם סינונימיים (bf185c7f…)', url: 'https://data.gov.il/dataset/321', classification: 'CONFIRMED_STRUCTURED_API',
    cadence: 'weekly (street-sync.yml); the registry is republished daily', geography: 'national — every locality code',
    history: stMeta && stMeta.counts ? `${stMeta.counts.current} official rows · ${stMeta.counts.synonyms} synonyms · ${stMeta.counts.historical} historical kept` : null,
    latestObservation: stMeta && stMeta.sources ? String(stMeta.sources.streets.lastModified || '').slice(0, 10) || null : null, latestObservationKind: 'the registry\'s last modification',
    sourceUpdatedAt: stMeta && stMeta.sources ? stMeta.sources.streets.lastModified || null : null,
    limitations: ['an ADDRESS registry: code 9000 is the locality itself (not offered as a street), 6000–6999 address areas, 7000–8999 sites', 'a code that leaves the registry stays as historical — identities are never re-used', 'no geometry: a street has no coordinates of its own'],
    sync: runSummary(stRuns, { staleAfterHours: 8 * 24 + 12, now }) });
  const evMeta = readJson(path.join(dataDir, 'streets', 'evidence', 'meta.json'));
  const evRuns = readRuns(path.join(dataDir, 'streets', 'evidence', 'sync-runs.jsonl'));
  const evFresh = evMeta && evMeta.source ? FRESH.evidenceFreshness({ meta: evMeta, runs: evRuns, monitor: readJson(path.join(dataDir, 'transactions', 'freshness.json')), today: new Date(now).toISOString().slice(0, 10) }) : null;
  out.push({ id: 'over:street-evidence', vertical: 'transactions', inProduct: true, channel: 'independent-republication',
    usedFor: { he: 'ראיות שוק ברמת הרחוב — עסקאות המרשם שכל כתובות החלקה שלהן על הרחוב (36 חודשים)', en: 'street-level market evidence — register deals whose parcel addresses are all on the street (36 months)' },
    publisher: 'גרסאות לעם (over.org.il) — עותק של מאגר רשות המסים', publisherEn: 'over.org.il — a copy of the Tax Authority register', name: 'street evidence sweep (lib/streets/evidence.js)', url: 'https://www.over.org.il/',
    classification: 'THIRD_PARTY_REPUBLICATION', cadence: 'weekly check; a full sweep only when the publisher\'s copy changes', geography: 'national, every swept locality — streets through the parcel crosswalk',
    history: evMeta && evMeta.window ? `${evMeta.window.from} … ${evMeta.window.to}` : null, latestObservation: evMeta && evMeta.window ? evMeta.window.to : null, latestObservationKind: 'the copy\'s latest deal',
    sourceUpdatedAt: evMeta && evMeta.source ? evMeta.source.scrapedAt : null,
    /* the copy's own age (lib/gov/freshness.js): STALE / VERY STALE / SOURCE LAG UNKNOWN raise SOURCE_STALE whatever PROPX's check says */
    freshness: evFresh, sourceStale: !!(evFresh && FRESH.isStale(evFresh.state)),
    limitations: ['not a government channel — labelled so', 'a deal enters a street\'s statistics only when every address of its parcel is on that street (corner parcels and truncated lists are POSSIBLE, never aggregated)', 'deals with no address link are locality-level only', 'no asking prices, no rents, no confirmed new / second-hand flag',
      'a snapshot: deals reach the register weeks to months after signing, and nothing after the copy\'s date is in it — its age and state are stated on every transaction surface'],
    sync: runSummary(evRuns, { staleAfterHours: 2 * 24 + 12, now }) });

  /* the RECENT layer (lib/recent, 20.10.2026; integrates discovery:over:govmap-layer): the GovMap-layer copy's recent window read
     verbatim, reconciled against the register copy — only the deals the register copy does not hold yet are shown, apart */
  { const rm = readJson(path.join(dataDir, 'streets', 'recent', 'meta.json')), rmRuns = readRuns(path.join(dataDir, 'streets', 'recent', 'sync-runs.jsonl'));
    const rs = rm && rm.source ? FRESH.stateOf({ snapshotAt: rm.source.loadedAt, checkedAt: rmRuns.filter((r) => Number(r.requests) > 0 && (r.status === 'ok' || r.status === 'unchanged')).map((r) => r.finishedAt).filter(Boolean).sort().pop() || null, today: new Date(now).toISOString().slice(0, 10) }) : null;
    out.push({ id: 'over:govmap-recent', vertical: 'transactions', inProduct: true, channel: 'independent-republication',
      usedFor: { he: 'עסקאות אחרונות שעותק שכבת העסקאות של GovMap מפרסם ועותק המרשם עדיין לא מחזיק — מוצגות בנפרד, לעולם לא בנתוני המרשם או במודל', en: 'recent deals the GovMap-layer copy publishes that the register copy does not hold yet — shown apart, never in the register figures or the model' },
      publisher: 'גרסאות לעם (over.org.il) — עותק של שכבת העסקאות של GovMap', publisherEn: 'over.org.il — a copy of the GovMap deals layer (lay=16)', name: 'recent transactions layer (lib/recent)', url: 'https://www.govmap.gov.il/?lay=16',
      classification: 'THIRD_PARTY_REPUBLICATION', cadence: 'daily check (street-recent-sync.yml); the window is read again only when the copy changes', geography: 'national — rows placed by settlement name or block · parcel',
      history: rm && rm.window ? `${rm.window.from} … ${rm.window.to} · ${rm.shown ? rm.shown.rows : 0} new recent deals shown of ${rm.source && rm.source.snapshot ? rm.source.snapshot.rows : '—'} read` : null,
      latestObservation: rm && rm.shown ? rm.shown.latest : null, latestObservationKind: 'the latest recent-only deal shown', sourceUpdatedAt: rm && rm.source ? rm.source.loadedAt : null,
      freshness: rs ? { state: rs.state, ageDays: rs.ageDays, stateReason: rs.reason } : null, sourceStale: !!(rs && FRESH.isStale(rs.state)),
      reconciliation: rm ? { classes: rm.classes, audit: rm.audit ? { expectedTotal: rm.audit.expectedTotal, replayedTotal: rm.audit.replayedTotal, exact: rm.audit.exact } : null, register: rm.register } : null,
      limitations: ['not a government channel — labelled so', 'a second deal-id series repeats deals one day earlier without a property type — paired and not shown twice', 'dates up to 2048 as published — future-dated rows are excluded',
        'amounts truncated to ₪1,000, its own sub-parcel numbering — reconciled, the register\'s fields stand', 'rows without a placeable settlement are excluded', 'never in a street median, sample state, change figure or the street value model'],
      discovery: { integrates: 'discovery:over:govmap-layer', auditedAt: '2026-10-19' },
      sync: runSummary(rmRuns, { staleAfterHours: 50, now }) }); }

  /* the daily transaction-freshness monitor (scripts/tx-freshness.js, P0 audit 19.10.2026) — a check, never a source of deals */
  { const fr = readJson(path.join(dataDir, 'transactions', 'freshness.json')), frRuns = readRuns(path.join(dataDir, 'transactions', 'freshness-runs.jsonl'));
    out.push({ id: 'propx:tx-freshness', vertical: 'transactions', inProduct: true, channel: 'derived',
      usedFor: { he: 'בדיקה יומית: כמה עדכני מאגר העסקאות — תאריך העותק, העסקה האחרונה, פיגור בימים, עותקים חדשים יותר, ערוצים רשמיים', en: 'daily check: how fresh the transaction universe is — copy date, latest deal, lag in days, newer copies, official channels' },
      publisher: 'PROPX', publisherEn: 'PROPX', name: 'transaction freshness monitor (scripts/tx-freshness.js)', url: null, classification: 'DERIVED',
      cadence: 'daily (tx-freshness.yml) — five read-only requests', geography: 'national',
      history: fr ? `copy ${String(fr.propx && fr.propx.snapshotAt || '').slice(0, 10)} · latest deal ${fr.propx && fr.propx.copyLatestDeal} · ${fr.freshness && fr.freshness.state}` : null,
      latestObservation: fr && fr.propx ? fr.propx.copyLatestDeal : null, latestObservationKind: 'the stored copy\'s latest deal', sourceUpdatedAt: fr ? fr.checkedAt : null,
      lagAlerts: fr ? (fr.alerts || []).filter((a) => !a.informational) : [],
      limitations: ['states freshness — it never writes a transaction', 'official channels refusing the runner are recorded, never worked around'],
      sync: runSummary(frRuns, { staleAfterHours: 50, now }) }); }

  /* THE NATIONAL MISSED-DEAL DETECTOR (scripts/txevents-national.js, 20.10.2026): the whole published file of the GovMap-layer copy's
     latest version, reconciled against the register copy under the recent layer's rules — rows the register copy does not hold are shown */
  { const nm = readJson(path.join(dataDir, 'txevents', 'national', 'meta.json')), nRuns = readRuns(path.join(dataDir, 'txevents', 'national', 'runs.jsonl'));
    const runs = nRuns.map((r) => ({ id: `${r.kind}:${r.at}`, startedAt: r.at, finishedAt: r.at, status: r.status === 'FAILED' ? 'failed' : r.status === 'UNCHANGED' ? 'unchanged' : 'ok', error: r.error || null, requests: r.kind === 'check' ? 2 : 1, contentChanged: r.status === 'UNCHANGED' ? false : undefined }));
    const ns = nm && nm.version ? FRESH.stateOf({ snapshotAt: nm.version.detectedAt, checkedAt: nRuns.filter((r) => r.kind === 'check' && r.status !== 'FAILED').map((r) => r.at).sort().pop() || null, today: new Date(now).toISOString().slice(0, 10) }) : null;
    out.push({ id: 'over:govmap-national', vertical: 'transactions', inProduct: true, channel: 'independent-republication',
      usedFor: { he: 'גלאי העסקאות החסרות: כל שורות הקובץ המלא של שכבת העסקאות של GovMap מול עותק המרשם — עסקאות שהמרשם אינו מחזיק מוצגות כאירועים', en: 'the missed-deal detector: every row of the GovMap-layer copy\'s published file against the register copy — deals the register copy does not hold are shown as events' },
      publisher: 'גרסאות לעם (over.org.il) — הקובץ שפורסם עם גרסת שכבת העסקאות של GovMap', publisherEn: 'over.org.il — the file published with the GovMap deals-layer dataset version', name: 'national missed-deal detector (scripts/txevents-national.js)', url: 'https://www.govmap.gov.il/?lay=16',
      classification: 'THIRD_PARTY_REPUBLICATION', cadence: 'version check every three hours (txevents-national.yml); the file is read again only when a new version is published', geography: 'national',
      history: nm ? `version ${nm.version ? nm.version.n : '?'} · ${nm.windowRows} rows in the register window · ${nm.shown ? nm.shown.govmapOnly : 0} not in the register copy` : null,
      latestObservation: nm && nm.file && nm.file.dates ? nm.file.dates.max : null, latestObservationKind: 'the file\'s latest date (future-dated rows included as published)', sourceUpdatedAt: nm && nm.version ? nm.version.detectedAt : null,
      freshness: ns ? { state: ns.state, ageDays: ns.ageDays, stateReason: ns.reason } : null, sourceStale: !!(ns && FRESH.isStale(ns.state)),
      limitations: ['not a government channel — labelled so', 'the layer states no ownership share: its prices are never used in a statistic', 'at 27 points GovMap holds more than 500 deals and the layer may truncate them (the publisher\'s own warning)', 'rows inside the recent window are the recent layer\'s (never twice)'],
      sync: runs.length ? runSummary(runs, { staleAfterHours: 12, now }) : { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'added 20.10.2026 — NO_RUN until the first txevents-national.yml run' } }); }

  /* THE TRANSACTION EVENTS (lib/txevents, 20.10.2026): the union of the transaction sources — one event per deal, newest first — and its
     completeness: every source row PROPX read has one reconciliation state; an unexplained row raises an alert */
  { const cp = readJson(path.join(dataDir, 'txevents', 'completeness.json'));
    const unexplained = cp && cp.notSurfaced ? cp.notSurfaced.unexplained : null;
    out.push({ id: 'propx:transaction-events', vertical: 'transactions', inProduct: true, channel: 'derived',
      usedFor: { he: 'טבלת העסקאות האחת: כל אירוע עסקה ש-PROPX מחזיק למקום — מהמרשם, משכבת GovMap ומשחזור החלקה — עם המקור והמצב שלו', en: 'the one transaction table: every transaction event PROPX holds for a place — from the register, the GovMap layer and the parcel recovery — with its source and state' },
      publisher: 'PROPX', publisherEn: 'PROPX', name: 'transaction events (lib/txevents)', url: null, classification: 'DERIVED',
      cadence: 'rebuilt by every transaction sync (scripts/txevents-build.js)', geography: 'national — locality · street · building · block / parcel',
      history: cp ? `latest event ${cp.latestEvent} · ${cp.sources ? cp.sources.healthy : 0} of ${cp.sources ? cp.sources.monitored : 0} sources current · unexplained rows ${unexplained}` : null,
      latestObservation: cp ? cp.latestEvent : null, latestObservationKind: 'the latest transaction event in any source', sourceUpdatedAt: cp ? cp.builtAt : null,
      completeness: cp ? { unexplained, statement: cp.notSurfaced.statement, newEvents: cp.newEvents, possibleDuplicates: cp.possibleDuplicates, conflicts: cp.conflicts, unresolved: cp.unresolved } : null,
      completenessAlert: unexplained != null && unexplained > 0,
      limitations: ['an event is shown whatever its price semantics; its price is used only when its state is PRICED IN STATISTICS', 'absence is stated only when the sources cover the period'],
      sync: cp ? { runState: 'SUCCESS', state: 'SUCCESS', lastCheckAt: cp.builtAt, note: 'built offline from the stored sources' } : { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'not built yet' } }); }

  /* the street value model (lib/streets/value-model.js) — a MODEL built from the street evidence, never a source of observations */
  { const sm = readJson(path.join(dataDir, 'streets', 'model', 'model.json'));
    out.push({ id: 'propx:street-model', vertical: 'derived', inProduct: true, channel: 'derived',
      usedFor: { he: 'הערכת PROPX לשווי שוק ברחוב (מודל) — לעולם לא השוק שנצפה', en: 'the PROPX street estimate (MODEL) — never the observed market' },
      publisher: 'PROPX', publisherEn: 'PROPX', name: `street value model ${sm ? sm.modelVersion : ''} (lib/streets/value-model.js)`, url: null, classification: 'DERIVED',
      cadence: 'rebuilt when the evidence, the directory, the land parcels or the method change (street-evidence-sync.yml)', geography: 'streets with street-specific evidence',
      history: sm ? `${sm.counts.estimated} of ${sm.counts.streets} streets estimated · training cutoff ${sm.trainingCutoff}` : null, latestObservation: sm ? sm.asOf : null, latestObservationKind: 'the evidence date (the copy\'s latest deal)',
      sourceUpdatedAt: sm ? sm.builtAt : null,
      limitations: ['a MODEL estimate — not an appraisal, an official value or an asking price', 'validated on held-out deals; MODEL UNAVAILABLE where the evidence is not street-specific'],
      sync: sm ? { runState: 'SUCCESS', state: 'SUCCESS', lastCheckAt: sm.builtAt, note: 'built offline from the stored evidence' } : { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'not built yet' } }); }

  /* derived layers (PROPX's own, from the sources above) */
  out.push({ id: 'propx:entities', vertical: 'derived', inProduct: true, channel: 'derived', usedFor: { he: 'רישום יזמים ופרויקטים — פעילות שנצפתה במקורות PROPX', en: 'developer & project registry — observed PROPX activity' },
    publisher: 'PROPX', publisherEn: 'PROPX', name: 'lib/entities — deterministic registry', url: null, classification: 'DERIVED', cadence: 'rebuilt from the stored records on every data change',
    geography: 'as its sources', history: 'as its sources', limitations: ['observed activity only — not a land bank, a total pipeline or a complete developer list', 'no similarity merge: possible same entities are linked, never combined'],
    sync: { runState: 'NO_RUN', state: 'NO_RUN', lastCheckAt: null, note: 'derived at read time from rmi:michrazim + the MoCH lotteries' } });

  /* ---- institutional due diligence (lib/dd, 18.10.2026; integrates the INTEGRATE verdicts of lib/trust/discovery/2026-10-18.json) —
     one run log (data/dd/sync-runs.jsonl) with a state per lane; NO_RUN until the first dd-sync.yml run */
  { const ddRuns = readRuns(path.join(dataDir, 'dd', 'sync-runs.jsonl')), ddLatest = readJson(path.join(dataDir, 'dd', 'latest.json'));
    const laneRuns = (lane) => ddRuns.filter((r) => r && r.lanes && r.lanes[lane]).map((r) => { const st = String(r.lanes[lane]); const err = r.errors && r.errors[lane] ? String(r.errors[lane]) : null;
      return { id: `${r.at}:${lane}`, startedAt: r.at, finishedAt: r.at, status: st === 'SCHEMA_CHANGED' ? 'failed' : st.toLowerCase(), error: st === 'SCHEMA_CHANGED' ? `schema changed: ${err || ''}` : err, contentChanged: st === 'UNCHANGED' ? false : undefined }; });
    const sumOf = (lane, staleAfterHours = 100) => { const rs = laneRuns(lane); const x = runSummary(rs, { staleAfterHours, now }); return rs.length ? x : { ...x, note: 'added 18.10.2026 — NO_RUN until the first dd-sync.yml run' }; };
    const L = ddLatest || {};
    const MOJ = ['משרד המשפטים — רשות התאגידים', 'Ministry of Justice — Israeli Corporations Authority'];
    const DD_SOURCES = [
      { id: 'datagov:ica:companies', lane: 'companies', vertical: 'corporate', publisher: MOJ, name: 'מאגר חברות — רשם החברות (data.gov.il, resource f004176c…)', url: 'https://data.gov.il/dataset/ica_companies', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'זהות משפטית של יזם: מספר חברה, סטטוס, סוג (פרטית / ציבורית), דגל הפרה, שנת דוח שנתי — במצב התאמה מפורש', en: 'a developer\'s legal identity: company number, status, type (private / public), breach flag, annual-report year — at an explicit match state' },
        history: L.companies ? `${L.companies.kept} rows kept of ${L.companies.total} (those resolving from developer names, their spelling variants and parties, and registered contractors)` : null, latestObservation: L.companies ? L.companies.sourceModified : null,
        limitations: ['no PROPX source carries a company number: a developer resolves by its registered name — STRONG MATCH at best, never VERIFIED unless the user supplies the number', 'no shareholders, parents, subsidiaries, SPVs or guarantors — ownership is NOT resolvable', '"מפרה" (breach) is a filing-duty flag, never insolvency', 'the current state only; status changes are recorded by PROPX from the day it began reading (history.jsonl)'] },
      { id: 'datagov:ica:changes', lane: 'filings', vertical: 'corporate', publisher: MOJ, name: 'פרטי שינויים בתאגידים — רשם החברות (charges registered / removed, annual reports, officers, breach updates)', url: 'https://data.gov.il/dataset/ica-changes', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'אירועי רישום לפי מספר החברה — רישום / סילוק שעבוד, דוחות שנתיים, בעלי תפקידים', en: 'filing events by company number — charge registration / removal, annual reports, officers' },
        history: L.filings ? `${L.filings.kept} events for ${L.filings.counts ? L.filings.counts.companies : '?'} companies · window ${L.filings.window ? L.filings.window.from + ' → ' + L.filings.window.to : '—'}` : null, latestObservation: L.filings && L.filings.window ? L.filings.window.to : null,
        limitations: ['a charge is financing collateral — never distress', 'no chargee, amount or charged asset', 'a rolling ~12-month window: no event before it is not no charge'] },
      { id: 'datagov:ica:partnerships', lane: 'partnerships', vertical: 'corporate', publisher: MOJ, name: 'מאגר שותפויות — רשם החברות', url: 'https://data.gov.il/dataset/ica_partnerships', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'זהות משפטית של יזם מסוג שותפות', en: 'the legal identity of partnership-kind developers' }, history: L.partnerships ? `${L.partnerships.kept} rows kept of ${L.partnerships.total}` : null, latestObservation: L.partnerships ? L.partnerships.sourceModified : null, limitations: ['name-only resolution, never VERIFIED'] },
      { id: 'datagov:ica:voluntary-liquidation-fast-track', lane: 'insolvency', vertical: 'corporate', publisher: MOJ, name: 'חברות בפרוק מרצון בהליך מזורז', url: 'https://data.gov.il/dataset/membership-in-liquidation', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'פירוק מרצון מזורז לפי מספר החברה — החלטת בעלי מניות, לא חדלות פירעון', en: 'fast-track voluntary liquidation by company number — a shareholder decision, not insolvency' }, history: L.insolvency ? `${L.insolvency.voluntaryFast.kept} of ${L.insolvency.voluntaryFast.total} rows match a kept company` : null, latestObservation: L.insolvency ? L.insolvency.voluntaryFast.sourceModified : null, limitations: ['VOLUNTARY LIQUIDATION ≠ INSOLVENCY'] },
      { id: 'datagov:moj:official-receiver:liquidation', lane: 'insolvency', vertical: 'corporate', publisher: ['משרד המשפטים — הכונס הרשמי / הממונה על הליכי חדלות פירעון', 'Ministry of Justice — the Official Receiver / Commissioner of Insolvency'], name: 'מאגר הכונס הרשמי — קובץ חברות בפירוק', url: 'https://data.gov.il/dataset/pr2018', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'תיקי פירוק בבית משפט לפי מספר החברה — בקשה, צו, ביטול / הקפאה, סגירה', en: 'court liquidation cases by company number — request, order, stay, closure' }, history: L.insolvency ? `${L.insolvency.liquidation.kept} cases of ${L.insolvency.liquidation.total} match a kept company` : null, latestObservation: L.insolvency ? L.insolvency.liquidation.sourceModified : null,
        limitations: ['rows with company number 0 cannot be joined and are never matched by name', 'the absence of a row is not evidence of solvency', 'the case status is the Receiver\'s own vocabulary'] },
      { id: 'datagov:ica:designated-strike-off', lane: 'strikeoff', vertical: 'corporate', publisher: MOJ, name: 'מאגר החברות המיועדות למחיקה — רשם החברות (data.gov.il, resource 0fd312bb…)', url: 'https://data.gov.il/dataset/', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'ייעוד למחיקה לפי מספר החברה — מועד הפרסום ומועד המחיקה הצפוי; ייעוד ≠ מחיקה, לא חדלות פירעון', en: 'designation for strike-off by company number — the publication date and the expected strike-off date; designation ≠ strike-off, not insolvency' },
        history: L.strikeOff ? `${L.strikeOff.kept} of ${L.strikeOff.total} designated companies are kept companies` : null, latestObservation: L.strikeOff ? L.strikeOff.sourceModified : null,
        limitations: ['an objection can stop a strike-off — the expected date is not an outcome', 'not insolvency, not litigation', 'kept for the companies PROPX keeps (developers\' and contractors\')'], audited: '2026-10-18-premium' },
      { id: 'datagov:moch:contractors-register', lane: 'contractors', vertical: 'construction', publisher: ['משרד הבינוי והשיכון — רשם הקבלנים', 'Ministry of Construction and Housing — Registrar of Contractors'], name: 'פנקס הקבלנים הרשומים', url: 'https://data.gov.il/dataset/pinkashakablanim', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'רישום קבלן: ענף, קבוצה, סיווג, מספר ישות (= מספר חברה) — הגשר בין אתר בנייה לחברה רשומה', en: 'contractor registration: branch, group, class, entity number (= company number) — the bridge from a construction site to a legal company' },
        history: L.contractors && L.contractors.counts ? `${L.contractors.counts.contractors} contractors · ${L.contractors.counts.withCompanyNumber} with a company number` : null, latestObservation: L.contractors ? L.contractors.sourceModified : null, limitations: ['CONTRACTOR ≠ DEVELOPER', 'individuals / older rows carry no company number', 'branch / group / class are registration facts, not quality judgements'] },
      { id: 'datagov:labor:active-construction-sites', lane: 'sites', vertical: 'construction', publisher: ['משרד העבודה — מינהל הבטיחות', 'Ministry of Labour — Occupational Safety Administration'], name: 'אתרי בנייה פעילים (+ אתרי בניה שנסגרו)', url: 'https://data.gov.il/dataset/b072e36c-a53b-49e1-be08-4a608fcf4638', classification: 'CONFIRMED_STRUCTURED_API',
        usedFor: { he: 'אתרים פעילים לפי מספר הקבלן המבצע (מפתח מדויק); צירוף לפרויקט רק במפתח שנקרא מהטקסט החופשי, עם מצב התאמה', en: 'active sites by the executing contractor\'s number (exact key); joined to a project only by a key read from the free text, with a match state' },
        history: L.sites && L.sites.counts ? `${L.sites.counts.active} active sites (${L.sites.counts.withExecutorId} with an executor number) · ${L.sites.counts.closed} closure notices · first / last seen kept by PROPX` : null, latestObservation: L.sites ? L.sites.sourceModified : null,
        limitations: ['ACTIVE SITE ≠ COMPLETED UNITS', 'no start / completion dates in the source — the dates are PROPX observations', 'a site no longer listed ≠ a stopped project'] },
      { id: 'tlv:iview2:permits-772', lane: 'tlv', vertical: 'planning', publisher: ['עיריית תל אביב-יפו — מינהל ההנדסה', 'Tel Aviv-Yafo Municipality — Engineering Administration'], name: 'IView2 — בקשות והיתרי בנייה (שכבה 772) + אתרי בנייה (שכבה 499)', url: 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/772', classification: 'CONFIRMED_GIS',
        usedFor: { he: 'סולם היתר → תחילת בנייה → גמר → אכלוס עם תאריכים — תל אביב-יפו בלבד', en: 'the permit → construction start → completion → occupancy ladder with dates — Tel Aviv-Yafo only' },
        history: L.tlv ? `${L.tlv.permits.counts.rows} permit requests · ${L.tlv.sites.counts.rows} site rows · import ${L.tlv.permits.imported || '—'}` : null, latestObservation: L.tlv ? L.tlv.permits.imported : null,
        limitations: ['TEL AVIV MUNICIPAL COVERAGE — never national, district or another city', 'PERMIT ≠ CONSTRUCTION START ≠ COMPLETION', 'a parcel match ≠ the same project without a second key (holder / executor)'] },
    ];
    for (const x of DD_SOURCES) add({ id: x.id, vertical: x.vertical, usedFor: x.usedFor, publisher: x.publisher[0], publisherEn: x.publisher[1], name: x.name, url: x.url, classification: x.classification,
      cadence: 'source: nightly (data.gov.il) / nightly import (Tel Aviv GIS) · PROPX: every working day (dd-sync.yml)', geography: x.id.startsWith('tlv:') ? 'Tel Aviv-Yafo only' : 'national',
      history: x.history, latestObservation: x.latestObservation, latestObservationKind: 'the source\'s own last modification / import', sourceUpdatedAt: x.latestObservation, sourceUpdatedKind: 'catalogue last_modified / GIS date_import',
      snapshots: 'slim keyed rows in data/dd/ (rewritten when the source changed) · what changed between two PROPX reads in data/dd/history.jsonl (append-only) · run log data/dd/sync-runs.jsonl',
      limitations: x.limitations, discovery: { integrates: 'discovery:' + x.id, auditedAt: '2026-10-18' }, sync: sumOf(x.lane) }); }

  /* ---- discovery: candidate sources audited read-only and NOT ingested (lib/trust/discovery/<date>.json) — classified, with a verdict, a join key and
     the evidence; listed so the Trust Center says what exists, what was rejected and why; never read at runtime */
  for (const f of discoveryFiles()) {
    const list = readJson(f, []);
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || !c.id || out.some((x) => x.id === 'discovery:' + c.id)) continue;
      const vertical = c.vertical || (/^cbs:|^datagov:cbs/.test(c.id) ? 'market' : /labor|contractors|fire/.test(c.id) ? 'construction' : /iplan|tlv:gis|tlv:iview2|haifa|jerusalem|beer-sheva|muni:|arcgis-online/.test(c.id) ? 'planning' : /ica:|moj:|tase:|courts|isa:|ratings:|datagov:cma|datagov:mof|datagov:moin|enforcement/.test(c.id) ? 'corporate' : /^sales:/.test(c.id) ? 'housing' : /moch/.test(c.id) ? 'housing' : /piba|census|socio|mot:|digital/.test(c.id) ? 'geo' : /rmi/.test(c.id) ? 'land' : 'derived');
      out.push({ id: 'discovery:' + c.id, vertical, inProduct: false, channel: 'official', publisher: c.owner || null, publisherEn: c.ownerEn || null, name: c.name || c.id, url: c.url || null, classification: c.classification || 'UNUSABLE',
        usedFor: (() => { const by = out.find((x) => x.discovery && x.discovery.integrates === 'discovery:' + c.id); return by ? { he: `נבדק — שולב כמקור ${by.id}`, en: `audited — integrated as ${by.id}` } : { he: `נבדק ולא נקרא — ${c.verdict === 'INTEGRATE' ? 'מועמד לשילוב' : c.verdict === 'REJECT' ? 'נדחה' : c.verdict === 'BLOCKED' ? 'חסום' : c.verdict === 'BROWSER-AUTOMATION ONLY' ? 'נגיש רק באוטומציית דפדפן — לא שולב' : 'תיעוד בלבד'}`, en: `audited, not read — ${c.verdict === 'INTEGRATE' ? 'candidate for integration' : c.verdict === 'REJECT' ? 'rejected' : c.verdict === 'BLOCKED' ? 'blocked' : c.verdict === 'BROWSER-AUTOMATION ONLY' ? 'browser automation only — not integrated' : 'documented only'}` }; })(),
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
    for (const l of s.lagAlerts || []) a.push({ id: s.id, kind: 'SOURCE_LAG', vertical: s.vertical, publisher: s.publisher, publisherEn: s.publisherEn || null, name: s.name, at: s.sourceUpdatedAt || null, note: l.message, lag: l.kind });
    if (s.sourceStale) a.push({ id: s.id, kind: 'SOURCE_STALE', vertical: s.vertical, publisher: s.publisher, publisherEn: s.publisherEn || null, name: s.name, at: s.sourceUpdatedAt || null, note: 'the source content itself is old (its own last update), whatever PROPX\'s check says' });
    return a;
  });
  const order = { REFUSED: 0, SCHEMA_CHANGED: 1, FAILED: 2, STALE: 3, PARTIAL: 4, SOURCE_LAG: 5, SOURCE_STALE: 6, RECOVERED: 7 };
  alerts.sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9) || String(y.at || '').localeCompare(String(x.at || '')));
  return { generatedAt: new Date(now).toISOString(), states: STATES, counts, sources: out, alerts, alertStates: [...ALERT_STATES, 'RECOVERED', 'SOURCE_STALE', 'SOURCE_LAG'], recoveryWindowDays: RECOVERY_WINDOW_DAYS,
    vocabulary: { SUCCESS: 'answered, data read', UNCHANGED: 'answered, nothing changed', PARTIAL: 'answered in part (budget, cap or some failures)', REFUSED: 'refused this runner (401/403/429) — not worked around',
      FAILED: 'the run failed — last valid data kept', SCHEMA_CHANGED: 'answered in an unrecognized shape — nothing applied', STALE: 'last good check older than the cadence allows', NO_RUN: 'no scheduled check (read on request, dated build, or audited only)' },
    principles: ['a source that is unavailable never becomes 0 — its last valid data is kept, dated and marked', 'raw snapshots are kept per content hash; history is appended; nothing is deleted',
      'OFFICIAL · THIRD_PARTY_REPUBLICATION · DERIVED · MODEL are never mixed without a label'] };
}

module.exports = { catalog, stateOfRun, shownState, runSummary, STATES };
