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
