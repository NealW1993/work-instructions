begin;

-- Plant-floor authors create a work instruction from a part, a title, a department and the steps.
-- Scope, acceptance criteria and verification records become optional details instead of being
-- required before anything can be saved. This replaces save_work_instruction_controlled with the
-- same logic, minus those three checks:
--   * a detail that is left out is stored as '' (the columns do not allow NULL);
--   * quality-system references that are not sent keep their previous value on an edit, and the
--     column default on a new instruction.
-- import_work_instruction_controlled calls this function, so imports follow the same rule.
-- No stored data is changed.
create or replace function public.save_work_instruction_controlled(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  actor public.profiles;
  previous public.work_instructions;
  saved public.work_instructions;
  target_item uuid;
  source_id uuid := nullif(p_payload->>'instructionId', '')::uuid;
  source_fork_id uuid := nullif(p_payload->>'sourceInstructionId', '')::uuid;
  replacement_id uuid := nullif(p_payload->>'replacementInstructionId', '')::uuid;
  department uuid := (p_payload->>'departmentId')::uuid;
  part text := btrim(p_payload->>'partId');
  title text := btrim(p_payload->>'itemTitle');
  mode text := p_payload->>'mode';
  next_revision integer := (p_payload->>'revision')::integer;
  root_id uuid;
  branch integer;
  new_id uuid := gen_random_uuid();
  evidence_source uuid;
  tool_ids uuid[];
  clause_refs text[];
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null then raise exception 'An active signed-in user is required.' using errcode = '42501'; end if;
  if mode is null or mode not in ('create', 'edit', 'fork') or next_revision is null or next_revision < 1
    or coalesce(part, '') = '' or coalesce(title, '') = '' or department is null
    or coalesce(btrim(p_payload->>'bodyMarkdown'), '') = '' then
    raise exception 'Part, title, department, a positive revision and steps are required.' using errcode = '23514';
  end if;
  -- Serialize matching work-item creation and branch numbering.
  perform pg_advisory_xact_lock(hashtextextended(department::text || lower(part) || lower(title), 0));
  if mode = 'edit' then
    select * into previous from public.work_instructions where id = source_id for update;
    if previous.id is null or previous.is_archived then
      raise exception 'The instruction is no longer active. Refresh before saving.' using errcode = 'PT409';
    end if;
    if actor.role not in ('admin', 'system_admin') and
      (previous.created_by <> actor.id or previous.approval_status = 'approved') then
      raise exception 'You cannot edit this instruction.' using errcode = '42501';
    end if;
    if nullif(p_payload->>'expectedUpdatedAt', '')::timestamptz is distinct from previous.updated_at then
      raise exception 'Another user changed this instruction. Reload and compare your changes before saving.' using errcode = 'PT409';
    end if;
    if next_revision < previous.revision or
      (previous.approval_status = 'approved' and next_revision <= previous.revision) then
      raise exception 'A changed approved instruction requires a higher revision number.' using errcode = '23514';
    end if;
    if next_revision > previous.revision and coalesce(btrim(p_payload->>'changeSummary'), '') = '' then
      raise exception 'A new controlled revision requires a change summary.' using errcode = '23514';
    end if;
    root_id := previous.fork_root_instruction_id;
    branch := previous.fork_number;
    evidence_source := previous.id;
  elsif mode = 'fork' then
    if actor.role not in ('admin', 'system_admin') then raise exception 'Only editors can create instruction branches.' using errcode = '42501'; end if;
    select * into previous from public.work_instructions where id = source_fork_id for update;
    if previous.id is null or previous.is_archived then raise exception 'The source instruction is no longer active.' using errcode = 'PT409'; end if;
    root_id := coalesce(previous.fork_root_instruction_id, previous.revision_family_id);
    perform pg_advisory_xact_lock(hashtextextended(root_id::text, 1));
    select coalesce(max(fork_number), 0) + 1 into branch from public.work_instructions where fork_root_instruction_id = root_id;
    evidence_source := previous.id;
  end if;
  select id into target_item from public.work_items
    where department_id = department and lower(btrim(part_id)) = lower(part) and lower(btrim(item_title)) = lower(title)
    order by created_at, id limit 1;
  if target_item is null then
    insert into public.work_items (department_id, part_id, item_title, created_by)
      values (department, part, title, actor.id) returning id into target_item;
  end if;
  if mode = 'create' then
    select * into previous from public.work_instructions
      where work_item_id = target_item and not is_archived and fork_root_instruction_id is null
      order by revision desc, updated_at desc limit 1 for update;
    if previous.id is not null then
      if replacement_id is distinct from previous.id then
        return jsonb_build_object('conflict', true, 'existingInstructionId', previous.id, 'existingRevision', previous.revision);
      end if;
      if actor.role not in ('admin', 'system_admin') then raise exception 'Only editors can replace an existing instruction.' using errcode = '42501'; end if;
      if next_revision <= previous.revision then raise exception 'A replacement revision must be higher than the current revision.' using errcode = '23514'; end if;
      evidence_source := previous.id;
    elsif replacement_id is not null then
      raise exception 'The active revision changed. Refresh before replacing it.' using errcode = 'PT409';
    end if;
  end if;
  -- The form no longer asks for quality-system references: use what was sent, otherwise carry the
  -- previous revision's forward, otherwise the same default the column uses.
  clause_refs := case
    when jsonb_typeof(p_payload->'isoClauseRefs') = 'array'
      then array(select jsonb_array_elements_text(p_payload->'isoClauseRefs'))
    else coalesce(previous.iso_clause_refs, array['7.5 Documented information',
      '8.5 Production and service provision', '8.6 Release of products and services']::text[])
  end;
  if mode = 'edit' and next_revision = previous.revision then
    new_id := previous.id;
    update public.work_instructions set work_item_id = target_item,
      body_markdown = p_payload->>'bodyMarkdown', uncommon_tools = coalesce(p_payload->>'uncommonTools', ''),
      iso_clause_refs = clause_refs,
      process_scope = coalesce(p_payload->>'processScope', ''), acceptance_criteria = coalesce(p_payload->>'acceptanceCriteria', ''),
      verification_records = coalesce(p_payload->>'verificationRecords', ''), risk_controls = coalesce(p_payload->>'riskControls', ''),
      last_change_summary = coalesce(nullif(btrim(p_payload->>'changeSummary'), ''), 'Instruction updated and submitted for review.'),
      approval_status = 'pending_review', submitted_by = actor.id, submitted_at = now(),
      approved_by = null, approved_at = null, rejected_by = null, rejected_at = null, approval_note = '', updated_by = actor.id
      where id = previous.id returning * into saved;
  else
    if mode <> 'fork' and previous.id is not null and exists (
      select 1 from public.work_instructions i where i.revision_family_id = previous.revision_family_id
        and i.id <> previous.id and i.revision >= next_revision
    ) then
      raise exception 'Use a revision number above all retained revisions in this instruction family.' using errcode = '23514';
    end if;
    if previous.id is not null and mode <> 'fork' and previous.approval_status <> 'approved' then
      update public.work_instructions set is_archived = true, updated_by = actor.id,
        last_change_summary = format('Superseded by revision %s; retained for traceability.', next_revision) where id = previous.id;
    end if;
    insert into public.work_instructions
      (id, work_item_id, body_markdown, notes_markdown, uncommon_tools, iso_clause_refs, process_scope,
       acceptance_criteria, verification_records, risk_controls, revision, last_change_summary,
       approval_status, submitted_by, submitted_at, created_by, updated_by, fork_root_instruction_id, fork_number, revision_family_id)
    values (new_id, target_item, p_payload->>'bodyMarkdown', coalesce(previous.notes_markdown, ''),
      coalesce(p_payload->>'uncommonTools', ''), clause_refs,
      coalesce(p_payload->>'processScope', ''), coalesce(p_payload->>'acceptanceCriteria', ''),
      coalesce(p_payload->>'verificationRecords', ''), coalesce(p_payload->>'riskControls', ''),
      next_revision, coalesce(nullif(btrim(p_payload->>'changeSummary'), ''), format('Revision %s submitted for review.', next_revision)),
      'pending_review', actor.id, now(), actor.id, actor.id, root_id, branch,
      case when mode <> 'fork' then coalesce(previous.revision_family_id, new_id) else new_id end) returning * into saved;
    if evidence_source is not null then
      insert into public.work_instruction_import_files (instruction_id, file_name, content_type, file_size, content_base64, created_by)
        select new_id, file_name, content_type, file_size, content_base64, created_by
          from public.work_instruction_import_files where instruction_id = evidence_source;
      insert into public.work_instruction_group_access (instruction_id, group_id, created_by)
        select new_id, group_id, actor.id from public.work_instruction_group_access where instruction_id = evidence_source;
      insert into public.instruction_media (instruction_id, storage_path, public_url, media_type, caption, sort_order, created_by)
        select new_id, storage_path, public_url, media_type, caption, sort_order, created_by
          from public.instruction_media where instruction_id = evidence_source;
      if mode <> 'fork' then
        insert into public.user_pinned_instructions (user_id, instruction_id, created_at)
          select user_id, new_id, created_at from public.user_pinned_instructions where instruction_id = evidence_source
          on conflict do nothing;
      end if;
    end if;
  end if;
  tool_ids := array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_payload->'suggestedToolIds', '[]')));
  delete from public.instruction_suggested_tools where instruction_id = new_id and not (suggested_tool_id = any(tool_ids));
  insert into public.instruction_suggested_tools (instruction_id, suggested_tool_id, created_by)
    select new_id, unnest(tool_ids), actor.id on conflict do nothing;
  if nullif(p_payload->>'aiEnhancementId', '') is not null then
    update public.instruction_ai_enhancements set instruction_id = new_id, outcome = 'applied', outcome_at = now()
      where id = (p_payload->>'aiEnhancementId')::uuid and actor_user_id = actor.id;
    if found then
      update public.work_instructions set ai_assisted = true, ai_assisted_at = now(),
        ai_assistance_last_event_id = (p_payload->>'aiEnhancementId')::uuid where id = new_id;
    end if;
  end if;
  insert into public.instruction_change_events
    (instruction_id, actor_user_id, event_type, detail, revision, occurred_at, source_payload)
    values (new_id, actor.id, 'updated', 'Controlled save completed with tooling and retained evidence.',
      next_revision, clock_timestamp(), jsonb_build_object('kind', 'controlled_save',
        'toolIds', to_jsonb(tool_ids), 'sourceInstructionId', evidence_source,
        'media', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.instruction_media m where m.instruction_id = new_id)));
  return jsonb_build_object('instructionId', new_id, 'forkNumber', branch,
    'archivedInstructionId', case when previous.id <> new_id and mode <> 'fork' and previous.approval_status <> 'approved' then previous.id else null end);
end;
$$;
revoke all on function public.save_work_instruction_controlled(jsonb) from public, anon;
grant execute on function public.save_work_instruction_controlled(jsonb) to authenticated;

commit;
