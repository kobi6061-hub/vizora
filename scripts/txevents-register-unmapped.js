#!/usr/bin/env node
// PROPX · THE REGISTER'S DEALS UNDER SETTLEMENT NAMES NO OFFICIAL LOCALITY CARRIES (closure P0, 20.10.2026).
//
// The register copy lists 1,335 settlement names; the sweep reads those whose code is an official locality code. The rest (a regional
// council's name, a merged village, a neighbourhood the register files apart — "צהל", "רמת אפעל", "מ. א. מטה יהודה" …) were listed, not
// read: their deals reached no locality, not even their recent ones. This job reads every deal under every such name, all years (the
// register's own search, the sweep's provably complete split, one request a second), and places each deal by its PARCEL — the same
// recovery as the GovMap layer's unplaced rows (lib/txevents/recover.js: the parcel polygon / block · parcel filed under exactly one
// locality by the whole layer and the register copy; never by the name). RESOLVED deals join their locality's events (never priced: the
// locality is PROPX's placement, not the register's statement); the rest stay UNPLACED in the national universe.
// It also stores the register's own per-settlement counts and latest deal (the source side of the latest-date parity).
//
//   node scripts/txevents-register-unmapped.js --extract <dir>    (dir = scripts/txevents-gpkg.py, for the layer's parcel knowledge)
// Output: data/txevents/history/register-unmapped.json, data/txevents/history/register-settlements.json

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.TXEVENTS_HISTORY_OUT || path.join(ROOT, 'data', 'txevents', 'history');
const BASE = process.env.STREET_EVIDENCE_BASE || 'https://www.over.org.il';
const UA = 'PROPX-txevents-register-unmapped/1.0 (+https://github.com/kobi6061-hub/vizora; read-only)';
const GAP_MS = Number(process.env.STREET_EVIDENCE_GAP_MS || 1000);
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

let lastAt = 0, requests = 0;
async function get(p, params = {}) {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    const wait = lastAt + GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
    lastAt = Date.now(); requests++;
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { retry: true, slow: r.status === 429 });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${u.pathname}`);
      return await r.json();
    } catch (e) {
      const retry = e.retry || e.name === 'TimeoutError' || /fetch failed|ECONN|ETIMEDOUT|socket/i.test(String(e.message));
      if (!retry || attempt >= 5) throw e;
      await sleep((e.slow ? 60000 : 5000) * attempt);
    }
  }
}

(async () => {
  const dir = opt('--extract');
  const SD = require('../lib/streets/directory'), EV = require('../lib/streets/evidence'), SW = require('../lib/streets/sweep'), M = require('../lib/streets/match');
  const KIT = require('../lib/txevents/kit'), RCV = require('../lib/txevents/recover'), REC = require('../lib/recent/reconcile');
  const D = SD.load();
  const K = dir ? KIT.knowledgeFrom(dir, D, EV, REC) : null;
  const stats = await get('/api/deals/stats');
  const list = ((await get('/api/deals/settlements')) || {}).data || [];
  const codeOf = (s) => { const c = num(s.settlement_code) != null ? num(s.settlement_code) : num(s.resolved_code); return c != null && D.localities.has(c) ? c : null; };
  const settlements = list.map((s) => ({ settlement: s.settlement, settlementCode: num(s.settlement_code), resolvedCode: num(s.resolved_code), code: codeOf(s), deals: num(s.deals), lastDeal: s.last_deal ? String(s.last_deal).slice(0, 10) : null }));
  const listed = settlements.reduce((a, s) => a + (s.deals || 0), 0);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'register-settlements.json'), JSON.stringify({ schema: 1, readAt: new Date().toISOString(), scrapedAt: stats.scraped_at || null, deals: num(stats.deals), firstDeal: stats.first_deal || null, lastDeal: stats.last_deal || null,
    listedDeals: listed, dealsUnderNoSettlement: num(stats.deals) != null ? num(stats.deals) - listed : null, settlements }) + '\n');
  const unmapped = settlements.filter((s) => s.code == null && s.deals);
  console.log(JSON.stringify({ settlements: settlements.length, unmapped: unmapped.length, unmappedDeals: unmapped.reduce((a, s) => a + s.deals, 0), dealsUnderNoSettlement: num(stats.deals) - listed }));
  if (!K) { console.log('no --extract: the settlement list only'); return; }

  /* every deal under every unmapped name, all years — the sweep's provably complete split */
  const search = async (name, from, to, offset = 0) => { const b = await get('/api/deals/search', { settlement: name, date_from: from, date_to: to, sort: 'date_desc', limit: SW.PAGE, offset }); const data = Array.isArray(b.data) ? b.data : []; const total = Number(b.total); return { data, total: Number.isFinite(total) ? total : null, capped: !!b.total_capped }; };
  const st = { leaves: 0, splits: 0, pagedDays: 0 };
  const rows = [], failed = [];
  const from = String(stats.first_deal || '1998-01-01').slice(0, 10), to = String(stats.last_deal).slice(0, 10);
  for (const s of unmapped) {
    try {
      const first = await search(s.settlement, from, to);
      const got = await SW.sweepWindow(s.settlement, from, to, first, st, search);
      for (const d of got) rows.push({ s: s.settlement, d });
    } catch (e) { failed.push({ settlement: s.settlement, error: String(e.message).slice(0, 200) }); }
  }
  /* each deal placed by its parcel; a resolved deal's parcel addresses matched to the locality's official streets */
  const LIs = new Map(); const LI = (c) => { if (!LIs.has(c)) LIs.set(c, M.localityIndex(D, c)); return LIs.get(c); };
  const COLS = ['settlement', 'date', 'amount', 'declaredAmount', 'nature', 'areaSqm', 'rooms', 'yearBuilt', 'portion', 'block', 'parcel', 'subParcel', 'addresses', 'addressesTotal', 'state', 'code', 'basis', 'candidates', 'streets'];
  const tally = {};
  const out = rows.map(({ s, d }) => {
    const x = RCV.recover(K, { settlementId: null, polygon: null, gush: d.gush, parcel: d.helka }, null);
    tally[x.state] = (tally[x.state] || 0) + 1;
    const addrs = Array.isArray(d.addresses) ? d.addresses.map(String) : [];
    const m = x.code != null && addrs.length ? M.matchDeal(LI(x.code), addrs, d.addresses_total) : null;
    return [s, String(d.date).slice(0, 10), num(d.amount), num(d.declared_amount), d.nature || null, num(d.area_sqm), num(d.rooms), num(d.year_built), num(d.portion_fraction), num(d.gush), num(d.helka), d.sub_parcel != null ? String(d.sub_parcel) : null,
      addrs.slice(0, 3), num(d.addresses_total), x.state, x.code, x.basis, x.candidates ? x.candidates.map((c) => c.code).join(',') : null,
      m ? [m.state, m.streets.map((z) => [Number(String(z.id).split(':')[2]), z.via, z.houses])] : null];
  });
  out.sort((a, b) => b[1].localeCompare(a[1]));
  fs.writeFileSync(path.join(OUT, 'register-unmapped.json'), JSON.stringify({ schema: 1, readAt: new Date().toISOString(), scrapedAt: stats.scraped_at || null, window: { from, to },
    settlements: unmapped.map((s) => s.settlement), requests, sweep: st, failed, byState: tally, columns: COLS, rows: out }) + '\n');
  console.log(JSON.stringify({ ok: !failed.length, rows: out.length, byState: tally, requests, failed: failed.length }));
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error('register-unmapped: ' + e.message); process.exit(1); });
