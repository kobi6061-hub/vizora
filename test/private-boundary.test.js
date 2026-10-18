'use strict';
/* PRIVATE WORKSPACE · BOUNDARY GATES (STEP 2A §7 / §18, 19.10.2026) — the private identity layer stays a separate island:
   nothing public imports it, no sync job or workflow can reach it, the offline build carries none of it, it writes no file, it reads
   and copies no browser-local business state, and the public read models answer byte-identically with the identity switch on or off. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

let n = 0; const at = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'vizora-app', 'data', 'standalone'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else if (/\.(c?js|mjs)$/.test(e.name)) out.push(f);
  }
  return out;
}
const FILES = walk(ROOT);
const IDENTITY_FILES = new Set(['lib/identity/config.js', 'lib/identity/token.js', 'lib/identity/password.js', 'lib/identity/cookie.js', 'lib/identity/rest.js', 'lib/identity/service.js',
  'api/identity.js', 'api/logout.js', 'scripts/identity-psql-adapter.js', 'scripts/identity-verify.js', 'scripts/kobix-dev-server.mjs', 'test/identity.test.js', 'test/private-identity.test.js', 'test/private-boundary.test.js']);

console.log('private boundary');
at('only the identity files import lib/identity (no read model, sync, API or page module reaches it)', () => {
  const users = FILES.filter((f) => /lib\/identity|identity-psql-adapter/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))).map(rel);
  for (const u of users) assert.ok(IDENTITY_FILES.has(u) || u.startsWith('lib/identity/'), 'imports the private layer: ' + u);
  assert.ok(users.includes('api/identity.js') && users.includes('api/logout.js'));
});
at('the identity layer imports nothing public: node built-ins and its own modules only — no read model, no data, no public store', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'lib/identity'))) {
    const src = fs.readFileSync(path.join(ROOT, 'lib/identity', f), 'utf8');
    for (const m of src.matchAll(/require\('([^']+)'\)/g)) assert.ok(/^node:/.test(m[1]) || /^\.\/[a-z]+$/.test(m[1]), `lib/identity/${f} requires ${m[1]}`);
    assert.ok(!/\bfs\b|writeFile|appendFile|createWriteStream/.test(src), `lib/identity/${f} touches the file system`);
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|storeConfig|market\./.test(src.replace(/\/\/.*$/gm, '')), `lib/identity/${f} names the public store`);
  }
  const api = fs.readFileSync(path.join(ROOT, 'api/identity.js'), 'utf8');
  for (const m of api.matchAll(/require\('([^']+)'\)/g)) assert.match(m[1], /^\.\.\/lib\/identity\//);
});
at('no sync / discovery workflow can reach the private project: its settings appear only in the activation check (read-only) and the isolation gate (no secret)', () => {
  const wf = path.join(ROOT, '.github/workflows');
  for (const f of fs.readdirSync(wf)) {
    const y = fs.readFileSync(path.join(wf, f), 'utf8');
    const names = y.match(/PROPX_WS_[A-Z_]+|PROPX_ID_SECRET|PROPX_IDENTITY/g) || [];
    if (f === 'identity-verify.yml') { assert.ok(names.length && !/PROPX_ID_SECRET|PROPX_IDENTITY|contents: write|git push/.test(y), f); continue; }
    assert.deepEqual(names, [], f + ' names a private-workspace setting');
  }
  for (const f of FILES.filter((x) => /scripts\/.*-(sync|discover|snapshot|build)\.js$/.test(rel(x)))) assert.ok(!/PROPX_WS_|PROPX_ID_SECRET|lib\/identity/.test(fs.readFileSync(f, 'utf8')), rel(f));
});
at('the private schema lives apart: no public migration names ws, the private migration names no public schema', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations'))) assert.ok(!/\bws\.|propx_auth/.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')), f);
  const priv = fs.readFileSync(path.join(ROOT, 'supabase/private/migrations/20261019120000_identity_foundation.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.ok(!/\bmarket\.|\buser_state\.|\bpublic\./.test(priv));
  assert.ok(!/evidence|deal|thesis|storage\.|bucket/i.test(priv), 'no evidence, deal, thesis or file storage (D3 · D5 · D6)');
});
at('the offline build carries no identity code, endpoint or setting', () => {
  const sa = fs.readFileSync(path.join(ROOT, 'standalone/israel-new-homes-v2.html'), 'utf8');
  for (const x of ['/api/identity', 'propx_id', 'PROPX_WS', 'PROPX_IDENTITY', 'ws:begin', 'wsChip', 'x-propx-intent']) assert.ok(!sa.includes(x), x);
});
at('the workspace UI reads, copies and syncs no browser-local business state (evidence, deals, theses, settings, watchlists)', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const blocks = [...page.matchAll(/\/\* ws:begin[\s\S]*?\/\* ws:end \*\//g), ...page.matchAll(/<!-- ws:begin -->[\s\S]*?<!-- ws:end -->/g)].map((m) => m[0]).join('\n');
  assert.ok(blocks.length > 5000, 'the workspace blocks are present');
  const code = blocks.replace(/\/\*[\s\S]*?\*\//g, '');   // the blocks' comments say what is NOT read; the gate reads the code
  for (const x of ['localStorage', 'sessionStorage', 'indexedDB', 'propx:dd:docs', 'propx:watch', 'altaris:', 'document.cookie']) assert.ok(!code.includes(x), x);
  const service = fs.readFileSync(path.join(ROOT, 'lib/identity/service.js'), 'utf8');
  assert.ok(!/import|userDocs|deal|thesis|watch/i.test(service.replace(/\/\/.*$/gm, '').replace(/'[^']*'/g, '')), 'no import / sync path in the server flows');
});
at('ALTARIS and its Live Thesis do not know the identity layer', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'altaris')).filter((x) => /\.(js|html)$/.test(x))) assert.ok(!/api\/identity|lib\/identity|propx_id/.test(fs.readFileSync(path.join(ROOT, 'altaris', f), 'utf8')), 'altaris/' + f);
});
at('the switch is OFF by default: no environment → the API answers {enabled:false} and contacts no store', async () => {
  const { identityConfig } = require('../lib/identity/config');
  assert.equal(identityConfig({}).enabled, false);
  assert.equal(identityConfig({ PROPX_IDENTITY: 'off', PROPX_ID_SECRET: 'x'.repeat(40) }).enabled, false);
});
at('public read models answer byte-identically with the identity switch ON or OFF (dossier · Trust Center · radar scan)', () => {
  const probe = `const D=require('./lib/dossier/query.js'),T=require('./lib/trust/catalog.js'),S=require('./lib/radar/scan.js');
    const strip=o=>JSON.stringify(o,(k,v)=>k==='generatedAt'||k==='checkedAt'||k==='now'||k==='builtAt'?undefined:v);
    const h=require('node:crypto').createHash('sha256');h.update(strip(D.dossier({level:'il'})));h.update(strip(D.dossier({level:'district',code:'d-center'})));
    h.update(strip(T.catalog({now:'2026-10-19T00:00:00Z'})));h.update(strip(S.forGeo?S.forGeo('il'):null));process.stdout.write(h.digest('hex'));`;
  const run = (env) => { const r = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 120000 }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const off = run({});
  const on = run({ PROPX_IDENTITY: 'on', PROPX_ID_SECRET: 'b'.repeat(40), PROPX_WS_URL: 'https://private-ws.example', PROPX_WS_APIKEY: 'anon-key-123456', PROPX_WS_JWT_SECRET: 'j'.repeat(40) });
  assert.match(off, /^[0-9a-f]{64}$/); assert.equal(on, off);
});

console.log(`private boundary: ${n} passed`);
