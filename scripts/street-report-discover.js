#!/usr/bin/env node
// PROPX · Street Investment Intelligence — read-only source discovery (planning + transport around a street).
//
// Verifies, on a GitHub runner (ags.iplan.gov.il and data.gov.il answer there, not from the Claude sandbox), what the sources a street
// report would read for PLANNING and TRANSPORT publish, how large a national read is, and under which licence terms — before PROPX
// depends on them. GET (and the ArcGIS query POST the layer PROPX already reads accepts) only, one request at a time; nothing is
// written or committed.
//
//   node scripts/street-report-discover.js --xplan        Xplan layer 1 (online plans): metadata, count, paging, status / type tallies,
//                                                         the geometry size of a generalized sample → the size of a national extract
//   node scripts/street-report-discover.js --ttl          national infrastructure plans (ttl_all_blue_lines) + train_compilation layers
//   node scripts/street-report-discover.js --transport    data.gov.il: rail / light-rail / metro stations and lines — packages, licence
//                                                         fields, resources, datastore fields, totals, samples, coordinate system

'use strict';

const UA = 'PROPX-street-report-discover/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const CKAN = 'https://data.gov.il/api/3/action/';
const IPLAN = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/';
const XPLAN = IPLAN + 'Xplan/MapServer/1';
const TIMEOUT = 120000;
const args = process.argv.slice(2);
const out = (o) => console.log(JSON.stringify(o));
const trim = (v, n = 600) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  await sleep(1000);
  return { status: r.status, text, json, bytes: Buffer.byteLength(text), ms: Date.now() - t0, lastModified: r.headers.get('last-modified') };
}
async function post(url, params) {
  const t0 = Date.now();
  const body = new URLSearchParams(); for (const [k, v] of Object.entries({ f: 'pjson', ...params })) body.set(k, String(v));
  const r = await fetch(url, { method: 'POST', body: body.toString(), signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  await sleep(1000);
  return { status: r.status, json, bytes: Buffer.byteLength(text), ms: Date.now() - t0, text };
}
async function ck(action, params) {
  const r = await get(CKAN + action + '?' + new URLSearchParams(params));
  if (!r.json || !r.json.success) throw new Error(`${action} HTTP ${r.status}: ${trim(r.text, 200)}`);
  return r.json.result;
}
const safe = async (label, fn) => { try { await fn(); } catch (e) { out({ kind: 'error', label, error: e.message }); } };

async function layerMeta(url, label) {
  const m = await get(url + '?f=pjson');
  const j = m.json || {};
  out({ kind: 'layer', label, url, status: m.status, name: j.name, type: j.type, geometryType: j.geometryType, maxRecordCount: j.maxRecordCount,
    supportsPagination: j.advancedQueryCapabilities ? j.advancedQueryCapabilities.supportsPagination : null,
    supportsStatistics: j.advancedQueryCapabilities ? j.advancedQueryCapabilities.supportsStatistics : j.supportsStatistics,
    spatialReference: j.extent && j.extent.spatialReference, extent: j.extent && { xmin: j.extent.xmin, ymin: j.extent.ymin, xmax: j.extent.xmax, ymax: j.extent.ymax },
    copyright: j.copyrightText || null, description: trim(j.description || '', 400), fields: (j.fields || []).map((f) => `${f.name}:${f.type.replace('esriFieldType', '')}${f.alias && f.alias !== f.name ? '·' + f.alias : ''}`) });
  return j;
}

async function xplan() {
  await layerMeta(XPLAN, 'xplan-1');
  await safe('count', async () => { const r = await post(XPLAN + '/query', { where: '1=1', returnCountOnly: 'true' }); out({ kind: 'count', status: r.status, ms: r.ms, count: r.json && r.json.count, error: r.json && r.json.error }); });
  for (const f of ['internet_short_status', 'entity_subtype_desc', 'station_desc', 'plan_charactor_name', 'district_name']) {
    await safe('tally ' + f, async () => {
      const r = await post(XPLAN + '/query', { where: '1=1', groupByFieldsForStatistics: f, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'objectid', outStatisticFieldName: 'n' }]) });
      const rows = (r.json && r.json.features || []).map((x) => x.attributes).sort((a, b) => b.n - a.n);
      out({ kind: 'tally', field: f, status: r.status, ms: r.ms, groups: rows.length, rows: rows.slice(0, 60), error: r.json && r.json.error });
    });
  }
  /* the objectid range (paging by objectid when resultOffset is not offered) */
  await safe('oid range', async () => {
    const r = await post(XPLAN + '/query', { where: '1=1', outStatistics: JSON.stringify([{ statisticType: 'min', onStatisticField: 'objectid', outStatisticFieldName: 'lo' }, { statisticType: 'max', onStatisticField: 'objectid', outStatisticFieldName: 'hi' }]) });
    out({ kind: 'oidRange', status: r.status, value: r.json && r.json.features && r.json.features[0] && r.json.features[0].attributes, error: r.json && r.json.error });
  });
  /* one generalized page of geometries (~10 m, 5 decimals, WGS84) → bytes per plan → a national extract's size */
  for (const [off, prec] of [[0.0001, 5], [0.0003, 5]]) {
    await safe('geometry sample ' + off, async () => {
      const r = await post(XPLAN + '/query', { where: '1=1', outFields: 'objectid,pl_number', returnGeometry: 'true', outSR: 4326, maxAllowableOffset: off, geometryPrecision: prec,
        resultOffset: 0, resultRecordCount: 200, orderByFields: 'objectid' });
      const feats = (r.json && r.json.features) || [];
      const verts = feats.map((f) => (f.geometry && f.geometry.rings ? f.geometry.rings.reduce((a, x) => a + x.length, 0) : 0));
      verts.sort((a, b) => a - b);
      out({ kind: 'geometrySample', maxAllowableOffset: off, status: r.status, ms: r.ms, features: feats.length, bytes: r.bytes, bytesPerPlan: feats.length ? Math.round(r.bytes / feats.length) : null,
        vertices: verts.length ? { median: verts[verts.length >> 1], p90: verts[Math.floor(verts.length * 0.9)], max: verts[verts.length - 1] } : null, exceeded: r.json && r.json.exceededTransferLimit, error: r.json && r.json.error });
    });
  }
  /* transport plans by their own words (name / objectives): the light-rail / metro / rail plans the layer holds and their statuses */
  for (const w of ['רכבת קלה', 'מטרו', 'רכבת', 'רק"ל', 'נת"צ', 'מסילה', 'תחנה']) {
    await safe('words ' + w, async () => {
      const like = `(pl_name LIKE '%${w.replace(/'/g, "''")}%')`;
      const c = await post(XPLAN + '/query', { where: like, returnCountOnly: 'true' });
      const s = await post(XPLAN + '/query', { where: like, outFields: 'pl_number,pl_name,internet_short_status,station_desc,entity_subtype_desc,district_name,pl_area_dunam,last_update_date', returnGeometry: 'false', resultRecordCount: 12, orderByFields: 'pl_area_dunam DESC' });
      out({ kind: 'transportWords', word: w, count: c.json && c.json.count, sample: ((s.json && s.json.features) || []).map((f) => f.attributes), error: (c.json && c.json.error) || (s.json && s.json.error) });
    });
  }
}

