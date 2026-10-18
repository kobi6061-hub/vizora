// PROPX · DUE-DILIGENCE SYNC (18.10.2026) — the official corporate / contractor / construction-site / municipal-permit
// sources behind the due-diligence layer, read on a GitHub runner (scripts/dd-sync.js, .github/workflows/dd-sync.yml) and
// kept under data/dd/ as slim, keyed rows. Integrates the INTEGRATE verdicts of lib/trust/discovery/2026-10-18.json.
//
// Lanes (each with its own run state; a failed lane keeps its last file — a refused source never becomes an empty one):
//   companies      the Registrar of Companies (datagov:ica:companies) paged whole; rows KEPT only where the normalized
//                  registered name (lib/entities/resolve.js regKey / lettersKey) equals a PROPX developer's, or the company
//                  number is a registered contractor's entity number — so every kept row is a candidate for an explicit
//                  resolution, never a selection
//   partnerships   the partnerships register (the 45 partnership-kind developers)
//   filings        the filings register (datagov:ica:changes) paged whole; events kept for the kept company numbers —
//                  charge registrations / removals / updates, annual reports, officers, breach updates (dated, verbatim kind)
//   liquidation    the Official Receiver's company-liquidation cases (exact company number; rows with number 0 unusable)
//   voluntaryFast  companies in fast-track voluntary liquidation (exact company number)
//   contractors    the contractors register — every row, slim (MISPAR_KABLAN · MISPAR_YESHUT · name · branch · group · class)
//   sites          the Ministry of Labour's active construction sites (every row, slim) with PROPX first-seen / last-seen
//                  dates (the source has no dates) and the rows that left the list; the closed-site notices
//   strikeoff      the Registrar's companies designated for strike-off (exact company number; publication + expected dates)
//   tlv            Tel Aviv-Yafo IView2: permit requests (layer 772) and supervised sites (layer 499) — MUNICIPAL COVERAGE
//
// history.jsonl (append-only): what changed between two PROPX reads — a company's registered status, a new filing, a new
// liquidation case, a site first seen / no longer listed, a permit stage advanced, a work start dated. The first read of a
// row is never an event (firstRun flagged). Nothing is deleted; a "gone" site is "no longer listed", never "stopped".
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const R = require('../entities/resolve');
const { regKey, skeletonKey, partiesOf } = R;
/** "parcel:<block>/<parcel>" from a free-text site name or a "gush/chelka" field (null when none is written) */
const parcelOf = (t) => { const pc = R.parseParcel(t); return pc ? pc.key : null; };
const parcelsOf = (rows) => [...new Set(rows.map((r) => parcelOf(r.parcel)).filter(Boolean))];
const { kindOf } = require('../entities/names');
const { isRetracted } = require('./retractions');
const { canonicalName, lettersKey } = require('../entities/names');

const VERSION = { id: 'propx-dd-sync-v1', effective: '2026-10-18' };
const UA = 'PROPX-dd-sync/1.0 (+https://github.com/kobi6061-hub/vizora; read-only, official open data)';
const CKAN = 'https://data.gov.il/api/3/action/datastore_search';
const TLV = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer';
const PAGE = 10000, PAGE_MIN = 2000;
const FILES = { companies: 'companies.json', partnerships: 'partnerships.json', filings: 'filings.json', insolvency: 'insolvency.json', contractors: 'contractors.json', sites: 'sites.json', tlv: 'tlv.json', strikeOff: 'strikeoff.json', latest: 'latest.json', runs: 'sync-runs.jsonl', history: 'history.jsonl', historyRecent: 'history-recent.json' };
const HISTORY_DAYS = 180;
const readLines = (f) => { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } const out = []; for (const l of t.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* torn line */ } } return out; };
const SOURCES = {
  companies: { id: 'datagov:ica:companies', resource: 'f004176c-b85f-4542-8901-7b3176f9a054', fields: ['מספר חברה', 'שם חברה', 'סוג תאגיד', 'סטטוס חברה', 'תת סטטוס', 'מפרה', 'שנה אחרונה של דוח שנתי (שהוגש)', 'תאריך התאגדות', 'שם עיר', 'חברה ממשלתית'] },
  partnerships: { id: 'datagov:ica:partnerships', resource: '139aa193-fabb-4f6b-a71b-0bb40fd73eb2', fields: ['מספר שותפות', 'שם שותפות', 'סוג תאגיד', 'סטטוס תאגיד', 'תאריך התאגדות', 'ישוב'] },
  filings: { id: 'datagov:ica:changes', resource: '28780ab5-3ef1-44c7-8377-da82c0aa6781', fields: ['מספר תאגיד', 'סוג בקשה', 'קוד סוג בקשה', 'תאריך עדכון סטטוס', 'מזהה השיעבוד'] },
  liquidation: { id: 'datagov:moj:official-receiver:liquidation', resource: 'd8715392-287f-49b7-9ae3-f21ec5bf55f3', fields: null },
  voluntaryFast: { id: 'datagov:ica:voluntary-liquidation-fast-track', resource: '6f3f0df3-5968-4135-81c5-8dd76bf89410', fields: ['מספר חברה', 'שם חברה', 'סטטוס חברה', 'תת סטטוס', 'אישור בקשת הפירוק', 'מועד החיסול הצפוי', 'מפרה'] },
  contractors: { id: 'datagov:moch:contractors-register', resource: '4eb61bd6-18cf-4e7c-9f9c-e166dfa0a2d8', fields: null },
  sitesActive: { id: 'datagov:labor:active-construction-sites', resource: 'b072e36c-a53b-49e1-be08-4a608fcf4638', fields: null },
  sitesClosed: { id: 'datagov:labor:closed-construction-sites', resource: 'b9257d8f-f93a-4c7d-84dd-e4b0838eadaa', fields: null },
  /* PREMIUM 2.0 (lib/trust/discovery/2026-10-18-premium.json): the Registrar's list of companies designated for strike-off — exact company number */
  strikeOff: { id: 'datagov:ica:designated-strike-off', resource: '0fd312bb-68c9-4647-b186-60c3e7b4f6f7', fields: null },
  tlvPermits: { id: 'tlv:iview2:permits-772', layer: 772, oid: 'oid_permit', fields: ['oid_permit', 'request_num', 'permission_num', 'permission_date', 'expiry_date', 'open_request', 'yechidot_diyur', 'sug_bakasha', 'building_stage', 'request_stage', 'tr_hathalat_bniya', 'finished', 'occupation', 'ms_tik_binyan', 'addresses', 'maslul_rishuy', 'sw_tama_38', 'protected', 'heara_teudat_gmar', 'progress', 'date_import'] },
  tlvSites: { id: 'tlv:iview2:sites-499', layer: 499, oid: 'oid_site', fields: ['oid_site', 'tik_tipul', 'heterim', 'status_pikuach', 'tr_status_pikuach', 'matzav_bniya', 'tr_tchilat_avoda', 'shimush', 'baalei_heter', 'sivug', 'sug_bakasha', 'ktovet', 'ms_tik_binyan', 'gush_chelka', 'date_import'] },
};

