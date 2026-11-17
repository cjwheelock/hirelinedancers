-- Admin analytics: one row per Eastern Time day, including days with no activity.
create index if not exists outreach_sends_sent_at_idx on public.outreach_sends (sent_at) where sent_at is not null;
create index if not exists outreach_form_submissions_created_idx on public.outreach_form_submissions (created_at);
create index if not exists instructor_profiles_created_idx on public.instructor_profiles (created_at);
create index if not exists instructor_profiles_published_idx on public.instructor_profiles (published_at) where published_at is not null;

-- p_start null means the first day with any recorded activity. p_end null means today.
create function public.admin_analytics_daily(p_start date default null, p_end date default null)
returns table (
  day date,
  visits integer,
  unique_visitors integer,
  emails_sent integer,
  form_submissions integer,
  dms_sent integer,
  manual_emails integer,
  other_outreach integer,
  instructors_joined integer,
  instructors_published integer,
  inquiries integer,
  matching_requests integer
) language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  tz constant text := 'America/New_York';
  v_today date := (now() at time zone tz)::date;
  v_end date := least(coalesce(p_end, v_today), v_today);
  v_start date := p_start;
  v_from timestamptz;
  v_to timestamptz;
begin
  if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
  if v_start is null then
    select least(
      (select min(v.visit_day) from public.site_visits v),
      (select (min(s.sent_at) at time zone tz)::date from public.outreach_sends s where s.status = 'sent' and s.kind <> 'test'),
      (select (min(f.created_at) at time zone tz)::date from public.outreach_form_submissions f where f.status = 'submitted'),
      (select min(m.day) from public.outreach_manual_activity m where m.count > 0),
      (select (min(p.created_at) at time zone tz)::date from public.instructor_profiles p),
      (select (min(q.created_at) at time zone tz)::date from public.inquiries q),
      (select (min(r.created_at) at time zone tz)::date from public.matching_requests r)
    ) into v_start;
    v_start := coalesce(v_start, v_end);
  end if;
  v_start := greatest(least(v_start, v_end), v_end - 1825);
  v_from := v_start::timestamp at time zone tz;
  v_to := (v_end + 1)::timestamp at time zone tz;

  return query
  with days as (
    select generate_series(v_start::timestamp, v_end::timestamp, interval '1 day')::date as day
  ), visit as (
    select v.visit_day as day, count(*)::integer as visits, count(distinct v.visitor_id)::integer as unique_visitors
    from public.site_visits v where v.visit_day between v_start and v_end group by 1
  ), email as (
    select (s.sent_at at time zone tz)::date as day, count(*)::integer as n
    from public.outreach_sends s
    where s.status = 'sent' and s.kind <> 'test' and s.sent_at >= v_from and s.sent_at < v_to group by 1
  ), form as (
    select (f.created_at at time zone tz)::date as day, count(*)::integer as n
    from public.outreach_form_submissions f
    where f.status = 'submitted' and f.created_at >= v_from and f.created_at < v_to group by 1
  ), manual as (
    select m.day,
      coalesce(sum(m.count) filter (where m.channel = 'instagram_dm'), 0)::integer as dms,
      coalesce(sum(m.count) filter (where m.channel = 'email_manual'), 0)::integer as emails,
      coalesce(sum(m.count) filter (where m.channel = 'other'), 0)::integer as other
    from public.outreach_manual_activity m where m.day between v_start and v_end group by 1
  ), joined as (
    select (p.created_at at time zone tz)::date as day, count(*)::integer as n
    from public.instructor_profiles p where p.created_at >= v_from and p.created_at < v_to group by 1
  ), published as (
    select (p.published_at at time zone tz)::date as day, count(*)::integer as n
    from public.instructor_profiles p where p.published_at >= v_from and p.published_at < v_to group by 1
  ), inquiry as (
    select (q.created_at at time zone tz)::date as day, count(*)::integer as n
    from public.inquiries q where q.created_at >= v_from and q.created_at < v_to group by 1
  ), matching as (
    select (r.created_at at time zone tz)::date as day, count(*)::integer as n
    from public.matching_requests r where r.created_at >= v_from and r.created_at < v_to group by 1
  )
  select d.day,
    coalesce(visit.visits, 0), coalesce(visit.unique_visitors, 0),
    coalesce(email.n, 0), coalesce(form.n, 0),
    coalesce(manual.dms, 0), coalesce(manual.emails, 0), coalesce(manual.other, 0),
    coalesce(joined.n, 0), coalesce(published.n, 0),
    coalesce(inquiry.n, 0), coalesce(matching.n, 0)
  from days d
  left join visit on visit.day = d.day
  left join email on email.day = d.day
  left join form on form.day = d.day
  left join manual on manual.day = d.day
  left join joined on joined.day = d.day
  left join published on published.day = d.day
  left join inquiry on inquiry.day = d.day
  left join matching on matching.day = d.day
  order by d.day;
end $$;

-- Visits and distinct browsers across a whole range (daily unique counts cannot be summed).
create function public.admin_analytics_visit_summary(p_start date default null, p_end date default null)
returns table (visits bigint, unique_visitors bigint, first_visit_day date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
  return query
  select count(*), count(distinct v.visitor_id), (select min(a.visit_day) from public.site_visits a)
  from public.site_visits v
  where (p_start is null or v.visit_day >= p_start) and (p_end is null or v.visit_day <= p_end);
end $$;

-- An empty referrer_host means the visit arrived with no outside referrer.
create function public.admin_analytics_top_referrers(p_start date default null, p_end date default null, p_limit integer default 10)
returns table (referrer_host text, visits bigint, unique_visitors bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
  return query
  select coalesce(v.referrer_host, ''), count(*), count(distinct v.visitor_id)
  from public.site_visits v
  where (p_start is null or v.visit_day >= p_start) and (p_end is null or v.visit_day <= p_end)
  group by 1 order by 2 desc, 1 limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $$;

create function public.admin_analytics_top_pages(p_start date default null, p_end date default null, p_limit integer default 10)
returns table (path text, visits bigint, unique_visitors bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
  return query
  select v.path, count(*), count(distinct v.visitor_id)
  from public.site_visits v
  where (p_start is null or v.visit_day >= p_start) and (p_end is null or v.visit_day <= p_end)
  group by 1 order by 2 desc, 1 limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $$;

revoke all on function public.admin_analytics_daily(date, date), public.admin_analytics_visit_summary(date, date),
  public.admin_analytics_top_referrers(date, date, integer), public.admin_analytics_top_pages(date, date, integer)
  from public, anon;
grant execute on function public.admin_analytics_daily(date, date), public.admin_analytics_visit_summary(date, date),
  public.admin_analytics_top_referrers(date, date, integer), public.admin_analytics_top_pages(date, date, integer)
  to authenticated, service_role;
