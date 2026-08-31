// PROPX · provider: GovMap real-estate deals (govmap.gov.il — the State of
// Israel mapping portal; its "עסקאות נדל"ן" layer serves the Tax Authority's
// reported transactions).
//
// WHY THIS SOURCE: the Tax Authority's own portal (nadlan.gov.il) offers no
// supported machine interface, but GovMap — an official government platform —
// publicly serves the same reported-deals layer through its API endpoints
// (also used by its own public site). No CAPTCHA is bypassed, no private
// third-party API is involved. The endpoint family is public but not formally
// documented as a stable contract, so this provider: sends an honest
// User-Agent, rate-limits, degrades gracefully on any change, and can be
// disabled instantly with GOV_GOVMAP_DISABLED=1. Contract verified against
// the open-source GovmapClient (github.com/nitzpo/nadlan-mcp), 31.08.2026.
//
// ENDPOINTS (base https://www.govmap.gov.il/api):
//   POST /search-service/autocomplete        {searchText, language:"he",
//        isAccurate:false, maxResults}       → {results:[{text, shape:"POINT(x y)"…}]}
//        coordinates are ITM / EPSG:2039, meters — a metric grid, so distances
//        are plain Euclidean; no WGS84 conversion is faked (itmX/itmY fields).
//   GET  /real-estate/deals/{x},{y}/{radius} → polygon METADATA list
//        [{polygon_id, dealscount, settlementNameHeb, streetNameHeb, houseNum…}]
//        (not deals — deals live one call deeper)
//   GET  /real-estate/street-deals/{polygonId}?limit&dealType&startDate&endDate
//        → {data:[deal…], totalCount}   dealType 1 = FIRST HAND (from
//        developer) · 2 = SECOND HAND — the government's own classification,
//        stored verbatim in sourceClassification and driving newness.
//   POST /layers-catalog/entitiesByPoint     {point:[x,y], layers:[{layerId}],
//        tolerance} → cadastre/deal entities at a point (block/parcel lookup).
//
// Deal record vocabulary: objectid, dealAmount, dealDate (ISO), assetArea,
// assetRoomNum, floor/floorNumber, settlementNameHeb, streetName, houseNumber,
// neighborhood, propertyTypeDescription, shape (building MULTIPOLYGON, ITM).

'use strict';

const { GovernmentRealEstateProvider } = require('./base');
const { makeTransaction, toNumber, toIsoDate } = require('../schema');
const { classifyNewness } = require('../classify');

