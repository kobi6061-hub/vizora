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
//   node scripts/dd-discover.js --pledges       the pledges register (רשם המשכונות): fields, debtor-id presence, lookups by company number
//   node scripts/dd-discover.js --tlv           Tel Aviv IView2: permits (772) + construction sites (499) — parcel / address / permit-holder fields
//   node scripts/dd-discover.js --finance       PREMIUM 2.0: MAYA / TASE / MAGNA / XBRL / rating agencies / data.gov.il — financial statements
//   node scripts/dd-discover.js --ownership     PREMIUM 2.0: shareholders / interested parties / group structure
//   node scripts/dd-discover.js --litigation    PREMIUM 2.0: class actions, courts, enforcement, insolvency catalogues
//   node scripts/dd-discover.js --permits       PREMIUM 2.0: municipal permits — data.gov.il, municipal portals, municipal ArcGIS (13 cities)
//   node scripts/dd-discover.js --execution     PREMIUM 2.0: construction starts / completions / occupancy sources
//   node scripts/dd-discover.js --sales         PREMIUM 2.0: project-level sales progress sources
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
/* the pledges register (רשם המשכונות) — catalogue-level only in the 18.10 audit; profiled here: fields, vocabulary, debtor id presence */
async function pledges() {
  const res = 'e7266a9c-fed6-40e4-a28e-8cddc9f44842';
  const head = await ds(res, { limit: 5 }); if (!head.result) return out({ lane: 'pledges', resource: res, status: head.status, error: head.error });
  const fields = (head.result.fields || []).map((f) => f.id + ':' + f.type);
  out({ lane: 'pledges', resource: res, total: head.result.total, fields, profile: profile(head.result.records || []), sample: (head.result.records || []).slice(0, 2) });
  const page = await ds(res, { limit: 1500 }); const rows = page.result ? page.result.records || [] : []; const F = Object.keys(rows[0] || {}); const pick = (re) => F.find((x) => re.test(x));
  out({ lane: 'pledges', vocab: { kind: pick(/סוג/) ? dist(rows, pick(/סוג/)) : null, status: pick(/סטטוס|מצב/) ? dist(rows, pick(/סטטוס|מצב/)) : null, debtorIdField: pick(/מספר (זהות|תאגיד|חברה|ח\.?פ)|ת\.?ז|מזהה חייב/) || null, dateField: pick(/תאריך/) || null, fieldsAll: F } });
  const numField = pick(/מספר (זהות|תאגיד|חברה)|ח\.?פ|מזהה חייב/);
  if (numField) for (const [name, num] of KNOWN_NUMBERS) { const r = await ds(res, { filters: { [numField]: String(num) }, limit: 5 }); out({ lane: 'pledges', step: 'lookup by company number', name, num, hits: r.result ? r.result.total : r.error, sample: r.result ? r.result.records.slice(0, 2) : null }); await sleep(300); }
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

/* ================================================================================================================
   PREMIUM DILIGENCE 2.0 lanes (18.10.2026): financial filings · ownership · litigation · municipal permits · execution · sales.
   Same rules: honest User-Agent, read-only, bounded timeouts; a refusal (403 / anti-bot page / login) is reported as such and
   never worked around; no header that pretends to be a browser.
   ================================================================================================================ */
const probe = async (lane, name, url, headers = {}) => {
  const r = await req(url, { headers, timeoutMs: 30000 });
  const body = r.json ? trim(r.json, 500) : trim(String(r.text || '').replace(/\s+/g, ' '), 300);
  const antiBot = /incapsula|imperva|cloudflare|captcha|_Incapsula_Resource|cf-chl|Request unsuccessful|Access Denied|bot/i.test(String(r.text || '').slice(0, 4000));
  out({ lane, name, url, status: r.status, ms: r.ms, type: r.type, server: r.server, antiBot, error: r.error || null, body });
  await sleep(250);
  return r;
};
async function ckanFields(lane, pkg) {
  for (const res of (pkg.resources || []).slice(0, 4)) {
    if (!res.datastore_active) { out({ lane, step: 'resource (no datastore)', pkg: pkg.title, org: pkg.organization && pkg.organization.title, name: res.name, format: res.format, url: trim(res.url, 160), modified: res.last_modified || res.metadata_modified }); continue; }
    const h = await ds(res.id, { limit: 3 });
    out({ lane, step: 'resource', pkg: pkg.title, org: pkg.organization && pkg.organization.title, resource: res.id, name: res.name, total: h.result ? h.result.total : null, error: h.error || null,
      fields: h.result ? (h.result.fields || []).map((f) => f.id) : null, sample: h.result ? trim((h.result.records || [])[0], 700) : null, modified: res.last_modified || res.metadata_modified });
    await sleep(300);
  }
}
async function searchAndProfile(lane, queries, rows = 12, profileTop = 6) {
  const seen = new Set();
  for (const q of queries) {
    const r = await ckanSearch(q, rows);
    out({ lane, step: 'catalogue', q, count: r.count, packages: (r.results || []).map((p) => ({ name: p.name, title: p.title, org: p.organization && p.organization.title, modified: p.metadata_modified, res: (p.resources || []).length })) });
    for (const p of (r.results || []).slice(0, profileTop)) { if (seen.has(p.id)) continue; seen.add(p.id); await ckanFields(lane, p); }
    await sleep(300);
  }
}
async function finance() {
  const MAYA = { 'X-Maya-With': 'allow' };
  /* TASE / MAYA: the public site's own data API, static report files, RSS; the TASE Data Hub (keyed) */
  await probe('finance', 'maya:api financereports', 'https://mayaapi.tase.co.il/api/company/financereports?companyId=1100', MAYA);
  await probe('finance', 'maya:api company details', 'https://mayaapi.tase.co.il/api/company/details?companyId=1100', MAYA);
  await probe('finance', 'maya:api reports search', 'https://mayaapi.tase.co.il/api/report/filter', MAYA);
  await probe('finance', 'maya:static report pdf', 'https://mayafiles.tase.co.il/rpdf/1500001-1501000/P1500001-00.pdf');
  await probe('finance', 'maya:static report html', 'https://mayafiles.tase.co.il/rhtm/1500001-1501000/H1500001.htm');
  await probe('finance', 'maya:rss', 'https://maya.tase.co.il/rss/maya.xml');
  await probe('finance', 'tase:site', 'https://www.tase.co.il/he');
  await probe('finance', 'tase:api (no key)', 'https://api.tase.co.il/api/company/securitiesdata?lang=he');
  await probe('finance', 'tase:openapi gateway (no key)', 'https://openapigw-p.tase.co.il/tase/prod/api/v1/basic-securities/companies-list');
  await probe('finance', 'tase:datahub', 'https://datahub.tase.co.il/');
  /* ISA MAGNA: the filing system, its details pages, XBRL */
  await probe('finance', 'isa:magna home', 'https://www.magna.isa.gov.il/');
  await probe('finance', 'isa:magna details', 'https://www.magna.isa.gov.il/details.aspx?reference=2024-01-000001');
  await probe('finance', 'isa:site', 'https://www.isa.gov.il/');
  await probe('finance', 'isa:xbrl', 'https://www.isa.gov.il/xbrl');
  /* credit ratings: the two Israeli rating agencies — robots and terms first */
  await probe('finance', 'maalot:robots', 'https://www.maalot.co.il/robots.txt');
  await probe('finance', 'maalot:home', 'https://www.maalot.co.il/');
  await probe('finance', 'midroog:robots', 'https://www.midroog.co.il/robots.txt');
  await probe('finance', 'midroog:home', 'https://www.midroog.co.il/');
  /* data.gov.il: any ISA / TASE / bonds / financial-statements dataset */
  await searchAndProfile('finance', ['רשות ניירות ערך', 'דוחות כספיים', 'אגרות חוב', 'בורסה לניירות ערך', 'תאגידים מדווחים', 'דירוג אשראי'], 10, 3);
}
async function ownership() {
  await searchAndProfile('ownership', ['רשות התאגידים', 'בעלי מניות', 'בעלי עניין', 'דירקטורים', 'נושאי משרה', 'שינוי שם חברה', 'קבוצת חברות', 'חברות בנות'], 12, 3);
  await probe('ownership', 'ica:generic corporation info (free page)', 'https://ica.justice.gov.il/GenericCorporarionInfo/SearchCorporation?unit=8');
  await probe('ownership', 'ica:online services', 'https://ica.justice.gov.il/');
}
async function litigation() {
  await searchAndProfile('litigation', ['תובענות ייצוגיות', 'פנקס תובענות ייצוגיות', 'הרשות השופטת', 'פסקי דין', 'הוצאה לפועל', 'חדלות פירעון', 'הממונה על הליכי חדלות פירעון', 'כונס נכסים', 'צו לפתיחת הליכים'], 12, 3);
  await probe('litigation', 'judiciary:site', 'https://www.gov.il/he/departments/the_judicial_authority');
  await probe('litigation', 'judiciary:class actions registry', 'https://www.court.gov.il/NGCS.Web.Site/HomePage.aspx');
  await probe('litigation', 'judiciary:supreme decisions search', 'https://supremedecisions.court.gov.il/');
}
/* municipal permits: data.gov.il, the municipal open-data portals and the municipal ArcGIS servers of the largest cities */
const CITIES = [
  ['ירושלים', 3000, ['https://opendata.jerusalem.muni.il', 'https://jerusalem.datacity.org.il'], ['https://gisviewer.jerusalem.muni.il/arcgis/rest/services', 'https://jergisng.jerusalem.muni.il/arcgis/rest/services']],
  ['חיפה', 4000, ['https://opendata.haifa.muni.il'], ['https://gisserver.haifa.muni.il/arcgis/rest/services', 'https://gis.haifa.muni.il/arcgis/rest/services']],
  ['ראשון לציון', 8300, ['https://opendata.rishonlezion.muni.il'], ['https://gis.rishonlezion.muni.il/arcgis/rest/services']],
  ['פתח תקווה', 7900, ['https://opendata.ptikva.org.il', 'https://data.petah-tikva.muni.il'], ['https://gis.ptikva.org.il/arcgis/rest/services']],
  ['באר שבע', 9000, ['https://opendata.br7.org.il'], ['https://gis.br7.org.il/arcgis/rest/services', 'https://gisweb.br7.org.il/arcgis/rest/services']],
  ['נתניה', 7400, ['https://opendata.netanya.muni.il'], ['https://gis.netanya.muni.il/arcgis/rest/services']],
  ['אשדוד', 70, ['https://opendata.ashdod.muni.il'], ['https://gis.ashdod.muni.il/arcgis/rest/services']],
  ['חולון', 6600, ['https://opendata.holon.muni.il'], ['https://gis.holon.muni.il/arcgis/rest/services']],
  ['רמת גן', 8600, ['https://opendata.ramat-gan.muni.il'], ['https://gis.ramat-gan.muni.il/arcgis/rest/services']],
  ['הרצליה', 6400, ['https://opendata.herzliya.muni.il'], ['https://gis.herzliya.muni.il/arcgis/rest/services']],
  ['בת ים', 6200, ['https://opendata.bat-yam.muni.il'], ['https://gis.bat-yam.muni.il/arcgis/rest/services']],
  ['כפר סבא', 6900, ['https://opendata.kfar-saba.muni.il'], ['https://gis.kfar-saba.muni.il/arcgis/rest/services']],
  ['רעננה', 8700, ['https://opendata.raanana.muni.il'], ['https://gis.raanana.muni.il/arcgis/rest/services']],
];
const PERMIT_RE = /היתר|רישוי|בני[יה]|heter|permit|rishui|binyan|bniya|building|license|construction/i;
async function arcgisWalk(lane, city, root) {
  const r = await req(`${root}?f=json`, { timeoutMs: 20000 });
  if (!r.json) { out({ lane, city, root, status: r.status, error: r.error || trim(String(r.text || '').replace(/\s+/g, ' '), 160) }); return; }
  const folders = r.json.folders || [], services = r.json.services || [];
  out({ lane, city, root, status: r.status, folders: folders.slice(0, 60), services: services.slice(0, 60).map((s) => s.name + ':' + s.type) });
  const cand = services.filter((s) => PERMIT_RE.test(s.name));
  for (const f of folders.slice(0, 25)) { const fr = await req(`${root}/${encodeURIComponent(f)}?f=json`, { timeoutMs: 20000 }); for (const s of ((fr.json && fr.json.services) || [])) if (PERMIT_RE.test(s.name) || PERMIT_RE.test(f)) cand.push(s); await sleep(150); }
  for (const s of cand.slice(0, 8)) {
    const m = await req(`${root}/${s.name}/${s.type}?f=json`, { timeoutMs: 20000 });
    const layers = ((m.json && m.json.layers) || []).map((l) => ({ id: l.id, name: l.name }));
    out({ lane, city, service: s.name + ':' + s.type, layers: layers.slice(0, 40) });
    for (const l of layers.filter((x) => PERMIT_RE.test(x.name)).slice(0, 4)) {
      const lm = await req(`${root}/${s.name}/${s.type}/${l.id}?f=json`, { timeoutMs: 20000 });
      const cnt = await req(`${root}/${s.name}/${s.type}/${l.id}/query?where=1%3D1&returnCountOnly=true&f=json`, { timeoutMs: 20000 });
      const q = await req(`${root}/${s.name}/${s.type}/${l.id}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json`, { timeoutMs: 20000 });
      out({ lane, city, layer: `${s.name}/${l.id} ${l.name}`, fields: lm.json && lm.json.fields ? lm.json.fields.map((f) => f.name + (f.alias && f.alias !== f.name ? '(' + f.alias + ')' : '')).slice(0, 60) : null, count: cnt.json ? cnt.json.count : null, sample: q.json && q.json.features ? trim(q.json.features.map((f) => f.attributes), 800) : trim(q.text, 200) });
      await sleep(200);
    }
  }
}
async function permits() {
  await searchAndProfile('permits', ['היתרי בניה', 'היתר בניה', 'רישוי בניה', 'בקשות להיתר', 'רישוי זמין', 'תעודת גמר', 'טופס 4', 'מידע תכנוני'], 20, 6);
  /* municipality organizations on data.gov.il and what each publishes */
  const orgs = await req(`${CKAN}/organization_list?all_fields=true&limit=1000`);
  const list = orgs.json && orgs.json.result ? orgs.json.result : [];
  out({ lane: 'permits', step: 'organizations', n: list.length, municipal: list.filter((o) => /עיריית|עירית|מועצה/.test(o.title || o.display_name || '')).map((o) => `${o.name}:${o.title}:${o.package_count}`).slice(0, 120) });
  for (const [city] of CITIES) {
    const o = list.find((x) => (x.title || '').includes(city));
    if (!o) { out({ lane: 'permits', city, datagov: 'no organization' }); continue; }
    const r = await req(`${CKAN}/package_search?fq=organization:${encodeURIComponent(o.name)}&rows=100`);
    const pk = (r.json && r.json.result && r.json.result.results) || [];
    out({ lane: 'permits', city, org: o.name, packages: pk.map((p) => p.title).slice(0, 100) });
    for (const p of pk.filter((p) => PERMIT_RE.test(p.title + ' ' + (p.notes || ''))).slice(0, 4)) await ckanFields('permits', p);
    await sleep(300);
  }
  /* municipal portals (CKAN-style search) and municipal ArcGIS servers */
  for (const [city, , portals, gis] of CITIES) {
    for (const base of portals) { const r = await req(`${base}/api/3/action/package_search?q=${encodeURIComponent('היתר')}&rows=10`, { timeoutMs: 20000 });
      out({ lane: 'permits', city, portal: base, status: r.status, error: r.error || null, count: r.json && r.json.result ? r.json.result.count : null, titles: r.json && r.json.result ? r.json.result.results.map((p) => p.title) : trim(String(r.text || '').replace(/\s+/g, ' '), 160) });
      if (r.json && r.json.result) for (const p of r.json.result.results.slice(0, 3)) for (const res of (p.resources || []).slice(0, 2)) {
        if (!res.datastore_active) { out({ lane: 'permits', city, portalResource: res.name, format: res.format, url: trim(res.url, 200) }); continue; }
        const h = await req(`${base}/api/3/action/datastore_search?resource_id=${res.id}&limit=2`, { timeoutMs: 20000 });
        out({ lane: 'permits', city, portalResource: res.name, id: res.id, total: h.json && h.json.result ? h.json.result.total : null, fields: h.json && h.json.result ? h.json.result.fields.map((f) => f.id) : null, sample: h.json && h.json.result ? trim(h.json.result.records[0], 600) : null });
      }
      await sleep(250); }
    for (const root of gis) await arcgisWalk('permits', city, root);
  }
}
/* round 2: the public ArcGIS Online catalogue (municipal feature services are published there), data.gov.il municipal
   organizations by exact title, the municipal CKAN portals by building terms, and the two municipal engineering platforms
   (Complot, GIS-net V5) — reachability only */
async function permits2() {
  for (const q of ['היתרי בניה', 'היתרי בנייה', 'היתר בניה', 'בקשות להיתר', 'רישוי בניה', 'building permits israel', 'heterim', 'תיקי בניין']) {
    const r = await req(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&num=40&f=json`, { timeoutMs: 30000 });
    const items = (r.json && r.json.results) || [];
    out({ lane: 'permits2', step: 'arcgis-online search', q, status: r.status, total: r.json ? r.json.total : null,
      items: items.filter((i) => /Feature Service|Map Service|Feature Layer|CSV|Web Map/.test(i.type)).map((i) => ({ title: i.title, type: i.type, owner: i.owner, access: i.access, url: i.url, modified: i.modified ? new Date(i.modified).toISOString().slice(0, 10) : null, tags: (i.tags || []).slice(0, 6) })).slice(0, 40) });
    for (const i of items.filter((x) => x.url && /FeatureServer|MapServer/.test(x.url) && /היתר|permit|heter|רישוי|בני/i.test(x.title)).slice(0, 6)) {
      const m = await req(`${i.url}?f=json`, { timeoutMs: 20000 });
      const layers = ((m.json && (m.json.layers || [])) || []).map((l) => ({ id: l.id, name: l.name }));
      out({ lane: 'permits2', item: i.title, owner: i.owner, url: i.url, status: m.status, layers: layers.slice(0, 12) });
      for (const l of (layers.length ? layers : [{ id: null }]).slice(0, 2)) {
        const base = l.id == null ? i.url : `${i.url}/${l.id}`;
        const lm = await req(`${base}?f=json`, { timeoutMs: 20000 });
        const cnt = await req(`${base}/query?where=1%3D1&returnCountOnly=true&f=json`, { timeoutMs: 20000 });
        const q2 = await req(`${base}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json`, { timeoutMs: 20000 });
        out({ lane: 'permits2', item: i.title, layer: base, fields: lm.json && lm.json.fields ? lm.json.fields.map((f) => f.name + (f.alias && f.alias !== f.name ? '(' + f.alias + ')' : '')).slice(0, 50) : null, count: cnt.json ? cnt.json.count : null, sample: q2.json && q2.json.features ? trim(q2.json.features.map((f) => f.attributes), 700) : trim(q2.text, 160) });
        await sleep(200);
      }
    }
    await sleep(400);
  }
  /* data.gov.il municipal organizations — every package title, building-related ones profiled */
  const orgs = await req(`${CKAN}/organization_list?all_fields=true&limit=1000`);
  for (const o of ((orgs.json && orgs.json.result) || []).filter((x) => /עיריית|עירית|מועצה/.test(x.title || ''))) {
    const r = await req(`${CKAN}/package_search?fq=organization:${encodeURIComponent(o.name)}&rows=200`);
    const pk = (r.json && r.json.result && r.json.result.results) || [];
    out({ lane: 'permits2', org: o.title, packages: pk.map((p) => p.title) });
    for (const p of pk.filter((p) => /בני|היתר|רישוי|מבנ|תיק/.test(p.title)).slice(0, 5)) await ckanFields('permits2', p);
  }
  /* municipal CKAN portals that answered in round 1 — building terms */
  for (const base of ['https://opendata.haifa.muni.il', 'https://jerusalem.datacity.org.il']) for (const q of ['בניה', 'בנייה', 'רישוי', 'היתרים', 'מבנים']) {
    const r = await req(`${base}/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=20`, { timeoutMs: 20000 });
    out({ lane: 'permits2', portal: base, q, status: r.status, count: r.json && r.json.result ? r.json.result.count : null, titles: r.json && r.json.result ? r.json.result.results.map((p) => `${p.title} [${(p.organization || {}).title || ''}]`) : trim(r.text, 120) });
    await sleep(250);
  }
  /* the municipal engineering platforms (reachability; no form submission, no scraping) */
  for (const [name, url] of [['complot:handasi', 'https://handasi.complot.co.il/handasi2016/'], ['complot:bakashot', 'https://bakashot.complot.co.il/'], ['gisnet:v5', 'https://v5.gis-net.co.il/v5/'],
    ['jerusalem:handasa', 'https://handasa.jerusalem.muni.il/'], ['haifa:engineering', 'https://www.haifa.muni.il/'], ['rishuy:national', 'https://www.gov.il/he/departments/topics/building_licensing'], ['iplan:rishuy-zamin', 'https://rishuy.iplan.gov.il/']]) await probe('permits2', name, url);
}
async function execution() {
  await searchAndProfile('execution', ['התחלות בנייה', 'גמר בנייה', 'התקדמות בנייה', 'פרויקטים בבנייה', 'אכלוס', 'אתרי בנייה', 'בניה רוויה'], 12, 4);
  const h = await ds('1ec45809-5927-430a-9b30-77f77f528ce3', { limit: 3 });
  out({ lane: 'execution', step: 'moch construction progress', total: h.result ? h.result.total : null, fields: h.result ? h.result.fields.map((f) => f.id) : null, sample: h.result ? trim(h.result.records[0], 900) : h.error });
}
async function sales() {
  await searchAndProfile('sales', ['מכירת דירות', 'דירות שנמכרו', 'מכירות דירות חדשות', 'מלאי דירות', 'דירה בהנחה', 'מחיר למשתכן', 'עסקאות נדלן', 'חוזים שנחתמו'], 12, 3);
  const h = await ds('7c8255d0-49ef-49db-8904-4cf917586031', { limit: 2 });
  out({ lane: 'sales', step: 'moch dira behanacha periodic data — every field', total: h.result ? h.result.total : null, fields: h.result ? h.result.fields.map((f) => f.id) : null });
}

(async () => {
  out({ lane: 'meta', at: new Date().toISOString(), node: process.version, argv: process.argv.slice(2) });
  if (has('finance')) await finance();
  if (has('ownership')) await ownership();
  if (has('litigation')) await litigation();
  if (has('permits')) await permits();
  if (has('permits2')) await permits2();
  if (has('execution')) await execution();
  if (has('sales')) await sales();
  if (has('companies')) await companies();
  if (has('legal')) await legal();
  if (has('public')) await publicFilings();
  if (has('contractors')) await contractors();
  if (has('sites')) await sites();
  if (has('insolvency')) await insolvency();
  if (has('pledges')) await pledges();
  if (has('tlv')) await tlv();
  out({ lane: 'meta', done: true });
})().catch((e) => { out({ lane: 'meta', fatal: String(e && e.stack || e) }); process.exit(1); });
