-- ExpenseFlow v2 schema (workspace-based). Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  username text unique,
  created_at timestamptz default now()
);
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default '₹',
  date_format text not null default 'DD/MM/YYYY',
  org_type text not null default 'Temple',
  monthly_budget numeric(14,2),
  primary_purchaser text,
  letterhead text,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);

create table if not exists members (
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  see_all boolean not null default false,       -- editors/viewers: see whole workspace instead of own entries
  can_download boolean not null default false,  -- editors/viewers: may export
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- helper functions (security definer so policies never recurse)
create or replace function ws_role(w uuid) returns text language sql stable security definer set search_path = public as $$
  select role from members where workspace_id = w and user_id = auth.uid() $$;
create or replace function is_member(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where workspace_id = w and user_id = auth.uid()) $$;
create or replace function can_write(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ws_role(w) in ('owner','admin','editor'), false) $$;
create or replace function can_manage(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ws_role(w) in ('owner','admin'), false) $$;
create or replace function sees_all(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where workspace_id = w and user_id = auth.uid() and (role in ('owner','admin') or see_all)) $$;

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  kind text not null default 'expense' check (kind in ('expense','income')),
  monthly_limit numeric(14,2),
  unique (workspace_id, kind, name)
);
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  monthly_limit numeric(14,2),
  unique (category_id, name)
);
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  unique (workspace_id, name)
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null default 'expense' check (type in ('expense','income')),
  entry_date date not null default current_date,
  amount numeric(14,2) not null check (amount >= 0),
  category_id uuid references categories(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  person_id uuid references people(id) on delete set null,   -- who paid (expense) / received from (income)
  payment_mode text not null default 'Cash',
  note text,
  reference_no text,                    -- income receipt number / UPI UTR; used for bank matching
  receipt_available boolean not null default false,
  bill_path text,                       -- IMAGE 2: the bill / invoice
  payment_proof_path text,              -- IMAGE 1: screenshot of the payment
  claim_status text check (claim_status in ('submitted','approved','settled')),
  claim_settled_at timestamptz,
  created_by uuid not null default auth.uid() references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists entries_ws_date on entries (workspace_id, entry_date desc);

create table if not exists entry_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entry_id uuid,
  action text not null,        -- updated | deleted
  snapshot jsonb,
  by_user uuid default auth.uid(),
  at timestamptz default now()
);

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  txn_date date not null,
  description text,
  reference text,
  amount numeric(14,2) not null,
  direction text not null default 'debit' check (direction in ('debit','credit')),
  matched_entry_id uuid unique references entries(id) on delete set null,
  created_at timestamptz default now()
);

create or replace function log_entry_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at = now();
    insert into entry_log (workspace_id, entry_id, action, snapshot) values (old.workspace_id, old.id, 'updated', to_jsonb(old));
    return new;
  else
    insert into entry_log (workspace_id, entry_id, action, snapshot) values (old.workspace_id, old.id, 'deleted', to_jsonb(old));
    return old;
  end if;
end $$;
drop trigger if exists entries_log on entries;
create trigger entries_log before update or delete on entries for each row execute function log_entry_change();

-- RPCs
create or replace function create_workspace(p_name text, p_org text default 'Temple') returns uuid
language plpgsql security definer set search_path = public as $$
declare w uuid; c uuid; n text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into workspaces (name, org_type, created_by) values (p_name, p_org, auth.uid()) returning id into w;
  insert into members (workspace_id, user_id, role) values (w, auth.uid(), 'owner');
  foreach n in array array['Groceries & Provisions','Vegetables & Annadanam','Puja Supplies','Utilities','Maintenance & Repairs','Festival & Events','Travel','Printing & Stationery','Salaries & Honorarium','Suspense','Other'] loop
    insert into categories (workspace_id, name, kind) values (w, n, 'expense'); end loop;
  foreach n in array array['Donation','Hundi','Seva','Other Income'] loop
    insert into categories (workspace_id, name, kind) values (w, n, 'income'); end loop;
  return w;
end $$;

