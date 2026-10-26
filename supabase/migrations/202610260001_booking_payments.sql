-- Booking payments: Hire Line Dancers moves from a monthly instructor
-- membership to a per-booking commission.
--
--   * Instructors join free. Every instructor profile receives no-fee access
--     (source 'commission') through the existing lifetime-access workflow, so
--     submission, approval, and publishing no longer require Stripe billing.
--   * Instructors send a signed booking agreement (a quote) from a message
--     thread. The organizer signs, then pays in full through Stripe Checkout.
--     The agreement takes effect only when payment succeeds.
--   * The organizer pays the instructor price plus a 5 percent service fee.
--     The instructor receives the price minus a 15 percent platform fee,
--     paid by Stripe Connect transfer 24 hours after the event ends unless the
--     organizer reports a problem.
--   * Every milestone posts a system message in the thread and emails both
--     participants.
--   * Contact details in messages are hidden until a booking is paid.
--
-- Money movement happens in Edge Functions with the service role. This
-- migration owns the durable state, the invariants, and the milestone log.

-- ---------------------------------------------------------------------------
-- No-fee instructor access
-- ---------------------------------------------------------------------------

alter table public.instructor_lifetime_access
  drop constraint if exists instructor_lifetime_access_source_check;
alter table public.instructor_lifetime_access
  add constraint instructor_lifetime_access_source_check
  check (source in ('admin', 'invitation', 'commission'));

alter table public.instructor_lifetime_access
  drop constraint if exists instructor_lifetime_access_source_invitation_check;
alter table public.instructor_lifetime_access
  add constraint instructor_lifetime_access_source_invitation_check check (
    (source = 'invitation' and invitation_id is not null)
    or (source in ('admin', 'commission') and invitation_id is null)
  );

