// PROPX · test helper — the files a vercel.json `includeFiles` glob selects (brace groups — nested —, `**`, `*`), so a gate can assert
// that a data file is bundled without depending on how the pattern is spelled. Vercel caps the string at 256 characters (schema).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** brace expansion, innermost group first: "a/{b,c}/{d,e}.json" → 4 patterns */
function expand(p) {
  const m = /\{([^{}]*)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(',').flatMap((alt) => expand(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}
const toRe = (p) => new RegExp('^' + p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\0/g, '.*') + '$');

/** does the includeFiles glob select this repository-relative path? */
function matches(glob, rel) { return expand(glob).some((p) => toRe(p).test(rel)); }

/** every repository file the glob selects (walks only the fixed prefix of each pattern) */
function files(glob, root) {
  const out = new Set();
  for (const p of expand(glob)) {
    const re = toRe(p), base = p.split(/[*?]/)[0].replace(/[^/]*$/, '').replace(/\/$/, '');
    const walk = (d) => { let es; try { es = fs.readdirSync(path.join(root, d), { withFileTypes: true }); } catch { return; }
      for (const e of es) { const r = d ? d + '/' + e.name : e.name; if (e.isDirectory()) walk(r); else if (re.test(r)) out.add(r); } };
    walk(base);
  }
  return out;
}

module.exports = { expand, matches, files };
