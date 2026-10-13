#!/usr/bin/env node
// PROPX · CBS new-home sales — read-only source discovery.
//
// Verifies what the Central Bureau of Statistics actually publishes about new-dwelling sales by locality before
// anything is built on it. Runs on a GitHub runner (.github/workflows/cbs-sales-discover.yml): the CBS hosts answer
// there, not from the Claude sandbox. Read-only — GET requests to cbs.gov.il hosts only; nothing is written or committed.
//
//   node scripts/cbs-sales-discover.js --get <url> [<url> …]          status, type, size, shape and the first bytes
//   node scripts/cbs-sales-discover.js --walk <url> --match <regex>   walk the time-series catalog from <url>,
//                                                                      printing every node and the ones matching
//   node scripts/cbs-sales-discover.js --list path:44,10 level:4:44                 every catalog node (all pages)
//   node scripts/cbs-sales-discover.js --series <id,id,…> [--from MM-YYYY] [--to MM-YYYY]
//                                                                      the observations of time series, with metadata
//   node scripts/cbs-sales-discover.js --links <url…> [--match <regex>] every link on the pages (matching the regex)
//   node scripts/cbs-sales-discover.js --pdf <url> [--match <regex>]    the text of a PDF (pdftotext), matching lines
//   node scripts/cbs-sales-discover.js --probe 2026:78-300 [--dept 04]  which media-release numbers carry a PDF of a
//                                                                      department (static DocLib files; robots.txt
//                                                                      allows them) — HEAD only, one request at a time

'use strict';

const UA = 'PROPX-cbs-discover/1.0 (+https://propx.live)';
const TIMEOUT = 25000;
const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*cbs\.gov\.il\//i;
const SERIES = 'https://apis.cbs.gov.il/series';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const many = (k) => { const i = args.indexOf(k); if (i < 0) return []; const out = []; for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]); return out; };

function shapeOf(v, depth = 0) {
  if (depth > 7) return '…';
  if (Array.isArray(v)) return v.length ? `[${v.length}× ${shapeOf(v[0], depth + 1)}]` : '[]';
  if (v && typeof v === 'object') return '{' + Object.entries(v).slice(0, 16).map(([k, x]) => `${k}: ${shapeOf(x, depth + 1)}`).join(', ') + '}';
  return JSON.stringify(v === undefined ? null : v).slice(0, 60);
}

