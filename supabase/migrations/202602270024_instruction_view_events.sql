begin;

create table if not exists public.instruction_view_events (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  viewer_user_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default timezone('utc', now())
);

create index if not exists instruction_view_events_instruction_idx
  on public.instruction_view_events (instruction_id, viewed_at desc);

create index if not exists instruction_view_events_viewer_idx
  on public.instruction_view_events (viewer_user_id, viewed_at desc);

create index if not exists instruction_view_events_viewed_at_idx
  on public.instruction_view_events (viewed_at desc);

alter table public.instruction_view_events enable row level security;

drop policy if exists instruction_view_events_select_system_admin on public.instruction_view_events;
create policy instruction_view_events_select_system_admin
on public.instruction_view_events
for select
to authenticated
using ((select public.is_system_admin()));

drop policy if exists instruction_view_events_insert_self on public.instruction_view_events;
create policy instruction_view_events_insert_self
on public.instruction_view_events
for insert
to authenticated
with check ((select auth.uid()) = viewer_user_id);

commit;
