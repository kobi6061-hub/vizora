#!/usr/bin/env python3
# PROPX · STREET GEOGRAPHY from the published GovMap-layer file (the GeoPackage over.org.il publishes with each dataset version — the
# same file the national missed-deal detector reads; one public GET on the runner, nothing new is integrated).
#
# Each row of the file is one deal with its OWN location: a representative point of the parcel / building polygon the source files it
# under (polygonId), its settlementId (the official locality code), streetCode (<locality code> × 10,000 + the official street code —
# decoded, its locality part checked), house number, and the
# neighbourhood NAME the source prints. Coordinates are never used to join a record to anything — they place the street's buildings on
# the map and give distances their basis. Written per locality (data/geo/street-geo/loc/<code>.json.gz):
#
#   streets   <streetCode> → pts: one per polygon the street's rows name [lng, lat, house, rows, firstDate, lastDate, gush, parcel]
#                            nb:  the neighbourhood names the source prints on the street's rows [[name, rows]]
#   nb        <name>       → rows, streets [[streetCode, rows]], bbox, centroid (median of its points) — a SOURCE LABEL, not a boundary
#
# A row without a geometry, a settlementId or a streetCode places nothing (counted in meta.json). The file's coordinate system is read
# from gpkg_spatial_ref_sys (EPSG 4326 used as is; 2039 / 3857 converted). VALIDATION: the same deals as published by the layer's API
# (data/streets/recent/raw/*.jsonl.gz — objectid, lon, lat) must agree with the file's point (median ≤ 15 m, ≥ 95 % within 50 m) or
# nothing is written.
# Usage: python3 -I scripts/street-geo-build.py <file.gpkg> <out-dir> <raw-api-dir> <directory.json>

import gzip, json, math, os, sqlite3, struct, sys
from collections import defaultdict

def itm_to_wgs84(x, y):
    """ITM (EPSG:2039) → WGS84, the inverse Transverse Mercator of lib/geo/itm.js (GRS80, published grid constants)"""
    a = 6378137.0; f = 1 / 298.257222101; e2 = f * (2 - f); e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2)); k0 = 1.0000067
    lat0 = (31 + 44 / 60 + 3.817 / 3600) * math.pi / 180; lon0 = (35 + 12 / 60 + 16.261 / 3600) * math.pi / 180; FE = 219529.584; FN = 626907.390
    def arc(phi):
        return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
                    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    M = arc(lat0) + (y - FN) / k0
    mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256))
    p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu) \
        + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu)
    ep2 = e2 / (1 - e2); s1, c1, t1 = math.sin(p1), math.cos(p1), math.tan(p1)
    C1 = ep2 * c1 * c1; T1 = t1 * t1; N1 = a / math.sqrt(1 - e2 * s1 * s1); R1 = a * (1 - e2) / (1 - e2 * s1 * s1) ** 1.5; D = (x - FE) / (N1 * k0)
    lat = p1 - (N1 * t1 / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720)
    lng = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c1
    return lng * 180 / math.pi, lat * 180 / math.pi

def merc_to_wgs84(x, y):
    return x / 6378137.0 * 180 / math.pi, (2 * math.atan(math.exp(y / 6378137.0)) - math.pi / 2) * 180 / math.pi

def haversine(lng1, lat1, lng2, lat2):
    r = 6371008.8; p1, p2 = math.radians(lat1), math.radians(lat2); dp = p2 - p1; dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))

