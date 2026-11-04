#!/usr/bin/env bash
# Applies supabase/schema.sql to a throwaway database and runs the row level security tests.
#
# Needs a PostgreSQL server you can create databases on (any recent version; 15+ is what Supabase
# runs). Point it somewhere with the usual PG* variables, e.g.
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres npm run test:rls
# The database is dropped and recreated each run, so never aim this at a real one.
set -euo pipefail

DB="${EF_TEST_DB:-ef_rls_test}"
HERE="$(cd "$(dirname "$0")/../.." && pwd)"

command -v psql >/dev/null || { echo "psql not found. Install PostgreSQL client tools first."; exit 1; }

# The schema is written to be re-runnable, so `drop ... if exists` chatters on a fresh database.
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

echo "Preparing database '$DB'…"
psql -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/supabase/tests/stubs.sql"
echo "Applying supabase/schema.sql…"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/supabase/schema.sql" >/dev/null
echo "Running tests…"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/supabase/tests/rls.test.sql"
