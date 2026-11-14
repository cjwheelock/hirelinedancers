\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.messaging_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Messaging assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.messaging_expect_error(
  p_statement text,
  p_message_fragment text,
  p_label text
)
returns void
language plpgsql
as $$
begin
  begin
    execute p_statement;
  exception when others then
    if position(p_message_fragment in sqlerrm) = 0 then
      raise exception 'Expected error for %, got: %', p_label, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected an error for %, but the statement succeeded', p_label;
end;
$$;

create or replace function pg_temp.messaging_set_request(
  p_account_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claim.sub',
    coalesce(p_account_id::text, ''),
    true
  );
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_account_id,
      'email', p_email,
      'role', p_role
    )::text,
    true
  );
end;
$$;

create or replace function pg_temp.booking_quote(
  p_thread_id uuid,
  p_instructor_account_id uuid,
  p_event_date date,
  p_policy text default 'standard',
  p_windows jsonb default null
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'thread_id', p_thread_id,
    'instructor_account_id', p_instructor_account_id,
    'event_date', p_event_date,
    'start_time', '18:00',
    'end_time', '20:00',
    'time_zone', 'America/Chicago',
    'venue_name', 'Booking Hall',
    'venue_address', '100 Congress Ave, Austin, TX 78701',
    'service_description', 'Two hours of beginner line dance instruction.',
    'pricing_mode', 'hourly',
    'hourly_rate_cents', 20000,
    'hours', 2,
    'flat_price_cents', null,
    'travel_fee_cents', 0,
    'provides_speakers', true,
    'provides_microphone', false,
    'cancellation_policy', p_policy,
    'cancellation_windows', coalesce(
      p_windows,
      '[{"minDaysBeforeEvent": 30, "refundPercent": 100}, {"minDaysBeforeEvent": 7, "refundPercent": 50}]'::jsonb
    ),
    'insurance_choice', 'instructor_handles_outside_agreement',
    'instructor_fee_bps', 1500,
    'client_fee_bps', 500,
    'price_cents', 40000,
    'client_fee_cents', 2000,
    'total_cents', 42000,
    'platform_fee_cents', 6000,
    'instructor_payout_cents', 34000,
    'agreement_version', '2026-10-26-booking-agreement-v2',
    'agreement_text', repeat('Booking agreement text. ', 20),
    'agreement_sha256', repeat('a', 64),
    'signature_name', 'Instructor One',
    'signature_email', 'booking-instructor@example.test',
    'signature_ip', '203.0.113.10',
    'signature_user_agent', 'Test browser'
  )
$$;


-- Fixtures: one organizer, three Austin instructors, one Dallas instructor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('31000000-0000-0000-0000-000000000001','cx-admin@example.test',now(),'{"full_name":"Cx Admin"}'),
 ('31000000-0000-0000-0000-000000000010','cx-organizer@example.test',now(),'{"full_name":"Jordan Avery Reyes"}'),
 ('31000000-0000-0000-0000-000000000020','cx-one@example.test',now(),'{"full_name":"Cx One"}'),
 ('31000000-0000-0000-0000-000000000021','cx-two@example.test',now(),'{"full_name":"Cx Two"}'),
 ('31000000-0000-0000-0000-000000000022','cx-three@example.test',now(),'{"full_name":"Cx Three"}');
update public.accounts set role=case when id='31000000-0000-0000-0000-000000000001' then 'admin'
  when id='31000000-0000-0000-0000-000000000010' then 'organizer' else 'instructor' end,
  first_name=case when id='31000000-0000-0000-0000-000000000010' then 'Jordan' end,
  last_name=case when id='31000000-0000-0000-0000-000000000010' then 'Reyes' end,
  onboarding_completed_at=now() where id::text like '31000000-%';
insert into public.marketplace_admins(account_id,is_owner,granted_by) values
 ('31000000-0000-0000-0000-000000000001',true,'31000000-0000-0000-0000-000000000001');
