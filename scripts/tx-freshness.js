#!/usr/bin/env node
// PROPX · daily transaction-freshness monitor (P0 audit, 19.10.2026) — READ-ONLY, separate from the weekly model rebuild.
//
// Every day, on a GitHub runner, it asks each transaction channel what it holds today and compares that with what PROPX
// stores, and writes the answer — never a transaction:
//   · the register copy PROPX reads (over.org.il /api/deals/stats): reachable? snapshot date (scraped_at), latest deal, rows
//   · the GovMap-layer copy (over.org.il /api/deals/govmap/stats): snapshot (loaded_at), latest deal — a NEWER copy PROPX does
//     not read is reported as such, never silently used
//   · the official channels (Tax Authority register, nadlan.gov.il, GovMap): reachable / refused / behind a CAPTCHA — recorded,
//     never bypassed
//   · PROPX's stored universe (data/streets/evidence): latest transaction date, counts over 7 · 30 · 60 · 90 · 180 · 365 days by
//     transaction date (to today and to the copy's latest deal), the last six months
//   · the lag in days, the freshness state (lib/gov/freshness.js) and the alerts: MATERIAL_LAG (a reachable copy's latest deal
//     ≥ 7 days after PROPX's, or the copy STALE / VERY STALE), NEW_COPY_NOT_SWEPT (the register copy changed and PROPX has not
//     swept it), VOLUME_DROP (the copy or PROPX's last-365-day count fell), OFFICIAL_UNREACHABLE (informational)
// Output: data/transactions/freshness.json (the latest) + data/transactions/freshness-runs.jsonl (append-only). Bot-written.
//
//   node scripts/tx-freshness.js [--dry-run] [--today YYYY-MM-DD]

'use strict';

const fs = require('fs');
const path = require('path');
const F = require('../lib/gov/freshness');
const EV = require('../lib/streets/evidence');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'transactions');
const UA = 'PROPX-tx-freshness/1.0 (+https://github.com/kobi6061-hub/vizora; read-only)';
const OVER = process.env.GOV_OVER_BASE || 'https://www.over.org.il';
const args = process.argv.slice(2);
const has = (k) => args.includes('--' + k);
const argVal = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const LAG_ALERT_DAYS = 7;
const DROP_SHARE = 0.10;
let requests = 0;

