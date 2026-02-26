begin;

with ranked_active_revisions as (
  select
    wi.id,
    row_number() over (
      partition by wi.work_item_id
      order by wi.revision desc, wi.updated_at desc, wi.created_at desc, wi.id desc
    ) as revision_rank
  from public.work_instructions wi
  where wi.is_archived = false
)
update public.work_instructions wi
set is_archived = true
from ranked_active_revisions rar
where wi.id = rar.id
  and rar.revision_rank > 1;

create unique index if not exists work_instructions_single_active_revision_idx
  on public.work_instructions (work_item_id)
  where is_archived = false;

commit;