insert into public.instructor_profiles(id,account_id,slug,status,display_name,city,region,event_types,published_at) values
 ('32000000-0000-0000-0000-000000000020','31000000-0000-0000-0000-000000000020','cx-one','published','Cx One','Austin','TX',array['weddings'],now()),
 ('32000000-0000-0000-0000-000000000021','31000000-0000-0000-0000-000000000021','cx-two','published','Cx Two','Austin','TX',array['weddings'],now()),
 ('32000000-0000-0000-0000-000000000022','31000000-0000-0000-0000-000000000022','cx-three','published','Cx Three','Austin','TX',array['weddings'],now());
insert into public.instructor_private_settings(instructor_profile_id,inquiry_email) values
 ('32000000-0000-0000-0000-000000000020','cx-one@example.test'),
 ('32000000-0000-0000-0000-000000000021','cx-two@example.test'),
 ('32000000-0000-0000-0000-000000000022','cx-three@example.test');
-- Fixtures in other suites share the Austin market; keep them out of this one.
update public.instructor_service_markets set accepting_inquiries=false
 where service_market_slug='austin-tx' and instructor_profile_id::text not like '32000000-%';

---------------------------------------------------------------------------
-- 1. Second routing round
---------------------------------------------------------------------------
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000010','cx-organizer@example.test','authenticated');
set local role authenticated;
select public.submit_inquiry('32000000-0000-0000-0000-000000000020','weddings',current_date+40,'18:00','America/Chicago',
 'Cx Hall','Austin','TX','78701',90,null,null,true,true,'Call me at 512-555-0199 or jordan@example.test',null,true) as inquiry_id \gset
select public.get_inquiry_primary_thread(:'inquiry_id') as source_thread \gset
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000020','cx-one@example.test','authenticated');
set local role authenticated;
select public.decline_inquiry_thread(:'source_thread',null);
reset role;
select pg_temp.messaging_assert((select count(*)=2 from public.inquiry_threads where inquiry_id=:'inquiry_id' and assignment_source='fallback'),'decline invites the two other matches');
select pg_temp.messaging_assert(private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where thread_id=:'source_thread' and notification_type='thread_declined')),
 'the chosen instructor declining still emails the organizer');
select id as fb_two from public.inquiry_threads where inquiry_id=:'inquiry_id' and instructor_profile_id='32000000-0000-0000-0000-000000000021' \gset
select id as fb_three from public.inquiry_threads where inquiry_id=:'inquiry_id' and instructor_profile_id='32000000-0000-0000-0000-000000000022' \gset

select pg_temp.messaging_set_request(null,null,'service_role');
select public.enqueue_due_inquiry_response_actions();
select pg_temp.messaging_assert((select still_looking_notified_at is null from public.inquiries where id=:'inquiry_id'),'no still-looking notice inside 48 hours');

-- An invited instructor declining does not email the organizer.
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000021','cx-two@example.test','authenticated');
set local role authenticated;
select public.decline_inquiry_thread(:'fb_two',null);
reset role;
select pg_temp.messaging_assert(not private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where thread_id=:'fb_two' and notification_type='thread_declined')),
 'invited instructor declines are not emailed to the organizer');
select pg_temp.messaging_assert(not private.inquiry_still_looking_due(:'inquiry_id'),'one invited instructor still open, so not due yet');

-- 48 hours after sharing with no engagement: one notice, one attention item.
update public.inquiries set automatic_sharing_started_at=now()-interval '49 hours' where id=:'inquiry_id';
update public.inquiry_threads set status='timed_out',timed_out_at=now() where id=:'fb_three';
select pg_temp.messaging_assert(not private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where thread_id=:'fb_three' and notification_type='response_timeout_organizer')),
 'invited instructor timeouts are not emailed to the organizer');
select pg_temp.messaging_set_request(null,null,'service_role');
select public.enqueue_due_inquiry_response_actions();
select public.enqueue_due_inquiry_response_actions();
reset role;
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_thread_notification_jobs where dedupe_key='inquiry:'||:'inquiry_id'||':still-looking' and notification_type='still_looking_organizer' and thread_id=:'source_thread'),
 'exactly one still-looking email to the organizer');
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_attention_items where thread_id=:'source_thread' and reason='no_response_after_sharing' and resolved_at is null),
 'the inquiry appears in admin Needs attention');
select pg_temp.messaging_assert(private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where notification_type='still_looking_organizer' and thread_id=:'source_thread')),
 'still-looking email is sendable while nobody has engaged');

