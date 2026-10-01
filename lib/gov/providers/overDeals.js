// PROPX · provider: the Israel Tax Authority's deals register as REPUBLISHED by
// גרסאות לעם (over.org.il) — an independent transparency project, not a
// government channel.
//
// WHY (decision of PROPX's owner, 02.10.2026): on 29.09.2026 the Tax Authority
// put an identification screen in front of its own register against automated
// reading, and GovMap's edge refuses PROPX's server (HTTP 403). No official
// channel answers. over.org.il published a copy of the register, taken from
// the Authority's real-estate information system (nadlan.taxes.gov.il) on
// 19.09.2026 — 3.84M deals since 1998 — behind a public, documented API with
// no key (OpenAPI at /openapi.json). Nothing is worked around: PROPX reads a
// public API as its publisher offers it.
//
// WHAT THE ROWS ARE — and are not:
//   · each row is a deal as the register published it: date, reported amount,
//     nature (מהות), rooms, area, year built, portion sold, gush / helka /
//     sub-parcel, settlement. Values pass through; a missing or zero value
//     stays null; nothing is estimated here;
//   · the CHANNEL is not governmental: every row carries deliveredVia
//     'over.org.il' and channel 'independent-republication', and the page
//     says so — never "official source";
//   · the register has NO address. over.org.il links addresses to a parcel
//     (its נדל"ן לעם crosswalk); a row's street / house come from that link
//     and are marked addressBasis 'parcel-crosswalk', with every candidate
//     address of the parcel. Many parcels have no linked address: the street
//     then stays null;
//   · no neighborhood (never inferred), no coordinates;
//   · no first / second-hand flag: newness only from year built vs deal year
//     (classifyNewness → probable_new / second_hand / unknown);
//   · a portion below 1 means a share of the property was sold for that
//     amount: the row is kept, marked partialSale, and never priced per m²;
//   · one row can be one flat or a whole building, so statistics are medians;
//   · the copy is a SNAPSHOT (stats.scraped_at): deals reported to the Tax
//     Authority after it do not appear until the publisher refreshes it.
//
// ENDPOINTS (base https://www.over.org.il):
//   GET /api/deals/settlements → {data:[{settlement, settlement_code, deals, last_deal, resolved_code}]}
//   GET /api/deals/stats       → {deals, first_deal, last_deal, scraped_at, source_url, …}
//   GET /api/deals/search?settlement&street&house&date_from=YYYY-MM-DD&sort=date_desc&limit(≤200)&offset
//       → {data:[deal…], total (counted to 10,000, then total_capped), address:{status, addresses, linked, parcels}}
//
// Disable instantly with GOV_OVER_DISABLED=1.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GovernmentRealEstateProvider } = require('./base');
const { makeTransaction, toNumber, toIsoDate } = require('../schema');
const { classifyNewness } = require('../classify');
const { classifyPropertyType } = require('../propertyType');
const { normHe } = require('../../geo/registry');

const BASE = process.env.GOV_OVER_BASE || 'https://www.over.org.il';
const AUTHORITY = 'רשות המסים — מאגר מידע נדל"ן; פרסום מחדש: גרסאות לעם (over.org.il)';
const UA = 'PROPX/1.0 (+https://github.com/kobi6061-hub/vizora)';
const MAX_PAGE = 200;            // the search refuses more (HTTP 422, le=200)
const LIST_TTL = 12 * 3600e3;    // the settlement list and the stats: twice a day
const PAGE_TTL = 10 * 60e3;      // one search answer, shared by the requests of one warm instance
const PAGE_CACHE_MAX = 300;
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const positive = (n) => (n != null && n > 0 ? n : null);

/* PROPX's own locality registry: a name (or an official former name) → its CBS
   code, so the register's spellings of the same locality are all found */
let LOCALITIES = null;
function localityFor(city) {
  if (LOCALITIES === null) {
    LOCALITIES = [];
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'geo', 'localities.json'), 'utf8'));
      LOCALITIES = (doc.localities || []).map((l) => ({ code: l.code, names: [l.he, ...(l.aliases || [])].map(normHe) }));
    } catch { /* registry not bundled: names alone are matched */ }
  }
  const k = normHe(city);
  return LOCALITIES.find((l) => l.names.includes(k)) || null;
}

/** "שד רגר יצחק 95" → {street:"שד רגר יצחק", house:"95"}; no number → the whole text is the street */
function splitAddress(a) {
  const s = norm(a);
  const m = s.match(/^(.*\S)\s+(\d+\s*[א-ת]?)$/);
  return m ? { street: m[1], house: m[2].replace(/\s+/g, '') } : { street: s, house: null };
}

class OverDealsProvider extends GovernmentRealEstateProvider {
  constructor(opts = {}) {
    super('over.org.il', opts);
    this.base = (opts.overBase || BASE).replace(/\/$/, '');
    this.disabled = opts.overDisabled ?? process.env.GOV_OVER_DISABLED === '1';
    this.timeoutMs = opts.overTimeoutMs || 8000;
    this.clock = opts.clock || Date.now;
    this.pages = new Map();     // url → {at, body}
    this.lists = {};            // name → {at, body, inflight}
  }

