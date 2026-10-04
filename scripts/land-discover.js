#!/usr/bin/env node
// PROPX · Land & Tender — read-only source discovery.
//
// Prints what the public sources of residential land, marketing and tenders
// actually expose: endpoints, fields, code tables, counts, date ranges and a
// few real records — so the source registry and the ingestion contract are
// written from evidence. Runs where gov.il is reachable (the GitHub runner,
// .github/workflows/land-discover.yml); the Claude sandbox cannot reach it.
//
//   node scripts/land-discover.js --rmi            Israel Land Authority tender site API (apps.land.gov.il/MichrazimSite)
//   node scripts/land-discover.js --rmi-detail <id,id,…>   full detail + map payload of given MichrazIDs
//   node scripts/land-discover.js --datagov        data.gov.il catalogue: land / tender / planning datasets + schemas
//   node scripts/land-discover.js --xplan          Planning Administration ArcGIS (xplan) services and plan layers
//   node scripts/land-discover.js --moch           MoCH development / infrastructure tender datasets (data.gov.il)
//   node scripts/land-discover.js --all
//
// Nothing is written anywhere. Every request carries an honest User-Agent and
// a bounded timeout; sequential with a small delay on the RMI site.

'use strict';

const UA = 'PROPX-land-discovery/1.0 (+https://github.com/kobi6061-hub/vizora; read-only source audit)';
const CKAN = 'https://data.gov.il/api/3/action';
const RMI = 'https://apps.land.gov.il/MichrazimSite/api';
const RMI_SITE = 'https://apps.land.gov.il/MichrazimSite/';
const XPLAN = 'https://ags.iplan.gov.il/arcgisiplan/rest/services';
const argVal = (f) => { const i = process.argv.indexOf('--' + f); return i > -1 ? process.argv[i + 1] : null; };
const has = (f) => process.argv.includes('--' + f);
const out = (o) => console.log(JSON.stringify(o));
const trim = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, { method = 'GET', body, headers = {}, accept = 'application/json', timeoutMs = 45000 } = {}) {
  const t0 = Date.now();
  const r = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': UA, Accept: accept, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, ok: r.ok, ms: Date.now() - t0, type: r.headers.get('content-type') || '', text, json,
    server: r.headers.get('server'), cache: r.headers.get('x-cache') };
}
/* a value profile: keys, types, non-null counts, examples — never a dump of everything */
function profile(rows, max = 60) {
  const keys = new Map();
  for (const row of rows) for (const [k, v] of Object.entries(row || {})) {
    const p = keys.get(k) || { type: new Set(), nonNull: 0, examples: [] };
    p.type.add(v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    if (v !== null && v !== undefined && v !== '') { p.nonNull++; if (p.examples.length < 3 && !p.examples.includes(trim(v, 80))) p.examples.push(trim(v, 80)); }
    keys.set(k, p);
  }
  return Object.fromEntries([...keys].slice(0, max).map(([k, p]) => [k, { types: [...p.type].join('|'), nonNull: p.nonNull, ex: p.examples }]));
}
const dist = (rows, k, top = 25) => { const m = new Map(); for (const r of rows) { const v = r && r[k]; m.set(String(v), (m.get(String(v)) || 0) + 1); }
  return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]).slice(0, top)); };
const dateRange = (rows, k) => { const d = rows.map((r) => r && r[k]).filter(Boolean).map(String).sort(); return d.length ? { min: d[0], max: d[d.length - 1], n: d.length } : null; };

/* ───────────────────────── RMI tender site ───────────────────────── */
const RMI_HEADERS = { Origin: 'https://apps.land.gov.il', Referer: RMI_SITE };

