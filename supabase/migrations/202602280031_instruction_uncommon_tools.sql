begin;

alter table public.work_instructions
  add column if not exists uncommon_tools text not null default '';

commit;
