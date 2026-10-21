// PROPX · HOUSING FINANCE (21.10.2026, the master data directive §5) — the Bank of Israel's own SDMX service (edge.boi.gov.il, keyless,
// GET only): new housing loans (amount, number, payment-to-income, interest by track, loan-to-value and payment-to-income bands,
// investment-dwelling and reduced-price loans, refinancing) and the stock of housing credit (balance, number, arrears ≥ 90 days, by track)
// for the whole banking system. Every measure is selected by its dimension codes (lib/finance/series.js) and every code is verified
// against the NAME the published codelist gives it — a mismatch, a missing code, no series or several series = the measure is not read.
//
// Store (data/finance/): observations.jsonl (append-only; a revised value is a new revision with the value it replaces — the CBS ledger
// logic, lib/cbs-sales/ledger.js) · latest.json (per measure: latest period, previous month, a year earlier, the change; DERIVED shares
// named as such) · raw/<sha16>.csv.gz per content hash · sync-runs.jsonl. National banking-system figures — never a locality's.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { FLOWS, MEASURES, VERIFY, SOURCE } = require('./series');
const { merge, currentOf } = require('../cbs-sales/ledger');

const DIR = process.env.FINANCE_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'finance');
const FILES = { ledger: 'observations.jsonl', runs: 'sync-runs.jsonl', latest: 'latest.json', raw: 'raw' };
const START = '2016-01';

/* ── parsing ── */
/** RFC 4180 CSV → rows of strings (quoted fields, doubled quotes, commas and newlines inside quotes) */
function parseCsv(t) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out;
}
/** the structure response (sdmx-json) → { dims: [ids], codelistOf: dim → Map(code → { he, en }) } */
function structureOf(json) {
  const S = json && (json.data || json);
  const dsd = S && S.dataStructures && S.dataStructures[0];
  if (!dsd || !S.codelists) throw new Error('unrecognized shape: no data structure / codelists in the structure response');
  const lists = new Map(S.codelists.map((c) => [`${c.agencyID || ''}:${c.id}(${c.version || ''})`, c]));
  const byId = new Map(S.codelists.map((c) => [c.id, c]));
  const dims = (dsd.dataStructureComponents.dimensionList.dimensions || []);
  const codelistOf = {};
  for (const d of dims) {
    const urn = d.localRepresentation && d.localRepresentation.enumeration;
    const m = urn && /Codelist=([^:]+):([A-Z0-9_]+)\(([^)]*)\)/.exec(urn);
    const cl = m ? lists.get(`${m[1]}:${m[2]}(${m[3]})`) || byId.get(m[2]) : null;
    if (cl) codelistOf[d.id] = new Map((cl.codes || []).map((k) => [String(k.id), { he: (k.names && k.names.he) || k.name || null, en: (k.names && k.names.en) || null }]));
  }
  return { dims: dims.map((d) => d.id), codelistOf };
}

/** a measure's codes against the codelist names: [] when every code stands behind its expected name, else the problems */
function verifyMeasure(m, st) {
  const bad = [];
  for (const [dim, code] of Object.entries(m.filter)) {
    if (!st.dims.includes(dim)) { bad.push(`${dim}: no such dimension`); continue; }
    const want = VERIFY[dim] && VERIFY[dim][code];
    const cl = st.codelistOf[dim];
    const got = cl && cl.get(String(code));
    if (!got) { bad.push(`${dim}=${code}: not in the codelist`); continue; }
    if (want && !want.test(got.he || '') && !want.test(got.en || '')) bad.push(`${dim}=${code}: named "${got.he || got.en}"`);
    if (!want) bad.push(`${dim}=${code}: no expected name recorded`);
  }
  return bad;
}

/** the observations of one measure from a flow's CSV: exactly one series must match its codes */
function select(m, rows) {
  const h = rows[0], ix = Object.fromEntries(h.map((k, i) => [k, i]));
  for (const k of ['SERIES_CODE', 'TIME_PERIOD', 'OBS_VALUE']) if (!(k in ix)) throw new Error(`unrecognized shape: no ${k} column`);
  const hit = rows.slice(1).filter((r) => r.length >= h.length - 1 && Object.entries(m.filter).every(([d, c]) => d in ix && r[ix[d]] === String(c)));
  const series = [...new Set(hit.map((r) => r[ix.SERIES_CODE]))];
  if (series.length !== 1) return { error: series.length ? `ambiguous: ${series.length} series match (${series.slice(0, 4).join(', ')})` : 'no series matches the codes', series };
  const obs = [];
  for (const r of hit) {
    const raw = r[ix.OBS_VALUE], v = raw === '' || raw === 'NaN' ? null : Number(raw);
    if (v === null || !Number.isFinite(v)) continue;   // a missing observation stays missing — never 0
    const mult = 'UNIT_MULT' in ix && r[ix.UNIT_MULT] !== '' ? Number(r[ix.UNIT_MULT]) : 0;
    const freq = 'FREQ' in ix ? r[ix.FREQ] : 'M';
    if (freq !== 'M' || !/^\d{4}-\d{2}$/.test(r[ix.TIME_PERIOD])) continue;
    obs.push({ measure: m.id, cbs: 'il', geo: 'il', freq: 'M', period: r[ix.TIME_PERIOD], value: m.kind === 'amount' || m.kind === 'count' ? Math.round(v * 10 ** mult * 100) / 100 : v,
      rawValue: v, unitMult: mult, unit: 'UNIT_MEASURE' in ix ? r[ix.UNIT_MEASURE] : null, seriesId: series[0], dataKind: 'OFFICIAL', release: 'RELEASE_STATUS' in ix ? r[ix.RELEASE_STATUS] : null });
  }
  return { series: series[0], obs };
}

