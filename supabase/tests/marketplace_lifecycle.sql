\set ON_ERROR_STOP on

-- Run after all files in supabase/migrations have been applied. The test uses
-- only standard PostgreSQL features and rolls back every fixture it creates.
begin;

create or replace function pg_temp.test_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Lifecycle assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(
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

create or replace function pg_temp.set_request(
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
    jsonb_build_object(
      'sub', p_account_id,
      'email', p_email,
      'role', p_role
    )::text,
    true
  );
end;
$$;

-- Supabase projects provide these baseline API-role grants through platform
-- default privileges. Recreate them here so the same file also runs against a
-- plain isolated PostgreSQL cluster with the minimal auth and storage shims.
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Auth fixtures. In Supabase, inserting auth.users also creates public.accounts.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test', '{"full_name":"Marketplace Owner"}'),
  ('00000000-0000-0000-0000-000000000002', 'delegate@example.test', '{"full_name":"Delegate Admin"}'),
  ('00000000-0000-0000-0000-000000000010', 'alice@example.test', '{"full_name":"Alice Refund"}'),
  ('00000000-0000-0000-0000-000000000011', 'bianca@example.test', '{"full_name":"Bianca Booking"}'),
  ('00000000-0000-0000-0000-000000000012', 'casey@example.test', '{"full_name":"Casey Existing"}'),
  ('00000000-0000-0000-0000-000000000020', 'organizer@example.test', '{"full_name":"Olivia Organizer"}'),
  ('00000000-0000-0000-0000-000000000030', 'outsider@example.test', '{"full_name":"Oscar Outsider"}');

update public.accounts
set role = 'admin', onboarding_completed_at = now()
where id = '00000000-0000-0000-0000-000000000001';

insert into public.marketplace_admins (account_id, is_owner, granted_by)
values (
  '00000000-0000-0000-0000-000000000001',
  true,
  '00000000-0000-0000-0000-000000000001'
);

-- Instructor onboarding creates a draft profile and keeps SMS disabled, even
-- when an older client submits the former SMS opt-in fields.
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000010',
  'alice@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'instructor', 'Alice Refund', 'Austin Steps', '+15125550101', true
);
select pg_temp.test_assert(
  (select role = 'instructor' and not sms_opt_in
   from public.accounts
   where id = '00000000-0000-0000-0000-000000000010'),
  'instructor onboarding must force account SMS off'
);
select pg_temp.test_assert(
  (select profile.status = 'draft' and not settings.sms_notifications_enabled
   from public.instructor_profiles profile
   join public.instructor_private_settings settings
     on settings.instructor_profile_id = profile.id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'instructor onboarding must create a draft with SMS off'
);
update public.instructor_private_settings settings
set sms_notifications_enabled = true
from public.instructor_profiles profile
where profile.id = settings.instructor_profile_id
  and profile.account_id = '00000000-0000-0000-0000-000000000010';
select pg_temp.test_assert(
  (select not settings.sms_notifications_enabled
   from public.instructor_private_settings settings
   join public.instructor_profiles profile on profile.id = settings.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'server-side writes must not re-enable SMS'
);
update public.instructor_profiles
set business_name = 'Austin Steps',
    city = 'Austin',
    region = 'TX',
    bio = 'Beginner-friendly line dance instruction for private and company events.',
    status = 'pending_review'
where account_id = '00000000-0000-0000-0000-000000000010';

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000011',
  'bianca@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'instructor', 'Bianca Booking', 'Bay Area Boots', null, false
);
update public.instructor_profiles
set business_name = 'Bay Area Boots',
    city = 'San Francisco',
    region = 'CA',
    bio = 'Line dance instruction for groups of every experience level.',
    status = 'pending_review'
where account_id = '00000000-0000-0000-0000-000000000011';

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000012',
  'casey@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'instructor', 'Casey Existing', 'Casey Dance Co.', null, false
);
update public.instructor_profiles
set city = 'Nashville',
    region = 'TN',
    status = 'pending_review'
where account_id = '00000000-0000-0000-0000-000000000012';

-- Organizer onboarding never creates an instructor profile and also forces the
-- retired SMS preference off.
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000020',
  'organizer@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'organizer', 'Olivia Organizer', 'Acme Events', '+12125550120', true
);
select pg_temp.test_assert(
  (select role = 'organizer' and not sms_opt_in
   from public.accounts
   where id = '00000000-0000-0000-0000-000000000020'),
  'organizer onboarding must force SMS off'
);
select pg_temp.test_assert(
  not exists (
    select 1 from public.instructor_profiles
    where account_id = '00000000-0000-0000-0000-000000000020'
  ),
  'organizer onboarding must not create an instructor profile'
);

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000002',
  'delegate@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'organizer', 'Delegate Admin', 'Delegate Events', null, false
);
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000030',
  'outsider@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'organizer', 'Oscar Outsider', null, null, false
);

