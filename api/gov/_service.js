// Shared GovDataService instance for the /api/gov/* endpoints.
// One instance per warm lambda: its MemoryStore de-duplicates upstream calls
// across requests; nothing here persists beyond the instance (durable
// snapshots come from scripts/gov-sync.js with a FileStore, or a future
// KV-backed store plugged into createDefaultService).
//
// GOV_DEV_FIXTURE=1 (local dev server ONLY — never set in production env)
// swaps the transports for a fixture-backed fetch: GovMap serves the Azor
// acceptance data, and the register's republication (over.org.il) serves
// SAMPLE rows for באר שבע (data/gov/fixtures/over-deals-sample.json), so the
// full UI pipeline can be exercised visually in an environment whose egress
// is blocked. Responses then carry meta.mode='dev-fixture' and the UI labels
// them as verification data.

'use strict';

const { createDefaultService } = require('../../lib/gov/service');

let service = null;

function fixtureFetch() {
  const fs = require('node:fs');
  const path = require('node:path');
  const fix = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'data', 'gov', 'fixtures', 'azor-jabotinsky7.json'), 'utf8')).govmapFixtures;
  const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
  return async (url, init) => {
    const u = String(url);
    if (u.includes('/search-service/autocomplete')) {
      const q = init && init.body ? JSON.parse(init.body).searchText : '';
      // only the acceptance locality exists in the fixture universe
      return jsonRes(/אזור/.test(q) ? fix.autocomplete : { resultsCount: 0, results: [] });
    }
    if (u.match(/\/real-estate\/deals\/[\d.]+,[\d.]+\/\d+$/)) return jsonRes(fix.polygons);
    if (u.includes('/real-estate/street-deals/')) {
      return jsonRes(u.includes('dealType=1') ? fix.streetDeals1 : fix.streetDeals2);
    }
    const over = overFixture(u);
    if (over) return jsonRes(over);
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

/* the register's republication, answered from SAMPLE rows in its own shapes */
let OVER = null;
function overFixture(u) {
  if (!/over\.org\.il\/api\/deals\//.test(u)) return null;
  if (!OVER) {
    const fs = require('node:fs');
    const path = require('node:path');
    OVER = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'gov', 'fixtures', 'over-deals-sample.json'), 'utf8'));
  }
  const url = new URL(u);
  if (url.pathname.endsWith('/settlements')) return OVER.settlements;
  if (url.pathname.endsWith('/stats')) return OVER.stats;
  if (!url.pathname.endsWith('/search')) return null;
  const q = (k) => url.searchParams.get(k);
  const street = q('street'), house = q('house');
  const rows = OVER.deals.filter((d) => (!q('settlement') || d.settlement === q('settlement'))
    && (!q('date_from') || d.date >= q('date_from'))
    && (!street || d.addresses.some((a) => a.includes(street) && (!house || a.endsWith(' ' + house)))));
  const limit = Number(q('limit')) || 50, offset = Number(q('offset')) || 0;
  return { data: rows.slice(offset, offset + limit), total: rows.length, total_capped: false, limit, offset, sort: 'date_desc',
    address: street ? { status: rows.length ? 'ok' : 'not_found', addresses: 2, linked: rows.length ? 2 : 0, parcels: [] } : null };
}

function serviceMode() {
  return process.env.GOV_DEV_FIXTURE === '1' ? 'dev-fixture' : 'live';
}

function getService() {
  if (!service) {
    service = serviceMode() === 'dev-fixture'
      ? createDefaultService({ fetchImpl: fixtureFetch() })
      : createDefaultService();
  }
  return service;
}

module.exports = { getService, serviceMode };
