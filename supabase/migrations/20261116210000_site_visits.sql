-- First-party page view log. No IP address, no user agent, no account link.
-- visitor_id is a random value the browser keeps in localStorage.
create table public.site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visit_day date not null default ((now() at time zone 'America/New_York')::date),
  path text not null check (char_length(path) between 1 and 300),
  referrer_host text check (char_length(referrer_host) <= 120),
  utm_source text check (char_length(utm_source) <= 80),
  utm_medium text check (char_length(utm_medium) <= 80),
  utm_campaign text check (char_length(utm_campaign) <= 80),
  visitor_id uuid
);
create index site_visits_created_idx on public.site_visits (created_at desc);
create index site_visits_day_idx on public.site_visits (visit_day);
create index site_visits_visitor_created_idx on public.site_visits (visitor_id, created_at desc) where visitor_id is not null;

alter table public.site_visits enable row level security;
revoke all on public.site_visits from public, anon, authenticated;
grant all on public.site_visits to service_role;
grant usage, select on sequence public.site_visits_id_seq to service_role;
grant select on public.site_visits to authenticated;
create policy "admins read site visits" on public.site_visits for select to authenticated
  using (public.is_marketplace_admin());

-- Insert-only entry point for the public site. Invalid or over-limit calls are dropped silently.
create function public.track_site_visit(
  p_path text,
  p_referrer text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_visitor_id text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_path text := split_part(split_part(coalesce(p_path, ''), '?', 1), '#', 1);
  v_host text;
  v_visitor uuid;
begin
  if char_length(coalesce(p_path, '')) > 600 or char_length(v_path) > 300
     or v_path !~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'
     or v_path ~ '^/admin(/|$)' then
    return;
  end if;

  v_host := lower(substring(left(coalesce(p_referrer, ''), 400) from '^(?:[A-Za-z][A-Za-z0-9+.-]*://)?([^/?#:@\s]+)'));
  v_host := regexp_replace(coalesce(v_host, ''), '^www\.', '');
  if v_host !~ '^[a-z0-9.-]{1,120}$' or v_host in ('hirelinedancers.com', 'localhost') then
    v_host := null;
  end if;

  if p_visitor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_visitor := p_visitor_id::uuid;
  end if;

  -- Per-browser cap: 60 page views an hour.
  if v_visitor is not null and (
    select count(*) from public.site_visits v
    where v.visitor_id = v_visitor and v.created_at > now() - interval '1 hour'
  ) >= 60 then
    return;
  end if;
  -- Site-wide cap: 300 page views a minute.
  if (select count(*) from public.site_visits v where v.created_at > now() - interval '1 minute') >= 300 then
    return;
  end if;

  insert into public.site_visits (path, referrer_host, utm_source, utm_medium, utm_campaign, visitor_id)
  values (
    v_path,
    v_host,
    lower(left(nullif(btrim(p_utm_source), ''), 80)),
    lower(left(nullif(btrim(p_utm_medium), ''), 80)),
    lower(left(nullif(btrim(p_utm_campaign), ''), 80)),
    v_visitor
  );
end $$;
revoke all on function public.track_site_visit(text, text, text, text, text, text) from public;
grant execute on function public.track_site_visit(text, text, text, text, text, text) to anon, authenticated, service_role;
