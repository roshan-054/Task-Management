-- =====================================================================
--  014 · Repair function permissions
--  Fixes "permission denied for function is_admin" (or my_role,
--  can_see_task, ...). The app's security rules call these small helper
--  functions to check who you are, so signed-in users must be allowed to
--  run them. If that permission gets removed (for example by following a
--  Supabase "Security Advisor" suggestion), every page that checks your
--  role fails. This puts the permissions back exactly as TaskFlow needs:
--  signed-in users can run them, signed-out visitors cannot.
--  Safe to run more than once. Included in schema.sql.
-- =====================================================================

-- Helpers used inside the security rules (row level security policies).
grant execute on function
  public.my_role(), public.my_department(), public.is_admin(), public.is_manager_or_admin(),
  public.can_see_task(uuid), public.is_tagged_on(uuid), public.can_manage_platforms(uuid)
to authenticated;

-- Actions the app calls directly. Each one checks permissions itself.
grant execute on function
  public.kpi_stats(text, uuid), public.kpi_platforms(text, uuid), public.remove_platform(uuid),
  public.admin_reset_password(uuid, text), public.admin_delete_user(uuid, uuid), public.fire_my_reminders()
to authenticated;

do $$ begin
  grant execute on function public.can_view_kpi(uuid) to authenticated;          -- 012
exception when undefined_function then null; end $$;
do $$ begin
  grant execute on function public.admin_create_login(text, text, text) to authenticated;  -- 011 / 013
exception when undefined_function then null; end $$;

-- Signed-out visitors still can't run anything.
revoke execute on all functions in schema public from anon;
