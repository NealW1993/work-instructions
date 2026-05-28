begin;

alter table public.process_map_formulas
  drop constraint if exists process_map_formulas_type_check;

alter table public.process_map_formulas
  add constraint process_map_formulas_type_check check (
    formula_type in (
      'oee',
      'capability',
      'dpmo',
      'takt',
      'yield',
      'little_law',
      'normal_curve',
      'control_limits',
      'custom'
    )
  );

create index if not exists process_map_formulas_custom_approval_idx
  on public.process_map_formulas ((payload #>> '{customFormula,approvalStatus}'), updated_at desc)
  where formula_type = 'custom';

create table if not exists public.work_instruction_import_files (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  file_name text not null,
  content_type text not null default 'application/octet-stream',
  file_size bigint not null default 0 check (file_size >= 0),
  content_base64 text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint work_instruction_import_files_file_name_not_blank check (btrim(file_name) <> ''),
  constraint work_instruction_import_files_content_not_blank check (btrim(content_base64) <> '')
);

create index if not exists work_instruction_import_files_instruction_idx
  on public.work_instruction_import_files (instruction_id, created_at desc);

alter table public.work_instruction_import_files enable row level security;

drop policy if exists work_instruction_import_files_select_controlled
  on public.work_instruction_import_files;
create policy work_instruction_import_files_select_controlled
on public.work_instruction_import_files
for select
to authenticated
using (
  exists (
    select 1
    from public.work_instructions instruction
    where instruction.id = work_instruction_import_files.instruction_id
  )
);

drop policy if exists work_instruction_import_files_insert_authors_or_editors
  on public.work_instruction_import_files;
create policy work_instruction_import_files_insert_authors_or_editors
on public.work_instruction_import_files
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.work_instructions instruction
    where instruction.id = work_instruction_import_files.instruction_id
      and (
        instruction.created_by = auth.uid()
        or instruction.updated_by = auth.uid()
        or (select public.is_editor())
      )
  )
);

drop policy if exists work_instruction_import_files_delete_editors
  on public.work_instruction_import_files;
create policy work_instruction_import_files_delete_editors
on public.work_instruction_import_files
for delete
to authenticated
using ((select public.is_editor()));

commit;