-- A late reply from an invited instructor cancels a still-pending notice.
update public.inquiry_threads set status='active',first_instructor_message_at=now() where id=:'fb_three';
select pg_temp.messaging_assert(not private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where notification_type='still_looking_organizer' and thread_id=:'source_thread')),
 'engagement before sending cancels the notice');

-- Engagement inside 48 hours prevents the notice entirely.
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000010','cx-organizer@example.test','authenticated');
set local role authenticated;
select public.submit_inquiry('32000000-0000-0000-0000-000000000020','weddings',current_date+45,'18:00','America/Chicago',
 'Cx Hall','Austin','TX','78701',90,null,null,true,true,'Second event',null,true) as engaged_inquiry \gset
select public.get_inquiry_primary_thread(:'engaged_inquiry') as engaged_source \gset
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000020','cx-one@example.test','authenticated');
set local role authenticated;
select public.decline_inquiry_thread(:'engaged_source',null);
reset role;
select id as engaged_fb from public.inquiry_threads where inquiry_id=:'engaged_inquiry' and instructor_profile_id='32000000-0000-0000-0000-000000000021' \gset
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000021','cx-two@example.test','authenticated');
set local role authenticated;
select public.set_inquiry_availability(:'engaged_fb');
reset role;
update public.inquiries set automatic_sharing_started_at=now()-interval '72 hours' where id=:'engaged_inquiry';
select pg_temp.messaging_set_request(null,null,'service_role');
select public.enqueue_due_inquiry_response_actions();
reset role;
select pg_temp.messaging_assert((select still_looking_notified_at is null from public.inquiries where id=:'engaged_inquiry'),
 'an available invited instructor means no still-looking notice');

---------------------------------------------------------------------------
-- 2. Organizer contact details stay hidden from instructors before payment
---------------------------------------------------------------------------
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000021','cx-two@example.test','authenticated');
set local role authenticated;
select public.get_inquiry_thread(:'engaged_fb') as fb_view \gset
select pg_temp.messaging_assert(not ((:'fb_view')::jsonb->'inquiry' ? 'contact_email') and not ((:'fb_view')::jsonb->'inquiry' ? 'contact_phone_e164')
  and not ((:'fb_view')::jsonb->'inquiry' ? 'email'), 'invited instructor sees no organizer email or phone');
select pg_temp.messaging_assert((:'fb_view')::jsonb->'inquiry'->>'contact_name' = 'Jordan R.','instructor sees first name and last initial');
select pg_temp.messaging_assert(not exists(select 1 from jsonb_array_elements((:'fb_view')::jsonb->'participants') as p(v)
  where p.v->>'participant_role'='organizer' and p.v->>'display_name' like '%Reyes%'),'participant list masks the organizer name');
select pg_temp.messaging_assert((select counterparty_name='Jordan R.' from public.list_inquiry_threads(null,'all','recent',50,null,null,false) where thread_id=:'engaged_fb'),
 'inbox list masks the organizer name');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000020','cx-one@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(position('512-555-0199' in coalesce(public.get_inquiry_thread(:'source_thread')->'inquiry'->>'message',''))=0
  and position('jordan@example.test' in coalesce(public.get_inquiry_thread(:'source_thread')->'inquiry'->>'message',''))=0,
 'contact details typed into the opening message are hidden from the instructor');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000010','cx-organizer@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(public.get_inquiry_thread(:'engaged_fb')->'inquiry'->>'contact_email'='cx-organizer@example.test','organizer still sees their own details');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000001','cx-admin@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(public.get_inquiry_thread(:'engaged_fb')->'inquiry'->>'contact_email'='cx-organizer@example.test','administrators still see organizer details');
reset role;
select pg_temp.messaging_set_request(null,null,'service_role');
select id as new_thread_job from public.inquiry_thread_notification_jobs where thread_id=:'engaged_fb' and notification_type='new_thread' \gset
select public.get_inquiry_notification_context(:'new_thread_job') as ctx \gset
select pg_temp.messaging_assert(not((:'ctx')::jsonb->'brief' ? 'Email') and not((:'ctx')::jsonb->'brief' ? 'Phone')
  and (:'ctx')::jsonb->'brief'->>'Organizer'='Jordan R.','new-opportunity email brief has no organizer email or phone');
