// PROPX · due-diligence data access (18.10.2026) — the slim keyed rows data/dd/ holds (lib/dd/sync.js), indexed once per
// data stamp for the read models. Bundled by static require (the Vercel function bundle traces them); a `dataDir` override
// reads from disk (tests, scripts). Nothing here computes a fact: it indexes what the sync kept.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const R = require('../entities/resolve');

const ROOT = path.join(__dirname, '..', '..', 'data', 'dd');
let B = {};
try { B.companies = require('../../data/dd/companies.json'); } catch { B.companies = null; }
try { B.partnerships = require('../../data/dd/partnerships.json'); } catch { B.partnerships = null; }
try { B.filings = require('../../data/dd/filings.json'); } catch { B.filings = null; }
try { B.insolvency = require('../../data/dd/insolvency.json'); } catch { B.insolvency = null; }
try { B.contractors = require('../../data/dd/contractors.json'); } catch { B.contractors = null; }
try { B.sites = require('../../data/dd/sites.json'); } catch { B.sites = null; }
try { B.tlv = require('../../data/dd/tlv.json'); } catch { B.tlv = null; }
try { B.latest = require('../../data/dd/latest.json'); } catch { B.latest = null; }
try { B.history = require('../../data/dd/history-recent.json'); } catch { B.history = null; }
let GEO = null; try { GEO = require('../../data/geo/localities.json'); } catch { GEO = null; }

