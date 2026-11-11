#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d "server/node_modules/express" ]; then
  echo "[boot] installing server dependencies..."
  npm --prefix server install --no-audit --no-fund
fi

if [ ! -f "client/dist/index.html" ]; then
  if [ ! -d "client/node_modules/vite" ]; then
    echo "[boot] installing client dependencies..."
    npm --prefix client install --no-audit --no-fund
  fi
  echo "[boot] building frontend bundle (client/dist)..."
  npm --prefix client run build
fi

node server/src/db/migrate.js
node server/src/db/seed.js

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
exec node server/src/index.js