update public.inquiry_thread_notification_jobs set available_at=now()-interval '1 minute' where id=:'new_thread_job' and status='pending';
select pg_temp.messaging_assert(coalesce((select bool_and(j->>'organizer_name'='Jordan R.') from public.claim_inquiry_thread_notification_jobs_v2(25,'10 minutes') j
  where (j->>'job_id')::bigint=:'new_thread_job'),true),'instructor emails use the short organizer name');
reset role;
select pg_temp.messaging_assert(private.organizer_short_name('Mary Jane de la Cruz')='Mary C.' and private.organizer_short_name('Cher')='Cher'
  and private.organizer_short_name('  ') = '  ' and private.organizer_short_name(null) is null,'short-name helper');

---------------------------------------------------------------------------
-- 3. Inquiries without an account
---------------------------------------------------------------------------
insert into auth.users(id,email) values ('33000000-0000-0000-0000-000000000001','guest@example.test');
select pg_temp.messaging_set_request(null,null,'service_role');
select pg_temp.messaging_assert(public.guest_inquiry_account('GUEST@example.test')->>'account_id'='33000000-0000-0000-0000-000000000001','existing sign-in is found case-insensitively');
select pg_temp.messaging_assert(public.guest_inquiry_account('nobody@example.test') is null,'unknown email has no account');
select public.submit_guest_inquiry('33000000-0000-0000-0000-000000000001','guest@example.test','Pat','Guest','iphash-1',
  '32000000-0000-0000-0000-000000000022',null,'weddings',current_date+50,null,'America/Chicago',null,'Austin','TX',null,40) as guest_inquiry \gset
reset role;
select pg_temp.messaging_assert((select role='organizer' and full_name='Pat Guest' from public.accounts where id='33000000-0000-0000-0000-000000000001'),'guest becomes an organizer account');
select pg_temp.messaging_assert((select organizer_account_id='33000000-0000-0000-0000-000000000001' and automatic_sharing from public.inquiries where id=:'guest_inquiry'),
 'guest inquiry belongs to the guest and allows sharing');
select pg_temp.messaging_assert(coalesce(current_setting('request.jwt.claims',true),'') not like '%33000000%','guest claims are restored after submission');
select pg_temp.messaging_set_request(null,null,'service_role');
select public.submit_guest_inquiry('33000000-0000-0000-0000-000000000001','guest@example.test','Pat','Guest','iphash-1',
  '32000000-0000-0000-0000-000000000022',null,'weddings',current_date+51,null,'America/Chicago',null,'Austin','TX',null,40);
select public.submit_guest_inquiry('33000000-0000-0000-0000-000000000001','guest@example.test','Pat','Guest','iphash-1',
  '32000000-0000-0000-0000-000000000022',null,'weddings',current_date+52,null,'America/Chicago',null,'Austin','TX',null,40);
select pg_temp.messaging_expect_error($q$select public.submit_guest_inquiry('33000000-0000-0000-0000-000000000001','guest@example.test','Pat','Guest','iphash-1',
  '32000000-0000-0000-0000-000000000022',null,'weddings',current_date+53,null,'America/Chicago',null,'Austin','TX',null,40)$q$,
  'Too many requests','fourth inquiry from one email in a day is refused');
select pg_temp.messaging_expect_error($q$select public.submit_guest_inquiry('31000000-0000-0000-0000-000000000021','cx-two@example.test','Cx','Two','iphash-2',
  '32000000-0000-0000-0000-000000000022',null,'weddings',current_date+53,null,'America/Chicago',null,'Austin','TX',null,40)$q$,
  'Sign in to send this inquiry','an instructor email must sign in instead');
select pg_temp.messaging_expect_error($q$select public.submit_guest_inquiry('33000000-0000-0000-0000-000000000001','other@example.test','Pat','Guest','iphash-3',
  '32000000-0000-0000-0000-000000000022',null,'weddings',current_date+53,null,'America/Chicago',null,'Austin','TX',null,40)$q$,
  'Account not found','account and email must match');
