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
