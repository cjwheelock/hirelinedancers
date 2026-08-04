-- Email-only inquiry delivery, founding guarantee operations, and verified refunds.
-- Apply after 202608040001_admin_analytics_and_inquiry_followups.sql.

-- SMS is temporarily paused. Preserve the schema and historical records so the
-- feature can be restored later without losing consent or delivery history.
update public.instructor_private_settings
set sms_notifications_enabled = false,
    sms_opted_out_at = coalesce(sms_opted_out_at, now()),
    updated_at = now()
where sms_notifications_enabled;

update public.accounts
set sms_opt_in = false,
    updated_at = now()
where sms_opt_in;

update public.inquiry_notification_jobs
set status = 'canceled',
    completed_at = now(),
    locked_at = null,
    last_error = 'SMS notifications are temporarily paused'
where channel = 'sms'
  and status in ('pending', 'processing');

update public.inquiry_recipients recipient
set sms_delivery_status = 'not_requested',
    updated_at = now()
where recipient.sms_delivery_status = 'queued'
  and exists (
    select 1
    from public.inquiry_notification_jobs job
    where job.inquiry_recipient_id = recipient.id
      and job.channel = 'sms'
      and job.status = 'canceled'
  );

-- Keep server-side writes email-only too. This prevents an older browser tab or
-- API client from silently re-enabling SMS while the feature is paused. The
-- phone and consent history remain available for a later, explicit relaunch.
create or replace function public.force_account_sms_paused()
returns trigger
language plpgsql
as $$
begin
  new.sms_opt_in := false;
  return new;
end;
$$;

drop trigger if exists force_account_sms_paused on public.accounts;
create trigger force_account_sms_paused
  before insert or update of sms_opt_in on public.accounts
  for each row execute function public.force_account_sms_paused();

create or replace function public.force_instructor_sms_paused()
returns trigger
language plpgsql
as $$
begin
  new.sms_notifications_enabled := false;
  return new;
end;
$$;

drop trigger if exists force_instructor_sms_paused on public.instructor_private_settings;
create trigger force_instructor_sms_paused
  before insert or update of sms_notifications_enabled on public.instructor_private_settings
  for each row execute function public.force_instructor_sms_paused();

create or replace function public.create_inquiry_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.instructor_private_settings;
  recipient_id uuid;
  delivery_email text;
begin
  if new.instructor_profile_id is null then
    delivery_email := 'hello@hirelinedancers.com';
  else
    select * into settings
    from public.instructor_private_settings
    where instructor_profile_id = new.instructor_profile_id;
    delivery_email := settings.inquiry_email;
  end if;

  if delivery_email is null then
    raise exception 'This instructor has not configured inquiry delivery';
  end if;

  insert into public.inquiry_recipients (
    inquiry_id,
    instructor_profile_id,
    delivered_to_email,
    delivered_to_phone_e164,
    sms_delivery_status
  ) values (
    new.id,
    new.instructor_profile_id,
    delivery_email,
    null,
    'not_requested'
  ) returning id into recipient_id;

  insert into public.inquiry_notification_jobs (inquiry_recipient_id, channel)
  values (recipient_id, 'email');

  return new;
end;
$$;

