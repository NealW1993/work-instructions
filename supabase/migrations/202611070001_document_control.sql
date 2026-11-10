begin;

-- Historical revisions are retained verbatim. New revisions also capture the
-- controlled metadata that previously existed only on the mutable master row.
alter table public.process_document_revisions
  add column if not exists metadata_snapshot jsonb not null default '{}'::jsonb;

-- The released revision stays available while the next revision is drafted.
-- Its complete metadata and access scope are captured at the release decision.
alter table public.process_documents
  add column if not exists released_revision integer,
  add column if not exists released_snapshot jsonb;
update public.process_documents d set released_revision = current_revision,
  released_snapshot = (to_jsonb(d) - 'released_snapshot') || jsonb_build_object(
    'released_revision', current_revision,
    'access_group_ids', coalesce((select jsonb_agg(g.group_id order by g.group_id)
      from public.process_document_group_access g where g.document_id = d.id), '[]'::jsonb))
where status = 'approved' and released_revision is null;

create or replace function public.can_read_process_document_revision(p_document_id uuid, p_revision integer)
returns boolean language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare document public.process_documents; actor public.profiles; groups jsonb;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null then return false; end if;
  select * into document from public.process_documents where id = p_document_id;
  if document.id is null then return false; end if;
  if actor.role in ('admin','system_admin') or document.created_by = actor.id or document.owner_user_id = actor.id then return true; end if;
  if document.status = 'obsolete' or document.released_revision is distinct from p_revision then return false; end if;
  groups := coalesce(document.released_snapshot->'access_group_ids', '[]'::jsonb);
  return jsonb_array_length(groups) = 0 or exists (
    select 1 from public.access_group_memberships m join public.access_groups g on g.id = m.group_id and g.is_active
      where m.user_id = actor.id and groups ? m.group_id::text
  );
end;
$$;
revoke all on function public.can_read_process_document_revision(uuid, integer) from public, anon;
grant execute on function public.can_read_process_document_revision(uuid, integer) to authenticated;

drop policy if exists process_document_revisions_select_controlled on public.process_document_revisions;
create policy process_document_revisions_select_controlled on public.process_document_revisions for select to authenticated
using (public.can_read_process_document_revision(document_id, revision));

drop policy if exists process_document_import_files_select_controlled on public.process_document_import_files;
create policy process_document_import_files_select_controlled on public.process_document_import_files for select to authenticated
using (exists (select 1 from public.process_document_revisions r where r.id = revision_id
  and public.can_read_process_document_revision(process_document_import_files.document_id, r.revision)));

drop policy if exists process_document_audit_events_select_controlled on public.process_document_audit_events;
create policy process_document_audit_events_select_controlled on public.process_document_audit_events for select to authenticated
using (public.can_read_process_document_revision(document_id, coalesce((select r.revision
  from public.process_document_revisions r where r.id = revision_id), -1)));

-- Ordinary readers see the last approved snapshot, never draft metadata or body.
-- Supplying an actor is restricted to trusted server calls or the caller's own ID.
create or replace function public.list_process_documents_controlled(p_actor_user_id uuid default null)
returns setof public.process_documents language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare document public.process_documents; actor public.profiles; groups jsonb;
begin
  if p_actor_user_id is not null and p_actor_user_id is distinct from auth.uid() and auth.role() is distinct from 'service_role' then
    raise exception 'The requested account does not match the signed-in user.' using errcode = '42501';
  end if;
  select * into actor from public.profiles where id = coalesce(p_actor_user_id, auth.uid()) and is_active;
  if actor.id is null then return; end if;
  for document in select * from public.process_documents loop
    if actor.role in ('admin','system_admin') or document.created_by = actor.id or document.owner_user_id = actor.id then
      return next document;
    elsif document.status <> 'obsolete' and document.released_revision is not null and document.released_snapshot is not null then
      groups := coalesce(document.released_snapshot->'access_group_ids', '[]'::jsonb);
      if jsonb_array_length(groups) = 0 or exists (
        select 1 from public.access_group_memberships m join public.access_groups g on g.id = m.group_id and g.is_active
          where m.user_id = actor.id and groups ? m.group_id::text
      ) then
        return next jsonb_populate_record(document, document.released_snapshot);
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.list_process_documents_controlled(uuid) from public, anon;
grant execute on function public.list_process_documents_controlled(uuid) to authenticated, service_role;

