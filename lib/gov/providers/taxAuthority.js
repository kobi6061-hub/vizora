// PROPX · provider: Israel Tax Authority real-estate transactions (מידע נדל"ן,
// the KARMAN transaction registry surfaced at nadlan.gov.il).
//
// This is the canonical transaction source for PROPX — and it currently has
// NO officially supported public API: the public site sits behind bot
// protection, and PROPX will not build on CAPTCHA bypasses or private
// third-party APIs (product decision, 30.08.2026).
//
// Therefore this provider is a COMPLETE connector with a disabled transport:
//   · the full capability surface and the raw→PROPX normalization contract
//     (normalizeRawDeal) are implemented and tested offline today;
//   · the live transport activates only when an officially supported access
//     mechanism is configured:
//         GOV_TAXAUTH_ENDPOINT  base URL of the authorized service
//         GOV_TAXAUTH_TOKEN     credential for it (optional, if required)
//     — e.g. an ITA data-sharing agreement, an official API when published,
//     or a licensed redistribution feed;
//   · until then every transaction call fails gracefully with
//     GovSourceUnavailableError carrying that exact explanation, and the
//     PROPX UI keeps showing its curated published-deals registry instead.
//
// The raw record vocabulary below (DEALDATE, DEALAMOUNT, DEALNATURE, GUSH,
// KEYVALUE, …) is the long-published KARMAN/nadlan.gov.il record shape, so an
// authorized feed of those records normalizes with zero mapping work.

'use strict';

const { GovernmentRealEstateProvider } = require('./base');
const { makeTransaction, toNumber, toIsoDate } = require('../schema');
const { classifyNewness } = require('../classify');

const pick = (raw, keys) => {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k];
  }
  return null;
};

/** "6108-279-12" | "6108/279" → {block, parcel, subParcel} (strings kept). */
function parseGush(v) {
  if (!v) return { block: null, parcel: null, subParcel: null };
  const parts = String(v).split(/[-/\s]+/).filter(Boolean);
  return { block: parts[0] || null, parcel: parts[1] || null, subParcel: parts[2] || null };
}

class TaxAuthorityProvider extends GovernmentRealEstateProvider {
  constructor(opts = {}) {
    super('taxes.gov.il/nadlan', opts);
    this.endpoint = opts.endpoint ?? process.env.GOV_TAXAUTH_ENDPOINT ?? null;
    this.token = opts.token ?? process.env.GOV_TAXAUTH_TOKEN ?? null;
  }

  enabled() { return !!this.endpoint; }

  // The capability surface is DECLARED even while the transport is disabled:
  // that is what lets GovDataService route a call here and surface the
  // actionable "configure an authorized connector" reason instead of a mute
  // "no provider". enabled() (shown in /api/gov/status) tells the two apart.
  capabilities() {
    return ['getTransactions', 'getStreetTransactions', 'getNearbyTransactions',
            'resolveBlockParcel', 'getGovernmentMarketSummary'];
  }

  requireEnabled(capability) {
    if (!this.enabled()) {
      this.unavailable(capability,
        'the Tax Authority transaction registry has no officially supported public API; ' +
        'configure GOV_TAXAUTH_ENDPOINT (an authorized access mechanism) to activate this connector');
    }
  }

  /* ================= raw → PROPX normalization (pure, offline-testable) ================= */

