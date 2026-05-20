alter table public.process_documents
  add column if not exists document_cover_image_data_url text not null default '',
  add column if not exists document_cover_image_name text not null default '';

alter table public.work_instructions
  add column if not exists iso_clause_refs text[] not null default array[
    '7.5 Documented information',
    '8.5 Production and service provision',
    '8.6 Release of products and services'
  ]::text[],
  add column if not exists process_scope text not null default '',
  add column if not exists acceptance_criteria text not null default '',
  add column if not exists verification_records text not null default '',
  add column if not exists risk_controls text not null default '';
