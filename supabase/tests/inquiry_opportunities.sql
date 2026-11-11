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

select pg_temp.messaging_assert(
  has_function_privilege(
    'authenticated',
    'public.submit_inquiry(uuid,text,date,time without time zone,text,text,text,text,text,integer,text,text,boolean,boolean,text,text,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_inquiry_threads(text,text,text,integer,timestamp with time zone,uuid,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.send_inquiry_message(uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_inquiry_thread_notification_jobs(integer,interval)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_inquiry_thread_notification_jobs(integer,interval)',
    'execute'
  ),
  'browser and worker RPC grants must use least privilege'
);

select pg_temp.messaging_assert(
  not has_table_privilege('authenticated', 'public.inquiry_messages', 'insert')
  and not has_table_privilege('authenticated', 'public.inquiry_messages', 'update')
  and not has_table_privilege('authenticated', 'public.inquiry_messages', 'delete')
  and has_table_privilege('authenticated', 'public.inquiry_messages', 'select'),
  'participant messages must be read-only outside constrained RPCs'
);

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

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'messaging-admin@example.test',
    '{"full_name":"Messaging Admin"}'
  ),
  (
    '10000000-0000-0000-0000-000000000010',
    'messaging-organizer@example.test',
    '{"full_name":"Messaging Organizer"}'
  ),
  (
    '10000000-0000-0000-0000-000000000020',
    'messaging-instructor-one@example.test',
    '{"full_name":"Instructor One"}'
  ),
  (
    '10000000-0000-0000-0000-000000000021',
    'messaging-instructor-two@example.test',
    '{"full_name":"Instructor Two"}'
  ),
  (
    '10000000-0000-0000-0000-000000000030',
    'messaging-outsider@example.test',
    '{"full_name":"Messaging Outsider"}'
  );

update public.accounts
set role = case
      when id = '10000000-0000-0000-0000-000000000001' then 'admin'
      when id = '10000000-0000-0000-0000-000000000010' then 'organizer'
      when id in (
        '10000000-0000-0000-0000-000000000020',
        '10000000-0000-0000-0000-000000000021'
      ) then 'instructor'
      else 'organizer'
    end,
    company_name = case
      when id = '10000000-0000-0000-0000-000000000010'
        then 'Messaging Events'
    end,
    onboarding_completed_at = now()
where id::text like '10000000-%';

insert into public.marketplace_admins (
  account_id,
  is_owner,
  granted_by
)
values (
  '10000000-0000-0000-0000-000000000001',
  true,
  '10000000-0000-0000-0000-000000000001'
);

insert into public.instructor_profiles (
  id,
  account_id,
  slug,
  status,
  display_name,
  city,
  region,
  event_types,
  published_at
)
values
  (
    '20000000-0000-0000-0000-000000000020',
    '10000000-0000-0000-0000-000000000020',
    'messaging-instructor-one-austin-tx',
    'published',
    'Instructor One',
    'Austin',
    'TX',
    array['corporate-events', 'private-parties'],
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000021',
    'messaging-instructor-two-austin-tx',
    'published',
    'Instructor Two',
    'Austin',
    'TX',
    array['corporate-events', 'private-parties'],
    now()
  );

insert into public.instructor_private_settings (
  instructor_profile_id,
  inquiry_email,
  response_reminders_enabled
)
values
  (
    '20000000-0000-0000-0000-000000000020',
    'messaging-instructor-one@example.test',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000021',
    'messaging-instructor-two@example.test',
    true
  );

insert into public.instructor_guarantees (
  instructor_profile_id,
  guarantee_status,
  guarantee_terms_version
)
values (
  '20000000-0000-0000-0000-000000000021',
  'covered',
  '2026-08-04'
);

select pg_temp.messaging_assert(
  (
    select count(*) = 2
    from public.instructor_service_markets mapping
    where mapping.service_market_slug = 'austin-tx'
      and mapping.instructor_profile_id in (
        '20000000-0000-0000-0000-000000000020',
        '20000000-0000-0000-0000-000000000021'
      )
      and mapping.accepting_inquiries
      and mapping.fallback_eligible
  ),
  'profile locations must normalize into database service markets'
);


-- A third instructor allows the organizer to contact both recommendations.
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000022','messaging-instructor-three@example.test','{"full_name":"Instructor Three"}');
update public.accounts set role='instructor',onboarding_completed_at=now() where id='10000000-0000-0000-0000-000000000022';
insert into public.instructor_profiles(id,account_id,slug,status,display_name,city,region,event_types,published_at)
 values('20000000-0000-0000-0000-000000000022','10000000-0000-0000-0000-000000000022','messaging-instructor-three','published','Instructor Three','Austin','TX',array['corporate-events'],now());
