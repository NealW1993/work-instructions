begin;

alter table public.profiles
  add column if not exists icon_color text;

update public.profiles
set icon_color = '#0EA5E9'
where icon_color is null
  or btrim(icon_color) = '';

alter table public.profiles
  alter column icon_color set default '#0EA5E9';

alter table public.profiles
  alter column icon_color set not null;

alter table public.profiles
  drop constraint if exists profiles_icon_color_valid_check;

alter table public.profiles
  add constraint profiles_icon_color_valid_check
  check (icon_color ~ '^#[0-9A-Fa-f]{6}$');

commit;
