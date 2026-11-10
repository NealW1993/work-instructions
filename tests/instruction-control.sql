-- Run only in a disposable schema clone. All fixtures roll back.
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-0000-0000-000000000001', 'instruction-test@example.invalid', '{"full_name":"Revision Test","employee_id":"980001"}');
update public.profiles set role = 'system_admin' where id = 'b1000000-0000-0000-0000-000000000001';
insert into public.departments (id, name) values ('b2000000-0000-0000-0000-000000000001', 'Revision test department');
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);

do $$
declare
  payload jsonb := '{"mode":"create","departmentId":"b2000000-0000-0000-0000-000000000001","partId":"TEST-REV","itemTitle":"Controlled setup","revision":1,"bodyMarkdown":"<p>Inspect before release.</p>","processScope":"Test cell","acceptanceCriteria":"Within drawing tolerance","verificationRecords":"Inspection record","isoClauseRefs":["7.5"],"suggestedToolIds":[],"changeSummary":"Clarify inspection acceptance after process review."}'::jsonb;
  result jsonb;
  first_id uuid;
  next_id uuid;
  fork_id uuid;
  stamp timestamptz;
  before_count integer;
begin
  result := public.save_work_instruction_controlled(payload);
  first_id := (result->>'instructionId')::uuid;
  if first_id is null then raise exception 'FAIL: create returned no ID'; end if;
  select updated_at into stamp from public.work_instructions where id = first_id;
  begin
    perform public.save_work_instruction_controlled(payload || jsonb_build_object('mode','edit','instructionId',first_id,'expectedUpdatedAt',stamp,'revision',2,'changeSummary',''));
    raise exception 'FAIL: a new revision without a summary was accepted';
  exception when check_violation then null;
  end;
  -- A failed tool link must roll back archive, revision creation and all evidence.
  select count(*) into before_count from public.work_instructions;
  begin
    perform public.save_work_instruction_controlled(payload || jsonb_build_object('mode','edit','instructionId',first_id,
      'expectedUpdatedAt',stamp,'revision',2,'suggestedToolIds',jsonb_build_array('b9000000-0000-0000-0000-000000000009')));
    raise exception 'FAIL: invalid tool accepted';
  exception when foreign_key_violation then null;
  end;
  if (select is_archived from public.work_instructions where id = first_id) or
    (select count(*) from public.work_instructions) <> before_count then
    raise exception 'FAIL: partial save escaped transaction';
  end if;
  begin
    perform public.save_work_instruction_controlled(payload || jsonb_build_object('mode','edit','instructionId',first_id,'expectedUpdatedAt','2000-01-01T00:00:00Z'));
    raise exception 'FAIL: stale save accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.decide_work_instruction(first_id, auth.uid(), 'rejected', '', stamp);
    raise exception 'FAIL: rejection without evidence accepted';
  exception when check_violation then null;
  end;
  insert into public.work_instruction_import_files (instruction_id,file_name,file_size,content_base64,created_by)
    values (first_id,'source.txt',5,'aGVsbG8=',auth.uid());
  insert into public.instruction_media (instruction_id,storage_path,public_url,media_type,created_by)
    values (first_id,'test/retained.png','https://example.invalid/retained.png','image',auth.uid());
  perform public.decide_work_instruction(first_id, auth.uid(), 'approved', '', stamp);
  begin
    perform public.decide_work_instruction(first_id, auth.uid(), 'approved', '', stamp);
    raise exception 'FAIL: repeat approval accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.save_work_instruction_controlled(payload || jsonb_build_object('mode','edit','instructionId',first_id,'expectedUpdatedAt',stamp));
    raise exception 'FAIL: approved content overwritten at same revision';
  exception when check_violation then null;
  end;
  result := public.save_work_instruction_controlled(payload || jsonb_build_object('mode','edit','instructionId',first_id,'expectedUpdatedAt',stamp,'revision',2));
  next_id := (result->>'instructionId')::uuid;
  if next_id = first_id or (select is_archived from public.work_instructions where id = first_id)
    or (select approval_status from public.work_instructions where id = next_id) <> 'pending_review' then
    raise exception 'FAIL: working revision interrupted the current released revision';
  end if;
  select updated_at into stamp from public.work_instructions where id = next_id;
  perform public.decide_work_instruction(next_id, auth.uid(), 'approved', '', stamp);
  if not (select is_archived from public.work_instructions where id = first_id) then
    raise exception 'FAIL: approval did not atomically supersede previous release';
  end if;
  begin
    update public.work_instructions set approval_status = 'pending_review' where id = next_id;
    raise exception 'FAIL: released approval downgraded';
  exception when check_violation then null;
  end;
  begin
    delete from public.instruction_media where instruction_id = next_id;
    raise exception 'FAIL: released attachment removed';
  exception when check_violation then null;
  end;
  if (select count(*) from public.work_instruction_import_files where instruction_id = next_id) <> 1
    or (select count(*) from public.instruction_media where instruction_id = next_id) <> 1 then
    raise exception 'FAIL: revision lost source import or attachment';
  end if;
  begin
    update public.work_instructions set body_markdown = 'tampered' where id = first_id;
    raise exception 'FAIL: archived content changed';
  exception when check_violation then null;
  end;
  begin
    delete from public.work_instruction_import_files where instruction_id = first_id;
    raise exception 'FAIL: source evidence deleted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if not exists (select 1 from public.instruction_change_events where instruction_id = first_id
    and source_payload->>'kind' = 'controlled_instruction_snapshot' and source_payload->'after'->>'approval_status' = 'approved') then
    raise exception 'FAIL: approval evidence missing';
  end if;
  result := public.set_work_instruction_archive(first_id, auth.uid(), false, false);
  if result->'conflict' is null or (select is_archived from public.work_instructions where id = next_id) then
    raise exception 'FAIL: unconfirmed restoration displaced the current release';
  end if;
  result := public.save_work_instruction_controlled(payload || jsonb_build_object('mode','fork','sourceInstructionId',next_id));
  fork_id := (result->>'instructionId')::uuid;
  select updated_at into stamp from public.work_instructions where id = next_id;
  result := public.merge_work_instruction_controlled(fork_id,auth.uid(),'{"body":true,"media":true}',stamp,
    (select updated_at from public.work_instructions where id = fork_id));
  if not (select is_archived from public.work_instructions where id = fork_id)
    or (select is_archived from public.work_instructions where id = next_id)
    or (select approval_status from public.work_instructions where id = (result->>'rootInstructionId')::uuid) <> 'pending_review' then
    raise exception 'FAIL: merge did not retain released version and submit a new revision';
  end if;
  if has_table_privilege('authenticated','public.work_instructions','UPDATE')
    or has_function_privilege('authenticated','public.decide_work_instruction(uuid,uuid,text,text,timestamptz)','EXECUTE') then
    raise exception 'FAIL: browser can bypass controlled save or approval';
  end if;
  raise notice 'PASS: atomic rollback, stale edit, rejection evidence, immutable release/evidence, uninterrupted release handoff, retained imports/media, audit, merge, restoration conflict and browser permissions';
end;
$$;
rollback;
