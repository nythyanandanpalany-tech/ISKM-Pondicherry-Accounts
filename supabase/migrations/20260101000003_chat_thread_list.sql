-- The chats screen asks for every thread it may show in one call: the workspace thread
-- (created on first use) plus every private/group thread the signed-in user belongs to.
-- security definer so the lookup can read chat_members for other people in the same thread.
create or replace function list_chat_threads(p_ws uuid) returns setof chat_threads
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_ws) then raise exception 'Not a member'; end if;
  perform ensure_workspace_thread(p_ws);
  return query
    select th.* from chat_threads th
    where (th.kind = 'workspace' and th.workspace_id = p_ws)
       or exists (select 1 from chat_members cm where cm.thread_id = th.id and cm.user_id = auth.uid());
end $$;
