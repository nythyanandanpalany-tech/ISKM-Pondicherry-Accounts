-- ExpenseFlow v2.8 — the main super admin, the activity log, and the chart of accounts (section H).
-- Run AFTER 20260101000009_daily_report.sql (SQL Editor -> New query -> paste -> Run). Safe to run again.
--
--   1. Every super admin has the same powers — except over the MAIN super admin (the account the
--      bootstrap script names), whose access nobody else can change and whose account cannot be deleted.
--   2. activity_log: every action of every user, written by the database itself (triggers), so nothing
--      done through the app — or around it — goes unrecorded. Super admins read all of it; owners and
--      admins read their own workspace's.
--   3. The chart of accounts from the FY2025-26 final accounts. A super admin approves it per workspace,
--      which creates its heads with the right book and capital flags; old heads can then be merged into
--      the chart's, carrying their vouchers with them.

-- ========================================================================================
-- 1. The main super admin
-- ========================================================================================
alter table profiles add column if not exists main_super_admin boolean not null default false;
create unique index if not exists profiles_one_main_super_admin on profiles ((true)) where main_super_admin;
alter table profiles drop constraint if exists profiles_main_is_super;
alter table profiles add constraint profiles_main_is_super check (not main_super_admin or super_admin);
-- Not writable from the browser: the column grants allow only full_name, username and advanced.
revoke update on profiles from authenticated;
grant update (full_name, username, advanced) on profiles to authenticated;

create or replace function is_main_super_admin(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select main_super_admin from profiles where id = u), false) $$;

