-- Email-only landing pages (/first-last-city-weddings/) for instructors featured in planner outreach.
create or replace function public.outreach_landing_pages()
returns table (instructor_profile_id uuid, city text, pronoun text, slug text)
language sql stable security definer set search_path = '' as $$
  with featured as (
    select m.featured_instructor_profile_id as pid, m.featured_instructor_pronoun as pronoun, m.service_market_slug, 0 as pri
    from public.outreach_markets m where m.featured_instructor_profile_id is not null
    union all
    select i.instructor_profile_id, i.pronoun, i.service_market_slug, 1
    from public.outreach_market_instructors i
  ), named as (
    select distinct on (f.pid) f.pid, f.pronoun,
      trim(regexp_replace(sm.name, '\s+(metro|and .*|Bay Area)$', '', 'i')) as city, p.display_name
    from featured f
    join public.service_markets sm on sm.slug = f.service_market_slug
    join public.instructor_profiles p on p.id = f.pid and p.status = 'published'
    order by f.pid, (f.pronoun is null), f.pri
  )
  select n.pid, n.city, n.pronoun,
    trim(both '-' from regexp_replace(lower(n.display_name || ' ' || n.city), '[^a-z0-9]+', '-', 'g')) || '-weddings'
  from named n;
$$;
revoke all on function public.outreach_landing_pages() from public;
grant execute on function public.outreach_landing_pages() to anon, authenticated, service_role;
