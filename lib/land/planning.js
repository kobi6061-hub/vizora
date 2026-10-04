// PROPX · Land & Tender — the planning and construction sources that join a
// tender by an EXACT key, and nothing else.
//
//   Planning Administration · xplan "blue lines" layer (ArcGIS, PlanningPublic/
//     Xplan/MapServer/1, ~37k plans): the plan's statutory station, approval
//     date, area and the approved housing units (pq_authorised_quantity_120).
//     Joined to a tender's lot by the plan number the Authority printed on the
//     lot (TochnitMigrash.Tochnit) — equal after whitespace removal, nothing
//     fuzzier. The Authority's own "site link" ids are NOT plan numbers and
//     are never joined.
//   RMI planning inventory ("מלאי תכנוני למגורים", data.gov.il 99aad98f…):
//     STATE LAND ONLY and STALE (resource last updated 2022-02-17) — kept as a
//     dated reference of potential units for marketing per plan, joined by the
//     same exact plan key, labelled with its date everywhere.
//   MoCH construction-progress reports ("דיווחי התקדמות הבניה - בניה רוויה",
//     data.gov.il 1ec45809…, last updated 2024-03-01): building-level stage
//     dates keyed by block/parcel (GUSH/HELKA). Joined to a tender's lot only
//     when the lot lists that exact block AND parcel (a parcel of "0" is
//     unknown and never joins). This is the only construction evidence of the
//     layer; a tender without such a row has none.
//   MoCH development costs ("עלויות פיתוח בבניה העירונית", bf164a03…): a
//     reference by locality (projects, not tenders): no exact key to a tender
//     exists, so it is never attached to one.
//
// Everything here is read on the GitHub runner by scripts/land-sync.js.

'use strict';

const { planKey, text, num, day } = require('./normalize');

const CKAN = process.env.GOV_DATAGOV_BASE || 'https://data.gov.il/api/3/action';
const XPLAN = process.env.IPLAN_XPLAN_BASE || 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1';
const UA = 'PROPX-land-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const RESOURCES = Object.freeze({
  planningInventory: { id: '99aad98f-2b54-4eea-834d-650b56389bf3', source: 'datagov:rmi:planning-inventory', stale: true, stateLandOnly: true },
  constructionProgress: { id: '1ec45809-5927-430a-9b30-77f77f528ce3', source: 'datagov:moch:construction-progress', stale: true },
  developmentCosts: { id: 'bf164a03-55c7-4bea-8740-66ce60a51a2c', source: 'datagov:moch:development-costs' },
});

