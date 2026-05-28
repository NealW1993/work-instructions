begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  body text not null default '',
  href text,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_notifications_event_type_not_blank check (btrim(event_type) <> ''),
  constraint user_notifications_title_not_blank check (btrim(title) <> '')
);

alter table public.process_map_formulas
  add column if not exists updated_by uuid references public.profiles(id);

update public.process_map_formulas
set updated_by = owner_user_id
where updated_by is null;

create index if not exists user_notifications_recipient_created_idx
  on public.user_notifications (recipient_user_id, created_at desc);

create index if not exists user_notifications_unread_idx
  on public.user_notifications (recipient_user_id, created_at desc)
  where read_at is null;

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
on public.user_notifications
for select
to authenticated
using (recipient_user_id = (select auth.uid()));

drop policy if exists user_notifications_update_read_own on public.user_notifications;
create policy user_notifications_update_read_own
on public.user_notifications
for update
to authenticated
using (recipient_user_id = (select auth.uid()))
with check (recipient_user_id = (select auth.uid()));

drop policy if exists user_notifications_delete_own on public.user_notifications;
create policy user_notifications_delete_own
on public.user_notifications
for delete
to authenticated
using (recipient_user_id = (select auth.uid()));

create or replace function public.notification_setting_enabled(
  p_user_id uuid,
  p_setting_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      p.user_settings #>> array['notifications', p_setting_key]
    )::boolean,
    true
  )
  from public.profiles p
  where p.id = p_user_id
$$;

create or replace function public.profile_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(full_name), ''), email, 'Unknown')
  from public.profiles
  where id = p_user_id
$$;

create or replace function public.notify_instruction_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  work_item record;
  recipient_id uuid;
  actor_id uuid;
  actor_name text;
  decision_label text;
  approval_status_changed boolean;
begin
  select wi.part_id, wi.item_title
  into work_item
  from public.work_items wi
  where wi.id = new.work_item_id;

  if work_item is null then
    return new;
  end if;

  approval_status_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    approval_status_changed := old.approval_status is distinct from new.approval_status;
  end if;

  if tg_op = 'INSERT'
    and new.approval_status = 'draft'
  then
    actor_id := coalesce(new.updated_by, new.created_by);

    for recipient_id in
      select p.id
      from public.profiles p
      where p.is_active = true
        and p.role in ('admin', 'system_admin')
        and public.notification_setting_enabled(p.id, 'newInstructions')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        actor_id,
        'instruction_created',
        'Work instruction created',
        format('%s | %s was started as a draft.', work_item.part_id, work_item.item_title),
        '/instructions/' || new.id::text,
        'work_instruction',
        new.id,
        jsonb_build_object('approvalStatus', new.approval_status, 'revision', new.revision)
      );
    end loop;
  end if;

  if new.approval_status = 'pending_review'
    and approval_status_changed
  then
    actor_id := coalesce(new.submitted_by, new.updated_by, new.created_by);

    for recipient_id in
      select p.id
      from public.profiles p
      where p.is_active = true
        and p.role in ('admin', 'system_admin')
        and public.notification_setting_enabled(p.id, 'pendingApprovals')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        actor_id,
        'instruction_pending_approval',
        'Work instruction pending approval',
        format('%s | %s was submitted for review.', work_item.part_id, work_item.item_title),
        '/instructions/' || new.id::text,
        'work_instruction',
        new.id,
        jsonb_build_object('approvalStatus', new.approval_status, 'revision', new.revision)
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
    and approval_status_changed
    and new.approval_status in ('approved', 'rejected')
  then
    actor_id := coalesce(new.approved_by, new.rejected_by, new.updated_by);
    actor_name := public.profile_name(actor_id);
    decision_label := case when new.approval_status = 'approved' then 'approved' else 'denied' end;

    for recipient_id in
      select distinct recipient
      from unnest(array[new.created_by, new.submitted_by, new.updated_by]) as recipient
      where recipient is not null
        and public.notification_setting_enabled(recipient, 'instructionApprovals')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        actor_id,
        'instruction_' || new.approval_status::text,
        'Work instruction ' || decision_label,
        format('%s | %s was %s by %s.', work_item.part_id, work_item.item_title, decision_label, actor_name),
        '/instructions/' || new.id::text,
        'work_instruction',
        new.id,
        jsonb_build_object('approvalStatus', new.approval_status, 'revision', new.revision)
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
    and approval_status_changed
    and new.approval_status = 'approved'
  then
    actor_id := coalesce(new.approved_by, new.updated_by);

    for recipient_id in
      select p.id
      from public.profiles p
      where p.is_active = true
        and public.notification_setting_enabled(p.id, 'newInstructions')
        and not exists (
          select 1
          from unnest(array[new.created_by, new.submitted_by, new.updated_by, actor_id]) as excluded_user
          where excluded_user is not null
            and excluded_user = p.id
        )
        and (
          not exists (
            select 1
            from public.work_instruction_group_access access
            where access.instruction_id = new.id
          )
          or exists (
            select 1
            from public.work_instruction_group_access access
            join public.access_group_memberships membership
              on membership.group_id = access.group_id
            where access.instruction_id = new.id
              and membership.user_id = p.id
          )
        )
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        actor_id,
        'instruction_available',
        'Work instruction available',
        format('%s | %s is approved and available.', work_item.part_id, work_item.item_title),
        '/instructions/' || new.id::text,
        'work_instruction',
        new.id,
        jsonb_build_object('approvalStatus', new.approval_status, 'revision', new.revision)
      );
    end loop;
  end if;

  return new;
