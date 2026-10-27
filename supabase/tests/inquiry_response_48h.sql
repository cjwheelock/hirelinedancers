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
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select public.submit_inquiry('20000000-0000-0000-0000-000000000020','corporate-events',current_date+30,
 '18:00','America/Chicago','Messaging Hall','Austin','TX','78701',80,'500-999','Beginner songs',true,true,'Please teach our team.',null,false) as inquiry_id \gset
select public.get_inquiry_primary_thread(:'inquiry_id') as thread_id \gset
reset role;
select pg_temp.messaging_set_request(null,null,'postgres');
select pg_temp.messaging_assert((select response_policy_version=2 and response_due_at=assigned_at+interval '48 hours'
 from public.inquiry_threads where id=:'thread_id'),'48-hour clock starts at submission, before email delivery');
select pg_temp.messaging_assert((select count(*)=5 from public.inquiry_thread_notification_jobs where thread_id=:'thread_id'),
 'initial email, two reminders, and two timeout emails are created atomically');
select pg_temp.messaging_assert((select available_at=t.assigned_at+interval '47 hours'
 from public.inquiry_thread_notification_jobs j join public.inquiry_threads t on t.id=j.thread_id
 where t.id=:'thread_id' and j.notification_type='response_reminder_47'),'final warning at 47 hours');
set local role service_role;
select pg_temp.messaging_set_request(null,null,'service_role');
select count(*) from public.claim_inquiry_thread_notification_jobs_v2();
reset role;
select pg_temp.messaging_assert((select count(*)=4 from public.inquiry_thread_notification_jobs
 where thread_id=:'thread_id' and status='pending'),'claiming initial alert does not cancel future reminders or timeout notices');
update public.inquiry_threads set response_clock_started_at=now()-interval '49 hours',response_due_at=now()-interval '1 hour'
 where id=:'thread_id';
set local role service_role;
select public.enqueue_due_inquiry_response_actions();
reset role;
select pg_temp.messaging_assert((select status='timed_out' and closed_at is null from public.inquiry_threads where id=:'thread_id'),
 'timeout allows late replies');
select pg_temp.messaging_assert((select count(*)=2 from public.inquiry_recommendations where source_thread_id=:'thread_id'),
 'two matching alternatives saved');
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000030','messaging-outsider@example.test','authenticated');
select pg_temp.messaging_expect_error(format('select public.get_inquiry_recommendations(%L)',:'thread_id'),'access denied','outsider cannot view recommendations');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select pg_temp.messaging_assert(jsonb_array_length(public.get_inquiry_recommendations(:'thread_id'))=2,'organizer sees two alternatives');
select public.contact_recommended_instructor(:'thread_id','20000000-0000-0000-0000-000000000021','Contact planner@example.test or 512-555-0102') as second_thread \gset
select public.contact_recommended_instructor(:'thread_id','20000000-0000-0000-0000-000000000022',null) as third_thread \gset
select pg_temp.messaging_assert(public.contact_recommended_instructor(:'thread_id','20000000-0000-0000-0000-000000000021','Contact planner@example.test or 512-555-0102')=:'second_thread'::uuid,
 'repeated send returns the existing thread');
select pg_temp.messaging_assert(public.get_inquiry_thread(:'second_thread')->'inquiry'->>'venue_name'='Messaging Hall'
 and public.get_inquiry_thread(:'second_thread')->'inquiry'->>'message'='Contact planner@example.test or 512-555-0102','saved event details and edited message preserved');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000020','messaging-instructor-one@example.test','authenticated');
select public.send_inquiry_message(:'thread_id','Sorry for the delay, I can help.',gen_random_uuid());
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_threads),'instructor cannot read other instructor conversations');
select pg_temp.messaging_expect_error(format('select public.get_inquiry_thread(%L)',:'second_thread'),'access denied','cross-thread detail is private');

