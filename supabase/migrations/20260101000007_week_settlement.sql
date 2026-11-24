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
