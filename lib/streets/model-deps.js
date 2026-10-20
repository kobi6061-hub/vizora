// PROPX · STREET VALUE MODEL — its dependency graph and staleness rule (20.10.2026).
//
// The model is stale ONLY when something it actually reads has changed. Each dependency is the PROJECTION the build reads — never a
// whole file whose other fields the model ignores:
//
//   versions        MODEL_VERSION · FEATURE_VERSION · VALIDATION_VERSION (lib/streets/value-model.js)
//   code            the build's require closure inside the repository (CODE_ENTRIES and every local module they require — today
//                   value-model · value-validate · evidence · match · directory · lib/gov/classify · lib/gov/schema · lib/geo/aliases)
//                   + scripts/street-model-build.js without its dependency-tracking block (@deps:begin … @deps:end)
//   evidence        the register copy: data/streets/evidence/meta.json source.scrapedAt + window, and summary.json's sha256 (any
//                   shard re-match rewrites the summary)
//   directory       the official street directory AS THE MODEL READS IT: every enumerated row (id · kind · status), every locality
//                   (code · district · Hebrew name) — not synonyms or names the model never reads
//   neighbourhoods  the verified neighbourhood links the model resolves (data/geo/neighborhoods.json × the directory's names and
//                   synonyms × match.js): the (locality:street → neighbourhood) pairs
//   land            the Israel Land Authority parcels in a subsidized / residential-lottery track — the ONLY thing the model reads
//                   from data/land (tenders.json track + parcels, lots-*.json lot parcels): the set of block/parcel keys
//
// NOT dependencies (a change there never makes the model stale): every other field of data/land (statuses, dates, prices, winners,
// other tracks), data/transactions, data/streets/recent (the recent layer), data/market, data/housing, data/renewal, … and the
// directory's synonyms / spellings where they change no neighbourhood link.
//
// A build records its dependencies (model.json inputs.deps). A build made before this record existed is covered by
// data/streets/model/dependencies.json, written once with the proof that every dependency equals what that build read.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const CODE_ENTRIES = ['lib/streets/value-model.js', 'lib/streets/value-validate.js', 'scripts/street-model-build.js'];
const BUILD_SCRIPT = 'scripts/street-model-build.js';
const DEPS = ['versions', 'code', 'evidence', 'directory', 'neighbourhoods', 'land'];
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');

/** the build script without its dependency-tracking block — editing how staleness is tracked is not a model change */
const stripTracking = (src) => src.replace(/\/\* @deps:begin[\s\S]*?@deps:end \*\//g, '');

/** the local modules the model build requires, transitively (relative requires only; node: modules are the runtime) */
function codeClosure(root = ROOT) {
  const seen = new Set(), queue = [...CODE_ENTRIES];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const raw = fs.readFileSync(path.join(root, f), 'utf8');
    const src = f === BUILD_SCRIPT ? stripTracking(raw) : raw;           // the tracking module is not model code
    for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      let p = path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1])).split(path.sep).join('/');
      if (!/\.(js|json)$/.test(p)) p = fs.existsSync(path.join(root, p + '.js')) ? p + '.js' : p + '/index.js';
      if (fs.existsSync(path.join(root, p))) queue.push(p);
    }
  }
  return [...seen].sort();
}

function codeHash(root = ROOT) {
  const files = codeClosure(root);
  return { files, sha256: sha(files.map((f) => f + '\n' + (f === BUILD_SCRIPT ? stripTracking(fs.readFileSync(path.join(root, f), 'utf8')) : fs.readFileSync(path.join(root, f), 'utf8'))).join('\n\u0000\n')) };
}

