// GET /api/housing?view=summary|records|record|status&…
//
// Government (subsidized) housing — the read side of the official lottery
// records that scripts/housing-sync.js ingests on a schedule (data/housing/).
// Session-gated like every route (middleware.js). The browser never receives
// the national dataset: it asks for a summary, one page of rows, or one
// record, already filtered here.
//
//   view=summary  KPIs · coverage of the period · series · drill-down · filter choices
//   view=records  one sorted page of rows (sort, order, page, size ≤ 100)
//   view=record   one lottery (id=lottery:<LotteryId>) with its project, lifecycle evidence, history
//   view=status   freshness + the latest sync runs
// Filters: period=6m|12m|24m|all|custom (&from&to=YYYY-MM-DD), city (CBS code or
// official name), neighborhood, project (ProjectId or name), developer,
// program, status, permit, lotteryStatus, type=first|continuation, q.
//
// Store of record: the PROPX Supabase project when the server-side env holds
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; the snapshot bundled with the
// deployment otherwise, or when the store is unreachable, incomplete or behind
// (lib/housing/query.js). Every answer names it in freshness.store.

'use strict';

const Q = require('../lib/housing/query');

const send = (res, code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  const url = new URL(req.url, 'http://x');
  const g = (k) => url.searchParams.get(k);
  const view = g('view') || 'summary';
  try {
    await Q.prime();
    if (view === 'status') return send(res, 200, Q.status());
    if (view === 'record') {
      const out = g('id') ? Q.record(g('id')) : null;
      return out ? send(res, 200, out) : send(res, 404, { error: 'not-found' });
    }
    const { filters, error } = Q.parseFilters(url.searchParams);
    if (error) return send(res, 400, { error });
    if (view === 'summary') return send(res, 200, Q.summary(filters, { bucket: g('bucket') }));
    if (view === 'records') return send(res, 200, Q.records(filters, { sort: g('sort'), order: g('order'), page: g('page'), size: g('size') }));
    return send(res, 400, { error: 'unknown view' });
  } catch (e) {
    console.error('housing api:', e.message);
    return send(res, 500, { error: 'housing-query-failed' });
  }
};
