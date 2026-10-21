#!/usr/bin/env node
// PROPX · NATIONAL PLAN BOUNDARIES — every plan of the Planning Administration's online-plans layer (PlanningPublic/Xplan/MapServer/1,
// the layer PROPX already reads daily for urban renewal and land) with its generalized boundary, stored in map tiles so a street report
// reads only the tiles around a street. GitHub runner only (ags.iplan.gov.il is not reachable from the sandbox).
//
//   node scripts/street-planning-sync.js [--out data/planning/national]
//
// The layer is paged by resultOffset (1,000 a page, ordered by objectid); the read is COMPLETE only when the stored plans + the rows
// skipped for a stated reason equal the layer's own count — otherwise nothing is written and the previous files stand. Each plan is the
// renewal lane's own normalization (lib/renewal/planning.js normalizePlan: stage from the source's status strings only, the XPlan unit
// pair through lib/planning/xplan-units.js) + its boundary (WGS84, ~10 m generalization) + a TOPIC read from the plan's own name and
// type only (RAIL_TRANSIT · ROAD · NATIONAL_INFRASTRUCTURE · PREFERRED_HOUSING · RENEWAL · OTHER) — a label of the plan's text, never
// a join. A boundary is used ONLY to state a spatial relation to a street (inside / its distance) — never to join a record.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { LAYER, FIELDS, normalizePlan, outlineOf } = require('../lib/renewal/planning');

const UA = 'PROPX-street-planning/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', path.join(__dirname, '..', 'data', 'planning', 'national'));
const PAGE = 1000, TILE = 0.05, LARGE_TILES = 36, TIMEOUT = 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ f: 'pjson', ...params })) body.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(LAYER + '/query', { method: 'POST', body: body.toString(), signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
      const j = JSON.parse(await r.text());
      if (j.error) throw new Error(`HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`);
      await sleep(1000);
      return j;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(5000 * attempt);
    }
  }
}

