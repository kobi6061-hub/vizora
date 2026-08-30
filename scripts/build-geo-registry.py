# -*- coding: utf-8 -*-
"""PROPX · Israel geography registry builder — the refresh pipeline.

Builds data/geo/ (the canonical geography the national search serves) from
the official locality/street registries. Inputs are pluggable so a future
government update is ingested by re-running this script — never by editing
the product:

  --streets-current  JSON {streets:[{city_name,street_name,...}]}
                     (official street registry names; default: the May-2026
                     mirror snapshot of the data.gov.il street registry)
  --streets-coded    JSON {streets:[{city_symbol,city_name,street_symbol,
                     street_name}]} (official symbol codes; default: the
                     2021 mirror snapshot that still carried the symbols)
  --cities-geo       JSON [{name,english_name,long,latt}] (coordinates)
  --cities-official  JSON [{semel_yeshuv,name,semel_napa,...}] (official
                     locality codes + napa; header row auto-skipped)

Identity rules (per the national-coverage directive):
  · locality id  = "loc:<official semel_yeshuv>"; a locality whose code is
    not present in any ingested source gets "locp:<slug>" and is counted in
    the audit as pending-official-code (healed by the next refresh).
  · street id    = "st:<cityCode>:<official street_symbol>", or
    "stp:<cityCode>:<8-hex name hash>" when the symbol is not yet known
    (street newer than the coded snapshot) — again audit-counted.
  · display names are NEVER keys; joins run on normalized names but the
    canonical display name is stored verbatim from the current registry.

Every output carries source descriptors + retrievedAt so the audit can
count against the source and future diffs are meaningful.
"""
import argparse, hashlib, json, pathlib, re, sys, unicodedata
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "geo"

# CBS napa (sub-district) leading digit → district; matches the official
# numbering (1x Jerusalem, 2x North, 3x Haifa, 4x Center, 5x Tel Aviv,
# 6x South, 7x Judea & Samaria area).
NAPA_DISTRICT = {"1": "d-jm", "2": "d-north", "3": "d-haifa", "4": "d-center",
                 "5": "d-ta", "6": "d-south", "7": "js-area"}

GERESH = "׳‘’'`"
GERSHAYIM = "״“”\""

