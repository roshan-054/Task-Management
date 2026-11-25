-- =====================================================================
--  003 · Remarks, blockers and tagging people
--  Safe to run more than once. Already included in schema.sql.
--
--  * task_remarks  – comments on a task. A remark can be a "blocker"
--                    with a reason (issue, delay, dependency, other)
--                    and can tag people (and their managers). Tagged
--                    people are notified, can open the task, reply and
--                    mark the blocker resolved. They still cannot edit
--                    the task itself.
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
