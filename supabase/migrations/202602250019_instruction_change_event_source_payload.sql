begin;

alter table public.instruction_change_events
  add column if not exists source_payload jsonb;

drop policy if exists instruction_change_events_update_editors on public.instruction_change_events;
create policy instruction_change_events_update_editors
on public.instruction_change_events
for update
to authenticated
using (
  (select public.is_editor())
  and actor_user_id = (select auth.uid())
)
with check (
  (select public.is_editor())
  and actor_user_id = (select auth.uid())
);

commit;
