update public.profiles
set role = 'system_admin'
where lower(email) = lower('nealwiechman@gmail.com');