let requests = 0;
async function get(url) {
  if (!ALLOWED.test(url)) throw new Error('not a cbs.gov.il URL: ' + url);
  requests++;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.8, */*;q=0.5' }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    const text = /json|text|xml|html/.test(type) || !type ? buf.toString('utf8').replace(/^﻿/, '') : null;
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
    return { url, status: r.status, type, bytes: buf.length, ms: Date.now() - t0, text, json, finalUrl: r.url, lastModified: r.headers.get('last-modified') };
  } catch (e) {
    return { url, status: 0, error: e.message, ms: Date.now() - t0 };
  }
}

function report(res, n = 1500) {
  console.log(`\n=== ${res.url}`);
  if (res.error) { console.log('   ERROR', res.error); return; }
  console.log(`   HTTP ${res.status} · ${res.type} · ${res.bytes} bytes · ${res.ms} ms${res.lastModified ? ' · last-modified ' + res.lastModified : ''}${res.finalUrl !== res.url ? ' · → ' + res.finalUrl : ''}`);
  if (res.json) console.log('   shape', shapeOf(res.json));
  if (res.text) console.log('   ' + res.text.slice(0, n).replace(/\s+/g, ' '));
}

/* a catalog node, whatever the exact field names turn out to be */
function nodesOf(json) {
  if (!json) return [];
  const pools = [];
  const visit = (v, d) => {
    if (d > 4 || !v) return;
    if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object') pools.push(v); v.slice(0, 1).forEach((x) => visit(x, d + 1)); return; }
    if (typeof v === 'object') Object.values(v).forEach((x) => visit(x, d + 1));
  };
  visit(json, 0);
  pools.sort((a, b) => b.length - a.length);
  return pools[0] || [];
}
const nameOf = (o) => o.name || o.Name || o.title || o.path_name || o.pathDesc || o.desc || o.description || JSON.stringify(o).slice(0, 80);
const pathOf = (o) => o.path || o.Path || o.pathCode || o.id || o.code || o.Id;

async function walk(startUrl, re, maxReq) {
  const queue = [{ url: startUrl, depth: 0, trail: '' }];
  const seen = new Set();
  const hits = [];
  while (queue.length && requests < maxReq) {
    const { url, depth, trail } = queue.shift();
    if (seen.has(url)) continue; seen.add(url);
    const res = await get(url);
    if (res.status !== 200 || !res.json) { console.log(`   [${res.status}] ${url}${res.error ? ' ' + res.error : ''}`); continue; }
    const nodes = nodesOf(res.json);
    if (depth === 0) console.log('   root shape', shapeOf(res.json));
    for (const o of nodes) {
      const nm = String(nameOf(o)), p = pathOf(o);
      const line = `${'  '.repeat(depth)}· ${nm} [${Array.isArray(p) ? p.join(',') : p}]${o.level != null ? ' L' + o.level : ''}`;
      if (re.test(nm) || re.test(trail)) { hits.push(`${trail} › ${nm} [${p}]`); console.log('★ ' + line); } else if (depth < 2) console.log('  ' + line);
      /* descend: the series catalog nests by path (comma-joined) */
      if (depth < 6 && p != null && (re.test(nm) || re.test(trail) || depth < 1 || /בני|דיור|דירות|construct|housing|dwell/i.test(nm))) {
        const pid = Array.isArray(p) ? p.join(',') : p;
        queue.push({ url: `${SERIES}/catalog/path?id=${encodeURIComponent(pid)}&format=json&download=false&lang=he`, depth: depth + 1, trail: trail + ' › ' + nm });
      }
    }
  }
  console.log(`\n${hits.length} matching nodes (${requests} requests):`);
  hits.forEach((h) => console.log('  ' + h));
}

(async () => {
  if (args.includes('--get')) {
    for (const u of many('--get')) report(await get(u), Number(opt('--chars', 2500)));
  } else if (args.includes('--walk')) {
    await walk(opt('--walk'), new RegExp(opt('--match', 'נמכר|מכיר|sold|sales'), 'i'), Number(opt('--max', 400)));
  } else if (args.includes('--list')) {
    /* every catalog node under a path (all pages), or every node of a level of a subject */
    for (const a of many('--list')) {
      const [kind, id, subject] = a.split(':');   // path:44,10  |  level:4:44
      for (let page = 1; page <= 40; page++) {
        const url = kind === 'level'
          ? `${SERIES}/catalog/level?id=${id}&subject=${subject}&format=json&download=false&lang=he&Page=${page}&PageSize=100`
          : `${SERIES}/catalog/path?id=${encodeURIComponent(id)}&format=json&download=false&lang=he&Page=${page}&PageSize=100`;
        const res = await get(url);
        if (res.status !== 200 || !res.json) { report(res, 300); break; }
        const c = res.json.catalogs || {}, list = c.catalog || [];
        if (page === 1) console.log(`\n=== ${a} · level ${c.level} · ${c.paging && c.paging.total_items} nodes`);
        for (const o of list) console.log(`  ${(o.path || []).join(',')}  ${o.name}${o.pathDesc ? '  ⟨' + o.pathDesc + '⟩' : ''}`);
        if (!c.paging || !c.paging.next_url) break;
      }
    }
  } else if (args.includes('--links')) {
    const re = new RegExp(opt('--match', '.'), 'i');
    for (const u of many('--links')) {
      const res = await get(u);
      report(res, 120);
      const seen = new Set();
      for (const m of String(res.text || '').matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        const h = m[1].replace(/&amp;/g, '&');
        if (re.test(h) && !seen.has(h)) { seen.add(h); console.log('  ' + h); }
      }
      console.log(`${seen.size} links`);
      /* links a page builds in script or JSON rather than in href: show where the pattern occurs in the raw page */
      const raw = String(res.text || '');
      let n = 0;
      for (const m of raw.matchAll(new RegExp(re.source, 'gi'))) {
        if (++n > 25) break;
        console.log(`  ~ …${raw.slice(Math.max(0, m.index - 160), m.index + 200).replace(/\s+/g, ' ')}…`);
      }
    }
  } else if (args.includes('--pdf')) {
    /* official PDFs: is there a table, and by what geography? (pdftotext from poppler-utils, installed by the workflow) */
    const { execFileSync } = require('child_process');
    const fs = require('fs'), os = require('os'), path = require('path');
    const re = new RegExp(opt('--match', '.'), 'i');
    for (const u of many('--pdf')) {
      if (!ALLOWED.test(u)) throw new Error('not a cbs.gov.il URL: ' + u);
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
      const buf = Buffer.from(await r.arrayBuffer());
      console.log(`\n=== ${u}\n   HTTP ${r.status} · ${r.headers.get('content-type')} · ${buf.length} bytes · last-modified ${r.headers.get('last-modified')}`);
      if (r.status !== 200 || !/pdf/.test(r.headers.get('content-type') || '')) continue;
      const f = path.join(os.tmpdir(), 'cbs-' + Date.now() + '.pdf');
      fs.writeFileSync(f, buf);
      const text = execFileSync('pdftotext', ['-layout', f, '-'], { maxBuffer: 64 << 20 }).toString('utf8');
      const lines = text.split('\n');
      console.log(`   ${lines.length} lines`);
      lines.forEach((ln, i) => { if (re.test(ln)) console.log(`   ${String(i + 1).padStart(5)}| ${ln.replace(/\s+$/, '')}`); });
    }
  } else if (args.includes('--probe')) {
    const [year, range] = opt('--probe').split(':');
    const [a, b] = range.split('-').map(Number);
    const dept = opt('--dept', '04'), yy = String(year).slice(2);
    if (!(b >= a && b - a <= 400)) throw new Error('range too wide');
    let hits = 0;
    for (let n = a; n <= b; n++) {
      const num = String(n).padStart(3, '0');
      const url = `https://www.cbs.gov.il/he/mediarelease/DocLib/${year}/${num}/${dept}_${yy}_${num}b.pdf`;
      try {
        const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
        const type = r.headers.get('content-type') || '';
        if (r.status === 200 && /pdf/i.test(type)) { hits++; console.log(`  ${num}  ${r.headers.get('last-modified')}  ${r.headers.get('content-length')} bytes  ${url}`); }
      } catch (e) { console.log(`  ${num}  ERROR ${e.message}`); }
      await new Promise((ok) => setTimeout(ok, 250));
    }
    console.log(`${hits} PDFs of department ${dept} in ${year}/${a}-${b}`);
  } else if (args.includes('--series')) {
    const ids = opt('--series');
    const from = opt('--from', '01-2018'), to = opt('--to', '12-2026');
    for (const u of [
      `${SERIES}/data/list?id=${encodeURIComponent(ids)}&format=json&download=false&lang=he&startPeriod=${from}&endPeriod=${to}`,
      `${SERIES}/data/list?id=${encodeURIComponent(ids)}&format=json&download=false&lang=en&startPeriod=${from}&endPeriod=${to}`,
    ]) report(await get(u), Number(opt('--chars', 6000)));
  } else {
    console.log('usage: --get <url…> | --walk <url> --match <regex> | --series <ids>');
    process.exitCode = 2;
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
