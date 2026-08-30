// PROPX · GovDataService — the single door between PROPX analytics and all
// government providers.
//
// Analytics code depends on THIS module only. Providers register behind the
// GovernmentRealEstateProvider contract, so adding a source (or activating
// the authorized Tax Authority connector) changes wiring here, never the
// analytics layer.
//
// Responsibilities:
//   · route each capability to the providers that actually serve it;
//   · progressive geographic fallback for transactions:
//         exact building → street → 250m → 500m → 1000m
//     with the scope actually used ALWAYS exposed on the result;
//   · deduplicate (government id + address/date/price fingerprint);
//   · partition by new-construction evidence (confirmed / probable / unknown)
//     so new-construction analytics can consume `confirmed` only;
//   · snapshot every successful payload so changes in source data are
//     detectable over time;
//   · aggregate provider failures into a readable `unavailable` list —
//     an empty result is always explained, never silently empty.

'use strict';

const { MemoryStore } = require('./store');
const { dedupe } = require('./fingerprint');
const { partitionByNewness } = require('./classify');
const { GovSourceUnavailableError } = require('./providers/base');

const FALLBACK_LADDER = [
  { level: 'building', radiusM: 0 },
  { level: 'street', radiusM: 0 },
  { level: 'radius', radiusM: 250 },
  { level: 'radius', radiusM: 500 },
  { level: 'radius', radiusM: 1000 },
];

class GovDataService {
  /** @param {object} opts {providers: GovernmentRealEstateProvider[], store?, now?} */
  constructor(opts = {}) {
    this.providers = opts.providers || [];
    this.store = opts.store || new MemoryStore();
    this.now = opts.now || (() => new Date().toISOString());
    for (const p of this.providers) if (!p.store) p.store = this.store;
  }

  providersFor(capability) {
    return this.providers.filter((p) => p.capabilities().includes(capability));
  }

  /** First capable provider wins; every failure is collected, not swallowed. */
  async route(capability, args, errors) {
    const list = this.providersFor(capability);
    if (!list.length) {
      errors.push({ provider: null, capability, reason: 'no registered provider serves ' + capability });
      return null;
    }
    for (const p of list) {
      try {
        return await p[capability](...args);
      } catch (e) {
        errors.push({
          provider: p.name, capability,
          reason: e instanceof GovSourceUnavailableError ? e.reason : e.message,
        });
      }
    }
    return null;
  }

  async searchLocation(query) {
    const errors = [];
    const res = await this.route('searchLocation', [query], errors);
    return { ...(res || { matches: [] }), unavailable: errors };
  }

  async resolveAddress(city, street, houseNumber) {
    const errors = [];
    const res = await this.route('resolveAddress', [city, street, houseNumber], errors);
    return res ? { ...res, unavailable: errors } : { resolved: null, unavailable: errors };
  }

  async resolveBlockParcel(address) {
    const errors = [];
    const res = await this.route('resolveBlockParcel', [address], errors);
    return res ? { ...res, unavailable: errors } : { block: null, parcel: null, unavailable: errors };
  }

  async getMarketTrends(location) {
    const errors = [];
    const res = await this.route('getMarketTrends', [location], errors);
    if (res) this.store.snapshot('trends:' + JSON.stringify(location || 'national'), res.points || res);
    return res ? { ...res, unavailable: errors } : { points: [], unavailable: errors };
  }

  async getGovernmentMarketSummary(location) {
    const errors = [];
    const res = await this.route('getGovernmentMarketSummary', [location], errors);
    return res ? { ...res, unavailable: errors } : { summary: null, unavailable: errors };
  }

  /**
   * Transactions with the progressive geographic fallback ladder.
   * @param {object} location {city, street?, houseNumber?, lat?, lng?, block?, parcel?}
   * @param {object} filters  {from?, to?, limit?, minResults?}
   * @returns {scope, transactions, partitions, unavailable}
   *   scope = the ladder rung that actually produced the data — never hidden.
   */
  async getTransactions(location, filters = {}) {
    const errors = [];
    const minResults = filters.minResults || 1;
    const loc = location || {};

    for (const rung of FALLBACK_LADDER) {
      let rows = null;

      if (rung.level === 'building') {
        if (!loc.city || !loc.street || loc.houseNumber == null) continue;
        rows = await this.route('getTransactions', [loc, filters], errors);
      } else if (rung.level === 'street') {
        if (!loc.city || !loc.street) continue;
        rows = await this.route('getStreetTransactions',
          [{ city: loc.city, street: loc.street }], errors);
      } else {
        if (loc.lat == null || loc.lng == null) continue;
        rows = await this.route('getNearbyTransactions', [loc.lat, loc.lng, rung.radiusM], errors);
      }

      if (rows && rows.length >= minResults) {
        const transactions = dedupe(rows);
        const scope = {
          level: rung.level,
          radiusM: rung.radiusM || null,
          sampleSize: transactions.length, // every aggregate exposes its n
          description: rung.level === 'building' ? `${loc.street} ${loc.houseNumber}, ${loc.city}`
            : rung.level === 'street' ? `${loc.street}, ${loc.city}`
            : `${rung.radiusM}m around ${loc.lat},${loc.lng}`,
        };
        this.store.snapshot('tx:' + scope.description, transactions.map(stripRaw));
        return { scope, transactions, partitions: partitionByNewness(transactions), unavailable: errors };
      }
    }

    return {
      scope: null, transactions: [],
      partitions: { confirmed: [], probable: [], unknown: [] },
      unavailable: dedupeErrors(errors),
    };
  }

  /** Convenience guard for the analytics layer: confirmed-new rows only. */
  async getConfirmedNewTransactions(location, filters) {
    const res = await this.getTransactions(location, filters);
    return { ...res, transactions: res.partitions.confirmed };
  }

  status() {
    return this.providers.map((p) => ({
      provider: p.name,
      capabilities: p.capabilities(),
      enabled: typeof p.enabled === 'function' ? p.enabled() : true,
    }));
  }
}

/** Snapshot view: content only — raw echoes are dropped and retrievedAt is
 *  excluded so change detection compares SOURCE data, not our own clock. */
function stripRaw(tx) {
  const provs = Array.isArray(tx.provenance) ? tx.provenance : [tx.provenance];
  return {
    ...tx,
    provenance: provs.map((p) => ({
      ...p,
      raw: p.raw ? '[stored raw omitted from snapshot]' : null,
      retrievedAt: undefined,
      fetchedAt: undefined,
    })),
  };
}

function dedupeErrors(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const k = e.provider + '|' + e.capability + '|' + e.reason;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Default wiring: the canonical provider set, in routing order —
 *  Tax Authority direct (activates only with an authorized connector),
 *  then GovMap (live official platform serving the same reported deals),
 *  then the registries and CBS. */
function createDefaultService(opts = {}) {
  const { DataGovProvider } = require('./providers/datagov');
  const { CbsProvider } = require('./providers/cbs');
  const { TaxAuthorityProvider } = require('./providers/taxAuthority');
  const { GovMapProvider } = require('./providers/govmap');
  return new GovDataService({
    providers: [new TaxAuthorityProvider(opts), new GovMapProvider(opts),
                new DataGovProvider(opts), new CbsProvider(opts)],
    store: opts.store,
  });
}

module.exports = { GovDataService, createDefaultService, FALLBACK_LADDER };