-- The owner reviews profiles. Approval alone does not publish them.
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select public.review_instructor_profile(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
  'approve', 'alice-refund-austin-tx', 'Lifecycle approval'
);
select public.review_instructor_profile(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000011'),
  'approve', 'bianca-booking-san-francisco-ca', 'Lifecycle approval'
);
select public.review_instructor_profile(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000012'),
  'approve', 'casey-existing-nashville-tn', 'Lifecycle approval'
);
select pg_temp.test_assert(
  (select count(*) = 3
   from public.instructor_profiles
   where account_id in (
     '00000000-0000-0000-0000-000000000010',
     '00000000-0000-0000-0000-000000000011',
     '00000000-0000-0000-0000-000000000012'
   ) and status = 'approved'),
  'approved profiles must wait for an active membership before publication'
);

-- Create an unassigned guarantee before Casey subscribes. The subscription
-- trigger must still allocate a founding position to the existing row.
select public.admin_update_instructor_guarantee(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000012'),
  'unassigned', 'not_started', 'Preexisting admin record'
);

-- Stripe subscription events are service-only. The first active or trialing
-- subscription publishes the profile and snapshots founding guarantee terms.
reset role;
select pg_temp.set_request(null, null, 'postgres');
set local role service_role;
select pg_temp.set_request(null, null, 'service_role');
select pg_temp.test_assert(
  public.apply_stripe_subscription_event(
    'evt_alice_first', 'customer.subscription.created', timestamptz '2026-08-04 12:00:00+00',
    '2025-07-30.basil', false,
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
    'cus_alice', 'sub_alice_first', 'price_hld_monthly', 'trialing',
    timestamptz '2026-08-04 12:00:00+00', timestamptz '2026-09-03 12:00:00+00',
    false, 'cs_alice_first', null,
    timestamptz '2026-08-04 12:00:00+00', timestamptz '2026-08-04 12:01:00+00'
  ) = 'processed',
  'first Alice subscription event must process'
);
select pg_temp.test_assert(
  public.apply_stripe_subscription_event(
    'evt_bianca_first', 'customer.subscription.created', timestamptz '2026-08-04 12:02:00+00',
    '2025-07-30.basil', false,
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000011'),
    'cus_bianca', 'sub_bianca_first', 'price_hld_monthly', 'active',
    timestamptz '2026-08-04 12:02:00+00', timestamptz '2026-09-04 12:02:00+00',
    false, 'cs_bianca_first', 'in_bianca_first',
    timestamptz '2026-08-04 12:02:00+00', timestamptz '2026-08-04 12:03:00+00'
  ) = 'processed',
  'first Bianca subscription event must process'
);
select pg_temp.test_assert(
  public.apply_stripe_subscription_event(
    'evt_casey_first', 'customer.subscription.created', timestamptz '2026-08-04 12:04:00+00',
    '2025-07-30.basil', false,
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000012'),
    'cus_casey', 'sub_casey_first', 'price_hld_monthly', 'active',
    timestamptz '2026-08-04 12:04:00+00', timestamptz '2026-09-04 12:04:00+00',
    false, 'cs_casey_first', 'in_casey_first',
    timestamptz '2026-08-04 12:04:00+00', timestamptz '2026-08-04 12:05:00+00'
  ) = 'processed',
  'Casey subscription must populate an existing guarantee record'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');

select pg_temp.test_assert(
  (select count(*) = 3
   from public.instructor_profiles
   where account_id in (
     '00000000-0000-0000-0000-000000000010',
     '00000000-0000-0000-0000-000000000011',
     '00000000-0000-0000-0000-000000000012'
   ) and status = 'published'),
  'active memberships must publish all approved profiles'
);
select pg_temp.test_assert(
  (select founding_member_number = 1
      and founding_status = 'active'
      and guarantee_status = 'covered'
      and guarantee_started_at = timestamptz '2026-08-04 12:00:00+00'
      and guarantee_ends_at = timestamptz '2027-08-04 12:00:00+00'
      and claim_deadline_at = timestamptz '2027-09-03 12:00:00+00'
      and first_stripe_subscription_id = 'sub_alice_first'
   from public.instructor_guarantees guarantee
   join public.instructor_profiles profile on profile.id = guarantee.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'Alice founding guarantee snapshot must be complete and exact'
);
select pg_temp.test_assert(
  (select founding_member_number = 3 and guarantee_status = 'covered'
   from public.instructor_guarantees guarantee
   join public.instructor_profiles profile on profile.id = guarantee.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000012'),
  'an existing unassigned guarantee must receive the next founding position'
);

-- A restarted subscription must not reset the original guarantee clock or IDs.
set local role service_role;
select pg_temp.set_request(null, null, 'service_role');
select public.apply_stripe_subscription_event(
  'evt_alice_canceled', 'customer.subscription.deleted', timestamptz '2026-08-10 12:00:00+00',
  '2025-07-30.basil', false,
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
  'cus_alice', 'sub_alice_first', 'price_hld_monthly', 'canceled',
  timestamptz '2026-08-04 12:00:00+00', timestamptz '2026-09-03 12:00:00+00',
  false, null, 'in_alice_first',
  timestamptz '2026-08-04 12:00:00+00', timestamptz '2026-08-10 12:01:00+00'
);
select public.apply_stripe_subscription_event(
  'evt_alice_restart', 'customer.subscription.created', timestamptz '2026-08-20 12:00:00+00',
  '2025-07-30.basil', false,
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
  'cus_alice', 'sub_alice_restart', 'price_hld_monthly', 'active',
  timestamptz '2026-08-20 12:00:00+00', timestamptz '2026-09-20 12:00:00+00',
  false, 'cs_alice_restart', 'in_alice_restart',
  timestamptz '2026-08-20 12:00:00+00', timestamptz '2026-08-20 12:01:00+00'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select founding_member_number = 1
      and guarantee_started_at = timestamptz '2026-08-04 12:00:00+00'
      and first_stripe_customer_id = 'cus_alice'
      and first_stripe_subscription_id = 'sub_alice_first'
   from public.instructor_guarantees guarantee
   join public.instructor_profiles profile on profile.id = guarantee.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'a restarted subscription must preserve first-subscription guarantee terms'
);
select id as alice_profile_id
from public.instructor_profiles
where account_id = '00000000-0000-0000-0000-000000000010'
\gset
select id as bianca_profile_id
from public.instructor_profiles
where account_id = '00000000-0000-0000-0000-000000000011'
\gset

-- Only the owner can grant delegated admin access. Delegated admins can search
-- and review operations, but cannot mutate guarantee or refund records.
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  public.grant_marketplace_admin('delegate@example.test')
    = '00000000-0000-0000-0000-000000000002',
  'owner must be able to grant delegated admin access'
);

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000002',
  'delegate@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  (select count(*) = 1 from public.admin_search_instructors('Alice Refund', 100, 0)),
  'admin search must match instructor name'
);
select pg_temp.test_assert(
  (select count(*) = 1 from public.admin_search_instructors('alice@example.test', 100, 0)),
  'admin search must match account email'
);
select pg_temp.test_assert(
  (select count(*) = 1 from public.admin_search_instructors('Austin', 100, 0)),
  'admin search must match city'
);
select pg_temp.expect_error(
  format(
    'select public.admin_update_instructor_guarantee(%L::uuid, %L, %L, %L)',
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
    'active', 'covered', 'Delegated mutation attempt'
  ),
  'Marketplace owner access required',
  'delegated admin finance mutation'
);

-- A regular instructor cannot see admin finance tables or use admin search.
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000010',
  'alice@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  (select count(*) = 0 from public.instructor_guarantees),
  'RLS must hide guarantee records from instructors'
);
select pg_temp.expect_error(
  'select * from public.admin_search_instructors(null, 100, 0)',
  'Administrator access required',
  'regular user admin search'
);