create or replace function add_member(p_ws uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can add members'; end if;
  select id into u from profiles where lower(email) = lower(p_email);
  if u is null then raise exception 'No user with that email. Ask them to sign up first.'; end if;
  insert into members (workspace_id, user_id, role) values (p_ws, u, p_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
end $$;

-- Row level security
alter table profiles enable row level security;       alter table workspaces enable row level security;
alter table members enable row level security;        alter table categories enable row level security;
alter table items enable row level security;          alter table people enable row level security;
alter table entries enable row level security;        alter table entry_log enable row level security;
alter table bank_transactions enable row level security;

drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select to authenticated using (
  id = auth.uid() or exists (select 1 from members a join members b on a.workspace_id = b.workspace_id where a.user_id = auth.uid() and b.user_id = profiles.id));
drop policy if exists "profiles update own" on profiles;
create policy "profiles update own" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "ws read" on workspaces;
create policy "ws read" on workspaces for select to authenticated using (is_member(id));
drop policy if exists "ws update" on workspaces;
create policy "ws update" on workspaces for update to authenticated using (can_manage(id)) with check (can_manage(id));
drop policy if exists "ws delete" on workspaces;
create policy "ws delete" on workspaces for delete to authenticated using (ws_role(id) = 'owner');

drop policy if exists "members read" on members;
create policy "members read" on members for select to authenticated using (is_member(workspace_id));
drop policy if exists "members update" on members;
create policy "members update" on members for update to authenticated using (can_manage(workspace_id) and role <> 'owner') with check (can_manage(workspace_id) and role <> 'owner');
drop policy if exists "members delete" on members;
create policy "members delete" on members for delete to authenticated using ((can_manage(workspace_id) and role <> 'owner') or user_id = auth.uid());

drop policy if exists "cat read" on categories;
create policy "cat read" on categories for select to authenticated using (is_member(workspace_id));
drop policy if exists "cat write" on categories;
create policy "cat write" on categories for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));
drop policy if exists "items read" on items;
create policy "items read" on items for select to authenticated using (is_member(workspace_id));
drop policy if exists "items write" on items;
create policy "items write" on items for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));
drop policy if exists "people read" on people;
create policy "people read" on people for select to authenticated using (is_member(workspace_id));
drop policy if exists "people insert" on people;
create policy "people insert" on people for insert to authenticated with check (can_write(workspace_id));
drop policy if exists "people manage" on people;
create policy "people manage" on people for update using (can_manage(workspace_id)) with check (can_manage(workspace_id));
drop policy if exists "people delete" on people;
create policy "people delete" on people for delete to authenticated using (can_manage(workspace_id));

drop policy if exists "entries read" on entries;
create policy "entries read" on entries for select to authenticated using (is_member(workspace_id) and (sees_all(workspace_id) or created_by = auth.uid()));
drop policy if exists "entries insert" on entries;
create policy "entries insert" on entries for insert to authenticated with check (can_write(workspace_id) and created_by = auth.uid());
drop policy if exists "entries update" on entries;
create policy "entries update" on entries for update to authenticated
  using (can_manage(workspace_id) or (can_write(workspace_id) and created_by = auth.uid() and (claim_status is null or claim_status = 'submitted')))
  with check (can_manage(workspace_id) or (can_write(workspace_id) and created_by = auth.uid() and (claim_status is null or claim_status = 'submitted')));
drop policy if exists "entries delete" on entries;
create policy "entries delete" on entries for delete to authenticated
  using (can_manage(workspace_id) or (can_write(workspace_id) and created_by = auth.uid() and (claim_status is null or claim_status = 'submitted')));

drop policy if exists "log read" on entry_log;
create policy "log read" on entry_log for select to authenticated using (can_manage(workspace_id));
drop policy if exists "bank all" on bank_transactions;
create policy "bank all" on bank_transactions for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));

-- Private storage bucket. Files live under <workspace_id>/<random>.<ext>
insert into storage.buckets (id, name, public) values ('receipts','receipts', false) on conflict do nothing;
drop policy if exists "receipts insert" on storage.objects;
create policy "receipts insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and can_write(((storage.foldername(name))[1])::uuid));
drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "receipts delete" on storage.objects;
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and can_write(((storage.foldername(name))[1])::uuid));

-- idempotent-policies
