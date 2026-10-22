// PROPX · FRESHNESS AUDIT — one row per data source / sync lane: how new is what PROPX holds, and how do we know.
//
// A pure, deterministic read model over files the repository already commits — the run logs and metas the scheduled syncs write
// (data/**), the Trust catalogue (lib/trust/catalog.js, which it reuses for every run summary) and the workflow files' own schedules —
// plus, optionally, GitHub Actions run evidence gathered by scripts/freshness-audit.js (status · dates · run ids only). It fetches
// nothing and writes nothing. Same inputs → same output.
//
// Every entry keeps FOUR dates apart (never one "updated"):
//   latestObservation  the newest observation the stored data holds (an event date, a period, a deal date)
//   publication        the source's own publication / last-modified date, when a channel states it (else null + the reason)
//   ingestion          when PROPX last stored new content from the source
//   lastCheck          when PROPX last asked the source (a check that found nothing new is a check)
// and one STATE (STATES below), the rule that set it, the cadence, the evidence paths.
//
// The documented-lag rules are each lane's own (lib/gov/freshness.js for the transaction copies, the CBS lanes' `freshness` blocks, the
// finance lane's) or a stated ASSUMPTION (never an official calendar) — written beside the state in `lag.basis`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const CAT = require('./catalog');
const FRESH = require('../gov/freshness');

const ENGINE = 'propx-freshness-audit-1';
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const HOUR = 3600e3, DAY = 24 * HOUR;
const GOOD_RUN = new Set(['SUCCESS', 'UNCHANGED', 'PARTIAL']);

/* the vocabulary — one state per entry, in precedence order (the first that applies) */
const STATES = ['REFUSED', 'FAILING', 'CHECK_STALE', 'SOURCE_STALE', 'EXPECTED_LAG', 'CURRENT', 'DATED_BUILD', 'NO_RUN'];
const STATE_MEANING = {
  REFUSED: 'the source refuses PROPX\'s runner (HTTP 401 / 403 / 429) — recorded, never worked around; the last valid data is kept',
  FAILING: 'the latest check failed or found an unrecognised shape — the last valid data is kept and dated',
  CHECK_STALE: 'PROPX\'s last good check is older than the lane\'s cadence allows',
  SOURCE_STALE: 'PROPX checks on schedule, but the source\'s own content is older than its documented lag (or the source is classified stale)',
  EXPECTED_LAG: 'a newer period is due under the documented lag, and its window has not closed yet',
  CURRENT: 'checked on schedule and the source holds the newest period its documented lag allows',
  DATED_BUILD: 'no scheduled check — a dated build or a hand transcription; its date is shown',
  NO_RUN: 'no recorded check',
};

/* ---------------------------------------------------------------- small readers */
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function readRuns(f) {
  let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } }
  return out;
}
const readGzJson = (f) => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { return null; } };
const iso = (v) => { const t = FRESH.ts(v); return t == null ? null : new Date(t).toISOString(); };
const day = (v) => { const t = FRESH.ts(v); return t == null ? null : new Date(t).toISOString().slice(0, 10); };
const ageDays = (v, now) => { const t = FRESH.ts(v); return t == null ? null : Math.floor((now - t) / DAY); };
const later = (a, b) => (!a ? b : !b ? a : FRESH.ts(a) >= FRESH.ts(b) ? a : b);
const runAt = (r) => (r ? r.finishedAt || r.startedAt || r.at || null : null);
const isCheckRun = (r) => r && !/:store$/.test(String(r.id || '')) && r.retrievalMethod !== 'replay' && r.retrievalMethod !== 'none'
  && !['running', 'skipped', 'rebuilt'].includes(String(r.status || '').toLowerCase());
/** the last run that stored new content (SUCCESS, or PARTIAL with content) — PROPX's ingestion date */
function lastIngest(runs) {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (!isCheckRun(r)) continue;
    const s = CAT.stateOfRun(r);
    if ((s === 'SUCCESS' || s === 'PARTIAL') && r.contentChanged !== false) return runAt(r);
  }
  return null;
}
const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const n = y * 12 + (m - 1) + k; return monthKey(Math.floor(n / 12), (n % 12) + 1); };

/* ---------------------------------------------------------------- schedules (the workflow files' own cron lines) */
/** the cron lines of a workflow file, [] when it has no schedule */
function cronOf(file, workflowsDir = WORKFLOWS) {
  let y = ''; try { y = fs.readFileSync(path.join(workflowsDir, file), 'utf8'); } catch { return []; }
  const m = /\n\s*schedule:\s*\n((?:\s*-\s*cron:.*\n?)+)/.exec(y);
  return m ? [...m[1].matchAll(/cron:\s*'([^']+)'/g)].map((x) => x[1]) : [];
}
/* a 5-field cron matcher for the subset the workflows use: numbers, *, *\/n, a-b, lists (UTC) */
function fieldMatch(spec, v) {
  return spec.split(',').some((p) => {
    if (p === '*') return true;
    const step = /^\*\/(\d+)$/.exec(p); if (step) return v % Number(step[1]) === 0;
    const rng = /^(\d+)-(\d+)$/.exec(p); if (rng) return v >= Number(rng[1]) && v <= Number(rng[2]);
    return Number(p) === v;
  });
}
function cronMatches(expr, t) {
  const [mi, h, dom, mon, dow] = expr.trim().split(/\s+/); const d = new Date(t);
  return fieldMatch(mi, d.getUTCMinutes()) && fieldMatch(h, d.getUTCHours()) && fieldMatch(dom, d.getUTCDate()) && fieldMatch(mon, d.getUTCMonth() + 1) && fieldMatch(dow, d.getUTCDay());
}
/** the scheduled fire at or before `now` (within 8 days), and the next one after it — UTC, minute precision */
function cronFires(exprs, now) {
  if (!exprs.length) return { previous: null, next: null };
  const start = Math.floor(now / 60e3) * 60e3;
  let previous = null, next = null;
  for (let t = start; t > start - 8 * DAY && !previous; t -= 60e3) if (exprs.some((e) => cronMatches(e, t))) previous = new Date(t).toISOString();
  for (let t = start + 60e3; t < start + 8 * DAY && !next; t += 60e3) if (exprs.some((e) => cronMatches(e, t))) next = new Date(t).toISOString();
  return { previous, next };
}

/* ---------------------------------------------------------------- the state rule */
/**
 * @param {{ scheduled: boolean, runState: string|null, lastGoodAt: string|null, lastCheckAt: string|null, builtAt?: string|null, staleAfterHours: number|null, lagState: string|null, now: number }} x
 *   lagState: CURRENT · EXPECTED_LAG · SOURCE_STALE · null (no documented lag)
 */
