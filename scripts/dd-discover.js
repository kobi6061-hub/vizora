#!/usr/bin/env node
// PROPX · Institutional due diligence — read-only source discovery (18.10.2026).
//
// Prints what the public corporate, legal, contractor, construction-site and municipal-permit sources actually expose:
// endpoints, fields, counts, identifier quality, sample rows and exact-join checks — so the entity-resolution layer and the
// DD read models are written from evidence, never from assumptions. Runs where gov.il is reachable (the GitHub runner,
// .github/workflows/dd-discover.yml); the Claude sandbox denies every Israeli host.
//
//   node scripts/dd-discover.js --companies     data.gov.il: the Corporations Authority companies registry (רשם החברות) — fields,
//                                              status / type vocabularies, exact-name lookups of known PROPX developers (identifier quality)
//   node scripts/dd-discover.js --legal         data.gov.il: charges (שעבודים), insolvency (חדלות פירעון / פירוק / כינוס), court / legal datasets
//   node scripts/dd-discover.js --public        TASE / MAYA / ISA (MAGNA): are public-company filings machine-readable without a key?
//   node scripts/dd-discover.js --contractors   the contractors register (פנקס הקבלנים): identifier fields, company-number coverage
//   node scripts/dd-discover.js --sites         active + closed construction sites (משרד העבודה): fields, the executor_id ↔ MISPAR_KABLAN join
//   node scripts/dd-discover.js --insolvency   the Official Receiver files (liquidation, debt claims), the filings register by company number (charges / violations), the registry by number
//   node scripts/dd-discover.js --tlv           Tel Aviv IView2: permits (772) + construction sites (499) — parcel / address / permit-holder fields
//   node scripts/dd-discover.js --all
//
// Nothing is written anywhere. Every request carries an honest User-Agent and a bounded timeout. No login, no CAPTCHA, no
// anti-bot circumvention: a refusal is reported as a refusal.

'use strict';

