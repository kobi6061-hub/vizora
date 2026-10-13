# Urban renewal — MoCH complexes

**Source.** data.gov.il dataset `urban_renewal` (Ministry of Construction and Housing), resource "מתחמי התחדשות
עירונית" (`f65a0daf-f737-49c5-9424-d378d52104f5`, CKAN datastore). One row per complex of the municipal and tax
urban-renewal tracks. Verified by `scripts/land-discover.js --supply` (Actions run 38330753512, 13.10.2026): 970
rows, resource last modified 2026-08-15. Classification CONFIRMED_STRUCTURED_API.

**What a row is — and is not.** A complex (מתחם) with its locality (name + CBS code), name, existing / additional /
proposed housing units, declaration date, plan number, links, track, approval year, an execution flag and the
Ministry's status. It is *not* construction (the status says how far planning / licensing went), not every renewal
project (TAMA 38 building permits are not complexes) and not a developer record.

## Modules

| file | role |
| --- | --- |
| `source.js` | `SOURCE` descriptor; `fetchComplexes()` — paged CKAN read, complete or fail |
| `normalize.js` | row → record: trimmed text, plain numbers only (text / "" → null, never 0), status verbatim + mapped `stage`, `declaration` (`declared` / `not-yet-declared` / `not-stated`), `unitsAddUp`, http(s) links only; required columns checked (`schema changed` fails the run) |
| `store.js` | `mergeRecords()` (upsert on the complex number, `firstSeenAt` kept, `inLatestSource` false when a row leaves, field history) + `FileRenewalStore` (`data/renewal/`) |
| `query.js` | read model for `api/intel.js`: `summary`, `records` (filters: city, stage, track, declaration, q; sorts), `record`, `searchHits` |

## Rules

- **Status verbatim.** The stage map covers only the exact status strings observed on 13.10.2026; anything else maps
  to `unknown` and is shown as the Ministry wrote it.
- **Units as published.** Existing + additional = proposed is checked per row (`unitsAddUp`); a row where it does not
  add up is shown as published with "≠", never corrected. Summed KPIs say over how many complexes they sum and are
  tagged DERIVED.
- **Nothing deleted.** A complex that leaves the source stays, marked `inLatestSource: false`, with the change in the
  history.
- **No join to developers or land.** A complex is linked to nothing it does not name itself (its plan number is shown,
  not joined).

## Files (bot-written by `.github/workflows/renewal-sync.yml`, daily 03:47 UTC)

`data/renewal/complexes.json` · `meta.json` · `history.jsonl` · `sync-runs.jsonl` · `raw/` (one snapshot per content
hash). Run locally: `node scripts/renewal-sync.js --dry-run`; offline suite: `node test/renewal.test.js`.