/* ── derived figures (named, never official) ── */
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
function measureLatest(m, series) {
  const periods = Object.keys(series).sort();
  if (!periods.length) return null;
  const p = periods[periods.length - 1], v = series[p];
  const prevP = addMonths(p, -1), yearP = addMonths(p, -12);
  const ch = (a, b) => (a == null || b == null ? null : m.kind === 'rate' || m.kind === 'ratio' ? Math.round((a - b) * 100) / 100 : b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);
  return { period: p, value: v, previous: series[prevP] != null ? { period: prevP, value: series[prevP] } : null, yearEarlier: series[yearP] != null ? { period: yearP, value: series[yearP] } : null,
    changeMonth: ch(v, series[prevP]), changeYear: ch(v, series[yearP]), changeUnit: m.kind === 'rate' || m.kind === 'ratio' ? 'percentage points' : '%', periods: periods.length, first: periods[0] };
}
/** shares inside one month among the published bands (the denominator is the sum of those bands — stated) */
function bandShares(latestByMeasure, band) {
  const ms = MEASURES.filter((m) => m.band === band), L = ms.map((m) => latestByMeasure[m.id]);
  if (L.some((x) => !x)) return null;
  const period = L.map((x) => x.period).sort().pop();
  if (L.some((x) => x.period !== period)) return { period: null, reason: 'the bands do not share one latest month' };
  const sum = L.reduce((a, x) => a + x.value, 0);
  if (!(sum > 0)) return null;
  return { period, class: 'DERIVED', denominator: 'the sum of the published bands in that month', total: Math.round(sum), bands: ms.map((m, i) => ({ measure: m.id, he: m.he, en: m.en, amount: L[i].value, sharePct: Math.round((L[i].value / sum) * 1000) / 10 })) };
}
/** a ÷ b in the latest month both series hold (a month one of them lacks is never compared) */
function sameMonth(A, B) {
  if (!A || !B) return null;
  const p = Object.keys(A).filter((k) => B[k] != null && A[k] != null).sort().pop();
  return p ? { period: p, a: A[p], b: B[p] } : null;
}
const ratio = (A, B, label, he) => { const x = sameMonth(A, B); return x && x.b > 0 ? { period: x.period, valuePct: Math.round((x.a / x.b) * 10000) / 100, class: 'DERIVED', formula: label, he } : null; };
function freshness(latestPeriod, now) {
  if (!latestPeriod) return { state: 'MISSING', reason: 'no observation held' };
  const [y, m] = latestPeriod.split('-').map(Number);
  const end = Date.UTC(y, m, 1);   // the first day after the month
  const days = Math.floor((now - end) / 864e5);
  return { latestPeriod, daysSincePeriodEnd: days, state: days <= SOURCE.lag.currentDays ? 'CURRENT' : days <= SOURCE.lag.lagDays ? 'EXPECTED_REPORTING_LAG' : 'STALE',
    basis: `CURRENT ≤ ${SOURCE.lag.currentDays} days after the month · EXPECTED_REPORTING_LAG ≤ ${SOURCE.lag.lagDays} · STALE beyond — ${SOURCE.lag.basis}` };
}
function buildLatest(records, ctx) {
  const cur = currentOf(records);
  const byMeasure = {};
  for (const r of cur.values()) { (byMeasure[r.measure] = byMeasure[r.measure] || {})[r.period] = r.value; }
  const measures = {}, L = {};
  for (const m of MEASURES) {
    const st = ctx.state[m.id] || { state: 'NO_RUN' };
    const latest = byMeasure[m.id] ? measureLatest(m, byMeasure[m.id]) : null;
    if (latest) L[m.id] = latest;
    measures[m.id] = { id: m.id, flow: m.flow, he: m.he, en: m.en, kind: m.kind, unit: m.kind === 'amount' ? 'ILS' : m.kind === 'count' ? 'loans' : '% a year', codes: m.filter,
      series: st.series || null, state: latest ? (st.state === 'OK' ? 'OK' : 'HELD') : 'MISSING', readState: st.state, problem: st.problem || null, latest,
      ...(latest ? {} : { missing: st.state === 'NOT_PUBLISHED' || !st.problem ? 'series-not-published' : 'not-read: ' + st.problem }) };
  }
  const latestPeriod = ['newLoans', 'balance'].map((k) => L[k] && L[k].period).filter(Boolean).sort().pop() || null;
  return {
    schema: 1, source: { ...SOURCE, flows: FLOWS }, checkedAt: ctx.at, readAt: ctx.readAt || ctx.at,
    freshness: freshness(L.newLoans ? L.newLoans.period : latestPeriod, Date.parse(ctx.at)),
    measures,
    derived: {
      ltvShares: bandShares(L, 'ltv'), ptiShares: bandShares(L, 'pti'),
      investmentShare: ratio(byMeasure.investmentLoans, byMeasure.newLoans, 'investment-dwelling loans ÷ all new housing loans (amount, same month)', 'הלוואות לדירה להשקעה ÷ כלל ההלוואות החדשות (סכום, אותו חודש)'),
      reducedPriceShare: ratio(byMeasure.reducedPriceLoans, byMeasure.newLoans, 'reduced-price housing loans ÷ all new housing loans (amount, same month)', 'הלוואות לדיור במחיר מופחת ÷ כלל ההלוואות החדשות'),
      arrearsShare: ratio(byMeasure.balanceArrears90, byMeasure.balance, 'outstanding in arrears ≥ 90 days ÷ outstanding housing credit (same month)', 'יתרה בפיגור 90+ ÷ יתרת האשראי לדיור'),
      averageNewLoan: (() => { const x = sameMonth(byMeasure.newLoans, byMeasure.newLoansCount); return x && x.b > 0 ? { period: x.period, value: Math.round(x.a / x.b), class: 'DERIVED', formula: 'new housing-loan amount ÷ number of new housing loans (same month)' } : null; })(),
    },
    records: { observations: records.length, revisions: records.filter((r) => (r.revision || 0) > 0).length },
    note: 'National banking-system figures (Bank of Israel). A rate is the average on loans issued in the month, by track — never an offer to a borrower; a variable track is published as its anchor and its margin, never summed by PROPX; shares are DERIVED inside one month. Never a locality or district figure.',
  };
}

