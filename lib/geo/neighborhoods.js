// PROPX · neighborhood resolution layer.
//
// Israel has no single authoritative nationwide neighborhood registry, so
// this layer is deliberately RESILIENT rather than pretending completeness:
//
//   1. explicit registry  — verified, recognized neighborhood names with a
//                           locality link (data/geo/neighborhoods.json);
//   2. explicit street links — street → neighborhood where a verified
//                           mapping exists;
//   3. runtime learning   — neighborhood names published on OFFICIAL
//                           government deal records for that street are
//                           recorded as observed evidence;
//   4. unresolved         — everything else.
//
// Hard rules:
//   · a street is NEVER hidden or dropped because its neighborhood is
//     unresolved — it stays fully searchable and attached to its locality;
//   · a neighborhood is NEVER invented, and a statistical area is never
//     silently relabelled as a named neighborhood;
//   · every resolution carries its source and method.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { baseNorm } = require('./aliases');

const FILE = path.join(__dirname, '..', '..', 'data', 'geo', 'neighborhoods.json');

let CACHE = null;
function load() {
  if (CACHE) return CACHE;
  let doc = { meta: {}, neighborhoods: [], streetLinks: [] };
  try { doc = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* layer optional */ }
  const byId = new Map(doc.neighborhoods.map((n) => [n.id, n]));
  const byLocality = new Map();
  for (const n of doc.neighborhoods) {
    const k = baseNorm(n.localityHe);
    if (!byLocality.has(k)) byLocality.set(k, []);
    byLocality.get(k).push(n);
  }
  const linkKey = (city, street) => baseNorm(city) + '|' + baseNorm(street);
  const links = new Map();
  for (const l of doc.streetLinks) {
    const n = byId.get(l.neighborhoodId);
    if (n) links.set(linkKey(n.localityHe, l.street), n);
  }
  CACHE = { meta: doc.meta, byId, byLocality, links, observed: new Map() };
  return CACHE;
}

/** Record a neighborhood name that an OFFICIAL deal record published. */
function learnFromOfficialDeal(city, street, neighborhoodName) {
  if (!city || !street || !neighborhoodName) return;
  const L = load();
  const k = baseNorm(city) + '|' + baseNorm(street);
  const m = L.observed.get(k) || new Map();
  const nk = baseNorm(neighborhoodName);
  m.set(nk, { name: String(neighborhoodName).trim(), hits: (m.get(nk) ? m.get(nk).hits : 0) + 1 });
  L.observed.set(k, m);
}

/**
 * Resolve the neighborhood of a street.
 * @returns {{resolved:boolean, name:string|null, id:string|null,
 *            method:string, source:string|null, confidence:'high'|'observed'|null}}
 */
function resolveNeighborhood(city, street) {
  const L = load();
  const k = baseNorm(city) + '|' + baseNorm(street);

  const link = L.links.get(k);
  if (link) {
    return { resolved: true, name: link.he, id: link.id, method: 'verified-street-link',
             source: link.source, confidence: 'high' };
  }
  const obs = L.observed.get(k);
  if (obs && obs.size) {
    const best = [...obs.values()].sort((a, b) => b.hits - a.hits)[0];
    return { resolved: true, name: best.name, id: null, method: 'observed-on-official-deal-records',
             source: 'official government transaction records', confidence: 'observed' };
  }
  return { resolved: false, name: null, id: null, method: 'no-authoritative-mapping-available',
           source: null, confidence: null };
}

/** Named neighborhoods known for a locality (may be empty — never invented). */
function neighborhoodsOf(city) {
  return (load().byLocality.get(baseNorm(city)) || []).map((n) => ({ id: n.id, he: n.he, en: n.en, source: n.source }));
}

function coverage() {
  const L = load();
  return {
    neighborhoods: L.byId.size,
    localitiesWithNeighborhoods: L.byLocality.size,
    verifiedStreetLinks: L.links.size,
    observedStreetLinks: L.observed.size,
    note: L.meta.note || null,
  };
}

module.exports = { resolveNeighborhood, neighborhoodsOf, learnFromOfficialDeal, coverage };
