#!/usr/bin/env node
// PROPX · Israel street directory — read-only source discovery.
//
// Verifies, on a GitHub runner (data.gov.il and over.org.il answer there, not from the Claude sandbox), what the
// official street sources publish before PROPX depends on them. Read-only: GET requests only; nothing is written.
//
//   node scripts/street-discover.js --catalogue                 data.gov.il packages / resources for streets + synonyms
//   node scripts/street-discover.js --resource <id>             one resource: fields, total, last modified, sample rows
//   node scripts/street-discover.js --profile <id>              the WHOLE table (paged): code ranges, special rows, duplicates
//   node scripts/street-discover.js --over                      over.org.il's OpenAPI: every path + parameters (deals register)
//   node scripts/street-discover.js --over-sweep "<a>|<b>"      a settlement sweep sample + its match to the street directory

'use strict';

const UA = 'PROPX-street-discover/1.0 (+https://github.com/kobi6061-hub/vizora)';
const CKAN = 'https://data.gov.il/api/3/action/';
const TIMEOUT = 45000;
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = (o) => console.log(JSON.stringify(o));
const trim = (v, n = 600) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text, json, lastModified: r.headers.get('last-modified') };
}
async function ck(action, params) {
  const r = await get(CKAN + action + '?' + new URLSearchParams(params));
  if (!r.json || !r.json.success) throw new Error(`${action} HTTP ${r.status}: ${trim(r.text, 200)}`);
  return r.json.result;
}

async function catalogue() {
  const terms = ['רחובות', 'רשימת רחובות', 'שמות רחובות', 'רחובות נרדפים', 'שמות נרדפים', 'street', 'streets', 'synonym', 'כתובות', 'יישובים'];
  const seen = new Map();
  for (const q of terms) {
    try {
      const r = await ck('package_search', { q, rows: 25 });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => ({ name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified })) });
      for (const p of r.results) seen.set(p.name, p);
    } catch (e) { out({ kind: 'search', q, error: e.message }); }
  }
  for (const p of seen.values()) {
    if (!/רחוב|street|נרדפ|synonym|ישוב|יישוב|כתוב/i.test(`${p.title} ${p.name}`)) continue;
    out({ kind: 'package', name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified, notes: trim(p.notes || '', 500),
      resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, format: x.format, ds: x.datastore_active, lm: x.last_modified, created: x.created, size: x.size, url: x.url })) });
  }
}

async function resource(id) {
  const meta = await ck('resource_show', { id });
  out({ kind: 'resourceMeta', id, name: meta.name, format: meta.format, ds: meta.datastore_active, lastModified: meta.last_modified, created: meta.created, url: meta.url, package: meta.package_id });
  const r = await ck('datastore_search', { resource_id: id, limit: 8 });
  out({ kind: 'resourceTable', id, total: r.total, fields: r.fields.map((f) => `${f.id}:${f.type}`), sample: r.records });
}

