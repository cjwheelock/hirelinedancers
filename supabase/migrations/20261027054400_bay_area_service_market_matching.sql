-- Match the existing Bay Area profile label to the existing Bay Area market.
-- Existing administrator eligibility choices are preserved.
begin;

insert into public.service_market_localities (service_market_slug, city, region)
select slug, 'San Francisco Bay Area', 'CA'
from public.service_markets
where slug='san-francisco-ca' and active
on conflict (service_market_slug,city_normalized,region_normalized) do nothing;

insert into public.instructor_service_markets (instructor_profile_id, service_market_slug, source)
select profile.id, locality.service_market_slug, 'profile_city'
from public.instructor_profiles profile
join public.service_market_localities locality
  on locality.city_normalized=private.normalize_market_value(profile.city)
 and locality.region_normalized=private.normalize_market_value(profile.region)
join public.service_markets market on market.slug=locality.service_market_slug and market.active
join public.instructor_private_settings settings on settings.instructor_profile_id=profile.id
where profile.status='published' and settings.inquiry_email is not null
  and locality.service_market_slug='san-francisco-ca'
  and locality.city_normalized='san francisco bay area'
  and locality.region_normalized='ca'
on conflict (instructor_profile_id,service_market_slug) do nothing;

commit;