const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const push = (m, k, v) => { if (k == null || k === '') return; const s = String(k); if (!m.has(s)) m.set(s, []); m.get(s).push(v); };
/** an official locality name as the Labour list / the municipality writes it → the registry's spelling (exact after whitespace, hyphen and quote normalization — never fuzzy) */
const cityKey = (s) => String(s || '').normalize('NFC').replace(/[״“”"'׳‘’]/g, '').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
const parcelKeyOf = (s) => { const m = String(s || '').match(/^\s*0*(\d+)\s*\/\s*0*(\d+)\s*$/); return m ? `parcel:${Number(m[1])}/${Number(m[2])}` : null; };

let MEMO = null;
function load({ dataDir = null } = {}) {
  const fromDisk = dataDir && path.resolve(dataDir) !== ROOT;
  const get = (k, f) => (fromDisk ? readJson(path.join(dataDir, f)) : B[k]);
  const latest = get('latest', 'latest.json');
  const stamp = (latest && latest.generatedAt) || null;
  if (!fromDisk && MEMO && MEMO.stamp === stamp) return MEMO;
  const companies = get('companies', 'companies.json'), partnerships = get('partnerships', 'partnerships.json'), filings = get('filings', 'filings.json'), insolvency = get('insolvency', 'insolvency.json'), contractors = get('contractors', 'contractors.json'), sites = get('sites', 'sites.json'), tlv = get('tlv', 'tlv.json'), historyPayload = get('history', 'history-recent.json');
  const C = {
    synced: !!(companies || contractors || sites || tlv), stamp, latest, companies, partnerships, filings, insolvency, contractors, sites, tlv,
    history: (historyPayload && historyPayload.events) || [],
    idx: R.buildIndex(companies, partnerships), cidx: R.buildContractorsIndex(contractors),
    filingsByNum: new Map(), liquidationByNum: new Map(), voluntaryByNum: new Map(),
    sitesByExecutor: new Map(), goneByExecutor: new Map(), sitesByParcel: new Map(), sitesByCityLot: new Map(), sitesByWorkId: new Map(), closedByRegKey: new Map(),
    tlvSitesByParcel: new Map(), tlvSitesByFile: new Map(), tlvSitesByTik: new Map(), tlvPermitsByFile: new Map(), tlvPermitsByRequest: new Map(), tlvPermitsByNumber: new Map(), tlvHoldersByRegKey: new Map(),
    historyByKey: new Map(), localityByName: new Map(), localityByCode: new Map(),
    freshness: {
      companies: companies ? { checkedAt: companies.fetchedAt, sourceModified: companies.sourceModified } : null,
      partnerships: partnerships ? { checkedAt: partnerships.fetchedAt, sourceModified: partnerships.sourceModified } : null,
      filings: filings ? { checkedAt: filings.fetchedAt, sourceModified: filings.sourceModified, window: filings.window } : null,
      insolvency: insolvency ? { checkedAt: insolvency.fetchedAt, sourceModified: insolvency.liquidation && insolvency.liquidation.sourceModified } : null,
      contractors: contractors ? { checkedAt: contractors.fetchedAt, sourceModified: contractors.sourceModified } : null,
      sites: sites ? { checkedAt: sites.fetchedAt, sourceModified: sites.sourceModified } : null,
      tlv: tlv ? { checkedAt: tlv.fetchedAt, imported: tlv.permits && tlv.permits.imported } : null,
    },
  };
  for (const r of (filings && filings.rows) || []) push(C.filingsByNum, r.num, r);
  for (const m of C.filingsByNum.values()) m.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const r of (insolvency && insolvency.liquidation && insolvency.liquidation.rows) || []) push(C.liquidationByNum, r.num, r);
  for (const r of (insolvency && insolvency.voluntaryFast && insolvency.voluntaryFast.rows) || []) push(C.voluntaryByNum, r.num, r);
  const geoRows = GEO ? (Array.isArray(GEO) ? GEO : GEO.records || GEO.localities || []) : [];
  for (const g of geoRows) { if (g && g.code != null) { C.localityByCode.set(String(g.code), g); if (g.he) C.localityByName.set(cityKey(g.he), g); } }
  for (const r of (sites && sites.active) || []) {
    C.sitesByWorkId.set(String(r.workId), r);
    if (r.executorId != null) push(C.sitesByExecutor, r.executorId, r);
    const pc = R.parseParcel(r.name); if (pc) push(C.sitesByParcel, pc.key, r);
    const lot = R.parseLotNumber(r.name); const loc = r.city ? C.localityByName.get(cityKey(r.city)) : null; if (lot != null && loc) push(C.sitesByCityLot, `${loc.code}|${lot}`, r);
  }
  for (const r of (sites && sites.gone) || []) if (r.executorId != null) push(C.goneByExecutor, r.executorId, r);
  for (const r of (sites && sites.closed && sites.closed.rows) || []) push(C.closedByRegKey, R.regKey(r.executorName), r);
  /* the sites layer carries several rows per supervision file (tik) — one site per tik: parcels and permit numbers united,
     the state / dates of the row with the latest supervision date */
  for (const r of (tlv && tlv.sites && tlv.sites.rows) || []) {
    const k = String(r.tik); const cur = C.tlvSitesByTik.get(k);
    const pc = R.parseParcel(r.parcel);
    if (!cur) C.tlvSitesByTik.set(k, { ...r, parcels: pc ? [pc.key] : [], permits: [...new Set(r.permits || [])], holderList: [...new Set(String(r.holders || '').split(/\s*,\s*/).map((h) => h.trim()).filter(Boolean))], rows: 1 });
    else {
      if (pc && !cur.parcels.includes(pc.key)) cur.parcels.push(pc.key);
      for (const x of r.permits || []) if (!cur.permits.includes(x)) cur.permits.push(x);
      for (const h of String(r.holders || '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)) if (!cur.holderList.includes(h)) cur.holderList.push(h);
      cur.rows++;
      if (String(r.supervisionDate || '') > String(cur.supervisionDate || '')) Object.assign(cur, { state: r.state, start: r.start || cur.start, supervision: r.supervision, supervisionDate: r.supervisionDate, use: r.use, address: r.address || cur.address });
    }
  }
  for (const site of C.tlvSitesByTik.values()) {
    for (const k of site.parcels) push(C.tlvSitesByParcel, k, site);
    if (site.file) push(C.tlvSitesByFile, site.file, site);
    for (const h of site.holderList) { const k = R.regKey(h); if (k) push(C.tlvHoldersByRegKey, k, site); }
  }
  for (const r of (tlv && tlv.permits && tlv.permits.rows) || []) { if (r.file) push(C.tlvPermitsByFile, r.file, r); if (r.permit) push(C.tlvPermitsByNumber, r.permit, r); C.tlvPermitsByRequest.set(String(r.request), r); }
  for (const e of C.history) push(C.historyByKey, e.key, e);
  if (!fromDisk) MEMO = C;
  return C;
}

/** "<locality code>|<lot number>" → the distinct plan|lot pairs the Authority's lot files carry in that locality (all tenders, any
    lifecycle) — a lot number written in a site name fits ONE pair or it is ambiguous */
let LOT_MEMO = null;
function lotIndex(tenders, stamp = null) {
  if (LOT_MEMO && LOT_MEMO.stamp === stamp && stamp != null) return LOT_MEMO.map;
  const m = new Map();
  for (const t of tenders || []) for (const l of t.lotRefs || []) for (const k of l.keys || []) {
    const [plan, lot] = String(k).split('|'); const n = Number(lot); if (!Number.isFinite(n)) continue;
    const key = `${t.localityCode}|${n}`; if (!m.has(key)) m.set(key, new Set()); m.get(key).add(`${String(plan).replace(/\s+/g, '')}|${n}`);
  }
  LOT_MEMO = { stamp, map: m }; return m;
}

module.exports = { load, lotIndex, cityKey, parcelKeyOf, ROOT };