async function rmiEndpointsFromApp() {
  // the public app's own script names its API paths: listed here so no endpoint is guessed
  try {
    const page = await req(RMI_SITE, { accept: 'text/html' });
    const scripts = [...page.text.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    out({ kind: 'rmiApp', status: page.status, scripts: scripts.slice(0, 12) });
    const paths = new Set();
    for (const s of scripts.slice(0, 8)) {
      const u = s.startsWith('http') ? s : RMI_SITE + s.replace(/^\.?\//, '');
      try {
        const js = await req(u, { accept: '*/*' });
        for (const m of js.text.matchAll(/api\/([A-Za-z]+Api)\/([A-Za-z]+)/g)) paths.add(m[1] + '/' + m[2]);
        for (const m of js.text.matchAll(/"(\/?api\/[A-Za-z/]+)"/g)) paths.add(m[1]);
      } catch (e) { out({ kind: 'rmiAppScript', url: u, error: e.message }); }
    }
    out({ kind: 'rmiEndpoints', n: paths.size, paths: [...paths].sort() });
  } catch (e) { out({ kind: 'rmiApp', error: e.message }); }
}

async function rmi() {
  await rmiEndpointsFromApp();
  // reference tables the site itself loads
  for (const p of ['YeshuvimApi/Get', 'SearchApi/GetSugMichraz', 'SearchApi/GetYeudMichraz', 'SearchApi/GetMerchav', 'SearchApi/GetStatusMichraz',
    'SearchApi/GetUchlusiya', 'SearchApi/GetSearchOptions', 'MichrazDetailsApi/GetSugMichraz', 'KodimApi/Get', 'SearchApi/GetKodim']) {
    try {
      const r = await req(RMI + '/' + p, { headers: RMI_HEADERS });
      const rows = Array.isArray(r.json) ? r.json : r.json && typeof r.json === 'object' ? Object.entries(r.json).slice(0, 1).map(([k, v]) => ({ [k]: v })) : [];
      out({ kind: 'rmiRef', path: p, status: r.status, ms: r.ms, n: Array.isArray(r.json) ? r.json.length : null,
        keys: r.json && !Array.isArray(r.json) ? Object.keys(r.json).slice(0, 30) : undefined,
        profile: rows.length ? profile(rows, 20) : undefined, sample: Array.isArray(r.json) ? trim(r.json.slice(0, 12), 1500) : trim(r.json, 600) });
    } catch (e) { out({ kind: 'rmiRef', path: p, error: e.message }); }
    await sleep(600);
  }
  // the whole tender list (the site's own search, no filters) and the active subset
  let all = [];
  for (const [label, body] of [['all', { ActiveQuickSearch: false, ActiveMichraz: false }], ['active', { ActiveQuickSearch: false, ActiveMichraz: true }],
    ['hasResults', { ActiveQuickSearch: false, ActiveMichraz: false, hasResults: true }]]) {
    try {
      const r = await req(RMI + '/SearchApi/Search', { method: 'POST', body, headers: RMI_HEADERS, timeoutMs: 120000 });
      const rows = Array.isArray(r.json) ? r.json : r.json && Array.isArray(r.json.results) ? r.json.results : [];
      if (label === 'all') all = rows;
      out({ kind: 'rmiSearch', label, status: r.status, ms: r.ms, type: r.type, n: rows.length, topKeys: r.json && !Array.isArray(r.json) ? Object.keys(r.json) : undefined,
        profile: profile(rows), excerpt: rows.length ? undefined : trim(r.text, 400) });
      if (rows.length) out({ kind: 'rmiSearchDist', label,
        status: dist(rows, 'StatusMichraz'), type: dist(rows, 'KodSugMichraz'), purpose: dist(rows, 'KodYeudMichraz'), region: dist(rows, 'KodMerchav'),
        booklet: dist(rows, 'PublishedChoveret'), online: dist(rows, 'Mekuvan'),
        pirsum: dateRange(rows, 'PirsumDate'), sgira: dateRange(rows, 'SgiraDate'), vaada: dateRange(rows, 'VaadaDate'), pticha: dateRange(rows, 'PtichaDate'),
        unitsTotal: rows.reduce((a, x) => a + (Number(x.YechidotDiur) || 0), 0), withUnits: rows.filter((x) => Number(x.YechidotDiur) > 0).length,
        sample: rows.slice(0, 3) });
    } catch (e) { out({ kind: 'rmiSearch', label, error: e.message }); }
    await sleep(1000);
  }
  // detail of a handful of real tenders of different states: newest active, newest with a committee date, a cancelled one, a residential one with units
  const by = (f) => all.filter(f).sort((a, b) => String(b.PirsumDate || '').localeCompare(String(a.PirsumDate || '')));
  const picks = new Map();
  const add = (label, t) => { if (t && !picks.has(t.MichrazID)) picks.set(t.MichrazID, label); };
  add('active-newest', by((t) => t.SgiraDate && String(t.SgiraDate) > new Date().toISOString())[0]);
  add('committee-dated-residential', by((t) => t.VaadaDate && Number(t.YechidotDiur) > 0 && String(t.VaadaDate) < new Date().toISOString())[0]);
  add('committee-dated-residential-2', by((t) => t.VaadaDate && Number(t.YechidotDiur) > 20 && String(t.VaadaDate) < new Date().toISOString())[3]);
  for (const st of Object.keys(dist(all, 'StatusMichraz'))) add('status-' + st, by((t) => String(t.StatusMichraz) === st)[0]);
  for (const ty of Object.keys(dist(all, 'KodSugMichraz')).slice(0, 8)) add('type-' + ty, by((t) => String(t.KodSugMichraz) === ty && Number(t.YechidotDiur) > 0)[0]);
  await rmiDetails([...picks].map(([id, label]) => ({ id, label })));
}

async function rmiDetails(list) {
  for (const { id, label } of list) {
    for (const [what, path] of [['detail', 'MichrazDetailsApi/Get'], ['map', 'MichrazDetailsApi/GetMichrazMapaDetails']]) {
      try {
        const r = await req(`${RMI}/${path}?michrazID=${encodeURIComponent(id)}`, { headers: RMI_HEADERS });
        const j = r.json;
        const nested = j && typeof j === 'object' && !Array.isArray(j)
          ? Object.fromEntries(Object.entries(j).filter(([, v]) => Array.isArray(v) || (v && typeof v === 'object')).map(([k, v]) => [k,
            Array.isArray(v) ? { n: v.length, profile: v.length && typeof v[0] === 'object' ? profile(v, 40) : undefined, first: trim(v[0], 1200) } : { keys: Object.keys(v).slice(0, 40), excerpt: trim(v, 900) }]))
          : undefined;
        out({ kind: 'rmiDetail', what, label, id, status: r.status, ms: r.ms, type: r.type,
          scalar: j && typeof j === 'object' && !Array.isArray(j) ? Object.fromEntries(Object.entries(j).filter(([, v]) => v === null || typeof v !== 'object').map(([k, v]) => [k, trim(v, 160)])) : undefined,
          nested, excerpt: j ? undefined : trim(r.text, 300) });
      } catch (e) { out({ kind: 'rmiDetail', what, label, id, error: e.message }); }
      await sleep(800);
    }
  }
}

/* ───────────────────────── data.gov.il ───────────────────────── */
async function ck(action, params = {}) {
  const u = new URL(CKAN + '/' + action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await req(u.toString());
  if (!r.json || !r.json.success) throw new Error(`${action} HTTP ${r.status}: ${trim(r.text, 200)}`);
  return r.json.result;
}
async function datagov() {
  const seen = new Map();
  const queries = ['מכרזי קרקע', 'מכרזים רשות מקרקעי ישראל', 'תוצאות מכרזים', 'שיווק קרקעות', 'מתחמים למגורים', 'הקצאת קרקע', 'חוזי פיתוח', 'מלאי תכנוני',
    'שומת קרקע', 'מכרזי פיתוח', 'מכרזי תשתית', 'יחידות דיור', 'תכניות מפורטות', 'היתרי בנייה', 'התחלות בנייה', 'land tender', 'planning inventory',
    'רשות מקרקעי ישראל', 'משרד הבינוי והשיכון', 'מינהל התכנון', 'תכנית מתאר', 'דיור להשכרה', 'התחדשות עירונית'];
  for (const q of queries) {
    try {
      const r = await ck('package_search', { q, rows: 30 });
      for (const p of r.results) if (!seen.has(p.name)) seen.set(p.name, { q, p });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => p.name) });
    } catch (e) { out({ kind: 'search', q, error: e.message }); }
  }
  for (const fq of ['organization:israel_land_authority', 'organization:the_israel_lands_administration', 'organization:ministry_of_construction_and_housing',
    'organization:ministry_of_housing', 'organization:planning_administration', 'organization:israel_planning_administration']) {
    try {
      const r = await ck('package_search', { fq, rows: 200 });
      for (const p of r.results) if (!seen.has(p.name)) seen.set(p.name, { q: fq, p });
      out({ kind: 'org', fq, count: r.count, names: r.results.map((p) => p.name) });
    } catch (e) { out({ kind: 'org', fq, error: e.message }); }
  }
  try {
    const orgs = await ck('organization_list', { all_fields: true, limit: 1000 });
    out({ kind: 'orgs', matches: orgs.filter((o) => /מקרקעי|בינוי|שיכון|תכנון|land|housing|plan/i.test(o.title + ' ' + o.name)).map((o) => ({ name: o.name, title: o.title, n: o.package_count })) });
  } catch (e) { out({ kind: 'orgs', error: e.message }); }
  // every relevant package: its resources, and the datastore schema + count of each tabular one
  const relevant = [...seen.values()].filter(({ p }) => /מכרז|קרקע|תכנ|מגרש|מתחם|שיווק|יח"ד|יחידות דיור|היתר|בניי|tender|land|plan|housing/i.test(p.title + ' ' + (p.notes || '')));
  out({ kind: 'relevant', n: relevant.length, names: relevant.map(({ p }) => p.name) });
  for (const { p } of relevant.slice(0, 60)) {
    const resources = [];
    for (const res of p.resources || []) {
      const row = { id: res.id, name: trim(res.name, 90), format: res.format, ds: res.datastore_active, lm: res.last_modified, url: trim(res.url, 160) };
      if (res.datastore_active) {
        try {
          const d = await ck('datastore_search', { resource_id: res.id, limit: 2 });
          row.total = d.total; row.fields = d.fields.map((f) => f.id + ':' + f.type).slice(0, 60); row.sample = trim(d.records, 900);
        } catch (e) { row.error = trim(e.message, 120); }
      }
      resources.push(row);
    }
    out({ kind: 'package', name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified, license: p.license_title,
      notes: trim(p.notes, 400), resources });
  }
}

/* ───────────────────────── MoCH tenders (data.gov.il) ───────────────────────── */
async function moch() {
  for (const q of ['פיתוח ותשתית', 'מכרזי פיתוח ותשתית', 'אומדן', 'הצעות זוכות', 'מכרזים משרד הבינוי']) {
    try {
      const r = await ck('package_search', { q, rows: 30, fq: 'organization:ministry_of_construction_and_housing' });
      out({ kind: 'mochSearch', q, count: r.count, hits: r.results.map((p) => ({ name: p.name, title: trim(p.title, 90), resources: (p.resources || []).map((x) => ({ id: x.id, name: trim(x.name, 60), format: x.format, ds: x.datastore_active })) })) });
    } catch (e) { out({ kind: 'mochSearch', q, error: e.message }); }
  }
}

/* ───────────────────────── Planning Administration (xplan ArcGIS) ───────────────────────── */
async function xplan() {
  for (const base of [XPLAN, 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic', 'https://ags.iplan.gov.il/arcgis/rest/services']) {
    try {
      const r = await req(base + '?f=pjson');
      out({ kind: 'xplanDir', base, status: r.status, folders: r.json && r.json.folders, services: r.json && (r.json.services || []).map((s) => s.name + ':' + s.type) });
      for (const f of (r.json && r.json.folders) || []) {
        try {
          const rr = await req(`${base}/${f}?f=pjson`);
          out({ kind: 'xplanFolder', base, folder: f, services: rr.json && (rr.json.services || []).map((s) => s.name + ':' + s.type) });
        } catch (e) { out({ kind: 'xplanFolder', base, folder: f, error: e.message }); }
      }
    } catch (e) { out({ kind: 'xplanDir', base, error: e.message }); }
  }
  // the likeliest plan layers: list their layers and fields, count, and one record of a plan with housing units
  for (const svc of ['PlanningPublic/Xplan/MapServer', 'PlanningPublic/one_plan/MapServer', 'PlanningPublic/xplan_data/MapServer', 'Xplan/MapServer']) {
    try {
      const r = await req(`${XPLAN}/${svc}?f=pjson`);
      if (!r.json || r.json.error) { out({ kind: 'xplanService', svc, status: r.status, error: trim(r.json && r.json.error, 200) }); continue; }
      out({ kind: 'xplanService', svc, description: trim(r.json.serviceDescription, 300), layers: (r.json.layers || []).map((l) => l.id + ':' + l.name) });
      for (const l of (r.json.layers || []).slice(0, 12)) {
        try {
          const lr = await req(`${XPLAN}/${svc}/${l.id}?f=pjson`);
          const fields = (lr.json && lr.json.fields || []).map((f) => f.name + ':' + f.type);
          const cnt = await req(`${XPLAN}/${svc}/${l.id}/query?where=1%3D1&returnCountOnly=true&f=pjson`);
          const unitsField = fields.find((f) => /yech|unit|diur|דיור/i.test(f));
          const one = await req(`${XPLAN}/${svc}/${l.id}/query?where=${encodeURIComponent(unitsField ? unitsField.split(':')[0] + ' > 0' : '1=1')}&outFields=*&resultRecordCount=1&returnGeometry=false&f=pjson`);
          out({ kind: 'xplanLayer', svc, layer: l.id + ':' + l.name, geometry: lr.json && lr.json.geometryType, count: cnt.json && cnt.json.count, fields: fields.slice(0, 60),
            one: trim(one.json && one.json.features && one.json.features[0] && one.json.features[0].attributes, 1200) });
        } catch (e) { out({ kind: 'xplanLayer', svc, layer: l.id, error: e.message }); }
      }
    } catch (e) { out({ kind: 'xplanService', svc, error: e.message }); }
  }
}

(async () => {
  const all = has('all');
  if (has('rmi-detail')) await rmiDetails(String(argVal('rmi-detail') || '').split(',').map((x) => x.trim()).filter(Boolean).map((id) => ({ id, label: 'asked' })));
  if (all || has('rmi')) await rmi();
  if (all || has('datagov')) await datagov();
  if (all || has('moch')) await moch();
  if (all || has('xplan')) await xplan();
})().catch((e) => { console.error('discovery failed:', e.message); process.exit(1); });
