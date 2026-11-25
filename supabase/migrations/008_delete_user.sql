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
