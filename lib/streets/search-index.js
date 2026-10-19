// PROPX · STREET SEARCH INDEX — prebuilt from the stored directory (scripts/street-sync.js writes it beside the directory
// after every run; `node scripts/street-sync.js --rebuild-index` rebuilds it offline), loaded by lib/geo/registry.js so a
// cold server instance parses one file instead of expanding 150k names (≈ 3 s of alias expansion → ≈ 0.15 s of JSON).
//
// Every searchable official row (kind street / area / site — never the locality placeholder 9000) and every official
// synonym that names one of them is expanded ONCE into its normalized keys (lib/geo/aliases.js aliasKeys — the same
// function the query side uses). A later word of an official name ("בן יהודה" → "יהודה") is a discovery key, ranked last.
//
// References are the OFFICIAL CODES, never a row position, so an added street changes only its own postings:
//   ref     = locality code × 100000 + code   (a street row's official code, or a synonym row's own code)
//   posting = ref × 4 + type                  type 1 official name · 2 synonym · 3 a later word of an official name
// Keys are sorted (binary-search prefix lookup); postings per key ascending and unique; no build time is stored, so an
// unchanged directory gives a byte-identical index. The index records the sha256 of the two files it was built from;
// a stale index (directory rewritten, index not rebuilt) is refused and the registry builds in memory instead.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { aliasKeys, baseNorm } = require('../geo/aliases');
const SD = require('./directory');

const FILE = 'search-index.json';
const SCHEMA = 2;
const TYPE = Object.freeze({ OFFICIAL: 1, SYNONYM: 2, WORD: 3 });
const REF_BASE = 100000;

const refOf = (cityCode, code) => Number(cityCode) * REF_BASE + Number(code);
const typeOf = (p) => p % 4;
const refOfPosting = (p) => (p - (p % 4)) / 4;
const cityOfRef = (ref) => Math.floor(ref / REF_BASE);
const codeOfRef = (ref) => ref % REF_BASE;

/** build from the directory object of lib/streets/directory.js load() */
function build(D) {
  const map = new Map();
  const push = (k, p) => { if (!k || k.length < 2) return; const a = map.get(k); if (a) a.push(p); else map.set(k, [p]); };
  const searchable = new Set();
  let rows = 0, synonyms = 0;
  for (const s of D.streets) {
    if (s.kind === SD.KIND.LOCALITY) continue;
    rows++;
    const ref = refOf(s.cityCode, s.code);
    searchable.add(ref);
    for (const k of aliasKeys(s.name)) push(k, ref * 4 + TYPE.OFFICIAL);
    const w = baseNorm(s.name).split(' ');
    for (let j = 1; j < w.length; j++) { const tail = w.slice(j).join(' '); if (tail.length >= 3) push(tail, ref * 4 + TYPE.WORD); }
  }
  for (const y of D.synonyms) {
    if (!searchable.has(refOf(y.cityCode, y.officialCode))) continue;   // a synonym of the placeholder / of an absent row: counted elsewhere, not searchable
    synonyms++;
    for (const k of aliasKeys(y.name)) push(k, refOf(y.cityCode, y.code) * 4 + TYPE.SYNONYM);
  }
  const keys = [...map.keys()].sort();
  const entries = keys.map((k) => [k, ...[...new Set(map.get(k))].sort((a, b) => a - b)]);
  return { schema: SCHEMA, files: D.fileHash || null, counts: { rows, synonyms, keys: keys.length, postings: entries.reduce((n, e) => n + e.length - 1, 0) }, entries };
}

/** one entry per line — a small directory change is a small text change in git */
function write(dir, index) {
  const head = JSON.stringify({ schema: index.schema, files: index.files, counts: index.counts });
  fs.writeFileSync(path.join(dir, FILE), head.slice(0, -1) + ',"entries":[\n' + index.entries.map((e) => JSON.stringify(e)).join(',\n') + '\n]}\n');
}

/** the stored index, or null when absent, of another schema, or built from other directory files than `fileHash` */
function read(dir, fileHash) {
  try {
    const x = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    if (x.schema !== SCHEMA) return null;
    if (fileHash && (!x.files || x.files.directory !== fileHash.directory || x.files.synonyms !== fileHash.synonyms)) return null;
    return x;
  } catch { return null; }
}

module.exports = { build, write, read, FILE, SCHEMA, TYPE, REF_BASE, refOf, typeOf, refOfPosting, cityOfRef, codeOfRef };