function stateOf({ scheduled, runState, lastGoodAt, lastCheckAt, builtAt = null, staleAfterHours, lagState, now }) {
  if (!scheduled) return lastCheckAt || lastGoodAt || builtAt ? { state: 'DATED_BUILD', rule: 'no schedule — a dated build or transcription' } : { state: 'NO_RUN', rule: 'no recorded check' };
  if (!lastCheckAt && !lastGoodAt) return { state: 'NO_RUN', rule: 'no recorded check' };
  if (runState === 'REFUSED') return { state: 'REFUSED', rule: 'the latest check was refused' };
  if (runState === 'FAILED' || runState === 'SCHEMA_CHANGED') return { state: 'FAILING', rule: `the latest check is ${runState}` };
  if (staleAfterHours && (!lastGoodAt || now - FRESH.ts(lastGoodAt) > staleAfterHours * HOUR)) return { state: 'CHECK_STALE', rule: `last good check older than ${staleAfterHours} h` };
  if (lagState === 'SOURCE_STALE') return { state: 'SOURCE_STALE', rule: 'the source content is older than its documented lag' };
  if (lagState === 'EXPECTED_LAG') return { state: 'EXPECTED_LAG', rule: 'a newer period is due and its window is open' };
  return { state: 'CURRENT', rule: lagState ? 'checked on schedule; newest period its documented lag allows' : 'checked on schedule; the source documents no lag' };
}

/* ---------------------------------------------------------------- documented-lag rules */
/** CBS price indices — ASSUMPTION (not an official calendar): a monthly index appears about the 15th of the month after its reference
    month; a two-month window (dwelling-price indices, keyed by the window's first month) about the 15th of the second month after it ends */
function cbsIndexLag(period, kind, today) {
  if (!period) return { state: null, basis: 'no period stored' };
  const latest = monthKey(period.year, period.month);
  const [y, m, d] = today.split('-').map(Number), cur = monthKey(y, m);
  const lagMonths = kind === 'monthly' ? 1 : 3;
  const expected = addMonths(cur, d >= 16 ? -lagMonths : -lagMonths - 1);
  const basis = `ASSUMPTION — ${kind === 'monthly' ? 'a monthly CBS index appears about the 15th of the following month' : 'a two-month CBS window appears about the 15th of the second month after it ends'}; expected latest ${kind === 'monthly' ? 'month' : 'window start'} on ${today}: ${expected}`;
  if (latest >= expected) return { state: 'CURRENT', expected, basis };
  return { state: d < 20 ? 'EXPECTED_LAG' : 'SOURCE_STALE', expected, basis };
}
/** a lane's own freshness block (cbs-sales, construction, finance): CURRENT / EXPECTED_REPORTING_LAG / STALE */
const ownLag = (f) => (!f || !f.state ? { state: null, basis: 'no freshness block' }
  : { state: f.state === 'CURRENT' ? 'CURRENT' : f.state === 'EXPECTED_REPORTING_LAG' ? 'EXPECTED_LAG' : 'SOURCE_STALE', basis: `the lane's own freshness block: ${f.state}${f.nextDueFrom ? ` · next period due from ${f.nextDueFrom}` : ''}${f.staleAfter ? ` · stale after ${f.staleAfter}` : ''}`, nextDueFrom: f.nextDueFrom || null });
/** a transaction copy's age (lib/gov/freshness.js: CURRENT ≤ 7 d · RECENT ≤ 21 · STALE ≤ 45 · VERY STALE > 45 · SOURCE LAG UNKNOWN) */
const copyLag = (st) => (!st ? { state: null, basis: 'no copy date' }
  : { state: FRESH.isStale(st.state) ? 'SOURCE_STALE' : 'CURRENT', basis: `lib/gov/freshness.js copy state ${st.state} (${st.ageDays} days old; CURRENT ≤ 7 · RECENT ≤ 21 · STALE ≤ 45 · VERY STALE > 45)`, copyState: st.state, copyAgeDays: st.ageDays });

/* ---------------------------------------------------------------- the lanes */
/* id = the Trust catalogue's id (lib/trust/catalog.js) where one exists; workflow = the file whose runs check it; staleAfterHours = the
   catalogue's cadence allowance where it states one */