async function profile(id) {
  const rows = []; let offset = 0, total = null;
  for (let guard = 0; guard < 20; guard++) {
    const r = await ck('datastore_search', { resource_id: id, limit: 32000, offset });
    total = r.total; rows.push(...r.records); offset += r.records.length;
    if (!r.records.length || offset >= total) break;
  }
  const fields = Object.keys(rows[0] || {});
  const num = (v) => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : null; };
  out({ kind: 'profile', id, total, read: rows.length, fields });
  // which field is which (the registry's column names are Hebrew / transliterated): print value shapes per field
  for (const f of fields) {
    const vals = rows.map((x) => x[f]);
    const distinct = new Set(vals.map((v) => String(v).trim()));
    const nums = vals.map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n));
    out({ kind: 'field', f, distinct: distinct.size, numeric: nums.length, min: nums.length ? nums.reduce((a, b) => Math.min(a, b)) : null, max: nums.length ? nums.reduce((a, b) => Math.max(a, b)) : null,
      sample: [...distinct].slice(0, 8) });
  }
  // special codes: the street-code field is the numeric one with values up to ~9999 and many repeats across localities
  /* the synonyms registry: name status values, synonyms whose official code is / is not an official row of the same locality */
  if (fields.includes('official_code') && fields.includes('street_name_status')) {
    const st = new Map(); for (const x of rows) { const k = String(x.street_name_status).trim(); st.set(k, (st.get(k) || 0) + 1); }
    out({ kind: 'synStatus', values: [...st] });
    const off = new Set(rows.filter((x) => num(x.street_code) === num(x.official_code)).map((x) => `${num(x.city_code)}:${num(x.street_code)}`));
    const syn = rows.filter((x) => num(x.street_code) !== num(x.official_code));
    const orphan = syn.filter((x) => !off.has(`${num(x.city_code)}:${num(x.official_code)}`));
    out({ kind: 'synShape', officialRows: rows.length - syn.length, synonymRows: syn.length, synonymTargetMissing: orphan.length,
      sampleSyn: syn.slice(0, 30).map((x) => [x.city_code, x.city_name, x.street_code, x.street_name, x.street_name_status, x.official_code].map((v) => String(v).trim()).join(' | ')),
      sampleOrphan: orphan.slice(0, 15).map((x) => [x.city_code, x.city_name, x.street_code, x.street_name, x.street_name_status, x.official_code].map((v) => String(v).trim()).join(' | ')),
      tlvSample: rows.filter((x) => num(x.city_code) === 5000 && /רוטשילד|אבן גבירול|דיזנגוף|ז.בוטינסקי/.test(String(x.street_name))).slice(0, 25).map((x) => [x.street_code, x.street_name, x.street_name_status, x.official_code].map((v) => String(v).trim()).join(' | ')) });
    const perStreet = new Map(); for (const x of syn) { const k = `${num(x.city_code)}:${num(x.official_code)}`; perStreet.set(k, (perStreet.get(k) || 0) + 1); }
    out({ kind: 'synPerStreet', streetsWithSynonyms: perStreet.size, max: [...perStreet.values()].reduce((a, b) => Math.max(a, b), 0),
      regions: [...new Set(rows.map((x) => `${String(x.region_code).trim()} ${String(x.region_name).trim()}`))].slice(0, 20) });
  }
  const cand = fields.filter((f) => /סמל_רחוב|street_code|semel_rechov|רחוב.*סמל|סמל.*רחוב/i.test(f));
  const cityF = fields.filter((f) => /סמל_ישוב|city_code|semel_yeshuv|ישוב.*סמל|סמל.*ישוב/i.test(f));
  out({ kind: 'columns', streetCode: cand, cityCode: cityF });
  if (cand[0] && cityF[0]) {
    const sc = cand[0], cc = cityF[0];
    const nameF = fields.find((f) => /שם_רחוב|street_name|shem_rechov/i.test(f)), cityNameF = fields.find((f) => /שם_ישוב|city_name|shem_yeshuv/i.test(f));
    const byCode = new Map(); for (const x of rows) { const c = num(x[sc]); byCode.set(c, (byCode.get(c) || 0) + 1); }
    const ranges = [[0, 0], [1, 999], [1000, 1999], [2000, 4999], [5000, 5999], [6000, 6999], [7000, 7999], [8000, 8999], [9000, 9000], [9001, 9999], [10000, 1e9]];
    out({ kind: 'streetCodeRanges', ranges: ranges.map(([a, b]) => ({ range: `${a}-${b}`, rows: rows.filter((x) => { const c = num(x[sc]); return c != null && c >= a && c <= b; }).length })) });
    const show = (label, pred, n = 25) => { const xs = rows.filter(pred); out({ kind: 'special', label, rows: xs.length, sample: xs.slice(0, n).map((x) => [x[cc], x[cityNameF], x[sc], x[nameF]].map((v) => String(v).trim()).join(' | ')) }); };
    show('code 9000', (x) => num(x[sc]) === 9000);
    show('code >= 9000 other', (x) => num(x[sc]) > 9000);
    show('code 0', (x) => num(x[sc]) === 0);
    show('code 1-99', (x) => { const c = num(x[sc]); return c != null && c >= 1 && c <= 99; }, 30);
    show('code 5000-5999', (x) => { const c = num(x[sc]); return c != null && c >= 5000 && c <= 5999; }, 30);
    show('code 6000-6999', (x) => { const c = num(x[sc]); return c != null && c >= 6000 && c <= 6999; }, 30);
    show('code 7000-8999', (x) => { const c = num(x[sc]); return c != null && c >= 7000 && c <= 8999; }, 30);
    show('street name == locality name', (x) => String(x[nameF]).trim() === String(x[cityNameF]).trim());
    show('name has (', (x) => /\(/.test(String(x[nameF])), 30);
    show('name looks like שכ / שכונת / קרית', (x) => /^(שכ |שכ'|שכונת|שכונה|קרית|קריית|גבעת|רמת|נווה|נוה)/.test(String(x[nameF]).trim()), 30);
    show('name with digits', (x) => /\d/.test(String(x[nameF])), 30);
    const dup = new Map(); for (const x of rows) { const k = `${num(x[cc])}:${num(x[sc])}`; dup.set(k, (dup.get(k) || 0) + 1); }
    const dups = [...dup].filter(([, v]) => v > 1);
    out({ kind: 'duplicateKeys', count: dups.length, sample: dups.slice(0, 20) });
    out({ kind: 'localities', distinct: new Set(rows.map((x) => num(x[cc]))).size });
  }
}

async function over() {
  const r = await get('https://www.over.org.il/openapi.json');
  out({ kind: 'overSpec', status: r.status });
  const spec = r.json || {};
  out({ kind: 'overInfo', info: trim(spec.info, 1500) });
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      const params = (op.parameters || []).map((x) => `${x.name}${x.required ? '*' : ''}:${x.schema && (x.schema.type || (x.schema.anyOf || []).map((a) => a.type).join('|'))}${x.schema && x.schema.enum ? '[' + x.schema.enum.join(',') + ']' : ''}${x.schema && x.schema.maximum != null ? ' ≤' + x.schema.maximum : ''}`);
      out({ kind: 'overPath', method: method.toUpperCase(), path: p, summary: op.summary, desc: trim(op.description || '', 700), params });
    }
  }
}

