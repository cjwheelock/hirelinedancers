insert into public.directory_instructor_targets (
  slug,
  display_name,
  business_name,
  city,
  region,
  active
)
values (
  'tessa-mctester',
  'Tessa McTester',
  'Tessa McTester Dance Co.',
  'Austin',
  'TX',
  true
)
on conflict (slug) do update set
  display_name = excluded.display_name,
  business_name = excluded.business_name,
  city = excluded.city,
  region = excluded.region,
  active = true,
  updated_at = now();
