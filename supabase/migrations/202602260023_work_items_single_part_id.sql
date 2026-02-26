begin;

alter table public.work_items
  add column if not exists part_id text;

update public.work_items
set part_id = nullif(btrim(part_number), '')
where coalesce(btrim(part_id), '') = '';

update public.work_items
set part_id = nullif(btrim(mold_number), '')
where coalesce(btrim(part_id), '') = ''
  and coalesce(btrim(mold_number), '') <> '';

update public.work_items
set part_id = format('LEGACY-%s', substr(id::text, 1, 8))
where coalesce(btrim(part_id), '') = '';

update public.work_items
set part_id = btrim(part_id);

with ranked_work_items as (
  select
    wi.id,
    first_value(wi.id) over (
      partition by wi.department_id, wi.item_title, wi.part_id
      order by wi.updated_at desc, wi.created_at desc, wi.id desc
    ) as canonical_id,
    row_number() over (
      partition by wi.department_id, wi.item_title, wi.part_id
      order by wi.updated_at desc, wi.created_at desc, wi.id desc
    ) as row_rank
  from public.work_items wi
),
duplicate_work_items as (
  select
    id,
    canonical_id
  from ranked_work_items
  where row_rank > 1
),
active_candidates as (
  select
    wi.id,
    coalesce(dwi.canonical_id, wi.work_item_id) as target_work_item_id,
    wi.revision,
    wi.updated_at,
    wi.created_at
  from public.work_instructions wi
  left join duplicate_work_items dwi
    on dwi.id = wi.work_item_id
  where wi.is_archived = false
),
ranked_active_candidates as (
  select
    ac.id,
    row_number() over (
      partition by ac.target_work_item_id
      order by ac.revision desc, ac.updated_at desc, ac.created_at desc, ac.id desc
    ) as active_rank
  from active_candidates ac
)
update public.work_instructions wi
set is_archived = true
from ranked_active_candidates rac
where wi.id = rac.id
  and rac.active_rank > 1;

with ranked_work_items as (
  select
    wi.id,
    first_value(wi.id) over (
      partition by wi.department_id, wi.item_title, wi.part_id
      order by wi.updated_at desc, wi.created_at desc, wi.id desc
    ) as canonical_id,
    row_number() over (
      partition by wi.department_id, wi.item_title, wi.part_id
      order by wi.updated_at desc, wi.created_at desc, wi.id desc
    ) as row_rank
  from public.work_items wi
),
duplicate_work_items as (
  select
    id,
    canonical_id
  from ranked_work_items
  where row_rank > 1
)
update public.work_instructions wi
set work_item_id = dwi.canonical_id
from duplicate_work_items dwi
where wi.work_item_id = dwi.id;

with ranked_work_items as (
  select
    wi.id,
    row_number() over (
      partition by wi.department_id, wi.item_title, wi.part_id
      order by wi.updated_at desc, wi.created_at desc, wi.id desc
    ) as row_rank
  from public.work_items wi
)
delete from public.work_items wi
using ranked_work_items rwi
where wi.id = rwi.id
  and rwi.row_rank > 1;

drop index if exists public.work_items_part_number_idx;
drop index if exists public.work_items_mold_number_idx;

alter table public.work_items
  drop constraint if exists work_items_part_number_mold_number_item_title_key;

alter table public.work_items
  drop constraint if exists work_items_part_mold_title_department_key;

alter table public.work_items
  drop constraint if exists work_items_part_id_item_title_department_key;

alter table public.work_items
  drop constraint if exists work_items_part_id_not_blank_check;

alter table public.work_items
  alter column part_id set not null;

alter table public.work_items
  add constraint work_items_part_id_not_blank_check
  check (char_length(btrim(part_id)) > 0);

alter table public.work_items
  add constraint work_items_part_id_item_title_department_key
  unique (part_id, item_title, department_id);

create index if not exists work_items_part_id_idx
  on public.work_items (part_id);

alter table public.work_items
  drop column if exists part_number;

alter table public.work_items
  drop column if exists mold_number;

commit;
