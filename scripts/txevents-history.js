#!/usr/bin/env node
// PROPX · THE GOVMAP-LAYER HISTORY — every row of the layer's published file dated BEFORE the register copy's stored window (closure P0,
// 20.10.2026). The stored window (36 months) was an optimization boundary, not the meaning of ALL: the layer reaches back to 1998.
//
//   node scripts/txevents-history.js --build --extract <dir>      (dir = scripts/txevents-gpkg.py --history-to <window.from>)
//
// Every pre-window row ends in exactly ONE class (data/txevents/history/meta.json → classes, per year):
//   INVALID_DATE            no date / a placeholder before 1990 (kept verbatim in invalid.json)
//   DUPLICATE_IN_SOURCE     the layer prints the same deal twice (its untyped series) — represented by its twin
//   AMBIGUOUS_DUPLICATE · POSSIBLE_DUPLICATE_IN_SOURCE     maybe a second print — shown, flagged, never counted
//   IN_REGISTER · IN_REGISTER_OTHER_UNIT · POSSIBLY_IN_REGISTER   a deal of the register's stored window (rows near its first day)
//   HISTORY_EVENT           a deal of its locality's history — shown in ALL, and folded at read time into the register deal it repeats
//                           (lib/txevents/history.js `fold`, the reconciliation's own rules) when the register copy's live search
//                           returns that deal for the same place and dates
//   UNPLACED / POSSIBLE_LOCATION   no usable settlement and no strong parcel signal (lib/txevents/recover.js) — the national universe's
//                           unplaced events (unplaced.json.gz), every source field kept
// The rules are the recent layer's own (lib/recent/reconcile.js `reconcile`, unchanged), applied one calendar year at a time with
// four days of the neighbouring years as context (a twin is at most three days apart). A RESOLVED row (recover.js) is reconciled
// again under its locality. Nothing in the register copy, the street statistics or the Street Value Model is read differently.
//
// Outputs (data/txevents/history/, bot-written): gm-<year>.json.gz (the year's shown rows, newest first, dictionary-encoded, indexed by
// locality), unplaced.json.gz, invalid.json, meta.json.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.TXEVENTS_HISTORY_OUT || path.join(ROOT, 'data', 'txevents', 'history');
const ENGINE = 'propx-txevents-history-1';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const tallyInto = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, k) => isoDay(Date.parse(d + 'T00:00:00Z') + k * DAY);

/* the columns of a year file — COLUMNAR (`cols[i]` holds column COLS[i] for every row), rows newest first (then locality, then object
   id); string columns dictionary-encoded (`dict[column]`), the date as day numbers, each the difference from the previous row (the first
   absolute). The file's object id identifies every row in the published file (its deal id stays in the file). No build time or
   version inside a year file: a year whose rows did not change keeps the same bytes. */
const COLS = ['oid', 'date', 'amount', 'areaSqm', 'rooms', 'floor', 'propertyType', 'dealNature', 'kind', 'cityCode', 'settlement', 'street', 'house',
  'streetCode', 'streetBasis', 'block', 'parcel', 'subParcel', 'class', 'recovery', 'twinOid'];
const DICT = new Set(['floor', 'propertyType', 'dealNature', 'kind', 'settlement', 'street', 'streetBasis', 'class', 'recovery']);
const SHOWN = new Set(['RECENT_NEW', 'POSSIBLE_DUPLICATE_IN_SOURCE', 'AMBIGUOUS_DUPLICATE', 'POSSIBLY_IN_REGISTER']);
const UCOLS = ['oid', 'dealId', 'date', 'amount', 'areaSqm', 'rooms', 'floor', 'propertyType', 'dealNature', 'kind', 'settlement', 'settlementId', 'street', 'house', 'streetCode', 'neighborhood',
  'block', 'parcel', 'subParcel', 'polygon', 'state', 'basis', 'candidates'];