-- Organizer inquiry submission creates exactly one email job. SMS recipient
-- data and SMS jobs remain absent. Static listings use the support inbox.
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000020',
  'organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  :'alice_profile_id'::uuid,
  'corporate-events', current_date + 30, time '18:00', 'America/Chicago',
  'Acme Hall', 'Austin', 'TX', '78701', 120, '$1,000-$2,000',
  'Beginner-friendly songs', true, true, 'Please teach for one hour.', null
) as alice_inquiry_id \gset
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select count(*) = 1
   from public.inquiry_notification_jobs job
   join public.inquiry_recipients recipient on recipient.id = job.inquiry_recipient_id
   where recipient.inquiry_id = :'alice_inquiry_id'::uuid
     and job.channel = 'email'
     and job.notification_type = 'new_inquiry'),
  'an instructor inquiry must enqueue one email'
);
select pg_temp.test_assert(
  (select recipient.delivered_to_email = 'alice@example.test'
      and recipient.delivered_to_phone_e164 is null
      and recipient.sms_delivery_status = 'not_requested'
   from public.inquiry_recipients recipient
   where recipient.inquiry_id = :'alice_inquiry_id'::uuid),
  'an instructor inquiry recipient must be email-only'
);
select pg_temp.test_assert(
  not exists (
    select 1
    from public.inquiry_notification_jobs job
    join public.inquiry_recipients recipient on recipient.id = job.inquiry_recipient_id
    where recipient.inquiry_id = :'alice_inquiry_id'::uuid
      and job.channel = 'sms'
  ),
  'an instructor inquiry must never enqueue SMS while paused'
);

set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000020',
  'organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  null, 'private-parties', current_date + 45, null, 'America/New_York',
  null, 'New York', 'NY', null, 50, null, null, null, null,
  'Concierge lifecycle test.', 'avery-cole-nashville-tn'
) as static_inquiry_id \gset
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select delivered_to_email = 'hello@hirelinedancers.com'
   from public.inquiry_recipients
   where inquiry_id = :'static_inquiry_id'::uuid),
  'an unclaimed static listing must deliver to the support inbox'
);
select pg_temp.test_assert(
  not exists (
    select 1
    from public.inquiry_notification_jobs job
    join public.inquiry_recipients recipient on recipient.id = job.inquiry_recipient_id
    where recipient.inquiry_id = :'static_inquiry_id'::uuid
      and job.channel = 'sms'
  ),
  'a static listing inquiry must also remain email-only'
);

