begin;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint departments_name_not_blank_check check (char_length(btrim(name)) > 0)
);

create unique index if not exists departments_name_unique_idx
  on public.departments (lower(name));

alter table public.departments enable row level security;

drop policy if exists departments_select_authenticated on public.departments;
create policy departments_select_authenticated
on public.departments
for select
to authenticated
using (true);

drop policy if exists departments_insert_system_admin on public.departments;
create policy departments_insert_system_admin
on public.departments
for insert
to authenticated
with check ((select public.is_system_admin()));

drop policy if exists departments_update_system_admin on public.departments;
create policy departments_update_system_admin
on public.departments
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists departments_delete_system_admin on public.departments;
create policy departments_delete_system_admin
on public.departments
for delete
to authenticated
using ((select public.is_system_admin()));

drop trigger if exists on_departments_updated on public.departments;
create trigger on_departments_updated
before update on public.departments
for each row
execute function public.set_updated_at();

insert into public.departments (name)
select 'General'
where not exists (
  select 1
  from public.departments
  where lower(name) = 'general'
);

alter table public.work_items
  add column if not exists department_id uuid references public.departments(id);

with general_department as (
  select id
  from public.departments
  where lower(name) = 'general'
  order by created_at asc
  limit 1
)
update public.work_items wi
set department_id = gd.id
from general_department gd
where wi.department_id is null;

alter table public.work_items
  alter column department_id set not null;

create index if not exists work_items_department_id_idx
  on public.work_items (department_id);

alter table public.work_items
  drop constraint if exists work_items_part_number_mold_number_item_title_key;

alter table public.work_items
  drop constraint if exists work_items_part_mold_title_department_key;

alter table public.work_items
  add constraint work_items_part_mold_title_department_key
  unique (part_number, mold_number, item_title, department_id);

commit;
