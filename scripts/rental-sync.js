#!/usr/bin/env node
// PROPX · long-term rental — sync of the Dira Lehaskir public CMS data (lib/rental/dira.js).
//
// Reads the government rental company's developer tenders and planning sites (WordPress REST API), its status
// taxonomies and its public project pages (sitemap), and writes data/rental/:
//   dira-tenders.json    one record per notice (wpId), upserted — never deleted (a notice gone from the source stays,
//                        marked inLatestSource:false); firstSeenAt / lastSeenAt; the explicit rental terms + evidence
//   dira-planning.json   one record per planning site, the same rules
//   dira-projects.json   the public project pages (URL + lastmod only — OFFICIAL_PAGE_ONLY)
//   dira-terms.json      the status taxonomies with their published counts
//   history.jsonl        every changed field (status, title, terms) with from → to
//   raw/                 the exact response bodies, once per content hash (gzip)
//   runs.jsonl           one line per run: SUCCESS · UNCHANGED · PARTIAL · FAILED
// Runs on a GitHub runner (.github/workflows/rental-sync.yml) — the Claude sandbox cannot reach the site.
//
//   node scripts/rental-sync.js [--dry-run] [--out <dir>] [--summary-file <path>]
// Exit: 0 SUCCESS / UNCHANGED · 2 PARTIAL · 1 FAILED.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const D = require('../lib/rental/dira');