-- An organizer outcome must not clear the instructor follow-up or fulfill the
-- guarantee. An instructor response clears the follow-up. Conflicting answers
-- resolve to disputed without counting as a qualifying booking.
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000020',
  'organizer@example.test',
  'authenticated'
);
select public.report_booking_outcome(
  :'alice_inquiry_id'::uuid, 'booked', 85000, 'Organizer believes it is booked'
);
select pg_temp.test_assert(
  (select booking_outcome = 'booked' and outcome_next_ask_at is not null
   from public.inquiries where id = :'alice_inquiry_id'::uuid),
  'organizer outcome must preserve the instructor follow-up date'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select guarantee_status = 'covered'
   from public.instructor_guarantees guarantee
   join public.instructor_profiles profile on profile.id = guarantee.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'organizer-only booking evidence must not fulfill the guarantee'
);

set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  (select qualifying_booking_count = 0
   from public.admin_search_instructors('alice@example.test', 100, 0)),
  'organizer-only booking evidence must not count as a qualifying booking'
);
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000010',
  'alice@example.test',
  'authenticated'
);
select public.report_booking_outcome(
  :'alice_inquiry_id'::uuid, 'not_booked', null, 'The client did not confirm'
);
select pg_temp.test_assert(
  (select booking_outcome = 'disputed' and outcome_next_ask_at is null
   from public.inquiries where id = :'alice_inquiry_id'::uuid),
  'instructor outcome must clear follow-up and preserve both parties evidence'
);

-- Due follow-ups enqueue only email. Submitting instructor feedback cancels the
-- queued reminder and leaves a non-booked guarantee covered.
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000020',
  'organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  :'alice_profile_id'::uuid,
  'fundraisers', current_date + 20, null, 'America/Chicago', null,
  'Austin', 'TX', null, 80, null, null, true, false,
  'Follow-up lifecycle test.', null
) as followup_inquiry_id \gset
reset role;
select pg_temp.set_request(null, null, 'postgres');
update public.inquiries
set outcome_next_ask_at = now() - interval '1 minute'
where id = :'followup_inquiry_id'::uuid;
set local role service_role;
select pg_temp.set_request(null, null, 'service_role');
select pg_temp.test_assert(
  public.enqueue_due_inquiry_followups() >= 1,
  'service worker must enqueue a due booking follow-up'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select count(*) = 1
   from public.inquiry_notification_jobs job
   join public.inquiry_recipients recipient on recipient.id = job.inquiry_recipient_id
   where recipient.inquiry_id = :'followup_inquiry_id'::uuid
     and job.channel = 'email'
     and job.notification_type = 'booking_followup'
     and job.status = 'pending'),
  'a due booking follow-up must be an email job'
);
select pg_temp.test_assert(
  not exists (
    select 1
    from public.inquiry_notification_jobs job
    join public.inquiry_recipients recipient on recipient.id = job.inquiry_recipient_id
    where recipient.inquiry_id = :'followup_inquiry_id'::uuid
      and job.channel = 'sms'
  ),
  'follow-up delivery must never enqueue SMS while paused'
);
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000010',
  'alice@example.test',
  'authenticated'
);
select public.submit_instructor_inquiry_feedback(
  :'followup_inquiry_id'::uuid, 'booking', 'still_deciding',
  'Waiting on the client.', null
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select status = 'canceled'
   from public.inquiry_notification_jobs job
   join public.inquiry_recipients recipient on recipient.id = job.inquiry_recipient_id
   where recipient.inquiry_id = :'followup_inquiry_id'::uuid
     and job.notification_type = 'booking_followup'),
  'instructor feedback must cancel a pending booking follow-up'
);

-- Instructor-confirmed bookings fulfill the guarantee and schedule a
-- completion check. Completion feedback records the event result and clears it.
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000020',
  'organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  :'bianca_profile_id'::uuid,
  'weddings', current_date, time '16:00', 'America/Los_Angeles',
  'Bay Hall', 'San Francisco', 'CA', '94103', 150, '$1,000-$2,000',
  'Two beginner dances', true, true, 'Wedding lifecycle test.', null
) as bianca_inquiry_id \gset
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000011',
  'bianca@example.test',
  'authenticated'
);
select public.submit_instructor_inquiry_feedback(
  :'bianca_inquiry_id'::uuid, 'booking', 'booked',
  'Contract signed.', current_date
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select booking_outcome = 'booked'
      and outcome_next_ask_at is null
      and booking_event_date = current_date
      and completion_next_ask_at is not null
   from public.inquiries where id = :'bianca_inquiry_id'::uuid),
  'instructor booking feedback must schedule completion tracking'
);
select pg_temp.test_assert(
  (select guarantee_status = 'fulfilled'
   from public.instructor_guarantees guarantee
   join public.instructor_profiles profile on profile.id = guarantee.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000011'),
  'instructor-confirmed booking must fulfill the guarantee'
);
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000011',
  'bianca@example.test',
  'authenticated'
);
select public.submit_instructor_inquiry_feedback(
  :'bianca_inquiry_id'::uuid, 'completion', 'completed',
  'The group had a great time.', null
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select completion_status = 'completed'
      and completion_reported_at is not null
      and completion_next_ask_at is null
   from public.inquiries where id = :'bianca_inquiry_id'::uuid),
  'completion feedback must close completion tracking'
);

