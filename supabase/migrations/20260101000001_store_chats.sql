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
create policy "stores read" on stores for select to authenticated using (is_member(workspace_id));
create policy "stores write" on stores for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));
create policy "sitems read" on store_items for select to authenticated using (is_member(workspace_id));
create policy "sitems write" on store_items for all to authenticated using (can_manage(workspace_id)) with check (can_manage(workspace_id));
create policy "moves read" on stock_moves for select to authenticated using (is_member(workspace_id));
create policy "moves insert" on stock_moves for insert to authenticated with check (can_write(workspace_id) and created_by = auth.uid());
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
create policy "threads read" on chat_threads for select to authenticated using (can_chat(id));
create policy "cm read" on chat_members for select to authenticated using (can_chat(thread_id));
create policy "cm insert own" on chat_members for insert to authenticated with check (user_id = auth.uid() and can_chat(thread_id));
create policy "cm update own" on chat_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cm delete own" on chat_members for delete to authenticated using (user_id = auth.uid());
create policy "msg read" on chat_messages for select to authenticated using (can_chat(thread_id));
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
create policy "feedback insert" on feedback for insert to authenticated with check (user_id = auth.uid());
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
