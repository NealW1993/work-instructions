begin;

alter table public.suggested_tools
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

update public.suggested_tools
set is_active = true
where is_active is null;

create index if not exists suggested_tools_active_name_idx
  on public.suggested_tools (is_active, name);

commit;
