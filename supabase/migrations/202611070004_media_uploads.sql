begin;

-- Contributors can author instructions, so their camera uploads need the same
-- capability. Storage derives owner_id from the authenticated JWT subject.
drop policy if exists storage_instruction_media_insert on storage.objects;
create policy storage_instruction_media_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'instruction-media'
  and owner_id = (select auth.uid())::text
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active)
);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('instruction-media','instruction-media',true,1073741824,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/x-m4v','video/quicktime','video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
