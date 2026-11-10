-- Run only on a disposable migrated database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'pin-owner@example.invalid', '{"full_name":"PIN Owner","employee_id":"970001"}'::jsonb),
  ('c1000000-0000-4000-8000-000000000002', 'pin-twin@example.invalid', '{"full_name":"PIN Twin","employee_id":"970002"}'::jsonb);

do $$
declare
  v_owner uuid := 'c1000000-0000-4000-8000-000000000001';
  v_twin uuid := 'c1000000-0000-4000-8000-000000000002';
  v_attempt integer;
begin
  -- Guessable PINs are refused wherever a PIN is set.
  if not (public.is_weak_pin('111111') and public.is_weak_pin('123456') and public.is_weak_pin('654321')
    and public.is_weak_pin('121212') and public.is_weak_pin('12345') and public.is_weak_pin('12a456')
    and public.is_weak_pin(null)) then
    raise exception 'FAIL: a guessable PIN was treated as strong';
  end if;
  if public.is_weak_pin('583920') then raise exception 'FAIL: a strong PIN was rejected'; end if;
  begin
    perform public.set_user_pin(v_owner, '000000');
    raise exception 'FAIL: weak PIN stored';
  exception when invalid_parameter_value then null; end;

  -- Two people may share a PIN, so setting one never reveals who else uses it.
  perform public.set_user_pin(v_owner, '583920');
  perform public.set_user_pin(v_twin, '583920');
  if public.verify_pin_login('970001', '583920') is distinct from v_owner
    or public.verify_pin_login('970002', '583920') is distinct from v_twin
    or public.verify_pin_login(' PIN-Owner@Example.invalid ', '583920') is distinct from v_owner then
    raise exception 'FAIL: a shared PIN or email sign-in resolved to the wrong account';
  end if;

  -- Nine failures in a row do not lock. Unknown IDs are counted the same way as real ones.
  for v_attempt in 1..9 loop
    if public.verify_pin_login('970001', '583921') is not null then raise exception 'FAIL: wrong PIN accepted'; end if;
    if public.verify_pin_login('979999', '583921') is not null then raise exception 'FAIL: unknown ID accepted'; end if;
  end loop;
  if public.pin_identifier_locked('970001') or public.pin_identifier_locked('979999') then
    raise exception 'FAIL: an identifier locked before ten failures';
  end if;

  -- The tenth locks the identifier for exactly 1 minute, even for the right PIN.
  perform public.verify_pin_login('970001', '583921');
  perform public.verify_pin_login('979999', '583921');
  if (select locked_until from public.pin_login_attempts where identifier = '970001')
    is distinct from timezone('utc', now()) + interval '1 minute' then
    raise exception 'FAIL: the lock does not last exactly 1 minute';
  end if;
  begin
    perform public.verify_pin_login('970001', '583920');
    raise exception 'FAIL: a locked identifier accepted the right PIN';
  exception when sqlstate 'P0429' then null; end;
  begin
    perform public.verify_pin_login('979999', '583920');
    raise exception 'FAIL: an unknown identifier was not locked like a real one';
  exception when sqlstate 'P0429' then null; end;
  if public.verify_pin_login('970002', '583920') is distinct from v_twin then
    raise exception 'FAIL: locking one identifier blocked another account';
  end if;

  -- When the minute is over, the right PIN works again and the count starts over.
  update public.pin_login_attempts set locked_until = timezone('utc', now()) - interval '1 second' where identifier = '970001';
  if public.verify_pin_login('970001', '583920') is distinct from v_owner then
    raise exception 'FAIL: the lock did not end after its minute';
  end if;
  if exists (select 1 from public.pin_login_attempts where identifier = '970001') then
    raise exception 'FAIL: a successful sign-in did not clear the failure count';
  end if;

  -- A system admin's PIN reset clears a lock straight away.
  for v_attempt in 1..10 loop
    perform public.verify_pin_login('970001', '583921');
  end loop;
  if not public.pin_identifier_locked('970001') then raise exception 'FAIL: ten failures did not lock again'; end if;
  perform public.set_user_pin(v_owner, '604918');
  if public.verify_pin_login('970001', '604918') is distinct from v_owner then
    raise exception 'FAIL: a PIN reset did not clear the lockout';
  end if;
  raise notice 'PASS: PIN policy, shared PINs, 1-minute lockout after ten failures, and reset';
end;
$$;

do $$
declare
  v_owner uuid := 'c1000000-0000-4000-8000-000000000001';
  v_attempt integer;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  -- A wrong current PIN returns false rather than raising, so the failure is kept and counts.
  if public.set_my_pin('111999', '725361') then raise exception 'FAIL: PIN changed without the current PIN'; end if;
  begin
    perform public.set_my_pin('604918', '222222');
    raise exception 'FAIL: a guessable new PIN was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_my_pin('604918', '604918');
    raise exception 'FAIL: an unchanged PIN was accepted';
  exception when invalid_parameter_value then null; end;
  if not public.set_my_pin('604918', '725361') then raise exception 'FAIL: a valid PIN change was refused'; end if;
  if public.verify_pin_login('970001', '725361') is distinct from v_owner then
    raise exception 'FAIL: the new PIN does not sign in';
  end if;
  for v_attempt in 1..10 loop
    perform public.set_my_pin('000111', '839204');
  end loop;
  begin
    perform public.set_my_pin('725361', '839204');
    raise exception 'FAIL: PIN changes kept accepting guesses of the current PIN';
  exception when sqlstate 'P0429' then null; end;
  raise notice 'PASS: changing your own PIN';
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.verify_pin_login(text, text)', 'execute')
    or has_function_privilege('authenticated', 'public.verify_pin_login(text, text)', 'execute') then
    raise exception 'FAIL: browsers can use verify_pin_login as a PIN oracle';
  end if;
  if has_function_privilege('authenticated', 'public.set_user_pin(uuid, text)', 'execute')
    or has_function_privilege('authenticated', 'public.record_pin_failure(text)', 'execute')
    or has_function_privilege('authenticated', 'public.pin_identifier_locked(text)', 'execute') then
    raise exception 'FAIL: browsers can set other PINs or tamper with lockouts';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'insert')
    or has_table_privilege('authenticated', 'public.profiles', 'update')
    or has_table_privilege('authenticated', 'public.profiles', 'delete')
    or has_table_privilege('authenticated', 'public.user_security', 'select')
    or has_table_privilege('authenticated', 'public.pin_login_attempts', 'select')
    or has_table_privilege('authenticated', 'public.process_map_formulas', 'update') then
    raise exception 'FAIL: browsers can write profiles or formulas, or read PIN data';
  end if;
  if not has_function_privilege('authenticated', 'public.set_my_pin(text, text)', 'execute') then
    raise exception 'FAIL: signed-in users cannot change their own PIN';
  end if;
  raise notice 'PASS: browser privileges for sign-in, PINs, profiles and formulas';
end;
$$;
rollback;
