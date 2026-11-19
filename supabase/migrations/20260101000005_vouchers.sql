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