reset role;
select pg_temp.messaging_assert(not has_function_privilege('anon','public.submit_guest_inquiry(uuid,text,text,text,text,uuid,text,text,date,time,text,text,text,text,text,integer,text,text,boolean,boolean,text)','execute')
  and not has_function_privilege('authenticated','public.guest_inquiry_account(text)','execute'),'guest functions are service-role only');

---------------------------------------------------------------------------
-- 4. Onboarding progress and instructor reminders
---------------------------------------------------------------------------
insert into auth.users(id,email,email_confirmed_at) values
 ('34000000-0000-0000-0000-000000000001','draft-one@example.test',now()),
 ('34000000-0000-0000-0000-000000000002','cj.wheelock1+hld-test@gmail.com',now());
update public.accounts set role='instructor' where id::text like '34000000-%';
insert into public.instructor_profiles(id,account_id,status,display_name,created_at) values
 ('35000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000001','draft','Draft One',now()-interval '80 hours'),
 ('35000000-0000-0000-0000-000000000002','34000000-0000-0000-0000-000000000002','draft','Test Account',now()-interval '80 hours');
select pg_temp.messaging_set_request('34000000-0000-0000-0000-000000000001','draft-one@example.test','authenticated');
set local role authenticated;
select public.record_instructor_onboarding_step('services');
select public.record_instructor_onboarding_step('basics');
select pg_temp.messaging_expect_error($q$select public.record_instructor_onboarding_step('nonsense')$q$,'Unknown onboarding step','unknown steps are refused');
select pg_temp.messaging_assert((select furthest_step=3 and furthest_step_key='services' from public.instructor_onboarding_progress where instructor_profile_id='35000000-0000-0000-0000-000000000001'),
 'furthest step never moves backward');
reset role;
update private.profile_reminder_config set enabled=true;
select pg_temp.messaging_set_request(null,null,'service_role');
select count(*) from public.claim_profile_completion_reminders(25);
reset role;
select pg_temp.messaging_assert((select count(*)=1 from public.profile_completion_reminder_jobs where profile_id='35000000-0000-0000-0000-000000000001' and kind='profile_24h'),
 'the 24-hour reminder is queued first');
select pg_temp.messaging_assert(not exists(select 1 from public.profile_completion_reminder_jobs where profile_id='35000000-0000-0000-0000-000000000001' and kind='profile_72h'),
 'the 72-hour reminder waits for the first one');
select pg_temp.messaging_assert(not exists(select 1 from public.profile_completion_reminder_jobs where profile_id='35000000-0000-0000-0000-000000000002'),
 'plus-addressed test accounts never get reminders');
update public.profile_completion_reminder_jobs set status='sent',provider_message_id='msg-24',completed_at=now()-interval '41 hours'
 where profile_id='35000000-0000-0000-0000-000000000001' and kind='profile_24h';
select pg_temp.messaging_set_request(null,null,'service_role');
select count(*) from public.claim_profile_completion_reminders(25);
reset role;
select pg_temp.messaging_assert((select count(*)=1 from public.profile_completion_reminder_jobs where profile_id='35000000-0000-0000-0000-000000000001' and kind='profile_72h'),
 'the 72-hour reminder follows a sent 24-hour reminder');
-- Payouts reminder: published a day ago, no ready payout account.
update public.instructor_profiles set published_at=now()-interval '2 days' where id='32000000-0000-0000-0000-000000000022';
select pg_temp.messaging_set_request(null,null,'service_role');
select count(*) from public.claim_profile_completion_reminders(25);
reset role;
select pg_temp.messaging_assert((select count(*)=1 from public.profile_completion_reminder_jobs where profile_id='32000000-0000-0000-0000-000000000022' and kind='payouts'),
 'published instructor without payouts gets one payouts reminder');
select pg_temp.messaging_set_request(null,null,'service_role');
select public.booking_sync_payout_account('32000000-0000-0000-0000-000000000021','acct_cxtwo',false,true,true,'active','{}',null);
update public.instructor_profiles set published_at=now()-interval '2 days' where id='32000000-0000-0000-0000-000000000021';
select count(*) from public.claim_profile_completion_reminders(25);
reset role;
select pg_temp.messaging_assert(not exists(select 1 from public.profile_completion_reminder_jobs where profile_id='32000000-0000-0000-0000-000000000021' and kind='payouts'),
 'instructors with ready payouts are not reminded');