-- Log, review, and verify Alice's manual guarantee refund. The database never
-- moves money. It records only a Stripe refund that the service has verified.
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select pg_temp.expect_error(
  format(
    'select public.admin_update_instructor_guarantee(%L::uuid, %L, %L, null)',
    :'alice_profile_id', 'active', 'refunded'
  ),
  'Refunded status requires a verified Stripe refund',
  'manual refunded guarantee status'
);
select public.admin_log_guarantee_claim(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
  'email', 'alice@example.test', 2998,
  'I did not receive a completed booking during the guarantee period.',
  'Owner will contact the instructor before deciding.'
) as alice_claim_id \gset
select pg_temp.test_assert(
  (select status = 'received' and qualifying_booking_count = 0
   from public.guarantee_claims where id = :'alice_claim_id'::uuid),
  'claim intake must snapshot zero qualifying bookings'
);
select public.admin_review_guarantee_claim(
  :'alice_claim_id'::uuid, 'in_review', false, false, false,
  null, 'Review started.', null
);
select pg_temp.expect_error(
  format(
    'select public.admin_review_guarantee_claim(%L::uuid, %L, false, true, true, 2998, null, null)',
    :'alice_claim_id', 'approved'
  ),
  'Confirm all guarantee requirements before approval',
  'claim approval without all confirmations'
);
select public.admin_review_guarantee_claim(
  :'alice_claim_id'::uuid, 'approved', true, true, true,
  2998, 'All requirements confirmed.', 'Approved under the founding guarantee.'
);
select pg_temp.test_assert(
  (select status = 'approved' and approved_refund_amount_cents = 2998
   from public.guarantee_claims where id = :'alice_claim_id'::uuid),
  'owner must be able to approve a fully reviewed claim'
);

-- Delegated admins cannot change claim decisions.
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000002',
  'delegate@example.test',
  'authenticated'
);
select pg_temp.expect_error(
  format(
    'select public.admin_review_guarantee_claim(%L::uuid, %L, true, true, true, 2998, null, null)',
    :'alice_claim_id', 'refund_pending'
  ),
  'Marketplace owner access required',
  'delegated admin claim decision'
);

-- Authenticated users have no direct execute privilege on the service refund
-- recorder, even if they know every argument.
select pg_temp.expect_error(
  format(
    'select public.apply_verified_membership_refund(%L::uuid, %L, %L, %L, %L, %L, 1499, %L, %L, now(), %L::uuid, null, null)',
    :'alice_claim_id', 're_forbidden', 'cus_alice', 'ch_forbidden',
    'pi_forbidden', 'in_forbidden', 'usd', 'succeeded',
    '00000000-0000-0000-0000-000000000001'
  ),
  'permission denied',
  'authenticated refund verification'
);

reset role;
select pg_temp.set_request(null, null, 'postgres');
set local role service_role;
select pg_temp.set_request(null, null, 'service_role');
select pg_temp.expect_error(
  format(
    'select public.apply_verified_membership_refund(%L::uuid, %L, %L, %L, %L, %L, 1499, %L, %L, now(), %L::uuid, null, null)',
    :'alice_claim_id', 're_wrongrecorder', 'cus_alice', 'ch_wrongrecorder',
    'pi_wrongrecorder', 'in_wrongrecorder', 'usd', 'succeeded',
    '00000000-0000-0000-0000-000000000002'
  ),
  'Refund recorder must be the marketplace owner',
  'non-owner refund recorder'
);
select pg_temp.expect_error(
  format(
    'select public.apply_verified_membership_refund(%L::uuid, %L, %L, %L, %L, %L, 1499, %L, %L, now(), %L::uuid, null, null)',
    :'alice_claim_id', 're_wrongcustomer', 'cus_someone_else', 'ch_wrongcustomer',
    'pi_wrongcustomer', 'in_wrongcustomer', 'usd', 'succeeded',
    '00000000-0000-0000-0000-000000000001'
  ),
  'Refund customer does not match this instructor',
  'wrong Stripe customer'
);

