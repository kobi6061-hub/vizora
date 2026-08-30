// PROPX · provider: CBS (Central Bureau of Statistics) official index API.
//
// Serves getMarketTrends from the documented CBS API:
//   catalog:  https://api.cbs.gov.il/index/catalog/catalog?lang=he&format=json
//   series:   https://api.cbs.gov.il/index/data/price?id=<seriesId>&format=json
//              &download=false&last=<n>
// (User-Agent header is mandatory per CBS docs — set by fetchJson.)
//
// The new-homes price index series id is DISCOVERED from the catalog at
// runtime (searching the housing chapter for "דירות חדשות") rather than
// hardcoded, so a CBS renumbering degrades to a clear error, never to a
// wrong series silently. Trends here are the OFFICIAL national index — a
// city passed in is echoed back with scope 'national' so callers can see
// exactly what the number describes.

'use strict';

const { GovernmentRealEstateProvider } = require('./base');

const CATALOG_URL = 'https://api.cbs.gov.il/index/catalog/catalog?lang=he&format=json&download=false';
const SERIES_URL = (id, last) =>
  `https://api.cbs.gov.il/index/data/price?id=${encodeURIComponent(id)}&format=json&download=false&last=${last}`;

const CACHE_MS = 6 * 60 * 60 * 1000;
const NEW_HOMES_RE = /דירות\s+חדשות/;

class CbsProvider extends GovernmentRealEstateProvider {
  constructor(opts = {}) {
    super('cbs.gov.il', opts);
    this.seriesId = opts.seriesId || process.env.GOV_CBS_NEWHOMES_SERIES || null;
  }

  capabilities() { return ['getMarketTrends']; }

  async cachedJson(url) {
    const hit = this.store && this.store.cacheGet(url, CACHE_MS);
    if (hit) return hit;
    const body = await this.fetchJson(url);
    if (this.store) this.store.cacheSet(url, body);
    return body;
  }

  /** Find the new-homes index series id in the CBS catalog. */
  async discoverNewHomesSeries() {
    if (this.seriesId) return { id: this.seriesId, name: 'configured via GOV_CBS_NEWHOMES_SERIES', discovered: false };
    const cat = await this.cachedJson(CATALOG_URL);
    // The catalog nests chapters→subjects→series with {id/code, name} nodes;
    // walk defensively and match by name.
    const found = [];
    (function walk(node, path) {
      if (!node || typeof node !== 'object') return;
      const name = node.name || node.Name || node.title || '';
      const id = node.id ?? node.Id ?? node.code ?? node.Code;
      if (name && id !== undefined && NEW_HOMES_RE.test(String(name))) found.push({ id, name, path });
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach((c) => walk(c, path.concat(name || [])));
        else if (v && typeof v === 'object') walk(v, path.concat(name || []));
      }
    })(cat, []);
    if (!found.length) {
      this.unavailable('getMarketTrends',
        'new-homes index series not found in the CBS catalog — set GOV_CBS_NEWHOMES_SERIES to the series id');
    }
    return { id: found[0].id, name: found[0].name, discovered: true };
  }

  /** Official new-homes price-index trend (national scope). */
  async getMarketTrends(location, opts = {}) {
    const last = Math.min(60, Math.max(2, opts.last || 25));
    const series = await this.discoverNewHomesSeries();
    const url = SERIES_URL(series.id, last);
    const body = await this.cachedJson(url);
    // Documented shape: {month:[{date|year+month, currBase:{value}, percent…}]}
    // — walked defensively; points the API did not supply are simply absent.
    const points = [];
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const value = node.value ?? (node.currBase && node.currBase.value);
      const date = node.date || (node.year && node.month != null ? `${node.year}-${String(node.month).padStart(2, '0')}` : null);
      if (value !== undefined && date) points.push({ date, value: Number(value) });
      Object.values(node).forEach(walk);
    })(body);
    if (!points.length) this.unavailable('getMarketTrends', 'CBS series ' + series.id + ' returned no readable points');
    points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return {
      scope: 'national',                       // CBS publishes the index nationally
      requestedLocation: location || null,     // echoed, NOT the scope of the numbers
      series: { id: series.id, name: series.name, discovered: series.discovered },
      points,
      provenance: { source: this.name, sourceUrl: url, retrievedAt: this.now() },
    };
  }
}

module.exports = { CbsProvider };
