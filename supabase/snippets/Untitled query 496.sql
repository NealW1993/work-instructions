-- Run only on a disposable migrated database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;

do $$
begin
  -- Browsers can neither read nor write the encrypted key or its activity log.
  if has_table_privilege('anon', 'public.ai_provider_settings', 'select')
    or has_table_privilege('authenticated', 'public.ai_provider_settings', 'select')
    or has_table_privilege('authenticated', 'public.ai_provider_settings', 'insert')
    or has_table_privilege('authenticated', 'public.ai_provider_settings', 'update')
    or has_table_privilege('authenticated', 'public.ai_provider_settings', 'delete')
    or has_table_privilege('authenticated', 'public.ai_settings_audit_events', 'select')
    or has_table_privilege('authenticated', 'public.ai_settings_audit_events', 'insert') then
    raise exception 'FAIL: browsers can read or write AI provider settings';
  end if;
  if not has_table_privilege('service_role', 'public.ai_provider_settings', 'select')
    or not has_table_privilege('service_role', 'public.ai_settings_audit_events', 'insert') then
    raise exception 'FAIL: the server cannot use the AI provider settings';
  end if;

  -- Only the four supported providers, and only one active configuration.
  begin
    insert into public.ai_provider_settings (provider, model, key_ciphertext, key_iv, key_tag, key_fingerprint, key_hint)
    values ('elsewhere', 'any-model', repeat('a', 32), 'nonce-value-', 'tag-value-value-', '0123456789abcdef', '…abcd');
    raise exception 'FAIL: an unknown provider was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.ai_provider_settings (id, provider, model, key_ciphertext, key_iv, key_tag, key_fingerprint, key_hint)
    values (2, 'openai', 'gpt-4.1-mini', repeat('a', 32), 'nonce-value-', 'tag-value-value-', '0123456789abcdef', '…abcd');
    raise exception 'FAIL: a second AI configuration was accepted';
  exception when check_violation then null; end;
  insert into public.ai_provider_settings (provider, model, key_ciphertext, key_iv, key_tag, key_fingerprint, key_hint)
  values ('anthropic', 'claude-opus-5-5', repeat('a', 32), 'nonce-value-', 'tag-value-value-', '0123456789abcdef', '…abcd');

  -- The activity log is permanent.
  insert into public.ai_settings_audit_events (action, provider) values ('revealed', 'anthropic');
  begin
    update public.ai_settings_audit_events set action = 'tested';
    raise exception 'FAIL: an activity record was changed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.ai_settings_audit_events;
    raise exception 'FAIL: an activity record was deleted';
  exception when insufficient_privilege then null; end;

  raise notice 'PASS: AI provider settings are server-only, single and validated; their activity log is permanent';
end;
$$;
rollback;
