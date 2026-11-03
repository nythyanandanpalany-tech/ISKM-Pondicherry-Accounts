-- ExpenseFlow schema. Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'member' check (role in ('admin','accountant','member')),
  created_at timestamptz default now()
);

-- The first person to sign up becomes admin, everyone after is a member.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when (select count(*) from profiles) = 0 then 'admin' else 'member' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','accountant'))
$$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null default 'bank' check (type in ('bank','cash','upi','card')),
  created_at timestamptz default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references profiles(id),
  expense_date date not null default current_date,
  title text not null,
  vendor text,
  amount numeric(12,2) not null check (amount >= 0),
  category_id uuid references categories(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  payment_mode text default 'upi',
  utr text,                      -- UPI / bank reference number, used for auto-matching
  notes text,
  payment_proof_path text,       -- IMAGE 1: screenshot of the payment
  bill_path text,                -- IMAGE 2: the bill / invoice the payment was for
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);
create index if not exists expenses_date_idx on expenses (expense_date desc);

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  txn_date date not null,
  description text,
  reference text,
  amount numeric(12,2) not null,         -- always positive
  direction text not null default 'debit' check (direction in ('debit','credit')),
  account_id uuid references accounts(id) on delete set null,
  matched_expense_id uuid unique references expenses(id) on delete set null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table categories enable row level security;
alter table accounts enable row level security;
alter table expenses enable row level security;
alter table bank_transactions enable row level security;

create policy "profiles read" on profiles for select to authenticated using (id = auth.uid() or is_staff());
create policy "profiles admin update" on profiles for update to authenticated using (is_admin()) with check (is_admin());

create policy "categories read" on categories for select to authenticated using (true);
create policy "categories write" on categories for all to authenticated using (is_staff()) with check (is_staff());
create policy "accounts read" on accounts for select to authenticated using (true);
create policy "accounts write" on accounts for all to authenticated using (is_staff()) with check (is_staff());

create policy "expenses read" on expenses for select to authenticated using (created_by = auth.uid() or is_staff());
create policy "expenses insert" on expenses for insert to authenticated with check (created_by = auth.uid() or is_staff());
create policy "expenses update" on expenses for update to authenticated
  using (is_staff() or (created_by = auth.uid() and status = 'pending'))
  with check (is_staff() or (created_by = auth.uid() and status = 'pending'));
create policy "expenses delete" on expenses for delete to authenticated
  using (is_staff() or (created_by = auth.uid() and status = 'pending'));

create policy "txn staff" on bank_transactions for all to authenticated using (is_staff()) with check (is_staff());

-- Private storage bucket for the payment screenshots and bills
insert into storage.buckets (id, name, public) values ('receipts','receipts', false) on conflict do nothing;
create policy "receipts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or is_staff()));
create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or is_staff()));
create policy "receipts update" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or is_staff()));
create policy "receipts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or is_staff()));

insert into categories (name) values
  ('Groceries & Provisions'),('Vegetables & Fruits'),('Utilities'),('Maintenance & Repairs'),
  ('Festival & Events'),('Travel'),('Printing & Stationery'),('Salaries & Honorarium'),('Miscellaneous')
on conflict do nothing;
insert into accounts (name,type) values ('Main Bank Account','bank'),('Cash','cash'),('UPI','upi') on conflict do nothing;
