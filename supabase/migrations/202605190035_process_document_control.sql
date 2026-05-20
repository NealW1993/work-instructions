begin;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'process_document_type'
  ) then
    create type public.process_document_type as enum (
      'process_map',
      'procedure',
      'work_instruction',
      'form',
      'quality_record',
      'policy',
      'specification',
      'template'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'process_document_status'
  ) then
    create type public.process_document_status as enum (
      'draft',
      'in_review',
      'approved',
      'obsolete'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'process_document_source_type'
  ) then
    create type public.process_document_source_type as enum (
      'manual',
      'template',
      'import'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'process_document_audit_event_type'
  ) then
    create type public.process_document_audit_event_type as enum (
      'created',
      'metadata_updated',
      'revision_created',
      'status_changed',
      'approved',
      'obsoleted',
      'imported',
      'template_used'
    );
  end if;
end
$$;

create table if not exists public.process_document_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  document_type public.process_document_type not null,
  description text not null default '',
  body_html text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.process_documents (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  title text not null,
  document_type public.process_document_type not null default 'procedure',
  status public.process_document_status not null default 'draft',
  department_id uuid references public.departments(id) on delete set null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  process_name text not null default '',
  process_scope text not null default '',
  process_inputs text not null default '',
  process_outputs text not null default '',
  process_risks text not null default '',
  process_controls text not null default '',
  related_instruction_ids uuid[] not null default '{}',
  iso_clause_refs text[] not null default '{}',
  current_revision integer not null default 1 check (current_revision > 0),
  effective_at timestamptz,
  next_review_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  obsoleted_by uuid references public.profiles(id) on delete set null,
  obsoleted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint process_documents_document_number_not_blank check (btrim(document_number) <> ''),
  constraint process_documents_title_not_blank check (btrim(title) <> '')
);

create index if not exists process_documents_status_idx
  on public.process_documents (status, updated_at desc);

create index if not exists process_documents_department_idx
  on public.process_documents (department_id, status);

create index if not exists process_documents_owner_idx
  on public.process_documents (owner_user_id, status);

create index if not exists process_documents_type_idx
  on public.process_documents (document_type, status);

create table if not exists public.process_document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.process_documents(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null,
  body_html text not null default '',
  change_summary text not null default '',
  source_type public.process_document_source_type not null default 'manual',
  template_id uuid references public.process_document_templates(id) on delete set null,
  imported_file_name text,
  imported_file_type text,
  imported_file_size bigint,
  prepared_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, revision),
  constraint process_document_revisions_title_not_blank check (btrim(title) <> '')
);

create index if not exists process_document_revisions_document_idx
  on public.process_document_revisions (document_id, revision desc);

create table if not exists public.process_document_audit_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.process_documents(id) on delete cascade,
  revision_id uuid references public.process_document_revisions(id) on delete set null,
  actor_user_id uuid not null references public.profiles(id),
  event_type public.process_document_audit_event_type not null,
  detail text not null default '',
  from_status public.process_document_status,
  to_status public.process_document_status,
  occurred_at timestamptz not null default timezone('utc', now()),
  source_payload jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists process_document_audit_events_document_idx
  on public.process_document_audit_events (document_id, occurred_at desc);

create index if not exists process_document_audit_events_actor_idx
  on public.process_document_audit_events (actor_user_id, occurred_at desc);

create index if not exists process_document_audit_events_type_idx
  on public.process_document_audit_events (event_type, occurred_at desc);

