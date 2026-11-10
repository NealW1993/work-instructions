-- Run only on a disposable migrated database. All test fixtures roll back.
\set ON_ERROR_STOP on
begin;
-- Schema-only clones may omit Supabase's platform default SELECT/USAGE grants.
-- These temporary grants make the RLS checks exercise actual browser access.
grant usage on schema auth, public to authenticated;
grant select on public.process_documents, public.process_document_revisions,
  public.process_document_import_files, public.process_document_audit_events,
  public.profiles, public.process_document_group_access,
  public.access_group_memberships, public.access_groups to authenticated;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,email,raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001','qms-admin@example.invalid','{"full_name":"QMS Admin","employee_id":"991001"}'::jsonb),
  ('71000000-0000-4000-8000-000000000002','qms-author@example.invalid','{"full_name":"QMS Author","employee_id":"991002"}'::jsonb),
  ('71000000-0000-4000-8000-000000000003','qms-inactive@example.invalid','{"full_name":"Inactive Author","employee_id":"991003"}'::jsonb),
  ('71000000-0000-4000-8000-000000000004','qms-reader@example.invalid','{"full_name":"QMS Reader","employee_id":"991004"}'::jsonb);
update public.profiles set role='system_admin' where id='71000000-0000-4000-8000-000000000001';
update public.profiles set is_active=false where id='71000000-0000-4000-8000-000000000003';

do $$
declare
  v_admin uuid := '71000000-0000-4000-8000-000000000001';
  v_author uuid := '71000000-0000-4000-8000-000000000002';
  v_reader uuid := '71000000-0000-4000-8000-000000000004';
  v_document jsonb := jsonb_build_object(
    'document_number','QMS-REGRESSION-001','title','Controlled setup procedure','document_type','procedure','status','draft',
    'department_id',null,'owner_user_id','71000000-0000-4000-8000-000000000002','process_name','Tool setup','process_purpose','Verify setup',
    'process_scope','Injection molding setup','process_inputs','Tool and setup sheet','process_outputs','Verified setup',
    'process_risks','Wrong tool','process_controls','Verify tool ID and first-off dimensions','related_instruction_ids','[]'::jsonb,
    'iso_clause_refs','["7.5 Documented information"]'::jsonb,'document_cover_image_data_url','','document_cover_image_name','',
    'process_map_payload','{"version":1}'::jsonb);
  v_revision jsonb := '{"body_html":"<p>Verify the mold number before setup.</p>","change_summary":"Initial setup procedure.","source_type":"import","template_id":null,"imported_file_name":"setup.txt","imported_file_type":"text/plain","imported_file_size":5}'::jsonb;
  v_import jsonb := '{"file_name":"setup.txt","content_type":"text/plain","file_size":5,"file_sha256":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","content_base64":"aGVsbG8="}'::jsonb;
  v_saved jsonb;
  v_doc public.process_documents%rowtype;
  v_first_revision uuid;
  v_before integer;
