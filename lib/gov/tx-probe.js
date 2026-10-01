// PROPX · transaction-source diagnostics — read-only, nothing is written.
//
//   probeSource()   one request to the official source (the address lookup
//                   every transaction query starts with), reported as the
//                   source answered it to THIS runtime: status, the serving
//                   edge's identifying headers, a short body excerpt when it
//                   refused, the time taken.
//   sampleCities()  the page's own transaction path (GovDataService →
//                   providers, exactly what /api/gov/transactions runs) for a
//                   few cities: what each answered, through which channel
//                   (GovMap, or the register's republication by over.org.il),
//                   why when empty, and the newest rows.
//
// Used by api/jobs/tx-refresh.js (modes probe / sample) to learn what the
// deployed runtime receives. Texts are redacted before they leave.

'use strict';

const { redact } = require('../store-config');

const BASE = (process.env.GOV_GOVMAP_BASE || 'https://www.govmap.gov.il/api').replace(/\/$/, '');
const UA = 'PROPX-gov-layer/1.0 (+https://kobix.online)';   // the providers' own User-Agent
const EDGE_HEADERS = ['server', 'content-type', 'via', 'x-cache', 'x-cdn', 'cf-ray', 'cf-cache-status', 'x-iinfo', 'x-azure-ref',
  'x-ms-request-id', 'x-amz-cf-id', 'x-amz-cf-pop', 'akamai-grn', 'x-akamai-request-id', 'x-sucuri-id', 'retry-after'];
const text = (s) => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
const ROW_FIELDS = ['date', 'city', 'street', 'houseNumber', 'block', 'parcel', 'subParcel', 'rooms', 'areaSqm', 'floor', 'price', 'newness', 'dealType', 'partialSale'];

async function probeSource({ fetchImpl = globalThis.fetch, city = 'באר שבע', timeoutMs = 8000 } = {}) {
  const url = BASE + '/search-service/autocomplete', t0 = Date.now();
  try {
    const r = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchText: city, language: 'he', isAccurate: false, maxResults: 3 }) });
    const body = await r.text();
    const get = (k) => (r.headers && typeof r.headers.get === 'function' ? r.headers.get(k) : null);
    const headers = Object.fromEntries(EDGE_HEADERS.map((k) => [k, get(k)]).filter(([, v]) => v).map(([k, v]) => [k, redact(v).slice(0, 120)]));
    let results = null;
    try { const j = JSON.parse(body); results = Array.isArray(j.results) ? j.results.length : null; } catch { /* not JSON */ }
    return { request: 'POST ' + url, status: r.status, accepted: r.ok, ms: Date.now() - t0, headers, results,
      bodyExcerpt: r.ok ? null : redact(text(body)).slice(0, 240) || null };
  } catch (e) {
    const why = e && e.cause && (e.cause.code || e.cause.message) ? `${e.message}: ${e.cause.code || e.cause.message}` : (e && e.message) || String(e);
    return { request: 'POST ' + url, status: null, accepted: false, ms: Date.now() - t0, error: redact(why).slice(0, 200) };
  }
}

/** the page's transaction path, city by city (sequential — a bounded load on the official source) */
async function sampleCities(service, cities, { months = 24, limit = 120, rowsPerCity = 3, budgetMs = 8000, deadline = Infinity } = {}) {
  const out = [];
  for (const city of cities) {
    if (Date.now() >= deadline) { out.push({ city, status: 'skipped', reason: 'job deadline' }); continue; }
    const t0 = Date.now();
    try {
      const r = await service.getTransactions({ city }, { months, limit, budgetMs });
      const official = (r.transactions || []).filter((t) => t.sourceFamily === 'OFFICIAL_GOVERNMENT' && t.price)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const res = official.filter((t) => t.propertyClass === 'residential');
      const n = (f) => res.filter(f).length;
      out.push({ city, status: official.length ? 'ok' : 'empty', ms: Date.now() - t0,
        // the channel the rows came through: GovMap, or the register's independent republication
        deliveredVia: official.some((t) => t.deliveredVia === 'over.org.il') ? 'over.org.il' : official.length ? 'GovMap' : null,
        answered: r.answered !== false,
        scope: r.scope ? { level: r.scope.level, description: r.scope.description, sampleSize: r.scope.sampleSize } : null,
        unavailable: (r.unavailable || []).map((u) => redact(`${u.provider || '—'}: ${u.reason}`).slice(0, 200)),
        counts: { official: official.length, residential: res.length, newBuild: n((t) => t.newness === 'confirmed_new' || t.newness === 'probable_new'),
          secondHand: n((t) => t.newness === 'second_hand'), unknown: n((t) => t.newness === 'unknown') },
        latestTransactionDate: official.length ? official[0].date : null,
        coverage: r.diagnostics || null,
        rows: res.slice(0, rowsPerCity).map((t) => Object.fromEntries(ROW_FIELDS.map((k) => [k, val(t[k]) ?? null]))) });
    } catch (e) {
      out.push({ city, status: 'error', ms: Date.now() - t0, error: redact(e && e.message).slice(0, 200) });
    }
  }
  return out;
}

module.exports = { probeSource, sampleCities };
