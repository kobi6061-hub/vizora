// PROPX · Urban renewal — normalization of the Ministry's complex rows.
//
// The resource pads its text columns with spaces (fixed-width export): every text is trimmed and its inner whitespace
// collapsed; nothing else is changed. Numbers are taken only when the cell is a plain number ("" and text → null,
// never 0). The Ministry's status is kept VERBATIM beside a stage mapped from the exact status strings observed on
// 13.10.2026; an unknown status maps to "unknown" (shown verbatim), never guessed. A declared complex is not
// construction: no stage here says construction started or completed.

'use strict';

const { createHash } = require('node:crypto');
const { SOURCE } = require('./source');

const NORMALIZER_VERSION = 2;
/* the columns the normalizer cannot work without — a renamed column fails the run instead of nulling a field */
const REQUIRED_COLUMNS = ['MisparMitham', 'Yeshuv', 'SemelYeshuv', 'ShemMitcham', 'YachadKayam', 'YachadTosafti', 'YachadMutza', 'TaarichHachraza', 'MisparTochnit', 'Maslul', 'Status'];

/* the Ministry's statuses (exact, whitespace-collapsed) → the PROPX renewal stage; order = how far the complex went */
const STATUS_STAGE = {
  'תכנון ראשוני': 'planning-initial',
  'תכנון סטטוטורי': 'planning-statutory',
  'תכנית מאושרת לפני מימוש': 'approved',
  'תכנית מאושרת במימוש': 'approved-in-implementation',
  'תכנית מאושרת - אחרי רישוי': 'approved-after-licensing',
};
const STAGES = ['declared', 'planning-initial', 'planning-statutory', 'approved', 'approved-in-implementation', 'approved-after-licensing'];

const text = (v) => { if (v === null || v === undefined) return null; const s = String(v).replace(/\s+/g, ' ').trim(); return s || null; };
function num(v) {
  const s = text(v); if (s === null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return null;
  const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : null;
}
/** "20/08/2006" | "2006-08-20…" → "2006-08-20"; anything else → null (kept verbatim in raw) */
function day(v) {
  const s = text(v); if (!s) return null;
  let m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) { const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isValidDay(d) ? d : null; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m && isValidDay(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const isValidDay = (d) => { const t = Date.parse(d + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d && d >= '1990-01-01' && d <= '2100-01-01'; };
const url = (v) => { const s = text(v); return s && /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null; };
const year = (v) => { const s = text(v); const m = s && /^(19|20)\d{2}$/.exec(s); return m ? Number(s) : null; };
const planKey = (p) => String(p || '').replace(/\s+/g, '').trim();

function hashRows(rows) { return createHash('sha1').update(JSON.stringify(rows)).digest('hex'); }

/** One source row → {record} or {error}. */
function normalizeRow(row, ctx) {
  const complexId = num(row && row.MisparMitham);
  if (complexId === null || !Number.isInteger(complexId)) return { error: 'missing or non-integer MisparMitham' };
  const statusHe = text(row.Status);
  const stage = statusHe && STATUS_STAGE[statusHe] ? STATUS_STAGE[statusHe] : statusHe ? 'unknown' : 'declared';
  const existingUnits = num(row.YachadKayam), additionalUnits = num(row.YachadTosafti), proposedUnits = num(row.YachadMutza);
  const record = {
    id: `renewal:${complexId}`, complexId,
    localityCode: num(row.SemelYeshuv), city: text(row.Yeshuv), name: text(row.ShemMitcham),
    existingUnits, additionalUnits, proposedUnits,
    /* the three unit columns as the Ministry publishes them; whether proposed = existing + additional is reported, never forced */
    unitsAddUp: existingUnits !== null && additionalUnits !== null && proposedUnits !== null ? existingUnits + additionalUnits === proposedUnits : null,
    declarationDate: day(row.TaarichHachraza), declarationRaw: text(row.TaarichHachraza),
    planNumber: text(row.MisparTochnit), planKey: text(row.MisparTochnit) ? planKey(row.MisparTochnit) : null,
    track: text(row.Maslul), approvalYear: year(row.ShnatMatanTokef), approvalYearRaw: text(row.ShnatMatanTokef),
    /* declared only with a declaration date; the Ministry writes "טרם הוכרז" (not yet declared) in the track column */
    declaration: day(row.TaarichHachraza) ? 'declared' : text(row.Maslul) === 'טרם הוכרז' ? 'not-yet-declared' : 'not-stated',
    executionRaw: text(row.Bebitzua), permitsRaw: text(row.SachHeterim),
    statusHe, stage,
    links: { site: url(row.KishurLatar), map: url(row.KishurLaMapa) },
    provenance: { source: SOURCE.id, resourceId: SOURCE.resourceId, sourceRowId: row._id ?? null, sourceUpdatedAt: ctx.sourceUpdatedAt || null,
      fetchedAt: ctx.fetchedAt, snapshotHash: ctx.snapshotHash ? String(ctx.snapshotHash).slice(0, 12) : null, retrievalMethod: ctx.retrievalMethod || 'live-api', classification: 'OFFICIAL' },
  };
  record.missing = ['localityCode', 'name', 'existingUnits', 'additionalUnits', 'proposedUnits', 'declarationDate', 'planNumber', 'track', 'statusHe'].filter((k) => record[k] === null);
  return { record };
}

function normalizeAll(rows, ctx) {
  const records = [], rejected = [], seen = new Set();
  for (const row of rows) {
    const r = normalizeRow(row, ctx);
    if (r.error) { rejected.push({ rowId: row && row._id, error: r.error }); continue; }
    if (seen.has(r.record.id)) { rejected.push({ rowId: row._id, error: 'duplicate MisparMitham ' + r.record.complexId }); continue; }
    seen.add(r.record.id); records.push(r.record);
  }
  return { records, rejected };
}

/* fields whose change is a history event */
const HISTORY_FIELDS = ['declaration', 'statusHe', 'stage', 'existingUnits', 'additionalUnits', 'proposedUnits', 'planNumber', 'approvalYear', 'executionRaw', 'permitsRaw', 'track', 'name', 'declarationDate'];

module.exports = { normalizeRow, normalizeAll, hashRows, planKey, REQUIRED_COLUMNS, STATUS_STAGE, STAGES, HISTORY_FIELDS, NORMALIZER_VERSION, text, num, day };
