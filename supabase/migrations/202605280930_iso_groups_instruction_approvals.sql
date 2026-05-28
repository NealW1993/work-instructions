begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'instruction_approval_status'
  ) then
    create type public.instruction_approval_status as enum (
      'draft',
      'pending_review',
      'approved',
      'rejected'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'access_group_join_request_status'
  ) then
    create type public.access_group_join_request_status as enum (
      'pending',
      'approved',
      'rejected',
      'cancelled'
    );
  end if;
end
$$;

do $$
declare
  approval_column_exists boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_instructions'
      and column_name = 'approval_status'
  )
  into approval_column_exists;

  if not approval_column_exists then
    alter table public.work_instructions
      add column approval_status public.instruction_approval_status not null default 'approved',
      add column submitted_by uuid references public.profiles(id) on delete set null,
      add column submitted_at timestamptz,
      add column approved_by uuid references public.profiles(id) on delete set null,
      add column approved_at timestamptz,
      add column rejected_by uuid references public.profiles(id) on delete set null,
      add column rejected_at timestamptz,
      add column approval_note text not null default '';

    update public.work_instructions
    set
      approval_status = 'approved',
      submitted_by = coalesce(created_by, updated_by),
      submitted_at = created_at,
      approved_by = coalesce(updated_by, created_by),
      approved_at = coalesce(updated_at, created_at),
      rejected_by = null,
      rejected_at = null,
      approval_note = ''
    where approval_status = 'approved';
  else
    alter table public.work_instructions
      add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
      add column if not exists submitted_at timestamptz,
      add column if not exists approved_by uuid references public.profiles(id) on delete set null,
      add column if not exists approved_at timestamptz,
      add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
      add column if not exists rejected_at timestamptz,
      add column if not exists approval_note text not null default '';
  end if;
end
$$;

alter table public.work_instructions
  alter column approval_status set default 'pending_review';

create index if not exists work_instructions_approval_status_idx
  on public.work_instructions (approval_status, updated_at desc);

create index if not exists work_instructions_pending_review_idx
  on public.work_instructions (submitted_at desc)
  where approval_status = 'pending_review';

create table if not exists public.access_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint access_groups_name_not_blank check (btrim(name) <> ''),
  constraint access_groups_slug_not_blank check (btrim(slug) <> '')
);

create unique index if not exists access_groups_unique_name_idx
  on public.access_groups ((lower(btrim(name))));

create unique index if not exists access_groups_unique_slug_idx
  on public.access_groups ((lower(btrim(slug))));

create index if not exists access_groups_active_name_idx
  on public.access_groups (is_active, name);

create table if not exists public.access_group_memberships (
  group_id uuid not null references public.access_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (group_id, user_id)
);

create index if not exists access_group_memberships_user_idx
  on public.access_group_memberships (user_id, created_at desc);

create table if not exists public.access_group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.access_groups(id) on delete cascade,
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  status public.access_group_join_request_status not null default 'pending',
  request_note text not null default '',
  decision_note text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists access_group_join_requests_one_pending_idx
  on public.access_group_join_requests (group_id, requester_user_id)
  where status = 'pending';

create index if not exists access_group_join_requests_status_idx
  on public.access_group_join_requests (status, created_at desc);

create table if not exists public.process_document_group_access (
  document_id uuid not null references public.process_documents(id) on delete cascade,
  group_id uuid not null references public.access_groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, group_id)
);

create index if not exists process_document_group_access_group_idx
  on public.process_document_group_access (group_id, document_id);

create table if not exists public.work_instruction_group_access (
  instruction_id uuid not null references public.work_instructions(id) on delete cascade,
  group_id uuid not null references public.access_groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (instruction_id, group_id)
);

create index if not exists work_instruction_group_access_group_idx
  on public.work_instruction_group_access (group_id, instruction_id);

create table if not exists public.process_document_import_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.process_documents(id) on delete cascade,
  revision_id uuid not null unique references public.process_document_revisions(id) on delete cascade,
  file_name text not null,
  content_type text not null default 'application/octet-stream',
  file_size bigint not null check (file_size >= 0),
  file_sha256 text not null default '',
  content_base64 text not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint process_document_import_files_name_not_blank check (btrim(file_name) <> ''),
  constraint process_document_import_files_content_not_blank check (btrim(content_base64) <> '')
);

