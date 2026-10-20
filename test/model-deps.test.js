// PROPX · STREET VALUE MODEL dependency gates (20.10.2026): the model is stale ONLY when something it reads moved
// (lib/streets/model-deps.js). A land-tender sync that changes statuses, prices, dates, winners or other tracks never marks it stale;
// a change in the subsidized / residential-lottery parcels it reads does — including a lot shard the old whole-file hash never saw.
// Offline: node test/model-deps.test.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MD = require('../lib/streets/model-deps');
const VM = require('../lib/streets/value-model');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const LAND = path.join(ROOT, 'data', 'land');
/* a copy of data/land holding tenders.json and the lot shards — the only land files the model reads */
function landCopy() {
  const d = tmp('propx-land-');
  for (const f of fs.readdirSync(LAND).filter((x) => x === 'tenders.json' || /^lots-\d+\.json$/.test(x))) fs.copyFileSync(path.join(LAND, f), path.join(d, f));
  return d;
}
const landSha = (dir) => MD.current({ landDir: dir }).land.sha256;
const BASE = landSha(LAND);

console.log('model-deps: what makes the street value model stale');

t('the committed build is CURRENT and its dependencies come from a record (the build\'s own, or the proven baseline)', () => {
  assert.equal(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'street-model-build.js'), '--check'], { encoding: 'utf8' }).trim(), 'CURRENT');
  const c = MD.check();
  assert.equal(c.stale, false); assert.deepEqual(c.moved, []); assert.ok(c.recordedFrom);
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'streets', 'model', 'dependencies.json'), 'utf8'));
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'streets', 'model', 'model.json'), 'utf8'));
  assert.equal(base.forBuild, model.builtAt);
  if (base.proof) for (const k of ['code', 'evidence', 'directory', 'land', 'versions']) assert.equal(base.proof[k].equal, true, k + ' proven equal to what the build read');
});

