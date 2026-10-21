'use strict';
/* SECURITY GATE (19.10.2026) — the session gate's exclusions are EXACT paths (never a prefix), the local dev server uses the
   same lists, and the evidence body (POST /api/intel, view=dd) is really limited to 256 KB: at the Edge on the declared
   length, in the function before the platform-parsed body is used, after parsing when no length was declared, and on the
   normalized evidence in total (lib/dd/userdocs.js). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHmac } = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let n = 0; const at = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const SECRET = 'unit-test-session-secret';
const mwSrc = SRC('middleware.js');
const gateSrc = SRC('lib/identity/gate.mjs');
let mw;
const cookie = () => { const exp = String(Date.now() + 3600e3); return `kobix_session=${exp}.${createHmac('sha256', SECRET).update('kobix|' + exp).digest('hex')}`; };
const run = (p, { method = 'GET', headers = {} } = {}) => mw.middleware(new Request('https://propx.example' + p, { method, headers }));
const setOf = (src, name) => { const m = new RegExp(name + ' = new Set\\(\\[([^\\]]*)\\]\\)').exec(src); assert.ok(m, name + ' not found'); return JSON.parse('[' + m[1].replace(/'/g, '"') + ']').sort(); };

(async () => {
  mw = await require('./helpers/middleware').loadMiddleware({ SESSION_SECRET: SECRET });
  console.log('security gate: exact exclusions');
  await at('the matcher sends every path to the middleware; the exclusions are exact paths decided in code', async () => {
    assert.deepEqual(mw.config.matcher, ['/(.*)']);
    assert.deepEqual(setOf(gateSrc, 'PUBLIC_PATHS'), ['/api/login', '/favicon.ico', '/login.html', '/robots.txt']);
    assert.deepEqual(setOf(gateSrc, 'MACHINE_PATHS'), ['/api/jobs/tx-refresh']);
    assert.match(mwSrc, /^import \{ [^}]+ \} from '\.\/lib\/identity\/gate\.mjs';$/m, 'the middleware decides through the one gate module');
    assert.ok(!/new Set\(\[/.test(mwSrc), 'no second, hand-written list in the middleware');
  });
  await at('the exact public paths pass without a cookie; every prefix / suffix look-alike is gated (302 → /login.html)', async () => {
    for (const p of ['/api/login', '/login.html', '/robots.txt', '/favicon.ico', '/api/jobs/tx-refresh']) assert.equal(await run(p), undefined, p);
    for (const p of ['/api/login-anything', '/api/loginx', '/api/login/', '/api/login/x', '/api/login.js', '/login.html.bak', '/login.htmlx', '/login.html/', '/robots.txt.x', '/favicon.icox',
      '/api/jobs/tx-refresh/', '/api/jobs/tx-refreshx', '/', '/index.html', '/api/intel', '/api/identity', '/data/dd/latest.json', '/altaris', '/standalone/x.html']) {
      const r = await run(p); assert.ok(r && r.status === 302 && /\/login\.html$/.test(r.headers.get('location')), p + ' escaped the gate'); }
  });
  await at('a valid session passes; a forged / expired / unsigned cookie does not', async () => {
    assert.equal(await run('/index.html', { headers: { cookie: cookie() } }), undefined);
    const exp = String(Date.now() - 1000), old = `kobix_session=${exp}.${createHmac('sha256', SECRET).update('kobix|' + exp).digest('hex')}`;
    for (const c of ['kobix_session=1.2', 'kobix_session=99999999999999.' + 'a'.repeat(64), old]) assert.equal((await run('/index.html', { headers: { cookie: c } })).status, 302, c);
  });
  await at('the local dev server decides through the same gate module and serves /api/login through the deployed module (GET is never the source)', async () => {
    const dev = SRC('scripts/kobix-dev-server.mjs');
    assert.match(dev, /from '\.\.\/lib\/identity\/gate\.mjs';/);
    assert.match(dev, /return decide\(/);
    assert.match(dev, /if \(p === '\/api\/login'\) return \(await identity\(\)\)\.login\(req, res\);/);
    assert.ok(!/new Set\(\[/.test(dev), 'no second, hand-written list');
    const L = require('../api/login').createLogin({ env: { SESSION_SECRET: SECRET, SITE_PASSWORD: 'x' } });
    const r = await new Promise((resolve) => { const h = {}; L({ method: 'GET', url: '/api/login', headers: {} }, { setHeader: (k, v) => { h[k] = v; }, set statusCode(v) { this.s = v; }, get statusCode() { return this.s; }, end(b) { resolve({ status: this.s, body: b, h }); } }); });
    assert.equal(r.status, 405); assert.ok(!/SITE_PASSWORD|require\(/.test(r.body), 'GET /api/login never serves the source');
  });

  console.log('security gate: the evidence body limit');
  await at('the Edge refuses a declared evidence body over 256 KB (413) before the function runs; 256 KB exactly passes; other paths and methods are not affected', async () => {
    const big = { method: 'POST', headers: { cookie: cookie(), 'content-length': String(256 * 1024 + 1) } };
    const r = await run('/api/intel?view=dd&developer=x', big); assert.equal(r.status, 413); assert.equal((await r.json()).limitBytes, 262144);
    assert.equal(await run('/api/intel?view=dd&developer=x', { method: 'POST', headers: { cookie: cookie(), 'content-length': String(256 * 1024) } }), undefined);
    assert.equal(await run('/api/intel?view=dd', { method: 'GET', headers: { cookie: cookie(), 'content-length': String(1e6) } }), undefined);
    assert.equal((await run('/api/intel?view=dd', { method: 'POST', headers: { 'content-length': String(1e6) } })).status, 302, 'no session → login first');
  });
  const H = require('../api/intel');
  const call = (req) => new Promise((resolve) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b }); } }; H(req, res); });
  const fakeReq = (o) => Object.assign({ method: 'POST', url: '/api/intel?view=dd&developer=dev-x', headers: {}, on() {} }, o);
  const bigDocs = { userDocs: Array.from({ length: 50 }, (_, i) => ({ type: 'permit', fields: { projectId: 'x', municipality: 'm', permitNumber: String(i), issueDate: '2025-01-01', holderName: 'א'.repeat(3000) }, provenance: { fileName: 'f.pdf' } })) };
  await at('the function refuses a declared length over 256 KB BEFORE reading the platform-parsed body', async () => {
    let touched = false; const req = fakeReq({ headers: { 'content-length': String(300 * 1024) } }); Object.defineProperty(req, 'body', { get() { touched = true; return {}; } });
    assert.equal((await call(req)).status, 413); assert.equal(touched, false, 'req.body was parsed before the length check');
  });
  await at('a pre-parsed body over 256 KB without a declared length (chunked) is refused after parsing (413)', async () => {
    assert.ok(Buffer.byteLength(JSON.stringify(bigDocs)) > 256 * 1024);
    assert.equal((await call(fakeReq({ body: bigDocs }))).status, 413);
    assert.equal((await call(fakeReq({ body: JSON.stringify(bigDocs) }))).status, 413, 'a string body is measured too');
  });
  await at('the raw stream (local dev server) is cut at 256 KB (413)', async () => {
    const big = Readable.from([Buffer.alloc(300 * 1024, 32)]); Object.assign(big, { method: 'POST', url: '/api/intel?view=dd&developer=dev-x', headers: {} });
    assert.equal((await call(big)).status, 413);
  });
  await at('the normalized evidence is capped at 256 KB in total per read — the documents past the total are rejected WITH the reason; more than 60 documents are said', async () => {
    const UD = require('../lib/dd/userdocs');
    /* a company extract carries up to 40 shareholder rows of 600 characters — a few of them pass 256 KB */
    const docs = Array.from({ length: 12 }, (_, i) => ({ type: 'company_extract', fields: { entityNumber: '51000000' + (i % 10), asOf: '2025-01-0' + (1 + (i % 9)), shareholders: Array.from({ length: 40 }, (_, j) => ({ name: 'א'.repeat(599) + j, sharePct: 1 })) }, provenance: { fileName: 'f' + i + '.pdf' } }));
    const r = UD.normalizeAll(docs);
    const used = r.docs.reduce((s, d) => s + Buffer.byteLength(JSON.stringify({ fields: d.fields, provenance: d.provenance })), 0);
    assert.ok(used <= UD.MAX_TOTAL_BYTES, 'within the total'); assert.ok(r.docs.length < 60 && r.rejected.some((x) => /256 KB total/.test(x.errors[0])), 'the excess is rejected with the reason');
    const many = UD.normalizeAll(Array.from({ length: 65 }, (_, i) => ({ type: 'permit', fields: { projectId: 'x', municipality: 'm', permitNumber: String(i), issueDate: '2025-01-01' }, provenance: { fileName: 'g' + i } })));
    assert.equal(many.docs.length, 60); assert.ok(many.rejected.some((x) => /5 documents over the limit of 60/.test(x.errors[0])));
  });
  await at('the documented limits say what is enforced (Edge 256 KB declared · function 256 KB · normalized 256 KB · platform 4.5 MB)', async () => {
    const intel = SRC('api/intel.js'); assert.match(intel, /declared length over 256 KB is refused BEFORE req\.body is touched/); assert.match(intel, /4\.5 MB/);
    assert.match(mwSrc, /MAX_EVIDENCE_BODY = 256 \* 1024/);
  });
  console.log(`security gate: ${n} gates passed`);
})().catch((e) => { console.log('  ✗ ' + (e && e.stack || e)); console.log('security gate: SOME FAILED'); process.exit(1); });
