// Shared GovDataService instance for the /api/gov/* endpoints.
// One instance per warm lambda: its MemoryStore de-duplicates upstream calls
// across requests; nothing here persists beyond the instance (durable
// snapshots come from scripts/gov-sync.js with a FileStore, or a future
// KV-backed store plugged into createDefaultService).
//
// GOV_DEV_FIXTURE=1 (local dev server ONLY — never set in production env)
// swaps the GovMap transport for a fixture-backed fetch serving the Azor
// acceptance data, so the full UI pipeline can be exercised visually in an
// environment whose egress to gov.il is blocked. Responses then carry
// meta.mode='dev-fixture' and the UI labels them as verification data.

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
    return { ok: false, status: 404, json: async () => ({}) };
  };
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
