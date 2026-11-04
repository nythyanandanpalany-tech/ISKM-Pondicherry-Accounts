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
