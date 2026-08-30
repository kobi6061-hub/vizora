// Shared GovDataService instance for the /api/gov/* endpoints.
// One instance per warm lambda: its MemoryStore de-duplicates upstream calls
// across requests; nothing here persists beyond the instance (durable
// snapshots come from scripts/gov-sync.js with a FileStore, or a future
// KV-backed store plugged into createDefaultService).

'use strict';

const { createDefaultService } = require('../../lib/gov/service');

let service = null;

function getService() {
  if (!service) service = createDefaultService();
  return service;
}

module.exports = { getService };
