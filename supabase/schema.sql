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

-- =====================================================================
--  Remarks, blockers and tagging (same as migrations/003_task_remarks.sql)
-- =====================================================================
create table if not exists public.task_remarks (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  kind        text not null default 'note' check (kind in ('note', 'blocker')),
  reason      text check (reason in ('issue', 'delay', 'dependency', 'other')),
  tagged      uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create index if not exists task_remarks_task_idx on public.task_remarks(task_id, created_at);
create index if not exists task_remarks_tagged_idx on public.task_remarks using gin (tagged);

-- Is the current user tagged on any remark of this task?
create or replace function public.is_tagged_on(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.task_remarks r where r.task_id = p_task and auth.uid() = any(r.tagged))
$$;

-- Can the current user see this task? (assignee, creator, admin, or tagged)
create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and (
    public.is_admin()
    or exists (select 1 from public.tasks t where t.id = p_task and (t.assigned_to = auth.uid() or t.created_by = auth.uid()))
    or public.is_tagged_on(p_task))
$$;

-- People tagged on a task can now open it (read only).
drop policy if exists task_read on public.tasks;
create policy task_read on public.tasks for select to authenticated
  using (public.my_role() is not null and (assigned_to = auth.uid() or created_by = auth.uid() or public.is_admin() or public.is_tagged_on(id)));

-- Clean up a new remark: author is always you, tags must be active people.
create or replace function public.guard_remark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.author_id := auth.uid(); end if;
    new.created_at := now();
    new.resolved_at := null; new.resolved_by := null;
    if new.kind = 'blocker' then new.reason := coalesce(new.reason, 'other'); else new.reason := null; end if;
    new.tagged := coalesce(array(
      select distinct p.id from public.profiles p
      where p.id = any(coalesce(new.tagged, '{}')) and p.active and p.id <> new.author_id), '{}');
    return new;
  end if;
  -- UPDATE: only the resolved state can change.
  if auth.uid() is not null and (
       new.body is distinct from old.body or new.kind is distinct from old.kind or new.reason is distinct from old.reason
       or new.tagged is distinct from old.tagged or new.task_id is distinct from old.task_id
       or new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at) then
    raise exception 'Remarks cannot be edited. Add a new remark instead.';
  end if;
  if new.resolved_at is not null and old.resolved_at is null then
    new.resolved_at := now(); new.resolved_by := coalesce(auth.uid(), new.resolved_by);
  elsif new.resolved_at is null then
    new.resolved_by := null;
  end if;
  return new;
end $$;

drop trigger if exists task_remarks_guard on public.task_remarks;
create trigger task_remarks_guard before insert or update on public.task_remarks
  for each row execute function public.guard_remark();

-- Notifications for remarks, blockers and resolutions.
create or replace function public.notify_remark() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  who text;
  why text;
  u uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  if tg_op = 'INSERT' then
    select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.author_id;
    why := case new.reason when 'issue' then 'an issue' when 'delay' then 'a delay' when 'dependency' then 'a dependency' else 'a blocker' end;
    foreach u in array new.tagged loop
      insert into public.notifications (user_id, task_id, type, message)
      values (u, t.id, 'tagged', who || ' tagged you on "' || t.title || '"' ||
              case when new.kind = 'blocker' then ' (blocked by ' || why || ')' else '' end);
    end loop;
    for u in select distinct x from unnest(array[t.created_by, t.assigned_to]) x
             where x <> new.author_id and not (x = any(new.tagged)) loop
      insert into public.notifications (user_id, task_id, type, message)
      values (u, t.id, case when new.kind = 'blocker' then 'blocked' else 'remark' end,
              case when new.kind = 'blocker' then who || ' flagged "' || t.title || '" as blocked by ' || why
                   else who || ' added a remark on "' || t.title || '"' end);
    end loop;
  elsif new.resolved_at is not null and old.resolved_at is null then
    select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.resolved_by;
    for u in select distinct x from unnest(array[new.author_id, t.created_by, t.assigned_to]) x
             where x is not null and x <> coalesce(new.resolved_by, '00000000-0000-0000-0000-000000000000'::uuid) loop
      insert into public.notifications (user_id, task_id, type, message)
      values (u, t.id, 'resolved', coalesce(who, 'Someone') || ' resolved a blocker on "' || t.title || '"');
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists task_remarks_notify on public.task_remarks;
create trigger task_remarks_notify after insert or update on public.task_remarks
  for each row execute function public.notify_remark();

alter table public.task_remarks enable row level security;
drop policy if exists remark_read   on public.task_remarks;
drop policy if exists remark_insert on public.task_remarks;
drop policy if exists remark_update on public.task_remarks;
drop policy if exists remark_delete on public.task_remarks;
create policy remark_read   on public.task_remarks for select to authenticated using (public.can_see_task(task_id));
create policy remark_insert on public.task_remarks for insert to authenticated
  with check (author_id = auth.uid() and public.can_see_task(task_id));
create policy remark_update on public.task_remarks for update to authenticated
  using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));