  enabled() { return !this.disabled; }
  capabilities() { return ['getTransactions', 'getStreetTransactions']; }
  /** the register is paged by offset — the service may ask for page 2 of a scope */
  supportsPaging() { return true; }

  requireEnabled(cap) {
    if (this.disabled) this.unavailable(cap, 'over.org.il provider disabled via GOV_OVER_DISABLED=1');
  }

  /* ---------------- transport ---------------- */

  async get(url, cap) {
    if (!this.fetchImpl) this.unavailable(cap, 'no fetch implementation available in this runtime');
    const init = { headers: { 'User-Agent': UA, Accept: 'application/json' } };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(this.timeoutMs);
    const r = await this.fetchImpl(url, init);
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return r.json();
  }

  /** a slowly-changing document (settlement list, stats), shared by concurrent requests */
  async list(name, cap) {
    const c = this.lists[name];
    if (c && c.body && this.clock() - c.at < LIST_TTL) return c.body;
    if (c && c.inflight) return c.inflight;
    const inflight = this.get(this.base + '/api/deals/' + name, cap)
      .then((body) => { this.lists[name] = { at: this.clock(), body }; return body; })
      .catch((e) => { this.lists[name] = c && c.body ? { ...c, inflight: null } : null; throw e; });
    this.lists[name] = { ...(c || {}), inflight };
    return inflight;
  }

  async stats(cap) {
    try { return await this.list('stats', cap); } catch { return null; }   // freshness is reported when known, never invented
  }

  async search(params, cap) {
    const u = new URL(this.base + '/api/deals/search');
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
    const url = u.toString();
    const hit = this.pages.get(url);
    if (hit && this.clock() - hit.at < PAGE_TTL) return { url, body: hit.body, cached: true };
    const body = await this.get(url, cap);
    this.pages.set(url, { at: this.clock(), body });
    if (this.pages.size > PAGE_CACHE_MAX) this.pages.delete(this.pages.keys().next().value);
    return { url, body, cached: false };
  }

  /* ---------------- settlement names ---------------- */

  /** every spelling the register uses for this locality: its own code, or the
   *  locality's name and official former names (PROPX registry) */
  async settlementNames(city, cap) {
    const body = await this.list('settlements', cap);
    const all = Array.isArray(body) ? body : body.data || [];
    const loc = localityFor(city);
    const keys = new Set([normHe(city), ...(loc ? loc.names : [])]);
    const code = loc && loc.code != null ? String(loc.code) : null;
    const hits = all.filter((s) => s && s.settlement &&
      ((code && String(s.settlement_code ?? '') === code) || keys.has(normHe(s.settlement))));
    if (!hits.length) this.unavailable(cap, `no settlement "${norm(city)}" in the republished register`);
    hits.sort((a, b) => (Number(b.deals) || 0) - (Number(a.deals) || 0));
    return { names: [...new Set(hits.map((s) => s.settlement))], code, matchedBy: code ? 'cbs-code+name' : 'name',
      perName: Object.fromEntries(hits.map((s) => [s.settlement, { deals: Number(s.deals) || null, lastDeal: s.last_deal || null }])) };
  }

  /* ---------------- normalization ---------------- */

  /**
   * @param {object} d   one deal of /api/deals/search
   * @param {object} ctx {sourceUrl, retrievedAt, responseId, snapshotAt, street?, scopeLevel?}
   */
  normalizeDeal(d, ctx = {}) {
    const date = toIsoDate(d.date) || toIsoDate(d.date_src);
    const yb = toNumber(d.year_built);
    const yearBuilt = yb && yb > 1800 ? yb : null;
    const pt = classifyPropertyType(d.nature);
    const cls = classifyNewness({ dealNature: d.nature, yearBuilt, dealYear: date ? Number(date.slice(0, 4)) : null });
    const addrs = (Array.isArray(d.addresses) ? d.addresses : []).map(norm).filter(Boolean);
    // on a street query, the parcel's address on THAT street is the one shown
    const want = ctx.street ? normHe(ctx.street) : '';
    const chosen = addrs.find((a) => want && normHe(splitAddress(a).street).includes(want)) || addrs[0] || null;
    const a = chosen ? splitAddress(chosen) : null;
    const fraction = toNumber(d.portion_fraction);
    const tx = makeTransaction({
      txId: null,                                   // the register publishes no deal id
      date,
      price: positive(toNumber(d.amount)),
      areaSqm: positive(toNumber(d.area_sqm)),
      rooms: positive(toNumber(d.rooms)),
      floor: null,                                  // not in the register
      yearBuilt,
      city: norm(d.settlement) || null,
      street: a ? a.street : null,
      houseNumber: a ? a.house : null,
      neighborhood: null,                           // not in the register — never inferred
      block: d.gush != null && d.gush !== '' ? String(d.gush) : null,
      parcel: d.helka != null && d.helka !== '' ? String(d.helka) : null,
      subParcel: d.sub_parcel != null && d.sub_parcel !== '' ? String(d.sub_parcel) : null,
      propertyClass: pt.propertyClass,
      dealType: norm(d.nature) || null,
      sourceClassification: null,                   // the register has no first / second-hand flag
      newness: cls.newness,
      newnessEvidence: cls.evidence.concat(pt.evidence),
    }, {
      source: this.name,
      sourceAuthority: AUTHORITY,
      sourceDataset: 'Tax Authority deals register, republished copy (over.org.il /api/deals/search)',
      sourceUrl: ctx.sourceUrl || null,
      sourceTimestamp: ctx.snapshotAt || null,      // when the publisher copied the register
      retrievalMethod: 'live-api',
      retrievedAt: ctx.retrievedAt || this.now(),
      responseId: ctx.responseId || null,
      raw: d,
    });
    tx.sourceFamily = 'OFFICIAL_GOVERNMENT';        // the values are the register's own …
    tx.deliveredVia = 'over.org.il';                // … the channel is not governmental
    tx.channel = 'independent-republication';
    tx.cityCode = d.settlement_code != null && d.settlement_code !== '' ? String(d.settlement_code) : null;
    if (a) {
      tx.addressBasis = 'parcel-crosswalk';
      tx.addressCandidates = addrs.slice(0, 8);
      tx.addressesTotal = toNumber(d.addresses_total) ?? addrs.length;
    }
    if (fraction != null && fraction < 1) {
      tx.partialSale = true;
      tx.portion = { text: String(d.portion ?? fraction), fraction };
      // the amount pays for a share of the whole area — no price per m² is honest here
      tx.pricePerSqm = null;
      if (!tx.missing.includes('pricePerSqm')) tx.missing.push('pricePerSqm');
    }
    tx.distanceM = null;
    tx.distanceBasis = ctx.scopeLevel ? 'within ' + ctx.scopeLevel + ' scope' : null;
    return tx;
  }

