alter table public.outreach_market_instructors add column wait_until timestamptz;
update public.outreach_market_instructors set wait_until = '2026-11-17 16:39:00-05'
where service_market_slug = 'san-francisco-ca' and years is null;

-- Co-featured outreach instructors pick up years teaching from their profile once they add it.
create or replace function public.outreach_activate_markets()
returns table (service_market_slug text, missing text[]) language plpgsql security definer set search_path = '' as $$
begin
  update public.outreach_markets m set featured_instructor_years = p.years_teaching
  from public.instructor_profiles p
  where p.id = m.featured_instructor_profile_id and m.featured_instructor_years is null and p.years_teaching is not null;

  update public.outreach_market_instructors i set years = p.years_teaching, wait_until = null
  from public.instructor_profiles p
  where p.id = i.instructor_profile_id and i.years is null and p.years_teaching is not null;

  -- An instructor who hasn't added years by the deadline drops out of the rotation.
  delete from public.outreach_market_instructors i where i.years is null and i.wait_until < now();

  update public.outreach_leads l set status = 'approved', approved_at = now()
  from public.outreach_markets m
  where m.service_market_slug = l.service_market_slug and m.auto_send and m.research_status = 'done'
    and l.status = 'new' and l.email is not null and l.contact_method = 'email';

  update public.outreach_markets m set sending_approved = true, sending_queued_at = coalesce(m.sending_queued_at, now())
  where m.auto_send and not m.sending_approved and m.research_status = 'done'
    and m.featured_instructor_name is not null and m.featured_instructor_years is not null
    and m.featured_instructor_pronoun is not null and m.featured_profile_url is not null;

  return query
  select m.service_market_slug, array_remove(array[
    case when m.featured_instructor_years is null then 'years teaching' end,
    case when m.featured_instructor_pronoun is null then 'pronoun (she/he/they)' end,
    case when m.featured_profile_url is null then 'profile link' end], null)
  from public.outreach_markets m
  where m.auto_send and not m.sending_approved and m.research_status = 'done';
end $$;