create policy remark_delete on public.task_remarks for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

revoke all on public.task_remarks from anon;
grant select, insert, update, delete on public.task_remarks to authenticated;
revoke execute on function public.guard_remark(), public.notify_remark() from public, anon;
revoke execute on function public.is_tagged_on(uuid), public.can_see_task(uuid) from public, anon;
grant execute on function public.is_tagged_on(uuid), public.can_see_task(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.task_remarks;
exception when duplicate_object then null; end $$;

-- =====================================================================
--  Reports-to manager and admin password reset (same as migrations/004_people_admin.sql)
-- =====================================================================
alter table public.profiles add column if not exists manager_id uuid references public.profiles(id) on delete set null;
alter table public.invitations add column if not exists manager_id uuid references public.profiles(id) on delete set null;

-- Only admins may change who someone reports to.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL editor / server side
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.department_id is distinct from old.department_id
       or new.team_id is distinct from old.team_id
       or new.manager_id is distinct from old.manager_id
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change role, department, team, manager or status.';
    end if;
  end if;
  if new.manager_id = new.id then raise exception 'Someone cannot report to themselves.'; end if;
  return new;
end $$;

-- Carry "reports to" over from the invitation when the account is created.
create or replace function public.apply_invite_manager() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.manager_id is null then
    select i.manager_id into new.manager_id from public.invitations i where lower(i.email) = lower(new.email);
  end if;
  return new;
end $$;
drop trigger if exists profiles_invite_manager on public.profiles;
create trigger profiles_invite_manager before insert on public.profiles
  for each row execute function public.apply_invite_manager();

-- KPI: managers also see people who report to them (any department).
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
      or (scope = 'department' and (me.role = 'admin'
            or (me.role = 'manager' and (p.department_id = me.department_id or p.manager_id = me.id))))
      or (scope = 'user' and p.id = target and (
            p.id = me.id or me.role = 'admin'
            or (me.role = 'manager' and (p.department_id = me.department_id or p.manager_id = me.id))))
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

-- Admin-only: set a new password for someone (and confirm their email,
-- so they can sign in straight away). Returns nothing; the admin's app
-- shows the password it generated once.
create or replace function public.admin_reset_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reset passwords.';
  end if;
  if p_password is null or char_length(p_password) < 8 then
    raise exception 'Use at least 8 characters.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Person not found.';
  end if;
  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_user;
end $$;

revoke execute on function public.admin_reset_password(uuid, text) from public, anon;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
revoke execute on function public.apply_invite_manager() from public, anon;
grant execute on function public.kpi_stats(text, uuid) to authenticated;

-- =====================================================================
--  Status notifications for every change (same as migrations/005_status_notifications.sql)
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


-- =====================================================================
--  006 · Platforms (e.g. Amazon, Custom, Other) per department
--  Each department has its own list. Its managers (and admins) add,
--  rename and remove options; tasks can carry one platform, which also
--  feeds the performance breakdown. RevOps starts with Amazon, Custom
--  and Other. Safe to run more than once. Included in schema.sql.
-- =====================================================================

create table if not exists public.platforms (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  archived      boolean not null default false,   -- removed, but kept for old tasks and reports
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create unique index if not exists platforms_dept_name_uq on public.platforms (department_id, lower(name));

alter table public.tasks add column if not exists platform_id uuid references public.platforms(id) on delete set null;
create index if not exists tasks_platform_idx on public.tasks (platform_id);

-- Admins manage every department's list; a manager manages their own department's.
create or replace function public.can_manage_platforms(p_dept uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.active
                   and (p.role = 'admin' or (p.role = 'manager' and p.department_id = p_dept)))
$$;

alter table public.platforms enable row level security;
drop policy if exists plat_read   on public.platforms;
drop policy if exists plat_insert on public.platforms;
drop policy if exists plat_update on public.platforms;
drop policy if exists plat_delete on public.platforms;
create policy plat_read   on public.platforms for select to authenticated using (public.my_role() is not null);
create policy plat_insert on public.platforms for insert to authenticated with check (public.can_manage_platforms(department_id));
create policy plat_update on public.platforms for update to authenticated
  using (public.can_manage_platforms(department_id)) with check (public.can_manage_platforms(department_id));
create policy plat_delete on public.platforms for delete to authenticated using (public.can_manage_platforms(department_id));
revoke all on public.platforms from anon;
grant select, insert, update, delete on public.platforms to authenticated;

-- Removing a platform: delete it if no task uses it, otherwise archive it
-- so old tasks and reports keep their label. Returns 'deleted' or 'archived'.
create or replace function public.remove_platform(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  select department_id into d from public.platforms where id = p_id;
  if d is null then raise exception 'Platform not found.'; end if;
  if not public.can_manage_platforms(d) then raise exception 'Only this department''s manager or an admin can remove its platforms.'; end if;
  if exists (select 1 from public.tasks where platform_id = p_id) then
    update public.platforms set archived = true where id = p_id;
    return 'archived';
  end if;
  delete from public.platforms where id = p_id;
  return 'deleted';
end $$;

-- Task guard, now also covering platform_id: assignees cannot change it,
-- and a task's platform must belong to the assignee's department.
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

-- Performance per platform for the same people kpi_stats() covers.
create or replace function public.kpi_platforms(scope text default 'me', target uuid default null)
returns table (
  user_id uuid, platform_id uuid, total int, completed int, open int,
  overdue_open int, completed_on_time int, completed_late int
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
      or (scope = 'department' and (me.role = 'admin'
            or (me.role = 'manager' and (p.department_id = me.department_id or p.manager_id = me.id))))
      or (scope = 'user' and p.id = target and (
            p.id = me.id or me.role = 'admin'
            or (me.role = 'manager' and (p.department_id = me.department_id or p.manager_id = me.id))))
    )
  )
  select t.assigned_to, t.platform_id,
    count(*)::int,
    count(*) filter (where t.status = 'completed')::int,
    count(*) filter (where t.status <> 'completed')::int,
    count(*) filter (where t.status <> 'completed' and t.due_date < current_date)::int,
    count(*) filter (where t.status = 'completed' and (t.due_date is null or t.completed_at::date <= t.due_date))::int,
    count(*) filter (where t.status = 'completed' and t.due_date is not null and t.completed_at::date > t.due_date)::int
  from public.tasks t join people pe on pe.id = t.assigned_to
  group by t.assigned_to, t.platform_id;
end $$;

revoke execute on function public.can_manage_platforms(uuid), public.remove_platform(uuid), public.kpi_platforms(text, uuid) from public, anon;
grant execute on function public.can_manage_platforms(uuid), public.remove_platform(uuid), public.kpi_platforms(text, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.platforms;
exception when duplicate_object then null; end $$;

-- Starting list for RevOps (matched by name, so it also works if the
-- department is called "Rev Ops" or "Revenue Operations").
insert into public.platforms (department_id, name, created_by)
select d.id, v.name, null
from public.departments d
cross join (values ('Amazon'), ('Custom'), ('Other')) as v(name)
where lower(replace(d.name, ' ', '')) in ('revops', 'revenueoperations')
on conflict do nothing;


-- =====================================================================
--  007 · Personal to-do list and notes
--  Private to each person: nobody else (not even admins) can read them.
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 300),
  done       boolean not null default false,
  position   double precision not null default extract(epoch from now()),
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index if not exists todos_user_idx on public.todos (user_id, position);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null default '' check (char_length(title) <= 200),
  body       text not null default '' check (char_length(body) <= 50000),
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);

-- Owner is always the signed-in person; timestamps are set by the database.
create or replace function public.stamp_personal_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.user_id := coalesce(old.user_id, auth.uid()); end if;
  if tg_table_name = 'todos' then
    if new.done and (tg_op = 'INSERT' or not old.done) then new.done_at := now();
    elsif not new.done then new.done_at := null; end if;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists todos_stamp on public.todos;
create trigger todos_stamp before insert or update on public.todos for each row execute function public.stamp_personal_row();
drop trigger if exists notes_stamp on public.notes;
create trigger notes_stamp before insert or update on public.notes for each row execute function public.stamp_personal_row();

alter table public.todos enable row level security;
alter table public.notes enable row level security;
drop policy if exists todos_own on public.todos;
drop policy if exists notes_own on public.notes;
create policy todos_own on public.todos for all to authenticated
  using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
create policy notes_own on public.notes for all to authenticated
  using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
revoke all on public.todos, public.notes from anon;
grant select, insert, update, delete on public.todos, public.notes to authenticated;
revoke execute on function public.stamp_personal_row() from public, anon;


-- =====================================================================
--  008 · Admins can delete a user
--  Removes their login (they can never sign in again), hands their open
--  tasks to someone else (or deletes them), and keeps a "(deleted)"
--  placeholder so completed work, remarks and history stay readable.
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

alter table public.profiles add column if not exists deleted_at timestamptz;

-- Let the profile outlive the login it came from: drop the
-- profiles.id -> auth.users foreign key (whatever its name is).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.profiles'::regclass and contype = 'f'
             and confrelid = 'auth.users'::regclass loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

-- p_reassign_to: who gets their open tasks. NULL deletes those open tasks.
-- Returns how many open tasks were moved or deleted.
create or replace function public.admin_delete_user(p_user uuid, p_reassign_to uuid default null)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  target public.profiles%rowtype;
  heir   public.profiles%rowtype;
  n int := 0;
begin
  if not public.is_admin() then raise exception 'Only an admin can delete users.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account.'; end if;
  select * into target from public.profiles where id = p_user;
  if target.id is null or target.deleted_at is not null then raise exception 'User not found.'; end if;
  if target.role = 'admin' and not exists (
       select 1 from public.profiles where role = 'admin' and active and deleted_at is null and id <> p_user) then
    raise exception 'You cannot delete the last admin.';
  end if;

  if p_reassign_to is not null then
    select * into heir from public.profiles where id = p_reassign_to and active and deleted_at is null;
    if heir.id is null or heir.id = p_user then raise exception 'Choose an active person to take over their open tasks.'; end if;
    -- Keep the platform only if it belongs to the new person's department.
    update public.tasks t set
      assigned_to = heir.id,
      platform_id = case when exists (select 1 from public.platforms pl where pl.id = t.platform_id and pl.department_id = heir.department_id)
                         then t.platform_id else null end
    where t.assigned_to = p_user and t.status <> 'completed';
    get diagnostics n = row_count;
  else
    delete from public.tasks where assigned_to = p_user and status <> 'completed';
    get diagnostics n = row_count;
  end if;

  -- Private data and things that would let them back in.
  delete from public.todos where user_id = p_user;
  delete from public.notes where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.invitations where lower(email) = lower(target.email);
  update public.profiles set manager_id = null where manager_id = p_user;

  -- Placeholder that keeps history readable.
  update public.profiles set
    full_name  = coalesce(nullif(target.full_name, ''), split_part(target.email, '@', 1)) || ' (deleted)',
    email      = 'deleted+' || target.id || '@deleted.invalid',
    title      = '',
    role       = 'member',
    active     = false,
    department_id = null, team_id = null, manager_id = null,
    deleted_at = now()
  where id = p_user;

  -- Remove the login itself (Supabase also removes its sessions and identities).
  delete from auth.users where id = p_user;
  return n;
end $$;

revoke execute on function public.admin_delete_user(uuid, uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid, uuid) to authenticated;
