\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.referral_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Referral assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.referral_expect_error(p_statement text, p_fragment text, p_label text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_statement;
  exception when others then
    if position(p_fragment in sqlerrm) = 0 then
      raise exception 'Expected error for %, got: %', p_label, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected an error for %, but the statement succeeded', p_label;
end;
$$;

create or replace function pg_temp.referral_as(p_account_id uuid, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_account_id::text, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_account_id, 'role', p_role)::text, true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('50000000-0000-0000-0000-000000000001', 'ref-admin@example.test', '{"full_name":"Ref Admin"}'),
  ('50000000-0000-0000-0000-000000000010', 'tay@example.test', '{"full_name":"Tay Rivers"}'),
  ('50000000-0000-0000-0000-000000000011', 'tay2@example.test', '{"full_name":"Tay Second"}'),
  ('50000000-0000-0000-0000-000000000020', 'maria@example.test', '{"full_name":"Maria Lopez"}'),
  ('50000000-0000-0000-0000-000000000030', 'old@example.test', '{"full_name":"Old Timer"}'),
  ('50000000-0000-0000-0000-000000000040', 'planner@example.test', '{"full_name":"Pat Planner"}'),
  ('50000000-0000-0000-0000-000000000050', 'late@example.test', '{"full_name":"Late Joiner"}');

update public.accounts
set role = case
      when id = '50000000-0000-0000-0000-000000000001' then 'admin'
      when id = '50000000-0000-0000-0000-000000000040' then 'organizer'
      else 'instructor'
    end,
    onboarding_completed_at = now()
where id::text like '50000000-%';
update public.accounts set created_at = now() - interval '60 days'
where id = '50000000-0000-0000-0000-000000000030';
update public.accounts set created_at = timestamptz '2027-02-01T05:00:00Z'
where id = '50000000-0000-0000-0000-000000000050';
update public.accounts set created_at = now() - interval '3 days'
where id = '50000000-0000-0000-0000-000000000020';

insert into public.marketplace_admins (account_id, is_owner, granted_by)
values ('50000000-0000-0000-0000-000000000001', true, '50000000-0000-0000-0000-000000000001');

insert into public.instructor_profiles (id, account_id, slug, status, display_name, city, region, event_types, published_at)
values
  ('60000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000010', 'tay-test', 'published', 'Dancing with Tay', 'Austin', 'TX', array['weddings'], now()),
  ('60000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000020', 'maria-test', 'published', 'Maria Lopez', 'Austin', 'TX', array['weddings'], now());

-- Grants: workers only for the service role, lookups for everyone.
select pg_temp.referral_assert(
  has_function_privilege('anon', 'public.lookup_referral_code(text)', 'execute')
  and has_function_privilege('anon', 'public.record_referral_visit(text)', 'execute')
  and not has_function_privilege('anon', 'public.create_my_referral_code()', 'execute')
  and not has_function_privilege('anon', 'public.get_my_referral_program()', 'execute')
  and not has_function_privilege('authenticated', 'public.referral_claim_due_payouts(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.referral_record_payout(uuid, text, integer)', 'execute')
  and has_function_privilege('service_role', 'public.referral_claim_due_payouts(integer)', 'execute'),
  'function grants'
);

-- Organizers cannot create codes.
set local role authenticated;
select pg_temp.referral_as('50000000-0000-0000-0000-000000000040', 'authenticated');
select pg_temp.referral_expect_error('select public.create_my_referral_code()', 'instructor accounts', 'organizer code');
select pg_temp.referral_expect_error('select public.get_my_referral_program()', 'instructor accounts', 'organizer program');

-- Instructors get first name plus two digits, and the same code every time.
select pg_temp.referral_as('50000000-0000-0000-0000-000000000010', 'authenticated');
select public.create_my_referral_code() as tay_code \gset
select pg_temp.referral_assert(:'tay_code' ~ '^TAY[0-9]{2}$', 'code format is first name plus two digits');
select pg_temp.referral_assert(public.create_my_referral_code() = :'tay_code', 'code is stable');
select pg_temp.referral_expect_error(
  $sql$insert into public.referral_codes (account_id, code) values ('50000000-0000-0000-0000-000000000010', 'TAY00')$sql$,
  'permission denied', 'direct code insert'
);

select pg_temp.referral_as('50000000-0000-0000-0000-000000000011', 'authenticated');
select public.create_my_referral_code() as tay2_code \gset
select pg_temp.referral_assert(:'tay2_code' ~ '^TAY[0-9]{2}$' and :'tay2_code' <> :'tay_code', 'same first name gets distinct digits');

-- Anyone can look up a code and count a visit.
set local role anon;
select pg_temp.referral_as(null, 'anon');
select pg_temp.referral_assert(
  (select referrer_name from public.lookup_referral_code(lower(:'tay_code'))) = 'Dancing with Tay',
  'lookup is case insensitive and shows the published name'
);
select pg_temp.referral_assert(not exists (select 1 from public.lookup_referral_code('NOPE11')), 'unknown code');
select public.record_referral_visit(:'tay_code');
select pg_temp.referral_expect_error('select count(*) from public.referral_codes', 'permission denied', 'anon reads codes');

-- Attach rules.
set local role authenticated;
select pg_temp.referral_as('50000000-0000-0000-0000-000000000010', 'authenticated');
select pg_temp.referral_expect_error(format('select public.attach_referral_code(%L)', :'tay_code'), 'own referral code', 'self referral');
select pg_temp.referral_as('50000000-0000-0000-0000-000000000030', 'authenticated');
select pg_temp.referral_expect_error(format('select public.attach_referral_code(%L)', :'tay_code'), 'within 30 days', 'old account');
select pg_temp.referral_as('50000000-0000-0000-0000-000000000050', 'authenticated');
select pg_temp.referral_expect_error(format('select public.attach_referral_code(%L)', :'tay_code'), 'joined by January 31, 2027', 'joined after the cutoff');
select pg_temp.referral_assert((public.get_my_referral_program() ->> 'can_add_referral')::boolean = false, 'late joiners cannot add a code');
select pg_temp.referral_as('50000000-0000-0000-0000-000000000020', 'authenticated');
select pg_temp.referral_expect_error($sql$select public.attach_referral_code('ZZZ99')$sql$, 'not found', 'unknown code attach');
select pg_temp.referral_assert(public.attach_referral_code(:'tay_code', 'link') = 'Dancing with Tay', 'attach returns referrer name');
select pg_temp.referral_expect_error(format('select public.attach_referral_code(%L)', :'tay2_code'), 'already saved', 'second attach');
select pg_temp.referral_assert(
  (select referred_joined_at = now() - interval '3 days' and earning_ends_at = now() - interval '3 days' + interval '1 year'
   from public.instructor_referrals where referred_account_id = '50000000-0000-0000-0000-000000000020'),
  'earning window is exactly one year from the join date'
);
select pg_temp.referral_assert(
  (public.get_my_referral_program() -> 'referred_by' ->> 'code') = :'tay_code'
  and (public.get_my_referral_program() ->> 'can_add_referral')::boolean = false,
  'referred instructor sees who referred them'
);

-- Referrer program view.
select pg_temp.referral_as('50000000-0000-0000-0000-000000000010', 'authenticated');
select public.get_my_referral_program() as tay_program \gset
select pg_temp.referral_assert(
  (:'tay_program'::jsonb ->> 'code') = :'tay_code'
  and (:'tay_program'::jsonb ->> 'link_visits')::integer = 1
  and jsonb_array_length(:'tay_program'::jsonb -> 'referrals') = 1
  and (:'tay_program'::jsonb -> 'referrals' -> 0 ->> 'name') = 'Maria Lopez',
  'referrer sees code, visits, and referred instructor'
);
select pg_temp.referral_assert(
  (select count(*) from public.instructor_referrals) = 1,
  'referrer can read their referral row'
);
select pg_temp.referral_as('50000000-0000-0000-0000-000000000011', 'authenticated');
select pg_temp.referral_assert((select count(*) from public.instructor_referrals) = 0, 'others cannot read referrals');

-- A paid booking for the referred instructor, then the payout.
reset role;
-- Bare inquiry and thread rows; their participant triggers are out of scope here.
set local session_replication_role = replica;
insert into public.inquiries (id, name, email) values ('70000000-0000-0000-0000-000000000001', 'Pat Planner', 'planner@example.test');
insert into public.inquiry_threads (id, inquiry_id) values ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001');
insert into public.bookings (
  id, thread_id, inquiry_id, instructor_profile_id, instructor_account_id, organizer_account_id, status,
  event_date, start_time, end_time, time_zone, event_starts_at, event_ends_at, venue_address, service_description,
  pricing_mode, hourly_rate_cents, hours, cancellation_policy, cancellation_windows, insurance_choice,
  instructor_fee_bps, client_fee_bps, price_cents, client_fee_cents, total_cents, platform_fee_cents, instructor_payout_cents,
  agreement_version, agreement_text, agreement_sha256, expires_at,
  stripe_charge_id, paid_at, payout_due_at
) values (
  '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000020', '50000000-0000-0000-0000-000000000040', 'completed',
  current_date - 2, '18:00', '20:00', 'America/Chicago', now() - interval '50 hours', now() - interval '48 hours',
  '100 Congress Ave, Austin, TX 78701', 'Two hours of beginner line dance instruction.',
  'hourly', 20000, 2, 'standard', private.standard_cancellation_windows(), 'instructor_handles_outside_agreement',
  1500, 500, 40000, 2000, 42000, 6000, 34000,
  '2026-10-26-booking-agreement-v2', repeat('Booking agreement text. ', 20), repeat('a', 64), now(),
  'ch_test_referral', now(), now() - interval '24 hours'
);
set local session_replication_role = origin;

-- Pending estimate before payout: 30% of $80 = $24.
set local role authenticated;
select pg_temp.referral_as('50000000-0000-0000-0000-000000000010', 'authenticated');
select pg_temp.referral_assert(
  (public.get_my_referral_program() -> 'referrals' -> 0 ->> 'pending_cents')::integer = 2400
  and (public.get_my_referral_program() -> 'referrals' -> 0 ->> 'bookings')::integer = 1,
  'pending estimate is 30% of platform revenue'
);

-- Instructor payout creates the referral earning.
reset role;
insert into public.instructor_payout_accounts (instructor_profile_id, stripe_account_id, livemode, details_submitted, payouts_enabled, transfers_capability)
values ('60000000-0000-0000-0000-000000000020', 'acct_mariatest', false, true, true, 'active');
select pg_temp.referral_as(null, 'service_role');
select * from public.booking_claim_due_transfers(10) \gset claimed_
select public.booking_record_transfer('72000000-0000-0000-0000-000000000001', 'tr_instructor1', 34000);
select pg_temp.referral_assert(
  (select amount_cents = 2400 and platform_revenue_cents = 8000 and status = 'due'
   from public.referral_earnings where booking_id = '72000000-0000-0000-0000-000000000001'),
  'earning recorded at 30% of $80'
);

-- No payout account yet: nothing to claim.
select pg_temp.referral_assert(not exists (select 1 from public.referral_claim_due_payouts(10)), 'referrer without payouts waits');

insert into public.instructor_payout_accounts (instructor_profile_id, stripe_account_id, livemode, details_submitted, payouts_enabled, transfers_capability)
values ('60000000-0000-0000-0000-000000000010', 'acct_taytest', false, true, true, 'active');

select * from public.referral_claim_due_payouts(10) \gset ref_
select pg_temp.referral_assert(
  :'ref_amount_cents'::integer = 2400 and :'ref_stripe_account_id' = 'acct_taytest' and :'ref_stripe_charge_id' = 'ch_test_referral',
  'claim returns referrer payout details'
);
select pg_temp.referral_expect_error(
  format('select public.referral_record_payout(%L, %L, 999)', :'ref_earning_id', 'tr_ref1'),
  'does not match', 'wrong amount'
);
select public.referral_record_payout(:'ref_earning_id'::uuid, 'tr_ref1', 2400);
select public.referral_record_payout(:'ref_earning_id'::uuid, 'tr_ref1', 2400);
select pg_temp.referral_assert(
  (select status = 'paid' and stripe_transfer_id = 'tr_ref1' from public.referral_earnings where id = :'ref_earning_id'::uuid),
  'payout recorded once'
);
select pg_temp.referral_assert(not exists (select 1 from public.referral_claim_due_payouts(10)), 'paid earnings are not reclaimed');

set local role authenticated;
select pg_temp.referral_as('50000000-0000-0000-0000-000000000010', 'authenticated');
select pg_temp.referral_assert(
  (public.get_my_referral_program() -> 'referrals' -> 0 ->> 'earned_cents')::integer = 2400
  and (public.get_my_referral_program() -> 'referrals' -> 0 ->> 'pending_cents')::integer = 0
  and (public.get_my_referral_program() ->> 'payouts_ready')::boolean,
  'program shows paid earnings'
);
select pg_temp.referral_expect_error('select public.admin_list_referral_program()', 'Administrator', 'non-admin list');

-- Admin view and corrections.
select pg_temp.referral_as('50000000-0000-0000-0000-000000000001', 'authenticated');
select public.admin_list_referral_program() as admin_view \gset
select pg_temp.referral_assert(
  (:'admin_view'::jsonb -> 'totals' ->> 'paid_cents')::integer = 2400
  and (:'admin_view'::jsonb -> 'totals' ->> 'referred')::integer = 1
  and jsonb_array_length(:'admin_view'::jsonb -> 'signups') = 1,
  'admin totals'
);
select pg_temp.referral_expect_error(
  format('select public.admin_set_instructor_referral(%L, %L)', '50000000-0000-0000-0000-000000000020', :'tay2_code'),
  'cannot be moved', 'move referral with earnings'
);
select pg_temp.referral_expect_error(
  format('select public.admin_set_instructor_referral(%L, %L)', '50000000-0000-0000-0000-000000000050', :'tay2_code'),
  'joined by January 31, 2027', 'admin attach after the cutoff'
);
select public.admin_set_instructor_referral('50000000-0000-0000-0000-000000000030', :'tay2_code');
select pg_temp.referral_assert(
  (select earning_ends_at = now() - interval '60 days' + interval '12 months'
   from public.instructor_referrals where referred_account_id = '50000000-0000-0000-0000-000000000030'),
  'admin-set referral also runs one year from the join date'
);
select pg_temp.referral_assert(
  (select source = 'admin' and code = :'tay2_code' from public.instructor_referrals where referred_account_id = '50000000-0000-0000-0000-000000000030'),
  'admin can attach an older instructor'
);
select public.admin_set_instructor_referral('50000000-0000-0000-0000-000000000030', null);
select pg_temp.referral_assert(
  not exists (select 1 from public.instructor_referrals where referred_account_id = '50000000-0000-0000-0000-000000000030'),
  'admin can clear a referral without earnings'
);
select public.admin_set_referral_code_disabled('50000000-0000-0000-0000-000000000011', true);
set local role anon;
select pg_temp.referral_as(null, 'anon');
select pg_temp.referral_assert(not exists (select 1 from public.lookup_referral_code(:'tay2_code')), 'disabled codes do not resolve');

rollback;
