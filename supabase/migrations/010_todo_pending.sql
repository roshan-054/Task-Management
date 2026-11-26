-- =====================================================================
--  010 · To-do: Pending tab with a reason, and to-dos linked to tasks
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

alter table public.todos add column if not exists pending      boolean not null default false;
alter table public.todos add column if not exists pending_note text not null default '' check (char_length(pending_note) <= 1000);
alter table public.todos add column if not exists pending_at   timestamptz;
alter table public.todos add column if not exists task_id      uuid references public.tasks(id) on delete set null;
create index if not exists todos_task_idx on public.todos (task_id);
