-- Learnings from the Dallas test (601 planners, 53% with email):
-- a map grid across each metro finds far more planners than city-name searches,
-- and a deeper crawl plus a Google search for "<business> <city> email" closes much of the email gap.

-- 1. Append a map-grid sweep (entries like "@32.85,-96.85,13z") after each city's named suburbs.
with spans(slug, lat, lng, dlat, dlng) as (values
  ('austin-tx', 30.27, -97.74, 0.35, 0.40),
  ('new-york-ny', 40.75, -73.95, 0.35, 0.45),
  ('san-francisco-ca', 37.70, -122.20, 0.45, 0.40),
  ('atlanta-ga', 33.80, -84.39, 0.35, 0.40),
  ('charlotte-nc', 35.23, -80.84, 0.30, 0.35),
  ('dallas-tx', 32.88, -96.80, 0.35, 0.40),
  ('fort-worth-tx', 32.78, -97.35, 0.30, 0.30),
  ('houston-tx', 29.76, -95.37, 0.40, 0.50),
  ('las-vegas-nv', 36.15, -115.17, 0.20, 0.25),
  ('los-angeles-ca', 34.00, -118.20, 0.40, 0.60),
  ('nashville-tn', 36.13, -86.78, 0.30, 0.35),
  ('phoenix-az', 33.45, -111.95, 0.30, 0.45),
  ('san-diego-ca', 32.95, -117.15, 0.35, 0.25)
), grid as (
  select s.slug, array_agg(format('@%s,%s,13z', round((s.lat + a)::numeric, 3), round((s.lng + b)::numeric, 3)) order by a, b) pts
  from spans s
  cross join lateral generate_series(-s.dlat, s.dlat + 0.001, 0.13) a
  cross join lateral generate_series(-s.dlng, s.dlng + 0.001, 0.15) b
  group by s.slug
)
update public.outreach_markets o set
  research_localities = coalesce(o.research_localities, '{}') || g.pts,
  research_status = case when o.research_status = 'pending' then 'pending' else 'discovering' end
from grid g where o.service_market_slug = g.slug;

-- 2. Re-check every not-yet-contacted lead that has no email, with the deeper crawl and Google search.
update public.outreach_leads set crawl_status = 'pending'
where email is null and status in ('new', 'form_pending');

-- 3. Research also runs every 5 minutes between the 15-minute send runs.
select cron.schedule('hld-booker-research', '5,10,20,25,35,40,50,55 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'hld_project_url') || '/functions/v1/outreach',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'hld_notification_worker_key')),
    body := '{"skip":["send"]}'::jsonb,
    timeout_milliseconds := 140000
  );
$$);
