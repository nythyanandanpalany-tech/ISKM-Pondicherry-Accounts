-- Row level security tests for supabase/schema.sql.
-- Run with: npm run test:rls   (see supabase/tests/run.sh for how the database is prepared)
--
-- Every test runs as the `authenticated` role with a JWT subject set, exactly as PostgREST does
-- for a browser request, so the policies are genuinely in force. Setup runs as the superuser,
-- which bypasses RLS on purpose — that is how the fixtures get written.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- ---------------------------------------------------------------- harness
create table if not exists t_results (n serial primary key, name text, pass boolean, detail text);
truncate t_results restart identity;
grant insert, select on t_results to authenticated;
grant usage, select on sequence t_results_n_seq to authenticated;

-- A scalar query's answer must equal `want`.
create or replace function t_eq(p_name text, p_sql text, p_want text) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute p_sql into got;
    if got is not distinct from p_want then insert into t_results(name,pass,detail) values (p_name,true,'');
    else insert into t_results(name,pass,detail) values (p_name,false,format('got %L, wanted %L', got, p_want)); end if;
  exception when others then
    insert into t_results(name,pass,detail) values (p_name,false,'raised: ' || sqlerrm);
  end;
end $$;

-- The statement must be refused (a policy, privilege or constraint stops it).
-- `set constraints all immediate` pulls deferred constraint triggers — the stock guard is one —
-- forward into this savepoint, where they can be caught, instead of firing at commit.
create or replace function t_deny(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    execute 'set constraints all immediate';
    insert into t_results(name,pass,detail) values (p_name,false,'was allowed, but should have been refused');
  exception when others then
    insert into t_results(name,pass,detail) values (p_name,true,'');
  end;
end $$;

-- The statement must succeed, deferred checks included.
create or replace function t_allow(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    execute 'set constraints all immediate';
    insert into t_results(name,pass,detail) values (p_name,true,'');
  exception when others then
    insert into t_results(name,pass,detail) values (p_name,false,'refused: ' || sqlerrm);
  end;
end $$;

-- The statement must touch exactly `want` rows. An UPDATE or DELETE blocked by a USING clause
-- changes nothing rather than raising, so this is how "silently saw no rows" gets asserted.
create or replace function t_rows(p_name text, p_sql text, p_want int) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute p_sql; get diagnostics n = row_count;
    execute 'set constraints all immediate';
    if n = p_want then insert into t_results(name,pass,detail) values (p_name,true,'');
    else insert into t_results(name,pass,detail) values (p_name,false,format('touched %s rows, wanted %s', n, p_want)); end if;
  exception when others then
    insert into t_results(name,pass,detail) values (p_name,false,'raised: ' || sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------- fixtures
\set owner    '''11111111-1111-1111-1111-111111111111'''
\set admin    '''22222222-2222-2222-2222-222222222222'''
\set editor   '''33333333-3333-3333-3333-333333333333'''
\set editor2  '''44444444-4444-4444-4444-444444444444'''
\set viewer   '''55555555-5555-5555-5555-555555555555'''
\set outsider '''66666666-6666-6666-6666-666666666666'''
\set unconf   '''77777777-7777-7777-7777-777777777777'''
\set ws       '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set ws2      '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set e_owner  '''e0000000-0000-0000-0000-000000000001'''
\set e_editor '''e0000000-0000-0000-0000-000000000002'''
\set e_claim  '''e0000000-0000-0000-0000-000000000003'''

reset role;
delete from auth.users;   -- cascades to profiles, which cascades through the workspace tables
delete from storage.objects;

-- profiles rows appear via the on_auth_user_created trigger. The last one never confirmed.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  (:owner,    'owner@temple.org',     now(), '{"full_name":"Owner"}'),
  (:admin,    'admin@temple.org',     now(), '{"full_name":"Admin"}'),
  (:editor,   'editor@temple.org',    now(), '{"full_name":"Editor"}'),
  (:editor2,  'editor2@temple.org',   now(), '{"full_name":"Editor Two"}'),
  (:viewer,   'viewer@temple.org',    now(), '{"full_name":"Viewer"}'),
  (:outsider, 'outsider@temple.org',  now(), '{"full_name":"Outsider"}'),
  (:unconf,   'unconfirmed@temple.org', null, '{"full_name":"Not Confirmed"}');

insert into workspaces (id, name, created_by) values (:ws, 'Test Temple', :owner), (:ws2, 'Other Temple', :outsider);
insert into members (workspace_id, user_id, role, see_all) values
  (:ws, :owner, 'owner', true), (:ws, :admin, 'admin', true),
  (:ws, :editor, 'editor', false), (:ws, :editor2, 'editor', false), (:ws, :viewer, 'viewer', false),
  (:ws2, :outsider, 'owner', true);

insert into categories (id, workspace_id, name, kind) values ('c0000000-0000-0000-0000-000000000001', :ws, 'Test Cat', 'expense');
insert into people (id, workspace_id, name) values ('d0000000-0000-0000-0000-000000000001', :ws, 'Ramesh');
insert into entries (id, workspace_id, type, entry_date, amount, created_by) values
  (:e_owner,  :ws, 'expense', current_date, 100, :owner),
  (:e_editor, :ws, 'expense', current_date, 200, :editor);
insert into entries (id, workspace_id, type, entry_date, amount, created_by, claim_status) values
  (:e_claim, :ws, 'expense', current_date, 300, :editor, 'approved');
insert into bank_transactions (workspace_id, txn_date, amount) values (:ws, current_date, 100);
insert into stores (id, workspace_id, name) values ('50000000-0000-0000-0000-000000000001', :ws, 'Annadanam Store');
insert into store_items (id, workspace_id, store_id, name, unit) values
  ('51000000-0000-0000-0000-000000000001', :ws, '50000000-0000-0000-0000-000000000001', 'Rice', 'kg');
insert into stock_moves (workspace_id, store_item_id, direction, qty, created_by) values
  (:ws, '51000000-0000-0000-0000-000000000001', 'in', 30, :owner);

-- Photos: 3 000 bytes in our workspace, half a megabyte in somebody else's.
insert into storage.buckets (id, name, public) values ('receipts','receipts',false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, metadata) values
  ('receipts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/one.webp', '{"size":1000}'),
  ('receipts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/two.webp', '{"size":2000}'),
  ('receipts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/other.webp', '{"size":500000}');

-- Each of these puts a JWT subject where the policies look for it, then switches into the role
-- that makes row level security apply at all — the same two things PostgREST does per request.
\set as_owner    'reset role; set request.jwt.claims = ''{"sub":"11111111-1111-1111-1111-111111111111"}''; set role authenticated;'
\set as_admin    'reset role; set request.jwt.claims = ''{"sub":"22222222-2222-2222-2222-222222222222"}''; set role authenticated;'
\set as_editor   'reset role; set request.jwt.claims = ''{"sub":"33333333-3333-3333-3333-333333333333"}''; set role authenticated;'
\set as_viewer   'reset role; set request.jwt.claims = ''{"sub":"55555555-5555-5555-5555-555555555555"}''; set role authenticated;'
\set as_outsider 'reset role; set request.jwt.claims = ''{"sub":"66666666-6666-6666-6666-666666666666"}''; set role authenticated;'
\set as_unconf   'reset role; set request.jwt.claims = ''{"sub":"77777777-7777-7777-7777-777777777777"}''; set role authenticated;'

-- ================================================================ entries
:as_owner
select t_eq('owner reads every entry in the workspace', 'select count(*) from entries', '3');
:as_editor
select t_eq('editor reads only their own entries', 'select count(*) from entries', '2');
select t_eq('editor cannot read the owner''s entry by id',
  'select count(*) from entries where id = ''e0000000-0000-0000-0000-000000000001''', '0');
:as_viewer
select t_eq('viewer without see_all reads no one else''s entries', 'select count(*) from entries', '0');
:as_outsider
select t_eq('outsider reads no entries of a workspace they are not in', 'select count(*) from entries', '0');

:as_editor
select t_allow('editor may add an entry of their own',
  'insert into entries (workspace_id, type, entry_date, amount, created_by) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''expense'', current_date, 10, ''33333333-3333-3333-3333-333333333333'')');
select t_deny('editor cannot add an entry in someone else''s name',
  'insert into entries (workspace_id, type, entry_date, amount, created_by) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''expense'', current_date, 10, ''11111111-1111-1111-1111-111111111111'')');
select t_deny('editor cannot add an entry to a workspace they are not in',
  'insert into entries (workspace_id, type, entry_date, amount, created_by) values (''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'', ''expense'', current_date, 10, ''33333333-3333-3333-3333-333333333333'')');
select t_rows('editor cannot edit another member''s entry',
  'update entries set amount = 999 where id = ''e0000000-0000-0000-0000-000000000001''', 0);
select t_rows('editor cannot edit their own entry once the claim is approved',
  'update entries set amount = 999 where id = ''e0000000-0000-0000-0000-000000000003''', 0);
select t_deny('editor cannot approve their own claim',
  'update entries set claim_status = ''approved'' where id = ''e0000000-0000-0000-0000-000000000002''');
select t_rows('editor cannot delete another member''s entry',
  'delete from entries where id = ''e0000000-0000-0000-0000-000000000001''', 0);
:as_owner
select t_allow('owner may approve a claim',
  'update entries set claim_status = ''approved'' where id = ''e0000000-0000-0000-0000-000000000002''');

-- ================================================================ audit log
:as_owner
select t_eq('the update trigger wrote history rows', 'select count(*) > 0 from entry_log', 'true');
:as_editor
select t_eq('an editor cannot read the history', 'select count(*) from entry_log', '0');
:as_outsider
select t_eq('an outsider cannot read the history', 'select count(*) from entry_log', '0');

-- ================================================================ invitations (the hijack)
:as_editor
select t_deny('a member cannot change the email on their own profile',
  'update profiles set email = ''owner@temple.org'' where id = ''33333333-3333-3333-3333-333333333333''');
select t_allow('a member may still change their own name',
  'update profiles set full_name = ''Editor Renamed'' where id = ''33333333-3333-3333-3333-333333333333''');
select t_rows('a member cannot touch someone else''s profile',
  'update profiles set full_name = ''Hijacked'' where id = ''11111111-1111-1111-1111-111111111111''', 0);
select t_deny('an editor cannot invite anybody',
  'select add_member(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''outsider@temple.org'', ''editor'')');

-- Even with a spoofed profiles.email, the invitation must resolve through auth.users. Forced in
-- as the superuser, because the grant above is what stops a member doing it themselves.
reset role;
update profiles set email = 'owner@temple.org' where id = :outsider;
:as_admin
select t_allow('admin invites by email',
  'select add_member(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''owner@temple.org'', ''viewer'')');
reset role;
select t_eq('a spoofed profile email does not redirect the invitation',
  'select count(*) from members where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'' and user_id = ''66666666-6666-6666-6666-666666666666''', '0');
select t_eq('the owner''s own membership was not demoted by that invitation',
  'select role from members where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'' and user_id = ''11111111-1111-1111-1111-111111111111''', 'owner');
update profiles set email = 'outsider@temple.org' where id = :outsider;

:as_admin
select t_deny('nobody can be invited straight to owner',
  'select add_member(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''editor2@temple.org'', ''owner'')');
select t_deny('an unconfirmed address cannot be invited',
  'select add_member(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''unconfirmed@temple.org'', ''editor'')');
select t_deny('an address with no account cannot be invited',
  'select add_member(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''nobody@nowhere.org'', ''editor'')');
-- Refused by the policy's WITH CHECK rather than filtered out, so this one does raise.
select t_deny('an admin cannot promote a member to owner directly',
  'update members set role = ''owner'' where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'' and user_id = ''33333333-3333-3333-3333-333333333333''');
:as_outsider
select t_eq('an outsider cannot read the member list', 'select count(*) from members where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '0');

-- ================================================================ workspaces
:as_unconf
select t_deny('an unconfirmed email cannot create a workspace', 'select create_workspace(''Sneaky Books'')');
:as_editor
-- A DELETE a policy hides simply removes nothing; it does not raise. Count the rows, not the error.
select t_rows('an editor cannot delete the workspace',
  'delete from workspaces where id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', 0);
select t_eq('the workspace is still there afterwards',
  'select count(*) from workspaces where id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '1');
select t_rows('an editor cannot rename the workspace',
  'update workspaces set name = ''Renamed'' where id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', 0);
:as_outsider
select t_eq('an outsider cannot see the workspace', 'select count(*) from workspaces where id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '0');

-- ================================================================ storage meter
:as_owner
select t_eq('the storage meter counts only the workspaces I manage', 'select storage_usage_total()', '3000');
:as_editor
select t_deny('an editor cannot read the storage meter', 'select storage_usage_total()');
:as_owner
select t_eq('a member sees only their own workspace''s photos',
  'select count(*) from storage.objects where bucket_id = ''receipts''', '2');
:as_outsider
select t_eq('an outsider sees none of our photos',
  'select count(*) from storage.objects where name like ''aaaaaaaa%''', '0');
reset role;
select t_eq('the photo bucket refuses oversized files',
  'select file_size_limit from storage.buckets where id = ''receipts''', '3145728');
select t_eq('the photo bucket accepts only images and PDFs',
  'select ''application/zip'' = any(allowed_mime_types) from storage.buckets where id = ''receipts''', 'false');

-- ================================================================ store
:as_editor
select t_deny('stock cannot be taken out beyond what is in stock',
  'insert into stock_moves (workspace_id, store_item_id, direction, qty, created_by) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''51000000-0000-0000-0000-000000000001'', ''out'', 999, ''33333333-3333-3333-3333-333333333333'')');
select t_allow('stock may be taken out within what is in stock',
  'insert into stock_moves (workspace_id, store_item_id, direction, qty, created_by) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''51000000-0000-0000-0000-000000000001'', ''out'', 5, ''33333333-3333-3333-3333-333333333333'')');
:as_owner
select t_deny('a stock-in that later stock-outs depend on cannot be deleted',
  'delete from stock_moves where direction = ''in''');
select t_eq('the stock view totals the movements', 'select qty from store_stock where store_item_id = ''51000000-0000-0000-0000-000000000001''', '25');

-- ================================================================ bank
:as_editor
select t_eq('an editor cannot read the bank statement', 'select count(*) from bank_transactions', '0');
select t_deny('an editor cannot add a bank row',
  'insert into bank_transactions (workspace_id, txn_date, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', current_date, 5)');
:as_owner
select t_eq('an owner can read the bank statement', 'select count(*) from bank_transactions', '1');

-- ================================================================ feedback
:as_editor
select t_allow('anyone may send feedback',
  'insert into feedback (user_id, kind, subject, body) values (''33333333-3333-3333-3333-333333333333'', ''bug'', ''Short subject'', ''Body'')');
select t_deny('an over-long feedback subject is refused',
  'insert into feedback (user_id, kind, subject, body) values (''33333333-3333-3333-3333-333333333333'', ''bug'', repeat(''x'', 201), ''Body'')');
select t_deny('feedback cannot be sent in someone else''s name',
  'insert into feedback (user_id, kind, subject, body) values (''11111111-1111-1111-1111-111111111111'', ''bug'', ''Not mine'', ''Body'')');
:as_owner
select t_eq('feedback is private to whoever sent it', 'select count(*) from feedback', '0');

-- ================================================================ vouchers
-- Dates are fixed in 2031 so the expected numbers do not depend on the day the tests run
-- (the fixtures above are dated current_date). Financial year: April–March.
reset role;
create or replace function t_v(p_type text, p_date text, p_mode text, p_note text, p_by text, p_extra_cols text default '', p_extra_vals text default '') returns text
language sql as $$
  select format('insert into entries (workspace_id, type, entry_date, amount, payment_mode, note, created_by%s) values (%L, %L, %L, 10, %L, %L, %L%s)',
    p_extra_cols, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_type, p_date, p_mode, p_note, p_by, p_extra_vals) $$;
create or replace function t_no(p_note text) returns text language sql as $$
  select format('select voucher_no from entries where note = %L', p_note) $$;
insert into categories (id, workspace_id, name, kind) values ('c0000000-0000-0000-0000-000000000002', :ws, 'Second Cat', 'expense');

:as_editor
select t_allow('an expense paid by UPI becomes a bank voucher', t_v('expense', '2031-01-15', 'UPI', 'v-bv1', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...numbered from the financial year, type, month and serial', t_no('v-bv1'), '2030-2031/BV/01/V001');
select t_allow('a second bank voucher in the month', t_v('expense', '2031-01-20', 'Bank Transfer', 'v-bv2', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...takes the next serial', t_no('v-bv2'), '2030-2031/BV/01/V002');
select t_allow('a cash expense', t_v('expense', '2031-01-16', 'Cash', 'v-cv1', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is a cash voucher with its own serial', t_no('v-cv1'), '2030-2031/CV/01/V001');
select t_allow('cash income', t_v('income', '2031-01-17', 'Cash', 'v-cr1', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is a cash receipt', t_no('v-cr1'), '2030-2031/CR/01/V001');
select t_allow('income by UPI', t_v('income', '2031-01-18', 'UPI', 'v-br1', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is a bank receipt', t_no('v-br1'), '2030-2031/BR/01/V001');
select t_allow('a cheque expense', t_v('expense', '2031-01-19', 'Cheque', 'v-bv-chq', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...goes through the bank, so it is a bank voucher', 'select voucher_type from entries where note = ''v-bv-chq''', 'BV');
select t_allow('the next month', t_v('expense', '2031-02-03', 'UPI', 'v-bv-feb', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...restarts the serial', t_no('v-bv-feb'), '2030-2031/BV/02/V001');
select t_allow('the last day of the financial year', t_v('expense', '2031-03-31', 'UPI', 'v-bv-mar', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is still in 2030-2031', t_no('v-bv-mar'), '2030-2031/BV/03/V001');
select t_allow('the first day of the next financial year', t_v('expense', '2031-04-01', 'UPI', 'v-bv-apr', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...starts 2031-2032', t_no('v-bv-apr'), '2031-2032/BV/04/V001');
select t_allow('an entry from before the module starts', t_v('expense', '2026-10-31', 'UPI', 'v-old', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...gets no voucher number', 'select voucher_no is null and voucher_type is null from entries where note = ''v-old''', 'true');
select t_allow('an entry on the first day', t_v('expense', '2026-11-01', 'Cash', 'v-first', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is a voucher', 'select voucher_no like ''2026-2027/CV/11/V%'' from entries where note = ''v-first''', 'true');
select t_allow('a client that tries to choose its own number', t_v('expense', '2031-05-02', 'UPI', 'v-hack', '33333333-3333-3333-3333-333333333333', ', voucher_no, voucher_seq, voucher_type', ', ''HACK'', 99, ''CV'''));
select t_eq('  ...gets the real one anyway', t_no('v-hack'), '2031-2032/BV/05/V001'::text);
-- Serials are padded to three digits but never truncated past 999.
reset role;
insert into voucher_counters (workspace_id, vfy, vkind, vmonth, last) values (:ws, '2031-2032', 'CR', 7, 998);
:as_editor
select t_allow('the 999th receipt of a month', t_v('income', '2031-07-05', 'Cash', 'v-999', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is V999', t_no('v-999'), '2031-2032/CR/07/V999');
select t_allow('the 1000th', t_v('income', '2031-07-06', 'Cash', 'v-1000', '33333333-3333-3333-3333-333333333333'));
select t_eq('  ...is V1000, not V100', t_no('v-1000'), '2031-2032/CR/07/V1000');

:as_owner
select t_rows('the owner cannot overwrite a voucher number', 'update entries set voucher_no = ''HACK'', voucher_seq = 7 where note = ''v-bv1''', 1);
select t_eq('  ...it is unchanged', t_no('v-bv1'), '2030-2031/BV/01/V001');
select t_allow('editing the amount', 'update entries set amount = 55 where note = ''v-bv1''');
select t_eq('  ...keeps the number', t_no('v-bv1'), '2030-2031/BV/01/V001');
select t_allow('paying in a different way (cash becomes UPI)', 'update entries set payment_mode = ''UPI'' where note = ''v-cv1''');
select t_eq('  ...moves it to a bank voucher with the next serial', t_no('v-cv1'), '2030-2031/BV/01/V004');
select t_eq('  ...and the old number stays in the history', 'select count(*) from entry_log where snapshot->>''voucher_no'' = ''2030-2031/CV/01/V001''', '1');
select t_allow('changing the date to another month', 'update entries set entry_date = ''2031-02-10'' where note = ''v-bv2''');
select t_eq('  ...moves it into that month''s series', t_no('v-bv2'), '2030-2031/BV/02/V002');
select t_allow('deleting a voucher', 'delete from entries where note = ''v-bv-chq''');
select t_allow('a new bank voucher after a delete', t_v('expense', '2031-01-25', 'UPI', 'v-after-delete', '11111111-1111-1111-1111-111111111111'));
select t_eq('  ...does not reuse a number', t_no('v-after-delete'), '2030-2031/BV/01/V005');
select t_eq('two numbers are never the same', 'select count(*) - count(distinct voucher_no) from entries where voucher_no is not null', '0');
select t_allow('moving an entry back before the start', 'update entries set entry_date = ''2026-10-01'' where note = ''v-first''');
select t_eq('  ...drops its voucher number', 'select voucher_no is null from entries where note = ''v-first''', 'true');

-- A self-voucher: no bill exists. "Bill promised, photo not yet uploaded" is a different state.
select t_allow('an expense with no bill', t_v('expense', '2031-06-01', 'Cash', 'v-nobill', '11111111-1111-1111-1111-111111111111', ', receipt_available', ', false'));
select t_eq('  ...is flagged no-bill', 'select no_bill from entries where note = ''v-nobill''', 'true');
select t_allow('an expense whose bill is still to come', t_v('expense', '2031-06-02', 'Cash', 'v-tocome', '11111111-1111-1111-1111-111111111111', ', receipt_available', ', true'));
select t_eq('  ...is not flagged no-bill', 'select no_bill from entries where note = ''v-tocome''', 'false');
select t_allow('an expense with a bill photo', t_v('expense', '2031-06-03', 'Cash', 'v-billed', '11111111-1111-1111-1111-111111111111', ', receipt_available, bill_path', ', false, ''x/y.jpg'''));
select t_eq('  ...is not flagged no-bill', 'select no_bill from entries where note = ''v-billed''', 'false');
select t_eq('income is never flagged no-bill', 'select count(*) from entries where type = ''income'' and no_bill', '0');

-- Journal vouchers
select t_allow('the owner may add a journal voucher (move between heads)',
  t_v('journal', '2031-01-22', 'Journal', 'v-jv1', '11111111-1111-1111-1111-111111111111', ', jv_kind, dr_category_id, cr_category_id', ', ''transfer'', ''c0000000-0000-0000-0000-000000000001'', ''c0000000-0000-0000-0000-000000000002'''));
select t_eq('  ...it is numbered JV', t_no('v-jv1'), '2030-2031/JV/01/V001');
select t_allow('a bill not yet paid (credits Outstanding expenses, so no credit head)',
  t_v('journal', '2031-01-23', 'Journal', 'v-jv2', '11111111-1111-1111-1111-111111111111', ', jv_kind, dr_category_id', ', ''unpaid_bill'', ''c0000000-0000-0000-0000-000000000001'''));
select t_eq('  ...next serial', t_no('v-jv2'), '2030-2031/JV/01/V002');
select t_deny('a journal needs a debit head',
  t_v('journal', '2031-01-24', 'Journal', 'v-bad1', '11111111-1111-1111-1111-111111111111', ', jv_kind, cr_category_id', ', ''correction'', ''c0000000-0000-0000-0000-000000000002'''));
select t_deny('a transfer cannot debit and credit the same head',
  t_v('journal', '2031-01-24', 'Journal', 'v-bad2', '11111111-1111-1111-1111-111111111111', ', jv_kind, dr_category_id, cr_category_id', ', ''transfer'', ''c0000000-0000-0000-0000-000000000001'', ''c0000000-0000-0000-0000-000000000001'''));
select t_deny('a transfer needs a credit head',
  t_v('journal', '2031-01-24', 'Journal', 'v-bad3', '11111111-1111-1111-1111-111111111111', ', jv_kind, dr_category_id', ', ''transfer'', ''c0000000-0000-0000-0000-000000000001'''));
select t_deny('an unpaid bill has no credit head of its own',
  t_v('journal', '2031-01-24', 'Journal', 'v-bad4', '11111111-1111-1111-1111-111111111111', ', jv_kind, dr_category_id, cr_category_id', ', ''unpaid_bill'', ''c0000000-0000-0000-0000-000000000001'', ''c0000000-0000-0000-0000-000000000002'''));
select t_deny('a journal needs a kind',
  t_v('journal', '2031-01-24', 'Journal', 'v-bad5', '11111111-1111-1111-1111-111111111111', ', dr_category_id', ', ''c0000000-0000-0000-0000-000000000001'''));
select t_deny('a journal needs a narration saying why',
  'insert into entries (workspace_id, type, entry_date, amount, payment_mode, created_by, jv_kind, dr_category_id) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''journal'', ''2031-01-24'', 10, ''Journal'', ''11111111-1111-1111-1111-111111111111'', ''unpaid_bill'', ''c0000000-0000-0000-0000-000000000001'')');
select t_deny('an expense cannot carry journal fields',
  t_v('expense', '2031-01-24', 'Cash', 'v-bad6', '11111111-1111-1111-1111-111111111111', ', dr_category_id', ', ''c0000000-0000-0000-0000-000000000001'''));
select t_deny('a journal of nothing is refused',
  'insert into entries (workspace_id, type, entry_date, amount, payment_mode, created_by, jv_kind, dr_category_id) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''journal'', ''2031-01-24'', 0, ''Journal'', ''11111111-1111-1111-1111-111111111111'', ''unpaid_bill'', ''c0000000-0000-0000-0000-000000000001'')');
select t_deny('a head with journal postings cannot be deleted', 'delete from categories where id = ''c0000000-0000-0000-0000-000000000002''');
select t_eq('a journal voucher does not count as cash or bank', 'select count(*) from entries where type = ''journal'' and voucher_type <> ''JV''', '0');
:as_admin
select t_allow('an admin may add a journal voucher',
  t_v('journal', '2031-01-26', 'Journal', 'v-jv3', '22222222-2222-2222-2222-222222222222', ', jv_kind, dr_category_id, cr_category_id', ', ''correction'', ''c0000000-0000-0000-0000-000000000001'', ''c0000000-0000-0000-0000-000000000002'''));
:as_editor
select t_deny('an editor cannot add a journal voucher',
  t_v('journal', '2031-01-27', 'Journal', 'v-jv-editor', '33333333-3333-3333-3333-333333333333', ', jv_kind, dr_category_id, cr_category_id', ', ''transfer'', ''c0000000-0000-0000-0000-000000000001'', ''c0000000-0000-0000-0000-000000000002'''));
select t_deny('an editor cannot turn their own entry into a journal',
  'update entries set type = ''journal'', jv_kind = ''correction'', dr_category_id = ''c0000000-0000-0000-0000-000000000001'', cr_category_id = ''c0000000-0000-0000-0000-000000000002'' where note = ''v-br1''');
:as_owner
select t_allow('the owner may delete a journal voucher', 'delete from entries where note = ''v-jv3''');
-- The voucher counters are the database's own business.
:as_editor
select t_eq('an editor cannot read the voucher counters', 'select count(*) from voucher_counters', '0');
select t_deny('an editor cannot write the voucher counters', 'insert into voucher_counters (workspace_id, vfy, vkind, vmonth, last) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''2030-2031'', ''BV'', 1, 0)');
select t_rows('an editor cannot reset a counter', 'update voucher_counters set last = 0', 0);
select t_deny('an editor cannot call the numbering trigger as a function', 'select assign_voucher()');
:as_viewer
select t_eq('a viewer reads nothing from the voucher counters', 'select count(*) from voucher_counters', '0');
reset role;
select t_eq('numbering starts on 1 November 2026 unless a workspace says otherwise', 'select count(*) from workspaces where vouchers_from is distinct from date ''2026-11-01''', '0');
update workspaces set vouchers_from = null where id = :ws2;
insert into entries (workspace_id, type, entry_date, amount, payment_mode, created_by) values (:ws2, 'expense', '2031-01-15', 5, 'UPI', :outsider);
select t_eq('a workspace with numbering switched off gets no numbers', 'select count(*) from entries where workspace_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'' and voucher_no is not null', '0');
select t_eq('  ...and no counters', 'select count(*) from voucher_counters where workspace_id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''', '0');

-- ================================================================ books and reports
reset role;
insert into categories (id, workspace_id, name, kind) values
  ('c0000000-0000-0000-0000-0000000000a1', :ws, 'Gaushala', 'expense'),
  ('c0000000-0000-0000-0000-0000000000a2', :ws, 'Purchase of books', 'expense'),
  ('c0000000-0000-0000-0000-0000000000a3', :ws, 'Construction – Building', 'expense'),
  ('c0000000-0000-0000-0000-0000000000a4', :ws, 'Annadanam', 'expense'),
  ('c0000000-0000-0000-0000-0000000000a5', :ws, 'Fixed assets purchased', 'expense');
select t_eq('a Gaushala head goes to the Goshala book', 'select book from categories where id = ''c0000000-0000-0000-0000-0000000000a1''', 'goshala');
select t_eq('Purchase of books goes to the Books book', 'select book from categories where id = ''c0000000-0000-0000-0000-0000000000a2''', 'books');
select t_eq('Construction is capital and has its own section',
  'select is_capital and section = ''construction'' from categories where id = ''c0000000-0000-0000-0000-0000000000a3''', 'true');
select t_eq('fixed assets are capital, but not Construction',
  'select is_capital and section is null from categories where id = ''c0000000-0000-0000-0000-0000000000a5''', 'true');
select t_eq('everything else is Temple and not capital',
  'select book = ''temple'' and not is_capital and section is null from categories where id = ''c0000000-0000-0000-0000-0000000000a4''', 'true');
select t_eq('heads that existed before keep the Temple book', 'select book from categories where id = ''c0000000-0000-0000-0000-000000000001''', 'temple');
:as_admin
select t_allow('an admin may move a head to another book', 'update categories set book = ''goshala'' where id = ''c0000000-0000-0000-0000-0000000000a4''');
select t_eq('  ...and the change sticks', 'select book from categories where id = ''c0000000-0000-0000-0000-0000000000a4''', 'goshala');
select t_allow('  ...and back', 'update categories set book = ''temple'' where id = ''c0000000-0000-0000-0000-0000000000a4''');
select t_deny('a head cannot be in a fourth book', 'update categories set book = ''annex'' where id = ''c0000000-0000-0000-0000-0000000000a4''');
:as_editor
select t_rows('an editor cannot change a head''s book', 'update categories set book = ''goshala'' where id = ''c0000000-0000-0000-0000-0000000000a4''', 0);

-- Bank accounts
reset role;
insert into bank_accounts (id, workspace_id, name) values
  ('b1000000-0000-0000-0000-000000000001', :ws, 'Ujjivan Small Finance Bank'),
  ('b1000000-0000-0000-0000-000000000002', :ws2, 'Somebody else''s bank');
:as_editor
select t_eq('a member can see their workspace''s bank accounts', 'select count(*) from bank_accounts', '1');
select t_deny('an editor cannot add a bank account', 'insert into bank_accounts (workspace_id, name) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''IDFC FIRST'')');
:as_owner
select t_allow('the owner may add a bank account', 'insert into bank_accounts (workspace_id, name) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''IDFC FIRST'')');
select t_deny('two bank accounts cannot share a name', 'insert into bank_accounts (workspace_id, name) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''IDFC FIRST'')');
:as_outsider
select t_eq('an outsider cannot see our bank accounts', 'select count(*) from bank_accounts where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '0');
:as_editor
select t_allow('a bank voucher can say which bank it went through',
  t_v('expense', '2031-09-01', 'UPI', 'b-bank', '33333333-3333-3333-3333-333333333333', ', bank_account_id', ', ''b1000000-0000-0000-0000-000000000001'''));
select t_eq('  ...and it is kept', 'select bank_account_id::text from entries where note = ''b-bank''', 'b1000000-0000-0000-0000-000000000001');
select t_deny('a voucher cannot use another workspace''s bank account',
  t_v('expense', '2031-09-02', 'UPI', 'b-bank2', '33333333-3333-3333-3333-333333333333', ', bank_account_id', ', ''b1000000-0000-0000-0000-000000000002'''));
select t_allow('a cash voucher with a bank account chosen',
  t_v('expense', '2031-09-03', 'Cash', 'b-cash', '33333333-3333-3333-3333-333333333333', ', bank_account_id', ', ''b1000000-0000-0000-0000-000000000001'''));
select t_eq('  ...forgets it, since no bank was involved', 'select bank_account_id is null from entries where note = ''b-cash''', 'true');

-- Paying a bill that a journal already booked
:as_owner
select t_allow('an unpaid-bill journal for 100',
  'insert into entries (id, workspace_id, type, entry_date, amount, payment_mode, note, created_by, jv_kind, dr_category_id) values (''e1000000-0000-0000-0000-000000000001'', ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''journal'', ''2031-09-05'', 100, ''Journal'', ''v-jv-unpaid'', ''11111111-1111-1111-1111-111111111111'', ''unpaid_bill'', ''c0000000-0000-0000-0000-000000000001'')');
-- (t_pay builds an expense of a chosen amount that settles the journal above)
reset role;
create or replace function t_pay(p_note text, p_amount numeric, p_by text, p_settles text default 'e1000000-0000-0000-0000-000000000001', p_type text default 'expense') returns text
language sql as $$
  select format('insert into entries (workspace_id, type, entry_date, amount, payment_mode, note, created_by, settles_entry_id) values (%L, %L, ''2031-09-10'', %s, ''UPI'', %L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_type, p_amount, p_note, p_by, p_settles) $$;
:as_owner
select t_allow('a payment of 60 against it', t_pay('p-60', 60, '11111111-1111-1111-1111-111111111111'));
select t_deny('a second payment of 60 would be more than the 100 owed', t_pay('p-60b', 60, '11111111-1111-1111-1111-111111111111'));
select t_allow('the remaining 40 can be paid', t_pay('p-40', 40, '11111111-1111-1111-1111-111111111111'));
select t_deny('once it is all paid, nothing more can be settled', t_pay('p-1', 1, '11111111-1111-1111-1111-111111111111'));
select t_deny('the journal cannot be cut below what has been paid', 'update entries set amount = 50 where id = ''e1000000-0000-0000-0000-000000000001''');
select t_deny('a journal with payments against it cannot be deleted', 'delete from entries where id = ''e1000000-0000-0000-0000-000000000001''');
select t_deny('income cannot settle a bill', t_pay('p-inc', 1, '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'income'));
select t_deny('an ordinary expense is not a bill to settle', t_pay('p-bad', 1, '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001'));
select t_deny('a payment cannot point at nothing real', t_pay('p-ghost', 1, '11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-0000000000ff'));
select t_allow('a payment can be edited down', 'update entries set amount = 30 where note = ''p-40''');
select t_allow('  ...which frees 10 to pay again', t_pay('p-10', 10, '11111111-1111-1111-1111-111111111111'));
:as_editor
select t_deny('an editor cannot settle a bill', t_pay('p-ed', 5, '33333333-3333-3333-3333-333333333333'));

-- Opening balances
:as_editor
select t_eq('an editor cannot read opening balances', 'select count(*) from opening_balances', '0');
select t_deny('an editor cannot set opening balances', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''temple'', ''cash'', 5)');
:as_owner
select t_allow('the owner may set an opening balance', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''temple'', ''cash'', 5000)');
select t_allow('  ...for a bank account', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''temple'', ''bank:b1000000-0000-0000-0000-000000000001'', -250.50)');
select t_allow('  ...for a head', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''goshala'', ''head:c0000000-0000-0000-0000-0000000000a1'', 120)');
select t_deny('one balance per account', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''temple'', ''cash'', 1)');
select t_deny('an account the books do not have', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''temple'', ''petty_cash'', 1)');
select t_deny('a book that does not exist', 'insert into opening_balances (workspace_id, book, account, amount) values (''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''annex'', ''cash'', 1)');
:as_outsider
select t_eq('an outsider cannot read our opening balances', 'select count(*) from opening_balances', '0');

-- ================================================================ deleting a workspace
reset role;

select t_eq('the workspace has history to lose', 'select count(*) > 0 from entry_log where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', 'true');
:as_owner
select t_allow('the owner may delete the workspace',
  'delete from workspaces where id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''');
reset role;
select t_eq('deleting a workspace takes its entries with it',
  'select count(*) from entries where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '0');
select t_eq('deleting a workspace takes its history with it',
  'select count(*) from entry_log where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '0');
select t_eq('deleting a workspace takes its members with it',
  'select count(*) from members where workspace_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''', '0');

-- ---------------------------------------------------------------- report
reset role;
\pset tuples_only off
\pset format aligned
\echo ''
select case when pass then 'ok' else 'FAIL' end as result, name as test, detail as why from t_results order by n;
\echo ''
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed, count(*) as total from t_results;
\echo ''
-- Make the shell exit non-zero if anything failed, so CI notices.
do $$
declare bad int;
begin
  select count(*) into bad from t_results where not pass;
  if bad > 0 then raise exception '% test(s) failed', bad; end if;
end $$;
\echo 'All row level security tests passed.'
