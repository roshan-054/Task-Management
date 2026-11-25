-- =====================================================================
--  004 · "Reports to" manager and admin password reset
--  Safe to run more than once. Already included in schema.sql.
--
--  * profiles.manager_id  – who this person reports to. Managers see the
--                           KPIs of their department AND of everyone who
--                           reports to them. "Also tag their manager"
--                           uses this.
--  * admin_reset_password – lets an admin set a new temporary password
--                           for someone (passwords are stored hashed, so
--                           an old password can never be looked up).
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
