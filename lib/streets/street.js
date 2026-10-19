// PROPX · STREET INTELLIGENCE — one official street, composed from layers that never stand in for each other:
//
//   IDENTITY      the official directory row (lib/streets/directory.js): st:<locality>:<street code>, name, kind (street /
//                 address area / site), status (current / historical), its official synonyms, the locality and district
//   MARKET        the register deals OBSERVED on this street (lib/streets/evidence.js — only deals whose parcel's every
//                 address is on this street), their sample state and statistics; POSSIBLE deals apart, never aggregated
//   CONTEXT       the locality's dwelling market in the same window, and a neighbourhood ONLY through a verified street link —
//                 "these figures describe the surrounding market, not observed prices on this street"
//   LINKS         records that carry this street in their own address, joined by the same exact rungs (official name →
//                 official synonym → normalized name; ambiguity never picks): Tel Aviv-Yafo building permits and construction
//                 sites (municipal coverage — no other municipality publishes them in a form PROPX reads)
//   KNOWS / DOES NOT KNOW   stated per street, from what was read — never filled
// A street without an observed deal is still a full street page: identity, the empty evidence state ("no observed
// transactions" — not a zero price), the context, the links.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SD = require('./directory');
const EV = require('./evidence');
const M = require('./match');
const { resolveNeighborhood } = require('../geo/neighborhoods');

const TLV = 5000;
const TLV_FILE = path.join(__dirname, '..', '..', 'data', 'dd', 'tlv.json');
const KIND_LABEL = { street: 'STREET', area: 'ADDRESS AREA', site: 'SITE' };

let REG = null;
const registry = () => { if (!REG) { try { REG = require('../geo/registry'); } catch { REG = null; } } return REG; };

/* ── Tel Aviv-Yafo permits + construction sites by the exact street they name ── */
let TLV_IDX = null;
function tlvLinks(D) {
  if (TLV_IDX && TLV_IDX.dir === D.dir) return TLV_IDX;
  const byStreet = new Map(), meta = { available: false, permits: 0, sites: 0, linkedPermits: 0, linkedSites: 0, ambiguous: 0, unresolved: 0 };
  let doc = null; try { doc = JSON.parse(fs.readFileSync(TLV_FILE, 'utf8')); } catch { /* not bundled */ }
  if (doc) {
    meta.available = true; meta.fetchedAt = doc.fetchedAt || null; meta.source = 'tlv:iview2:permits-772';
    const LI = M.localityIndex(D, TLV);
    /* the layer repeats one request in several rows (one per layer object): one record per street per request + permit
       (per site file), its rows counted in `rows` */
    const seen = new Map();
    const put = (code, item) => {
      const k = code + '|' + item.kind + '|' + (item.kind === 'permit' ? item.request + '|' + item.permit : item.tik);
      if (seen.has(k)) {
        const rec = seen.get(k); rec.rows++;
        const hs = new Set([...(rec.house ? rec.house.split(', ') : []), ...(item.house ? item.house.split(', ') : [])]);
        rec.house = hs.size ? [...hs].join(', ') : null;
        return;
      }
      const rec = { ...item, rows: 1 }; seen.set(k, rec);
      if (!byStreet.has(code)) byStreet.set(code, []); byStreet.get(code).push(rec);
    };
    /* a record naming several addresses links to each street it names exactly; `streetsNamed` says how many */
    const link = (text, mk) => {
      const hits = new Map();
      for (const part of String(text || '').split(',')) {
        const a = M.parseAddress(part); if (!a.street) continue;
        const r = M.resolveStreet(LI, a.street);
        if (!r) { meta.unresolved++; continue; }
        if (r.ambiguous) { meta.ambiguous++; continue; }
        const code = SD.parseId(r.id).streetCode;
        if (!hits.has(code)) hits.set(code, { via: r.via, houses: [] });
        if (a.house && !hits.get(code).houses.includes(a.house)) hits.get(code).houses.push(a.house);
      }
      for (const [code, h] of hits) put(code, { ...mk(h.via, h.houses.join(', ') || null), streetsNamed: hits.size });
      return hits.size > 0;
    };
    const permits = (doc.permits && doc.permits.rows) || [], sites = (doc.sites && doc.sites.rows) || [];
    meta.permits = permits.length; meta.sites = sites.length;
    for (const p of permits) if (link(p.addresses, (via, house) => ({ kind: 'permit', request: p.request, permit: p.permit || null, permitDate: p.permitDate || null,
      opened: p.opened || null, start: p.start || null, finished: p.finished || null, occupation: p.occupation || null, units: p.units != null ? p.units : null,
      type: p.type || null, stage: p.stage || null, address: p.addresses || null, house, via }))) meta.linkedPermits++;
    for (const s of sites) if (link(s.address, (via, house) => ({ kind: 'site', tik: s.tik, permits: s.permits || [], state: s.state || null, start: s.start || null,
      use: s.use || null, type: s.type || null, address: s.address || null, parcel: s.parcel || null, house, via }))) meta.linkedSites++;
  }
  TLV_IDX = { dir: D.dir, byStreet, meta };
  return TLV_IDX;
}

