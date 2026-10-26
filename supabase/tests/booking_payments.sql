\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.booking_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Booking assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.booking_expect_error(
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

create or replace function pg_temp.booking_set_request(
  p_account_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_account_id::text, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_account_id, 'email', p_email, 'role', p_role)::text,
    true
  );
end;
$$;

-- Builds a quote payload with amounts that match the database invariants.
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
  ('30000000-0000-0000-0000-000000000001', 'booking-admin@example.test', '{"full_name":"Booking Admin"}'),
  ('30000000-0000-0000-0000-000000000010', 'booking-organizer@example.test', '{"full_name":"Sarah Planner"}'),
  ('30000000-0000-0000-0000-000000000020', 'booking-instructor@example.test', '{"full_name":"Jess Teacher"}'),
  ('30000000-0000-0000-0000-000000000030', 'booking-outsider@example.test', '{"full_name":"Booking Outsider"}');

update public.accounts
set role = case
      when id = '30000000-0000-0000-0000-000000000001' then 'admin'
      when id = '30000000-0000-0000-0000-000000000020' then 'instructor'
      else 'organizer'
    end,
    onboarding_completed_at = now()
where id::text like '30000000-%';

insert into public.marketplace_admins (account_id, is_owner, granted_by)
values (
  '30000000-0000-0000-0000-000000000001',
  true,
  '30000000-0000-0000-0000-000000000001'
);

insert into public.instructor_profiles (
  id, account_id, slug, status, display_name, city, region, event_types, published_at
) values (
  '40000000-0000-0000-0000-000000000020',
  '30000000-0000-0000-0000-000000000020',
  'booking-instructor-austin-tx',
  'published',
  'Jess Teacher',
  'Austin',
  'TX',
  array['corporate-events'],
  now()
);

insert into public.instructor_private_settings (instructor_profile_id, inquiry_email)
values ('40000000-0000-0000-0000-000000000020', 'booking-instructor@example.test');

-- New instructors join free.
select pg_temp.booking_assert(
  exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = '40000000-0000-0000-0000-000000000020'
      and access.source = 'commission'
      and access.granted_by = '30000000-0000-0000-0000-000000000020'
  ),
  'new instructor profiles must receive no-fee commission access'
);

-- Instructors can save booking preferences, and invalid schedules fail.
set local role authenticated;
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000020', 'booking-instructor@example.test', 'authenticated'
);
update public.instructor_private_settings
set hourly_rate_cents = 20000,
    minimum_hours = 2,
    default_cancellation_policy = 'custom',
    custom_cancellation_windows = '[{"minDaysBeforeEvent": 14, "refundPercent": 100}]'
where instructor_profile_id = '40000000-0000-0000-0000-000000000020';
select pg_temp.booking_expect_error(
  $sql$update public.instructor_private_settings
       set custom_cancellation_windows = '[{"minDaysBeforeEvent": 7, "refundPercent": 50}, {"minDaysBeforeEvent": 14, "refundPercent": 100}]'
       where instructor_profile_id = '40000000-0000-0000-0000-000000000020'$sql$,
  'instructor_private_cancellation_policy_check',
  'out-of-order cancellation windows'
);

-- The organizer sends an inquiry with contact details in the message.
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000010', 'booking-organizer@example.test', 'authenticated'
);
select public.submit_inquiry(
  '40000000-0000-0000-0000-000000000020',
  'corporate-events',
  current_date + 45,
  time '18:00',
  'America/Chicago',
  'Booking Hall',
  'Austin',
  'TX',
  '78701',
  60,
  '$500-$1,000',
  null,
  true,
  true,
  'Call me at (512) 555-0134 or email sarah@example.com. Instagram @sarahplans',
  null,
  false
) as inquiry_id \gset
select public.get_inquiry_primary_thread(:'inquiry_id'::uuid) as thread_id \gset

reset role;
select pg_temp.booking_set_request(null, null, 'postgres');

