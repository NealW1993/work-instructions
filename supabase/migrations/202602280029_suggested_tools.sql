begin;

create table if not exists public.suggested_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tool_type text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint suggested_tools_name_not_blank check (char_length(btrim(name)) > 0),
  constraint suggested_tools_type_not_blank check (char_length(btrim(tool_type)) > 0)
);

drop trigger if exists on_suggested_tools_updated on public.suggested_tools;
create trigger on_suggested_tools_updated
before update on public.suggested_tools
for each row
execute function public.set_updated_at();

create unique index if not exists suggested_tools_unique_name_type_idx
  on public.suggested_tools ((lower(btrim(name))), (lower(btrim(tool_type))));

create index if not exists suggested_tools_tool_type_idx
  on public.suggested_tools (tool_type);

alter table public.suggested_tools enable row level security;

drop policy if exists suggested_tools_select_authenticated on public.suggested_tools;
create policy suggested_tools_select_authenticated
on public.suggested_tools
for select
to authenticated
using (true);

drop policy if exists suggested_tools_insert_system_admin on public.suggested_tools;
create policy suggested_tools_insert_system_admin
on public.suggested_tools
for insert
to authenticated
with check ((select public.is_system_admin()));

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

commit;
