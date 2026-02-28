begin;

alter table public.work_instructions
  add column if not exists fork_root_instruction_id uuid references public.work_instructions(id) on delete set null,
  add column if not exists fork_number integer,
  add column if not exists merged_into_root_at timestamptz,
  add column if not exists merge_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_instructions_fork_number_check'
      and conrelid = 'public.work_instructions'::regclass
  ) then
    alter table public.work_instructions
      add constraint work_instructions_fork_number_check
      check (fork_number is null or fork_number > 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_instructions_fork_root_consistency_check'
      and conrelid = 'public.work_instructions'::regclass
  ) then
    alter table public.work_instructions
      add constraint work_instructions_fork_root_consistency_check
      check (
        (fork_root_instruction_id is null and fork_number is null)
        or (fork_root_instruction_id is not null and fork_number is not null)
      );
  end if;
end
$$;

create index if not exists work_instructions_fork_root_idx
  on public.work_instructions (fork_root_instruction_id, fork_number);

drop index if exists public.work_instructions_single_active_revision_idx;

create unique index if not exists work_instructions_single_active_root_revision_idx
  on public.work_instructions (work_item_id)
  where is_archived = false and fork_root_instruction_id is null;

create unique index if not exists work_instructions_single_active_fork_branch_idx
  on public.work_instructions (fork_root_instruction_id, fork_number)
  where is_archived = false and fork_root_instruction_id is not null and fork_number is not null;

commit;
