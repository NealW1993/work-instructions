-- Run only in a disposable schema clone. All fixtures roll back.
-- A work instruction needs a part, a title, a department and steps; the other details are optional.
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001', 'details-test@example.invalid', '{"full_name":"Details Test","employee_id":"980101"}');
update public.profiles set role = 'admin' where id = 'c1000000-0000-0000-0000-000000000001';
insert into public.departments (id, name) values ('c2000000-0000-0000-0000-000000000001', 'Details test department');
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

do $$
declare
  -- Only what an operator fills in on the shop floor: no scope, acceptance criteria, records or references.
  minimal jsonb := '{"mode":"create","departmentId":"c2000000-0000-0000-0000-000000000001","partId":"TEST-SIMPLE","itemTitle":"Simple setup","revision":1,"bodyMarkdown":"1. Check the fixture.","suggestedToolIds":[]}';
  result jsonb;
  saved public.work_instructions;
  stamp timestamptz;
begin
  -- Saving without the optional details works, and they are stored as empty text.
  result := public.save_work_instruction_controlled(minimal);
  select * into saved from public.work_instructions where id = (result->>'instructionId')::uuid;
  if saved.id is null then raise exception 'FAIL: a minimal instruction was not saved'; end if;
  if saved.process_scope <> '' or saved.acceptance_criteria <> '' or saved.verification_records <> '' or saved.risk_controls <> '' then
    raise exception 'FAIL: left-out details were not stored as empty text';
  end if;
  -- Quality-system references that are not sent fall back to the column default.
  if saved.iso_clause_refs is distinct from array['7.5 Documented information', '8.5 Production and service provision',
    '8.6 Release of products and services']::text[] then
    raise exception 'FAIL: default references not applied to a new instruction';
  end if;

  -- Editing with details filled in stores them; references that are not sent are carried forward.
  update public.work_instructions set iso_clause_refs = array['7.5 Documented information']::text[] where id = saved.id;
  select updated_at into stamp from public.work_instructions where id = saved.id;
  perform public.save_work_instruction_controlled(minimal || jsonb_build_object(
    'mode', 'edit', 'instructionId', saved.id, 'expectedUpdatedAt', stamp,
    'acceptanceCriteria', 'Fixture seated with no gap'));
  select * into saved from public.work_instructions where id = saved.id;
  if saved.acceptance_criteria <> 'Fixture seated with no gap' then raise exception 'FAIL: a filled-in detail was not saved'; end if;
  if saved.iso_clause_refs is distinct from array['7.5 Documented information']::text[] then
    raise exception 'FAIL: existing references were not carried forward on edit';
  end if;

  -- Part, title and steps are still required.
  begin
    perform public.save_work_instruction_controlled(minimal || '{"partId":"TEST-NO-STEPS","bodyMarkdown":"  "}'::jsonb);
    raise exception 'FAIL: an instruction without steps was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.save_work_instruction_controlled(minimal || '{"partId":"","itemTitle":"No part"}'::jsonb);
    raise exception 'FAIL: an instruction without a part was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.save_work_instruction_controlled(minimal || '{"partId":"TEST-NO-TITLE","itemTitle":""}'::jsonb);
    raise exception 'FAIL: an instruction without a title was accepted';
  exception when check_violation then null;
  end;

  raise notice 'PASS: optional details stored as empty text, default and carried-forward references, part/title/steps still required';
end;
$$;
rollback;
