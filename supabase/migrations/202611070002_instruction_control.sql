begin;

-- A stable family survives part/title/department changes between revisions.
alter table public.work_instructions add column revision_family_id uuid not null default gen_random_uuid();
with families as (
  select id, first_value(id) over (
    partition by coalesce(fork_root_instruction_id, work_item_id), fork_number
    order by created_at, revision, id
  ) as family_id from public.work_instructions
)
update public.work_instructions i set revision_family_id = f.family_id from families f where i.id = f.id;

-- A released revision remains available while its successor is under review.
drop index if exists public.work_instructions_single_active_root_revision_idx;
drop index if exists public.work_instructions_single_active_fork_branch_idx;
create unique index work_instructions_active_release_family_idx on public.work_instructions (revision_family_id)
  where not is_archived and approval_status = 'approved';
create unique index work_instructions_active_draft_family_idx on public.work_instructions (revision_family_id)
  where not is_archived and approval_status <> 'approved';
create unique index work_instructions_active_root_release_idx on public.work_instructions (work_item_id)
  where not is_archived and fork_root_instruction_id is null and approval_status = 'approved';
create unique index work_instructions_active_root_draft_idx on public.work_instructions (work_item_id)
  where not is_archived and fork_root_instruction_id is null and approval_status <> 'approved';

-- Revisions can share retained storage objects without losing attachment rows.
alter table public.instruction_media drop constraint if exists instruction_media_storage_path_key;
create unique index if not exists instruction_media_revision_storage_key
  on public.instruction_media (instruction_id, storage_path);

-- Capture complete before/after evidence, including release and archive changes.
create or replace function public.log_instruction_change_event()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return new;
  end if;
  insert into public.instruction_change_events
    (instruction_id, actor_user_id, event_type, detail, revision, occurred_at, source_payload)
  values (
    new.id, new.updated_by,
    case when tg_op = 'INSERT' then 'created' else 'updated' end::public.instruction_change_event_type,
    coalesce(nullif(btrim(new.last_change_summary), ''), 'Controlled instruction updated.'),
    new.revision, clock_timestamp(),
    jsonb_build_object('kind', 'controlled_instruction_snapshot',
      'before', case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
      'after', to_jsonb(new),
      'workItem', (select to_jsonb(w) from public.work_items w where w.id = new.work_item_id))
  );
  return new;
end;
$$;

create or replace function public.guard_instruction_release()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if old.approval_status = 'approved' and
      row(new.approval_status, new.approved_by, new.approved_at) is distinct from
      row(old.approval_status, old.approved_by, old.approved_at) then
      raise exception 'Released approval evidence is immutable. Create a new revision.' using errcode = '23514';
    end if;
    if old.is_archived and (
      (to_jsonb(new) - array['is_archived', 'updated_at', 'updated_by', 'last_change_summary'])
      is distinct from
      (to_jsonb(old) - array['is_archived', 'updated_at', 'updated_by', 'last_change_summary'])
    ) then
      raise exception 'Archived revision content is retained and cannot be edited.' using errcode = '23514';
    end if;
    if old.approval_status = 'approved' and (
      row(new.work_item_id, new.body_markdown, new.notes_markdown, new.uncommon_tools,
        new.iso_clause_refs, new.process_scope, new.acceptance_criteria,
        new.verification_records, new.risk_controls, new.revision)
      is distinct from
      row(old.work_item_id, old.body_markdown, old.notes_markdown, old.uncommon_tools,
        old.iso_clause_refs, old.process_scope, old.acceptance_criteria,
        old.verification_records, old.risk_controls, old.revision)
    ) then
      raise exception 'Create a new revision to change an approved instruction.' using errcode = '23514';
    end if;
  end if;
  if new.approval_status = 'approved' and
     (tg_op = 'INSERT' or old.approval_status is distinct from new.approval_status) then
    if tg_op = 'INSERT' or old.approval_status <> 'pending_review' then
      raise exception 'Only a submitted instruction can be approved.' using errcode = '23514';
    end if;
    if new.approved_by is null or new.approved_at is null or not exists (
      select 1 from public.profiles where id = new.approved_by and is_active and role in ('admin', 'system_admin')
    ) then
      raise exception 'Approval requires an active authorized approver and timestamp.' using errcode = '23514';
    end if;
    if auth.uid() is not null and auth.uid() <> new.approved_by then
      raise exception 'Approval identity must match the signed-in approver.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_instruction_release before insert or update on public.work_instructions
for each row execute function public.guard_instruction_release();

