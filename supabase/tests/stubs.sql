-- Minimal stand-ins for the parts of a Supabase project that live outside the public schema, so
-- that supabase/schema.sql can be applied to a plain PostgreSQL server and its row level security
-- actually exercised (see supabase/tests/rls.test.sql).
--
-- This is a test harness, not a Supabase replica. It mirrors only the shapes the schema depends
-- on — auth.uid(), auth.users, storage.buckets, storage.objects, storage.foldername — and the role
-- and privilege setup PostgREST relies on. Passing here does not prove a real project is correct;
-- it proves the policies and functions behave as intended given those shapes.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- The three roles PostgREST switches into, depending on the caller's JWT.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,          -- null until the confirmation link is clicked
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
-- PostgREST puts the verified JWT claims into this setting for the duration of the request;
-- auth.uid() is the 'sub' claim, i.e. the signed-in user's id.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ---------------------------------------------------------------- storage
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,                      -- '<workspace_id>/<random>.<ext>'
  owner uuid,
  metadata jsonb,                          -- {"size": 12345, ...}
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
-- Supabase's own helper: the folder segments of an object path.
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select case when position('/' in name) = 0 then '{}'::text[]
              else string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') end
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- privileges
-- Supabase gives the API roles access to new tables in `public` through default privileges, which
-- is what makes the hardening migration's column-level REVOKE on profiles meaningful. Set this up
-- before the schema runs, so each table picks the grants up as it is created — the same order a
-- real project sees.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
