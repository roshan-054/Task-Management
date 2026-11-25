-- =====================================================================
--  TaskFlow — Supabase schema
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  It is safe to re-run: objects are created with "if not exists" or
--  replaced.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
--  Types
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'manager', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('not_started', 'in_progress', 'on_hold', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (department_id, name)
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  full_name     text not null default '',
  title         text not null default '',
  role          user_role not null default 'member',
  department_id uuid references public.departments(id) on delete set null,
  team_id       uuid references public.teams(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- People who are allowed to create an account. Admins and managers add
-- rows here; the person then activates their account with that email.
create table if not exists public.invitations (
  email         text primary key,
  full_name     text not null default '',
  title         text not null default '',
  role          user_role not null default 'member',
  department_id uuid references public.departments(id) on delete set null,
  team_id       uuid references public.teams(id) on delete set null,
  invited_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 200),
  description  text not null default '',
  status       task_status not null default 'not_started',
  priority     task_priority not null default 'medium',
  due_date     date,
  links        jsonb not null default '[]'::jsonb,   -- [{ "label": "...", "url": "https://..." }]
  created_by   uuid not null references public.profiles(id) on delete cascade,
  assigned_to  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to);
create index if not exists tasks_created_idx  on public.tasks(created_by);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete cascade,
  type       text not null,             -- 'completed' | 'on_hold' | 'assigned'
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------------------------------------------------------------------
--  Helper functions (security definer so policies can call them safely)
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.my_department() returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create or replace function public.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'manager'), false)
$$;

