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
//   node scripts/land-discover.js --rmi-detail <id,id,…>   profiled detail + map payload of given MichrazIDs
//   node scripts/land-discover.js --rmi-full <id,id,…>     the complete detail payload (every lot, bid, parcel) of given MichrazIDs
//   node scripts/land-discover.js --rmi-codes      the public app's bundle: API paths and the code tables / labels it ships
//   node scripts/land-discover.js --rmi-tables     GeneralTablesApi/Get in full: every code table the site uses
//   node scripts/land-discover.js --datagov        data.gov.il catalogue: land / tender / planning datasets + schemas
//   node scripts/land-discover.js --datagov-profile  whole-table profiles + join checks of the resources found
//   node scripts/land-discover.js --xplan          Planning Administration ArcGIS (xplan) services and plan layers
//   node scripts/land-discover.js --xplan-plan 'a|b'  exact plan-number lookups in the blue-lines layer, every attribute
//   node scripts/land-discover.js --moch           MoCH development / infrastructure tender datasets (data.gov.il)
//   node scripts/land-discover.js --supply         data.gov.il: urban renewal, building permits, construction starts / completions,
//                                                  rental supply — every matching datastore resource profiled (fields, counts, date
//                                                  ranges, status / stage distributions), for the supply & renewal layers (13.10.2026)
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

