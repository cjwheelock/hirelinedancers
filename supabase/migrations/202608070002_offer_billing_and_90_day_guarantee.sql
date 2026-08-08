-- Finalize earned-offer billing and the paid-invoice-based 90-day membership
-- guarantee. Existing 2026-08-04 guarantee records retain their original
-- terms, dates, statuses, and refund workflow.

alter table public.instructor_invitations
  add column if not exists offer_redeemed_at timestamptz,
  add column if not exists offer_redeemed_checkout_session_id text,
  add column if not exists offer_redeemed_subscription_id text;

alter table public.instructor_invitations
  drop constraint if exists instructor_invitations_offer_redemption_check;

alter table public.instructor_invitations
  add constraint instructor_invitations_offer_redemption_check check (
    (
      offer_redeemed_at is null
      and offer_redeemed_checkout_session_id is null
      and offer_redeemed_subscription_id is null
    )
    or (
      offer_redeemed_at is not null
      and offer_redeemed_checkout_session_id ~ '^cs_(live|test)_[A-Za-z0-9]+$'
      and offer_redeemed_subscription_id ~ '^sub_[A-Za-z0-9]+$'
      and offer_eligible
      and offer_earned_at is not null
    )
  );

create unique index if not exists instructor_invitations_redeemed_checkout_session_unique
  on public.instructor_invitations (offer_redeemed_checkout_session_id)
  where offer_redeemed_checkout_session_id is not null;

create unique index if not exists instructor_invitations_redeemed_subscription_unique
  on public.instructor_invitations (offer_redeemed_subscription_id)
  where offer_redeemed_subscription_id is not null;

alter table public.stripe_checkout_attempts
  add column if not exists instructor_invitation_id uuid
    references public.instructor_invitations(id) on delete restrict,
  add column if not exists offer_code text,
  add column if not exists offer_earned_at timestamptz,
  add column if not exists stripe_coupon_id text,
  add column if not exists offer_free_months smallint,
  add column if not exists checkout_terms_version text,
  add column if not exists guarantee_terms_version text;

alter table public.stripe_checkout_attempts
  drop constraint if exists stripe_checkout_attempts_offer_check,
  drop constraint if exists stripe_checkout_attempts_coupon_id_check,
  drop constraint if exists stripe_checkout_attempts_terms_check;

alter table public.stripe_checkout_attempts
  add constraint stripe_checkout_attempts_offer_check check (
    (
      instructor_invitation_id is null
      and offer_code is null
      and offer_earned_at is null
      and stripe_coupon_id is null
      and offer_free_months is null
    )
    or (
      instructor_invitation_id is not null
      and offer_code = 'outreach_two_months_90_day_v1'
      and offer_earned_at is not null
      and stripe_coupon_id is not null
      and offer_free_months = 2
    )
  ),
  add constraint stripe_checkout_attempts_coupon_id_check check (
    stripe_coupon_id is null or stripe_coupon_id ~ '^[A-Za-z0-9_-]+$'
  ),
  add constraint stripe_checkout_attempts_terms_check check (
    (checkout_terms_version is null and guarantee_terms_version is null)
    or (
      checkout_terms_version = '2026-08-07-membership-v2'
      and guarantee_terms_version = '2026-08-07-90-day-paid-invoice-v1'
    )
  );

create index if not exists stripe_checkout_attempts_invitation_idx
  on public.stripe_checkout_attempts (instructor_invitation_id, status)
  where instructor_invitation_id is not null;