-- Exercise two private conversations, simultaneous quotes, and paid-booking attribution.
savepoint booking_compatibility;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000021','messaging-instructor-two@example.test','authenticated');
select pg_temp.messaging_assert(
 position('planner@example.test' in coalesce(public.get_inquiry_thread(:'second_thread')->'inquiry'->>'message',''))=0
 and position('512-555-0102' in coalesce(public.get_inquiry_thread(:'second_thread')->'thread'->'inquiry_snapshot'->>'message',''))=0
 and not (public.get_inquiry_thread(:'second_thread')->'inquiry' ? 'contact_email')
 and (select position('planner@example.test' in coalesce(inquiry_snapshot->>'message',''))=0 from public.inquiry_threads where id=:'second_thread'),
 'unpaid instructors cannot read contact details through the inquiry or snapshot');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select pg_temp.messaging_assert(
 position('planner@example.test' in public.get_inquiry_thread(:'second_thread')->'inquiry'->>'message')>0,
 'the organizer can still see their original opening message');
select public.send_inquiry_message(:'second_thread','Please call 512-555-0103','e0000000-0000-0000-0000-000000000001');
select public.send_inquiry_message(:'second_thread','Please call 512-555-0103','e0000000-0000-0000-0000-000000000001');
select pg_temp.messaging_assert((select count(*)=1 from public.inquiry_messages where client_request_id='e0000000-0000-0000-0000-000000000001'),
 'retries of masked messages remain idempotent');
reset role;
select pg_temp.messaging_set_request(null,null,'service_role');
select public.booking_sync_payout_account('20000000-0000-0000-0000-000000000020','acct_compat1',false,true,true,'active','{}',null);
select public.booking_sync_payout_account('20000000-0000-0000-0000-000000000021','acct_compat2',false,true,true,'active','{}',null);
select (public.booking_create_quote(pg_temp.booking_quote(:'thread_id','10000000-0000-0000-0000-000000000020',current_date+30))->>'bookingId') as first_quote \gset
select (public.booking_create_quote(pg_temp.booking_quote(:'second_thread','10000000-0000-0000-0000-000000000021',current_date+30))->>'bookingId') as second_quote \gset
select pg_temp.messaging_assert((select count(*)=4 from public.inquiry_thread_notification_jobs where notification_type='booking_update' and thread_id in (:'thread_id',:'second_thread')),
 'both independent quotes queue booking notifications');
select public.booking_record_organizer_signature(:'first_quote','10000000-0000-0000-0000-000000000010','Messaging Organizer','messaging-organizer@example.test',repeat('a',64),null,null);
select pg_temp.messaging_expect_error(format('select public.booking_record_organizer_signature(%L::uuid,%L::uuid,%L,%L,%L,null,null)',
 :'second_quote','10000000-0000-0000-0000-000000000010','Messaging Organizer','messaging-organizer@example.test',repeat('a',64)),
 'Another booking for this inquiry','only one quote can be signed for payment');
select pg_temp.messaging_assert(public.booking_apply_payment(:'first_quote','paid','cs_test_compat','pi_compat','ch_compat','card',42000)='applied',
 'payment on the original instructor conversation succeeds');
select pg_temp.messaging_assert((select booked_instructor_profile_id='20000000-0000-0000-0000-000000000020' from public.inquiries where id=:'inquiry_id')
 and (select count(*)=2 from public.inquiry_threads where inquiry_id=:'inquiry_id' and id<>:'thread_id' and status='closed')
 and (select status='withdrawn' from public.bookings where id=:'second_quote'),
 'payment attributes the booked instructor and closes competing conversations');
select pg_temp.messaging_assert(exists(select 1 from public.inquiry_thread_notification_jobs where thread_id=:'thread_id'
 and notification_type='booking_update' and status='pending' and private.inquiry_notification_needed(id)),
 'booking notifications remain sendable after payment');
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000020','messaging-instructor-one@example.test','authenticated');
select pg_temp.messaging_assert((public.get_inquiry_thread(:'thread_id')->'thread'->>'is_current_assignment')::boolean
 and (public.get_inquiry_thread(:'thread_id')->'inquiry'->>'contact_email') is not null,
 'the paid instructor retains their conversation and contact details');
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000021','messaging-instructor-two@example.test','authenticated');
select pg_temp.messaging_assert(not exists(select 1 from public.inquiries where id=:'inquiry_id')
 and not (public.get_inquiry_thread(:'second_thread')->'inquiry' ? 'contact_email')
 and not (public.get_inquiry_thread(:'second_thread')->'thread'->>'can_reply')::boolean,
 'another instructor cannot read paid contact details or reply after the event is booked');