select public.apply_verified_membership_refund(
  :'alice_claim_id'::uuid, 're_alicepartial1', 'cus_alice',
  'ch_alice1', 'pi_alice1', 'in_alice1', 1499, 'usd', 'succeeded',
  timestamptz '2026-08-21 12:00:00+00',
  '00000000-0000-0000-0000-000000000001', 'evt_refund_alice1', null
) as first_refund_state \gset
select pg_temp.test_assert(
  :'first_refund_state' = 'partially_refunded',
  'first verified refund must leave a partial claim state'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select pg_temp.expect_error(
  format(
    'select public.admin_log_guarantee_claim(%L::uuid, %L, %L, 2998, null, null)',
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000010'),
    'email', 'alice@example.test'
  ),
  'A claim with a verified refund record cannot be reopened',
  'reopening a partially refunded claim'
);
select pg_temp.expect_error(
  format(
    'select public.admin_review_guarantee_claim(%L::uuid, %L, true, true, true, 2998, null, null)',
    :'alice_claim_id', 'refund_pending'
  ),
  'A claim with a verified refund record cannot be reviewed again',
  'reviewing a partially refunded claim'
);
select pg_temp.test_assert(
  (select status = 'partially_refunded'
   from public.guarantee_claims where id = :'alice_claim_id'::uuid),
  'rejected claim reopening must preserve the partial refund state'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
set local role service_role;
select pg_temp.set_request(null, null, 'service_role');
select public.apply_verified_membership_refund(
  :'alice_claim_id'::uuid, 're_alicepartial1', 'cus_alice',
  'ch_alice1', 'pi_alice1', 'in_alice1', 1499, 'usd', 'succeeded',
  timestamptz '2026-08-21 12:00:00+00',
  '00000000-0000-0000-0000-000000000001', 'evt_refund_alice1', null
) as duplicate_refund_state \gset
select pg_temp.test_assert(
  :'duplicate_refund_state' = 'partially_refunded'
    and (select count(*) = 1 from public.membership_refunds where guarantee_claim_id = :'alice_claim_id'::uuid)
    and (select count(*) = 1
         from public.membership_admin_events
         where guarantee_claim_id = :'alice_claim_id'::uuid
           and event_type = 'refund_verified'),
  'retrying the same verified refund must not duplicate refund records or audit events'
);
select pg_temp.expect_error(
  format(
    'select public.apply_verified_membership_refund(%L::uuid, %L, %L, %L, %L, %L, 1600, %L, %L, now(), %L::uuid, null, null)',
    :'alice_claim_id', 're_aliceoverage', 'cus_alice', 'ch_aliceoverage',
    'pi_aliceoverage', 'in_aliceoverage', 'usd', 'succeeded',
    '00000000-0000-0000-0000-000000000001'
  ),
  'Verified refunds cannot exceed the approved amount',
  'verified refund over approved total'
);
select public.apply_verified_membership_refund(
  :'alice_claim_id'::uuid, 're_alicepartial2', 'cus_alice',
  'ch_alice2', 'pi_alice2', 'in_alice2', 1499, 'usd', 'succeeded',
  timestamptz '2026-08-22 12:00:00+00',
  '00000000-0000-0000-0000-000000000001', 'evt_refund_alice2', null
) as final_refund_state \gset
select pg_temp.test_assert(
  :'final_refund_state' = 'refunded',
  'verified refunds meeting the approved total must close the claim'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');

select pg_temp.test_assert(
  (select status = 'refunded' and refunded_at is not null
   from public.guarantee_claims where id = :'alice_claim_id'::uuid),
  'completed refund must mark the claim refunded'
);
select pg_temp.test_assert(
  (select guarantee_status = 'refunded'
      and founding_status = 'ended'
      and founding_member_number = 1
      and refunded_at is not null
   from public.instructor_guarantees guarantee
   join public.instructor_profiles profile on profile.id = guarantee.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'completed refund must end benefits without erasing the founding number'
);
select pg_temp.test_assert(
  (select membership.status = 'active'
      and membership.stripe_subscription_id = 'sub_alice_restart'
   from public.instructor_memberships membership
   join public.instructor_profiles profile on profile.id = membership.instructor_profile_id
   where profile.account_id = '00000000-0000-0000-0000-000000000010'),
  'refund tracking must not cancel or rewrite Stripe membership status'
);

set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  (select refunded
      and verified_refund_cents = 2998
      and refund_count = 2
      and claim_status = 'refunded'
      and stripe_livemode is false
   from public.admin_search_instructors('alice@example.test', 100, 0)),
  'admin search must summarize refunds, claim state, and Stripe mode'
);
select pg_temp.expect_error(
  format(
    'select public.admin_update_instructor_guarantee(%L::uuid, %L, %L, null)',
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000012'),
    'unassigned', 'covered'
  ),
  'An assigned founding position cannot be removed',
  'removing an assigned founding position'
);

-- Lifetime access is independent from Stripe and may be granted only through
-- the protected admin or invitation workflows.
reset role;
select pg_temp.set_request(null, null, 'postgres');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000013', 'lifetime-invite@example.test', '{"full_name":"Lena Lifetime"}'),
  ('00000000-0000-0000-0000-000000000014', 'lifetime-admin@example.test', '{"full_name":"Gina Grant"}');

set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000014',
  'lifetime-admin@example.test',
  'authenticated'
);
select public.complete_account_onboarding(
  'instructor', 'Gina Grant', 'Grant Dance Co.', null, false
);
update public.instructor_profiles
set city = 'Denver', region = 'CO', status = 'pending_review'
where account_id = '00000000-0000-0000-0000-000000000014';

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000030',
  'outsider@example.test',
  'authenticated'
);
select pg_temp.expect_error(
  format(
    'select public.admin_grant_instructor_lifetime_access(%L::uuid, null)',
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000014')
  ),
  'Administrator access required',
  'regular user lifetime grant'
);
select pg_temp.expect_error(
  format(
    'insert into public.instructor_lifetime_access (instructor_profile_id, source, granted_by) values (%L::uuid, %L, %L::uuid)',
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000014'),
    'admin',
    '00000000-0000-0000-0000-000000000030'
  ),
  'row-level security',
  'direct lifetime access insert'
);

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  public.admin_grant_instructor_lifetime_access(
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000014'),
    'Lifecycle admin grant'
  ),
  'an administrator must be able to grant lifetime access'
);
select public.review_instructor_profile(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000014'),
  'approve', 'gina-grant-denver-co', 'Lifetime profile approval'
);
select pg_temp.test_assert(
  (select status = 'published'
   from public.instructor_profiles
   where account_id = '00000000-0000-0000-0000-000000000014'),
  'approval must publish an admin-granted lifetime profile without Stripe'
);