async function ckan(action, params, fetchImpl) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetchImpl(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  const t = await r.text(); let j;
  try { j = JSON.parse(t); } catch { throw new Error(`${action}: HTTP ${r.status}, not JSON`); }
  if (!j.success) throw new Error(`${action}: HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result;
}
/** every row of a datastore resource (paged; an incomplete read throws) + the resource's own last-modified time */
async function fetchResource(key, fetchImpl = globalThis.fetch) {
  const res = RESOURCES[key];
  const meta = await ckan('resource_show', { id: res.id }, fetchImpl);
  const rows = []; let total = null;
  for (let offset = 0; ; offset += 2000) {
    const r = await ckan('datastore_search', { resource_id: res.id, limit: 2000, offset }, fetchImpl);
    total = r.total; rows.push(...r.records);
    if (!r.records.length || rows.length >= total) break;
  }
  if (total != null && rows.length < total) throw new Error(`${key}: read ${rows.length} of ${total} rows`);
  return { rows, total, sourceUpdatedAt: meta.last_modified ? new Date(meta.last_modified + (meta.last_modified.endsWith('Z') ? '' : 'Z')).toISOString() : null,
    endpoint: `${CKAN}/datastore_search?resource_id=${res.id}`, resourceId: res.id, source: res.source };
}

/* ───────────────────────── planning inventory (STALE, state land only) ───────────────────────── */
const dmy = (v) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || '').trim()); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
function normalizeInventoryRow(r, ctx) {
  const plan = text(r['מספר תוכנית']);
  if (!plan) return null;
  const units = num(r['יחד פוטנציאל לשיווק']);
  return { id: `plan-inventory:${num(r['מפתח לפוליגון תכנית']) || r._id}`, plan, planKey: planKey(plan), name: text(r['שם תוכנית']), stage: text(r['שלב תכנוני']),
    initiator: text(r['יזם תכנון']), localityCode: num(r['סמל יישוב']), locality: text(r['יישוב']),
    thresholdDate: dmy(r['תאריך קיום תנאי סף']), depositDate: dmy(r['תאריך פרסום להפקדה ברשומות']), approvalDate: dmy(r['תאריך פרסום לאישור ברשומות']),
    potentialUnits: units != null && units >= 0 ? units : null, stateLandOnly: true, asOf: ctx.sourceUpdatedAt ? ctx.sourceUpdatedAt.slice(0, 10) : null,
    rmiLink: text(r['קישור לאתר רשות מקרקעי ישראל']), planningLink: text(r['קישור לאתר מנהל תכנון']),
    provenance: { source: RESOURCES.planningInventory.source, resourceId: RESOURCES.planningInventory.id, sourceRowId: r._id, sourceUpdatedAt: ctx.sourceUpdatedAt, fetchedAt: ctx.fetchedAt, snapshotHash: ctx.snapshotHash } };
}

/* ───────────────────────── xplan (Planning Administration GIS) ───────────────────────── */
const esriDay = (ms) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
function normalizeXplanFeature(a, ctx) {
  const plan = text(a.pl_number);
  if (!plan) return null;
  const approved = num(a.pq_authorised_quantity_120);
  return { planKey: planKey(plan), plan, planId: num(a.pl_id), mpId: num(a.mp_id), name: text(a.pl_name), station: text(a.station_desc), shortStatus: text(a.internet_short_status),
    kind: text(a.entity_subtype_desc), district: text(a.district_name), jurisdiction: text(a.jurstiction_area_name), planArea: text(a.plan_area_name),
    areaDunam: num(a.pl_area_dunam), landUse: text(a.pl_landuse_string), approvedUnits: approved != null && approved >= 0 ? approved : null, unitsDelta: num(a.quantity_delta_120),
    approvalDate: esriDay(a.pl_date_8), advertiseDate: esriDay(a.pl_date_advertise), depositDate: esriDay(a.pl_last_deposit_date || a.depositing_date),
    rejectionDate: esriDay(a.pl_rejection_date), lastUpdate: esriDay(a.last_update_date), url: text(a.pl_url),
    provenance: { source: 'iplan:xplan', endpoint: XPLAN, fetchedAt: ctx.fetchedAt, join: 'exact-plan-number' } };
}
const XPLAN_FIELDS = 'pl_number,pl_id,mp_id,pl_name,station_desc,internet_short_status,entity_subtype_desc,district_name,jurstiction_area_name,plan_area_name,pl_area_dunam,pl_landuse_string,pq_authorised_quantity_120,quantity_delta_120,pl_date_8,pl_date_advertise,pl_last_deposit_date,depositing_date,pl_rejection_date,last_update_date,pl_url';
/** exact pl_number lookups, batched; returns Map(planKey → feature) for the plan numbers that exist in the layer */
async function fetchXplanPlans(planNumbers, { fetchImpl = globalThis.fetch, batch = 10, maxRequests = 400, timeoutMs = 90000, fetchedAt = new Date().toISOString() } = {}) {
  const found = new Map(); let requests = 0, failures = 0, asked = 0; const errors = [];
  const nums = [...new Set(planNumbers.filter(Boolean))];
  for (let i = 0; i < nums.length && requests < maxRequests && failures < 3; i += batch) {
    const slice = nums.slice(i, i + batch);
    const where = 'pl_number IN (' + slice.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',') + ')';
    const u = `${XPLAN}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(XPLAN_FIELDS)}&returnGeometry=false&f=pjson`;
    requests++;
    try {
      const r = await fetchImpl(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
      for (const f of j.features || []) { const p = normalizeXplanFeature(f.attributes, { fetchedAt }); if (p && !found.has(p.planKey)) found.set(p.planKey, p); }
      asked += slice.length; failures = 0;
    } catch (e) { failures++; errors.push(e.message); }   /* a failed batch is asked again next run (its plans stay unresolved, never guessed) */
  }
  /* askedKeys: the plan numbers a successful batch really looked up (a miss among them is a real miss) */
  return { found, requests, asked: nums.length, askedKeys: new Set(nums.slice(0, asked)), complete: asked >= nums.length, errors: errors.slice(0, 3) };
}

/* ───────────────────────── MoCH construction progress (block/parcel) ───────────────────────── */
const STAGES = { 5: 'excavation', 7: 'foundations', 8: 'ground-floor', 16: 'frame', 18: 'roof', 29: 'finishing', 39: 'form-4', 42: 'completion' };
const excelDay = (v) => { if (v == null || v === '' || v === '-') return null; const n = Number(v); if (Number.isFinite(n) && n > 20000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10); return dmy(v) || day(v); };
function normalizeProgressRow(r, ctx) {
  const block = text(r.GUSH), parcel = text(r.HELKA);
  const stages = {};
  for (const [k, name] of Object.entries(STAGES)) { const d = excelDay(r['TAARICH_SHLAV_BNIYA_' + k]); if (d) stages[name] = d; }
  return { id: `moch-progress:${r._id}`, block, parcel, joinable: !!(block && parcel && parcel !== '0'), district: text(r.MAHOZ), locality: text(r.YESHUV_LAMAS), site: text(r.ATAR),
    compound: num(r.MISPAR_MITHAM), lot: text(r.MIGRASH), building: text(r.MISPAR_BINYAN), floors: num(r.KOMOT_BINYAN), units: num(r.YEHIDOT_BINYAN), marketing: text(r.SHITAT_SHIVUK),
    contractYear: text(r.SHNAT_HOZE), determinedDate: dmy(r.TAARICH_KOBEA), stages, latestStage: Object.keys(stages).length ? Object.entries(stages).sort((a, b) => a[1] < b[1] ? 1 : -1)[0] : null,
    provenance: { source: RESOURCES.constructionProgress.source, resourceId: RESOURCES.constructionProgress.id, sourceRowId: r._id, sourceUpdatedAt: ctx.sourceUpdatedAt, fetchedAt: ctx.fetchedAt } };
}

/* ───────────────────────── joins (exact keys only) ───────────────────────── */
/** plans per tender: the lot plan numbers (via 'lot') enriched from xplan and the inventory by exact key; site-link ids are left unjoined */
function joinPlans(record, { xplan = new Map(), inventory = new Map() }) {
  if (!record.plans) return record;
  const plans = record.plans.map((p) => {
    if (p.via !== 'lot') return { plan: p.plan, via: p.via, xplan: null, inventory: null, join: 'not-a-plan-number' };
    const key = planKey(p.plan), x = xplan.get(key) || null, inv = inventory.get(key) || null;
    return { plan: p.plan, via: p.via, join: 'exact-plan-number',
      xplan: x ? { station: x.station, shortStatus: x.shortStatus, approvedUnits: x.approvedUnits, approvalDate: x.approvalDate, depositDate: x.depositDate, areaDunam: x.areaDunam, landUse: x.landUse, url: x.url, lastUpdate: x.lastUpdate, fetchedAt: x.provenance.fetchedAt } : null,
      inventory: inv ? { potentialUnits: inv.potentialUnits, stage: inv.stage, asOf: inv.asOf, stateLandOnly: true } : null };
  });
  const approved = plans.map((p) => p.xplan && p.xplan.approvedUnits).filter((u) => u != null);
  return { ...record, plans, planning: { joined: plans.filter((p) => p.xplan).length, ofPlans: plans.filter((p) => p.via === 'lot').length,
    approvedUnitsInPlans: approved.length ? approved.reduce((s, u) => s + u, 0) : null,   // the PLANS' approved units (a plan is wider than the tender's lots)
    basis: 'exact-plan-number' } };
}
/** construction evidence per tender: MoCH progress rows whose block AND parcel equal a lot's parcel */
function joinConstruction(record, progressByParcel) {
  if (!record.lots) return record;
  const links = [];
  for (const lot of record.lots) for (const p of lot.parcels) {
    if (!p.parcel || p.parcel === '0') continue;
    for (const row of progressByParcel.get(p.block + '/' + p.parcel) || []) {
      links.push({ lotId: lot.lotId, block: p.block, parcel: p.parcel, progressId: row.id, locality: row.locality, site: row.site, building: row.building, units: row.units,
        stages: row.stages, latestStage: row.latestStage, asOf: row.provenance.sourceUpdatedAt ? row.provenance.sourceUpdatedAt.slice(0, 10) : null, join: 'exact-block-parcel' });
    }
  }
  const starts = links.map((l) => l.stages.excavation || l.stages.foundations).filter(Boolean).sort();
  const done = links.map((l) => l.stages.completion || l.stages['form-4']).filter(Boolean).sort();
  return { ...record, construction: { permit: null, permitEvidence: 'not-published-by-these-sources', start: starts[0] || null, completion: done.length === links.length && done.length ? done[done.length - 1] : null,
    links, evidence: links.length ? 'moch-progress:exact-block-parcel' : 'no-exact-parcel-join' } };
}

module.exports = { RESOURCES, fetchResource, normalizeInventoryRow, normalizeXplanFeature, fetchXplanPlans, normalizeProgressRow, joinPlans, joinConstruction, STAGES, XPLAN, CKAN };