create index if not exists process_document_import_files_document_idx
  on public.process_document_import_files (document_id, created_at desc);

drop trigger if exists on_access_groups_updated on public.access_groups;
create trigger on_access_groups_updated
before update on public.access_groups
for each row
execute function public.set_updated_at();

drop trigger if exists on_access_group_join_requests_updated on public.access_group_join_requests;
create trigger on_access_group_join_requests_updated
before update on public.access_group_join_requests
for each row
execute function public.set_updated_at();

create or replace function public.is_access_group_member(target_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select public.is_editor())
    or exists (
      select 1
      from public.access_group_memberships membership
      where membership.group_id = target_group_id
        and membership.user_id = (select auth.uid())
    ),
    false
  );
$$;

create or replace function public.can_access_process_document_groups(target_document_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select public.is_editor())
    or not exists (
      select 1
      from public.process_document_group_access document_group
      where document_group.document_id = target_document_id
    )
    or exists (
      select 1
      from public.process_document_group_access document_group
      join public.access_group_memberships membership
        on membership.group_id = document_group.group_id
      where document_group.document_id = target_document_id
        and membership.user_id = (select auth.uid())
    ),
    false
  );
$$;

create or replace function public.can_access_work_instruction_groups(target_instruction_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select public.is_editor())
    or not exists (
      select 1
      from public.work_instruction_group_access instruction_group
      where instruction_group.instruction_id = target_instruction_id
    )
    or exists (
      select 1
      from public.work_instruction_group_access instruction_group
      join public.access_group_memberships membership
        on membership.group_id = instruction_group.group_id
      where instruction_group.instruction_id = target_instruction_id
        and membership.user_id = (select auth.uid())
    ),
    false
  );
$$;

grant execute on function public.is_access_group_member(uuid) to authenticated;
grant execute on function public.can_access_process_document_groups(uuid) to authenticated;
grant execute on function public.can_access_work_instruction_groups(uuid) to authenticated;

alter table public.access_groups enable row level security;
alter table public.access_group_memberships enable row level security;
alter table public.access_group_join_requests enable row level security;
alter table public.process_document_group_access enable row level security;
alter table public.work_instruction_group_access enable row level security;
alter table public.process_document_import_files enable row level security;

drop policy if exists access_groups_select_active_authenticated on public.access_groups;
create policy access_groups_select_active_authenticated
on public.access_groups
for select
to authenticated
using (is_active or (select public.is_editor()));

drop policy if exists access_groups_insert_system_admin on public.access_groups;
create policy access_groups_insert_system_admin
on public.access_groups
for insert
to authenticated
with check ((select public.is_system_admin()));

drop policy if exists access_groups_update_system_admin on public.access_groups;
create policy access_groups_update_system_admin
on public.access_groups
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists access_group_memberships_select_self_or_admin on public.access_group_memberships;
create policy access_group_memberships_select_self_or_admin
on public.access_group_memberships
for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_editor()));

drop policy if exists access_group_memberships_insert_system_admin on public.access_group_memberships;
create policy access_group_memberships_insert_system_admin
on public.access_group_memberships
for insert
to authenticated
with check ((select public.is_system_admin()));

drop policy if exists access_group_memberships_delete_system_admin on public.access_group_memberships;
create policy access_group_memberships_delete_system_admin
on public.access_group_memberships
for delete
to authenticated
using ((select public.is_system_admin()));

drop policy if exists access_group_join_requests_select_self_or_admin on public.access_group_join_requests;
create policy access_group_join_requests_select_self_or_admin
on public.access_group_join_requests
for select
to authenticated
using (requester_user_id = (select auth.uid()) or (select public.is_editor()));

drop policy if exists access_group_join_requests_insert_self on public.access_group_join_requests;
create policy access_group_join_requests_insert_self
on public.access_group_join_requests
for insert
to authenticated
with check (
  requester_user_id = (select auth.uid())
  and status = 'pending'
);

