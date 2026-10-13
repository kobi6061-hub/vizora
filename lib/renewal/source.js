// PROPX · Urban renewal — the official source.
//
// data.gov.il (CKAN datastore), dataset "התחדשות עירונית" (package urban_renewal) of the Ministry of Construction and
// Housing, resource "מתחמי התחדשות עירונית": one row per DECLARED urban-renewal complex (מתחם) in the municipal and
// tax tracks — complex number, locality (name + CBS code), complex name, existing / additional / proposed housing
// units, declaration date, plan number, links, track, approval year, an execution flag and the Ministry's status.
// Verified by scripts/land-discover.js --supply (GitHub Actions run 38330753512, 13.10.2026): 970 rows, resource last
// modified 2026-08-15. A declared complex is NOT construction: the status says how far planning / licensing went.

'use strict';

const SOURCE = Object.freeze({
  id: 'datagov:moch:urban-renewal-complexes',
  authority: 'משרד הבינוי והשיכון',
  authorityEn: 'Ministry of Construction and Housing',
  dataset: 'התחדשות עירונית',
  datasetName: 'urban_renewal',
  resource: 'מתחמי התחדשות עירונית',
  resourceId: 'f65a0daf-f737-49c5-9424-d378d52104f5',
  page: 'https://data.gov.il/dataset/urban_renewal',
  format: 'ckan-datastore',
  classification: 'CONFIRMED_STRUCTURED_API',
  scope: 'complexes DECLARED in the municipal (רשויות) and tax (מיסוי) tracks — not every urban-renewal project (TAMA 38 building permits are not complexes)',
  verified: { run: '38330753512', at: '2026-10-13', rows: 970, sourceModified: '2026-08-15' },
});

const CKAN = process.env.GOV_DATAGOV_BASE || 'https://data.gov.il/api/3/action';
const UA = 'PROPX-data-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';

async function ckan(action, params, fetchImpl) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetchImpl(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { const e = new Error(`${action}: HTTP ${r.status}, not JSON`); e.status = r.status; throw e; }
  if (!j.success) { const e = new Error(`${action}: HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`); e.status = r.status; throw e; }
  return j.result;
}

/** Every row of the complexes resource + the source's own update time. Pages are read in a stable order (_id); the
 *  read must contain exactly `total` distinct rows — a skipped or repeated page fails the run. */
async function fetchComplexes({ fetchImpl = globalThis.fetch } = {}) {
  const meta = await ckan('resource_show', { id: SOURCE.resourceId }, fetchImpl);
  const rows = [];
  let total = null;
  for (let offset = 0; ; ) {
    const r = await ckan('datastore_search', { resource_id: SOURCE.resourceId, limit: 1000, offset, sort: '_id asc' }, fetchImpl);
    total = r.total;
    rows.push(...r.records);
    offset += r.records.length;
    if (!r.records.length || rows.length >= total) break;
  }
  const ids = new Set(rows.map((x) => x._id));
  if (rows.length !== total || ids.size !== total) throw new Error(`incomplete read: ${rows.length} rows (${ids.size} distinct) of ${total}`);
  return { rows, total, sourceUpdatedAt: meta.last_modified ? meta.last_modified + (/[zZ]|[+-]\d\d:?\d\d$/.test(meta.last_modified) ? '' : 'Z') : null,
    endpoint: `${CKAN}/datastore_search?resource_id=${SOURCE.resourceId}` };
}

module.exports = { SOURCE, fetchComplexes };
