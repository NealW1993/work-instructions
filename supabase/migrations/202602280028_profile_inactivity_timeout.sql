begin;

alter table public.profiles
  add column if not exists inactivity_timeout_minutes integer;

update public.profiles
set inactivity_timeout_minutes = 15
where inactivity_timeout_minutes is null;

alter table public.profiles
  alter column inactivity_timeout_minutes set default 15;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_inactivity_timeout_minutes_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_inactivity_timeout_minutes_check
      check (
        inactivity_timeout_minutes is null
        or (inactivity_timeout_minutes >= 1 and inactivity_timeout_minutes <= 10080)
      );
  end if;
end
$$;

commit;
