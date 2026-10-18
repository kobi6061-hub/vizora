// PROPX · LOCAL / TEST store adapter for the private-workspace identity — never used in Production.
//
// Speaks to a THROWAWAY PostgreSQL (scripts/private-pg-local.sh, or the CI service container) exactly the way the
// private project's API would: connected as `authenticator`, SET LOCAL ROLE to the token's role, the token's claims in
// request.jwt.claims, one function of schema `ws` per call. Same interface as lib/identity/rest.js: rpc(fn, args, claims).
//
// Every value travels as a BOUND parameter (psql \getenv + \bind, the extended protocol), never inside the statement text:
// a failed call logs `ws.fn(p_x := $1, …)`, not a password hash or a token hash (security review 19.10.2026, finding 7).
// The values reach psql through its environment (readable by the same OS user only), not its command line. A server-side
// Postgres adapter for Production, if one is ever needed (supabase/private/README.md), must bind the same way.

'use strict';

const { execFile } = require('node:child_process');
const { FUNCTIONS } = require('../lib/identity/rest');

function psqlAdapter(url) {
  return {
    kind: 'psql',
    rpc(fn, args, claims) {
      if (!FUNCTIONS.has(fn)) throw new Error('identity store: unknown function');
      const role = claims && claims.role;
      if (role !== 'authenticated' && role !== 'propx_auth') throw new Error('identity store: refused role');
      const env = { PATH: process.env.PATH, PGARG_C: JSON.stringify(claims) };
      const named = [], bound = [];
      for (const [k, v] of Object.entries(args || {})) {
        if (!/^p_[a-z_]+$/.test(k)) throw new Error('identity store: bad argument name');
        if (v === null || v === undefined) { named.push(`${k} := null`); continue; }
        bound.push(k); env['PGARG_' + bound.length] = String(v);
        named.push(`${k} := $${bound.length}`);
      }
      const sql = `\\getenv c PGARG_C\n${bound.map((_, i) => `\\getenv a${i + 1} PGARG_${i + 1}\n`).join('')}begin;\nset local role ${role};\n`
        + `select set_config('request.jwt.claims', $1, true) is null \\bind :c \\g\n`
        + `select '@@' || coalesce((ws.${fn}(${named.join(', ')}))::text, 'null') \\bind ${bound.map((_, i) => `:a${i + 1}`).join(' ')} \\g\ncommit;\n`;
      return new Promise((resolve) => {
        const p = execFile('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-f', '-'], { encoding: 'utf8', env }, (err, stdout, stderr) => {
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
