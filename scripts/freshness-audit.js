#!/usr/bin/env node
// PROPX · FRESHNESS AUDIT → lib/trust/discovery/<Israel date>-freshness-audit.json
//
//   node scripts/freshness-audit.js [--now <ISO>] [--out <file>]
//          [--fetch-github]         read the workflows' runs through `gh api` (GET only: status · dates · run ids — no log text)
//          [--github <file>]        reuse run evidence saved before (a raw evidence file, or an earlier audit output's `github`)
//          [--integrity]            the deep integrity pass over the stored transaction universe (≈ 1 minute, offline)
//
// The audit itself is lib/trust/freshness-audit.js (pure, over the committed data). This script adds what the repository cannot hold by
// itself: the GitHub Actions evidence of when each workflow last ran on the production branch, the root causes found in the failed
// runs' logs (the INVESTIGATION table below — read by hand from the job logs, 21–22.10.2026), and optionally the deep integrity pass.
// It never triggers, re-runs or cancels a workflow, and never prints a secret.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const FA = require('../lib/trust/freshness-audit');

const ROOT = path.join(__dirname, '..');
const REPO = 'kobi6061-hub/vizora';
const PROD = 'claude/vizora-project-isolation-6lbq3g';
const PREVIEW = 'claude/street-report-preview';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const now = opt('--now') ? Date.parse(opt('--now')) : Date.now();
if (!Number.isFinite(now)) { console.error('--now: not a date'); process.exit(2); }
const israelDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const OUT = opt('--out') || path.join(ROOT, 'lib', 'trust', 'discovery', `${israelDate}-freshness-audit.json`);

/* ── the failed / stale runs read by hand from their job logs (21–22.10.2026): run ids, dates and the cause in our words — no log text ── */
const INVESTIGATION = [
  { workflow: 'txevents-national.yml', runs: [39596014029, 39642748425, 39681669082], at: '2026-10-21', conclusion: 'success (silent gap)', class: 'IN_REPO_FIXED',
    cause: 'unchanged checks never recorded: the commit step measured the last record with `git log -1 -- data/txevents/national/runs.jsonl` in a depth-1 checkout, which answers with the branch head (any sync\'s commit) — the last record stayed 20.10.2026 18:55 UTC and the Trust Center read the detector as STALE',
    fix: 'lib/txevents/runlog.js + `scripts/txevents-national.js --record-decision` read the last record from runs.jsonl itself; the Trust catalogue allows 24 h (12 h recording gap + the observed 4.5–7 h schedule interval)', test: 'test/freshness-audit.test.js' },
  { workflow: 'street-evidence-sync.yml', runs: [39572546743], at: '2026-10-21', conclusion: 'success (false alarm in its output)', class: 'IN_REPO_FIXED',
    cause: 'data/txevents/coverage-audit.json reported missed 304 since 20.10.2026 17:56: every one is a GovMap row FOLDED into a register deal filed under an unmapped settlement name (304 register events, all in the read) — the audit counted folded rows as missed',
    fix: 'scripts/txevents-audit.js counts FOLDED apart (lib/txevents/kit.js surfaceAccount): missed 0 · folded 304 on the stored data', test: 'test/freshness-audit.test.js' },
  { workflow: 'street-geo-build.yml', runs: [39560045045], at: '2026-10-21T07:09Z', conclusion: 'failure', class: 'IN_REPO_FIXED',
    cause: 'two push-triggered builds in a row: the second (script 4d7adb2) rebased its commit of the binary data/geo/street-geo files onto the first one\'s and conflicted (CONFLICT in loc/*.json.gz, meta.json) — the stored build is the previous script\'s (c41968b): 22,571 source-neighbourhood street keys stay in the layer\'s raw form; no reader uses that field today',
    fix: 'the commit step re-places the run\'s whole build on the newest branch head instead of rebasing binaries; dispatch street-geo-build.yml once to align the data', test: 'test/freshness-audit.test.js' },
  { workflow: 'street-recent-sync.yml', runs: [39395354370], at: '2026-10-20T08:42Z', conclusion: 'failure', class: 'IN_REPO_FIXED_EARLIER',
    cause: 'the gate "the Street Value Model is untouched" failed: the model input check reported stale after a land sync changed tenders.json — fixed the same day by lib/streets/model-deps.js (only what the model reads); every later run passed' },
  { workflow: 'txevents-national.yml', runs: [39437351911, 39439075385], at: '2026-10-20T14:14Z', conclusion: 'failure', class: 'IN_REPO_FIXED_EARLIER',
    cause: 'the published file named its columns in camelCase, so the file did not reproduce the API window (same 0 · differs 11,900) — the build refused to write; the column map was added and the next build validated 11,900 / 11,900' },
  { workflow: 'cbs-sales-sync.yml', runs: [39143071361], at: '2026-10-18T16:00Z', conclusion: 'failure', class: 'EXTERNAL',
    cause: 'CBS series API answered HTTP 500 to 12 of 22 requests (district 5074 and others); the run recorded PARTIAL, kept the last data and exited 2; the next run (19.10) answered 22/22' },
  { workflow: 'dd-sync.yml', runs: [39401290154], at: '2026-10-20T09:31Z', conclusion: 'failure', class: 'EXTERNAL',
    cause: 'data.gov.il datastore_search answered HTTP 404 (HTML) for five Registrar of Companies / Official Receiver resources mid-paging; lanes FAILED, last data kept; the next run (21.10) read every lane' },
  { workflow: 'construction-sync.yml', runs: [39080649194], at: '2026-10-17T23:52Z', conclusion: 'failure', class: 'IN_REPO_FIXED_EARLIER',
    cause: 'the first run of the lane (manual) — the geography resolution was corrected before the first successful run 39082195857 (18.10.2026)' },
  { workflow: 'identity-verify.yml · identity-activate.yml', runs: [39676022156, 39676017719], at: '2026-10-21T21:06Z', conclusion: 'failure', class: 'CONFIG',
    cause: 'the private identity project is not configured: SUPABASE_ACCESS_TOKEN · SUPABASE_URL · PROPX_WS_URL · PROPX_WS_APIKEY · PROPX_WS_JWT_SECRET are not set as repository secrets (by design until the founder activates STEP 2A) — not a data lane' },
  { workflow: 'tx-refresh.yml · data-sync.yml (transactions part)', runs: [39569876493, 39565825297], at: '2026-10-21', conclusion: 'success (source REFUSED)', class: 'EXTERNAL',
    cause: 'GovMap (the official deals channel) answers HTTP 403 to every runner request; nadlan.gov.il shows a reCAPTCHA screen; nadlan.taxes.gov.il is unreachable from the runner — recorded, never worked around (data/transactions/freshness.json officialChannels)' },
];

