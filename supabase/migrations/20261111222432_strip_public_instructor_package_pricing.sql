-- Public profiles may describe services and duration, but must not publish prices.
-- Keep the stored package JSON intact for its owner/admin and private quote flows.
create or replace function private.published_instructor_profile_extras()
returns table (id uuid, highlights jsonb, packages jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.highlights,
    coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', item.value -> 'name',
        'description', item.value -> 'description',
        'durationHours', item.value -> 'durationHours'
      )) order by item.ordinality)
      from jsonb_array_elements(profile.packages) with ordinality as item(value, ordinality)
    ), '[]'::jsonb) as packages
  from public.instructor_profiles profile
  where profile.status = 'published';
$$;

-- Preserve the existing narrow public entry point and its existing grants.
-- Explicitly keep PUBLIC (all database roles) from gaining execution implicitly.
revoke all on function private.published_instructor_profile_extras() from public;
grant execute on function private.published_instructor_profile_extras() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
