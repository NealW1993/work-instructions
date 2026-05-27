alter table public.process_documents
  add column if not exists process_purpose text not null default '',
  add column if not exists process_map_payload jsonb not null default '{}'::jsonb;

alter table public.process_document_revisions
  add column if not exists process_map_payload jsonb not null default '{}'::jsonb;

create index if not exists process_documents_process_map_payload_idx
  on public.process_documents using gin (process_map_payload)
  where document_type = 'process_map';
