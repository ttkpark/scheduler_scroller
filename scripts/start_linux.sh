#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR%/scripts}"

cd "$PROJECT_ROOT"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

. ".venv/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt

npm install --omit=dev

export PYTHON_CMD="$PROJECT_ROOT/.venv/bin/python"
export PORT=8003

node server.js

