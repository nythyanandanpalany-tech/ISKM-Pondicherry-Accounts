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
