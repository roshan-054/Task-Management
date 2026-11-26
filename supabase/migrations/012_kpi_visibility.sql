-- =====================================================================
--  012 · Who can see whose performance (KPI)
--  * Admins see everyone.
--  * Everyone sees their own.
--  * A manager sees team members only (never other managers or admins):
--      - people who report to them (Reports to = this manager), and
--      - team members in their own department and team who don't report
--        to a different manager.
--  Enforced inside the database, so the app can't show more than this.
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

create or replace function public.can_view_kpi(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me join public.profiles p on p.id = p_user
    where me.id = auth.uid() and me.active
      and (
        p.id = me.id
        or me.role = 'admin'
        or (me.role = 'manager' and p.role = 'member' and (
              p.manager_id = me.id
              or (p.manager_id is null
                  and me.department_id is not null and p.department_id = me.department_id
                  and (me.team_id is null or p.team_id = me.team_id))))
      )
  )
$$;

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
      or (scope = 'department' and me.role in ('admin', 'manager') and public.can_view_kpi(p.id))
      or (scope = 'user' and p.id = target and public.can_view_kpi(p.id))
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
      or (scope = 'department' and me.role in ('admin', 'manager') and public.can_view_kpi(p.id))
      or (scope = 'user' and p.id = target and public.can_view_kpi(p.id))
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

revoke execute on function public.can_view_kpi(uuid), public.kpi_stats(text, uuid), public.kpi_platforms(text, uuid) from public, anon;
grant execute on function public.can_view_kpi(uuid), public.kpi_stats(text, uuid), public.kpi_platforms(text, uuid) to authenticated;
