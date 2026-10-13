// PROPX · Urban renewal (declared complexes, MoCH) — offline tests.
// `node test/renewal.test.js`
//
// Every row below is a TEST FIXTURE in the Ministry's own column names (complex numbers 9990001+, names prefixed
// "TEST FIXTURE"), padded with spaces like the real export, written only to temp directories.

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const N = require('../lib/renewal/normalize');
const { mergeRecords, FileRenewalStore } = require('../lib/renewal/store');
const { SOURCE } = require('../lib/renewal/source');

const ROOT = path.join(__dirname, '..');
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };
const pad = (s, n = 40) => String(s) + ' '.repeat(n);
let seq = 0;
const row = (o = {}) => ({ _id: ++seq, MisparMitham: 9990000 + seq, Yeshuv: pad('גבעתיים'), SemelYeshuv: 6300, ShemMitcham: pad('TEST FIXTURE מתחם'),
  YachadKayam: '126', YachadTosafti: '108', YachadMutza: 234, TaarichHachraza: '20/08/2006', MisparTochnit: pad('גב/ 400'), KishurLatar: '', SachHeterim: '',
  KishurLaMapa: 'https://example.invalid/map', Maslul: pad('רשויות'), ShnatMatanTokef: '2012', Bebitzua: '', Status: pad('   תכנית מאושרת לפני מימוש'), ...o });
const CTX = { fetchedAt: '2026-10-13T03:00:00.000Z', sourceUpdatedAt: '2026-08-15T22:00:15Z', snapshotHash: 'a'.repeat(40), retrievalMethod: 'live-api' };

console.log('renewal: normalization');
t('padded text is trimmed and collapsed; the status is kept verbatim beside its mapped stage', () => {
  const { record: r } = N.normalizeRow(row(), CTX);
  assert.equal(r.city, 'גבעתיים'); assert.equal(r.name, 'TEST FIXTURE מתחם'); assert.equal(r.track, 'רשויות');
  assert.equal(r.statusHe, 'תכנית מאושרת לפני מימוש'); assert.equal(r.stage, 'approved');
  assert.equal(r.id, 'renewal:' + r.complexId); assert.equal(r.provenance.classification, 'OFFICIAL'); assert.equal(r.provenance.source, SOURCE.id);
  assert.equal(N.normalizeRow(row({ Status: 'תכנית מאושרת -  אחרי רישוי ' }), CTX).record.stage, 'approved-after-licensing');
  assert.equal(N.normalizeRow(row({ Status: ' 2025 ' }), CTX).record.stage, 'unknown', 'an unknown status is shown verbatim, never guessed');
  assert.equal(N.normalizeRow(row({ Status: '' }), CTX).record.stage, 'declared');
});
t('numbers only from plain numeric cells — "" and text are null, never 0; dates dd/mm/yyyy only when valid', () => {
  const { record: r } = N.normalizeRow(row({ YachadKayam: '', YachadTosafti: 'לא ידוע', YachadMutza: ' 530 ' }), CTX);
  assert.equal(r.existingUnits, null); assert.equal(r.additionalUnits, null); assert.equal(r.proposedUnits, 530); assert.equal(r.unitsAddUp, null);
  assert.ok(r.missing.includes('existingUnits') && r.missing.includes('additionalUnits'));
  assert.equal(r.declarationDate, '2006-08-20');
  assert.equal(N.normalizeRow(row({ TaarichHachraza: '31/02/2010' }), CTX).record.declarationDate, null);
  assert.equal(N.normalizeRow(row({ TaarichHachraza: '31/02/2010' }), CTX).record.declarationRaw, '31/02/2010');
  assert.equal(N.normalizeRow(row({ ShnatMatanTokef: 'טרם' }), CTX).record.approvalYear, null);
  assert.equal(N.normalizeRow(row({ YachadKayam: '-5' }), CTX).record.existingUnits, null);
});
t('the unit columns are reported as published; whether proposed = existing + additional is stated, never forced', () => {
  assert.equal(N.normalizeRow(row(), CTX).record.unitsAddUp, true);
  const r = N.normalizeRow(row({ YachadMutza: 530 }), CTX).record;
  assert.equal(r.unitsAddUp, false); assert.equal(r.proposedUnits, 530); assert.equal(r.existingUnits, 126);
});
t('links only when they are http(s) URLs; a row without a complex number is rejected; a duplicate number is rejected', () => {
  const r = N.normalizeRow(row({ KishurLatar: 'javascript:alert(1)' }), CTX).record;
  assert.equal(r.links.site, null); assert.equal(r.links.map, 'https://example.invalid/map');
  assert.ok(N.normalizeRow(row({ MisparMitham: '' }), CTX).error);
  const a = row(), { records, rejected } = N.normalizeAll([a, { ...a, _id: 999 }], CTX);
  assert.equal(records.length, 1); assert.match(rejected[0].error, /duplicate/);
});