-- ---------------------------------------------------------------------
--  New account → profile. ONLY emails that an admin or manager added to
--  public.invitations can create an account. This runs inside the
--  database, so it also blocks anyone calling the Supabase sign-up API
--  directly, magic links, anonymous sign-ins and OAuth providers.
--  The first admin is created with supabase/make-admin.sql.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations%rowtype;
begin
  if new.email is null or new.email = '' then
    raise exception 'Sign-up requires an invited email address.';
  end if;
  select * into inv from public.invitations
   where lower(email) = lower(new.email) and accepted_at is null;

  if inv.email is not null then
    insert into public.profiles (id, email, full_name, title, role, department_id, team_id)
    values (new.id, lower(new.email),
            coalesce(nullif(inv.full_name, ''), new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
            inv.title, inv.role, inv.department_id, inv.team_id);
    update public.invitations set accepted_at = now() where email = inv.email;
  else
    raise exception 'This email has not been invited. Ask your admin or manager to add you first.';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change role, department, team or active flag.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL editor / server side
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.department_id is distinct from old.department_id
       or new.team_id is distinct from old.team_id
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change role, department, team or status.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
--  Task rules
--   * Members may only create tasks for themselves.
--   * Managers/admins may assign to anyone in any team.
--   * An assignee who did not create the task may ONLY change status.
-- ---------------------------------------------------------------------
create or replace function public.guard_task_write() returns trigger
language plpgsql security definer set search_path = public as $$
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

  new.updated_at := now();
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks
  for each row execute function public.guard_task_write();

-- Notifications: tell the manager when their task is completed / put on hold,
-- and tell the assignee when a task is assigned to them.
create or replace function public.notify_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
begin
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    if new.assigned_to <> new.created_by then
      insert into public.notifications (user_id, task_id, type, message)
      values (new.assigned_to, new.id, 'assigned', coalesce(who, 'Someone') || ' assigned you "' || new.title || '"');
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and new.created_by <> coalesce(auth.uid(), new.created_by) then
    if new.status = 'completed' then
      insert into public.notifications (user_id, task_id, type, message)
      values (new.created_by, new.id, 'completed', coalesce(who, 'Someone') || ' completed "' || new.title || '"');
    elsif new.status = 'on_hold' then
      insert into public.notifications (user_id, task_id, type, message)
      values (new.created_by, new.id, 'on_hold', coalesce(who, 'Someone') || ' put "' || new.title || '" on hold');
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to <> new.created_by then
    insert into public.notifications (user_id, task_id, type, message)
    values (new.assigned_to, new.id, 'assigned', coalesce(who, 'Someone') || ' assigned you "' || new.title || '"');
  end if;
  return new;
end $$;

drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update on public.tasks
  for each row execute function public.notify_task_change();

-- ---------------------------------------------------------------------
--  KPI stats (aggregates only — managers never see tasks they didn't assign)
--  scope 'me'         → the caller only
--  scope 'department' → everyone in the caller's department (managers),
--                       everyone (admins)
--  scope 'user'       → one person, if the caller may see them
-- ---------------------------------------------------------------------
create or replace function public.kpi_stats(scope text default 'me', target uuid default null)
returns table (
  user_id uuid, total int, completed int, in_progress int, on_hold int, not_started int,
  overdue_open int, completed_on_time int, completed_late int,
  avg_completion_hours numeric, high_priority_completed int, weekly jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if me.id is null then return; end if;

  return query
  with people as (
    select p.id from public.profiles p
    where p.active and (
      (scope = 'me' and p.id = me.id)
      or (scope = 'department' and (me.role = 'admin' or (me.role = 'manager' and p.department_id = me.department_id)))
      or (scope = 'user' and p.id = target and (
            p.id = me.id or me.role = 'admin'
            or (me.role = 'manager' and p.department_id = me.department_id)))
    )
  )
  select
    pe.id,
    count(t.id)::int,
    count(t.id) filter (where t.status = 'completed')::int,
    count(t.id) filter (where t.status = 'in_progress')::int,
    count(t.id) filter (where t.status = 'on_hold')::int,
    count(t.id) filter (where t.status = 'not_started')::int,
    count(t.id) filter (where t.status <> 'completed' and t.due_date < current_date)::int,
    count(t.id) filter (where t.status = 'completed' and (t.due_date is null or t.completed_at::date <= t.due_date))::int,
    count(t.id) filter (where t.status = 'completed' and t.due_date is not null and t.completed_at::date > t.due_date)::int,
    round(avg(extract(epoch from (t.completed_at - t.created_at)) / 3600) filter (where t.status = 'completed'), 1),
    count(t.id) filter (where t.status = 'completed' and t.priority in ('high', 'urgent'))::int,
    (
      select coalesce(jsonb_agg(c order by w desc), '[]'::jsonb) from (
        select w, (select count(*) from public.tasks t2
                    where t2.assigned_to = pe.id and t2.status = 'completed'
                      and t2.completed_at >= date_trunc('week', now()) - (w || ' weeks')::interval
                      and t2.completed_at <  date_trunc('week', now()) - ((w - 1) || ' weeks')::interval) as c
        from generate_series(7, 0, -1) w
      ) s
    )
  from people pe
  left join public.tasks t on t.assigned_to = pe.id
  group by pe.id;
end $$;

-- ---------------------------------------------------------------------
--  Row level security
-- ---------------------------------------------------------------------
alter table public.departments   enable row level security;
alter table public.teams         enable row level security;
alter table public.profiles      enable row level security;
alter table public.invitations   enable row level security;
alter table public.tasks         enable row level security;
alter table public.notifications enable row level security;

-- Departments & teams: everyone signed in can read; admins manage.
drop policy if exists dep_read  on public.departments;
drop policy if exists dep_write on public.departments;
create policy dep_read  on public.departments for select to authenticated using (public.my_role() is not null);
create policy dep_write on public.departments for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists team_read  on public.teams;
drop policy if exists team_write on public.teams;
create policy team_read  on public.teams for select to authenticated using (public.my_role() is not null);
create policy team_write on public.teams for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: everyone signed in can see the directory (needed to assign
-- tasks across teams). You can edit your own name/title; admins edit all.
drop policy if exists prof_read   on public.profiles;
drop policy if exists prof_update on public.profiles;
create policy prof_read   on public.profiles for select to authenticated using (id = auth.uid() or public.my_role() is not null);
create policy prof_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- Invitations: admins invite anyone; managers invite members into their department.
drop policy if exists inv_read   on public.invitations;
drop policy if exists inv_insert on public.invitations;
drop policy if exists inv_delete on public.invitations;
create policy inv_read on public.invitations for select to authenticated
  using (public.is_admin() or invited_by = auth.uid());
create policy inv_insert on public.invitations for insert to authenticated
  with check (
    invited_by = auth.uid() and (
      public.is_admin()
      or (public.my_role() = 'manager' and role = 'member' and department_id = public.my_department()
          and (team_id is null or exists (select 1 from public.teams t where t.id = team_id and t.department_id = public.my_department())))
    )
    and email = lower(email)
  );
create policy inv_delete on public.invitations for delete to authenticated
  using (public.is_admin() or (invited_by = auth.uid() and accepted_at is null));

-- Tasks: you see tasks assigned to you and tasks you created. Admins see all.
drop policy if exists task_read   on public.tasks;
drop policy if exists task_insert on public.tasks;
drop policy if exists task_update on public.tasks;
drop policy if exists task_delete on public.tasks;
create policy task_read on public.tasks for select to authenticated
  using (public.my_role() is not null and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin()));
create policy task_insert on public.tasks for insert to authenticated
  with check (public.my_role() is not null);
create policy task_update on public.tasks for update to authenticated
  using (public.my_role() is not null and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin()));
create policy task_delete on public.tasks for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Notifications: only your own.
drop policy if exists notif_read   on public.notifications;
drop policy if exists notif_update on public.notifications;
drop policy if exists notif_delete on public.notifications;
create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
--  Realtime: stream task and notification changes to the browser.
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
--  Function permissions: nothing is callable without signing in.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.kpi_stats(text, uuid) to authenticated;
grant execute on function public.my_role(), public.my_department(), public.is_admin(), public.is_manager_or_admin() to authenticated;

-- Anonymous (signed-out) visitors get no table access at all.
revoke all on all tables in schema public from anon;

-- Signed-in users need table privileges; the row level security policies
-- above then decide exactly which rows each person can see or change.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- =====================================================================
--  Task timing & status history (same as migrations/002_task_history.sql)
-- =====================================================================
alter table public.tasks add column if not exists started_at timestamptz;

create table if not exists public.task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  changed_by  uuid references public.profiles(id) on delete set null,
  from_status task_status,
  to_status   task_status not null,
  created_at  timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events(task_id, created_at);
create index if not exists task_events_time_idx on public.task_events(created_at);

-- started_at: stamped the first time work begins (or at completion if it skipped "In progress")
create or replace function public.stamp_task_times() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.started_at is null and new.status in ('in_progress', 'completed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.started_at := now();
  end if;
  return new;
end $$;

drop trigger if exists tasks_stamp_times on public.tasks;
create trigger tasks_stamp_times before insert or update on public.tasks
  for each row execute function public.stamp_task_times();

-- history: one event per status change
create or replace function public.log_task_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, changed_by, from_status, to_status)
    values (new.id, coalesce(auth.uid(), new.created_by), null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.task_events (task_id, changed_by, from_status, to_status)
    values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end $$;

drop trigger if exists tasks_log_event on public.tasks;
create trigger tasks_log_event after insert or update on public.tasks
  for each row execute function public.log_task_event();

-- Backfill existing tasks once so old data is usable too.
insert into public.task_events (task_id, changed_by, from_status, to_status, created_at)
select t.id, t.created_by, null, 'not_started', t.created_at
from public.tasks t
where not exists (select 1 from public.task_events e where e.task_id = t.id);
insert into public.task_events (task_id, changed_by, from_status, to_status, created_at)
select t.id, t.assigned_to, null, 'completed', t.completed_at
from public.tasks t
where t.completed_at is not null
  and not exists (select 1 from public.task_events e where e.task_id = t.id and e.to_status = 'completed');
update public.tasks set started_at = coalesce(started_at, completed_at)
where started_at is null and status = 'completed';

-- Read access mirrors tasks: you see the history of tasks you can see.
alter table public.task_events enable row level security;
drop policy if exists task_events_read on public.task_events;
create policy task_events_read on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));   -- tasks RLS applies here

revoke all on public.task_events from anon;
grant select on public.task_events to authenticated;
revoke execute on function public.stamp_task_times(), public.log_task_event() from public, anon;
