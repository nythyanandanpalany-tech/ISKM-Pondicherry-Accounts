-- ExpenseFlow v2.7 — the daily report for Mangalarti (accounting module, change 3E).
-- Run AFTER 20260101000008_roles.sql (SQL Editor -> New query -> paste -> Run). Safe to run again.
--
-- Every morning at 3:30 India time — an hour before Mangalarti — the previous day's income and expense
-- go to the temple's Telegram group: one message for all books together, then one each for Temple,
-- Goshala and Books. Each message is, in order: (1) total income and total expense, (2) a breakdown by
-- head, (3) donor names with amounts. A day (or a book) with no entries sends nothing.
--
-- It all runs inside the database, so nothing depends on a server staying awake:
--   * daily_report_text() writes a message; the app's preview calls the very same function.
--   * pg_cron calls run_daily_reports() at 22:00 UTC, which is 03:30 IST (India has no daylight saving).
--   * pg_net posts each message to Telegram's sendMessage.
--   * The bot token lives in the `private` schema, which the browser's API cannot reach at all. It can be
--     set or replaced by an owner/admin, never read back.

-- ----------------------------------------------------------------------------------------
-- 1. Extensions (both are on Supabase's free plan). Skipped where unavailable, e.g. the test database,
--    which brings stand-ins of its own (supabase/tests/stubs.sql).
-- ----------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
end $$;

-- ----------------------------------------------------------------------------------------
-- 2. Settings, the secret, and what was sent
-- ----------------------------------------------------------------------------------------
create table if not exists report_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  telegram_chat_id text,
  language text not null default 'en' check (language in ('en')),   -- Tamil to follow when Prabhu says
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references profiles(id) on delete set null
);
alter table report_settings enable row level security;
drop policy if exists "report settings read" on report_settings;
create policy "report settings read" on report_settings for select to authenticated using (can_manage(workspace_id));
-- Written only through set_daily_report().

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema private from authenticated'; end if;
end $$;
create table if not exists private.report_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  telegram_token text not null
);
revoke all on private.report_secrets from public;

create table if not exists report_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  report_date date,
  book text check (book in ('all','temple','goshala','books')),
  kind text not null check (kind in ('scheduled','manual','test')),
  message text not null,
  request_id bigint,                 -- pg_net's id; its reply is copied into status/error once it arrives
  status int,
  error text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references profiles(id) on delete set null
);
-- The 3:30 job sends each day's report once, however often it is run.
create unique index if not exists report_deliveries_once on report_deliveries (workspace_id, report_date, book) where kind = 'scheduled';
create index if not exists report_deliveries_recent on report_deliveries (workspace_id, created_at desc);
alter table report_deliveries enable row level security;
drop policy if exists "report deliveries read" on report_deliveries;
create policy "report deliveries read" on report_deliveries for select to authenticated using (can_manage(workspace_id));

-- ----------------------------------------------------------------------------------------
-- 3. Writing the message
-- ----------------------------------------------------------------------------------------
-- Rupees with Indian grouping (₹1,23,456), paise only when there are any.
create or replace function inr(n numeric) returns text language plpgsql immutable as $$
declare whole text := trunc(abs(n))::bigint::text; paise int := round((abs(n) - trunc(abs(n))) * 100); head text; tail text;
begin
  if length(whole) > 3 then
    tail := right(whole, 3); head := left(whole, length(whole) - 3);
    while length(head) > 2 loop tail := right(head, 2) || ',' || tail; head := left(head, length(head) - 2); end loop;
    whole := head || ',' || tail;
  end if;
  return case when n < 0 then '-' else '' end || '₹' || whole || case when paise > 0 then '.' || lpad(paise::text, 2, '0') else '' end;
end $$;

-- The day's income and expense lines of one book ('all' for every book). No permission check here: it is
-- only ever called by the functions below, which check first.
create or replace function _daily_report_rows(p_ws uuid, p_day date, p_book text)
returns table (type text, amount numeric, head text, donor text)
language sql stable security definer set search_path = public as $$
  select e.type, e.amount, coalesce(c.name, 'Uncategorised'), p.name
    from entries e
    left join categories c on c.id = e.category_id
    left join people p on p.id = e.person_id
   where e.workspace_id = p_ws and e.entry_date = p_day and e.type in ('income','expense')
     and (p_book = 'all' or coalesce(c.book, 'temple') = p_book)
$$;
revoke all on function _daily_report_rows(uuid, date, text) from public;