function lanes(ctx) {
  const { dataDir, today, now } = ctx;
  const J = (...p) => readJson(path.join(dataDir, ...p));
  const R = (...p) => readRuns(path.join(dataDir, ...p));
  const market = J('market', 'latest.json') || {}, I = market.indicators || {};
  const cs = J('cbs-sales', 'latest.json'), cc = J('construction', 'latest.json'), fl = J('finance', 'latest.json');
  const land = J('land', 'meta.json'), housing = J('housing', 'meta.json'), renewal = J('renewal', 'meta.json'), renewalPlanning = (J('renewal', 'planning.json') || {}).meta || null;
  const ev = J('streets', 'evidence', 'meta.json'), evRuns = R('streets', 'evidence', 'sync-runs.jsonl');
  const rm = J('streets', 'recent', 'meta.json'), rmRuns = R('streets', 'recent', 'sync-runs.jsonl');
  const nm = J('txevents', 'national', 'meta.json'), nRuns = R('txevents', 'national', 'runs.jsonl');
  const monitor = J('transactions', 'freshness.json'), frRuns = R('transactions', 'freshness-runs.jsonl');
  const cp = J('txevents', 'completeness.json'), latest = J('txevents', 'latest.json');
  const plans = J('planning', 'national', 'meta.json'), geo = J('geo', 'street-geo', 'meta.json');
  const streets = J('geo', 'streets', 'meta.json'), geoReg = J('geo', 'registry-meta.json'), model = J('streets', 'model', 'model.json');
  const dd = J('dd', 'latest.json'), ddRuns = R('dd', 'sync-runs.jsonl');
  const refMeta = (dir, id) => J(dir, id, 'meta.json');
  const nChecks = nRuns.filter((r) => r.kind === 'check' && r.status !== 'FAILED');
  const regVersion = [...nChecks].reverse().find((r) => r.register) || null, gmVersion = [...nChecks].reverse().find((r) => r.govmap) || null;
  const evState = ev && ev.source ? FRESH.evidenceFreshness({ meta: ev, runs: evRuns, monitor, today }) : null;
  const rmChecked = rmRuns.filter((r) => Number(r.requests) > 0 && (r.status === 'ok' || r.status === 'unchanged')).map(runAt).filter(Boolean).sort().pop() || null;
  const rmState = rm && rm.source ? FRESH.stateOf({ snapshotAt: rm.source.loadedAt, checkedAt: rmChecked, today }) : null;
  const nmState = nm && nm.version ? FRESH.stateOf({ snapshotAt: nm.version.detectedAt, checkedAt: nChecks.map((r) => r.at).sort().pop() || null, today }) : null;
  const ind = (k, kind) => ({ id: `cbs:${k}`, label: `CBS ${k}`, workflow: 'market-sync.yml', staleAfterHours: 50, evidence: ['data/market/latest.json'],
    latestObservation: I[k] && I[k].period ? { value: monthKey(I[k].period.year, I[k].period.month), kind: kind === 'monthly' ? 'latest index month' : 'latest two-month window (first month)' } : null,
    publication: { value: null, kind: 'not stored — the CBS index API is read for the period, not its release date' },
    ingestion: { value: I[k] ? I[k].checkedAt || null : null, kind: 'the snapshot read (market-sync rewrites the indicator each run)' },
    lag: cbsIndexLag(I[k] && I[k].period, kind, today) });
  const boi = I.boiRate || null;
  const boiLag = !boi ? { state: null, basis: 'no snapshot' } : boi.nextDecision && boi.nextDecision <= today
    ? { state: day(boi.checkedAt) <= boi.nextDecision && (FRESH.daysBetween(boi.nextDecision, today) || 0) <= 2 ? 'EXPECTED_LAG' : 'SOURCE_STALE',
      basis: `the snapshot names the next rate decision ${boi.nextDecision}; read ${iso(boi.checkedAt)} — a decision on or before today is read by the next daily sync (the snapshot keeps the value it read)` }
    : { state: 'CURRENT', basis: `next rate decision ${boi.nextDecision || 'not stated'}` };
  const reference = (dir, id, trustId, workflow, staleAfterHours, kind) => { const m = refMeta(dir, id); return {
    id: trustId, label: `${dir}/${id}`, workflow, staleAfterHours, evidence: [`data/${dir}/${id}/meta.json`, `data/${dir}/${id}/runs.jsonl`],
    latestObservation: m ? { value: kind === 'census' ? '2022' : m.sourceUpdatedAt || null, kind: kind === 'census' ? 'the census observation (one, 2022)' : 'the resource\'s content date (data.gov.il last_modified)' } : null,
    publication: m ? { value: m.sourceUpdatedAt || null, kind: 'data.gov.il resource last_modified' } : null,
    ingestion: m ? { value: m.readAt || null, kind: 'the last content read (meta.readAt)' } : null,
    lag: { state: null, basis: 'the publisher states a cadence, not a calendar — no lag rule' } }; };
  const ddLane = (catId, lane, key) => ({ id: catId, label: `dd:${lane}`, workflow: 'dd-sync.yml', staleAfterHours: 100, evidence: ['data/dd/latest.json', 'data/dd/sync-runs.jsonl'],
    latestObservation: key ? { value: key, kind: 'the source\'s own last modification / import' } : null, publication: key ? { value: key, kind: 'catalogue last_modified / GIS date_import' } : null,
    ingestion: { value: [...ddRuns].reverse().map((r) => (r.lanes && r.lanes[lane] === 'SUCCESS' ? r.at : null)).find(Boolean) || null, kind: 'the last run that read new content for the lane' },
    lag: { state: null, basis: 'nightly source; no lag rule' } });
  const L = [
    /* ── transactions ── */
    { id: 'over:street-evidence', label: 'Tax Authority register — republished copy (over.org.il), the street evidence sweep', vertical: 'transactions', workflow: 'street-evidence-sync.yml', staleAfterHours: 60,
      evidence: ['data/streets/evidence/meta.json', 'data/streets/evidence/sync-runs.jsonl', 'data/transactions/freshness.json'],
      latestObservation: ev && ev.source ? { value: ev.source.lastDeal, kind: 'the copy\'s latest deal date' } : null,
      publication: { value: regVersion && regVersion.register ? regVersion.register.detectedAt : null, kind: `the republisher's dataset version ${regVersion && regVersion.register ? 'v' + regVersion.register.n + ' ' : ''}detected (over.org.il); the copy's own scrape: ${ev && ev.source ? ev.source.scrapedAt : '—'}; the Tax Authority states no publication date` },
      ingestion: { value: ev && ev.sweep ? ev.sweep.updatedAt : null, kind: `the COMPLETE sweep (${ev && ev.sweep ? ev.sweep.done + '/' + ev.sweep.of : '—'} localities)` },
      lag: copyLag(evState) },
    { id: 'over:govmap-recent', label: 'GovMap deals layer — republished copy, recent window (lib/recent)', vertical: 'transactions', workflow: 'street-recent-sync.yml', staleAfterHours: 50,
      evidence: ['data/streets/recent/meta.json', 'data/streets/recent/sync-runs.jsonl'],
      latestObservation: rm && rm.source ? { value: rm.source.lastDeal, kind: `the copy's latest deal (shown recent-only deals to ${rm.shown ? rm.shown.latest : '—'})` } : null,
      publication: { value: rm && rm.source ? (gmVersion && gmVersion.govmap ? gmVersion.govmap.detectedAt : rm.source.loadedAt) : null, kind: `the republisher's dataset version ${rm && rm.source ? 'v' + rm.source.version : ''} detected; the copy's load: ${rm && rm.source ? rm.source.loadedAt : '—'}` },
      ingestion: { value: rm && rm.source && rm.source.snapshot ? rm.source.snapshot.fetchedAt : null, kind: 'the window read (verbatim snapshot)' },
      lag: copyLag(rmState) },
    { id: 'over:govmap-national', label: 'GovMap deals layer — the whole published file (national missed-deal detector)', vertical: 'transactions', workflow: 'txevents-national.yml', staleAfterHours: 24, githubCheck: true,
      evidence: ['data/txevents/national/meta.json', 'data/txevents/national/runs.jsonl'],
      latestObservation: nm && nm.file ? { value: latestNonFuture(latest), kind: `the latest file row the union shows (the file's own max ${nm.file.dates ? nm.file.dates.max : '—'} includes future-dated rows, INVALID)` } : null,
      publication: { value: nm && nm.version ? nm.version.detectedAt : null, kind: `the republisher's dataset version ${nm && nm.version ? 'v' + nm.version.n : ''} detected` },
      ingestion: { value: nm ? nm.builtAt : null, kind: 'the national build' },
      lag: copyLag(nmState) },
    { id: 'propx:tx-freshness', label: 'the transaction freshness monitor (five read-only requests)', vertical: 'transactions', workflow: 'tx-freshness.yml', staleAfterHours: 30,
      evidence: ['data/transactions/freshness.json', 'data/transactions/freshness-runs.jsonl'],
      latestObservation: monitor ? { value: monitor.propx && monitor.propx.copyLatestDeal, kind: 'the stored copy\'s latest deal' } : null,
      publication: monitor ? { value: monitor.register && monitor.register.snapshotAt, kind: 'the register copy the republisher serves now (its scrape date)' } : null,
      ingestion: { value: null, kind: 'a monitor stores no deal' },
      lag: { state: null, basis: monitor && monitor.freshness ? `a monitor — it REPORTS the copy's state (${monitor.freshness.state}, ${monitor.freshness.ageDays} days; see over:street-evidence), its own freshness is its check` : 'no monitor output' } },
    { id: 'propx:transaction-events', label: 'the transaction events union (lib/txevents)', vertical: 'transactions', workflow: null, rebuiltBy: 'street-evidence-sync.yml · street-recent-sync.yml · txevents-national.yml', staleAfterHours: null,
      evidence: ['data/txevents/completeness.json', 'data/txevents/latest.json'],
      latestObservation: cp ? { value: cp.latestEvent, kind: 'the newest counted event of any source' } : null,
      publication: { value: null, kind: 'a PROPX derivation — the sources\' dates are on their own rows' },
      ingestion: { value: cp ? cp.builtAt : null, kind: 'the union build' }, lag: { state: null, basis: 'derived — as fresh as its sources' }, derived: true },
    { id: 'govmap:tax-authority-deals', label: 'Tax Authority deals via GovMap (official channel)', vertical: 'transactions', workflow: 'data-sync.yml', staleAfterHours: 50,
      evidence: ['data/transactions/sync-runs.jsonl'], latestObservation: null, publication: { value: null, kind: 'never answered' }, ingestion: { value: null, kind: 'never served a deal' },
      lag: { state: null, basis: 'refuses the runner' } },
    { id: 'propx:street-model', label: 'PROPX street value model (MODEL)', vertical: 'derived', workflow: null, rebuiltBy: 'street-evidence-sync.yml (--if-stale)', staleAfterHours: null,
      evidence: ['data/streets/model/model.json'], latestObservation: model ? { value: model.asOf, kind: 'the evidence date it is anchored to' } : null,
      publication: { value: null, kind: 'a PROPX model' }, ingestion: { value: model ? model.builtAt : null, kind: 'the model build' }, lag: { state: null, basis: 'rebuilt only when its inputs change' }, derived: true },
    /* ── official series ── */
    { id: 'cbs:new-home-sales', label: 'CBS new-home sales + inventory (+ the whole market since 21.10.2026)', vertical: 'market', workflow: 'cbs-sales-sync.yml', staleAfterHours: 100,
      evidence: ['data/cbs-sales/latest.json', 'data/cbs-sales/runs.jsonl'],
      latestObservation: cs && cs.geos && cs.geos.il ? { value: cs.geos.il.metrics.latest, kind: `latest published month (inventory ${cs.inventory && cs.inventory.latest ? cs.inventory.latest.period : '—'})` } : null,
      publication: { value: cs ? cs.sourceUpdate : null, kind: 'CBS series update date' }, ingestion: { value: lastIngest(R('cbs-sales', 'runs.jsonl')), kind: 'the last run that added / revised observations' },
      lag: ownLag(cs && cs.freshness) },
    { id: 'cbs:construction', label: 'CBS construction — permits · starts · completions · active', vertical: 'market', workflow: 'construction-sync.yml', staleAfterHours: 100,
      evidence: ['data/construction/latest.json', 'data/construction/sync-runs.jsonl'],
      latestObservation: cc && cc.freshness ? { value: `${cc.freshness.latest} (quarter ${cc.freshness.latestQuarter})`, kind: 'latest published month / quarter' } : null,
      publication: { value: cc ? cc.sourceUpdate : null, kind: 'CBS series update date' }, ingestion: { value: lastIngest(R('construction', 'sync-runs.jsonl')), kind: 'the last run that added / revised observations' },
      lag: ownLag(cc && cc.freshness) },
    ind('newHomesIndex', 'bimonthly'), ind('dwellingsIndex', 'bimonthly'), ind('dwellingsByDistrict', 'bimonthly'), ind('cpi', 'monthly'), ind('rentIndex', 'monthly'), ind('constructionInputsIndex', 'monthly'),
    { id: 'boi:policy-rate', label: 'Bank of Israel policy rate', vertical: 'market', workflow: 'market-sync.yml', staleAfterHours: 50, evidence: ['data/market/latest.json'],
      latestObservation: boi ? { value: `${boi.value}%`, kind: 'the rate in force when read' } : null, publication: boi ? { value: boi.publishedAt || null, kind: 'publishedAt as served by the Bank of Israel API' } : null,
      ingestion: { value: boi ? boi.checkedAt : null, kind: 'the snapshot read' }, lag: boiLag },
    { id: 'boi:housing-finance', label: 'Bank of Israel housing finance (SDMX)', vertical: 'market', workflow: 'finance-sync.yml', staleAfterHours: 100, evidence: ['data/finance/latest.json', 'data/finance/sync-runs.jsonl'],
      latestObservation: fl && fl.freshness ? { value: fl.freshness.latestPeriod, kind: 'the latest month of new housing loans' } : null,
      publication: { value: null, kind: 'the service states no publication date' }, ingestion: { value: lastIngest(R('finance', 'sync-runs.jsonl')), kind: 'the last run that added observations' },
      lag: ownLag(fl && fl.freshness) },
    { id: 'cbs:average-dwelling-price', label: 'CBS Table 2.2 average dwelling prices (transcribed into index.html PRICE_SRC / PRICE_BASIS)', vertical: 'market', workflow: null, staleAfterHours: null,
      evidence: ['index.html (PRICE_SRC · PRICE_BASIS, read only)', 'lib/trust/catalog.js cbs:average-dwelling-price'], transcribed: priceSrc(ctx),
      latestObservation: { value: (priceSrc(ctx) || {}).period || null, kind: 'the quarter transcribed (provisional)' }, publication: { value: (priceSrc(ctx) || {}).edition || null, kind: 'the CBS edition read' },
      ingestion: { value: (priceSrc(ctx) || {}).transcribed || null, kind: 'transcribed by hand' },
      lag: { state: null, basis: 'ASSUMPTION — a quarter\'s average prices appear with the price-statistics release about 6–7 weeks after the quarter; Q3 2026 is not expected before mid-November 2026 — check by hand' } },
    /* ── land, housing, renewal, rental ── */
    { id: 'rmi:michrazim', label: 'Israel Land Authority tenders', vertical: 'land', workflow: 'land-sync.yml', staleAfterHours: 50, evidence: ['data/land/meta.json', 'data/land/sync-runs.jsonl'],
      latestObservation: land && land.coverage ? { value: land.coverage.publishedTo, kind: `latest tender publication (committee decisions to ${land.coverage.committeeTo})` } : null,
      publication: { value: null, kind: `the list states no publication date; list content last changed (PROPX observed) ${land ? land.snapshotFetchedAt : '—'}` },
      ingestion: { value: land ? land.snapshotFetchedAt : null, kind: `list content last changed · detail ${land && land.detailCoverage ? land.detailCoverage.retrieved + '/' + land.detailCoverage.listed : '—'}` },
      lag: { state: null, basis: 'daily source; PARTIAL = the daily detail request cap (detail coverage stated)' } },
    { id: 'datagov:moch:dira-behanacha-lotteries', label: 'MoCH subsidized-housing lotteries', vertical: 'housing', workflow: 'data-sync.yml', staleAfterHours: 50, evidence: ['data/housing/meta.json', 'data/housing/sync-runs.jsonl'],
      latestObservation: housing && housing.coverage ? { value: housing.coverage.lotteryDateTo, kind: 'latest lottery date in the source' } : null,
      publication: { value: housing ? housing.sourceUpdatedAt : null, kind: 'data.gov.il resource last_modified' }, ingestion: { value: lastIngest(R('housing', 'sync-runs.jsonl')), kind: 'the last run that stored new content' },
      lag: housing && housing.coverage ? (ageDays(housing.coverage.lotteryDateTo, now) > 365
        ? { state: 'SOURCE_STALE', basis: `documented (Trust catalogue): the resource lags — its newest lottery ${housing.coverage.lotteryDateTo} is ${ageDays(housing.coverage.lotteryDateTo, now)} days old although the resource was modified ${day(housing.sourceUpdatedAt)}` }
        : { state: 'CURRENT', basis: 'newest lottery within 365 days' }) : { state: null, basis: 'no meta' } },
    { id: 'datagov:moch:urban-renewal-complexes', label: 'MoCH urban-renewal complexes', vertical: 'renewal', workflow: 'renewal-sync.yml', staleAfterHours: 50, evidence: ['data/renewal/meta.json', 'data/renewal/sync-runs.jsonl'],
      latestObservation: renewal && renewal.coverage ? { value: renewal.coverage.declarationTo, kind: 'latest declaration date' } : null,
      publication: { value: renewal ? renewal.sourceUpdatedAt : null, kind: 'data.gov.il resource last_modified' }, ingestion: { value: lastIngest(R('renewal', 'sync-runs.jsonl')), kind: 'the last run that stored new content' },
      lag: { state: null, basis: 'the publisher states no cadence' } },
    { id: 'iplan:xplan:renewal', label: 'XPlan join of the renewal complexes', vertical: 'renewal', workflow: 'renewal-sync.yml', staleAfterHours: 50, evidence: ['data/renewal/planning.json', 'data/renewal/planning-runs.jsonl'],
      latestObservation: renewalPlanning ? { value: renewalPlanning.checkedAt, kind: 'the last read of the layer (a continuous source)' } : null, publication: { value: null, kind: 'the layer states no publication date' },
      ingestion: { value: lastIngest(R('renewal', 'planning-runs.jsonl')), kind: 'the last run that stored new content' }, lag: { state: null, basis: 'continuous source' } },
    { id: 'dira-lehaskir:tenders', label: 'Dira Lehaskir rental notices', vertical: 'land', workflow: 'rental-sync.yml', staleAfterHours: 100, evidence: ['data/rental/dira-tenders.json', 'data/rental/runs.jsonl'],
      latestObservation: null, publication: null, ingestion: { value: lastIngest(R('rental', 'runs.jsonl')), kind: 'the last run that stored new content' }, lag: { state: null, basis: 'as the company publishes' }, fromCatalog: true },
    /* ── planning, geography, context ── */
    { id: 'iplan:vatmal', label: 'VATMAL declared complexes', vertical: 'planning', workflow: 'vatmal-sync.yml', staleAfterHours: 24 * 9, evidence: ['data/planning/vatmal/meta.json', 'data/planning/vatmal/runs.jsonl'],
      latestObservation: null, publication: { value: null, kind: 'the layer states no publication date' }, ingestion: { value: (J('planning', 'vatmal', 'meta.json') || {}).readAt || null, kind: 'the last content read' },
      lag: { state: null, basis: 'as the Committee declares' }, fromCatalog: true },
    { id: 'propx:plan-boundaries', label: 'every Xplan plan boundary (street report)', vertical: 'planning', workflow: 'street-planning-sync.yml', staleAfterHours: null, evidence: ['data/planning/national/meta.json'],
      latestObservation: plans ? { value: plans.fetchedAt, kind: `the read of the layer (${plans.stored}/${plans.layerCount} plans, complete ${plans.complete})` } : null,
      publication: { value: null, kind: 'the layer states no publication date' }, ingestion: { value: plans ? plans.fetchedAt : null, kind: 'the build' },
      lag: { state: null, basis: 'no schedule: plan statuses change continuously, the stored boundaries / stages are as of the build' } },
    { id: 'propx:street-geo', label: 'street points from the GovMap-layer file (street report)', vertical: 'geo', workflow: 'street-geo-build.yml', staleAfterHours: null, evidence: ['data/geo/street-geo/meta.json'],
      latestObservation: geo ? { value: geo.builtAt, kind: `built from the file ${geo.file ? String(geo.file.sha256).slice(0, 12) : '—'}` } : null,
      publication: { value: nm && nm.version ? nm.version.detectedAt : null, kind: 'the GovMap-layer dataset version the file belongs to' }, ingestion: { value: geo ? geo.builtAt : null, kind: 'the build' },
      lag: { state: null, basis: 'no schedule: rebuilt by hand / on a push of the build script' } },
    { id: 'datagov:streets', label: 'the official street directory + synonyms', vertical: 'geo', workflow: 'street-sync.yml', staleAfterHours: 8 * 24 + 12, evidence: ['data/geo/streets/meta.json', 'data/geo/streets/sync-runs.jsonl'],
      latestObservation: streets && streets.sources ? { value: day(streets.sources.streets.lastModified), kind: 'the registry\'s last modification' } : null,
      publication: { value: streets && streets.sources ? streets.sources.streets.lastModified : null, kind: 'data.gov.il last_modified' },
      ingestion: { value: lastIngest(R('geo', 'streets', 'sync-runs.jsonl')), kind: 'the last run that stored new content' }, lag: { state: null, basis: 'republished daily; read weekly' } },
    { id: 'datagov:geo-registry', label: 'the locality registry (dated build)', vertical: 'geo', workflow: null, staleAfterHours: null, evidence: ['data/geo/registry-meta.json'],
      latestObservation: geoReg ? { value: geoReg.builtAt, kind: 'registry built' } : null, publication: { value: null, kind: 'mirror snapshots' }, ingestion: { value: geoReg ? geoReg.builtAt : null, kind: 'the build' },
      lag: { state: null, basis: 'rebuilt on demand (scripts/build-geo-registry.py)' } },
    reference('reference', 'census-2022', 'datagov:cbs:census-2022', 'reference-sync.yml', 24 * 40, 'census'),
    reference('reference', 'residents', 'datagov:piba:residents-by-locality', 'reference-sync.yml', 24 * 9),
    reference('transport', 'bus-stops', 'datagov:mot:bus-stops', 'transport-sync.yml', 24 * 9),
    reference('transport', 'lrt', 'datagov:mot:lrt-stations', 'transport-sync.yml', 24 * 9),
    reference('transport', 'rail', 'datagov:mot:rail-stations', 'transport-sync.yml', 24 * 9),
    reference('transport', 'metro', 'datagov:mot:metro-stations', 'transport-sync.yml', 24 * 9),
    reference('surroundings', 'contaminated', 'datagov:moep:contaminated-land', 'surroundings-sync.yml', 24 * 9),
    reference('surroundings', 'edu-points', 'datagov:moe:institution-coordinates', 'surroundings-sync.yml', 24 * 9),
    reference('surroundings', 'edu-info', 'datagov:moe:institutions', 'surroundings-sync.yml', 24 * 9),
    /* ── land joins classified stale by their own source registry ── */
    { id: 'datagov:rmi:planning-inventory', label: 'ILA planning inventory (state land, 2022)', vertical: 'planning', workflow: 'land-sync.yml', staleAfterHours: 50, evidence: ['lib/land/sources.js', 'data/land/meta.json'],
      latestObservation: null, publication: null, ingestion: null, lag: { state: 'SOURCE_STALE', basis: 'classified STALE in lib/land/sources.js (the publisher\'s inventory dates from 2022)' }, fromCatalog: true },
    { id: 'datagov:moch:construction-progress', label: 'MoCH construction progress (by block / parcel)', vertical: 'construction', workflow: 'land-sync.yml', staleAfterHours: 50, evidence: ['lib/land/sources.js', 'data/land/meta.json'],
      latestObservation: null, publication: null, ingestion: null, lag: { state: 'SOURCE_STALE', basis: 'classified STALE in lib/land/sources.js (content as of 2024-03)' }, fromCatalog: true },
    /* ── due diligence ── */
    ...(dd ? [ddLane('datagov:ica:companies', 'companies', dd.companies && dd.companies.sourceModified), ddLane('datagov:ica:changes', 'filings', dd.filings && dd.filings.window && dd.filings.window.to),
      ddLane('datagov:ica:partnerships', 'partnerships', dd.partnerships && dd.partnerships.sourceModified), ddLane('datagov:ica:designated-strike-off', 'strikeoff', dd.strikeOff && dd.strikeOff.sourceModified),
      ddLane('datagov:moj:official-receiver:liquidation', 'insolvency', dd.insolvency && dd.insolvency.liquidation && dd.insolvency.liquidation.sourceModified),
      ddLane('datagov:moch:contractors-register', 'contractors', dd.contractors && dd.contractors.sourceModified), ddLane('datagov:labor:active-construction-sites', 'sites', dd.sites && dd.sites.sourceModified),
      ddLane('tlv:iview2:permits-772', 'tlv', dd.tlv && dd.tlv.permits && dd.tlv.permits.imported)] : []),
  ];
  return L;
}
/* the newest GovMap-file row the union shows (data/txevents/latest.json per locality) — the file's own max date includes future-dated rows */
function latestNonFuture(latest) {
  if (!latest || !latest.localities) return null;
  return Object.values(latest.localities).map((x) => x.govmapNational).filter(Boolean).sort().pop() || null;
}
/* Table 2.2 as transcribed in index.html (PRICE_SRC) — read only */
function priceSrc(ctx) {
  if (ctx._priceSrc !== undefined) return ctx._priceSrc;
  let html = ''; try { html = fs.readFileSync(path.join(ctx.root, 'index.html'), 'utf8'); } catch { /* none */ }
  const m = /const PRICE_SRC=\{([^}]*)\}/.exec(html);
  const get = (k) => { const x = m && new RegExp(`${k}:"([^"]*)"`).exec(m[1]); return x ? x[1] : null; };
  ctx._priceSrc = m ? { table: get('table'), period: get('period'), edition: get('edition'), transcribed: get('transcribed') } : null;
  return ctx._priceSrc;
}