create table if not exists public.document_search_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  query text not null,
  mode text not null default 'ai' check (mode in ('ai', 'lexical')),
  result_count integer not null default 0 check (result_count >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists document_search_events_actor_idx
  on public.document_search_events (actor_user_id, created_at desc);

drop trigger if exists on_process_document_templates_updated on public.process_document_templates;
create trigger on_process_document_templates_updated
before update on public.process_document_templates
for each row
execute function public.set_updated_at();

drop trigger if exists on_process_documents_updated on public.process_documents;
create trigger on_process_documents_updated
before update on public.process_documents
for each row
execute function public.set_updated_at();

create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Audit events are append-only and cannot be %', lower(TG_OP);
end;
$$;

create or replace function public.log_process_document_change_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_event_type public.process_document_audit_event_type;
  resolved_detail text;
  resolved_actor uuid;
begin
  resolved_actor := coalesce(new.updated_by, new.created_by, new.approved_by, new.obsoleted_by);

  if resolved_actor is null then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    resolved_event_type := 'created';
    resolved_detail := 'Controlled document created.';
  elsif old.status is distinct from new.status then
    if new.status = 'approved' then
      resolved_event_type := 'approved';
      resolved_detail := format('Document approved at revision %s.', new.current_revision);
    elsif new.status = 'obsolete' then
      resolved_event_type := 'obsoleted';
      resolved_detail := 'Document marked obsolete.';
    else
      resolved_event_type := 'status_changed';
      resolved_detail := format('Status changed from %s to %s.', old.status, new.status);
    end if;
  else
    resolved_event_type := 'metadata_updated';
    resolved_detail := 'Document metadata updated.';
  end if;

  insert into public.process_document_audit_events (
    document_id,
    actor_user_id,
    event_type,
    detail,
    from_status,
    to_status,
    source_payload
  )
  values (
    new.id,
    resolved_actor,
    resolved_event_type,
    resolved_detail,
    case when TG_OP = 'UPDATE' then old.status else null end,
    new.status,
    jsonb_build_object(
      'document_number', new.document_number,
      'title', new.title,
      'current_revision', new.current_revision
    )
  );

  return new;
end;
$$;

create or replace function public.log_process_document_revision_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_document public.process_documents%rowtype;
  resolved_event_type public.process_document_audit_event_type := 'revision_created';
  resolved_detail text;
begin
  select *
  into owning_document
  from public.process_documents
  where id = new.document_id;

  if not found then
    return new;
  end if;

  if new.source_type = 'import' then
    resolved_event_type := 'imported';
  elsif new.source_type = 'template' then
    resolved_event_type := 'template_used';
  end if;

  resolved_detail := coalesce(
    nullif(trim(new.change_summary), ''),
    format('Revision %s recorded.', new.revision)
  );

  insert into public.process_document_audit_events (
    document_id,
    revision_id,
    actor_user_id,
    event_type,
    detail,
    to_status,
    source_payload
  )
  values (
    new.document_id,
    new.id,
    new.prepared_by,
    resolved_event_type,
    resolved_detail,
    owning_document.status,
    jsonb_build_object(
      'revision', new.revision,
      'source_type', new.source_type,
      'template_id', new.template_id,
      'imported_file_name', new.imported_file_name,
      'imported_file_type', new.imported_file_type,
      'imported_file_size', new.imported_file_size
    )
  );

  return new;
end;
$$;

drop trigger if exists on_process_documents_audit_event on public.process_documents;
create trigger on_process_documents_audit_event
after insert or update on public.process_documents
for each row
execute function public.log_process_document_change_event();

drop trigger if exists on_process_document_revisions_audit_event on public.process_document_revisions;
create trigger on_process_document_revisions_audit_event
after insert on public.process_document_revisions
for each row
execute function public.log_process_document_revision_event();

drop trigger if exists prevent_process_document_audit_event_update on public.process_document_audit_events;
create trigger prevent_process_document_audit_event_update
before update on public.process_document_audit_events
for each row
execute function public.prevent_audit_event_mutation();

drop trigger if exists prevent_process_document_audit_event_delete on public.process_document_audit_events;
create trigger prevent_process_document_audit_event_delete
before delete on public.process_document_audit_events
for each row
execute function public.prevent_audit_event_mutation();

drop policy if exists instruction_change_events_update_editors on public.instruction_change_events;
drop policy if exists instruction_change_events_delete_system_admin on public.instruction_change_events;
drop policy if exists instruction_change_events_update_source_payload_once on public.instruction_change_events;

create policy instruction_change_events_update_source_payload_once
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

create or replace function public.prevent_instruction_change_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE'
    and old.instruction_id is not distinct from new.instruction_id
    and old.actor_user_id is not distinct from new.actor_user_id
    and old.event_type is not distinct from new.event_type
    and old.detail is not distinct from new.detail
    and old.revision is not distinct from new.revision
    and old.occurred_at is not distinct from new.occurred_at
    and old.created_at is not distinct from new.created_at
    and old.source_payload is null
    and new.source_payload is not null
  then
    return new;
  end if;

  raise exception 'Instruction audit events are immutable except one-time source payload enrichment.';
end;
$$;

drop trigger if exists prevent_instruction_change_event_update on public.instruction_change_events;
create trigger prevent_instruction_change_event_update
before update on public.instruction_change_events
for each row
execute function public.prevent_instruction_change_event_mutation();

drop trigger if exists prevent_instruction_change_event_delete on public.instruction_change_events;
create trigger prevent_instruction_change_event_delete
before delete on public.instruction_change_events
for each row
execute function public.prevent_audit_event_mutation();

alter table public.process_document_templates enable row level security;
alter table public.process_documents enable row level security;
alter table public.process_document_revisions enable row level security;
alter table public.process_document_audit_events enable row level security;
alter table public.document_search_events enable row level security;

drop policy if exists process_document_templates_select_authenticated on public.process_document_templates;
create policy process_document_templates_select_authenticated
on public.process_document_templates
for select
to authenticated
using (is_active = true or (select public.is_editor()));

drop policy if exists process_document_templates_insert_system_admin on public.process_document_templates;
create policy process_document_templates_insert_system_admin
on public.process_document_templates
for insert
to authenticated
with check ((select public.is_system_admin()));

drop policy if exists process_document_templates_update_system_admin on public.process_document_templates;
create policy process_document_templates_update_system_admin
on public.process_document_templates
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

drop policy if exists process_documents_select_controlled on public.process_documents;
create policy process_documents_select_controlled
on public.process_documents
for select
to authenticated
using (status = 'approved' or (select public.is_editor()));

drop policy if exists process_documents_insert_editors on public.process_documents;
create policy process_documents_insert_editors
on public.process_documents
for insert
to authenticated
with check (
  (select public.is_editor())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists process_documents_update_editors on public.process_documents;
create policy process_documents_update_editors
on public.process_documents
for update
to authenticated
using ((select public.is_editor()))
with check (
  (select public.is_editor())
  and updated_by = (select auth.uid())
);

drop policy if exists process_document_revisions_select_controlled on public.process_document_revisions;
create policy process_document_revisions_select_controlled
on public.process_document_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.process_documents d
    where d.id = document_id
      and (d.status = 'approved' or (select public.is_editor()))
  )
);

