-- Booker outreach: planner research, approved Gmail sends from hello@, reply tracking,
-- and a reusable answer library for planners' contact forms.
-- Sending is disabled until an administrator turns it on (private.outreach_config.enabled).

create table private.outreach_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  daily_limit integer not null default 30 check (daily_limit between 1 and 100),
  send_timezone text not null default 'America/Chicago',
  send_hour_start integer not null default 9 check (send_hour_start between 0 and 23),
  send_hour_end integer not null default 16 check (send_hour_end between 1 and 24),
  sender_email text not null default 'hello@hirelinedancers.com',
  sender_name text not null default 'CJ Wheelock',
  followup_after_days integer not null default 7 check (followup_after_days between 2 and 60),
  research_enabled boolean not null default true
);
insert into private.outreach_config values (true, false, 30, 'America/Chicago', 9, 16, 'hello@hirelinedancers.com', 'CJ Wheelock', 7, true);

-- One row per service market that outreach has touched. Featured instructor details fill the template.
create table public.outreach_markets (
  service_market_slug text primary key references public.service_markets(slug) on update cascade,
  featured_instructor_profile_id uuid references public.instructor_profiles(id) on delete set null,
  featured_instructor_name text,
  featured_instructor_years integer check (featured_instructor_years is null or featured_instructor_years between 0 and 80),
  featured_instructor_pronoun text check (featured_instructor_pronoun in ('she', 'he', 'they')),
  featured_profile_url text check (featured_profile_url is null or featured_profile_url ~ '^https://hirelinedancers\.com/'),
  research_status text not null default 'pending' check (research_status in ('pending', 'discovering', 'crawling', 'done', 'failed', 'skipped')),
  research_localities text[] not null default '{}',
  research_center_lat double precision,
  research_center_lng double precision,
  research_radius_miles integer not null default 60,
  research_error text,
  researched_at timestamptz,
  sending_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_templates (
  key text primary key,
  audience text not null default 'wedding_planner',
  kind text not null check (kind in ('first_touch', 'follow_up')),
  subject_template text not null,
  body_template text not null,
  active boolean not null default false,
  approved_note text,
  updated_at timestamptz not null default now()
);

create table public.outreach_leads (
  id bigint generated always as identity primary key,
  service_market_slug text not null references public.service_markets(slug) on update cascade,
  audience text not null default 'wedding_planner',
  business text not null,
  first_name text,
  greeting text not null,
  email text check (email is null or (email = lower(trim(email)) and email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$')),
  other_emails text,
  contact_method text not null check (contact_method in ('email', 'contact_form', 'website', 'phone')),
  contact_form_url text,
  website text,
  website_host text,
  instagram text,
  phone text,
  city text,
  maps_category text,
  rating numeric,
  review_count integer,
  google_maps_cid text,
  source text,
  name_evidence text,
  crawl_status text not null default 'done' check (crawl_status in ('pending', 'done', 'failed')),
  status text not null default 'new' check (status in (
    'new', 'approved', 'processing', 'sent', 'followed_up', 'replied', 'bounced', 'unsubscribed',
    'excluded', 'form_pending', 'form_submitted', 'send_failed', 'uncertain')),
  approved_at timestamptz,
  first_sent_at timestamptz,
  follow_up_sent_at timestamptz,
  replied_at timestamptz,
  gmail_thread_id text,
  locked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index outreach_leads_email_unique on public.outreach_leads (email) where email is not null;
create unique index outreach_leads_host_unique on public.outreach_leads (audience, website_host) where website_host is not null;
create unique index outreach_leads_cid_unique on public.outreach_leads (google_maps_cid) where google_maps_cid is not null;
create index outreach_leads_market_status on public.outreach_leads (service_market_slug, status);

create table public.outreach_sends (
  id bigint generated always as identity primary key,
  lead_id bigint references public.outreach_leads(id) on delete set null,
  template_key text not null,
  kind text not null check (kind in ('first_touch', 'follow_up', 'test')),
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed', 'uncertain')),
  gmail_message_id text,
  gmail_thread_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index outreach_sends_one_per_kind on public.outreach_sends (lead_id, kind) where lead_id is not null and kind <> 'test';

create table public.outreach_suppressions (
  value text primary key check (value = lower(trim(value))),
  reason text not null,
  created_at timestamptz not null default now()
);

-- Every answer CJ gives for a contact-form field, reused automatically next time.
create table public.outreach_form_answers (
  id bigint generated always as identity primary key,
  question_key text not null unique check (question_key = lower(trim(question_key))),
  example_labels text[] not null default '{}',
  answer text not null,
  notes text,
  times_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each contact-form submission, with the exact field answers used.
create table public.outreach_form_submissions (
  id bigint generated always as identity primary key,
  lead_id bigint not null references public.outreach_leads(id) on delete cascade,
  form_url text not null,
  answers jsonb not null default '{}',
  status text not null check (status in ('submitted', 'failed', 'skipped')),
  note text,
  created_at timestamptz not null default now()
);

alter table private.outreach_config enable row level security;
alter table public.outreach_markets enable row level security;
alter table public.outreach_templates enable row level security;
alter table public.outreach_leads enable row level security;
alter table public.outreach_sends enable row level security;
alter table public.outreach_suppressions enable row level security;
alter table public.outreach_form_answers enable row level security;
alter table public.outreach_form_submissions enable row level security;

revoke all on private.outreach_config, public.outreach_markets, public.outreach_templates, public.outreach_leads,
  public.outreach_sends, public.outreach_suppressions, public.outreach_form_answers, public.outreach_form_submissions
  from public, anon, authenticated;
grant all on private.outreach_config, public.outreach_markets, public.outreach_templates, public.outreach_leads,
  public.outreach_sends, public.outreach_suppressions, public.outreach_form_answers, public.outreach_form_submissions
  to service_role;
grant usage, select on sequence public.outreach_leads_id_seq, public.outreach_sends_id_seq,
  public.outreach_form_answers_id_seq, public.outreach_form_submissions_id_seq to service_role;

-- Administrators manage everything except sends (read-only; only the worker writes sends).
grant select, insert, update on public.outreach_markets, public.outreach_templates, public.outreach_leads,
  public.outreach_suppressions, public.outreach_form_answers, public.outreach_form_submissions to authenticated;
grant delete on public.outreach_suppressions, public.outreach_form_answers to authenticated;
grant select on public.outreach_sends to authenticated;
grant usage, select on sequence public.outreach_leads_id_seq, public.outreach_form_answers_id_seq,
  public.outreach_form_submissions_id_seq to authenticated;

create policy "admins manage outreach markets" on public.outreach_markets for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());
create policy "admins manage outreach templates" on public.outreach_templates for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());
create policy "admins manage outreach leads" on public.outreach_leads for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());
create policy "admins read outreach sends" on public.outreach_sends for select to authenticated
  using (public.is_marketplace_admin());
create policy "admins manage outreach suppressions" on public.outreach_suppressions for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());
create policy "admins manage form answers" on public.outreach_form_answers for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());
create policy "admins manage form submissions" on public.outreach_form_submissions for all to authenticated
  using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());

