-- =====================================================================
--  Create the first admin (run once, in Supabase → SQL Editor).
--  1. Replace you@example.com below with YOUR email (keep the quotes).
--  2. Press Run.
--  3. Open the app → "Activate your account" → sign up with that email.
--
--  Nobody else can become admin: sign-up only works for invited emails,
--  and only an existing admin can invite another admin.
-- =====================================================================

insert into public.invitations (email, full_name, role)
values (lower('you@example.com'), 'Admin', 'admin')
on conflict (email) do update set role = 'admin', accepted_at = null;

-- If you already have an account with that email, this makes it admin.
update public.profiles set role = 'admin', active = true
where email = lower('you@example.com');

-- Everyone who currently has an account. If you see anyone you did not
-- add, remove them in Authentication → Users.
select email, role, active, created_at from public.profiles order by created_at;
