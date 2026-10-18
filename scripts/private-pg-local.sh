#!/usr/bin/env bash
# PROPX · a THROWAWAY local PostgreSQL 16 for the private-workspace isolation test (test/private-identity.test.js).
# Nothing here touches a real project: a fresh cluster in a temporary directory, TCP on 127.0.0.1 only, trust auth,
# removed by `scripts/private-pg-local.sh stop`. Prints the PROPX_PG_URL the test reads.
#   scripts/private-pg-local.sh start   →  export PROPX_PG_URL=postgres://postgres@127.0.0.1:54329/postgres
#   node test/private-identity.test.js
#   scripts/private-pg-local.sh stop
set -euo pipefail
PORT="${PROPX_PG_PORT:-54329}"
DIR="${PROPX_PG_DIR:-/tmp/propx-private-pg}"
BIN="$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v initdb)")"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
case "${1:-start}" in
  start)
    if [ -f "$DIR/data/postmaster.pid" ]; then echo "PROPX_PG_URL=postgres://postgres@127.0.0.1:$PORT/postgres"; exit 0; fi
    rm -rf "$DIR"; mkdir -p "$DIR"; [ "$(id -u)" = "0" ] && chown postgres "$DIR"
    as_pg "$BIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 >/dev/null
    as_pg "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/log" -w start >/dev/null
    echo "PROPX_PG_URL=postgres://postgres@127.0.0.1:$PORT/postgres" ;;
  stop)
    [ -d "$DIR/data" ] && as_pg "$BIN/pg_ctl" -D "$DIR/data" -m fast stop >/dev/null || true
    rm -rf "$DIR"; echo stopped ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
