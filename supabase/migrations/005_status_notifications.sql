-- =====================================================================
--  005 · Notify the person who assigned a task on EVERY status change
--  (Not started, In progress, On hold, Completed), not only on
--  completion and hold. Safe to run more than once. Included in schema.sql.
-- =====================================================================

create or replace function public.notify_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  label text;
begin
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    if new.assigned_to <> new.created_by then
      insert into public.notifications (user_id, task_id, type, message)
      values (new.assigned_to, new.id, 'assigned', coalesce(who, 'Someone') || ' assigned you "' || new.title || '"');
    end if;
    return new;
  end if;

  -- Status changed by someone other than the person who assigned it → tell them.
  if new.status is distinct from old.status and auth.uid() is not null and auth.uid() <> new.created_by then
    label := case new.status
      when 'completed'   then ' completed "' || new.title || '"'
      when 'on_hold'     then ' put "' || new.title || '" on hold'
      when 'in_progress' then ' started working on "' || new.title || '"' ||
                              case when old.status = 'on_hold' then ' again (resumed from on hold)'
                                   when old.status = 'completed' then ' again (reopened)' else '' end
      when 'not_started' then ' moved "' || new.title || '" back to not started'
    end;
    insert into public.notifications (user_id, task_id, type, message)
    values (new.created_by, new.id, new.status::text, coalesce(who, 'Someone') || label);
  end if;

  -- The assigner changed the status of a task they gave someone → tell the assignee.
  if new.status is distinct from old.status and auth.uid() = new.created_by and new.assigned_to <> new.created_by then
    insert into public.notifications (user_id, task_id, type, message)
    values (new.assigned_to, new.id, new.status::text,
            coalesce(who, 'Someone') || ' changed "' || new.title || '" to ' ||
            case new.status when 'completed' then 'Completed' when 'on_hold' then 'On hold'
                            when 'in_progress' then 'In progress' else 'Not started' end);
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to <> new.created_by then
    insert into public.notifications (user_id, task_id, type, message)
    values (new.assigned_to, new.id, 'assigned', coalesce(who, 'Someone') || ' assigned you "' || new.title || '"');
  end if;
  return new;
end $$;

revoke execute on function public.notify_task_change() from public, anon;