const has = (f) => process.argv.includes('--' + f);
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const DIR = path.resolve(argVal('out') || path.join(__dirname, '..', 'data', 'rental'));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const TRACKED = ['kind', 'title', 'status', 'tender', 'terms', 'placeText', 'modified'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** upsert one list: new records added, changed fields recorded, missing ones kept and marked */
function merge(prev, incoming, at, history) {
  const by = new Map((prev || []).map((r) => [r.id, r]));
  let added = 0, changed = 0;
  const seen = new Set();
  for (const r of incoming) {
    seen.add(r.id);
    const old = by.get(r.id);
    if (!old) { by.set(r.id, { ...r, firstSeenAt: at, lastSeenAt: at, inLatestSource: true }); added++; continue; }
    const diffs = TRACKED.filter((k) => k in r && !same(old[k], r[k]));
    for (const k of diffs) history.push({ id: r.id, field: k, from: old[k] ?? null, to: r[k] ?? null, observedAt: at });
    if (diffs.length) changed++;
    by.set(r.id, { ...old, ...r, firstSeenAt: old.firstSeenAt, lastSeenAt: at, inLatestSource: true });
  }
  let gone = 0;
  for (const [id, r] of by) if (!seen.has(id) && r.inLatestSource !== false) { by.set(id, { ...r, inLatestSource: false }); history.push({ id, field: 'inLatestSource', from: true, to: false, observedAt: at }); gone++; }
  return { list: [...by.values()].sort((a, b) => b.wpId - a.wpId), added, changed, gone };
}

(async () => {
  const at = new Date().toISOString();
  const R = await D.fetchAll();
  const termIndex = (tax) => Object.fromEntries(((R.terms[tax] && R.terms[tax].terms) || []).map((x) => [x.id, x]));
  const parts = R.parts;
  const okParts = Object.entries(parts).filter(([, v]) => v.ok).map(([k]) => k);
  const badParts = Object.entries(parts).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error}`)
    .concat(Object.entries(R.terms).filter(([, v]) => !v.ok).map(([k, v]) => `terms ${k}: ${v.error}`));
  const tenders = parts.michraz.ok ? parts.michraz.items.map((x) => D.normalizeMichraz(x, termIndex('tax_status_et'))) : null;
  const planning = parts.planning.ok ? parts.planning.items.map((x) => D.normalizePlanning(x, termIndex('statuss'))) : null;
  const dev = tenders ? tenders.filter((x) => x.kind === 'developer-tender') : [];
  const summary = `Dira Lehaskir: ${badParts.length ? (okParts.length ? 'PARTIAL' : 'FAILED') : 'read'} — notices ${tenders ? tenders.length : '—'} (developer tenders ${dev.length}, with a tender number ${dev.filter((x) => x.tender).length}, rental units stated ${dev.filter((x) => x.terms && x.terms.rentalUnits != null).length}) · planning ${planning ? planning.length : '—'} · project pages ${parts.projects.ok ? parts.projects.pages.length : '—'}`;
  console.log(summary);
  for (const b of badParts) console.log('  FAILED', b);
  if (has('dry-run')) {
    for (const x of dev.slice(0, 40)) console.log(`  ${x.tender ? x.tender.raw : '—'} · ${x.status ? x.status.name : '—'} · total ${x.terms.totalUnits ?? '—'} · rental ${x.terms.rentalUnits ?? '—'} (${x.terms.rentalBasis || '—'}) · sale ${x.terms.saleUnits ?? '—'} · years ${x.terms.rentalYears ?? '—'}${x.terms.discountedText ? ' · discounted: ' + x.terms.discountedText.slice(0, 120) : ''} · ${x.title.slice(0, 80)}`);
    /* the notices whose rental share is not in a recognised pattern: the words around "השכרה", to review the patterns */
    const raw = new Map((parts.michraz.ok ? parts.michraz.items : []).map((x) => [x.id, D.plain(x.content && x.content.rendered).replace(/\s+/g, ' ')]));
    for (const x of dev.filter((y) => y.terms.rentalUnits == null || y.terms.rentalYears == null).slice(0, 45)) {
      const tx = raw.get(x.wpId) || '', i = tx.search(/השכר|שכירות/);
      console.log(`  UNPARSED ${x.tender ? x.tender.raw : x.wpId}: ${i < 0 ? '(no rental words) ' + tx.slice(0, 160) : tx.slice(Math.max(0, i - 160), i + 200)}`);
    }
    for (const [tax, v] of Object.entries(R.terms)) console.log(`  terms ${tax}:`, v.ok ? v.terms.map((t) => `${t.name}(${t.slug})=${t.count}`).join(' · ') : v.error);
    for (const x of (planning || []).slice(0, 50)) console.log(`  planning ${x.title} · ${x.status ? x.status.name : '—'} · ${x.modified}`);
    if (parts.projects.ok) console.log('  project pages:', parts.projects.pages.slice(0, 60).map((x) => x.slug).join(' | '));
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const status = !okParts.length ? 'FAILED' : badParts.length ? 'PARTIAL' : null;
  if (status === 'FAILED') {
    fs.appendFileSync(path.join(DIR, 'runs.jsonl'), JSON.stringify({ id: 'rental:' + at, startedAt: at, finishedAt: new Date().toISOString(), state: 'FAILED', status: 'failed', error: badParts.join(' | ').slice(0, 500) }) + '\n');
    if (argVal('summary-file')) fs.writeFileSync(argVal('summary-file'), summary + '\n');
    process.exitCode = 1; return;
  }
  /* raw snapshot: the exact bodies, once per content hash */
  const bundle = [...Object.values(R.terms).filter((v) => v.ok).flatMap((v) => v.raw), ...Object.values(parts).filter((v) => v.ok).flatMap((v) => v.raw)];
  const sha = crypto.createHash('sha256').update(JSON.stringify(bundle.map((b) => [b.url, b.body]))).digest('hex');
  const rawDir = path.join(DIR, 'raw'); fs.mkdirSync(rawDir, { recursive: true });
  const fresh = !fs.readdirSync(rawDir).some((f) => f.includes(sha.slice(0, 16)));
  if (fresh) fs.writeFileSync(path.join(rawDir, `${at.slice(0, 10)}-${sha.slice(0, 16)}.json.gz`), zlib.gzipSync(JSON.stringify({ fetchedAt: at, sha256: sha, responses: bundle })));
  const history = [];
  const out = { tenders: null, planning: null };
  let added = 0, changed = 0, gone = 0;
  if (tenders) { const prev = readJson(path.join(DIR, 'dira-tenders.json'), { records: [] }).records; const m = merge(prev, tenders, at, history); out.tenders = m.list; added += m.added; changed += m.changed; gone += m.gone; }
  if (planning) { const prev = readJson(path.join(DIR, 'dira-planning.json'), { records: [] }).records; const m = merge(prev, planning, at, history); out.planning = m.list; added += m.added; changed += m.changed; gone += m.gone; }
  const meta = { source: D.SOURCE, fetchedAt: at, snapshot: sha.slice(0, 16) };
  if (out.tenders) fs.writeFileSync(path.join(DIR, 'dira-tenders.json'), JSON.stringify({ ...meta, records: out.tenders }, null, 1) + '\n');
  if (out.planning) fs.writeFileSync(path.join(DIR, 'dira-planning.json'), JSON.stringify({ ...meta, records: out.planning }, null, 1) + '\n');
  if (parts.projects.ok) fs.writeFileSync(path.join(DIR, 'dira-projects.json'), JSON.stringify({ ...meta, classification: 'OFFICIAL_PAGE_ONLY', pages: parts.projects.pages }, null, 1) + '\n');
  const termsOut = Object.fromEntries(Object.entries(R.terms).filter(([, v]) => v.ok).map(([k, v]) => [k, v.terms]));
  if (Object.keys(termsOut).length) fs.writeFileSync(path.join(DIR, 'dira-terms.json'), JSON.stringify({ ...meta, taxonomies: termsOut }, null, 1) + '\n');
  if (history.length) fs.appendFileSync(path.join(DIR, 'history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');
  const state = status || (added || changed || gone || fresh ? 'SUCCESS' : 'UNCHANGED');
  fs.appendFileSync(path.join(DIR, 'runs.jsonl'), JSON.stringify({ id: 'rental:' + at, startedAt: at, finishedAt: new Date().toISOString(), state, status: state.toLowerCase(),
    notices: tenders ? tenders.length : null, developerTenders: dev.length, planning: planning ? planning.length : null, projectPages: parts.projects.ok ? parts.projects.pages.length : null,
    added, changed, gone, snapshot: sha.slice(0, 16), ...(badParts.length ? { error: badParts.join(' | ').slice(0, 500) } : {}) }) + '\n');
  if (argVal('summary-file')) fs.writeFileSync(argVal('summary-file'), `${summary} · +${added} new · ${changed} changed · ${gone} gone\n`);
  if (status === 'PARTIAL') process.exitCode = 2;
})().catch((e) => { console.error(e); process.exitCode = 1; });
