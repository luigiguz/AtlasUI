#!/bin/bash
set -euo pipefail

mkdir -p /app/.atlas /app/.cloudflared-tunnels
chown -R atlas:atlas /app/.atlas /app/.cloudflared-tunnels

wait_for_postgres() {
  local url="${ATLAS_DATABASE_URL:-}"
  if [[ -z "$url" || "$url" != postgresql* ]]; then
    return 0
  fi
  echo "Atlas: esperando PostgreSQL…"
  for _ in $(seq 1 60); do
    if python - <<'PY'
import os
import sys

from sqlalchemy import create_engine, text

url = os.environ.get("ATLAS_DATABASE_URL", "")
if not url.startswith("postgresql"):
    sys.exit(0)
try:
    engine = create_engine(url, pool_pre_ping=True)
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
    then
      echo "Atlas: PostgreSQL disponible."
      return 0
    fi
    sleep 2
  done
  echo "Atlas: timeout esperando PostgreSQL." >&2
  exit 1
}

if [[ "$(id -u)" -eq 0 ]]; then
  wait_for_postgres
  exec gosu atlas "$@"
fi
wait_for_postgres
exec "$@"