const UA = 'PROPX-dd-discovery/1.0 (+https://github.com/kobi6061-hub/vizora; read-only source audit)';
const CKAN = 'https://data.gov.il/api/3/action';
const TLV = 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer';
const MODES = process.argv.slice(2).filter((a) => a.startsWith('--')).flatMap((a) => a.slice(2).split(',')).map((a) => a.trim()).filter(Boolean);
const has = (f) => MODES.includes(f) || MODES.includes('all');
const out = (o) => console.log(JSON.stringify(o));
const trim = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, { method = 'GET', body, headers = {}, timeoutMs = 45000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.5', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, ok: r.ok, ms: Date.now() - t0, type: r.headers.get('content-type') || '', text, json, server: r.headers.get('server') };
  } catch (e) { return { status: 0, ok: false, ms: Date.now() - t0, error: String(e && e.message || e), text: '', json: null }; }
}
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
const dist = (rows, k, top = 12) => { const m = new Map(); for (const r of rows) { const v = r && r[k] != null && r[k] !== '' ? String(r[k]) : '—'; m.set(v, (m.get(v) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, top); };

async function ckanSearch(q, rows = 10) { const r = await req(`${CKAN}/package_search?q=${encodeURIComponent(q)}&rows=${rows}`); return r.json && r.json.result ? r.json.result : { status: r.status, error: r.error || trim(r.text, 200) }; }
async function ds(resource, params = {}) {
  const u = new URL(`${CKAN}/datastore_search`); u.searchParams.set('resource_id', resource); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  let r = null;
  for (let i = 0; i < 3; i++) { r = await req(u.toString()); if (r.json || (r.status && r.status < 500 && r.status !== 403 && r.status !== 429)) break; await sleep([3000, 8000, 20000][i]); }
  return { status: r.status, ms: r.ms, result: r.json && r.json.result ? r.json.result : null, error: r.json && r.json.error ? r.json.error : (r.error || (r.json ? null : 'non-JSON answer: ' + trim(String(r.text || '').replace(/\s+/g, ' '), 160))) };
}
const listPackages = (res) => (res && res.results ? res.results.map((p) => ({ name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified, resources: (p.resources || []).map((x) => ({ id: x.id, name: x.name, format: x.format, datastore: !!x.datastore_active, modified: x.last_modified })) })) : res);

/* known PROPX developers (ILA winners / MoCH developers) — identifier-quality probes against the companies registry */
const KNOWN = ['י.ח. דמרי בניה ופיתוח בע"מ', 'עמרם אברהם חברה לבנין בע"מ', 'דונה חברה להנדסה ובנין בע"מ', 'אפריקה ישראל מגורים בע"מ', 'שיכון ובינוי נדל"ן בע"מ', 'אזורים בנין (1965) בע"מ', 'פרץ בוני הנגב אחים פרץ בע"מ', 'מגידו י.ק יזום בע"מ', 'אשדר חברה לבניה בע"מ', 'קבוצת אלמוגים אחזקות בע"מ'];
const variants = (n) => [...new Set([n, n.replace(/״/g, '"'), n.replace(/"/g, '״'), n.replace(/["״]/g, '~'), n.replace(/\s*בע"מ\s*$/, '').trim(), n.replace(/\s*בע״מ\s*$/, '').trim()])];

async function companies() {
  out({ lane: 'companies', step: 'catalogue', q: 'רשם החברות', packages: listPackages(await ckanSearch('רשם החברות', 8)) });
  out({ lane: 'companies', step: 'catalogue', q: 'חברות ica', packages: listPackages(await ckanSearch('ica companies', 8)) });
  const CANDIDATES = ['f004176c-b85f-4542-8901-7b3176f9a054'];
  for (const p of (await ckanSearch('רשם החברות', 8)).results || []) for (const r of p.resources || []) if (r.datastore_active && !CANDIDATES.includes(r.id)) CANDIDATES.push(r.id);
  for (const res of CANDIDATES.slice(0, 4)) {
    const head = await ds(res, { limit: 5 });
    if (!head.result) { out({ lane: 'companies', resource: res, status: head.status, error: head.error }); continue; }
    const fields = (head.result.fields || []).map((f) => f.id + ':' + f.type);
    out({ lane: 'companies', resource: res, total: head.result.total, fields, profile: profile(head.result.records || []), sample: (head.result.records || []).slice(0, 2) });
    /* vocabularies: status, type, violating flag — sampled from a larger page */
    const page = await ds(res, { limit: 2000 });
    if (page.result) { const rows = page.result.records || []; const F = Object.keys(rows[0] || {}); const pick = (re) => F.find((k) => re.test(k));
      out({ lane: 'companies', resource: res, vocab: { status: pick(/סטטוס/) ? dist(rows, pick(/סטטוס/)) : null, type: pick(/סוג/) ? dist(rows, pick(/סוג/)) : null, violating: pick(/מפרה/) ? dist(rows, pick(/מפרה/)) : null, lastReport: pick(/דוח/) ? dist(rows, pick(/דוח/), 8) : null, fieldsAll: F } }); }
    /* identifier quality: exact filter on the name field vs full-text q, for ten known PROPX developers */
    const nameField = (head.result.fields || []).map((f) => f.id).find((k) => /שם\s*חברה$|^שם חברה/.test(k)) || (head.result.fields || []).map((f) => f.id).find((k) => /שם/.test(k));
    const numField = (head.result.fields || []).map((f) => f.id).find((k) => /מספר\s*חברה/.test(k));
    for (const name of KNOWN) {
      const hits = [];
      for (const v of variants(name)) { const r = await ds(res, { filters: { [nameField]: v }, limit: 5 }); if (r.result && r.result.records.length) hits.push({ variant: v, exact: r.result.records.map((x) => ({ num: x[numField], name: x[nameField], status: x[Object.keys(x).find((k) => /סטטוס/.test(k))] })) }); await sleep(150); }
      const ft = await ds(res, { q: name.replace(/["״]/g, ' '), limit: 8 });
      out({ lane: 'companies', step: 'lookup', name, exact: hits, fulltext: ft.result ? ft.result.records.map((x) => ({ num: x[numField], name: x[nameField] })) : ft.error, fulltextTotal: ft.result ? ft.result.total : null });
      await sleep(200);
    }
  }
}
async function legal() {
  for (const q of ['שעבודים', 'שעבוד חברות', 'חדלות פירעון', 'פירוק חברות', 'כינוס נכסים', 'הממונה על הליכי חדלות פירעון', 'בתי משפט תיקים', 'הוצאה לפועל', 'חברות מפרות', 'עמותות רשם']) {
    const r = await ckanSearch(q, 8); out({ lane: 'legal', q, count: r.count, packages: listPackages(r) }); await sleep(200);
  }
}
async function publicFilings() {
  for (const [name, url, headers] of [
    ['tase:api (keyless?)', 'https://api.tase.co.il/api/company/securitiesdata?lang=he', {}],
    ['maya:api (public endpoint, documented header)', 'https://mayaapi.tase.co.il/api/company/alldetails?companyId=1', { 'X-Maya-With': 'allow' }],
    ['maya:site', 'https://maya.tase.co.il/', {}],
    ['isa:magna', 'https://www.magna.isa.gov.il/', {}],
    ['isa:open-data', 'https://www.isa.gov.il/', {}],
    ['datagov:public-companies', `${CKAN}/package_search?q=${encodeURIComponent('חברות ציבוריות בורסה')}&rows=8`, {}],
    ['datagov:isa', `${CKAN}/package_search?q=${encodeURIComponent('רשות ניירות ערך')}&rows=8`, {}],
  ]) { const r = await req(url, { headers, timeoutMs: 30000 }); out({ lane: 'public', name, url, status: r.status, ms: r.ms, type: r.type, server: r.server, error: r.error || null, body: r.json ? trim(r.json, 400) : trim(r.text.replace(/\s+/g, ' '), 300) }); await sleep(300); }
}
async function resolveResource(q, fallback, pick) {
  const cat = await ckanSearch(q, 8); const pk = listPackages(cat); out({ lane: 'catalogue', q, packages: pk });
  for (const p of Array.isArray(pk) ? pk : []) for (const r of p.resources || []) if (r.datastore && pick(p, r)) return r.id;
  return fallback;
}
async function contractors() {
  const res = await resolveResource('פנקס הקבלנים', '4eb61bd6-18cf-4e7c-9f9c-e166dfa0a2d8', (p, r) => /קבלן|קבלנים/.test(p.title + ' ' + r.name) && !/PDF/i.test(r.format));
  const head = await ds(res, { limit: 3 }); if (!head.result) return out({ lane: 'contractors', status: head.status, error: head.error });
  out({ lane: 'contractors', total: head.result.total, fields: (head.result.fields || []).map((f) => f.id + ':' + f.type) });
  const page = await ds(res, { limit: 5000 }); const rows = page.result ? page.result.records : [];
  const withCo = rows.filter((r) => String(r.MISPAR_YESHUT || '').trim() !== '');
  out({ lane: 'contractors', sampled: rows.length, withCompanyNumber: withCo.length, companyNumberLengths: dist(withCo.map((r) => ({ L: String(r.MISPAR_YESHUT).trim().length })), 'L'), branches: dist(rows, 'TEUR_ANAF'), groups: dist(rows, 'KVUTZA'), recognized: dist(rows, 'KABLAN_MUKAR'), distinctKablan: new Set(rows.map((r) => r.MISPAR_KABLAN)).size });
  for (const name of KNOWN.slice(0, 6)) { const r = await ds(res, { q: name.replace(/["״]/g, ' '), limit: 5 }); out({ lane: 'contractors', step: 'lookup', name, hits: r.result ? r.result.records.map((x) => ({ kablan: x.MISPAR_KABLAN, yeshut: x.MISPAR_YESHUT, name: x.SHEM_YESHUT, branch: x.TEUR_ANAF, group: x.KVUTZA, sivug: x.SIVUG })) : r.error }); await sleep(200); }
}
async function sites() {
  const A = await resolveResource('אתרי בניה פעילים', 'b072e36c-a53b-49e1-be08-4a608fcf4638', (p, r) => /אתרי בנ/.test(p.title + ' ' + r.name) && /פעיל/.test(p.title + ' ' + r.name) && !/סגור|PDF/i.test(r.name + r.format));
  const C = await resolveResource('אתרי בניה סגורים', 'b9257d8f-f93a-4c7d-84dd-e4b0838eadaa', (p, r) => /אתרי בנ/.test(p.title + ' ' + r.name) && /סגור/.test(p.title + ' ' + r.name) && !/PDF/i.test(r.format));
  const K = await resolveResource('פנקס הקבלנים', '4eb61bd6-18cf-4e7c-9f9c-e166dfa0a2d8', (p, r) => /קבלן|קבלנים/.test(p.title + ' ' + r.name) && !/PDF/i.test(r.format));
  const head = await ds(A, { limit: 3 }); if (!head.result) return out({ lane: 'sites', status: head.status, error: head.error });
  out({ lane: 'sites', active: { total: head.result.total, fields: (head.result.fields || []).map((f) => f.id + ':' + f.type) } });
  const page = await ds(A, { limit: 3000 }); const rows = page.result ? page.result.records : [];
  const pat = (s) => (/גוש|חלקה/.test(s) ? 'block/parcel' : /מגרש/.test(s) ? 'lot' : /\d/.test(s) ? 'street+number?' : 'free text');
  out({ lane: 'sites', sampled: rows.length, cities: dist(rows, 'city_name', 15), buildTypes: dist(rows, 'build_types'), cranes: dist(rows, 'has_cranes'), siteNamePatterns: dist(rows.map((r) => ({ p: pat(String(r.site_name || '')) })), 'p'), executorIdPresent: rows.filter((r) => r.executor_id).length, sanctions: dist(rows, 'sanctions', 5) });
  /* the exact join: executor_id ↔ MISPAR_KABLAN in the contractors register */
  const ids = [...new Set(rows.map((r) => r.executor_id).filter(Boolean))].slice(0, 25); let joined = 0; const ex = [];
  for (const id of ids) { const r = await ds(K, { filters: { MISPAR_KABLAN: String(id) }, limit: 3 }); const hit = r.result && r.result.records[0]; if (hit) { joined++; if (ex.length < 5) ex.push({ executor_id: id, kablan: hit.MISPAR_KABLAN, company: hit.MISPAR_YESHUT, name: hit.SHEM_YESHUT }); } await sleep(120); }
  out({ lane: 'sites', step: 'join executor_id → contractors.MISPAR_KABLAN', tried: ids.length, joined, examples: ex });
  const closed = await ds(C, { limit: 3 }); out({ lane: 'sites', closed: closed.result ? { total: closed.result.total, fields: (closed.result.fields || []).map((f) => f.id + ':' + f.type), sample: closed.result.records.slice(0, 2) } : closed.error });
  out({ lane: 'sites', sample: rows.slice(0, 3) });
}
/* known company numbers (exact hits of the first run, 18.10.2026): the join key for every corporate / legal probe */
const KNOWN_NUMBERS = [['י.ח. דמרי בניה ופיתוח בע"מ', 511399388], ['שיכון ובינוי נדל"ן בע"מ', 520021171], ['פרץ בוני הנגב אחים פרץ בע"מ', 510865058], ['דונה חברה להנדסה ובנין בע"מ', 511543886], ['אזורים בנין (1965) בע"מ', 520031089], ['עמרם אברהם חברה לבנין בע"מ', 513201582], ['מגידו י.ק יזום בע"מ', 515384840]];
async function insolvency() {
  /* a. the Official Receiver (הכונס הרשמי / הממונה על הליכי חדלות פירעון): companies in liquidation, debt claims */
  const cat = listPackages(await ckanSearch('הכונס הרשמי', 8)); out({ lane: 'insolvency', step: 'catalogue', packages: cat });
  const RES = { liquidation: 'd8715392-287f-49b7-9ae3-f21ec5bf55f3', claims: '3cb25b2e-a501-4870-86a6-30be8d8e80a5', voluntaryFast: '6f3f0df3-5968-4135-81c5-8dd76bf89410' };
  for (const [k, res] of Object.entries(RES)) {
    const head = await ds(res, { limit: 5 }); if (!head.result) { out({ lane: 'insolvency', set: k, resource: res, status: head.status, error: head.error }); continue; }
    const fields = (head.result.fields || []).map((f) => f.id + ':' + f.type);
    out({ lane: 'insolvency', set: k, resource: res, total: head.result.total, fields, profile: profile(head.result.records || []), sample: (head.result.records || []).slice(0, 2) });
    const page = await ds(res, { limit: 1500 }); const rows = page.result ? page.result.records || [] : []; const F = Object.keys(rows[0] || {}); const pick = (re) => F.find((x) => re.test(x));
    out({ lane: 'insolvency', set: k, vocab: { status: pick(/סטטוס|מצב/) ? dist(rows, pick(/סטטוס|מצב/)) : null, kind: pick(/סוג/) ? dist(rows, pick(/סוג/)) : null, dateField: pick(/תאריך/) || null, numberField: pick(/מספר (תאגיד|חברה|ח\.פ|ח"פ|זהות)/) || pick(/מספר/) || null, fieldsAll: F } });
    const numField = pick(/מספר (תאגיד|חברה)/) || pick(/ח\.?פ/) || null;
    if (numField) for (const [name, num] of KNOWN_NUMBERS) { const r = await ds(res, { filters: { [numField]: String(num) }, limit: 5 }); out({ lane: 'insolvency', set: k, step: 'lookup by company number', name, num, hits: r.result ? r.result.records.length : r.error, sample: r.result ? r.result.records.slice(0, 2) : null }); await sleep(250); }
    await sleep(400);
  }
  /* b. the filings register (ica-changes) BY COMPANY NUMBER: charge registrations / removals, violation updates, annual reports */
  const CH = '28780ab5-3ef1-44c7-8377-da82c0aa6781';
  for (const [name, num] of KNOWN_NUMBERS) {
    const r = await ds(CH, { filters: { 'מספר תאגיד': String(num) }, limit: 500 });
    const rows = r.result ? r.result.records || [] : [];
    out({ lane: 'insolvency', set: 'filings', step: 'by company number', name, num, total: r.result ? r.result.total : r.error, kinds: dist(rows, 'סוג בקשה', 20), dates: dist(rows.map((x) => ({ y: String(x['תאריך עדכון סטטוס'] || '').slice(-4) })), 'y', 12), chargeIds: rows.filter((x) => /שעבוד/.test(String(x['סוג בקשה']))).map((x) => ({ kind: x['סוג בקשה'], id: x['מזהה השיעבוד'], at: x['תאריך עדכון סטטוס'] })).slice(0, 12) });
    await sleep(300);
  }
  /* c. the companies registry BY COMPANY NUMBER (the exact key) and by the registry's own spelling (~ for the quotation mark) */
  const CO = 'f004176c-b85f-4542-8901-7b3176f9a054';
  for (const [name, num] of KNOWN_NUMBERS) {
    const byNum = await ds(CO, { filters: { 'מספר חברה': String(num) }, limit: 2 });
    const byName = await ds(CO, { filters: { 'שם חברה': name.replace(/["״]/g, '~') }, limit: 3 });
    const rec = byNum.result && byNum.result.records[0];
    out({ lane: 'insolvency', set: 'registry', name, num, byNumber: rec ? { name: rec['שם חברה'], status: rec['סטטוס חברה'], type: rec['סוג תאגיד'], violating: rec['מפרה'], lastReport: rec['שנה אחרונה של דוח שנתי (שהוגש)'], incorporated: rec['תאריך התאגדות'], city: rec['שם עיר'] } : byNum.error, byTildeName: byName.result ? byName.result.records.map((x) => ({ num: x['מספר חברה'], name: x['שם חברה'] })) : byName.error });
    await sleep(300);
  }
}
async function tlv() {
  for (const [layer, label] of [[772, 'בקשות והיתרי בניה'], [499, 'אתרי בניה'], [524, 'חלקות']]) {
    const meta = await req(`${TLV}/${layer}?f=json`); const fields = meta.json && meta.json.fields ? meta.json.fields.map((f) => f.name + ':' + f.type) : null;
    const cnt = await req(`${TLV}/${layer}/query?where=1%3D1&returnCountOnly=true&f=json`);
    const q = await req(`${TLV}/${layer}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=3&f=json`);
    const feats = q.json && q.json.features ? q.json.features.map((f) => f.attributes) : null;
    out({ lane: 'tlv', layer, label, status: meta.status, count: cnt.json ? cnt.json.count : cnt.error || trim(cnt.text, 120), fields, parcelFields: fields ? fields.filter((f) => /gush|helka|chelka|parcel|block|גוש|חלקה/i.test(f)) : null, addressFields: fields ? fields.filter((f) => /addr|ktovet|street|rehov|כתובת/i.test(f)) : null, holderFields: fields ? fields.filter((f) => /baal|holder|yazam|mevakesh/i.test(f)) : null, sample: feats ? feats.slice(0, 2).map((a) => Object.fromEntries(Object.entries(a).slice(0, 40))) : q.error || trim(q.text, 200) });
    await sleep(300);
  }
  /* stage vocabularies of the permits layer */
  const st = await req(`${TLV}/772/query?where=1%3D1&outFields=building_stage,request_stage,sug_bakasha,permission_date,tr_hathalat_bniya,finished,occupation&returnGeometry=false&resultRecordCount=2000&f=json`);
  const rows = st.json && st.json.features ? st.json.features.map((f) => f.attributes) : [];
  out({ lane: 'tlv', layer: 772, sampled: rows.length, buildingStage: dist(rows, 'building_stage'), requestStage: dist(rows, 'request_stage'), type: dist(rows, 'sug_bakasha', 8), withPermit: rows.filter((r) => r.permission_date).length, withStart: rows.filter((r) => r.tr_hathalat_bniya).length, withFinished: rows.filter((r) => r.finished).length, withOccupation: rows.filter((r) => r.occupation).length });
}

(async () => {
  out({ lane: 'meta', at: new Date().toISOString(), node: process.version, argv: process.argv.slice(2) });
  if (has('companies')) await companies();
  if (has('legal')) await legal();
  if (has('public')) await publicFilings();
  if (has('contractors')) await contractors();
  if (has('sites')) await sites();
  if (has('insolvency')) await insolvency();
  if (has('tlv')) await tlv();
  out({ lane: 'meta', done: true });
})().catch((e) => { out({ lane: 'meta', fatal: String(e && e.stack || e) }); process.exit(1); });
