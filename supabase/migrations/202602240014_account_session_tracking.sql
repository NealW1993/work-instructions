begin;

alter table public.profiles
  add column if not exists total_signed_in_seconds bigint not null default 0,
  add column if not exists active_session_started_at timestamptz;

create or replace function public.touch_user_session(end_session boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  now_ts timestamptz := timezone('utc', now());
  next_total bigint;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles as p
  set
    total_signed_in_seconds = p.total_signed_in_seconds +
      case
        when p.active_session_started_at is null then 0
        else greatest(
          0,
          floor(extract(epoch from (now_ts - p.active_session_started_at)))::bigint
        )
      end,
    active_session_started_at =
      case
        when end_session then null
        else now_ts
      end
  where p.id = auth.uid()
  returning p.total_signed_in_seconds into next_total;

  if next_total is null then
    raise exception 'Profile not found';
  end if;

  return next_total;
end;
$$;

revoke execute on function public.touch_user_session(boolean) from public;
grant execute on function public.touch_user_session(boolean) to authenticated;

update public.profiles
set total_signed_in_seconds = coalesce(total_signed_in_seconds, 0)
where true;

commit;
