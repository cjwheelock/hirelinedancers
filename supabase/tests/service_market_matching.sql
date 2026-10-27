\set ON_ERROR_STOP on

begin;
create or replace function pg_temp.check(p_value boolean,p_label text) returns void language plpgsql as $$
begin if coalesce(p_value,false) is not true then raise exception 'Bay Area test failed: %',p_label; end if; end; $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('83000000-0000-0000-0000-000000000010','bay-organizer@example.test','{"full_name":"Test Organizer"}'),
 ('83000000-0000-0000-0000-000000000020','bay-one@example.test','{"full_name":"Test One"}'),
 ('83000000-0000-0000-0000-000000000021','bay-two@example.test','{"full_name":"Test Two"}'),
 ('83000000-0000-0000-0000-000000000022','bay-optout@example.test','{"full_name":"Test Optout"}');
update public.accounts set role=case when id='83000000-0000-0000-0000-000000000010' then 'organizer' else 'instructor' end,
 onboarding_completed_at=now() where id::text like '83000000-%';
insert into public.instructor_profiles(id,account_id,slug,status,display_name,city,region,event_types,published_at) values
 ('84000000-0000-0000-0000-000000000020','83000000-0000-0000-0000-000000000020','bay-area-release-test-one','published','Test One','San Francisco Bay Area','CA',array['weddings'],now()),
 ('84000000-0000-0000-0000-000000000021','83000000-0000-0000-0000-000000000021','bay-area-release-test-two','published','Test Two','San Francisco Bay Area','CA',array['weddings'],now()),
 ('84000000-0000-0000-0000-000000000022','83000000-0000-0000-0000-000000000022','bay-area-release-test-optout','published','Test Optout','San Francisco Bay Area','CA',array['weddings'],now());
insert into public.instructor_private_settings(instructor_profile_id,inquiry_email) values
 ('84000000-0000-0000-0000-000000000020','bay-one@example.test'),
 ('84000000-0000-0000-0000-000000000021','bay-two@example.test'),
 ('84000000-0000-0000-0000-000000000022','bay-optout@example.test');
update public.instructor_service_markets set fallback_eligible=false,source='admin'
 where instructor_profile_id='84000000-0000-0000-0000-000000000022' and service_market_slug='san-francisco-ca';
select pg_temp.check((select count(*)=2 from public.instructor_service_markets where instructor_profile_id in
 ('84000000-0000-0000-0000-000000000020','84000000-0000-0000-0000-000000000021')
 and service_market_slug='san-francisco-ca' and accepting_inquiries and fallback_eligible), 'both published profiles are matched');
select pg_temp.check((select not fallback_eligible and source='admin' from public.instructor_service_markets
 where instructor_profile_id='84000000-0000-0000-0000-000000000022' and service_market_slug='san-francisco-ca'), 'explicit administrator choice is preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub','83000000-0000-0000-0000-000000000010',true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.submit_inquiry('84000000-0000-0000-0000-000000000020','weddings',current_date+30,
 '18:00','America/Los_Angeles','Event Hall','San Francisco','CA','94102',40,null,null,true,true,'A future event',null,false) as bay_inquiry \gset
select public.submit_inquiry('84000000-0000-0000-0000-000000000020','weddings',current_date+31,
 '18:00','America/Los_Angeles','Event Hall','Los Angeles','CA','90001',40,null,null,true,true,'Another event',null,false) as la_inquiry \gset
reset role;
select pg_temp.check(private.inquiry_candidate_matches(:'bay_inquiry','84000000-0000-0000-0000-000000000021'), 'San Francisco event finds the other Bay Area instructor');
select pg_temp.check(not private.inquiry_candidate_matches(:'bay_inquiry','84000000-0000-0000-0000-000000000022'), 'opted-out instructor is excluded');
select pg_temp.check(not private.inquiry_candidate_matches(:'la_inquiry','84000000-0000-0000-0000-000000000021'), 'unrelated service markets are not matched');
rollback;
