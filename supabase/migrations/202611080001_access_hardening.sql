-- Sign-in and account hardening.
--
-- 1. Only the server can check a PIN, and ten failures in a row lock that identifier for 1 minute.
-- 2. PINs no longer have to be unique, so setting one no longer reveals that another user has it.
-- 3. New PINs cannot be trivially guessable (repeated or sequential digits, common patterns).
-- 4. Changing your own PIN requires your current PIN.
-- 5. Browsers cannot write profiles, PIN hashes or formulas directly; those changes go through
--    server routes that enforce role rules (profiles, formulas) or SECURITY DEFINER functions.

create table if not exists public.pin_login_attempts (
  identifier text primary key,
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.pin_login_attempts enable row level security;
revoke all on public.pin_login_attempts from public, anon, authenticated;
grant all on public.pin_login_attempts to service_role;

create or replace function public.is_weak_pin(candidate text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select candidate is null
    or candidate !~ '^[0-9]{6}$'
    or candidate ~ '^([0-9])\1{5}$'
    or strpos('01234567890123456', candidate) > 0
    or strpos('98765432109876543', candidate) > 0
    or candidate in ('121212', '123123', '112233', '111222', '101010', '010101', '131313', '202020',
                     '212121', '696969', '420420', '159753', '147258', '258369', '102030', '100200');
$$;
revoke all on function public.is_weak_pin(text) from public;
grant execute on function public.is_weak_pin(text) to anon, authenticated, service_role;

-- Counts a failed attempt for an identifier and returns true when it is now locked.
-- Ten failures in a row lock the identifier for 1 minute. The count starts again after a lock ends,
-- after a successful sign-in or PIN reset, or when no attempt has failed for 15 minutes.
create or replace function public.record_pin_failure(p_identifier text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  now_ts timestamptz := timezone('utc', now());
  failures integer;
begin
  -- Attempts for unknown identifiers are counted too (no account enumeration), so prune stale rows.
  delete from public.pin_login_attempts
  where updated_at < now_ts - interval '1 day' and (locked_until is null or locked_until < now_ts);

  insert into public.pin_login_attempts as attempt (identifier, failed_count, locked_until, updated_at)
  values (p_identifier, 1, null, now_ts)
  on conflict (identifier) do update set
    failed_count = case
      when attempt.updated_at < now_ts - interval '15 minutes'
        or (attempt.locked_until is not null and attempt.locked_until <= now_ts) then 1
      else attempt.failed_count + 1
    end,
    updated_at = now_ts
  returning failed_count into failures;

  if failures >= 10 then
    update public.pin_login_attempts set locked_until = now_ts + interval '1 minute' where identifier = p_identifier;
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.record_pin_failure(text) from public, anon, authenticated;
grant execute on function public.record_pin_failure(text) to service_role;

create or replace function public.pin_identifier_locked(p_identifier text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.pin_login_attempts
    where identifier = p_identifier and locked_until is not null and locked_until > timezone('utc', now())
  );
$$;
revoke all on function public.pin_identifier_locked(text) from public, anon, authenticated;
grant execute on function public.pin_identifier_locked(text) to service_role;

create or replace function public.verify_pin_login(login_identifier text, submitted_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  normalized_identifier text := lower(btrim(coalesce(login_identifier, '')));
  matched_user_id uuid;
begin
  if normalized_identifier = '' then
    return null;
  end if;

  -- A locked identifier is refused even with the correct PIN, so guessing cannot continue.
  if public.pin_identifier_locked(normalized_identifier) then
    raise exception using errcode = 'P0429', message = 'Too many failed sign-in attempts. Try again in a minute or ask a system administrator to reset your PIN.';
  end if;

  if submitted_pin is not null and submitted_pin ~ '^[0-9]{6}$' then
    select p.id
    into matched_user_id
    from public.profiles p
    join public.user_security s on s.user_id = p.id
    where p.is_active
      and (
        (normalized_identifier ~ '^[0-9]{1,6}$' and p.employee_id = normalized_identifier)
        or lower(p.email) = normalized_identifier
      )
      and s.pin_hash = extensions.crypt(submitted_pin, s.pin_hash)
    limit 1;
  end if;

  if matched_user_id is null then
    perform public.record_pin_failure(normalized_identifier);
    return null;
  end if;

  delete from public.pin_login_attempts where identifier = normalized_identifier;
  return matched_user_id;
end;
$$;
-- The sign-in route calls this with the service role; browsers can no longer use it as a PIN oracle.
revoke all on function public.verify_pin_login(text, text) from public, anon, authenticated;
grant execute on function public.verify_pin_login(text, text) to service_role;

create or replace function public.set_user_pin(target_user_id uuid, new_pin text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.profiles;
begin
  if auth.role() is distinct from 'service_role' and not public.is_system_admin() then
    raise exception using errcode = '42501', message = 'Not authorized to set a user PIN.';
  end if;
  if new_pin is null or new_pin !~ '^[0-9]{6}$' then
    raise exception using errcode = '22023', message = 'PIN must be exactly 6 digits.';
  end if;
  if public.is_weak_pin(new_pin) then
    raise exception using errcode = '22023', message = 'Choose a PIN that is harder to guess. Avoid repeated or sequential digits.';
  end if;

  update public.user_security
  set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf'))
  where user_id = target_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Target user security record not found.';
  end if;

  -- A system admin's PIN reset also clears a lockout on that account's identifiers.
  select * into target from public.profiles where id = target_user_id;
  delete from public.pin_login_attempts
  where identifier in (lower(coalesce(target.employee_id, '')), lower(coalesce(target.email, '')));
end;
$$;
revoke all on function public.set_user_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.set_user_pin(uuid, text) to service_role;

drop function if exists public.set_my_pin(text);
-- Returns false when the current PIN is wrong. It does not raise in that case, because raising
-- would roll back the recorded failure and the lockout could never take effect.
create or replace function public.set_my_pin(current_pin text, new_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  actor uuid := auth.uid();
  limit_key text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Sign in before changing your PIN.';
  end if;
  limit_key := 'pin-change:' || actor::text;
  if public.pin_identifier_locked(limit_key) then
    raise exception using errcode = 'P0429', message = 'Too many incorrect PIN entries. Try again in a minute.';
  end if;
  if new_pin is null or new_pin !~ '^[0-9]{6}$' then
    raise exception using errcode = '22023', message = 'PIN must be exactly 6 digits.';
  end if;
  if public.is_weak_pin(new_pin) then
    raise exception using errcode = '22023', message = 'Choose a PIN that is harder to guess. Avoid repeated or sequential digits.';
  end if;
  if current_pin is not distinct from new_pin then
    raise exception using errcode = '22023', message = 'Choose a new PIN that is different from your current PIN.';
  end if;
  if not exists (
    select 1 from public.user_security s
    where s.user_id = actor
      and current_pin ~ '^[0-9]{6}$'
      and s.pin_hash = extensions.crypt(current_pin, s.pin_hash)
  ) then
    perform public.record_pin_failure(limit_key);
    return false;
  end if;

  update public.user_security
  set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf'))
  where user_id = actor;
  delete from public.pin_login_attempts where identifier = limit_key;
  return true;
end;
$$;
revoke all on function public.set_my_pin(text, text) from public, anon;
grant execute on function public.set_my_pin(text, text) to authenticated, service_role;

-- Profiles change only through server routes (service role) and SECURITY DEFINER functions such as
-- touch_user_session, so a signed-in user cannot rewrite their employee ID, email or timeout.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
-- PIN hashes are never readable or writable by browsers.
revoke all on public.user_security from anon, authenticated;
-- Formula approval lives in the payload; writes go through the formula API, which enforces review.
revoke insert, update, delete on public.process_map_formulas from anon, authenticated;
