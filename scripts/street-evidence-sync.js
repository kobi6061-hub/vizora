#!/usr/bin/env node
// PROPX · STREET MARKET EVIDENCE — sweep of the deals register (republished copy, over.org.il) per locality, joined to the
// official street directory (lib/streets/match.js). Runs on a GitHub runner (the sandbox cannot reach the publisher).
//
//   source   GET https://www.over.org.il/api/deals/{stats,natures,settlements,search} — a public, documented, key-less API
//            of a volunteer transparency project: sequential requests, one second apart, retried politely on 429 / 5xx.
//   window   the 36 months that end on the copy's latest deal (stats.last_deal), not on today: the copy is a snapshot.
//   sweep    every settlement name of the register with a deal in the window, grouped by its CBS locality code
//            (settlement_code, else the publisher's resolved_code); a name with no code in the directory is listed, not swept.
//            A settlement's window is split by date until every query answers ≤ 200 rows in ONE page, so no offset paging
//            over a non-unique sort can skip a row; every leaf proves fetched = total, every split proves the children's
//            totals add up to the parent's. A single day with more than 200 deals is paged and must add up as well.
//            Any short read fails that locality (its previous shard is kept) and the run is PARTIAL.
//   storage  data/streets/evidence/<locality>.json — every row of the window, the source's fields verbatim in columns
//            (amount, nature, area, rooms, year built, portion, gush / helka / sub-parcel, the parcel's crosswalk addresses)
//            + the parcel's match to the directory; summary.json (per street: observed / priced / ₪-per-m² counts, latest
//            deal, possible); meta.json; sync-runs.jsonl; progress.json while a sweep is unfinished (the next run resumes).
//   change   nothing is swept again until the publisher's copy changes (stats.scraped_at) unless --force.
//
//   node scripts/street-evidence-sync.js                       live sweep (resumes an unfinished one)
//   --force                                                    sweep although the copy did not change
//   --only 5000,7900                                           these locality codes only (a test run; the run is PARTIAL)
//   --max-minutes N                                            stop cleanly after N minutes (progress kept)
//   --rebuild                                                  offline: re-match the stored shards to the current directory
//   --summary-file <path>                                      append a one-line summary (commit message)
// Exit: 0 complete / partial-with-progress · 1 failed.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SD = require('../lib/streets/directory');
const M = require('../lib/streets/match');
const EV = require('../lib/streets/evidence');
const SW = require('../lib/streets/sweep');
const { windowOf, normalize, buildShard, rematch } = SW;
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

const BASE = process.env.STREET_EVIDENCE_BASE || 'https://www.over.org.il';
const DIR = EV.DIR;
const UA = 'PROPX-street-evidence/1.0 (+https://github.com/kobi6061-hub/vizora)';
const GAP_MS = Number(process.env.STREET_EVIDENCE_GAP_MS || 1000);
const args = process.argv.slice(2);
const has = (f) => args.includes('--' + f);
const argVal = (f) => { const i = args.indexOf('--' + f); return i > -1 ? args[i + 1] : null; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, f), JSON.stringify(o) + '\n'); };
const hashOf = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

/* ── transport: one request at a time, GAP_MS apart ── */
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
      const retry = e.retry || e.name === 'TimeoutError' || e.name === 'AbortError' || /fetch failed|ECONN|ETIMEDOUT|socket/i.test(String(e.message));
      if (!retry || attempt >= 5) throw e;
      await sleep((e.slow ? 60000 : 5000) * attempt);
    }
  }
}

/* one page of the register for a settlement and a date range */
async function search(name, from, to, offset = 0) {
  const b = await get('/api/deals/search', { settlement: name, date_from: from, date_to: to, sort: 'date_desc', limit: SW.PAGE, offset });
  const data = Array.isArray(b.data) ? b.data : [];
  const total = Number(b.total);
  return { data, total: Number.isFinite(total) ? total : null, capped: !!b.total_capped };
}
const sweepWindow = (name, from, to, first, st) => SW.sweepWindow(name, from, to, first, st, search);

function finish(meta, run, D) {
  fs.mkdirSync(DIR, { recursive: true });
  const summary = EV.summarize(DIR, D);
  meta.counts = summary.counts;
  meta.directory = D.fileHash;
  writeJson('summary.json', summary);
  writeJson('meta.json', meta);
  return summary;
}