let NB_DOC;
const nbDoc = () => { if (NB_DOC === undefined) { try { NB_DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'geo', 'neighborhoods.json'), 'utf8')); } catch { NB_DOC = null; } } return NB_DOC; };

/** the official street, or null for an id the directory does not hold */
function identity(id, D) {
  const s = D.byId.get(String(id || ''));
  if (!s || s.kind === SD.KIND.LOCALITY) return null;
  const loc = D.localities.get(s.cityCode) || {};
  const G = registry() && registry().loadGeo();
  const l = G ? G.byCode.get(s.cityCode) : null;
  return { id: s.id, name: s.name, kind: s.kind, kindLabel: KIND_LABEL[s.kind] || s.kind, status: s.status, firstSeen: s.firstSeen, retiredAt: s.retiredAt,
    cityCode: s.cityCode, streetCode: s.code, city: l ? l.he : loc.he || null, cityEn: l ? l.en || null : null, cityId: 'loc:' + s.cityCode,
    district: (l && l.district) || loc.district || null, region: loc.regionName || null,
    synonyms: (D.synByStreet.get(s.id) || []).map((y) => y.name).sort((a, b) => a.localeCompare(b, 'he')) };
}

function knowsOf(idn, ev, links, ctx) {
  const knows = ['official-street'], not = ['asking-prices', 'rents', 'confirmed-new', 'deals-after-copy'];
  if (idn.synonyms.length) knows.push('official-synonyms');
  if (!ev || !ev.swept) not.push(ev && ev.state === EV.STATE.NOT_SWEPT ? 'locality-not-swept' : 'evidence-not-loaded');
  else {
    const st = ev.stats;
    if (st.observed) knows.push('observed-deals'); else not.push('no-observed-deals');
    if (st.medianPrice != null) knows.push('street-median'); else if (st.observed) not.push('street-price-insufficient');
    if (ev.possible.length) knows.push('possible-deals');
    if (st.probableNew) knows.push('probable-new');
    not.push('unaddressed-deals');
  }
  if (links.permits.length || links.sites.length) knows.push('tlv-permits'); else not.push(idn.cityCode === TLV ? 'no-tlv-permits' : 'permits-outside-tlv');
  if (!ctx.neighbourhood.resolved) not.push('neighbourhood-unlinked');
  return { knows, doesNotKnow: not };
}

/**
 * The Street Intelligence read of one official street id.
 * @param {string} id st:<locality>:<street>
 * @param {object} [opt] {limit: deals listed (default 120, max 500), dir}
 */