create or replace function _daily_report_text(p_ws uuid, p_day date, p_book text) returns text
language plpgsql stable security definer set search_path = public as $$
declare msg text; inc numeric; exp numeric; n int; r record; title text; label text;
begin
  select count(*), coalesce(sum(x.amount) filter (where x.type = 'income'), 0), coalesce(sum(x.amount) filter (where x.type = 'expense'), 0)
    into n, inc, exp from _daily_report_rows(p_ws, p_day, p_book) x;
  if n = 0 then return null; end if;   -- nothing that day: send nothing

  select name into title from workspaces where id = p_ws;
  label := case p_book when 'all' then 'All books' when 'temple' then 'Temple' when 'goshala' then 'Goshala' else 'Books' end;
  msg := 'Hare Krishna 🙏' || E'\n' || title || ' — Daily report · ' || label || E'\n'
      || to_char(p_day, 'FMDay, FMDD Mon YYYY') || E'\n\n'
      || 'Total income: ' || inr(inc) || E'\n'
      || 'Total expense: ' || inr(exp) || E'\n';

  if inc > 0 then
    msg := msg || E'\nIncome by head\n';
    for r in select x.head, sum(x.amount) s from _daily_report_rows(p_ws, p_day, p_book) x where x.type = 'income'
              group by x.head order by sum(x.amount) desc, x.head loop
      msg := msg || '• ' || r.head || ': ' || inr(r.s) || E'\n';
    end loop;
  end if;
  if exp > 0 then
    msg := msg || E'\nExpense by head\n';
    for r in select x.head, sum(x.amount) s from _daily_report_rows(p_ws, p_day, p_book) x where x.type = 'expense'
              group by x.head order by sum(x.amount) desc, x.head loop
      msg := msg || '• ' || r.head || ': ' || inr(r.s) || E'\n';
    end loop;
  end if;
  if inc > 0 then
    msg := msg || E'\nDonors\n';
    for r in select coalesce(x.donor, 'Name not recorded') d, sum(x.amount) s from _daily_report_rows(p_ws, p_day, p_book) x
              where x.type = 'income' group by x.donor order by x.donor is null, sum(x.amount) desc, x.donor loop
      msg := msg || '• ' || r.d || ': ' || inr(r.s) || E'\n';
    end loop;
  end if;
  -- Telegram's limit is 4096 characters; a day that long is cut, not lost.
  return left(rtrim(msg, E'\n'), 4000);
end $$;
revoke all on function _daily_report_text(uuid, date, text) from public;

-- The messages for one day, in sending order. The app's preview reads exactly this.
create or replace function daily_report_messages(p_ws uuid, p_day date)
returns table (book text, message text) language plpgsql stable security definer set search_path = public as $$
begin
  if not can_account(p_ws) then raise exception 'Only owners, admins and the main accountant can see the daily report'; end if;
  return query
    select b.bk, x.m from unnest(array['all','temple','goshala','books']) with ordinality as b(bk, ord)
      cross join lateral (select _daily_report_text(p_ws, p_day, b.bk) as m) x
     where x.m is not null order by b.ord;
end $$;

-- ----------------------------------------------------------------------------------------
-- 4. Settings: set by owners and admins; the token can be replaced but never read back
-- ----------------------------------------------------------------------------------------
create or replace function daily_report_config(p_ws uuid)
returns table (enabled boolean, telegram_chat_id text, has_token boolean, token_hint text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can see the daily report settings'; end if;
  return query
    select coalesce(s.enabled, false), s.telegram_chat_id, t.telegram_token is not null,
           case when t.telegram_token is null then null
                else split_part(t.telegram_token, ':', 1) || ':…' || right(t.telegram_token, 4) end
      from (select p_ws as w) x
      left join report_settings s on s.workspace_id = x.w
      left join private.report_secrets t on t.workspace_id = x.w;
end $$;

-- p_token: null keeps the saved one, '' removes it.
create or replace function set_daily_report(p_ws uuid, p_enabled boolean, p_chat_id text, p_token text default null) returns void
language plpgsql security definer set search_path = public as $$
declare tok text := nullif(btrim(coalesce(p_token, '')), ''); chat text := nullif(btrim(coalesce(p_chat_id, '')), '');
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can change the daily report'; end if;
  if tok is not null and tok !~ '^[0-9]{5,}:[A-Za-z0-9_-]{30,}$' then
    raise exception 'That does not look like a Telegram bot token (it is the line @BotFather gives, like 123456789:AAF…)';
  end if;
  if chat is not null and chat !~ '^(-?[0-9]{5,}|@[A-Za-z][A-Za-z0-9_]{4,})$' then
    raise exception 'The group chat id is a number such as -1001234567890 (or @channelname)';
  end if;
  if p_token is not null then
    if tok is null then delete from private.report_secrets where workspace_id = p_ws;
    else insert into private.report_secrets (workspace_id, telegram_token) values (p_ws, tok)
         on conflict (workspace_id) do update set telegram_token = excluded.telegram_token; end if;
  end if;
  if p_enabled and (chat is null or not exists (select 1 from private.report_secrets where workspace_id = p_ws)) then
    raise exception 'Add the bot token and the group chat id before switching the daily report on';
  end if;
  insert into report_settings (workspace_id, enabled, telegram_chat_id, updated_at, updated_by)
  values (p_ws, p_enabled, chat, now(), auth.uid())
  on conflict (workspace_id) do update set enabled = excluded.enabled, telegram_chat_id = excluded.telegram_chat_id,
    updated_at = now(), updated_by = auth.uid();
end $$;

-- ----------------------------------------------------------------------------------------
-- 5. Sending
-- ----------------------------------------------------------------------------------------
create or replace function _telegram_send(p_ws uuid, p_text text) returns bigint
language plpgsql security definer set search_path = public as $$
declare tok text; chat text;
begin
  select telegram_token into tok from private.report_secrets where workspace_id = p_ws;
  select telegram_chat_id into chat from report_settings where workspace_id = p_ws;
  if tok is null or chat is null then raise exception 'The Telegram bot token and group chat id are not set'; end if;
  return net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 15000);
