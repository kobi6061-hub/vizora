#!/usr/bin/env node
// PROPX · SOURCE UNIVERSE DISCOVERY (21.10.2026, the master data directive) — read-only evidence for every official catalogue PROPX can reach.
//
// Runs on a GitHub runner (Israeli hosts answer there, not from the Claude sandbox). GET only (+ the ArcGIS query the iplan layers accept
// as GET), one request at a time with a 1-second spacing, bounded timeouts, no credentials, no CAPTCHA or access-control circumvention: a
// refused / challenged / keyed endpoint is RECORDED as such and never retried around. Each mode writes its raw evidence (HTTP status, content
// type, schema, counts, newest observation, licence, timings) to OUT_DIR/<mode>.json.gz; the consolidated catalogue
// (lib/trust/discovery/2026-10-21-source-universe.json) is built from these files by scripts/source-universe-build.js.
//
//   --ckan     data.gov.il: every organization and EVERY package of the catalogue (package_search paged to its count), slim metadata;
//              relevant resources (keyword / publisher score) probed through datastore_search: total rows, fields, newest date value
//   --gov      gov.il API reference page, the Tax Authority real-estate service page, the GovMap API documentation (links + headings)
//   --iplan    ags.iplan.gov.il: every folder, service and layer of the public ArcGIS directory + feature counts (PlanningPublic first)
//   --cbs      CBS: the API documentation page, the time-series catalogue (subjects), the price-index catalogue, the dictionary API
//   --boi      Bank of Israel: the SDMX structure (every dataflow), housing / mortgage / credit / rate flows sampled for their latest period
//   --mot      Ministry of Transport GTFS file (HEAD: size, last-modified) + the national public-transport stops in it are NOT downloaded
//   --muni     municipal open-data portals (CKAN on datacity / city hosts) and ArcGIS roots of the largest municipalities
//   --other    other public-sector GIS / API roots (Survey of Israel, environment, meteorology, geology, water, education, health …)
//   --verify   settle the catalogue's PENDING entries: file resources by two ranged GETs (magic bytes + ZIP central directory — never the
//              whole file), unprobed datastore resources counted, municipal packages' metadata + first rows, iplan / Ashdod layer fields, GTFS list

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const UA = 'PROPX-source-discovery/1.0 (+https://github.com/kobi6061-hub/vizora; read-only official open-data audit)';
const OUT_DIR = process.env.OUT_DIR || 'lib/trust/discovery/2026-10-21-universe';
const TIMEOUT = 60000, SPACING = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trim = (v, n = 400) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
let calls = 0;