create table if not exists public.membership_paid_invoices (
  stripe_invoice_id text primary key,
  instructor_profile_id uuid not null
    references public.instructor_profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_price_id text not null,
  amount_paid_cents integer not null,
  currency text not null,
  paid_at timestamptz not null,
  billing_reason text not null,
  livemode boolean not null,
  source_event_id text not null,
  recorded_at timestamptz not null default now(),
  constraint membership_paid_invoices_invoice_id_check check (
    stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'
  ),
  constraint membership_paid_invoices_customer_id_check check (
    stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  ),
  constraint membership_paid_invoices_subscription_id_check check (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  constraint membership_paid_invoices_price_id_check check (
    stripe_price_id ~ '^price_[A-Za-z0-9]+$'
  ),
  constraint membership_paid_invoices_amount_check check (
    amount_paid_cents > 0
  ),
  constraint membership_paid_invoices_currency_check check (currency = 'usd'),
  constraint membership_paid_invoices_billing_reason_check check (
    billing_reason in ('subscription_create', 'subscription_cycle')
  ),
  constraint membership_paid_invoices_source_event_check check (
    nullif(trim(source_event_id), '') is not null
  )
);

create index if not exists membership_paid_invoices_profile_paid_idx
  on public.membership_paid_invoices (
    instructor_profile_id,
    stripe_subscription_id,
    paid_at,
    stripe_invoice_id
  );

alter table public.membership_paid_invoices enable row level security;

drop policy if exists "admins read membership paid invoices"
  on public.membership_paid_invoices;
create policy "admins read membership paid invoices"
  on public.membership_paid_invoices
  for select to authenticated using (public.is_marketplace_admin());

alter table public.instructor_guarantees
  alter column guarantee_terms_version
    set default '2026-08-07-90-day-paid-invoice-v1',
  add column if not exists activation_checkout_session_id text,
  add column if not exists first_paid_invoice_id text,
  add column if not exists first_paid_invoice_paid_at timestamptz,
  add column if not exists first_paid_amount_cents integer,
  add column if not exists first_paid_currency text,
  add column if not exists guarantee_duration_days smallint,
  add column if not exists claim_request_window_days smallint;

alter table public.instructor_guarantees
  drop constraint if exists instructor_guarantees_activation_session_check,
  drop constraint if exists instructor_guarantees_first_paid_invoice_check,
  drop constraint if exists instructor_guarantees_duration_snapshot_check,
  drop constraint if exists instructor_guarantees_current_terms_dates_check,
  drop constraint if exists instructor_guarantees_first_paid_invoice_fkey;

alter table public.instructor_guarantees
  add constraint instructor_guarantees_activation_session_check check (
    activation_checkout_session_id is null
    or activation_checkout_session_id ~ '^cs_(live|test)_[A-Za-z0-9]+$'
  ),
  add constraint instructor_guarantees_first_paid_invoice_check check (
    (
      first_paid_invoice_id is null
      and first_paid_invoice_paid_at is null
      and first_paid_amount_cents is null
      and first_paid_currency is null
    )
    or (
      first_paid_invoice_id ~ '^in_[A-Za-z0-9]+$'
      and first_paid_invoice_paid_at is not null
      and first_paid_amount_cents > 0
      and first_paid_currency = 'usd'
    )
  ),
  add constraint instructor_guarantees_duration_snapshot_check check (
    (
      guarantee_duration_days is null
      and claim_request_window_days is null
    )
    or (
      guarantee_duration_days = 90
      and claim_request_window_days = 30
    )
  ),
  add constraint instructor_guarantees_current_terms_dates_check check (
    guarantee_terms_version <> '2026-08-07-90-day-paid-invoice-v1'
    or (
      guarantee_duration_days = 90
      and claim_request_window_days = 30
      and (
        (
          first_paid_invoice_id is null
          and guarantee_started_at is null
          and guarantee_ends_at is null
          and claim_deadline_at is null
        )
        or (
          first_paid_invoice_id is not null
          and guarantee_started_at is not distinct from
            first_paid_invoice_paid_at
          and guarantee_ends_at is not distinct from
            first_paid_invoice_paid_at + interval '90 days'
          and claim_deadline_at is not distinct from
            first_paid_invoice_paid_at + interval '120 days'
        )
      )
    )
  ),
  add constraint instructor_guarantees_first_paid_invoice_fkey
    foreign key (first_paid_invoice_id)
    references public.membership_paid_invoices(stripe_invoice_id)
    on delete restrict;

create unique index if not exists instructor_guarantees_first_paid_invoice_unique
  on public.instructor_guarantees (first_paid_invoice_id)
  where first_paid_invoice_id is not null;

alter table public.guarantee_claims
  add column if not exists eligible_paid_amount_cents integer;

alter table public.guarantee_claims
  drop constraint if exists guarantee_claims_eligible_paid_amount_check;

alter table public.guarantee_claims
  add constraint guarantee_claims_eligible_paid_amount_check check (
    eligible_paid_amount_cents is null or eligible_paid_amount_cents > 0
  );

alter table public.membership_admin_events
  drop constraint if exists membership_admin_events_type_check;

alter table public.membership_admin_events
  add constraint membership_admin_events_type_check check (
    event_type in (
      'founding_assigned', 'guarantee_updated', 'guarantee_fulfilled',
      'claim_received', 'claim_reviewed', 'refund_verified', 'benefits_ended',
      'offer_redeemed', 'paid_invoice_recorded', 'guarantee_started'
    )
  );

drop function if exists public.register_instructor_checkout_attempt(
  uuid, text, text, text, text, text, timestamptz
);

create function public.register_instructor_checkout_attempt(
  p_instructor_profile_id uuid,
  p_request_key text,
  p_stripe_checkout_session_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_checkout_url text,
  p_expires_at timestamptz,
  p_instructor_invitation_id uuid,
  p_offer_code text,
  p_offer_earned_at timestamptz,
  p_stripe_coupon_id text,
  p_offer_free_months smallint,
  p_checkout_terms_version text,
  p_guarantee_terms_version text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.instructor_invitations;
  has_offer boolean := p_instructor_invitation_id is not null;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_instructor_profile_id is null then
    raise exception 'Instructor profile is required';
  end if;
  if p_checkout_terms_version is distinct from '2026-08-07-membership-v2'
    or p_guarantee_terms_version is distinct from
      '2026-08-07-90-day-paid-invoice-v1' then
    raise exception 'Checkout terms are not current';
  end if;
  if p_stripe_checkout_session_id is null
    or p_stripe_checkout_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$'
    or p_stripe_customer_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_stripe_price_id is null
    or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception 'Stripe checkout identifiers are invalid';
  end if;

  if has_offer is distinct from (
    p_offer_code is not null
    and p_offer_earned_at is not null
    and p_stripe_coupon_id is not null
    and p_offer_free_months is not null
  ) then
    raise exception 'Checkout offer details are incomplete';
  end if;
  if not has_offer and (
    p_offer_code is not null
    or p_offer_earned_at is not null
    or p_stripe_coupon_id is not null
    or p_offer_free_months is not null
  ) then
    raise exception 'Checkout offer details must all be null';
  end if;
  if has_offer and (
    p_offer_code <> 'outreach_two_months_90_day_v1'
    or p_offer_free_months <> 2
    or p_stripe_coupon_id !~ '^[A-Za-z0-9_-]+$'
  ) then
    raise exception 'Checkout offer details are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  if exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = p_instructor_profile_id
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.instructor_profiles profile
    where profile.id = p_instructor_profile_id
      and profile.status = 'approved'
      and profile.approved_at is not null
  ) then
    raise exception 'An approved instructor profile is required for checkout';
  end if;

  if has_offer then
    select invitation_record.* into invitation
    from public.instructor_invitations invitation_record
    where invitation_record.id = p_instructor_invitation_id
    for update;

    if invitation.id is null
      or invitation.accepted_profile_id is distinct from p_instructor_profile_id
      or invitation.offer_code is distinct from p_offer_code
      or not invitation.offer_eligible
      or invitation.offer_earned_at is distinct from p_offer_earned_at
      or invitation.offer_redeemed_at is not null then
      raise exception 'The earned instructor offer is no longer available';
    end if;

    if exists (
      select 1
      from public.instructor_memberships membership
      where membership.instructor_profile_id = p_instructor_profile_id
    ) or exists (
      select 1
      from public.instructor_private_settings settings
      where settings.instructor_profile_id = p_instructor_profile_id
        and settings.stripe_subscription_id is not null
    ) or exists (
      select 1
      from public.stripe_checkout_attempts attempt
      where attempt.instructor_profile_id = p_instructor_profile_id
        and attempt.status = 'completed'
    ) then
      raise exception 'The earned instructor offer is only for a first membership';
    end if;
  end if;

  insert into public.stripe_checkout_attempts (
    instructor_profile_id,
    request_key,
    stripe_checkout_session_id,
    stripe_customer_id,
    stripe_price_id,
    checkout_url,
    status,
    expires_at,
    instructor_invitation_id,
    offer_code,
    offer_earned_at,
    stripe_coupon_id,
    offer_free_months,
    checkout_terms_version,
    guarantee_terms_version
  ) values (
    p_instructor_profile_id,
    p_request_key,
    p_stripe_checkout_session_id,
    p_stripe_customer_id,
    p_stripe_price_id,
    p_checkout_url,
    'open',
    p_expires_at,
    p_instructor_invitation_id,
    p_offer_code,
    p_offer_earned_at,
    p_stripe_coupon_id,
    p_offer_free_months,
    p_checkout_terms_version,
    p_guarantee_terms_version
  );

  return true;
end;
$$;

create or replace function public.guarantee_eligible_paid_amount(
  p_instructor_profile_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(invoice.amount_paid_cents), 0)::integer
  from public.instructor_guarantees guarantee_record
  join public.membership_paid_invoices invoice
    on invoice.instructor_profile_id = guarantee_record.instructor_profile_id
   and invoice.stripe_subscription_id =
     guarantee_record.first_stripe_subscription_id
   and invoice.paid_at >= guarantee_record.guarantee_started_at
   and invoice.paid_at < guarantee_record.guarantee_ends_at
  where guarantee_record.instructor_profile_id = p_instructor_profile_id
    and guarantee_record.guarantee_terms_version =
      '2026-08-07-90-day-paid-invoice-v1';
$$;

-- This recorder never creates a Stripe refund. It stores only refund facts
-- that the owner explicitly asked the verification service to fetch from
-- Stripe after a guarantee claim was received and approved.
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
  guarantee_record public.instructor_guarantees;
  eligible_invoice public.membership_paid_invoices;
  prior_refund public.membership_refunds;
  refund_id uuid;
  eligible_paid_amount integer;
  reserved_total integer;
  reserved_invoice_total integer;
  verified_total integer;
  next_claim_status text;
  uses_current_terms boolean;
  normalized_customer_id text := nullif(trim(p_stripe_customer_id), '');
  normalized_charge_id text := nullif(trim(p_stripe_charge_id), '');
  normalized_payment_intent_id text :=
    nullif(trim(p_stripe_payment_intent_id), '');
  normalized_invoice_id text := nullif(trim(p_stripe_invoice_id), '');
  normalized_event_id text := nullif(trim(p_event_id), '');
  normalized_failure_reason text := nullif(trim(p_failure_reason), '');
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
  if p_stripe_refund_id is null
    or p_stripe_refund_id !~ '^re_[A-Za-z0-9]+$'
    or normalized_customer_id is null
    or normalized_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or (
      normalized_charge_id is not null
      and normalized_charge_id !~ '^ch_[A-Za-z0-9]+$'
    )
    or (
      normalized_payment_intent_id is not null
      and normalized_payment_intent_id !~ '^pi_[A-Za-z0-9]+$'
    )
    or (
      normalized_invoice_id is not null
      and normalized_invoice_id !~ '^in_[A-Za-z0-9]+$'
    ) then
    raise exception 'Stripe refund identifiers are invalid';
  end if;
  if p_amount_cents is null
    or p_amount_cents <= 0
    or p_currency is null
    or lower(p_currency) <> 'usd' then
    raise exception 'Refund amount or currency is invalid';
  end if;
  if p_stripe_status is null or p_stripe_status not in (
    'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
  ) then
    raise exception 'Unsupported Stripe refund status';
  end if;
  if p_stripe_created_at is null then
    raise exception 'Stripe refund creation time is required';
  end if;
  if char_length(coalesce(normalized_failure_reason, '')) > 2000 then
    raise exception 'Refund failure reason is too long';
  end if;

  select claim_record.* into claim
  from public.guarantee_claims claim_record
  where claim_record.id = p_claim_id
  for update;
  if claim.id is null then
    raise exception 'Guarantee claim not found';
  end if;
  if claim.status not in (
    'approved', 'refund_pending', 'partially_refunded', 'refunded'
  ) or claim.approved_refund_amount_cents is null then
    raise exception 'Approve the guarantee claim before verifying a refund';
  end if;
  if p_stripe_created_at < date_trunc('second', claim.received_at) then
    raise exception 'The Stripe refund must be created after the claim request';
  end if;

  select guarantee_candidate.* into guarantee_record
  from public.instructor_guarantees guarantee_candidate
  where guarantee_candidate.instructor_profile_id =
    claim.instructor_profile_id
  for update;
  if guarantee_record.instructor_profile_id is null then
    raise exception 'Guarantee record not found';
  end if;

  select refund_record.* into prior_refund
  from public.membership_refunds refund_record
  where refund_record.stripe_refund_id = p_stripe_refund_id
  for update;

  if claim.status = 'refunded' and prior_refund.id is null then
    raise exception 'This guarantee claim has already been fully refunded';
  end if;

  uses_current_terms := guarantee_record.guarantee_terms_version =
    '2026-08-07-90-day-paid-invoice-v1';

  if uses_current_terms then
    eligible_paid_amount := public.guarantee_eligible_paid_amount(
      claim.instructor_profile_id
    );
    if claim.eligible_paid_amount_cents is null
      or eligible_paid_amount <= 0
      or claim.approved_refund_amount_cents >
        claim.eligible_paid_amount_cents
      or claim.approved_refund_amount_cents > eligible_paid_amount then
      raise exception 'Approved refund exceeds eligible paid membership invoices';
    end if;
    if normalized_invoice_id is null then
      raise exception 'A current guarantee refund must identify its paid invoice';
    end if;

    select invoice.* into eligible_invoice
    from public.membership_paid_invoices invoice
    where invoice.stripe_invoice_id = normalized_invoice_id
      and invoice.instructor_profile_id = claim.instructor_profile_id
      and invoice.stripe_customer_id = normalized_customer_id
      and invoice.stripe_subscription_id =
        guarantee_record.first_stripe_subscription_id
      and invoice.paid_at >= guarantee_record.guarantee_started_at
      and invoice.paid_at < guarantee_record.guarantee_ends_at;

    if eligible_invoice.stripe_invoice_id is null then
      raise exception 'Refund invoice is outside this guarantee coverage';
    end if;
    if p_amount_cents > eligible_invoice.amount_paid_cents then
      raise exception 'Refund exceeds the eligible paid invoice amount';
    end if;
  elsif normalized_customer_id is distinct from
      guarantee_record.first_stripe_customer_id
    and not exists (
      select 1
      from public.instructor_memberships membership
      where membership.instructor_profile_id = claim.instructor_profile_id
        and membership.stripe_customer_id = normalized_customer_id
    ) then
    raise exception 'Refund customer does not match this instructor';
  end if;

  if prior_refund.id is not null then
    if prior_refund.guarantee_claim_id is distinct from claim.id
      or prior_refund.instructor_profile_id is distinct from
        claim.instructor_profile_id
      or prior_refund.stripe_customer_id is distinct from
        normalized_customer_id
      or prior_refund.stripe_charge_id is distinct from normalized_charge_id
      or prior_refund.stripe_payment_intent_id is distinct from
        normalized_payment_intent_id
      or prior_refund.stripe_invoice_id is distinct from
        normalized_invoice_id
      or prior_refund.amount_cents is distinct from p_amount_cents
      or prior_refund.currency is distinct from lower(p_currency)
      or prior_refund.stripe_created_at is distinct from
        p_stripe_created_at then
      raise exception 'That Stripe refund is already associated with different records';
    end if;
    if prior_refund.stripe_status = 'succeeded'
      and p_stripe_status <> 'succeeded' then
      raise exception 'A succeeded Stripe refund cannot return to a pending or failed state';
    end if;
  end if;

  select coalesce(sum(refund.amount_cents), 0)::integer
  into reserved_total
  from public.membership_refunds refund
  where refund.guarantee_claim_id = claim.id
    and refund.stripe_status in ('pending', 'requires_action', 'succeeded')
    and refund.stripe_refund_id <> p_stripe_refund_id;

  if p_stripe_status in ('pending', 'requires_action', 'succeeded')
    and reserved_total + p_amount_cents >
      claim.approved_refund_amount_cents then
    raise exception 'Verified refunds cannot exceed the approved amount';
  end if;

  if uses_current_terms then
    select coalesce(sum(refund.amount_cents), 0)::integer
    into reserved_invoice_total
    from public.membership_refunds refund
    where refund.instructor_profile_id = claim.instructor_profile_id
      and refund.stripe_invoice_id = normalized_invoice_id
      and refund.stripe_status in (
        'pending', 'requires_action', 'succeeded'
      )
      and refund.stripe_refund_id <> p_stripe_refund_id;

    if p_stripe_status in ('pending', 'requires_action', 'succeeded')
      and reserved_invoice_total + p_amount_cents >
        eligible_invoice.amount_paid_cents then
      raise exception 'Verified refunds cannot exceed the paid invoice amount';
    end if;
  end if;

  if prior_refund.id is null then
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
      normalized_customer_id,
      normalized_charge_id,
      normalized_payment_intent_id,
      normalized_invoice_id,
      p_amount_cents,
      lower(p_currency),
      p_stripe_status,
      p_stripe_created_at,
      now(),
      p_recorded_by,
      normalized_event_id,
      normalized_failure_reason
    )
    returning id into refund_id;
  else
    update public.membership_refunds
    set stripe_status = p_stripe_status,
        verified_at = now(),
        recorded_by = p_recorded_by,
        last_stripe_event_id = coalesce(
          normalized_event_id,
          last_stripe_event_id
        ),
        failure_reason = normalized_failure_reason
    where id = prior_refund.id
    returning id into refund_id;
  end if;

  select coalesce(sum(refund.amount_cents), 0)::integer into verified_total
  from public.membership_refunds refund
  where refund.guarantee_claim_id = claim.id
    and refund.stripe_status = 'succeeded';

  next_claim_status := case
    when verified_total = 0 then 'refund_pending'
    when verified_total >= claim.approved_refund_amount_cents then 'refunded'
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
        founding_status = case
          when uses_current_terms then founding_status
          else 'ended'
        end,
        founding_ended_at = case
          when uses_current_terms then founding_ended_at
          else coalesce(founding_ended_at, now())
        end,
        founding_ended_reason = case
          when uses_current_terms then founding_ended_reason
          else 'Historical founding guarantee refund completed'
        end,
        updated_by = p_recorded_by
    where instructor_profile_id = claim.instructor_profile_id;
  end if;

  if prior_refund.id is null
    or prior_refund.stripe_status is distinct from p_stripe_status
    or prior_refund.failure_reason is distinct from
      normalized_failure_reason then
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
        'stripe_invoice_id', normalized_invoice_id,
        'amount_cents', p_amount_cents,
        'verified_total_cents', verified_total,
        'claim_status', next_claim_status
      )
    );
  end if;

  return next_claim_status;
