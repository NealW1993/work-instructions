begin;

alter table public.profiles
  add column if not exists font_color text;

update public.profiles
set font_color = '#FFFFFF'
where font_color is null
  or btrim(font_color) = '';

alter table public.profiles
  alter column font_color set default '#FFFFFF';

alter table public.profiles
  alter column font_color set not null;

alter table public.profiles
  drop constraint if exists profiles_font_color_valid_check;

alter table public.profiles
  add constraint profiles_font_color_valid_check
  check (font_color ~ '^#[0-9A-Fa-f]{6}$');

commit;
