// PROPX · Land & Tender — client of the Israel Land Authority tender site API.
//
// The public site's own JSON API (apps.land.gov.il/MichrazimSite/api): the
// whole tender list, one tender's detail (lots, bids, winners, prices, plan
// numbers, parcels), its map polygon, the code tables and the settlement
// list. No key. Honest User-Agent, a bounded timeout per request and a small
// delay between requests on the site. Endpoint names were read from the
// public app's bundle (scripts/land-discover.js --rmi-codes), not guessed.

'use strict';

const BASE = (process.env.RMI_MICHRAZIM_BASE || 'https://apps.land.gov.il/MichrazimSite/api').replace(/\/$/, '');
const UA = 'PROPX-land-sync/1.0 (+https://github.com/kobi6061-hub/vizora; public tender data)';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://apps.land.gov.il', Referer: 'https://apps.land.gov.il/MichrazimSite/' };

class RmiClient {
  constructor({ fetchImpl = globalThis.fetch, delayMs = 350, timeoutMs = 45000, base = BASE } = {}) {
    this.fetch = fetchImpl; this.delayMs = delayMs; this.timeoutMs = timeoutMs; this.base = base; this.last = 0; this.requests = 0;
  }
  async pace() {
    const wait = this.last + this.delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
  async call(path, { method = 'GET', body } = {}) {
    await this.pace();
    this.requests++;
    const init = { method, headers: { ...HEADERS, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(this.timeoutMs);
    const r = await this.fetch(this.base + '/' + path, init);
    const text = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${path}`); e.status = r.status; throw e; }
    try { return JSON.parse(text); } catch { throw new Error(`${path}: not JSON (${text.slice(0, 80)})`); }
  }
  /** the whole tender list (the site's own search with no filter), or the active subset */
  async search({ activeOnly = false } = {}) {
    const j = await this.call('SearchApi/Search', { method: 'POST', body: { ActiveQuickSearch: false, ActiveMichraz: !!activeOnly } });
    const rows = Array.isArray(j) ? j : Array.isArray(j && j.results) ? j.results : null;
    if (!rows) throw new Error('SearchApi/Search: unexpected shape');
    return rows;
  }
  /** one tender's full detail: lots (Tik), bids, winners, plan numbers, parcels, documents, status message */
  detail(michrazId) { return this.call(`MichrazDetailsApi/Get?michrazID=${encodeURIComponent(michrazId)}`); }
  /** the tender's published polygon(s): CenterX/Y, Min/Max (ITM), MichrazShape WKT, Migrashim[] with TikShape */
  map(michrazId) { return this.call(`MichrazDetailsApi/GetMichrazMapaDetails?michrazID=${encodeURIComponent(michrazId)}`); }
  tables() { return this.call('GeneralTablesApi/Get'); }
  settlements() { return this.call('YeshuvimApi/Get'); }
}

module.exports = { RmiClient, BASE, UA };