select pg_temp.booking_assert(
  (
    select position('555-0134' in body) = 0
      and position('sarah@example.com' in body) = 0
      and position('@sarahplans' in body) = 0
      and position('[contact details hidden until the booking is paid]' in body) > 0
    from public.inquiry_messages
    where thread_id = :'thread_id'::uuid and message_kind = 'inquiry'
  ),
  'contact details in an unbooked inquiry message must be hidden'
);
select pg_temp.booking_assert(
  (
    select count(*) = 1
    from public.inquiry_message_originals original
    join public.inquiry_messages message on message.id = original.message_id
    where message.thread_id = :'thread_id'::uuid
      and position('sarah@example.com' in original.original_body) > 0
  ),
  'the original text must be kept for administrators'
);

-- The instructor cannot see organizer contact details before payment.
set local role authenticated;
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000020', 'booking-instructor@example.test', 'authenticated'
);
select pg_temp.booking_assert(
  (
    select not (detail -> 'inquiry' ? 'contact_email')
      and not (detail -> 'inquiry' ? 'email')
      and position('sarah@example.com' in coalesce(detail -> 'inquiry' ->> 'message', '')) = 0
    from public.get_inquiry_thread(:'thread_id'::uuid) as detail
  ),
  'get_inquiry_thread must hide organizer contact details from instructors before payment'
);
select pg_temp.booking_assert(
  not exists (select 1 from public.inquiries where id = :'inquiry_id'::uuid),
  'instructors must not read the inquiry row directly before payment'
);

-- A participant message with a phone number is masked too.
select public.send_inquiry_message(
  :'thread_id'::uuid,
  'Text me at 512.555.0199 to plan.',
  '50000000-0000-0000-0000-000000000001'
);
-- Retrying the same request returns the stored message instead of failing.
select public.send_inquiry_message(
  :'thread_id'::uuid,
  'Text me at 512.555.0199 to plan.',
  '50000000-0000-0000-0000-000000000001'
);
select pg_temp.booking_assert(
  (
    select count(*) = 1
    from public.inquiry_messages
    where thread_id = :'thread_id'::uuid
      and message_kind = 'participant'
      and position('555.0199' in body) = 0
  ),
  'masked participant messages must stay idempotent'
);

-- The booking panel shows payout setup is required.
select pg_temp.booking_assert(
  (
    select (panel ->> 'role') = 'instructor'
      and (panel ->> 'payouts_ready')::boolean = false
      and (panel -> 'defaults' ->> 'hourly_rate_cents')::integer = 20000
      and panel -> 'booking' = 'null'::jsonb
    from public.get_thread_booking(:'thread_id'::uuid) as panel
  ),
  'get_thread_booking must return instructor defaults and payout readiness'
);

-- Outsiders cannot read the booking panel.
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000030', 'booking-outsider@example.test', 'authenticated'
);
select pg_temp.booking_expect_error(
  format('select public.get_thread_booking(%L::uuid)', :'thread_id'),
  'access denied',
  'outsider booking panel'
);

-- Browsers cannot call service-only transitions.
select pg_temp.booking_assert(
  not has_function_privilege('authenticated', 'public.booking_create_quote(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.booking_apply_payment(uuid, text, text, text, text, text, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.booking_claim_due_transfers(integer)', 'execute')
  and not has_table_privilege('authenticated', 'public.bookings', 'insert')
  and not has_table_privilege('authenticated', 'public.bookings', 'update'),
  'booking money movement must be service-role only'
);

reset role;
select pg_temp.booking_set_request(null, null, 'service_role');

-- A quote requires completed payout setup.
select pg_temp.booking_expect_error(
  format(
    'select public.booking_create_quote(%L::jsonb)',
    pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 45)
  ),
  'Finish payout setup',
  'quote before payout setup'
);

select public.booking_sync_payout_account(
  '40000000-0000-0000-0000-000000000020',
  'acct_test123',
  false,
  true,
  true,
  'active',
  '{}',
  null
);

