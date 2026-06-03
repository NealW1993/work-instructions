begin;

create or replace function public.notification_setting_enabled(
  p_user_id uuid,
  p_setting_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.user_settings #>> array['notifications', p_setting_key] is null then true
    when lower(p.user_settings #>> array['notifications', p_setting_key]) in ('email', 'false', 'none', 'off') then false
    else true
  end
  from public.profiles p
  where p.id = p_user_id
$$;

commit;
