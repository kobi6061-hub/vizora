#!/usr/bin/env node
// PROPX · due-diligence sync — the Registrar of Companies (companies, partnerships, filings), the Official Receiver
// (liquidation cases), fast-track voluntary liquidations, the contractors register, the Ministry of Labour's active /
// closed construction sites and Tel Aviv-Yafo's IView2 permits + sites → data/dd/ (lib/dd/sync.js). Runs on a GitHub
// runner (.github/workflows/dd-sync.yml): the Claude sandbox cannot reach gov.il or the municipal GIS.
//
//   node scripts/dd-sync.js                      read every lane → write data/dd/
//   node scripts/dd-sync.js --lanes sites,tlv    some lanes only (contractors, companies, partnerships, filings, insolvency, sites, tlv)
//   node scripts/dd-sync.js --dry-run            read and report, write nothing
//   --out <dir>   --summary-file <path>   --verbose
//
// Read-only against the sources; honest User-Agent; a non-JSON refusal (the data.gov.il WAF answers HTML 403 to bursts)
// is retried with a backoff three times, then the lane is REFUSED and its last data kept. Exit 0 SUCCESS / UNCHANGED ·
// 2 PARTIAL · 1 FAILED / REFUSED / SCHEMA_CHANGED.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runSync, exitCodeOf, UA, SOURCES } = require('../lib/dd/sync');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const DIR = path.resolve(argVal('out') || path.join(__dirname, '..', 'data', 'dd'));
const LANES = argVal('lanes') ? argVal('lanes').split(',').map((x) => x.trim()).filter(Boolean) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      const text = (await r.text()).replace(/^﻿/, '');
      let json = null; try { json = JSON.parse(text); } catch { json = null; }
      if (json && (r.ok || json.result || json.features)) return json;
      if (json && json.error) { const e = new Error(`HTTP ${r.status} ${JSON.stringify(json.error).slice(0, 200)} from ${url}`); e.status = r.status; if (r.status === 404 || r.status === 409 || r.status === 400) throw e; last = e; }
      else { last = new Error(`HTTP ${r.status} (${r.headers.get('content-type') || '?'}; ${json ? 'json' : 'non-JSON'}) from ${url}`); last.status = r.status; }
    } catch (e) { if (e.status === 404 || e.status === 409 || e.status === 400) throw e; last = e; }
    await sleep([4000, 10000, 25000, 40000][i]);
  }
  throw last;
}
/** the catalogue's last-modified stamps (resource_show) — recorded beside every lane as the source's own date */
async function modifiedStamps() {
  const out = {};
  for (const src of Object.values(SOURCES)) {
    if (!src.resource) continue;
    try { const r = await fetchJson(`https://data.gov.il/api/3/action/resource_show?id=${src.resource}`); out[src.id] = (r.result && (r.result.last_modified || r.result.metadata_modified)) || null; } catch { out[src.id] = null; }
    await sleep(400);
  }
  return out;
}

(async () => {
  const Q = require('../lib/entities/query');
  const L = Q.load(); const devs = [...L.devById.values()].map((d) => ({ id: d.id, canonical: d.canonical, kind: d.kind }));
  const now = new Date().toISOString();
  const modified = await modifiedStamps();
  const log = has('verbose') ? (o) => console.log(JSON.stringify(o)) : (o) => { if (o.error || o.page === 1 || (o.page && o.page % 10 === 0)) console.log(JSON.stringify(o)); };
  const run = await runSync({ fetchJson, devs, dir: DIR, now, lanes: LANES, modified, log, dryRun: has('dry-run') });
  const lines = [`Due diligence sync ${now.slice(0, 10)}: ${run.status}`, ...Object.entries(run.lanes).map(([k, v]) => `  ${k}: ${v}${run.errors && run.errors[k] ? ' — ' + run.errors[k] : ''}`), `  events: ${run.events}`];
  const latest = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'latest.json'), 'utf8')); } catch { return null; } })();
  if (latest) lines.push(`  companies kept ${latest.companies ? latest.companies.kept : '—'} · partnerships ${latest.partnerships ? latest.partnerships.kept : '—'} · filings ${latest.filings ? latest.filings.kept : '—'} · liquidation ${latest.insolvency ? latest.insolvency.liquidation.kept : '—'} · contractors ${latest.contractors ? latest.contractors.counts.contractors : '—'} · sites ${latest.sites ? latest.sites.counts.active : '—'} · TLV permits ${latest.tlv ? latest.tlv.permits.counts.rows : '—'} / sites ${latest.tlv ? latest.tlv.sites.counts.rows : '—'}`);
  console.log(lines.join('\n'));
  const sf = argVal('summary-file'); if (sf) fs.writeFileSync(sf, `Due diligence sync ${now.slice(0, 10)}: ${run.status}\n\n${lines.slice(1).join('\n')}\n`);
  process.exit(exitCodeOf(run.status));
})().catch((e) => { console.error('dd-sync fatal:', e && e.stack || e); process.exit(1); });
