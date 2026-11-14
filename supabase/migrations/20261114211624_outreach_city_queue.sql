-- Outreach city queue: cities send one at a time in the order they were queued,
-- new cities activate automatically once research is done, and CJ gets status emails.

alter table private.outreach_config
  add column notify_email text,
  add column last_daily_report_on date;

alter table public.outreach_markets
  add column auto_send boolean not null default true,
  add column sending_queued_at timestamptz,
  add column details_requested_at timestamptz,
  add column completed_notified_at timestamptz;

-- Austin is first in line.
update public.outreach_markets set sending_queued_at = '2026-11-14 20:00:00+00' where service_market_slug = 'austin-tx';

-- Activates researched cities: copies years from the instructor profile, approves planners with an email,
-- and queues the city once the featured instructor details the approved email needs are complete.
-- Returns cities still missing details (so the worker can ask CJ once).
create function public.outreach_activate_markets()
returns table (service_market_slug text, missing text[]) language plpgsql security definer set search_path = '' as $$
begin
  update public.outreach_markets m set featured_instructor_years = p.years_teaching
  from public.instructor_profiles p
  where p.id = m.featured_instructor_profile_id and m.featured_instructor_years is null and p.years_teaching is not null;

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
revoke all on function public.outreach_activate_markets() from public, anon, authenticated;
grant execute on function public.outreach_activate_markets() to service_role;

-- Same claim as before, but first emails go to one city at a time, in queue order.
create or replace function public.outreach_claim_batch(p_limit integer default 5)
returns table (lead_id bigint, kind text) language plpgsql security definer set search_path = '' as $$
declare cfg private.outreach_config; sent_today integer; room integer;
begin
  select * into cfg from private.outreach_config where singleton;
  if not cfg.enabled then return; end if;
  update public.outreach_leads set status = 'uncertain', locked_at = null,
    notes = trim(coalesce(notes, '') || ' Worker lease expired; check Gmail Sent before retrying.')
  where status = 'processing' and locked_at < now() - interval '10 minutes';
  select count(*) into sent_today from public.outreach_sends s
  where s.kind <> 'test' and s.status in ('sent', 'processing', 'uncertain')
    and s.created_at >= (date_trunc('day', now() at time zone cfg.send_timezone) at time zone cfg.send_timezone);
  room := greatest(0, least(cfg.daily_limit - sent_today, coalesce(p_limit, 5), 10));
  if room = 0 then return; end if;
  return query
  with picked as (
    select l.id, case when l.status = 'approved' then 'first_touch' else 'follow_up' end as k
    from public.outreach_leads l
    join public.outreach_markets m on m.service_market_slug = l.service_market_slug and m.sending_approved
    where l.email is not null and l.locked_at is null
      and not exists (select 1 from public.outreach_suppressions s where s.value = l.email or s.value = split_part(l.email, '@', 2))
      and (
        (l.status = 'approved' and exists (select 1 from public.outreach_templates t where t.audience = l.audience and t.kind = 'first_touch' and t.active))
        or (l.status = 'sent' and l.replied_at is null and l.first_sent_at < now() - make_interval(days => cfg.followup_after_days)
            and exists (select 1 from public.outreach_templates t where t.audience = l.audience and t.kind = 'follow_up' and t.active))
      )
    order by (l.status = 'sent') desc, m.sending_queued_at nulls last, l.review_count desc nulls last, l.id
    for update of l skip locked
    limit room
  )
  update public.outreach_leads l set status = 'processing', locked_at = now()
  from picked where l.id = picked.id
  returning l.id, picked.k;
end $$;

-- Sent-today count and per-city progress for the worker's status emails.
create function public.outreach_status_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sent_today', (select count(*) from public.outreach_sends s, private.outreach_config c
      where c.singleton and s.kind <> 'test' and s.status = 'sent'
        and s.created_at >= (date_trunc('day', now() at time zone c.send_timezone) at time zone c.send_timezone)),
    'today', (select (now() at time zone c.send_timezone)::date from private.outreach_config c where c.singleton),
    'markets', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', m.service_market_slug, 'name', sm.name, 'queued_at', m.sending_queued_at,
        'sending_approved', m.sending_approved, 'completed_notified_at', m.completed_notified_at,
        'remaining', (select count(*) from public.outreach_leads l where l.service_market_slug = m.service_market_slug and l.status in ('approved', 'processing')),
        'sent', (select count(*) from public.outreach_leads l where l.service_market_slug = m.service_market_slug and l.first_sent_at is not null),
        'replied', (select count(*) from public.outreach_leads l where l.service_market_slug = m.service_market_slug and l.status = 'replied'),
        'bounced', (select count(*) from public.outreach_leads l where l.service_market_slug = m.service_market_slug and l.status = 'bounced')
      ) order by m.sending_queued_at nulls last), '[]'::jsonb)
      from public.outreach_markets m join public.service_markets sm on sm.slug = m.service_market_slug)
  );
$$;
revoke all on function public.outreach_status_snapshot() from public, anon, authenticated;
grant execute on function public.outreach_status_snapshot() to service_role;

-- Cities with more than one featured instructor: each planner email features one of them, alternating.
create table public.outreach_market_instructors (
  service_market_slug text not null references public.outreach_markets(service_market_slug) on delete cascade,
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  name text not null,
  years integer check (years is null or years between 0 and 80),
  pronoun text check (pronoun in ('she', 'he', 'they')),
  profile_url text not null check (profile_url ~ '^https://hirelinedancers\.com/'),
  primary key (service_market_slug, instructor_profile_id)
);
alter table public.outreach_market_instructors enable row level security;
revoke all on public.outreach_market_instructors from public, anon, authenticated;
grant all on public.outreach_market_instructors to service_role;
grant select, insert, update, delete on public.outreach_market_instructors to authenticated;
create policy "admins manage outreach market instructors" on public.outreach_market_instructors for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());

alter table public.outreach_leads add column featured_instructor_profile_id uuid references public.instructor_profiles(id) on delete set null;

create or replace function public.outreach_mark_daily_report(p_day date) returns void language sql security definer set search_path = '' as $$
  update private.outreach_config set last_daily_report_on = p_day where singleton;
$$;
revoke all on function public.outreach_mark_daily_report(date) from public, anon, authenticated;
grant execute on function public.outreach_mark_daily_report(date) to service_role;
