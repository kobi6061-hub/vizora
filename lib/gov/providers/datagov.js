// PROPX · provider: data.gov.il (CKAN) — official government registries.
//
// Serves location capabilities from the open State registries:
//   · cities registry  (רשימת יישובים — CBS city symbols)
//   · streets registry (מרשם הרחובות — street symbols per city)
// via the documented CKAN datastore API:
//   GET https://data.gov.il/api/3/action/datastore_search
//       ?resource_id=…&filters={…}&q=…&limit=…
//
// Resource ids default to the well-known public registry resources and are
// overridable by env (GOV_DATAGOV_CITIES_RESOURCE / GOV_DATAGOV_STREETS_RESOURCE)
// so a registry re-publication never requires a code change.
//
// This provider serves REGISTRY data only — data.gov.il does not host an
// address-level transactions dataset (verified 30.08.2026), so transaction
// capabilities are intentionally not claimed here.

'use strict';

const { GovernmentRealEstateProvider } = require('./base');

const CKAN = 'https://data.gov.il/api/3/action/datastore_search';
const CITIES_RESOURCE = process.env.GOV_DATAGOV_CITIES_RESOURCE || '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba';
const STREETS_RESOURCE = process.env.GOV_DATAGOV_STREETS_RESOURCE || '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';

const CACHE_MS = 12 * 60 * 60 * 1000; // registries are slow-moving

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

class DataGovProvider extends GovernmentRealEstateProvider {
  constructor(opts = {}) {
    super('data.gov.il', opts);
    this.citiesResource = opts.citiesResource || CITIES_RESOURCE;
    this.streetsResource = opts.streetsResource || STREETS_RESOURCE;
  }

  capabilities() { return ['searchLocation', 'resolveAddress']; }

  async ckan(resource, params) {
    const qs = new URLSearchParams({ resource_id: resource, ...params });
    const url = `${CKAN}?${qs}`;
    const cached = this.store && this.store.cacheGet(url, CACHE_MS);
    if (cached) return cached;
    const body = await this.fetchJson(url);
    if (!body.success) throw new Error('CKAN success=false for ' + url);
    const out = { records: body.result.records || [], url };
    if (this.store) this.store.cacheSet(url, out);
    return out;
  }

  /** Free-text search across the cities and streets registries. */
  async searchLocation(query) {
    const q = clean(query);
    if (!q) return { matches: [], provenance: this.prov(null) };
    const [cities, streets] = await Promise.all([
      this.ckan(this.citiesResource, { q, limit: '8' }),
      this.ckan(this.streetsResource, { q, limit: '12' }),
    ]);
    const matches = [
      ...cities.records.map((r) => ({
        kind: 'city',
        city: clean(r['שם_ישוב']),
        cityCode: Number(r['סמל_ישוב']) || null,
      })),
      ...streets.records.map((r) => ({
        kind: 'street',
        city: clean(r['שם_ישוב']),
        cityCode: Number(r['סמל_ישוב']) || null,
        street: clean(r['שם_רחוב']),
        streetCode: Number(r['סמל_רחוב']) || null,
      })),
    ];
    return { matches, provenance: this.prov([cities.url, streets.url]) };
  }

  /**
   * Canonical address resolution against the State registries.
   * House numbers are not part of the national street registry — the number
   * is echoed back as `houseNumber` and marked unverified rather than
   * silently "resolved".
   */
  async resolveAddress(city, street, houseNumber) {
    const cityQ = clean(city), streetQ = clean(street);
    const cities = await this.ckan(this.citiesResource, {
      filters: JSON.stringify({ 'שם_ישוב': cityQ }), limit: '3',
    });
    let cityRec = cities.records[0];
    if (!cityRec) {
      const fuzzy = await this.ckan(this.citiesResource, { q: cityQ, limit: '3' });
      cityRec = fuzzy.records.find((r) => clean(r['שם_ישוב']).includes(cityQ));
    }
    if (!cityRec) this.unavailable('resolveAddress', `city "${cityQ}" not found in the government cities registry`);

    const streets = await this.ckan(this.streetsResource, {
      filters: JSON.stringify({ 'סמל_ישוב': cityRec['סמל_ישוב'] }), q: streetQ, limit: '10',
    });
    const streetRec = streets.records.find((r) => clean(r['שם_רחוב']) === streetQ)
      || streets.records.find((r) => clean(r['שם_רחוב']).includes(streetQ));
    if (!streetRec) this.unavailable('resolveAddress', `street "${streetQ}" not found in "${clean(cityRec['שם_ישוב'])}" in the government streets registry`);

    return {
      city: clean(cityRec['שם_ישוב']),
      cityCode: Number(cityRec['סמל_ישוב']) || null,
      street: clean(streetRec['שם_רחוב']),
      streetCode: Number(streetRec['סמל_רחוב']) || null,
      houseNumber: houseNumber === undefined || houseNumber === null ? null : Number(houseNumber),
      houseNumberVerified: false, // registry holds streets, not building numbers
      provenance: this.prov([cities.url, streets.url]),
    };
  }

  prov(urls) {
    return {
      source: this.name,
      sourceUrl: urls,
      retrievedAt: this.now(),
      license: 'Israel open government data',
    };
  }
}

module.exports = { DataGovProvider, CITIES_RESOURCE, STREETS_RESOURCE };
