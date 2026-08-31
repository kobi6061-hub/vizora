# PROPX · National Geography Layer

Complete, canonical Israeli geography — independent of whether a place has
any market data. **Geography and transactions are two separate layers**: a
street exists in PROPX because the official registry says it exists, never
because a deal was reported on it.

```
ISRAEL → locality → neighborhood (where resolvable) → street → address
```

## Files

| File | Role |
| --- | --- |
| `scripts/build-geo-registry.py` | refresh pipeline: ingests the official locality + street registries, emits `data/geo/*`, writes the set-difference proof |
| `data/geo/localities.json` | 1,304 localities: canonical id, official code, names, district, coordinates, regional council |
| `data/geo/streets-index.json` | 63,559 official streets: `[cityCode, streetCode, street, city]` |
| `data/geo/neighborhoods.json` | neighborhood registry + verified street links |
| `lib/geo/aliases.js` | deterministic spelling-variant expansion (the search keys) |
| `lib/geo/registry.js` | inverted alias index + national search + id resolution |
| `lib/geo/neighborhoods.js` | neighborhood resolution layer (verified → observed → unresolved) |
| `lib/geo/itm.js` | ITM (EPSG:2039) and Web Mercator (EPSG:3857) ↔ WGS84, haversine, Israel bounds |
| `api/geo/search.js` | `GET /api/geo/search?q=` |
| `scripts/geo-audit.js` | national coverage audit + randomized/adversarial QA |

## Canonical identity

Display names are never identifiers.

- locality — `loc:<official code>`; `locp:<slug>` while an official code is pending
- street — `st:<localityCode>:<streetCode>`; `stp:<…>` while pending
- neighborhood — `nb:<id>`

`locality_code + street_code` is the street's identity, so the many
same-named streets across Israel can never collide: search always returns
city-qualified rows.

## Aliases

Each official name expands once into normalized search keys: street-type
prefixes (רחוב/שד׳/דרך/סמטת/משעול/כיכר), honorifics (הרב/ד״ר/ע״ש), geresh &
gershayim, final-letter folding, doubled yud/vav, hyphen↔space, optional
leading ה. The canonical display name is never altered — the keys only make a
typed variant reach the right record. `שדרות בן גוריון` finds the registry's
own `שד בן גוריון`.

## Neighborhoods — resilient by design

Israel has no single authoritative nationwide neighborhood registry, so the
layer resolves in priority order and states which applied:

1. `verified-street-link` — a verified street→neighborhood mapping
2. `observed-on-official-deal-records` — the neighborhood published on official
   government transaction records for that street
3. `unresolved` — no authoritative mapping

**A street is never hidden, dropped or downgraded because its neighborhood is
unresolved.** It stays fully searchable, attached to its locality, and the
transaction fallback simply continues to the city level. Neighborhoods are
never invented, and a statistical area is never relabelled as a named
neighborhood.

## Transaction fallback ladder

```
building → street → neighborhood → locality → 250m → 500m → 1km
```

The rung that produced the rows is always reported (`scope.level`,
`scope.sampleSize`, `scope.fallbackReason`), and a wider rung is never
presented as the narrower one. A thin street sample is shown as-is —
street rows are never swapped out for neighborhood rows, and any wider
benchmark is labelled separately and never blended into street statistics.

## Refresh

`scripts/build-geo-registry.py` takes the official sources as arguments, so a
government update is ingested by re-running it — no product rebuild. It
records source counts and a build date, and its set-difference proof fails
loudly if anything in the source is missing from the index. Canonical ids are
stable across refreshes; pending ids heal to official codes when a
code-bearing snapshot arrives.

## Audit

`node scripts/geo-audit.js` — counts vs build meta, set-difference proof,
orphans, duplicate canonical ids, alias resolution, mandated locality list
(every locality type), adversarial sample (Arab localities, kibbutzim,
moshavim, Bedouin towns, peripheral councils), random 100 localities + 500
streets, streets with no transactions, unresolved-neighborhood streets, and
the street-collision test.