-- Amounts that do not match the fee rules are rejected.
select pg_temp.booking_expect_error(
  format(
    'select public.booking_create_quote(%L::jsonb)',
    pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 45)
      || '{"client_fee_cents": 1000, "total_cents": 41000}'::jsonb
  ),
  'bookings_amounts_check',
  'mismatched amounts'
);

-- Only the thread's instructor can quote.
select pg_temp.booking_expect_error(
  format(
    'select public.booking_create_quote(%L::jsonb)',
    pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000030', current_date + 45)
  ),
  'Only the instructor',
  'quote from another account'
);

select (public.booking_create_quote(
  pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 45)
) ->> 'bookingId') as first_booking_id \gset

select pg_temp.booking_assert(
  (
    select status = 'quote_sent'
      and version = 1
      and expires_at <= now() + interval '7 days'
      and payout_due_at = event_ends_at + interval '24 hours'
      and event_ends_at = event_starts_at + interval '2 hours'
    from public.bookings where id = :'first_booking_id'::uuid
  )
  and exists (
    select 1 from public.booking_signatures
    where booking_id = :'first_booking_id'::uuid and party_role = 'instructor'
  )
  and exists (
    select 1 from public.inquiry_messages message
    join public.booking_milestones milestone on milestone.message_id = message.id
    where milestone.booking_id = :'first_booking_id'::uuid
      and milestone.code = 'quote_sent'
      and message.message_kind = 'system'
      and position('$420.00' in message.body) > 0
      and position('Next: Sarah reviews, signs, and pays.' in message.body) > 0
  )
  and (
    select count(*) = 2
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'thread_id'::uuid
      and job.notification_type = 'booking_update'
  ),
  'a quote must be signed by the instructor, post a milestone, and email both parties'
);

-- An updated quote withdraws the previous one.
select (public.booking_create_quote(
  pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 45)
) ->> 'bookingId') as booking_id \gset

select pg_temp.booking_assert(
  (select status = 'withdrawn' and closed_at is not null from public.bookings where id = :'first_booking_id'::uuid)
  and (select status = 'quote_sent' and version = 2 and replaces_booking_id = :'first_booking_id'::uuid
       from public.bookings where id = :'booking_id'::uuid),
  'an updated quote must replace the open quote'
);

-- The organizer must sign the exact agreement they reviewed.
select pg_temp.booking_expect_error(
  format(
    'select public.booking_record_organizer_signature(%L::uuid, %L::uuid, %L, %L, %L, null, null)',
    :'booking_id', '30000000-0000-0000-0000-000000000010', 'Sarah Planner',
    'booking-organizer@example.test', repeat('b', 64)
  ),
  'agreement changed',
  'stale agreement signature'
);
select pg_temp.booking_expect_error(
  format(
    'select public.booking_record_organizer_signature(%L::uuid, %L::uuid, %L, %L, %L, null, null)',
    :'booking_id', '30000000-0000-0000-0000-000000000030', 'Booking Outsider',
    'booking-outsider@example.test', repeat('a', 64)
  ),
  'access denied',
  'outsider signature'
);
select public.booking_record_organizer_signature(
  :'booking_id'::uuid,
  '30000000-0000-0000-0000-000000000010',
  'Sarah Planner',
  'booking-organizer@example.test',
  repeat('a', 64),
  '198.51.100.7',
  'Organizer browser'
);
select pg_temp.booking_assert(
  (select status = 'awaiting_payment' from public.bookings where id = :'booking_id'::uuid),
  'organizer signature must move the booking to awaiting payment'
);

