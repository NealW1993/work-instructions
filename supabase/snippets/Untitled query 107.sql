begin;

alter table public.profiles
  add column if not exists employee_id text;

update public.profiles
set employee_id = nullif(left(regexp_replace(employee_id, '[^0-9]', '', 'g'), 6), '')
where employee_id is not null;

update public.profiles p
set employee_id = source.normalized_employee_id
from (
  select
    id,
    nullif(
      left(
        regexp_replace(
          coalesce(raw_user_meta_data ->> 'employee_id', ''),
          '[^0-9]',
          '',
          'g'
        ),
        6
      ),
      ''
    ) as normalized_employee_id
  from auth.users
) source
where p.id = source.id
  and p.employee_id is null
  and source.normalized_employee_id is not null;

alter table public.profiles
  drop constraint if exists profiles_employee_id_format_check;

alter table public.profiles
  add constraint profiles_employee_id_format_check
  check (employee_id is null or employee_id ~ '^[0-9]{1,6}$');

create unique index if not exists profiles_employee_id_unique_idx
  on public.profiles (employee_id)
  where employee_id is not null;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, employee_id)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    nullif(
      left(
        regexp_replace(
          coalesce(new.raw_user_meta_data ->> 'employee_id', ''),
          '[^0-9]',
          '',
          'g'
        ),
        6
      ),
      ''
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      employee_id = coalesce(excluded.employee_id, public.profiles.employee_id);

  insert into public.user_security (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.verify_pin_login(login_identifier text, submitted_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  normalized_identifier text;
  matched_user_id uuid;
begin
  if submitted_pin is null or submitted_pin !~ '^[0-9]{6}$' then
    return null;
  end if;

  normalized_identifier := btrim(coalesce(login_identifier, ''));

  if normalized_identifier = '' then
    return null;
  end if;

  select p.id
  into matched_user_id
  from public.profiles p
  join public.user_security s
    on s.user_id = p.id
  where p.is_active = true
    and (
      (normalized_identifier ~ '^[0-9]{1,6}$' and p.employee_id = normalized_identifier)
      or lower(p.email) = lower(normalized_identifier)
    )
    and s.pin_hash = extensions.crypt(submitted_pin, s.pin_hash)
  limit 1;

  return matched_user_id;
end;
$$;

revoke execute on function public.verify_pin_login(text, text) from public;
grant execute on function public.verify_pin_login(text, text) to service_role;

commit;