/* ---------------------------------------------------------------- GitHub run evidence (optional) */
/** github = { workflows: { '<file>': { production: { lastSuccess: {id, at, event}, lastFailure: {id, at, event, conclusion}, latest: {…} }, … } } } */
const ghOf = (github, file) => (github && github.workflows && file ? github.workflows[file] || null : null);

/* ---------------------------------------------------------------- the transactions block */
function transactions(ctx) {
  const { dataDir, today } = ctx;
  const J = (...p) => readJson(path.join(dataDir, ...p));
  const ev = J('streets', 'evidence', 'meta.json'), rm = J('streets', 'recent', 'meta.json'), nm = J('txevents', 'national', 'meta.json');
  const monitor = J('transactions', 'freshness.json'), cp = J('txevents', 'completeness.json'), latest = J('txevents', 'latest.json');
  const cov = J('txevents', 'coverage-audit.json'), ca = J('txevents', 'completeness-audit.json'), geo = J('geo', 'street-geo', 'meta.json');
  const nRuns = readRuns(path.join(dataDir, 'txevents', 'national', 'runs.jsonl'));
  const lastNatCheck = [...nRuns].reverse().find((r) => r.kind === 'check' && r.status !== 'FAILED') || null;
  const residents = readGzJson(path.join(dataDir, 'reference', 'residents', 'rows.json.gz'));
  const top = Array.isArray(residents) ? residents.filter((r) => r.level === 'locality').sort((a, b) => b.residents - a.residents || a.locality - b.locality).slice(0, 10) : [];
  const unplaced = J('txevents', 'national', 'unplaced.json'), invalid = J('txevents', 'national', 'invalid.json');
  const count = (x) => (x == null ? null : Array.isArray(x) ? x.length : Array.isArray(x.rows) ? x.rows.length : typeof x.count === 'number' ? x.count : null);
  return {
    contract: ['transaction date (latestDeal)', 'source copy (snapshot / load)', 'republisher dataset version detected (publication of the copy)', 'PROPX ingestion (sweep / read)', 'PROPX check'],
    register: ev && ev.source ? {
      source: 'over:deals-register (the Tax Authority register as republished by over.org.il — not a government channel)',
      latestDeal: ev.source.lastDeal, copy: ev.source.scrapedAt, version: lastNatCheck && lastNatCheck.register ? { n: lastNatCheck.register.n, detectedAt: lastNatCheck.register.detectedAt } : null,
      window: ev.window, ingestion: ev.sweep ? { status: ev.sweep.status, completedAt: ev.sweep.updatedAt, localities: `${ev.sweep.done}/${ev.sweep.of}` } : null,
      lastCheck: monitor ? monitor.checkedAt : null, state: monitor && monitor.freshness ? { state: monitor.freshness.state, ageDays: monitor.freshness.ageDays } : null,
      fill: monitor && monitor.propx ? monitor.propx.lastSixMonths : null,
      note: 'deals reach the register weeks to months after signing: the copy of 19.09.2026 held ≈ 41 % of July and ≈ 13 % of August 2026 (lib/gov/freshness.js BASIS) — a latest deal is not a complete month',
    } : null,
    recent: rm && rm.source ? {
      source: 'over:govmap-recent (the GovMap deals layer as republished by over.org.il — not a government channel)',
      latestDeal: rm.source.lastDeal, latestShown: rm.shown ? rm.shown.latest : null, copy: rm.source.loadedAt, version: rm.source.version,
      window: rm.window, ingestion: rm.source.snapshot ? rm.source.snapshot.fetchedAt : null,
      reconciledAgainst: rm.register ? rm.register.scrapedAt : null, reconciledAgainstCurrentRegister: !!(rm.register && ev && ev.source && rm.register.scrapedAt === ev.source.scrapedAt),
      shown: rm.shown ? { rows: rm.shown.rows, kinds: rm.shown.kinds } : null,
      note: 'shown apart, never priced: the copy states no ownership share (VERIFIED 0)',
    } : null,
    national: nm ? { version: nm.version ? { n: nm.version.n, detectedAt: nm.version.detectedAt } : null, builtAt: nm.builtAt, fileMaxDate: nm.file && nm.file.dates ? nm.file.dates.max : null,
      latestShown: latestNonFuture(latest), lastCheck: lastNatCheck ? lastNatCheck.at : null, lastCheckStatus: lastNatCheck ? lastNatCheck.status : null } : null,
    union: latest ? {
      latestEvent: latest.national ? latest.national.latest : cp ? cp.latestEvent : null, builtAt: latest.builtAt,
      districts: Object.fromEntries(Object.entries(latest.districts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { latest: v.latest, events: v.events }])),
      largestLocalities: top.map((r) => { const x = (latest.localities || {})[String(r.locality)] || {}; return { code: r.locality, name: r.name, residents: r.residents, union: x.latest || null, register: x.register || null, govmapRecent: x.govmapRecent || null, govmapNational: x.govmapNational || null }; }),
      basis: 'the ten localities with the most registered residents (data/reference/residents, the population register)',
    } : null,
    monitor: monitor ? { checkedAt: monitor.checkedAt, state: monitor.freshness ? monitor.freshness.state : null, alerts: (monitor.alerts || []).map((a) => a.kind),
      newerCopies: (monitor.newerCopies || []).map((c) => ({ id: c.id, snapshotAt: c.snapshotAt, latestTransactionDate: c.latestTransactionDate, readByPropx: !!c.readByPropx })),
      official: (monitor.officialChannels || []).map((o) => ({ id: o.id, status: o.status, answered: !!o.answered, refused: !!o.refused, antiBot: o.antiBot || null })) } : null,
    actions: newerCopyActions({ evidenceMeta: ev, recentMeta: rm, monitor, nationalMeta: nm, nationalLastCheck: lastNatCheck, streetGeoMeta: geo, streetGeoKeys: streetGeoKeyCheck(dataDir) }),
    integrity: {
      recentClasses: rm ? rm.classes : null,
      recentPromotion: rm && rm.promotion ? rm.promotion.byState : null,
      recentConfirmed: rm && rm.lifecycle ? rm.lifecycle.confirmed : null,
      registerCounts: ev ? ev.counts : null,
      unionUnexplained: cp && cp.notSurfaced ? cp.notSurfaced.unexplained : null,
      unionPossibleDuplicates: cp ? cp.possibleDuplicates : null, unionUnresolved: cp ? cp.unresolved : null,
      completenessNotSurfaced: ca ? ca.defensibleKnownSourceEventsNotSurfaced : null, completenessBuiltAt: ca ? ca.builtAt : null,
      coverageAudit: cov && cov.national ? { builtAt: cov.builtAt, missed: cov.national.missed, folded: cov.national.folded === undefined ? null : cov.national.folded,
        note: cov.national.folded === undefined && cov.national.missed ? 'built before the fold accounting (22.10.2026): rows folded into a register event were counted as missed — see scripts/txevents-audit.js' : null } : null,
      nationalUnplaced: count(unplaced), nationalInvalid: count(invalid),
      futureDated: rm && rm.classes ? rm.classes.FUTURE_DATED || 0 : null,
    },
  };
}

