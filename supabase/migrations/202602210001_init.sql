begin;

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('system_admin', 'admin', 'user');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_type') THEN
    CREATE TYPE public.media_type AS ENUM ('image', 'video');
  END IF;
END
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.app_role not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_security (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null default crypt(encode(gen_random_bytes(16), 'hex'), gen_salt('bf')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  drop column if exists pin_hash;

insert into public.user_security (user_id)
select p.id
from public.profiles p
on conflict (user_id) do nothing;

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  part_number text not null,
  mold_number text not null default '',
  item_title text not null,
  description text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(part_number, mold_number, item_title)
);

create index if not exists work_items_part_number_idx
  on public.work_items (part_number);

create index if not exists work_items_mold_number_idx
  on public.work_items (mold_number);

create table if not exists public.work_instructions (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  title text not null,
  body_markdown text not null default '',
  notes_markdown text not null default '',
  version integer not null default 1 check (version > 0),
  is_archived boolean not null default false,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists work_instructions_work_item_idx
  on public.work_instructions (work_item_id);

create table if not exists public.instruction_media (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  media_type public.media_type not null,
  caption text,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists instruction_media_instruction_idx
  on public.instruction_media (instruction_id, sort_order);

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists password_reset_tokens_user_id_idx
  on public.password_reset_tokens (user_id);

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

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do update
  set email = excluded.email;

  insert into public.user_security (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = lower(new.email)
  where id = new.id;

  return new;
end;
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'system_admin'), false);
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'system_admin', false);
$$;

create or replace function public.enforce_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if auth.uid() <> old.id and not public.is_system_admin() then
      raise exception 'You are not allowed to update this profile';
    end if;

    if not public.is_system_admin() and new.role is distinct from old.role then
      raise exception 'Only system_admin can change roles';
    end if;

    if not public.is_system_admin() and new.is_active is distinct from old.is_active then
      raise exception 'Only system_admin can change active status';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.set_my_pin(new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_pin is null or new_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  update public.user_security
  set pin_hash = crypt(new_pin, gen_salt('bf'))
  where user_id = auth.uid();

  if not found then
    raise exception 'User security record not found';
  end if;
end;
$$;

create or replace function public.set_user_pin(target_user_id uuid, new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_pin is null or new_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  if auth.role() <> 'service_role' and not public.is_system_admin() then
    raise exception 'Not authorized to set user pin';
  end if;

  update public.user_security
  set pin_hash = crypt(new_pin, gen_salt('bf'))
  where user_id = target_user_id;

  if not found then
    raise exception 'Target user security record not found';
  end if;
end;
$$;

create or replace function public.verify_pin_login(login_email text, submitted_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user_id uuid;
begin
  if login_email is null or submitted_pin is null then
    return null;
  end if;

  if submitted_pin !~ '^[0-9]{6}$' then
    return null;
  end if;

  select p.id
  into matched_user_id
  from public.profiles p
  join public.user_security s
    on s.user_id = p.id
  where lower(p.email) = lower(login_email)
    and p.is_active = true
    and s.pin_hash = crypt(submitted_pin, s.pin_hash)
  limit 1;

  return matched_user_id;
end;
$$;

revoke execute on function public.verify_pin_login(text, text) from public;
revoke execute on function public.set_user_pin(uuid, text) from public;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_editor() to authenticated;
grant execute on function public.is_system_admin() to authenticated;
grant execute on function public.set_my_pin(text) to authenticated;
grant execute on function public.set_user_pin(uuid, text) to authenticated, service_role;
grant execute on function public.verify_pin_login(text, text) to service_role;

drop trigger if exists on_profiles_updated on public.profiles;
create trigger on_profiles_updated
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists on_user_security_updated on public.user_security;
create trigger on_user_security_updated
before update on public.user_security
for each row
execute function public.set_updated_at();

drop trigger if exists on_profiles_enforce on public.profiles;
create trigger on_profiles_enforce
before update on public.profiles
for each row
execute function public.enforce_profile_mutation();

drop trigger if exists on_work_items_updated on public.work_items;
create trigger on_work_items_updated
before update on public.work_items
for each row
execute function public.set_updated_at();

drop trigger if exists on_work_instructions_updated on public.work_instructions;
create trigger on_work_instructions_updated
before update on public.work_instructions
for each row
execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_auth_user_created();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
after update of email on auth.users
for each row
execute function public.handle_auth_user_updated();

alter table public.profiles enable row level security;
alter table public.user_security enable row level security;
alter table public.work_items enable row level security;
alter table public.work_instructions enable row level security;
alter table public.instruction_media enable row level security;
alter table public.password_reset_tokens enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id or (select public.is_system_admin()))
with check ((select auth.uid()) = id or (select public.is_system_admin()));

drop policy if exists user_security_service_role on public.user_security;
create policy user_security_service_role
on public.user_security
for all
to service_role
using (true)
with check (true);

drop policy if exists work_items_select_authenticated on public.work_items;
create policy work_items_select_authenticated
on public.work_items
for select
to authenticated
using (true);

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

drop policy if exists work_instructions_select_authenticated on public.work_instructions;
create policy work_instructions_select_authenticated
on public.work_instructions
for select
to authenticated
using (true);

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

drop policy if exists instruction_media_select_authenticated on public.instruction_media;
create policy instruction_media_select_authenticated
on public.instruction_media
for select
to authenticated
using (true);

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

drop policy if exists password_reset_tokens_service_role on public.password_reset_tokens;
create policy password_reset_tokens_service_role
on public.password_reset_tokens
for all
to service_role
using (true)
with check (true);

insert into storage.buckets (id, name, public, file_size_limit)
values ('instruction-media', 'instruction-media', true, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists storage_instruction_media_read on storage.objects;
create policy storage_instruction_media_read
on storage.objects
for select
to authenticated
using (bucket_id = 'instruction-media');

drop policy if exists storage_instruction_media_insert on storage.objects;
create policy storage_instruction_media_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'instruction-media'
  and public.is_editor()
);

drop policy if exists storage_instruction_media_update on storage.objects;
create policy storage_instruction_media_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'instruction-media'
  and public.is_editor()
)
with check (
  bucket_id = 'instruction-media'
  and public.is_editor()
);

drop policy if exists storage_instruction_media_delete on storage.objects;
create policy storage_instruction_media_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'instruction-media'
  and public.is_editor()
);

commit;