-- The caller's identity comes from the authenticated database session, never JSON.
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
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null then raise exception 'An active signed-in user is required.' using errcode = '42501'; end if;
  if mode is null or mode not in ('create', 'edit', 'fork') or next_revision is null or next_revision < 1
    or coalesce(part, '') = '' or coalesce(title, '') = '' or department is null
    or coalesce(btrim(p_payload->>'bodyMarkdown'), '') = ''
    or coalesce(btrim(p_payload->>'processScope'), '') = ''
    or coalesce(btrim(p_payload->>'acceptanceCriteria'), '') = ''
    or coalesce(btrim(p_payload->>'verificationRecords'), '') = '' then
    raise exception 'Part, title, department, positive revision, steps, scope, acceptance criteria and verification records are required.' using errcode = '23514';
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
  if mode = 'edit' and next_revision = previous.revision then
    new_id := previous.id;
    update public.work_instructions set work_item_id = target_item,
      body_markdown = p_payload->>'bodyMarkdown', uncommon_tools = coalesce(p_payload->>'uncommonTools', ''),
      iso_clause_refs = array(select jsonb_array_elements_text(p_payload->'isoClauseRefs')),
      process_scope = p_payload->>'processScope', acceptance_criteria = p_payload->>'acceptanceCriteria',
      verification_records = p_payload->>'verificationRecords', risk_controls = coalesce(p_payload->>'riskControls', ''),
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
      coalesce(p_payload->>'uncommonTools', ''), array(select jsonb_array_elements_text(p_payload->'isoClauseRefs')),
      p_payload->>'processScope', p_payload->>'acceptanceCriteria', p_payload->>'verificationRecords', coalesce(p_payload->>'riskControls', ''),
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

