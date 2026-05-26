#!/bin/bash
set -euo pipefail

mkdir -p /app/.atlas /app/.cloudflared-tunnels
chown -R atlas:atlas /app/.atlas /app/.cloudflared-tunnels

if [[ "$(id -u)" -eq 0 ]]; then
  exec gosu atlas "$@"
fi
exec "$@"
