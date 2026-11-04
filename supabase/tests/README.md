# Row level security tests

The database holds all of this app's security. The browser talks to Postgres directly, so what a
signed-in sevak can read and write is decided entirely by the policies and `security definer`
functions in `supabase/schema.sql` — nothing in the React code is a safeguard. These tests check
that layer.

```bash
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres npm run test:rls
```

It needs a PostgreSQL server you can create databases on (15+ is what Supabase runs); point it
with the usual `PG*` variables. No Docker, no Supabase account, no network. The run **drops and
recreates** its database — `ef_rls_test`, or `EF_TEST_DB` — so never aim it at one you care about.

Each run applies `stubs.sql`, then `supabase/schema.sql`, then `rls.test.sql`, and prints one row
per assertion with a `passed / failed / total` summary at the end. A failure exits non-zero.

## How it stands in for Supabase

`stubs.sql` recreates only the pieces a real project keeps outside the `public` schema:
`auth.users`, `auth.uid()`, `storage.buckets`, `storage.objects`, `storage.foldername()`, the
`anon` / `authenticated` / `service_role` roles, and the default privileges that grant those roles
access to new tables. That last part is what makes the column-level `REVOKE` in the hardening
migration meaningful.

`auth.uid()` reads the signed-in user the same way PostgREST supplies it — from the request's JWT
claims — so a test switches identity by setting that claim and then becoming the API role:

```sql
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
set role authenticated;
```

`rls.test.sql` wraps those two lines in `\set as_owner`, `as_admin`, `as_editor`, `as_viewer`,
`as_outsider` and `as_unconf`, and asserts with four helpers: `t_allow`, `t_deny`, `t_eq` and
`t_rows`.

The `set role` line is the important one. Postgres skips row level security for superusers, so a
test that forgets it passes no matter what the policies say.

## What is covered

Entry visibility and the `see_all` override, claim approval, the audit log, invitations (including
the interception the hardening migration fixed, and that nobody can be invited straight to owner),
the confirmed-email requirement, workspace rename/delete limits, the storage meter's scoping, the
photo bucket's size and MIME limits and cross-workspace photo reads, the stock triggers, bank
statement access, feedback privacy, and that deleting a workspace takes its entries, history and
members with it.

## What is not covered

Supabase Auth itself — sign-up, confirmation mail, magic links, password rules, rate limits. Those
live in the dashboard's settings and in `lib/db.ts`. Passing here says the policies behave as
intended given the stub's shapes; it is not proof that a live project is configured correctly.
