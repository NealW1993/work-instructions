begin;

drop policy if exists work_instructions_delete_editors on public.work_instructions;
drop policy if exists work_instructions_delete_system_admin on public.work_instructions;

create policy work_instructions_delete_system_admin
on public.work_instructions
for delete
to authenticated
using ((select public.is_system_admin()));

commit;
