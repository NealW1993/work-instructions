begin;

alter table public.profiles
  add column if not exists dashboard_default_layout jsonb not null default '[]'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_dashboard_default_layout_array_check;

alter table public.profiles
  add constraint profiles_dashboard_default_layout_array_check
  check (jsonb_typeof(dashboard_default_layout) = 'array');

commit;