def norm(s):
    """Search/join normalization. Display names are stored untouched."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s))
    for ch in GERESH:
        s = s.replace(ch, "")
    for ch in GERSHAYIM:
        s = s.replace(ch, "")
    s = s.replace("־", "-").replace("–", "-").replace(".", " ")
    s = re.sub(r"\s*-\s*", "-", s)
    s = re.sub(r"[()]", " ", s)
    s = s.replace("יי", "י")  # spelling variants: קריית/קרית, בניין/בנין …
    s = re.sub(r"\s+", " ", s).strip()
    return s

def slug8(s):
    return hashlib.sha1(norm(s).encode("utf-8")).hexdigest()[:8]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--streets-current", required=True)
    ap.add_argument("--streets-coded", required=True)
    ap.add_argument("--cities-geo", required=True)
    ap.add_argument("--cities-official", required=True)
    ap.add_argument("--source-note", default="data.gov.il registries via mirror snapshots")
    a = ap.parse_args()

    cur = json.load(open(a.streets_current, encoding="utf-8"))["streets"]
    coded = json.load(open(a.streets_coded, encoding="utf-8"))["streets"]
    geo = json.load(open(a.cities_geo, encoding="utf-8"))
    off = json.load(open(a.cities_official, encoding="utf-8"))

    # ---------------- localities ----------------
    # official codes by normalized name (registry file has a header-map row 0)
    off_rows = [r for r in off if str(r.get("semel_yeshuv", "")).strip().isdigit()]
    off_by_name = {norm(r["name"]): r for r in off_rows}
    coded_city_by_name = {}
    for r in coded:
        coded_city_by_name.setdefault(norm(r["city_name"]), int(r["city_symbol"]))
    geo_by_name = {norm(r["name"]): r for r in geo}

    current_city_names = sorted({r["city_name"].strip() for r in cur})
    localities, pending_loc = [], []
    code_of_city = {}
    for name in current_city_names:
        n = norm(name)
        o = off_by_name.get(n)
        code = int(o["semel_yeshuv"]) if o else coded_city_by_name.get(n)
        g = geo_by_name.get(n) or geo_by_name.get(n.replace("(שבט)", "").strip())
        napa = str(o.get("semel_napa", "")).strip() if o else ""
        district = NAPA_DISTRICT.get(napa[:1]) if napa else None
        loc_id = f"loc:{code}" if code else f"locp:{slug8(name)}"
        if not code:
            pending_loc.append(name)
        code_of_city[n] = code
        localities.append({
            "id": loc_id, "code": code, "he": name,
            "en": (g or {}).get("english_name") or (o or {}).get("english_name") or None,
            "lat": (g or {}).get("latt"), "lng": (g or {}).get("long"),
            "napa": napa or None, "district": district,
            "moatza": (o or {}).get("shem_moaatza") or None,
        })

    # ---------------- streets ----------------
    code_by_pair = {}
    for r in coded:
        code_by_pair[(norm(r["city_name"]), norm(r["street_name"]))] = int(r["street_symbol"])

    streets, pending_st, seen = [], 0, set()
    for r in cur:
        cn, sn = r["city_name"].strip(), r["street_name"].strip()
        ncity, nstreet = norm(cn), norm(sn)
        ccode = code_of_city.get(ncity)
        scode = code_by_pair.get((ncity, nstreet))
        # a street row that just repeats the locality name is the registry's
        # "locality as its own street" row — keep it (small localities)
        sid = (f"st:{ccode}:{scode}" if (ccode and scode)
               else f"stp:{ccode or slug8(cn)}:{slug8(sn)}")
        if sid in seen:
            continue
        seen.add(sid)
        if not (ccode and scode):
            pending_st += 1
        streets.append([ccode, scode, sn, cn] if (ccode and scode) else [ccode, None, sn, cn])

    OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        "builtAt": date.today().isoformat(),
        "sources": {
            "streetsCurrent": {"note": "official street registry names (May-2026 mirror of the data.gov.il street registry)", "rows": len(cur)},
            "streetsCoded": {"note": "official street symbols (2021 mirror of the same registry, pre symbol-removal)", "rows": len(coded)},
            "citiesOfficial": {"note": "official locality registry with semel_yeshuv + napa", "rows": len(off_rows)},
            "citiesGeo": {"note": "locality coordinates", "rows": len(geo)},
            "synonyms": {"note": "official street-synonyms dataset — NOT yet ingested (no reachable snapshot); alias layer ships with built-in normalization + curated aliases and ingests the official dataset on next refresh", "rows": 0},
            "statAreas": {"note": "CBS statistical areas — NOT yet ingested (no reachable snapshot); registry schema reserves the layer", "rows": 0},
        },
        "counts": {
            "localities": len(localities),
            "localitiesWithOfficialCode": sum(1 for l in localities if l["code"]),
            "localitiesPendingCode": len(pending_loc),
            "streets": len(streets),
            "streetsWithOfficialCode": sum(1 for s in streets if s[1]),
            "streetsPendingCode": pending_st,
        },
        "note": a.source_note,
    }
    json.dump({"meta": meta, "localities": localities},
              open(OUT / "localities.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"meta": {"builtAt": meta["builtAt"], "columns": ["cityCode", "streetCode", "street", "city"]},
               "streets": streets},
              open(OUT / "streets-index.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(meta, open(OUT / "registry-meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---------------- COVERAGE PROOF: source MINUS index must be empty ----------------
    idx_loc_names = {norm(l["he"]) for l in localities}
    idx_loc_codes = {l["code"] for l in localities if l["code"]}
    idx_street_keys = {(norm(s[3]), norm(s[2])) for s in streets}
    miss_loc_names = sorted({norm(r["city_name"]) for r in cur} - idx_loc_names)
    miss_off_codes = sorted({int(r["semel_yeshuv"]) for r in off_rows} - idx_loc_codes)
    miss_streets = [(c, s) for (c, s) in {(norm(r["city_name"]), norm(r["street_name"])) for r in cur}
                    if (c, s) not in idx_street_keys]
    report = {
        "builtAt": meta["builtAt"],
        "localities": {
            "officialRegistryCount": len(current_city_names),
            "indexed": len(localities),
            "missing": len(miss_loc_names),
            "missingSample": miss_loc_names[:10],
            "officialCodeRegistryCount": len(off_rows),
            "officialCodesNotIndexed": len(miss_off_codes),
            "officialCodesNotIndexedNote": "locality codes present in the official code registry but absent from the current street-registry snapshot (dissolved/merged or unpopulated localities); listed, not dropped silently",
            "officialCodesNotIndexedSample": miss_off_codes[:15],
            "pendingOfficialCode": len(pending_loc),
        },
        "streets": {
            "officialRegistryCount": len({(norm(r['city_name']), norm(r['street_name'])) for r in cur}),
            "indexed": len(streets),
            "missing": len(miss_streets),
            "missingSample": miss_streets[:10],
            "withOfficialCode": meta["counts"]["streetsWithOfficialCode"],
            "pendingOfficialCode": meta["counts"]["streetsPendingCode"],
            "pendingNote": "streets present in the current official registry whose symbol is newer than the coded snapshot (dominated by the 2022-2025 Arab-municipality street-naming drive); searchable today under a stable provisional id, healed to the official symbol on the next refresh",
        },
        "synonyms": {"imported": 0, "unresolved": 0, "note": "official synonyms dataset pending a reachable snapshot; normalization + curated aliases active"},
        "statAreas": {"expected": None, "mapped": 0, "note": "CBS statistical areas pending a reachable snapshot; schema slot reserved"},
        "setDifferencePass": len(miss_loc_names) == 0 and len(miss_streets) == 0,
    }
    json.dump(report, open(OUT / "coverage-report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(meta["counts"], ensure_ascii=False, indent=1))
    print("SET-DIFFERENCE:", "PASS (source minus index = empty set)" if report["setDifferencePass"]
          else "FAIL loc=%d st=%d" % (len(miss_loc_names), len(miss_streets)))
    if pending_loc:
        print("pending-code localities:", ", ".join(pending_loc[:12]), "..." if len(pending_loc) > 12 else "")

if __name__ == "__main__":
    sys.exit(main())