/** a NEWER copy than the one PROPX holds, or a build that does not match its input → the workflow that ingests it (pure) */
function newerCopyActions({ evidenceMeta, recentMeta, monitor, nationalMeta, nationalLastCheck, streetGeoMeta, streetGeoKeys }) {
  const out = [];
  const t = (v) => FRESH.ts(v);
  const regHeld = evidenceMeta && evidenceMeta.source ? evidenceMeta.source.scrapedAt : null;
  const regServed = monitor && monitor.register ? monitor.register.snapshotAt : null;
  if (regHeld && regServed && t(regServed) > t(regHeld) + HOUR) out.push({ kind: 'NEW_COPY_NOT_SWEPT', source: 'over:deals-register', held: regHeld, served: regServed, workflow: 'street-evidence-sync.yml', why: 'the republisher serves a newer register copy than the one PROPX swept — the sweep ingests it (and reconciles the recent layer and rebuilds the union)' });
  if (nationalLastCheck && nationalLastCheck.registerChanged && !out.some((a) => a.kind === 'NEW_COPY_NOT_SWEPT')) out.push({ kind: 'NEW_COPY_NOT_SWEPT', source: 'over:deals-register', held: regHeld, served: nationalLastCheck.register && nationalLastCheck.register.detectedAt, workflow: 'street-evidence-sync.yml', why: 'the version check saw a newer register dataset version than the swept copy' });
  const gmHeld = recentMeta && recentMeta.source ? recentMeta.source.loadedAt : null;
  const gmServed = monitor && monitor.govmapLayer ? monitor.govmapLayer.snapshotAt : null;
  if (gmHeld && gmServed && t(gmServed) > t(gmHeld) + HOUR) out.push({ kind: 'NEW_COPY_NOT_READ', source: 'over:govmap-recent', held: gmHeld, served: gmServed, workflow: 'street-recent-sync.yml', why: 'the republisher serves a newer GovMap-layer copy than the recent layer read' });
  if (nationalMeta && nationalMeta.version && nationalLastCheck && nationalLastCheck.govmap && nationalLastCheck.govmap.id !== nationalMeta.version.id) out.push({ kind: 'NEW_VERSION_NOT_BUILT', source: 'over:govmap-national', held: nationalMeta.version.n, served: nationalLastCheck.govmap.n, workflow: 'txevents-national.yml', inputs: { force: true }, why: 'the version check saw a GovMap-layer version the national build has not read' });
  if (recentMeta && recentMeta.register && regHeld && recentMeta.register.scrapedAt !== regHeld) out.push({ kind: 'RECENT_NOT_RECONCILED', source: 'over:govmap-recent', held: recentMeta.register.scrapedAt, served: regHeld, workflow: 'street-recent-sync.yml', why: 'the recent layer was reconciled against another register copy — it shows nothing until reconciled (lib/recent/read.js gate)' });
  if (streetGeoMeta && streetGeoMeta.file && nationalMeta && nationalMeta.file && streetGeoMeta.file.sha256 !== nationalMeta.file.sha256) out.push({ kind: 'STREET_GEO_OLDER_FILE', source: 'propx:street-geo', held: String(streetGeoMeta.file.sha256).slice(0, 12), served: String(nationalMeta.file.sha256).slice(0, 12), workflow: 'street-geo-build.yml', why: 'the street points were built from another GovMap-layer file than the national build reads' });
  if (streetGeoKeys && streetGeoKeys.undecoded > 0) out.push({ kind: 'STREET_GEO_OLDER_SCRIPT', source: 'propx:street-geo', held: `${streetGeoKeys.undecoded} source-neighbourhood street keys in the layer's raw form (locality × 10,000 + code) in ${streetGeoKeys.files} locality files`, served: 'scripts/street-geo-build.py decodes them (4d7adb2, 21.10.2026)', workflow: 'street-geo-build.yml', why: 'the stored build predates the current build script (the run for 4d7adb2 lost its push to a rebase conflict — GitHub run 39560045045); no reader uses the field today' });
  return out;
}
/** data/geo/street-geo: source-neighbourhood street keys still in the layer's raw form (≥ 10,000) — the build predates 4d7adb2 */
function streetGeoKeyCheck(dataDir) {
  const dir = path.join(dataDir, 'geo', 'street-geo', 'loc');
  let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.json\.gz$/.test(f)).sort(); } catch { return null; }
  let undecoded = 0, withUndecoded = 0, keys = 0;
  for (const f of files) {
    const j = readGzJson(path.join(dir, f)); if (!j || !j.nb) continue;
    let hit = false;
    for (const n of Object.values(j.nb)) for (const [k] of n.streets || []) { keys++; if (Number(k) >= 10000) { undecoded++; hit = true; } }
    if (hit) withUndecoded++;
  }
  return { files: withUndecoded, of: files.length, keys, undecoded };
}

