// TEST HARNESS ONLY — a LOCAL stand-in for the few Supabase Management API endpoints scripts/identity-activate.js calls, so the
// isolation gate can run the activation sequence (preflight · refusals · apply · audit · probe) on a throwaway PostgreSQL. SQL runs
// through psql as the throwaway cluster's superuser (as the real API may); it never contacts Supabase.
'use strict';
const http = require('node:http'); const { spawnSync } = require('node:child_process');
const DB = process.env.MOCK_DB_URL, REF = 'abcdefghijklmnopqrst';
let pgcfg = { db_schema: 'public,graphql_public' }, auth = { disable_signup: false }, seen = [];
http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
  const send = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Bearer sbp_localmocktoken') return send(401, { message: 'unauthorized' });
  const u = req.url; seen.push(req.method + ' ' + u);
  if (u === '/v1/projects') return send(200, [{ id: REF, ref: REF, name: 'propx-private', region: 'eu-central-1', status: 'ACTIVE_HEALTHY', created_at: '2026-10-18T00:00:00Z', database: { version: '17.6' } },
    { id: 'zzzzzzzzzzzzzzzzzzzz', ref: 'zzzzzzzzzzzzzzzzzzzz', name: 'propx-market', region: 'eu-central-1', status: 'ACTIVE_HEALTHY' }]);
  if (u === `/v1/projects/${REF}/database/query`) {
    const q = JSON.parse(b).query; const r = spawnSync('psql', [DB, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: q, encoding: 'utf8' });
    if (r.status !== 0) return send(400, { message: 'Failed to run sql query: ' + r.stderr });
    const out = r.stdout.trim(); try { return send(201, out ? [{ c: JSON.parse(out.split('\n').pop()) }] : []); } catch { return send(201, []); }
  }
  if (u === `/v1/projects/${REF}/postgrest`) { if (req.method === 'PATCH') pgcfg = { ...pgcfg, ...JSON.parse(b) }; return send(200, pgcfg); }
  if (u === `/v1/projects/${REF}/config/auth`) { if (req.method === 'PATCH') auth = { ...auth, ...JSON.parse(b) }; return send(200, auth); }
  if (/\/advisors\/(security|performance)$/.test(u)) return send(200, { lints: [{ name: 'rls_enabled_no_policy', level: 'INFO', title: 'RLS Enabled No Policy', detail: 'Table `ws.sessions` has RLS enabled, but no policies exist', metadata: { schema: 'ws', name: 'sessions' } }] });
  send(404, { message: 'not mocked: ' + u });
}); }).listen(Number(process.env.MOCK_PORT || 54399), () => console.log('mock up'));