/* ── the run ── */
function readLines(f) { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const urlOf = (flow) => ({ structure: `${SOURCE.base}structure/dataflow/${SOURCE.agency}/${flow}/latest?references=all&detail=full&format=sdmx-json`, data: `${SOURCE.base}data/dataflow/${SOURCE.agency}/${flow}/1.0?startperiod=${START}&format=csv` });

/**
 * @param {object} o { dir, fetchText(url, accept) → string (throws on a non-200), now?, dryRun? }
 * run states: SUCCESS (new / revised values) · UNCHANGED · PARTIAL (some measures not read — their data kept) · FAILED · REFUSED · SCHEMA_CHANGED
 */
async function runSync({ dir = DIR, fetchText, now = new Date(), dryRun = false }) {
  const at = now.toISOString();
  const records = readLines(path.join(dir, FILES.ledger));
  const state = {}, incoming = [], raws = [], errors = [];
  for (const flow of Object.keys(FLOWS)) {
    const ms = MEASURES.filter((m) => m.flow === flow);
    let st, rows;
    try {
      const u = urlOf(flow);
      st = structureOf(JSON.parse(await fetchText(u.structure, 'application/json')));
      const csv = await fetchText(u.data, 'text/csv');
      raws.push({ flow, csv });
      rows = parseCsv(csv);
      if (!rows.length || !rows[0].includes('SERIES_CODE')) throw new Error('unrecognized shape: the data response is not the SDMX CSV');
    } catch (e) { errors.push(`${flow}: ${e.message}`); for (const m of ms) state[m.id] = { state: /HTTP (401|403|429)/.test(e.message) ? 'REFUSED' : /unrecognized shape|not JSON|Unexpected token/.test(e.message) ? 'SCHEMA_CHANGED' : 'FAILED', problem: e.message.slice(0, 200) }; continue; }
    for (const m of ms) {
      const bad = verifyMeasure(m, st);
      if (bad.length) { state[m.id] = { state: 'SCHEMA_CHANGED', problem: bad.join('; ') }; continue; }
      const s = select(m, rows);
      if (s.error) { state[m.id] = { state: s.series && s.series.length ? 'SCHEMA_CHANGED' : 'NOT_PUBLISHED', problem: s.error }; continue; }
      state[m.id] = { state: 'OK', series: s.series, observations: s.obs.length };
      incoming.push(...s.obs.map((o) => ({ ...o, url: urlOf(flow).data })));
    }
  }
  const answered = new Set(MEASURES.filter((m) => state[m.id].state === 'OK').map((m) => `${m.id}|il`));
  const mg = merge(records, incoming, { fetchedAt: at, answered });
  const states = MEASURES.map((m) => state[m.id].state);
  const okN = states.filter((s) => s === 'OK').length, notPub = states.filter((s) => s === 'NOT_PUBLISHED').length;
  const status = okN === 0 ? (states.every((s) => s === 'REFUSED') ? 'refused' : states.some((s) => s === 'SCHEMA_CHANGED') ? 'schema_changed' : 'failed')
    : okN + notPub < MEASURES.length ? 'partial' : mg.append.length ? 'success' : 'unchanged';
  const all = records.concat(mg.append);
  const prev = readJson(path.join(dir, FILES.latest));
  const latest = buildLatest(all, { state, at, readAt: mg.append.length ? at : (prev && prev.readAt) || at });
  const run = { id: 'finance-' + at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: SOURCE.id, at, status, measures: MEASURES.length, read: okN, notPublished: notPub,
    added: mg.added, revised: mg.revised, unchanged: mg.unchanged, missingInSource: mg.missingInSource.length, contentChanged: mg.append.length > 0,
    problems: Object.entries(state).filter(([, v]) => v.state !== 'OK').map(([k, v]) => `${k}: ${v.state}${v.problem ? ' — ' + v.problem : ''}`).slice(0, 40), error: errors.join(' · ') || null };
  if (!dryRun) {
    fs.mkdirSync(path.join(dir, FILES.raw), { recursive: true });
    if (mg.append.length) fs.appendFileSync(path.join(dir, FILES.ledger), mg.append.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const r of raws) { const h = crypto.createHash('sha256').update(r.csv).digest('hex').slice(0, 16); const f = path.join(dir, FILES.raw, `${r.flow}-${h}.csv.gz`); if (!fs.existsSync(f)) fs.writeFileSync(f, zlib.gzipSync(r.csv)); }
    if (okN) fs.writeFileSync(path.join(dir, FILES.latest), JSON.stringify(latest, null, 1));
    fs.appendFileSync(path.join(dir, FILES.runs), JSON.stringify(run) + '\n');
  }
  return { status, run, latest, merge: mg, state };
}

/* ── the read model ── */
let CACHE = null;
function read(dir = DIR) {
  const f = path.join(dir, FILES.latest);
  let mt = 0; try { mt = fs.statSync(f).mtimeMs; } catch { return null; }
  if (CACHE && CACHE.f === f && CACHE.mt === mt) return CACHE.v;
  const v = readJson(f); CACHE = { f, mt, v }; return v;
}
/** the dossier / API block: the headline figures with their periods, or the reason there are none */
function summary(dir = DIR) {
  const L = read(dir);
  if (!L) return { available: false, missing: 'finance-not-synced', source: { id: SOURCE.id, publisher: SOURCE.publisher, publisherEn: SOURCE.publisherEn } };
  const pick = (k) => (L.measures[k] && L.measures[k].latest ? { id: k, he: L.measures[k].he, en: L.measures[k].en, kind: L.measures[k].kind, ...L.measures[k].latest } : { id: k, he: L.measures[k] && L.measures[k].he, en: L.measures[k] && L.measures[k].en, missing: (L.measures[k] && L.measures[k].missing) || 'series-not-published' });
  return { available: true, scope: 'national — the whole banking system', checkedAt: L.checkedAt, readAt: L.readAt, freshness: L.freshness,
    headline: ['newLoans', 'newLoansCount', 'rateFixedUnindexed', 'rateFixedCpi', 'variableCpiAnchor', 'variableCpiMargin', 'pti', 'balance'].map(pick),
    tracks: ['newLoansFixedUnindexed', 'newLoansVariableUnindexed', 'newLoansFixedCpi', 'newLoansVariableCpi'].map(pick),
    notPublished: Object.values(L.measures).filter((m) => m.missing === 'series-not-published').map((m) => ({ id: m.id, he: m.he, en: m.en })),
    derived: L.derived, source: { id: SOURCE.id, publisher: SOURCE.publisher, publisherEn: SOURCE.publisherEn, dataset: SOURCE.dataset, datasetEn: SOURCE.datasetEn, page: SOURCE.page, classification: 'OFFICIAL' }, note: L.note };
}

module.exports = { parseCsv, structureOf, verifyMeasure, select, buildLatest, runSync, read, summary, freshness, urlOf, DIR, FILES };
