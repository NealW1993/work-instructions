begin;

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

commit;
