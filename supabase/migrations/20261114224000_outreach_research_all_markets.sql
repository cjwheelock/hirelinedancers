-- Research wedding planners in every active city, with or without an instructor.
-- Cities without an instructor are research-only (auto_send false): their leads stay 'new'
-- until an instructor joins there, or until CJ approves no-instructor outreach copy.

delete from public.outreach_markets where service_market_slug like 'hld-test%';

create or replace function public.outreach_queue_new_markets() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  -- 1. A city whose research-only row gains its first instructor joins the sending line.
  --    If its research is still running, it moves to the front of the research line.
  with joined as (
    select distinct on (m.slug) m.slug, p.id, p.display_name, p.slug as profile_slug
    from public.service_markets m
    join public.instructor_service_markets ism on ism.service_market_slug = m.slug and ism.accepting_inquiries
    join public.instructor_profiles p on p.id = ism.instructor_profile_id and p.status = 'published'
    join public.outreach_markets o on o.service_market_slug = m.slug and o.featured_instructor_profile_id is null
    where m.active and m.slug not like 'hld-test%' and coalesce(p.headline, '') not ilike '%test profile%'
    order by m.slug, p.approved_at nulls last
  )
  update public.outreach_markets o set
    featured_instructor_profile_id = j.id,
    featured_instructor_name = j.display_name,
    featured_profile_url = 'https://hirelinedancers.com/profile/' || j.profile_slug || '/',
    auto_send = true,
    details_requested_at = null,
    created_at = case when o.research_status = 'done' then o.created_at
      else (select min(x.created_at) - interval '1 second' from public.outreach_markets x) end
  from joined j where o.service_market_slug = j.slug;
  get diagnostics n = row_count;

  -- 2. Every other active city gets a research-only row.
  insert into public.outreach_markets (service_market_slug, auto_send, research_localities)
  select m.slug, false,
    coalesce((select array_agg(l.city || ', ' || l.region) from public.service_market_localities l where l.service_market_slug = m.slug), array[m.name || ', ' || m.region])
  from public.service_markets m
  where m.active and m.slug not like 'hld-test%'
    and not exists (select 1 from public.outreach_markets o where o.service_market_slug = m.slug)
  order by m.slug
  on conflict do nothing;
  return n;
end $$;

select public.outreach_queue_new_markets();