insert into public.instructor_private_settings(instructor_profile_id,inquiry_email)
 values('20000000-0000-0000-0000-000000000022','messaging-instructor-three@example.test');

-- All four alternatives must be invited, not capped at two recommendations.
insert into auth.users(id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000023','four@example.test','{"full_name":"Instructor Four"}'),
 ('10000000-0000-0000-0000-000000000024','five@example.test','{"full_name":"Instructor Five"}');
update public.accounts set role='instructor',onboarding_completed_at=now() where id in ('10000000-0000-0000-0000-000000000023','10000000-0000-0000-0000-000000000024');
insert into public.instructor_profiles(id,account_id,slug,status,display_name,city,region,event_types,published_at) values
 ('20000000-0000-0000-0000-000000000023','10000000-0000-0000-0000-000000000023','instructor-four','published','Instructor Four','Austin','TX',array['corporate-events'],now()),
 ('20000000-0000-0000-0000-000000000024','10000000-0000-0000-0000-000000000024','instructor-five','published','Instructor Five','Austin','TX',array['corporate-events'],now());
insert into public.instructor_private_settings(instructor_profile_id,inquiry_email) values
 ('20000000-0000-0000-0000-000000000023','four@example.test'),('20000000-0000-0000-0000-000000000024','five@example.test');
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select public.submit_inquiry('20000000-0000-0000-0000-000000000020','corporate-events',current_date+30,
 '18:00','America/Chicago','Messaging Hall','Austin','TX','78701',80,'500-999','Beginner songs',true,true,'PRIVATE ORIGINAL MESSAGE',null,true) as inquiry_id \gset
select public.get_inquiry_primary_thread(:'inquiry_id') as thread_id \gset
reset role;
select pg_temp.messaging_assert((select automatic_sharing from public.inquiries where id=:'inquiry_id'),'new explicit sharing is recorded');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000020','one@example.test','authenticated');
set local role authenticated;
select public.decline_inquiry_thread(:'thread_id',null);
select public.send_inquiry_message(:'thread_id','I hope your event goes well.',gen_random_uuid());
select pg_temp.messaging_assert((public.get_inquiry_thread(:'thread_id')->'thread'->>'can_reply')::boolean,'unavailable conversation remains open');
reset role;
select pg_temp.messaging_assert((select count(*)=5 from public.inquiry_threads where inquiry_id=:'inquiry_id'),'four alternatives invited immediately');
select private.invite_inquiry_matches(:'thread_id');
select pg_temp.messaging_assert((select count(*)=5 from public.inquiry_threads where inquiry_id=:'inquiry_id'),'retry does not duplicate invitations');
select pg_temp.messaging_assert(not exists(select 1 from public.inquiry_messages m join public.inquiry_threads t on t.id=m.thread_id where t.inquiry_id=:'inquiry_id' and t.id<>:'thread_id' and m.body like '%PRIVATE ORIGINAL%'),'original message never copied');
select id as second_thread from public.inquiry_threads where inquiry_id=:'inquiry_id' and instructor_profile_id='20000000-0000-0000-0000-000000000021' \gset
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000021','two@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(public.get_inquiry_thread(:'second_thread')->'inquiry'->>'contact_email'='messaging-organizer@example.test','invited instructor receives organizer contact');
select pg_temp.messaging_assert(not(public.get_inquiry_opportunity(:'second_thread') ? 'candidates'),'instructor cannot see applicants');
select pg_temp.messaging_expect_error(format('select public.get_inquiry_thread(%L)',:'thread_id'),'access denied','private conversation isolation');
select public.set_inquiry_availability(:'second_thread');
select public.set_inquiry_availability(:'second_thread');
reset role;
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_messages where thread_id=:'second_thread' and body='Available for this event.'),'availability is idempotent');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(jsonb_array_length(public.get_inquiry_opportunity(:'second_thread')->'candidates')=5,'organizer sees all candidates');
reset role;
-- Verify explicit decline keeps declined status despite later correspondence.
select pg_temp.messaging_assert((select status='declined' from public.inquiry_threads where id=:'thread_id'),'message after decline does not restore availability');

