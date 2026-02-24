-- Optional helper: seed baseline departments.
-- Edit this list to match your facility before running.

insert into public.departments (name, sort_order, color_hex)
values
  ('Office', 0, '#0EA5E9'),
  ('Compression Molding', 1, '#22C55E'),
  ('Spin-Cast', 2, '#F97316'),
  ('Large-Cast', 3, '#A855F7'),
  ('Machine Shop', 4, '#EAB308'),
  ('Open-Cast', 5, '#14B8A6'),
  ('Assembly', 6, '#EF4444'),
  ('Trim', 7, '#8B5CF6'),
  ('Shipping', 8, '#06B6D4'),
  ('Maintenance', 9, '#84CC16'),
  ('Quality', 10, '#F43F5E')
on conflict do nothing;