end;
$$;

create or replace function public.current_instructor_invitation_offer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invitation public.instructor_invitations;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select invitation_record.* into invitation
  from public.instructor_invitations invitation_record
  join public.instructor_profiles profile
    on profile.id = invitation_record.accepted_profile_id
  where profile.account_id = auth.uid()
    and invitation_record.offer_code is not null
  order by
    invitation_record.accepted_at desc nulls last,
    invitation_record.created_at desc
  limit 1;

  if invitation.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'status', case
      when invitation.profile_submission_deadline_at <= now()
        and (
          invitation.profile_submitted_at is null
          or invitation.profile_submitted_at >
            invitation.profile_submission_deadline_at
        ) then 'claim_expired'
      else invitation.status
    end,
    'claimedAt', invitation.claimed_at,
    'profileSubmissionDeadlineAt', invitation.profile_submission_deadline_at,
    'accountCreatedAt', invitation.account_created_at,
    'profileSubmittedAt', invitation.profile_submitted_at,
    'offerCode', invitation.offer_code,
    'offerEligible', invitation.offer_eligible,
    'offerEarnedAt', invitation.offer_earned_at,
    'offerStatus', case
      when invitation.offer_redeemed_at is not null then 'redeemed'
      when invitation.offer_eligible then 'earned'
      when invitation.profile_submitted_at is not null then 'ineligible'
      when invitation.profile_submission_deadline_at <= now() then 'expired'
      else 'pending'
    end,
    'offerRedeemedAt', invitation.offer_redeemed_at,
    'offerRedeemedCheckoutSessionId',
      invitation.offer_redeemed_checkout_session_id,
    'offerRedeemedSubscriptionId', invitation.offer_redeemed_subscription_id
  );