async function ttl() {
  const svc = await get(IPLAN + 'ttl_all_blue_lines/MapServer?f=pjson');
  out({ kind: 'service', name: 'ttl_all_blue_lines', status: svc.status, layers: ((svc.json && svc.json.layers) || []).map((l) => `${l.id}:${l.name}`), copyright: svc.json && svc.json.copyrightText });
  for (const l of ((svc.json && svc.json.layers) || []).slice(0, 4)) {
    const url = IPLAN + 'ttl_all_blue_lines/MapServer/' + l.id;
    await safe('ttl layer ' + l.id, async () => {
      await layerMeta(url, 'ttl-' + l.id);
      const c = await post(url + '/query', { where: '1=1', returnCountOnly: 'true' });
      const s = await post(url + '/query', { where: '1=1', outFields: '*', returnGeometry: 'false', resultRecordCount: 25 });
      out({ kind: 'ttlRows', layer: l.id, count: c.json && c.json.count, sample: ((s.json && s.json.features) || []).map((f) => f.attributes), error: (c.json && c.json.error) || (s.json && s.json.error) });
      const g = await post(url + '/query', { where: '1=1', outFields: '*', returnGeometry: 'true', outSR: 4326, maxAllowableOffset: 0.0001, geometryPrecision: 5, resultRecordCount: 50 });
      out({ kind: 'ttlGeometry', layer: l.id, status: g.status, bytes: g.bytes, features: ((g.json && g.json.features) || []).length, error: g.json && g.json.error });
    });
  }
  const tr = await get(IPLAN + 'train_compilation/MapServer?f=pjson');
  out({ kind: 'service', name: 'train_compilation', status: tr.status, layers: ((tr.json && tr.json.layers) || []).map((l) => `${l.id}:${l.name}`), copyright: tr.json && tr.json.copyrightText, description: trim((tr.json && tr.json.serviceDescription) || '', 400) });
  for (const l of ((tr.json && tr.json.layers) || []).slice(0, 12)) {
    await safe('train layer ' + l.id, async () => {
      const url = IPLAN + 'train_compilation/MapServer/' + l.id;
      const m = await get(url + '?f=pjson');
      const c = await post(url + '/query', { where: '1=1', returnCountOnly: 'true' });
      const s = await post(url + '/query', { where: '1=1', outFields: '*', returnGeometry: 'false', resultRecordCount: 6 });
      out({ kind: 'trainLayer', layer: l.id, name: l.name, geometryType: m.json && m.json.geometryType, fields: ((m.json && m.json.fields) || []).map((f) => `${f.name}${f.alias && f.alias !== f.name ? '·' + f.alias : ''}`),
        count: c.json && c.json.count, sample: ((s.json && s.json.features) || []).map((f) => f.attributes), error: (c.json && c.json.error) || (s.json && s.json.error) });
    });
  }
}

