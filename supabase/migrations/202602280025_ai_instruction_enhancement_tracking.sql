begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'instruction_ai_enhancement_outcome'
  ) then
    create type public.instruction_ai_enhancement_outcome as enum (
      'generated',
      'applied',
      'discarded'
    );
  end if;
end
$$;

create table if not exists public.instruction_ai_enhancements (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  instruction_id uuid references public.work_instructions(id) on delete set null,
  source_instruction_id uuid references public.work_instructions(id) on delete set null,
  mode text not null check (mode in ('create', 'edit', 'fork')),
  part_id text not null default '',
  item_title text not null default '',
  department_name text not null default '',
  revision integer check (revision is null or revision > 0),
  outcome public.instruction_ai_enhancement_outcome not null default 'generated',
  generated_at timestamptz not null default timezone('utc', now()),
  outcome_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists instruction_ai_enhancements_actor_idx
  on public.instruction_ai_enhancements (actor_user_id, generated_at desc);

create index if not exists instruction_ai_enhancements_outcome_idx
  on public.instruction_ai_enhancements (outcome, generated_at desc);

create index if not exists instruction_ai_enhancements_instruction_idx
  on public.instruction_ai_enhancements (instruction_id, generated_at desc);

drop trigger if exists on_instruction_ai_enhancements_updated on public.instruction_ai_enhancements;
create trigger on_instruction_ai_enhancements_updated
before update on public.instruction_ai_enhancements
for each row
execute function public.set_updated_at();

alter table public.instruction_ai_enhancements enable row level security;

drop policy if exists instruction_ai_enhancements_select_actor_or_system_admin on public.instruction_ai_enhancements;
create policy instruction_ai_enhancements_select_actor_or_system_admin
on public.instruction_ai_enhancements
for select
to authenticated
using (
  actor_user_id = (select auth.uid())
  or (select public.is_system_admin())
);

drop policy if exists instruction_ai_enhancements_insert_actor on public.instruction_ai_enhancements;
create policy instruction_ai_enhancements_insert_actor
on public.instruction_ai_enhancements
for insert
to authenticated
with check (
  (select public.is_editor())
  and actor_user_id = (select auth.uid())
);

drop policy if exists instruction_ai_enhancements_update_actor on public.instruction_ai_enhancements;
create policy instruction_ai_enhancements_update_actor
on public.instruction_ai_enhancements
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

drop policy if exists instruction_ai_enhancements_delete_system_admin on public.instruction_ai_enhancements;
create policy instruction_ai_enhancements_delete_system_admin
on public.instruction_ai_enhancements
for delete
to authenticated
using ((select public.is_system_admin()));

alter table public.work_instructions
  add column if not exists ai_assisted boolean not null default false,
  add column if not exists ai_assisted_at timestamptz,
  add column if not exists ai_assistance_last_event_id uuid references public.instruction_ai_enhancements(id) on delete set null;

create index if not exists work_instructions_ai_assisted_idx
  on public.work_instructions (ai_assisted, created_at desc);

commit;