reset role;
select pg_temp.set_request(null, null, 'postgres');
insert into public.instructor_invitations (
  email,
  token_hash,
  request_key,
  grants_lifetime_access,
  status,
  invited_by,
  sent_at
) values (
  'lifetime-invite@example.test',
  repeat('a', 64),
  'lifetime-invite-lifecycle',
  true,
  'sent',
  '00000000-0000-0000-0000-000000000001',
  now()
);

set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000013',
  'lifetime-invite@example.test',
  'authenticated'
);
select pg_temp.test_assert(
  public.accept_instructor_invitation(
    repeat('a', 64), 'Lena Lifetime', 'Lifetime Line Dance'
  ),
  'accepting a lifetime invitation must return active lifetime access'
);
select pg_temp.test_assert(
  (select account.role = 'instructor'
      and profile.status = 'draft'
   from public.accounts account
   join public.instructor_profiles profile on profile.account_id = account.id
   where account.id = '00000000-0000-0000-0000-000000000013'),
  'invitation acceptance must onboard the instructor with a draft profile'
);
select pg_temp.test_assert(
  public.current_instructor_lifetime_access(),
  'the signed-in instructor lifetime status check must return true'
);
select pg_temp.test_assert(
  public.accept_instructor_invitation(
    repeat('a', 64), 'Lena Lifetime', 'Lifetime Line Dance'
  ),
  'accepted invitation claims must be idempotent for the same instructor'
);

reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select access.source = 'invitation'
   from public.instructor_profiles profile
   join public.instructor_lifetime_access access
     on access.instructor_profile_id = profile.id
   where profile.account_id = '00000000-0000-0000-0000-000000000013'),
  'invitation acceptance must record invitation-sourced lifetime access'
);
insert into public.instructor_invitations (
  email, token_hash, request_key, grants_lifetime_access, status, invited_by, sent_at
) values (
  'another-instructor@example.test', repeat('b', 64), 'wrong-email-lifecycle',
  false, 'sent', '00000000-0000-0000-0000-000000000001', now()
);
insert into public.instructor_invitations (
  email, token_hash, request_key, grants_lifetime_access, status, invited_by,
  created_at, expires_at, sent_at
) values (
  'lifetime-invite@example.test', repeat('c', 64), 'expired-invite-lifecycle',
  false, 'sent', '00000000-0000-0000-0000-000000000001',
  now() - interval '2 days', now() - interval '1 day', now() - interval '2 days'
);
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000013',
  'lifetime-invite@example.test',
  'authenticated'
);
select pg_temp.expect_error(
  'select public.accept_instructor_invitation(repeat(''b'', 64), ''Lena Lifetime'', null)',
  'Sign in with the email address',
  'invitation email mismatch'
);
select pg_temp.expect_error(
  'select public.accept_instructor_invitation(repeat(''c'', 64), ''Lena Lifetime'', null)',
  'invitation has expired',
  'expired instructor invitation'
);