async function transport() {
  await safe('license_list', async () => { const r = await ck('license_list', {}); out({ kind: 'licenseList', licences: r.map((x) => ({ id: x.id, title: x.title, url: x.url })) }); });
  const seen = new Map();
  for (const q of ['רכבת קלה', 'תחנות רכבת', 'מטרו', 'lrt', 'metro', 'rail', 'תחנות רכבת ישראל', 'GTFS', 'תחבורה ציבורית']) {
    await safe('search ' + q, async () => {
      const r = await ck('package_search', { q, rows: 30 });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => ({ name: p.name, title: p.title, org: p.organization && p.organization.name, modified: p.metadata_modified, license: p.license_id || null })) });
      for (const p of r.results) seen.set(p.name, p);
    });
  }
  for (const p of seen.values()) {
    if (!/רכבת|רק"ל|מטרו|lrt|metro|rail|train|gtfs|תחנ/i.test(`${p.title} ${p.name}`)) continue;
    out({ kind: 'package', name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified,
      license: { id: p.license_id || null, title: p.license_title || null, url: p.license_url || null }, notes: trim(p.notes || '', 600),
      extras: (p.extras || []).map((e) => `${e.key}=${trim(e.value, 120)}`),
      resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, format: x.format, ds: x.datastore_active, lm: x.last_modified, size: x.size, url: x.url })) });
    for (const x of (p.resources || []).filter((y) => y.datastore_active).slice(0, 3)) {
      await safe('table ' + x.id, async () => {
        const r = await ck('datastore_search', { resource_id: x.id, limit: 4 });
        out({ kind: 'table', package: p.name, resource: x.id, name: x.name, total: r.total, fields: r.fields.map((f) => `${f.id}:${f.type}`), sample: r.records });
      });
    }
  }
  /* the portal's own terms (what a dataset without a stated licence is published under) */
  await safe('terms', async () => { const r = await get('https://data.gov.il/terms'); out({ kind: 'terms', url: 'https://data.gov.il/terms', status: r.status, bytes: r.bytes, head: trim(r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 1500) }); });
}

(async () => {
  if (args.includes('--xplan')) await xplan();
  else if (args.includes('--ttl')) await ttl();
  else if (args.includes('--transport')) await transport();
  else { console.error('usage: --xplan | --ttl | --transport'); process.exit(2); }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