create or replace function public.decide_work_instruction(p_id uuid, p_actor uuid, p_status text,
  p_note text, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare current_instruction public.work_instructions;
begin
  if not exists (select 1 from public.profiles where id = p_actor and is_active and role in ('admin', 'system_admin')) then
    raise exception 'An active approver is required.' using errcode = '42501';
  end if;
  select * into current_instruction from public.work_instructions where id = p_id for update;
  if current_instruction.id is null then raise exception 'Instruction not found.' using errcode = 'P0002'; end if;
  if current_instruction.is_archived or current_instruction.approval_status <> 'pending_review'
    or current_instruction.updated_at is distinct from p_expected_updated_at then
    raise exception 'This instruction changed or is no longer pending review. Refresh before deciding.' using errcode = 'PT409';
  end if;
  if p_status is null or p_status not in ('approved', 'rejected') or
    (p_status = 'rejected' and coalesce(btrim(p_note), '') = '') then
    raise exception 'A rejection requires a reason.' using errcode = '23514';
  end if;
  if p_status = 'approved' then
    -- The release swap and its audit events commit together with the decision.
    perform pg_advisory_xact_lock(hashtextextended(current_instruction.revision_family_id::text, 2));
    update public.work_instructions set is_archived = true, updated_by = p_actor,
      last_change_summary = format('Superseded by approved revision %s.', current_instruction.revision)
      where revision_family_id = current_instruction.revision_family_id and id <> p_id
        and not is_archived and approval_status = 'approved';
  end if;
  update public.work_instructions set approval_status = p_status::public.instruction_approval_status,
    approved_by = case when p_status = 'approved' then p_actor else null end,
    approved_at = case when p_status = 'approved' then now() else null end,
    rejected_by = case when p_status = 'rejected' then p_actor else null end,
    rejected_at = case when p_status = 'rejected' then now() else null end,
    approval_note = coalesce(btrim(p_note), ''), updated_by = p_actor,
    last_change_summary = case when p_status = 'approved' then 'Approved for controlled release.' else 'Rejected: ' || btrim(p_note) end
    where id = p_id;
  if p_status = 'approved' then
    insert into public.instruction_review_status (instruction_id, status, last_calibrated_at, flagged_at, flagged_by, updated_by)
      values (p_id, 'up_to_date', now(), null, null, p_actor)
      on conflict (instruction_id) do update set status = 'up_to_date', last_calibrated_at = now(), flagged_at = null, flagged_by = null, updated_by = p_actor;
  end if;
  return jsonb_build_object('status', p_status);
end;
$$;
revoke all on function public.decide_work_instruction(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.decide_work_instruction(uuid, uuid, text, text, timestamptz) to service_role;

create or replace function public.set_work_instruction_archive(p_id uuid, p_actor uuid, p_archive boolean, p_force_swap boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare target public.work_instructions; conflict_row public.work_instructions; displaced uuid[] := '{}';
begin
  if not exists (select 1 from public.profiles where id = p_actor and is_active and role in ('admin', 'system_admin')) then
    raise exception 'Only active editors can archive or restore instructions.' using errcode = '42501';
  end if;
  select * into target from public.work_instructions where id = p_id for update;
  if target.id is null then raise exception 'Instruction not found.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target.revision_family_id::text, 2));
  if p_archive then
    update public.work_instructions set is_archived = true, updated_by = p_actor,
      last_change_summary = 'Archived; retained for controlled-document traceability.' where id = p_id and not is_archived;
  elsif target.is_archived then
    select * into conflict_row from public.work_instructions i
      where not i.is_archived and i.id <> p_id
        and ((i.approval_status = 'approved') = (target.approval_status = 'approved'))
        and (i.revision_family_id = target.revision_family_id
          or (target.fork_root_instruction_id is null and i.fork_root_instruction_id is null and i.work_item_id = target.work_item_id))
      order by i.revision desc limit 1 for update;
    if conflict_row.id is not null and not p_force_swap then
      return jsonb_build_object('conflict', jsonb_build_object(
        'existingInstructionId', conflict_row.id, 'existingRevision', conflict_row.revision,
        'restoringRevision', target.revision, 'hasNewerRevision', conflict_row.revision > target.revision));
    end if;
    with archived as (
      update public.work_instructions i set is_archived = true, updated_by = p_actor,
        last_change_summary = format('Replaced by explicit restoration of revision %s.', target.revision)
      where not i.is_archived and i.id <> p_id
        and ((i.approval_status = 'approved') = (target.approval_status = 'approved'))
        and (i.revision_family_id = target.revision_family_id
          or (target.fork_root_instruction_id is null and i.fork_root_instruction_id is null and i.work_item_id = target.work_item_id))
      returning id
    ) select coalesce(array_agg(id), '{}') into displaced from archived;
    update public.work_instructions set is_archived = false, updated_by = p_actor,
      last_change_summary = 'Restored from retained revision history by an authorized editor.' where id = p_id;
  end if;
  return jsonb_build_object('success', true, 'archived', p_archive, 'restored', not p_archive,
    'promotedInstructionId', p_id, 'archivedInstructionIds', to_jsonb(displaced), 'swappedOutInstructionIds', to_jsonb(displaced));
end;
$$;
revoke all on function public.set_work_instruction_archive(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_work_instruction_archive(uuid, uuid, boolean, boolean) to service_role;

create or replace function public.merge_work_instruction_controlled(p_fork_id uuid, p_actor uuid,
  p_fields jsonb, p_expected_root_updated_at timestamptz, p_expected_fork_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  fork public.work_instructions; root public.work_instructions;
  original public.work_instructions; root_item public.work_items; fork_item public.work_items;
  payload jsonb; result jsonb; merged_id uuid; tools jsonb; content public.work_instructions;
begin
  if not exists (select 1 from public.profiles where id = p_actor and is_active and role in ('admin', 'system_admin')) then
    raise exception 'Only active editors can merge branches.' using errcode = '42501';
  end if;
  select * into fork from public.work_instructions where id = p_fork_id for update;
  if fork.id is null or fork.fork_root_instruction_id is null or fork.is_archived then
    raise exception 'An active instruction branch is required.' using errcode = '23514';
  end if;
  select * into original from public.work_instructions where id = fork.fork_root_instruction_id;
  perform pg_advisory_xact_lock(hashtextextended(original.revision_family_id::text, 2));
  select * into root from public.work_instructions where revision_family_id = original.revision_family_id and not is_archived
    order by revision desc limit 1 for update;
  if root.id is null or root.updated_at is distinct from p_expected_root_updated_at or
    fork.updated_at is distinct from p_expected_fork_updated_at then
    raise exception 'The branch or original changed. Refresh and review the merge preview again.' using errcode = 'PT409';
  end if;
  if not exists (select 1 from jsonb_each(p_fields) where value = 'true'::jsonb) then
    raise exception 'Select at least one field to merge.' using errcode = '23514';
  end if;
  select * into root_item from public.work_items where id = root.work_item_id;
  select * into fork_item from public.work_items where id = fork.work_item_id;
  content := case when p_fields->>'body' = 'true' then fork else root end;
  select coalesce(jsonb_agg(suggested_tool_id), '[]') into tools from public.instruction_suggested_tools
    where instruction_id = content.id;
  payload := jsonb_build_object('mode','edit','instructionId',root.id,'expectedUpdatedAt',root.updated_at,
    'departmentId',case when p_fields->>'department' = 'true' then fork_item.department_id else root_item.department_id end,
    'partId',case when p_fields->>'partId' = 'true' then fork_item.part_id else root_item.part_id end,
    'itemTitle',case when p_fields->>'itemTitle' = 'true' then fork_item.item_title else root_item.item_title end,
    'bodyMarkdown',content.body_markdown,'uncommonTools',content.uncommon_tools,
    'isoClauseRefs',to_jsonb(content.iso_clause_refs),'processScope',content.process_scope,
    'acceptanceCriteria',content.acceptance_criteria,'verificationRecords',content.verification_records,
    'riskControls',content.risk_controls,'suggestedToolIds',tools,
    'revision',(select max(revision) + 1 from public.work_instructions where revision_family_id = root.revision_family_id),
    'changeSummary',format('Merged branch %s into a new revision; approval is required before release.',fork.fork_number));
  -- Identity is set only within this service-role-only transaction.
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  result := public.save_work_instruction_controlled(payload);
  merged_id := (result->>'instructionId')::uuid;
  if p_fields->>'media' = 'true' then
    delete from public.instruction_media where instruction_id = merged_id;
    insert into public.instruction_media (instruction_id,storage_path,public_url,media_type,caption,sort_order,created_by)
      select merged_id,storage_path,public_url,media_type,caption,sort_order,created_by
      from public.instruction_media where instruction_id = fork.id;
    insert into public.work_instruction_import_files (instruction_id,file_name,content_type,file_size,content_base64,created_by)
      select merged_id,file_name,content_type,file_size,content_base64,created_by
      from public.work_instruction_import_files where instruction_id = fork.id;
  end if;
  update public.work_instructions set merged_into_root_at = now(), merge_count = merge_count + 1,
    is_archived = true, updated_by = p_actor,
    last_change_summary = format('Merged into instruction %s; branch retained.',merged_id) where id = fork.id;
  insert into public.instruction_change_events (instruction_id,actor_user_id,event_type,detail,revision,occurred_at,source_payload)
    values (merged_id,p_actor,'updated',payload->>'changeSummary',(payload->>'revision')::integer,clock_timestamp(),
      jsonb_build_object('kind','fork_merge','forkInstructionId',fork.id,'rootInstructionId',root.id,'fields',p_fields));
  return jsonb_build_object('success',true,'rootInstructionId',merged_id,'mergedAt',now(),'mergedFields',p_fields);
end;
$$;
revoke all on function public.merge_work_instruction_controlled(uuid, uuid, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.merge_work_instruction_controlled(uuid, uuid, jsonb, timestamptz, timestamptz) to service_role;

create trigger retain_instruction_import_files before update or delete on public.work_instruction_import_files
for each row execute function public.prevent_audit_event_mutation();

-- Document writes go through the checked transaction; browsers cannot bypass it.
revoke insert, update, delete on public.work_instructions from authenticated, anon;
revoke insert, update, delete on public.instruction_suggested_tools from authenticated, anon;
revoke update, delete on public.work_items from authenticated, anon;

create or replace function public.guard_instruction_child_evidence()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if (tg_op <> 'INSERT' and exists (select 1 from public.work_instructions where id = old.instruction_id and (is_archived or approval_status = 'approved')))
    or (tg_op <> 'DELETE' and exists (select 1 from public.work_instructions where id = new.instruction_id and (is_archived or approval_status = 'approved'))) then
    raise exception 'Released or archived instruction evidence is retained. Create a new revision.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger retain_instruction_media before insert or update or delete on public.instruction_media
for each row execute function public.guard_instruction_child_evidence();
create trigger retain_instruction_tools before insert or update or delete on public.instruction_suggested_tools
for each row execute function public.guard_instruction_child_evidence();
create trigger retain_instruction_import_insert before insert on public.work_instruction_import_files
for each row execute function public.guard_instruction_child_evidence();

create or replace function public.guard_instruction_work_item()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if row(old.part_id,old.item_title,old.department_id) is distinct from row(new.part_id,new.item_title,new.department_id)
    and exists (select 1 from public.work_instructions where work_item_id = old.id) then
    raise exception 'Work-item identity is retained with instruction history. Create a revised instruction instead.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger retain_instruction_work_item before update on public.work_items
for each row execute function public.guard_instruction_work_item();

create policy instruction_media_storage_delete_retention on storage.objects as restrictive
for delete to authenticated using (bucket_id <> 'instruction-media');
create policy instruction_media_storage_update_retention on storage.objects as restrictive
for update to authenticated using (bucket_id <> 'instruction-media') with check (bucket_id <> 'instruction-media');

drop policy if exists instruction_change_events_select_authenticated on public.instruction_change_events;
create policy instruction_change_events_select_controlled on public.instruction_change_events for select to authenticated
using (exists (select 1 from public.work_instructions i where i.id = instruction_id));

commit;
