begin;

alter table public.work_instruction_import_files
  add column if not exists file_sha256 text not null default '';

-- Every new retained copy, including revision clones, receives a checksum of
-- its actual bytes. Existing evidence is left untouched by this migration.
create or replace function public.stamp_instruction_import_checksum()
returns trigger language plpgsql set search_path = public, extensions, pg_catalog as $$
declare source_bytes bytea;
begin
  source_bytes := decode(new.content_base64, 'base64');
  if octet_length(source_bytes) < 1 or octet_length(source_bytes) > 15728640
    or new.file_size is distinct from octet_length(source_bytes)::bigint then
    raise exception 'Source file size must match its retained bytes and be at most 15 MB.' using errcode = '23514';
  end if;
  new.file_sha256 := encode(extensions.digest(source_bytes, 'sha256'), 'hex');
  return new;
end;
$$;
create trigger stamp_instruction_import_checksum before insert on public.work_instruction_import_files
for each row execute function public.stamp_instruction_import_checksum();

create or replace function public.import_work_instruction_controlled(p_actor uuid, p_metadata jsonb, p_file jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare result jsonb; instruction_id uuid; file_id uuid; file_hash text;
begin
  if not exists (select 1 from public.profiles where id=p_actor and is_active) then
    raise exception 'An active signed-in contributor is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_file) is distinct from 'object'
    or coalesce(btrim(p_file->>'file_name'),'')='' or coalesce(btrim(p_file->>'content_base64'),'')='' then
    raise exception 'Import metadata and retained source bytes are required.' using errcode = '23514';
  end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  result := public.save_work_instruction_controlled(p_metadata || jsonb_build_object('mode','create',
    'instructionId',null,'sourceInstructionId',null,'replacementInstructionId',null));
  if coalesce((result->>'conflict')::boolean,false) then
    raise exception 'An instruction already exists for this part, title and department. Open that instruction to create a controlled revision.' using errcode = '23505';
  end if;
  instruction_id := (result->>'instructionId')::uuid;
  if instruction_id is null then raise exception 'The controlled import did not return an instruction.' using errcode='23514'; end if;
  insert into public.work_instruction_import_files(instruction_id,file_name,content_type,file_size,content_base64,created_by)
    values(instruction_id,p_file->>'file_name',coalesce(nullif(p_file->>'content_type',''),'application/octet-stream'),
      (p_file->>'file_size')::bigint,p_file->>'content_base64',p_actor)
    returning id,file_sha256 into file_id,file_hash;
  insert into public.instruction_change_events(instruction_id,actor_user_id,event_type,detail,revision,occurred_at,source_payload)
    values(instruction_id,p_actor,'updated','Original source retained with checksum; review is required before production release.',
      (p_metadata->>'revision')::integer,clock_timestamp(),jsonb_build_object('kind','instruction_imported',
        'fileId',file_id,'fileName',p_file->>'file_name','fileSize',(p_file->>'file_size')::bigint,'sha256',file_hash));
  return result || jsonb_build_object('fileId',file_id,'fileSha256',file_hash);
end;
$$;
revoke all on function public.import_work_instruction_controlled(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_work_instruction_controlled(uuid,jsonb,jsonb) to service_role;

commit;
