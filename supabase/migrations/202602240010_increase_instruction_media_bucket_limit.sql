begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('instruction-media', 'instruction-media', true, 1073741824)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

commit;