t('LAND: a tender sync that changes statuses, dates, prices, winners or a non-subsidized track does NOT make the model stale', () => {
  const d = landCopy();
  try {
    const T = JSON.parse(fs.readFileSync(path.join(d, 'tenders.json'), 'utf8'));
    let touched = 0;
    for (const x of T) {
      if (x.track === 'subsidized' || x.track === 'residential-lottery') { x.status = 'changed-by-test'; x.lastUpdated = '2099-01-01'; touched++; continue; }
      x.status = 'changed-by-test'; x.parcels = [{ block: 999999, parcel: 1 }]; touched++;
    }
    T.push({ id: 'test-new', track: 'open-market', parcels: [{ block: 888888, parcel: 2 }] });
    fs.writeFileSync(path.join(d, 'tenders.json'), JSON.stringify(T));
    assert.ok(touched > 100);
    assert.equal(landSha(d), BASE, 'the subsidized-parcel set is unchanged → the land dependency is unchanged');
    assert.equal(MD.check({ landDir: d }).stale, false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

t('LAND: a new subsidized-track parcel (tender or lot shard) DOES make it stale — the old whole-file hash never saw a lot shard', () => {
  const d = landCopy();
  try {
    const T = JSON.parse(fs.readFileSync(path.join(d, 'tenders.json'), 'utf8'));
    const sub = T.find((x) => x.track === 'subsidized');
    assert.ok(sub, 'a subsidized tender exists');
    sub.parcels = [...(sub.parcels || []), { block: 777777, parcel: 3 }];
    fs.writeFileSync(path.join(d, 'tenders.json'), JSON.stringify(T));
    assert.notEqual(landSha(d), BASE);
    const c = MD.check({ landDir: d });
    assert.equal(c.stale, true); assert.deepEqual(c.moved, ['land']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  const d2 = landCopy();
  try {
    const T = JSON.parse(fs.readFileSync(path.join(d2, 'tenders.json'), 'utf8'));
    const ids = new Set(T.filter((x) => x.track === 'subsidized' || x.track === 'residential-lottery').map((x) => x.id));
    /* the shard that holds a subsidized tender's lots (a tender's lots live in one shard) */
    let shard = null, L = null, id = null;
    for (const f of fs.readdirSync(d2).filter((x) => /^lots-\d+\.json$/.test(x))) { const j = JSON.parse(fs.readFileSync(path.join(d2, f), 'utf8')); id = Object.keys(j).find((k) => ids.has(k)); if (id) { shard = f; L = j; break; } }
    assert.ok(shard, 'a lot shard holds a subsidized tender');
    L[id] = [...L[id], { parcels: [{ block: 666666, parcel: 4 }] }];
    fs.writeFileSync(path.join(d2, shard), JSON.stringify(L));
    assert.equal(fs.readFileSync(path.join(d2, 'tenders.json'), 'utf8'), fs.readFileSync(path.join(LAND, 'tenders.json'), 'utf8'), 'tenders.json itself unchanged');
    assert.deepEqual(MD.check({ landDir: d2 }).moved, ['land'], 'a lot shard alone moves the land dependency');
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

t('CODE: the build\'s require closure (incl. directory · schema · aliases the old list missed); a change inside the build script\'s @deps blocks is not a model change, one outside is', () => {
  const files = MD.codeClosure();
  for (const f of ['lib/streets/value-model.js', 'lib/streets/value-validate.js', 'scripts/street-model-build.js', 'lib/streets/evidence.js', 'lib/streets/match.js',
    'lib/streets/directory.js', 'lib/gov/classify.js', 'lib/gov/schema.js', 'lib/geo/aliases.js']) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /recent|land|model-deps/.test(f)), 'the recent layer, the land read model and the tracking module are not model code');
  const r = tmp('propx-code-');
  try {
    for (const f of files) { fs.mkdirSync(path.join(r, path.dirname(f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(r, f)); }
    const base = MD.codeHash(r).sha256;
    assert.equal(base, MD.codeHash(ROOT).sha256);
    const b = path.join(r, 'scripts', 'street-model-build.js'), src = fs.readFileSync(b, 'utf8');
    fs.writeFileSync(b, src.replace('/* @deps:end */', '/* tracking edited */ /* @deps:end */'));
    assert.equal(MD.codeHash(r).sha256, base, 'an edit inside @deps leaves the code hash');
    fs.writeFileSync(b, src.replace("const MATERIAL = 0.05;", "const MATERIAL = 0.06;"));
    assert.notEqual(MD.codeHash(r).sha256, base, 'a modelling edit moves it');
    fs.writeFileSync(b, src);
    fs.appendFileSync(path.join(r, 'lib', 'geo', 'aliases.js'), '\n// edited\n');
    assert.notEqual(MD.codeHash(r).sha256, base, 'a required module moves it');
  } finally { fs.rmSync(r, { recursive: true, force: true }); }
});

t('DIRECTORY / NEIGHBOURHOODS / EVIDENCE / VERSIONS are projections of what the model reads; the recent layer and unrelated data are not dependencies', () => {
  const now = MD.current();
  assert.deepEqual(Object.keys(now).sort(), [...MD.DEPS].sort());
  assert.ok(now.directory.rows > 50000 && now.directory.localities > 1000);
  assert.equal(now.neighbourhoods.links, VM.neighbourhoodIndex(require('../lib/streets/directory').load()).size);
  assert.equal(now.land.parcels, VM.subsidizedParcels().size);
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'streets', 'model-deps.js'), 'utf8');
  assert.ok(!/data\/streets\/recent|data\/transactions|data\/market/.test(src.split('NOT dependencies')[0].replace(/^\/\/.*$/gm, '')), 'no unrelated data path is read');
  assert.deepEqual(MD.diff(now, now), []);
  assert.deepEqual(MD.diff(null, now), MD.DEPS, 'no record → every dependency');
});

t('the build records its dependencies (model.json inputs.deps + dependencies.json) and the DATA / MODEL reason comes from them; the workflow still rebuilds only when stale', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'street-model-build.js'), 'utf8');
  assert.match(src, /deps: d \};/); assert.match(src, /writeJson\('dependencies\.json'/); assert.match(src, /const reason = reasonOf\(prevModel, inputs\)/);
  assert.ok(!/tenders\.json/.test(MD.stripTracking(src)), 'the build script reads no land file itself');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'street-evidence-sync.yml'), 'utf8');
  assert.match(wf, /street-model-build\.js --if-stale/);
});

console.log(`model-deps: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
