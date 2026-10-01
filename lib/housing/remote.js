// PROPX · the housing records as the PROPX Supabase project holds them — the
// store of record once the project is configured (server-side SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY). query.js reads this first and falls back to the
// snapshot bundled with the deployment (data/housing/, written by the same
// sync) when the store is not configured, unreachable, incomplete or behind.
//
// A store snapshot is accepted only whole: the latest completed housing sync
// run (with the meta it wrote), exactly as many records and status-history
// events as that run says it holds. Anything else is a reason to fall back,
// reported in the answer.

'use strict';

const PAGE = 1000;

async function getJson(fetchImpl, url, key, headers = {}, signal, withTotal = false) {
  const r = await fetchImpl(url, { signal, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Accept-Profile': 'market', ...headers } });
  if (!r.ok) throw new Error(`store ${r.status} on ${url.split('/rest/v1/')[1].split('?')[0]}`);
  const body = await r.json();
  if (!withTotal) return body;
  const range = r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-range') : null;
  const m = /\/(\d+)$/.exec(range || '');
  return { rows: body, total: m ? Number(m[1]) : null };
}

/* every row of a table, page by page: follows the exact count the store reports, so a
   project whose row cap is below PAGE is still read whole (and a short read is caught) */
async function paged(fetchImpl, base, key, table, query, signal) {
  const out = [];
  let total = null;
  for (;;) {
    const from = out.length;
    const page = await getJson(fetchImpl, `${base}${table}?${query}`, key,
      { 'Range-Unit': 'items', Range: `${from}-${from + PAGE - 1}`, ...(from === 0 ? { Prefer: 'count=exact' } : {}) }, signal, true);
    if (from === 0) total = page.total;
    out.push(...page.rows);
    if (!page.rows.length || (total != null ? out.length >= total : page.rows.length < PAGE)) return out;
  }
}

/**
 * @returns {Promise<{meta, records, history, runFinishedAt}>} or throws with the reason
 */
async function loadRemote({ url, key, sourceId, fetchImpl = globalThis.fetch, timeoutMs = 6000 }) {
  const base = url.replace(/\/$/, '') + '/rest/v1/';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const [run] = await getJson(fetchImpl, `${base}sync_runs?select=finished_at,snapshot_hash,details&source_id=eq.${encodeURIComponent(sourceId)}`
      + '&status=eq.ok&order=finished_at.desc&limit=1', key, {}, ctl.signal);
    const meta = run && run.details && run.details.meta;
    if (!meta) throw new Error('store has no completed housing sync run');
    const rows = await paged(fetchImpl, base, key, 'housing_lotteries', 'select=record&order=id.asc', ctl.signal);
    const records = rows.map((r) => r.record).filter(Boolean);
    if (records.length !== meta.records) throw new Error(`store holds ${records.length} records, its last run ${meta.records}`);
    const hist = await paged(fetchImpl, base, key, 'housing_status_history',
      'select=record_id,field,from_value,to_value,observed_at,run_key&order=observed_at.asc,id.asc', ctl.signal);
    if (Number.isInteger(meta.historyEvents) && hist.length !== meta.historyEvents) throw new Error(`store holds ${hist.length} history events, its last run ${meta.historyEvents}`);
    const history = hist.map((h) => ({ id: h.record_id, field: h.field, from: h.from_value, to: h.to_value, observedAt: h.observed_at, syncRunId: h.run_key }));
    return { meta, records, history, runFinishedAt: run.finished_at };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `store did not answer within ${timeoutMs} ms` : e.message);
  } finally { clearTimeout(timer); }
}

module.exports = { loadRemote };