ENV_LEN = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
def point_of(blob):
    """a GeoPackage geometry blob → (x, y): the point itself, else the envelope centre, else the mean of the first ring; None when empty"""
    if not blob or len(blob) < 8 or blob[0:2] != b'GP':
        return None
    flags = blob[3]
    if flags & 0x10:
        return None
    le = '<' if flags & 1 else '>'
    env = (flags >> 1) & 7
    off = 8
    if env:
        e = struct.unpack(le + 'dddd', blob[off:off + 32])
        off += ENV_LEN.get(env, 0)
    wkb = blob[off:]
    bo = '<' if wkb[0] == 1 else '>'
    t = struct.unpack(bo + 'I', wkb[1:5])[0] & 0xFFFF
    base = t % 1000
    dim = 3 if (t // 1000) in (1, 2) else 4 if (t // 1000) == 3 else 2
    if base == 1:
        x, y = struct.unpack(bo + 'dd', wkb[5:21])
        return x, y
    if env:
        return (e[0] + e[1]) / 2, (e[2] + e[3]) / 2
    def ring_mean(buf, o):
        n = struct.unpack(bo + 'I', buf[o:o + 4])[0]; o += 4
        sx = sy = 0.0
        for i in range(n):
            x, y = struct.unpack(bo + 'dd', buf[o + i * 8 * dim:o + i * 8 * dim + 16]); sx += x; sy += y
        return (sx / n, sy / n) if n else None
    if base == 3:
        return ring_mean(wkb, 9)
    if base == 6:
        # the first polygon's first ring: header(5) + count(4) + polygon header(5) + ring count(4)
        return ring_mean(wkb, 9 + 9)
    return None

def main():
    src, out, rawdir, dirfile = sys.argv[1:5]
    con = sqlite3.connect('file:' + src + '?mode=ro', uri=True)
    cur = con.cursor()
    table = [r[0] for r in cur.execute("SELECT table_name FROM gpkg_contents WHERE data_type = 'features'")][0]
    gcol, gtype, srs = cur.execute('SELECT column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns WHERE table_name = ?', (table,)).fetchone()
    org = cur.execute('SELECT organization, organization_coordsys_id, srs_name FROM gpkg_spatial_ref_sys WHERE srs_id = ?', (srs,)).fetchone()
    epsg = int(org[1]) if org and str(org[0]).upper() == 'EPSG' else int(srs)
    conv = (lambda x, y: (x, y)) if epsg == 4326 else itm_to_wgs84 if epsg == 2039 else merc_to_wgs84 if epsg in (3857, 900913) else None
    if conv is None:
        raise SystemExit('unsupported coordinate system: %s' % (org,))
    cols = {r[1].lower(): r[1] for r in cur.execute('PRAGMA table_info("%s")' % table)}
    need = ['objectid', 'settlementid', 'streetcode', 'streetnameheb', 'housenum', 'neighborhood', 'dealdate', 'gushnum', 'parcelnum', 'polygonid']
    q = 'SELECT %s, "%s" FROM "%s"' % (', '.join('"%s"' % cols[c] for c in need), gcol, table)
    # the API's own points for the same deals (validation)
    api = {}
    for fn in sorted(os.listdir(rawdir)):
        if not fn.endswith('.jsonl.gz'):
            continue
        with gzip.open(os.path.join(rawdir, fn), 'rt', encoding='utf-8') as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get('objectid') is not None and r.get('lon') is not None and r.get('lat') is not None:
                    api[int(r['objectid'])] = (float(r['lon']), float(r['lat']))
    directory = json.load(open(dirfile, encoding='utf-8'))
    dcols = directory['columns']; ci, si, ni = dcols.index('cityCode'), dcols.index('streetCode'), dcols.index('name')
    dnames = {(int(r[ci]), int(r[si])): r[ni] for r in directory['rows']}
    S = defaultdict(dict)          # code → streetCode → polygonId → [sx, sy, n, houses{}, first, last, gush, parcel]
    SNB = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    NB = defaultdict(lambda: defaultdict(lambda: {'rows': 0, 'streets': defaultdict(int), 'xs': [], 'ys': []}))
    st = defaultdict(int)
    dists = []
    names_same = names_diff = 0
    for r in cur.execute(q):
        oid, setid, scode, sname, house, nb, date, gush, parcel, poly, blob = r
        st['rows'] += 1
        p = point_of(blob)
        if p is None:
            st['noGeometry'] += 1
            continue
        lng, lat = conv(p[0], p[1])
        if not (29.3 <= lat <= 33.5 and 34.0 <= lng <= 36.0):
            st['outsideIsrael'] += 1
            continue
        if oid is not None and int(oid) in api:
            a = api[int(oid)]
            dists.append(haversine(lng, lat, a[0], a[1]))
        try:
            code = int(setid) if setid not in (None, '') else None
        except (TypeError, ValueError):
            code = None
        if code is None:
            st['noSettlementId'] += 1
            continue
        nbname = (nb or '').strip() or None
        try:
            sc = int(scode) if scode not in (None, '') else None
        except (TypeError, ValueError):
            sc = None
        if nbname:
            n = NB[code][nbname]; n['rows'] += 1; n['xs'].append(lng); n['ys'].append(lat)
        if sc is None or sc <= 0:
            st['noStreetCode'] += 1
            continue
        # the layer writes the street code as <locality code> × 10,000 + <official street code>: decoded, and kept only when its
        # locality part is the row's own locality (a code naming another locality places nothing)
        if sc >= 10000:
            if sc // 10000 != code:
                st['streetCodeOtherLocality'] += 1
                continue
            sc = sc % 10000
        if nbname:
            NB[code][nbname]['streets'][sc] += 1
        if (code, sc) in dnames:
            st['streetInDirectory'] += 1
            if sname and dnames[(code, sc)].replace(' ', '') == str(sname).replace(' ', ''):
                names_same += 1
            else:
                names_diff += 1
        else:
            st['streetNotInDirectory'] += 1
        key = str(poly) if poly not in (None, '') else '%s-%s' % (gush, parcel)
        e = S[code].get(sc)
        if e is None:
            e = S[code][sc] = {}
        g = e.get(key)
        d = str(date)[:10] if date else None
        if g is None:
            g = e[key] = [0.0, 0.0, 0, defaultdict(int), d, d, gush, parcel]
        g[0] += lng; g[1] += lat; g[2] += 1
        if house not in (None, ''):
            g[3][str(house).strip()] += 1
        if d and (g[4] is None or d < g[4]): g[4] = d
        if d and (g[5] is None or d > g[5]): g[5] = d
        if nbname:
            SNB[code][sc][nbname] += 1
        st['placed'] += 1
    dists.sort()
    val = {'matched': len(dists), 'apiRows': len(api)}
    if dists:
        val.update({'medianM': round(dists[len(dists) // 2], 2), 'p95M': round(dists[int(len(dists) * 0.95)], 2), 'maxM': round(dists[-1], 2),
                    'within50mPct': round(100.0 * sum(1 for x in dists if x <= 50) / len(dists), 2)})
    val['pass'] = bool(dists) and val['medianM'] <= 15 and val['within50mPct'] >= 95
    print(json.dumps({'table': table, 'geometryColumn': gcol, 'geometryType': gtype, 'srs': {'id': srs, 'org': org, 'epsg': epsg}, 'stats': st, 'validation': val,
                      'directoryNames': {'same': names_same, 'different': names_diff}}, ensure_ascii=False))
    if not val['pass']:
        raise SystemExit('validation failed — nothing written')
    os.makedirs(os.path.join(out, 'loc'), exist_ok=True)
    med = lambda xs: sorted(xs)[len(xs) // 2]
    loc_index = {}
    for code in sorted(set(S) | set(NB)):
        streets = {}
        for sc, polys in S.get(code, {}).items():
            pts = []
            for key, g in polys.items():
                hs = sorted(g[3].items(), key=lambda kv: (-kv[1], kv[0]))
                pts.append([round(g[0] / g[2], 6), round(g[1] / g[2], 6), hs[0][0] if hs else None, g[2], g[4], g[5], g[6], g[7]])
            pts.sort(key=lambda p: (p[0], p[1]))
            nbl = sorted(SNB[code][sc].items(), key=lambda kv: (-kv[1], kv[0])) if code in SNB and sc in SNB[code] else []
            streets[str(sc)] = {'pts': pts, 'nb': [[k, v] for k, v in nbl]}
        nbs = {}
        for name, n in NB.get(code, {}).items():
            nbs[name] = {'rows': n['rows'], 'streets': sorted([[k, v] for k, v in n['streets'].items()], key=lambda kv: (-kv[1], kv[0])),
                         'centroid': [round(med(n['xs']), 6), round(med(n['ys']), 6)],
                         'bbox': [round(min(n['xs']), 6), round(min(n['ys']), 6), round(max(n['xs']), 6), round(max(n['ys']), 6)]}
        doc = {'schema': 1, 'code': code, 'streets': streets, 'nb': nbs}
        with gzip.open(os.path.join(out, 'loc', '%d.json.gz' % code), 'wt', encoding='utf-8') as fh:
            json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
        loc_index[code] = {'streets': len(streets), 'points': sum(len(s['pts']) for s in streets.values()), 'neighbourhoodNames': len(nbs)}
    meta = {'schema': 1, 'engine': 'propx-street-geo-1', 'table': table, 'geometryType': gtype, 'srs': {'id': srs, 'epsg': epsg, 'name': org[2] if org else None},
            'stats': dict(st), 'validation': val, 'directoryNames': {'same': names_same, 'different': names_diff},
            'localities': {str(k): v for k, v in sorted(loc_index.items())},
            'method': 'one representative point per polygon (parcel / building) the source files a deal under; the point is the mean of its rows\' points',
            'notJoin': 'coordinates never join a record to another — they place a street\'s buildings and give a distance its basis'}
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