/** the current value of every dependency (projections) */
function current({ root = ROOT, landDir, evidenceDir } = {}) {
  const VM = require('./value-model'), EV = require('./evidence'), SD = require('./directory');
  const S = EV.store(evidenceDir || undefined);
  const D = SD.load();
  const versions = { model: VM.MODEL_VERSION, feature: VM.FEATURE_VERSION, validation: VM.VALIDATION_VERSION };
  const code = codeHash(root);
  const evidence = S.available ? { scrapedAt: S.meta.source.scrapedAt, window: S.meta.window, summary: sha(fs.readFileSync(path.join(S.dir, 'summary.json'))) } : null;
  const rows = D.streets.filter((s) => s.kind !== SD.KIND.LOCALITY).map((s) => [s.id, s.kind, (D.byId.get(s.id) || {}).status || 'current']).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const locs = [...D.localities].map(([c, l]) => [c, l.district || null, l.he || null]).sort((a, b) => a[0] - b[0]);
  const directory = { sha256: sha([rows, locs]), rows: rows.length, localities: locs.length };
  const nb = VM.neighbourhoodIndex(D);
  const pairs = (nb.pairs ? nb.pairs() : null);
  const neighbourhoods = { sha256: sha(pairs || nbPairs(nb, rows)), links: nb.size };
  const subsidy = [...VM.subsidizedParcels(landDir)].sort();
  const land = { sha256: sha(subsidy), parcels: subsidy.length };
  return { versions, code: { sha256: code.sha256, files: code.files }, evidence, directory, neighbourhoods, land };
}
/* the (locality:street → neighbourhood) pairs, read through the index's own lookup over every enumerated street */
function nbPairs(nb, rows) {
  const out = [];
  for (const [id] of rows) { const [, c, s] = id.split(':'); const v = nb.idOf(Number(c), Number(s)); if (v) out.push([c + ':' + s, v]); }
  return out;
}

/** a dependency record → the comparable form (the file list travels for the report, not for the comparison) */
const comparable = (d) => d && { versions: d.versions, code: d.code && d.code.sha256, evidence: d.evidence, directory: d.directory && d.directory.sha256, neighbourhoods: d.neighbourhoods && d.neighbourhoods.sha256, land: d.land && d.land.sha256 };

/** what the stored build read: its own record, or the one-time baseline written for a build made before records existed */
function recorded(model, baseline) {
  if (!model) return null;
  if (model.inputs && model.inputs.deps) return { deps: model.inputs.deps, from: 'model.json inputs.deps' };
  if (baseline && baseline.forBuild === model.builtAt && baseline.deps) return { deps: baseline.deps, from: 'dependencies.json (baseline for the build ' + model.builtAt + ')' };
  return null;
}

/** which dependencies moved between two records (null record → every dependency) */
function diff(a, b) {
  const A = comparable(a), B = comparable(b);
  if (!A || !B) return [...DEPS];
  return DEPS.filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
}

/** the staleness of the stored build */
function check({ modelDir = path.join(ROOT, 'data', 'streets', 'model'), root = ROOT, landDir, evidenceDir } = {}) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(modelDir, f), 'utf8')); } catch { return null; } };
  const model = read('model.json');
  if (!model) return { stale: true, moved: [...DEPS], reason: 'no stored build' };
  const rec = recorded(model, read('dependencies.json'));
  const now = current({ root, landDir, evidenceDir });
  if (!rec) return { stale: true, moved: [...DEPS], reason: 'the stored build records no dependencies', now };
  const moved = diff(rec.deps, now);
  return { stale: moved.length > 0, moved, recordedFrom: rec.from, now };
}

/** the graph, for the docs and the report */
const GRAPH = Object.freeze({
  versions: ['lib/streets/value-model.js MODEL_VERSION · FEATURE_VERSION · VALIDATION_VERSION'],
  code: ['the require closure of ' + CODE_ENTRIES.join(' · ') + ' (the build script without its @deps block)'],
  evidence: ['data/streets/evidence/meta.json → source.scrapedAt · window', 'data/streets/evidence/summary.json (sha256)'],
  directory: ['data/geo/streets (via lib/streets/directory.js) → enumerated rows (id · kind · status) · localities (code · district · Hebrew name)'],
  neighbourhoods: ['data/geo/neighborhoods.json × the directory\'s names / synonyms × lib/streets/match.js → (locality:street → neighbourhood) pairs'],
  land: ['data/land/tenders.json → track ∈ {subsidized, residential-lottery} and parcels', 'data/land/lots-*.json → those tenders\' lot parcels', '= the set of block/parcel keys (lib/streets/value-model.js subsidizedParcels)'],
});

module.exports = { DEPS, CODE_ENTRIES, GRAPH, codeClosure, codeHash, stripTracking, current, recorded, diff, comparable, check, sha };
