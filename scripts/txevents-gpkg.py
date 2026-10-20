#!/usr/bin/env python3
# PROPX · read ONE published GovMap-layer file (the GeoPackage over.org.il publishes with each dataset version) and write, without
# changing a value:
#   window.jsonl.gz    every row dated on / after --from, verbatim (attribute columns only; the geometry blob is not copied — the
#                      layer's own lon / lat columns stay)
#   parcels.jsonl.gz   over EVERY row of the file: (settlement, gush, parcel, street, house) → rows, first and last date — the layer's
#                      own address of each parcel, the basis of the parcel → street recovery
#   schema.json        the table, its columns, row counts, the date range, rows per year
# Usage: python3 -I scripts/txevents-gpkg.py <file.gpkg|file.parquet> <out-dir> --from YYYY-MM-DD
# Read-only on the input; standard library only for a GeoPackage (SQLite). A GeoParquet file needs pyarrow.

import gzip, json, os, sqlite3, sys
from collections import defaultdict

def iso(v):
    """a date as the file stores it → YYYY-MM-DD (text, epoch seconds or milliseconds); None when absent"""
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        import datetime
        x = float(v)
        if x > 1e11:
            x = x / 1000.0
        return datetime.datetime.utcfromtimestamp(x).strftime('%Y-%m-%d')
    return str(v)[:10]

def rows_gpkg(path):
    con = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    cur = con.cursor()
    feats = [r[0] for r in cur.execute("SELECT table_name FROM gpkg_contents WHERE data_type IN ('features','attributes')")]
    if not feats:
        raise SystemExit('no feature table in the GeoPackage')
    table = feats[0]
    geom = set(r[0] for r in cur.execute('SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?', (table,)))
    cols = [r[1] for r in cur.execute('PRAGMA table_info("%s")' % table.replace('"', '""')) if r[1] not in geom]
    total = cur.execute('SELECT count(*) FROM "%s"' % table.replace('"', '""')).fetchone()[0]
    def gen():
        q = 'SELECT %s FROM "%s"' % (', '.join('"%s"' % c.replace('"', '""') for c in cols), table.replace('"', '""'))
        for r in con.execute(q):
            yield dict(zip(cols, r))
    return {'table': table, 'columns': cols, 'geometry': sorted(geom), 'total': total, 'rows': gen()}

def rows_parquet(path):
    import pyarrow.parquet as pq
    f = pq.ParquetFile(path)
    cols = [c for c in f.schema_arrow.names if c not in ('geometry', 'geom')]
    def gen():
        for b in f.iter_batches(columns=cols, batch_size=100000):
            for r in b.to_pylist():
                yield r
    return {'table': os.path.basename(path), 'columns': cols, 'geometry': ['geometry'], 'total': f.metadata.num_rows, 'rows': gen()}

def main():
    if len(sys.argv) < 3:
        raise SystemExit('usage: txevents-gpkg.py <file> <out-dir> --from YYYY-MM-DD')
    src, out = sys.argv[1], sys.argv[2]
    frm = sys.argv[sys.argv.index('--from') + 1] if '--from' in sys.argv else '0000-00-00'
    os.makedirs(out, exist_ok=True)
    head = open(src, 'rb').read(16)
    T = rows_gpkg(src) if head.startswith(b'SQLite format 3') else rows_parquet(src)
    low = {c.lower(): c for c in T['columns']}
    def col(*names):
        for n in names:
            if n in low:
                return low[n]
        return None
    c_date = col('deal_date', 'dealdate', 'date')
    c_set, c_st, c_house = col('settlement', 'settlementname', 'city'), col('street', 'streetname'), col('house_num', 'housenum', 'house')
    c_gush, c_parcel = col('gush', 'block'), col('parcel', 'helka')
    years = defaultdict(int)
    agg = {}
    n = nwin = 0
    dmin = dmax = None
    with gzip.open(os.path.join(out, 'window.jsonl.gz'), 'wt', encoding='utf-8') as w:
        for r in T['rows']:
            n += 1
            d = iso(r.get(c_date)) if c_date else None
            if d:
                years[d[:4]] += 1
                dmin = d if dmin is None or d < dmin else dmin
                dmax = d if dmax is None or d > dmax else dmax
            k = (r.get(c_set), r.get(c_gush), r.get(c_parcel), r.get(c_st), r.get(c_house))
            if k[1] is not None and k[2] is not None:
                a = agg.get(k)
                if a is None:
                    agg[k] = [1, d, d]
                else:
                    a[0] += 1
                    if d and (a[1] is None or d < a[1]): a[1] = d
                    if d and (a[2] is None or d > a[2]): a[2] = d
            if d and d >= frm:
                nwin += 1
                o = {k2: (v if not isinstance(v, bytes) else None) for k2, v in r.items()}
                if c_date:
                    o[c_date] = d if not isinstance(r.get(c_date), str) else r.get(c_date)
                w.write(json.dumps(o, ensure_ascii=False, separators=(',', ':')) + '\n')
    with gzip.open(os.path.join(out, 'parcels.jsonl.gz'), 'wt', encoding='utf-8') as p:
        for k, a in agg.items():
            p.write(json.dumps([k[0], k[1], k[2], k[3], k[4], a[0], a[1], a[2]], ensure_ascii=False, separators=(',', ':')) + '\n')
    schema = {'table': T['table'], 'columns': T['columns'], 'geometry': T['geometry'], 'total': T['total'], 'read': n, 'window': {'from': frm, 'rows': nwin},
              'dates': {'min': dmin, 'max': dmax}, 'years': dict(sorted(years.items())), 'parcelAddressKeys': len(agg),
              'map': {'date': c_date, 'settlement': c_set, 'street': c_st, 'house': c_house, 'gush': c_gush, 'parcel': c_parcel}}
    json.dump(schema, open(os.path.join(out, 'schema.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({k: schema[k] for k in ('table', 'total', 'read', 'window', 'dates', 'parcelAddressKeys', 'columns', 'map')}, ensure_ascii=False))
    with gzip.open(os.path.join(out, 'window.jsonl.gz'), 'rt', encoding='utf-8') as w:
        for i, line in enumerate(w):
            if i >= 2: break
            print('sample row: ' + line.strip()[:900])

if __name__ == '__main__':
    main()
