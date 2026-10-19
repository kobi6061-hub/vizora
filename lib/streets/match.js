// PROPX · STREET MATCH — attaching a register deal to an official street, conservatively.
//
// The Tax Authority's register publishes NO address. The republished copy (over.org.il) links each deal's parcel (גוש /
// חלקה) to the addresses its crosswalk knows for that parcel: `addresses` (at most 3 shown, "<street> <house>") and
// `addresses_total` (how many exist). PROPX attaches a deal to an official street of the directory only through those
// addresses, and only inside the deal's own locality:
//
//   rungs (the first that answers wins, the rung is kept with the match):
//     1 official street code   — not available on this channel (the rows carry address text, not codes) — documented
//     2 official name          — the address's street text equals an official name of the locality (normalized)
//     3 official synonym       — it equals an official synonym, which resolves to its official street
//     4 spelling variant       — the same name in another spelling (hyphen / space, one vav, final letters, the spelling of
//                                its type word: שדרות = שד, כיכר = ככר, סמטת = סמ, רחוב = none) — strong
//     5 normalized name        — a variant key that DROPS something (a distinguishing type word, an honorific, a leading ה) —
//                                LOOSE: the deal is POSSIBLE, never OBSERVED (the registry has 223 pairs like "כיכר X" / "X")
//   current rows answer before historical (retired) rows on every rung.
//   two streets answering the same rung = AMBIGUOUS (none picked); no answer = UNRESOLVED.
//
//   deal states:
//     OBSERVED     every address of the parcel is shown (addresses_total = addresses shown) and all of them resolve to
//                  ONE street — the deal counts in that street's statistics
//     POSSIBLE     the parcel touches the street but the evidence does not prove the deal is on it: the parcel's addresses
//                  name several streets (a corner parcel), the list is truncated (3 of N shown), or one of its addresses
//                  could not be resolved, the total is not stated with 3 shown, or the name joined only loosely — listed
//                  apart, NEVER in a street aggregate
//     UNRESOLVED   the parcel has addresses but none resolves to an official street of the locality
//     NO_ADDRESS   the crosswalk has no address for the parcel — a locality-level record only
//
// Nothing here guesses: no fuzzy name, no geometry, no nearest street, no house-number interpolation.

'use strict';

const SD = require('./directory');
const { aliasKeys, foldFinals } = require('../geo/aliases');

const STATE = Object.freeze({ OBSERVED: 'OBSERVED', POSSIBLE: 'POSSIBLE', UNRESOLVED: 'UNRESOLVED', NO_ADDRESS: 'NO_ADDRESS' });
const VIA = Object.freeze({ CODE: 'street-code', NAME: 'official-name', SYNONYM: 'official-synonym', SPELLING: 'spelling-variant', ALIAS: 'normalized-name' });
const VIA_RANK = { 'street-code': 0, 'official-name': 1, 'official-synonym': 2, 'spelling-variant': 3, 'normalized-name': 4 };
const REASON = Object.freeze({ MULTI_STREET: 'multi-street-parcel', TRUNCATED: 'address-list-truncated', UNRESOLVED_ADDRESS: 'unresolved-address-on-parcel',
  AMBIGUOUS_ADDRESS: 'ambiguous-address-on-parcel', LOOSE_NAME: 'loose-name-match' });

/* the street-type word at the start of a name, in one spelling — the registry tells "כיכר השומר" and "השומר" apart, so a type
   word is never dropped for a strong match; only its spellings meet (רחוב = no type word: it is the default) */
const TYPE_WORDS = [[/^(רחוב|רח)\s+/, ''], [/^(שדרות|שד)\s+/, 'שד '], [/^(סמטת|סמטה|סמ)\s+/, 'סמ '], [/^(כיכר|ככר)\s+/, 'ככר '], [/^(שכונת|שכונה|שכ)\s+/, 'שכ ']];
/** a spelling key: the normalized name with hyphens as spaces, one vav, plain final letters and one spelling of its type word */
function spellKey(name) {
  let n = SD.normName(name).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, to] of TYPE_WORDS) if (re.test(n)) { n = to + n.replace(re, ''); break; }
  return foldFinals(n.replace(/וו/g, 'ו'));
}