end;
$$;

drop function if exists public.admin_list_instructor_invitations();
create function public.admin_list_instructor_invitations()
returns table (
  invitation_id uuid,
  email text,
  grants_lifetime_access boolean,
  invitation_status text,
  offer_code text,
  offer_status text,
  expires_at timestamptz,
  claimed_at timestamptz,
  profile_submission_deadline_at timestamptz,
  account_created_at timestamptz,
  profile_submitted_at timestamptz,
  offer_eligible boolean,
  offer_earned_at timestamptz,
  offer_redeemed_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_profile_id uuid,
  invited_by_email text,
  created_at timestamptz
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
    invitation.id,
    invitation.email,
    invitation.grants_lifetime_access,
    case
      when invitation.status in (
        'pending', 'sending', 'sent', 'delivery_failed'
      ) and invitation.expires_at <= now() then 'expired'
      when invitation.status in ('claimed', 'accepted')
        and invitation.profile_submission_deadline_at <= now()
        and (
          invitation.profile_submitted_at is null
          or invitation.profile_submitted_at >
            invitation.profile_submission_deadline_at
        ) then 'claim_expired'
      else invitation.status
    end,
    invitation.offer_code,
    case
      when invitation.offer_code is null then null
      when invitation.offer_redeemed_at is not null then 'redeemed'
      when invitation.offer_eligible then 'earned'
      when invitation.profile_submitted_at is not null then 'ineligible'
      when invitation.status in ('claimed', 'accepted')
        and invitation.profile_submission_deadline_at <= now() then 'expired'
      when invitation.status = 'accepted' then 'awaiting_submission'
      when invitation.status = 'claimed' then 'awaiting_account'
      else 'awaiting_claim'
    end,
    invitation.expires_at,
    invitation.claimed_at,
    invitation.profile_submission_deadline_at,
    invitation.account_created_at,
    invitation.profile_submitted_at,
    invitation.offer_eligible,
    invitation.offer_earned_at,
    invitation.offer_redeemed_at,
    invitation.sent_at,
    invitation.accepted_at,
    invitation.accepted_profile_id,
    inviter.email,
    invitation.created_at
  from public.instructor_invitations invitation
  join public.accounts inviter on inviter.id = invitation.invited_by
  order by invitation.created_at desc
  limit 200;
end;
$$;

create or replace function public.redeem_instructor_checkout_offer(
  p_instructor_profile_id uuid,
  p_instructor_invitation_id uuid,
  p_offer_code text,
  p_stripe_checkout_session_id text,
  p_stripe_subscription_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.instructor_invitations;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_instructor_profile_id is null
    or p_instructor_invitation_id is null
    or p_offer_code is distinct from 'outreach_two_months_90_day_v1'
    or p_stripe_checkout_session_id is null
    or p_stripe_checkout_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$'
    or p_stripe_subscription_id is null
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'Offer redemption identifiers are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select invitation_record.* into invitation
  from public.instructor_invitations invitation_record
  where invitation_record.id = p_instructor_invitation_id
  for update;

  if invitation.id is null
    or invitation.accepted_profile_id is distinct from p_instructor_profile_id
    or invitation.offer_code is distinct from p_offer_code
    or not invitation.offer_eligible
    or invitation.offer_earned_at is null then
    raise exception 'Earned instructor offer not found';
  end if;

  if invitation.offer_redeemed_at is not null then
    if invitation.offer_redeemed_checkout_session_id =
        p_stripe_checkout_session_id
      and invitation.offer_redeemed_subscription_id =
        p_stripe_subscription_id then
      return 'duplicate';
    end if;
    raise exception 'Earned instructor offer was already redeemed';
  end if;

  if not exists (
    select 1
    from public.stripe_checkout_attempts attempt
    where attempt.instructor_profile_id = p_instructor_profile_id
      and attempt.instructor_invitation_id = p_instructor_invitation_id
      and attempt.offer_code = p_offer_code
      and attempt.stripe_checkout_session_id = p_stripe_checkout_session_id
      and attempt.status = 'completed'
      and attempt.stripe_coupon_id is not null
      and attempt.offer_free_months = 2
      and attempt.checkout_terms_version = '2026-08-07-membership-v2'
      and attempt.guarantee_terms_version =
        '2026-08-07-90-day-paid-invoice-v1'
  ) then
    raise exception 'Completed earned-offer Checkout attempt not found';
  end if;

  if not exists (
    select 1
    from public.instructor_memberships membership
    join public.stripe_checkout_attempts attempt
      on attempt.instructor_profile_id = membership.instructor_profile_id
     and attempt.stripe_checkout_session_id =
       membership.latest_checkout_session_id
     and attempt.stripe_customer_id = membership.stripe_customer_id
     and attempt.stripe_price_id = membership.stripe_price_id
    where membership.instructor_profile_id = p_instructor_profile_id
      and membership.stripe_subscription_id = p_stripe_subscription_id
      and membership.latest_checkout_session_id =
        p_stripe_checkout_session_id
  ) then
    raise exception 'Completed earned-offer membership not found';
  end if;

  update public.instructor_invitations
  set offer_redeemed_at = now(),
      offer_redeemed_checkout_session_id = p_stripe_checkout_session_id,
      offer_redeemed_subscription_id = p_stripe_subscription_id,
      updated_at = now()
  where id = invitation.id;

  insert into public.membership_admin_events (
    instructor_profile_id,
    event_type,
    detail
  ) values (
    p_instructor_profile_id,
    'offer_redeemed',
    jsonb_build_object(
      'instructor_invitation_id', p_instructor_invitation_id,
      'offer_code', p_offer_code,
      'stripe_checkout_session_id', p_stripe_checkout_session_id,
      'stripe_subscription_id', p_stripe_subscription_id
    )
  );

  return 'redeemed';
end;
$$;

create or replace function public.start_current_membership_guarantee_from_ledger(
  p_instructor_profile_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  guarantee public.instructor_guarantees;
  first_invoice public.membership_paid_invoices;
  prior_first_invoice_id text;
begin
  select guarantee_record.* into guarantee
  from public.instructor_guarantees guarantee_record
  where guarantee_record.instructor_profile_id = p_instructor_profile_id
  for update;

  if guarantee.instructor_profile_id is null then
    return 'no_guarantee';
  end if;
  if guarantee.guarantee_terms_version <>
      '2026-08-07-90-day-paid-invoice-v1' then
    return 'historical_guarantee_preserved';
  end if;
  if guarantee.first_stripe_subscription_id is null then
    return 'activation_pending';
  end if;

  select invoice.* into first_invoice
  from public.membership_paid_invoices invoice
  where invoice.instructor_profile_id = p_instructor_profile_id
    and invoice.stripe_subscription_id =
      guarantee.first_stripe_subscription_id
    and invoice.stripe_customer_id = guarantee.first_stripe_customer_id
  order by invoice.paid_at, invoice.stripe_invoice_id
  limit 1;

  if first_invoice.stripe_invoice_id is null then
    return 'first_payment_pending';
  end if;

  prior_first_invoice_id := guarantee.first_paid_invoice_id;

  if prior_first_invoice_id is not null
    and prior_first_invoice_id is distinct from first_invoice.stripe_invoice_id
    and (
      guarantee.guarantee_status not in ('not_started', 'covered')
      or now() >= first_invoice.paid_at + interval '90 days'
      or exists (
        select 1
        from public.guarantee_claims claim
        where claim.instructor_profile_id = p_instructor_profile_id
      )
      or exists (
        select 1
        from public.membership_refunds refund
        where refund.instructor_profile_id = p_instructor_profile_id
      )
    ) then
    return 'earlier_invoice_requires_manual_review';
  end if;

  update public.instructor_guarantees
  set guarantee_status = case
        when guarantee_status = 'not_started' then 'covered'
        else guarantee_status
      end,
      guarantee_started_at = first_invoice.paid_at,
      guarantee_ends_at = first_invoice.paid_at + interval '90 days',
      claim_deadline_at = first_invoice.paid_at + interval '120 days',
      first_stripe_customer_id = first_invoice.stripe_customer_id,
      first_paid_invoice_id = first_invoice.stripe_invoice_id,
      first_paid_invoice_paid_at = first_invoice.paid_at,
      first_paid_amount_cents = first_invoice.amount_paid_cents,
      first_paid_currency = first_invoice.currency,
      guarantee_duration_days = 90,
      claim_request_window_days = 30
  where instructor_profile_id = p_instructor_profile_id
    and guarantee_terms_version =
      '2026-08-07-90-day-paid-invoice-v1';

  if prior_first_invoice_id is distinct from first_invoice.stripe_invoice_id then
    insert into public.membership_admin_events (
      instructor_profile_id,
      event_type,
      detail
    ) values (
      p_instructor_profile_id,
      'guarantee_started',
      jsonb_build_object(
        'stripe_invoice_id', first_invoice.stripe_invoice_id,
        'stripe_subscription_id', first_invoice.stripe_subscription_id,
        'paid_at', first_invoice.paid_at,
        'guarantee_ends_at', first_invoice.paid_at + interval '90 days',
        'claim_deadline_at', first_invoice.paid_at + interval '120 days',
        'replaced_first_invoice_id', prior_first_invoice_id
      )
    );
    return case
      when prior_first_invoice_id is null then 'guarantee_started'
      else 'guarantee_start_corrected'
    end;
  end if;

  return 'guarantee_unchanged';
end;
$$;

create or replace function public.assign_founding_guarantee_from_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  activation public.stripe_checkout_attempts;
  existing_guarantee public.instructor_guarantees;
  has_historical_obligation boolean := false;
begin
  if new.status not in ('trialing', 'active')
    or new.latest_checkout_session_id is null then
    return new;
  end if;

  select attempt.* into activation
  from public.stripe_checkout_attempts attempt
  where attempt.instructor_profile_id = new.instructor_profile_id
    and attempt.stripe_checkout_session_id = new.latest_checkout_session_id
    and attempt.stripe_customer_id = new.stripe_customer_id
    and attempt.stripe_price_id = new.stripe_price_id
    and attempt.status in ('open', 'completed')
    and attempt.checkout_terms_version = '2026-08-07-membership-v2'
    and attempt.guarantee_terms_version =
      '2026-08-07-90-day-paid-invoice-v1'
  limit 1;

  if activation.id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.instructor_profile_id::text, 0)
  );
  select guarantee_record.* into existing_guarantee
  from public.instructor_guarantees guarantee_record
  where guarantee_record.instructor_profile_id = new.instructor_profile_id
  for update;

  if existing_guarantee.instructor_profile_id is not null
    and existing_guarantee.guarantee_terms_version <>
      '2026-08-07-90-day-paid-invoice-v1' then
    has_historical_obligation :=
      existing_guarantee.founding_member_number is not null
      or existing_guarantee.founding_status in ('reserved', 'active')
      or existing_guarantee.guarantee_started_at is not null
      or existing_guarantee.guarantee_ends_at is not null
      or existing_guarantee.claim_deadline_at is not null
      or existing_guarantee.first_stripe_customer_id is not null
      or existing_guarantee.first_stripe_subscription_id is not null
      or existing_guarantee.guarantee_status in (
        'covered', 'claim_eligible', 'fulfilled', 'claim_received',
        'under_review', 'approved', 'denied', 'refunded', 'expired'
      )
      or exists (
        select 1
        from public.guarantee_claims historical_claim
        where historical_claim.instructor_profile_id =
          new.instructor_profile_id
      );
  end if;

  if has_historical_obligation then
    return new;
  end if;

  if existing_guarantee.instructor_profile_id is null then
    insert into public.instructor_guarantees (
      instructor_profile_id,
      founding_status,
      guarantee_status,
      guarantee_terms_version,
      activation_checkout_session_id,
      first_stripe_customer_id,
      first_stripe_subscription_id,
      guarantee_duration_days,
      claim_request_window_days
    ) values (
      new.instructor_profile_id,
      'not_available',
      'not_started',
      '2026-08-07-90-day-paid-invoice-v1',
      new.latest_checkout_session_id,
      new.stripe_customer_id,
      new.stripe_subscription_id,
      90,
      30
    );
  else
    update public.instructor_guarantees
    set guarantee_terms_version =
          '2026-08-07-90-day-paid-invoice-v1',
        founding_status = case
          when founding_member_number is null then 'not_available'
          else founding_status
        end,
        guarantee_status = case
          when guarantee_terms_version <>
            '2026-08-07-90-day-paid-invoice-v1' then 'not_started'
          else guarantee_status
        end,
        guarantee_started_at = case
          when guarantee_terms_version <>
            '2026-08-07-90-day-paid-invoice-v1' then null
          else guarantee_started_at
        end,
        guarantee_ends_at = case
          when guarantee_terms_version <>
            '2026-08-07-90-day-paid-invoice-v1' then null
          else guarantee_ends_at
        end,
        claim_deadline_at = case
          when guarantee_terms_version <>
            '2026-08-07-90-day-paid-invoice-v1' then null
          else claim_deadline_at
        end,
        activation_checkout_session_id = coalesce(
          activation_checkout_session_id,
          new.latest_checkout_session_id
        ),
        first_stripe_customer_id = coalesce(
          first_stripe_customer_id,
          new.stripe_customer_id
        ),
        first_stripe_subscription_id = coalesce(
          first_stripe_subscription_id,
          new.stripe_subscription_id
        ),
        guarantee_duration_days = coalesce(guarantee_duration_days, 90),
        claim_request_window_days = coalesce(
          claim_request_window_days,
          30
        )
    where instructor_profile_id = new.instructor_profile_id;
  end if;

  perform public.start_current_membership_guarantee_from_ledger(
    new.instructor_profile_id
  );
  return new;
end;
$$;

drop trigger if exists assign_founding_guarantee_from_membership
  on public.instructor_memberships;
create trigger assign_founding_guarantee_from_membership
  after insert or update of status, stripe_created_at, latest_checkout_session_id
  on public.instructor_memberships
  for each row execute function public.assign_founding_guarantee_from_membership();

create or replace function public.record_membership_paid_invoice(
  p_instructor_profile_id uuid,
  p_stripe_invoice_id text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_amount_paid_cents integer,
  p_currency text,
  p_paid_at timestamptz,
  p_billing_reason text,
  p_livemode boolean,
  p_source_event_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_invoice public.membership_paid_invoices;
  inserted_count integer;
  guarantee_result text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_instructor_profile_id is null
    or p_stripe_invoice_id is null
    or p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$'
    or p_stripe_customer_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_stripe_subscription_id is null
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_stripe_price_id is null
    or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
    or p_amount_paid_cents is null
    or p_amount_paid_cents <= 0
    or p_currency is null
    or lower(p_currency) <> 'usd'
    or p_paid_at is null
    or p_billing_reason is null
    or p_billing_reason not in ('subscription_create', 'subscription_cycle')
    or p_livemode is null
    or nullif(trim(p_source_event_id), '') is null then
    raise exception 'Paid membership invoice facts are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  if exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = p_instructor_profile_id
  ) then
    return 'lifetime_access_ignored';
  end if;

  if not exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = p_instructor_profile_id
      and membership.stripe_customer_id = p_stripe_customer_id
      and membership.stripe_subscription_id = p_stripe_subscription_id
      and membership.stripe_price_id = p_stripe_price_id
  ) and not exists (
    select 1
    from public.instructor_guarantees guarantee_record
    where guarantee_record.instructor_profile_id = p_instructor_profile_id
      and guarantee_record.guarantee_terms_version =
        '2026-08-07-90-day-paid-invoice-v1'
      and guarantee_record.first_stripe_customer_id = p_stripe_customer_id
      and guarantee_record.first_stripe_subscription_id =
        p_stripe_subscription_id
  ) then
    raise exception 'Paid invoice does not match this instructor membership';
  end if;

  select invoice.* into existing_invoice
  from public.membership_paid_invoices invoice
  where invoice.stripe_invoice_id = p_stripe_invoice_id;

  if existing_invoice.stripe_invoice_id is not null then
    if existing_invoice.instructor_profile_id is distinct from
        p_instructor_profile_id
      or existing_invoice.stripe_customer_id is distinct from
        p_stripe_customer_id
      or existing_invoice.stripe_subscription_id is distinct from
        p_stripe_subscription_id
      or existing_invoice.stripe_price_id is distinct from p_stripe_price_id
      or existing_invoice.amount_paid_cents is distinct from
        p_amount_paid_cents
      or existing_invoice.currency is distinct from lower(p_currency)
      or existing_invoice.paid_at is distinct from p_paid_at
      or existing_invoice.billing_reason is distinct from p_billing_reason
      or existing_invoice.livemode is distinct from p_livemode then
      raise exception 'Stripe invoice was already recorded with different facts';
    end if;

    guarantee_result := public.start_current_membership_guarantee_from_ledger(
      p_instructor_profile_id
    );
    return 'duplicate:' || guarantee_result;
  end if;

  insert into public.membership_paid_invoices (
    stripe_invoice_id,
    instructor_profile_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    amount_paid_cents,
    currency,
    paid_at,
    billing_reason,
    livemode,
    source_event_id
  ) values (
    p_stripe_invoice_id,
    p_instructor_profile_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_price_id,
    p_amount_paid_cents,
    lower(p_currency),
    p_paid_at,
    p_billing_reason,
    p_livemode,
    trim(p_source_event_id)
  )
  on conflict (stripe_invoice_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'Stripe invoice could not be recorded idempotently';
  end if;

  insert into public.membership_admin_events (
    instructor_profile_id,
    event_type,
    detail
  ) values (
    p_instructor_profile_id,
    'paid_invoice_recorded',
    jsonb_build_object(
      'stripe_invoice_id', p_stripe_invoice_id,
      'stripe_subscription_id', p_stripe_subscription_id,
      'amount_paid_cents', p_amount_paid_cents,
      'currency', lower(p_currency),
      'paid_at', p_paid_at,
      'billing_reason', p_billing_reason,
      'source_event_id', p_source_event_id
    )
  );

  guarantee_result := public.start_current_membership_guarantee_from_ledger(
    p_instructor_profile_id
  );
  return 'recorded:' || guarantee_result;
end;
$$;

alter table public.inquiry_outcome_reports
  add column if not exists booked_first_reported_at timestamptz;

update public.inquiry_outcome_reports
set booked_first_reported_at = coalesce(booked_first_reported_at, created_at)
where outcome = 'booked'
  and booked_first_reported_at is null;

create or replace function public.snapshot_first_booked_report_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.booked_first_reported_at := case
      when new.outcome = 'booked' then now()
      else null
    end;
  elsif old.booked_first_reported_at is not null then
    new.booked_first_reported_at := old.booked_first_reported_at;
  elsif new.outcome = 'booked' and old.outcome <> 'booked' then
    new.booked_first_reported_at := now();
  else
    new.booked_first_reported_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_first_booked_report_time
  on public.inquiry_outcome_reports;
create trigger snapshot_first_booked_report_time
  before insert or update of outcome, booked_first_reported_at
  on public.inquiry_outcome_reports
  for each row execute function public.snapshot_first_booked_report_time();

create or replace function public.guarantee_qualifying_booking_count(
  p_instructor_profile_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct inquiry.id)::integer
  from public.inquiries inquiry
  join public.instructor_profiles profile
    on profile.id = inquiry.instructor_profile_id
  join public.instructor_guarantees guarantee_record
    on guarantee_record.instructor_profile_id = profile.id
  join public.inquiry_outcome_reports report
    on report.inquiry_id = inquiry.id
   and report.reporter_account_id = profile.account_id
   and report.outcome = 'booked'
  where profile.id = p_instructor_profile_id
    and (
      guarantee_record.guarantee_terms_version <>
        '2026-08-07-90-day-paid-invoice-v1'
      or (
        guarantee_record.guarantee_started_at is not null
        and guarantee_record.guarantee_ends_at is not null
        and report.booked_first_reported_at >=
          guarantee_record.guarantee_started_at
        and report.booked_first_reported_at <
          guarantee_record.guarantee_ends_at
      )
    );
$$;

create or replace function public.mark_guarantee_fulfilled_by_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_at timestamptz;
begin
  if new.instructor_profile_id is null or new.booking_outcome <> 'booked' then
    return new;
  end if;

  select min(report.booked_first_reported_at) into evidence_at
  from public.inquiry_outcome_reports report
  join public.instructor_profiles profile
    on profile.account_id = report.reporter_account_id
  join public.instructor_guarantees guarantee_record
    on guarantee_record.instructor_profile_id = profile.id
  where report.inquiry_id = new.id
    and profile.id = new.instructor_profile_id
    and report.outcome = 'booked'
    and (
      guarantee_record.guarantee_terms_version <>
        '2026-08-07-90-day-paid-invoice-v1'
      or (
        guarantee_record.guarantee_started_at is not null
        and guarantee_record.guarantee_ends_at is not null
        and report.booked_first_reported_at >=
          guarantee_record.guarantee_started_at
        and report.booked_first_reported_at <
          guarantee_record.guarantee_ends_at
      )
    );

  if evidence_at is null then
    return new;
  end if;

  update public.instructor_guarantees
  set guarantee_status = 'fulfilled',
      coverage_issue_at = evidence_at,
      coverage_issue_reason =
        'Hire Line Dancers inquiry reported as booked'
  where instructor_profile_id = new.instructor_profile_id
    and guarantee_status in (
      'covered', 'claim_eligible', 'claim_received', 'under_review'
    );

  if found then
    insert into public.membership_admin_events (
      instructor_profile_id,
      event_type,
      detail
    ) values (
      new.instructor_profile_id,
      'guarantee_fulfilled',
      jsonb_build_object(
        'inquiry_id', new.id,
        'qualifying_evidence_at', evidence_at
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists mark_guarantee_fulfilled_by_booking
  on public.inquiries;
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
  guarantee_terms_version text,
  guarantee_started_at timestamptz,
  guarantee_ends_at timestamptz,
  claim_deadline_at timestamptz,
  guarantee_admin_note text,
  qualifying_booking_count integer,
  eligible_paid_amount_cents integer,
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
    coalesce(
      membership.stripe_subscription_id,
      settings.stripe_subscription_id
    ),
    membership_mode.livemode,
    guarantee_record.founding_member_number,
    coalesce(guarantee_record.founding_status, 'unassigned'),
    coalesce(guarantee_record.guarantee_status, 'not_started'),
    guarantee_record.guarantee_terms_version,
    guarantee_record.guarantee_started_at,
    guarantee_record.guarantee_ends_at,
    guarantee_record.claim_deadline_at,
    guarantee_record.admin_note,
    public.guarantee_qualifying_booking_count(profile.id),
    case
      when guarantee_record.guarantee_terms_version =
        '2026-08-07-90-day-paid-invoice-v1' then
        public.guarantee_eligible_paid_amount(profile.id)
      else null
    end,
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
  left join public.instructor_private_settings settings
    on settings.instructor_profile_id = profile.id
  left join public.instructor_memberships membership
    on membership.instructor_profile_id = profile.id
  left join public.instructor_guarantees guarantee_record
    on guarantee_record.instructor_profile_id = profile.id
  left join public.guarantee_claims claim
    on claim.instructor_profile_id = profile.id
  left join lateral (
    select event.livemode
    from public.stripe_webhook_events event
    where event.stripe_object_id = coalesce(
      membership.stripe_subscription_id,
      settings.stripe_subscription_id
    )
    order by
      event.stripe_created_at desc,
      event.processed_at desc,
      event.stripe_event_id desc
    limit 1
  ) membership_mode on true
  left join lateral (
    select
      coalesce(
        sum(refund.amount_cents)
          filter (where refund.stripe_status = 'succeeded'),
        0
      )::integer as verified_refund_cents,
      count(*) filter (
        where refund.stripe_status = 'succeeded'
      )::integer as refund_count,
      max(refund.verified_at) filter (
        where refund.stripe_status = 'succeeded'
      ) as latest_refunded_at
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
  guarantee_record public.instructor_guarantees;
begin
  if not public.current_marketplace_owner_status() then
    raise exception 'Marketplace owner access required';
  end if;
  if p_founding_status not in (
    'unassigned', 'reserved', 'active', 'ended', 'not_available'
  ) then
    raise exception 'Invalid founding status';
  end if;
  if p_guarantee_status not in (
    'not_started', 'covered', 'claim_eligible', 'fulfilled', 'ineligible',
    'claim_received', 'under_review', 'approved', 'denied', 'refunded',
    'expired'
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
    select 1
    from public.instructor_profiles profile
    where profile.id = p_instructor_profile_id
  ) then
    raise exception 'Instructor profile not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select existing.* into guarantee_record
  from public.instructor_guarantees existing
  where existing.instructor_profile_id = p_instructor_profile_id
  for update;

  if p_founding_status in ('unassigned', 'not_available')
    and guarantee_record.founding_member_number is not null then
    raise exception 'An assigned founding position cannot be removed';
  end if;

  if p_founding_status in ('reserved', 'active') then
    next_number := guarantee_record.founding_member_number;
    if next_number is null then
      raise exception 'The founding member program is closed to new assignments';
    end if;
  end if;

  if guarantee_record.instructor_profile_id is null then
    if p_guarantee_status <> 'not_started' then
      raise exception 'A guarantee starts only from a verified paid membership invoice';
    end if;

    insert into public.instructor_guarantees (
      instructor_profile_id,
      founding_member_number,
      founding_status,
      founding_assigned_at,
      guarantee_status,
      guarantee_terms_version,
      guarantee_duration_days,
      claim_request_window_days,
      admin_note,
      updated_by
    ) values (
      p_instructor_profile_id,
      next_number,
      p_founding_status,
      case when next_number is not null then now() end,
      'not_started',
      '2026-08-07-90-day-paid-invoice-v1',
      90,
      30,
      nullif(trim(p_admin_note), ''),
      auth.uid()
    );
  else
    if guarantee_record.guarantee_started_at is null
      and p_guarantee_status <> 'not_started' then
      raise exception 'A guarantee starts only from a verified paid membership invoice';
    end if;
    if guarantee_record.guarantee_started_at is not null
      and p_guarantee_status = 'not_started' then
      raise exception 'A started guarantee cannot return to not started';
    end if;

    update public.instructor_guarantees
    set founding_member_number = case
          when p_founding_status in ('reserved', 'active') then
            coalesce(founding_member_number, next_number)
          else founding_member_number
        end,
        founding_status = p_founding_status,
        founding_assigned_at = case
          when p_founding_status in ('reserved', 'active') then
            coalesce(founding_assigned_at, now())
          else founding_assigned_at
        end,
        founding_ended_at = case
          when p_founding_status in ('ended', 'not_available') then
            coalesce(founding_ended_at, now())
          else founding_ended_at
        end,
        guarantee_status = p_guarantee_status,
        admin_note = nullif(trim(p_admin_note), ''),
        updated_by = auth.uid()
    where instructor_profile_id = p_instructor_profile_id;
  end if;

  insert into public.membership_admin_events (
    instructor_profile_id,
    actor_account_id,
    event_type,
    detail
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
  eligible_paid_amount integer;
  guarantee_record public.instructor_guarantees;
  uses_current_terms boolean;
begin
  if not public.current_marketplace_owner_status() then
    raise exception 'Marketplace owner access required';
  end if;
  if p_received_via not in ('email', 'phone', 'admin', 'other') then
    raise exception 'Invalid claim source';
  end if;
  if p_requested_amount_cents is not null
    and p_requested_amount_cents <= 0 then
    raise exception 'Requested amount must be positive';
  end if;
  if char_length(coalesce(p_instructor_message, '')) > 4000
    or char_length(coalesce(p_admin_note, '')) > 4000 then
    raise exception 'Claim notes must be 4,000 characters or fewer';
  end if;

  select guarantee_candidate.* into guarantee_record
  from public.instructor_guarantees guarantee_candidate
  where guarantee_candidate.instructor_profile_id = p_instructor_profile_id
  for update;

  if guarantee_record.instructor_profile_id is null then
    raise exception 'Guarantee record not found';
  end if;
  if exists (
    select 1
    from public.guarantee_claims existing_claim
    where existing_claim.instructor_profile_id = p_instructor_profile_id
      and (
        existing_claim.status in ('partially_refunded', 'refunded')
        or exists (
          select 1
          from public.membership_refunds refund
          where refund.guarantee_claim_id = existing_claim.id
        )
      )
  ) then
    raise exception 'A claim with a verified refund record cannot be reopened';
  end if;

  uses_current_terms := guarantee_record.guarantee_terms_version =
    '2026-08-07-90-day-paid-invoice-v1';
  booking_count := public.guarantee_qualifying_booking_count(
    p_instructor_profile_id
  );

  if uses_current_terms then
    if guarantee_record.guarantee_started_at is null
      or guarantee_record.guarantee_ends_at is null
      or guarantee_record.claim_deadline_at is null then
      raise exception 'The guarantee has not started because no paid invoice was recorded';
    end if;
    if now() < guarantee_record.guarantee_ends_at then
      raise exception 'The 90-day performance window is still active';
    end if;
    if now() > guarantee_record.claim_deadline_at then
      raise exception 'The guarantee claim deadline has passed';
    end if;
    if guarantee_record.guarantee_status in (
      'fulfilled', 'ineligible', 'denied', 'refunded', 'expired'
    ) or booking_count > 0 then
      raise exception 'This guarantee is not claim eligible';
    end if;

    eligible_paid_amount := public.guarantee_eligible_paid_amount(
      p_instructor_profile_id
    );
    if eligible_paid_amount <= 0 then
      raise exception 'No paid membership invoices are eligible for this claim';
    end if;
    if p_requested_amount_cents is not null
      and p_requested_amount_cents > eligible_paid_amount then
      raise exception 'Requested amount exceeds eligible paid membership invoices';
    end if;
  else
    if guarantee_record.guarantee_started_at is null
      or guarantee_record.guarantee_ends_at is null
      or guarantee_record.claim_deadline_at is null then
      raise exception 'The historical guarantee has no active coverage window';
    end if;
    if now() < guarantee_record.guarantee_ends_at then
      raise exception 'The guarantee performance window is still active';
    end if;
    if now() > guarantee_record.claim_deadline_at then
      raise exception 'The guarantee claim deadline has passed';
    end if;
    if guarantee_record.guarantee_status in (
      'fulfilled', 'ineligible', 'denied', 'refunded', 'expired'
    ) or booking_count > 0 then
      raise exception 'This guarantee is not claim eligible';
    end if;
    eligible_paid_amount := null;
  end if;

  insert into public.guarantee_claims (
    instructor_profile_id,
    received_at,
    received_via,
    claimant_email,
    status,
    requested_amount_cents,
    eligible_paid_amount_cents,
    instructor_message,
    qualifying_booking_count,
    admin_note,
    created_by
  ) values (
    p_instructor_profile_id,
    now(),
    p_received_via,
    nullif(trim(p_claimant_email), ''),
    'received',
    p_requested_amount_cents,
    eligible_paid_amount,
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
      when public.guarantee_claims.status = 'refunded' then
        public.guarantee_claims.status
      else 'received'
    end,
    requested_amount_cents = excluded.requested_amount_cents,
    eligible_paid_amount_cents = excluded.eligible_paid_amount_cents,
    instructor_message = excluded.instructor_message,
    qualifying_booking_count = excluded.qualifying_booking_count,
    admin_note = excluded.admin_note,
    created_by = auth.uid()
  returning id into claim_id;

  update public.instructor_guarantees
  set guarantee_status = case
        when guarantee_status in ('fulfilled', 'refunded') then
          guarantee_status
        else 'claim_received'
      end,
      updated_by = auth.uid()
  where instructor_profile_id = p_instructor_profile_id;

  insert into public.membership_admin_events (
    instructor_profile_id,
    guarantee_claim_id,
    actor_account_id,
    event_type,
    detail
  ) values (
    p_instructor_profile_id,
    claim_id,
    auth.uid(),
    'claim_received',
    jsonb_build_object(
      'qualifying_booking_count', booking_count,
      'eligible_paid_amount_cents', eligible_paid_amount
    )
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
  guarantee_record public.instructor_guarantees;
  next_guarantee_status text;
  booking_count integer;
  eligible_paid_amount integer;
  uses_current_terms boolean;
begin
  if not public.current_marketplace_owner_status() then
    raise exception 'Marketplace owner access required';
  end if;
  if p_status not in (
    'in_review', 'approved', 'denied', 'withdrawn', 'refund_pending'
  ) then
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

  select claim_record.* into claim
  from public.guarantee_claims claim_record
  where claim_record.id = p_claim_id
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

  select guarantee_candidate.* into guarantee_record
  from public.instructor_guarantees guarantee_candidate
  where guarantee_candidate.instructor_profile_id = claim.instructor_profile_id
  for update;
  if guarantee_record.instructor_profile_id is null then
    raise exception 'Guarantee record not found';
  end if;

  uses_current_terms := guarantee_record.guarantee_terms_version =
    '2026-08-07-90-day-paid-invoice-v1';
  booking_count := public.guarantee_qualifying_booking_count(
    claim.instructor_profile_id
  );

  if guarantee_record.guarantee_ends_at is null
    or guarantee_record.claim_deadline_at is null
    or claim.received_at < guarantee_record.guarantee_ends_at
    or claim.received_at > guarantee_record.claim_deadline_at then
    raise exception 'The claim was not received during the request window';
  end if;

  if uses_current_terms then
    eligible_paid_amount := public.guarantee_eligible_paid_amount(
      claim.instructor_profile_id
    );
    if eligible_paid_amount <= 0 then
      raise exception 'No paid membership invoices are eligible for this claim';
    end if;
    if p_status in ('approved', 'refund_pending')
      and p_approved_refund_amount_cents > eligible_paid_amount then
      raise exception 'Approved refund exceeds eligible paid membership invoices';
    end if;
  else
    eligible_paid_amount := null;
  end if;

  if p_status in ('approved', 'refund_pending') and booking_count > 0 then
    raise exception 'This instructor already has a qualifying Hire Line Dancers booking';
  end if;
  if p_status in ('approved', 'refund_pending')
    and claim.requested_amount_cents is not null
    and p_approved_refund_amount_cents > claim.requested_amount_cents then
    raise exception 'Approved refund exceeds the requested amount';
  end if;

  update public.guarantee_claims
  set status = p_status,
      approved_refund_amount_cents = case
        when p_status in ('approved', 'refund_pending') then
          p_approved_refund_amount_cents
        else approved_refund_amount_cents
      end,
      eligible_paid_amount_cents = eligible_paid_amount,
      profile_complete_confirmed = p_profile_complete_confirmed,
      contact_details_current_confirmed =
        p_contact_details_current_confirmed,
      response_requirement_confirmed = p_response_requirement_confirmed,
      qualifying_booking_count = booking_count,
      admin_note = nullif(trim(p_admin_note), ''),
      decision_reason = nullif(trim(p_decision_reason), ''),
      decided_by = case
        when p_status in ('approved', 'denied', 'withdrawn') then auth.uid()
        else decided_by
      end,
      decided_at = case
        when p_status in ('approved', 'denied', 'withdrawn') then now()
        else decided_at
      end
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
    instructor_profile_id,
    guarantee_claim_id,
    actor_account_id,
    event_type,
    detail
  ) values (
    claim.instructor_profile_id,
    claim.id,
    auth.uid(),
    'claim_reviewed',
    jsonb_build_object(
      'claim_status', p_status,
      'approved_refund_amount_cents', p_approved_refund_amount_cents,
      'qualifying_booking_count', booking_count,
      'eligible_paid_amount_cents', eligible_paid_amount
    )
  );
end;
$$;

revoke all on public.membership_paid_invoices from anon, authenticated;
revoke all on public.instructor_guarantees from anon, authenticated;
revoke all on public.guarantee_claims from anon, authenticated;
revoke all on public.membership_refunds from anon, authenticated;
revoke all on public.membership_admin_events from anon, authenticated;

grant select on public.membership_paid_invoices to authenticated;
grant select on public.instructor_guarantees to authenticated;
grant select on public.guarantee_claims to authenticated;
grant select on public.membership_refunds to authenticated;
grant select on public.membership_admin_events to authenticated;

revoke execute on function public.register_instructor_checkout_attempt(
  uuid, text, text, text, text, text, timestamptz, uuid, text,
  timestamptz, text, smallint, text, text
) from public, anon, authenticated;
revoke execute on function public.redeem_instructor_checkout_offer(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke execute on function public.start_current_membership_guarantee_from_ledger(
  uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.assign_founding_guarantee_from_membership()
  from public, anon, authenticated, service_role;
revoke execute on function public.record_membership_paid_invoice(
  uuid, text, text, text, text, integer, text, timestamptz, text,
  boolean, text
) from public, anon, authenticated;
revoke execute on function public.snapshot_first_booked_report_time()
  from public, anon, authenticated, service_role;
revoke execute on function public.guarantee_qualifying_booking_count(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.guarantee_eligible_paid_amount(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.mark_guarantee_fulfilled_by_booking()
  from public, anon, authenticated, service_role;
revoke execute on function public.current_instructor_invitation_offer()
  from public, anon;
revoke execute on function public.admin_list_instructor_invitations()
  from public, anon;
revoke execute on function public.admin_search_instructors(
  text, integer, integer
) from public, anon;
revoke execute on function public.admin_update_instructor_guarantee(
  uuid, text, text, text
) from public, anon;
revoke execute on function public.admin_log_guarantee_claim(
  uuid, text, text, integer, text, text
) from public, anon;
revoke execute on function public.admin_review_guarantee_claim(
  uuid, text, boolean, boolean, boolean, integer, text, text
) from public, anon;
revoke execute on function public.apply_verified_membership_refund(
  uuid, text, text, text, text, text, integer, text, text,
  timestamptz, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.register_instructor_checkout_attempt(
  uuid, text, text, text, text, text, timestamptz, uuid, text,
  timestamptz, text, smallint, text, text
) to service_role;
grant execute on function public.redeem_instructor_checkout_offer(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.record_membership_paid_invoice(
  uuid, text, text, text, text, integer, text, timestamptz, text,
  boolean, text
) to service_role;
grant execute on function public.current_instructor_invitation_offer()
  to authenticated;
grant execute on function public.admin_list_instructor_invitations()
  to authenticated;
grant execute on function public.admin_search_instructors(
  text, integer, integer
) to authenticated;
grant execute on function public.admin_update_instructor_guarantee(
  uuid, text, text, text
) to authenticated;
grant execute on function public.admin_log_guarantee_claim(
  uuid, text, text, integer, text, text
) to authenticated;
grant execute on function public.admin_review_guarantee_claim(
  uuid, text, boolean, boolean, boolean, integer, text, text
) to authenticated;
grant execute on function public.apply_verified_membership_refund(
  uuid, text, text, text, text, text, integer, text, text,
  timestamptz, uuid, text, text
) to service_role;