-- Confirmed bookings notify interested instructors once, without revealing the winner.
select id as third_thread from public.inquiry_threads where inquiry_id=:'inquiry_id' and instructor_profile_id='20000000-0000-0000-0000-000000000022' \gset
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000022','three@example.test','authenticated');
set local role authenticated;
select public.set_inquiry_availability(:'third_thread');
reset role;
select pg_temp.messaging_set_request(null,null,'service_role');
select public.booking_sync_payout_account('20000000-0000-0000-0000-000000000021','acct_opportunity',false,true,true,'active','{}',null);
select (public.booking_create_quote(pg_temp.booking_quote(:'second_thread','10000000-0000-0000-0000-000000000021',current_date+30))->>'bookingId') as quote_id \gset
select public.booking_record_organizer_signature(:'quote_id','10000000-0000-0000-0000-000000000010','Messaging Organizer','messaging-organizer@example.test',repeat('a',64),null,null);
select pg_temp.messaging_assert(private.inquiry_finalizing(:'inquiry_id'),'signature starts finalizing');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000022','three@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(public.get_inquiry_opportunity(:'third_thread')->>'phase'='finalizing','other instructor sees pending status');
select pg_temp.messaging_expect_error(format('select public.set_inquiry_availability(%L)',:'third_thread'),'not accepting','new responses paused');
reset role;
savepoint expired_selection;
update public.bookings set expires_at=now()-interval '1 minute' where id=:'quote_id';
select pg_temp.messaging_assert(not private.inquiry_finalizing(:'inquiry_id'),'existing quote expiry releases pending selection');
update public.bookings set status='payment_processing',payment_started_at=now() where id=:'quote_id';
select pg_temp.messaging_assert(private.inquiry_finalizing(:'inquiry_id'),'processing payment remains pending after quote deadline');
rollback to savepoint expired_selection;
select pg_temp.messaging_set_request(null,null,'service_role');
select public.booking_apply_payment(:'quote_id','paid','cs_opportunity','pi_opportunity','ch_opportunity','card',42000);
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_thread_notification_jobs where dedupe_key='opportunity-closed:'||:'inquiry_id'||':'||:'third_thread'),'interested instructor gets closure notification');
select public.booking_apply_payment(:'quote_id','paid','cs_opportunity','pi_opportunity','ch_opportunity','card',42000);
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_thread_notification_jobs where dedupe_key='opportunity-closed:'||:'inquiry_id'||':'||:'third_thread'),'duplicate payment webhook does not duplicate closure');
select pg_temp.messaging_assert((select count(*)=0 from public.inquiry_thread_notification_jobs where dedupe_key='opportunity-closed:'||:'inquiry_id'||':'||:'thread_id'),'unavailable instructor not sent rejection notice');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000022','three@example.test','authenticated');
set local role authenticated;
select pg_temp.messaging_assert(not (public.get_inquiry_thread(:'third_thread')->'inquiry' ? 'booked_instructor_profile_id'),'winner identity stays private');
select pg_temp.messaging_assert(not (public.get_inquiry_thread(:'third_thread')->'thread'->>'can_reply')::boolean,'competing conversation closes after payment');
reset role;
-- Legacy inquiries do not silently acquire new sharing consent.
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
set local role authenticated;
select public.submit_inquiry('20000000-0000-0000-0000-000000000020','corporate-events',current_date+35,
 '18:00','America/Chicago','Messaging Hall','Austin','TX','78701',80,null,null,true,true,'Legacy',null,false) as legacy_id \gset
reset role;
select pg_temp.messaging_assert((select not automatic_sharing from public.inquiries where id=:'legacy_id'),'legacy sharing preserved');

-- The elapsed-time timeout invites all matches, and the original instructor remains eligible.
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
set local role authenticated;
select public.submit_inquiry('20000000-0000-0000-0000-000000000020','corporate-events',current_date+40,
 '18:00','America/Chicago','Messaging Hall','Austin','TX','78701',80,null,null,true,true,'Later event',null,true) as timeout_id \gset
select public.get_inquiry_primary_thread(:'timeout_id') as timeout_thread \gset
reset role;
update public.inquiry_threads set assigned_at=now()-interval '49 hours',response_clock_started_at=now()-interval '49 hours',response_due_at=now()-interval '1 hour' where id=:'timeout_thread';
select pg_temp.messaging_set_request(null,null,'service_role');
select public.enqueue_due_inquiry_response_actions();
select pg_temp.messaging_assert((select count(*)=5 from public.inquiry_threads where inquiry_id=:'timeout_id'),'timeout invites all four alternatives');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000020','one@example.test','authenticated');
set local role authenticated;
select public.set_inquiry_availability(:'timeout_thread');
select pg_temp.messaging_assert(public.get_inquiry_opportunity(:'timeout_thread')->>'own_availability'='available','late original instructor can participate');
reset role;
select pg_temp.messaging_expect_error(format('update public.inquiries set booking_outcome=%L,booked_instructor_profile_id=%L where id=%L','booked','20000000-0000-0000-0000-000000000020',:'timeout_id'),'full payment','an inquiry cannot close as booked without payment');
rollback;
