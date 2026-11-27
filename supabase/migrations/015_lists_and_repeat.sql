-- =====================================================================
--  015 · To-do lists and repeating tasks
--  * To-do lists: make several named lists (like Google Tasks). Private
--    to each person, like the rest of To-do.
--  * Repeating tasks: a task can repeat every day, every weekday, every
--    week or every month. When it is completed, the database creates the
--    next one (same title, details, person, platform and reminders) with
--    the next due date.
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

-- ---------- to-do lists ----------
create table if not exists public.todo_lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  position   double precision not null default extract(epoch from now()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists todo_lists_user_idx on public.todo_lists (user_id, position);
alter table public.todos add column if not exists list_id uuid references public.todo_lists(id) on delete cascade;
create index if not exists todos_list_idx on public.todos (list_id);

drop trigger if exists todo_lists_stamp on public.todo_lists;
create trigger todo_lists_stamp before insert or update on public.todo_lists for each row execute function public.stamp_personal_row();

-- A to-do can only go into one of your own lists.
create or replace function public.check_todo_list() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.list_id is not null and not exists (select 1 from public.todo_lists l where l.id = new.list_id and l.user_id = new.user_id) then
    raise exception 'List not found.';
  end if;
  return new;
end $$;
drop trigger if exists todos_check_list on public.todos;
create trigger todos_check_list before insert or update of list_id on public.todos for each row execute function public.check_todo_list();

alter table public.todo_lists enable row level security;
drop policy if exists todo_lists_own on public.todo_lists;
create policy todo_lists_own on public.todo_lists for all to authenticated
  using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
revoke all on public.todo_lists from anon;
grant select, insert, update, delete on public.todo_lists to authenticated;
revoke execute on function public.check_todo_list() from public, anon, authenticated;

-- ---------- repeating tasks ----------
alter table public.tasks add column if not exists repeat text check (repeat is null or repeat in ('daily', 'weekdays', 'weekly', 'monthly'));
alter table public.tasks add column if not exists repeat_parent uuid references public.tasks(id) on delete set null;
alter table public.tasks add column if not exists repeat_spawned boolean not null default false;

-- Only the person who created a task (or an admin) can change how it repeats.
create or replace function public.guard_task_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare plat public.platforms%rowtype;
begin
  -- SQL editor / server side, or the next copy of a repeating task (made by the database itself)
  if auth.uid() is null or current_setting('taskflow.spawn', true) = '1' then
    new.updated_at := now();
    if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then new.completed_at := now(); end if;
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
         or new.repeat      is distinct from old.repeat
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

create or replace function public.guard_reminder() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype;
begin
  if auth.uid() is null or current_setting('taskflow.spawn', true) = '1' then return new; end if;
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

-- When a repeating task is completed, create the next one.
create or replace function public.spawn_next_occurrence() returns trigger
language plpgsql security definer set search_path = public as $$
declare base date; nxt date; new_id uuid;
begin
  if new.repeat is null or new.status <> 'completed' or old.status = 'completed' or new.repeat_spawned then return null; end if;
  base := coalesce(new.due_date, current_date);
  nxt := base;
  loop  -- next date after today, so a late completion doesn't create an already-overdue copy
    nxt := case new.repeat
      when 'daily' then nxt + 1
      when 'weekdays' then nxt + case extract(isodow from nxt)::int when 5 then 3 when 6 then 2 else 1 end
      when 'weekly' then nxt + 7
      else (nxt + interval '1 month')::date end;
    exit when nxt > current_date;
  end loop;

  perform set_config('taskflow.spawn', '1', true);
  insert into public.tasks (title, description, priority, due_date, due_time, links, platform_id, created_by, assigned_to, repeat, repeat_parent)
  values (new.title, new.description, new.priority, case when new.due_date is null then null else nxt end, new.due_time, new.links,
          new.platform_id, new.created_by, new.assigned_to, new.repeat, coalesce(new.repeat_parent, new.id))
  returning id into new_id;
  update public.tasks set repeat_spawned = true where id = new.id;
  -- Carry over reminders that count back from the due time, shifted to the new date.
  if new.due_date is not null and to_regclass('public.reminders') is not null then
    insert into public.reminders (task_id, user_id, created_by, remind_at, offset_minutes)
    select new_id, rm.user_id, rm.created_by, rm.remind_at + (nxt - new.due_date) * interval '1 day', rm.offset_minutes
    from public.reminders rm where rm.task_id = new.id and rm.offset_minutes is not null;
  end if;
  perform set_config('taskflow.spawn', '', true);
  return null;
end $$;
drop trigger if exists tasks_repeat on public.tasks;
create trigger tasks_repeat after update of status on public.tasks
  for each row execute function public.spawn_next_occurrence();
revoke execute on function public.spawn_next_occurrence() from public, anon, authenticated;