create or replace function public.set_process_document_updated_at()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;
drop trigger if exists on_process_documents_updated on public.process_documents;
create trigger on_process_documents_updated before update on public.process_documents
for each row execute function public.set_process_document_updated_at();

create or replace function public.retain_controlled_document_evidence()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if TG_TABLE_NAME = 'process_document_revisions' and TG_OP = 'UPDATE' then
    if old.approved_by is null and old.approved_at is null
      and new.approved_by is not null and new.approved_at is not null
      and (to_jsonb(new) - array['approved_by', 'approved_at']) =
          (to_jsonb(old) - array['approved_by', 'approved_at']) then
      return new;
    end if;
  end if;
  raise exception using errcode = '23514',
    message = 'Controlled document revisions and source evidence are retained. Create a new revision or mark the document obsolete.';
end;
$$;

drop trigger if exists retain_process_document_revisions on public.process_document_revisions;
create trigger retain_process_document_revisions
before update or delete on public.process_document_revisions
for each row execute function public.retain_controlled_document_evidence();

drop trigger if exists retain_process_document_import_files on public.process_document_import_files;
create trigger retain_process_document_import_files
before update or delete on public.process_document_import_files
for each row execute function public.retain_controlled_document_evidence();

drop trigger if exists retain_process_documents on public.process_documents;
create trigger retain_process_documents
before delete on public.process_documents
for each row execute function public.retain_controlled_document_evidence();

-- Browser clients cannot bypass the transactional workflow or forge approvals.
-- The RPC is callable only by the server after bearer-token authentication.
revoke insert, update, delete on public.process_documents from authenticated, anon;
revoke insert, update, delete on public.process_document_revisions from authenticated, anon;
revoke insert, update, delete on public.process_document_import_files from authenticated, anon;
revoke insert, update, delete on public.process_document_group_access from authenticated, anon;
revoke insert, update, delete on public.process_document_audit_events from authenticated, anon;

