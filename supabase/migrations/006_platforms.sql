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