/* ── GitHub run evidence through `gh api` (status · dates · run ids) ── */
function gh(endpoint) { return JSON.parse(execFileSync('gh', ['api', endpoint], { maxBuffer: 1 << 28, encoding: 'utf8' })); }
function fetchGithub() {
  const wfs = gh(`repos/${REPO}/actions/workflows?per_page=100`).workflows || [];
  const out = { readAt: new Date().toISOString(), repo: REPO, productionBranch: PROD, previewBranch: PREVIEW, workflows: {} };
  for (const w of wfs) {
    const file = path.basename(w.path);
    const runs = (gh(`repos/${REPO}/actions/workflows/${w.id}/runs?per_page=100`).workflow_runs || [])
      .map((r) => ({ id: r.id, branch: r.head_branch, event: r.event, status: r.status, conclusion: r.conclusion, at: r.run_started_at || r.created_at }));
    out.workflows[file] = summarizeRuns(file, w.name, w.state, runs);
  }
  return out;
}
const slim = (r) => (r ? { id: r.id, at: r.at, event: r.event, conclusion: r.conclusion } : null);
function summarizeRuns(file, name, state, runs) {
  const sorted = [...runs].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const on = (b) => sorted.filter((r) => r.branch === b);
  const prod = on(PROD), prev = on(PREVIEW);
  const done = (xs) => xs.filter((r) => r.status === 'completed');
  const weekAgo = now - 7 * 864e5;
  return { name, state,
    production: prod.length ? { latest: slim(prod[0]), lastSuccess: slim(done(prod).find((r) => r.conclusion === 'success')), lastFailure: slim(done(prod).find((r) => r.conclusion && !['success', 'skipped'].includes(r.conclusion))),
      scheduledLast7d: prod.filter((r) => r.event === 'schedule' && Date.parse(r.at) >= weekAgo).length, runsListed: prod.length } : null,
    preview: prev.length ? { latest: slim(prev[0]), lastSuccess: slim(done(prev).find((r) => r.conclusion === 'success')) } : null };
}
function loadGithub(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return j && j.github && j.github.workflows ? j.github : j;
}