end
$$;

drop trigger if exists on_work_instruction_notifications on public.work_instructions;
create trigger on_work_instruction_notifications
after insert or update of approval_status on public.work_instructions
for each row
execute function public.notify_instruction_status_change();

create or replace function public.notify_process_document_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
  actor_id uuid;
  actor_name text;
  status_changed boolean;
begin
  status_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    status_changed := old.status is distinct from new.status;
  end if;

  if new.status = 'in_review'
    and status_changed
  then
    actor_id := new.updated_by;

    for recipient_id in
      select p.id
      from public.profiles p
      where p.is_active = true
        and p.role in ('admin', 'system_admin')
        and public.notification_setting_enabled(p.id, 'pendingApprovals')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        actor_id,
        'document_pending_approval',
        'Document pending approval',
        format('%s | %s was submitted for review.', new.document_number, new.title),
        '/process-documents',
        'process_document',
        new.id,
        jsonb_build_object('status', new.status, 'revision', new.current_revision)
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
    and status_changed
    and new.status in ('approved', 'obsolete')
  then
    actor_id := coalesce(new.approved_by, new.obsoleted_by, new.updated_by);
    actor_name := public.profile_name(actor_id);

    for recipient_id in
      select distinct recipient
      from unnest(array[new.created_by, new.owner_user_id]) as recipient
      where recipient is not null
        and public.notification_setting_enabled(recipient, 'documentApprovals')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        actor_id,
        'document_' || new.status::text,
        'Document ' || new.status::text,
        format('%s | %s was %s by %s.', new.document_number, new.title, new.status, actor_name),
        '/process-documents',
        'process_document',
        new.id,
        jsonb_build_object('status', new.status, 'revision', new.current_revision)
      );
    end loop;
  end if;

  return new;
end
$$;

drop trigger if exists on_process_document_notifications on public.process_documents;
create trigger on_process_document_notifications
after insert or update of status on public.process_documents
for each row
execute function public.notify_process_document_status_change();

create or replace function public.notify_formula_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
  actor_name text;
  old_status text;
  new_status text;
