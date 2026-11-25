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