const TOPICS = [
  ['RAIL_TRANSIT', /רכבת|רק"ל|רק״ל|רקל|מטרו|מסילה|מטרונית|BRT|הסעת המונים|נת"צ|נתיב תחבורה ציבורית/],
  ['ROAD', /כביש|מחלף|דרך מס|דרך מהירה|רמזור|צומת/],
  ['RENEWAL', /התחדשות עירונית|פינוי[ -]בינוי|פינוי ובינוי|תמ"א 38|תמא 38|הריסה ובניה/],
];
function topicOf(p) {
  const name = String(p.name || '');
  for (const [t, re] of TOPICS) if (re.test(name)) return t;
  if (p.kind === 'תכנית דרך') return 'ROAD';
  if (p.kind === 'תכנית לתשתית לאומית') return 'NATIONAL_INFRASTRUCTURE';
  if (p.kind === 'תכנית מועדפת לדיור' || p.kind === 'תכנית לדיור לאומי' || /^תמל/.test(p.planKey || '')) return 'PREFERRED_HOUSING';
  return 'OTHER';
}
const tileOf = (x, y) => `${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`;

(async () => {
  const fetchedAt = new Date().toISOString();
  const count = (await post({ where: '1=1', returnCountOnly: 'true' })).count;
  if (!Number.isFinite(count) || count < 30000) throw new Error('implausible layer count: ' + count);
  const plans = [], skipped = { noPlanNumberOrMpId: 0, noGeometry: 0 };
  const seenOid = new Set();
  let pages = 0;
  for (let offset = 0; offset < count + PAGE; offset += PAGE) {
    const j = await post({ where: '1=1', outFields: FIELDS.concat(['objectid']).join(','), returnGeometry: 'true', outSR: 4326, maxAllowableOffset: 0.0001,
      geometryPrecision: 5, orderByFields: 'objectid', resultOffset: offset, resultRecordCount: PAGE });
    pages++;
    const feats = j.features || [];
    if (!feats.length) break;
    for (const f of feats) {
      const oid = f.attributes && f.attributes.objectid;
      if (seenOid.has(oid)) continue;
      seenOid.add(oid);
      const p = normalizePlan(f.attributes, { fetchedAt });
      if (!p) { skipped.noPlanNumberOrMpId++; continue; }
      const o = outlineOf(f.geometry);
      if (!o) { skipped.noGeometry++; continue; }
      plans.push({ oid, p, o });
    }
    process.stderr.write(`page ${pages}: offset ${offset}, ${feats.length} features, ${plans.length} kept\n`);
  }
  const accounted = plans.length + skipped.noPlanNumberOrMpId + skipped.noGeometry;
  const complete = accounted === seenOid.size && seenOid.size === count;
  if (!complete) throw new Error(`INCOMPLETE: layer ${count}, read ${seenOid.size}, accounted ${accounted} — nothing written`);

  /* one record per plan: the attributes a street report shows + its outline */
  const rec = ({ oid, p, o }) => ({ oid, mpId: p.mpId, planNumber: p.planNumber, name: p.name, stage: p.stage, station: p.station, event: p.event, kind: p.kind,
    permitPower: p.permitPower, district: p.district, jurisdiction: p.jurisdiction, locality: p.locality, areaDunam: p.areaDunam, landUse: p.landUse ? p.landUse.slice(0, 200) : null,
    objectives: p.objectives ? p.objectives.slice(0, 320) : null, existingAuthorisedUnits: p.existingAuthorisedUnits, planUnitDelta: p.planUnitDelta,
    dates: { depositDate: p.dates.depositDate, gazetteDate: p.dates.gazetteDate, approvalHearingDate: p.dates.approvalHearingDate, receivedDate: p.dates.receivedDate },
    lastUpdate: p.lastUpdate, url: p.url, topic: topicOf(p), bbox: o.bbox, centroid: o.centroid, rings: o.rings });
  const tiles = new Map(), large = [];
  const topics = {}, stages = {};
  for (const x of plans) {
    const r = rec(x);
    topics[r.topic] = (topics[r.topic] || 0) + 1; stages[r.stage] = (stages[r.stage] || 0) + 1;
    const [x0, y0, x1, y1] = r.bbox;
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE), ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > LARGE_TILES) { large.push(r); continue; }
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      const k = `${tx}_${ty}`; if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(r);
    }
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true });
  const write = (f, doc) => { const buf = zlib.gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 }); fs.writeFileSync(f, buf); return buf.length; };
  let bytes = 0;
  const index = {};
  for (const [k, rs] of [...tiles.entries()].sort()) { rs.sort((a, b) => a.oid - b.oid); bytes += write(path.join(OUT, 'tiles', k + '.json.gz'), { tile: k, size: TILE, plans: rs }); index[k] = rs.length; }
  large.sort((a, b) => a.oid - b.oid);
  bytes += write(path.join(OUT, 'large.json.gz'), { note: `plans whose boundary box spans more than ${LARGE_TILES} tiles (area-wide plans)`, plans: large });
  const meta = { schema: 1, engine: 'propx-plan-boundaries-1', source: { id: 'iplan:xplan', layer: LAYER, classification: 'OFFICIAL' }, fetchedAt,
    layerCount: count, stored: plans.length, skipped, complete, pages, tileSize: TILE, largeThresholdTiles: LARGE_TILES, tiles: index, large: large.length,
    topics, stages, bytes, generalization: 'maxAllowableOffset 0.0001° (~10 m), 5 decimals, WGS84',
    topicRule: 'from the plan\'s own name and type only (lib: scripts/street-planning-sync.js TOPICS) — a label of the plan\'s text, never a join',
    use: 'a boundary states a spatial relation to a street (inside / distance) — never a join of records, never a value',
    hash: crypto.createHash('sha256').update(JSON.stringify(plans.map((x) => [x.oid, x.p.mpId, x.p.stage, x.p.lastUpdate]))).digest('hex') };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify({ count, stored: plans.length, skipped, tiles: tiles.size, large: large.length, bytes, topics, stages }));
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
