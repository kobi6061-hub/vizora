#!/usr/bin/env node
// PROPX · OWNERSHIP-SHARE AUDIT (20.10.2026) — can anything PROPX can read tell, for a recent-only GovMap-layer deal, whether it sold
// the WHOLE property, a PARTIAL share, several units for one consideration — or nothing can (UNKNOWN)?
//
// Offline part (this script): over the deals BOTH copies hold (the register states the portion sold), every field of the GovMap-layer
// row — and every pair of fields — is tested as a discriminator: a value (or pair) that holds whole-property sales only, on a support
// large enough to matter. Excluded by rule (never a basis to infer a share): the price, the area, the parcel's or unit's activity — they
// are tabulated apart, marked EXCLUDED. Runner part (recorded below with its run ids): what each source and endpoint offers.
//
//   node scripts/recent-share-audit.js        → data/streets/recent/share-audit.json + a summary on stdout

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'streets', 'recent');
const R = require('../lib/recent/reconcile');
const EV = require('../lib/streets/evidence');
const W = require('../lib/recent/window');

/* what the runner probes found (tx-freshness-discover --share run 39418100089 · --share-history run 39418597161, 20.10.2026) */
const SOURCES = [
  { id: 'over:deals-register', what: 'the Tax Authority register as republished by over.org.il (/api/deals/search, /api/deals/parcel/{gush}/{helka}, /api/append/<dataset>/…)',
    shareField: 'portion ("1.000", "0.500" …) and portion_fraction — STATED for every row', otherFields: ['date', 'date_src', 'amount', 'declared_amount', 'nature', 'area_sqm', 'rooms', 'year_built', 'sub_parcel', 'settlement', 'settlement_code', 'gush', 'helka', 'addresses', 'addresses_total', 'price_per_sqm', 'price_per_sqm_normalized'],
    dealId: 'none — the register publishes no deal id', copies: 'ONE scrape: dataset versions v1–v5 built 18.09.2026 10:03 → 19.09.2026 11:20 (city by city); weekly poll, last 17.10.2026 — no new version; per-row first_seen (all 18–19.09.2026)',
    status: 'BLOCKED AT ITS SOURCE — the publisher\'s change log (13.10.2026): "the scraping of the Tax Authority site is blocked at the moment and the database has not been updated since 19/09/2026"',
    verdict: 'RESOLVES the share for a deal it holds — only after it holds it; no later copy exists or is scheduled' },
  { id: 'over:govmap-recent', what: 'the GovMap deals layer (lay=16) as republished by over.org.il (/api/deals/govmap/search · /points · /stats)',
    shareField: 'NONE', otherFields: ['objectid', 'deal_id', 'deal_date', 'deal_date_raw', 'deal_amount', 'settlement', 'street', 'house_num', 'floor', 'asset_area', 'rooms', 'property_type', 'deal_nature', 'gush', 'parcel', 'sub_parcel', 'polygon_id', 'lon', 'lat'],
    dealId: 'deal_id (unique in every stored snapshot) + objectid — no key shared with the register', copies: 'versions v1 08.07.2026 (313,696 rows, partial) · v2 04.08.2026 (1,000,000 — capped) · v3 03.10.2026 (2,501,231) · v4 08.10.2026 (2,500,941 — 290 fewer than v3); full snapshots (files), not a row archive; the version diff returns nothing',
    status: 'READ (the recent layer)', verdict: 'CANNOT state the share — no field, no endpoint; 27 points capped at 500 deals each by GovMap itself' },
  { id: 'over:nadlan-parcel', what: '/api/nadlan/parcel/{gush}/{helka}/deals — "every deal reported on this block/parcel"', shareField: 'the register\'s portion (the same rows, served by the same function as /api/deals/parcel)',
    verdict: 'NOT A THIRD SOURCE — the register rows again' },
  { id: 'over:mcp', what: '/deals/mcp — the publisher\'s MCP endpoint over the same register', verdict: 'NOT A THIRD SOURCE' },
  { id: 'nadlan.gov.il', what: 'the government real-estate site', status: 'behind reCAPTCHA Enterprise (19.10.2026 audit)', verdict: 'NOT READ — never bypassed' },
  { id: 'govmap.gov.il', what: 'GovMap\'s own deals API', status: 'CloudFront 403 to the runner', verdict: 'NOT READ — never bypassed' },
  { id: 'nadlan.taxes.gov.il', what: 'the Tax Authority register itself', status: 'identification screen against automated reading since 29.09.2026', verdict: 'NOT READ — never bypassed' },
  { id: 'data.gov.il', what: 'open-data portal', status: 'no transaction dataset', verdict: 'NOTHING TO READ' },
];