---------------------------------------------------------------------------
-- 5. Reviews
---------------------------------------------------------------------------
-- A paid booking with instructor two on the engaged inquiry.
select pg_temp.messaging_set_request(null,null,'service_role');
select (public.booking_create_quote(pg_temp.booking_quote(:'engaged_fb','31000000-0000-0000-0000-000000000021',current_date+45))->>'bookingId') as booking_id \gset
select public.booking_record_organizer_signature(:'booking_id','31000000-0000-0000-0000-000000000010','Jordan Reyes','cx-organizer@example.test',repeat('a',64),null,null);
select public.booking_apply_payment(:'booking_id','paid','cs_cx','pi_cx','ch_cx','card',42000);
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000021','cx-two@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(public.get_inquiry_thread(:'engaged_fb')->'inquiry'->>'contact_name'='Jordan Avery Reyes',
 'after payment the booked instructor sees the organizer name as before');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000010','cx-organizer@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_expect_error(format('select public.submit_instructor_review(%L,5,%L)',:'booking_id','Great'),'after the event','no review before the event');
reset role;
select pg_temp.messaging_assert(not exists(select 1 from public.inquiry_thread_notification_jobs where notification_type='review_request'),'no review request before completion');
update public.bookings set status='completed' where id=:'booking_id';
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_thread_notification_jobs where notification_type='review_request' and thread_id=:'engaged_fb'
  and recipient_account_id='31000000-0000-0000-0000-000000000010'),'completion queues one review request to the organizer');
select pg_temp.messaging_assert(private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where notification_type='review_request')),
 'review request is sendable after the event even though the event is past');
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000021','cx-two@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_expect_error(format('select public.submit_instructor_review(%L,5,null)',:'booking_id'),'access denied','instructor cannot review themselves');
select pg_temp.messaging_assert((public.get_booking_review(:'engaged_fb')->>'can_review')::boolean is false,'instructor gets no review form');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000010','cx-organizer@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert((public.get_booking_review(:'engaged_fb')->>'can_review')::boolean,'organizer can review after completion');
select pg_temp.messaging_expect_error(format('select public.submit_instructor_review(%L,6,null)',:'booking_id'),'1 to 5','rating range enforced');
select public.submit_instructor_review(:'booking_id',5,'  Everyone danced.  ') as review_id \gset
select pg_temp.messaging_expect_error(format('select public.submit_instructor_review(%L,4,null)',:'booking_id'),'already reviewed','one review per booking');
select pg_temp.messaging_assert(public.get_booking_review(:'engaged_fb')->'review'->>'note'='Everyone danced.','organizer sees their review');
reset role;
select pg_temp.messaging_assert(not private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where notification_type='review_request')),
 'review request is cancelled once reviewed');
set local role anon;
select pg_temp.messaging_set_request(null,null,'anon');
select public.get_instructor_reviews('32000000-0000-0000-0000-000000000021') as public_reviews \gset
select pg_temp.messaging_assert((:'public_reviews')::jsonb->>'count'='1' and (:'public_reviews')::jsonb->'reviews'->0->>'reviewer_name'='Jordan R.'
  and not ((:'public_reviews')::jsonb->'reviews'->0 ? 'organizer_account_id'),'reviews are public with a short reviewer name');
select pg_temp.messaging_expect_error('select * from public.instructor_reviews','permission denied','anon cannot read the review table directly');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000010','cx-organizer@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_expect_error(format('select public.admin_set_instructor_review_hidden(%L,true)',:'review_id'),'Administrator access required','only admins hide reviews');
reset role;
select pg_temp.messaging_set_request('31000000-0000-0000-0000-000000000001','cx-admin@example.test','authenticated');
set local role authenticated;
select public.admin_set_instructor_review_hidden(:'review_id',true);
select pg_temp.messaging_assert(jsonb_array_length(public.admin_list_instructor_reviews(50))>=1,'admins list reviews');
reset role;
select pg_temp.messaging_assert((public.get_instructor_reviews('32000000-0000-0000-0000-000000000021')->>'count')::int=0,'hidden reviews leave the public profile');

rollback;
