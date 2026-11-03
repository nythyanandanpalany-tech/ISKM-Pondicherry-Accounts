-- Storage meter for the free plan (1 GB of files). Run after 002_store_chats.sql.
create or replace function storage_usage_total() returns bigint
language plpgsql security definer set search_path = public, storage as $$
begin
  if not exists (select 1 from members where user_id = auth.uid() and role in ('owner','admin')) then
    raise exception 'Only owners and admins can see storage usage';
  end if;
  return coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'receipts'), 0);
end $$;
