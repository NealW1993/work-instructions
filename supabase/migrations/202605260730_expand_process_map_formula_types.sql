alter table public.process_map_formulas
  drop constraint if exists process_map_formulas_type_check;

alter table public.process_map_formulas
  add constraint process_map_formulas_type_check check (
    formula_type in (
      'oee',
      'capability',
      'dpmo',
      'takt',
      'yield',
      'little_law',
      'normal_curve',
      'control_limits'
    )
  );
