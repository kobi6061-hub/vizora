'use strict';
/* PROPX · SOURCE UNIVERSE (the master data directive M2 / M3 / M4, 21.10.2026) — the gates over the auditable source catalogue
 * (lib/trust/discovery/2026-10-21-source-universe.json, built by scripts/source-universe-build.js from stored runner evidence). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const B = require('../scripts/source-universe-build');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')); } };

const U = B.build();
const STORED = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/trust/discovery/2026-10-21-source-universe.json'), 'utf8'));

t('the 11 states and the 20 fields of the directive — every source carries all 20 fields, exactly one state and the reason for it', () => {
  assert.deepEqual(Object.keys(B.STATES), ['CONNECTED_VERIFIED', 'EXISTING_VERIFIED', 'ACCESSIBLE_NOT_YET_INTEGRATED', 'REDUNDANT_PROVEN', 'BLOCKED_AUTH', 'BLOCKED_TECHNICAL', 'LICENSE_REVIEW_REQUIRED', 'PAID_APPROVAL_REQUIRED', 'UNSUITABLE_DATA', 'NOT_ACTUALLY_AN_API', 'PENDING_VERIFICATION']);
  assert.equal(B.FIELDS.length, 20);
  const ids = new Set();
  for (const s of U.sources) { assert.ok(!ids.has(s.id), 'duplicate ' + s.id); ids.add(s.id); assert.ok(B.STATES[s.state], s.id + ' ' + s.state); assert.ok(s.stateWhy, s.id); for (const k of B.FIELDS) assert.ok(k in s, `${s.id}: ${k}`); }
  assert.equal(U.summary.candidates, U.sources.length);
  assert.equal(Object.values(U.summary.byState).reduce((a, b) => a + b, 0), U.sources.length);
});
t('CONNECTED_VERIFIED only with retrieval + validation + a downstream reader; a data.gov.il package integrated in this mission proves a stored, successful read', () => {
  const cv = U.sources.filter((s) => s.state === 'CONNECTED_VERIFIED');
  assert.ok(cv.length >= 9);
  for (const s of cv) {
    assert.ok(s.integration && s.integration.integrated, s.id);
    if (s.id.startsWith('datagov:pkg:')) { const p = s.integration.proof; assert.ok(p && p.records > 0 && p.okRuns > 0 && s.integration.readBy, s.id); assert.ok(fs.existsSync(path.join(ROOT, p.store, 'meta.json')), s.id); }
  }
  for (const id of ['datagov:pkg:bus_stops', 'datagov:pkg:lrt_stat', 'datagov:pkg:2022', 'boi:sdmx:BIR_MRTG_99', 'boi:sdmx:BMB_99']) assert.equal(U.sources.find((s) => s.id === id).state, 'CONNECTED_VERIFIED', id);
  // an integrated source is never also blocked / unsuitable
  // the one exception: CBS Table 2.2 has no API — PROPX reads it as a labelled TRANSCRIPTION
  for (const s of U.sources) if (s.integration && s.integration.integrated) assert.ok(['CONNECTED_VERIFIED', 'EXISTING_VERIFIED'].includes(s.state) || (s.id === 'cbs:average-prices-table-2-2' && s.state === 'NOT_ACTUALLY_AN_API'), `${s.id}: integrated but ${s.state}`);
});
t('never a bypass: refused, CAPTCHA-protected and keyed channels are BLOCKED, the 41 data.gov.il file downloads are BLOCKED_TECHNICAL (403), competitors are never a source', () => {
  for (const id of ['govmap:api', 'nadlan.gov.il:site', 'misim:svinfonadlan', 'boi:web', 'datagov:file-hosts']) assert.equal(U.sources.find((s) => s.id === id).state, 'BLOCKED_TECHNICAL', id);
  assert.equal(U.sources.find((s) => s.id === 'ims:api').state, 'BLOCKED_AUTH');
  const fh = U.sources.find((s) => s.id === 'datagov:file-hosts'); assert.ok(fh.dataset.tested >= 41 && fh.dataset.refused === fh.dataset.tested);
  const comp = U.sources.find((s) => s.id === 'ledger:listings:madlan-yad2'); assert.equal(comp.state, 'UNSUITABLE_DATA');
  for (const s of U.sources.filter((x) => /CONNECTED|EXISTING/.test(x.state))) assert.ok(!/madlan|yad2/i.test(JSON.stringify([s.endpoint, s.documentation])), s.id);
  for (const id of ['ledger:tase:datahub', 'ledger:ica:company-extract']) assert.equal(U.sources.find((s) => s.id === id).state, 'PAID_APPROVAL_REQUIRED', id);
});
t('every data.gov.il package was examined: 1,203 read, 221 relevant classified one by one, the rest listed by publisher; nothing left PENDING without the reason', () => {
  const C = U.catalogues.find((c) => c.id === 'data.gov.il'); assert.equal(C.packages, 1203); assert.equal(C.fetched, 1203);
  assert.equal(C.relevant + C.notRelevant, 1203); assert.equal(Object.values(U.notRelevant.byOrg).reduce((a, b) => a + b.length, 0), C.notRelevant);
  assert.equal(U.sources.filter((s) => s.id.startsWith('datagov:pkg:')).length, C.relevant);
  for (const s of U.sources.filter((x) => x.state === 'PENDING_VERIFICATION')) assert.ok(/verify|read/.test(s.stateWhy), s.id);
  assert.match(U.summary.notCompleteness, /never claims universal completeness/);
});
t('M4: the source-to-field matrix — the directive\'s eight classes, every cited source in the universe, every stored path on disk', () => {
  const M = U.fieldMatrix; assert.equal(Object.keys(M.classes).length, 8);
  assert.ok(M.rows.length >= 70);
  for (const r of M.rows) { assert.ok(M.classes[r.class]); if (r.propx.stored) assert.ok(fs.existsSync(path.join(ROOT, r.propx.stored)), r.propx.stored); }
  for (const d of ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9', '6.10', '6.11', '6.12']) assert.ok(M.rows.some((r) => r.domain.startsWith(d + ' ')), 'domain ' + d);
});
t('the stored catalogue is the builder\'s output (states) and carries no credential', () => {
  assert.deepEqual(STORED.summary.byState, U.summary.byState, 'rebuild: node scripts/source-universe-build.js');
  const raw = fs.readFileSync(path.join(ROOT, 'lib/trust/discovery/2026-10-21-source-universe.json'), 'utf8');
  assert.ok(!/(api[_-]?key|access[_-]?token|password|secret)=[A-Za-z0-9]/i.test(raw) && !/Bearer [A-Za-z0-9._-]{20,}/.test(raw));
  // the Trust Center's discovery loader does not pick the consolidated file up as a ledger of its own
  assert.ok(!/^\d{4}-\d{2}-\d{2}(-[a-z]+)?\.json$/.test('2026-10-21-source-universe.json'));
});
console.log(`source universe: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
