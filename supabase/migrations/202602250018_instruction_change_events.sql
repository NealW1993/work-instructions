begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'instruction_change_event_type'
  ) then
    create type public.instruction_change_event_type as enum ('created', 'updated');
  end if;
end
$$;

create table if not exists public.instruction_change_events (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id),
  event_type public.instruction_change_event_type not null,
  detail text not null default '',
  revision integer not null check (revision > 0),
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists instruction_change_events_instruction_idx
  on public.instruction_change_events (instruction_id, occurred_at desc);

create index if not exists instruction_change_events_occurred_idx
  on public.instruction_change_events (occurred_at desc);

create index if not exists instruction_change_events_actor_idx
  on public.instruction_change_events (actor_user_id, occurred_at desc);

create unique index if not exists instruction_change_events_dedupe_idx
  on public.instruction_change_events (instruction_id, event_type, actor_user_id, occurred_at);

alter table public.instruction_change_events enable row level security;

drop policy if exists instruction_change_events_select_authenticated on public.instruction_change_events;
create policy instruction_change_events_select_authenticated
on public.instruction_change_events
for select
to authenticated
using (true);

drop policy if exists instruction_change_events_insert_editors on public.instruction_change_events;
create policy instruction_change_events_insert_editors
on public.instruction_change_events
for insert
to authenticated
with check (
  (select public.is_editor())
  and actor_user_id = (select auth.uid())
);

drop policy if exists instruction_change_events_delete_system_admin on public.instruction_change_events;
create policy instruction_change_events_delete_system_admin
on public.instruction_change_events
for delete
to authenticated
using ((select public.is_system_admin()));

create or replace function public.log_instruction_change_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_detail text;
begin
  if TG_OP = 'UPDATE' then
    if old.work_item_id is not distinct from new.work_item_id
      and old.body_markdown is not distinct from new.body_markdown
      and old.notes_markdown is not distinct from new.notes_markdown
      and old.revision is not distinct from new.revision
      and coalesce(old.last_change_summary, '') = coalesce(new.last_change_summary, '')
      and old.updated_by is not distinct from new.updated_by
    then
      return new;
    end if;
  end if;

  if TG_OP = 'INSERT' then
    resolved_detail := coalesce(
      nullif(trim(new.last_change_summary), ''),
      format('Revision %s created.', coalesce(new.revision, 1))
    );

    insert into public.instruction_change_events (
      instruction_id,
      actor_user_id,
      event_type,
      detail,
      revision,
      occurred_at
    )
    values (
      new.id,
      coalesce(new.created_by, new.updated_by),
      'created',
      resolved_detail,
      coalesce(new.revision, 1),
      coalesce(new.created_at, timezone('utc', now()))
    )
    on conflict do nothing;

    return new;
  end if;

  resolved_detail := coalesce(
    nullif(trim(new.last_change_summary), ''),
    'Instruction content updated.'
  );

  insert into public.instruction_change_events (
    instruction_id,
    actor_user_id,
    event_type,
    detail,
    revision,
    occurred_at
  )
  values (
    new.id,
    coalesce(new.updated_by, new.created_by),
    'updated',
    resolved_detail,
    coalesce(new.revision, 1),
    coalesce(new.updated_at, timezone('utc', now()))
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_work_instructions_change_event on public.work_instructions;
create trigger on_work_instructions_change_event
after insert or update on public.work_instructions
for each row
execute function public.log_instruction_change_event();

insert into public.instruction_change_events (
  instruction_id,
  actor_user_id,
  event_type,
  detail,
  revision,
  occurred_at
)
select
  wi.id,
  wi.created_by,
  'created',
  format('Revision %s created.', wi.revision),
  wi.revision,
  wi.created_at
from public.work_instructions wi
on conflict do nothing;

insert into public.instruction_change_events (
  instruction_id,
  actor_user_id,
  event_type,
  detail,
  revision,
  occurred_at
)
select
  wi.id,
  wi.updated_by,
  'updated',
  coalesce(
    nullif(trim(wi.last_change_summary), ''),
    format('Revision %s updated.', wi.revision)
  ),
  wi.revision,
  wi.updated_at
from public.work_instructions wi
where wi.updated_at > wi.created_at + interval '1 second'
  or wi.updated_by <> wi.created_by
  or wi.revision > 1
on conflict do nothing;

commit;
