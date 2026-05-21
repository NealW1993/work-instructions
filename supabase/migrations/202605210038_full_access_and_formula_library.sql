begin;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'system_admin'), false);
$$;

create table if not exists public.process_map_formulas (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  formula_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint process_map_formulas_name_not_blank check (btrim(name) <> ''),
  constraint process_map_formulas_type_check check (
    formula_type in ('oee', 'capability', 'dpmo', 'takt')
  )
);

create index if not exists process_map_formulas_owner_updated_idx
  on public.process_map_formulas (owner_user_id, updated_at desc);

create index if not exists process_map_formulas_type_idx
  on public.process_map_formulas (formula_type, updated_at desc);

drop trigger if exists on_process_map_formulas_updated on public.process_map_formulas;
create trigger on_process_map_formulas_updated
before update on public.process_map_formulas
for each row
execute function public.set_updated_at();

alter table public.process_map_formulas enable row level security;

drop policy if exists process_map_formulas_select_owner_or_editor on public.process_map_formulas;
create policy process_map_formulas_select_owner_or_editor
on public.process_map_formulas
for select
to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_editor()));

drop policy if exists process_map_formulas_insert_owner on public.process_map_formulas;
create policy process_map_formulas_insert_owner
on public.process_map_formulas
for insert
to authenticated
with check (owner_user_id = (select auth.uid()) or (select public.is_editor()));

drop policy if exists process_map_formulas_update_owner_or_editor on public.process_map_formulas;
create policy process_map_formulas_update_owner_or_editor
on public.process_map_formulas
for update
to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_editor()))
with check (owner_user_id = (select auth.uid()) or (select public.is_editor()));

drop policy if exists process_map_formulas_delete_owner_or_editor on public.process_map_formulas;
create policy process_map_formulas_delete_owner_or_editor
on public.process_map_formulas
for delete
to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_editor()));

commit;