-- An organizer outcome is useful evidence, but it must not suppress the
-- instructor's one-week follow-up. Only the contacted instructor clears it.
create or replace function public.report_booking_outcome(
  p_inquiry_id uuid,
  p_outcome text,
  p_booking_value_cents integer default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inquiry public.inquiries;
  is_recipient boolean;
  resolved_outcome text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_outcome not in ('booked', 'not_booked', 'still_deciding', 'no_response') then
    raise exception 'Invalid booking outcome';
  end if;
  if p_booking_value_cents is not null and p_booking_value_cents < 0 then
    raise exception 'Booking value cannot be negative';
  end if;

  select * into inquiry
  from public.inquiries
  where id = p_inquiry_id
  for update;
  if inquiry.id is null then
    raise exception 'Inquiry not found';
  end if;

  select exists (
    select 1
    from public.inquiry_recipients recipient
    join public.instructor_profiles profile on profile.id = recipient.instructor_profile_id
    where recipient.inquiry_id = p_inquiry_id
      and profile.account_id = auth.uid()
  ) into is_recipient;

  if inquiry.organizer_account_id <> auth.uid()
    and not is_recipient
    and not public.is_marketplace_admin() then
    raise exception 'Not allowed to report this outcome';
  end if;

  insert into public.inquiry_outcome_reports (
    inquiry_id,
    reporter_account_id,
    outcome,
    booking_value_cents,
    note
  ) values (
    p_inquiry_id,
    auth.uid(),
    p_outcome,
    p_booking_value_cents,
    nullif(trim(p_note), '')
  )
  on conflict (inquiry_id, reporter_account_id) do update set
    outcome = excluded.outcome,
    booking_value_cents = excluded.booking_value_cents,
    note = excluded.note,
    updated_at = now();

  select case
    when bool_or(outcome = 'booked') and bool_or(outcome = 'not_booked') then 'disputed'
    when bool_or(outcome = 'booked') then 'booked'
    when bool_or(outcome = 'not_booked') then 'not_booked'
    when bool_or(outcome = 'still_deciding') then 'still_deciding'
    else 'no_response'
  end
  into resolved_outcome
  from public.inquiry_outcome_reports
  where inquiry_id = p_inquiry_id;

  update public.inquiries set
    booking_outcome = resolved_outcome,
    booking_value_cents = case
      when resolved_outcome = 'booked' then p_booking_value_cents
      else booking_value_cents
    end,
    outcome_note = nullif(trim(p_note), ''),
    outcome_reported_by = auth.uid(),
    outcome_reported_at = now(),
    outcome_next_ask_at = case
      when is_recipient then null
      else outcome_next_ask_at
    end,
    status = case
      when resolved_outcome = 'booked' then 'booked'
      when resolved_outcome = 'not_booked' then 'not_booked'
      when status in ('booked', 'not_booked') and first_responded_at is not null then 'responded'
      when status in ('booked', 'not_booked') then 'submitted'
      else status
    end,
    closed_at = case
      when resolved_outcome in ('booked', 'not_booked') then now()
      else null
    end
  where id = p_inquiry_id;
end;
$$;

create table if not exists public.instructor_guarantees (
  instructor_profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  founding_member_number smallint unique,
  founding_status text not null default 'unassigned',
  founding_assigned_at timestamptz,
  founding_ended_at timestamptz,
  founding_ended_reason text,
  guarantee_status text not null default 'not_started',
  guarantee_terms_version text not null default '2026-08-04',
  guarantee_started_at timestamptz,
  guarantee_ends_at timestamptz,
  claim_deadline_at timestamptz,
  first_stripe_customer_id text,
  first_stripe_subscription_id text,
  coverage_issue_at timestamptz,
  coverage_issue_reason text,
  admin_note text,
  refunded_at timestamptz,
  updated_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_guarantees_founding_number_check check (
    founding_member_number is null or founding_member_number between 1 and 100
  ),
  constraint instructor_guarantees_founding_status_check check (
    founding_status in ('unassigned', 'reserved', 'active', 'ended', 'not_available')
  ),
  constraint instructor_guarantees_status_check check (
    guarantee_status in (
      'not_started', 'covered', 'claim_eligible', 'fulfilled', 'ineligible',
      'claim_received', 'under_review', 'approved', 'denied', 'refunded', 'expired'
    )
  ),
  constraint instructor_guarantees_dates_check check (
    guarantee_ends_at is null
    or guarantee_started_at is null
    or guarantee_ends_at >= guarantee_started_at
  ),
  constraint instructor_guarantees_deadline_check check (
    claim_deadline_at is null
    or guarantee_ends_at is null
    or claim_deadline_at >= guarantee_ends_at
  ),
  constraint instructor_guarantees_note_check check (
    admin_note is null or char_length(admin_note) <= 4000
  )
);

create table if not exists public.guarantee_claims (
  id uuid primary key default gen_random_uuid(),
  instructor_profile_id uuid not null unique references public.instructor_profiles(id) on delete cascade,
  received_at timestamptz not null default now(),
  received_via text not null default 'email',
  claimant_email text,
  status text not null default 'received',
  requested_amount_cents integer,
  approved_refund_amount_cents integer,
  currency text not null default 'usd',
  instructor_message text,
  profile_complete_confirmed boolean not null default false,
  contact_details_current_confirmed boolean not null default false,
  response_requirement_confirmed boolean not null default false,
  qualifying_booking_count integer not null default 0,
  admin_note text,
  decision_reason text,
  created_by uuid references public.accounts(id) on delete set null,
  decided_by uuid references public.accounts(id) on delete set null,
  decided_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guarantee_claims_received_via_check check (
    received_via in ('email', 'phone', 'admin', 'other')
  ),
  constraint guarantee_claims_status_check check (
    status in (
      'received', 'in_review', 'approved', 'denied', 'withdrawn',
      'refund_pending', 'partially_refunded', 'refunded'
    )
  ),
  constraint guarantee_claims_requested_amount_check check (
    requested_amount_cents is null or requested_amount_cents > 0
  ),
  constraint guarantee_claims_approved_amount_check check (
    approved_refund_amount_cents is null or approved_refund_amount_cents > 0
  ),
  constraint guarantee_claims_currency_check check (currency = 'usd'),
  constraint guarantee_claims_message_check check (
    instructor_message is null or char_length(instructor_message) <= 4000
  ),
  constraint guarantee_claims_note_check check (
    admin_note is null or char_length(admin_note) <= 4000
  ),
  constraint guarantee_claims_reason_check check (
    decision_reason is null or char_length(decision_reason) <= 2000
  )
);

create table if not exists public.membership_refunds (
  id uuid primary key default gen_random_uuid(),
  guarantee_claim_id uuid not null references public.guarantee_claims(id) on delete restrict,
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete restrict,
  stripe_refund_id text not null unique,
  stripe_customer_id text not null,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  amount_cents integer not null,
  currency text not null,
  stripe_status text not null,
  stripe_created_at timestamptz,
  verified_at timestamptz not null default now(),
  recorded_by uuid references public.accounts(id) on delete set null,
  last_stripe_event_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_refunds_amount_check check (amount_cents > 0),
  constraint membership_refunds_currency_check check (currency = 'usd'),
  constraint membership_refunds_status_check check (
    stripe_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')
  ),
  constraint membership_refunds_id_check check (stripe_refund_id ~ '^re_[A-Za-z0-9]+$')
);

create table if not exists public.membership_admin_events (
  id bigint generated by default as identity primary key,
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  guarantee_claim_id uuid references public.guarantee_claims(id) on delete set null,
  membership_refund_id uuid references public.membership_refunds(id) on delete set null,
  actor_account_id uuid references public.accounts(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint membership_admin_events_type_check check (
    event_type in (
      'founding_assigned', 'guarantee_updated', 'guarantee_fulfilled',
      'claim_received', 'claim_reviewed', 'refund_verified', 'benefits_ended'
    )
  )
);

drop trigger if exists set_instructor_guarantees_updated_at on public.instructor_guarantees;
create trigger set_instructor_guarantees_updated_at
  before update on public.instructor_guarantees
  for each row execute function public.set_updated_at();

drop trigger if exists set_guarantee_claims_updated_at on public.guarantee_claims;
create trigger set_guarantee_claims_updated_at
  before update on public.guarantee_claims
  for each row execute function public.set_updated_at();

drop trigger if exists set_membership_refunds_updated_at on public.membership_refunds;
create trigger set_membership_refunds_updated_at
  before update on public.membership_refunds
  for each row execute function public.set_updated_at();

alter table public.instructor_guarantees enable row level security;
alter table public.guarantee_claims enable row level security;
alter table public.membership_refunds enable row level security;
alter table public.membership_admin_events enable row level security;

drop policy if exists "admins read instructor guarantees" on public.instructor_guarantees;
create policy "admins read instructor guarantees" on public.instructor_guarantees
  for select to authenticated using (public.is_marketplace_admin());

drop policy if exists "admins read guarantee claims" on public.guarantee_claims;
create policy "admins read guarantee claims" on public.guarantee_claims
  for select to authenticated using (public.is_marketplace_admin());

drop policy if exists "admins read membership refunds" on public.membership_refunds;
create policy "admins read membership refunds" on public.membership_refunds
  for select to authenticated using (public.is_marketplace_admin());

drop policy if exists "admins read membership events" on public.membership_admin_events;
create policy "admins read membership events" on public.membership_admin_events
  for select to authenticated using (public.is_marketplace_admin());

create or replace function public.assign_founding_guarantee_from_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number smallint;
  coverage_start timestamptz;
  existing_guarantee public.instructor_guarantees;
begin
  if new.status not in ('trialing', 'active') then
    return new;
  end if;

  coverage_start := coalesce(new.stripe_created_at, new.created_at, now());
  perform pg_advisory_xact_lock(hashtextextended('hire-line-dancers-founding-members', 0));

  select * into existing_guarantee
  from public.instructor_guarantees guarantee
  where guarantee.instructor_profile_id = new.instructor_profile_id
  for update;

  if existing_guarantee.instructor_profile_id is null
    or (
      existing_guarantee.founding_member_number is null
      and existing_guarantee.founding_status in ('unassigned', 'reserved')
    ) then
    select slot::smallint into next_number
    from generate_series(1, 100) slot
    where not exists (
      select 1
      from public.instructor_guarantees guarantee
      where guarantee.founding_member_number = slot
    )
    order by slot
    limit 1;

    insert into public.instructor_guarantees as guarantee_record (
      instructor_profile_id,
      founding_member_number,
      founding_status,
      founding_assigned_at,
      guarantee_status,
      guarantee_started_at,
      guarantee_ends_at,
      claim_deadline_at,
      first_stripe_customer_id,
      first_stripe_subscription_id
    ) values (
      new.instructor_profile_id,
      next_number,
      case when next_number is null then 'not_available' else 'active' end,
      case when next_number is null then null else now() end,
      case when next_number is null then 'ineligible' else 'covered' end,
      case when next_number is null then null else coverage_start end,
      case when next_number is null then null else coverage_start + interval '1 year' end,
      case when next_number is null then null else coverage_start + interval '1 year 30 days' end,
      case when next_number is null then null else new.stripe_customer_id end,
      case when next_number is null then null else new.stripe_subscription_id end
    )
    on conflict (instructor_profile_id) do update set
      founding_member_number = excluded.founding_member_number,
      founding_status = excluded.founding_status,
      founding_assigned_at = excluded.founding_assigned_at,
      guarantee_status = case
        when guarantee_record.guarantee_status in (
          'fulfilled', 'approved', 'denied', 'refunded', 'expired'
        ) then guarantee_record.guarantee_status
        else excluded.guarantee_status
      end,
      guarantee_started_at = coalesce(guarantee_record.guarantee_started_at, excluded.guarantee_started_at),
      guarantee_ends_at = coalesce(guarantee_record.guarantee_ends_at, excluded.guarantee_ends_at),
      claim_deadline_at = coalesce(guarantee_record.claim_deadline_at, excluded.claim_deadline_at),
      first_stripe_customer_id = coalesce(guarantee_record.first_stripe_customer_id, excluded.first_stripe_customer_id),
      first_stripe_subscription_id = coalesce(guarantee_record.first_stripe_subscription_id, excluded.first_stripe_subscription_id);

    if next_number is not null then
      insert into public.membership_admin_events (
        instructor_profile_id, event_type, detail
      ) values (
        new.instructor_profile_id,
        'founding_assigned',
        jsonb_build_object('founding_member_number', next_number)
      );
    end if;
  else
    update public.instructor_guarantees
    set founding_status = case
          when founding_status = 'reserved' then 'active'
          else founding_status
        end,
        founding_assigned_at = case
          when founding_status = 'reserved' then coalesce(founding_assigned_at, now())
          else founding_assigned_at
        end,
        guarantee_status = case
          when founding_status = 'reserved' and guarantee_status = 'not_started' then 'covered'
          else guarantee_status
        end,
        guarantee_started_at = coalesce(guarantee_started_at, coverage_start),
        guarantee_ends_at = coalesce(guarantee_ends_at, coverage_start + interval '1 year'),
        claim_deadline_at = coalesce(claim_deadline_at, coverage_start + interval '1 year 30 days'),
        first_stripe_customer_id = coalesce(first_stripe_customer_id, new.stripe_customer_id),
        first_stripe_subscription_id = coalesce(first_stripe_subscription_id, new.stripe_subscription_id)
    where instructor_profile_id = new.instructor_profile_id
      and founding_member_number is not null;
  end if;

  return new;
end;
$$;

-- Backfill first-subscription snapshots before enabling automatic assignment.
with ranked_memberships as (
  select
    membership.*,
    row_number() over (
      order by coalesce(membership.stripe_created_at, membership.created_at), membership.instructor_profile_id
    ) as founding_rank
  from public.instructor_memberships membership
), prepared as (
  select
    ranked.*,
    coalesce(ranked.stripe_created_at, ranked.created_at) as coverage_start
  from ranked_memberships ranked
)
insert into public.instructor_guarantees (
  instructor_profile_id,
  founding_member_number,
  founding_status,
  founding_assigned_at,
  guarantee_status,
  guarantee_started_at,
  guarantee_ends_at,
  claim_deadline_at,
  first_stripe_customer_id,
  first_stripe_subscription_id
)
select
  prepared.instructor_profile_id,
  case when prepared.founding_rank <= 100 then prepared.founding_rank::smallint end,
  case
    when prepared.founding_rank > 100 then 'not_available'
    when prepared.status in ('trialing', 'active') then 'active'
    else 'ended'
  end,
  case when prepared.founding_rank <= 100 then prepared.coverage_start end,
  case
    when prepared.founding_rank > 100 then 'ineligible'
    when now() > prepared.coverage_start + interval '1 year 30 days' then 'expired'
    when prepared.status in ('trialing', 'active') then 'covered'
    else 'ineligible'
  end,
  case when prepared.founding_rank <= 100 then prepared.coverage_start end,
  case when prepared.founding_rank <= 100 then prepared.coverage_start + interval '1 year' end,
  case when prepared.founding_rank <= 100 then prepared.coverage_start + interval '1 year 30 days' end,
  case when prepared.founding_rank <= 100 then prepared.stripe_customer_id end,
  case when prepared.founding_rank <= 100 then prepared.stripe_subscription_id end
from prepared
on conflict (instructor_profile_id) do nothing;

drop trigger if exists assign_founding_guarantee_from_membership on public.instructor_memberships;
create trigger assign_founding_guarantee_from_membership
  after insert or update of status, stripe_created_at on public.instructor_memberships
  for each row execute function public.assign_founding_guarantee_from_membership();

create or replace function public.mark_guarantee_fulfilled_by_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.instructor_profile_id is not null
    and new.booking_outcome = 'booked'
    and exists (
      select 1
      from public.inquiry_outcome_reports report
      join public.instructor_profiles profile
        on profile.account_id = report.reporter_account_id
      where report.inquiry_id = new.id
        and profile.id = new.instructor_profile_id
        and report.outcome = 'booked'
    ) then
    update public.instructor_guarantees
    set guarantee_status = 'fulfilled',
        coverage_issue_at = now(),
        coverage_issue_reason = 'Hire Line Dancers inquiry reported as booked'
    where instructor_profile_id = new.instructor_profile_id
      and guarantee_status in ('covered', 'claim_eligible', 'claim_received', 'under_review');

    if found then
      insert into public.membership_admin_events (
        instructor_profile_id, event_type, detail
      ) values (
        new.instructor_profile_id,
        'guarantee_fulfilled',
        jsonb_build_object('inquiry_id', new.id)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_guarantee_fulfilled_by_booking on public.inquiries;
create trigger mark_guarantee_fulfilled_by_booking
  after insert or update of booking_outcome on public.inquiries
  for each row execute function public.mark_guarantee_fulfilled_by_booking();

drop function if exists public.admin_search_instructors(text, integer, integer);
create function public.admin_search_instructors(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  instructor_profile_id uuid,
  account_id uuid,
  display_name text,
  business_name text,
  account_email text,
  inquiry_email text,
  city text,
  region text,
  profile_status text,
  subscription_status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_livemode boolean,
  founding_member_number smallint,
  founding_status text,
  guarantee_status text,
  guarantee_started_at timestamptz,
  guarantee_ends_at timestamptz,
  claim_deadline_at timestamptz,
  guarantee_admin_note text,
  qualifying_booking_count integer,
  claim_id uuid,
  claim_status text,
  claim_received_at timestamptz,
  claim_received_via text,
  claimant_email text,
  requested_amount_cents integer,
  approved_refund_amount_cents integer,
  profile_complete_confirmed boolean,
  contact_details_current_confirmed boolean,
  response_requirement_confirmed boolean,
  claim_admin_note text,
  decision_reason text,
  verified_refund_cents integer,
  refund_count integer,
  refunded boolean,
  latest_refunded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;

  return query
  select
    profile.id,
    profile.account_id,
    profile.display_name,
    profile.business_name,
    account.email,
    settings.inquiry_email,
    profile.city,
    profile.region,
    profile.status,
    coalesce(membership.status, settings.subscription_status, 'inactive'),
    coalesce(membership.stripe_customer_id, settings.stripe_customer_id),
    coalesce(membership.stripe_subscription_id, settings.stripe_subscription_id),
    membership_mode.livemode,
    guarantee.founding_member_number,
    coalesce(guarantee.founding_status, 'unassigned'),
    coalesce(guarantee.guarantee_status, 'not_started'),
    guarantee.guarantee_started_at,
    guarantee.guarantee_ends_at,
    guarantee.claim_deadline_at,
    guarantee.admin_note,
    (
      select count(*)::integer
      from public.inquiries inquiry
      where inquiry.instructor_profile_id = profile.id
        and exists (
          select 1
          from public.inquiry_outcome_reports report
          where report.inquiry_id = inquiry.id
            and report.reporter_account_id = profile.account_id
            and report.outcome = 'booked'
        )
    ),
    claim.id,
    claim.status,
    claim.received_at,
    claim.received_via,
    claim.claimant_email,
    claim.requested_amount_cents,
    claim.approved_refund_amount_cents,
    claim.profile_complete_confirmed,
    claim.contact_details_current_confirmed,
    claim.response_requirement_confirmed,
    claim.admin_note,
    claim.decision_reason,
    coalesce(refund_summary.verified_refund_cents, 0),
    coalesce(refund_summary.refund_count, 0),
    coalesce(claim.status = 'refunded', false),
    refund_summary.latest_refunded_at
  from public.instructor_profiles profile
  join public.accounts account on account.id = profile.account_id
  left join public.instructor_private_settings settings on settings.instructor_profile_id = profile.id
  left join public.instructor_memberships membership on membership.instructor_profile_id = profile.id
  left join public.instructor_guarantees guarantee on guarantee.instructor_profile_id = profile.id
  left join public.guarantee_claims claim on claim.instructor_profile_id = profile.id
  left join lateral (
    select event.livemode
    from public.stripe_webhook_events event
    where event.stripe_object_id = coalesce(
      membership.stripe_subscription_id,
      settings.stripe_subscription_id
    )
    order by event.stripe_created_at desc, event.processed_at desc, event.stripe_event_id desc
    limit 1
  ) membership_mode on true
  left join lateral (
    select
      coalesce(sum(refund.amount_cents) filter (where refund.stripe_status = 'succeeded'), 0)::integer as verified_refund_cents,
      count(*) filter (where refund.stripe_status = 'succeeded')::integer as refund_count,
      max(refund.verified_at) filter (where refund.stripe_status = 'succeeded') as latest_refunded_at
    from public.membership_refunds refund
    where refund.instructor_profile_id = profile.id
  ) refund_summary on true
  where nullif(trim(p_search), '') is null
    or concat_ws(
      ' ',
      profile.display_name,
      profile.business_name,
      account.email,
      settings.inquiry_email,
      profile.city,
      profile.region
    ) ilike '%' || trim(p_search) || '%'
  order by lower(profile.display_name), profile.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.admin_update_instructor_guarantee(
  p_instructor_profile_id uuid,
  p_founding_status text,
  p_guarantee_status text,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number smallint;
  coverage_start timestamptz;
begin
  if not public.current_marketplace_owner_status() then
    raise exception 'Marketplace owner access required';
  end if;
  if p_founding_status not in ('unassigned', 'reserved', 'active', 'ended', 'not_available') then
    raise exception 'Invalid founding status';
  end if;
  if p_guarantee_status not in (
    'not_started', 'covered', 'claim_eligible', 'fulfilled', 'ineligible',
    'claim_received', 'under_review', 'approved', 'denied', 'refunded', 'expired'
  ) then
    raise exception 'Invalid guarantee status';
  end if;
  if p_guarantee_status = 'refunded' then
    raise exception 'Refunded status requires a verified Stripe refund';
  end if;
  if char_length(coalesce(p_admin_note, '')) > 4000 then
    raise exception 'Admin notes must be 4,000 characters or fewer';
  end if;
  if not exists (
    select 1 from public.instructor_profiles where id = p_instructor_profile_id
  ) then
    raise exception 'Instructor profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hire-line-dancers-founding-members', 0));
  if p_founding_status in ('unassigned', 'not_available')
    and exists (
      select 1
      from public.instructor_guarantees guarantee
      where guarantee.instructor_profile_id = p_instructor_profile_id
        and guarantee.founding_member_number is not null
    ) then
    raise exception 'An assigned founding position cannot be removed';
  end if;
  if p_founding_status in ('reserved', 'active') then
    select guarantee.founding_member_number into next_number
    from public.instructor_guarantees guarantee
    where guarantee.instructor_profile_id = p_instructor_profile_id;

    if next_number is null then
      select slot::smallint into next_number
      from generate_series(1, 100) slot
      where not exists (
        select 1
        from public.instructor_guarantees guarantee
        where guarantee.founding_member_number = slot
      )
      order by slot
      limit 1;
    end if;
    if next_number is null then
      raise exception 'All 100 founding positions are assigned';
    end if;
  end if;

  select coalesce(membership.stripe_created_at, membership.created_at, now())
  into coverage_start
  from public.instructor_memberships membership
  where membership.instructor_profile_id = p_instructor_profile_id;
  coverage_start := coalesce(coverage_start, now());

  insert into public.instructor_guarantees (
    instructor_profile_id,
    founding_member_number,
    founding_status,
    founding_assigned_at,
    guarantee_status,
    guarantee_started_at,
    guarantee_ends_at,
    claim_deadline_at,
    admin_note,
    updated_by
  ) values (
    p_instructor_profile_id,
    next_number,
    p_founding_status,
    case when next_number is not null then now() end,
    p_guarantee_status,
    case when p_guarantee_status <> 'not_started' then coverage_start end,
    case when p_guarantee_status <> 'not_started' then coverage_start + interval '1 year' end,
    case when p_guarantee_status <> 'not_started' then coverage_start + interval '1 year 30 days' end,
    nullif(trim(p_admin_note), ''),
    auth.uid()
  )
  on conflict (instructor_profile_id) do update set
    founding_member_number = case
      when excluded.founding_status in ('reserved', 'active') then coalesce(public.instructor_guarantees.founding_member_number, excluded.founding_member_number)
      else public.instructor_guarantees.founding_member_number
    end,
    founding_status = excluded.founding_status,
    founding_assigned_at = case
      when excluded.founding_status in ('reserved', 'active') then coalesce(public.instructor_guarantees.founding_assigned_at, now())
      else public.instructor_guarantees.founding_assigned_at
    end,
    founding_ended_at = case
      when excluded.founding_status in ('ended', 'not_available') then now()
      else null
    end,
    guarantee_status = excluded.guarantee_status,
    guarantee_started_at = coalesce(public.instructor_guarantees.guarantee_started_at, excluded.guarantee_started_at),
    guarantee_ends_at = coalesce(public.instructor_guarantees.guarantee_ends_at, excluded.guarantee_ends_at),
    claim_deadline_at = coalesce(public.instructor_guarantees.claim_deadline_at, excluded.claim_deadline_at),
    admin_note = excluded.admin_note,
    updated_by = auth.uid();

  insert into public.membership_admin_events (
    instructor_profile_id, actor_account_id, event_type, detail
  ) values (
    p_instructor_profile_id,
    auth.uid(),
    'guarantee_updated',
    jsonb_build_object(
      'founding_status', p_founding_status,
      'guarantee_status', p_guarantee_status
    )
  );
end;
$$;

create or replace function public.admin_log_guarantee_claim(
  p_instructor_profile_id uuid,
  p_received_via text default 'email',
  p_claimant_email text default null,
  p_requested_amount_cents integer default null,
  p_instructor_message text default null,
  p_admin_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_id uuid;
  booking_count integer;
begin
  if not public.current_marketplace_owner_status() then
    raise exception 'Marketplace owner access required';
  end if;
  if p_received_via not in ('email', 'phone', 'admin', 'other') then
    raise exception 'Invalid claim source';
  end if;
  if p_requested_amount_cents is not null and p_requested_amount_cents <= 0 then
    raise exception 'Requested amount must be positive';
  end if;
  if char_length(coalesce(p_instructor_message, '')) > 4000
    or char_length(coalesce(p_admin_note, '')) > 4000 then
    raise exception 'Claim notes must be 4,000 characters or fewer';
  end if;
  if not exists (
    select 1 from public.instructor_profiles where id = p_instructor_profile_id
  ) then
    raise exception 'Instructor profile not found';
  end if;
  if exists (
    select 1
    from public.guarantee_claims claim
    where claim.instructor_profile_id = p_instructor_profile_id
      and (
        claim.status in ('partially_refunded', 'refunded')
        or exists (
          select 1
          from public.membership_refunds refund
          where refund.guarantee_claim_id = claim.id
        )
      )
  ) then
    raise exception 'A claim with a verified refund record cannot be reopened';
  end if;

  insert into public.instructor_guarantees (instructor_profile_id)
  values (p_instructor_profile_id)
  on conflict (instructor_profile_id) do nothing;

  select count(*)::integer into booking_count
  from public.inquiries inquiry
  join public.instructor_profiles profile
    on profile.id = inquiry.instructor_profile_id
  where profile.id = p_instructor_profile_id
    and exists (
      select 1
      from public.inquiry_outcome_reports report
      where report.inquiry_id = inquiry.id
        and report.reporter_account_id = profile.account_id
        and report.outcome = 'booked'
    );

  insert into public.guarantee_claims (
    instructor_profile_id,
    received_via,
    claimant_email,
    status,
    requested_amount_cents,
    instructor_message,
    qualifying_booking_count,
    admin_note,
    created_by
  ) values (
    p_instructor_profile_id,
    p_received_via,
    nullif(trim(p_claimant_email), ''),
    'received',
    p_requested_amount_cents,
    nullif(trim(p_instructor_message), ''),
    booking_count,
    nullif(trim(p_admin_note), ''),
    auth.uid()
  )
  on conflict (instructor_profile_id) do update set
    received_at = now(),
    received_via = excluded.received_via,
    claimant_email = excluded.claimant_email,
    status = case
      when public.guarantee_claims.status = 'refunded' then public.guarantee_claims.status
      else 'received'
    end,
    requested_amount_cents = excluded.requested_amount_cents,
    instructor_message = excluded.instructor_message,
    qualifying_booking_count = excluded.qualifying_booking_count,
    admin_note = excluded.admin_note,
    created_by = auth.uid()
  returning id into claim_id;

  update public.instructor_guarantees
  set guarantee_status = case
        when guarantee_status in ('fulfilled', 'refunded') then guarantee_status
        else 'claim_received'
      end,
      updated_by = auth.uid()
  where instructor_profile_id = p_instructor_profile_id;

  insert into public.membership_admin_events (
    instructor_profile_id, guarantee_claim_id, actor_account_id, event_type
  ) values (
    p_instructor_profile_id, claim_id, auth.uid(), 'claim_received'
  );

  return claim_id;
end;
$$;

create or replace function public.admin_review_guarantee_claim(
  p_claim_id uuid,
  p_status text,
  p_profile_complete_confirmed boolean,
  p_contact_details_current_confirmed boolean,
  p_response_requirement_confirmed boolean,
  p_approved_refund_amount_cents integer default null,
  p_admin_note text default null,
  p_decision_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  claim public.guarantee_claims;
  next_guarantee_status text;
  booking_count integer;
begin
  if not public.current_marketplace_owner_status() then
    raise exception 'Marketplace owner access required';
  end if;
  if p_status not in ('in_review', 'approved', 'denied', 'withdrawn', 'refund_pending') then
    raise exception 'Invalid claim status';
  end if;
  if p_status in ('approved', 'refund_pending')
    and coalesce(p_approved_refund_amount_cents, 0) <= 0 then
    raise exception 'Enter an approved refund amount';
  end if;
  if p_status in ('approved', 'refund_pending')
    and not (
      p_profile_complete_confirmed
      and p_contact_details_current_confirmed
      and p_response_requirement_confirmed
    ) then
    raise exception 'Confirm all guarantee requirements before approval';
  end if;
  if char_length(coalesce(p_admin_note, '')) > 4000
    or char_length(coalesce(p_decision_reason, '')) > 2000 then
    raise exception 'Claim review notes are too long';
  end if;

  select * into claim
  from public.guarantee_claims
  where id = p_claim_id
  for update;
  if claim.id is null then
    raise exception 'Guarantee claim not found';
  end if;
  if claim.status in ('partially_refunded', 'refunded')
    or exists (
      select 1
      from public.membership_refunds refund
      where refund.guarantee_claim_id = claim.id
    ) then
    raise exception 'A claim with a verified refund record cannot be reviewed again';
  end if;

  select count(*)::integer into booking_count
  from public.inquiries inquiry
  join public.instructor_profiles profile
    on profile.id = inquiry.instructor_profile_id
  where profile.id = claim.instructor_profile_id
    and exists (
      select 1
      from public.inquiry_outcome_reports report
      where report.inquiry_id = inquiry.id
        and report.reporter_account_id = profile.account_id
        and report.outcome = 'booked'
    );

  if p_status in ('approved', 'refund_pending') and booking_count > 0 then
    raise exception 'This instructor already has a Hire Line Dancers booking';
  end if;

  update public.guarantee_claims
  set status = p_status,
      approved_refund_amount_cents = case
        when p_status in ('approved', 'refund_pending') then p_approved_refund_amount_cents
        else approved_refund_amount_cents
      end,
      profile_complete_confirmed = p_profile_complete_confirmed,
      contact_details_current_confirmed = p_contact_details_current_confirmed,
      response_requirement_confirmed = p_response_requirement_confirmed,
      qualifying_booking_count = booking_count,
      admin_note = nullif(trim(p_admin_note), ''),
      decision_reason = nullif(trim(p_decision_reason), ''),
      decided_by = case when p_status in ('approved', 'denied', 'withdrawn') then auth.uid() else decided_by end,
      decided_at = case when p_status in ('approved', 'denied', 'withdrawn') then now() else decided_at end
  where id = claim.id;

  next_guarantee_status := case p_status
    when 'in_review' then 'under_review'
    when 'approved' then 'approved'
    when 'refund_pending' then 'approved'
    when 'denied' then 'denied'
    when 'withdrawn' then 'claim_eligible'
  end;

  update public.instructor_guarantees
  set guarantee_status = next_guarantee_status,
      updated_by = auth.uid()
  where instructor_profile_id = claim.instructor_profile_id;

  insert into public.membership_admin_events (
    instructor_profile_id, guarantee_claim_id, actor_account_id, event_type, detail
  ) values (
    claim.instructor_profile_id,
    claim.id,
    auth.uid(),
    'claim_reviewed',
    jsonb_build_object(
      'claim_status', p_status,
      'approved_refund_amount_cents', p_approved_refund_amount_cents,
      'qualifying_booking_count', booking_count
    )
  );
end;
$$;

create or replace function public.apply_verified_membership_refund(
  p_claim_id uuid,
  p_stripe_refund_id text,
  p_stripe_customer_id text,
  p_stripe_charge_id text,
  p_stripe_payment_intent_id text,
  p_stripe_invoice_id text,
  p_amount_cents integer,
  p_currency text,
  p_stripe_status text,
  p_stripe_created_at timestamptz,
  p_recorded_by uuid,
  p_event_id text default null,
  p_failure_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  claim public.guarantee_claims;
  guarantee public.instructor_guarantees;
  refund_id uuid;
  prior_refund public.membership_refunds;
  verified_total integer;
  next_claim_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if not exists (
    select 1
    from public.marketplace_admins admin_access
    where admin_access.account_id = p_recorded_by
      and admin_access.is_owner
  ) then
    raise exception 'Refund recorder must be the marketplace owner';
  end if;
  if p_stripe_refund_id !~ '^re_[A-Za-z0-9]+$'
    or nullif(trim(p_stripe_customer_id), '') is null then
    raise exception 'Stripe refund identifiers are invalid';
  end if;
  if p_amount_cents <= 0 or lower(p_currency) <> 'usd' then
    raise exception 'Refund amount or currency is invalid';
  end if;
  if p_stripe_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then
    raise exception 'Unsupported Stripe refund status';
  end if;

  select * into claim
  from public.guarantee_claims
  where id = p_claim_id
  for update;
  if claim.id is null then
    raise exception 'Guarantee claim not found';
  end if;
  if claim.status not in ('approved', 'refund_pending', 'partially_refunded', 'refunded') then
    raise exception 'Approve the guarantee claim before verifying a refund';
  end if;

  select * into guarantee
  from public.instructor_guarantees
  where instructor_profile_id = claim.instructor_profile_id
  for update;
  if guarantee.instructor_profile_id is null then
    raise exception 'Guarantee record not found';
  end if;
  if p_stripe_customer_id is distinct from guarantee.first_stripe_customer_id
    and not exists (
      select 1
      from public.instructor_memberships membership
      where membership.instructor_profile_id = claim.instructor_profile_id
        and membership.stripe_customer_id = p_stripe_customer_id
    ) then
    raise exception 'Refund customer does not match this instructor';
  end if;

  select * into prior_refund
  from public.membership_refunds refund
  where refund.stripe_refund_id = p_stripe_refund_id;

  if p_stripe_status = 'succeeded'
    and claim.approved_refund_amount_cents is not null
    and (
      coalesce((
        select sum(refund.amount_cents)
        from public.membership_refunds refund
        where refund.guarantee_claim_id = claim.id
          and refund.stripe_status = 'succeeded'
          and refund.stripe_refund_id <> p_stripe_refund_id
      ), 0) + p_amount_cents
    ) > claim.approved_refund_amount_cents then
    raise exception 'Verified refunds cannot exceed the approved amount';
  end if;

  insert into public.membership_refunds (
    guarantee_claim_id,
    instructor_profile_id,
    stripe_refund_id,
    stripe_customer_id,
    stripe_charge_id,
    stripe_payment_intent_id,
    stripe_invoice_id,
    amount_cents,
    currency,
    stripe_status,
    stripe_created_at,
    verified_at,
    recorded_by,
    last_stripe_event_id,
    failure_reason
  ) values (
    claim.id,
    claim.instructor_profile_id,
    p_stripe_refund_id,
    p_stripe_customer_id,
    nullif(trim(p_stripe_charge_id), ''),
    nullif(trim(p_stripe_payment_intent_id), ''),
    nullif(trim(p_stripe_invoice_id), ''),
    p_amount_cents,
    lower(p_currency),
    p_stripe_status,
    p_stripe_created_at,
    now(),
    p_recorded_by,
    nullif(trim(p_event_id), ''),
    nullif(trim(p_failure_reason), '')
  )
  on conflict (stripe_refund_id) do update set
    stripe_status = excluded.stripe_status,
    verified_at = now(),
    recorded_by = excluded.recorded_by,
    last_stripe_event_id = coalesce(excluded.last_stripe_event_id, public.membership_refunds.last_stripe_event_id),
    failure_reason = excluded.failure_reason
  where public.membership_refunds.guarantee_claim_id = excluded.guarantee_claim_id
    and public.membership_refunds.instructor_profile_id = excluded.instructor_profile_id
    and public.membership_refunds.stripe_customer_id = excluded.stripe_customer_id
    and public.membership_refunds.amount_cents = excluded.amount_cents
  returning id into refund_id;

  if refund_id is null then
    raise exception 'That Stripe refund is already associated with different records';
  end if;

  select coalesce(sum(refund.amount_cents), 0)::integer into verified_total
  from public.membership_refunds refund
  where refund.guarantee_claim_id = claim.id
    and refund.stripe_status = 'succeeded';

  next_claim_status := case
    when verified_total = 0 then 'refund_pending'
    when claim.approved_refund_amount_cents is not null
      and verified_total >= claim.approved_refund_amount_cents then 'refunded'
    else 'partially_refunded'
  end;

  update public.guarantee_claims
  set status = next_claim_status,
      refunded_at = case
        when next_claim_status = 'refunded' then coalesce(refunded_at, now())
        else refunded_at
      end
  where id = claim.id;

  if next_claim_status = 'refunded' then
    update public.instructor_guarantees
    set guarantee_status = 'refunded',
        refunded_at = coalesce(refunded_at, now()),
        founding_status = 'ended',
        founding_ended_at = coalesce(founding_ended_at, now()),
        founding_ended_reason = 'Founding guarantee refund completed',
        updated_by = p_recorded_by
    where instructor_profile_id = claim.instructor_profile_id;
  end if;

  if prior_refund.id is null or prior_refund.stripe_status is distinct from p_stripe_status then
    insert into public.membership_admin_events (
      instructor_profile_id,
      guarantee_claim_id,
      membership_refund_id,
      actor_account_id,
      event_type,
      detail
    ) values (
      claim.instructor_profile_id,
      claim.id,
      refund_id,
      p_recorded_by,
      'refund_verified',
      jsonb_build_object(
        'stripe_status', p_stripe_status,
        'amount_cents', p_amount_cents,
        'verified_total_cents', verified_total,
        'claim_status', next_claim_status
      )
    );
  end if;

  return next_claim_status;
end;
$$;

revoke all on public.instructor_guarantees from anon, authenticated;
revoke all on public.guarantee_claims from anon, authenticated;
revoke all on public.membership_refunds from anon, authenticated;
revoke all on public.membership_admin_events from anon, authenticated;
grant select on public.instructor_guarantees to authenticated;
grant select on public.guarantee_claims to authenticated;
grant select on public.membership_refunds to authenticated;
grant select on public.membership_admin_events to authenticated;

revoke execute on function public.admin_search_instructors(text, integer, integer) from public, anon;
revoke execute on function public.admin_update_instructor_guarantee(uuid, text, text, text) from public, anon;
revoke execute on function public.admin_log_guarantee_claim(uuid, text, text, integer, text, text) from public, anon;
revoke execute on function public.admin_review_guarantee_claim(uuid, text, boolean, boolean, boolean, integer, text, text) from public, anon;
revoke execute on function public.apply_verified_membership_refund(uuid, text, text, text, text, text, integer, text, text, timestamptz, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_search_instructors(text, integer, integer) to authenticated;
grant execute on function public.admin_update_instructor_guarantee(uuid, text, text, text) to authenticated;
grant execute on function public.admin_log_guarantee_claim(uuid, text, text, integer, text, text) to authenticated;
grant execute on function public.admin_review_guarantee_claim(uuid, text, boolean, boolean, boolean, integer, text, text) to authenticated;
grant execute on function public.apply_verified_membership_refund(uuid, text, text, text, text, text, integer, text, text, timestamptz, uuid, text, text) to service_role;