/* ---------------------------------------------------------------- the audit */
/**
 * @param {{ dataDir?: string, root?: string, now?: number, github?: object, workflowsDir?: string }} opt
 */
function audit({ dataDir = DATA, root = ROOT, now = Date.now(), github = null, workflowsDir = WORKFLOWS } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const ctx = { dataDir, root, today, now };
  const cat = CAT.catalog({ dataDir, now });
  const byId = new Map(cat.sources.map((s) => [s.id, s]));
  const entries = [];
  for (const l of lanes(ctx)) {
    const c = byId.get(l.id) || null;
    const sync = c && c.sync ? c.sync : null;
    const crons = l.workflow ? cronOf(l.workflow, workflowsDir) : [];
    const scheduled = crons.length > 0;
    const gh = ghOf(github, l.workflow);
    /* a successful production run dates a CHECK only where the workflow fails when the source does not answer (githubCheck: the national
       detector's `--check` exits 1 on a failed read) — elsewhere a green run can carry a refused source, and the run log stays the check */
    const ghOk = l.githubCheck && gh && gh.production && gh.production.lastSuccess ? gh.production.lastSuccess : null;
    const runLogCheck = sync ? sync.lastCheckAt || null : null;
    let lastCheckAt = runLogCheck, origin = runLogCheck ? 'run-log' : null;
    if (ghOk && (!lastCheckAt || FRESH.ts(ghOk.at) > FRESH.ts(lastCheckAt) + HOUR)) { lastCheckAt = ghOk.at; origin = 'github-run'; }
    /* a summary without lastGoodAt (the land joins) is good at its last check when its run state is good */
    const runLogGood = sync ? (sync.lastGoodAt !== undefined ? sync.lastGoodAt || null : GOOD_RUN.has(sync.runState) ? runLogCheck : null) : null;
    const lastGoodAt = later(runLogGood, ghOk ? ghOk.at : null);
    const latestObservation = l.latestObservation || (l.fromCatalog && c ? { value: c.latestObservation || null, kind: c.latestObservationKind || 'as the Trust catalogue reads it' } : null);
    const publication = l.publication || (l.fromCatalog && c ? { value: c.sourceUpdatedAt || null, kind: c.sourceUpdatedKind || 'as the Trust catalogue reads it' } : null);
    const derived = !!l.derived;
    const st = derived ? { state: (l.ingestion && l.ingestion.value) ? 'CURRENT' : 'NO_RUN', rule: 'derived — as fresh as its sources (see their rows)' }
      : stateOf({ scheduled, runState: sync ? sync.runState || null : null, lastGoodAt, lastCheckAt, builtAt: l.ingestion ? l.ingestion.value || null : null, staleAfterHours: l.staleAfterHours, lagState: l.lag ? l.lag.state : null, now });
    const findings = [];
    if (gh && gh.production && gh.production.lastSuccess && runLogCheck && FRESH.ts(gh.production.lastSuccess.at) - FRESH.ts(runLogCheck) > (l.staleAfterHours || 24) * HOUR / 2)
      findings.push({ kind: 'RUN_LOG_BEHIND', detail: `the latest successful production run (${gh.production.lastSuccess.id}, ${gh.production.lastSuccess.at}) is newer than the run log's last check (${runLogCheck}) by more than half the cadence allowance` });
    if (scheduled && gh && !(gh.production && gh.production.latest)) findings.push({ kind: 'NO_PRODUCTION_RUN_YET', detail: `the workflow has run only outside the production branch so far; its first scheduled production run: ${cronFires(crons, now).next}` });
    if (sync && sync.recovered) findings.push({ kind: 'RECOVERED', detail: `a good check followed a ${sync.latestFailureState} at ${sync.latestFailureAt}` });
    entries.push({
      id: l.id, label: l.label, vertical: l.vertical || (c && c.vertical) || null,
      latestObservation, publication, ingestion: l.ingestion || null,
      lastCheck: { at: lastCheckAt, origin, runState: sync ? sync.runState || null : null, lastGoodAt, runLog: runLogCheck,
        github: gh && gh.production ? { lastSuccess: gh.production.lastSuccess || null, lastFailure: gh.production.lastFailure || null } : null },
      cadence: { workflow: l.workflow, rebuiltBy: l.rebuiltBy || null, cron: crons, staleAfterHours: l.staleAfterHours, ...(scheduled ? cronFires(crons, now) : { previous: null, next: null }) },
      lag: l.lag || null, state: st.state, stateRule: st.rule,
      evidence: l.evidence, findings,
    });
  }
  entries.sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || a.id.localeCompare(b.id));
  const counts = {}; for (const e of entries) counts[e.state] = (counts[e.state] || 0) + 1;
  return { schema: 1, engine: ENGINE, asOf: new Date(now).toISOString(), today, states: STATES, meaning: STATE_MEANING, counts, entries, transactions: transactions(ctx) };
}

module.exports = { ENGINE, STATES, STATE_MEANING, audit, stateOf, cbsIndexLag, ownLag, copyLag, newerCopyActions, streetGeoKeyCheck, lastIngest, cronOf, cronFires, cronMatches, latestNonFuture };