  /**
   * Normalize one government transaction record into the PROPX schema.
   * @param {object} raw  a KARMAN/nadlan-shaped record
   * @param {object} ctx  {city?, street?, houseNumber?, lat?, lng?, sourceUrl?, sourceTimestamp?, sample?}
   */
  normalizeRawDeal(raw, ctx = {}) {
    const dealDate = toIsoDate(pick(raw, ['DEALDATE', 'DEALDATETIME', 'dealDate', 'date']));
    const price = toNumber(pick(raw, ['DEALAMOUNT', 'dealAmount', 'price']));
    const area = toNumber(pick(raw, ['DEALNATURE', 'ASSETAREA', 'area', 'areaSqm']));
    const yearBuilt = toNumber(pick(raw, ['BUILDINGYEAR', 'YEARBUILT', 'yearBuilt']));
    const fullAddress = pick(raw, ['FULLADRESS', 'FULLADDRESS', 'DISPLAYADRESS', 'address']);
    const houseFromAddress = fullAddress ? (String(fullAddress).match(/\s(\d+[א-ת]?)(?:,|$)/) || [])[1] : null;
    const gush = parseGush(pick(raw, ['GUSH', 'gush', 'blockParcel']));
    const dealYear = dealDate ? Number(dealDate.slice(0, 4)) : null;
    const cls = classifyNewness({
      dealNature: pick(raw, ['DEALNATUREDESCRIPTION', 'dealNatureDescription', 'propertyType']),
      newFlag: raw.NEWPROJECT === true || raw.isNew === true || undefined,
      yearBuilt, dealYear,
      projectName: pick(raw, ['PROJECTNAME', 'projectName']),
    });
    return makeTransaction({
      txId: pick(raw, ['KEYVALUE', 'DEALID', 'keyValue', 'id']),
      date: dealDate,
      price,
      pricePerSqm: toNumber(pick(raw, ['PRICEPERSQM', 'pricePerSqm'])), // derived only if absent
      areaSqm: area,
      rooms: toNumber(pick(raw, ['ASSETROOMNUM', 'rooms'])),
      floor: pick(raw, ['FLOORNO', 'floor']),
      floorsInBuilding: toNumber(pick(raw, ['BUILDINGFLOORS', 'floorsInBuilding'])),
      yearBuilt,
      city: ctx.city ?? pick(raw, ['CITY', 'city', 'SETL_NAME']),
      street: ctx.street ?? pick(raw, ['STREET', 'street', 'STREET_NAME']),
      houseNumber: ctx.houseNumber ?? toNumber(pick(raw, ['HOUSENUM', 'houseNumber'])) ?? houseFromAddress ?? null,
      block: gush.block,
      parcel: gush.parcel,
      subParcel: gush.subParcel,
      lat: ctx.lat ?? toNumber(pick(raw, ['LAT', 'lat', 'Y'])),
      lng: ctx.lng ?? toNumber(pick(raw, ['LONG', 'LNG', 'lng', 'X'])),
      dealType: pick(raw, ['DEALNATUREDESCRIPTION', 'dealNatureDescription', 'propertyType']),
      newness: cls.newness,
      newnessEvidence: cls.evidence,
    }, {
      source: this.name,
      sourceUrl: ctx.sourceUrl || null,
      sourceTimestamp: ctx.sourceTimestamp || pick(raw, ['DISPLAYDATE', 'updated']) || null,
      retrievedAt: this.now(),
      sample: ctx.sample === true,
      raw: ctx.keepRaw === false ? null : raw,
    });
  }

  /* ================= transport (active only with an authorized endpoint) ================= */

  async callAuthorized(pathname, params, capability) {
    this.requireEnabled(capability);
    const url = new URL(pathname, this.endpoint);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    return this.fetchJson(url.toString(), this.token ? { headers: { Authorization: 'Bearer ' + this.token } } : {});
  }

  async getTransactions(location, filters = {}) {
    const body = await this.callAuthorized('/transactions', {
      city: location.city, street: location.street, house: location.houseNumber,
      block: location.block, parcel: location.parcel,
      from: filters.from, to: filters.to, limit: filters.limit || 100,
    }, 'getTransactions');
    const rows = body.records || body.AllResults || body.rows || [];
    return rows.map((r) => this.normalizeRawDeal(r, { ...location, sourceUrl: this.endpoint }));
  }

  async getStreetTransactions(street) { return this.getTransactions(street, {}); }

  async getNearbyTransactions(lat, lng, radiusM) {
    const body = await this.callAuthorized('/transactions/nearby', { lat, lng, radius: radiusM }, 'getNearbyTransactions');
    const rows = body.records || body.rows || [];
    return rows.map((r) => this.normalizeRawDeal(r, { lat, lng, sourceUrl: this.endpoint }));
  }

  async resolveBlockParcel(address) {
    const body = await this.callAuthorized('/cadastre/resolve', {
      city: address.city, street: address.street, house: address.houseNumber,
    }, 'resolveBlockParcel');
    const g = parseGush(body.gush || body.GUSH || (body.block ? `${body.block}-${body.parcel || ''}-${body.subParcel || ''}` : null));
    if (!g.block) this.unavailable('resolveBlockParcel', 'authorized endpoint returned no cadastre for the address');
    return { ...address, ...g, provenance: { source: this.name, sourceUrl: this.endpoint, retrievedAt: this.now() } };
  }

  async getGovernmentMarketSummary(location) {
    const body = await this.callAuthorized('/summary', { city: location.city, street: location.street }, 'getGovernmentMarketSummary');
    return { ...body, provenance: { source: this.name, sourceUrl: this.endpoint, retrievedAt: this.now() } };
  }
}

module.exports = { TaxAuthorityProvider, parseGush };
