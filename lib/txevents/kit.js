// PROPX · the shared parts of the runner builds over the GovMap-layer file (scripts/txevents-national.js, scripts/txevents-history.js):
// the file's column names → the API's, gz line readers, the register copy's settlement names and parcels, and the recovery
// knowledge base (lib/txevents/recover.js) from the extract (scripts/txevents-gpkg.py).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');

/* the published file names its columns in camelCase (objectId · dealId · dealDate · dealAmount · settlementNameHeb · streetNameHeb · houseNum ·
   floorNo · assetArea · assetRoomNum · propertyTypeDescription · dealNatureDescription · gushNum · parcelNum · subParcelNum · polygonId) and
   carries three the API does not serve (settlementId · streetCode · neighborhood) — mapped to the API's names, the extra three kept */
const FILE_MAP = { dealid: 'deal_id', dealdate: 'deal_date', dealamount: 'deal_amount', settlementnameheb: 'settlement', streetnameheb: 'street', housenum: 'house_num',
  floorno: 'floor', assetarea: 'asset_area', assetroomnum: 'rooms', propertytypedescription: 'property_type', dealnaturedescription: 'deal_nature',
  gushnum: 'gush', parcelnum: 'parcel', subparcelnum: 'sub_parcel', polygonid: 'polygon_id', settlementid: 'settlement_id', streetcode: 'street_code' };
const numOrNull = (v) => (v == null || v === '' ? null : /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : v);
const lowerKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
/** a file row → the API's field names */
function apiRow(o0) {
  const o = lowerKeys(o0);
  for (const [k, v] of Object.entries(FILE_MAP)) if (o[k] !== undefined && o[v] === undefined) { o[v] = o[k]; delete o[k]; }
  if (o.objectid == null) o.objectid = o.fid != null ? o.fid : o.ogc_fid != null ? o.ogc_fid : o.id;
  o.objectid = numOrNull(o.objectid);
  if (o.deal_date != null) o.deal_date = String(o.deal_date).slice(0, 10);
  for (const k of ['deal_amount', 'asset_area', 'rooms', 'gush', 'parcel', 'sub_parcel', 'deal_id']) if (o[k] != null) o[k] = numOrNull(o[k]);
  return o;
}

const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
/** stream a .jsonl.gz file line by line (files too large for one string) */
async function eachGz(f, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(f).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) { if (!line) continue; fn(JSON.parse(line), n++); }
  return n;
}

/** the register copy's shards (data/streets/evidence): settlement names per locality, and every parcel with its deal count */
function registerOf(EV) {
  const names = new Map(), parcels = [];
  for (const f of fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x))) {
    const sh = EV.shardOf(Number(f.replace('.json', ''))); if (!sh) continue;
    names.set(sh.cityCode, sh.settlements);
    for (const p of sh.parcels) parcels.push([sh.cityCode, p[0], p[1], p[2] || 1]);
  }
  return { names, parcels };
}

/** the recovery knowledge base from an extract directory (parcels.jsonl.gz + polygons.jsonl.gz) and the register copy */
function knowledgeFrom(dir, D, EV, REC) {
  const R = require('./recover');
  const reg = registerOf(EV);
  const place = REC.settlementIndex(D, reg.names);
  const pf = path.join(dir, 'parcels.jsonl.gz'), gf = path.join(dir, 'polygons.jsonl.gz');
  const K = R.knowledge({ D, place, parcelRows: fs.existsSync(pf) ? readGz(pf) : [], polygonRows: fs.existsSync(gf) ? readGz(gf) : [], registerParcels: reg.parcels });
  K.place = place;
  return K;
}

/* ── the coverage audit's accounting of the GovMap rows of one read (scripts/txevents-audit.js) ──
   A GovMap row is SURFACED when it is an event of its own in the read, FOLDED when it repeats a register deal filed under an unmapped
   settlement name and is shown as that register event's source evidence (lib/txevents/index.js layerEventsOf → history.js fold; since
   20.10.2026) — counted only when that register event is in the same read — and MISSED otherwise. Before 22.10.2026 the audit counted
   every FOLDED row as missed (304 rows on 21.10.2026, every one folded into a register event the read shows). */
/** the event id of a GovMap row — the same rule as lib/txevents/index.js gmEvent */
const gmIdOf = (x) => `gm:${x.dealId || 'o' + x.oid}`;
/** layerEventsOf(code).evidence ([[registerEventId, { dealId, oid, … }]]) → Map(GovMap event id → the register event it is folded into) */
function foldsOf(evidence) {
  const m = new Map();
  for (const [rid, ev] of evidence || []) if (ev && rid) m.set(gmIdOf(ev), rid);
  return m;
}
/** the GovMap row ids of a read against its event ids and folds → { rows, surfaced, folded, missed, missedIds } */
function surfaceAccount(rowIds, eventIds, folds = new Map()) {
  let surfaced = 0, folded = 0;
  const missedIds = [];
  for (const id of rowIds) {
    if (eventIds.has(id)) surfaced++;
    else if (folds.has(id) && eventIds.has(folds.get(id))) folded++;
    else missedIds.push(id);
  }
  return { rows: rowIds.length, surfaced, folded, missed: missedIds.length, missedIds: missedIds.slice(0, 20) };
}

module.exports = { FILE_MAP, apiRow, readGz, eachGz, registerOf, knowledgeFrom, gmIdOf, foldsOf, surfaceAccount };
