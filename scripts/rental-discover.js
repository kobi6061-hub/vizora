#!/usr/bin/env node
// PROPX · long-term rental — read-only source discovery (audit 14.10.2026).
//
// What do the official sources actually publish about long-term rental? Runs on a GitHub runner
// (.github/workflows/rental-discover.yml) — the Claude sandbox cannot reach these hosts. Read-only: GET requests
// with an honest User-Agent, one at a time, robots.txt respected for site probes; nothing is written or committed.
//
//   --wiki                     the Hebrew Wikipedia API: the government rental company's page — its official website
//   --site <host>              a site's robots.txt, sitemap(s), home page (generator, links) and public CMS / feed
//                              endpoints (/wp-json/, /feed/) — only paths robots.txt allows
//   --get <url…>               status, type, size and the first bytes of allowed URLs
//   --datagov <q|q|…>          data.gov.il CKAN package_search for each query: datasets, publishers, resources, dates
//   --cbs-index <regex>        the CBS price-index catalogue (chapters → subjects → series) — names matching, with codes
//                              and the latest observation of each match
//   --cbs-series <regex>       the CBS time-series catalogue (subjects → branches) — names matching, with paths

'use strict';

const UA = 'PROPX-rental-discover/1.0 (+https://github.com/kobi6061-hub/vizora; read-only source audit)';
const TIMEOUT = 25000;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const many = (k) => { const i = args.indexOf(k); if (i < 0) return []; const o = []; for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) o.push(args[j]); return o; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let extraHost = null;
const allowed = (u) => {
  let h; try { h = new URL(u).hostname; } catch { return false; }
  return /(^|\.)gov\.il$/.test(h) || /(^|\.)wikipedia\.org$/.test(h) || /(^|\.)wikidata\.org$/.test(h) || (extraHost && (h === extraHost || h.endsWith('.' + extraHost)));
};

async function get(url, accept = 'application/json, text/html;q=0.8, */*;q=0.5') {
  if (!allowed(url)) throw new Error('host not allowed: ' + url);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    const text = /json|text|xml|html|javascript/.test(type) || !type ? buf.toString('utf8').replace(/^﻿/, '') : null;
    let json = null; if (text) { try { json = JSON.parse(text); } catch { /* not json */ } }
    return { url, status: r.status, type, bytes: buf.length, ms: Date.now() - t0, text, json, finalUrl: r.url, lastModified: r.headers.get('last-modified') };
  } catch (e) { const c = e.cause || {}; return { url, status: 0, error: `${e.message}${c.code ? ' · ' + c.code : ''}${c.message ? ' · ' + c.message : ''}`, ms: Date.now() - t0 }; }
}
const line = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function report(res, n = 1200) {
  console.log(`\n=== ${res.url}`);
  if (res.error) { console.log('   ERROR', res.error); return; }
  console.log(`   HTTP ${res.status} · ${res.type} · ${res.bytes} bytes · ${res.ms} ms${res.lastModified ? ' · last-modified ' + res.lastModified : ''}${res.finalUrl && res.finalUrl !== res.url ? ' · → ' + res.finalUrl : ''}`);
  if (res.text) console.log('   ' + line(res.text).slice(0, n));
}

