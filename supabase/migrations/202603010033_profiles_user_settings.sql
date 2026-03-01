begin;

alter table public.profiles
  add column if not exists user_settings jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_user_settings_object_check;

alter table public.profiles
  add constraint profiles_user_settings_object_check
  check (jsonb_typeof(user_settings) = 'object');

commit;
