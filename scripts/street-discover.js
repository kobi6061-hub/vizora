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
  out({ kind: 'profile', id, total, read: rows.length, fields });
  // which field is which (the registry's column names are Hebrew / transliterated): print value shapes per field
  for (const f of fields) {
    const vals = rows.map((x) => x[f]);
    const distinct = new Set(vals.map((v) => String(v).trim()));
    const nums = vals.map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n));
    out({ kind: 'field', f, distinct: distinct.size, numeric: nums.length, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null,
      sample: [...distinct].slice(0, 8) });
  }
  // special codes: the street-code field is the numeric one with values up to ~9999 and many repeats across localities
  const num = (v) => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : null; };
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

(async () => {
  if (args.includes('--catalogue')) return catalogue();
  if (args.includes('--resource')) return resource(opt('--resource'));
  if (args.includes('--profile')) return profile(opt('--profile'));
  if (args.includes('--over')) return over();
  console.log('usage: --catalogue | --resource <id> | --profile <id> | --over');
  process.exitCode = 2;
})().catch((e) => { console.error('discover failed:', e.message); process.exitCode = 1; });
