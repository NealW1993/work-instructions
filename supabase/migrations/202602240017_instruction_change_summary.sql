begin;

alter table public.work_instructions
  add column if not exists last_change_summary text;

commit;