select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
update public.instructor_profiles
set city = 'Raleigh', region = 'NC', status = 'pending_review'
where account_id = '00000000-0000-0000-0000-000000000013';
select public.review_instructor_profile(
  (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000013'),
  'approve', 'lena-lifetime-raleigh-nc', 'Invited lifetime approval'
);
select pg_temp.test_assert(
  (select status = 'published'
   from public.instructor_profiles
   where account_id = '00000000-0000-0000-0000-000000000013'),
  'approval must publish an invitation-granted lifetime profile without Stripe'
);

reset role;
select pg_temp.set_request(null, null, 'postgres');
set local role service_role;
select pg_temp.set_request(null, null, 'service_role');
select (public.create_instructor_invitation(
  'replacement@example.test', repeat('d', 64), 'replacement-first', false,
  '00000000-0000-0000-0000-000000000001', now() + interval '30 days'
)).id as replacement_first_id \gset
select (public.create_instructor_invitation(
  'replacement@example.test', repeat('e', 64), 'replacement-second', true,
  '00000000-0000-0000-0000-000000000001', now() + interval '30 days'
)).id as replacement_second_id \gset
select pg_temp.test_assert(
  (select first.status = 'revoked' and second.status = 'pending'
   from public.instructor_invitations first
   join public.instructor_invitations second on second.id = :'replacement_second_id'::uuid
   where first.id = :'replacement_first_id'::uuid),
  'a newer invitation must atomically revoke the prior open invitation'
);
select pg_temp.test_assert(
  public.apply_stripe_subscription_event(
    'evt_lifetime_canceled', 'customer.subscription.deleted', timestamptz '2026-08-25 12:00:00+00',
    '2025-07-30.basil', false,
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000013'),
    'cus_lifetime_ignored', 'sub_lifetime_ignored', 'price_hld_monthly', 'canceled',
    timestamptz '2026-08-01 12:00:00+00', timestamptz '2026-08-25 12:00:00+00',
    false, null, null,
    timestamptz '2026-08-01 12:00:00+00', timestamptz '2026-08-25 12:01:00+00'
  ) = 'lifetime_access_ignored',
  'Stripe cancellation events must be ignored for lifetime profiles'
);
select pg_temp.test_assert(
  not public.register_instructor_checkout_attempt(
    (select id from public.instructor_profiles where account_id = '00000000-0000-0000-0000-000000000013'),
    'lifetime-checkout-block', 'cs_lifetime_block', 'cus_lifetime_block',
    'price_hld_monthly', 'https://checkout.stripe.test/lifetime-block', now() + interval '1 hour'
  ),
  'checkout registration must reject lifetime access after the final server check'
);
reset role;
select pg_temp.set_request(null, null, 'postgres');
select pg_temp.test_assert(
  (select status = 'published'
      and not exists (
        select 1 from public.instructor_memberships membership
        where membership.instructor_profile_id = profile.id
      )
   from public.instructor_profiles profile
   where profile.account_id = '00000000-0000-0000-0000-000000000013'),
  'a canceled Stripe event cannot unpublish or create billing for lifetime access'
);

-- Founding positions stop at 100 and are never reused when benefits end. The
-- ninety-eighth bulk fixture is marketplace member 101 because three positions
-- were already assigned above.
reset role;
select pg_temp.set_request(null, null, 'postgres');
insert into auth.users (id, email, raw_user_meta_data)
select
  format('10000000-0000-0000-0000-%s', lpad(series::text, 12, '0'))::uuid,
  format('bulk-founder-%s@example.test', series),
  jsonb_build_object('full_name', format('Bulk Founder %s', series))
from generate_series(1, 98) series
order by series;

update public.accounts
set role = 'instructor', onboarding_completed_at = now()
where email like 'bulk-founder-%@example.test';

insert into public.instructor_profiles (
  account_id, display_name, status, approved_at
)
select
  account.id,
  account.full_name,
  'approved',
  now()
from public.accounts account
where account.email like 'bulk-founder-%@example.test'
order by account.email;

insert into public.instructor_memberships (
  instructor_profile_id,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_price_id,
  status,
  stripe_created_at
)
select
  profile.id,
  'cus_bulk_' || row_number() over (order by account.email),
  'sub_bulk_' || row_number() over (order by account.email),
  'price_hld_monthly',
  'active',
  timestamptz '2026-08-05 00:00:00+00'
    + row_number() over (order by account.email) * interval '1 second'
from public.instructor_profiles profile
join public.accounts account on account.id = profile.account_id
where account.email like 'bulk-founder-%@example.test'
order by account.email;

select pg_temp.test_assert(
  (select count(*) = 100
   from public.instructor_guarantees
   where founding_member_number is not null),
  'exactly 100 permanent founding positions may be assigned'
);
select pg_temp.test_assert(
  (select count(*) = 1
   from public.instructor_guarantees
   where founding_member_number is null
     and founding_status = 'not_available'
     and guarantee_status = 'ineligible'),
  'marketplace member 101 must not receive founding guarantee coverage'
);
select pg_temp.test_assert(
  (select count(distinct founding_member_number) = 100
   from public.instructor_guarantees
   where founding_member_number is not null),
  'founding member numbers must remain unique at the boundary'
);

-- Revocation immediately removes delegated admin search and finance visibility.
set local role authenticated;
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000001',
  'owner@example.test',
  'authenticated'
);
select public.revoke_marketplace_admin('00000000-0000-0000-0000-000000000002');
select pg_temp.set_request(
  '00000000-0000-0000-0000-000000000002',
  'delegate@example.test',
  'authenticated'
);
select pg_temp.expect_error(
  'select * from public.admin_search_instructors(null, 100, 0)',
  'Administrator access required',
  'revoked admin search'
);
select pg_temp.test_assert(
  (select count(*) = 0 from public.guarantee_claims),
  'revoked admin RLS must hide guarantee claims'
);

-- Anonymous callers do not receive execute permission for admin operations.
reset role;
select pg_temp.set_request(null, null, 'postgres');
set local role anon;
select pg_temp.set_request(null, null, 'anon');
select pg_temp.expect_error(
  'select * from public.admin_search_instructors(null, 100, 0)',
  'permission denied',
  'anonymous admin search'
);

reset role;
select pg_temp.set_request(null, null, 'postgres');
select 'marketplace lifecycle passed' as result;
rollback;