const BASE = process.env.GOV_GOVMAP_BASE || 'https://www.govmap.gov.il/api';
const AUTHORITY = 'רשות המיסים (נתוני עסקאות) via GovMap — the official State of Israel mapping portal';
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/** Centroid of the first ring of a WKT POLYGON/MULTIPOLYGON, ITM meters. */
function wktCentroid(wkt) {
  if (!wkt) return null;
  const m = String(wkt).match(/\(\(+([^()]+)/);
  if (!m) return null;
  const pts = m[1].split(',').map((p) => p.trim().split(/\s+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
  if (!pts.length) return null;
  return {
    x: pts.reduce((a, p) => a + p[0], 0) / pts.length,
    y: pts.reduce((a, p) => a + p[1], 0) / pts.length,
  };
}

class GovMapProvider extends GovernmentRealEstateProvider {
  constructor(opts = {}) {
    super('govmap.gov.il', opts);
    this.base = (opts.base || BASE).replace(/\/$/, '');
    this.disabled = opts.disabled ?? process.env.GOV_GOVMAP_DISABLED === '1';
    this.pageLimit = opts.pageLimit || 40;
  }

  enabled() { return !this.disabled; }

  capabilities() {
    return ['searchLocation', 'resolveAddress', 'resolveBlockParcel',
            'getTransactions', 'getStreetTransactions', 'getNearbyTransactions'];
  }

  requireEnabled(cap) {
    if (this.disabled) this.unavailable(cap, 'GovMap provider disabled via GOV_GOVMAP_DISABLED=1');
  }

  /* ---------------- low-level calls ---------------- */

  async autocomplete(searchText) {
    const url = this.base + '/search-service/autocomplete';
    const key = url + '|' + searchText;
    const hit = this.store && this.store.cacheGet(key, 6 * 60 * 60 * 1000);
    if (hit) return hit;
    const body = await this.fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchText, language: 'he', isAccurate: false, maxResults: 10 }),
    });
    const results = (body.results || []).map((r) => {
      let itm = null;
      const m = String(r.shape || '').match(/^POINT\(([\d.]+)\s+([\d.]+)\)/);
      if (m) itm = { x: Number(m[1]), y: Number(m[2]) };
      return { text: norm(r.text), id: r.id, type: r.type, itm, sourceUrl: url };
    });
    if (this.store) this.store.cacheSet(key, results);
    return results;
  }

  async dealPolygons(x, y, radiusM) {
    const url = `${this.base}/real-estate/deals/${x},${y}/${radiusM}`;
    const body = await this.fetchJson(url);
    if (!Array.isArray(body)) throw new Error('unexpected polygons response from ' + url);
    return { polygons: body, url };
  }

  async streetDeals(polygonId, dealType, limit, startDate) {
    const url = `${this.base}/real-estate/street-deals/${encodeURIComponent(polygonId)}?limit=${limit || this.pageLimit}&dealType=${dealType}` +
      (startDate ? `&startDate=${encodeURIComponent(startDate)}` : '');
    const body = await this.fetchJson(url);
    const rows = Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : null);
    if (!rows) throw new Error('unexpected street-deals response from ' + url);
    return { rows, url, totalCount: body.totalCount ?? rows.length };
  }

  /* ---------------- normalization ---------------- */

  /**
   * @param {object} raw GovMap street-deals record
   * @param {object} ctx {dealType, sourceUrl, target:{x,y,houseNumber}, scopeLevel}
   */
  normalizeDeal(raw, ctx = {}) {
    const srcCls = ctx.dealType === 1 ? 'govmap dealType=1 (first hand / יד ראשונה מקבלן)'
      : ctx.dealType === 2 ? 'govmap dealType=2 (second hand / יד שנייה)' : null;
    const dealDate = toIsoDate(raw.dealDate);
    const cls = classifyNewness({
      sourceClassification: srcCls,
      dealNature: raw.propertyTypeDescription,
      dealYear: dealDate ? Number(dealDate.slice(0, 4)) : null,
    });
    const centroid = wktCentroid(raw.shape);
    const tx = makeTransaction({
      txId: raw.objectid != null ? 'govmap:' + raw.objectid : null,
      date: dealDate,
      price: toNumber(raw.dealAmount),
      areaSqm: toNumber(raw.assetArea),
      rooms: toNumber(raw.assetRoomNum ?? raw.rooms),
      floor: raw.floorNumber != null ? String(raw.floorNumber) : (raw.floor != null ? norm(raw.floor) : null),
      city: norm(raw.settlementNameHeb) || null,
      street: norm(raw.streetName) || null,
      houseNumber: raw.houseNumber != null ? norm(raw.houseNumber) : null,
      itmX: centroid ? Math.round(centroid.x) : null,
      itmY: centroid ? Math.round(centroid.y) : null,
      dealType: norm(raw.propertyTypeDescription) || null,
      sourceClassification: srcCls,
      newness: cls.newness,
      newnessEvidence: cls.evidence,
    }, {
      source: this.name,
      sourceAuthority: AUTHORITY,
      sourceDataset: 'real-estate/street-deals (עסקאות נדל"ן layer)',
      sourceRecordId: raw.objectid != null ? String(raw.objectid) : null,
      sourceUrl: ctx.sourceUrl || null,
      sourceTimestamp: null, // GovMap does not publish a per-record update time
      retrievalMethod: 'live-api',
      retrievedAt: this.now(),
      raw,
    });
    // geographic annotations (query context, not properties of the deal)
    if (ctx.target && ctx.target.houseNumber != null && tx.houseNumber != null &&
        norm(String(ctx.target.houseNumber)) === norm(String(tx.houseNumber)) &&
        (!ctx.target.street || norm(ctx.target.street) === tx.street || (tx.street || '').includes(norm(ctx.target.street)))) {
      tx.distanceM = 0;
      tx.distanceBasis = 'same building (house number match)';
    } else if (ctx.target && ctx.target.x != null && tx.itmX != null) {
      tx.distanceM = Math.round(Math.hypot(tx.itmX - ctx.target.x, tx.itmY - ctx.target.y));
      tx.distanceBasis = 'ITM Euclidean, building centroid';
    } else {
      tx.distanceM = null;
      tx.distanceBasis = ctx.scopeLevel ? 'within ' + ctx.scopeLevel + ' scope (no geometry on record)' : null;
    }
    return tx;
  }

  /* ---------------- capability surface ---------------- */

  async searchLocation(query) {
    this.requireEnabled('searchLocation');
    const results = await this.autocomplete(norm(query));
    return {
      matches: results.map((r) => ({ kind: r.type || 'address', label: r.text, id: r.id, itm: r.itm })),
      provenance: { source: this.name, sourceAuthority: AUTHORITY, sourceUrl: this.base + '/search-service/autocomplete', retrievedAt: this.now() },
    };
  }

  async resolveAddress(city, street, houseNumber) {
    this.requireEnabled('resolveAddress');
    const q = [norm(street), houseNumber, norm(city)].filter((v) => v !== null && v !== undefined && v !== '').join(' ');
    const results = await this.autocomplete(q);
    const best = results.find((r) => r.itm);
    if (!best) this.unavailable('resolveAddress', `GovMap autocomplete found no located result for "${q}"`);
    return {
      city: norm(city), street: norm(street),
      houseNumber: houseNumber ?? null,
      matchedText: best.text,
      itmX: best.itm.x, itmY: best.itm.y, crs: 'EPSG:2039 (ITM)',
      houseNumberVerified: /\d/.test(best.text), // located result echoing a number
      provenance: { source: this.name, sourceAuthority: AUTHORITY, sourceUrl: best.sourceUrl, retrievedAt: this.now() },
    };
  }

  async resolveBlockParcel(address) {
    this.requireEnabled('resolveBlockParcel');
    const loc = address.itmX != null ? address : await this.resolveAddress(address.city, address.street, address.houseNumber);
    const url = this.base + '/layers-catalog/entitiesByPoint';
    const body = await this.fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: [loc.itmX, loc.itmY], layers: [{ layerId: '16' }], tolerance: 0 }),
    });
    // walk defensively for gush/helka keys anywhere in the entities payload
    let block = null, parcel = null;
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      for (const [k, v] of Object.entries(node)) {
        const key = k.toLowerCase();
        if (block === null && (key === 'gush' || key.includes('gush_num') || key === 'גוש')) block = String(v);
        if (parcel === null && (key === 'helka' || key.includes('parcel') || key === 'חלקה')) parcel = String(v);
        walk(v);
      }
    })(body);
    if (!block) this.unavailable('resolveBlockParcel', 'no cadastre entity returned at the resolved point');
    return {
      ...loc, block, parcel,
      provenance: { source: this.name, sourceAuthority: AUTHORITY, sourceUrl: url, retrievedAt: this.now() },
    };
  }

  /** Address-anchored retrieval: autocomplete → deal polygons → street deals
   *  for BOTH government classes (first hand + second hand), each row tagged. */
  async getTransactions(location, filters = {}) {
    this.requireEnabled('getTransactions');
    const loc = await this.resolveAddress(location.city, location.street, location.houseNumber);
    // street/building queries stay tight; a city-level query sweeps the
    // center at a wider radius (the ladder discloses the scope either way)
    const radius = filters.radiusM || (location.street ? 60 : 400);
    return this.dealsAroundPoint(loc.itmX, loc.itmY, radius, {
      ...location, x: loc.itmX, y: loc.itmY,
    }, filters);
  }

  async getStreetTransactions(street) {
    this.requireEnabled('getStreetTransactions');
    const loc = await this.resolveAddress(street.city, street.street, null);
    return this.dealsAroundPoint(loc.itmX, loc.itmY, 120, { ...street, x: loc.itmX, y: loc.itmY }, {});
  }

  async getNearbyTransactions(a, b, radiusM) {
    this.requireEnabled('getNearbyTransactions');
    // accepts ITM meters (x,y). WGS84 degrees are NOT silently reprojected.
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(a) < 1000) {
      this.unavailable('getNearbyTransactions',
        'GovMap operates in ITM (EPSG:2039) meters; pass ITM coordinates (use resolveAddress) — WGS84 is not silently reprojected');
    }
    return this.dealsAroundPoint(a, b, radiusM, { x: a, y: b }, {});
  }

  async dealsAroundPoint(x, y, radiusM, target, filters) {
    const { polygons, url: polyUrl } = await this.dealPolygons(x, y, radiusM);
    const ids = [];
    for (const p of polygons) {
      const id = p.polygon_id ?? p.polygonId ?? p.POLYGON_ID;
      if (id != null && !ids.includes(String(id))) ids.push(String(id));
      if (ids.length >= 6) break; // bounded fan-out per query
    }
    const out = [];
    const startDate = filters.months
      ? new Date(Date.now() - filters.months * 30.44 * 86400e3).toISOString().slice(0, 7)
      : undefined;
    for (const id of ids) {
      for (const dealType of [1, 2]) { // government classes: first hand + second hand
        try {
          const { rows, url } = await this.streetDeals(id, dealType, filters.limit || this.pageLimit, startDate);
          for (const r of rows) out.push(this.normalizeDeal(r, { dealType, sourceUrl: url, target, scopeLevel: radiusM + 'm' }));
        } catch (e) {
          // a polygon/class miss must not sink the query; surfaced via meta below
          out.polyErrors = (out.polyErrors || 0) + 1;
        }
      }
    }
    out.sort((p, q) => String(q.date).localeCompare(String(p.date)));
    out.forEach((t) => { t.queryPolygonSourceUrl = polyUrl; });
    return out;
  }
}

module.exports = { GovMapProvider, wktCentroid };