/* ── the deep integrity pass (offline, ≈ 1 minute): pricing, ownership share, duplicates, future dates over every locality ── */
function deepIntegrity(today) {
  const TX = require('../lib/txevents'), EV = require('../lib/streets/evidence'), RECENT = require('../lib/recent/read');
  const S = TX.stores(), L = RECENT.load(), nat = S.national;
  const reg = { deals: 0, priced: 0, pricedPartial: 0, pricedUnder100k: 0, pricedMultiUnit: 0, pricedPortionMissing: 0, partialSales: 0, afterCopyLatest: 0 };
  const regLast = EV.store().meta.source.lastDeal;
  for (const f of fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x)).sort()) {
    const sh = EV.shardOf(Number(f.replace('.json', ''))); if (!sh) continue;
    for (const { deal: d } of EV.dealsOf(sh)) {
      reg.deals++; if (d.partialSale) reg.partialSales++; if (d.date > regLast) reg.afterCopyLatest++;
      if (!d.priced) continue;
      reg.priced++;
      if (d.partialSale || d.portionFraction !== 1) reg.pricedPartial++;
      if (d.portionMissing) reg.pricedPortionMissing++;
      if (!(d.amount >= 100000)) reg.pricedUnder100k++;
      if (d.sameConsideration > 1) reg.pricedMultiUnit++;
    }
  }
  const codes = new Set(fs.readdirSync(EV.DIR).filter((x) => /^\d+\.json$/.test(x)).map((x) => Number(x.replace('.json', ''))).filter((c) => EV.shardOf(c)));
  for (const byCode of [L.layer && L.layer.byCode, nat && nat.byCode]) for (const k of Object.keys(byCode || {})) codes.add(Number(k));
  const loadDay = L.meta && L.meta.source ? String(L.meta.source.loadedAt).slice(0, 10) : null;
  const u = { localities: 0, events: 0, byState: {}, bySource: {}, govmapPriced: 0, govmapVerified: 0, pricedNotRegister: 0, pricedBreakingRule: 0, futureDated: 0, afterCopyLoad: 0, duplicateIds: 0, possibleDuplicateInStatistics: 0, latestCounted: null };
  for (const code of [...codes].filter((c) => Number.isFinite(c) && c > 0).sort((a, b) => a - b)) {
    const q = TX.query({ code, all: true, unlimited: true, today });
    u.localities++;
    const seen = new Set();
    for (const e of q.events) {
      u.events++; u.byState[e.state] = (u.byState[e.state] || 0) + 1; const s = e.sourceId || e.source; u.bySource[s] = (u.bySource[s] || 0) + 1;
      if (seen.has(e.id)) u.duplicateIds++; seen.add(e.id);
      if (e.date > today) u.futureDated++; if (loadDay && e.date > loadDay) u.afterCopyLoad++;
      if (e.state !== 'POSSIBLE_DUPLICATE' && (!u.latestCounted || e.date > u.latestCounted)) u.latestCounted = e.date;
      if (e.source === 'govmap' && e.state === 'PRICED_IN_STATISTICS') u.govmapPriced++;
      if (e.source === 'govmap' && e.state === 'VERIFIED_DWELLING') u.govmapVerified++;
      if (e.state === 'PRICED_IN_STATISTICS') { if (e.source !== 'register') u.pricedNotRegister++; if (e.partialSale || !(e.price >= 100000) || e.priced === false) u.pricedBreakingRule++; }
      if (e.state === 'POSSIBLE_DUPLICATE' && e.inStatistics) u.possibleDuplicateInStatistics++;
    }
  }
  return { ranAt: new Date().toISOString(), rules: ['priced = whole property (portion 1), ≥ ₪100,000, one consideration for one unit, register only', 'no GovMap-layer row priced or VERIFIED', 'no event after the copy\'s load day or today', 'no event id twice in a locality', 'a possible duplicate never in a statistic'],
    register: reg, union: u,
    violations: reg.pricedPartial + reg.pricedUnder100k + reg.pricedMultiUnit + reg.pricedPortionMissing + reg.afterCopyLatest + u.govmapPriced + u.govmapVerified + u.pricedNotRegister + u.pricedBreakingRule + u.futureDated + u.afterCopyLoad + u.duplicateIds + u.possibleDuplicateInStatistics };
}

/* ── main ── */
let github = null;
if (args.includes('--fetch-github')) github = fetchGithub();
else if (opt('--github')) github = loadGithub(opt('--github'));
const audit = FA.audit({ now, github });
const integrity = args.includes('--integrity') ? deepIntegrity(audit.today) : null;
const doc = { schema: 1, kind: 'freshness-audit', producedBy: 'scripts/freshness-audit.js', engine: FA.ENGINE, asOf: audit.asOf, israelDate,
  note: 'per-source freshness from the committed data and run logs (lib/trust/freshness-audit.js) + GitHub Actions run evidence (status · dates · run ids only) + root causes read from the failed runs\' job logs — not a list of discovery candidates',
  github, investigation: INVESTIGATION, integrity, audit };
const text = JSON.stringify(doc, null, 1) + '\n';
if (/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|Bearer\s+[A-Za-z0-9._-]{20,}|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*\S{10,}/.test(text)) { console.error('refused: the output looks like it carries a credential'); process.exit(1); }
fs.writeFileSync(OUT, text);
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), counts: audit.counts, actions: audit.transactions.actions.map((a) => `${a.kind} → ${a.workflow}`), integrity: integrity ? { violations: integrity.violations } : null }));