rollback to savepoint booking_compatibility;

select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select public.report_thread_booking_outcome(:'second_thread','booked');
reset role;
select pg_temp.messaging_assert((select booked_instructor_profile_id='20000000-0000-0000-0000-000000000021' from public.inquiries where id=:'inquiry_id'),
 'booking selects the chosen conversation, not the latest instructor');
select pg_temp.messaging_assert(not exists(select 1 from public.inquiry_thread_notification_jobs j join public.inquiry_threads t on t.id=j.thread_id
 where t.inquiry_id=:'inquiry_id' and j.status='pending' and j.notification_type<>'new_message'),'booking cancels outstanding response notifications');
select pg_temp.messaging_assert((select count(*)=2 from public.inquiry_threads where inquiry_id=:'inquiry_id' and status='closed'),
 'other conversations close on booking');
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000021','messaging-instructor-two@example.test','authenticated');
select public.submit_instructor_inquiry_feedback(:'inquiry_id','booking','booked','Confirmed event details',current_date+32);
reset role;
select pg_temp.messaging_assert((select booking_event_date=current_date+32 from public.inquiries where id=:'inquiry_id')
 and exists(select 1 from public.inquiry_followup_responses where inquiry_id=:'inquiry_id'
   and private_comment='Confirmed event details' and confirmed_event_date=current_date+32),
 'instructor booking feedback retains the confirmed date and private comment');

-- An unavailable instructor triggers alternatives immediately, without counting a read as a reply.
update public.instructor_service_markets set fallback_eligible=false
 where instructor_profile_id in ('20000000-0000-0000-0000-000000000021','20000000-0000-0000-0000-000000000022');
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select public.submit_inquiry('20000000-0000-0000-0000-000000000020','corporate-events',current_date+31,
 '18:00','America/Chicago','Messaging Hall','Austin','TX','78701',80,null,null,true,true,'Second event',null,false) as no_match_inquiry \gset
select public.get_inquiry_primary_thread(:'no_match_inquiry') as no_match_thread \gset
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000020','messaging-instructor-one@example.test','authenticated');
select public.mark_inquiry_thread_read(:'no_match_thread');
reset role;
select pg_temp.messaging_assert((select first_instructor_message_at is null and status='awaiting_response' from public.inquiry_threads where id=:'no_match_thread'),
 'reading does not satisfy the response requirement');
update public.inquiry_threads set response_clock_started_at=now()-interval '47 hours', response_due_at=now()+interval '1 hour'
 where id=:'no_match_thread';
select pg_temp.messaging_assert(not private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where thread_id=:'no_match_thread' and notification_type='response_reminder_24')),
 'delayed 24-hour reminders do not pile up with the final warning');
select pg_temp.messaging_assert(private.inquiry_notification_needed((select id from public.inquiry_thread_notification_jobs where thread_id=:'no_match_thread' and notification_type='response_reminder_47')),
 '47-hour reminder remains sendable before deadline');
set local role authenticated;
select public.decline_inquiry_thread(:'no_match_thread');
reset role;
select pg_temp.messaging_assert(exists(select 1 from public.inquiry_attention_items where thread_id=:'no_match_thread' and reason='no_matches'),
 'no suitable candidates creates an attention item');
select pg_temp.messaging_assert(exists(select 1 from public.inquiry_thread_notification_jobs where thread_id=:'no_match_thread' and notification_type='thread_declined' and status='pending'),
 'unavailable response immediately notifies the organizer');
select pg_temp.messaging_assert(not exists(select 1 from public.inquiry_thread_notification_jobs where thread_id=:'no_match_thread' and notification_type like 'response_%' and status='pending'),
 'unavailability stops the response reminders');
rollback;