const LINKAGES = [
  { id: 'transaction-id', verdict: 'NONE', why: 'the register publishes no deal id; the GovMap deal_id / objectid exist only in the layer' },
  { id: 'block-parcel-sub-parcel', verdict: 'PARTIAL KEY', why: 'block · parcel agree; the layer numbers sub-parcels its own way (1,984 sub-parcel differences among the deals both copies hold) — the reconciliation matches the unit OR the parcel, within one day, with the amounts agreeing (₪1,000 truncation or the share relation) and the area to the metre' },
  { id: 'date', verdict: 'KEY WITH A KNOWN OFFSET', why: 'typed series: the same day (3,160 of 3,172); untyped 1136… series: the register dates it one day later (30 of 30)' },
  { id: 'amount', verdict: 'REPRESENTATION, NOT A KEY', why: 'typed series truncated to ₪1,000; a partial sale printed as the share\'s amount (76) or the whole value (184) or neither (41) — the relation is checked only against a register deal that states its portion' },
  { id: 'in-source twin (1136… series)', verdict: 'DUPLICATE DETECTION ONLY', why: 'a second print of a typed deal one day earlier — says nothing of the share' },
  { id: 'register-share print', verdict: 'EVIDENCE ONLY WITH THE REGISTER', why: 'the layer sometimes prints a partial sale twice (share + whole value); recognisable only through the register deal\'s portion (16 rows on 20.10.2026)' },
  { id: 'later register rows', verdict: 'THE ONLY RESOLUTION — NOT AVAILABLE', why: 'a newer register copy would state the portion of every deal it holds (lib/recent/lifecycle.js confirms then); none exists since 19.09.2026 and the publisher reports its scraper blocked' },
];

function fieldTest() {
  const S = EV.store();
  const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'raw', 'index.json'), 'utf8'));
  const snap = idx.snapshots.filter((x) => x.kind === 'window').pop();
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'raw', snap.file))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byOid = new Map(raw.map((g) => [Number(g.objectid), g]));
  const rec = R.reconcile(raw, { window: W.windowOf(S.meta.source.lastDeal), loadDay: String(snap.copy.loadedAt).slice(0, 10), EV, D: require('../lib/streets/directory').load(), M: require('../lib/streets/match') });
  const pairs = [];
  for (const r of rec.rows) {
    const o = rec.out.get(r.oid);
    if (!o || !['IN_REGISTER', 'IN_REGISTER_OTHER_UNIT'].includes(o.cls) || !r.typed || !EV.DWELLING_NATURES.has(EV.natureKey(r.nature)) || o.register.portion == null) continue;
    pairs.push({ r, g: byOid.get(r.oid), partial: o.register.portion < 1 });
  }
  const unitRows = new Map(); for (const r of rec.rows) { const k = `${r.gush}|${r.parcel}|${r.sub}`; unitRows.set(k, (unitRows.get(k) || 0) + 1); }
  const parcelDay = new Map(); for (const r of rec.rows) { const k = `${r.gush}|${r.parcel}|${r.date}`; parcelDay.set(k, (parcelDay.get(k) || 0) + 1); }
  const F = {
    series: (p) => p.r.series, floorStated: (p) => (p.g.floor == null ? 'no' : 'yes'), floor: (p) => p.g.floor, roomsHalf: (p) => (p.g.rooms == null ? 'none' : Number.isInteger(p.g.rooms) ? 'whole' : 'half'),
    rooms: (p) => p.g.rooms, propertyType: (p) => p.g.property_type, dealNature: (p) => p.g.deal_nature, subParcelStated: (p) => (p.g.sub_parcel == null ? 'no' : 'yes'),
    addressPublished: (p) => (p.g.street == null ? 'no' : 'yes'), polygonForm: (p) => (/^\d+-\d+$/.test(p.g.polygon_id || '') ? 'block-parcel' : /^\d+$/.test(p.g.polygon_id || '') ? 'numeric' : 'other'),
    settlementNamed: (p) => (p.g.settlement == null ? 'no' : 'yes'), inSourceTwin: (p) => (p.r.twin ? 'yes' : 'no'), dealIdLength: (p) => String(p.g.deal_id).length,
    dealIdParity: (p) => Number(String(p.g.deal_id).slice(-1)) % 2, weekday: (p) => new Date(p.g.deal_date).getUTCDay(),
    EXCLUDED_amountRoundThousand: (p) => (p.g.deal_amount % 1000 === 0 ? 'round' : 'exact'), EXCLUDED_areaBand: (p) => (p.g.asset_area == null ? 'none' : p.g.asset_area < 60 ? '<60' : p.g.asset_area < 90 ? '60–89' : p.g.asset_area < 120 ? '90–119' : '120+'),
    EXCLUDED_unitRowsInCopy: (p) => Math.min(3, unitRows.get(`${p.r.gush}|${p.r.parcel}|${p.r.sub}`)), EXCLUDED_parcelRowsThatDay: (p) => Math.min(5, parcelDay.get(`${p.r.gush}|${p.r.parcel}|${p.r.date}`)),
  };
  const tab = (fn) => { const t = new Map(); for (const p of pairs) { const v = String(fn(p)); const e = t.get(v) || { n: 0, partial: 0 }; e.n++; if (p.partial) e.partial++; t.set(v, e); } return t; };
  const fields = {};
  for (const [k, fn] of Object.entries(F)) {
    const t = tab(fn);
    const vals = [...t].sort((a, b) => b[1].n - a[1].n).map(([v, e]) => ({ value: v, n: e.n, partial: e.partial, partialPct: Math.round((1000 * e.partial) / e.n) / 10 }));
    const pure = vals.filter((x) => x.partial === 0 && x.n >= 30);
    fields[k] = { excluded: k.startsWith('EXCLUDED_'), values: vals.slice(0, 12), distinct: vals.length, purestWithSupport30: vals.filter((x) => x.n >= 30).sort((a, b) => a.partialPct - b.partialPct)[0] || null, pureWhole: pure };
  }
  const cat = ['series', 'floorStated', 'roomsHalf', 'propertyType', 'dealNature', 'subParcelStated', 'addressPublished', 'polygonForm', 'settlementNamed', 'inSourceTwin', 'dealIdLength', 'dealIdParity', 'weekday', 'EXCLUDED_unitRowsInCopy', 'EXCLUDED_parcelRowsThatDay'];
  const leaves = [];
  for (let i = 0; i < cat.length; i++) for (let j = i + 1; j < cat.length; j++) {
    const t = tab((p) => F[cat[i]](p) + ' & ' + F[cat[j]](p));
    for (const [v, e] of t) if (e.n >= 50) leaves.push({ fields: [cat[i], cat[j]], value: v, n: e.n, partial: e.partial, partialPct: Math.round((1000 * e.partial) / e.n) / 10, usesExcluded: /EXCLUDED_/.test(cat[i] + cat[j]) });
  }
  leaves.sort((a, b) => a.partialPct - b.partialPct || b.n - a.n);
  const partial = pairs.filter((p) => p.partial).length;
  return { overlap: { dwellingDealsBothCopiesHold: pairs.length, partialInRegister: partial, partialPct: Math.round((1000 * partial) / pairs.length) / 10 }, fields,
    pairwise: { combinationsTested: (cat.length * (cat.length - 1)) / 2, leavesWithSupport50: leaves.length, purest: leaves.slice(0, 10), pureLeaves: leaves.filter((x) => x.partial === 0),
      pureLeavesWithoutExcludedFields: leaves.filter((x) => x.partial === 0 && !x.usesExcluded) } };
}

