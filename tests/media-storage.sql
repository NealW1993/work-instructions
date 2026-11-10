begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001','camera-test@example.invalid','{"full_name":"Camera Test","employee_id":"970001"}'),
  ('c1000000-0000-0000-0000-000000000002','inactive-camera-test@example.invalid','{"full_name":"Inactive Camera Test","employee_id":"970002"}');
update public.profiles set is_active=false where id='c1000000-0000-0000-0000-000000000002';
grant select,insert,update,delete on storage.objects to authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into storage.objects(bucket_id,name,owner_id) values
  ('instruction-media','inline/image/test/owned.jpg','c1000000-0000-0000-0000-000000000001');
do $$
begin
  begin
    insert into storage.objects(bucket_id,name,owner_id) values
      ('instruction-media','inline/image/test/forged.jpg','c1000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: another user can own a forged upload';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name='changed.jpg' where name='inline/image/test/owned.jpg';
  if found then
    raise exception 'FAIL: retained media can be overwritten';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$
begin
  begin
    insert into storage.objects(bucket_id,name,owner_id) values
      ('instruction-media','inline/image/test/inactive.jpg','c1000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: inactive user uploaded media';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: contributor camera upload, verified ownership, retained originals, inactive account rejection';
end;
$$;
reset role;
rollback;