console.log('renewal: store');
t('upsert on the complex number: firstSeenAt kept, changes in history, a missing complex kept (never deleted)', () => {
  const a = row(), b = row();
  const r1 = N.normalizeAll([a, b], CTX).records;
  const m1 = mergeRecords([], r1, { fetchedAt: CTX.fetchedAt, syncRunId: 'r1' });
  assert.equal(m1.stats.inserted, 2);
  const later = { ...CTX, fetchedAt: '2026-10-14T03:00:00.000Z' };
  const r2 = N.normalizeAll([{ ...a, Status: 'תכנית מאושרת במימוש' }], later).records;
  const m2 = mergeRecords(m1.records, r2, { fetchedAt: later.fetchedAt, syncRunId: 'r2', prevCheckedAt: CTX.fetchedAt });
  assert.equal(m2.records.length, 2, 'nothing deleted');
  const ra = m2.records.find((r) => r.complexId === a.MisparMitham), rb = m2.records.find((r) => r.complexId === b.MisparMitham);
  assert.equal(ra.firstSeenAt, CTX.fetchedAt); assert.equal(ra.stage, 'approved-in-implementation');
  assert.equal(rb.inLatestSource, false); assert.equal(rb.lastSeenAt, CTX.fetchedAt);
  assert.ok(m2.history.some((h) => h.field === 'statusHe' && h.to === 'תכנית מאושרת במימוש'));
  assert.ok(m2.history.some((h) => h.field === 'inLatestSource' && h.to === false));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-test-')), s = new FileRenewalStore(dir);
  s.write({ records: m2.records, history: m2.history, meta: { checkedAt: later.fetchedAt }, run: { id: 'r2' } });
  assert.equal(s.readRecords().length, 2); assert.equal(s.readHistory().length, m2.history.length); assert.equal(s.readRuns().length, 1);
  assert.ok(s.snapshotRaw([a], 'b'.repeat(40), later.fetchedAt)); assert.equal(s.snapshotRaw([a], 'b'.repeat(40), later.fetchedAt), null, 'one raw snapshot per content hash');
});

console.log('renewal: sync');
t('the sync refuses a changed schema and writes only its run log; a fixture never reaches data/renewal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-sync-')), stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-stub-'));
  const stub = path.join(stubDir, 'stub.js');
  fs.writeFileSync(stub, `globalThis.fetch = async (u) => { const url = String(u);
    const ok = (result) => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, result }) });
    if (url.includes('resource_show')) return ok({ last_modified: '2026-08-15T22:00:15' });
    return ok({ total: 1, records: [{ _id: 1, MisparMitham: 9991, Yeshuv: 'x' }] }); };`);
  const r = spawnSync(process.execPath, ['-r', stub, path.join(ROOT, 'scripts/renewal-sync.js')], { env: { ...process.env, RENEWAL_DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /schema changed/);
  const s = new FileRenewalStore(dir);
  assert.equal(s.readRecords().length, 0); assert.equal(s.readRuns()[0].status, 'failed');
  fs.writeFileSync(stub, `globalThis.fetch = async (u) => { const url = String(u);
    const ok = (result) => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, result }) });
    if (url.includes('resource_show')) return ok({ last_modified: '2026-08-15T22:00:15' });
    return ok({ total: 2, records: ${JSON.stringify([row(), row()])} }); };`);
  const ok = spawnSync(process.execPath, ['-r', stub, path.join(ROOT, 'scripts/renewal-sync.js')], { env: { ...process.env, RENEWAL_DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(s.readRecords().length, 2); assert.equal(s.readMeta().inLatestSource, 2); assert.ok(s.readRuns().some((x) => x.status === 'ok' && x.rawSnapshot));
});
t('no credential or store address in the renewal modules or workflow', () => {
  for (const f of ['lib/renewal/source.js', 'lib/renewal/normalize.js', 'lib/renewal/store.js', 'scripts/renewal-sync.js', '.github/workflows/renewal-sync.yml']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /SITE_PASSWORD|SESSION_SECRET|SERVICE_ROLE_KEY=|supabase\.co|PROPX_JOB_TOKEN/, f);
  }
});

console.log(`\nrenewal: ${passed} passed`);