begin
  if new.formula_type <> 'custom' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_status := old.payload #>> '{customFormula,approvalStatus}';
  else
    old_status := null;
  end if;
  new_status := coalesce(new.payload #>> '{customFormula,approvalStatus}', 'pending_review');

  if new_status = 'pending_review'
    and (tg_op = 'INSERT' or old_status is distinct from new_status)
  then
    for recipient_id in
      select p.id
      from public.profiles p
      where p.is_active = true
        and p.role in ('admin', 'system_admin')
        and public.notification_setting_enabled(p.id, 'pendingApprovals')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        new.owner_user_id,
        'formula_pending_approval',
        'Formula draft pending approval',
        format('%s was saved for review.', new.name),
        '/process-maps/formulas',
        'process_map_formula',
        new.id,
        jsonb_build_object('approvalStatus', new_status)
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
    and old_status is distinct from new_status
    and new_status in ('approved', 'rejected')
    and public.notification_setting_enabled(new.owner_user_id, 'formulaApprovals')
  then
    actor_name := public.profile_name(new.updated_by);
    insert into public.user_notifications (
      recipient_user_id,
      actor_user_id,
      event_type,
      title,
      body,
      href,
      entity_type,
      entity_id,
      metadata
    )
    values (
      new.owner_user_id,
      new.updated_by,
      'formula_' || new_status,
      'Formula ' || case when new_status = 'approved' then 'approved' else 'denied' end,
      format('%s was %s by %s.', new.name, case when new_status = 'approved' then 'approved' else 'denied' end, actor_name),
      '/process-maps/formulas',
      'process_map_formula',
      new.id,
      jsonb_build_object('approvalStatus', new_status)
    );
  end if;

  return new;
end
$$;

drop trigger if exists on_process_map_formula_notifications on public.process_map_formulas;
create trigger on_process_map_formula_notifications
after insert or update of payload on public.process_map_formulas
for each row
execute function public.notify_formula_status_change();

create or replace function public.notify_group_join_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  group_name text;
  requester_name text;
  recipient_id uuid;
  actor_id uuid;
  actor_name text;
  status_changed boolean;
begin
  select g.name
  into group_name
  from public.access_groups g
  where g.id = new.group_id;

  requester_name := public.profile_name(new.requester_user_id);
  status_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    status_changed := old.status is distinct from new.status;
  end if;

  if new.status = 'pending'
    and status_changed
  then
    for recipient_id in
      select p.id
      from public.profiles p
      where p.is_active = true
        and p.role in ('admin', 'system_admin')
        and public.notification_setting_enabled(p.id, 'groupRequests')
    loop
      insert into public.user_notifications (
        recipient_user_id,
        actor_user_id,
        event_type,
        title,
        body,
        href,
        entity_type,
        entity_id,
        metadata
      )
      values (
        recipient_id,
        new.requester_user_id,
        'group_join_request_pending',
        'Group join request pending',
        format('%s requested access to %s.', requester_name, coalesce(group_name, 'a group')),
        '/groups',
        'access_group_join_request',
        new.id,
        jsonb_build_object('groupId', new.group_id, 'status', new.status)
      );
    end loop;
  end if;

  if tg_op = 'UPDATE'
    and status_changed
    and new.status in ('approved', 'rejected')
    and public.notification_setting_enabled(new.requester_user_id, 'groupRequests')
  then
    actor_id := new.decided_by;
    actor_name := public.profile_name(actor_id);

    insert into public.user_notifications (
      recipient_user_id,
      actor_user_id,
      event_type,
      title,
      body,
      href,
      entity_type,
      entity_id,
      metadata
    )
    values (
      new.requester_user_id,
      actor_id,
      'group_join_request_' || new.status::text,
      'Group request ' || case when new.status = 'approved' then 'approved' else 'denied' end,
      format(
        'Access to %s was %s by %s.',
        coalesce(group_name, 'the group'),
        case when new.status = 'approved' then 'approved' else 'denied' end,
        actor_name
      ),
      '/groups',
      'access_group_join_request',
      new.id,
      jsonb_build_object('groupId', new.group_id, 'status', new.status)
    );
  end if;

  return new;
end
$$;

drop trigger if exists on_access_group_join_request_notifications on public.access_group_join_requests;
create trigger on_access_group_join_request_notifications
after insert or update of status on public.access_group_join_requests
for each row
execute function public.notify_group_join_request_change();

create or replace function public.notify_group_membership_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  group_name text;
  actor_name text;
begin
  if not public.notification_setting_enabled(new.user_id, 'groupRequests') then
    return new;
  end if;

  if exists (
    select 1
    from public.access_group_join_requests request
    where request.group_id = new.group_id
      and request.requester_user_id = new.user_id
      and request.status = 'approved'
      and request.decided_by is not distinct from new.assigned_by
      and request.decided_at >= timezone('utc', now()) - interval '5 minutes'
  ) then
    return new;
  end if;

  select g.name
  into group_name
  from public.access_groups g
  where g.id = new.group_id;

  actor_name := public.profile_name(new.assigned_by);

  insert into public.user_notifications (
    recipient_user_id,
    actor_user_id,
    event_type,
    title,
    body,
    href,
    entity_type,
    entity_id,
    metadata
  )
  values (
    new.user_id,
    new.assigned_by,
    'group_membership_assigned',
    'Group access assigned',
    format('You were assigned to %s by %s.', coalesce(group_name, 'a group'), actor_name),
    '/groups',
    'access_group',
    new.group_id,
    jsonb_build_object('groupId', new.group_id)
  );

  return new;
end
$$;

drop trigger if exists on_access_group_membership_notifications on public.access_group_memberships;
create trigger on_access_group_membership_notifications
after insert on public.access_group_memberships
for each row
execute function public.notify_group_membership_assignment();

commit;
