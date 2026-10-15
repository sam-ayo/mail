#!/usr/bin/env bash
# Applies each file in migrations/ that the database does not have yet, in name order.
# The schema_migrations table records the files that ran.
#
# Usage: DATABASE_URL=... scripts/migrate.sh
#        DATABASE_URL=... scripts/migrate.sh --baseline 0004_push.sql
# --baseline records the files up to and including the given file, but does not run them.
# Use it once on a database that got its schema before this script existed.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to migrate}"
cd "$(dirname "$0")/.."

baseline=""
if [[ "${1:-}" == "--baseline" ]]; then
  baseline="${2:?Give the name of the last file that the database already has}"
  [[ -f "migrations/$baseline" ]] || { echo "No file migrations/$baseline" >&2; exit 1; }
fi

run_psql() { psql "$DATABASE_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"; }

run_psql -c "SET client_min_messages = warning; CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)"
applied="$(run_psql --tuples-only --no-align -c "SELECT name FROM schema_migrations")"

count=0
for file in migrations/*.sql; do
  name="$(basename "$file")"
  grep -qxF "$name" <<<"$applied" && continue
  if [[ -n "$baseline" && ! "$name" > "$baseline" ]]; then
    echo "Recording $name (baseline, not run)"
    run_psql -c "INSERT INTO schema_migrations (name) VALUES ('$name')"
  else
    echo "Applying $name"
    # One transaction: if the file fails, the database does not change and the file is not recorded.
    run_psql --single-transaction -f "$file" -c "INSERT INTO schema_migrations (name) VALUES ('$name')"
  fi
  count=$((count + 1))
done

echo "Done. $count file(s) recorded."
