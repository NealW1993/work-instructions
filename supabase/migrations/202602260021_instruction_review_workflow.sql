begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'instruction_review_state'
  ) then
    create type public.instruction_review_state as enum ('up_to_date', 'needs_review');
  end if;
end
$$;

create table if not exists public.instruction_review_settings (
  id boolean primary key default true check (id),
  review_window_days integer not null default 30 check (review_window_days between 1 and 365),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.instruction_review_status (
  instruction_id uuid primary key references public.work_instructions(id) on delete cascade,
  status public.instruction_review_state not null default 'up_to_date',
  last_calibrated_at timestamptz not null default timezone('utc', now()),
  flagged_at timestamptz,
  flagged_by uuid references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists instruction_review_status_state_idx
  on public.instruction_review_status (status, updated_at desc);

create index if not exists instruction_review_status_flagged_idx
  on public.instruction_review_status (flagged_at desc)
  where flagged_at is not null;

drop trigger if exists on_instruction_review_settings_updated on public.instruction_review_settings;
create trigger on_instruction_review_settings_updated
before update on public.instruction_review_settings
for each row
execute function public.set_updated_at();

drop trigger if exists on_instruction_review_status_updated on public.instruction_review_status;
create trigger on_instruction_review_status_updated
before update on public.instruction_review_status
for each row
execute function public.set_updated_at();

alter table public.instruction_review_settings enable row level security;
alter table public.instruction_review_status enable row level security;

drop policy if exists instruction_review_settings_select_authenticated on public.instruction_review_settings;
create policy instruction_review_settings_select_authenticated
on public.instruction_review_settings
for select
to authenticated
using (true);

drop policy if exists instruction_review_settings_insert_system_admin on public.instruction_review_settings;
create policy instruction_review_settings_insert_system_admin
on public.instruction_review_settings
for insert
to authenticated
with check ((select public.is_system_admin()));

drop policy if exists instruction_review_settings_update_system_admin on public.instruction_review_settings;
create policy instruction_review_settings_update_system_admin
on public.instruction_review_settings
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists instruction_review_status_select_authenticated on public.instruction_review_status;
create policy instruction_review_status_select_authenticated
on public.instruction_review_status
for select
to authenticated
using (true);

create or replace function public.sync_instruction_review_status_from_instruction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  baseline_at timestamptz := coalesce(new.updated_at, new.created_at, timezone('utc', now()));
  actor_user_id uuid := coalesce(new.updated_by, new.created_by);
begin
  if TG_OP = 'UPDATE' then
    if old.work_item_id is not distinct from new.work_item_id
      and old.body_markdown is not distinct from new.body_markdown
      and old.notes_markdown is not distinct from new.notes_markdown
      and old.revision is not distinct from new.revision
      and coalesce(old.last_change_summary, '') = coalesce(new.last_change_summary, '')
    then
      return new;
    end if;
  end if;

  if actor_user_id is null then
    return new;
  end if;

  insert into public.instruction_review_status (
    instruction_id,
    status,
    last_calibrated_at,
    flagged_at,
    flagged_by,
    updated_by
  )
  values (
    new.id,
    'up_to_date',
    baseline_at,
    null,
    null,
    actor_user_id
  )
  on conflict (instruction_id) do update
  set
    status = 'up_to_date',
    last_calibrated_at = excluded.last_calibrated_at,
    flagged_at = null,
    flagged_by = null,
    updated_by = excluded.updated_by,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_work_instructions_sync_review_status on public.work_instructions;
create trigger on_work_instructions_sync_review_status
after insert or update on public.work_instructions
for each row
execute function public.sync_instruction_review_status_from_instruction();

insert into public.instruction_review_settings (id, review_window_days)
values (true, 30)
on conflict (id) do nothing;

insert into public.instruction_review_status (
  instruction_id,
  status,
  last_calibrated_at,
  flagged_at,
  flagged_by,
  updated_by
)
select
  wi.id,
  'up_to_date',
  coalesce(wi.updated_at, wi.created_at, timezone('utc', now())),
  null,
  null,
  coalesce(wi.updated_by, wi.created_by)
from public.work_instructions wi
where coalesce(wi.updated_by, wi.created_by) is not null
on conflict (instruction_id) do nothing;

commit;