drop policy if exists process_document_revisions_insert_editors on public.process_document_revisions;
create policy process_document_revisions_insert_editors
on public.process_document_revisions
for insert
to authenticated
with check (
  (select public.is_editor())
  and prepared_by = (select auth.uid())
);

drop policy if exists process_document_audit_events_select_controlled on public.process_document_audit_events;
create policy process_document_audit_events_select_controlled
on public.process_document_audit_events
for select
to authenticated
using (
  exists (
    select 1
    from public.process_documents d
    where d.id = document_id
      and (d.status = 'approved' or (select public.is_editor()))
  )
);

drop policy if exists process_document_audit_events_insert_editors on public.process_document_audit_events;
create policy process_document_audit_events_insert_editors
on public.process_document_audit_events
for insert
to authenticated
with check (
  (select public.is_editor())
  and actor_user_id = (select auth.uid())
);

drop policy if exists document_search_events_insert_self on public.document_search_events;
create policy document_search_events_insert_self
on public.document_search_events
for insert
to authenticated
with check (actor_user_id = (select auth.uid()));

drop policy if exists document_search_events_select_system_admin on public.document_search_events;
create policy document_search_events_select_system_admin
on public.document_search_events
for select
to authenticated
using ((select public.is_system_admin()));

insert into public.process_document_templates (
  slug,
  name,
  document_type,
  description,
  body_html,
  sort_order
)
values
  (
    'process-map',
    'Process Map',
    'process_map',
    'SIPOC-style process map with inputs, controls, outputs, measures, and interactions.',
    '<h1>Process Map</h1><h2>Purpose</h2><p>Define the intended process outcome.</p><h2>Scope</h2><p>Define where the process starts and ends.</p><h2>Inputs</h2><ul><li>Input, supplier, and acceptance criteria</li></ul><h2>Process Flow</h2><ol><li>Trigger or request received.</li><li>Work is performed according to defined controls.</li><li>Output is verified and released.</li></ol><h2>Outputs</h2><ul><li>Output, customer, and acceptance criteria</li></ul><h2>Risks and Controls</h2><ul><li>Risk, control method, and owner</li></ul><h2>Records</h2><ul><li>Record name, storage location, and retention expectation</li></ul>',
    10
  ),
  (
    'standard-procedure',
    'Standard Procedure',
    'procedure',
    'Controlled procedure template for repeatable operations.',
    '<h1>Procedure</h1><h2>Purpose</h2><p>State why this procedure exists.</p><h2>Scope</h2><p>Identify applicable departments, products, and exclusions.</p><h2>Responsibilities</h2><ul><li>Process owner:</li><li>Approver:</li><li>Users:</li></ul><h2>Procedure</h2><ol><li>Prepare the required inputs and records.</li><li>Perform the controlled activity.</li><li>Verify the output against acceptance criteria.</li><li>Record completion and exceptions.</li></ol><h2>Related Documents</h2><ul><li>Work instructions, forms, specifications, or process maps</li></ul>',
    20
  ),
  (
    'work-instruction',
    'Work Instruction',
    'work_instruction',
    'Detailed work instruction template aligned with the existing instruction system.',
    '<h1>Work Instruction</h1><h2>Safety and Prerequisites</h2><ul><li>PPE, tooling, machine state, and training requirements</li></ul><h2>Required Materials</h2><ul><li>Material, fixture, gauge, or document</li></ul><h2>Steps</h2><ol><li>Perform the first controlled step.</li><li>Verify the result before continuing.</li><li>Document any nonconformance or deviation.</li></ol><h2>Acceptance Criteria</h2><ul><li>Define what good looks like.</li></ul><h2>Records</h2><ul><li>Required signoff, lot record, inspection result, or upload</li></ul>',
    30
  ),
  (
    'quality-record',
    'Quality Record',
    'quality_record',
    'Record definition template for evidence retained by the QMS.',
    '<h1>Quality Record</h1><h2>Record Purpose</h2><p>Describe the evidence this record provides.</p><h2>Required Fields</h2><ul><li>Field name, owner, and completion rule</li></ul><h2>Retention</h2><p>Define storage location, retention period, and disposal method.</p><h2>Review Method</h2><p>Define how completeness and accuracy are verified.</p>',
    40
  ),
  (
    'controlled-form',
    'Controlled Form',
    'form',
    'Template for a controlled form with owner, fields, and retention notes.',
    '<h1>Controlled Form</h1><h2>Form Owner</h2><p>Identify the owner and approver.</p><h2>Instructions</h2><p>Explain when and how the form is used.</p><h2>Fields</h2><ul><li>Field, input rule, and required status</li></ul><h2>Retention</h2><p>Define where completed forms are stored and for how long.</p>',
    50
  )
on conflict (slug) do update
set
  name = excluded.name,
  document_type = excluded.document_type,
  description = excluded.description,
  body_html = excluded.body_html,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = timezone('utc', now());

commit;