-- A bank payment that is still clearing does not confirm the booking.
select public.booking_attach_checkout_session(:'booking_id'::uuid, 'cs_test_booking1');
select public.booking_apply_payment(:'booking_id'::uuid, 'processing', 'cs_test_booking1', 'pi_test1', null, 'us_bank_account', 42000) as ach_result \gset
select pg_temp.booking_assert(
  :'ach_result' = 'applied'
  and (select status = 'payment_processing' and paid_at is null from public.bookings where id = :'booking_id'::uuid),
  'ACH processing must not confirm the booking'
);
select pg_temp.booking_expect_error(
  format('select public.booking_apply_payment(%L::uuid, %L, %L, %L, %L, %L, %s)',
    :'booking_id', 'paid', 'cs_test_booking1', 'pi_test1', 'py_test1', 'us_bank_account', 41000),
  'does not match',
  'wrong payment amount'
);
select public.booking_apply_payment(:'booking_id'::uuid, 'paid', 'cs_test_booking1', 'pi_test1', 'py_test1', 'us_bank_account', 42000) as paid_result \gset
select public.booking_apply_payment(:'booking_id'::uuid, 'paid', 'cs_test_booking1', 'pi_test1', 'py_test1', 'us_bank_account', 42000) as repeat_result \gset
select pg_temp.booking_assert(
  :'paid_result' = 'applied'
  and :'repeat_result' = 'ignored'
  and (select status = 'confirmed' and paid_at is not null from public.bookings where id = :'booking_id'::uuid)
  and (select booking_outcome = 'booked' and booking_value_cents = 40000 from public.inquiries where id = :'inquiry_id'::uuid),
  'a cleared payment must confirm the booking once and mark the inquiry booked'
);

-- Money for a withdrawn quote must be refunded.
select pg_temp.booking_assert(
  public.booking_apply_payment(:'first_booking_id'::uuid, 'paid', 'cs_test_old', 'pi_test_old', 'ch_test_old', 'card', 42000) = 'refund_required',
  'payment for a closed quote must require a refund'
);

-- After payment the instructor sees contact details, and new messages are not masked.
set local role authenticated;
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000020', 'booking-instructor@example.test', 'authenticated'
);
select pg_temp.booking_assert(
  (
    select (detail -> 'inquiry' ->> 'contact_email') is not null
    from public.get_inquiry_thread(:'thread_id'::uuid) as detail
  )
  and (
    select (panel -> 'booking' -> 'contacts' ->> 'organizer_email') is not null
      and not (panel -> 'booking' ? 'stripe_charge_id')
      and (panel -> 'booking' ->> 'instructor_payout_cents')::integer = 34000
    from public.get_thread_booking(:'thread_id'::uuid) as panel
  ),
  'paid bookings must share contact details with both parties'
);
select public.send_inquiry_message(
  :'thread_id'::uuid,
  'My cell is 512-555-0177.',
  '50000000-0000-0000-0000-000000000002'
);
select pg_temp.booking_assert(
  exists (
    select 1 from public.inquiry_messages
    where thread_id = :'thread_id'::uuid and position('512-555-0177' in body) > 0
  ),
  'messages after payment must not be masked'
);
select pg_temp.booking_expect_error(
  format('select public.decline_inquiry_thread(%L::uuid, null)', :'thread_id'),
  'paid booking',
  'closing a thread with a paid booking'
);

-- The organizer view hides instructor-side fees.
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000010', 'booking-organizer@example.test', 'authenticated'
);
select pg_temp.booking_assert(
  (
    select not (panel -> 'booking' ? 'instructor_payout_cents')
      and not (panel -> 'booking' ? 'platform_fee_cents')
      and (panel -> 'booking' -> 'cancellation_preview' ->> 'refund_cents')::integer = 40000
      and (panel -> 'booking' ->> 'can_cancel')::boolean
    from public.get_thread_booking(:'thread_id'::uuid) as panel
  ),
  'organizers must see their own refund preview but not instructor fees'
);
select pg_temp.booking_expect_error(
  format('select public.report_booking_problem(%L::uuid, %L)', :'booking_id', 'Too early'),
  'Before the event starts',
  'problem report before the event'
);

reset role;
select pg_temp.booking_set_request(null, null, 'service_role');