function main() {
  const ft = fieldTest();
  const pureAllowed = Object.entries(ft.fields).filter(([k, f]) => !f.excluded && f.pureWhole.length);
  const out = { schema: 1, builtAt: new Date().toISOString(), runs: { share: 39418100089, shareHistory: 39418597161 }, sources: SOURCES, linkages: LINKAGES, fieldTest: ft,
    conclusion: {
      resolvableToday: false,
      singleFieldDiscriminator: pureAllowed.length ? pureAllowed.map(([k]) => k) : 'none — no permitted field has a value holding whole-property sales only (support ≥ 30)',
      pairDiscriminator: ft.pairwise.pureLeavesWithoutExcludedFields.length ? ft.pairwise.pureLeavesWithoutExcludedFields : 'none among permitted fields; the only pure pair leaf uses the unit\'s activity in the copy (EXCLUDED by rule: activity is never a basis for the share) and was found by searching ' + ft.pairwise.combinationsTested + ' combinations — a post-hoc pattern, not a stated fact',
      onlyResolution: 'a NEWER register copy holding the same transaction (lib/recent/lifecycle.js) — none exists; the publisher reports its scraper blocked since 19.09.2026',
      consequence: 'every recent-only deal stays at most RECENT_OBSERVED_LIMITED; RECENT_OBSERVED_VERIFIED = 0; no recent price enters a statistic or the Street Value Model' } };
  fs.writeFileSync(path.join(DIR, 'share-audit.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`share audit: ${ft.overlap.dwellingDealsBothCopiesHold} dwelling deals both copies hold, ${ft.overlap.partialInRegister} partial (${ft.overlap.partialPct} %) · single-field discriminators: ${pureAllowed.length} · pure pair leaves: ${ft.pairwise.pureLeaves.length} (${ft.pairwise.pureLeavesWithoutExcludedFields.length} without an excluded field) · resolvable today: no`);
}

if (require.main === module) main();
module.exports = { SOURCES, LINKAGES, fieldTest };