/* robots.txt: the Disallow rules for User-agent: * (simple prefix matching, enough to stay off forbidden paths) */
function robotsRules(text) {
  const rules = []; let star = false;
  for (const raw of String(text || '').split('\n')) {
    const l = raw.replace(/#.*/, '').trim(); if (!l) continue;
    const [k, ...v] = l.split(':'); const val = v.join(':').trim();
    if (/^user-agent$/i.test(k)) star = val === '*';
    else if (star && /^disallow$/i.test(k) && val) rules.push(val);
  }
  return rules;
}

(async () => {
  if (args.includes('--wiki')) {
    for (const title of ['דירה להשכיר (חברה ממשלתית)', 'דירה להשכיר']) {
      const base = 'https://he.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&action=query';
      const ex = await get(`${base}&prop=extlinks&ellimit=100&titles=${encodeURIComponent(title)}`);
      report(ex, 3000);
      const rev = await get(`${base}&prop=revisions&rvprop=content&rvslots=main&rvsection=0&titles=${encodeURIComponent(title)}`);
      const content = rev.json && rev.json.query && rev.json.query.pages && rev.json.query.pages[0] && rev.json.query.pages[0].revisions ? rev.json.query.pages[0].revisions[0].slots.main.content : '';
      console.log('   infobox lines:', (content.match(/^\|.*(אתר|website|URL|url).*$/gim) || []).join(' ¦ '));
      const pp = await get(`${base}&prop=pageprops&titles=${encodeURIComponent(title)}`);
      const q = pp.json && pp.json.query && pp.json.query.pages && pp.json.query.pages[0] && pp.json.query.pages[0].pageprops ? pp.json.query.pages[0].pageprops.wikibase_item : null;
      if (q) {
        const wd = await get(`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${q}&property=P856`);
        console.log(`   wikidata ${q} official website (P856):`, wd.json && wd.json.claims && wd.json.claims.P856 ? wd.json.claims.P856.map((c) => c.mainsnak.datavalue && c.mainsnak.datavalue.value).join(' | ') : wd.error || '(none)');
        const inst = await get(`https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${q}&property=P576`);
        console.log(`   wikidata ${q} dissolved (P576):`, inst.json && inst.json.claims && inst.json.claims.P576 ? JSON.stringify(inst.json.claims.P576.map((c) => c.mainsnak.datavalue && c.mainsnak.datavalue.value)) : '(none)');
      }
      console.log('   lead text:', line(content).slice(0, 1500));
    }
  } else if (args.includes('--site')) {
    const host = opt('--site'); extraHost = host.replace(/^www\./, '');
    for (const u of [`https://${host}/`, `http://${host}/`, `https://${extraHost}/`, `http://${extraHost}/`]) report(await get(u, 'text/html'), 300);
    const root = `https://${host}`;
    const rb = await get(root + '/robots.txt', 'text/plain'); report(rb, 1500);
    const rules = rb.status === 200 ? robotsRules(rb.text) : [];
    const ok = (p) => !rules.some((r) => p.startsWith(r));
    console.log('   disallow:', rules.join(' | ') || '(none)');
    const sitemaps = rb.text ? [...rb.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
    for (const sm of sitemaps.length ? sitemaps : [root + '/sitemap.xml', root + '/sitemap_index.xml']) {
      const r = await get(sm, 'application/xml, text/xml'); report(r, 2500);
      const locs = r.text ? [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]) : [];
      console.log(`   ${locs.length} <loc> entries`); locs.slice(0, 80).forEach((x) => console.log('     ' + x));
      await sleep(500);
    }
    const home = await get(root + '/', 'text/html'); report(home, 600);
    if (home.text) {
      console.log('   generator:', (home.text.match(/<meta[^>]+name=["']generator["'][^>]*>/i) || ['—'])[0]);
      const links = [...new Set([...home.text.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]))];
      console.log(`   ${links.length} links:`); links.slice(0, 120).forEach((x) => console.log('     ' + x));
      const apis = [...new Set([...home.text.matchAll(/["'](\/?(?:wp-json|api|graphql|umbraco|_next\/data)[^"'\s]*)["']/gi)].map((m) => m[1]))];
      console.log('   api-like paths in the page:', apis.slice(0, 40).join(' | ') || '(none)');
    }
    for (const p of ['/wp-json/', '/wp-json/wp/v2/types', '/wp-json/wp/v2/pages?per_page=50&_fields=id,slug,link,modified,title', '/feed/', '/api/', '/umbraco/api/']) {
      if (!ok(p)) { console.log(`\n=== ${root}${p} — disallowed by robots.txt, not requested`); continue; }
      const r = await get(root + p); report(r, 1500); await sleep(500);
      if (r.json && p === '/wp-json/' && r.json.routes) console.log('   routes:', Object.keys(r.json.routes).slice(0, 120).join(' '));
    }
  } else if (args.includes('--get')) {
    const hosts = opt('--allow'); if (hosts) extraHost = hosts;
    for (const u of many('--get')) { report(await get(u), Number(opt('--chars', 2500))); await sleep(400); }
  } else if (args.includes('--datagov')) {
    for (const q of opt('--datagov').split('|')) {
      const r = await get(`https://data.gov.il/api/3/action/package_search?rows=40&q=${encodeURIComponent(q)}`);
      console.log(`\n=== data.gov.il package_search "${q}" → ${r.status} ${r.json && r.json.result ? r.json.result.count + ' datasets' : r.error || ''}`);
      for (const p of (r.json && r.json.result ? r.json.result.results : [])) {
        console.log(`  · ${p.title} [${p.name}] · ${p.organization ? p.organization.title : '—'} · modified ${p.metadata_modified}`);
        for (const res of p.resources || []) console.log(`      - ${res.name || res.id} · ${res.format} · ${res.id} · ${res.datastore_active ? 'datastore' : 'file'} · modified ${res.last_modified || res.created}`);
      }
      await sleep(400);
    }
  } else if (args.includes('--cbs-index')) {
    const re = new RegExp(opt('--cbs-index'), 'i');
    const B = 'https://api.cbs.gov.il/index';
    const cat = await get(`${B}/catalog/catalog?lang=he&format=json&download=false`);
    const nodes = (j, pre) => { const out = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { const id = v[pre + 'Id'] ?? v[pre + 'ID'] ?? v.id; const name = v[pre + 'Name'] ?? v.name; if (id != null && name) out.push({ id, name, mainCode: v.mainCode }); Object.values(v).forEach(walk); } }; walk(j); return out; };
    const chapters = [...new Map(nodes(cat.json, 'chapter').map((c) => [c.id, c])).values()];
    console.log(`${chapters.length} chapters`);
    for (const ch of chapters) {
      console.log(`chapter ${ch.id} ${ch.name}${ch.mainCode ? ' · main ' + ch.mainCode : ''}`);
      const c = await get(`${B}/catalog/chapter?id=${encodeURIComponent(ch.id)}&lang=he&format=json&download=false`); await sleep(250);
      for (const s of [...new Map(nodes(c.json, 'subject').map((x) => [x.id, x])).values()]) {
        const hit = re.test(s.name) || re.test(ch.name);
        if (!hit) continue;
        console.log(`  ★ subject ${s.id} ${s.name}`);
        const sj = await get(`${B}/catalog/subject?id=${encodeURIComponent(s.id)}&lang=he&format=json&download=false`); await sleep(250);
        const codes = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { const code = v.code ?? v.Code ?? v.indexCode; const name = v.name ?? v.Name ?? v.indexName; if (code != null && name) codes.push({ code, name }); Object.values(v).forEach(walk); } };
        walk(sj.json);
        for (const x of codes.slice(0, 60)) {
          const d = await get(`${B}/data/price?id=${encodeURIComponent(x.code)}&format=json&download=false&lang=he&last=2`); await sleep(250);
          console.log(`     ${x.code} ${x.name} → ${d.status} ${d.text ? line(d.text).slice(0, 300) : d.error || ''}`);
        }
      }
    }
  } else if (args.includes('--cbs-series')) {
    const re = new RegExp(opt('--cbs-series'), 'i'), S = 'https://apis.cbs.gov.il/series';
    const lvl = await get(`${S}/catalog/level?id=1&format=json&download=false&lang=he`);
    const subs = lvl.json && lvl.json.catalogs ? lvl.json.catalogs.catalog : [];
    console.log(`${subs.length} subjects`);
    for (const s of subs) {
      const id = (s.path || []).join(',');
      console.log(`subject ${id} ${s.name}`);
      for (let page = 1; page <= 10; page++) {
        const r = await get(`${S}/catalog/path?id=${encodeURIComponent(id)}&format=json&download=false&lang=he&Page=${page}&PageSize=100`); await sleep(200);
        const c = r.json && r.json.catalogs; if (!c) break;
        for (const n of c.catalog || []) if (re.test(n.name) || re.test(s.name)) console.log(`  ★ ${(n.path || []).join(',')} ${n.name}`);
        if (!c.paging || !c.paging.next_url) break;
      }
    }
  } else {
    console.log('usage: --wiki | --site <host> | --get <url…> [--allow host] | --datagov "q|q" | --cbs-index <regex> | --cbs-series <regex>');
    process.exitCode = 2;
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
