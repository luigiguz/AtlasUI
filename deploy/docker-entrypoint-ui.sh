#!/bin/sh
set -e
CFG=/usr/share/nginx/html/atlas-runtime-config.js
URL="${ATLAS_PUBLIC_API_URL:-${ATLASVPN_PUBLIC_API_URL:-}}"
if [ -n "$URL" ]; then
  B64=$(printf '%s' "$URL" | base64 | tr -d '\n')
  printf '%s\n' "window.__ATLAS_API_BASE__=typeof atob!==\"undefined\"?atob(\"${B64}\"):\"\";" >"$CFG"
else
  printf '%s\n' 'window.__ATLAS_API_BASE__="";' >"$CFG"
fi
exec nginx -g "daemon off;"
