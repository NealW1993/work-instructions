begin;

create table if not exists public.suggested_tool_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint suggested_tool_categories_name_not_blank
    check (char_length(btrim(name)) > 0)
);

create unique index if not exists suggested_tool_categories_unique_name_idx
  on public.suggested_tool_categories ((lower(btrim(name))));

create index if not exists suggested_tool_categories_sort_idx
  on public.suggested_tool_categories (sort_order, name);

drop trigger if exists on_suggested_tool_categories_updated on public.suggested_tool_categories;
create trigger on_suggested_tool_categories_updated
before update on public.suggested_tool_categories
for each row
execute function public.set_updated_at();

create table if not exists public.suggested_tool_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.suggested_tool_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint suggested_tool_subcategories_name_not_blank
    check (char_length(btrim(name)) > 0)
);

create unique index if not exists suggested_tool_subcategories_unique_name_per_category_idx
  on public.suggested_tool_subcategories (category_id, (lower(btrim(name))));

create index if not exists suggested_tool_subcategories_sort_idx
  on public.suggested_tool_subcategories (category_id, sort_order, name);

drop trigger if exists on_suggested_tool_subcategories_updated on public.suggested_tool_subcategories;
create trigger on_suggested_tool_subcategories_updated
before update on public.suggested_tool_subcategories
for each row
execute function public.set_updated_at();

alter table public.suggested_tools
  add column if not exists category_id uuid references public.suggested_tool_categories(id) on delete restrict,
  add column if not exists subcategory_id uuid references public.suggested_tool_subcategories(id) on delete restrict,
  add column if not exists sort_order integer not null default 0;

insert into public.suggested_tool_categories (name, sort_order)
select distinct
  btrim(st.tool_type) as name,
  row_number() over (order by lower(btrim(st.tool_type))) - 1 as sort_order
from public.suggested_tools st
where char_length(btrim(coalesce(st.tool_type, ''))) > 0
on conflict do nothing;

insert into public.suggested_tool_categories (name, sort_order)
values ('General', 999)
on conflict do nothing;

update public.suggested_tools st
set category_id = stc.id
from public.suggested_tool_categories stc
where st.category_id is null
  and lower(btrim(st.tool_type)) = lower(btrim(stc.name));

update public.suggested_tools st
set category_id = stc.id
from public.suggested_tool_categories stc
where st.category_id is null
  and lower(btrim(stc.name)) = lower('General');

alter table public.suggested_tools
  alter column category_id set not null;

drop index if exists public.suggested_tools_unique_name_type_idx;

drop index if exists public.suggested_tools_tool_type_idx;

alter table public.suggested_tools
  drop column if exists tool_type;

create unique index if not exists suggested_tools_unique_name_category_subcategory_idx
  on public.suggested_tools (
    (lower(btrim(name))),
    category_id,
    coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists suggested_tools_category_sort_idx
  on public.suggested_tools (category_id, subcategory_id, sort_order, name);

create or replace function public.enforce_suggested_tool_subcategory_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subcategory_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.suggested_tool_subcategories stsc
    where stsc.id = new.subcategory_id
      and stsc.category_id = new.category_id
  ) then
    raise exception 'Suggested tool subcategory does not belong to selected category';
  end if;

  return new;
end;
$$;

drop trigger if exists on_suggested_tools_enforce_subcategory on public.suggested_tools;
create trigger on_suggested_tools_enforce_subcategory
before insert or update on public.suggested_tools
for each row
execute function public.enforce_suggested_tool_subcategory_match();

create table if not exists public.instruction_suggested_tools (
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  suggested_tool_id uuid not null references public.suggested_tools(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (instruction_id, suggested_tool_id)
);

create index if not exists instruction_suggested_tools_instruction_idx
  on public.instruction_suggested_tools (instruction_id, created_at desc);

create index if not exists instruction_suggested_tools_tool_idx
  on public.instruction_suggested_tools (suggested_tool_id, created_at desc);

alter table public.suggested_tool_categories enable row level security;
alter table public.suggested_tool_subcategories enable row level security;
alter table public.suggested_tools enable row level security;
alter table public.instruction_suggested_tools enable row level security;

drop policy if exists suggested_tool_categories_select_authenticated on public.suggested_tool_categories;
create policy suggested_tool_categories_select_authenticated
on public.suggested_tool_categories
for select
to authenticated
using (true);

drop policy if exists suggested_tool_categories_insert_editors on public.suggested_tool_categories;
create policy suggested_tool_categories_insert_editors
on public.suggested_tool_categories
for insert
to authenticated
with check ((select public.is_editor()));

drop policy if exists suggested_tool_categories_update_system_admin on public.suggested_tool_categories;
create policy suggested_tool_categories_update_system_admin
on public.suggested_tool_categories
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists suggested_tool_categories_delete_system_admin on public.suggested_tool_categories;
create policy suggested_tool_categories_delete_system_admin
on public.suggested_tool_categories
for delete
to authenticated
using ((select public.is_system_admin()));

drop policy if exists suggested_tool_subcategories_select_authenticated on public.suggested_tool_subcategories;
create policy suggested_tool_subcategories_select_authenticated
on public.suggested_tool_subcategories
for select
to authenticated
using (true);

drop policy if exists suggested_tool_subcategories_insert_editors on public.suggested_tool_subcategories;
create policy suggested_tool_subcategories_insert_editors
on public.suggested_tool_subcategories
for insert
to authenticated
with check ((select public.is_editor()));

drop policy if exists suggested_tool_subcategories_update_system_admin on public.suggested_tool_subcategories;
create policy suggested_tool_subcategories_update_system_admin
on public.suggested_tool_subcategories
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists suggested_tool_subcategories_delete_system_admin on public.suggested_tool_subcategories;
create policy suggested_tool_subcategories_delete_system_admin
on public.suggested_tool_subcategories
for delete
to authenticated
using ((select public.is_system_admin()));

drop policy if exists suggested_tools_select_authenticated on public.suggested_tools;
create policy suggested_tools_select_authenticated
on public.suggested_tools
for select
to authenticated
using (true);

drop policy if exists suggested_tools_insert_editors on public.suggested_tools;
drop policy if exists suggested_tools_insert_system_admin on public.suggested_tools;
create policy suggested_tools_insert_editors
on public.suggested_tools
for insert
to authenticated
with check ((select public.is_editor()));

drop policy if exists suggested_tools_update_system_admin on public.suggested_tools;
create policy suggested_tools_update_system_admin
on public.suggested_tools
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists suggested_tools_delete_system_admin on public.suggested_tools;
create policy suggested_tools_delete_system_admin
on public.suggested_tools
for delete
to authenticated
using ((select public.is_system_admin()));

drop policy if exists instruction_suggested_tools_select_authenticated on public.instruction_suggested_tools;
create policy instruction_suggested_tools_select_authenticated
on public.instruction_suggested_tools
for select
to authenticated
using (true);

drop policy if exists instruction_suggested_tools_insert_editors on public.instruction_suggested_tools;
create policy instruction_suggested_tools_insert_editors
on public.instruction_suggested_tools
for insert
to authenticated
with check ((select public.is_editor()) and created_by = (select auth.uid()));

drop policy if exists instruction_suggested_tools_delete_editors on public.instruction_suggested_tools;
create policy instruction_suggested_tools_delete_editors
on public.instruction_suggested_tools
for delete
to authenticated
using ((select public.is_editor()));

commit;