/* --over-probe [settlementCode] [street] — the exact shapes of the street-relevant answers, a dozen sequential GETs, one second
   apart (a volunteer project's public API: polite by construction) */
async function overProbe(code = '7900', street = 'העצמאות', city = 'פתח תקווה') {
  const B = 'https://www.over.org.il';
  const e = encodeURIComponent;
  const calls = [
    ['deals/stats', '/api/deals/stats'],
    ['deals/natures', '/api/deals/natures'],
    ['govmap/stats', '/api/deals/govmap/stats'],
    ['breakdown(city)', `/api/deals/breakdown?settlement_code=${code}&limit=60`],
    ['breakdown(city,street)', `/api/deals/breakdown?settlement_code=${code}&street=${e(street)}&limit=60`],
    ['series(city,street)', `/api/deals/series?settlement_code=${code}&street=${e(street)}`],
    ['search(city,street)', `/api/deals/search?settlement_code=${code}&street=${e(street)}&limit=5&date_from=2023-01-01`],
    ['search(city,street-prefix)', `/api/deals/search?settlement_code=${code}&street=${e(street.slice(0, 3))}&limit=3`],
    ['nadlan/streets', `/api/nadlan/streets?q=${e(street)}&settlement=${code}&limit=20`],
    ['nadlan/address', `/api/nadlan/address?city=${e(city)}&street=${e(street)}&number=1&deals=false`],
    ['govmap/settlements', '/api/deals/govmap/settlements'],
    ['govmap/search(city,street)', `/api/deals/govmap/search?settlement=${e(city)}&street=${e(street)}&limit=5&date_from=2023-01-01`],
  ];
  for (const [label, p] of calls) {
    try {
      const r = await get(B + p);
      const j = r.json;
      const rows = j && (Array.isArray(j) ? j : j.data || j.results || j.items || j.streets || null);
      out({ kind: 'overProbe', label, url: p, status: r.status, keys: j && !Array.isArray(j) ? Object.keys(j).slice(0, 30) : null,
        n: Array.isArray(rows) ? rows.length : null, total: j && (j.total ?? j.count ?? null), head: trim(Array.isArray(rows) ? rows.slice(0, 6) : j, 2200),
        notes: j && (j.notes || j.caveats) ? trim(j.notes || j.caveats, 900) : undefined });
    } catch (err) { out({ kind: 'overProbe', label, url: p, error: err.message }); }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
}

/* --over-sweep "<settlement>|<settlement>…" — what a settlement-wide sweep of the republished register returns, before PROPX
   builds street evidence on it: the settlement list (names ↔ CBS codes), then per settlement three pages of the last 36
   months (200 rows each) and one street query; the parcel-crosswalk addresses of each row are matched, ON THE RUNNER, to the
   official street directory committed in this repository (official name · synonym · alias key · none) and summarised.
   Sequential GETs one second apart; nothing is written. */
async function overSweep(names) {
  const B = 'https://www.over.org.il';
  const e = encodeURIComponent;
  const pause = () => new Promise((ok) => setTimeout(ok, 1000));
  const SD = require('../lib/streets/directory');
  const { aliasKeys } = require('../lib/geo/aliases');
  const D = SD.load();
  const st = await get(B + '/api/deals/stats'); await pause();
  const last = st.json && st.json.last_deal ? String(st.json.last_deal) : null;
  const from = last ? new Date(Date.parse(last) - 3 * 365.25 * 86400e3).toISOString().slice(0, 10) : '2023-09-17';
  out({ kind: 'overSweep', step: 'stats', status: st.status, head: trim(st.json, 600), dateFrom: from });
  const sl = await get(B + '/api/deals/settlements'); await pause();
  const rows = (sl.json && (sl.json.data || sl.json)) || [];
  const codes = new Map();
  for (const r of rows) { const c = r.settlement_code == null || r.settlement_code === '' ? null : Number(r.settlement_code); if (!codes.has(c)) codes.set(c, []); codes.get(c).push(r.settlement); }
  out({ kind: 'overSweep', step: 'settlements', status: sl.status, n: rows.length, keys: rows[0] ? Object.keys(rows[0]) : null, head: trim(rows.slice(0, 4), 800),
    withCode: rows.filter((r) => r.settlement_code != null && r.settlement_code !== '').length,
    codeInDirectory: rows.filter((r) => D.localities.has(Number(r.settlement_code))).length,
    codesWithSeveralNames: [...codes].filter(([c, n]) => c != null && n.length > 1).slice(0, 15),
    resolvedCodeDiffers: rows.filter((r) => r.resolved_code != null && String(r.resolved_code) !== String(r.settlement_code)).slice(0, 10) });
  for (const asked of names) {
    const meta = rows.find((r) => r.settlement === asked) || rows.find((r) => SD.normName(r.settlement) === SD.normName(asked));
    const name = meta ? meta.settlement : asked;
    const code = meta ? Number(meta.settlement_code || meta.resolved_code) : null;
    const loc = D.localities.get(code);
    /* the directory's names of this locality: official name → ids, synonym → ids, alias key → ids */
    const byName = new Map(), bySyn = new Map(), byKey = new Map();
    const add = (m, k, id) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
    for (const x of D.streets) if (x.cityCode === code && x.kind !== 'locality') { add(byName, x.n, x.id); for (const k of aliasKeys(x.name)) add(byKey, k, x.id); }
    for (const y of D.synonyms) if (y.cityCode === code) { const id = SD.streetId(y.cityCode, y.officialCode); add(bySyn, y.n, id); for (const k of aliasKeys(y.name)) add(byKey, k, id); }
    const tally = { rows: 0, natures: {}, withAddresses: 0, nAddr: {}, totalGtShown: 0, multiStreetParcels: 0,
      streetMatch: { official: 0, synonym: 0, aliasKey: 0, ambiguous: 0, none: 0 }, noneSample: [], ambiguousSample: [], keys: null, sample: [] };
    for (let page = 0; page < 3; page++) {
      const url = `/api/deals/search?settlement=${e(name)}&date_from=${from}&sort=date_desc&limit=200&offset=${page * 200}`;
      const r = await get(B + url); await pause();
      if (page === 0) out({ kind: 'overSweep', step: 'page0', settlement: name, code, inDirectory: !!loc, status: r.status, keys: r.json ? Object.keys(r.json) : null,
        total: r.json && r.json.total, totalCapped: r.json && r.json.total_capped, extra: r.json ? trim(Object.fromEntries(Object.entries(r.json).filter(([k]) => k !== 'data')), 700) : trim(r.text, 300) });
      const data = (r.json && r.json.data) || [];
      for (const d of data) {
        tally.rows++; tally.keys = tally.keys || Object.keys(d);
        if (tally.sample.length < 4) tally.sample.push(trim(d, 900));
        tally.natures[d.nature] = (tally.natures[d.nature] || 0) + 1;
        const addrs = Array.isArray(d.addresses) ? d.addresses : [];
        tally.nAddr[addrs.length] = (tally.nAddr[addrs.length] || 0) + 1;
        if (addrs.length) tally.withAddresses++;
        if (Number(d.addresses_total) > addrs.length) tally.totalGtShown++;
        const streets = new Set();
        for (const a of addrs) {
          const t = String(typeof a === 'string' ? a : (a && (a.street || a.address)) || '').trim();
          const m = t.match(/^(.*\S)\s+(\d+\s*[א-ת]?)$/); const sn = SD.normName(m ? m[1] : t);
          let ids = byName.get(sn), how = 'official';
          if (!ids) { ids = bySyn.get(sn); how = 'synonym'; }
          if (!ids) { ids = null; for (const k of aliasKeys(sn)) if (byKey.has(k)) { ids = byKey.get(k); break; } how = 'aliasKey'; }
          if (!ids) { tally.streetMatch.none++; if (tally.noneSample.length < 12) tally.noneSample.push(t); continue; }
          if (ids.size > 1) { tally.streetMatch.ambiguous++; if (tally.ambiguousSample.length < 6) tally.ambiguousSample.push([t, [...ids]]); continue; }
          tally.streetMatch[how]++; streets.add([...ids][0]);
        }
        if (streets.size > 1) tally.multiStreetParcels++;
      }
      if (data.length < 200) break;
    }
    out({ kind: 'overSweep', step: 'summary', settlement: name, code, ...tally, sample: undefined });
    for (const x of tally.sample) out({ kind: 'overSweep', step: 'row', settlement: name, row: x });
    const anyStreet = [...byName.keys()][0];
    if (anyStreet) {
      const r = await get(B + `/api/deals/search?settlement=${e(name)}&street=${e(anyStreet)}&date_from=${from}&limit=5`); await pause();
      out({ kind: 'overSweep', step: 'streetQuery', settlement: name, street: anyStreet, status: r.status,
        extra: r.json ? trim(Object.fromEntries(Object.entries(r.json).filter(([k]) => k !== 'data')), 900) : trim(r.text, 300),
        rows: r.json && r.json.data ? r.json.data.map((d) => trim({ date: d.date, gush: d.gush, helka: d.helka, addresses: d.addresses, addresses_total: d.addresses_total }, 400)) : null });
    }
  }
}

(async () => {
  if (args.includes('--over-sweep')) return overSweep(String(opt('--over-sweep') || 'פתח תקווה').split('|').map((x) => x.trim()).filter(Boolean));
  if (args.includes('--over-probe')) return overProbe(opt('--over-probe') || undefined, opt('--street') || undefined, opt('--city') || undefined);
  if (args.includes('--catalogue')) return catalogue();
  if (args.includes('--resource')) return resource(opt('--resource'));
  if (args.includes('--profile')) return profile(opt('--profile'));
  if (args.includes('--over')) return over();
  console.log('usage: --catalogue | --resource <id> | --profile <id> | --over');
  process.exitCode = 2;
})().catch((e) => { console.error('discover failed:', e.message); process.exitCode = 1; });
