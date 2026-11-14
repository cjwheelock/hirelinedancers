-- Regional planner research: each launch city searches its surrounding suburbs and wedding areas (80 mile radius).
-- Applied as data on 2026-11-14; see outreach_markets.research_localities for the live lists.
update public.outreach_markets set research_radius_miles = 80 where service_market_slug <> 'austin-tx';