async function req(url, opt = {}) {
  const t0 = Date.now(); calls++;
  try {
    const r = await fetch(url, { method: opt.method || 'GET', redirect: 'follow', headers: { 'User-Agent': UA, Accept: opt.accept || 'application/json, text/html;q=0.8, */*;q=0.5', ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || TIMEOUT) });
    const type = r.headers.get('content-type') || '';
    const text = opt.method === 'HEAD' ? '' : await r.text();
    let json = null; if (/json/.test(type) || /^\s*[[{]/.test(text.slice(0, 2))) { try { json = JSON.parse(text); } catch { json = null; } }
    await sleep(SPACING);
    return { url, status: r.status, type, finalUrl: r.url !== url ? r.url : undefined, bytes: Buffer.byteLength(text), ms: Date.now() - t0, json, text,
      lastModified: r.headers.get('last-modified') || null, length: r.headers.get('content-length') || null, server: r.headers.get('server') || null,
      challenge: /captcha|cf-chl|challenge-platform|Request unsuccessful|Incapsula|_Incapsula_Resource|access denied/i.test(text.slice(0, 5000)) || undefined };
  } catch (e) {
    await sleep(SPACING);
    return { url, status: 0, error: e.name === 'TimeoutError' ? 'timeout' : String((e.cause && e.cause.code) || e.message).slice(0, 120), ms: Date.now() - t0 };
  }
}
const ev = (r, extra = {}) => ({ url: r.url, status: r.status, type: r.type, bytes: r.bytes, ms: r.ms, finalUrl: r.finalUrl, error: r.error, lastModified: r.lastModified, challenge: r.challenge, ...extra });
function save(mode, obj) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const f = path.join(OUT_DIR, mode + '.json.gz');
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify({ mode, at: new Date().toISOString(), calls, ...obj })));
  console.log(`${mode}: wrote ${f} · ${calls} requests`);
}
const linksOf = (html, base) => { const out = new Set(); for (const m of String(html || '').matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) { try { out.add(new URL(m[1], base).href); } catch { /* skip */ } } return [...out]; };
const headingsOf = (html) => [...String(html || '').matchAll(/<(h[1-4]|title)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 120);

/* ── relevance: the real-estate data universe of the directive (§6), Hebrew + English ── */
const KW = ['נדל"ן', 'נדלן', 'דיור', 'דירה', 'דירות', 'משכנת', 'שכר דירה', 'שכירות', 'מחיר למשתכן', 'דירה בהנחה', 'מחיר מטרה', 'עסקאות', 'מקרקעין', 'קרקע', 'מכרז', 'הגרל',
  'בנייה', 'בניה', 'היתר', 'קבלן', 'התחדשות', 'פינוי', 'תמ"א', 'תכנון', 'תכנית', 'תוכנית', 'תב"ע', 'ייעוד', 'שימושי קרקע', 'מבנה', 'מבנים', 'בניין', 'כתובת', 'רחוב', 'רחובות', 'שכונ',
  'יישוב', 'ישוב', 'אזור סטטיסטי', 'אזורים סטטיסטיים', 'גבול', 'גוש', 'חלקה', 'קדסטר', 'מיפוי', 'תחבורה', 'רכבת', 'מטרו', 'תחנ', 'אוטובוס', 'כביש', 'נתיב', 'חינוך', 'בית ספר',
  'בתי ספר', 'גני ילדים', 'גן ילדים', 'מוסדות', 'בריאות', 'מרפא', 'בית חולים', 'בתי חולים', 'פארק', 'שטחים פתוחים', 'סביבה', 'רעש', 'זיהום', 'הצפ', 'ניקוז', 'נחל', 'ביוב', 'חשמל',
  'גז', 'קרינה', 'אנטנ', 'אזור תעשייה', 'תעשי', 'מסחר', 'ארנונה', 'אוכלוסי', 'תושבים', 'מפקד', 'למ"ס', 'חברתי-כלכלי', 'אשכול', 'הכנסה', 'ריבית', 'אשראי', 'מדד', 'מחירי',
  'תשומות', 'שימור', 'מורשת', 'עתיקות', 'רעידות אדמה', 'סייסמ', 'חיזוק', 'מקלט', 'ממ"ד', 'חני', 'שטחי ציבור', 'מוסדות ציבור', 'רשות מקומית', 'רשויות מקומיות', 'מועצה',
  'real estate', 'housing', 'dwelling', 'mortgage', 'rent', 'land', 'tender', 'construction', 'building', 'permit', 'planning', 'zoning', 'address', 'street', 'neighborhood',
  'neighbourhood', 'locality', 'statistical area', 'boundar', 'parcel', 'cadast', 'transport', 'rail', 'metro', 'station', 'bus', 'gtfs', 'road', 'school', 'education',
  'kindergarten', 'health', 'clinic', 'hospital', 'park', 'environment', 'noise', 'flood', 'drainage', 'population', 'census', 'socio', 'income', 'interest', 'credit', 'index',
  'price', 'preservation', 'heritage', 'earthquake', 'shelter', 'parking', 'municipal', 'gis'];
const RELEVANT_ORGS = /moch|binui|shikun|rmi|ila|mmi|iplan|planning|cbs|lamas|population|piba|mot|transport|netivei|moin|interior|education|edu|health|sviva|environment|mapi|survey|digital|labor|economy|energy|water|gsi|geolog|ims|meteo|rail|fire|tax|justice|ica|beer-sheva|haifa|jerusalem|tel-aviv|municipal/i;
function score(p) {
  const T = (p.title || '') + ' ' + (p.name || ''), G = (p.tags || []).join(' '), N = (p.notes || '') + ' ' + (p.resources || []).map((r) => r.name || '').join(' ');
  let s = 0; const hits = new Set();
  for (const k of KW) { const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); if (re.test(T)) { s += 3; hits.add(k); } else if (re.test(G)) { s += 2; hits.add(k); } else if (re.test(N)) { s += 1; hits.add(k); } }
  if (RELEVANT_ORGS.test(p.org || '')) s += 2;
  return { score: s, hits: [...hits].slice(0, 12) };
}

/* ── data.gov.il: the whole CKAN catalogue ── */
async function ckanCatalogue(base, label, probeLimit) {
  const api = base.replace(/\/$/, '') + '/api/3/action/';
  const status = await req(api + 'status_show');
  const orgsR = await req(api + 'organization_list?all_fields=true&include_dataset_count=true&limit=1000');
  const orgs = orgsR.json && orgsR.json.success ? orgsR.json.result.map((o) => ({ name: o.name, title: o.title || o.display_name, packages: o.package_count })) : null;
  const packages = []; let count = null, start = 0, pages = [];
  for (;;) {
    const r = await req(api + 'package_search?' + new URLSearchParams({ rows: '1000', start: String(start), sort: 'name asc' }), { timeout: 180000 });
    pages.push(ev(r));
    if (!r.json || !r.json.success) break;
    count = r.json.result.count;
    for (const p of r.json.result.results) packages.push({ id: p.id, name: p.name, title: p.title, org: p.organization && p.organization.name, orgTitle: p.organization && p.organization.title,
      license: p.license_id || null, licenseTitle: p.license_title || null, modified: p.metadata_modified, created: p.metadata_created, notes: trim(p.notes || '', 500),
      tags: (p.tags || []).map((t) => t.name), groups: (p.groups || []).map((g) => g.name), frequency: (p.extras || []).find((x) => /freq|update/i.test(x.key))?.value || null,
      resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, format: x.format, datastore: !!x.datastore_active, modified: x.last_modified || x.metadata_modified || x.created, size: x.size || null,
        host: (() => { try { return new URL(x.url).host; } catch { return null; } })() })) });
    start += 1000;
    if (start >= count || r.json.result.results.length === 0) break;
  }
  for (const p of packages) Object.assign(p, score(p));
  /* datastore probes of the relevant resources: total rows, fields, the newest value of the first date-like field */
  const rel = packages.filter((p) => p.score >= 4).sort((a, b) => b.score - a.score);
  const probes = [];
  for (const p of rel) for (const x of p.resources.filter((y) => y.datastore)) {
    if (probes.length >= probeLimit) break;
    const r = await req(api + 'datastore_search?' + new URLSearchParams({ resource_id: x.id, limit: '1' }));
    const res = r.json && r.json.success ? r.json.result : null;
    const fields = res ? res.fields.filter((f) => f.id !== '_id').map((f) => f.id + ':' + f.type) : null;
    const pr = { pkg: p.name, resource: x.id, rname: x.name, status: r.status, total: res ? res.total : null, fields, sample: res && res.records[0] ? trim(res.records[0], 600) : null, ms: r.ms, error: r.error || (!res && r.json ? trim(r.json.error, 200) : undefined) };
    const df = res && res.fields.find((f) => f.id !== '_id' && (/timestamp|date/.test(f.type) || /date|תאריך|updated|עדכון|year|שנה|month|חודש|period|תקופה/i.test(f.id)));
    if (df) {
      const s = await req(api + 'datastore_search?' + new URLSearchParams({ resource_id: x.id, limit: '1', sort: `"${df.id}" desc`, fields: df.id }));
      pr.newest = { field: df.id, value: s.json && s.json.success && s.json.result.records[0] ? s.json.result.records[0][df.id] : null, status: s.status };
    }
    probes.push(pr);
  }
  return { label, base, status: ev(status, { ok: !!(status.json && status.json.success), ckan: status.json && status.json.result && status.json.result.ckan_version }), orgs, count, fetched: packages.length, pages, packages, probes };
}

