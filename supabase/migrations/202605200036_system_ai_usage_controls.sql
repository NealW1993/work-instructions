begin;

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint system_settings_key_not_blank check (btrim(key) <> '')
);

drop trigger if exists on_system_settings_updated on public.system_settings;
create trigger on_system_settings_updated
before update on public.system_settings
for each row
execute function public.set_updated_at();

alter table public.system_settings enable row level security;

drop policy if exists system_settings_select_authenticated on public.system_settings;
create policy system_settings_select_authenticated
on public.system_settings
for select
to authenticated
using (true);

drop policy if exists system_settings_insert_system_admin on public.system_settings;
create policy system_settings_insert_system_admin
on public.system_settings
for insert
to authenticated
with check ((select public.is_system_admin()));

drop policy if exists system_settings_update_system_admin on public.system_settings;
create policy system_settings_update_system_admin
on public.system_settings
for update
to authenticated
using ((select public.is_system_admin()))
with check ((select public.is_system_admin()));

insert into public.system_settings (key, value)
values ('dashboard_ai_search_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null,
  action text not null default '',
  mode text not null default '',
  subject_type text not null default '',
  subject_id uuid,
  token_input integer not null default 0 check (token_input >= 0),
  token_output integer not null default 0 check (token_output >= 0),
  token_total integer not null default 0 check (token_total >= 0),
  model text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_usage_events_feature_not_blank check (btrim(feature) <> ''),
  constraint ai_usage_events_action_not_blank check (btrim(action) <> '')
);

create index if not exists ai_usage_events_actor_created_idx
  on public.ai_usage_events (actor_user_id, created_at desc);

create index if not exists ai_usage_events_feature_created_idx
  on public.ai_usage_events (feature, created_at desc);

create index if not exists ai_usage_events_subject_idx
  on public.ai_usage_events (subject_type, subject_id);

alter table public.ai_usage_events enable row level security;

drop policy if exists ai_usage_events_select_actor_or_kpi_admin on public.ai_usage_events;
create policy ai_usage_events_select_actor_or_kpi_admin
on public.ai_usage_events
for select
to authenticated
using (actor_user_id = (select auth.uid()) or (select public.is_editor()));

drop policy if exists ai_usage_events_insert_actor on public.ai_usage_events;
create policy ai_usage_events_insert_actor
on public.ai_usage_events
for insert
to authenticated
with check (actor_user_id = (select auth.uid()));

insert into public.ai_usage_events (
  actor_user_id,
  feature,
  action,
  mode,
  subject_type,
  subject_id,
  metadata,
  created_at
)
select
  actor_user_id,
  'instruction_enhancement',
  outcome::text,
  mode::text,
  'work_instruction',
  instruction_id,
  jsonb_build_object(
    'enhancementId', id,
    'source_instruction_id', source_instruction_id,
    'part_id', part_id,
    'item_title', item_title,
    'department_name', department_name,
    'revision', revision,
    'source', 'backfill_instruction_ai_enhancements'
  ),
  generated_at
from public.instruction_ai_enhancements existing
where not exists (
  select 1
  from public.ai_usage_events usage
  where usage.actor_user_id = existing.actor_user_id
    and usage.feature = 'instruction_enhancement'
    and usage.action = existing.outcome::text
    and (
      usage.created_at = existing.generated_at
      or usage.metadata ->> 'enhancementId' = existing.id::text
    )
);

insert into public.ai_usage_events (
  actor_user_id,
  feature,
  action,
  mode,
  token_input,
  token_output,
  token_total,
  metadata,
  created_at
)
select
  actor_user_id,
  'dashboard_search',
  'query',
  mode,
  0,
  0,
  0,
  jsonb_build_object(
    'query', query,
    'result_count', result_count,
    'source', 'backfill_document_search_events'
  ),
  created_at
from public.document_search_events existing
where not exists (
  select 1
  from public.ai_usage_events usage
  where usage.actor_user_id = existing.actor_user_id
    and usage.feature = 'dashboard_search'
    and usage.action = 'query'
    and usage.created_at = existing.created_at
);

insert into public.ai_usage_events (
  actor_user_id,
  feature,
  action,
  mode,
  subject_type,
  subject_id,
  metadata,
  created_at
)
select
  created_by,
  'process_document_create',
  status::text,
  'manual',
  'process_document',
  id,
  jsonb_build_object(
    'document_number', document_number,
    'title', title,
    'document_type', document_type,
    'status', status,
    'source', 'backfill_process_documents'
  ),
  created_at
from public.process_documents existing
where not exists (
  select 1
  from public.ai_usage_events usage
  where usage.actor_user_id = existing.created_by
    and usage.feature = 'process_document_create'
    and usage.subject_id = existing.id
    and usage.created_at = existing.created_at
);

insert into public.ai_usage_events (
  actor_user_id,
  feature,
  action,
  mode,
  subject_type,
  subject_id,
  metadata,
  created_at
)
select
  prepared_by,
  case
    when source_type = 'template' then 'process_document_template'
    when source_type = 'import' then 'process_document_import'
    else 'process_document_revision'
  end,
  format('revision_%s', revision),
  source_type::text,
  'process_document',
  document_id,
  jsonb_build_object(
    'revision', revision,
    'title', title,
    'source_type', source_type,
    'template_id', template_id,
    'imported_file_name', imported_file_name,
    'imported_file_type', imported_file_type,
    'imported_file_size', imported_file_size,
    'source', 'backfill_process_document_revisions'
  ),
  created_at
from public.process_document_revisions existing
where not exists (
  select 1
  from public.ai_usage_events usage
  where usage.actor_user_id = existing.prepared_by
    and usage.subject_id = existing.document_id
    and usage.created_at = existing.created_at
    and usage.feature in (
      'process_document_revision',
      'process_document_template',
      'process_document_import'
    )
);

commit;
