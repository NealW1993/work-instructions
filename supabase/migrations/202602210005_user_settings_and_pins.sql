begin;

alter table public.profiles
  add column if not exists theme_preference text not null default 'dark';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_theme_preference_check'
  ) then
    alter table public.profiles
      add constraint profiles_theme_preference_check
      check (theme_preference in ('light', 'dark'));
  end if;
end
$$;

create table if not exists public.user_pinned_instructions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, instruction_id)
);

create index if not exists user_pinned_instructions_user_idx
  on public.user_pinned_instructions (user_id, created_at desc);

create index if not exists user_pinned_instructions_instruction_idx
  on public.user_pinned_instructions (instruction_id);

alter table public.user_pinned_instructions enable row level security;

drop policy if exists user_pinned_instructions_select_self on public.user_pinned_instructions;
create policy user_pinned_instructions_select_self
on public.user_pinned_instructions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_pinned_instructions_insert_self on public.user_pinned_instructions;
create policy user_pinned_instructions_insert_self
on public.user_pinned_instructions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_pinned_instructions_delete_self on public.user_pinned_instructions;
create policy user_pinned_instructions_delete_self
on public.user_pinned_instructions
for delete
to authenticated
using ((select auth.uid()) = user_id);

commit;
