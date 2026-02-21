begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_instructions'
      and column_name = 'version'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_instructions'
      and column_name = 'revision'
  ) then
    alter table public.work_instructions
      rename column version to revision;
  end if;
end
$$;

alter table public.work_instructions
  drop constraint if exists work_instructions_version_check;

alter table public.work_instructions
  drop constraint if exists work_instructions_revision_check;

alter table public.work_instructions
  add constraint work_instructions_revision_check
  check (revision > 0);

alter table public.work_instructions
  alter column revision set not null,
  alter column revision set default 1;

alter table public.work_instructions
  drop column if exists title;

alter table public.work_items
  drop column if exists description;

commit;
