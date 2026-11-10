-- Imports are atomic and preserve exact source bytes through later revisions.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('73000000-0000-4000-8000-000000000001','import-author@example.invalid','{"full_name":"Import author","employee_id":"993001"}'),
  ('73000000-0000-4000-8000-000000000002','import-admin@example.invalid','{"full_name":"Import approver","employee_id":"993002"}');
update public.profiles set role='system_admin' where id='73000000-0000-4000-8000-000000000002';
insert into public.departments(id,name) values('73000000-0000-4000-8000-000000000003','Import test department');
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
  actor uuid := '73000000-0000-4000-8000-000000000001';
  approver uuid := '73000000-0000-4000-8000-000000000002';
  metadata jsonb := '{"departmentId":"73000000-0000-4000-8000-000000000003","partId":"IMPORT-TEST","itemTitle":"Original work instruction","revision":1,"bodyMarkdown":"Open the retained original.","processScope":"Test cell","acceptanceCriteria":"Inspect original criteria","verificationRecords":"Original source","isoClauseRefs":["7.5 Documented information"],"suggestedToolIds":[]}'::jsonb;
  source jsonb := '{"file_name":"source.txt","content_type":"text/plain","file_size":5,"content_base64":"aGVsbG8="}'::jsonb;
  result jsonb;
  instruction public.work_instructions;
  clone_id uuid;
begin
  begin
    perform public.import_work_instruction_controlled(actor,metadata,jsonb_set(source,'{file_size}','99'));
    raise exception 'FAIL: mismatched imported byte count accepted';
  exception when check_violation then null; end;
  if exists(select 1 from public.work_items where part_id='IMPORT-TEST') then
    raise exception 'FAIL: failed import left an orphan work item or instruction';
  end if;
  result := public.import_work_instruction_controlled(actor,metadata,source);
  select * into instruction from public.work_instructions where id=(result->>'instructionId')::uuid;
  if instruction.approval_status<>'pending_review' or instruction.revision_family_id<>instruction.id then
    raise exception 'FAIL: imported instruction has invalid release status or family';
  end if;
  if not exists(select 1 from public.work_instruction_import_files where instruction_id=instruction.id and content_base64='aGVsbG8='
    and file_size=5 and file_sha256='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824') then
    raise exception 'FAIL: original source bytes or checksum missing';
  end if;
  begin
    perform public.import_work_instruction_controlled(actor,metadata,source);
    raise exception 'FAIL: duplicate import silently replaced existing revision';
  exception when unique_violation then null; end;
  if (select count(*) from public.work_instructions where work_item_id=instruction.work_item_id)<>1 then
    raise exception 'FAIL: duplicate import left an orphan revision';
  end if;
  perform set_config('request.jwt.claim.sub',approver::text,true);
  perform public.decide_work_instruction(instruction.id,approver,'approved','',instruction.updated_at);
  select * into instruction from public.work_instructions where id=instruction.id;
  begin
    insert into public.work_instruction_import_files(instruction_id,file_name,content_type,file_size,content_base64,created_by)
      values(instruction.id,'late.txt','text/plain',5,'aGVsbG8=',actor);
    raise exception 'FAIL: source evidence appended to released revision';
  exception when check_violation then null; end;
  result := public.save_work_instruction_controlled(metadata || jsonb_build_object('mode','edit','instructionId',instruction.id,
    'expectedUpdatedAt',instruction.updated_at,'revision',2,'changeSummary','Clarify the imported setup instruction while preserving its original source.'));
  clone_id := (result->>'instructionId')::uuid;
  if not exists(select 1 from public.work_instruction_import_files where instruction_id=clone_id
    and file_sha256='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824') then
    raise exception 'FAIL: revision clone lost the retained source checksum';
  end if;
  if has_function_privilege('authenticated','public.import_work_instruction_controlled(uuid,jsonb,jsonb)','EXECUTE') then
    raise exception 'FAIL: browser can impersonate import actor';
  end if;
  raise notice 'PASS: atomic import rollback, canonical source size, SHA-256 evidence, valid family, duplicate conflicts, release retention and revision cloning';
end;
$$;
rollback;
