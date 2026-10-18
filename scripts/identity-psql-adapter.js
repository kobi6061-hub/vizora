// PROPX · LOCAL / TEST store adapter for the private-workspace identity — never used in Production.
//
// Speaks to a THROWAWAY PostgreSQL (scripts/private-pg-local.sh, or the CI service container) exactly the way the
// private project's API would: connected as `authenticator`, SET LOCAL ROLE to the token's role, the token's claims in
// request.jwt.claims, one function of schema `ws` per call. Same interface as lib/identity/rest.js: rpc(fn, args, claims).

'use strict';

const { execFile } = require('node:child_process');
const { FUNCTIONS } = require('../lib/identity/rest');

const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function psqlAdapter(url) {
  return {
    kind: 'psql',
    rpc(fn, args, claims) {
      if (!FUNCTIONS.has(fn)) throw new Error('identity store: unknown function');
      const role = claims && claims.role;
      if (role !== 'authenticated' && role !== 'propx_auth') throw new Error('identity store: refused role');
      const call = `ws.${fn}(${Object.entries(args || {}).map(([k, v]) => `${k} := ${lit(v)}`).join(', ')})`;
      const sql = `begin;\nset local role ${role};\nselect set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true) is null;\n`
        + `select '@@' || coalesce((${call})::text, 'null');\ncommit;\n`;
      return new Promise((resolve) => {
        const p = execFile('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-f', '-'], { encoding: 'utf8' }, (err, stdout, stderr) => {
          if (err) {
            const m = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr || '');
            return resolve({ ok: false, status: 400, code: m ? m[1] : 'unreachable', message: m ? m[2] : null });
          }
          const line = String(stdout).split('\n').find((l) => l.startsWith('@@'));
          resolve({ ok: true, value: line ? JSON.parse(line.slice(2)) : null });
        });
        p.stdin.end(sql);
      });
    },
  };
}

module.exports = { psqlAdapter };