end $$;
revoke all on function _telegram_send(uuid, text) from public;

-- Returns how many messages went out. A scheduled run skips what it already sent for that day.
create or replace function _send_daily_report(p_ws uuid, p_day date, p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; sent int := 0; d uuid;
begin
  for r in select b.book, _daily_report_text(p_ws, p_day, b.book) m
             from unnest(array['all','temple','goshala','books']) with ordinality as b(book, ord) order by b.ord loop
    continue when r.m is null;
    d := null;
    insert into report_deliveries (workspace_id, report_date, book, kind, message)
    values (p_ws, p_day, r.book, p_kind, r.m)
    on conflict (workspace_id, report_date, book) where kind = 'scheduled' do nothing
    returning id into d;
    continue when d is null;
    update report_deliveries set request_id = _telegram_send(p_ws, r.m) where id = d;
    sent := sent + 1;
  end loop;
  return sent;
end $$;
revoke all on function _send_daily_report(uuid, date, text) from public;

-- The 3:30 job: yesterday, India time, for every workspace that has the report switched on.
create or replace function run_daily_reports() returns int
language plpgsql security definer set search_path = public as $$
declare w uuid; total int := 0; yesterday date := (now() at time zone 'Asia/Kolkata')::date - 1;
begin
  for w in select s.workspace_id from report_settings s
            where s.enabled and s.telegram_chat_id is not null
              and exists (select 1 from private.report_secrets t where t.workspace_id = s.workspace_id) loop
    begin
      total := total + _send_daily_report(w, yesterday, 'scheduled');
    exception when others then
      insert into report_deliveries (workspace_id, report_date, kind, message, error) values (w, yesterday, 'scheduled', '(not sent)', sqlerrm);
    end;
  end loop;
  return total;
end $$;
revoke all on function run_daily_reports() from public;

-- "Send this day now", for a missed or corrected day. Not limited to once.
create or replace function send_daily_report_now(p_ws uuid, p_day date) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can send the daily report'; end if;
  return _send_daily_report(p_ws, p_day, 'manual');
end $$;

create or replace function send_daily_report_test(p_ws uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can send the daily report'; end if;
  m := 'Hare Krishna 🙏' || E'\n' || (select name from workspaces where id = p_ws)
    || E' — the daily report is connected.\nFrom tomorrow it arrives here at 3:30 AM with the previous day''s income and expense.';
  insert into report_deliveries (workspace_id, kind, message, request_id) values (p_ws, 'test', m, _telegram_send(p_ws, m));
end $$;

create or replace function _json_text(p text, k text) returns text language plpgsql immutable as $$
begin return p::jsonb->>k; exception when others then return null; end $$;

-- Recent sends with Telegram's answer. pg_net keeps replies for a few hours, so they are copied here
-- the first time they are seen.
create or replace function daily_report_log(p_ws uuid)
returns table (id uuid, created_at timestamptz, kind text, report_date date, book text, status int, error text, by_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not can_manage(p_ws) then raise exception 'Only owners and admins can see what was sent'; end if;
  update report_deliveries d
     set status = r.status_code,
         error = case when r.status_code between 200 and 299 then null
                      else coalesce(nullif(r.error_msg, ''), _json_text(r.content, 'description'), 'HTTP ' || r.status_code) end
    from net._http_response r
   where d.workspace_id = p_ws and d.status is null and d.request_id = r.id
     and (r.status_code is not null or nullif(r.error_msg, '') is not null);
  return query
    select d.id, d.created_at, d.kind, d.report_date, d.book, d.status, d.error, p.full_name
      from report_deliveries d left join profiles p on p.id = d.created_by
     where d.workspace_id = p_ws order by d.created_at desc limit 30;
end $$;

-- ----------------------------------------------------------------------------------------
-- 6. The schedule: 22:00 UTC = 03:30 IST. cron.schedule() replaces a job of the same name.
-- ----------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('daily-report-mangalarti', '0 22 * * *', 'select public.run_daily_reports()');
  end if;
end $$;