-- Cancellation splits follow the Standard policy.
select pg_temp.booking_assert(
  (
    select split.refund_percent = 100 and split.refund_cents = 40000 and split.payout_cents = 0
    from public.bookings booking,
      lateral private.booking_cancellation_split(booking, 'organizer', booking.event_starts_at - interval '31 days') split
    where booking.id = :'booking_id'::uuid
  )
  and (
    select split.refund_percent = 50 and split.refund_cents = 20000 and split.payout_cents = 17000
    from public.bookings booking,
      lateral private.booking_cancellation_split(booking, 'organizer', booking.event_starts_at - interval '10 days') split
    where booking.id = :'booking_id'::uuid
  )
  and (
    select split.refund_percent = 0 and split.refund_cents = 0 and split.payout_cents = 34000
    from public.bookings booking,
      lateral private.booking_cancellation_split(booking, 'organizer', booking.event_starts_at - interval '2 days') split
    where booking.id = :'booking_id'::uuid
  )
  and (
    select split.refund_cents = 42000 and split.payout_cents = 0
    from public.bookings booking,
      lateral private.booking_cancellation_split(booking, 'instructor', booking.event_starts_at - interval '2 days') split
    where booking.id = :'booking_id'::uuid
  ),
  'cancellation splits must follow the policy windows and refund the fee on instructor cancellations'
);

-- Move the event into the past to exercise reminders and payouts.
update public.bookings
set event_date = current_date - 2,
    event_starts_at = now() - interval '26 hours',
    event_ends_at = now() - interval '25 hours',
    payout_due_at = now() - interval '1 hour'
where id = :'booking_id'::uuid;

select (public.booking_post_due_reminders() ->> 'eventsEnded') as ended_count \gset
select pg_temp.booking_assert(
  :ended_count = 1
  and (select status = 'completed' from public.bookings where id = :'booking_id'::uuid),
  'ended events must move to completed with a milestone'
);

select * from public.booking_claim_due_transfers(10) \gset claimed_
select pg_temp.booking_assert(
  :'claimed_booking_id'::uuid = :'booking_id'::uuid
  and :claimed_amount_cents = 34000
  and :'claimed_stripe_account_id' = 'acct_test123'
  and :'claimed_stripe_charge_id' = 'py_test1',
  'due payouts must be claimed with the instructor share'
);
select pg_temp.booking_assert(
  not exists (select 1 from public.booking_claim_due_transfers(10)),
  'a claimed payout must not be claimed again immediately'
);
select public.booking_record_transfer(:'booking_id'::uuid, 'tr_test1', 34000);
select pg_temp.booking_assert(
  (select status = 'paid_out' and paid_out_at is not null from public.bookings where id = :'booking_id'::uuid)
  and exists (select 1 from public.booking_milestones where booking_id = :'booking_id'::uuid and code = 'payout_sent'),
  'a recorded transfer must complete the booking'
);

-- A second booking in the same thread: cancellation by the instructor.
select (public.booking_create_quote(
  pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 60)
) ->> 'bookingId') as second_booking_id \gset
select public.booking_record_organizer_signature(
  :'second_booking_id'::uuid, '30000000-0000-0000-0000-000000000010', 'Sarah Planner',
  'booking-organizer@example.test', repeat('a', 64), null, null
);
select public.booking_apply_payment(:'second_booking_id'::uuid, 'paid', 'cs_test_booking2', 'pi_test2', 'ch_test2', 'card', 42000);
select (public.booking_prepare_cancellation(:'second_booking_id'::uuid, '30000000-0000-0000-0000-000000000020', 'Emergency', false) ->> 'refundCents') as cancel_refund \gset
select pg_temp.booking_assert(
  :cancel_refund = 42000
  and (select status = 'cancelled' and cancelled_by_role = 'instructor' and refund_status = 'pending' and payout_cents = 0
       from public.bookings where id = :'second_booking_id'::uuid),
  'instructor cancellation must refund everything'
);
select public.booking_record_refund(:'second_booking_id'::uuid, 're_test2', 'succeeded', null);
select pg_temp.booking_assert(
  exists (
    select 1 from public.booking_milestones milestone
    join public.inquiry_messages message on message.id = milestone.message_id
    where milestone.booking_id = :'second_booking_id'::uuid
      and milestone.code = 'cancelled'
      and position('$420.00' in message.body) > 0
  )
  and not exists (select 1 from public.booking_claim_due_transfers(10)),
  'a full refund must post a milestone and owe no payout'
);