const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };
const appendLines = (f, rows) => { if (!rows.length) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const s = (v) => (v == null ? null : String(v).trim() === '' ? null : String(v).trim());
const n = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : null; };
/** dd/mm/yyyy → yyyy-mm-dd (the Registrar's and the Receiver's date format); ISO left alone */
const dmy = (v) => { const t = s(v); if (!t) return null; const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; const i = t.match(/^(\d{4}-\d{2}-\d{2})/); return i ? i[1] : null; };
const epoch = (v) => (v == null ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? new Date(Number(v)).toISOString().slice(0, 10) : null);
const dateOf = () => new Date().toISOString().slice(0, 10);
const shortRead = (lane, scanned, total) => { const e = new Error(`${lane}: short read — ${scanned} of ${total} rows answered`); e.kind = 'PARTIAL'; return e; };
const schemaError = (lane, missing) => { const e = new Error(`${lane}: expected fields missing: ${missing.join(', ')}`); e.kind = 'SCHEMA_CHANGED'; return e; };

/* ---- CKAN paging: the whole table, slowly, kept slim ------------------------------------------------------------- */
async function pageCkan(fetchJson, src, { keep, slim, log, pageSize = PAGE, pause = 1200 }) {
  let offset = 0, total = null, pages = 0, size = pageSize, fieldsSeen = null, kept = [], scanned = 0, estimated = false;
  for (;;) {
    const u = new URL(CKAN); u.searchParams.set('resource_id', src.resource); u.searchParams.set('limit', String(size)); u.searchParams.set('offset', String(offset));
    if (src.fields) u.searchParams.set('fields', src.fields.join(','));
    let r;
    try { r = await fetchJson(u.toString()); } catch (e) { if (size > PAGE_MIN && /413|414|500|502|504|too large|timeout/i.test(String(e.message))) { size = PAGE_MIN; continue; } throw e; }
    const res = r && r.result; if (!res || !Array.isArray(res.records)) throw new Error(`${src.id}: no result.records in the answer`);
    if (fieldsSeen == null) { fieldsSeen = (res.fields || []).map((f) => f.id); const want = src.fields || []; const missing = want.filter((f) => !fieldsSeen.includes(f)); if (missing.length) throw schemaError(src.id, missing); }
    total = res.total ?? total; if (res.total_was_estimated) estimated = true; pages++; scanned += res.records.length;
    for (const row of res.records) { if (!keep || keep(row)) { const x = slim ? slim(row) : row; if (x) kept.push(x); } }
    if (log) log({ lane: src.id, page: pages, offset, got: res.records.length, total, kept: kept.length });
    if (!res.records.length || (total != null && !estimated && offset + res.records.length >= total) || ((total == null || estimated) && res.records.length < size)) break;
    offset += res.records.length; await sleep(pause);
  }
  /* a short read (the server stopped answering rows before its own total) is never a complete table: the lane fails and keeps
     its last file, so a row that simply was not read is never recorded as "gone" or "removed" */
  if (total != null && !estimated && scanned < total) throw shortRead(src.id, scanned, total);
  return { kept, total, pages, scanned, fields: fieldsSeen };
}
/* ---- ArcGIS paging ------------------------------------------------------------------------------------------------ */
async function pageArcgis(fetchJson, src, { slim, log, pause = 500 }) {
  let offset = 0, out = [], pages = 0, fieldsSeen = null, got = 0;
  /* the layer's own row count first — the paged read must reach it (a short read fails the lane) */
  const c = await fetchJson(`${TLV}/${src.layer}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const expected = c && Number.isFinite(Number(c.count)) ? Number(c.count) : null;
  if (expected == null) throw new Error(`${src.id}: no row count in the answer${c && c.error ? ' — ' + JSON.stringify(c.error).slice(0, 200) : ''}`);
  for (;;) {
    const u = `${TLV}/${src.layer}/query?where=1%3D1&outFields=${encodeURIComponent(src.fields.join(','))}&returnGeometry=false&orderByFields=${src.oid}&resultOffset=${offset}&resultRecordCount=1000&f=json`;
    const r = await fetchJson(u); if (!r || !Array.isArray(r.features)) throw new Error(`${src.id}: no features in the answer${r && r.error ? ' — ' + JSON.stringify(r.error).slice(0, 200) : ''}`);
    if (fieldsSeen == null) { fieldsSeen = (r.fields || []).map((f) => f.name); const missing = src.fields.filter((f) => !fieldsSeen.includes(f)); if (missing.length) throw schemaError(src.id, missing); }
    pages++; got += r.features.length; for (const f of r.features) { const x = slim(f.attributes || {}); if (x) out.push(x); }
    if (log) log({ lane: src.id, page: pages, offset, got: r.features.length, kept: out.length });
    if (!r.exceededTransferLimit && r.features.length < 1000) break;
    if (!r.features.length) break;
    offset += r.features.length; await sleep(pause);
  }
  if (got < expected) throw shortRead(src.id, got, expected);
  return { kept: out, pages, fields: fieldsSeen, total: expected, scanned: got };
}

/* ---- the developer keys the companies lane keeps rows for ------------------------------------------------------- */
function developerKeys(devs) {
  const K = { companyReg: new Set(), companyLetters: new Set(), companySkel: new Set(), partnershipReg: new Set(), partnershipLetters: new Set(), partnershipSkel: new Set(), developers: 0 };
  const add = (name, kind) => {
    const rk = regKey(name), lk = lettersKey(canonicalName(name)), sk = skeletonKey(name);
    if (kind === 'partnership') { if (rk) K.partnershipReg.add(rk); if (lk) K.partnershipLetters.add(lk); if (sk) K.partnershipSkel.add(sk); }
    else if (kind === 'company') { if (rk) K.companyReg.add(rk); if (lk) K.companyLetters.add(lk); if (sk) K.companySkel.add(sk); }
  };
  for (const d of devs || []) {
    const name = d.canonical || d.name; if (!name) continue; K.developers++;
    add(name, d.kind);
    /* a joint winner string: every party is a candidate of its own (resolved separately, never as one entity) */
    for (const part of partiesOf(name)) add(part, kindOf(canonicalName(part)));
  }
  return K;
}
const rowKeys = (name) => { const c = canonicalName(String(name || '').replace(/~/g, '"')); return { rk: regKey(c), lk: lettersKey(c), sk: skeletonKey(c) }; };

/* ---- lanes ------------------------------------------------------------------------------------------------------- */
async function laneContractors(ctx) {
  const src = SOURCES.contractors;
  const slim = (r) => ({ kablan: s(r.MISPAR_KABLAN), company: /^\d{8,9}$/.test(String(r.MISPAR_YESHUT || '').trim()) ? String(r.MISPAR_YESHUT).trim() : null, name: s(r.SHEM_YESHUT), city: s(r.SHEM_YISHUV), street: s(r.SHEM_REHOV), house: s(r.MISPAR_BAIT), registered: dmy(r.TAARICH_KABLAN), branchCode: s(r.KOD_ANAF), branch: s(r.TEUR_ANAF), group: s(r.KVUTZA), sivug: s(r.SIVUG), sivugDate: dmy(r.TARICH_SUG), hekef: s(r.HEKEF), recognized: s(r.KABLAN_MUKAR), workers: s(r.OVDIM), note: s(r.HEARA) });
  const pg = await pageCkan(ctx.fetchJson, src, { slim, log: ctx.log, pageSize: 32000 });
  const need = ['MISPAR_KABLAN', 'MISPAR_YESHUT', 'SHEM_YESHUT', 'TEUR_ANAF', 'KVUTZA', 'SIVUG']; const missing = need.filter((f) => !pg.fields.includes(f)); if (missing.length) throw schemaError(src.id, missing);
  const rows = pg.kept.filter((r) => r.kablan);
  return { schema: 'propx-dd-contractors-v1', source: src.id, resource: src.resource, fetchedAt: ctx.now, sourceModified: ctx.modified[src.id] || null, total: pg.total, rows, counts: { rows: rows.length, contractors: new Set(rows.map((r) => r.kablan)).size, withCompanyNumber: new Set(rows.filter((r) => r.company).map((r) => r.company)).size } };
}
async function laneCompanies(ctx, keys, contractorNumbers) {
  const src = SOURCES.companies;
  const keep = (r) => { const num = String(r['מספר חברה'] || '').trim(); if (contractorNumbers.has(num)) return true; const { rk, lk, sk } = rowKeys(r['שם חברה']); return keys.companyReg.has(rk) || keys.companyLetters.has(lk) || keys.companySkel.has(sk); };
  const slim = (r) => ({ num: n(r['מספר חברה']), name: s(r['שם חברה']), type: s(r['סוג תאגיד']), status: s(r['סטטוס חברה']), sub: s(r['תת סטטוס']), violating: s(r['מפרה']), lastReport: n(r['שנה אחרונה של דוח שנתי (שהוגש)']), incorporated: dmy(r['תאריך התאגדות']), city: s(r['שם עיר']), government: s(r['חברה ממשלתית']), kind: 'company' });
  const pg = await pageCkan(ctx.fetchJson, src, { keep, slim, log: ctx.log });
  const rows = pg.kept.filter((r) => r.num != null);
  return { schema: 'propx-dd-companies-v1', source: src.id, resource: src.resource, fetchedAt: ctx.now, sourceModified: ctx.modified[src.id] || null, total: pg.total, scanned: pg.scanned, pages: pg.pages, rows,
    keys: { developers: keys.developers, companyNames: keys.companyReg.size, contractorNumbers: contractorNumbers.size }, counts: { rows: rows.length, byDeveloperName: rows.filter((r) => { const { rk, lk, sk } = rowKeys(r.name); return keys.companyReg.has(rk) || keys.companyLetters.has(lk) || keys.companySkel.has(sk); }).length, byContractorNumber: rows.filter((r) => contractorNumbers.has(String(r.num))).length } };
}
async function lanePartnerships(ctx, keys) {
  const src = SOURCES.partnerships;
  const keep = (r) => { const { rk, lk, sk } = rowKeys(r['שם שותפות']); return keys.partnershipReg.has(rk) || keys.partnershipLetters.has(lk) || keys.partnershipSkel.has(sk); };
  const slim = (r) => ({ num: n(r['מספר שותפות']), name: s(r['שם שותפות']), type: s(r['סוג תאגיד']), status: s(r['סטטוס תאגיד']), incorporated: dmy(r['תאריך התאגדות']), city: s(r['ישוב']), kind: 'partnership' });
  const pg = await pageCkan(ctx.fetchJson, src, { keep, slim, log: ctx.log });
  const rows = pg.kept.filter((r) => r.num != null);
  return { schema: 'propx-dd-partnerships-v1', source: src.id, resource: src.resource, fetchedAt: ctx.now, sourceModified: ctx.modified[src.id] || null, total: pg.total, scanned: pg.scanned, pages: pg.pages, rows, keys: { partnershipNames: keys.partnershipReg.size }, counts: { rows: rows.length } };
}
async function laneFilings(ctx, numbers) {
  const src = SOURCES.filings;
  const keep = (r) => numbers.has(String(r['מספר תאגיד'] || '').trim());
  const slim = (r) => ({ num: n(r['מספר תאגיד']), kind: s(r['סוג בקשה']), kindCode: n(r['קוד סוג בקשה']), date: dmy(r['תאריך עדכון סטטוס']), chargeId: n(r['מזהה השיעבוד']) });
  const pg = await pageCkan(ctx.fetchJson, src, { keep, slim, log: ctx.log });
  const rows = pg.kept.filter((r) => r.num != null && r.kind);
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return { schema: 'propx-dd-filings-v1', source: src.id, resource: src.resource, fetchedAt: ctx.now, sourceModified: ctx.modified[src.id] || null, total: pg.total, scanned: pg.scanned, pages: pg.pages, rows, window: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null, counts: { rows: rows.length, companies: new Set(rows.map((r) => r.num)).size, charges: rows.filter((r) => /שעבוד/.test(r.kind)).length } };
}
async function laneInsolvency(ctx, numbers) {
  const L = SOURCES.liquidation, V = SOURCES.voluntaryFast;
  const keepL = (r) => numbers.has(String(r['מספר זיהוי של החברה'] || '').trim());
  const slimL = (r) => ({ caseId: n(r['מזהה תיק פירוק חברה']), num: n(r['מספר זיהוי של החברה']), name: s(r['שם החברה']), city: s(r['עיר פעילות חברה']), status: s(r['סטטוס תיק']), requested: dmy(r['תאריך הגשת הבקשה']), orderDate: dmy(r['תאריך קבלת צו פירוק']), stayDate: dmy(r['תאריך ביטול / הקפאת צו פירוק']), closed: dmy(r['תאריך סגירת תיק']), closeReason: s(r['סיבת סגירה']), court: s(r['בית משפט מחוזי בו מתנהל התיק']) });
  const pl = await pageCkan(ctx.fetchJson, L, { keep: keepL, slim: slimL, log: ctx.log });
  const needL = ['מזהה תיק פירוק חברה', 'סטטוס תיק', 'שם החברה', 'מספר זיהוי של החברה']; const mL = needL.filter((f) => !pl.fields.includes(f)); if (mL.length) throw schemaError(L.id, mL);
  const keepV = (r) => numbers.has(String(r['מספר חברה'] || '').trim());
  const slimV = (r) => ({ num: n(r['מספר חברה']), name: s(r['שם חברה']), status: s(r['סטטוס חברה']), sub: s(r['תת סטטוס']), approved: dmy(r['אישור בקשת הפירוק']), expectedDissolution: dmy(r['מועד החיסול הצפוי']), violating: s(r['מפרה']) });
  const pv = await pageCkan(ctx.fetchJson, V, { keep: keepV, slim: slimV, log: ctx.log });
  return { schema: 'propx-dd-insolvency-v1', fetchedAt: ctx.now,
    liquidation: { source: L.id, resource: L.resource, sourceModified: ctx.modified[L.id] || null, total: pl.total, scanned: pl.scanned, rows: pl.kept.filter((r) => r.num), counts: { rows: pl.kept.length } },
    voluntaryFast: { source: V.id, resource: V.resource, sourceModified: ctx.modified[V.id] || null, total: pv.total, scanned: pv.scanned, rows: pv.kept.filter((r) => r.num != null), counts: { rows: pv.kept.length } } };
}
/* the companies designated for strike-off (מאגר החברות המיועדות למחיקה): rows of the kept companies only, with the publication and
   expected strike-off dates — a registry status fact, never insolvency */
async function laneStrikeOff(ctx, numbers) {
  const src = SOURCES.strikeOff;
  const pick = (row, re) => { const k = Object.keys(row).find((x) => re.test(x)); return k ? row[k] : null; };
  const slim = (r) => ({ num: n(pick(r, /^מספר התאגיד$/)), name: s(pick(r, /^שם התאגיד$/)), type: s(pick(r, /^סוג תאגיד$/)), status: s(pick(r, /^סטטוס התאגיד$/)), sub: s(pick(r, /^תת סטטוס התאגיד$/)),
    published: dmy(pick(r, /פרסום/)), expected: dmy(pick(r, /הצפוי/)) });
  const pg = await pageCkan(ctx.fetchJson, src, { keep: (r) => numbers.has(String(n(pick(r, /^מספר התאגיד$/)))), slim, log: ctx.log, pageSize: 10000 });
  const need = ['מספר התאגיד', 'סטטוס התאגיד']; const miss = need.filter((f) => !(pg.fields || []).includes(f)); if (miss.length) throw schemaError(src.id, miss);
  if (!(pg.fields || []).some((f) => /פרסום/.test(f)) || !(pg.fields || []).some((f) => /הצפוי/.test(f))) throw schemaError(src.id, ['publication date', 'expected strike-off date']);
  const rows = pg.kept.filter((r) => r.num);
  return { schema: 'propx-dd-strikeoff-v1', source: src.id, resource: src.resource, fetchedAt: ctx.now, sourceModified: ctx.modified[src.id] || null, total: pg.total, scanned: pg.scanned, rows, counts: { rows: rows.length } };
}
async function laneSites(ctx, prev) {
  const A = SOURCES.sitesActive, C = SOURCES.sitesClosed, today = ctx.now.slice(0, 10);
  const slimA = (r) => ({ workId: n(r.work_id), name: s(r.site_name), executorName: s(r.executor_name), executorId: n(r.executor_id), foreman: s(r.foreman_name), cranes: n(r.has_cranes), city: s(r.city_name), buildTypes: s(r.build_types), warrants: n(r.safety_warrents), sanctions: n(r.sanctions), sanctionsSum: n(r.sanctions_sum) });
  const pa = await pageCkan(ctx.fetchJson, A, { slim: slimA, log: ctx.log, pageSize: 32000 });
  const needA = ['work_id', 'site_name', 'executor_id', 'city_name']; const mA = needA.filter((f) => !pa.fields.includes(f)); if (mA.length) throw schemaError(A.id, mA);
  const prevActive = new Map(((prev && prev.active) || []).map((r) => [String(r.workId), r])), prevGone = new Map(((prev && prev.gone) || []).map((r) => [String(r.workId), r]));
  const active = []; const seen = new Set();
  for (const r of pa.kept) { if (r.workId == null) continue; const k = String(r.workId); if (seen.has(k)) continue; seen.add(k); const p = prevActive.get(k) || prevGone.get(k); active.push({ ...r, firstSeen: p ? p.firstSeen : today, lastSeen: today, relisted: !!(prevGone.get(k) && !prevActive.get(k)) || undefined }); }
  const gone = [...prevGone.values()].filter((r) => !seen.has(String(r.workId)));
  for (const [k, r] of prevActive) if (!seen.has(k)) gone.push({ ...r, lastSeen: r.lastSeen, notListedSince: today });
  const slimC = (r) => ({ name: s(r.workName), executorName: s(r.executorName), from: dmy(r.fromDate) });
  const pc = await pageCkan(ctx.fetchJson, C, { slim: slimC, log: ctx.log, pageSize: 32000 });
  const closed = pc.kept.filter((r) => r.name || r.executorName);
  return { schema: 'propx-dd-sites-v1', fetchedAt: ctx.now, firstRun: !prev,
    source: A.id, resource: A.resource, sourceModified: ctx.modified[A.id] || null, total: pa.total, active, gone,
    closed: { source: C.id, resource: C.resource, sourceModified: ctx.modified[C.id] || null, total: pc.total, rows: closed },
    counts: { active: active.length, withExecutorId: active.filter((r) => r.executorId != null).length, gone: gone.length, closed: closed.length, cities: new Set(active.map((r) => r.city).filter(Boolean)).size } };
}
async function laneTlv(ctx) {
  const P = SOURCES.tlvPermits, S = SOURCES.tlvSites;
  const slimP = (a) => ({ oid: a.oid_permit, request: n(a.request_num), permit: n(a.permission_num) || null, permitDate: epoch(a.permission_date), expiry: epoch(a.expiry_date), opened: epoch(a.open_request), units: n(a.yechidot_diyur), type: s(a.sug_bakasha), stage: s(a.building_stage), requestStage: s(a.request_stage), start: epoch(a.tr_hathalat_bniya), finished: s(a.finished), occupation: s(a.occupation), file: n(a.ms_tik_binyan), addresses: s(a.addresses), track: s(a.maslul_rishuy), tama38: s(a.sw_tama_38), protectedBuilding: n(a.protected), completionNote: s(a.heara_teudat_gmar), progress: n(a.progress), imported: s(a.date_import) });
  const pp = await pageArcgis(ctx.fetchJson, P, { slim: slimP, log: ctx.log });
  const slimS = (a) => ({ oid: a.oid_site, tik: s(a.tik_tipul), permits: String(a.heterim || '').split(/\s*,\s*/).map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number), supervision: s(a.status_pikuach), supervisionDate: epoch(a.tr_status_pikuach), state: s(a.matzav_bniya), start: epoch(a.tr_tchilat_avoda), use: s(a.shimush), holders: s(a.baalei_heter), sivug: s(a.sivug), type: s(a.sug_bakasha), address: s(a.ktovet), file: n(a.ms_tik_binyan), parcel: s(a.gush_chelka), imported: s(a.date_import) });
  const ps = await pageArcgis(ctx.fetchJson, S, { slim: slimS, log: ctx.log });
  const imported = (pp.kept[0] && pp.kept[0].imported) || null;
  return { schema: 'propx-dd-tlv-v1', fetchedAt: ctx.now, coverage: 'TEL AVIV MUNICIPAL COVERAGE',
    permits: { source: P.id, layer: P.layer, imported, rows: pp.kept.filter((r) => r.request != null), counts: { rows: pp.kept.length, withPermit: pp.kept.filter((r) => r.permitDate).length, withStart: pp.kept.filter((r) => r.start).length } },
    sites: { source: S.id, layer: S.layer, imported: (ps.kept[0] && ps.kept[0].imported) || null, rows: ps.kept.filter((r) => r.tik), counts: { rows: ps.kept.length, withParcel: ps.kept.filter((r) => r.parcel).length, withStart: ps.kept.filter((r) => r.start).length } } };
}

/* ---- history: what changed between two PROPX reads ---------------------------------------------------------------- */
function diffCompanies(prev, next, at) {
  const ev = []; if (!prev || !prev.rows) return ev;
  const P = new Map(prev.rows.map((r) => [String(r.num), r]));
  for (const r of next.rows) { const p = P.get(String(r.num)); if (!p) continue;
    if ((p.status || null) !== (r.status || null)) ev.push({ at, lane: 'companies', event: 'company-status-changed', key: 'co:' + r.num, name: r.name, old: p.status, new: r.status, sourceDate: next.sourceModified });
    if (!!/מפרה/.test(p.violating || '') !== !!/מפרה/.test(r.violating || '')) ev.push({ at, lane: 'companies', event: 'company-breach-flag-changed', key: 'co:' + r.num, name: r.name, old: p.violating || null, new: r.violating || null, sourceDate: next.sourceModified });
    if ((p.sub || null) !== (r.sub || null)) ev.push({ at, lane: 'companies', event: 'company-sub-status-changed', key: 'co:' + r.num, name: r.name, old: p.sub || null, new: r.sub || null, sourceDate: next.sourceModified });
    /* a later year = a newer annual report on file; any other change (an earlier year, a cleared value) is a CHANGE, never "advanced" */
    if ((p.lastReport || null) !== (r.lastReport || null)) ev.push({ at, lane: 'companies', event: r.lastReport && (!p.lastReport || r.lastReport > p.lastReport) ? 'annual-report-year-advanced' : 'annual-report-year-changed', key: 'co:' + r.num, name: r.name, old: p.lastReport || null, new: r.lastReport || null, sourceDate: next.sourceModified }); }
  return ev;
}
/** the Registrar's verbatim filing kind → a PROPX event name. Order matters: "ביטול סילוק שעבוד" (a removal CANCELLED — the charge
    stands again) is tested before "סילוק שעבוד"; a bare "דו״ח שנתי" is the annual report itself, "דו״ח שנתי-<detail>" a change
    reported with it (an officer, an address …) — never "a new annual report". An attachment-order filing is a lien on shares,
    never insolvency. */
function filingEvent(kind) {
  const k = String(kind || '');
  if (/ביטול\s+סילוק\s+שעבוד/.test(k)) return 'charge-removal-cancelled';
  if (/רישום\s+שעבוד/.test(k)) return 'charge-registered';
  if (/סילוק\s+שעבוד/.test(k)) return 'charge-removed';
  if (/שעבוד/.test(k)) return 'charge-updated';
  if (/הפרה/.test(k)) return 'breach-update';
  if (/^\s*דו.ח שנתי\s*$/.test(k)) return 'annual-report-filed';
  if (/^\s*דו.ח שנתי\s*-/.test(k)) return 'annual-report-update';
  if (/צו עיקול/.test(k)) return 'attachment-order-filing';
  if (/פירוק מרצון|חיסול מרצון/.test(k)) return 'voluntary-liquidation-filing';
  return 'filing-observed';
}
const filingKey = (r) => [r.num, r.kindCode ?? r.kind, r.date, r.chargeId ?? ''].join('|');
/* only a company kept in the PREVIOUS read can produce an event: the first read of a newly kept company is a baseline */
function diffFilings(prev, next, at, prevKept = null) {
  const ev = []; if (!prev || !prev.rows) return ev;
  const P = new Set(prev.rows.map(filingKey));
  for (const r of next.rows) if (!P.has(filingKey(r)) && (!prevKept || prevKept.has(String(r.num)))) ev.push({ at, lane: 'filings', event: filingEvent(r.kind), key: 'co:' + r.num, kind: r.kind, chargeId: r.chargeId, sourceDate: r.date });
  return ev;
}
function diffInsolvency(prev, next, at, prevKept = null) {
  const ev = []; if (!prev) return ev;
  const PL = new Map(((prev.liquidation || {}).rows || []).map((r) => [String(r.caseId), r]));
  const known = (num) => !prevKept || prevKept.has(String(num));
  for (const r of next.liquidation.rows) { const p = PL.get(String(r.caseId)); if (!p && !known(r.num)) continue; if (!p) ev.push({ at, lane: 'insolvency', event: 'liquidation-case-observed', key: 'co:' + r.num, caseId: r.caseId, status: r.status, sourceDate: r.requested || r.orderDate || null }); else if ((p.status || null) !== (r.status || null)) ev.push({ at, lane: 'insolvency', event: 'liquidation-status-changed', key: 'co:' + r.num, caseId: r.caseId, old: p.status, new: r.status, sourceDate: r.closed || r.stayDate || r.orderDate || null }); }
  const PV = new Set(((prev.voluntaryFast || {}).rows || []).map((r) => String(r.num)));
  for (const r of next.voluntaryFast.rows) if (!PV.has(String(r.num)) && known(r.num)) ev.push({ at, lane: 'insolvency', event: 'voluntary-liquidation-observed', key: 'co:' + r.num, status: r.status, sub: r.sub, sourceDate: r.approved || null });
  return ev;
}
function diffStrikeOff(prev, next, at, prevKept = null) {
  const ev = []; if (!prev || !prev.rows) return ev;
  const P = new Map(prev.rows.map((r) => [String(r.num), r])), N = new Map(next.rows.map((r) => [String(r.num), r]));
  for (const [k, r] of N) { const p = P.get(k); if (!p) { if (!prevKept || prevKept.has(k)) ev.push({ at, lane: 'strikeoff', event: 'strike-off-designation-observed', key: 'co:' + k, name: r.name, expected: r.expected, sourceDate: r.published }); continue; }
    if ((p.expected || null) !== (r.expected || null)) ev.push({ at, lane: 'strikeoff', event: 'strike-off-date-changed', key: 'co:' + k, old: p.expected || null, new: r.expected || null, sourceDate: r.published }); }
  for (const [k, p] of P) if (!N.has(k)) ev.push({ at, lane: 'strikeoff', event: 'strike-off-designation-no-longer-listed', key: 'co:' + k, name: p.name, old: p.expected || null, sourceDate: null });
  return ev;
}
function diffSites(prev, next, at) {
  const ev = []; if (!prev || !prev.active) return ev;
  const P = new Map(prev.active.map((r) => [String(r.workId), r]));
  for (const r of next.active) { const p = P.get(String(r.workId)); if (!p) ev.push({ at, lane: 'sites', event: r.relisted ? 'site-relisted' : 'site-first-seen', key: 'site:labor:' + r.workId, name: r.name, city: r.city, executorId: r.executorId, executorName: r.executorName, parcel: parcelOf(r.name), sourceDate: null });
    else { if ((p.executorId || null) !== (r.executorId || null)) ev.push({ at, lane: 'sites', event: 'site-executor-changed', key: 'site:labor:' + r.workId, executorId: r.executorId, oldExecutorId: p.executorId, old: p.executorId || null, new: r.executorId || null, parcel: parcelOf(r.name), sourceDate: null });
      if ((p.sanctions || 0) !== (r.sanctions || 0) || (p.warrants || 0) !== (r.warrants || 0)) ev.push({ at, lane: 'sites', event: 'site-enforcement-changed', key: 'site:labor:' + r.workId, executorId: r.executorId, parcel: parcelOf(r.name), old: { sanctions: p.sanctions || 0, warrants: p.warrants || 0 }, new: { sanctions: r.sanctions || 0, warrants: r.warrants || 0 }, sourceDate: null }); } }
  const N = new Set(next.active.map((r) => String(r.workId)));
  for (const [k, p] of P) if (!N.has(k)) ev.push({ at, lane: 'sites', event: 'site-no-longer-listed', key: 'site:labor:' + k, name: p.name, city: p.city, executorId: p.executorId, executorName: p.executorName, parcel: parcelOf(p.name), sourceDate: null });
  const PC = new Set(((prev.closed || {}).rows || []).map((r) => [r.name, r.executorName, r.from].join('|')));
  for (const r of next.closed.rows) if (!PC.has([r.name, r.executorName, r.from].join('|'))) ev.push({ at, lane: 'sites', event: 'site-closure-notice', key: 'closed:' + sha([r.name, r.executorName, r.from]).slice(0, 12), name: r.name, executorName: r.executorName, executorKey: R.regKey(r.executorName) || null, parcel: parcelOf(r.name), sourceDate: r.from });
  return ev;
}
function diffTlv(prev, next, at) {
  const ev = []; if (!prev || !prev.permits) return ev;
  /* several rows can carry one request (buildings) / one supervision file: compare the GROUPS, never row against row */
  const group = (rows, key) => { const m = new Map(); for (const r of rows || []) { const k = String(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const stages = (rs, f) => rs.map((r) => r[f] || '').sort().join('|');
  const first = (rs, f) => rs.map((r) => r[f]).filter(Boolean).sort()[0] || null;
  const P = group(prev.permits.rows, 'request'), N = group(next.permits.rows, 'request');
  for (const [k, rs] of N) { const ps = P.get(k);
    if (!ps) { ev.push({ at, lane: 'tlv', event: 'permit-request-observed', key: 'permit:tlv:' + k, stage: rs[0].stage, units: rs[0].units, sourceDate: first(rs, 'opened') }); continue; }
    if (stages(ps, 'stage') !== stages(rs, 'stage')) ev.push({ at, lane: 'tlv', event: 'permit-stage-changed', key: 'permit:tlv:' + k, old: [...new Set(ps.map((r) => r.stage))].join(' · '), new: [...new Set(rs.map((r) => r.stage))].join(' · '), sourceDate: rs[0].imported ? dmy(rs[0].imported) : null });
    if (!first(ps, 'permitDate') && first(rs, 'permitDate')) ev.push({ at, lane: 'tlv', event: 'permit-issued', key: 'permit:tlv:' + k, permit: rs.find((r) => r.permitDate).permit, sourceDate: first(rs, 'permitDate') });
    if (!first(ps, 'start') && first(rs, 'start')) ev.push({ at, lane: 'tlv', event: 'construction-start-dated', key: 'permit:tlv:' + k, sourceDate: first(rs, 'start') }); }
  const PS = group(prev.sites.rows, 'tik'), NS = group(next.sites.rows, 'tik');
  for (const [k, rs] of NS) { const ps = PS.get(k);
    if (!ps) { ev.push({ at, lane: 'tlv', event: 'site-observed', key: 'site:tlv:' + k, parcel: rs[0].parcel, parcels: parcelsOf(rs), state: rs[0].state, sourceDate: first(rs, 'start') }); continue; }
    if (stages(ps, 'state') !== stages(rs, 'state')) ev.push({ at, lane: 'tlv', event: 'site-state-changed', key: 'site:tlv:' + k, parcels: parcelsOf(rs), old: [...new Set(ps.map((r) => r.state))].join(' · '), new: [...new Set(rs.map((r) => r.state))].join(' · '), sourceDate: first(rs, 'supervisionDate') });
    if (!first(ps, 'start') && first(rs, 'start')) ev.push({ at, lane: 'tlv', event: 'work-start-dated', key: 'site:tlv:' + k, parcels: parcelsOf(rs), sourceDate: first(rs, 'start') }); }
  return ev;
}

/* ---- the run ------------------------------------------------------------------------------------------------------ */
const errKind = (e) => (e && e.kind) || (/HTTP 40[13]/.test(String(e && e.message)) ? 'REFUSED' : 'FAILED');
async function runSync({ fetchJson, devs, dir, now = new Date().toISOString(), lanes = null, modified = {}, log = null, dryRun = false }) {
  const ctx = { fetchJson, now, modified, log };
  const want = (l) => !lanes || lanes.includes(l);
  const prevOf = (f) => readJson(path.join(dir, f));
  const states = {}, written = [], events = [], errors = {};
  const keys = developerKeys(devs);
  const settle = async (lane, fn) => { try { const out = await fn(); return out; } catch (e) { states[lane] = errKind(e); errors[lane] = String(e && e.message || e).slice(0, 300); if (log) log({ lane, error: errors[lane] }); return null; } };
  /* the companies / partnerships kept by the PREVIOUS read — only those can produce filing / insolvency events */
  const prevKept = (() => { const a = prevOf(FILES.companies), b = prevOf(FILES.partnerships); if (!a && !b) return null; return new Set([...((a && a.rows) || []), ...((b && b.rows) || [])].map((r) => String(r.num))); })();
  const commit = (lane, file, payload, diff) => {
    if (!payload) return; const prev = prevOf(file); const prevHash = prev ? sha({ ...prev, fetchedAt: null, firstRun: null }) : null, nextHash = sha({ ...payload, fetchedAt: null, firstRun: null });
    const ev = diff && prev ? diff(prev, payload, now, prevKept) : []; if (!prev) ev.push({ at: now, lane, event: 'first-read', key: 'lane:' + lane, note: 'the first read of this source is a baseline, never a change' });
    events.push(...ev); states[lane] = prevHash === nextHash ? 'UNCHANGED' : 'SUCCESS';
    if (!dryRun && states[lane] === 'SUCCESS') { writeJson(path.join(dir, file), payload); written.push(file); }
  };
  /* contractors first: their entity numbers widen the registry rows kept */
  let contractors = want('contractors') ? await settle('contractors', () => laneContractors(ctx)) : prevOf(FILES.contractors);
  if (want('contractors')) commit('contractors', FILES.contractors, contractors, null);
  if (!contractors) contractors = prevOf(FILES.contractors);
  const contractorNumbers = new Set(((contractors && contractors.rows) || []).map((r) => r.company).filter(Boolean));
  let companies = want('companies') ? await settle('companies', () => laneCompanies(ctx, keys, contractorNumbers)) : prevOf(FILES.companies);
  if (want('companies')) commit('companies', FILES.companies, companies, diffCompanies);
  if (!companies) companies = prevOf(FILES.companies);
  let partnerships = want('partnerships') ? await settle('partnerships', () => lanePartnerships(ctx, keys)) : prevOf(FILES.partnerships);
  if (want('partnerships')) commit('partnerships', FILES.partnerships, partnerships, diffCompanies);
  const numbers = new Set([...(((companies && companies.rows) || []).map((r) => String(r.num))), ...(((partnerships && partnerships.rows) || []).map((r) => String(r.num)))]);
  if (want('filings')) { const out = numbers.size ? await settle('filings', () => laneFilings(ctx, numbers)) : null; if (!numbers.size) { states.filings = 'FAILED'; errors.filings = 'no company numbers to read filings for (the companies lane has not succeeded)'; } commit('filings', FILES.filings, out, diffFilings); }
  if (want('insolvency')) { const out = numbers.size ? await settle('insolvency', () => laneInsolvency(ctx, numbers)) : null; if (!numbers.size) { states.insolvency = 'FAILED'; errors.insolvency = 'no company numbers'; } commit('insolvency', FILES.insolvency, out, diffInsolvency); }
  if (want('strikeoff')) { const out = numbers.size ? await settle('strikeoff', () => laneStrikeOff(ctx, numbers)) : null; if (!numbers.size) { states.strikeoff = 'FAILED'; errors.strikeoff = 'no company numbers'; } commit('strikeoff', FILES.strikeOff, out, diffStrikeOff); }
  if (want('sites')) { const prev = prevOf(FILES.sites); const out = await settle('sites', () => laneSites(ctx, prev)); commit('sites', FILES.sites, out, diffSites); }
  if (want('tlv')) { const out = await settle('tlv', () => laneTlv(ctx)); commit('tlv', FILES.tlv, out, diffTlv); }
  const vals = Object.values(states); const ok = vals.filter((v) => v === 'SUCCESS' || v === 'UNCHANGED').length;
  const status = !vals.length ? 'FAILED' : ok === vals.length ? (vals.every((v) => v === 'UNCHANGED') ? 'UNCHANGED' : 'SUCCESS') : ok === 0 ? (vals.every((v) => v === 'REFUSED') ? 'REFUSED' : vals.some((v) => v === 'SCHEMA_CHANGED') ? 'SCHEMA_CHANGED' : 'FAILED') : 'PARTIAL';
  const run = { at: now, version: VERSION.id, status, lanes: states, errors: Object.keys(errors).length ? errors : undefined, written, events: events.length, dryRun: dryRun || undefined };
  if (!dryRun) {
    appendLines(path.join(dir, FILES.runs), [run]);
    appendLines(path.join(dir, FILES.history), events.filter((e) => e.event !== 'first-read'));
    /* the bundled window of the ledger (the page's function bundle cannot read a .jsonl): the last HISTORY_DAYS days, newest first */
    const cutoff = new Date(Date.parse(now) - HISTORY_DAYS * 86400e3).toISOString();
    const recent = readLines(path.join(dir, FILES.history)).filter((e) => e && e.at && e.at >= cutoff && !isRetracted(e)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    writeJson(path.join(dir, FILES.historyRecent), { schema: 'propx-dd-history-recent-v1', generatedAt: now, days: HISTORY_DAYS, events: recent });
    const C = readJson(path.join(dir, FILES.companies)), P = readJson(path.join(dir, FILES.partnerships)), F = readJson(path.join(dir, FILES.filings)), I = readJson(path.join(dir, FILES.insolvency)), K = readJson(path.join(dir, FILES.contractors)), S = readJson(path.join(dir, FILES.sites)), T = readJson(path.join(dir, FILES.tlv));
    writeJson(path.join(dir, FILES.latest), { schema: 'propx-dd-latest-v1', version: VERSION.id, generatedAt: now, run: { at: now, status, lanes: states },
      companies: C ? { fetchedAt: C.fetchedAt, sourceModified: C.sourceModified, total: C.total, kept: C.rows.length, counts: C.counts } : null,
      partnerships: P ? { fetchedAt: P.fetchedAt, sourceModified: P.sourceModified, total: P.total, kept: P.rows.length } : null,
      filings: F ? { fetchedAt: F.fetchedAt, sourceModified: F.sourceModified, total: F.total, kept: F.rows.length, window: F.window, counts: F.counts } : null,
      insolvency: I ? { fetchedAt: I.fetchedAt, liquidation: { total: I.liquidation.total, kept: I.liquidation.rows.length, sourceModified: I.liquidation.sourceModified }, voluntaryFast: { total: I.voluntaryFast.total, kept: I.voluntaryFast.rows.length, sourceModified: I.voluntaryFast.sourceModified } } : null,
      contractors: K ? { fetchedAt: K.fetchedAt, sourceModified: K.sourceModified, total: K.total, counts: K.counts } : null,
      sites: S ? { fetchedAt: S.fetchedAt, sourceModified: S.sourceModified, total: S.total, counts: S.counts } : null,
      strikeOff: (() => { const X = readJson(path.join(dir, FILES.strikeOff)); return X ? { fetchedAt: X.fetchedAt, sourceModified: X.sourceModified, total: X.total, kept: X.rows.length } : null; })(),
      tlv: T ? { fetchedAt: T.fetchedAt, permits: { imported: T.permits.imported, counts: T.permits.counts }, sites: { imported: T.sites.imported, counts: T.sites.counts } } : null });
  }
  return { ...run, eventsList: events };
}
const exitCodeOf = (status) => (status === 'SUCCESS' || status === 'UNCHANGED' ? 0 : status === 'PARTIAL' ? 2 : 1);

module.exports = { VERSION, UA, CKAN, TLV, FILES, SOURCES, runSync, exitCodeOf, developerKeys, pageCkan, pageArcgis, diffCompanies, diffFilings, diffInsolvency, diffStrikeOff, diffSites, diffTlv, dmy, epoch };
