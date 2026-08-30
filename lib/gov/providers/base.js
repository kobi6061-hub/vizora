// PROPX · Government Real Estate Data Layer — provider contract.
//
// Every government source is wrapped in a provider implementing this exact
// interface. The PROPX analytics layer talks ONLY to GovDataService
// (lib/gov/service.js), which talks only to this contract — so adding a
// source (or an officially authorized connector replacing a stub) never
// changes analytics code.
//
// A provider that cannot serve a capability throws GovSourceUnavailableError
// with a human-actionable reason — it NEVER fabricates, estimates, or
// silently degrades.

'use strict';

class GovSourceUnavailableError extends Error {
  constructor(provider, capability, reason) {
    super(`[${provider}] ${capability} unavailable: ${reason}`);
    this.name = 'GovSourceUnavailableError';
    this.provider = provider;
    this.capability = capability;
    this.reason = reason;
  }
}

class GovernmentRealEstateProvider {
  /** @param {object} opts {fetchImpl?, store?, now?} — all injectable for tests */
  constructor(name, opts = {}) {
    this.name = name;
    this.fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.store = opts.store || null;
    this.now = opts.now || (() => new Date().toISOString());
  }

  /** Which of the interface methods this provider actually serves. */
  capabilities() { return []; }

  /* ---- location & cadastre ---- */
  async searchLocation(_query) { this.unsupported('searchLocation'); }
  async resolveAddress(_city, _street, _houseNumber) { this.unsupported('resolveAddress'); }
  async resolveBlockParcel(_address) { this.unsupported('resolveBlockParcel'); }

  /* ---- transactions ---- */
  async getTransactions(_location, _filters) { this.unsupported('getTransactions'); }
  async getStreetTransactions(_street) { this.unsupported('getStreetTransactions'); }
  async getNearbyTransactions(_lat, _lng, _radiusM) { this.unsupported('getNearbyTransactions'); }

  /* ---- market analytics ---- */
  async getMarketTrends(_location) { this.unsupported('getMarketTrends'); }
  async getGovernmentMarketSummary(_location) { this.unsupported('getGovernmentMarketSummary'); }

  unsupported(capability) {
    throw new GovSourceUnavailableError(this.name, capability, 'not supported by this provider');
  }

  unavailable(capability, reason) {
    throw new GovSourceUnavailableError(this.name, capability, reason);
  }

  async fetchJson(url, init = {}) {
    if (!this.fetchImpl) this.unavailable('fetch', 'no fetch implementation available in this runtime');
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { 'User-Agent': 'PROPX-gov-layer/1.0 (+https://kobix.online)', Accept: 'application/json', ...(init.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  }
}

module.exports = { GovernmentRealEstateProvider, GovSourceUnavailableError };
