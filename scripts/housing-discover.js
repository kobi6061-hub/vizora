#!/usr/bin/env node
// PROPX · official source discovery for government (subsidized) housing.
//
// Read-only. Prints what the official sources actually expose — datasets,
// resources, update times, field names/types, row counts and a few sample
// rows — so the ingestion contract is written from evidence, not from page
// wording. Runs where gov.il is reachable (the GitHub Actions runner via
// .github/workflows/housing-sync.yml, mode "discover"); the Claude sandbox
// cannot reach gov.il.
//
//   node scripts/housing-discover.js                 everything below
//   node scripts/housing-discover.js --resource <id> one CKAN resource in depth
//
// Nothing is written anywhere.

'use strict';

const CKAN = process.env.GOV_DATAGOV_BASE || 'https://data.gov.il/api/3/action';
const UA = 'PROPX-data-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };

/* a lead from public references — verified here, never assumed */
const LEADS = ['7c8255d0-49ef-49db-8904-4cf917586031'];
const QUERIES = [
  'דירה בהנחה', 'מחיר למשתכן', 'מחיר מטרה', 'הגרלות דירות', 'דיור מוזל', 'משרד הבינוי והשיכון',
  'היתרי בנייה', 'התחלות בנייה', 'גמר בנייה', 'טופס 4', 'מכרזי רשות מקרקעי ישראל', 'מכרזים רמ"י',
  'דירות שלא נמכרו', 'מלאי דירות חדשות', 'פרויקטים למגורים',
];
const trim = (v, n = 140) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const out = (o) => console.log(JSON.stringify(o));

async function get(url, accept = 'application/json') {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
  const text = await r.text();
  return { status: r.status, type: r.headers.get('content-type') || '', text };
}
async function ck(action, params = {}) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await get(u.toString());
  let j;
  try { j = JSON.parse(r.text); } catch { throw new Error(`${action} HTTP ${r.status} non-JSON: ${r.text.slice(0, 160)}`); }
  if (!j.success) throw new Error(`${action} HTTP ${r.status}: ${trim(j.error, 300)}`);
  return j.result;
}
const resSummary = (r) => ({ id: r.id, name: r.name, format: r.format, datastore_active: r.datastore_active,
  last_modified: r.last_modified, created: r.created, size: r.size, url: trim(r.url, 200) });

async function describeResource(id, samples = 3) {
  const res = await ck('resource_show', { id });
  const pkg = await ck('package_show', { id: res.package_id });
  out({ kind: 'resource', id, name: res.name, format: res.format, datastore_active: res.datastore_active,
    resource_last_modified: res.last_modified, resource_created: res.created,
    package: { name: pkg.name, title: pkg.title, organization: pkg.organization && pkg.organization.title,
      metadata_modified: pkg.metadata_modified, frequency: pkg.frequency || pkg.extras && pkg.extras.find((e) => /freq|update/i.test(e.key)),
      license: pkg.license_title, url: `https://data.gov.il/dataset/${pkg.name}` },
    sibling_resources: pkg.resources.map(resSummary) });
  if (!res.datastore_active) return;
  const ds = await ck('datastore_search', { resource_id: id, limit: samples });
  out({ kind: 'schema', id, total: ds.total, fields: ds.fields.map((f) => `${f.id}:${f.type}`) });
  for (const rec of ds.records) out({ kind: 'sample', id, record: Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, trim(v)])) });
  // newest rows by every date-looking field, to see the actual freshness
  for (const f of ds.fields.filter((x) => /date|תאריך|time|זמן|_dt$/i.test(x.id) || x.type === 'timestamp').slice(0, 4)) {
    try {
      const top = await ck('datastore_search', { resource_id: id, limit: 2, sort: `${f.id} desc` });
      out({ kind: 'newest', id, field: f.id, values: top.records.map((r) => r[f.id]) });
    } catch (e) { out({ kind: 'newest', id, field: f.id, error: e.message }); }
  }
}

async function main() {
  const one = argVal('resource');
  if (one) return describeResource(one, 5);

  // 1 · catalogue search
  const seen = new Map();
  for (const q of QUERIES) {
    try {
      const r = await ck('package_search', { q, rows: 15 });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => ({ name: p.name, title: p.title,
        org: p.organization && p.organization.title, modified: p.metadata_modified, resources: p.num_resources })) });
      for (const p of r.results) seen.set(p.name, p);
    } catch (e) { out({ kind: 'search', q, error: e.message }); }
  }
  // 2 · every housing-ministry / land-authority / planning package found: its resources
  const relevant = [...seen.values()].filter((p) => /בינוי|שיכון|מקרקעי|תכנון|housing|construction|land/i.test(
    `${p.organization && p.organization.title} ${p.organization && p.organization.name} ${p.title}`));
  for (const p of relevant) out({ kind: 'package', name: p.name, title: p.title, org: p.organization && p.organization.title,
    modified: p.metadata_modified, resources: (p.resources || []).map(resSummary) });
  // 3 · the lead resource(s) and every datastore resource of the relevant packages, in depth
  const ids = new Set(LEADS);
  for (const p of relevant) for (const r of p.resources || []) if (r.datastore_active) ids.add(r.id);
  for (const id of [...ids].slice(0, 25)) {
    try { await describeResource(id); } catch (e) { out({ kind: 'resource', id, error: e.message }); }
  }
  // 4 · the lottery website itself (not an open-data contract — recorded, not relied on)
  for (const u of ['https://www.dira.moch.gov.il/ProjectsList', 'https://dira.moch.gov.il/ProjectsList']) {
    try { const r = await get(u, 'text/html'); out({ kind: 'site', url: u, status: r.status, type: r.type, bytes: r.text.length }); }
    catch (e) { out({ kind: 'site', url: u, error: e.message }); }
  }
}

main().catch((e) => { console.error('discover failed:', e.message); process.exitCode = 1; });
