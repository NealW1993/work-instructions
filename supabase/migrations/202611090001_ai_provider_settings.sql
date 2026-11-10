-- AI provider settings, managed by system admins in System Administration.
--
-- The API key is stored only as AES-256-GCM ciphertext. The encryption key lives in the app server's
-- environment (AI_KEY_ENCRYPTION_KEY) and never in the database, so database access or a backup alone
-- cannot reveal the API key. Browsers cannot read or write either table. Only the server (service
-- role) can, after confirming the request comes from a system admin who re-entered their PIN.

create table if not exists public.ai_provider_settings (
  id smallint primary key default 1 check (id = 1),
  provider text not null check (provider in ('anthropic', 'openai', 'xai', 'google')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
  key_ciphertext text not null check (char_length(key_ciphertext) between 16 and 2000),
  key_iv text not null check (char_length(key_iv) between 8 and 64),
  key_tag text not null check (char_length(key_tag) between 8 and 64),
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{16}$'),
  key_hint text not null check (char_length(key_hint) <= 8),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);
alter table public.ai_provider_settings enable row level security;
revoke all on public.ai_provider_settings from public, anon, authenticated;
grant select, insert, update, delete on public.ai_provider_settings to service_role;

-- Who saved, viewed, tested or removed the key, and failed PIN entries. The actor id is kept even if
-- the account is later deleted.
create table if not exists public.ai_settings_audit_events (
  id bigint generated always as identity primary key,
  action text not null check (action in ('saved', 'model_changed', 'revealed', 'removed', 'tested', 'pin_failed', 'pin_locked')),
  provider text check (provider is null or provider in ('anthropic', 'openai', 'xai', 'google')),
  actor_user_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists ai_settings_audit_events_created_idx on public.ai_settings_audit_events (created_at desc);
alter table public.ai_settings_audit_events enable row level security;
revoke all on public.ai_settings_audit_events from public, anon, authenticated;
grant select, insert on public.ai_settings_audit_events to service_role;

-- Activity records are permanent: not even the server can change or delete them.
create or replace function public.prevent_ai_settings_audit_change()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception using errcode = '42501', message = 'AI settings activity records cannot be changed or deleted.';
end;
$$;
drop trigger if exists prevent_ai_settings_audit_change on public.ai_settings_audit_events;
create trigger prevent_ai_settings_audit_change
before update or delete on public.ai_settings_audit_events
for each row execute function public.prevent_ai_settings_audit_change();