create or replace function private.grant_commission_instructor_access(
  p_instructor_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_account_id uuid;
begin
  select account_id into profile_account_id
  from public.instructor_profiles
  where id = p_instructor_profile_id;
  if profile_account_id is null then
    return false;
  end if;

  insert into public.instructor_lifetime_access (
    instructor_profile_id,
    source,
    granted_by,
    note
  ) values (
    p_instructor_profile_id,
    'commission',
    profile_account_id,
    'Commission booking model: no instructor membership fee.'
  )
  on conflict (instructor_profile_id) do nothing;
  return true;
exception
  when others then
    -- A profile that already completed paid membership activation keeps its
    -- membership until an administrator cancels it in Stripe.
    raise warning 'Commission access was not granted to %: %',
      p_instructor_profile_id, sqlerrm;
    return false;
end;
$$;

create or replace function public.grant_commission_access_to_new_instructor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Tests that exercise the legacy membership workflow turn this off for
  -- their own transaction.
  if coalesce(current_setting('hire_line_dancers.commission_access', true), '') = 'off' then
    return new;
  end if;
  perform private.grant_commission_instructor_access(new.id);
  return new;
end;
$$;

drop trigger if exists grant_commission_access_to_new_instructor
  on public.instructor_profiles;
create trigger grant_commission_access_to_new_instructor
  after insert on public.instructor_profiles
  for each row execute function public.grant_commission_access_to_new_instructor();

do $$
declare
  profile_row record;
begin
  for profile_row in
    select profile.id
    from public.instructor_profiles profile
    where not exists (
      select 1
      from public.instructor_lifetime_access access
      where access.instructor_profile_id = profile.id
    )
    order by profile.created_at, profile.id
  loop
    perform private.grant_commission_instructor_access(profile_row.id);
  end loop;
end;
$$;

revoke all on function private.grant_commission_instructor_access(uuid)
  from public, anon, authenticated;
revoke all on function public.grant_commission_access_to_new_instructor()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Instructor booking preferences
-- ---------------------------------------------------------------------------

-- A cancellation schedule is an array of windows ordered from the earliest
-- cancellation to the latest:
--   [{"minDaysBeforeEvent": 30, "refundPercent": 100},
--    {"minDaysBeforeEvent": 7, "refundPercent": 50}]
-- A cancellation at least minDaysBeforeEvent days before the event start
-- refunds refundPercent of the instructor price. A later cancellation that
-- matches no window refunds nothing.
create or replace function private.valid_cancellation_windows(p_windows jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  window_count integer;
  item jsonb;
  previous_days integer := null;
  previous_percent integer := null;
  days integer;
  percent integer;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    return false;
  end if;
  window_count := jsonb_array_length(p_windows);
  if window_count < 1 or window_count > 3 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(p_windows)
  loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'minDaysBeforeEvent') <> 'number'
      or jsonb_typeof(item -> 'refundPercent') <> 'number'
      or (select count(*) from jsonb_object_keys(item)) <> 2 then
      return false;
    end if;
    if (item ->> 'minDaysBeforeEvent') !~ '^[0-9]+$'
      or (item ->> 'refundPercent') !~ '^[0-9]+$' then
      return false;
    end if;
    days := (item ->> 'minDaysBeforeEvent')::integer;
    percent := (item ->> 'refundPercent')::integer;
    if days < 0 or days > 365 or percent < 0 or percent > 100 then
      return false;
    end if;
    if previous_days is not null
      and (days >= previous_days or percent > previous_percent) then
      return false;
    end if;
    previous_days := days;
    previous_percent := percent;
  end loop;
  return true;
end;
$$;

create or replace function private.standard_cancellation_windows()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[{"minDaysBeforeEvent": 30, "refundPercent": 100}, {"minDaysBeforeEvent": 7, "refundPercent": 50}]'::jsonb
$$;

alter table public.instructor_private_settings
  add column if not exists hourly_rate_cents integer,
  add column if not exists default_cancellation_policy text not null default 'standard',
  add column if not exists custom_cancellation_windows jsonb;

alter table public.instructor_private_settings
  drop constraint if exists instructor_private_hourly_rate_check;
alter table public.instructor_private_settings
  add constraint instructor_private_hourly_rate_check check (
    hourly_rate_cents is null or hourly_rate_cents between 1000 and 500000
  );
alter table public.instructor_private_settings
  drop constraint if exists instructor_private_cancellation_policy_check;
alter table public.instructor_private_settings
  add constraint instructor_private_cancellation_policy_check check (
    default_cancellation_policy in ('standard', 'custom')
    and (
      custom_cancellation_windows is null
      or private.valid_cancellation_windows(custom_cancellation_windows)
    )
    and (
      default_cancellation_policy = 'standard'
      or custom_cancellation_windows is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Stripe Connect payout accounts
-- ---------------------------------------------------------------------------

create table public.instructor_payout_accounts (
  instructor_profile_id uuid primary key
    references public.instructor_profiles(id) on delete restrict,
  stripe_account_id text not null unique,
  livemode boolean not null,
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  transfers_capability text not null default 'inactive',
  requirements_currently_due text[] not null default '{}',
  requirements_disabled_reason text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_payout_accounts_stripe_id_check check (
    stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ),
  constraint instructor_payout_accounts_capability_check check (
    transfers_capability in ('inactive', 'pending', 'active', 'unrequested')
  )
);

create or replace function private.instructor_payouts_ready(
  p_instructor_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.instructor_payout_accounts account
    where account.instructor_profile_id = p_instructor_profile_id
      and account.details_submitted
      and account.payouts_enabled
      and account.transfers_capability = 'active'
  )
$$;

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.inquiry_threads(id) on delete restrict,
  inquiry_id uuid not null references public.inquiries(id) on delete restrict,
  instructor_profile_id uuid not null
    references public.instructor_profiles(id) on delete restrict,
  instructor_account_id uuid not null references public.accounts(id) on delete restrict,
  organizer_account_id uuid not null references public.accounts(id) on delete restrict,
  status text not null default 'quote_sent',
  version smallint not null default 1,
  replaces_booking_id uuid references public.bookings(id) on delete set null,

  -- Agreement fields chosen by the instructor.
  event_date date not null,
  start_time time not null,
  end_time time not null,
  time_zone text not null,
  event_starts_at timestamptz not null,
  event_ends_at timestamptz not null,
  venue_name text,
  venue_address text not null,
  service_description text not null,
  pricing_mode text not null,
  hourly_rate_cents integer,
  hours numeric(4, 2),
  flat_price_cents integer,
  travel_fee_cents integer not null default 0,
  provides_speakers boolean not null default false,
  provides_microphone boolean not null default false,
  cancellation_policy text not null,
  cancellation_windows jsonb not null,
  insurance_choice text not null,

  -- Money. price_cents is the instructor price including travel.
  currency text not null default 'usd',
  instructor_fee_bps integer not null,
  client_fee_bps integer not null,
  price_cents integer not null,
  client_fee_cents integer not null,
  total_cents integer not null,
  platform_fee_cents integer not null,
  instructor_payout_cents integer not null,

  -- The exact agreement both parties sign.
  agreement_version text not null,
  agreement_text text not null,
  agreement_sha256 text not null,
  expires_at timestamptz not null,

  -- Payment.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  payment_method_type text,
  payment_started_at timestamptz,
  paid_at timestamptz,
  payment_failed_at timestamptz,
  payment_failure_message text,

  -- Payout.
  payout_due_at timestamptz not null,
  stripe_transfer_id text unique,
  paid_out_at timestamptz,
  payout_cents integer,
  payout_error text,
  payout_attempts smallint not null default 0,

  -- Endings.
  closed_at timestamptz,
  closed_by_account_id uuid references public.accounts(id) on delete set null,
  close_reason text,
  cancelled_by_role text,
  refund_cents integer,
  stripe_refund_id text unique,
  refund_status text,
  instructor_cancellation_fee_cents integer,

  -- Problems and disputes.
  problem_reported_at timestamptz,
  problem_details text,
  problem_resolved_at timestamptz,
  problem_resolution text,
  stripe_dispute_id text,
  disputed_at timestamptz,

  -- Milestone bookkeeping for the scheduler.
  expiry_reminder_posted_at timestamptz,
  event_reminder_posted_at timestamptz,
  event_ended_posted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bookings_status_check check (status in (
    'quote_sent',
    'awaiting_payment',
    'payment_processing',
    'confirmed',
    'completed',
    'paid_out',
    'expired',
    'withdrawn',
    'declined',
    'payment_failed',
    'cancelled'
  )),
  constraint bookings_version_check check (version between 1 and 1000),
  constraint bookings_time_zone_check check (
    char_length(time_zone) between 1 and 64
    and time_zone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)*$'
  ),
  constraint bookings_event_window_check check (
    event_ends_at > event_starts_at
    and event_ends_at <= event_starts_at + interval '24 hours'
  ),
  constraint bookings_text_check check (
    char_length(trim(venue_address)) between 3 and 300
    and (venue_name is null or char_length(venue_name) <= 200)
    and char_length(trim(service_description)) between 3 and 2000
  ),
  constraint bookings_pricing_check check (
    (
      pricing_mode = 'hourly'
      and hourly_rate_cents between 1000 and 500000
      and hours between 0.5 and 24
      and flat_price_cents is null
    )
    or (
      pricing_mode = 'flat'
      and flat_price_cents between 1000 and 1000000
      and hourly_rate_cents is null
      and hours is null
    )
  ),
  constraint bookings_travel_fee_check check (travel_fee_cents between 0 and 200000),
  constraint bookings_policy_check check (
    cancellation_policy in ('standard', 'custom')
    and private.valid_cancellation_windows(cancellation_windows)
    and (
      cancellation_policy = 'custom'
      or cancellation_windows = private.standard_cancellation_windows()
    )
  ),
  constraint bookings_insurance_check check (
    insurance_choice in ('coi_on_file', 'instructor_handles_outside_agreement')
  ),
  constraint bookings_currency_check check (currency = 'usd'),
  constraint bookings_fee_rate_check check (
    instructor_fee_bps between 0 and 5000 and client_fee_bps between 0 and 5000
  ),
  constraint bookings_amounts_check check (
    price_cents between 5000 and 1000000
    and price_cents = (
      case
        when pricing_mode = 'hourly'
          then round(hourly_rate_cents * hours)::integer
        else flat_price_cents
      end
    ) + travel_fee_cents
    and client_fee_cents = round(price_cents * client_fee_bps / 10000.0)::integer
    and platform_fee_cents = round(price_cents * instructor_fee_bps / 10000.0)::integer
    and total_cents = price_cents + client_fee_cents
    and instructor_payout_cents = price_cents - platform_fee_cents
  ),
  constraint bookings_agreement_check check (
    char_length(agreement_version) between 1 and 80
    and char_length(agreement_text) between 200 and 40000
    and agreement_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint bookings_payment_check check (
    (payment_method_type is null or payment_method_type in ('card', 'us_bank_account', 'link'))
    and (status not in ('confirmed', 'completed', 'paid_out') or paid_at is not null)
    and (status <> 'payment_processing' or payment_started_at is not null)
  ),
  constraint bookings_payout_check check (
    (status <> 'paid_out' or (paid_out_at is not null and stripe_transfer_id is not null))
    and (payout_cents is null or payout_cents between 0 and instructor_payout_cents)
  ),
  constraint bookings_close_check check (
    (status in ('expired', 'withdrawn', 'declined', 'payment_failed', 'cancelled'))
      = (closed_at is not null)
    and (cancelled_by_role is null or cancelled_by_role in ('organizer', 'instructor', 'admin'))
    and (status <> 'cancelled' or cancelled_by_role is not null)
    and (refund_cents is null or refund_cents between 0 and total_cents)
    and (refund_status is null or refund_status in ('pending', 'succeeded', 'failed', 'not_required'))
    and (close_reason is null or char_length(close_reason) <= 2000)
  ),
  constraint bookings_problem_check check (
    (problem_details is null or char_length(problem_details) between 1 and 4000)
    and (problem_resolution is null or problem_resolution in ('released', 'refunded', 'partially_refunded'))
    and (problem_resolved_at is null or problem_reported_at is not null)
  )
);

create unique index bookings_one_open_per_thread_idx
  on public.bookings (thread_id)
  where status in ('quote_sent', 'awaiting_payment', 'payment_processing', 'confirmed', 'completed');
create index bookings_thread_idx on public.bookings (thread_id, created_at desc);
create index bookings_instructor_idx on public.bookings (instructor_profile_id, status, event_starts_at);
create index bookings_organizer_idx on public.bookings (organizer_account_id, status, event_starts_at);
create index bookings_expiry_idx on public.bookings (expires_at)
  where status in ('quote_sent', 'awaiting_payment');
create index bookings_payout_due_idx on public.bookings (payout_due_at)
  where status in ('confirmed', 'completed') and paid_out_at is null;

create table public.booking_signatures (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  party_role text not null,
  account_id uuid not null references public.accounts(id) on delete restrict,
  typed_name text not null,
  email text not null,
  agreement_sha256 text not null,
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now(),
  unique (booking_id, party_role),
  constraint booking_signatures_role_check check (party_role in ('instructor', 'organizer')),
  constraint booking_signatures_name_check check (char_length(trim(typed_name)) between 2 and 120),
  constraint booking_signatures_email_check check (char_length(email) between 3 and 320),
  constraint booking_signatures_sha_check check (agreement_sha256 ~ '^[0-9a-f]{64}$'),
  constraint booking_signatures_ip_check check (ip_address is null or char_length(ip_address) <= 100),
  constraint booking_signatures_agent_check check (user_agent is null or char_length(user_agent) <= 500)
);

create or replace function public.protect_booking_signature_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Booking signatures cannot be changed or deleted';
end;
$$;

create trigger protect_booking_signature_immutability
  before update or delete on public.booking_signatures
  for each row execute function public.protect_booking_signature_immutability();

create table public.booking_stripe_events (
  stripe_event_id text primary key,
  event_type text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  processed_at timestamptz not null default now(),
  constraint booking_stripe_events_id_check check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$')
);

-- Original text of messages whose contact details were hidden before a
-- booking was paid. Administrators can read it for support and disputes.
create table public.inquiry_message_originals (
  message_id bigint primary key,
  thread_id uuid not null,
  original_body text not null,
  created_at timestamptz not null default now()
);
create index inquiry_message_originals_thread_idx
  on public.inquiry_message_originals (thread_id);

-- ---------------------------------------------------------------------------
-- Thread notifications for booking milestones
-- ---------------------------------------------------------------------------

alter table public.inquiry_thread_notification_jobs
  drop constraint if exists inquiry_thread_notification_type_check;
alter table public.inquiry_thread_notification_jobs
  add constraint inquiry_thread_notification_type_check check (
    notification_type in (
      'new_thread',
      'new_message',
      'response_reminder_24',
      'response_reminder_48',
      'response_timeout_instructor',
      'response_timeout_organizer',
      'thread_declined',
      'fallback_routed_organizer',
      'booking_update'
    )
  );

create or replace function public.inquiry_thread_notification_job_is_sendable(
  p_job_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job public.inquiry_thread_notification_jobs%rowtype;
  thread_status text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select * into job
  from public.inquiry_thread_notification_jobs
  where id = p_job_id;
  if job.id is null or job.status <> 'processing' then
    return false;
  end if;
  select status into thread_status
  from public.inquiry_threads
  where id = job.thread_id;

  return case
    when job.notification_type = 'new_thread'
      then thread_status = 'awaiting_response'
    when job.notification_type = 'new_message'
      then thread_status in ('awaiting_response', 'active', 'declined')
    when job.notification_type in ('response_reminder_24', 'response_reminder_48')
      then thread_status = 'awaiting_response'
    when job.notification_type in (
      'response_timeout_instructor',
      'response_timeout_organizer'
    ) then thread_status = 'timed_out'
    when job.notification_type = 'thread_declined'
      then thread_status = 'declined'
    when job.notification_type = 'fallback_routed_organizer'
      then thread_status in ('awaiting_response', 'active', 'declined', 'timed_out')
    when job.notification_type = 'booking_update'
      then thread_status is not null
    else false
  end;
end;
$$;

create table public.booking_milestones (
  booking_id uuid not null references public.bookings(id) on delete restrict,
  code text not null,
  message_id bigint references public.inquiry_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (booking_id, code),
  constraint booking_milestones_code_check check (code ~ '^[a-z0-9_]{2,60}$')
);

-- Posts a booking milestone as a system message and emails both thread
-- participants. Each milestone code is posted at most once per booking.
create or replace function private.post_booking_milestone(
  p_booking_id uuid,
  p_code text,
  p_body text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  created_message public.inquiry_messages%rowtype;
begin
  select * into booking from public.bookings where id = p_booking_id;
  if booking.id is null then
    raise exception 'Booking not found';
  end if;

  insert into public.booking_milestones (booking_id, code)
  values (booking.id, p_code)
  on conflict (booking_id, code) do nothing;
  if not found then
    return null;
  end if;

  insert into public.inquiry_messages (
    thread_id,
    sender_account_id,
    message_kind,
    body
  ) values (
    booking.thread_id,
    null,
    'system',
    left(p_body, 4000)
  ) returning * into created_message;

  update public.booking_milestones
  set message_id = created_message.id
  where booking_id = booking.id
    and code = p_code;

  update public.inquiry_threads
  set last_message_id = created_message.id,
      last_message_at = created_message.created_at,
      updated_at = now()
  where id = booking.thread_id;

  insert into public.inquiry_thread_notification_jobs (
    thread_id,
    message_id,
    recipient_account_id,
    recipient_email,
    notification_type,
    dedupe_key
  )
  select
    booking.thread_id,
    created_message.id,
    recipient.account_id,
    recipient.email,
    'booking_update',
    'booking:' || booking.id::text || ':' || p_code || ':' || recipient.account_id::text
  from (
    select
      participant.account_id,
      case
        when participant.participant_role = 'instructor'
          then coalesce(settings.inquiry_email, account.email)
        else account.email
      end as email
    from public.inquiry_thread_participants participant
    join public.accounts account on account.id = participant.account_id
    left join public.instructor_private_settings settings
      on settings.instructor_profile_id = booking.instructor_profile_id
     and participant.participant_role = 'instructor'
    where participant.thread_id = booking.thread_id
      and participant.left_at is null
  ) recipient
  where coalesce(recipient.email, '') ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  on conflict (dedupe_key) do nothing;

  return created_message.id;
end;
$$;

revoke all on function private.post_booking_milestone(uuid, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Formatting and calculation helpers
-- ---------------------------------------------------------------------------

create or replace function private.booking_money(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || to_char(coalesce(p_cents, 0) / 100.0, 'FM999,999,990.00')
$$;

create or replace function private.booking_local_date(
  p_at timestamptz,
  p_time_zone text
)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone p_time_zone, 'FMMon FMDD, YYYY')
$$;

create or replace function private.booking_local_time(p_value time)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_value, 'FMHH12:MI AM')
$$;

create or replace function private.booking_first_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(split_part(trim(coalesce(p_name, '')), ' ', 1), ''), 'The organizer')
$$;

create or replace function private.booking_names(p_booking public.bookings)
returns table (instructor_name text, organizer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(profile.display_name, 'The instructor'),
    private.booking_first_name(coalesce(inquiry.contact_name, inquiry.name, organizer.full_name))
  from public.instructor_profiles profile
  cross join public.inquiries inquiry
  left join public.accounts organizer on organizer.id = p_booking.organizer_account_id
  where profile.id = p_booking.instructor_profile_id
    and inquiry.id = p_booking.inquiry_id
$$;

-- Returns the refund owed to the organizer and the instructor payout for a
-- cancellation at p_at. The organizer service fee is kept on an organizer
-- cancellation and refunded on an instructor or administrator cancellation.
create or replace function private.booking_cancellation_split(
  p_booking public.bookings,
  p_cancelled_by text,
  p_at timestamptz default now()
)
returns table (
  refund_percent integer,
  refund_cents integer,
  instructor_kept_cents integer,
  payout_cents integer,
  days_before_event integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  days integer;
  percent integer := 0;
  item jsonb;
  refund_price integer;
  kept integer;
begin
  days := floor(extract(epoch from (p_booking.event_starts_at - p_at)) / 86400)::integer;
  if p_cancelled_by in ('instructor', 'admin') then
    return query select 100, p_booking.total_cents, 0, 0, days;
    return;
  end if;
  for item in select value from jsonb_array_elements(p_booking.cancellation_windows)
  loop
    if days >= (item ->> 'minDaysBeforeEvent')::integer then
      percent := (item ->> 'refundPercent')::integer;
      exit;
    end if;
  end loop;
  refund_price := round(p_booking.price_cents * percent / 100.0)::integer;
  kept := p_booking.price_cents - refund_price;
  return query select
    percent,
    refund_price,
    kept,
    kept - round(kept * p_booking.instructor_fee_bps / 10000.0)::integer,
    days;
end;
$$;

create or replace function private.booking_cancellation_summary(p_windows jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  parts text[] := '{}';
begin
  for item in select value from jsonb_array_elements(p_windows)
  loop
    parts := parts || (
      (item ->> 'refundPercent') || '% refund ' ||
      (item ->> 'minDaysBeforeEvent') || '+ days before'
    );
  end loop;
  return array_to_string(parts, ', ') || ', otherwise no refund';
end;
$$;

-- ---------------------------------------------------------------------------
-- Contact detail masking before a booking is paid
-- ---------------------------------------------------------------------------

create or replace function private.mask_contact_details(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  masked text := p_body;
  replacement constant text := '[contact details hidden until the booking is paid]';
begin
  if masked is null then
    return null;
  end if;
  -- Email addresses.
  masked := regexp_replace(
    masked,
    '[A-Za-z0-9._%+-]+[[:space:]]*(@|\(at\)|\[at\])[[:space:]]*[A-Za-z0-9.-]+[[:space:]]*(\.|\(dot\)|\[dot\])[[:space:]]*[A-Za-z]{2,}',
    replacement,
    'gi'
  );
  -- Phone numbers with at least ten digits and common separators.
  masked := regexp_replace(
    masked,
    '(\+?1[[:space:].-]?)?\(?[0-9]{3}\)?[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}',
    replacement,
    'g'
  );
  -- Social profile and messaging links.
  masked := regexp_replace(
    masked,
    '(https?://)?(www\.)?(instagram\.com|facebook\.com|fb\.me|tiktok\.com|wa\.me|t\.me|linkedin\.com|x\.com|twitter\.com|snapchat\.com)/[^[:space:]]*',
    replacement,
    'gi'
  );
  -- Social handles such as @linedancejess.
  masked := regexp_replace(
    masked,
    '(^|[[:space:](])@[A-Za-z0-9_.]{3,30}',
    '\1' || replacement,
    'g'
  );
  return masked;
end;
$$;

create or replace function private.thread_has_paid_booking(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.bookings booking
    where booking.thread_id = p_thread_id
      and booking.paid_at is not null
  )
$$;

create or replace function public.mask_unbooked_message_contact_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  masked text;
begin
  if new.message_kind not in ('participant', 'inquiry') then
    return new;
  end if;
  if private.thread_has_paid_booking(new.thread_id) then
    return new;
  end if;
  masked := private.mask_contact_details(new.body);
  if masked is distinct from new.body then
    insert into public.inquiry_message_originals (message_id, thread_id, original_body)
    values (new.id, new.thread_id, new.body)
    on conflict (message_id) do nothing;
    new.body := left(masked, 4000);
  end if;
  return new;
end;
$$;

drop trigger if exists mask_unbooked_message_contact_details on public.inquiry_messages;
create trigger mask_unbooked_message_contact_details
  before insert on public.inquiry_messages
  for each row execute function public.mask_unbooked_message_contact_details();

-- send_inquiry_message is idempotent by client request ID and compares the
-- stored body with the submitted body. Masked messages store the original
-- separately, so the retry check compares against the original as well.
create or replace function private.inquiry_message_matches_submission(
  p_message public.inquiry_messages,
  p_body text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_message.body = p_body
    or exists (
      select 1
      from public.inquiry_message_originals original
      where original.message_id = p_message.id
        and original.original_body = p_body
    )
$$;

-- ---------------------------------------------------------------------------
-- Reading a thread's booking
-- ---------------------------------------------------------------------------

create or replace function private.booking_json(
  p_booking public.bookings,
  p_role text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  split record;
  payout_hold text;
begin
  if p_booking.id is null then
    return null;
  end if;

  result := to_jsonb(p_booking) - array[
    'stripe_payment_intent_id',
    'stripe_charge_id',
    'stripe_checkout_session_id',
    'stripe_transfer_id',
    'stripe_refund_id',
    'stripe_dispute_id',
    'payout_error',
    'payout_attempts'
  ]::text[];

  if p_role = 'organizer' then
    result := result - array['platform_fee_cents', 'instructor_payout_cents', 'payout_cents', 'instructor_fee_bps']::text[];
  elsif p_role = 'instructor' then
    result := result - array['client_fee_bps']::text[];
  end if;

  payout_hold := case
    when p_booking.disputed_at is not null then 'disputed'
    when p_booking.problem_reported_at is not null and p_booking.problem_resolved_at is null then 'problem_reported'
    else null
  end;

  result := result || jsonb_build_object(
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_role', signature.party_role,
        'typed_name', signature.typed_name,
        'signed_at', signature.signed_at
      ) order by signature.signed_at)
      from public.booking_signatures signature
      where signature.booking_id = p_booking.id
    ), '[]'::jsonb),
    'payout_hold', payout_hold,
    'cancellation_summary', private.booking_cancellation_summary(p_booking.cancellation_windows),
    'problem_report_open',
      p_booking.status in ('confirmed', 'completed')
      and p_booking.problem_reported_at is null
      and now() >= p_booking.event_starts_at
      and now() < p_booking.payout_due_at,
    'can_cancel',
      p_booking.status = 'confirmed'
      and now() < p_booking.event_starts_at
  );

  if p_booking.status = 'confirmed' and now() < p_booking.event_starts_at and p_role in ('organizer', 'instructor') then
    select * into split from private.booking_cancellation_split(p_booking, p_role, now());
    result := result || jsonb_build_object(
      'cancellation_preview', jsonb_build_object(
        'refund_cents', split.refund_cents,
        'refund_percent', split.refund_percent,
        'instructor_payout_cents', split.payout_cents,
        'days_before_event', split.days_before_event
      )
    );
  end if;

  if p_booking.paid_at is not null then
    result := result || jsonb_build_object(
      'contacts', (
        select jsonb_build_object(
          'organizer_name', coalesce(inquiry.contact_name, inquiry.name, organizer.full_name),
          'organizer_email', coalesce(inquiry.contact_email, inquiry.email, organizer.email),
          'organizer_phone', coalesce(inquiry.contact_phone_e164, organizer.phone_e164),
          'organizer_company', inquiry.company_name,
          'instructor_name', profile.display_name,
          'instructor_business', profile.business_name,
          'instructor_email', coalesce(settings.inquiry_email, instructor.email),
          'instructor_phone', settings.inquiry_phone_e164
        )
        from public.inquiries inquiry
        join public.instructor_profiles profile on profile.id = p_booking.instructor_profile_id
        left join public.instructor_private_settings settings on settings.instructor_profile_id = profile.id
        left join public.accounts organizer on organizer.id = p_booking.organizer_account_id
        left join public.accounts instructor on instructor.id = p_booking.instructor_account_id
        where inquiry.id = p_booking.inquiry_id
      )
    );
  end if;
  return result;
end;
$$;

create or replace function public.get_thread_booking(p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  thread public.inquiry_threads%rowtype;
  latest public.bookings%rowtype;
  inquiry public.inquiries%rowtype;
  defaults jsonb := null;
  payouts_ready boolean := null;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  select * into thread from public.inquiry_threads where id = p_thread_id;
  if thread.id is null then
    raise exception 'Inquiry thread not found or access denied';
  end if;

  select participant.participant_role into caller_role
  from public.inquiry_thread_participants participant
  where participant.thread_id = thread.id
    and participant.account_id = caller_id
    and participant.left_at is null;
  if caller_role is null then
    if public.is_marketplace_admin() then
      caller_role := 'admin';
    else
      raise exception 'Inquiry thread not found or access denied';
    end if;
  end if;

  select * into latest
  from public.bookings booking
  where booking.thread_id = thread.id
  order by booking.created_at desc, booking.version desc
  limit 1;

  select * into inquiry from public.inquiries where id = thread.inquiry_id;

  if caller_role = 'instructor' then
    payouts_ready := private.instructor_payouts_ready(thread.instructor_profile_id);
    select jsonb_build_object(
      'hourly_rate_cents', settings.hourly_rate_cents,
      'minimum_hours', settings.minimum_hours,
      'cancellation_policy', coalesce(settings.default_cancellation_policy, 'standard'),
      'custom_cancellation_windows', settings.custom_cancellation_windows,
      'standard_cancellation_windows', private.standard_cancellation_windows(),
      'liability_insurance_status', profile.liability_insurance_status,
      'provides_speakers', coalesce(profile.provides_speakers, false),
      'provides_microphone', coalesce(profile.provides_microphone, false),
      'event_date', inquiry.event_date,
      'start_time', inquiry.event_start_time,
      'time_zone', coalesce(nullif(inquiry.time_zone, ''), 'America/New_York'),
      'venue_name', inquiry.venue_name,
      'event_city', inquiry.event_city,
      'event_region', inquiry.event_region
    ) into defaults
    from public.instructor_profiles profile
    left join public.instructor_private_settings settings
      on settings.instructor_profile_id = profile.id
    where profile.id = thread.instructor_profile_id;
  end if;

  return jsonb_build_object(
    'role', caller_role,
    'thread_status', thread.status,
    'is_current_assignment', not exists (
      select 1
      from public.inquiry_threads newer_thread
      where newer_thread.inquiry_id = thread.inquiry_id
        and newer_thread.assignment_order > thread.assignment_order
    ),
    'booking', private.booking_json(latest, caller_role),
    'booking_count', (select count(*) from public.bookings where thread_id = thread.id),
    'payouts_ready', payouts_ready,
    'defaults', defaults,
    'terms', jsonb_build_object(
      'instructor_fee_bps', 1500,
      'client_fee_bps', 500,
      'payout_delay_hours', 24,
      'problem_report_window_hours', 24,
      'quote_expiry_days', 7,
      'ach_minimum_business_days', 5
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Participant actions that do not move money
-- ---------------------------------------------------------------------------

create or replace function public.decline_booking_quote(
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  booking public.bookings%rowtype;
  names record;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if clean_reason is not null and char_length(clean_reason) > 2000 then
    raise exception 'Reason must be 2,000 characters or fewer';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null or booking.organizer_account_id <> caller_id then
    raise exception 'Booking not found or access denied';
  end if;
  if booking.status not in ('quote_sent', 'awaiting_payment') then
    raise exception 'Only an open quote can be declined';
  end if;

  update public.bookings
  set status = 'declined',
      closed_at = now(),
      closed_by_account_id = caller_id,
      close_reason = clean_reason,
      updated_at = now()
  where id = booking.id;

  select * into names from private.booking_names(booking);
  perform private.post_booking_milestone(
    booking.id,
    'declined',
    names.organizer_name || ' declined the quote.' ||
      case when clean_reason is not null then ' Reason: ' || clean_reason else '' end ||
      ' Next: ' || names.instructor_name || ' can send a revised quote or close the conversation.'
  );
  return jsonb_build_object('bookingId', booking.id, 'status', 'declined');
end;
$$;

create or replace function public.withdraw_booking_quote(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  booking public.bookings%rowtype;
  names record;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null or booking.instructor_account_id <> caller_id then
    raise exception 'Booking not found or access denied';
  end if;
  if booking.status not in ('quote_sent', 'awaiting_payment') then
    raise exception 'Only an open quote can be withdrawn';
  end if;

  update public.bookings
  set status = 'withdrawn',
      closed_at = now(),
      closed_by_account_id = caller_id,
      close_reason = 'Withdrawn by the instructor',
      updated_at = now()
  where id = booking.id;

  select * into names from private.booking_names(booking);
  perform private.post_booking_milestone(
    booking.id,
    'withdrawn',
    names.instructor_name || ' withdrew the quote. Next: ' ||
      names.instructor_name || ' can send a new quote.'
  );
  return jsonb_build_object('bookingId', booking.id, 'status', 'withdrawn');
end;
$$;

create or replace function public.report_booking_problem(
  p_booking_id uuid,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  booking public.bookings%rowtype;
  names record;
  clean_details text := nullif(trim(coalesce(p_details, '')), '');
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if clean_details is null then
    raise exception 'Describe the problem so we can review it';
  end if;
  if char_length(clean_details) > 4000 then
    raise exception 'Problem details must be 4,000 characters or fewer';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null or booking.organizer_account_id <> caller_id then
    raise exception 'Booking not found or access denied';
  end if;
  if booking.status not in ('confirmed', 'completed') then
    raise exception 'Problems can be reported only for a paid booking';
  end if;
  if booking.problem_reported_at is not null then
    raise exception 'A problem was already reported for this booking';
  end if;
  if now() < booking.event_starts_at then
    raise exception 'Before the event starts, message the instructor or cancel the booking instead';
  end if;
  if now() >= booking.payout_due_at or booking.paid_out_at is not null then
    raise exception 'The problem report window for this booking has closed. Contact support for help';
  end if;

  update public.bookings
  set problem_reported_at = now(),
      problem_details = clean_details,
      updated_at = now()
  where id = booking.id;

  select * into names from private.booking_names(booking);
  perform private.post_booking_milestone(
    booking.id,
    'problem_reported',
    names.organizer_name || ' reported a problem with this booking. The payout is paused while Hire Line Dancers reviews it. We aim to decide within 10 business days. Next: Hire Line Dancers reviews the report.'
  );
  return jsonb_build_object('bookingId', booking.id, 'problemReported', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role state transitions used by the booking Edge Functions
-- ---------------------------------------------------------------------------

create or replace function private.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
end;
$$;

-- Creates a signed quote. The Edge Function renders the agreement text and
-- computes the amounts; table constraints re-check every amount.
create or replace function public.booking_create_quote(p_quote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread public.inquiry_threads%rowtype;
  organizer_id uuid;
  previous public.bookings%rowtype;
  created public.bookings%rowtype;
  names record;
  starts_at timestamptz;
  ends_at timestamptz;
  tz text := p_quote ->> 'time_zone';
  event_day date := (p_quote ->> 'event_date')::date;
  start_at time := (p_quote ->> 'start_time')::time;
  end_at time := (p_quote ->> 'end_time')::time;
  next_version smallint := 1;
begin
  perform private.require_service_role();

  select * into thread
  from public.inquiry_threads
  where id = (p_quote ->> 'thread_id')::uuid
  for update;
  if thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if thread.instructor_account_id is distinct from (p_quote ->> 'instructor_account_id')::uuid then
    raise exception 'Only the instructor in this conversation can send a quote';
  end if;
  if thread.status not in ('awaiting_response', 'active') then
    raise exception 'This conversation is closed';
  end if;
  if exists (
    select 1
    from public.inquiry_threads newer_thread
    where newer_thread.inquiry_id = thread.inquiry_id
      and newer_thread.assignment_order > thread.assignment_order
  ) then
    raise exception 'This inquiry was routed to another instructor';
  end if;
  if not private.instructor_payouts_ready(thread.instructor_profile_id) then
    raise exception 'Finish payout setup before sending a quote';
  end if;

  select participant.account_id into organizer_id
  from public.inquiry_thread_participants participant
  where participant.thread_id = thread.id
    and participant.participant_role = 'organizer'
    and participant.left_at is null
  limit 1;
  if organizer_id is null then
    raise exception 'This conversation has no organizer account';
  end if;

  begin
    starts_at := (event_day + start_at) at time zone tz;
    ends_at := (
      event_day + case when end_at <= start_at then 1 else 0 end + end_at
    ) at time zone tz;
  exception when others then
    raise exception 'The event date, times, or time zone are invalid';
  end;
  if starts_at <= now() + interval '2 hours' then
    raise exception 'The event must start at least 2 hours from now';
  end if;
  if starts_at > now() + interval '2 years' then
    raise exception 'The event must be within the next 2 years';
  end if;

  select * into previous
  from public.bookings booking
  where booking.thread_id = thread.id
    and booking.status in ('quote_sent', 'awaiting_payment', 'payment_processing', 'confirmed', 'completed')
  for update;
  if previous.id is not null then
    if previous.status in ('payment_processing', 'confirmed', 'completed') then
      raise exception 'This conversation already has a paid booking';
    end if;
    update public.bookings
    set status = 'withdrawn',
        closed_at = now(),
        closed_by_account_id = thread.instructor_account_id,
        close_reason = 'Replaced by an updated quote',
        updated_at = now()
    where id = previous.id;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.bookings
  where thread_id = thread.id;

  insert into public.bookings (
    thread_id,
    inquiry_id,
    instructor_profile_id,
    instructor_account_id,
    organizer_account_id,
    status,
    version,
    replaces_booking_id,
    event_date,
    start_time,
    end_time,
    time_zone,
    event_starts_at,
    event_ends_at,
    venue_name,
    venue_address,
    service_description,
    pricing_mode,
    hourly_rate_cents,
    hours,
    flat_price_cents,
    travel_fee_cents,
    provides_speakers,
    provides_microphone,
    cancellation_policy,
    cancellation_windows,
    insurance_choice,
    instructor_fee_bps,
    client_fee_bps,
    price_cents,
    client_fee_cents,
    total_cents,
    platform_fee_cents,
    instructor_payout_cents,
    agreement_version,
    agreement_text,
    agreement_sha256,
    expires_at,
    payout_due_at
  ) values (
    thread.id,
    thread.inquiry_id,
    thread.instructor_profile_id,
    thread.instructor_account_id,
    organizer_id,
    'quote_sent',
    next_version,
    previous.id,
    event_day,
    start_at,
    end_at,
    tz,
    starts_at,
    ends_at,
    nullif(trim(coalesce(p_quote ->> 'venue_name', '')), ''),
    trim(p_quote ->> 'venue_address'),
    trim(p_quote ->> 'service_description'),
    p_quote ->> 'pricing_mode',
    (p_quote ->> 'hourly_rate_cents')::integer,
    (p_quote ->> 'hours')::numeric,
    (p_quote ->> 'flat_price_cents')::integer,
    coalesce((p_quote ->> 'travel_fee_cents')::integer, 0),
    coalesce((p_quote ->> 'provides_speakers')::boolean, false),
    coalesce((p_quote ->> 'provides_microphone')::boolean, false),
    p_quote ->> 'cancellation_policy',
    p_quote -> 'cancellation_windows',
    p_quote ->> 'insurance_choice',
    (p_quote ->> 'instructor_fee_bps')::integer,
    (p_quote ->> 'client_fee_bps')::integer,
    (p_quote ->> 'price_cents')::integer,
    (p_quote ->> 'client_fee_cents')::integer,
    (p_quote ->> 'total_cents')::integer,
    (p_quote ->> 'platform_fee_cents')::integer,
    (p_quote ->> 'instructor_payout_cents')::integer,
    p_quote ->> 'agreement_version',
    p_quote ->> 'agreement_text',
    p_quote ->> 'agreement_sha256',
    least(now() + interval '7 days', starts_at),
    ends_at + interval '24 hours'
  ) returning * into created;

  insert into public.booking_signatures (
    booking_id,
    party_role,
    account_id,
    typed_name,
    email,
    agreement_sha256,
    ip_address,
    user_agent
  ) values (
    created.id,
    'instructor',
    created.instructor_account_id,
    trim(p_quote ->> 'signature_name'),
    p_quote ->> 'signature_email',
    created.agreement_sha256,
    left(p_quote ->> 'signature_ip', 100),
    left(p_quote ->> 'signature_user_agent', 500)
  );

  select * into names from private.booking_names(created);
  perform private.post_booking_milestone(
    created.id,
    case when previous.id is null then 'quote_sent' else 'quote_updated' end,
    case
      when previous.id is null then names.instructor_name || ' sent a signed quote'
      else names.instructor_name || ' sent an updated quote. The previous version is withdrawn. New total'
    end ||
      ': ' || private.booking_money(created.total_cents) || ' (' ||
      private.booking_money(created.price_cents) || ' plus a ' ||
      private.booking_money(created.client_fee_cents) || ' service fee) for ' ||
      private.booking_local_date(created.event_starts_at, created.time_zone) ||
      '. Expires ' || private.booking_local_date(created.expires_at, created.time_zone) ||
      '. Next: ' || names.organizer_name || ' reviews, signs, and pays.'
  );

  return jsonb_build_object(
    'bookingId', created.id,
    'version', created.version,
    'expiresAt', created.expires_at,
    'totalCents', created.total_cents
  );
end;
$$;

-- Records the organizer's signature. The organizer signs the exact agreement
-- text they reviewed, identified by its SHA-256 fingerprint.
create or replace function public.booking_record_organizer_signature(
  p_booking_id uuid,
  p_account_id uuid,
  p_typed_name text,
  p_email text,
  p_agreement_sha256 text,
  p_ip_address text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
begin
  perform private.require_service_role();
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null or booking.organizer_account_id <> p_account_id then
    raise exception 'Booking not found or access denied';
  end if;
  if booking.status = 'awaiting_payment' then
    return jsonb_build_object('bookingId', booking.id, 'status', booking.status, 'alreadySigned', true);
  end if;
  if booking.status <> 'quote_sent' then
    raise exception 'This quote is no longer open';
  end if;
  if booking.expires_at <= now() then
    raise exception 'This quote has expired. Ask the instructor to send a new one';
  end if;
  if p_agreement_sha256 is distinct from booking.agreement_sha256 then
    raise exception 'The agreement changed after you opened it. Review the latest version before signing';
  end if;

  insert into public.booking_signatures (
    booking_id,
    party_role,
    account_id,
    typed_name,
    email,
    agreement_sha256,
    ip_address,
    user_agent
  ) values (
    booking.id,
    'organizer',
    p_account_id,
    trim(p_typed_name),
    p_email,
    booking.agreement_sha256,
    left(p_ip_address, 100),
    left(p_user_agent, 500)
  );

  update public.bookings
  set status = 'awaiting_payment',
      updated_at = now()
  where id = booking.id;

  select * into names from private.booking_names(booking);
  perform private.post_booking_milestone(
    booking.id,
    'organizer_signed',
    names.organizer_name || ' signed the agreement. Payment of ' ||
      private.booking_money(booking.total_cents) ||
      ' is pending, and the agreement takes effect once it is paid. Next: ' ||
      names.organizer_name || ' completes payment.'
  );
  return jsonb_build_object('bookingId', booking.id, 'status', 'awaiting_payment', 'alreadySigned', false);
end;
$$;

create or replace function public.booking_attach_checkout_session(
  p_booking_id uuid,
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  if p_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$' then
    raise exception 'Invalid Checkout Session identifier';
  end if;
  update public.bookings
  set stripe_checkout_session_id = p_session_id,
      updated_at = now()
  where id = p_booking_id
    and status = 'awaiting_payment';
  if not found then
    raise exception 'This booking is not awaiting payment';
  end if;
end;
$$;

-- Applies a verified Stripe payment outcome. Returns 'applied', 'ignored',
-- or 'refund_required' when money arrived for a quote that is no longer open.
create or replace function public.booking_apply_payment(
  p_booking_id uuid,
  p_outcome text,
  p_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_payment_method_type text,
  p_amount_cents integer,
  p_failure_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
  inquiry_warning text;
begin
  perform private.require_service_role();
  if p_outcome not in ('paid', 'processing', 'failed') then
    raise exception 'Invalid payment outcome';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'Booking not found';
  end if;
  if p_outcome in ('paid', 'processing') and p_amount_cents is distinct from booking.total_cents then
    raise exception 'Stripe amount does not match the booking total';
  end if;
  select * into names from private.booking_names(booking);

  if p_outcome = 'processing' then
    if booking.status <> 'awaiting_payment' then
      return case when booking.status = 'payment_processing' then 'ignored' else 'refund_required' end;
    end if;
    update public.bookings
    set status = 'payment_processing',
        stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
        payment_method_type = coalesce(p_payment_method_type, payment_method_type),
        payment_started_at = now(),
        updated_at = now()
    where id = booking.id;
    perform private.post_booking_milestone(
      booking.id,
      'payment_processing',
      'Bank payment of ' || private.booking_money(booking.total_cents) ||
        ' started. Bank payments usually clear in about 4 business days. The booking is confirmed when it clears. Next: nobody needs to act.'
    );
    return 'applied';
  end if;

  if p_outcome = 'failed' then
    if booking.status not in ('awaiting_payment', 'payment_processing') then
      return 'ignored';
    end if;
    update public.bookings
    set status = case when expires_at <= now() then 'expired' else 'awaiting_payment' end,
        closed_at = case when expires_at <= now() then now() else null end,
        close_reason = case when expires_at <= now() then 'Payment failed after the quote expired' else null end,
        payment_failed_at = now(),
        payment_failure_message = left(p_failure_message, 500),
        payment_started_at = null,
        updated_at = now()
    where id = booking.id;
    perform private.post_booking_milestone(
      booking.id,
      'payment_failed_' || to_char(now(), 'YYYYMMDDHH24MISS'),
      'Payment did not go through. Next: ' || names.organizer_name ||
        ' can try again with another payment method' ||
        case when booking.expires_at <= now() then ' after ' || names.instructor_name || ' sends a new quote.' else '.' end
    );
    return 'applied';
  end if;

  -- p_outcome = 'paid'
  if booking.status in ('confirmed', 'completed', 'paid_out') then
    return 'ignored';
  end if;
  if booking.status not in ('awaiting_payment', 'payment_processing') then
    return 'refund_required';
  end if;
  if p_charge_id is null or p_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$' then
    raise exception 'A Stripe charge identifier is required to confirm payment';
  end if;

  update public.bookings
  set status = 'confirmed',
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
      stripe_charge_id = p_charge_id,
      payment_method_type = coalesce(p_payment_method_type, payment_method_type),
      payment_started_at = coalesce(payment_started_at, now()),
      paid_at = now(),
      updated_at = now()
  where id = booking.id;

  begin
    update public.inquiries
    set booking_outcome = 'booked',
        booked_instructor_profile_id = booking.instructor_profile_id,
        booking_value_cents = booking.price_cents,
        booking_event_date = booking.event_date,
        outcome_note = 'Paid through Hire Line Dancers',
        outcome_reported_by = booking.organizer_account_id,
        outcome_reported_at = now(),
        outcome_next_ask_at = null,
        updated_at = now()
    where id = booking.inquiry_id;
  exception when others then
    get stacked diagnostics inquiry_warning = message_text;
    raise warning 'Booking % paid but inquiry outcome was not updated: %', booking.id, inquiry_warning;
  end;

  perform private.post_booking_milestone(
    booking.id,
    'confirmed',
    'Booking confirmed. ' || private.booking_money(booking.total_cents) ||
      ' paid. The signed agreement and both contacts are in Booking details. Next: nobody needs to act until the event on ' ||
      private.booking_local_date(booking.event_starts_at, booking.time_zone) || '.'
  );
  return 'applied';
end;
$$;

create or replace function public.booking_expire_due_quotes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due public.bookings%rowtype;
  names record;
  expired_count integer := 0;
begin
  perform private.require_service_role();
  for due in
    select booking.*
    from public.bookings booking
    where booking.status in ('quote_sent', 'awaiting_payment')
      and booking.expires_at <= now()
    order by booking.expires_at
    limit 200
    for update skip locked
  loop
    update public.bookings
    set status = 'expired',
        closed_at = now(),
        close_reason = 'The quote expired without payment',
        updated_at = now()
    where id = due.id;
    select * into names from private.booking_names(due);
    perform private.post_booking_milestone(
      due.id,
      'expired',
      'The quote expired without payment. Next: ' || names.instructor_name ||
        ' can send a new quote if still available.'
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

create or replace function public.booking_post_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  due public.bookings%rowtype;
  names record;
  expiry_count integer := 0;
  event_count integer := 0;
  ended_count integer := 0;
begin
  perform private.require_service_role();

  for due in
    select booking.*
    from public.bookings booking
    where booking.status in ('quote_sent', 'awaiting_payment')
      and booking.expiry_reminder_posted_at is null
      and booking.expires_at > now()
      and booking.expires_at <= now() + interval '24 hours'
      and booking.created_at <= now() - interval '1 hour'
    limit 200
    for update skip locked
  loop
    update public.bookings set expiry_reminder_posted_at = now(), updated_at = now() where id = due.id;
    select * into names from private.booking_names(due);
    perform private.post_booking_milestone(
      due.id,
      'expiry_reminder',
      'This quote expires in about 24 hours. Next: ' || names.organizer_name ||
        case when due.status = 'awaiting_payment' then ' completes payment.' else ' reviews, signs, and pays.' end
    );
    expiry_count := expiry_count + 1;
  end loop;

  for due in
    select booking.*
    from public.bookings booking
    where booking.status = 'confirmed'
      and booking.event_reminder_posted_at is null
      and booking.event_starts_at > now()
      and booking.event_starts_at <= now() + interval '3 days'
    limit 200
    for update skip locked
  loop
    update public.bookings set event_reminder_posted_at = now(), updated_at = now() where id = due.id;
    perform private.post_booking_milestone(
      due.id,
      'event_reminder',
      'Event coming up on ' || private.booking_local_date(due.event_starts_at, due.time_zone) ||
        ', ' || private.booking_local_time(due.start_time) || ' to ' ||
        private.booking_local_time(due.end_time) || ' at ' ||
        coalesce(due.venue_name || ', ', '') || due.venue_address ||
        '. Next: both of you confirm any final details here.'
    );
    event_count := event_count + 1;
  end loop;

  for due in
    select booking.*
    from public.bookings booking
    where booking.status = 'confirmed'
      and booking.event_ends_at <= now()
    limit 200
    for update skip locked
  loop
    update public.bookings
    set status = 'completed',
        event_ended_posted_at = now(),
        updated_at = now()
    where id = due.id;
    select * into names from private.booking_names(due);
    perform private.post_booking_milestone(
      due.id,
      'event_ended',
      'Event complete. If something went wrong, ' || names.organizer_name ||
        ' can report a problem within 24 hours. Otherwise ' || names.instructor_name ||
        ' is paid automatically. Next: ' || names.organizer_name || ' reports a problem only if needed.'
    );
    ended_count := ended_count + 1;
  end loop;

  return jsonb_build_object(
    'expiryReminders', expiry_count,
    'eventReminders', event_count,
    'eventsEnded', ended_count
  );
end;
$$;

-- Claims bookings whose instructor share is ready to transfer. A claimed row
-- is locked for 10 minutes so concurrent workers cannot transfer twice; the
-- Stripe idempotency key prevents a duplicate transfer after a retry.
create or replace function public.booking_claim_due_transfers(p_limit integer default 10)
returns table (
  booking_id uuid,
  amount_cents integer,
  stripe_account_id text,
  stripe_charge_id text,
  instructor_profile_id uuid,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  return query
  with due as (
    select booking.id
    from public.bookings booking
    where booking.stripe_transfer_id is null
      and booking.stripe_charge_id is not null
      and booking.disputed_at is null
      and booking.payout_attempts < 8
      and (booking.problem_reported_at is null or booking.problem_resolved_at is not null)
      and coalesce(booking.refund_status, 'not_required') in ('succeeded', 'not_required')
      and booking.updated_at <= now() - case when booking.payout_attempts > 0 then interval '10 minutes' else interval '0 minutes' end
      and coalesce(booking.payout_cents, booking.instructor_payout_cents) > 0
      and (
        (booking.status = 'completed' and booking.payout_due_at <= now())
        or booking.status = 'cancelled'
      )
    order by booking.payout_due_at, booking.id
    limit greatest(1, least(coalesce(p_limit, 10), 25))
    for update skip locked
  ), claimed as (
    update public.bookings booking
    set payout_attempts = booking.payout_attempts + 1,
        payout_cents = coalesce(booking.payout_cents, booking.instructor_payout_cents),
        updated_at = now()
    from due
    where booking.id = due.id
    returning booking.*
  )
  select
    claimed.id,
    claimed.payout_cents,
    account.stripe_account_id,
    claimed.stripe_charge_id,
    claimed.instructor_profile_id,
    claimed.status
  from claimed
  join public.instructor_payout_accounts account
    on account.instructor_profile_id = claimed.instructor_profile_id;
end;
$$;

create or replace function public.booking_record_transfer(
  p_booking_id uuid,
  p_transfer_id text,
  p_amount_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
begin
  perform private.require_service_role();
  if p_transfer_id !~ '^tr_[A-Za-z0-9]+$' then
    raise exception 'Invalid Stripe transfer identifier';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'Booking not found';
  end if;
  if booking.stripe_transfer_id is not null then
    return;
  end if;
  if p_amount_cents is distinct from booking.payout_cents then
    raise exception 'Transfer amount does not match the claimed payout';
  end if;

  update public.bookings
  set stripe_transfer_id = p_transfer_id,
      paid_out_at = now(),
      payout_error = null,
      status = case when status = 'completed' then 'paid_out' else status end,
      updated_at = now()
  where id = booking.id;

  select * into names from private.booking_names(booking);
  perform private.post_booking_milestone(
    booking.id,
    'payout_sent',
    'Payout of ' || private.booking_money(p_amount_cents) || ' sent to ' ||
      names.instructor_name || '. It usually reaches the bank account within 2 business days. ' ||
      case when booking.status = 'completed' then 'This booking is complete. Thank you for booking through Hire Line Dancers.' else 'Next: nobody needs to act.' end
  );
end;
$$;

create or replace function public.booking_record_transfer_error(
  p_booking_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  update public.bookings
  set payout_error = left(coalesce(p_error, 'Transfer failed'), 1000),
      updated_at = now()
  where id = p_booking_id;
end;
$$;

-- Locks a confirmed booking for cancellation and records the amounts. The
-- Edge Function then refunds the organizer and, when owed, pays the
-- instructor their share through the normal transfer worker.
create or replace function public.booking_prepare_cancellation(
  p_booking_id uuid,
  p_account_id uuid,
  p_reason text,
  p_as_admin boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  actor_role text;
  split record;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform private.require_service_role();
  if clean_reason is not null and char_length(clean_reason) > 2000 then
    raise exception 'Reason must be 2,000 characters or fewer';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'Booking not found or access denied';
  end if;
  if p_as_admin then
    actor_role := 'admin';
  elsif booking.organizer_account_id = p_account_id then
    actor_role := 'organizer';
  elsif booking.instructor_account_id = p_account_id then
    actor_role := 'instructor';
  else
    raise exception 'Booking not found or access denied';
  end if;

  if booking.status = 'cancelled' then
    return jsonb_build_object(
      'bookingId', booking.id,
      'alreadyCancelled', true,
      'refundCents', booking.refund_cents,
      'refundStatus', booking.refund_status,
      'paymentIntentId', booking.stripe_payment_intent_id,
      'chargeId', booking.stripe_charge_id
    );
  end if;
  if booking.status <> 'confirmed' then
    raise exception 'Only a confirmed booking can be cancelled. For a payment that is still clearing, wait for it to clear';
  end if;
  if now() >= booking.event_starts_at and not p_as_admin then
    raise exception 'The event has started. Report a problem instead of cancelling';
  end if;
  if booking.disputed_at is not null and not p_as_admin then
    raise exception 'This payment is under dispute. Contact support for help';
  end if;

  select * into split from private.booking_cancellation_split(booking, actor_role, now());

  update public.bookings
  set status = 'cancelled',
      closed_at = now(),
      closed_by_account_id = p_account_id,
      close_reason = clean_reason,
      cancelled_by_role = actor_role,
      refund_cents = split.refund_cents,
      refund_status = case when split.refund_cents > 0 then 'pending' else 'not_required' end,
      payout_cents = split.payout_cents,
      payout_due_at = least(payout_due_at, now()),
      updated_at = now()
  where id = booking.id;

  return jsonb_build_object(
    'bookingId', booking.id,
    'alreadyCancelled', false,
    'cancelledByRole', actor_role,
    'refundCents', split.refund_cents,
    'refundPercent', split.refund_percent,
    'payoutCents', split.payout_cents,
    'refundStatus', case when split.refund_cents > 0 then 'pending' else 'not_required' end,
    'paymentIntentId', booking.stripe_payment_intent_id,
    'chargeId', booking.stripe_charge_id
  );
end;
$$;

create or replace function public.booking_record_refund(
  p_booking_id uuid,
  p_refund_id text,
  p_refund_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
  actor_name text;
begin
  perform private.require_service_role();
  if p_refund_status not in ('pending', 'succeeded', 'failed') then
    raise exception 'Invalid refund status';
  end if;
  if p_refund_id is not null and p_refund_id !~ '^(re|pyr)_[A-Za-z0-9]+$' then
    raise exception 'Invalid Stripe refund identifier';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'Booking not found';
  end if;

  update public.bookings
  set stripe_refund_id = coalesce(p_refund_id, stripe_refund_id),
      refund_status = p_refund_status,
      payout_error = case when p_refund_status = 'failed' then left(coalesce(p_error, 'Refund failed'), 1000) else payout_error end,
      updated_at = now()
  where id = booking.id;

  if p_refund_status = 'succeeded' or (p_refund_status = 'pending' and p_refund_id is not null) then
    select * into names from private.booking_names(booking);
    if booking.status = 'cancelled' then
      actor_name := case booking.cancelled_by_role
        when 'organizer' then names.organizer_name
        when 'instructor' then names.instructor_name
        else 'Hire Line Dancers'
      end;
      perform private.post_booking_milestone(
        booking.id,
        'cancelled',
        actor_name || ' cancelled the booking. ' ||
          private.booking_money(booking.refund_cents) || ' is being refunded to ' ||
          names.organizer_name || '''s original payment method' ||
          case
            when coalesce(booking.payout_cents, 0) > 0 then ', and ' || private.booking_money(booking.payout_cents) ||
              ' will be paid to ' || names.instructor_name || ' under the ' ||
              case when booking.cancellation_policy = 'custom' then 'custom' else 'Standard' end || ' cancellation policy.'
            else '.'
          end ||
          ' Refunds usually appear within 5 to 10 business days. Next: nobody needs to act.'
      );
    else
      perform private.post_booking_milestone(
        booking.id,
        'problem_refund',
        'Hire Line Dancers reviewed the reported problem and is refunding ' ||
          private.booking_money(booking.refund_cents) || ' to ' || names.organizer_name ||
          '''s original payment method.' ||
          case
            when coalesce(booking.payout_cents, 0) > 0 then ' ' || names.instructor_name || ' will be paid ' ||
              private.booking_money(booking.payout_cents) || '.'
            else ''
          end ||
          ' Next: nobody needs to act.'
      );
    end if;
  end if;
end;
$$;

-- Posts the cancellation milestone when no refund is owed.
create or replace function public.booking_finish_cancellation_without_refund(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
  actor_name text;
begin
  perform private.require_service_role();
  select * into booking from public.bookings where id = p_booking_id;
  if booking.id is null or booking.status <> 'cancelled' or coalesce(booking.refund_cents, 0) > 0 then
    raise exception 'This cancellation requires a refund';
  end if;
  select * into names from private.booking_names(booking);
  actor_name := case booking.cancelled_by_role
    when 'organizer' then names.organizer_name
    when 'instructor' then names.instructor_name
    else 'Hire Line Dancers'
  end;
  perform private.post_booking_milestone(
    booking.id,
    'cancelled',
    actor_name || ' cancelled the booking. Under the ' ||
      case when booking.cancellation_policy = 'custom' then 'custom' else 'Standard' end ||
      ' cancellation policy no refund is due, and ' || private.booking_money(coalesce(booking.payout_cents, 0)) ||
      ' will be paid to ' || names.instructor_name || '. Next: nobody needs to act.'
  );
end;
$$;

-- Administrator decision on a reported problem. A zero refund releases the
-- payout. A positive refund comes out of the instructor price; the instructor
-- is paid the rest minus the platform fee.
create or replace function public.booking_prepare_problem_resolution(
  p_booking_id uuid,
  p_admin_account_id uuid,
  p_refund_cents integer,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  kept integer;
  payout integer;
  names record;
begin
  perform private.require_service_role();
  if not exists (
    select 1
    from public.accounts account
    where account.id = p_admin_account_id
      and (
        account.role = 'admin'
        or exists (select 1 from public.marketplace_admins admin_access where admin_access.account_id = account.id)
      )
  ) then
    raise exception 'Administrator access required';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'Booking not found';
  end if;
  if booking.problem_reported_at is null or booking.problem_resolved_at is not null then
    raise exception 'This booking has no open problem report';
  end if;
  if booking.stripe_transfer_id is not null then
    raise exception 'The instructor was already paid for this booking';
  end if;
  if p_refund_cents is null or p_refund_cents < 0 or p_refund_cents > booking.price_cents then
    raise exception 'The refund must be between $0 and the instructor price';
  end if;

  kept := booking.price_cents - p_refund_cents;
  payout := kept - round(kept * booking.instructor_fee_bps / 10000.0)::integer;

  if p_refund_cents = booking.price_cents then
    -- A full refund also returns the service fee and ends the booking.
    update public.bookings
    set problem_resolved_at = now(),
        problem_resolution = 'refunded',
        status = 'cancelled',
        closed_at = now(),
        closed_by_account_id = p_admin_account_id,
        cancelled_by_role = 'admin',
        refund_cents = booking.total_cents,
        refund_status = 'pending',
        payout_cents = 0,
        close_reason = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Refunded after a problem report'),
        updated_at = now()
    where id = booking.id;
    return jsonb_build_object(
      'bookingId', booking.id,
      'refundCents', booking.total_cents,
      'payoutCents', 0,
      'paymentIntentId', booking.stripe_payment_intent_id,
      'chargeId', booking.stripe_charge_id
    );
  end if;

  update public.bookings
  set problem_resolved_at = now(),
      problem_resolution = case when p_refund_cents = 0 then 'released' else 'partially_refunded' end,
      refund_cents = nullif(p_refund_cents, 0),
      refund_status = case when p_refund_cents > 0 then 'pending' else 'not_required' end,
      payout_cents = payout,
      close_reason = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = booking.id;

  if p_refund_cents = 0 then
    select * into names from private.booking_names(booking);
    perform private.post_booking_milestone(
      booking.id,
      'problem_released',
      'Hire Line Dancers reviewed the reported problem and released the payout to ' ||
        names.instructor_name || '. Next: nobody needs to act.'
    );
  end if;

  return jsonb_build_object(
    'bookingId', booking.id,
    'refundCents', p_refund_cents,
    'payoutCents', payout,
    'paymentIntentId', booking.stripe_payment_intent_id,
    'chargeId', booking.stripe_charge_id
  );
end;
$$;

create or replace function public.booking_record_dispute(
  p_charge_id text,
  p_dispute_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
begin
  perform private.require_service_role();
  select * into booking
  from public.bookings
  where stripe_charge_id = p_charge_id
  for update;
  if booking.id is null then
    return null;
  end if;
  update public.bookings
  set stripe_dispute_id = p_dispute_id,
      disputed_at = coalesce(disputed_at, now()),
      updated_at = now()
  where id = booking.id;
  perform private.post_booking_milestone(
    booking.id,
    'payment_disputed',
    'The payment for this booking was disputed with the card issuer or bank. Any payout not yet sent is paused while Hire Line Dancers responds. Next: Hire Line Dancers may contact you for details.'
  );
  return booking.id;
end;
$$;

create or replace function public.booking_sync_payout_account(
  p_instructor_profile_id uuid,
  p_stripe_account_id text,
  p_livemode boolean,
  p_details_submitted boolean,
  p_payouts_enabled boolean,
  p_transfers_capability text,
  p_requirements_currently_due text[],
  p_disabled_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.instructor_payout_accounts%rowtype;
begin
  perform private.require_service_role();
  insert into public.instructor_payout_accounts (
    instructor_profile_id,
    stripe_account_id,
    livemode,
    details_submitted,
    payouts_enabled,
    transfers_capability,
    requirements_currently_due,
    requirements_disabled_reason,
    last_synced_at,
    updated_at
  ) values (
    p_instructor_profile_id,
    p_stripe_account_id,
    p_livemode,
    coalesce(p_details_submitted, false),
    coalesce(p_payouts_enabled, false),
    case when p_transfers_capability in ('inactive', 'pending', 'active') then p_transfers_capability else 'unrequested' end,
    coalesce(p_requirements_currently_due, '{}'),
    left(p_disabled_reason, 200),
    now(),
    now()
  )
  on conflict (instructor_profile_id) do update set
    details_submitted = excluded.details_submitted,
    payouts_enabled = excluded.payouts_enabled,
    transfers_capability = excluded.transfers_capability,
    requirements_currently_due = excluded.requirements_currently_due,
    requirements_disabled_reason = excluded.requirements_disabled_reason,
    last_synced_at = now(),
    updated_at = now()
  where public.instructor_payout_accounts.stripe_account_id = excluded.stripe_account_id
  returning * into saved;
  if saved.instructor_profile_id is null then
    raise exception 'This instructor already has a different payout account';
  end if;
  return jsonb_build_object(
    'stripeAccountId', saved.stripe_account_id,
    'payoutsReady', private.instructor_payouts_ready(saved.instructor_profile_id),
    'detailsSubmitted', saved.details_submitted,
    'requirementsCurrentlyDue', saved.requirements_currently_due
  );
end;
$$;

create or replace function public.booking_record_stripe_event(
  p_event_id text,
  p_event_type text,
  p_booking_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_service_role();
  insert into public.booking_stripe_events (stripe_event_id, event_type, booking_id)
  values (p_event_id, p_event_type, p_booking_id)
  on conflict (stripe_event_id) do nothing;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Closing a conversation withdraws any unpaid quote
-- ---------------------------------------------------------------------------

create or replace function public.withdraw_quotes_when_thread_closes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_quote public.bookings%rowtype;
begin
  if new.status is not distinct from old.status
    or new.status not in ('declined', 'timed_out', 'withdrawn', 'closed') then
    return new;
  end if;
  for open_quote in
    select *
    from public.bookings
    where thread_id = new.id
      and status in ('quote_sent', 'awaiting_payment')
    for update
  loop
    update public.bookings
    set status = 'withdrawn',
        closed_at = now(),
        close_reason = 'The conversation was closed',
        updated_at = now()
    where id = open_quote.id;
    perform private.post_booking_milestone(
      open_quote.id,
      'withdrawn',
      'The open quote was withdrawn because this conversation was closed. Next: nobody needs to act.'
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists withdraw_quotes_when_thread_closes on public.inquiry_threads;
create trigger withdraw_quotes_when_thread_closes
  after update of status on public.inquiry_threads
  for each row execute function public.withdraw_quotes_when_thread_closes();

-- A paid booking keeps its conversation open so both parties can coordinate.
create or replace function public.protect_threads_with_paid_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('declined', 'withdrawn', 'closed', 'timed_out')
    and exists (
      select 1
      from public.bookings booking
      where booking.thread_id = new.id
        and booking.status in ('payment_processing', 'confirmed', 'completed')
    ) then
    raise exception 'This conversation has a paid booking. Cancel the booking instead';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_threads_with_paid_bookings on public.inquiry_threads;
create trigger protect_threads_with_paid_bookings
  before update of status on public.inquiry_threads
  for each row execute function public.protect_threads_with_paid_bookings();

-- ---------------------------------------------------------------------------
-- Contact details stay private until a booking is paid
-- ---------------------------------------------------------------------------

-- Same as the threaded messaging version, except that a retry whose stored
-- body was masked still matches the submitted original.
create or replace function public.send_inquiry_message(
  p_thread_id uuid,
  p_body text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_body text := nullif(trim(coalesce(p_body, '')), '');
  thread public.inquiry_threads%rowtype;
  participant public.inquiry_thread_participants%rowtype;
  existing public.inquiry_messages%rowtype;
  created_message public.inquiry_messages%rowtype;
  recipient_account_id uuid;
  recipient_email text;
  is_admin boolean := false;
  admin_static_reply boolean := false;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if clean_body is null then
    raise exception 'Message is required';
  end if;
  if char_length(clean_body) > 4000 then
    raise exception 'Message must be 4,000 characters or fewer';
  end if;
  if p_client_request_id is null then
    raise exception 'A client request ID is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 41));

  select * into existing
  from public.inquiry_messages
  where sender_account_id = caller_id
    and client_request_id = p_client_request_id;
  if existing.id is not null then
    if existing.thread_id <> p_thread_id
      or not private.inquiry_message_matches_submission(existing, clean_body) then
      raise exception 'Client request ID was already used for another message';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'thread_id', existing.thread_id,
      'sender_account_id', existing.sender_account_id,
      'message_kind', existing.message_kind,
      'body', existing.body,
      'client_request_id', existing.client_request_id,
      'created_at', existing.created_at
    );
  end if;

  select * into thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;
  if thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if thread.status not in ('awaiting_response', 'active') then
    raise exception 'This inquiry thread is closed for replies';
  end if;

  select * into participant
  from public.inquiry_thread_participants
  where thread_id = thread.id
    and account_id = caller_id
    and left_at is null;
  if participant.account_id is null then
    is_admin := public.is_marketplace_admin();
    if is_admin and thread.assignment_source = 'static_support' then
      admin_static_reply := true;
    else
      raise exception 'Inquiry thread not found or access denied';
    end if;
  end if;

  if (
    select count(*)
    from public.inquiry_messages message
    where message.sender_account_id = caller_id
      and message.created_at >= now() - interval '1 minute'
  ) >= 20 then
    raise exception 'Message limit reached. Please try again shortly';
  end if;
  if (
    select count(*)
    from public.inquiry_messages message
    where message.sender_account_id = caller_id
      and message.created_at >= now() - interval '1 day'
  ) >= 500 then
    raise exception 'Daily message limit reached';
  end if;

  insert into public.inquiry_messages (
    thread_id,
    sender_account_id,
    message_kind,
    body,
    client_request_id
  ) values (
    thread.id,
    caller_id,
    'participant',
    clean_body,
    p_client_request_id
  ) returning * into created_message;

  if admin_static_reply then
    insert into public.inquiry_admin_access_events (
      thread_id,
      admin_account_id,
      action
    ) values (
      thread.id,
      caller_id,
      'sent'
    );
  end if;

  update public.inquiry_threads
  set status = case
        when participant.participant_role = 'instructor' then 'active'
        else status
      end,
      first_instructor_message_at = case
        when participant.participant_role = 'instructor'
          then coalesce(first_instructor_message_at, created_message.created_at)
        else first_instructor_message_at
      end,
      last_message_id = created_message.id,
      last_message_at = created_message.created_at,
      updated_at = now()
  where id = thread.id;

  update public.inquiry_thread_participants
  set last_read_message_id = created_message.id,
      last_read_at = created_message.created_at,
      updated_at = now()
  where thread_id = thread.id
    and account_id = caller_id;

  if participant.participant_role = 'instructor'
    and thread.first_instructor_message_at is null then
    update public.inquiries
    set first_responded_at = coalesce(first_responded_at, created_message.created_at),
        status = case
          when status in ('submitted', 'viewed') then 'responded'
          else status
        end,
        updated_at = now()
    where id = thread.inquiry_id;
    perform private.cancel_inquiry_thread_response_jobs(
      thread.id,
      'Instructor responded before the reminder was sent'
    );
  end if;

  select
    other.account_id,
    case
      when other.participant_role = 'instructor' then
        coalesce(settings.inquiry_email, account.email)
      else account.email
    end
  into recipient_account_id, recipient_email
  from public.inquiry_thread_participants other
  join public.accounts account on account.id = other.account_id
  left join public.instructor_profiles profile
    on profile.account_id = other.account_id
   and profile.id = thread.instructor_profile_id
  left join public.instructor_private_settings settings
    on settings.instructor_profile_id = profile.id
  where other.thread_id = thread.id
    and other.account_id <> caller_id
    and other.left_at is null
  limit 1;

  if recipient_email is null
    and thread.assignment_source = 'static_support'
    and participant.participant_role = 'organizer' then
    select recipient.delivered_to_email
    into recipient_email
    from public.inquiry_recipients recipient
    where recipient.id = thread.inquiry_recipient_id;
    recipient_account_id := null;
  end if;

  if recipient_email is not null then
    insert into public.inquiry_thread_notification_jobs (
      thread_id,
      inquiry_recipient_id,
      message_id,
      recipient_account_id,
      recipient_email,
      notification_type,
      dedupe_key
    ) values (
      thread.id,
      thread.inquiry_recipient_id,
      created_message.id,
      recipient_account_id,
      recipient_email,
      'new_message',
      'thread:' || thread.id::text || ':message:' || created_message.id::text ||
        ':recipient:' || coalesce(recipient_account_id::text, 'static-support')
    ) on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'id', created_message.id,
    'thread_id', created_message.thread_id,
    'sender_account_id', created_message.sender_account_id,
    'message_kind', created_message.message_kind,
    'body', created_message.body,
    'client_request_id', created_message.client_request_id,
    'created_at', created_message.created_at
  );
end;
$$;


-- Same as the threaded messaging version, except that an instructor sees the
-- organizer's email, phone, and unmasked inquiry message only after a booking
-- in this thread is paid.
create or replace function public.get_inquiry_thread(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  is_admin boolean;
  caller_role text;
  is_current_assignment boolean := true;
  result jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  is_admin := public.is_marketplace_admin();
  if not is_admin and not private.is_inquiry_thread_participant(p_thread_id) then
    raise exception 'Inquiry thread not found or access denied';
  end if;

  if not is_admin then
    select
      participant.participant_role,
      not exists (
        select 1
        from public.inquiry_threads newer_thread
        where newer_thread.inquiry_id = thread.inquiry_id
          and newer_thread.assignment_order > thread.assignment_order
      )
    into caller_role, is_current_assignment
    from public.inquiry_threads thread
    join public.inquiry_thread_participants participant
      on participant.thread_id = thread.id
     and participant.account_id = caller_id
     and participant.left_at is null
    where thread.id = p_thread_id;
  end if;

  if is_admin then
    insert into public.inquiry_admin_access_events (
      thread_id,
      admin_account_id,
      action
    ) values (
      p_thread_id,
      caller_id,
      'opened'
    );
  end if;

  select jsonb_build_object(
    'thread', to_jsonb(thread) || jsonb_build_object(
      'is_current_assignment',
      is_admin or caller_role = 'organizer' or is_current_assignment
    ),
    'inquiry', case
      when is_admin or caller_role = 'organizer' then
        to_jsonb(inquiry) - 'messaging_search_vector'
      when is_current_assignment and private.thread_has_paid_booking(thread.id) then
        to_jsonb(inquiry) - 'messaging_search_vector'
      when is_current_assignment then
        (to_jsonb(inquiry) - array[
          'messaging_search_vector',
          'email',
          'contact_email',
          'contact_phone_e164'
        ]::text[]) || jsonb_build_object(
          'message', private.mask_contact_details(inquiry.message)
        )
      else
        to_jsonb(inquiry) - array[
          'messaging_search_vector',
          'email',
          'contact_email',
          'contact_phone_e164',
          'message',
          'status',
          'first_viewed_at',
          'first_responded_at',
          'closed_at',
          'updated_at',
          'booking_outcome',
          'booked_instructor_profile_id',
          'booking_value_cents',
          'booking_event_date',
          'outcome_note',
          'outcome_reported_by',
          'outcome_reported_at',
          'outcome_followup_count',
          'outcome_last_asked_at',
          'outcome_next_ask_at',
          'completion_status',
          'completion_reported_at',
          'completion_reported_by',
          'completion_followup_count',
          'completion_last_asked_at',
          'completion_next_ask_at',
          'fallback_consent',
          'fallback_consent_at'
        ]::text[]
    end,
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'account_id', participant.account_id,
          'participant_role', participant.participant_role,
          'display_name', account.full_name,
          'joined_at', participant.joined_at,
          'last_read_message_id', participant.last_read_message_id,
          'last_read_at', participant.last_read_at,
          'archived_at', participant.archived_at
        ) order by participant.participant_role
      )
      from public.inquiry_thread_participants participant
      join public.accounts account on account.id = participant.account_id
      where participant.thread_id = thread.id
        and participant.left_at is null
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'thread_id', recent.thread_id,
          'sender_account_id', recent.sender_account_id,
          'sender_role', recent.sender_role,
          'body', recent.body,
          'message_type', recent.message_kind,
          'created_at', recent.created_at,
          'redacted_at', recent.redacted_at,
          'sender_name', recent.sender_name,
          'client_request_id', recent.client_request_id
        ) order by recent.id
      )
      from (
        select
          message.id,
          message.thread_id,
          message.sender_account_id,
          account.full_name as sender_name,
          coalesce(
            participant.participant_role,
            case
              when message.message_kind = 'system' then 'system'
              when exists (
                select 1
                from public.inquiry_admin_access_events access_event
                where access_event.thread_id = message.thread_id
                  and access_event.admin_account_id = message.sender_account_id
                  and access_event.action = 'sent'
              ) then 'admin'
            end
          ) as sender_role,
          message.message_kind,
          message.body,
          message.client_request_id,
          message.created_at,
          message.redacted_at
        from public.inquiry_messages message
        left join public.accounts account on account.id = message.sender_account_id
        left join public.inquiry_thread_participants participant
          on participant.thread_id = message.thread_id
         and participant.account_id = message.sender_account_id
        where message.thread_id = thread.id
        order by message.id desc
        limit 500
      ) recent
    ), '[]'::jsonb),
    'message_count', (
      select count(*) from public.inquiry_messages where thread_id = thread.id
    ),
    'admin_notes', case when is_admin then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', note.id,
          'author_account_id', note.author_account_id,
          'author_name', account.full_name,
          'note', note.note,
          'created_at', note.created_at
        ) order by note.id
      )
      from public.inquiry_admin_notes note
      left join public.accounts account on account.id = note.author_account_id
      where note.thread_id = thread.id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result
  from public.inquiry_threads thread
  join public.inquiries inquiry on inquiry.id = thread.inquiry_id
  where thread.id = p_thread_id;

  if result is null then
    raise exception 'Inquiry thread not found';
  end if;
  return result;
end;
$$;


-- Instructors read inquiries through get_inquiry_thread. Direct table reads
-- are limited to organizers, administrators, and instructors with a paid
-- booking for the inquiry.
drop policy if exists "participants read inquiries" on public.inquiries;
create policy "participants read inquiries"
  on public.inquiries
  for select to authenticated
  using (
    organizer_account_id = (select auth.uid())
    or public.is_marketplace_admin()
    or (
      private.is_current_inquiry_assignment_participant(id)
      and exists (
        select 1
        from public.bookings booking
        where booking.inquiry_id = inquiries.id
          and booking.paid_at is not null
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

create trigger set_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger set_instructor_payout_accounts_updated_at
  before update on public.instructor_payout_accounts
  for each row execute function public.set_updated_at();

alter table public.instructor_payout_accounts enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_signatures enable row level security;
alter table public.booking_milestones enable row level security;
alter table public.booking_stripe_events enable row level security;
alter table public.inquiry_message_originals enable row level security;

create policy "instructors and admins read payout accounts"
  on public.instructor_payout_accounts
  for select to authenticated
  using (
    exists (
      select 1
      from public.instructor_profiles profile
      where profile.id = instructor_payout_accounts.instructor_profile_id
        and profile.account_id = (select auth.uid())
    )
    or public.is_marketplace_admin()
  );

create policy "participants and admins read bookings"
  on public.bookings
  for select to authenticated
  using (
    organizer_account_id = (select auth.uid())
    or instructor_account_id = (select auth.uid())
    or public.is_marketplace_admin()
  );

create policy "admins read booking signatures"
  on public.booking_signatures
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read booking milestones"
  on public.booking_milestones
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read booking stripe events"
  on public.booking_stripe_events
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read original message text"
  on public.inquiry_message_originals
  for select to authenticated
  using (public.is_marketplace_admin());

revoke all on public.instructor_payout_accounts from public, anon, authenticated;
revoke all on public.bookings from public, anon, authenticated;
revoke all on public.booking_signatures from public, anon, authenticated;
revoke all on public.booking_milestones from public, anon, authenticated;
revoke all on public.booking_stripe_events from public, anon, authenticated;
revoke all on public.inquiry_message_originals from public, anon, authenticated;

grant select on public.instructor_payout_accounts to authenticated;
grant select on public.bookings to authenticated;
grant select on public.booking_signatures to authenticated;
grant select on public.booking_milestones to authenticated;
grant select on public.booking_stripe_events to authenticated;
grant select on public.inquiry_message_originals to authenticated;

grant all on public.instructor_payout_accounts to service_role;
grant all on public.bookings to service_role;
grant all on public.booking_signatures to service_role;
grant all on public.booking_milestones to service_role;
grant all on public.booking_stripe_events to service_role;
grant all on public.inquiry_message_originals to service_role;
grant usage, select on sequence public.booking_signatures_id_seq to service_role;

-- Helpers in the private schema are never callable from the browser.
revoke all on function private.valid_cancellation_windows(jsonb) from public, anon;
revoke all on function private.standard_cancellation_windows() from public, anon;
revoke all on function private.instructor_payouts_ready(uuid) from public, anon, authenticated;
revoke all on function private.booking_money(integer) from public, anon, authenticated;
revoke all on function private.booking_local_date(timestamptz, text) from public, anon, authenticated;
revoke all on function private.booking_local_time(time) from public, anon, authenticated;
revoke all on function private.booking_first_name(text) from public, anon, authenticated;
revoke all on function private.booking_names(public.bookings) from public, anon, authenticated;
revoke all on function private.booking_cancellation_split(public.bookings, text, timestamptz) from public, anon, authenticated;
revoke all on function private.booking_cancellation_summary(jsonb) from public, anon, authenticated;
revoke all on function private.mask_contact_details(text) from public, anon, authenticated;
revoke all on function private.thread_has_paid_booking(uuid) from public, anon, authenticated;
revoke all on function private.inquiry_message_matches_submission(public.inquiry_messages, text) from public, anon, authenticated;
revoke all on function private.booking_json(public.bookings, text) from public, anon, authenticated;
revoke all on function private.require_service_role() from public, anon, authenticated;
-- Check constraints on instructor_private_settings call these as the writer.
grant execute on function private.valid_cancellation_windows(jsonb) to authenticated, service_role;
grant execute on function private.standard_cancellation_windows() to authenticated, service_role;

revoke all on function public.mask_unbooked_message_contact_details() from public, anon, authenticated;
revoke all on function public.withdraw_quotes_when_thread_closes() from public, anon, authenticated;
revoke all on function public.protect_threads_with_paid_bookings() from public, anon, authenticated;
revoke all on function public.protect_booking_signature_immutability() from public, anon, authenticated;

revoke all on function public.get_thread_booking(uuid) from public, anon, service_role;
grant execute on function public.get_thread_booking(uuid) to authenticated;
revoke all on function public.decline_booking_quote(uuid, text) from public, anon, service_role;
grant execute on function public.decline_booking_quote(uuid, text) to authenticated;
revoke all on function public.withdraw_booking_quote(uuid) from public, anon, service_role;
grant execute on function public.withdraw_booking_quote(uuid) to authenticated;
revoke all on function public.report_booking_problem(uuid, text) from public, anon, service_role;
grant execute on function public.report_booking_problem(uuid, text) to authenticated;

do $$
declare
  service_function text;
begin
  foreach service_function in array array[
    'public.booking_create_quote(jsonb)',
    'public.booking_record_organizer_signature(uuid, uuid, text, text, text, text, text)',
    'public.booking_attach_checkout_session(uuid, text)',
    'public.booking_apply_payment(uuid, text, text, text, text, text, integer, text)',
    'public.booking_expire_due_quotes()',
    'public.booking_post_due_reminders()',
    'public.booking_claim_due_transfers(integer)',
    'public.booking_record_transfer(uuid, text, integer)',
    'public.booking_record_transfer_error(uuid, text)',
    'public.booking_prepare_cancellation(uuid, uuid, text, boolean)',
    'public.booking_record_refund(uuid, text, text, text)',
    'public.booking_finish_cancellation_without_refund(uuid)',
    'public.booking_prepare_problem_resolution(uuid, uuid, integer, text)',
    'public.booking_record_dispute(text, text)',
    'public.booking_sync_payout_account(uuid, text, boolean, boolean, boolean, text, text[], text)',
    'public.booking_record_stripe_event(text, text, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', service_function);
    execute format('grant execute on function %s to service_role', service_function);
  end loop;
end;
$$;

grant execute on function private.require_service_role() to service_role;

-- Booking milestones arrive as inquiry messages, which the inbox already
-- receives in realtime. Bookings are added so open booking panels refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'bookings'
    ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stripe webhook endpoints, provisioned by booking-scheduler
-- ---------------------------------------------------------------------------

-- The scheduler creates the booking webhook endpoints in Stripe with the
-- platform secret key and stores their signing secrets here, so no signing
-- secret has to be copied by hand. Secrets are kept in Supabase Vault when
-- it is available.
create table private.booking_webhook_endpoints (
  kind text primary key,
  stripe_endpoint_id text not null,
  url text not null,
  livemode boolean not null,
  vault_secret_name text,
  signing_secret text,
  created_at timestamptz not null default now(),
  constraint booking_webhook_endpoints_kind_check check (kind in ('platform', 'connect')),
  constraint booking_webhook_endpoints_id_check check (stripe_endpoint_id ~ '^we_[A-Za-z0-9]+$'),
  constraint booking_webhook_endpoints_secret_check check (
    (vault_secret_name is not null) <> (signing_secret is not null)
  )
);

revoke all on private.booking_webhook_endpoints from public, anon, authenticated;

create or replace function public.booking_save_webhook_endpoint(
  p_kind text,
  p_endpoint_id text,
  p_url text,
  p_livemode boolean,
  p_signing_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_name text := 'hld_booking_webhook_' || p_kind;
  has_vault boolean := exists (select 1 from pg_namespace where nspname = 'vault');
begin
  perform private.require_service_role();
  if p_signing_secret !~ '^whsec_[A-Za-z0-9]+$' then
    raise exception 'Invalid webhook signing secret';
  end if;
  if has_vault then
    if exists (select 1 from vault.secrets where name = secret_name) then
      execute 'select vault.update_secret((select id from vault.secrets where name = $1), $2)'
        using secret_name, p_signing_secret;
    else
      execute 'select vault.create_secret($1, $2, $3)'
        using p_signing_secret, secret_name, 'Stripe signing secret for Hire Line Dancers booking webhooks';
    end if;
  end if;
  insert into private.booking_webhook_endpoints (
    kind, stripe_endpoint_id, url, livemode, vault_secret_name, signing_secret
  ) values (
    p_kind,
    p_endpoint_id,
    p_url,
    p_livemode,
    case when has_vault then secret_name end,
    case when has_vault then null else p_signing_secret end
  )
  on conflict (kind) do update set
    stripe_endpoint_id = excluded.stripe_endpoint_id,
    url = excluded.url,
    livemode = excluded.livemode,
    vault_secret_name = excluded.vault_secret_name,
    signing_secret = excluded.signing_secret,
    created_at = now();
end;
$$;

create or replace function public.booking_webhook_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb := '{}'::jsonb;
  endpoint record;
  secret text;
begin
  perform private.require_service_role();
  for endpoint in select * from private.booking_webhook_endpoints
  loop
    secret := endpoint.signing_secret;
    if endpoint.vault_secret_name is not null then
      execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
        into secret
        using endpoint.vault_secret_name;
    end if;
    result := result || jsonb_build_object(
      endpoint.kind,
      jsonb_build_object(
        'endpointId', endpoint.stripe_endpoint_id,
        'url', endpoint.url,
        'livemode', endpoint.livemode,
        'secret', secret
      )
    );
  end loop;
  return result;
end;
$$;

revoke all on function public.booking_save_webhook_endpoint(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.booking_save_webhook_endpoint(text, text, text, boolean, text) to service_role;
revoke all on function public.booking_webhook_config() from public, anon, authenticated;
grant execute on function public.booking_webhook_config() to service_role;

-- ---------------------------------------------------------------------------
-- Run booking-scheduler every minute
-- ---------------------------------------------------------------------------

-- Reuses the Vault secrets that schedule process-inquiry-notifications. When
-- they are missing (for example in local development), schedule the worker
-- by hand as described in SUPABASE_SETUP.md.
do $$
declare
  ready boolean := false;
  vault_secret_count integer := 0;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
    and exists (select 1 from pg_extension where extname = 'pg_net')
    and exists (select 1 from pg_namespace where nspname = 'vault') then
    execute $check$
      select count(*) from vault.secrets
      where name in ('hld_project_url', 'hld_notification_worker_key')
    $check$ into vault_secret_count;
    ready := vault_secret_count = 2;
  end if;
  if ready then
    execute $unschedule$
      select cron.unschedule(jobid) from cron.job where jobname = 'process-hld-bookings'
    $unschedule$;
    perform cron.schedule(
      'process-hld-bookings',
      '* * * * *',
      $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'hld_project_url'
        ) || '/functions/v1/booking-scheduler',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'hld_notification_worker_key'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
      $job$
    );
  else
    raise notice 'booking-scheduler was not scheduled automatically. Schedule it with Supabase Cron.';
  end if;
end;
$$;
