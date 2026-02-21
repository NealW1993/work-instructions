begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.user_security
  alter column pin_hash set default extensions.crypt(
    encode(extensions.gen_random_bytes(16), 'hex'),
    extensions.gen_salt('bf')
  );

create or replace function public.set_my_pin(new_pin text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new_pin is null or new_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  if exists (
    select 1
    from public.user_security s
    join public.profiles p
      on p.id = s.user_id
    where p.is_active = true
      and s.user_id <> auth.uid()
      and s.pin_hash = extensions.crypt(new_pin, s.pin_hash)
  ) then
    raise exception 'PIN is already in use by another active user';
  end if;

  update public.user_security
  set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf'))
  where user_id = auth.uid();

  if not found then
    raise exception 'User security record not found';
  end if;
end;
$$;

create or replace function public.set_user_pin(target_user_id uuid, new_pin text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new_pin is null or new_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  if auth.role() <> 'service_role' and not public.is_system_admin() then
    raise exception 'Not authorized to set user pin';
  end if;

  if exists (
    select 1
    from public.user_security s
    join public.profiles p
      on p.id = s.user_id
    where p.is_active = true
      and s.user_id <> target_user_id
      and s.pin_hash = extensions.crypt(new_pin, s.pin_hash)
  ) then
    raise exception 'PIN is already in use by another active user';
  end if;

  update public.user_security
  set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf'))
  where user_id = target_user_id;

  if not found then
    raise exception 'Target user security record not found';
  end if;
end;
$$;

create or replace function public.verify_pin_login(login_email text, submitted_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  matched_user_id uuid;
  match_count integer;
begin
  if submitted_pin is null then
    return null;
  end if;

  if submitted_pin !~ '^[0-9]{6}$' then
    return null;
  end if;

  if login_email is not null and btrim(login_email) <> '' then
    select p.id
    into matched_user_id
    from public.profiles p
    join public.user_security s
      on s.user_id = p.id
    where lower(p.email) = lower(login_email)
      and p.is_active = true
      and s.pin_hash = extensions.crypt(submitted_pin, s.pin_hash)
    limit 1;

    return matched_user_id;
  end if;

  select count(*)
  into match_count
  from public.profiles p
  join public.user_security s
    on s.user_id = p.id
  where p.is_active = true
    and s.pin_hash = extensions.crypt(submitted_pin, s.pin_hash);

  if match_count <> 1 then
    return null;
  end if;

  select p.id
  into matched_user_id
  from public.profiles p
  join public.user_security s
    on s.user_id = p.id
  where p.is_active = true
    and s.pin_hash = extensions.crypt(submitted_pin, s.pin_hash)
  limit 1;

  return matched_user_id;
end;
$$;

revoke execute on function public.verify_pin_login(text, text) from public;
grant execute on function public.verify_pin_login(text, text) to service_role;

commit;
