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
