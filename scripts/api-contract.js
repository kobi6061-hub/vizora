#!/usr/bin/env node
// PROPX · API contract check — runs the serverless functions' own handlers in
// Node (no network, no browser, no secrets) over the committed data, and checks
// the shape and the rules of their answers. It runs in CI (data-sync.yml) on
// the commit that deploys; it is an API-contract check, not a browser smoke of
// Production. Exit 0 only if every check passes.

'use strict';

const assert = require('node:assert');

const call = async (handler, { method = 'GET', url, headers = {} }) => {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  await handler({ method, url, headers }, res);
  let json = null; try { json = JSON.parse(res.body); } catch { /* not JSON */ }
  return { status: res.statusCode, json, headers: res.headers };
};
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };

(async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROPX_JOB_TOKEN']) delete process.env[k];   // the contract of the unconfigured fallback
  const housing = require('../api/housing');
  const job = require('../api/jobs/tx-refresh');
  const today = new Date().toISOString().slice(0, 10);
  console.log('GET /api/housing');
  let all;
  await ok('summary: freshness keeps four facts apart and names its store', async () => {
    const r = await call(housing, { url: '/api/housing?view=summary&period=all' });
    assert.equal(r.status, 200); assert.match(r.headers['cache-control'], /no-store/);
    all = r.json; const f = all.freshness;
    for (const k of ['freshness', 'coverage', 'kpis', 'maturity', 'series', 'breakdown', 'facets', 'excluded']) assert.ok(k in all, k);
    assert.equal(f.synced, true);
    assert.match(f.sourceUpdatedAt, /^\d{4}-\d{2}-\d{2}T/); assert.match(f.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(f.latestEventDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(f.latestEventDate, f.coverage.lotteryDateTo, 'the event horizon comes from the content');
    assert.equal(f.store, 'git'); assert.equal(f.storeReason, 'store-not-configured');
    assert.equal(all.coverage.state, 'within');
    assert.ok(Number.isInteger(all.kpis.lotteries) && all.kpis.lotteries > 0);
    assert.equal(all.kpis.signedSales, null); assert.equal(all.kpis.availableInventory, null);
  });
  await ok('a period after the newest lottery has no numbers (null, never 0)', async () => {
    const months = (Date.parse(today) - Date.parse(all.freshness.latestEventDate)) / (30.44 * 864e5);
    if (months <= 6) return console.log('    (skipped: the source has a lottery in the last 6 months)');
    const r = await call(housing, { url: '/api/housing?view=summary&period=6m' });
    assert.equal(r.json.coverage.state, 'none'); assert.equal(r.json.kpis, null); assert.equal(r.json.maturity, null);
    const t = await call(housing, { url: '/api/housing?view=records&period=6m' });
    assert.equal(t.json.total, null); assert.deepEqual(t.json.rows, []);
  });
  let first;
  await ok('records: one sorted page, at most 25 rows, no coordinates', async () => {
    const r = await call(housing, { url: '/api/housing?view=records&period=all&sort=lotteryDate&order=desc' });
    assert.equal(r.status, 200); assert.ok(r.json.rows.length > 0 && r.json.rows.length <= 25); assert.ok(r.json.total >= r.json.rows.length);
    first = r.json.rows[0];
    for (const k of ['id', 'lotteryId', 'projectId', 'lotteryDate', 'city', 'localityCode', 'winners', 'maturity']) assert.ok(k in first, k);
    assert.ok(!JSON.stringify(r.json).match(/"lat"|"lng"|coordinates":\s*\[/));
  });
  await ok('record: the project, its history and provenance', async () => {
    const r = await call(housing, { url: '/api/housing?view=record&id=' + encodeURIComponent(first.id) });
    assert.equal(r.status, 200);
    for (const k of ['record', 'project', 'history', 'freshness']) assert.ok(k in r.json, k);
    assert.equal(r.json.record.provenance.classification, 'OFFICIAL');
    assert.equal((await call(housing, { url: '/api/housing?view=record&id=lottery:1' })).status, 404);
  });
  await ok('status, bad input and methods', async () => {
    const s = await call(housing, { url: '/api/housing?view=status' });
    assert.equal(s.status, 200); assert.ok(Array.isArray(s.json.runs)); assert.equal(s.json.freshness.store, 'git');
    assert.equal((await call(housing, { url: '/api/housing?view=nope' })).status, 400);
    assert.equal((await call(housing, { url: '/api/housing?view=summary&period=custom&from=2025-01-01' })).status, 400);
    assert.equal((await call(housing, { method: 'POST', url: '/api/housing' })).status, 405);
  });
  console.log('POST /api/jobs/tx-refresh');
  await ok('fail-closed while unconfigured: 503 with no token, 405 for GET; no GovMap call', async () => {
    const r = await call(job, { method: 'POST', url: '/api/jobs/tx-refresh?mode=probe', headers: { authorization: 'Bearer ' + 'x'.repeat(40) } });
    assert.equal(r.status, 503); assert.equal(r.json.error, 'job-not-configured');
    assert.equal((await call(job, { method: 'GET', url: '/api/jobs/tx-refresh' })).status, 405);
  });
  console.log(`\nAPI CONTRACT: ${n} checks passed`);
})().catch((e) => { console.error('API CONTRACT FAILED:', e.message); process.exit(1); });
