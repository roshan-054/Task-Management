-- =====================================================================
--  002 · Task timing & status history (for analytics)
--  Safe to run more than once. Already included in schema.sql.
--
--  * tasks.completed_at  – exact date & time a task was completed
--                          (set automatically, already existed)
--  * tasks.started_at    – first time a task moved to "In progress"
--  * task_events         – one row for every status change: who changed
--                          it, from what, to what, and when
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
