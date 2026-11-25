-- ExpenseFlow — complete database setup for Supabase.
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run. It is safe to run again.
-- (Same content as supabase/migrations/*.sql, concatenated in order.)

-- ======================================================================
-- 20260101000000_schema.sql
-- ======================================================================
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
  perform seed_default_items(w);          -- categories alone left every Item dropdown empty
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

-- ======================================================================
-- 20260101000001_store_chats.sql
-- ======================================================================
-- ExpenseFlow v2.1: Store, Chats, feedback inbox, Advanced view, modules, sample data.
-- Run AFTER schema.sql (SQL Editor -> New query -> paste -> Run).

alter table profiles add column if not exists advanced boolean not null default false;
alter table workspaces add column if not exists modules jsonb not null default '{"store":true,"chats":true}';
alter table workspaces add column if not exists is_demo boolean not null default false;
alter table entries add column if not exists fund_source text;
alter table entries add column if not exists beneficiary text;
-- allow account deletion without losing the workspace's entries
alter table entries alter column created_by drop not null;
alter table entries drop constraint if exists entries_created_by_fkey;
alter table entries add constraint entries_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;

-- ===== STORE =====
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique (workspace_id, name)
);
create table if not exists store_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  unit text not null default 'pcs',          -- litres, bags, kg ...
  min_qty int not null default 0,            -- low-stock alert level
  unique (store_id, name)
);
create table if not exists stock_moves (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  store_item_id uuid not null references store_items(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  qty int not null check (qty > 0),
  move_date date not null default current_date,
  note text,
  created_by uuid default auth.uid() references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists stock_moves_item on stock_moves (store_item_id, move_date desc);

create or replace view store_stock with (security_invoker = on) as
  select store_item_id, workspace_id,
         coalesce(sum(case when direction = 'in' then qty else -qty end), 0)::int as qty
  from stock_moves group by store_item_id, workspace_id;

create or replace function guard_stock() returns trigger language plpgsql as $$
declare cur int;
begin
  perform 1 from store_items where id = new.store_item_id for update;   -- serialize concurrent moves
  if new.direction = 'out' then
    select coalesce(sum(case when direction = 'in' then qty else -qty end), 0) into cur from stock_moves where store_item_id = new.store_item_id;
    if cur < new.qty then raise exception 'Not enough stock: only % available', cur; end if;
  end if;
  return new;
end $$;
drop trigger if exists stock_guard on stock_moves;
create trigger stock_guard before insert on stock_moves for each row execute function guard_stock();

create or replace function guard_stock_delete() returns trigger language plpgsql as $$
declare cur int;
begin
  if old.direction = 'in' then
    select coalesce(sum(case when direction = 'in' then qty else -qty end), 0) into cur from stock_moves where store_item_id = old.store_item_id;
    if cur - old.qty < 0 then raise exception 'Cannot delete: later stock-outs depend on this stock-in'; end if;
  end if;
  return old;
end $$;
drop trigger if exists stock_guard_delete on stock_moves;
create trigger stock_guard_delete before delete on stock_moves for each row execute function guard_stock_delete();

alter table stores enable row level security; alter table store_items enable row level security; alter table stock_moves enable row level security;
drop policy if exists "stores read" on stores;
create policy "stores read" on stores for select to authenticated using (is_member(workspace_id));
drop policy if exists "stores write" on stores;
create policy "stores write" on stores for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));
drop policy if exists "sitems read" on store_items;
create policy "sitems read" on store_items for select to authenticated using (is_member(workspace_id));
drop policy if exists "sitems write" on store_items;
create policy "sitems write" on store_items for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));
drop policy if exists "moves read" on stock_moves;
create policy "moves read" on stock_moves for select to authenticated using (is_member(workspace_id));
drop policy if exists "moves insert" on stock_moves;
create policy "moves insert" on stock_moves for insert to authenticated with check (can_write(workspace_id) and created_by = auth.uid());
drop policy if exists "moves delete" on stock_moves;
create policy "moves delete" on stock_moves for delete to authenticated using (can_manage(workspace_id));

-- ===== CHATS =====
create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  kind text not null check (kind in ('workspace','private','group')),
  title text,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create unique index if not exists one_workspace_thread on chat_threads (workspace_id) where kind = 'workspace';
create table if not exists chat_members (
  thread_id uuid references chat_threads(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid default auth.uid() references profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread on chat_messages (thread_id, created_at desc);

create or replace function can_chat(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_threads th where th.id = t and (
    (th.kind = 'workspace' and is_member(th.workspace_id)) or
    exists (select 1 from chat_members cm where cm.thread_id = t and cm.user_id = auth.uid())))
$$;

alter table chat_threads enable row level security; alter table chat_members enable row level security; alter table chat_messages enable row level security;
drop policy if exists "threads read" on chat_threads;
create policy "threads read" on chat_threads for select to authenticated using (can_chat(id));
drop policy if exists "cm read" on chat_members;
create policy "cm read" on chat_members for select to authenticated using (can_chat(thread_id));
drop policy if exists "cm insert own" on chat_members;
create policy "cm insert own" on chat_members for insert to authenticated with check (user_id = auth.uid() and can_chat(thread_id));
drop policy if exists "cm update own" on chat_members;
create policy "cm update own" on chat_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "cm delete own" on chat_members;
create policy "cm delete own" on chat_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists "msg read" on chat_messages;
create policy "msg read" on chat_messages for select to authenticated using (can_chat(thread_id));
drop policy if exists "msg insert" on chat_messages;
create policy "msg insert" on chat_messages for insert to authenticated with check (can_chat(thread_id) and sender_id = auth.uid());

-- people you chat with must be readable
drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select to authenticated using (
  id = auth.uid()
  or exists (select 1 from members a join members b on a.workspace_id = b.workspace_id where a.user_id = auth.uid() and b.user_id = profiles.id)
  or exists (select 1 from chat_members a join chat_members b on a.thread_id = b.thread_id where a.user_id = auth.uid() and b.user_id = profiles.id));

create or replace function ensure_workspace_thread(p_ws uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if not is_member(p_ws) then raise exception 'Not a member'; end if;
  select id into t from chat_threads where workspace_id = p_ws and kind = 'workspace';
  if t is null then
    insert into chat_threads (workspace_id, kind, title) values (p_ws, 'workspace', (select name from workspaces where id = p_ws))
    on conflict (workspace_id) where kind = 'workspace' do nothing;
    select id into t from chat_threads where workspace_id = p_ws and kind = 'workspace';
  end if;
  insert into chat_members (thread_id, user_id) values (t, auth.uid()) on conflict do nothing;
  return t;
end $$;

create or replace function start_private_chat(p_username text) returns uuid language plpgsql security definer set search_path = public as $$
declare other uuid; t uuid;
begin
  select id into other from profiles where lower(username) = lower(ltrim(trim(p_username), '@'));
  if other is null then raise exception 'No user with that username'; end if;
  if other = auth.uid() then raise exception 'That is you'; end if;
  select th.id into t from chat_threads th where th.kind = 'private'
    and exists (select 1 from chat_members where thread_id = th.id and user_id = auth.uid())
    and exists (select 1 from chat_members where thread_id = th.id and user_id = other) limit 1;
  if t is null then
    insert into chat_threads (kind, created_by) values ('private', auth.uid()) returning id into t;
    insert into chat_members (thread_id, user_id) values (t, auth.uid()), (t, other);
  end if;
  return t;
end $$;

create or replace function create_group(p_title text, p_usernames text[]) returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid; u text; other uuid;
begin
  insert into chat_threads (kind, title, created_by) values ('group', p_title, auth.uid()) returning id into t;
  insert into chat_members (thread_id, user_id) values (t, auth.uid());
  foreach u in array p_usernames loop
    select id into other from profiles where lower(username) = lower(ltrim(trim(u), '@'));
    if other is null then raise exception 'No user with username %', u; end if;
    insert into chat_members (thread_id, user_id) values (t, other) on conflict do nothing;
  end loop;
  return t;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table chat_messages;
  end if;
exception when others then null; end $$;

-- ===== FEEDBACK INBOX (read it in Supabase -> Table editor -> feedback) =====
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references profiles(id) on delete set null,
  workspace_id uuid,
  kind text not null check (kind in ('support','feature','interface','bug')),
  subject text not null,
  body text not null check (length(body) <= 4000),
  created_at timestamptz default now()
);
alter table feedback enable row level security;
drop policy if exists "feedback insert" on feedback;
create policy "feedback insert" on feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "feedback read own" on feedback;
create policy "feedback read own" on feedback for select to authenticated using (user_id = auth.uid());

-- ===== SAMPLE DATA + ACCOUNT DELETION =====
create or replace function create_sample_workspace() returns uuid language plpgsql security definer set search_path = public as $$
declare w uuid; c1 uuid; c2 uuid; c3 uuid; i1 uuid; p1 uuid; p2 uuid; d int;
begin
  w := create_workspace('Sri Rama Temple Trust [demo]');
  update workspaces set is_demo = true, monthly_budget = 60000 where id = w;
  select id into c1 from categories where workspace_id = w and name = 'Vegetables & Annadanam';
  select id into c2 from categories where workspace_id = w and name = 'Puja Supplies';
  select id into c3 from categories where workspace_id = w and name = 'Donation';
  update categories set monthly_limit = 25000 where id = c1;
  update categories set monthly_limit = 15000 where id = c2;
  insert into items (workspace_id, category_id, name) values (w, c1, 'Rice') returning id into i1;
  insert into people (workspace_id, name) values (w, 'Ramesh') returning id into p1;
  insert into people (workspace_id, name) values (w, 'Sita Devi') returning id into p2;
  for d in 0..6 loop
    insert into entries (workspace_id, type, entry_date, amount, category_id, item_id, person_id, payment_mode, note, created_by)
    values (w, 'expense', current_date - d, 800 + d * 150, c1, i1, p1, case when d % 2 = 0 then 'UPI' else 'Cash' end, 'Sample purchase', auth.uid());
  end loop;
  insert into entries (workspace_id, type, entry_date, amount, category_id, person_id, payment_mode, note, claim_status, created_by)
    values (w, 'expense', current_date - 1, 1200, c2, p2, 'Cash', 'Flowers & incense (own pocket)', 'submitted', auth.uid());
  insert into entries (workspace_id, type, entry_date, amount, category_id, person_id, payment_mode, reference_no, created_by)
    values (w, 'income', current_date, 5000, c3, p2, 'UPI', 'R-1001', auth.uid());
  return w;
end $$;

create or replace function remove_sample_data() returns void language sql security definer set search_path = public as $$
  delete from workspaces where is_demo and ws_role(id) = 'owner'
$$;

create or replace function delete_account() returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from members m where m.user_id = auth.uid() and m.role = 'owner'
             and exists (select 1 from members o where o.workspace_id = m.workspace_id and o.user_id <> auth.uid())) then
    raise exception 'You own a workspace that has other members. Delete that workspace or remove the members first.';
  end if;
  delete from workspaces where id in (select workspace_id from members where user_id = auth.uid() and role = 'owner');
  delete from auth.users where id = auth.uid();
end $$;

-- idempotent-policies

-- ======================================================================
-- 20260101000002_storage_usage.sql
-- ======================================================================
-- Storage meter for the free plan (1 GB of files). Run after 002_store_chats.sql.
create or replace function storage_usage_total() returns bigint
language plpgsql security definer set search_path = public, storage as $$
begin
  if not exists (select 1 from members where user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'Only owners and admins can see storage usage';
  end if;
  return coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'receipts'), 0);
end $$;

-- ======================================================================
-- 20260101000003_chat_thread_list.sql
-- ======================================================================
-- The chats screen asks for every thread it may show in one call: the workspace thread
-- (created on first use) plus every private/group thread the signed-in user belongs to.
-- security definer so the lookup can read chat_members for other people in the same thread.
create or replace function list_chat_threads(p_ws uuid) returns setof chat_threads
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_ws) then raise exception 'Not a member'; end if;
  perform ensure_workspace_thread(p_ws);
  return query
    select th.* from chat_threads th
    where (th.kind = 'workspace' and th.workspace_id = p_ws)
       or exists (select 1 from chat_members cm where cm.thread_id = th.id and cm.user_id = auth.uid());
end $$;

-- ======================================================================
-- 20260101000004_hardening.sql
-- ======================================================================
-- ExpenseFlow v2.2 — security and housekeeping hardening.
-- Run AFTER 20260101000003_chat_thread_list.sql (SQL Editor -> New query -> paste -> Run).
-- Safe to run again.
--
-- What this fixes, and why each one matters:
--   1. An invitation could be intercepted: members may write their own profile row, and invitations
--      were resolved through profiles.email.
--   2. add_member accepted any role, including 'owner', which the members policies otherwise forbid.
--   3. Creating or joining a set of books needed no confirmed email address.
--   4. The photo bucket had no size or file-type limit at all.
--   5. The storage meter reported every workspace's photos to every admin.
--   6. A deleted workspace left its audit log behind for ever.
--   7. Indexes for the filters the screens actually run.

-- ----------------------------------------------------------------------------------------
-- 1. profiles.email belongs to Supabase Auth, not to the member
-- ----------------------------------------------------------------------------------------
-- "profiles update own" allows a member to write any column of their own row, and add_member used
-- to look invitees up by profiles.email. Together that was enough to be invited in someone else's
-- place: set your own email to the treasurer's address, then wait for an admin to add "them".
-- Column privileges are the narrow fix — the client may still edit the three columns the Settings
-- screen offers, and nothing else. A column added later is read-only until it is listed here.
revoke update on profiles from authenticated;
revoke update on profiles from anon;
grant update (full_name, username, advanced) on profiles to authenticated;

-- The address does legitimately change when a user changes it in Supabase Auth, which is the only
-- place it can be changed. security definer, so this write is not subject to the grants above.
create or replace function sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function sync_profile_email();

-- ----------------------------------------------------------------------------------------
-- 2 + 3. Invitations resolve against the authoritative, confirmed address
-- ----------------------------------------------------------------------------------------
create or replace function email_confirmed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
$$;

create or replace function add_member(p_ws uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can add members'; end if;
  if not email_confirmed() then
    raise exception 'Please confirm your own email address first — check your inbox for the link.';
  end if;
  -- 'owner' is deliberately absent: the members policies forbid handing the role out, and this
  -- function used to be the way round that, because its ON CONFLICT could overwrite any role.
  if p_role not in ('admin','editor','viewer') then
    raise exception 'Role must be admin, editor or viewer';
  end if;
  -- auth.users, not profiles: that column is Supabase's own and no member can write it. Requiring
  -- a confirmed address also proves the invitee actually holds the mailbox being invited.
  select id into u from auth.users
    where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if u is null then
    raise exception 'No confirmed account with that email. Ask them to sign up and click the link in their confirmation email first.';
  end if;
  insert into members (workspace_id, user_id, role) values (p_ws, u, p_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role
    where members.role <> 'owner';   -- never demote or overwrite the owner
end $$;

create or replace function create_workspace(p_name text, p_org text default 'Temple') returns uuid
language plpgsql security definer set search_path = public as $$
declare w uuid; n text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not email_confirmed() then
    raise exception 'Please confirm your email address first — check your inbox for the link.';
  end if;
  insert into workspaces (name, org_type, created_by) values (p_name, p_org, auth.uid()) returning id into w;
  insert into members (workspace_id, user_id, role) values (w, auth.uid(), 'owner');
  foreach n in array array['Groceries & Provisions','Vegetables & Annadanam','Puja Supplies','Utilities','Maintenance & Repairs','Festival & Events','Travel','Printing & Stationery','Salaries & Honorarium','Suspense','Other'] loop
    insert into categories (workspace_id, name, kind) values (w, n, 'expense'); end loop;
  foreach n in array array['Donation','Hundi','Seva','Other Income'] loop
    insert into categories (workspace_id, name, kind) values (w, n, 'income'); end loop;
  perform seed_default_items(w);          -- categories alone left every Item dropdown empty
  return w;
end $$;

-- ----------------------------------------------------------------------------------------
-- 4. The photo bucket enforces its own size and type limits
-- ----------------------------------------------------------------------------------------
-- Policies decide *who* may upload, never *what*. Without these the bucket accepted a file of any
-- type and any size from any member — the previous Firebase edition refused anything over 3 MB or
-- not an image/PDF, and that guarantee was lost in the move.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------------------
-- 5. The storage meter counts only the workspaces you manage
-- ----------------------------------------------------------------------------------------
create or replace function storage_usage_total() returns bigint
language plpgsql security definer set search_path = public, storage as $$
declare mine text[];
begin
  select coalesce(array_agg(workspace_id::text), '{}') into mine
    from members where user_id = auth.uid() and role in ('owner','admin');
  if array_length(mine, 1) is null then
    raise exception 'Only owners and admins can see storage usage';
  end if;
  -- Previously this summed the whole bucket, so one temple's gauge included every other
  -- temple's photos on the same project.
  return coalesce((select sum((metadata->>'size')::bigint) from storage.objects
                   where bucket_id = 'receipts' and (storage.foldername(name))[1] = any(mine)), 0);
end $$;

-- ----------------------------------------------------------------------------------------
-- 6. A deleted workspace takes its audit log with it
-- ----------------------------------------------------------------------------------------
-- entry_log deliberately has no foreign key to workspaces: the BEFORE DELETE trigger on entries
-- writes a row while the workspace is already on its way out, and a key would make deleting a
-- workspace fail outright. An AFTER DELETE trigger runs once the cascade has finished, so it can
-- clear up both the old rows and the ones the cascade just wrote.
create or replace function purge_workspace_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from entry_log where workspace_id = old.id;
  return old;
end $$;
drop trigger if exists workspaces_purge_log on workspaces;
create trigger workspaces_purge_log after delete on workspaces
  for each row execute function purge_workspace_log();

-- ----------------------------------------------------------------------------------------
-- 7. Deleting a workspace must not be blocked by its own stock history
-- ----------------------------------------------------------------------------------------
-- The stock guard refuses to remove a stock-in that later stock-outs depend on. During a cascade
-- (deleting a workspace, a store, an item, or closing an account) the rows go in an order Postgres
-- chooses, so that guard would fire part-way through a consistent deletion and abort the lot:
-- any workspace that had ever used the Store could not be deleted at all.
--
-- Deferring it to commit time fixes both cases. By then the cascade has finished, so either the
-- item has gone with it — nothing left to go negative — or this was a single deletion and the
-- remaining movements are the final answer.
create or replace function guard_stock_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  -- The item itself is being removed, so its running total no longer means anything.
  if not exists (select 1 from store_items where id = old.store_item_id) then return null; end if;
  select coalesce(sum(case when direction = 'in' then qty else -qty end), 0) into remaining
    from stock_moves where store_item_id = old.store_item_id;
  if remaining < 0 then
    raise exception 'Cannot delete: later stock-outs depend on this stock-in';
  end if;
  return null;
end $$;
drop trigger if exists stock_guard_delete on stock_moves;
create constraint trigger stock_guard_delete after delete on stock_moves
  deferrable initially deferred for each row execute function guard_stock_delete();

-- ----------------------------------------------------------------------------------------
-- 8. Housekeeping
-- ----------------------------------------------------------------------------------------
-- The form caps the subject at 200 characters; only the database can insist on it.
alter table feedback drop constraint if exists feedback_subject_len;
alter table feedback add constraint feedback_subject_len check (length(subject) between 1 and 200);

-- Indexes for the filters the screens run: claims, a member restricted to their own entries,
-- the daily/monthly report, the bank list, one entry's history, and the "bills missing" count.
create index if not exists entries_ws_claim        on entries (workspace_id, claim_status) where claim_status is not null;
create index if not exists entries_ws_creator_date on entries (workspace_id, created_by, entry_date desc);
create index if not exists entries_ws_type_date    on entries (workspace_id, type, entry_date);
create index if not exists entries_ws_bill_missing on entries (workspace_id) where receipt_available and bill_path is null;
create index if not exists bank_ws_date            on bank_transactions (workspace_id, txn_date desc);
create index if not exists entry_log_entry         on entry_log (workspace_id, entry_id, at desc);

-- ---------------------------------------------------------------------------
-- Default items under each seeded category.
--
-- create_workspace seeded the categories but nothing beneath them, so the Add-entry
-- dialog's Item dropdown sat disabled on "No items" for every category until an admin
-- added them one at a time in Settings. These are the usual ones for a temple; an admin
-- can still delete or add to them. Idempotent, so it is also the backfill for a workspace
-- created before this existed:  select seed_default_items('<workspace-id>');
create or replace function seed_default_items(p_ws uuid) returns void
language plpgsql security definer set search_path = public as $$
declare seed jsonb := '{
  "Groceries & Provisions":  ["Rice","Wheat & Flour","Dal & Pulses","Sugar & Jaggery","Spices","Oil & Ghee"],
  "Vegetables & Annadanam":  ["Vegetables","Fruits","Milk & Curd","Rice","Cooking Gas"],
  "Puja Supplies":           ["Flowers & Garlands","Incense & Camphor","Ghee for Lamps","Tulsi","Kumkum & Chandan","Coconut & Banana"],
  "Utilities":               ["Electricity","Water","Gas Cylinder","Internet & Phone"],
  "Maintenance & Repairs":   ["Plumbing","Electrical","Painting","Carpentry","Cleaning Supplies"],
  "Festival & Events":       ["Decorations","Prasadam Distribution","Sound & Lighting","Pandal & Tent","Invitations"],
  "Travel":                  ["Fuel","Auto & Taxi","Train & Bus"],
  "Printing & Stationery":   ["Receipt Books","Banners & Posters","Office Stationery"],
  "Salaries & Honorarium":   ["Pujari Honorarium","Cook","Staff Salary","Security"],
  "Donation":                ["General Donation","Annadanam Donation","Gaushala Donation","Festival Donation"],
  "Hundi":                   ["Main Hundi","Gaushala Hundi"],
  "Seva":                    ["Annadanam Seva","Archana Seva","Abhishekam Seva","Vastra Seva"]
}'::jsonb;
  k text; v jsonb; cid uuid;
begin
  if not can_manage(p_ws) then raise exception 'Only an owner or admin may seed items'; end if;
  for k, v in select key, value from jsonb_each(seed) loop
    -- Only the categories this workspace actually kept; a deleted one is not recreated.
    select id into cid from categories where workspace_id = p_ws and name = k limit 1;
    if cid is not null then
      insert into items (workspace_id, category_id, name)
      select p_ws, cid, x from jsonb_array_elements_text(v) as x
      on conflict (category_id, name) do nothing;
    end if;
  end loop;
end $$;
revoke all on function seed_default_items(uuid) from public;
grant execute on function seed_default_items(uuid) to authenticated;

-- ======================================================================
-- 20260101000005_vouchers.sql
-- ======================================================================
-- ExpenseFlow v2.3 — numbered vouchers (Change 3A of the accounting module).
-- Run AFTER 20260101000004_hardening.sql (SQL Editor -> New query -> paste -> Run).
-- Safe to run again.
--
-- What this adds:
--   1. Every entry dated on or after the workspace's `vouchers_from` (1 November 2026) becomes a
--      numbered voucher:  <financial year>/<type>/<month>/V<serial>   e.g. 2026-2027/BV/11/V001
--        CV  cash voucher      (expense paid in cash)
--        BV  bank voucher      (expense paid any other way: UPI, bank transfer, cheque, card)
--        CR  cash receipt      (income received in cash)
--        BR  bank receipt      (income received any other way)
--        JV  journal voucher   (NEW — no cash or bank moves; see 3 below)
--      The financial year runs April–March. The serial restarts every month, separately for each
--      type. Numbers are handed out by a trigger, never by the browser, so two people saving at the
--      same moment can never receive the same one.
--   2. Entries already made in November 2026 are numbered by this migration, in date order.
--   3. Journal vouchers: an entry of type 'journal' debits one head and credits another (or credits
--      "Outstanding expenses" for a bill that has not been paid yet). Only owners and admins may
--      create, change or delete one.
--   4. `no_bill` marks an expense that has no bill — a self-voucher. It is derived, so it can never
--      disagree with the "Receipt / bill available?" answer and the bill photo.

-- ----------------------------------------------------------------------------------------
-- 1. Where the numbering starts
-- ----------------------------------------------------------------------------------------
-- Per workspace, so another centre using the same project can pick its own date (or NULL = never).
alter table workspaces add column if not exists vouchers_from date default date '2026-11-01';

-- ----------------------------------------------------------------------------------------
-- 2. Entry columns
-- ----------------------------------------------------------------------------------------
alter table entries add column if not exists voucher_type  text check (voucher_type in ('CV','BV','CR','BR','JV'));
alter table entries add column if not exists voucher_fy    text;      -- '2026-2027'
alter table entries add column if not exists voucher_month smallint;  -- calendar month of the entry date, 1-12
alter table entries add column if not exists voucher_seq   integer;
alter table entries add column if not exists voucher_no    text;      -- '2026-2027/BV/11/V001'

alter table entries add column if not exists jv_kind text check (jv_kind in ('unpaid_bill','transfer','correction'));
alter table entries add column if not exists dr_category_id uuid references categories(id);   -- NO ACTION: a head that has journal postings cannot be deleted
alter table entries add column if not exists cr_category_id uuid references categories(id);

-- An expense with no bill: nothing attached and "bill available?" answered No. A bill that is
-- promised but not yet uploaded (receipt_available and no photo) is a different thing — that one
-- is still "Bills missing".
alter table entries add column if not exists no_bill boolean
  generated always as (type = 'expense' and not receipt_available and bill_path is null) stored;

alter table entries drop constraint if exists entries_type_check;
alter table entries drop constraint if exists entries_type_ok;
alter table entries add constraint entries_type_ok check (type in ('expense','income','journal'));

-- A journal voucher is a positive amount moved from one head to another, with a narration saying why. 'unpaid_bill' credits the
-- liability "Outstanding expenses", which is not one of the workspace's categories, so it has no
-- credit head of its own. Nothing else may carry journal fields.
alter table entries drop constraint if exists entries_journal_shape;
alter table entries add constraint entries_journal_shape check (
  (type = 'journal' and amount > 0 and length(btrim(coalesce(note, ''))) > 0 and jv_kind is not null and dr_category_id is not null and (
     (jv_kind = 'unpaid_bill' and cr_category_id is null)
     or (jv_kind <> 'unpaid_bill' and cr_category_id is not null and cr_category_id <> dr_category_id)))
  or (type <> 'journal' and jv_kind is null and dr_category_id is null and cr_category_id is null)
);

create unique index if not exists entries_voucher_no on entries (workspace_id, voucher_no) where voucher_no is not null;

-- ----------------------------------------------------------------------------------------
-- 3. The serial counters
-- ----------------------------------------------------------------------------------------
-- One row per (workspace, financial year, type, month). Only the trigger below touches it:
-- row level security is on and there is no policy, so no browser request can read or write it.
create table if not exists voucher_counters (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  vfy          text not null,
  vkind        text not null,
  vmonth       smallint not null,
  last         integer not null default 0,
  primary key (workspace_id, vfy, vkind, vmonth)
);
alter table voucher_counters enable row level security;

-- ----------------------------------------------------------------------------------------
-- 4. Numbering
-- ----------------------------------------------------------------------------------------
-- April–March: 2026-11-19 -> '2026-2027', 2027-02-10 -> '2026-2027', 2027-04-01 -> '2027-2028'.
create or replace function voucher_fy(d date) returns text language sql immutable as $$
  select case when extract(month from d) >= 4
              then extract(year from d)::int     || '-' || (extract(year from d)::int + 1)
              else (extract(year from d)::int - 1) || '-' || extract(year from d)::int end
$$;

-- Cash is cash; UPI, bank transfer, cheque, card and anything else passes through a bank.
create or replace function voucher_kind(p_type text, p_mode text) returns text language sql immutable as $$
  select case p_type
    when 'journal' then 'JV'
    when 'expense' then case when lower(btrim(p_mode)) = 'cash' then 'CV' else 'BV' end
    else                case when lower(btrim(p_mode)) = 'cash' then 'CR' else 'BR' end
  end
$$;

create or replace function assign_voucher() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  from_date date; k text; fy text; m int; n int;
begin
  -- These columns belong to the database. Whatever a client sent is thrown away: an insert starts
  -- blank, and an update keeps what was there unless the number has to change (below).
  if tg_op = 'UPDATE' then
    new.voucher_type := old.voucher_type;   new.voucher_fy  := old.voucher_fy;
    new.voucher_month := old.voucher_month; new.voucher_seq := old.voucher_seq;
    new.voucher_no := old.voucher_no;
  else
    new.voucher_type := null; new.voucher_fy := null; new.voucher_month := null;
    new.voucher_seq := null;  new.voucher_no := null;
  end if;

  select vouchers_from into from_date from workspaces where id = new.workspace_id;
  if from_date is null or new.entry_date < from_date then
    -- Before the accounting module starts (or this workspace has not switched it on): no voucher.
    new.voucher_type := null; new.voucher_fy := null; new.voucher_month := null;
    new.voucher_seq := null;  new.voucher_no := null;
    return new;
  end if;

  k  := voucher_kind(new.type, new.payment_mode);
  fy := voucher_fy(new.entry_date);
  m  := extract(month from new.entry_date)::int;

  if new.voucher_no is not null and new.voucher_type = k and new.voucher_fy = fy and new.voucher_month = m then
    return new;   -- nothing the number is built from has changed, so the number stays
  end if;

  -- First number, or the entry moved to another type / month / year (cash became UPI, the date was
  -- corrected). It is issued a new number from the right series; the old one is never reused, and
  -- is kept in entry_log, which snapshots the row before every update.
  insert into voucher_counters as c (workspace_id, vfy, vkind, vmonth, last)
    values (new.workspace_id, fy, k, m, 1)
    on conflict (workspace_id, vfy, vkind, vmonth) do update set last = c.last + 1
    returning c.last into n;

  new.voucher_type  := k;
  new.voucher_fy    := fy;
  new.voucher_month := m;
  new.voucher_seq   := n;
  -- lpad would truncate past 999, so only pad the short ones.
  new.voucher_no    := fy || '/' || k || '/' || lpad(m::text, 2, '0') || '/V'
                       || case when n < 100 then lpad(n::text, 3, '0') else n::text end;
  return new;
end $$;
revoke all on function assign_voucher() from public;

-- Alphabetically after entries_log, which stamps updated_at and writes the history row first.
drop trigger if exists entries_voucher on entries;
create trigger entries_voucher before insert or update on entries
  for each row execute function assign_voucher();

-- ----------------------------------------------------------------------------------------
-- 5. Number the entries that already exist (the November ones)
-- ----------------------------------------------------------------------------------------
-- Oldest first, so V001 is the earliest of its month. entries_log is paused so this housekeeping
-- does not show up as an "updated" line in every entry's history; updated_at is left alone too.
-- Already-numbered entries are skipped, so running this again changes nothing.
alter table entries disable trigger entries_log;
do $$
declare r record;
begin
  for r in
    select e.id from entries e join workspaces w on w.id = e.workspace_id
     where w.vouchers_from is not null and e.entry_date >= w.vouchers_from and e.voucher_no is null
     order by e.workspace_id, e.entry_date, e.created_at, e.id
  loop
    update entries set voucher_no = null where id = r.id;   -- the trigger does the numbering
  end loop;
end $$;
alter table entries enable trigger entries_log;

-- ----------------------------------------------------------------------------------------
-- 6. Only owners and admins handle journal vouchers
-- ----------------------------------------------------------------------------------------
-- Same rules as before for everything else; a journal is additionally closed to editors, whose
-- own-entry branch now excludes it.
drop policy if exists "entries insert" on entries;
create policy "entries insert" on entries for insert to authenticated
  with check (can_write(workspace_id) and created_by = auth.uid() and (type <> 'journal' or can_manage(workspace_id)));

drop policy if exists "entries update" on entries;
create policy "entries update" on entries for update to authenticated
  using (can_manage(workspace_id)
         or (can_write(workspace_id) and created_by = auth.uid() and type <> 'journal' and (claim_status is null or claim_status = 'submitted')))
  with check (can_manage(workspace_id)
         or (can_write(workspace_id) and created_by = auth.uid() and type <> 'journal' and (claim_status is null or claim_status = 'submitted')));

drop policy if exists "entries delete" on entries;
create policy "entries delete" on entries for delete to authenticated
  using (can_manage(workspace_id)
         or (can_write(workspace_id) and created_by = auth.uid() and type <> 'journal' and (claim_status is null or claim_status = 'submitted')));

-- ======================================================================
-- 20260101000006_books.sql
-- ======================================================================
-- ExpenseFlow v2.4 — books and reports (Change 3B of the accounting module).
-- Run AFTER 20260101000005_vouchers.sql (SQL Editor -> New query -> paste -> Run).
-- Safe to run again.
--
-- The reports themselves are computed in the app from the numbered vouchers (lib/accounts.ts), so
-- this migration only adds what the vouchers do not already say:
--   1. Which of the three books a head belongs to (Temple / Goshala / Books), whether it is capital
--      spending rather than an expense, and whether it sits in the Construction section.
--   2. Which bank account a bank voucher or receipt went through.
--   3. Which unpaid-bill journal a payment settles, so paying a bill that was already booked as an
--      expense is not counted twice.
--   4. Opening balances, for the balance-sheet accounts Prabhu will supply later.

-- ----------------------------------------------------------------------------------------
-- 1. Heads: book, capital, construction
-- ----------------------------------------------------------------------------------------
alter table categories add column if not exists book text not null default 'temple' check (book in ('temple','goshala','books'));
alter table categories add column if not exists is_capital boolean not null default false;   -- capital spending: an asset, not charged to expenses
alter table categories add column if not exists section text check (section in ('construction'));

-- Sensible defaults from the name, for heads that already exist and heads added later. They are
-- only defaults: Accounts -> Setup changes any of them, and an UPDATE is never second-guessed.
create or replace function categories_default_books() returns trigger language plpgsql as $$
begin
  if new.book = 'temple' then
    if new.name ~* 'g(au|o)s(h)?ala' then new.book := 'goshala';
    elsif new.name ~* 'purchase of books?|books? purchase|^books?$' then new.book := 'books'; end if;
  end if;
  if new.kind = 'expense' and new.name ~* 'construction' then
    if new.section is null then new.section := 'construction'; end if;
    if not new.is_capital then new.is_capital := true; end if;
  elsif new.kind = 'expense' and new.name ~* 'fixed assets?' and not new.is_capital then
    new.is_capital := true;
  end if;
  return new;
end $$;
drop trigger if exists categories_defaults on categories;
create trigger categories_defaults before insert on categories for each row execute function categories_default_books();

update categories set book = 'goshala' where book = 'temple' and name ~* 'g(au|o)s(h)?ala';
update categories set book = 'books'   where book = 'temple' and name ~* 'purchase of books?|books? purchase|^books?$';
update categories set section = 'construction', is_capital = true where kind = 'expense' and name ~* 'construction' and section is null;
update categories set is_capital = true where kind = 'expense' and name ~* 'fixed assets?' and not is_capital;

-- ----------------------------------------------------------------------------------------
-- 2. Bank accounts
-- ----------------------------------------------------------------------------------------
create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz default now(),
  unique (workspace_id, name)
);
alter table bank_accounts enable row level security;
drop policy if exists "bank accounts read" on bank_accounts;
create policy "bank accounts read" on bank_accounts for select to authenticated using (is_member(workspace_id));
drop policy if exists "bank accounts write" on bank_accounts;
create policy "bank accounts write" on bank_accounts for all to authenticated
  using (can_manage(workspace_id)) with check (can_manage(workspace_id));

-- NO ACTION: a bank account that vouchers went through cannot be deleted.
alter table entries add column if not exists bank_account_id uuid references bank_accounts(id);

-- ----------------------------------------------------------------------------------------
-- 3. Paying a bill that was booked by a journal
-- ----------------------------------------------------------------------------------------
-- A journal of kind 'unpaid_bill' has already charged the expense and credited "Outstanding
-- expenses". The payment that follows must clear that liability, not charge the expense again.
-- NO ACTION: a journal that has payments against it cannot be deleted.
alter table entries add column if not exists settles_entry_id uuid references entries(id);
create index if not exists entries_settles on entries (settles_entry_id) where settles_entry_id is not null;

create or replace function check_entry_links() returns trigger
language plpgsql security definer set search_path = public as $$
declare jv_amount numeric; paid numeric;
begin
  -- A bank account only means something for money that went through a bank, and must be ours.
  if new.type = 'journal' or lower(btrim(new.payment_mode)) = 'cash' then
    new.bank_account_id := null;
  elsif new.bank_account_id is not null
        and not exists (select 1 from bank_accounts b where b.id = new.bank_account_id and b.workspace_id = new.workspace_id) then
    raise exception 'That bank account belongs to a different set of books';
  end if;

  -- Settling an unpaid bill: owners and admins only (editors cannot even see the journals).
  if new.settles_entry_id is not null then
    if new.type <> 'expense' then raise exception 'Only an expense can settle an unpaid bill'; end if;
    if not can_manage(new.workspace_id) then raise exception 'Only owners and admins can settle an unpaid bill'; end if;
    select amount into jv_amount from entries
     where id = new.settles_entry_id and workspace_id = new.workspace_id and type = 'journal' and jv_kind = 'unpaid_bill'
       for update;                                   -- serialise two people paying the same bill
    if not found then raise exception 'That is not an unpaid-bill journal voucher of this workspace'; end if;
    select coalesce(sum(amount), 0) into paid from entries where settles_entry_id = new.settles_entry_id and id <> new.id;
    if paid + new.amount > jv_amount then
      raise exception 'That is more than is still unpaid on this bill (% of % already paid)', paid, jv_amount;
    end if;
  end if;

  -- The other way round: an unpaid-bill journal cannot be cut below what has been paid against it.
  if tg_op = 'UPDATE' and new.type = 'journal' then
    select coalesce(sum(amount), 0) into paid from entries where settles_entry_id = new.id;
    if paid > new.amount then raise exception 'Payments of % are already recorded against this journal', paid; end if;
  end if;
  return new;
end $$;
revoke all on function check_entry_links() from public;
-- Alphabetically before entries_log and entries_voucher, which see the cleaned-up row.
drop trigger if exists entries_links on entries;
create trigger entries_links before insert or update on entries for each row execute function check_entry_links();

-- ----------------------------------------------------------------------------------------
-- 4. Opening balances
-- ----------------------------------------------------------------------------------------
-- One signed amount per book and account: debit positive, credit negative. `account` is a fixed
-- name for the standing accounts, or bank:<id> / head:<id> for a bank account or a head.
-- Accounting starts on workspaces.vouchers_from, so these say where each account stood on that day
-- (and, for income and expense heads, what had already accrued earlier in that financial year).
create table if not exists opening_balances (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  book text not null check (book in ('temple','goshala','books')),
  account text not null check (
    account in ('cash','loans_advances','bbt_recoverable','capital_fund','loans_received','outstanding')
    or account ~ '^(bank|head):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  amount numeric(14,2) not null,
  primary key (workspace_id, book, account)
);
alter table opening_balances enable row level security;
drop policy if exists "opening read" on opening_balances;
create policy "opening read" on opening_balances for select to authenticated using (can_manage(workspace_id));
drop policy if exists "opening write" on opening_balances;
create policy "opening write" on opening_balances for all to authenticated
  using (can_manage(workspace_id)) with check (can_manage(workspace_id));

-- ======================================================================
-- 20260101000007_week_settlement.sql
-- ======================================================================
-- ExpenseFlow v2.5 — weekly settlement (Change 3C of the accounting module).
-- Run AFTER 20260101000006_books.sql (SQL Editor -> New query -> paste -> Run).
-- Safe to run again.
--
-- A calendar week (Monday to Sunday) is "settled" when:
--   1. bank matched          every bank voucher of the week is matched to a statement row, and no
--                            statement row of the week is left unmatched
--   2. cash counted          the cash in hand was counted at the end of the week and agrees with the
--                            cash book
--   3. trial balance tallies for every book
--   4. bills attached        no expense of the week is still waiting for its bill
--
-- Checks 1, 3 and 4 are worked out from the vouchers every time (lib/settlement.ts); only the cash
-- count and the act of settling are written down, here. Settling locks nothing — there is no
-- month-locking — it records that the week was checked, and the screen says so if a week that was
-- settled has since changed.

create table if not exists week_settlements (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),   -- a Monday
  cash_counted numeric(14,2) check (cash_counted >= 0),
  cash_note text check (cash_note is null or length(cash_note) <= 500),
  counted_by uuid, counted_at timestamptz,
  settled_by uuid, settled_at timestamptz,
  -- What the week looked like when it was settled, so a later change can be pointed out.
  snapshot jsonb,
  primary key (workspace_id, week_start),
  constraint week_settled_needs_count check (settled_at is null or cash_counted is not null)
);
alter table week_settlements enable row level security;
drop policy if exists "week settlements read" on week_settlements;
create policy "week settlements read" on week_settlements for select to authenticated using (can_manage(workspace_id));
drop policy if exists "week settlements write" on week_settlements;
create policy "week settlements write" on week_settlements for all to authenticated
  using (can_manage(workspace_id)) with check (can_manage(workspace_id));

-- Who counted and who settled is stamped here, never taken from the browser.
create or replace function week_settlements_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare india_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.week_start > india_today then raise exception 'That week has not started yet'; end if;

  if tg_op = 'INSERT' or new.cash_counted is distinct from old.cash_counted or new.cash_note is distinct from old.cash_note then
    new.counted_by := case when new.cash_counted is null then null else auth.uid() end;
    new.counted_at := case when new.cash_counted is null then null else now() end;
    -- A new count reopens a settled week: it was settled on the old figure.
    if tg_op = 'UPDATE' and old.settled_at is not null and new.settled_at is not distinct from old.settled_at then
      new.settled_at := null; new.settled_by := null; new.snapshot := null;
    end if;
  else
    new.counted_by := coalesce(old.counted_by, new.counted_by);
    new.counted_at := coalesce(old.counted_at, new.counted_at);
  end if;

  if new.settled_at is not null and (tg_op = 'INSERT' or old.settled_at is null or new.settled_at is distinct from old.settled_at) then
    if new.week_start + 6 > india_today then raise exception 'A week can only be settled once it has ended (on its Sunday or later)'; end if;
    new.settled_at := now(); new.settled_by := auth.uid();
  elsif new.settled_at is null then
    new.settled_by := null; new.snapshot := null;
  end if;
  return new;
end $$;
revoke all on function week_settlements_stamp() from public;
drop trigger if exists week_settlements_stamp on week_settlements;
create trigger week_settlements_stamp before insert or update on week_settlements for each row execute function week_settlements_stamp();

-- ======================================================================
-- 20260101000008_roles.sql
-- ======================================================================
-- ExpenseFlow v2.6 — users and roles (accounting module, change 3D).
-- Run AFTER 20260101000007_week_settlement.sql (SQL Editor -> New query -> paste -> Run). Safe to run again.
--
--   Super admin     everything, in every workspace: can edit and delete any entry, sees every user,
--                   and decides everyone's role (profiles.super_admin; set only through admin_* below)
--   Main accountant sees everything, adds entries and journal vouchers, keeps the books, the bank
--                   statement and the weekly settlement — but cannot edit or delete an entry
--   Entry user      adds entries and sees only their own; cannot edit or delete (the role is 'editor')
--   Full view       a per-member switch (members.see_all) the super admin can turn on for anyone
--
-- Owners and admins keep what they had. Nobody can make themselves a super admin: the column is not
-- writable from the browser, and only an existing super admin may grant it. The very first one is
-- granted with the service key (scripts/bootstrap-super-admin.mjs).

-- ----------------------------------------------------------------------------------------
-- 1. The super admin flag, and the new role
-- ----------------------------------------------------------------------------------------
alter table profiles add column if not exists super_admin boolean not null default false;
-- Column privileges from the hardening migration already keep this column read-only for members;
-- restated so that the rule stays true even if someone re-grants the table later.
revoke update on profiles from authenticated;
grant update (full_name, username, advanced) on profiles to authenticated;

alter table members drop constraint if exists members_role_check;
alter table members add constraint members_role_check check (role in ('owner','admin','accountant','editor','viewer'));

-- ----------------------------------------------------------------------------------------
-- 2. The helpers every policy goes through
-- ----------------------------------------------------------------------------------------
create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select super_admin from profiles where id = auth.uid()), false)
$$;

-- A super admin acts as owner of every workspace, whether or not they are a member of it.
create or replace function ws_role(w uuid) returns text language sql stable security definer set search_path = public as $$
  select case when is_super_admin() and exists (select 1 from workspaces where id = w) then 'owner'
              else (select role from members where workspace_id = w and user_id = auth.uid()) end $$;
create or replace function is_member(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where workspace_id = w and user_id = auth.uid())
      or (is_super_admin() and exists (select 1 from workspaces where id = w)) $$;
create or replace function can_write(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ws_role(w) in ('owner','admin','accountant','editor'), false) $$;
create or replace function can_manage(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ws_role(w) in ('owner','admin'), false) $$;
-- The books: journals, ledgers, the bank statement, reconciliation and the weekly settlement.
create or replace function can_account(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ws_role(w) in ('owner','admin','accountant'), false) $$;
create or replace function sees_all(w uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ws_role(w) in ('owner','admin','accountant'), false)
      or exists (select 1 from members where workspace_id = w and user_id = auth.uid() and see_all) $$;

-- ----------------------------------------------------------------------------------------
-- 3. Entries: entry users add, only owners/admins/super admins edit or delete
-- ----------------------------------------------------------------------------------------
drop policy if exists "entries insert" on entries;
create policy "entries insert" on entries for insert to authenticated
  with check (can_write(workspace_id) and created_by = auth.uid() and (type <> 'journal' or can_account(workspace_id)));

drop policy if exists "entries update" on entries;
create policy "entries update" on entries for update to authenticated
  using (can_manage(workspace_id)) with check (can_manage(workspace_id));

drop policy if exists "entries delete" on entries;
create policy "entries delete" on entries for delete to authenticated
  using (can_manage(workspace_id));

-- A photo can be added by anyone who can add an entry, but only removed by someone who may edit one.
drop policy if exists "receipts delete" on storage.objects;
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and can_manage(((storage.foldername(name))[1])::uuid));

-- ----------------------------------------------------------------------------------------
-- 4. The main accountant keeps the books
-- ----------------------------------------------------------------------------------------
drop policy if exists "log read" on entry_log;
create policy "log read" on entry_log for select to authenticated using (can_account(workspace_id));

drop policy if exists "bank all" on bank_transactions;
create policy "bank all" on bank_transactions for all to authenticated
  using (can_account(workspace_id)) with check (can_account(workspace_id));

drop policy if exists "week settlements read" on week_settlements;
create policy "week settlements read" on week_settlements for select to authenticated using (can_account(workspace_id));
drop policy if exists "week settlements write" on week_settlements;
create policy "week settlements write" on week_settlements for all to authenticated
  using (can_account(workspace_id)) with check (can_account(workspace_id));

-- Opening balances are read for every report; changing them stays with owners and admins.
drop policy if exists "opening read" on opening_balances;
create policy "opening read" on opening_balances for select to authenticated using (can_account(workspace_id));

-- Paying an unpaid bill is part of keeping the books, so the accountant may do it too.
create or replace function check_entry_links() returns trigger
language plpgsql security definer set search_path = public as $$
declare jv_amount numeric; paid numeric;
begin
  if new.type = 'journal' or lower(btrim(new.payment_mode)) = 'cash' then
    new.bank_account_id := null;
  elsif new.bank_account_id is not null
        and not exists (select 1 from bank_accounts b where b.id = new.bank_account_id and b.workspace_id = new.workspace_id) then
    raise exception 'That bank account belongs to a different set of books';
  end if;

  if new.settles_entry_id is not null then
    if new.type <> 'expense' then raise exception 'Only an expense can settle an unpaid bill'; end if;
    if not can_account(new.workspace_id) then raise exception 'Only owners, admins and the accountant can settle an unpaid bill'; end if;
    select amount into jv_amount from entries
     where id = new.settles_entry_id and workspace_id = new.workspace_id and type = 'journal' and jv_kind = 'unpaid_bill'
       for update;
    if not found then raise exception 'That is not an unpaid-bill journal voucher of this workspace'; end if;
    select coalesce(sum(amount), 0) into paid from entries where settles_entry_id = new.settles_entry_id and id <> new.id;
    if paid + new.amount > jv_amount then
      raise exception 'That is more than is still unpaid on this bill (% of % already paid)', paid, jv_amount;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.type = 'journal' then
    select coalesce(sum(amount), 0) into paid from entries where settles_entry_id = new.id;
    if paid > new.amount then raise exception 'Payments of % are already recorded against this journal', paid; end if;
  end if;
  return new;
end $$;
revoke all on function check_entry_links() from public;

-- ----------------------------------------------------------------------------------------
-- 5. Things that went by the owner row and must not sweep up a super admin
-- ----------------------------------------------------------------------------------------
-- ws_role() now says 'owner' for a super admin everywhere, so this would have deleted every
-- temple's sample workspace instead of only the caller's own.
create or replace function remove_sample_data() returns void language sql security definer set search_path = public as $$
  delete from workspaces w where w.is_demo
    and exists (select 1 from members m where m.workspace_id = w.id and m.user_id = auth.uid() and m.role = 'owner')
$$;

create or replace function storage_usage_total() returns bigint
language plpgsql security definer set search_path = public, storage as $$
declare mine text[];
begin
  if is_super_admin() then
    select coalesce(array_agg(id::text), '{}') into mine from workspaces;
  else
    select coalesce(array_agg(workspace_id::text), '{}') into mine
      from members where user_id = auth.uid() and role in ('owner','admin');
    if array_length(mine, 1) is null then
      raise exception 'Only owners and admins can see storage usage';
    end if;
  end if;
  return coalesce((select sum((metadata->>'size')::bigint) from storage.objects
                   where bucket_id = 'receipts' and (storage.foldername(name))[1] = any(mine)), 0);
end $$;

drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select to authenticated using (
  id = auth.uid()
  or is_super_admin()
  or exists (select 1 from members a join members b on a.workspace_id = b.workspace_id where a.user_id = auth.uid() and b.user_id = profiles.id)
  or exists (select 1 from chat_members a join chat_members b on a.thread_id = b.thread_id where a.user_id = auth.uid() and b.user_id = profiles.id));

-- Workspace admins may now hand out the accountant role as well.
create or replace function add_member(p_ws uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can add members'; end if;
  if not email_confirmed() and not is_super_admin() then
    raise exception 'Please confirm your own email address first — check your inbox for the link.';
  end if;
  if p_role not in ('admin','accountant','editor','viewer') then
    raise exception 'Role must be admin, accountant, editor or viewer';
  end if;
  select id into u from auth.users
    where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  if u is null then
    raise exception 'No confirmed account with that email. Ask them to sign up and click the link in their confirmation email first.';
  end if;
  insert into members (workspace_id, user_id, role) values (p_ws, u, p_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role
    where members.role <> 'owner';
end $$;

-- ----------------------------------------------------------------------------------------
-- 6. The super admin's Users and Permissions screens
-- ----------------------------------------------------------------------------------------
-- Every change made here is kept, with who made it.
create table if not exists role_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  by_user uuid default auth.uid() references profiles(id) on delete set null,
  user_id uuid references profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  change text not null
);
create index if not exists role_log_at on role_log (at desc);
alter table role_log enable row level security;
drop policy if exists "role log read" on role_log;
create policy "role log read" on role_log for select to authenticated using (is_super_admin());
-- No insert/update/delete policies: only the functions below write it.

create or replace function admin_list_users()
returns table (id uuid, email text, full_name text, super_admin boolean, confirmed boolean,
               created_at timestamptz, last_sign_in_at timestamptz, memberships jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can list the users'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.super_admin, u.email_confirmed_at is not null,
           u.created_at, u.last_sign_in_at,
           coalesce((select jsonb_agg(jsonb_build_object('workspace_id', m.workspace_id, 'workspace', w.name, 'role', m.role,
                                                         'see_all', m.see_all, 'can_download', m.can_download) order by w.name)
                       from members m join workspaces w on w.id = m.workspace_id where m.user_id = p.id), '[]'::jsonb)
      from profiles p join auth.users u on u.id = p.id
     order by p.super_admin desc, lower(coalesce(nullif(p.full_name, ''), u.email));
end $$;

create or replace function admin_set_super_admin(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can change who is a super admin'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'No such user'; end if;
  if not p_on and not exists (select 1 from profiles where super_admin and id <> p_user) then
    raise exception 'There must always be at least one super admin';
  end if;
  update profiles set super_admin = p_on where id = p_user and super_admin is distinct from p_on;
  if found then
    insert into role_log (user_id, change) values (p_user, case when p_on then 'made super admin' else 'super admin removed' end);
  end if;
end $$;

-- Add someone to a workspace, or change their role and switches there.
create or replace function admin_set_member(p_ws uuid, p_user uuid, p_role text, p_see_all boolean default false, p_can_download boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare old members%rowtype;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change permissions here'; end if;
  if p_role not in ('owner','admin','accountant','editor','viewer') then
    raise exception 'Role must be owner, admin, accountant, editor or viewer';
  end if;
  if not exists (select 1 from workspaces where id = p_ws) then raise exception 'No such workspace'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'No such user'; end if;
  select * into old from members where workspace_id = p_ws and user_id = p_user;
  if old.role = 'owner' and p_role <> 'owner'
     and not exists (select 1 from members where workspace_id = p_ws and role = 'owner' and user_id <> p_user) then
    raise exception 'A workspace needs an owner. Make someone else its owner first.';
  end if;
  insert into members (workspace_id, user_id, role, see_all, can_download) values (p_ws, p_user, p_role, p_see_all, p_can_download)
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, see_all = excluded.see_all, can_download = excluded.can_download;
  if old.user_id is null then
    insert into role_log (user_id, workspace_id, change) values (p_user, p_ws, 'added as ' || p_role);
  elsif (old.role, old.see_all, old.can_download) is distinct from (p_role, p_see_all, p_can_download) then
    insert into role_log (user_id, workspace_id, change) values (p_user, p_ws,
      concat_ws(', ',
        case when old.role <> p_role then 'role ' || old.role || ' → ' || p_role end,
        case when old.see_all <> p_see_all then 'full view ' || case when p_see_all then 'on' else 'off' end end,
        case when old.can_download <> p_can_download then 'download ' || case when p_can_download then 'on' else 'off' end end));
  end if;
end $$;

create or replace function admin_remove_member(p_ws uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change permissions here'; end if;
  select role into r from members where workspace_id = p_ws and user_id = p_user;
  if r is null then return; end if;
  if r = 'owner' and not exists (select 1 from members where workspace_id = p_ws and role = 'owner' and user_id <> p_user) then
    raise exception 'A workspace needs an owner. Make someone else its owner first.';
  end if;
  delete from members where workspace_id = p_ws and user_id = p_user;
  insert into role_log (user_id, workspace_id, change) values (p_user, p_ws, 'removed (was ' || r || ')');
end $$;

revoke all on function admin_list_users() from public;
revoke all on function admin_set_super_admin(uuid, boolean) from public;
revoke all on function admin_set_member(uuid, uuid, text, boolean, boolean) from public;
revoke all on function admin_remove_member(uuid, uuid) from public;
grant execute on function admin_list_users() to authenticated;
grant execute on function admin_set_super_admin(uuid, boolean) to authenticated;
grant execute on function admin_set_member(uuid, uuid, text, boolean, boolean) to authenticated;
grant execute on function admin_remove_member(uuid, uuid) to authenticated;