create or replace function public.save_process_document_controlled(
  p_actor_user_id uuid,
  p_document_id uuid,
  p_expected_revision integer,
  p_expected_updated_at timestamptz,
  p_document jsonb,
  p_revision jsonb,
  p_import_file jsonb,
  p_access_group_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.profiles%rowtype;
  v_old public.process_documents%rowtype;
  v_doc public.process_documents%rowtype;
  v_previous_revision public.process_document_revisions%rowtype;
  v_revision public.process_document_revisions%rowtype;
  v_previous_import public.process_document_import_files%rowtype;
  v_status public.process_document_status;
  v_source public.process_document_source_type;
  v_full_access boolean;
  v_new boolean := p_document_id is null;
  v_changed boolean;
  v_old_content jsonb;
  v_content jsonb;
  v_group_ids uuid[];
  v_old_group_ids uuid[];
  v_summary text;
  v_now timestamptz := clock_timestamp();
  v_lifecycle_keys text[] := array['id','status','current_revision','released_revision','released_snapshot','effective_at','next_review_at','approved_by','approved_at','obsoleted_by','obsoleted_at','created_by','updated_by','created_at','updated_at'];
begin
  select * into v_actor from public.profiles where id = p_actor_user_id and is_active = true;
  if not found then raise exception using errcode = '42501', message = 'An active user account is required.'; end if;
  v_full_access := v_actor.role in ('admin', 'system_admin');
  v_status := (p_document ->> 'status')::public.process_document_status;
  v_source := (p_revision ->> 'source_type')::public.process_document_source_type;
  if v_status is null or v_source is null or jsonb_typeof(p_document) <> 'object' or jsonb_typeof(p_revision) <> 'object' then
    raise exception using errcode = '22023', message = 'Valid document, revision and lifecycle status are required.';
  end if;
  if v_status in ('approved','obsolete') and not v_full_access then
    raise exception using errcode = '42501', message = 'Only admins can approve or obsolete controlled documents.';
  end if;
  if v_new then
    if v_status not in ('draft','in_review') then
      raise exception using errcode = '22023', message = 'Create a draft or submit the initial revision for review before approval.';
    end if;
    v_doc.id := gen_random_uuid();
    v_doc.created_by := p_actor_user_id;
    v_doc.created_at := v_now;
    v_doc.current_revision := 1;
  else
    select * into v_old from public.process_documents where id = p_document_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Controlled document not found.'; end if;
    if p_expected_revision is distinct from v_old.current_revision or p_expected_updated_at is distinct from v_old.updated_at then
      raise exception using errcode = 'PT409', message = 'This document changed after you opened it. Reload and review the latest revision before saving.';
    end if;
    if not v_full_access and (v_old.status in ('approved','obsolete') or (v_old.created_by <> p_actor_user_id and v_old.owner_user_id is distinct from p_actor_user_id)) then
      raise exception using errcode = '42501', message = 'Only the owner, creator, or an admin can revise this document. Released documents require an admin.';
    end if;
    select * into v_previous_revision from public.process_document_revisions
      where document_id = v_old.id and revision = v_old.current_revision;
    if not found then raise exception using errcode = '23514', message = 'The current revision is missing. Restore its retained evidence before revising this document.'; end if;
    select * into v_previous_import from public.process_document_import_files where revision_id = v_previous_revision.id;
    select coalesce(array_agg(group_id order by group_id), '{}'::uuid[]) into v_old_group_ids
      from public.process_document_group_access where document_id = v_old.id;
    v_doc := v_old;
  end if;

  select coalesce(array_agg(distinct group_id order by group_id), '{}'::uuid[]) into v_group_ids
    from unnest(coalesce(p_access_group_ids, '{}'::uuid[])) group_id;
  if exists (select 1 from unnest(v_group_ids) selected(id) left join public.access_groups g on g.id = selected.id and g.is_active where g.id is null) then
    raise exception using errcode = '22023', message = 'One or more selected access groups were not found or are inactive.';
  end if;
  if not v_full_access and exists (select 1 from unnest(v_group_ids) selected(id) where not exists (
    select 1 from public.access_group_memberships m where m.group_id = selected.id and m.user_id = p_actor_user_id
  )) then raise exception using errcode = '42501', message = 'You can only restrict documents to groups you belong to.'; end if;

  -- Populate only controlled fields; lifecycle and identity are assigned below.
  v_doc := jsonb_populate_record(v_doc, p_document - v_lifecycle_keys);
  v_doc.process_purpose := coalesce(v_doc.process_purpose, v_doc.process_scope, '');
  v_doc.process_map_payload := coalesce(v_doc.process_map_payload, '{}'::jsonb);
  if jsonb_typeof(v_doc.process_map_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'The process map payload must be an object.';
  end if;
  if v_doc.owner_user_id is null or not exists (select 1 from public.profiles where id = v_doc.owner_user_id and is_active) then
    raise exception using errcode = '22023', message = 'Select an active document owner.';
  end if;
  if btrim(coalesce(v_doc.document_number,'')) = '' or btrim(coalesce(v_doc.title,'')) = '' or btrim(coalesce(p_revision ->> 'body_html','')) = '' then
    raise exception using errcode = '22023', message = 'Document number, title, and body are required.';
  end if;
  if v_status = 'approved' and (btrim(coalesce(v_doc.process_scope,'')) = '' or btrim(coalesce(v_doc.process_controls,'')) = '' or
      not coalesce('7.5 Documented information' = any(v_doc.iso_clause_refs),false)) then
    raise exception using errcode = '22023', message = 'Approval requires process scope, controls and measures, and the ISO clause 7.5 mapping.';
  end if;
  v_content := to_jsonb(v_doc) - v_lifecycle_keys;
  v_old_content := to_jsonb(v_old) - v_lifecycle_keys;
  v_changed := v_new or v_content is distinct from v_old_content
    or v_group_ids is distinct from v_old_group_ids
    or (p_revision ->> 'body_html') is distinct from v_previous_revision.body_html
    or v_source is distinct from v_previous_revision.source_type
    or nullif(p_revision ->> 'template_id','')::uuid is distinct from v_previous_revision.template_id
    or (p_import_file is not null and (p_import_file ->> 'file_sha256') is distinct from v_previous_import.file_sha256);

  if not v_new and v_status = 'approved' and (v_changed or v_old.status <> 'in_review') then
    raise exception using errcode = '22023', message = 'Approve the saved revision currently in review. Save content changes and submit them for review first.';
  end if;
  if not v_new and v_status = 'obsolete' and (v_changed or v_old.status = 'obsolete') then
    raise exception using errcode = '22023', message = 'Mark an existing saved revision obsolete without changing its controlled content.';
  end if;
  if not v_new and v_old.status = 'obsolete' and v_status <> 'draft' then
    raise exception using errcode = '22023', message = 'Start a new draft revision to reactivate an obsolete document.';
  end if;
  -- Reopening a released or obsolete document always creates a fresh revision,
  -- even when its starting content is unchanged. Approval evidence stays intact.
  if not v_new and v_old.status in ('approved','obsolete') and v_status in ('draft','in_review') then v_changed := true; end if;
  v_summary := btrim(coalesce(p_revision ->> 'change_summary',''));
  if v_changed and not v_new and v_summary = '' then
    raise exception using errcode = '22023', message = 'A change summary is required for each new controlled revision.';
  end if;
  if v_new then v_summary := coalesce(nullif(v_summary,''), 'Initial controlled document revision.'); end if;

  v_doc.status := v_status;
  v_doc.updated_by := p_actor_user_id;
  v_doc.updated_at := v_now;
  if v_changed and not v_new then v_doc.current_revision := v_old.current_revision + 1; end if;
  if v_status = 'approved' then
    v_doc.approved_by := p_actor_user_id; v_doc.approved_at := v_now;
    v_doc.effective_at := v_now; v_doc.next_review_at := v_now + interval '365 days';
    v_doc.obsoleted_by := null; v_doc.obsoleted_at := null;
    v_doc.released_revision := v_doc.current_revision;
    v_doc.released_snapshot := (to_jsonb(v_doc) - 'released_snapshot') || jsonb_build_object('access_group_ids', v_group_ids);
  elsif v_status = 'obsolete' then
    v_doc.obsoleted_by := p_actor_user_id; v_doc.obsoleted_at := v_now;
    v_doc.released_revision := null; v_doc.released_snapshot := null;
  else
    v_doc.approved_by := null; v_doc.approved_at := null; v_doc.effective_at := null;
    v_doc.next_review_at := null; v_doc.obsoleted_by := null; v_doc.obsoleted_at := null;
  end if;
  if v_new then
    insert into public.process_documents select (v_doc).*;
  end if;

  if v_changed then
    v_revision.id := gen_random_uuid(); v_revision.document_id := v_doc.id;
    v_revision.revision := v_doc.current_revision; v_revision.title := v_doc.title;
    v_revision.body_html := p_revision ->> 'body_html'; v_revision.change_summary := v_summary;
    v_revision.source_type := v_source; v_revision.template_id := nullif(p_revision ->> 'template_id','')::uuid;
    v_revision.process_map_payload := v_doc.process_map_payload;
    v_revision.prepared_by := p_actor_user_id; v_revision.created_at := v_now;
    v_revision.metadata_snapshot := v_content || jsonb_build_object('access_group_ids', v_group_ids, 'recorded_status', v_status);
    if v_source = 'import' then
      if p_import_file is null then
        if v_previous_import.id is null or v_previous_revision.source_type <> 'import' then
          raise exception using errcode = '22023', message = 'Import the source file before saving this revision. Source evidence is required for retention.';
        end if;
        p_import_file := to_jsonb(v_previous_import);
      end if;
      if btrim(coalesce(p_import_file ->> 'file_name','')) = '' or btrim(coalesce(p_import_file ->> 'content_base64','')) = '' then
        raise exception using errcode = '22023', message = 'Imported source file name and content are required.';
      end if;
      v_revision.imported_file_name := p_import_file ->> 'file_name';
      v_revision.imported_file_type := p_import_file ->> 'content_type';
      v_revision.imported_file_size := (p_import_file ->> 'file_size')::bigint;
    end if;
    insert into public.process_document_revisions select (v_revision).*;
    if v_source = 'import' then
      insert into public.process_document_import_files(document_id,revision_id,file_name,content_type,file_size,file_sha256,content_base64,uploaded_by)
      values(v_doc.id,v_revision.id,v_revision.imported_file_name,coalesce(v_revision.imported_file_type,'application/octet-stream'),
        v_revision.imported_file_size,coalesce(p_import_file ->> 'file_sha256',''),p_import_file ->> 'content_base64',p_actor_user_id);
    end if;
  else
    v_revision := v_previous_revision;
  end if;
  if v_status = 'approved' then
    update public.process_document_revisions set approved_by = p_actor_user_id, approved_at = v_now where id = v_revision.id;
  end if;
  if not v_new then
    update public.process_documents set
      document_number=v_doc.document_number,title=v_doc.title,document_type=v_doc.document_type,status=v_doc.status,
      department_id=v_doc.department_id,owner_user_id=v_doc.owner_user_id,process_name=v_doc.process_name,process_purpose=v_doc.process_purpose,
      process_scope=v_doc.process_scope,process_inputs=v_doc.process_inputs,process_outputs=v_doc.process_outputs,
      process_risks=v_doc.process_risks,process_controls=v_doc.process_controls,related_instruction_ids=v_doc.related_instruction_ids,
      iso_clause_refs=v_doc.iso_clause_refs,document_cover_image_data_url=v_doc.document_cover_image_data_url,
      document_cover_image_name=v_doc.document_cover_image_name,process_map_payload=v_doc.process_map_payload,
      current_revision=v_doc.current_revision,approved_by=v_doc.approved_by,approved_at=v_doc.approved_at,effective_at=v_doc.effective_at,
      released_revision=v_doc.released_revision,released_snapshot=v_doc.released_snapshot,
      next_review_at=v_doc.next_review_at,obsoleted_by=v_doc.obsoleted_by,obsoleted_at=v_doc.obsoleted_at,updated_by=v_doc.updated_by
    where id=v_doc.id
    returning updated_at into v_doc.updated_at;
  end if;
  delete from public.process_document_group_access where document_id=v_doc.id;
  insert into public.process_document_group_access(document_id,group_id,created_by)
    select v_doc.id,group_id,p_actor_user_id from unnest(v_group_ids) group_id;
  return jsonb_build_object('documentId',v_doc.id,'revision',v_doc.current_revision,'revisionId',v_revision.id,
    'status',v_status,'previousStatus',v_old.status,'revisionChanged',v_changed,'createdBy',v_doc.created_by,
    'ownerUserId',v_doc.owner_user_id,'createdAt',v_now,'updatedAt',v_doc.updated_at);
end;
$$;

revoke all on function public.save_process_document_controlled(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.save_process_document_controlled(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,uuid[]) to service_role;

-- Serializes system-admin removals, including concurrent requests through the
-- service role. Ordinary admin/full-access behavior is unchanged.
create or replace function public.retain_last_active_system_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.role = 'system_admin' and old.is_active and
      (TG_OP = 'DELETE' or new.role <> 'system_admin' or not new.is_active) then
    perform pg_advisory_xact_lock(724109, 1);
    if not exists(select 1 from public.profiles where id <> old.id and role = 'system_admin' and is_active) then
      raise exception using errcode = '23514', message = 'The last active system administrator cannot be demoted, deactivated, or deleted.';
    end if;
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists retain_last_active_system_admin on public.profiles;
create trigger retain_last_active_system_admin
before update of role, is_active or delete on public.profiles
for each row execute function public.retain_last_active_system_admin();

commit;
