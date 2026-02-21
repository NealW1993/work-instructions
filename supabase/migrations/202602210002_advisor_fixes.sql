begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id or (select public.is_system_admin()))
with check ((select auth.uid()) = id or (select public.is_system_admin()));

drop policy if exists work_items_insert_editors on public.work_items;
create policy work_items_insert_editors
on public.work_items
for insert
to authenticated
with check ((select public.is_editor()) and created_by = (select auth.uid()));

drop policy if exists work_items_update_editors on public.work_items;
create policy work_items_update_editors
on public.work_items
for update
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists work_items_delete_editors on public.work_items;
create policy work_items_delete_editors
on public.work_items
for delete
to authenticated
using ((select public.is_editor()));

drop policy if exists work_instructions_insert_editors on public.work_instructions;
create policy work_instructions_insert_editors
on public.work_instructions
for insert
to authenticated
with check (
  (select public.is_editor())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists work_instructions_update_editors on public.work_instructions;
create policy work_instructions_update_editors
on public.work_instructions
for update
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists work_instructions_delete_editors on public.work_instructions;
create policy work_instructions_delete_editors
on public.work_instructions
for delete
to authenticated
using ((select public.is_editor()));

drop policy if exists instruction_media_insert_editors on public.instruction_media;
create policy instruction_media_insert_editors
on public.instruction_media
for insert
to authenticated
with check ((select public.is_editor()) and created_by = (select auth.uid()));

drop policy if exists instruction_media_update_editors on public.instruction_media;
create policy instruction_media_update_editors
on public.instruction_media
for update
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists instruction_media_delete_editors on public.instruction_media;
create policy instruction_media_delete_editors
on public.instruction_media
for delete
to authenticated
using ((select public.is_editor()));

commit;