  /* ---------------- capability surface ---------------- */

  async query(location, filters, cap, level) {
    this.requireEnabled(cap);
    if (!location || !norm(location.city)) this.unavailable(cap, 'a locality is required');
    const set = await this.settlementNames(location.city, cap);
    const st = await this.stats(cap);
    const limit = Math.max(1, Math.min(MAX_PAGE, Number(filters.limit) || 120));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const months = Number(filters.months) || null;
    const dateFrom = months ? new Date(this.clock() - months * 30.44 * 86400e3).toISOString().slice(0, 10) : undefined;
    const street = level !== 'locality' ? norm(location.street) || undefined : undefined;
    const house = level === 'building' && location.houseNumber != null ? norm(location.houseNumber) : undefined;
    const answers = await Promise.all(set.names.map((settlement) => this.search({
      settlement, street, house, date_from: dateFrom, sort: 'date_desc', limit, offset }, cap)));
    const out = [];
    let total = 0, capped = false, more = false, link = null;
    for (const { url, body } of answers) {
      const retrievedAt = this.now(), responseId = `${url}@${retrievedAt}#${(this.responseSeq = (this.responseSeq || 0) + 1)}`;
      const data = Array.isArray(body.data) ? body.data : [];
      for (const d of data) out.push(this.normalizeDeal(d, { sourceUrl: url, retrievedAt, responseId,
        snapshotAt: st && st.scraped_at, street, scopeLevel: level }));
      const n = Number(body.total);
      if (Number.isFinite(n)) total += n;
      if (body.total_capped) capped = true;
      if (Number.isFinite(n) ? offset + data.length < n || body.total_capped : data.length >= limit) more = true;
      if (body.address && typeof body.address === 'object') link = link || {
        status: body.address.status || null, addresses: toNumber(body.address.addresses), linked: toNumber(body.address.linked),
        parcels: Array.isArray(body.address.parcels) ? body.address.parcels.length : null };
    }
    out.sort((p, q) => (q.date || '').localeCompare(p.date || ''));   // ISO desc across spellings
    out.diagnostics = {
      kind: 'register-search',
      deliveredVia: 'over.org.il',
      level,
      settlements: set.names,
      matchedBy: set.matchedBy,
      dateFrom: dateFrom || null,
      offset, limit,
      rowsRetrieved: out.length,
      totalReported: total,          // the register's count for this filter (counted to 10,000 per spelling)
      totalCapped: capped,
      more,
      addressLink: link,             // street / house queries: how the address reached parcels
      snapshotAt: st && st.scraped_at ? String(st.scraped_at) : null,
      latestInRegister: st && st.last_deal ? String(st.last_deal) : null,
      registerSource: st && st.source_url ? String(st.source_url) : null,
    };
    return out;
  }

  /** locality, or one building when city + street + house are given */
  async getTransactions(location, filters = {}) {
    const level = location && location.street && location.houseNumber != null ? 'building' : 'locality';
    return this.query(location, filters, 'getTransactions', level);
  }

  async getStreetTransactions(street, filters = {}) {
    if (!street || !norm(street.street)) this.unavailable('getStreetTransactions', 'a street is required');
    return this.query(street, filters, 'getStreetTransactions', 'street');
  }
}

module.exports = { OverDealsProvider, splitAddress };
