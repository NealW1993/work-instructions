begin;

alter table public.departments
  add column if not exists sort_order integer;

alter table public.departments
  add column if not exists color_hex text;

with ordered_departments as (
  select
    id,
    row_number() over (order by lower(name), created_at, id) - 1 as next_sort_order
  from public.departments
)
update public.departments as departments
set sort_order = ordered_departments.next_sort_order
from ordered_departments
where departments.id = ordered_departments.id
  and departments.sort_order is null;

with ordered_departments as (
  select
    id,
    row_number() over (
      order by coalesce(sort_order, 2147483647), lower(name), created_at, id
    ) - 1 as seq
  from public.departments
)
update public.departments as departments
set color_hex =
  case (ordered_departments.seq % 12)
    when 0 then '#0EA5E9'
    when 1 then '#22C55E'
    when 2 then '#F97316'
    when 3 then '#A855F7'
    when 4 then '#EAB308'
    when 5 then '#14B8A6'
    when 6 then '#EF4444'
    when 7 then '#8B5CF6'
    when 8 then '#06B6D4'
    when 9 then '#84CC16'
    when 10 then '#F43F5E'
    else '#3B82F6'
  end
from ordered_departments
where departments.id = ordered_departments.id
  and (departments.color_hex is null or btrim(departments.color_hex) = '');

alter table public.departments
  alter column sort_order set default 0;

update public.departments
set sort_order = 0
where sort_order is null;

alter table public.departments
  alter column sort_order set not null;

alter table public.departments
  alter column color_hex set default '#0EA5E9';

update public.departments
set color_hex = '#0EA5E9'
where color_hex is null
  or btrim(color_hex) = '';

alter table public.departments
  alter column color_hex set not null;

alter table public.departments
  drop constraint if exists departments_color_hex_valid_check;

alter table public.departments
  add constraint departments_color_hex_valid_check
  check (color_hex ~ '^#[0-9A-Fa-f]{6}$');

create index if not exists departments_sort_order_idx
  on public.departments (sort_order, lower(name));

commit;