function street(id, opt = {}) {
  const D = SD.load();
  const idn = identity(id, D);
  if (!idn) return null;
  const limit = Math.max(1, Math.min(500, Number(opt.limit) || 120));
  const ev = EV.street(idn.id, { dir: opt.dir });
  const loc = EV.locality(idn.cityCode, { dir: opt.dir });
  const nb = resolveNeighborhood(idn.city || '', idn.name);
  let nbStats = null;
  if (nb.resolved && nb.method === 'verified-street-link') {
    /* the streets this neighbourhood's verified links name, resolved exactly inside the locality */
    const LI = M.localityIndex(D, idn.cityCode);
    const doc = nbDoc();
    const codes = doc ? doc.streetLinks.filter((x) => x.neighborhoodId === nb.id).map((x) => M.resolveStreet(LI, x.street)).filter((r) => r && r.id).map((r) => SD.parseId(r.id).streetCode) : [];
    const uniq = [...new Set(codes)];
    nbStats = uniq.length ? EV.neighbourhood(idn.cityCode, uniq, { dir: opt.dir }) : null;
    /* the neighbourhood figure is the OBSERVED dwelling deals on these whole streets (a verified link names a street,
       not a stretch of it) — the streets are listed so the basis is visible */
    if (nbStats) nbStats.streetNames = uniq.map((c) => (D.byId.get(SD.streetId(idn.cityCode, c)) || {}).name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'he'));
  }
  const T = idn.cityCode === TLV ? tlvLinks(D) : null;
  const tl = T ? T.byStreet.get(idn.streetCode) || [] : [];
  const links = { coverage: idn.cityCode === TLV ? 'TLV_MUNICIPAL' : 'NOT_COVERED', source: T ? T.meta.source || null : null, fetchedAt: T ? T.meta.fetchedAt || null : null,
    permits: tl.filter((x) => x.kind === 'permit').sort((a, b) => String(b.opened || '').localeCompare(String(a.opened || ''))).slice(0, 60),
    sites: tl.filter((x) => x.kind === 'site').sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))).slice(0, 60),
    totals: { permits: tl.filter((x) => x.kind === 'permit').length, sites: tl.filter((x) => x.kind === 'site').length } };
  const ctx = {
    note: 'These figures describe the surrounding market, not observed prices on this street.',
    locality: loc && loc.swept ? { cityCode: idn.cityCode, window: loc.window, dwelling: loc.dwelling, addressStates: loc.addressStates,
      state: loc.stats.state, priced: loc.stats.priced, medianPrice: loc.stats.medianPrice, medianPricePerSqm: loc.stats.medianPricePerSqm, last12: loc.stats.last12,
      latest: loc.stats.latest ? loc.stats.latest.date : null, cls: 'DERIVED', basis: 'median of the locality\'s priced dwelling deals in the window (every address state)' }
      : { state: loc ? loc.state : null, reason: loc ? 'locality-not-swept' : 'evidence-not-loaded' },
    neighbourhood: nb.resolved && nb.method === 'verified-street-link'
      ? { resolved: true, name: nb.name, id: nb.id, method: nb.method, source: nb.source,
        stats: nbStats ? { streets: nbStats.streets, streetNames: nbStats.streetNames, basis: 'observed dwelling deals on the verified-linked streets (whole streets)',
          state: nbStats.stats.state, priced: nbStats.stats.priced, medianPrice: nbStats.stats.medianPrice, medianPricePerSqm: nbStats.stats.medianPricePerSqm } : null }
      : { resolved: false, reason: 'no verified street → neighbourhood link (PROPX never infers a neighbourhood)' },
  };
  const evidence = ev && ev.swept ? { ...ev, deals: ev.deals.slice(0, limit), dealsTotal: ev.deals.length, possible: ev.possible.slice(0, 60), possibleTotal: ev.possible.length } : ev;
  const meta = D.meta || {};
  return {
    id: idn.id, identity: idn,
    directory: { source: SD.SOURCES.streets, synonymsSource: SD.SOURCES.synonyms, registryUpdated: meta.sources && meta.sources.streets ? meta.sources.streets.lastModified : null,
      synonymsUpdated: meta.sources && meta.sources.synonyms ? meta.sources.synonyms.lastModified : null, checkedAt: meta.fetchedAt || null, cls: 'OFFICIAL' },
    evidence: evidence || { swept: false, state: null, reason: 'evidence-not-loaded' },
    context: ctx, links, ...knowsOf(idn, ev, links, ctx),
    terms: ['street_directory', 'official_street_id', 'street_market_evidence_status', 'street_observed_deal', 'street_median_price', 'street_median_price_per_sqm',
      'street_sample_size', 'street_context', 'probable_new_transaction'],
  };
}

module.exports = { street, identity, tlvLinks, KIND_LABEL };