async function modeCkan() {
  const dg = await ckanCatalogue('https://data.gov.il', 'data.gov.il', 450);
  save('ckan', { datagov: dg });
}

async function modeGov() {
  const pages = [
    ['gov.il API reference', 'https://www.gov.il/he/pages/apinew'],
    ['Tax Authority real-estate information service', 'https://www.gov.il/he/service/real_estate_information'],
    ['GovMap API documentation', 'https://www.govmap.gov.il/sites/api/index.html'],
    ['GovMap API (EN)', 'https://api.govmap.gov.il/'],
    ['GovMap developers', 'https://www.govmap.gov.il/?c=0,0&z=0&b=1&lay=&api=1'],
    ['Survey of Israel open data', 'https://www.gov.il/he/departments/topics/mapi_open_data'],
    ['nadlan.gov.il', 'https://www.nadlan.gov.il/'],
    ['Tax Authority real-estate info site', 'https://www.misim.gov.il/svinfonadlan2010/'],
    ['CBS API page', 'https://www.cbs.gov.il/he/cbsNewBrand/Pages/%D7%9E%D7%9E%D7%A9%D7%A7-API.aspx'],
    ['BOI statistics', 'https://www.boi.org.il/roles/statistics/'],
    ['BOI API guide', 'https://www.boi.org.il/information/bank-paymnts/guide/api-guide/'],
    ['Government Authority for Urban Renewal', 'https://www.gov.il/he/departments/urban_renewal_authority/govil-landing-page'],
    ['Israel Land Authority tenders', 'https://apps.land.gov.il/MichrazimSite/'],
    ['MoT open data', 'https://www.gov.il/he/departments/topics/data_transportation/govil-landing-page'],
  ];
  const out = [];
  for (const [label, url] of pages) {
    const r = await req(url, { accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8' });
    const links = r.text ? linksOf(r.text, r.finalUrl || url) : [];
    out.push(ev(r, { label, headings: headingsOf(r.text), apiLinks: links.filter((l) => /api|swagger|openapi|sdmx|arcgis|rest|json|wfs|wms|data\.gov|gtfs|download|csv|xlsx|zip/i.test(l)).slice(0, 150), linkCount: links.length, textSample: r.text ? r.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000) : null }));
  }
  /* GovMap API: the documented JS API needs a token issued to a registered site — probe the public endpoints the documentation names */
  for (const [label, url] of [['GovMap API JS', 'https://www.govmap.gov.il/govmap/api/govmap.api.js'], ['GovMap layers catalog', 'https://www.govmap.gov.il/api/layers-catalog/catalog'],
    ['GovMap search', 'https://ags.govmap.gov.il/Search/FreeSearch'], ['GovMap geocode', 'https://es.govmap.gov.il/TldSearch/api/DetailsByQuery?query=%D7%94%D7%A8%D7%A6%D7%9C&lyrs=1&gid=govmap']]) {
    const r = await req(url);
    out.push(ev(r, { label, textSample: r.text ? r.text.slice(0, 600) : null }));
  }
  save('gov', { pages: out });
}

async function arcgisDir(root, label, maxLayers) {
  const services = [], layers = [];
  const rootR = await req(root + '?f=json');
  const folders = rootR.json ? rootR.json.folders || [] : [];
  const svcList = rootR.json ? (rootR.json.services || []).map((s) => ({ ...s, folder: '' })) : [];
  for (const f of folders) { const r = await req(root + '/' + encodeURIComponent(f) + '?f=json'); services.push(ev(r, { folder: f, services: r.json ? (r.json.services || []).length : null })); if (r.json) for (const s of r.json.services || []) svcList.push({ ...s, folder: f }); }
  const probed = [];
  for (const s of svcList) {
    if (!/MapServer|FeatureServer/.test(s.type)) { probed.push({ name: s.name, type: s.type }); continue; }
    const url = root + '/' + s.name + '/' + s.type;
    const r = await req(url + '?f=json');
    const ls = r.json ? [...(r.json.layers || []), ...(r.json.tables || [])] : [];
    probed.push(ev(r, { name: s.name, type: s.type, folder: s.folder, description: trim((r.json && (r.json.serviceDescription || r.json.description)) || '', 300), copyright: r.json && r.json.copyrightText || null, layers: ls.map((l) => ({ id: l.id, name: l.name, geometryType: l.geometryType || null })) }));
    for (const l of ls) {
      if (layers.length >= maxLayers) break;
      if (l.subLayerIds && l.subLayerIds.length) continue;
      const c = await req(url + '/' + l.id + '/query?' + new URLSearchParams({ where: '1=1', returnCountOnly: 'true', f: 'json' }));
      layers.push({ service: s.name, id: l.id, name: l.name, status: c.status, count: c.json && typeof c.json.count === 'number' ? c.json.count : null, error: c.error || (c.json && c.json.error ? trim(c.json.error, 160) : undefined) });
    }
  }
  return { label, root, rootStatus: ev(rootR, { folders, services: (rootR.json && rootR.json.services || []).length }), folderReads: services, services: probed, layers };
}

async function modeIplan() {
  const ip = await arcgisDir('https://ags.iplan.gov.il/arcgisiplan/rest/services', 'iplan', 400);
  save('iplan', { iplan: ip });
}

async function modeCbs() {
  const out = [];
  for (const [label, url] of [
    ['series catalogue · subjects', 'https://apis.cbs.gov.il/series/catalog/level?id=1&format=json&download=false'],
    ['series catalogue · subject 44 construction & real estate', 'https://apis.cbs.gov.il/series/catalog/level?id=2&subject=44&format=json&download=false'],
    ['series catalogue · subject 40 prices', 'https://apis.cbs.gov.il/series/catalog/level?id=2&subject=40&format=json&download=false'],
    ['price index · chapters', 'https://api.cbs.gov.il/index/catalog/catalog?format=json&download=false'],
    ['price index · housing chapter list', 'https://api.cbs.gov.il/index/catalog/chapter?id=aa&format=json&download=false'],
    ['dictionary · root', 'https://api.cbs.gov.il/dictionary/'],
    ['dictionary · subjects', 'https://api.cbs.gov.il/dictionary/subjects?format=json'],
    ['dictionary · geography localities (he)', 'https://api.cbs.gov.il/dictionary/he/geo/localities?format=json'],
    ['dictionary · geography statistical areas (he)', 'https://api.cbs.gov.il/dictionary/he/geo/statisticalareas?format=json'],
    ['dictionary · geography (en)', 'https://api.cbs.gov.il/dictionary/en/geo?format=json'],
  ]) {
    const r = await req(url);
    out.push(ev(r, { label, sample: r.json ? trim(r.json, 2500) : r.text ? r.text.slice(0, 800) : null }));
  }
  save('cbs', { probes: out });
}

async function modeBoi() {
  const base = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/';
  const out = [];
  const flows = await req(base + 'structure/dataflow/BOI.STATISTICS?format=sdmx-json', { timeout: 120000 });
  let list = [];
  const df = flows.json && (flows.json.data && flows.json.data.dataflows || flows.json.Structure && flows.json.Structure.dataflows);
  if (Array.isArray(df)) list = df.map((d) => ({ id: d.id, agency: d.agencyID, version: d.version, name: d.name && (typeof d.name === 'string' ? d.name : d.name.en || d.name.he || Object.values(d.name)[0]), names: d.names }));
  out.push(ev(flows, { label: 'dataflows', count: list.length, sample: list.length ? null : (flows.text || '').slice(0, 800) }));
  const rel = list.filter((d) => /mortgage|housing|dwelling|credit|loan|interest|rate|real estate|construction|משכנת|דיור|ריבית|אשראי/i.test(JSON.stringify(d)));
  const samples = [];
  for (const d of rel.slice(0, 30)) {
    const r = await req(base + `data/dataflow/${d.agency || 'BOI.STATISTICS'}/${d.id}/${d.version || '1.0'}?startperiod=2026-01&format=csv`, { accept: 'text/csv, */*', timeout: 120000 });
    const lines = (r.text || '').trim().split('\n');
    samples.push(ev(r, { flow: d.id, name: d.name, rows: Math.max(0, lines.length - 1), header: lines[0] ? lines[0].slice(0, 500) : null, last: lines.length > 1 ? lines.slice(-3).join(' ⏎ ').slice(0, 600) : null }));
  }
  const ex = await req(base + 'structure/dataflow/all/all/latest?format=sdmx-json', { timeout: 120000 });
  out.push(ev(ex, { label: 'all dataflows (alternative path)', sample: ex.json ? null : (ex.text || '').slice(0, 400) }));
  save('boi', { flows: list, probes: out, samples });
}

async function modeMot() {
  const out = [];
  for (const [label, url, method] of [['GTFS file (HEAD)', 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip', 'HEAD'],
    ['GTFS directory', 'https://gtfs.mot.gov.il/gtfsfiles/', 'GET'], ['MoT SIRI / open data landing', 'https://www.gov.il/he/departments/general/gtfs_general_transit_feed_specifications', 'GET']]) {
    const r = await req(url, { method });
    out.push(ev(r, { label, length: r.length, textSample: method === 'GET' && r.text ? r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200) : null }));
  }
  save('mot', { probes: out });
}

async function modeMuni() {
  const cities = ['jerusalem', 'tel-aviv', 'haifa', 'petah-tikva', 'petahtikva', 'ramat-gan', 'ramatgan', 'rishon', 'rishonlezion', 'herzliya', 'netanya', 'beer-sheva', 'beersheva', 'br7',
    'ashdod', 'holon', 'bat-yam', 'batyam', 'kfar-saba', 'kfarsaba', 'raanana', 'rehovot', 'modiin', 'givatayim', 'hod-hasharon', 'ashkelon', 'nazareth', 'eilat', 'kiryat-gat', 'lod', 'ramla'];
  const ckan = [];
  for (const c of cities) {
    const r = await req(`https://${c}.datacity.org.il/api/3/action/package_list`);
    const ok = r.json && r.json.success;
    ckan.push(ev(r, { city: c, portal: `${c}.datacity.org.il`, packages: ok ? r.json.result.length : null, names: ok ? r.json.result.slice(0, 400) : null }));
  }
  const portals = [];
  for (const [label, url] of [['TLV open data portal', 'https://opendata.tel-aviv.gov.il/'], ['TLV ArcGIS root', 'https://gisn.tel-aviv.gov.il/arcgis/rest/services?f=json'],
    ['Jerusalem ArcGIS', 'https://gisviewer.jerusalem.muni.il/arcgis/rest/services?f=json'], ['Haifa CKAN', 'https://opendata.haifa.muni.il/api/3/action/package_list'],
    ['Beer Sheva CKAN', 'https://opendata.br7.org.il/api/3/action/package_list'], ['Petah Tikva GIS', 'https://gis.ptk.org.il/arcgis/rest/services?f=json'],
    ['Rishon LeZion GIS', 'https://gis.rishonlezion.muni.il/arcgis/rest/services?f=json'], ['Netanya GIS', 'https://gis.netanya.muni.il/arcgis/rest/services?f=json'],
    ['Ramat Gan GIS', 'https://gis.ramat-gan.muni.il/arcgis/rest/services?f=json'], ['Herzliya GIS', 'https://gis.herzliya.muni.il/arcgis/rest/services?f=json'],
    ['Ashdod GIS', 'https://gis.ashdod.muni.il/arcgis/rest/services?f=json'], ['Beer Sheva GIS', 'https://gis.br7.org.il/arcgis/rest/services?f=json']]) {
    const r = await req(url);
    const ok = r.json && (r.json.success || r.json.folders || r.json.services);
    portals.push(ev(r, { label, ok: !!ok, folders: r.json && r.json.folders ? r.json.folders.slice(0, 80) : undefined, services: r.json && r.json.services ? r.json.services.slice(0, 120).map((s) => s.name + ':' + s.type) : undefined,
      packages: r.json && r.json.success && Array.isArray(r.json.result) ? r.json.result.length : undefined, names: r.json && r.json.success && Array.isArray(r.json.result) ? r.json.result.slice(0, 300) : undefined }));
  }
  /* TLV ArcGIS: the public directory's services (TLV is PROPX's one live municipal connector) */
  const tlv = await arcgisDir('https://gisn.tel-aviv.gov.il/arcgis/rest/services', 'tlv', 250);
  save('muni', { ckan, portals, tlv });
}

async function modeOther() {
  const out = [];
  for (const [label, url] of [
    ['Survey of Israel · GovMap ArcGIS root', 'https://ags.govmap.gov.il/arcgis/rest/services?f=json'],
    ['Survey of Israel · open GIS', 'https://open-data.mapi.gov.il/'],
    ['Environment (MoEP) GIS root', 'https://gis.sviva.gov.il/arcgis/rest/services?f=json'],
    ['IMS API (documentation)', 'https://ims.gov.il/he/ObservationDataAPI'],
    ['IMS API endpoint (keyed)', 'https://api.ims.gov.il/v1/envista/stations'],
    ['GSI (geology) GIS', 'https://www.gsi.gov.il/'],
    ['Water Authority', 'https://www.gov.il/he/departments/water_authority/govil-landing-page'],
    ['Ministry of Education institutions (GIS)', 'https://apps.education.gov.il/mosdotnew/'],
    ['ILA GIS (govmap layers)', 'https://apps.land.gov.il/MichrazimSite/api/SearchApi/Search'],
    ['Netivei Israel open data', 'https://www.iroads.co.il/'],
    ['Israel Railways', 'https://www.rail.co.il/'],
    ['NTA (metro / light rail)', 'https://www.nta.co.il/'],
  ]) {
    const r = await req(url);
    out.push(ev(r, { label, sample: r.json ? trim(r.json, 1200) : r.text ? r.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : null }));
  }
  save('other', { probes: out });
}

/* ── second pass: the series PROPX would read — BOI housing finance (structure + data since 2024) and the CBS average-price subjects ── */
async function modeBoi2() {
  const base = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/';
  const out = [];
  for (const flow of ['BIR_MRTG_99', 'BMB_99', 'REAL_ES_DF', 'BR', 'DEBT_AGG']) {
    const st = await req(base + `structure/dataflow/BOI.STATISTICS/${flow}/latest?references=all&detail=full&format=sdmx-json`, { timeout: 120000 });
    const data = await req(base + `data/dataflow/BOI.STATISTICS/${flow}/1.0?startperiod=${flow === 'BR' ? '2026-06' : '2024-01'}&format=csv`, { accept: 'text/csv, */*', timeout: 180000 });
    const lines = (data.text || '').trim().split('\n');
    /* the structure: dimension / attribute ids and the code labels of every codelist (Hebrew + English names) */
    const S = st.json && (st.json.data || st.json);
    const codelists = S && S.codelists ? S.codelists.map((c) => ({ id: c.id, codes: (c.codes || []).slice(0, 400).map((k) => ({ id: k.id, name: k.name || (k.names && (k.names.en || k.names.he)) || null, he: k.names && k.names.he || null })) })) : null;
    const dsd = S && S.dataStructures && S.dataStructures[0];
    out.push({ flow, structure: ev(st, { dimensions: dsd ? (dsd.dataStructureComponents.dimensionList.dimensions || []).map((d) => ({ id: d.id, codelist: d.localRepresentation && d.localRepresentation.enumeration })) : null,
      attributes: dsd && dsd.dataStructureComponents.attributeList ? (dsd.dataStructureComponents.attributeList.attributes || []).map((a) => a.id) : null, codelists }),
      data: ev(data, { rows: Math.max(0, lines.length - 1), header: lines[0] || null }), csv: data.status === 200 && data.text && data.text.length < 6e6 ? data.text : null });
  }
  save('boi2', { flows: out });
}
/* ── third pass: the Ministry of Transport station layers PROPX would read (data.gov.il): every ZIP shapefile parsed (entries, .prj,
   shape type, fields, sample, distinct status values) and every datastore table read whole (≤ 2,000 rows) or sampled ── */
async function modeMot2() {
  const SHP = require('../lib/transport/shp');
  const base = 'https://data.gov.il/api/3/action/';
  const out = [];
  for (const pkg of ['rail_stat', 'lrt_stat', 'metro_stat', 'bus_stops', 'metro_line', 'lrt_line']) {
    const ps = await req(base + 'package_show?id=' + pkg);
    const P = ps.json && ps.json.success ? ps.json.result : null;
    const rec = { pkg, status: ps.status, title: P && P.title, modified: P && P.metadata_modified, license: P && P.license_title, resources: [] };
    for (const r of (P && P.resources) || []) {
      const R = { id: r.id, name: r.name, format: r.format, url: r.url, modified: r.last_modified || r.metadata_modified, datastore: !!r.datastore_active, size: r.size };
      if (/zip/i.test(r.format || '') || /\.zip$/i.test(r.url || '')) {
        try {
          const t0 = Date.now(); const res = await fetch(r.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) }); calls++;
          const buf = Buffer.from(await res.arrayBuffer()); await sleep(SPACING);
          R.download = { status: res.status, bytes: buf.length, ms: Date.now() - t0, type: res.headers.get('content-type') };
          if (res.status === 200) {
            const L = SHP.readZippedLayer(buf);
            const stat = {}; for (const f of L.features) for (const k of Object.keys(f.attributes)) if (/STAT|TYPE|LINE|YEAR/i.test(k)) { stat[k] = stat[k] || {}; const v = String(f.attributes[k]); stat[k][v] = (stat[k][v] || 0) + 1; }
            R.layer = { name: L.name, entries: L.entries, prj: (L.prj || '').slice(0, 400), projection: SHP.projectionOf(L.prj), shapeType: L.shapeType, bbox: L.bbox, features: L.features.length, fields: L.fields.map((f) => f.name + ':' + f.type), codePage: L.codePage,
              sample: L.features.slice(0, 6).map((f) => ({ a: f.attributes, g: f.geometry.type === 'Point' ? [f.geometry.x, f.geometry.y] : { type: f.geometry.type, n: (f.geometry.points || []).length, first: (f.geometry.points || [])[0] } })), distinct: stat };
          }
        } catch (e) { R.error = String(e.message).slice(0, 300); }
      } else if (R.datastore) {
        const rows = []; let total = null;
        for (let off = 0; off < 2000; off += 1000) { const d = await req(base + `datastore_search?resource_id=${r.id}&limit=1000&offset=${off}`); if (!d.json || !d.json.success) { R.error = 'datastore HTTP ' + d.status; break; } total = d.json.result.total; rows.push(...d.json.result.records); if (rows.length >= total) break; }
        const stat = {}; for (const row of rows) for (const k of Object.keys(row)) if (/STAT|TYPE|Type|LINE|YEAR|Metropolin/i.test(k)) { stat[k] = stat[k] || {}; const v = String(row[k]); if (Object.keys(stat[k]).length < 60 || stat[k][v]) stat[k][v] = (stat[k][v] || 0) + 1; }
        R.table = { total, read: rows.length, fields: rows[0] ? Object.keys(rows[0]) : [], sample: rows.slice(0, 5), distinct: stat };
      }
      rec.resources.push(R);
    }
    out.push(rec);
  }
  save('mot2', { packages: out });
}
async function modeCbs2() {
  const out = [];
  const pages = ['%D7%A1%D7%93%D7%A8%D7%95%D7%AA-%D7%A2%D7%99%D7%AA%D7%99%D7%95%D7%AA-%D7%91%D7%90%D7%9E%D7%A6%D7%A2%D7%95%D7%AA-API.aspx', '%D7%9E%D7%93%D7%93%D7%99-%D7%9E%D7%97%D7%99%D7%A8%D7%99%D7%9D-%D7%91%D7%90%D7%9E%D7%A6%D7%A2%D7%95%D7%AA-API.aspx',
    '%D7%A1%D7%93%D7%A8%D7%95%D7%AA-SDMX-%D7%91%D7%90%D7%9E%D7%A6%D7%A2%D7%95%D7%AA-API.aspx', '%D7%9E%D7%99%D7%9C%D7%95%D7%A0%D7%99%D7%9D-API.aspx'];
  for (const pg of pages) {
    const url = 'https://www.cbs.gov.il/he/cbsNewBrand/Pages/' + pg;
    const r = await req(url, { accept: 'text/html' });
    const txt = (r.text || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    out.push(ev(r, { label: decodeURIComponent(pg), apiUrls: [...new Set((txt.match(/https?:\/\/apis?\.cbs\.gov\.il\/[^\s"'<>)]+/g) || []))].slice(0, 80), text: txt.slice(0, 6000) }));
  }
  /* the price-index chapter of the dwelling market: every subject and its codes, and the latest periods of each code */
  const ch = await req('https://api.cbs.gov.il/index/catalog/chapter?id=aa&format=json&download=false');
  const subjects = ch.json && ch.json.subject ? ch.json.subject : [];
  const subj = [];
  for (const s of subjects) {
    const r = await req(`https://api.cbs.gov.il/index/catalog/subject?id=${s.subjectId}&format=json&download=false`);
    const codes = r.json && (r.json.code || r.json.codes || r.json.subject) || null;
    subj.push(ev(r, { subjectId: s.subjectId, name: s.subjectName, raw: r.json ? JSON.stringify(r.json).slice(0, 4000) : (r.text || '').slice(0, 400) }));
    const list = Array.isArray(codes) ? codes : [];
    for (const c of list.slice(0, 40)) {
      const id = c.codeId || c.code || c.id; if (!id) continue;
      const d = await req(`https://api.cbs.gov.il/index/data/price?id=${id}&format=json&download=false&last=3`);
      subj.push(ev(d, { subjectId: s.subjectId, code: id, codeName: c.codeName || c.name || null, data: d.json ? JSON.stringify(d.json).slice(0, 1500) : (d.text || '').slice(0, 300) }));
    }
  }
  save('cbs2', { pages: out, chapter: ev(ch, { subjects }), subjects: subj });
}

/* ── fourth pass (verify): settle the catalogue's PENDING entries — every file resource read by its first bytes and its ZIP central directory
   (two ranged GETs, never the whole file), every unprobed datastore resource counted, the municipal packages' metadata + first rows, the
   Planning Administration entity / VATMAL fields, Ashdod's parcel service, the GTFS archive's file list ── */
async function ranged(url, range) {
  const t0 = Date.now(); calls++;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: range }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
    const buf = Buffer.from(await r.arrayBuffer()); await sleep(SPACING);
    return { url, status: r.status, type: r.headers.get('content-type'), contentRange: r.headers.get('content-range'), length: r.headers.get('content-length'), bytes: buf.length, ms: Date.now() - t0, buf, finalHost: (() => { try { return new URL(r.url).host; } catch { return null; } })() };
  } catch (e) { await sleep(SPACING); return { url, status: 0, error: String((e.cause && e.cause.code) || e.message).slice(0, 120), ms: Date.now() - t0 }; }
}
function zipEntries(buf) {
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) {
    const n = buf.readUInt16LE(i + 10), cdSize = buf.readUInt32LE(i + 12), cdOff = i - cdSize; if (cdOff < 0) return { total: n, note: 'central directory larger than the read window' };
    const out = []; for (let k = 0, p = cdOff; k < n && p + 46 <= buf.length; k++) { if (buf.readUInt32LE(p) !== 0x02014b50) break; const usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32); out.push({ name: buf.slice(p + 46, p + 46 + nl).toString('utf8'), size: usize }); p += 46 + nl + xl + cl; }
    return { total: n, entries: out.slice(0, 80) };
  }
  return { note: 'no end-of-central-directory record in the read window' };
}
async function fileEvidence(url) {
  const head = await ranged(url, 'bytes=0-3');
  const R = { url, first: { status: head.status, type: head.type, contentRange: head.contentRange, bytes: head.bytes, error: head.error, host: head.finalHost, magic: head.buf ? head.buf.slice(0, 4).toString('hex') : null } };
  if ((head.status === 206 || head.status === 200) && head.buf && head.buf.slice(0, 2).toString('latin1') === 'PK') {
    const tail = await ranged(url, 'bytes=-262144');
    R.tail = { status: tail.status, contentRange: tail.contentRange, bytes: tail.bytes, error: tail.error };
    if (tail.buf && (tail.status === 206 || tail.status === 200)) R.zip = zipEntries(tail.buf);
  }
  return R;
}
async function ckanVerify(api, names) {
  const out = [];
  for (const name of names) {
    const ps = await req(api + 'package_show?id=' + encodeURIComponent(name));
    const P = ps.json && ps.json.success ? ps.json.result : null;
    const rec = { pkg: name, status: ps.status, error: ps.error, title: P && P.title, license: P && (P.license_title || P.license_id), modified: P && P.metadata_modified, org: P && P.organization && P.organization.title, resources: [] };
    for (const r of ((P && P.resources) || []).slice(0, 8)) {
      const R = { id: r.id, name: r.name, format: r.format, url: r.url, datastore: !!r.datastore_active, modified: r.last_modified || r.metadata_modified, size: r.size || null };
      if (R.datastore) {
        const d = await req(api + 'datastore_search?' + new URLSearchParams({ resource_id: r.id, limit: '2' }));
        const res = d.json && d.json.success ? d.json.result : null;
        R.table = { status: d.status, total: res ? res.total : null, fields: res ? res.fields.filter((f) => f.id !== '_id').map((f) => f.id + ':' + f.type) : null, sample: res ? trim(res.records, 900) : null, error: d.error };
      } else if (r.url && /^https?:/.test(r.url) && !/\.(html?|aspx?)($|\?)/i.test(r.url)) R.file = await fileEvidence(r.url);
      rec.resources.push(R);
    }
    out.push(rec);
  }
  return out;
}
async function modeVerify() {
  const T = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(OUT_DIR, 'ckan-triage.json.gz'))).toString('utf8'));
  const names = T.relevant.filter((r) => r.proposedState === 'PENDING_VERIFICATION' || (r.value !== 'LOW' && !r.integrated && !(r.probe && r.probe.total != null))).map((r) => r.name);
  const datagov = await ckanVerify('https://data.gov.il/api/3/action/', names);
  const jerusalem = await ckanVerify('https://jerusalem.datacity.org.il/api/3/action/', ['light-rail-stations', 'light-rail-future-stations', 'light-rail-line', 'light-rail-future-lines', 'urban-renewal-38', 'urban-renewal-areas', 'urban-renewal-evacuation-construction', 'plots', 'blocks-key', 'city-buildings']);
  const haifa = await ckanVerify('https://opendata.haifa.muni.il/api/3/action/', ['yeudei_karka', 'blg_shimur', 'shimurpreservationareas', 'sekreishimurcompleted', 'sikreishimurinexecution', 'gvul_tichnun', 'buildingsites', 'neighborhood', 'stat_construction']);
  const IP = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/';
  const arc = [];
  for (const [label, u] of [['iplan entities layer 3 (polygons)', IP + 'entities/MapServer/3?f=json'], ['iplan entities layer 1 (points)', IP + 'entities/MapServer/1?f=json'],
    ['iplan vatmal layer 0', IP + 'vatmal_mitchamim_muchrazim/MapServer/0?f=json'], ['iplan vatmal sample', IP + 'vatmal_mitchamim_muchrazim/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3&f=json'],
    ['iplan Shimour layer 2', IP + 'Shimour/MapServer/2?f=json'], ['iplan land use layer 1', IP + 'xplan_background/MapServer/1?f=json'],
    ['Ashdod parcels service', 'https://gis.ashdod.muni.il/arcgis/rest/services/' + encodeURIComponent('גושים_וחלקות') + '/MapServer?f=json']]) {
    const r = await req(u); const j = r.json || {};
    arc.push(ev(r, { label, name: j.name || null, geometryType: j.geometryType || null, fields: Array.isArray(j.fields) ? j.fields.map((f) => f.name + ':' + (f.alias || '') + ':' + f.type) : null, layers: Array.isArray(j.layers) ? j.layers.map((l) => l.id + ':' + l.name) : null,
      maxRecordCount: j.maxRecordCount ?? null, copyright: j.copyrightText || null, features: Array.isArray(j.features) ? trim(j.features.map((f) => f.attributes), 1500) : null, error: r.error || (j.error ? trim(j.error, 200) : undefined) }));
  }
  const gtfs = await fileEvidence('https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip');
  save('verify', { datagov, jerusalem, haifa, arcgis: arc, gtfs });
}

const MODES = { verify: modeVerify, mot2: modeMot2, boi2: modeBoi2, cbs2: modeCbs2, ckan: modeCkan, gov: modeGov, iplan: modeIplan, cbs: modeCbs, boi: modeBoi, mot: modeMot, muni: modeMuni, other: modeOther };
(async () => {
  const mode = (process.argv[2] || '').replace(/^--/, '');
  if (!MODES[mode]) { console.error('mode: ' + Object.keys(MODES).join(' | ')); process.exit(2); }
  const t0 = Date.now();
  await MODES[mode]();
  console.log(`${mode}: done in ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch((e) => { console.error(e); process.exit(1); });
