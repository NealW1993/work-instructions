-- Optional helper: assign Employee IDs for existing users.
-- Replace the values list with your real users before running.

with employee_id_mapping(email, employee_id) as (
  values
    ('nwiechman@omnitechnologies.com', '100001')
),
normalized as (
  select
    lower(trim(email)) as email,
    nullif(left(regexp_replace(employee_id, '[^0-9]', '', 'g'), 6), '') as employee_id
  from employee_id_mapping
),
updated_profiles as (
  update public.profiles p
  set employee_id = n.employee_id
  from normalized n
  where lower(p.email) = n.email
    and n.employee_id is not null
  returning n.email, n.employee_id
)
update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('employee_id', up.employee_id)
from updated_profiles up
where lower(u.email) = up.email;