drop policy if exists access_group_join_requests_update_admin on public.access_group_join_requests;
create policy access_group_join_requests_update_admin
on public.access_group_join_requests
for update
to authenticated
using ((select public.is_editor()) or requester_user_id = (select auth.uid()))
with check (
  (
    (select public.is_editor())
    and decided_by = (select auth.uid())
  )
  or (
    requester_user_id = (select auth.uid())
    and status = 'cancelled'
  )
);

drop policy if exists process_document_group_access_select_authenticated on public.process_document_group_access;
create policy process_document_group_access_select_authenticated
on public.process_document_group_access
for select
to authenticated
using (true);

drop policy if exists process_document_group_access_manage_system_admin on public.process_document_group_access;
create policy process_document_group_access_manage_system_admin
on public.process_document_group_access
for all
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists work_instruction_group_access_select_authenticated on public.work_instruction_group_access;
create policy work_instruction_group_access_select_authenticated
on public.work_instruction_group_access
for select
to authenticated
using (true);

drop policy if exists work_instruction_group_access_manage_system_admin on public.work_instruction_group_access;
create policy work_instruction_group_access_manage_system_admin
on public.work_instruction_group_access
for all
to authenticated
using ((select public.is_editor()))
with check ((select public.is_editor()));

drop policy if exists process_document_import_files_select_controlled on public.process_document_import_files;
create policy process_document_import_files_select_controlled
on public.process_document_import_files
for select
to authenticated
using (
  exists (
    select 1
    from public.process_documents document
    where document.id = document_id
      and (
        document.status = 'approved'
        or document.created_by = (select auth.uid())
        or document.owner_user_id = (select auth.uid())
        or (select public.is_editor())
      )
      and (
        document.created_by = (select auth.uid())
        or document.owner_user_id = (select auth.uid())
        or (select public.is_editor())
        or public.can_access_process_document_groups(document.id)
      )
  )
);

drop policy if exists process_document_import_files_insert_editors on public.process_document_import_files;
create policy process_document_import_files_insert_editors
on public.process_document_import_files
for insert
to authenticated
with check ((select public.is_editor()) and uploaded_by = (select auth.uid()));

drop policy if exists work_items_insert_editors on public.work_items;
drop policy if exists work_items_insert_authenticated_authors on public.work_items;
create policy work_items_insert_authenticated_authors
on public.work_items
for insert
to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists work_instructions_select_authenticated on public.work_instructions;
drop policy if exists work_instructions_select_controlled on public.work_instructions;
create policy work_instructions_select_controlled
on public.work_instructions
for select
to authenticated
using (
  (
    approval_status = 'approved'
    or created_by = (select auth.uid())
    or updated_by = (select auth.uid())
    or (select public.is_editor())
  )
  and (
    created_by = (select auth.uid())
    or updated_by = (select auth.uid())
    or (select public.is_editor())
    or public.can_access_work_instruction_groups(id)
  )
);

drop policy if exists work_instructions_insert_editors on public.work_instructions;
drop policy if exists work_instructions_insert_authors_or_editors on public.work_instructions;
create policy work_instructions_insert_authors_or_editors
on public.work_instructions
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and (
    (select public.is_editor())
    or approval_status in ('draft', 'pending_review')
  )
);

drop policy if exists work_instructions_update_editors on public.work_instructions;
drop policy if exists work_instructions_update_authors_or_editors on public.work_instructions;
create policy work_instructions_update_authors_or_editors
on public.work_instructions
for update
to authenticated
using (
  (select public.is_editor())
  or (
    created_by = (select auth.uid())
    and approval_status in ('draft', 'pending_review', 'rejected')
  )
)
with check (
  (select public.is_editor())
  or (
    created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and approval_status in ('draft', 'pending_review', 'rejected')
  )
);

drop policy if exists instruction_suggested_tools_insert_editors on public.instruction_suggested_tools;
drop policy if exists instruction_suggested_tools_insert_authors_or_editors on public.instruction_suggested_tools;
create policy instruction_suggested_tools_insert_authors_or_editors
on public.instruction_suggested_tools
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select public.is_editor())
    or exists (
      select 1
      from public.work_instructions instruction
      where instruction.id = instruction_id
        and instruction.created_by = (select auth.uid())
        and instruction.approval_status in ('draft', 'pending_review', 'rejected')
    )
  )
);

