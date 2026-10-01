// PROPX · government (subsidized) housing — the official source.
//
// data.gov.il (CKAN datastore), dataset "נתונים תקופתיים - תכנית דירה בהנחה"
// (package mechir-lamishtaken) of the Ministry of Construction and Housing,
// resource "מעקב אחר הגרלות דירה בהנחה": one row per lottery (first and
// continuation lotteries) of the מחיר למשתכן / מחיר מטרה programs, with the
// project, developer, locality code, neighbourhood, dates, units, applicants,
// winners, official price per m², project status and permit status. Stated
// update frequency: weekly. Verified by scripts/housing-discover.js
// (GitHub Actions run 36889657484, 2026-10-01): 2,352 rows, unique LotteryId.

'use strict';

const SOURCE = Object.freeze({
  id: 'datagov:moch:dira-behanacha-lotteries',
  authority: 'משרד הבינוי והשיכון',
  authorityEn: 'Ministry of Construction and Housing',
  dataset: 'נתונים תקופתיים - תכנית דירה בהנחה',
  datasetName: 'mechir-lamishtaken',
  resource: 'מעקב אחר הגרלות דירה בהנחה',
  resourceId: '7c8255d0-49ef-49db-8904-4cf917586031',
  page: 'https://data.gov.il/dataset/mechir-lamishtaken',
  format: 'ckan-datastore',
  sourceClass: 'CONFIRMED_STRUCTURED',
  cadence: 'Week',
});

const CKAN = process.env.GOV_DATAGOV_BASE || 'https://data.gov.il/api/3/action';
const UA = 'PROPX-data-sync/1.0 (+https://github.com/kobi6061-hub/vizora; official open data)';

async function ckan(action, params, fetchImpl) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetchImpl(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`${action}: HTTP ${r.status}, not JSON`); }
  if (!j.success) throw new Error(`${action}: HTTP ${r.status}, ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result;
}

/** Every row of the lotteries resource + the source's own update time. */
async function fetchLotteries({ fetchImpl = globalThis.fetch } = {}) {
  const meta = await ckan('resource_show', { id: SOURCE.resourceId }, fetchImpl);
  const rows = [];
  let total = null;
  for (let offset = 0; ; offset += 1000) {
    const r = await ckan('datastore_search', { resource_id: SOURCE.resourceId, limit: 1000, offset }, fetchImpl);
    total = r.total;
    rows.push(...r.records);
    if (!r.records.length || rows.length >= total) break;
  }
  if (rows.length !== total) throw new Error(`incomplete read: ${rows.length} of ${total} rows`);
  return { rows, total, sourceUpdatedAt: meta.last_modified ? meta.last_modified + (/[zZ]|[+-]\d\d:?\d\d$/.test(meta.last_modified) ? '' : 'Z') : null,
    endpoint: `${CKAN}/datastore_search?resource_id=${SOURCE.resourceId}` };
}

module.exports = { SOURCE, fetchLotteries };