/* the public app's bundle: every API path it calls, and the code tables it ships (status / type / purpose / region labels) */
async function rmiCodes() {
  const page = await req(RMI_SITE, { accept: 'text/html' });
  const scripts = [...page.text.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]).filter((s) => /main|chunk|app/i.test(s));
  for (const s of scripts) {
    const u = s.startsWith('http') ? s : RMI_SITE + s.replace(/^\.?\//, '');
    try {
      const js = await req(u, { accept: '*/*', timeoutMs: 90000 });
      const paths = new Set([...js.text.matchAll(/([A-Za-z]+Api\/[A-Za-z]+)/g)].map((m) => m[1]));
      out({ kind: 'rmiBundle', url: u, status: js.status, chars: js.text.length, apiPaths: [...paths].sort() });
      // Hebrew labels next to numeric codes: {id:3,name:"מפורסם"} / value:3,label:"…" / case 3: "…"
      const labels = [];
      for (const m of js.text.matchAll(/\{[^{}]{0,40}?(?:id|value|code|Kod[A-Za-z]*|key)\s*:\s*(\d{1,3})\s*,[^{}]{0,80}?(?:name|label|text|title|Teur|desc)[A-Za-z]*\s*:\s*"([^"]{2,60})"[^{}]{0,60}\}/g)) labels.push(m[1] + '=' + m[2]);
      for (const m of js.text.matchAll(/case\s+(\d{1,3})\s*:\s*(?:return\s+)?"([֐-׿][^"]{1,60})"/g)) labels.push('case ' + m[1] + '=' + m[2]);
      out({ kind: 'rmiLabels', url: u, n: labels.length, labels: [...new Set(labels)].slice(0, 400) });
      // context around the status / type / purpose keywords, so the mapping is read from the app itself
      for (const kw of ['StatusMichraz', 'KodSugMichraz', 'KodYeudMichraz', 'KodMerchav', 'StatusMichrazMurchav', 'SugTacharut', 'MechirSafType', 'KodTzuratHaknaya', 'SugMechirMufchat']) {
        const ctx = []; let i = -1, n = 0;
        while ((i = js.text.indexOf(kw, i + 1)) > -1 && n++ < 6) ctx.push(js.text.slice(Math.max(0, i - 160), i + 260).replace(/\s+/g, ' '));
        out({ kind: 'rmiKeyword', kw, n: ctx.length, ctx });
      }
      // the bundle escapes Hebrew as \uXXXX: decode, then list the literals that look like status / type names
      const dec = js.text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const he = [...new Set([...dec.matchAll(/"([֐-׿][֐-׿ \-"'/()״׳,.:]{3,60})"/g)].map((m) => m[1]))].filter((x) => /מכרז|מפורסם|בוטל|זוכ|ועד|הגרל|מחיר|דיור|בניי|מגורים|מסחר|מוקפא|נדחה|נסגר|תוצא|הקפא|פעיל|הושלם|חוזה|שומה|פיתוח|ערבות/.test(x));
      out({ kind: 'rmiHebrewLiterals', url: u, n: he.length, literals: he.slice(0, 400) });
      // where the code tables come from: every URL-ish literal (assets, json, api) and the table ids the app names
      const urls = [...new Set([...dec.matchAll(/"([^"\s]*(?:assets|\.json|\/api\/|GeneralTable|generalTable|Config|config)[^"\s]*)"/g)].map((m) => m[1]))].filter((x) => x.length < 160);
      const tableIds = [...new Set([...dec.matchAll(/(generalTable_[A-Za-z]+|codeValue_[A-Za-z]+)\s*[:=]\s*("?[\w]+"?)/g)].map((m) => m[1] + '=' + m[2]))];
      out({ kind: 'rmiAppUrls', urls: urls.slice(0, 120), tableIds: tableIds.slice(0, 80) });
      for (const cand of urls.filter((x) => /\.json$/i.test(x)).slice(0, 12)) {
        const cu = cand.startsWith('http') ? cand : RMI_SITE + cand.replace(/^\.?\//, '');
        try { const r = await req(cu); out({ kind: 'rmiAsset', url: cu, status: r.status, type: r.type, excerpt: trim(r.json || r.text, 3000) }); }
        catch (e) { out({ kind: 'rmiAsset', url: cu, error: e.message }); }
      }
      // the general-table service: the shapes an Angular service of that name would call
      for (const p of ['GeneralTableApi/Get', 'GeneralTableApi/GetAll', 'GeneralTablesApi/Get', 'TablesApi/Get', 'KodimApi/GetAll', 'SearchApi/GetGeneralTables', 'MichrazDetailsApi/GetGeneralTable', 'ConfigApi/Get', 'ConfigurationApi/Get']) {
        try { const r = await req(RMI + '/' + p, { headers: RMI_HEADERS }); if (r.status !== 404) out({ kind: 'rmiRef2', path: p, status: r.status, excerpt: trim(r.json || r.text, 2500) }); }
        catch (e) { out({ kind: 'rmiRef2', path: p, error: e.message }); }
        await sleep(400);
      }
    } catch (e) { out({ kind: 'rmiBundle', url: u, error: e.message }); }
  }
}
/* the complete payload of a few tenders (every lot, bid and parcel row), for the normalizer contract */
async function rmiFull(ids) {
  for (const id of ids) {
    try {
      const r = await req(`${RMI}/MichrazDetailsApi/Get?michrazID=${encodeURIComponent(id)}`, { headers: RMI_HEADERS });
      const j = r.json || {};
      const { MichrazDocList, Comments, MichrazFullDocument, ...rest } = j;
      out({ kind: 'rmiFull', id, status: r.status, docs: Array.isArray(MichrazDocList) ? MichrazDocList.length : null, payload: rest });
    } catch (e) { out({ kind: 'rmiFull', id, error: e.message }); }
    await sleep(800);
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

/* supply & renewal: what data.gov.il publishes on urban renewal, permits, starts, completions and rental supply —
   each tabular resource profiled over up to 5,000 rows (never dumped): fields, fill, distributions of the columns that
   look like a stage / status / year / locality, date ranges. Read-only; sequential. */
async function supply() {
  const seen = new Map();
  const queries = ['התחדשות עירונית', 'פינוי בינוי', 'פינוי-בינוי', 'תמ"א 38', 'מתחמי התחדשות', 'מתחמים מוכרזים', 'הרשות הממשלתית להתחדשות עירונית',
    'היתרי בנייה', 'היתרי בניה', 'התחלות בנייה', 'התחלות בניה', 'גמר בנייה', 'גמר בניה', 'טופס 4', 'דירות בבנייה', 'יחידות דיור בבנייה',
    'דיור להשכרה', 'דירה להשכיר', 'urban renewal', 'building permits', 'construction starts', 'housing starts', 'dwellings completed'];
  for (const q of queries) {
    try {
      const r = await ck('package_search', { q, rows: 40 });
      for (const p of r.results) if (!seen.has(p.name)) seen.set(p.name, { q, p });
      out({ kind: 'search', q, count: r.count, hits: r.results.map((p) => `${p.name} | ${trim(p.title, 70)} | ${p.organization ? p.organization.name : '-'}`) });
    } catch (e) { out({ kind: 'search', q, error: e.message }); }
    await sleep(250);
  }
  try {
    const orgs = await ck('organization_list', { all_fields: true, limit: 1000 });
    out({ kind: 'orgs', matches: orgs.filter((o) => /התחדשות|renewal|בינוי|שיכון|תכנון|planning|הלשכה המרכזית|cbs|statistic/i.test(o.title + ' ' + o.name)).map((o) => ({ name: o.name, title: o.title, n: o.package_count })) });
  } catch (e) { out({ kind: 'orgs', error: e.message }); }
  const relevant = [...seen.values()].filter(({ p }) => /התחדש|פינוי|בינוי|תמ"?א|היתר|התחל|גמר|טופס|בניי|בניה|השכר|renewal|permit|construction|start|complet|rent/i.test(p.title + ' ' + (p.notes || '')));
  out({ kind: 'relevant', n: relevant.length, names: relevant.map(({ p }) => p.name) });
  const stageLike = (k) => /סטטוס|status|שלב|stage|מצב|סוג|type|שנה|year|ישוב|יישוב|city|locality|מחוז|district|מסלול|track/i.test(k);
  for (const { p } of relevant.slice(0, 40)) {
    const resources = [];
    for (const res of p.resources || []) {
      const row = { id: res.id, name: trim(res.name, 90), format: res.format, ds: res.datastore_active, lm: res.last_modified, created: res.created, url: trim(res.url, 160) };
      if (res.datastore_active) {
        try {
          const d = await ck('datastore_search', { resource_id: res.id, limit: 5000 });
          row.total = d.total; row.fields = d.fields.map((f) => f.id + ':' + f.type).slice(0, 80);
          row.profile = profile(d.records, 80);
          row.dist = Object.fromEntries(d.fields.map((f) => f.id).filter(stageLike).slice(0, 12).map((k) => [k, dist(d.records, k, 15)]));
          row.dates = Object.fromEntries(d.fields.filter((f) => /date|timestamp/i.test(f.type) || /תאריך|date/i.test(f.id)).slice(0, 6).map((f) => [f.id, dateRange(d.records, f.id)]));
          row.sample = trim(d.records.slice(0, 2), 900);
        } catch (e) { row.error = trim(e.message, 160); }
        await sleep(250);
      }
      resources.push(row);
    }
    out({ kind: 'package', name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified, frequency: p.frequency || null,
      notes: trim(p.notes, 500), resources });
  }
}

/* whole-table profile of the datastore resources the vertical would depend on: fill rates, code / status
   distributions, year ranges, join-key coverage between the MoCH tender table and its bids table */
const LT_RESOURCES = {
  planningInventory: '99aad98f-2b54-4eea-834d-650b56389bf3',   // רמ"י · מלאי תכנוני למגורים
  mochTenders: '04e375ef-08a6-4327-8044-7bd595c4d106',         // משרד הבינוי · תוצאות מכרזי פיתוח ותשתית
  mochBids: '722aebc6-5541-46fa-abcf-15b06e02c70c',            // משרד הבינוי · סכומי ההצעות
  mochDevCosts: 'bf164a03-55c7-4bea-8740-66ce60a51a2c',        // משרד הבינוי · עלויות פיתוח בבניה העירונית
  mochProgress: '1ec45809-5927-430a-9b30-77f77f528ce3',        // משרד הבינוי · דיווחי התקדמות הבניה - בניה רוויה
};
async function allRows(id) {
  const rows = []; let offset = 0;
  for (;;) {
    const r = await ck('datastore_search', { resource_id: id, limit: 2000, offset });
    rows.push(...r.records); offset += r.records.length;
    if (!r.records.length || offset >= r.total) return { rows, total: r.total, fields: r.fields };
  }
}
async function datagovProfile() {
  const got = {};
  for (const [name, id] of Object.entries(LT_RESOURCES)) {
    try {
      const { rows, total, fields } = await allRows(id);
      got[name] = rows;
      const meta = await ck('resource_show', { id });
      const o = { kind: 'ltProfile', name, id, total, read: rows.length, lastModified: meta.last_modified, fields: fields.map((f) => f.id + ':' + f.type), profile: profile(rows, 40) };
      if (name === 'planningInventory') Object.assign(o, { stage: dist(rows, 'שלב תכנוני'), initiator: dist(rows, 'יזם תכנון', 15),
        approvalYear: dist(rows.map((r) => ({ y: String(r['תאריך פרסום לאישור ברשומות'] || '').slice(0, 4) })), 'y', 30),
        depositYear: dist(rows.map((r) => ({ y: String(r['תאריך פרסום להפקדה ברשומות'] || '').slice(0, 4) })), 'y', 30),
        unitsTotal: rows.reduce((a, r) => a + (Number(r['יחד פוטנציאל לשיווק']) || 0), 0),
        topCities: Object.entries(rows.reduce((a, r) => { const k = r['יישוב']; a[k] = (a[k] || 0) + (Number(r['יחד פוטנציאל לשיווק']) || 0); return a; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 15),
        planNumberShapes: dist(rows.map((r) => ({ s: String(r['מספר תוכנית'] || '').replace(/\d+/g, '#') })), 's', 15), sample: rows.slice(0, 3) });
      if (name === 'mochTenders') Object.assign(o, { withTenderId: rows.filter((r) => String(r.TenderID || '').trim()).length, year: dist(rows, 'TenderYear', 20),
        descriptions: dist(rows.map((r) => ({ d: String(r.TenderDescription || '').split(/[\s-]/)[0] })), 'd', 25), proposals: dist(rows, 'ProposalsNumber', 12),
        decisionRange: dateRange(rows, 'DecisionDate'), publishRange: dateRange(rows, 'PublishDate'), omdanTotal: rows.reduce((a, r) => a + (Number(r.OMDAN) || 0), 0), sample: rows.slice(0, 3) });
      if (name === 'mochBids') Object.assign(o, { status: dist(rows, 'ProposalStatus', 12), withProvider: rows.filter((r) => String(r.ProviderName || '').trim()).length,
        distinctTenders: new Set(rows.map((r) => r.TenderID)).size, sample: rows.slice(0, 3) });
      if (name === 'mochDevCosts') Object.assign(o, { status: dist(rows, 'StatusDescription', 20), districts: dist(rows, 'MahozName', 10), unitsTotal: rows.reduce((a, r) => a + (Number(r.LivingUnits) || 0), 0),
        tenderIndexYears: dist(rows.map((r) => ({ y: String(r.TenderIndexDate || '').slice(-4) })), 'y', 25), sample: rows.slice(0, 3) });
      if (name === 'mochProgress') Object.assign(o, { marketing: dist(rows, 'SHITAT_SHIVUK', 15), contractYear: dist(rows, 'SHNAT_HOZE', 25), districts: dist(rows, 'MAHOZ', 10),
        withGush: rows.filter((r) => String(r.GUSH || '').trim() && r.GUSH !== '0').length, unitsTotal: rows.reduce((a, r) => a + (Number(r.YEHIDOT_BINYAN) || 0), 0),
        stageFilled: Object.fromEntries(Object.keys(rows[0] || {}).filter((k) => /TAARICH_SHLAV/.test(k)).map((k) => [k, rows.filter((r) => String(r[k] || '').trim()).length])), sample: rows.slice(0, 3) });
      out(o);
    } catch (e) { out({ kind: 'ltProfile', name, id, error: e.message }); }
  }
  // the MoCH tender ↔ bids join: by TenderID when filled, and whether the bids table's TenderID matches the _id or TenderNumber instead
  if (got.mochTenders && got.mochBids) {
    const bidIds = new Set(got.mochBids.map((r) => String(r.TenderID)));
    const byTenderId = got.mochTenders.filter((r) => bidIds.has(String(r.TenderID))).length;
    const byRowId = got.mochTenders.filter((r) => bidIds.has(String(r._id))).length;
    const byNumber = got.mochTenders.filter((r) => bidIds.has(String(r.TenderNumber))).length;
    out({ kind: 'ltJoin', tenders: got.mochTenders.length, bidTenders: bidIds.size, joinByTenderID: byTenderId, joinByRowId: byRowId, joinByTenderNumber: byNumber,
      bidIdRange: [...bidIds].map(Number).filter(Number.isFinite).sort((a, b) => a - b).filter((_, i, a) => i === 0 || i === a.length - 1) });
  }
  // MoCH sites ↔ construction progress ↔ dev costs: shared site codes
  if (got.mochDevCosts && got.mochProgress) {
    const atar = new Set(got.mochDevCosts.map((r) => `${r.LamasCode}|${r.AtarCode}`));
    out({ kind: 'ltJoin2', devCostSites: atar.size, progressRowsWithAtarName: got.mochProgress.filter((r) => String(r.ATAR || '').trim()).length,
      progressMithamSample: got.mochProgress.slice(0, 5).map((r) => [r.YESHUV_LAMAS, r.ATAR, r.MISPAR_MITHAM, r.SHEM_MITHAM, r.MIGRASH, r.GUSH, r.HELKA, r.SHITAT_SHIVUK, r.SHNAT_HOZE]) });
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

/* ───────────────────────── urban renewal × xplan (read-only) ─────────────────────────
   Every plan number the MoCH renewal complexes print, looked up EXACTLY in the xplan blue-lines layer: how many exist,
   duplicates per number, whether the Mavat id in MoCH's site link equals the layer's ids, the status / station vocabulary,
   field aliases and the geometry size. Diagnostics for misses (a LIKE on the number's core) are printed, never joined. */
async function renewalXplan() {
  const L = `${XPLAN}/PlanningPublic/Xplan/MapServer/1`;
  const rows = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'data', 'renewal', 'complexes.json'), 'utf8'));
  try { const r = await req(`${L}?f=pjson`, { timeoutMs: 60000 }); out({ kind: 'layerMeta', geometry: r.json.geometryType, maxRecordCount: r.json.maxRecordCount, sr: r.json.extent && r.json.extent.spatialReference,
    fields: (r.json.fields || []).map((f) => [f.name, f.alias, f.type, f.domain ? trim(f.domain, 300) : null]), capabilities: r.json.capabilities, advanced: trim(r.json.advancedQueryCapabilities, 400) }); }
  catch (e) { out({ kind: 'layerMeta', error: e.message }); }
  for (const g of ['station_desc', 'internet_short_status', 'entity_subtype_desc', 'station_desc,internet_short_status']) {
    try {
      const stats = encodeURIComponent(JSON.stringify([{ statisticType: 'count', onStatisticField: 'pl_id', outStatisticFieldName: 'n' }]));
      const r = await req(`${L}/query?where=1%3D1&groupByFieldsForStatistics=${encodeURIComponent(g)}&outStatistics=${stats}&f=pjson`, { timeoutMs: 90000 });
      out({ kind: 'vocabulary', by: g, error: r.json && r.json.error, values: (r.json && r.json.features || []).map((f) => f.attributes).sort((a, b) => b.n - a.n).slice(0, 80) });
    } catch (e) { out({ kind: 'vocabulary', by: g, error: e.message }); }
  }
  const withPlan = rows.filter((r) => r.planNumber);
  const mavatId = (r) => { const m = r.links && r.links.site && /mavat\.iplan\.gov\.il\/SV\d\/\d+\/(\d+)\//.exec(r.links.site); return m ? Number(m[1]) : null; };
  const found = new Map(); let asked = 0, failed = 0;
  for (let i = 0; i < withPlan.length; i += 25) {
    const slice = withPlan.slice(i, i + 25).map((r) => r.planNumber);
    const where = 'pl_number IN (' + slice.map((n) => `'${n.replace(/'/g, "''")}'`).join(',') + ')';
    try {
      const r = await req(`${L}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&f=pjson`, { timeoutMs: 90000 });
      if (r.json && r.json.error) throw new Error(trim(r.json.error, 200));
      for (const f of (r.json && r.json.features) || []) { const k = f.attributes.pl_number; if (!found.has(k)) found.set(k, []); found.get(k).push(f.attributes); }
      asked += slice.length;
    } catch (e) { failed++; out({ kind: 'batchError', i, error: e.message }); }
  }
  const hits = withPlan.filter((r) => found.has(r.planNumber)), misses = withPlan.filter((r) => !found.has(r.planNumber));
  const dup = [...found].filter(([, v]) => v.length > 1);
  const idAgree = { plId: 0, mpId: 0, urlId: 0, none: 0, noLink: 0 };
  for (const r of hits) { const id = mavatId(r), a = found.get(r.planNumber)[0]; if (!id) { idAgree.noLink++; continue; }
    const urlId = a.pl_url && /SV\d\/\d+\/(\d+)/.exec(a.pl_url); if (a.pl_id === id) idAgree.plId++; else if (a.mp_id === id) idAgree.mpId++; else if (urlId && Number(urlId[1]) === id) idAgree.urlId++; else idAgree.none++; }
  out({ kind: 'exactSummary', complexes: rows.length, withPlan: withPlan.length, asked, failedBatches: failed, hits: hits.length, misses: misses.length, numbersWithSeveralFeatures: dup.length,
    severalExamples: dup.slice(0, 5).map(([k, v]) => ({ k, rows: v.map((a) => ({ pl_id: a.pl_id, mp_id: a.mp_id, station: a.station_desc, status: a.internet_short_status, units: a.pq_authorised_quantity_120, upd: a.last_update_date })) })), idAgree });
  const disagree = hits.filter((r) => { const id = mavatId(r), a = found.get(r.planNumber)[0]; const u = a.pl_url && /SV\d\/\d+\/(\d+)/.exec(a.pl_url); return id && a.pl_id !== id && a.mp_id !== id && !(u && Number(u[1]) === id); });
  out({ kind: 'idDisagree', n: disagree.length, ex: disagree.slice(0, 8).map((r) => ({ c: r.complexId, plan: r.planNumber, link: r.links.site, xp: found.get(r.planNumber).map((a) => [a.pl_id, a.mp_id, a.pl_url]) })) });
  const allHit = [].concat(...[...found.values()]);
  out({ kind: 'hitProfile', profile: profile(allHit, 120), station: dist(allHit, 'station_desc', 40), status: dist(allHit, 'internet_short_status', 40), subtype: dist(allHit, 'entity_subtype_desc', 20) });
  for (const fmt of [/^\d{3}-\d{7}$/, /^[\u0590-\u05FF]+\/\d+$/, /\//]) { const r = hits.find((x) => fmt.test(x.planNumber)); if (r) out({ kind: 'hitExample', complex: r.complexId, moch: { plan: r.planNumber, units: [r.existingUnits, r.additionalUnits, r.proposedUnits], approvalYear: r.approvalYear, link: r.links.site }, xplan: found.get(r.planNumber) }); }
  out({ kind: 'missList', n: misses.length, sample: misses.slice(0, 60).map((r) => [r.complexId, r.planNumber, mavatId(r), r.city]) });
  for (const r of misses.slice(0, 25)) {
    const core = (r.planNumber.match(/\d{3,}/g) || []).sort((a, b) => b.length - a.length)[0];
    const id = mavatId(r); const q = [];
    if (core) q.push(['like', `pl_number LIKE '%${core}%'`]);
    if (id) q.push(['byId', `pl_id = ${id} OR mp_id = ${id}`]);
    for (const [label, where] of q) {
      try { const x = await req(`${L}/query?where=${encodeURIComponent(where)}&outFields=pl_number,pl_id,mp_id,pl_name,jurstiction_area_name,station_desc&returnGeometry=false&resultRecordCount=6&f=pjson`, { timeoutMs: 60000 });
        out({ kind: 'missDiag', complex: r.complexId, plan: r.planNumber, city: r.city, label, rows: ((x.json && x.json.features) || []).map((f) => f.attributes), error: x.json && x.json.error }); }
      catch (e) { out({ kind: 'missDiag', complex: r.complexId, label, error: e.message }); }
    }
  }
  for (const r of hits.slice(0, 3)) {
    try { const x = await req(`${L}/query?where=${encodeURIComponent(`pl_number='${r.planNumber.replace(/'/g, "''")}'`)}&outFields=pl_number&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00005&geometryPrecision=5&f=pjson`, { timeoutMs: 60000 });
      const g = x.json && x.json.features && x.json.features[0] && x.json.features[0].geometry; out({ kind: 'geometry', plan: r.planNumber, rings: g && g.rings ? g.rings.length : null, points: g && g.rings ? g.rings.reduce((s, ring) => s + ring.length, 0) : null, bytes: g ? JSON.stringify(g).length : null, sr: x.json && x.json.spatialReference }); }
    catch (e) { out({ kind: 'geometry', plan: r.planNumber, error: e.message }); }
  }
  try { const t0 = Date.now(); const x = await req(`${L}/query?where=1%3D1&returnCountOnly=true&f=pjson`, { timeoutMs: 60000 }); out({ kind: 'layerCount', count: x.json && x.json.count, ms: Date.now() - t0 }); } catch (e) { out({ kind: 'layerCount', error: e.message }); }
  try { const x = await req(`${XPLAN}/PlanningPublic/Xplan/MapServer?f=pjson`, { timeoutMs: 60000 }); out({ kind: 'service', layers: (x.json.layers || []).map((l) => l.id + ':' + l.name), tables: (x.json.tables || []).map((l) => l.id + ':' + l.name) }); } catch (e) { out({ kind: 'service', error: e.message }); }
}

(async () => {
  const all = has('all');
  if (has('renewal-xplan')) await renewalXplan();
  if (has('rmi-codes')) await rmiCodes();
  if (has('xplan-plan')) {
    // exact plan-number lookups in the blue-lines layer, with every attribute (so the quantity codes can be read off known plans)
    const nums = String(argVal('xplan-plan') || '').split('|').map((x) => x.trim()).filter(Boolean);
    for (const n of nums) {
      for (const [label, where] of [['exact', `pl_number='${n.replace(/'/g, "''")}'`], ['like', `pl_number LIKE '%${n.replace(/'/g, "''").replace(/^[^\/]*\//, '')}%'`]]) {
        try {
          const r = await req(`${XPLAN}/PlanningPublic/Xplan/MapServer/1/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&resultRecordCount=5&f=pjson`, { timeoutMs: 60000 });
          const feats = (r.json && r.json.features) || [];
          out({ kind: 'xplanPlan', plan: n, label, status: r.status, n: feats.length, rows: feats.map((f) => f.attributes), error: r.json && r.json.error });
        } catch (e) { out({ kind: 'xplanPlan', plan: n, label, error: e.message }); }
        if (label === 'exact') { /* the like-search only when exact found nothing */ }
      }
    }
    // the Mavat quantity code glossary, if the layer's metadata carries field aliases / domains
    try { const r = await req(`${XPLAN}/PlanningPublic/Xplan/MapServer/1?f=pjson`); out({ kind: 'xplanLayerMeta', fields: (r.json.fields || []).map((f) => [f.name, f.alias, f.domain ? trim(f.domain, 200) : null]), description: trim(r.json.description, 600) }); }
    catch (e) { out({ kind: 'xplanLayerMeta', error: e.message }); }
  }
  if (has('rmi-tables')) { const r = await req(RMI + '/GeneralTablesApi/Get', { headers: RMI_HEADERS }); const rows = Array.isArray(r.json) ? r.json : [];
    const by = {}; for (const x of rows) (by[x.TableID + ' ' + x.TableName] = by[x.TableID + ' ' + x.TableName] || []).push([x.Code, x.Value, x.MichrazPail, x.Status, x.Group]);
    out({ kind: 'rmiTables', status: r.status, n: rows.length, tables: by }); }
  if (has('datagov-profile')) await datagovProfile();
  if (has('supply')) await supply();
  if (has('rmi-full')) await rmiFull(String(argVal('rmi-full') || '').split(',').map((x) => x.trim()).filter(Boolean));
  if (has('rmi-detail')) await rmiDetails(String(argVal('rmi-detail') || '').split(',').map((x) => x.trim()).filter(Boolean).map((id) => ({ id, label: 'asked' })));
  if (all || has('rmi')) await rmi();
  if (all || has('datagov')) await datagov();
  if (all || has('moch')) await moch();
  if (all || has('xplan')) await xplan();
})().catch((e) => { console.error('discovery failed:', e.message); process.exit(1); });