begin
  -- A failed late-stage import validation must leave no master row or audit orphan.
  begin
    perform public.save_process_document_controlled(v_author,null,null,null,v_document,v_revision,null,'{}');
    raise exception 'FAIL: missing import evidence accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.process_documents where document_number='QMS-REGRESSION-001') then
    raise exception 'FAIL: failed save left a master row';
  end if;

  v_saved := public.save_process_document_controlled(v_author,null,null,null,v_document,v_revision,v_import,'{}');
  select * into v_doc from public.process_documents where id=(v_saved->>'documentId')::uuid;
  v_first_revision := (v_saved->>'revisionId')::uuid;
  if v_doc.current_revision<>1 or v_doc.status<>'draft' then raise exception 'FAIL: initial draft'; end if;
  if not exists(select 1 from public.process_document_revisions where id=v_first_revision and metadata_snapshot->>'process_scope'='Injection molding setup') then
    raise exception 'FAIL: metadata snapshot missing';
  end if;

  -- Submission and approval are decisions on the saved revision, not revisions.
  v_document := jsonb_set(v_document,'{status}','"in_review"');
  v_saved := public.save_process_document_controlled(v_author,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,v_revision,null,'{}');
  if (v_saved->>'revision')::integer<>1 or (v_saved->>'revisionChanged')::boolean then raise exception 'FAIL: submission incremented revision'; end if;
  select * into v_doc from public.process_documents where id=v_doc.id;
  -- The result carries the new stamp, so the browser can act again without reloading first.
  if (v_saved->>'updatedAt')::timestamptz is distinct from v_doc.updated_at then
    raise exception 'FAIL: save result is missing the new revision stamp';
  end if;
  v_document := jsonb_set(v_document,'{status}','"approved"');
  begin
    perform public.save_process_document_controlled(v_author,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,v_revision,null,'{}');
    raise exception 'FAIL: author approved document';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_process_document_controlled(v_admin,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,
      jsonb_set(v_revision,'{body_html}','"<p>Changed content.</p>"'),null,'{}');
    raise exception 'FAIL: changed content approved without review';
  exception when invalid_parameter_value then null; end;
  v_saved := public.save_process_document_controlled(v_admin,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,v_revision,null,'{}');
  if (v_saved->>'revision')::integer<>1 then raise exception 'FAIL: approval incremented revision'; end if;
  if not exists(select 1 from public.process_document_revisions where id=v_first_revision and approved_by=v_admin and approved_at is not null) then
    raise exception 'FAIL: approval evidence missing';
  end if;

  -- Released content cannot be edited in place; draft creation preserves release evidence and source bytes.
  select * into v_doc from public.process_documents where id=v_doc.id;
  v_document := jsonb_set(v_document,'{status}','"draft"');
  v_revision := jsonb_set(v_revision,'{change_summary}','"Clarify verified tooling requirements."');
  v_saved := public.save_process_document_controlled(v_admin,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,v_revision,null,'{}');
  if (v_saved->>'revision')::integer<>2 then raise exception 'FAIL: reopening release did not create revision'; end if;
  if (select count(*) from public.process_document_import_files where document_id=v_doc.id and content_base64='aGVsbG8=')<>2 then
    raise exception 'FAIL: imported source evidence not retained on next revision';
  end if;
  if not exists(select 1 from public.process_document_revisions where id=v_first_revision and approved_by=v_admin) then
    raise exception 'FAIL: prior approval was lost';
  end if;
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  if not exists (select 1 from public.list_process_documents_controlled() where id=v_doc.id and current_revision=1 and status='approved'
      and title='Controlled setup procedure') then raise exception 'FAIL: draft hid the released document from readers'; end if;
  if not public.can_read_process_document_revision(v_doc.id,1) or public.can_read_process_document_revision(v_doc.id,2) then
    raise exception 'FAIL: reader revision scope leaked draft or hid release';
  end if;
  perform set_config('codex.document_control_test_id',v_doc.id::text,true);

  -- A stale browser tab cannot save after the revision changes.
  begin
    perform public.save_process_document_controlled(v_admin,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,v_revision,null,'{}');
    raise exception 'FAIL: stale save accepted';
  exception when sqlstate 'PT409' then null; end;
  select * into v_doc from public.process_documents where id=v_doc.id;
  v_document := jsonb_set(v_document,'{title}','"Revised setup procedure"');
  v_revision := jsonb_set(v_revision,'{change_summary}','""');
  begin
    perform public.save_process_document_controlled(v_admin,v_doc.id,v_doc.current_revision,v_doc.updated_at,v_document,v_revision,null,'{}');
    raise exception 'FAIL: changed content accepted without change summary';
  exception when invalid_parameter_value then null; end;

  select count(*) into v_before from public.process_document_audit_events where document_id=v_doc.id;
  if v_before<5 then raise exception 'FAIL: lifecycle audit trail incomplete'; end if;
  begin
    update public.process_document_revisions set body_html='<p>Tampered.</p>' where id=v_first_revision;
    raise exception 'FAIL: retained revision changed';
  exception when check_violation then null; end;
  begin
    delete from public.process_document_import_files where document_id=v_doc.id;
    raise exception 'FAIL: imported evidence deleted';
  exception when check_violation then null; end;
  begin
    delete from public.process_documents where id=v_doc.id;
    raise exception 'FAIL: controlled document deleted';
  exception when check_violation then null; end;
  begin
    update public.process_document_audit_events set detail='Tampered' where document_id=v_doc.id;
    raise exception 'FAIL: audit event changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  if has_function_privilege('authenticated','public.save_process_document_controlled(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,uuid[])','EXECUTE') then
    raise exception 'FAIL: browser can impersonate an actor in service RPC';
  end if;
  if has_table_privilege('authenticated','public.process_document_revisions','INSERT') then
    raise exception 'FAIL: browser can forge revisions';
  end if;
  begin
    perform public.save_process_document_controlled('71000000-0000-4000-8000-000000000003',null,null,null,v_document,v_revision,v_import,'{}');
    raise exception 'FAIL: inactive user created document';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: atomic creation, status-only decisions, approval authority, immutable evidence, source retention, stale saves, change summaries and browser permissions';
end;
$$;

-- Exercise the real browser grants and RLS, not only privileged helper calls.
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare target uuid := current_setting('codex.document_control_test_id')::uuid;
begin
  if exists (select 1 from public.process_documents where id=target) then
    raise exception 'FAIL: reader can query working master metadata directly';
  end if;
  if (select count(*) from public.process_document_revisions where document_id=target)<>1 then
    raise exception 'FAIL: reader cannot see exactly the released revision';
  end if;
  if (select count(*) from public.process_document_import_files where document_id=target)<>1 then
    raise exception 'FAIL: reader cannot see exactly the released source evidence';
  end if;
  begin
    perform public.list_process_documents_controlled('71000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: reader impersonated administrator in library RPC';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: released revision remains visible during drafting; draft metadata/body stay private under RLS';
end;
$$;
reset role;

do $$
declare target public.process_documents; revision public.process_document_revisions; groups uuid[];
begin
  select * into target from public.process_documents where id=current_setting('codex.document_control_test_id')::uuid;
  select r.* into revision from public.process_document_revisions r where r.document_id=target.id and r.revision=target.current_revision;
  select coalesce(array_agg(group_id),'{}') into groups from public.process_document_group_access where document_id=target.id;
  perform public.save_process_document_controlled('71000000-0000-4000-8000-000000000001', target.id,
    target.current_revision, target.updated_at, jsonb_set(to_jsonb(target),'{status}','"obsolete"'), to_jsonb(revision),null,groups);
  if exists (select 1 from public.list_process_documents_controlled() where id=target.id)
    or public.can_read_process_document_revision(target.id,1) then
    raise exception 'FAIL: obsolete document remains released to operators';
  end if;
  raise notice 'PASS: obsoleting a document withdraws its released copy without deleting retained evidence';
end;
$$;
rollback;
