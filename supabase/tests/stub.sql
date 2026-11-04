-- Minimal stand-ins for the Supabase-managed objects our schema builds on, so the schema can be
-- run against a plain Postgres to check it. Shapes only: not a working auth system.
create schema if not exists auth;
create schema if not exists storage;
-- Roles live in the cluster, not the database, so they may already be there.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- In Supabase this reads the signed-in user from the request JWT. Here it reads a session setting
-- so the policies can be exercised as different people.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;

-- On Supabase a signed-in person can call auth.uid() and read their own storage rows.
grant usage on schema auth, storage to authenticated, anon;
grant select on auth.users to authenticated;
grant all on storage.objects, storage.buckets to authenticated;