(async () => {
  const startedAt = new Date().toISOString();
  const run = { id: 'street-evidence-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: 'over:deals-register', startedAt, status: 'failed' };
  const D = SD.load();
  try {
    if (has('rebuild')) {
      let n = 0;
      for (const f of fs.readdirSync(DIR).filter((x) => /^\d+\.json$/.test(x))) { writeJson(f, rematch(readJson(f), D)); n++; }
      const meta = readJson('meta.json') || {};
      const s = finish(meta, run, D);
      console.log(`rebuilt ${n} shards`, JSON.stringify(s.counts));
      return;
    }
    const deadline = Date.now() + Number(argVal('max-minutes') || 330) * 60e3;
    const stats = await get('/api/deals/stats');
    const scrapedAt = stats && stats.scraped_at ? String(stats.scraped_at) : null;
    if (!scrapedAt || !stats.last_deal) throw new Error('the register copy states no scrape date / latest deal — nothing swept');
    const prevMeta = readJson('meta.json');
    let progress = readJson('progress.json');
    if (progress && progress.scrapedAt !== scrapedAt) progress = null;          // the copy changed under an unfinished sweep: start over
    const only = argVal('only') ? new Set(String(argVal('only')).split(',').map(Number)) : null;
    if (!progress && !only && !has('force') && prevMeta && prevMeta.source && prevMeta.source.scrapedAt === scrapedAt && prevMeta.sweep && prevMeta.sweep.status === 'COMPLETE') {
      Object.assign(run, { status: 'unchanged', scrapedAt, finishedAt: new Date().toISOString(), requests });
      fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n');
      console.log('the register copy has not changed since the last complete sweep (' + scrapedAt + ')');
      return;
    }
    const window = windowOf(stats.last_deal);
    const natures = await get('/api/deals/natures');
    const settlements = await get('/api/deals/settlements');
    const list = (settlements && (settlements.data || settlements)) || [];
    /* settlement names → locality codes */
    const byCode = new Map(), unmapped = [];
    let outside = 0;
    for (const s of list) {
      if (!s || !s.settlement) continue;
      if (s.last_deal && String(s.last_deal).slice(0, 10) < window.from) { outside++; continue; }
      const code = num(s.settlement_code) != null ? num(s.settlement_code) : num(s.resolved_code);
      if (code == null || !D.localities.has(code)) { unmapped.push({ settlement: s.settlement, deals: num(s.deals), resolvedName: s.resolved_name || null }); continue; }
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(s.settlement);
    }
    const codes = [...byCode.keys()].filter((c) => !only || only.has(c)).sort((a, b) => a - b);
    progress = progress || { scrapedAt, startedAt, window, done: [], failed: [] };
    /* a locality that failed in an earlier run of this sweep is tried again (once per run) */
    const retry = new Set(progress.failed.map((f) => f.code));
    progress.done = progress.done.filter((c) => !retry.has(c));
    const fetchedAt = new Date().toISOString();
    const meta = { schema: EV.META_SCHEMA,
      source: { name: 'Tax Authority deals register — republished copy (over.org.il)', base: BASE, channel: 'independent-republication', scrapedAt,
        lastDeal: String(stats.last_deal).slice(0, 10), firstDeal: stats.first_deal || null, datasetId: stats.dataset_id || null, registerUrl: stats.source_url || null, deals: num(stats.deals) },
      window, dwellingNatures: [...EV.DWELLING_NATURES], natures: ((natures && natures.data) || []).map((n) => ({ nature: n.nature, deals: num(n.deals), note: n.note || null })),
      settlements: { total: list.length, outsideWindow: outside, mapped: [...byCode.values()].reduce((n, l) => n + l.length, 0), localities: byCode.size, unmapped },
      sweep: { status: 'RUNNING', startedAt: progress.startedAt, updatedAt: fetchedAt, done: progress.done.length, of: codes.length, failed: progress.failed } };
    const st = { leaves: 0, splits: 0, pagedDays: 0, rows: 0, duplicates: 0 };
    writeJson('progress.json', progress);
    for (const code of codes) {
      if (progress.done.includes(code)) continue;
      if (Date.now() > deadline) break;
      try {
        let rows = [];
        for (const name of byCode.get(code)) {
          const first = await search(name, window.from, window.to);
          rows.push(...await sweepWindow(name, window.from, window.to, first, st));
        }
        const n = normalize(rows); st.rows += n.kept.length; st.duplicates += n.duplicates;
        const shard = buildShard(code, byCode.get(code), n.kept, { window, scrapedAt, fetchedAt }, D);
        shard.duplicatesCollapsed = n.duplicates;
        shard.contentHash = hashOf(shard.rows.concat(shard.parcels));
        writeJson(code + '.json', shard);
        progress.done.push(code);
        progress.failed = progress.failed.filter((f) => f.code !== code);
      } catch (e) {
        progress.failed = progress.failed.filter((f) => f.code !== code).concat([{ code, error: String(e.message).slice(0, 300) }]);
        progress.done.push(code);              // not retried in this sweep; listed — its previous shard (if any) is kept
      }
      writeJson('progress.json', progress);
    }
    const remaining = codes.filter((c) => !progress.done.includes(c)).length;
    const complete = !remaining && !progress.failed.length && !only;
    meta.sweep = { status: complete ? 'COMPLETE' : remaining ? 'RUNNING' : 'PARTIAL', startedAt: progress.startedAt, updatedAt: new Date().toISOString(),
      done: progress.done.length, of: codes.length, failed: progress.failed, only: only ? [...only] : undefined };
    if (complete) fs.rmSync(path.join(DIR, 'progress.json'), { force: true });
    const summary = finish(meta, run, D);
    Object.assign(run, { status: complete ? 'ok' : 'partial', scrapedAt, window, requests, finishedAt: new Date().toISOString(), sweep: meta.sweep,
      ...st, counts: summary.counts, contentChanged: true });
    fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n');
    const line = `Street evidence: ${meta.sweep.status} · ${meta.sweep.done}/${meta.sweep.of} localities · ${summary.counts.rows.toLocaleString('en')} deals ${window.from}…${window.to} · ${summary.counts.streetsWithObserved.toLocaleString('en')} streets with observed deals · copy ${scrapedAt.slice(0, 10)} · ${requests} requests`;
    const sf = argVal('summary-file'); if (sf) fs.appendFileSync(sf, line + '\n');
    console.log(line);
    if (progress.failed.length) console.log('failed localities:', JSON.stringify(progress.failed.slice(0, 30)));
  } catch (e) {
    run.error = String(e.message).slice(0, 500); run.finishedAt = new Date().toISOString(); run.requests = requests;
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, 'sync-runs.jsonl'), JSON.stringify(run) + '\n');
    console.error('street evidence sync failed:', e.message);
    process.exitCode = 1;
  }
})();