async function get(url, accept = 'application/json') {
  requests++;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
const pause = () => new Promise((ok) => setTimeout(ok, 1000));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readRuns = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/* an official channel: reachable with data, refused, or behind an identification screen — a marker found ends the read */
const BOT = /recaptcha|grecaptcha|hcaptcha|captcha|Request blocked|The request could not be satisfied|incapsula|perimeterx|הזדהות|אני לא רובוט/i;
async function official(id, url) {
  try {
    const r = await get(url, 'text/html,*/*;q=0.8');
    const blocked = r.status === 401 || r.status === 403 || r.status === 429;
    const marker = (r.text.match(BOT) || [])[0] || null;
    return { id, url, status: r.status, answered: r.status === 200 && !marker, refused: blocked, antiBot: marker ? marker.toLowerCase() : null,
      note: blocked ? 'refused this runner — not worked around' : marker ? 'an identification / CAPTCHA screen — not bypassed' : r.status === 200 ? 'reachable' : `HTTP ${r.status}` };
  } catch (e) { return { id, url, status: null, answered: false, refused: false, antiBot: null, note: `unreachable from the runner (${String(e.message).slice(0, 80)})` }; }
}

/* PROPX's stored universe: every swept locality's deals (dwellings and all natures) by transaction date */
function propxProfile(today) {
  const S = EV.store();
  if (!S.available) return { available: false };
  const src = S.meta.source || {};
  const all = [], dw = [];
  const files = fs.readdirSync(path.join(ROOT, 'data', 'streets', 'evidence')).filter((f) => /^\d+\.json$/.test(f));
  let shards = 0, fetchedMin = null, fetchedMax = null;
  for (const f of files) {
    const sh = EV.shardOf(Number(f.replace('.json', '')));
    if (!sh) continue;
    shards++;
    if (sh.fetchedAt) { if (!fetchedMin || sh.fetchedAt < fetchedMin) fetchedMin = sh.fetchedAt; if (!fetchedMax || sh.fetchedAt > fetchedMax) fetchedMax = sh.fetchedAt; }
    for (const x of EV.dealsOf(sh)) { if (!x.deal.date) continue; all.push(x.deal.date); if (x.deal.dwelling) dw.push(x.deal.date); }
  }
  const latest = (xs) => xs.reduce((m, d) => (d > m ? d : m), '') || null;
  const monthly = {}; for (const d of dw) { const m = d.slice(0, 7); monthly[m] = (monthly[m] || 0) + 1; }
  const lastSix = Object.keys(monthly).sort().slice(-6).map((m) => ({ month: m, dwellings: monthly[m] }));
  const per = (xs, ref) => Object.fromEntries(F.PERIODS.map((k) => [k, xs.filter((d) => d > F.isoDay(Date.parse(ref + 'T00:00:00Z') - k * 864e5) && d <= ref).length]));
  return {
    available: true, sweep: S.meta.sweep ? S.meta.sweep.status : null, shards,
    snapshotAt: src.scrapedAt || null, copyLatestDeal: src.lastDeal || null, window: S.meta.window,
    ingestedFrom: fetchedMin, ingestedTo: fetchedMax,
    latestTransaction: latest(all), latestDwellingTransaction: latest(dw), deals: all.length, dwellings: dw.length,
    periodsToToday: F.periods(dw, { today, lastDeal: src.lastDeal }),
    countsToCopyEnd: src.lastDeal ? per(dw, src.lastDeal) : null,
    lastSixMonths: lastSix,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const today = argVal('today') || startedAt.slice(0, 10);
  const run = { id: 'tx-freshness-' + startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'), source: 'propx:tx-freshness', startedAt, status: 'failed' };
  const prev = readJson(path.join(OUT_DIR, 'freshness.json'));
  try {
    /* 1 · the register copy PROPX reads */
    let register = { answered: false };
    try {
      const r = await get(OVER + '/api/deals/stats'); await pause();
      const j = r.json || {};
      register = r.status === 200 && j.scraped_at ? { answered: true, status: r.status, snapshotAt: String(j.scraped_at), latestTransactionDate: j.last_deal ? String(j.last_deal).slice(0, 10) : null,
        deals: Number(j.deals) || null, datasetId: j.dataset_id || null, upstream: j.source_url || null }
        : { answered: false, status: r.status, error: `HTTP ${r.status}` };
    } catch (e) { register = { answered: false, error: String(e.message).slice(0, 160) }; }
    /* 2 · the GovMap-layer copy (read by PROPX only as its separate recent layer, lib/recent) */
    let govmapLayer = { answered: false };
    try {
      const r = await get(OVER + '/api/deals/govmap/stats'); await pause();
      const j = r.json || {};
      govmapLayer = r.status === 200 && j.loaded_at ? { answered: true, status: r.status, snapshotAt: String(j.loaded_at), latestTransactionDate: j.last_deal ? String(j.last_deal).slice(0, 10) : null,
        deals: Number(j.deals) || null, datasetId: j.dataset_id || null, version: j.version ?? null, upstream: j.source_url || null, readByPropx: require('../lib/recent/read').readsCopy(String(j.loaded_at)) }
        : { answered: false, status: r.status, error: `HTTP ${r.status}`, readByPropx: false };
    } catch (e) { govmapLayer = { answered: false, error: String(e.message).slice(0, 160), readByPropx: false }; }
    /* 3 · the official channels */
    const officialChannels = [];
    for (const [id, url] of [['taxes:nadlan-register', 'https://nadlan.taxes.gov.il/svinfonadlan2010/startpage.aspx'], ['nadlan.gov.il', 'https://www.nadlan.gov.il/'], ['govmap.gov.il', 'https://www.govmap.gov.il/']]) {
      officialChannels.push(await official(id, url)); await pause();
    }
    /* 4 · PROPX */
    const propx = propxProfile(today);
    const checkedAt = new Date().toISOString();
    const st = F.stateOf({ snapshotAt: propx.snapshotAt, checkedAt: register.answered ? checkedAt : (prev && prev.register && prev.register.answered ? prev.checkedAt : null), today });
    const newerCopies = [];
    if (govmapLayer.answered && govmapLayer.latestTransactionDate && propx.copyLatestDeal) {
      const d = F.daysBetween(propx.copyLatestDeal, govmapLayer.latestTransactionDate);
      const s = F.daysBetween(propx.snapshotAt, govmapLayer.snapshotAt);
      /* PROPX reads this copy as its separate RECENT layer (lib/recent) when the stored layer is the same copy, reconciled against
         the register copy PROPX holds — then its newer deals are listed apart and the newer copy is no lag alert */
      const read = require('../lib/recent/read').readsCopy(govmapLayer.snapshotAt);
      if (d > 0 || s > 0) newerCopies.push({ id: 'over:govmap-layer', name: 'GovMap deals layer (lay=16) — republished copy (over.org.il)', snapshotAt: govmapLayer.snapshotAt,
        latestTransactionDate: govmapLayer.latestTransactionDate, daysNewerLatestDeal: d, daysNewerSnapshot: s, readByPropx: read, ...(read ? { readAs: 'recent-layer' } : {}),
        why: read ? 'read as a separate recent layer: its deals the register copy does not hold yet are listed apart (lib/recent)'
          : 'not read yet: the recent layer (lib/recent) holds an older copy of this layer or was reconciled against another register copy — the daily recent sync reads it' });
    }
    const alerts = [];
    if (F.isStale(st.state)) alerts.push({ kind: 'MATERIAL_LAG', reason: 'copy-age', message: `the transaction copy PROPX reads is ${st.state} (${st.ageDays} days old)`, values: { state: st.state, ageDays: st.ageDays } });
    for (const n of newerCopies) if (!n.readByPropx && n.daysNewerLatestDeal >= LAG_ALERT_DAYS) alerts.push({ kind: 'MATERIAL_LAG', reason: 'newer-copy', message: `${n.name}: latest deal ${n.latestTransactionDate}, ${n.daysNewerLatestDeal} days after PROPX's (${propx.copyLatestDeal})`, values: n });
    if (register.answered && propx.snapshotAt && register.snapshotAt !== propx.snapshotAt) {
      const newer = (F.ts(register.snapshotAt) || 0) > (F.ts(propx.snapshotAt) || 0);
      alerts.push({ kind: newer ? 'NEW_COPY_NOT_SWEPT' : 'OLDER_COPY_SERVED', message: newer ? `the register copy changed (${register.snapshotAt}) — PROPX holds ${propx.snapshotAt} until the sweep reads it` : `the publisher serves an OLDER copy (${register.snapshotAt}) than PROPX holds (${propx.snapshotAt}) — PROPX keeps its newer copy` });
    }
    if (prev && prev.register && prev.register.deals && register.deals && register.deals < prev.register.deals) alerts.push({ kind: 'VOLUME_DROP', message: `the register copy's rows fell from ${prev.register.deals} to ${register.deals}` });
    if (prev && prev.propx && prev.propx.countsToCopyEnd && propx.countsToCopyEnd && prev.propx.snapshotAt !== propx.snapshotAt) {
      const a = prev.propx.countsToCopyEnd[365], b = propx.countsToCopyEnd[365];
      if (a && b < a * (1 - DROP_SHARE)) alerts.push({ kind: 'VOLUME_DROP', message: `PROPX's dwelling deals in the copy's last 365 days fell from ${a} to ${b} with the new copy` });
    }
    for (const o of officialChannels) if (!o.answered) alerts.push({ kind: 'OFFICIAL_UNREACHABLE', informational: true, message: `${o.id}: ${o.note}` });
    const out = {
      schema: 1, checkedAt, today,
      contract: ['transaction_date', 'source_snapshot_date', 'source_publication_date', 'propx_ingested_at', 'propx_checked_at', 'source_id', 'source_class', 'match_state'],
      register, govmapLayer, officialChannels, propx,
      freshness: { state: st.state, ageDays: st.ageDays, stateReason: st.reason, thresholds: F.THRESHOLDS, basis: F.BASIS },
      lagDays: { snapshotAge: F.daysBetween(propx.snapshotAt, today), latestTransaction: F.daysBetween(propx.copyLatestDeal, today) },
      newerCopies, alerts,
    };
    Object.assign(run, { status: register.answered ? 'ok' : 'failed', error: register.answered ? null : (register.error || 'the register copy did not answer'), finishedAt: new Date().toISOString(), requests,
      state: st.state, registerSnapshotAt: register.snapshotAt || null, govmapLayerSnapshotAt: govmapLayer.snapshotAt || null, propxLatest: propx.copyLatestDeal || null, alerts: alerts.map((a) => a.kind) });
    if (has('dry-run')) { console.log(JSON.stringify(out, null, 1)); return 0; }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'freshness.json'), JSON.stringify(out, null, 1) + '\n');
    fs.appendFileSync(path.join(OUT_DIR, 'freshness-runs.jsonl'), JSON.stringify(run) + '\n');
    console.log(`transaction freshness: ${st.state} · copy ${propx.snapshotAt} · latest ${propx.copyLatestDeal} · ${alerts.length} alert(s): ${alerts.map((a) => a.kind).join(', ') || 'none'}`);
    return register.answered ? 0 : 1;
  } catch (e) {
    Object.assign(run, { status: 'failed', error: String(e.message).slice(0, 240), finishedAt: new Date().toISOString(), requests });
    if (!has('dry-run')) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.appendFileSync(path.join(OUT_DIR, 'freshness-runs.jsonl'), JSON.stringify(run) + '\n'); }
    console.error('tx-freshness failed:', e.message);
    return 1;
  }
}

if (require.main === module) main().then((c) => process.exit(c));
module.exports = { propxProfile, official };
