# -*- coding: utf-8 -*-
"""Build the OFFLINE/artifact variant of the PROPX app from the deployed one.

The deployed site (repo root) authenticates server-side (Edge middleware +
/api/login against the SITE_PASSWORD env var). This script produces
standalone/israel-new-homes-v2.html for use as a local file or a private
Claude artifact, where no server exists: it inlines the official-indicator
snapshot and hides the server logout/session controls.

It embeds NO password gate and NO credential. The repository is public, and a
client-side check cannot protect content that is already in the HTML, so a
gate only ever added a way to leak a password. Production access stays with
the server-side gate alone. Passing a password is refused on purpose.

Usage: python3 scripts/build-standalone.py
"""
import sys, pathlib, hashlib

if len(sys.argv) > 1:
    sys.exit("build-standalone.py takes no arguments: the offline build embeds no "
             "password or credential (the repository is public).")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DST = ROOT / "standalone" / "israel-new-homes-v2.html"

s = SRC.read_text(encoding="utf-8")
# the exact source this build came from — test/integrity.test.js recomputes it,
# so a stale standalone fails the gate
SRC_SHA = hashlib.sha256(SRC.read_bytes()).hexdigest()
# the Artifact host supplies doctype/html/head/body — strip the deploy skeleton
s = "\n".join(ln for ln in s.split("\n") if "<!-- doc-skeleton -->" not in ln)

OFFLINE_CSS = """
/* offline build: no server session — hide logout controls, and the ALTARIS
   link (a server route, /altaris, that an offline file cannot open) */
#logoutBtn,.rail a[href="/api/logout"],.rail a[href="/altaris"]{display:none!important}
"""

# no server offline: inline the latest official-indicator snapshot in place of
# the /data/market/latest.js request (the page falls back to its dated figures
# if the snapshot is empty)
TAG = '<script src="/data/market/latest.js"></script>'
assert s.count(TAG) == 1
snap = (ROOT / "data" / "market" / "latest.js").read_text(encoding="utf-8")
assert "<" not in snap.split("*/", 1)[-1], "snapshot must not contain raw '<'"
s = s.replace(TAG, "<script>\n" + snap + "</script>", 1)

# the same for the official CBS new-home sales snapshot (data/cbs-sales/latest.js, written by the CBS sync)
TAG2 = '<script src="/data/cbs-sales/latest.js"></script>'
assert s.count(TAG2) == 1
snap2 = (ROOT / "data" / "cbs-sales" / "latest.js").read_text(encoding="utf-8")
assert "<" not in snap2.split("*/", 1)[-1], "CBS snapshot must not contain raw '<'"
s = s.replace(TAG2, "<script>\n" + snap2 + "</script>", 1)

# the shared table sort / filter core (lib/table/core.js) — pure functions, inlined like the snapshots
TAG3 = '<script src="/lib/table/core.js"></script>'
assert s.count(TAG3) == 1
core = (ROOT / "lib" / "table" / "core.js").read_text(encoding="utf-8")
assert "</script" not in core.lower(), "table core must not close the script element"
s = s.replace(TAG3, "<script>\n" + core + "</script>", 1)

# the explainability registry (lib/explain/registry.js) — pure bilingual data, inlined the same way
TAG4 = '<script src="/lib/explain/registry.js"></script>'
assert s.count(TAG4) == 1
xp = (ROOT / "lib" / "explain" / "registry.js").read_text(encoding="utf-8")
assert "</script" not in xp.lower(), "explain registry must not close the script element"
s = s.replace(TAG4, "<script>\n" + xp + "</script>", 1)

# the map geography (lib/geo/boundaries.js) — Natural Earth boundaries, geometry only, inlined the same way
TAG5 = '<script src="/lib/geo/boundaries.js"></script>'
assert s.count(TAG5) == 1
geo = (ROOT / "lib" / "geo" / "boundaries.js").read_text(encoding="utf-8")
assert "</script" not in geo.lower(), "geo boundaries must not close the script element"
s = s.replace(TAG5, "<script>\n" + geo + "</script>", 1)

# the user-evidence validator (lib/dd/userdocs.js) — pure functions; the due-diligence panel is server-only, inlined so the
# page never requests a missing file offline
TAG6 = '<script src="/lib/dd/userdocs.js"></script>'
assert s.count(TAG6) == 1
ud = (ROOT / "lib" / "dd" / "userdocs.js").read_text(encoding="utf-8")
assert "</script" not in ud.lower(), "user-docs validator must not close the script element"
s = s.replace(TAG6, "<script>\n" + ud + "</script>", 1)

BUILD_META = '<meta name="propx-build"'
assert s.count(BUILD_META) == 1
s = s.replace(BUILD_META, '<meta name="propx-source-sha256" content="%s">\n%s' % (SRC_SHA, BUILD_META), 1)

assert "</style>" in s and s.count("</style>") == 1
s = s.replace("</style>", OFFLINE_CSS + "</style>", 1)
s = s.rstrip() + "\n"

DST.write_text(s, encoding="utf-8")
print("built %s (%d chars)" % (DST, len(s)))
