-- =====================================================================
--  013 · Temporary passwords
--  When an admin sets a password for someone (Activate account or Reset
--  password), it counts as temporary: the next time that person signs in
--  the app asks them to choose their own. They can also change it any
--  time from their profile. Safe to run more than once. Included in
--  schema.sql.
-- =====================================================================

alter table public.profiles add column if not exists must_change_password boolean not null default false;

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
  update public.profiles set must_change_password = (p_user <> auth.uid()) where id = p_user;
end $$;

create or replace function public.admin_create_login(p_email text, p_password text, p_full_name text default '')
returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  inv public.invitations%rowtype;
  v_email text := lower(trim(p_email));
  v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Please sign in again.';
  end if;
  select * into inv from public.invitations where email = v_email;
  if inv.email is null then
    raise exception 'This email has not been invited yet. Invite them first.';
  end if;
  if not (public.is_admin() or (public.my_role() = 'manager' and inv.invited_by = auth.uid())) then
    raise exception 'Only an admin, or the manager who invited this person, can activate their account.';
  end if;
  if inv.accepted_at is not null or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists.';
  end if;
  if p_password is null or char_length(p_password) < 8 then
    raise exception 'Use at least 8 characters.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', coalesce(nullif(p_full_name, ''), inv.full_name, '')),
    now(), now(), '', '', '', ''
  );  -- the on_auth_user_created trigger creates the profile from the invitation

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());
  update public.profiles set must_change_password = true where id = v_id;
  return v_id;
end $$;


revoke execute on function public.admin_reset_password(uuid, text), public.admin_create_login(text, text, text) from public, anon;
grant execute on function public.admin_reset_password(uuid, text), public.admin_create_login(text, text, text) to authenticated;