/** "שד רגר יצחק 95" → {street, house}; "רחוב התקוה מס' 56" → {street:"התקוה", house:"56"}; no number → the whole text */
function parseAddress(a) {
  let s = String(a == null ? '' : a).replace(/\s+/g, ' ').trim();
  s = s.replace(/^רחוב\s+/, '').replace(/\s+מס['׳]?\s*(?=\d)/, ' ');
  const m = s.match(/^(.*\S)\s+(\d+\s*[א-ת]?)$/);
  return m ? { street: m[1], house: m[2].replace(/\s+/g, '') } : { street: s, house: null };
}

/**
 * The names of one locality's official rows (street / area / site — never the placeholder 9000). Current rows answer first; a
 * historical row (retired from the registry) answers only when no current row does, so a re-coded name never turns ambiguous.
 * @param {object} D lib/streets/directory.js load()
 */
function localityIndex(D, cityCode) {
  const mk = () => ({ name: new Map(), syn: new Map(), spell: new Map(), key: new Map() });
  const cur = mk(), hist = mk();
  const add = (m, k, id) => { if (!k) return; let s = m.get(k); if (!s) m.set(k, (s = new Set())); s.add(id); };
  const rows = (D.byCity.get(Number(cityCode)) || []).filter((x) => x.kind !== SD.KIND.LOCALITY);
  const status = new Map(rows.map((x) => [x.id, x.status]));
  const into = (id) => (status.get(id) === 'historical' ? hist : cur);
  for (const x of rows) { const T = into(x.id); add(T.name, x.n, x.id); add(T.spell, spellKey(x.name), x.id); for (const k of aliasKeys(x.name)) add(T.key, k, x.id); }
  for (const y of D.synonyms) {
    if (y.cityCode !== Number(cityCode)) continue;
    const id = SD.streetId(y.cityCode, y.officialCode);
    if (!status.has(id)) continue;   // a synonym of the placeholder names the locality, not a street
    const T = into(id); add(T.syn, y.n, id); add(T.spell, spellKey(y.name), id); for (const k of aliasKeys(y.name)) add(T.key, k, id);
  }
  return { cityCode: Number(cityCode), cur, hist, size: rows.length };
}

/** one street text → {id, via} | {ambiguous:[ids], via} | null. Rungs: official name · official synonym · spelling variant
    (strong) · normalized name (loose: a type word, an honorific or a leading ה dropped) — current rows before historical ones */
function resolveStreet(LI, text) {
  const n = SD.normName(text);
  if (!n) return null;
  const one = (set, via) => (set.size === 1 ? { id: [...set][0], via } : { ambiguous: [...set].sort(), via });
  const sp = spellKey(n), keys = aliasKeys(n);
  for (const T of [LI.cur, LI.hist]) {
    if (T.name.has(n)) return one(T.name.get(n), VIA.NAME);
    if (T.syn.has(n)) return one(T.syn.get(n), VIA.SYNONYM);
    if (T.spell.has(sp)) return one(T.spell.get(sp), VIA.SPELLING);
  }
  for (const T of [LI.cur, LI.hist]) {
    const hit = new Set();
    for (const k of keys) for (const id of T.key.get(k) || []) hit.add(id);
    if (hit.size) return one(hit, VIA.ALIAS);
  }
  return null;
}

/**
 * A deal's parcel addresses → its match state and the street(s) it touches.
 * @returns {{state, streets:[{id, via, houses:[]}], reasons:[], addresses:number, addressesTotal:number}}
 */
function matchDeal(LI, addresses, addressesTotal) {
  const list = (Array.isArray(addresses) ? addresses : []).map((a) => String(a == null ? '' : a).trim()).filter(Boolean);
  /* no stated total with a full page of 3 shown addresses: the list may be cut — never assumed complete */
  const totalKnown = addressesTotal != null && addressesTotal !== '' && Number.isFinite(Number(addressesTotal));
  const total = totalKnown && Number(addressesTotal) > list.length ? Number(addressesTotal) : list.length;
  const cutUnknown = !totalKnown && list.length >= 3;
  if (!list.length) return { state: STATE.NO_ADDRESS, streets: [], reasons: [], addresses: 0, addressesTotal: total };
  const by = new Map();
  let unresolved = 0, ambiguous = 0;
  for (const a of list) {
    const p = parseAddress(a);
    const r = resolveStreet(LI, p.street);
    if (!r) { unresolved++; continue; }
    if (r.ambiguous) { ambiguous++; continue; }
    const cur = by.get(r.id) || { id: r.id, via: r.via, houses: [] };
    if (VIA_RANK[r.via] > VIA_RANK[cur.via]) cur.via = r.via;   // the weakest rung that put an address on the street
    if (p.house && !cur.houses.includes(p.house)) cur.houses.push(p.house);
    by.set(r.id, cur);
  }
  const streets = [...by.values()];
  if (!streets.length) return { state: STATE.UNRESOLVED, streets: [], reasons: ambiguous ? [REASON.AMBIGUOUS_ADDRESS] : [REASON.UNRESOLVED_ADDRESS], addresses: list.length, addressesTotal: total };
  const reasons = [];
  if (streets.length > 1) reasons.push(REASON.MULTI_STREET);
  if (total > list.length || cutUnknown) reasons.push(REASON.TRUNCATED);
  if (streets.some((x) => x.via === VIA.ALIAS)) reasons.push(REASON.LOOSE_NAME);
  if (unresolved) reasons.push(REASON.UNRESOLVED_ADDRESS);
  if (ambiguous) reasons.push(REASON.AMBIGUOUS_ADDRESS);
  return { state: reasons.length ? STATE.POSSIBLE : STATE.OBSERVED, streets, reasons, addresses: list.length, addressesTotal: total };
}

module.exports = { STATE, VIA, REASON, parseAddress, spellKey, localityIndex, resolveStreet, matchDeal };