-- Another super admin may do anything — except change the main super admin's access.
create or replace function _protect_main(p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if is_main_super_admin(p_user) and p_user is distinct from auth.uid() then
    raise exception 'The main super admin''s access cannot be changed by anyone else';
  end if;
end $$;
revoke all on function _protect_main(uuid) from public;

create or replace function admin_set_super_admin(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can change who is a super admin'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'No such user'; end if;
  if not p_on and is_main_super_admin(p_user) then raise exception 'The main super admin always keeps full access'; end if;
  if not p_on and not exists (select 1 from profiles where super_admin and id <> p_user) then
    raise exception 'There must always be at least one super admin';
  end if;
  update profiles set super_admin = p_on where id = p_user and super_admin is distinct from p_on;
  if found then
    insert into role_log (user_id, change) values (p_user, case when p_on then 'made super admin' else 'super admin removed' end);
  end if;
end $$;

create or replace function admin_set_member(p_ws uuid, p_user uuid, p_role text, p_see_all boolean default false, p_can_download boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare old members%rowtype;
begin
  if not is_super_admin() then raise exception 'Only a super admin can change permissions here'; end if;
  perform _protect_main(p_user);
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
  perform _protect_main(p_user);
  select role into r from members where workspace_id = p_ws and user_id = p_user;
  if r is null then return; end if;
  if r = 'owner' and not exists (select 1 from members where workspace_id = p_ws and role = 'owner' and user_id <> p_user) then
    raise exception 'A workspace needs an owner. Make someone else its owner first.';
  end if;
  delete from members where workspace_id = p_ws and user_id = p_user;
  insert into role_log (user_id, workspace_id, change) values (p_user, p_ws, 'removed (was ' || r || ')');
end $$;

-- Workspace owners and admins cannot change or remove the main super admin's membership either.
drop policy if exists "members update" on members;
create policy "members update" on members for update to authenticated
  using (can_manage(workspace_id) and role <> 'owner' and (not is_main_super_admin(user_id) or user_id = auth.uid()))
  with check (can_manage(workspace_id) and role <> 'owner');
drop policy if exists "members delete" on members;
create policy "members delete" on members for delete to authenticated
  using ((can_manage(workspace_id) and role <> 'owner' and not is_main_super_admin(user_id)) or user_id = auth.uid());

-- The main super admin's account cannot be deleted.
create or replace function delete_account() returns void language plpgsql security definer set search_path = public as $$
begin
  if is_main_super_admin(auth.uid()) then
    raise exception 'The main super admin''s account cannot be deleted';
  end if;
  if exists (select 1 from members m where m.user_id = auth.uid() and m.role = 'owner'
             and exists (select 1 from members o where o.workspace_id = m.workspace_id and o.user_id <> auth.uid())) then
    raise exception 'You own a workspace that has other members. Delete that workspace or remove the members first.';
  end if;
  delete from workspaces where id in (select workspace_id from members where user_id = auth.uid() and role = 'owner');
  delete from auth.users where id = auth.uid();
end $$;
create or replace function _guard_main_delete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.main_super_admin then raise exception 'The main super admin''s account cannot be deleted'; end if;
  return old;
end $$;
drop trigger if exists profiles_guard_main on profiles;
create trigger profiles_guard_main before delete on profiles for each row execute function _guard_main_delete();

drop function if exists admin_list_users();
create function admin_list_users()
returns table (id uuid, email text, full_name text, super_admin boolean, main_super_admin boolean, confirmed boolean,
               created_at timestamptz, last_sign_in_at timestamptz, memberships jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_super_admin() then raise exception 'Only a super admin can list the users'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.super_admin, p.main_super_admin, u.email_confirmed_at is not null,
           u.created_at, u.last_sign_in_at,
           coalesce((select jsonb_agg(jsonb_build_object('workspace_id', m.workspace_id, 'workspace', w.name, 'role', m.role,
                                                         'see_all', m.see_all, 'can_download', m.can_download) order by w.name)
                       from members m join workspaces w on w.id = m.workspace_id where m.user_id = p.id), '[]'::jsonb)
      from profiles p join auth.users u on u.id = p.id
     order by p.main_super_admin desc, p.super_admin desc, lower(coalesce(nullif(p.full_name, ''), u.email));
end $$;
revoke all on function admin_list_users() from public;
grant execute on function admin_list_users() to authenticated;

-- ========================================================================================
-- 2. The activity log
-- ========================================================================================
-- No foreign keys: a record of what someone did must outlive the user, the workspace and the row.
create table if not exists activity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  workspace_id uuid,
  workspace_name text,
  area text not null,
  action text not null check (action in ('added','changed','deleted','signed in','signed up','sent')),
  summary text not null,
  details jsonb
);
create index if not exists activity_log_at on activity_log (at desc);
create index if not exists activity_log_ws_at on activity_log (workspace_id, at desc);
create index if not exists activity_log_actor_at on activity_log (actor, at desc);
alter table activity_log enable row level security;
drop policy if exists "activity read" on activity_log;
create policy "activity read" on activity_log for select to authenticated
  using (is_super_admin() or (workspace_id is not null and can_manage(workspace_id)));
-- No write policies: only the triggers below write it, and nobody can edit or delete a line.

-- Money and dates as people read them, for the summaries.
create or replace function _dmy(d text) returns text language sql immutable as $$
  select case when d is null then null else to_char(d::date, 'DD/MM/YYYY') end $$;
create or replace function _head_name(id text) returns text language sql stable security definer set search_path = public as $$
  select name from categories where id = nullif($1, '')::uuid $$;
create or replace function _user_name(id text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from profiles where id = nullif($1, '')::uuid $$;

create or replace function _activity(p_ws uuid, p_area text, p_action text, p_summary text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into activity_log (actor, actor_name, workspace_id, workspace_name, area, action, summary, details)
  values (auth.uid(), _user_name(auth.uid()::text), p_ws, (select name from workspaces where id = p_ws), p_area, p_action, p_summary, p_details);
end $$;
revoke all on function _activity(uuid, text, text, text, jsonb) from public;

create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  act text := case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'deleted' end;
  verb text := case tg_op when 'INSERT' then 'Added' when 'UPDATE' then 'Changed' else 'Deleted' end;
  diff jsonb := '{}'; k text; ws uuid; area text; what text; changes text;
begin
  -- Only what a person did directly: rows a cascade or another trigger touched are part of that one action.
  if pg_trigger_depth() > 1 then return null; end if;
  -- Rows that went with a deleted workspace, head, store or user are part of that one deletion, not
  -- separate actions (a cascade's row triggers fire at the same depth as a direct delete).
  if tg_op = 'DELETE' then
    if tg_table_name <> 'workspaces' and o ? 'workspace_id' and not exists (select 1 from workspaces where id = (o->>'workspace_id')::uuid) then return null; end if;
    if tg_table_name = 'items' and not exists (select 1 from categories where id = (o->>'category_id')::uuid) then return null; end if;
    if tg_table_name = 'store_items' and not exists (select 1 from stores where id = (o->>'store_id')::uuid) then return null; end if;
    if tg_table_name = 'stock_moves' and not exists (select 1 from store_items where id = (o->>'store_item_id')::uuid) then return null; end if;
    if tg_table_name = 'members' and not exists (select 1 from profiles where id = (o->>'user_id')::uuid) then return null; end if;
  end if;

  if tg_op = 'UPDATE' then
    for k in select key from jsonb_each(n) loop
      continue when k in ('updated_at', 'snapshot', 'voucher_seq', 'voucher_month', 'voucher_fy', 'claim_settled_at');
      if n->k is distinct from o->k then diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
    end loop;
    if diff = '{}' then return null; end if;
    select string_agg(replace(key, '_', ' '), ', ') into changes from jsonb_object_keys(diff) key;
  end if;

  ws := case tg_table_name when 'workspaces' then (r->>'id')::uuid else nullif(r->>'workspace_id', '')::uuid end;

  case tg_table_name
  when 'entries' then
    area := 'Entries';
    what := initcap(r->>'type') || ' ' || coalesce(r->>'voucher_no', _dmy(r->>'entry_date')) || ' · ' || inr((r->>'amount')::numeric)
         || coalesce(' · ' || _head_name(coalesce(r->>'category_id', r->>'dr_category_id')), '');
    if tg_op = 'UPDATE' and diff ? 'category_id' then
      changes := replace(changes, 'category id', 'head ' || coalesce(_head_name(o->>'category_id'), '—') || ' → ' || coalesce(_head_name(n->>'category_id'), '—'));
    end if;
  when 'categories' then area := 'Heads'; what := r->>'kind' || ' head ' || (r->>'name') || ' (' || (r->>'book') || ' book)';
  when 'items' then area := 'Heads'; what := 'item ' || (r->>'name') || coalesce(' under ' || _head_name(r->>'category_id'), '');
  when 'people' then area := 'People'; what := 'person ' || (r->>'name');
  when 'members' then
    area := 'Members & roles';
    what := coalesce(_user_name(r->>'user_id'), 'a member') || ' as ' || (r->>'role')
         || case when (r->>'see_all')::boolean and r->>'role' in ('editor','viewer') then ' (full view)' else '' end;
    if tg_op = 'UPDATE' then
      what := coalesce(_user_name(r->>'user_id'), 'a member');
      changes := concat_ws(', ',
        case when diff ? 'role' then 'role ' || (o->>'role') || ' → ' || (n->>'role') end,
        case when diff ? 'see_all' then 'full view ' || case when (n->>'see_all')::boolean then 'on' else 'off' end end,
        case when diff ? 'can_download' then 'download ' || case when (n->>'can_download')::boolean then 'on' else 'off' end end);
    end if;
  when 'profiles' then
    area := 'Users'; what := coalesce(nullif(r->>'full_name', ''), r->>'email');
    if tg_op = 'UPDATE' and diff ? 'super_admin' then
      perform _activity(null, area, act, case when (n->>'super_admin')::boolean then 'Made ' || what || ' a super admin'
                                              else 'Took super admin away from ' || what end, diff);
      return null;
    end if;
  when 'workspaces' then
    area := 'Workspace'; what := 'workspace ' || (r->>'name');
    if tg_op = 'UPDATE' and diff ? 'chart_approved_at' and n->>'chart_approved_at' is not null then
      perform _activity(ws, 'Heads', act, 'Approved the chart of accounts', null);
      return null;
    end if;
  when 'bank_accounts' then area := 'Bank'; what := 'bank account ' || (r->>'name');
  when 'bank_transactions' then
    area := 'Bank'; what := 'statement row ' || _dmy(r->>'txn_date') || ' · ' || inr((r->>'amount')::numeric) || coalesce(' · ' || nullif(r->>'description', ''), '');
    if tg_op = 'UPDATE' and diff ? 'matched_entry_id' then
      perform _activity(ws, area, act, case when n->>'matched_entry_id' is null then 'Unmatched ' || what
        else 'Matched ' || what || ' to ' || coalesce((select coalesce(voucher_no, 'an entry') from entries where id = (n->>'matched_entry_id')::uuid), 'an entry') end, diff);
      return null;
    end if;
  when 'opening_balances' then
    area := 'Books setup';
    what := 'opening balance ' || case
        when r->>'account' = 'cash' then 'Cash in hand'
        when r->>'account' like 'bank:%' then 'Bank – ' || coalesce((select name from bank_accounts where id::text = substr(r->>'account', 6)), 'removed account')
        when r->>'account' like 'head:%' then coalesce(_head_name(substr(r->>'account', 6)), 'removed head')
        else initcap(replace(r->>'account', '_', ' ')) end
      || ' (' || (r->>'book') || ') ' || inr((r->>'amount')::numeric);
  when 'week_settlements' then
    area := 'Weekly settlement'; what := 'week of ' || _dmy(r->>'week_start');
    if tg_op = 'UPDATE' and diff ? 'settled_at' then
      perform _activity(ws, area, act, case when n->>'settled_at' is null then 'Reopened ' else 'Settled ' end || what, diff);
      return null;
    elsif r->>'cash_counted' is not null and (tg_op = 'INSERT' or diff ? 'cash_counted') then
      perform _activity(ws, area, act, 'Counted cash ' || inr((r->>'cash_counted')::numeric) || ' for the ' || what, diff);
      return null;
    end if;
  when 'report_settings' then
    area := 'Daily report'; what := 'Telegram settings (' || case when (r->>'enabled')::boolean then 'on' else 'off' end || ')';
  when 'report_secrets' then
    -- Never the token itself.
    perform _activity(ws, 'Daily report', act, case tg_op when 'DELETE' then 'Removed the Telegram bot token' else 'Saved a new Telegram bot token' end, null);
    return null;
  when 'report_deliveries' then
    if tg_op <> 'INSERT' then return null; end if;
    perform _activity(ws, 'Daily report', 'sent', case r->>'kind' when 'test' then 'Sent a Telegram test message'
      else 'Sent the daily report for ' || _dmy(r->>'report_date') || ' (' || coalesce(r->>'book', '') || ')'
           || case r->>'kind' when 'scheduled' then ' at 3:30 AM' else ' by hand' end end, null);
    return null;
  when 'stores' then area := 'Store'; what := 'store ' || (r->>'name');
  when 'store_items' then area := 'Store'; what := 'store item ' || (r->>'name');
  when 'stock_moves' then
    area := 'Store';
    what := 'stock ' || (r->>'direction') || ' ' || (r->>'qty') || ' of ' || coalesce((select name from store_items where id = (r->>'store_item_id')::uuid), 'an item');
  else area := initcap(replace(tg_table_name, '_', ' ')); what := tg_table_name;
  end case;

  perform _activity(ws, area, act,
    verb || ' ' || what || case when tg_op = 'UPDATE' and changes is not null and changes <> '' then ' — ' || changes else '' end,
    case when tg_op = 'UPDATE' then diff when tg_op = 'DELETE' then o else null end);
  return null;
end $$;
revoke all on function log_activity() from public;

do $$
declare t text;
begin
  foreach t in array array['entries','categories','items','people','members','profiles','workspaces','bank_accounts','bank_transactions',
                           'opening_balances','week_settlements','report_settings','report_deliveries','stores','store_items','stock_moves'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_activity on public.%I', t);
      execute format('create trigger zz_activity after insert or update or delete on public.%I for each row execute function log_activity()', t);
    end if;
  end loop;
  execute 'drop trigger if exists zz_activity on private.report_secrets';
  execute 'create trigger zz_activity after insert or update or delete on private.report_secrets for each row execute function log_activity()';
end $$;

-- Signing up and signing in come from Supabase Auth.
create or replace function log_auth_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into activity_log (actor, actor_name, area, action, summary)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'Sign-in', 'signed up', 'Signed up as ' || new.email);
  elsif new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
    insert into activity_log (actor, actor_name, area, action, summary)
    values (new.id, coalesce(_user_name(new.id::text), new.email), 'Sign-in', 'signed in', 'Signed in');
  end if;
  return null;
end $$;
revoke all on function log_auth_activity() from public;
drop trigger if exists zz_activity_auth on auth.users;
create trigger zz_activity_auth after insert or update of last_sign_in_at on auth.users for each row execute function log_auth_activity();

-- ========================================================================================
-- 3. The chart of accounts (from the FY2025-26 final accounts), approved by a super admin
-- ========================================================================================
alter table workspaces add column if not exists chart_approved_at timestamptz;
alter table workspaces add column if not exists chart_approved_by uuid references profiles(id) on delete set null;

-- grp: income / expense / capital heads are created on approval; assets and liabilities are standing
-- accounts of the books (lib/accounts.ts) or bank accounts.
create or replace function chart_of_accounts()
returns table (ord int, grp text, name text, kind text, book text, is_capital boolean, section text)
language sql immutable as $$
  values
    ( 1, 'income',    'Donations – received in bank',      'income',  'temple',  false, null),
    ( 2, 'income',    'Donations – received in cash',      'income',  'temple',  false, null),
    ( 3, 'income',    'Sale of books',                     'income',  'temple',  false, null),
    ( 4, 'income',    'Interest on savings bank accounts', 'income',  'temple',  false, null),
    (10, 'expense',   'Allowance (staff / devotees)',      'expense', 'temple',  false, null),
    (11, 'expense',   'Annadanam',                         'expense', 'temple',  false, null),
    (12, 'expense',   'Purchase of books',                 'expense', 'books',   false, null),
    (13, 'expense',   'Gaushala',                          'expense', 'goshala', false, null),
    (14, 'expense',   'Festival',                          'expense', 'temple',  false, null),
    (15, 'expense',   'Fees, electricity & other charges', 'expense', 'temple',  false, null),
    (16, 'expense',   'Travelling',                        'expense', 'temple',  false, null),
    (17, 'expense',   'Deity & Puja',                      'expense', 'temple',  false, null),
    (18, 'expense',   'Medical',                           'expense', 'temple',  false, null),
    (19, 'expense',   'Office',                            'expense', 'temple',  false, null),
    (20, 'expense',   'Miscellaneous',                     'expense', 'temple',  false, null),
    (21, 'expense',   'Bank charges',                      'expense', 'temple',  false, null),
    (30, 'capital',   'Construction – Building',           'expense', 'temple',  true,  'construction'),
    (31, 'capital',   'Fixed assets purchased',            'expense', 'temple',  true,  null),
    (40, 'asset',     'Cash in hand',                      null,      null,      false, null),
    (41, 'asset',     'Bank – Ujjivan Small Finance Bank', null,      null,      false, null),
    (42, 'asset',     'Bank – IDFC FIRST',                 null,      null,      false, null),
    (43, 'asset',     'Loans & advances',                  null,      null,      false, null),
    (44, 'asset',     'Recoverable from BBT trade book (until BBT decision)', null, null, false, null),
    (50, 'liability', 'Capital Fund',                      null,      null,      false, null),
    (51, 'liability', 'Outstanding expenses (bills not yet paid – needed for accrual)', null, null, false, null),
    (52, 'liability', 'Loans received',                    null,      null,      false, null)
$$;

-- The chart, with whether each line is already in this workspace, and who approved it.
create or replace function chart_status(p_ws uuid)
returns table (ord int, grp text, name text, kind text, book text, is_capital boolean, present boolean,
               approved_at timestamptz, approved_by text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can see the chart of accounts'; end if;
  return query
    select c.ord, c.grp, c.name, c.kind, c.book, c.is_capital,
           case when c.kind is not null then exists (select 1 from categories h where h.workspace_id = p_ws and h.kind = c.kind and lower(h.name) = lower(c.name))
                when c.name like 'Bank – %' then exists (select 1 from bank_accounts b where b.workspace_id = p_ws and lower(b.name) = lower(substr(c.name, 8)))
                else true end,
           w.chart_approved_at, _user_name(w.chart_approved_by::text)
      from chart_of_accounts() c cross join workspaces w where w.id = p_ws order by c.ord;
end $$;

-- Approving creates the missing heads and banks, and puts every chart head in its book. Returns how many were added.
create or replace function approve_chart_of_accounts(p_ws uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c record; added int := 0;
begin
  if not is_super_admin() then raise exception 'Only a super admin can approve the chart of accounts'; end if;
  if not exists (select 1 from workspaces where id = p_ws) then raise exception 'No such workspace'; end if;
  for c in select * from chart_of_accounts() loop
    if c.kind is not null then
      update categories set book = c.book, is_capital = c.is_capital, section = c.section
       where workspace_id = p_ws and kind = c.kind and lower(name) = lower(c.name)
         and (book, is_capital, section) is distinct from (c.book, c.is_capital, c.section);
      if not exists (select 1 from categories where workspace_id = p_ws and kind = c.kind and lower(name) = lower(c.name)) then
        insert into categories (workspace_id, name, kind, book, is_capital, section) values (p_ws, c.name, c.kind, c.book, c.is_capital, c.section);
        added := added + 1;
      end if;
    elsif c.name like 'Bank – %' and not exists (select 1 from bank_accounts where workspace_id = p_ws and lower(name) = lower(substr(c.name, 8))) then
      insert into bank_accounts (workspace_id, name) values (p_ws, substr(c.name, 8));
      added := added + 1;
    end if;
  end loop;
  -- Approving an unchanged chart again records nothing new.
  update workspaces set chart_approved_at = now(), chart_approved_by = auth.uid() where id = p_ws and (chart_approved_at is null or added > 0);
  return added;
end $$;

-- Heads outside the chart, with how many vouchers use them, so they can be merged into the chart's.
create or replace function chart_other_heads(p_ws uuid)
returns table (id uuid, name text, kind text, entries int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can see the chart of accounts'; end if;
  return query
    select h.id, h.name, h.kind,
           (select count(*)::int from entries e where e.workspace_id = p_ws and h.id in (e.category_id, e.dr_category_id, e.cr_category_id))
      from categories h
     where h.workspace_id = p_ws
       and not exists (select 1 from chart_of_accounts() c where c.kind = h.kind and lower(c.name) = lower(h.name))
     order by h.kind, h.name;
end $$;

-- Move everything from one head into another, then remove the old head. Voucher numbers do not change.
create or replace function merge_head(p_from uuid, p_into uuid) returns int
language plpgsql security definer set search_path = public as $$
declare f categories%rowtype; t categories%rowtype; it record; same uuid; moved int;
begin
  if not is_super_admin() then raise exception 'Only a super admin can merge heads'; end if;
  select * into f from categories where id = p_from;
  select * into t from categories where id = p_into;
  if f.id is null or t.id is null then raise exception 'No such head'; end if;
  if f.id = t.id then raise exception 'Choose a different head to merge into'; end if;
  if f.workspace_id <> t.workspace_id then raise exception 'Both heads must be in the same workspace'; end if;
  if f.kind <> t.kind then raise exception 'An income head can only be merged into an income head, and an expense head into an expense head'; end if;
  if exists (select 1 from entries where type = 'journal' and dr_category_id in (p_from, p_into) and cr_category_id in (p_from, p_into)) then
    raise exception 'A journal voucher moves money between these two heads; merging would make both sides the same head';
  end if;

  select count(*) into moved from entries where p_from in (category_id, dr_category_id, cr_category_id);
  update entries set category_id = p_into where category_id = p_from;
  update entries set dr_category_id = p_into where dr_category_id = p_from;
  update entries set cr_category_id = p_into where cr_category_id = p_from;
  for it in select * from items where category_id = p_from loop
    select id into same from items where category_id = p_into and lower(name) = lower(it.name);
    if same is not null then
      update entries set item_id = same where item_id = it.id;
      delete from items where id = it.id;
    else
      update items set category_id = p_into where id = it.id;
    end if;
  end loop;
  insert into opening_balances (workspace_id, book, account, amount)
    select workspace_id, book, 'head:' || p_into, amount from opening_balances where workspace_id = f.workspace_id and account = 'head:' || p_from
  on conflict (workspace_id, book, account) do update set amount = opening_balances.amount + excluded.amount;
  delete from opening_balances where workspace_id = f.workspace_id and account = 'head:' || p_from;
  delete from categories where id = p_from;
  perform _activity(f.workspace_id, 'Heads', 'changed', 'Merged head ' || f.name || ' into ' || t.name || ' (' || moved || ' voucher' || case when moved = 1 then '' else 's' end || ' moved)', null);
  return moved;
end $$;
