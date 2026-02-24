begin;

create table if not exists public.instruction_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, instruction_id)
);

create index if not exists instruction_likes_instruction_idx
  on public.instruction_likes (instruction_id, created_at desc);

create index if not exists instruction_likes_user_idx
  on public.instruction_likes (user_id, created_at desc);

alter table public.instruction_likes enable row level security;

drop policy if exists instruction_likes_select_authenticated on public.instruction_likes;
create policy instruction_likes_select_authenticated
on public.instruction_likes
for select
to authenticated
using (true);

drop policy if exists instruction_likes_insert_self on public.instruction_likes;
create policy instruction_likes_insert_self
on public.instruction_likes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists instruction_likes_delete_self on public.instruction_likes;
create policy instruction_likes_delete_self
on public.instruction_likes
for delete
to authenticated
using ((select auth.uid()) = user_id);

alter table public.profiles
  add column if not exists authored_likes_seen_at timestamptz;

update public.profiles
set authored_likes_seen_at = coalesce(authored_likes_seen_at, timezone('utc', now()));

alter table public.profiles
  alter column authored_likes_seen_at set default timezone('utc', now()),
  alter column authored_likes_seen_at set not null;

commit;