-- A third booking: a problem report pauses payout until an administrator decides.
select (public.booking_create_quote(
  pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 70)
) ->> 'bookingId') as third_booking_id \gset
select public.booking_record_organizer_signature(
  :'third_booking_id'::uuid, '30000000-0000-0000-0000-000000000010', 'Sarah Planner',
  'booking-organizer@example.test', repeat('a', 64), null, null
);
select public.booking_apply_payment(:'third_booking_id'::uuid, 'paid', 'cs_test_booking3', 'pi_test3', 'ch_test3', 'card', 42000);
update public.bookings
set event_starts_at = now() - interval '3 hours',
    event_ends_at = now() - interval '1 hour',
    payout_due_at = now() + interval '23 hours'
where id = :'third_booking_id'::uuid;
select public.booking_post_due_reminders();

reset role;
set local role authenticated;
select pg_temp.booking_set_request(
  '30000000-0000-0000-0000-000000000010', 'booking-organizer@example.test', 'authenticated'
);
select public.report_booking_problem(:'third_booking_id'::uuid, 'The instructor arrived an hour late.');
reset role;
select pg_temp.booking_set_request(null, null, 'service_role');
update public.bookings set payout_due_at = now() - interval '1 minute' where id = :'third_booking_id'::uuid;
select pg_temp.booking_assert(
  not exists (select 1 from public.booking_claim_due_transfers(10)),
  'a reported problem must pause the payout'
);
select pg_temp.booking_expect_error(
  format('select public.booking_prepare_problem_resolution(%L::uuid, %L::uuid, 10000, null)',
    :'third_booking_id', '30000000-0000-0000-0000-000000000030'),
  'Administrator access required',
  'non-admin resolution'
);
select public.booking_prepare_problem_resolution(
  :'third_booking_id'::uuid, '30000000-0000-0000-0000-000000000001', 10000, 'Late arrival'
);
select pg_temp.booking_assert(
  (select refund_cents = 10000 and payout_cents = 25500 and refund_status = 'pending'
   from public.bookings where id = :'third_booking_id'::uuid)
  and not exists (select 1 from public.booking_claim_due_transfers(10)),
  'a partial refund must finish before the reduced payout is sent'
);
select public.booking_record_refund(:'third_booking_id'::uuid, 're_test3', 'succeeded', null);
select * from public.booking_claim_due_transfers(10) \gset third_
select pg_temp.booking_assert(
  :'third_booking_id'::uuid = :'third_booking_id'::uuid and :third_amount_cents = 25500,
  'after the refund the reduced payout must be claimed'
);

select public.booking_record_transfer(:'third_booking_id'::uuid, 'tr_test3', 25500);

-- Expired quotes close with a milestone.
select (public.booking_create_quote(
  pg_temp.booking_quote(:'thread_id'::uuid, '30000000-0000-0000-0000-000000000020', current_date + 80)
) ->> 'bookingId') as fourth_booking_id \gset
update public.bookings set expires_at = now() - interval '1 minute' where id = :'fourth_booking_id'::uuid;
select public.booking_expire_due_quotes() as expired_count \gset
select pg_temp.booking_assert(
  :expired_count = 1
  and (select status = 'expired' from public.bookings where id = :'fourth_booking_id'::uuid)
  and exists (select 1 from public.booking_milestones where booking_id = :'fourth_booking_id'::uuid and code = 'expired'),
  'expired quotes must close with a milestone'
);

-- Booking update notifications are sendable.
select pg_temp.booking_assert(
  exists (
    select 1 from public.inquiry_thread_notification_jobs
    where notification_type = 'booking_update' and thread_id = :'thread_id'::uuid
  ),
  'booking milestones must queue booking_update emails'
);

select 'booking payments passed' as result;
rollback;
