-- =====================================================================
--  009 · Reminders and a due time on tasks
--  Anyone who can see a task can set reminders for themselves; the
--  person who created a task can also remind the assignee. Reminders
--  arrive as notifications (with sound and a desktop alert).
--  With pg_cron (available on Supabase) they also fire while nobody has
--  the app open, so they are waiting in the bell next time. Without it
--  they fire whenever the app is open.
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

alter table public.tasks add column if not exists due_time text
  check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create table if not exists public.reminders (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,  -- who is reminded
  created_by     uuid not null default auth.uid() references public.profiles(id) on delete cascade,  -- who set it
  remind_at      timestamptz not null,
  offset_minutes int check (offset_minutes is null or offset_minutes >= 0),  -- minutes before the due time; null = custom time
  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists reminders_due_idx  on public.reminders (remind_at) where sent_at is null;
create index if not exists reminders_task_idx on public.reminders (task_id);
create index if not exists reminders_user_idx on public.reminders (user_id);

create or replace function public.guard_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.sent_at := null;
  else
    new.created_by := old.created_by; new.task_id := old.task_id; new.user_id := old.user_id;
    if new.remind_at is distinct from old.remind_at then new.sent_at := null; end if;
  end if;
  select * into t from public.tasks where id = new.task_id;
  if t.id is null or not public.can_see_task(t.id) then raise exception 'Task not found.'; end if;
  if new.user_id <> auth.uid()
     and not (t.created_by = auth.uid() and new.user_id = t.assigned_to)
     and not public.is_admin() then
    raise exception 'You can only set reminders for yourself, or for the person you assigned the task to.';
  end if;
  return new;
end $$;
drop trigger if exists reminders_guard on public.reminders;
create trigger reminders_guard before insert or update on public.reminders
  for each row execute function public.guard_reminder();

alter table public.reminders enable row level security;
drop policy if exists rem_read   on public.reminders;
drop policy if exists rem_insert on public.reminders;
drop policy if exists rem_update on public.reminders;
drop policy if exists rem_delete on public.reminders;
create policy rem_read   on public.reminders for select to authenticated using (user_id = auth.uid() or created_by = auth.uid());
create policy rem_insert on public.reminders for insert to authenticated with check (public.my_role() is not null);
create policy rem_update on public.reminders for update to authenticated
  using (user_id = auth.uid() or created_by = auth.uid()) with check (user_id = auth.uid() or created_by = auth.uid());
create policy rem_delete on public.reminders for delete to authenticated using (user_id = auth.uid() or created_by = auth.uid());
revoke all on public.reminders from anon;
grant select, insert, update, delete on public.reminders to authenticated;

-- Turn due reminders into notifications. p_user = null handles everyone
-- (used by the scheduler); otherwise only that person's reminders.
create or replace function public.fire_reminders_for(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; msg text;
begin
  for r in
    select rm.id, rm.user_id, rm.offset_minutes, t.id as task_id, t.title, t.status
    from public.reminders rm join public.tasks t on t.id = rm.task_id
    where rm.sent_at is null and rm.remind_at <= now() and (p_user is null or rm.user_id = p_user)
    order by rm.remind_at
    for update of rm skip locked
  loop
    update public.reminders set sent_at = now() where id = r.id;
    continue when r.status = 'completed';
    msg := '"' || r.title || '" ' || case
      when r.offset_minutes = 0 then 'is due now'
      when r.offset_minutes = 15 then 'is due in 15 minutes'
      when r.offset_minutes = 30 then 'is due in 30 minutes'
      when r.offset_minutes = 60 then 'is due in 1 hour'
      when r.offset_minutes = 120 then 'is due in 2 hours'
      when r.offset_minutes = 1440 then 'is due tomorrow at this time'
      when r.offset_minutes is not null then 'is coming up'
      else '· reminder' end;
    insert into public.notifications (user_id, task_id, type, message) values (r.user_id, r.task_id, 'reminder', msg);
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function public.fire_due_reminders() returns int
language sql security definer set search_path = public as $$ select public.fire_reminders_for(null) $$;
-- What the app calls while it is open: only your own reminders.
create or replace function public.fire_my_reminders() returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 0; end if;
  return public.fire_reminders_for(auth.uid());
end $$;

revoke execute on function public.guard_reminder(), public.fire_reminders_for(uuid), public.fire_due_reminders(), public.fire_my_reminders() from public, anon, authenticated;
grant execute on function public.fire_my_reminders() to authenticated;

-- Run every minute in the background (Supabase includes pg_cron).
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'taskflow-reminders') then
    perform cron.unschedule('taskflow-reminders');
  end if;
  perform cron.schedule('taskflow-reminders', '* * * * *', 'select public.fire_due_reminders()');
exception when others then
  raise notice 'pg_cron is not available (%); reminders will fire while the app is open.', sqlerrm;
end $$;

-- Task guard, now also covering due_time (assignees can't change it).
create or replace function public.guard_task_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare plat public.platforms%rowtype;
begin
  if auth.uid() is null then                        -- SQL editor / server side
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.assigned_to <> auth.uid() and not public.is_manager_or_admin() then
      raise exception 'Members can only create tasks for themselves.';
    end if;
  else
    if auth.uid() <> old.created_by and not public.is_admin() then
      if new.title       is distinct from old.title
         or new.description is distinct from old.description
         or new.priority    is distinct from old.priority
         or new.due_date    is distinct from old.due_date
         or new.links       is distinct from old.links
         or new.platform_id is distinct from old.platform_id
         or new.due_time    is distinct from old.due_time
         or new.assigned_to is distinct from old.assigned_to
         or new.created_by  is distinct from old.created_by then
        raise exception 'This task was assigned to you. You can only update its status.';
      end if;
    end if;
    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to <> auth.uid() and not public.is_manager_or_admin() then
      raise exception 'Only managers can assign tasks to other people.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if new.platform_id is not null and (tg_op = 'INSERT'
       or new.platform_id is distinct from old.platform_id or new.assigned_to is distinct from old.assigned_to) then
    select * into plat from public.platforms where id = new.platform_id;
    if plat.id is null then raise exception 'That platform no longer exists.'; end if;
    if plat.archived and (tg_op = 'INSERT' or new.platform_id is distinct from old.platform_id) then
      raise exception 'The platform "%" was removed. Choose another one.', plat.name;
    end if;
    if plat.department_id is distinct from (select department_id from public.profiles where id = new.assigned_to) then
      raise exception 'The platform "%" belongs to another department than the assignee.', plat.name;
    end if;
  end if;

  new.updated_at := now();
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
