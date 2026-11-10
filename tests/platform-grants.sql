-- Supabase's standard platform grants, only for disposable schema clones.
grant usage on schema public, auth, storage to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