create function private.outreach_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger outreach_markets_touch before update on public.outreach_markets for each row execute function private.outreach_touch_updated_at();
create trigger outreach_leads_touch before update on public.outreach_leads for each row execute function private.outreach_touch_updated_at();
create trigger outreach_templates_touch before update on public.outreach_templates for each row execute function private.outreach_touch_updated_at();
create trigger outreach_form_answers_touch before update on public.outreach_form_answers for each row execute function private.outreach_touch_updated_at();

-- Admin-readable view of the config, and a narrow setter.
create function public.outreach_get_config() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.is_marketplace_admin() or auth.role() = 'service_role'
    then (select to_jsonb(c) - 'singleton' from private.outreach_config c where singleton) end;
$$;
create function public.outreach_set_config(p_enabled boolean, p_daily_limit integer default null, p_research_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_marketplace_admin() then raise exception 'Administrator access required'; end if;
  update private.outreach_config set enabled = coalesce(p_enabled, enabled),
    daily_limit = coalesce(p_daily_limit, daily_limit), research_enabled = coalesce(p_research_enabled, research_enabled)
  where singleton;
  return public.outreach_get_config();
end $$;
revoke all on function public.outreach_get_config(), public.outreach_set_config(boolean, integer, boolean) from public, anon;
grant execute on function public.outreach_get_config(), public.outreach_set_config(boolean, integer, boolean) to authenticated, service_role;

-- Markets with a published instructor and no outreach row yet get queued for research.
create function public.outreach_queue_new_markets() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.outreach_markets (service_market_slug, featured_instructor_profile_id, featured_instructor_name, featured_profile_url, research_localities)
  select distinct on (m.slug) m.slug, p.id, p.display_name, 'https://hirelinedancers.com/profile/' || p.slug || '/',
    coalesce((select array_agg(l.city || ', ' || l.region) from public.service_market_localities l where l.service_market_slug = m.slug), array[m.name || ', ' || m.region])
  from public.service_markets m
  join public.instructor_service_markets ism on ism.service_market_slug = m.slug and ism.accepting_inquiries
  join public.instructor_profiles p on p.id = ism.instructor_profile_id and p.status = 'published'
  where m.active and coalesce(p.headline, '') not ilike '%test profile%'
    and not exists (select 1 from public.outreach_markets o where o.service_market_slug = m.slug)
  order by m.slug, p.approved_at desc nulls last
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.outreach_queue_new_markets() from public, anon, authenticated;
grant execute on function public.outreach_queue_new_markets() to service_role;

-- Claim the next batch of emails for the sender. Enforces the daily cap, the market approval,
-- suppressions, and the one-follow-up rule. Expired leases become 'uncertain' and are never retried automatically.
create function public.outreach_claim_batch(p_limit integer default 5)
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
    order by (l.status = 'sent') desc, l.review_count desc nulls last, l.id
    for update of l skip locked
    limit room
  )
  update public.outreach_leads l set status = 'processing', locked_at = now()
  from picked where l.id = picked.id
  returning l.id, picked.k;
end $$;
revoke all on function public.outreach_claim_batch(integer) from public, anon, authenticated;
grant execute on function public.outreach_claim_batch(integer) to service_role;

insert into public.outreach_templates (key, audience, kind, subject_template, body_template, active, approved_note) values (
  'planner_first_touch', 'wedding_planner', 'first_touch',
  'A line dance instructor for your {city} weddings',
  E'{greeting}\n\nI''m reaching out to see if the couples you work with might be open to having a line dance instructor at their wedding. We think it''s the perfect way to get the entire room on the dance floor together at the same time for a unique experience. Couples get a full floor, great photos and video, and a fun memory for all their guests to share.\n\nWe have {a_city}-based line dancer who''s available now for any current and upcoming clients. {Possessive} name is {instructor_name}, and {subject_has} been teaching for {instructor_years} years. You can see {possessive} work and contact {object} here: {profile_url}\n\nWe''d love to be kept in mind for any weddings you''re planning, because we think we can help you create a memorable experience for your clients.\n\nThanks,\nCJ Wheelock\nFounder, Hire Line Dancers',
  true, 'Approved by CJ on Nov 14, 2026 (Austin wording, with city and instructor details as placeholders).'
);