async function build() {
  const dir = opt('--extract');
  if (!dir) throw new Error('--extract <dir> is required');
  const schema = readJson(path.join(dir, 'schema.json'));
  if (!schema || !schema.history || !schema.history.to) throw new Error('the extract holds no history (txevents-gpkg.py --history-to)');
  const KIT = require('../lib/txevents/kit'), RCV = require('../lib/txevents/recover');
  const EV = require('../lib/streets/evidence'), SD = require('../lib/streets/directory'), M = require('../lib/streets/match');
  const REC = require('../lib/recent/reconcile');
  const S = EV.store();
  if (!S.available) throw new Error('no stored register copy');
  const regWin = S.meta.window;
  if (schema.history.to !== regWin.from) throw new Error(`the extract's history ends ${schema.history.to}, the register window starts ${regWin.from}`);
  const nmeta = readJson(path.join(ROOT, 'data', 'txevents', 'national', 'meta.json'));
  const version = nmeta && nmeta.version ? nmeta.version : null;
  const loadDay = version && version.detectedAt ? String(version.detectedAt).slice(0, 10) : schema.dates.max;
  const D = SD.load();
  const K = KIT.knowledgeFrom(dir, D, EV, REC);
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'txh-'));

  /* 1 · split the history by year on disk (a year at a time in memory); the window's first week is the last year's context */
  const yearFiles = new Map(), buf = new Map();
  const flush = (y) => { const b = buf.get(y); if (b && b.length) { fs.appendFileSync(path.join(tmp, y + '.jsonl'), b.join('')); b.length = 0; } };
  const put = (o) => { const y = String(o.deal_date).slice(0, 4); if (!buf.has(y)) { buf.set(y, []); yearFiles.set(y, path.join(tmp, y + '.jsonl')); } const b = buf.get(y); b.push(JSON.stringify(o) + '\n'); if (b.length >= 20000) flush(y); };
  const seen = new Set();
  let historyRows = 0;
  await KIT.eachGz(path.join(dir, 'history.jsonl.gz'), (raw) => { const o = KIT.apiRow(raw); seen.add(o.objectid); historyRows++; put(o); });
  const ctxTo = addDays(regWin.from, 6);
  let ctxRows = 0;
  await KIT.eachGz(path.join(dir, 'window.jsonl.gz'), (raw) => { const o = KIT.apiRow(raw); if (o.deal_date && o.deal_date <= ctxTo && !seen.has(o.objectid)) { o.__ctx = true; ctxRows++; put(o); } });
  for (const y of buf.keys()) flush(y);
  const readYear = (y) => (yearFiles.has(String(y)) ? fs.readFileSync(yearFiles.get(String(y)), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const years = [...yearFiles.keys()].sort();

  /* 2 · one year at a time: the reconciliation, then the recovery of the rows that name no settlement (a second pass) */
  const classes = {}, perYear = {}, localities = {}, streets = {}, recState = {}, recBasis = {}, streetBasis = {}, audit = { strings: new Map(), via: {}, codeAgreement: {} };
  const files = [], unplaced = [];
  let shownTotal = 0;
  const LIs = new Map(); const LI = (c) => { if (!LIs.has(c)) LIs.set(c, M.localityIndex(D, c)); return LIs.get(c); };
  for (const y of years) {
    const prev = readYear(Number(y) - 1).filter((o) => o.deal_date >= `${Number(y) - 1}-12-27`);
    const cur = readYear(y);
    const next = readYear(Number(y) + 1).filter((o) => o.deal_date <= `${Number(y) + 1}-01-04`);
    const chunk = [...prev, ...cur, ...next];
    const rawByOid = new Map(chunk.map((o) => [Number(o.objectid), o]));
    const mine = new Set(cur.filter((o) => !o.__ctx && o.deal_date < regWin.from).map((o) => Number(o.objectid)));
    const rec = REC.reconcile(chunk, { window: { from: regWin.from }, loadDay, EV, D, M });
    const Y = (perYear[y] = { rows: mine.size });
    const clsOf = (o) => (o.cls === 'CONTEXT_BEFORE_WINDOW' ? (o.asWindow ? o.asWindow.cls : null) : o.cls);
    const shownRows = [];
    const recover = [];
    for (const r of rec.rows) {
      if (!mine.has(r.oid)) continue;
      const o = rec.out.get(r.oid);
      const c = clsOf(o);
      if (c == null) { recover.push(r); continue; }                // named no usable settlement → the recovery
      tallyInto(classes, c === 'RECENT_NEW' ? 'HISTORY_EVENT' : c); tallyInto(Y, c === 'RECENT_NEW' ? 'HISTORY_EVENT' : c);
      if (SHOWN.has(c)) shownRows.push({ r, o: o.asWindow || o, c, rec, recovery: null });
    }
    /* the recovery */
    const res = new Map();
    for (const r of recover) {
      const g = rawByOid.get(r.oid) || {};
      const p = r.settlement ? K.place(r.settlement) : null;
      const x = RCV.recover(K, { settlementId: g.settlement_id, polygon: g.polygon_id, gush: r.gush, parcel: r.parcel }, p && p.codes ? p.codes : null);
      res.set(r.oid, x); tallyInto(recState, x.state); tallyInto(recBasis, x.basis);
    }
    const resolved = recover.filter((r) => /^RESOLVED/.test(res.get(r.oid).state) && D.localities.has(res.get(r.oid).code));
    const second = resolved.length ? REC.reconcile(resolved.map((r) => ({ ...rawByOid.get(r.oid), settlement: D.localities.get(res.get(r.oid).code).he })), { window: { from: regWin.from }, loadDay, EV, D, M }) : null;
    const secondRow = new Map(second ? second.rows.map((z) => [z.oid, z]) : []);
    for (const r of recover) {
      const x = res.get(r.oid);
      const o2 = second && /^RESOLVED/.test(x.state) ? second.out.get(r.oid) : null;
      const c2 = o2 ? clsOf(o2) : null;
      if (c2 != null) {
        const k = c2 === 'RECENT_NEW' ? 'HISTORY_EVENT' : c2;
        tallyInto(classes, k); tallyInto(Y, k); tallyInto(Y, 'recovered');
        const sr = secondRow.get(r.oid);
        if (SHOWN.has(c2)) shownRows.push({ r: sr, o: o2.asWindow || o2, c: c2, rec: second, recovery: `${x.state}:${x.basis}` });
        continue;
      }
      const state = /^RESOLVED/.test(x.state) ? 'POSSIBLE_LOCATION' : x.state;
      tallyInto(classes, state); tallyInto(Y, state);
      const g = rawByOid.get(r.oid) || {};
      unplaced.push([r.oid, r.dealId, r.date, r.amount, r.area, r.rooms, r.floor, r.type, r.nature, rec.kindOf(r), r.settlement, g.settlement_id != null ? g.settlement_id : null, r.street, r.house,
        g.street_code != null ? g.street_code : null, g.neighborhood || null, r.gush, r.parcel, r.sub, r.polygon, state, x.basis, x.candidates ? x.candidates.map((z) => z.code).join(',') : null]);
    }

    /* the street of every shown row: the layer's own official street code (an exact key) beside the published name resolved in the
       official directory — the two compared, never silently merged */
    const dict = Object.fromEntries([...DICT].map((k) => [k, []])), dictIdx = Object.fromEntries([...DICT].map((k) => [k, new Map()]));
    const enc = (k, v) => { if (!DICT.has(k) || v == null) return v; const m = dictIdx[k]; if (!m.has(v)) { m.set(v, dict[k].length); dict[k].push(v); } return m.get(v); };
    const rows = [];
    for (const { r, o, c, rec: R, recovery } of shownRows) {
      const g = rawByOid.get(r.oid) || {};
      const kind = R.kindOf(r);
      const nameSt = R.streetOf(r);
      const sc = g.street_code != null && g.street_code !== '' ? Number(g.street_code) : null;
      const scOk = sc != null && D.byId && D.byId.has(`st:${r.code}:${sc}`);
      let streetCode = null, basis;
      if (scOk && (nameSt.code == null || nameSt.code === sc)) { streetCode = sc; basis = nameSt.code === sc ? 'street-code+name' : 'street-code'; }
      else if (scOk) { streetCode = sc; basis = 'street-code-name-differs'; }
      else if (nameSt.code != null) { streetCode = nameSt.code; basis = nameSt.basis; }
      else basis = nameSt.basis || 'no-address';
      tallyInto(streetBasis, basis);
      rows.push([r.oid, r.date, r.amount, r.area, r.rooms, r.floor, r.type, r.nature, kind, r.code, r.settlement, r.street, r.house,
        streetCode, basis, r.gush, r.parcel, r.sub, c, recovery, c === 'RECENT_NEW' ? null : (o.candidates || []).join(',') || o.twinOf || null]);
      const L = (localities[r.code] = localities[r.code] || { rows: 0, events: 0, possible: 0, earliest: null, latest: null });
      L.rows++; if (c === 'RECENT_NEW') L.events++; else L.possible++;
      if (!L.earliest || r.date < L.earliest) L.earliest = r.date;
      if (!L.latest || r.date > L.latest) L.latest = r.date;
      if (streetCode != null) tallyInto(streets, `${r.code}|${streetCode}`);
    }
    /* the street-string audit over every row of the year with a published street (shown or not) */
    for (const r of rec.rows) {
      if (!mine.has(r.oid)) continue;
      const g = rawByOid.get(r.oid) || {};
      const code = r.code != null ? r.code : (res.get(r.oid) && res.get(r.oid).code) || null;
      if (!r.street) { tallyInto(audit.via, 'no-street'); continue; }
      if (code == null) { tallyInto(audit.via, 'no-locality'); continue; }
      const key = `${code}|${r.street}`;
      let a = audit.strings.get(key);
      if (!a) {
        const z = M.resolveStreet(LI(code), r.street);
        a = { via: !z ? 'unresolved' : z.ambiguous ? 'ambiguous' : z.via, code: z && z.id ? Number(String(z.id).split(':')[2]) : null, rows: 0 };
        audit.strings.set(key, a);
      }
      a.rows++;
      tallyInto(audit.via, a.via);
      const sc = g.street_code != null && g.street_code !== '' ? Number(g.street_code) : null;
      tallyInto(audit.codeAgreement, sc == null ? 'no-source-code' : !(D.byId && D.byId.has(`st:${code}:${sc}`)) ? 'source-code-not-in-directory' : a.code == null ? 'name-unresolved' : a.code === sc ? 'agree' : 'differ');
    }
    rows.sort((a, b) => b[1].localeCompare(a[1]) || (a[9] || 0) - (b[9] || 0) || a[0] - b[0]);
    const dayNo = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / DAY);
    const cols = COLS.map((k, i) => rows.map((x, j) => (k === 'date' ? (j ? dayNo(rows[j - 1][1]) - dayNo(x[1]) : dayNo(x[1])) : enc(k, x[i]))));
    const doc = { schema: 2, engine: ENGINE, year: Number(y), rows: rows.length, columns: COLS, dict, cols };
    const gz = zlib.gzipSync(JSON.stringify(doc), { level: 9 });
    fs.mkdirSync(OUT, { recursive: true });
    const name = `gm-${y}.json.gz`;
    fs.writeFileSync(path.join(OUT, name), gz);
    files.push({ year: Number(y), file: name, rows: rows.length, bytes: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex') });
    shownTotal += rows.length;
    Y.shown = rows.length;
    console.log(JSON.stringify({ year: y, rows: Y.rows, shown: rows.length, bytes: gz.length, recover: recover.length, resolved: resolved.length }));
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  /* 2b · the street-string audit over the stored window's rows too (every row of the file from the register's first day to the load
     day): the layer's published street string in the official directory of its locality, beside the layer's own street code */
  const auditW = { strings: new Map(), via: {}, codeAgreement: {} };
  await KIT.eachGz(path.join(dir, 'window.jsonl.gz'), (raw) => {
    const o = KIT.apiRow(raw);
    if (!o.deal_date || o.deal_date < regWin.from || o.deal_date > loadDay) return;
    const p = o.settlement ? K.place(o.settlement) : null;
    const code = K.official(o.settlement_id) != null ? K.official(o.settlement_id) : p && p.code != null ? p.code : null;
    if (!o.street) { tallyInto(auditW.via, 'no-street'); return; }
    if (code == null) { tallyInto(auditW.via, 'no-locality'); return; }
    const key = `${code}|${o.street}`;
    let a = auditW.strings.get(key);
    if (!a) { const z = M.resolveStreet(LI(code), o.street); a = { via: !z ? 'unresolved' : z.ambiguous ? 'ambiguous' : z.via, code: z && z.id ? Number(String(z.id).split(':')[2]) : null, rows: 0 }; auditW.strings.set(key, a); }
    a.rows++; tallyInto(auditW.via, a.via);
    const sc = o.street_code != null && o.street_code !== '' ? Number(o.street_code) : null;
    tallyInto(auditW.codeAgreement, sc == null ? 'no-source-code' : !(D.byId && D.byId.has(`st:${code}:${sc}`)) ? 'source-code-not-in-directory' : a.code == null ? 'name-unresolved' : a.code === sc ? 'agree' : 'differ');
  });

  /* 3 · invalid dates (the extract's own file) */
  const invalid = [];
  if (fs.existsSync(path.join(dir, 'invalid.jsonl.gz'))) await KIT.eachGz(path.join(dir, 'invalid.jsonl.gz'), (raw) => { const o = KIT.apiRow(raw); invalid.push([o.objectid, o.deal_id, o.deal_date || null, o.deal_amount, o.settlement || null, o.street || null, o.house_num || null, o.gush, o.parcel, o.sub_parcel, o.property_type || null, o.deal_nature || null, 'no date / a placeholder date before 1990']); });

  const sumClasses = Object.values(classes).reduce((a, b) => a + b, 0);
  if (sumClasses !== historyRows) throw new Error(`accounting: ${sumClasses} classified of ${historyRows} history rows`);
  const strings = [...audit.strings.values()];
  const meta = {
    schema: 1, engine: ENGINE, builtAt: new Date().toISOString(), version, loadDay,
    source: { id: 'over:govmap-national', datasetId: '4174aac2-c8b2-443e-9425-3773ce47c8da', file: nmeta && nmeta.file ? { sha256: nmeta.file.sha256, bytes: nmeta.file.bytes, rowsTotal: nmeta.file.rowsTotal } : null },
    register: { scrapedAt: S.meta.source.scrapedAt, lastDeal: S.meta.source.lastDeal, window: regWin },
    period: { to: regWin.from, before: `< ${regWin.from}` }, historyRows, contextRows: ctxRows, invalid: invalid.length,
    classes, perYear, shown: shownTotal, recovery: { rows: Object.values(recState).reduce((a, b) => a + b, 0), byState: recState, byBasis: recBasis, settlementIdAgreement: K.settlementIdAgreement },
    unplaced: unplaced.length, streetBasis,
    streetAudit: { distinctStrings: strings.length, rowsByVia: audit.via, stringsByVia: strings.reduce((m, a) => tallyInto(m, a.via), {}), codeAgreement: audit.codeAgreement,
      window: { distinctStrings: auditW.strings.size, rowsByVia: auditW.via, stringsByVia: [...auditW.strings.values()].reduce((m, a) => tallyInto(m, a.via), {}), codeAgreement: auditW.codeAgreement },
      vias: { 'official-name': 'the official street name', 'official-synonym': 'an official synonym (the directory\'s synonym file)', 'spelling-variant': 'a deterministic spelling variant of an official name',
        'normalized-name': 'a normalized name (type words / punctuation dropped) — POSSIBLE, never certain', ambiguous: 'several official streets carry the spelling', unresolved: 'no official street carries it' } },
    localities, streets, files,
  };
  fs.writeFileSync(path.join(OUT, 'unplaced.json.gz'), zlib.gzipSync(JSON.stringify({ schema: 1, version: version && version.id, columns: UCOLS, rows: unplaced }), { level: 9 }));
  fs.writeFileSync(path.join(OUT, 'invalid.json'), JSON.stringify({ schema: 1, version: version && version.id, columns: ['oid', 'dealId', 'date', 'amount', 'settlement', 'street', 'house', 'block', 'parcel', 'subParcel', 'propertyType', 'dealNature', 'reason'], rows: invalid }) + '\n');
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta) + '\n');
  console.log(JSON.stringify({ ok: true, historyRows, shown: shownTotal, classes, unplaced: unplaced.length, invalid: invalid.length, recovery: meta.recovery, bytes: files.reduce((a, f) => a + f.bytes, 0), streetAudit: meta.streetAudit }));
}

(async () => {
  try {
    if (args.includes('--build')) await build();
    else { console.error('usage: --build --extract <dir>'); process.exit(2); }
  } catch (e) { console.error('txevents-history: ' + (e.stack || e.message)); process.exit(1); }
})();
