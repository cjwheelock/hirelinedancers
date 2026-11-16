-- Planner emails link to the instructor's email-only landing page (https://hirelinedancers.com/<first>-<last>-<city>-weddings).
create or replace function public.outreach_sync_landing_urls() returns void
language sql security definer set search_path = '' as $$
  update public.outreach_markets m set featured_profile_url = 'https://hirelinedancers.com/' || l.slug
  from public.outreach_landing_pages() l
  where l.instructor_profile_id = m.featured_instructor_profile_id
    and m.featured_profile_url is distinct from 'https://hirelinedancers.com/' || l.slug;
  update public.outreach_market_instructors i set profile_url = 'https://hirelinedancers.com/' || l.slug
  from public.outreach_landing_pages() l
  where l.instructor_profile_id = i.instructor_profile_id
    and i.profile_url is distinct from 'https://hirelinedancers.com/' || l.slug;
$$;
revoke all on function public.outreach_sync_landing_urls() from public, anon, authenticated;
grant execute on function public.outreach_sync_landing_urls() to service_role;
-- outreach_activate_markets() now starts with: perform public.outreach_sync_landing_urls();
-- Closing line of planner_first_touch updated 2026-11-16 to CJ's wording:
-- "We'd love to be kept in mind for any weddings you're planning because we think we can help you create a fun, memorable experience for your clients."