drop policy if exists instruction_suggested_tools_delete_editors on public.instruction_suggested_tools;
drop policy if exists instruction_suggested_tools_delete_authors_or_editors on public.instruction_suggested_tools;
create policy instruction_suggested_tools_delete_authors_or_editors
on public.instruction_suggested_tools
for delete
to authenticated
using (
  (select public.is_editor())
  or exists (
    select 1
    from public.work_instructions instruction
    where instruction.id = instruction_id
      and instruction.created_by = (select auth.uid())
      and instruction.approval_status in ('draft', 'pending_review', 'rejected')
  )
);

drop policy if exists process_documents_select_controlled on public.process_documents;
create policy process_documents_select_controlled
on public.process_documents
for select
to authenticated
using (
  (
    status = 'approved'
    or created_by = (select auth.uid())
    or owner_user_id = (select auth.uid())
    or (select public.is_editor())
  )
  and (
    created_by = (select auth.uid())
    or owner_user_id = (select auth.uid())
    or (select public.is_editor())
    or public.can_access_process_document_groups(id)
  )
);

drop policy if exists process_documents_insert_editors on public.process_documents;
drop policy if exists process_documents_insert_authors_or_editors on public.process_documents;
create policy process_documents_insert_authors_or_editors
on public.process_documents
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and (
    (select public.is_editor())
    or status in ('draft', 'in_review')
  )
);

drop policy if exists process_documents_update_editors on public.process_documents;
drop policy if exists process_documents_update_authors_or_editors on public.process_documents;
create policy process_documents_update_authors_or_editors
on public.process_documents
for update
to authenticated
using (
  (select public.is_editor())
  or (
    (created_by = (select auth.uid()) or owner_user_id = (select auth.uid()))
    and status in ('draft', 'in_review')
  )
)
with check (
  (select public.is_editor())
  or (
    (created_by = (select auth.uid()) or owner_user_id = (select auth.uid()))
    and updated_by = (select auth.uid())
    and status in ('draft', 'in_review')
  )
);

drop policy if exists process_document_revisions_select_controlled on public.process_document_revisions;
create policy process_document_revisions_select_controlled
on public.process_document_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.process_documents document
    where document.id = document_id
      and (
        document.status = 'approved'
        or document.created_by = (select auth.uid())
        or document.owner_user_id = (select auth.uid())
        or (select public.is_editor())
      )
      and (
        document.created_by = (select auth.uid())
        or document.owner_user_id = (select auth.uid())
        or (select public.is_editor())
        or public.can_access_process_document_groups(document.id)
      )
  )
);

drop policy if exists process_document_revisions_insert_editors on public.process_document_revisions;
drop policy if exists process_document_revisions_insert_authors_or_editors on public.process_document_revisions;
create policy process_document_revisions_insert_authors_or_editors
on public.process_document_revisions
for insert
to authenticated
with check (
  prepared_by = (select auth.uid())
  and (
    (select public.is_editor())
    or exists (
      select 1
      from public.process_documents document
      where document.id = document_id
        and (document.created_by = (select auth.uid()) or document.owner_user_id = (select auth.uid()))
        and document.status in ('draft', 'in_review')
    )
  )
);

drop policy if exists process_document_audit_events_select_controlled on public.process_document_audit_events;
create policy process_document_audit_events_select_controlled
on public.process_document_audit_events
for select
to authenticated
using (
  exists (
    select 1
    from public.process_documents document
    where document.id = document_id
      and (
        document.status = 'approved'
        or document.created_by = (select auth.uid())
        or document.owner_user_id = (select auth.uid())
        or (select public.is_editor())
      )
      and (
        document.created_by = (select auth.uid())
        or document.owner_user_id = (select auth.uid())
        or (select public.is_editor())
        or public.can_access_process_document_groups(document.id)
      )
  )
);

drop policy if exists storage_instruction_media_insert on storage.objects;
create policy storage_instruction_media_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'instruction-media');

commit;
