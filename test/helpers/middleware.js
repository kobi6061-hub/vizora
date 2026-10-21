// PROPX · test helper — run the REAL middleware.js (an ES module that imports lib/identity/gate.mjs) inside a CommonJS test:
// the source is evaluated with the gate module handed in for its one import line, and a chosen `process.env`.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const IMPORT = /^import \{ ([^}]+) \} from '\.\/lib\/identity\/gate\.mjs';$/m;

async function loadMiddleware(env) {
  const gate = await import(pathToFileURL(path.join(ROOT, 'lib/identity/gate.mjs')).href);
  const src = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
  const m = IMPORT.exec(src);
  if (!m) throw new Error('middleware.js: the gate import line was not found');
  const body = src.replace(IMPORT, `const { ${m[1]} } = __gate;`)
    .replace(/export const config/, 'const config').replace(/export default async function middleware/, 'async function middleware');
  const fn = new Function('__gate', 'process', 'crypto', 'Response', 'URL', 'TextEncoder', 'Headers', body + '\nreturn { middleware, config };');
  return { ...fn(gate, { env }, globalThis.crypto, Response, URL, TextEncoder, Headers), gate };
}

module.exports = { loadMiddleware, ROOT };
