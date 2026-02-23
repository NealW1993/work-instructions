-- Optional helper: seed baseline departments.
-- Edit this list to match your facility before running.

insert into public.departments (name)
values
  ('Office'),
  ('Compression Molding'),
  ('Spin-Cast'),
  ('Large-Cast'),
  ('Machine Shop'),
  ('Open-Cast'),
  ('Assembly'),
  ('Trim'),
  ('Shipping'),
  ('Maintenance'),
  ('Quality')
on conflict do nothing;
