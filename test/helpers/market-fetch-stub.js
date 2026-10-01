// Test-only network stub, preloaded with `node -r` so scripts/market-sync.js
// runs end to end offline. MARKET_STUB=<json file> holds
// [[urlFragment, body, status?], ...]; first matching fragment wins.
'use strict';
const fs = require('node:fs');
const routes = JSON.parse(fs.readFileSync(process.env.MARKET_STUB, 'utf8'));
globalThis.fetch = async (url) => {
  const u = String(url);
  for (const [frag, body, status = 200] of routes) {
    if (u.includes(frag)) return { ok: status < 400, status, json: async () => body };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
