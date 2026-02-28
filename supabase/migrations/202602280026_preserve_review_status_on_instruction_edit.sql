begin;

create or replace function public.sync_instruction_review_status_from_instruction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  baseline_at timestamptz := coalesce(new.updated_at, new.created_at, timezone('utc', now()));
  actor_user_id uuid := coalesce(new.updated_by, new.created_by);
begin
  if TG_OP = 'UPDATE' then
    if old.work_item_id is not distinct from new.work_item_id
      and old.body_markdown is not distinct from new.body_markdown
      and old.notes_markdown is not distinct from new.notes_markdown
      and old.revision is not distinct from new.revision
      and coalesce(old.last_change_summary, '') = coalesce(new.last_change_summary, '')
    then
      return new;
    end if;
  end if;

  if actor_user_id is null then
    return new;
  end if;

  insert into public.instruction_review_status (
    instruction_id,
    status,
    last_calibrated_at,
    flagged_at,
    flagged_by,
    updated_by
  )
  values (
    new.id,
    'up_to_date',
    baseline_at,
    null,
    null,
    actor_user_id
  )
  on conflict (instruction_id) do update
  set
    status = instruction_review_status.status,
    last_calibrated_at = case
      when instruction_review_status.status = 'up_to_date'
        then excluded.last_calibrated_at
      else instruction_review_status.last_calibrated_at
    end,
    flagged_at = case
      when instruction_review_status.status = 'needs_review'
        then instruction_review_status.flagged_at
      else null
    end,
    flagged_by = case
      when instruction_review_status.status = 'needs_review'
        then instruction_review_status.flagged_by
      else null
    end,
    updated_by = excluded.updated_by,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

commit;
