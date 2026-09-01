-- Durable membership credits that are awarded in the application and applied
-- to Stripe one renewal at a time. Stripe remains the billing source of truth,
-- while these tables preserve eligibility, retries, and operator audit facts.

create table public.membership_credit_entitlements (
  id uuid primary key default gen_random_uuid(),
  instructor_profile_id uuid not null
    references public.instructor_profiles(id) on delete cascade,
  benefit_code text not null default 'membership_free_month_v1',
  source text not null,
  source_reference text not null,
  idempotency_key uuid not null unique,
  status text not null default 'pending',
  policy_version text not null
    default '2026-09-01-membership-free-month-v1',
  benefit_quantity smallint not null default 1,
  currency text not null default 'usd',
  awarded_by_account_id uuid
    references public.accounts(id) on delete set null,
  admin_note text,
  last_deferred_reason text,
  last_evaluated_at timestamptz,
  awarded_at timestamptz not null default now(),
  applied_at timestamptz,
  consumed_at timestamptz,
  voided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_credit_entitlements_benefit_check check (
    benefit_code = 'membership_free_month_v1'
  ),
  constraint membership_credit_entitlements_source_check check (
    source in ('admin', 'referral', 'welcome_video')
  ),
  constraint membership_credit_entitlements_source_reference_check check (
    source_reference = btrim(source_reference)
    and source_reference ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$'
  ),
  constraint membership_credit_entitlements_status_check check (
    status in (
      'pending', 'applying', 'applied', 'consumed', 'voided', 'needs_review'
    )
  ),
  constraint membership_credit_entitlements_policy_check check (
    policy_version = '2026-09-01-membership-free-month-v1'
  ),
  constraint membership_credit_entitlements_quantity_check check (
    benefit_quantity = 1
  ),
  constraint membership_credit_entitlements_currency_check check (
    currency = 'usd'
  ),
  constraint membership_credit_entitlements_note_check check (
    admin_note is null or (
      admin_note = btrim(admin_note)
      and char_length(admin_note) between 1 and 2000
    )
  ),
  constraint membership_credit_entitlements_deferred_reason_check check (
    last_deferred_reason is null or last_deferred_reason in (
      'no_membership', 'membership_inactive', 'cancellation_scheduled',
      'lifetime_access', 'billing_recovery', 'unsupported_cadence',
      'existing_discount', 'invoice_in_progress',
      'billing_identity_mismatch', 'stripe_configuration',
      'stripe_state_changed', 'another_credit_in_progress',
      'subscription_canceled', 'stripe_request_rejected'
    )
  ),
  constraint membership_credit_entitlements_expiry_check check (
    expires_at is null or expires_at > awarded_at
  ),
  constraint membership_credit_entitlements_status_time_check check (
    (status <> 'consumed' or consumed_at is not null)
    and (status <> 'voided' or voided_at is not null)
    and (consumed_at is null or applied_at is not null)
  ),
  unique (source, source_reference)
);

create table public.membership_credit_applications (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null
    references public.membership_credit_entitlements(id) on delete cascade,
  instructor_profile_id uuid not null
    references public.instructor_profiles(id) on delete cascade,
  attempt_number integer not null,
  status text not null default 'applying',
  stripe_idempotency_key text not null unique,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_price_id text not null,
  stripe_coupon_id text,
  stripe_discount_id text,
  stripe_invoice_id text,
  stripe_request_id text,
  consumption_event_id text,
  deferred_reason text,
  failure_code text,
  actual_discount_amount_cents integer,
  currency text not null default 'usd',
  livemode boolean not null,
  started_at timestamptz not null default now(),
  applied_at timestamptz,
  consumed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_credit_applications_attempt_check check (
    attempt_number > 0
  ),
  constraint membership_credit_applications_status_check check (
    status in (
      'applying', 'applied', 'consumed', 'deferred', 'abandoned',
      'needs_review'
    )
  ),
  constraint membership_credit_applications_idempotency_check check (
    stripe_idempotency_key ~
      '^hld-membership-credit-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint membership_credit_applications_customer_check check (
    stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  ),
  constraint membership_credit_applications_subscription_check check (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  constraint membership_credit_applications_price_check check (
    stripe_price_id ~ '^price_[A-Za-z0-9]+$'
  ),
  constraint membership_credit_applications_coupon_check check (
    stripe_coupon_id is null
      or stripe_coupon_id ~ '^[A-Za-z0-9_-]+$'
  ),
  constraint membership_credit_applications_discount_check check (
    stripe_discount_id is null
      or stripe_discount_id ~ '^di_[A-Za-z0-9]+$'
  ),
  constraint membership_credit_applications_invoice_check check (
    stripe_invoice_id is null
      or stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'
  ),
  constraint membership_credit_applications_request_check check (
    stripe_request_id is null
      or stripe_request_id ~ '^req_[A-Za-z0-9]+$'
  ),
  constraint membership_credit_applications_deferred_reason_check check (
    deferred_reason is null or deferred_reason in (
      'no_membership', 'membership_inactive', 'cancellation_scheduled',
      'lifetime_access', 'billing_recovery', 'unsupported_cadence',
      'existing_discount', 'invoice_in_progress',
      'billing_identity_mismatch', 'stripe_configuration',
      'stripe_state_changed', 'another_credit_in_progress',
      'subscription_canceled', 'stripe_request_rejected'
    )
  ),
  constraint membership_credit_applications_failure_code_check check (
    failure_code is null or failure_code ~ '^[a-z0-9_]{1,100}$'
  ),
  constraint membership_credit_applications_amount_check check (
    actual_discount_amount_cents is null
      or actual_discount_amount_cents > 0
  ),
  constraint membership_credit_applications_currency_check check (
    currency = 'usd'
  ),
  constraint membership_credit_applications_status_time_check check (
    (status not in ('applied', 'consumed') or applied_at is not null)
    and (status <> 'consumed' or consumed_at is not null)
    and (
      status in ('applying', 'applied')
      or completed_at is not null
    )
  ),
  unique (entitlement_id, attempt_number)
);

create index membership_credit_entitlements_profile_awarded_idx
  on public.membership_credit_entitlements (
    instructor_profile_id, awarded_at desc, id desc
  );

create index membership_credit_entitlements_actor_idx
  on public.membership_credit_entitlements (awarded_by_account_id)
  where awarded_by_account_id is not null;

create index membership_credit_entitlements_pending_idx
  on public.membership_credit_entitlements (
    instructor_profile_id, awarded_at, id
  )
  where status = 'pending';

create index membership_credit_applications_profile_idx
  on public.membership_credit_applications (
    instructor_profile_id, created_at desc, id desc
  );

create unique index membership_credit_applications_one_live_entitlement
  on public.membership_credit_applications (entitlement_id)
  where status in ('applying', 'applied');

create unique index membership_credit_applications_one_live_profile
  on public.membership_credit_applications (instructor_profile_id)
  where status in ('applying', 'applied');

create unique index membership_credit_applications_discount_unique
  on public.membership_credit_applications (stripe_discount_id)
  where stripe_discount_id is not null;

create unique index membership_credit_applications_invoice_unique
  on public.membership_credit_applications (stripe_invoice_id)
  where stripe_invoice_id is not null;

create unique index membership_credit_applications_event_unique
  on public.membership_credit_applications (consumption_event_id)
  where consumption_event_id is not null;

create trigger set_membership_credit_entitlements_updated_at
  before update on public.membership_credit_entitlements
  for each row execute function public.set_updated_at();

create trigger set_membership_credit_applications_updated_at
  before update on public.membership_credit_applications
  for each row execute function public.set_updated_at();

alter table public.membership_admin_events
  add column membership_credit_entitlement_id uuid
    references public.membership_credit_entitlements(id) on delete set null,
  add column membership_credit_application_id uuid
    references public.membership_credit_applications(id) on delete set null;

create index membership_admin_events_credit_entitlement_idx
  on public.membership_admin_events (membership_credit_entitlement_id)
  where membership_credit_entitlement_id is not null;

create index membership_admin_events_credit_application_idx
  on public.membership_admin_events (membership_credit_application_id)
  where membership_credit_application_id is not null;

alter table public.membership_admin_events
  drop constraint if exists membership_admin_events_type_check;

alter table public.membership_admin_events
  add constraint membership_admin_events_type_check check (
    event_type in (
      'founding_assigned', 'guarantee_updated', 'guarantee_fulfilled',
      'claim_received', 'claim_reviewed', 'refund_verified', 'benefits_ended',
      'offer_redeemed', 'paid_invoice_recorded', 'guarantee_started',
      'billing_grace_started', 'first_payment_failed', 'billing_recovered',
      'billing_recovery_closed', 'billing_grace_expired',
      'credit_granted', 'credit_application_deferred', 'credit_applied',
      'credit_consumed', 'credit_requeued', 'credit_needs_review'
    )
  );

alter table public.membership_credit_entitlements enable row level security;
alter table public.membership_credit_applications enable row level security;

create policy "admins read membership credit entitlements"
  on public.membership_credit_entitlements
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read membership credit applications"
  on public.membership_credit_applications
  for select to authenticated
  using (public.is_marketplace_admin());

create or replace function public.admin_list_membership_credit_entitlements(
  p_instructor_profile_id uuid
)
returns table (
  id uuid,
  instructor_profile_id uuid,
  benefit_code text,
  source text,
  source_reference text,
  status text,
  admin_note text,
  awarded_by_account_id uuid,
  awarded_at timestamptz,
  applied_at timestamptz,
  consumed_at timestamptz,
  voided_at timestamptz,
  expires_at timestamptz,
  application_id uuid,
  application_status text,
  deferred_reason text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  actual_discount_amount_cents integer,
  currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;

  if p_instructor_profile_id is null then
    raise exception 'Instructor profile is required';
  end if;

  return query
  select
    entitlement.id,
    entitlement.instructor_profile_id,
    entitlement.benefit_code,
    entitlement.source,
    entitlement.source_reference,
    entitlement.status,
    entitlement.admin_note,
    entitlement.awarded_by_account_id,
    entitlement.awarded_at,
    entitlement.applied_at,
    entitlement.consumed_at,
    entitlement.voided_at,
    entitlement.expires_at,
    application.id,
    application.status,
    coalesce(application.deferred_reason, entitlement.last_deferred_reason),
    application.stripe_subscription_id,
    application.stripe_invoice_id,
    application.actual_discount_amount_cents,
    entitlement.currency
  from public.membership_credit_entitlements entitlement
  left join lateral (
    select candidate.*
    from public.membership_credit_applications candidate
    where candidate.entitlement_id = entitlement.id
    order by candidate.attempt_number desc, candidate.created_at desc
    limit 1
  ) application on true
  where entitlement.instructor_profile_id = p_instructor_profile_id
  order by entitlement.awarded_at desc, entitlement.id desc;
end;
$$;

create or replace function public.issue_membership_credit_entitlement(
  p_instructor_profile_id uuid,
  p_source text,
  p_source_reference text,
  p_idempotency_key uuid,
  p_awarded_by_account_id uuid default null,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement public.membership_credit_entitlements;
  normalized_source text := lower(btrim(coalesce(p_source, '')));
  normalized_reference text := btrim(coalesce(p_source_reference, ''));
  normalized_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
begin
  if p_instructor_profile_id is null
    or p_idempotency_key is null
    or normalized_source not in ('admin', 'referral', 'welcome_video')
    or normalized_reference !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$'
    or char_length(coalesce(normalized_note, '')) > 2000 then
    raise exception 'Membership credit request is invalid';
  end if;

  if not exists (
    select 1
    from public.instructor_profiles profile
    where profile.id = p_instructor_profile_id
  ) then
    raise exception 'Instructor profile not found';
  end if;

  if p_awarded_by_account_id is not null and not exists (
    select 1
    from public.marketplace_admins admin_access
    where admin_access.account_id = p_awarded_by_account_id
  ) then
    raise exception 'Awarding administrator is invalid';
  end if;

  if normalized_source = 'admin' and not exists (
    select 1
    from public.marketplace_admins owner_access
    where owner_access.account_id = p_awarded_by_account_id
      and owner_access.is_owner
  ) then
    raise exception 'Marketplace owner access required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'membership-credit:' || p_instructor_profile_id::text,
      0
    )
  );

  select existing.* into entitlement
  from public.membership_credit_entitlements existing
  where existing.idempotency_key = p_idempotency_key;

  if entitlement.id is not null then
    if entitlement.instructor_profile_id <> p_instructor_profile_id
      or entitlement.source <> normalized_source
      or entitlement.source_reference <> normalized_reference then
      raise exception 'Membership credit idempotency key was reused';
    end if;

    return jsonb_build_object(
      'result', 'existing',
      'entitlement', to_jsonb(entitlement)
    );
  end if;

  select existing.* into entitlement
  from public.membership_credit_entitlements existing
  where existing.source = normalized_source
    and existing.source_reference = normalized_reference;

  if entitlement.id is not null then
    if entitlement.instructor_profile_id <> p_instructor_profile_id then
      raise exception 'Membership credit source reference was reused';
    end if;

    return jsonb_build_object(
      'result', 'existing',
      'entitlement', to_jsonb(entitlement)
    );
  end if;

  insert into public.membership_credit_entitlements (
    instructor_profile_id,
    source,
    source_reference,
    idempotency_key,
    awarded_by_account_id,
    admin_note
  ) values (
    p_instructor_profile_id,
    normalized_source,
    normalized_reference,
    p_idempotency_key,
    p_awarded_by_account_id,
    normalized_note
  ) returning * into entitlement;

  insert into public.membership_admin_events (
    instructor_profile_id,
    membership_credit_entitlement_id,
    actor_account_id,
    event_type,
    detail
  ) values (
    entitlement.instructor_profile_id,
    entitlement.id,
    p_awarded_by_account_id,
    'credit_granted',
    jsonb_build_object(
      'benefit_code', entitlement.benefit_code,
      'source', entitlement.source,
      'source_reference', entitlement.source_reference,
      'policy_version', entitlement.policy_version
    )
  );

  return jsonb_build_object(
    'result', 'created',
    'entitlement', to_jsonb(entitlement)
  );
end;
$$;

create or replace function public.claim_membership_credit_application(
  p_instructor_profile_id uuid,
  p_entitlement_id uuid,
  p_expected_price_id text,
  p_expected_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement public.membership_credit_entitlements;
  application public.membership_credit_applications;
  membership public.instructor_memberships;
  next_application_id uuid;
  next_attempt integer;
  deferred_reason text;
  reason_changed boolean;
begin
  if p_instructor_profile_id is null
    or p_expected_price_id is null
    or p_expected_price_id !~ '^price_[A-Za-z0-9]+$'
    or p_expected_livemode is null then
    raise exception 'Membership credit claim is invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'membership-credit:' || p_instructor_profile_id::text,
      0
    )
  );

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.instructor_profile_id = p_instructor_profile_id
    and candidate.status in ('applying', 'applied')
  order by candidate.created_at, candidate.id
  limit 1
  for update;

  if application.id is not null then
    if p_entitlement_id is not null
      and application.entitlement_id <> p_entitlement_id then
      update public.membership_credit_entitlements
      set last_deferred_reason = 'another_credit_in_progress',
          last_evaluated_at = now()
      where id = p_entitlement_id
        and instructor_profile_id = p_instructor_profile_id
        and status = 'pending';

      return jsonb_build_object(
        'result', 'deferred',
        'deferredReason', 'another_credit_in_progress',
        'blockingEntitlementId', application.entitlement_id
      );
    end if;

    return jsonb_build_object(
      'result', case
        when application.status = 'applying' then 'resuming'
        else 'applied'
      end,
      'application', to_jsonb(application)
    );
  end if;

  if p_entitlement_id is not null then
    select candidate.* into entitlement
    from public.membership_credit_entitlements candidate
    where candidate.id = p_entitlement_id
      and candidate.instructor_profile_id = p_instructor_profile_id
    for update;
  else
    select candidate.* into entitlement
    from public.membership_credit_entitlements candidate
    where candidate.instructor_profile_id = p_instructor_profile_id
      and candidate.status = 'pending'
      and (candidate.expires_at is null or candidate.expires_at > now())
    order by candidate.awarded_at, candidate.id
    limit 1
    for update skip locked;
  end if;

  if entitlement.id is null then
    return jsonb_build_object('result', 'empty');
  end if;

  if entitlement.status <> 'pending' then
    return jsonb_build_object(
      'result', 'existing',
      'entitlement', to_jsonb(entitlement)
    );
  end if;

  select current_membership.* into membership
  from public.instructor_memberships current_membership
  where current_membership.instructor_profile_id = p_instructor_profile_id
  for update;

  if exists (
    select 1
    from public.instructor_lifetime_access lifetime_access
    where lifetime_access.instructor_profile_id = p_instructor_profile_id
  ) then
    deferred_reason := 'lifetime_access';
  elsif membership.instructor_profile_id is null then
    deferred_reason := 'no_membership';
  elsif membership.status not in ('active', 'trialing') then
    deferred_reason := 'membership_inactive';
  elsif membership.cancel_at_period_end then
    deferred_reason := 'cancellation_scheduled';
  elsif membership.stripe_price_id <> p_expected_price_id then
    deferred_reason := 'unsupported_cadence';
  elsif exists (
    select 1
    from public.instructor_billing_recoveries recovery
    where recovery.instructor_profile_id = p_instructor_profile_id
      and recovery.status in ('grace_period', 'access_paused')
  ) then
    deferred_reason := 'billing_recovery';
  end if;

  if deferred_reason is not null then
    reason_changed := entitlement.last_deferred_reason is distinct from
      deferred_reason;

    update public.membership_credit_entitlements
    set last_deferred_reason = deferred_reason,
        last_evaluated_at = now()
    where id = entitlement.id;

    if reason_changed then
      insert into public.membership_admin_events (
        instructor_profile_id,
        membership_credit_entitlement_id,
        event_type,
        detail
      ) values (
        entitlement.instructor_profile_id,
        entitlement.id,
        'credit_application_deferred',
        jsonb_build_object('reason', deferred_reason)
      );
    end if;

    return jsonb_build_object(
      'result', 'deferred',
      'entitlementId', entitlement.id,
      'deferredReason', deferred_reason
    );
  end if;

  next_application_id := gen_random_uuid();
  select coalesce(max(candidate.attempt_number), 0) + 1
    into next_attempt
  from public.membership_credit_applications candidate
  where candidate.entitlement_id = entitlement.id;

  insert into public.membership_credit_applications (
    id,
    entitlement_id,
    instructor_profile_id,
    attempt_number,
    stripe_idempotency_key,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    livemode
  ) values (
    next_application_id,
    entitlement.id,
    entitlement.instructor_profile_id,
    next_attempt,
    'hld-membership-credit-' || next_application_id::text,
    membership.stripe_customer_id,
    membership.stripe_subscription_id,
    membership.stripe_price_id,
    p_expected_livemode
  ) returning * into application;

  update public.membership_credit_entitlements
  set status = 'applying',
      last_deferred_reason = null,
      last_evaluated_at = now()
  where id = entitlement.id;

  return jsonb_build_object(
    'result', 'claimed',
    'application', to_jsonb(application)
  );
end;
$$;

create or replace function public.defer_membership_credit_application(
  p_application_id uuid,
  p_deferred_reason text,
  p_failure_code text default null,
  p_needs_review boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.membership_credit_applications;
  next_status text := case when coalesce(p_needs_review, false)
    then 'needs_review' else 'deferred' end;
begin
  if p_application_id is null
    or p_deferred_reason is null
    or p_deferred_reason not in (
      'no_membership', 'membership_inactive', 'cancellation_scheduled',
      'lifetime_access', 'billing_recovery', 'unsupported_cadence',
      'existing_discount', 'invoice_in_progress',
      'billing_identity_mismatch', 'stripe_configuration',
      'stripe_state_changed', 'another_credit_in_progress',
      'subscription_canceled', 'stripe_request_rejected'
    )
    or (
      p_failure_code is not null
      and p_failure_code !~ '^[a-z0-9_]{1,100}$'
    ) then
    raise exception 'Membership credit deferral is invalid';
  end if;

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.id = p_application_id;

  if application.id is null then
    raise exception 'Membership credit application not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'membership-credit:' || application.instructor_profile_id::text,
      0
    )
  );

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.id = p_application_id
  for update;

  if application.status in ('deferred', 'needs_review') then
    return jsonb_build_object(
      'result', 'existing',
      'applicationId', application.id,
      'status', application.status
    );
  end if;

  if application.status <> 'applying' then
    raise exception 'Membership credit application cannot be deferred';
  end if;

  update public.membership_credit_applications
  set status = next_status,
      deferred_reason = p_deferred_reason,
      failure_code = p_failure_code,
      completed_at = now()
  where id = application.id;

  update public.membership_credit_entitlements
  set status = case when next_status = 'needs_review'
        then 'needs_review' else 'pending' end,
      last_deferred_reason = p_deferred_reason,
      last_evaluated_at = now()
  where id = application.entitlement_id;

  insert into public.membership_admin_events (
    instructor_profile_id,
    membership_credit_entitlement_id,
    membership_credit_application_id,
    event_type,
    detail
  ) values (
    application.instructor_profile_id,
    application.entitlement_id,
    application.id,
    case when next_status = 'needs_review'
      then 'credit_needs_review'
      else 'credit_application_deferred'
    end,
    jsonb_strip_nulls(jsonb_build_object(
      'reason', p_deferred_reason,
      'failure_code', p_failure_code
    ))
  );

  return jsonb_build_object(
    'result', next_status,
    'applicationId', application.id,
    'entitlementId', application.entitlement_id,
    'deferredReason', p_deferred_reason
  );
end;
$$;

create or replace function public.mark_membership_credit_applied(
  p_application_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_stripe_coupon_id text,
  p_stripe_discount_id text,
  p_stripe_request_id text default null,
  p_applied_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.membership_credit_applications;
  entitlement public.membership_credit_entitlements;
  requeue_recovered boolean := false;
begin
  if p_application_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
    or p_stripe_coupon_id !~ '^[A-Za-z0-9_-]+$'
    or p_stripe_discount_id !~ '^di_[A-Za-z0-9]+$'
    or (p_stripe_request_id is not null
      and p_stripe_request_id !~ '^req_[A-Za-z0-9]+$')
    or p_applied_at is null then
    raise exception 'Applied membership credit facts are invalid';
  end if;

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.id = p_application_id;

  if application.id is null then
    raise exception 'Membership credit application not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'membership-credit:' || application.instructor_profile_id::text,
      0
    )
  );

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.id = p_application_id
  for update;

  if application.status in ('applied', 'consumed') then
    if application.stripe_customer_id <> p_stripe_customer_id
      or application.stripe_subscription_id <> p_stripe_subscription_id
      or application.stripe_price_id <> p_stripe_price_id
      or application.stripe_coupon_id <> p_stripe_coupon_id
      or application.stripe_discount_id <> p_stripe_discount_id then
      raise exception 'Applied membership credit facts changed';
    end if;

    return jsonb_build_object(
      'result', 'existing',
      'applicationId', application.id,
      'status', application.status
    );
  end if;

  if application.status = 'abandoned' then
    if application.deferred_reason <> 'subscription_canceled'
      or application.applied_at is not null
      or application.stripe_coupon_id is not null
      or application.stripe_discount_id is not null then
      raise exception 'Abandoned membership credit cannot be recovered as applying';
    end if;

    select candidate.* into entitlement
    from public.membership_credit_entitlements candidate
    where candidate.id = application.entitlement_id
    for update;

    if entitlement.id is null
      or entitlement.status <> 'pending'
      or exists (
        select 1
        from public.membership_credit_applications replacement
        where replacement.entitlement_id = application.entitlement_id
          and replacement.id <> application.id
          and replacement.status in ('applying', 'applied', 'consumed')
      ) then
      raise exception 'Requeued membership credit already has a replacement application';
    end if;

    requeue_recovered := true;
  elsif application.status <> 'applying' then
    raise exception 'Membership credit application no longer matches Stripe';
  end if;

  if application.stripe_customer_id <> p_stripe_customer_id
    or application.stripe_subscription_id <> p_stripe_subscription_id
    or application.stripe_price_id <> p_stripe_price_id then
    raise exception 'Membership credit application no longer matches Stripe';
  end if;

  if not exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = application.instructor_profile_id
      and membership.stripe_customer_id = p_stripe_customer_id
      and membership.stripe_subscription_id = p_stripe_subscription_id
      and membership.stripe_price_id = p_stripe_price_id
  ) then
    raise exception 'Canonical membership changed before credit application';
  end if;

  update public.membership_credit_applications
  set status = 'applied',
      stripe_coupon_id = p_stripe_coupon_id,
      stripe_discount_id = p_stripe_discount_id,
      stripe_request_id = p_stripe_request_id,
      applied_at = p_applied_at,
      deferred_reason = null,
      failure_code = null
  where id = application.id;

  update public.membership_credit_entitlements
  set status = 'applied',
      applied_at = coalesce(applied_at, p_applied_at),
      last_deferred_reason = null,
      last_evaluated_at = now()
  where id = application.entitlement_id;

  insert into public.membership_admin_events (
    instructor_profile_id,
    membership_credit_entitlement_id,
    membership_credit_application_id,
    event_type,
    detail
  ) values (
    application.instructor_profile_id,
    application.entitlement_id,
    application.id,
    'credit_applied',
    jsonb_build_object(
      'stripe_subscription_id', p_stripe_subscription_id,
      'stripe_discount_id', p_stripe_discount_id,
      'stripe_coupon_id', p_stripe_coupon_id,
      'requeue_recovered', requeue_recovered
    )
  );

  return jsonb_build_object(
    'result', 'applied',
    'applicationId', application.id,
    'entitlementId', application.entitlement_id,
    'requeueRecovered', requeue_recovered
  );
end;
$$;

create or replace function public.consume_membership_credit_application(
  p_event_id text,
  p_application_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_stripe_coupon_id text,
  p_stripe_discount_id text,
  p_stripe_invoice_id text,
  p_actual_discount_amount_cents integer,
  p_currency text,
  p_livemode boolean,
  p_consumed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.membership_credit_applications;
  entitlement public.membership_credit_entitlements;
  requeue_reversed boolean := false;
  application_recovered boolean := false;
begin
  if nullif(btrim(p_event_id), '') is null
    or p_application_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
    or p_stripe_coupon_id !~ '^[A-Za-z0-9_-]+$'
    or p_stripe_discount_id !~ '^di_[A-Za-z0-9]+$'
    or p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$'
    or p_actual_discount_amount_cents is null
    or p_actual_discount_amount_cents <= 0
    or lower(btrim(p_currency)) <> 'usd'
    or p_livemode is null
    or p_consumed_at is null then
    raise exception 'Membership credit consumption facts are invalid';
  end if;

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.id = p_application_id;

  if application.id is null then
    raise exception 'Membership credit application not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'membership-credit:' || application.instructor_profile_id::text,
      0
    )
  );

  select candidate.* into application
  from public.membership_credit_applications candidate
  where candidate.id = p_application_id
  for update;

  if application.status = 'consumed' then
    if application.stripe_invoice_id <> p_stripe_invoice_id
      or application.stripe_discount_id <> p_stripe_discount_id then
      raise exception 'Consumed membership credit facts changed';
    end if;

    return jsonb_build_object(
      'result', 'duplicate',
      'applicationId', application.id,
      'entitlementId', application.entitlement_id
    );
  end if;

  if application.status in ('applying', 'abandoned') then
    select candidate.* into entitlement
    from public.membership_credit_entitlements candidate
    where candidate.id = application.entitlement_id
    for update;

    if entitlement.id is null
      or (
        application.status = 'applying'
        and entitlement.status <> 'applying'
      )
      or (
        application.status = 'abandoned'
        and (
          application.deferred_reason <> 'subscription_canceled'
          or entitlement.status <> 'pending'
        )
      )
      or exists (
        select 1
        from public.membership_credit_applications replacement
        where replacement.entitlement_id = application.entitlement_id
          and replacement.id <> application.id
          and replacement.status in ('applying', 'applied', 'consumed')
      ) then
      raise exception 'Requeued membership credit already has a replacement application';
    end if;

    if application.applied_at is null then
      if application.stripe_coupon_id is not null
        or application.stripe_discount_id is not null then
        raise exception 'Recovering membership credit has partial Stripe facts';
      end if;
      application_recovered := true;
    elsif application.status = 'abandoned' then
      if application.stripe_coupon_id is null
        or application.stripe_discount_id is null then
        raise exception 'Requeued membership credit is missing Stripe facts';
      end if;
      requeue_reversed := true;
    else
      raise exception 'Applying membership credit has inconsistent Stripe facts';
    end if;
  elsif application.status <> 'applied' then
    raise exception 'Membership credit invoice does not match its application';
  end if;

  if application.stripe_customer_id <> p_stripe_customer_id
    or application.stripe_subscription_id <> p_stripe_subscription_id
    or application.stripe_price_id <> p_stripe_price_id
    or (
      not application_recovered
      and application.stripe_coupon_id <> p_stripe_coupon_id
    )
    or (
      not application_recovered
      and application.stripe_discount_id <> p_stripe_discount_id
    )
    or application.livemode <> p_livemode then
    raise exception 'Membership credit invoice does not match its application';
  end if;

  update public.membership_credit_applications
  set status = 'consumed',
      stripe_coupon_id = p_stripe_coupon_id,
      stripe_discount_id = p_stripe_discount_id,
      stripe_invoice_id = p_stripe_invoice_id,
      consumption_event_id = btrim(p_event_id),
      actual_discount_amount_cents = p_actual_discount_amount_cents,
      currency = lower(btrim(p_currency)),
      applied_at = coalesce(applied_at, p_consumed_at),
      consumed_at = p_consumed_at,
      completed_at = p_consumed_at
  where id = application.id;

  update public.membership_credit_entitlements
  set status = 'consumed',
      applied_at = coalesce(
        applied_at, application.applied_at, p_consumed_at
      ),
      consumed_at = p_consumed_at,
      last_deferred_reason = null,
      last_evaluated_at = now()
  where id = application.entitlement_id;

  insert into public.membership_admin_events (
    instructor_profile_id,
    membership_credit_entitlement_id,
    membership_credit_application_id,
    event_type,
    detail
  ) values (
    application.instructor_profile_id,
    application.entitlement_id,
    application.id,
    'credit_consumed',
    jsonb_build_object(
      'stripe_invoice_id', p_stripe_invoice_id,
      'stripe_discount_id', p_stripe_discount_id,
      'actual_discount_amount_cents', p_actual_discount_amount_cents,
      'currency', lower(btrim(p_currency)),
      'requeue_reversed', requeue_reversed,
      'application_recovered', application_recovered
    )
  );

  return jsonb_build_object(
    'result', 'consumed',
    'applicationId', application.id,
    'entitlementId', application.entitlement_id,
    'stripeInvoiceId', p_stripe_invoice_id,
    'requeueReversed', requeue_reversed,
    'applicationRecovered', application_recovered
  );
end;
$$;

create or replace function public.requeue_canceled_membership_credits(
  p_instructor_profile_id uuid,
  p_stripe_subscription_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.membership_credit_applications;
  requeued_count integer := 0;
begin
  if p_instructor_profile_id is null
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'Canceled membership credit facts are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'membership-credit:' || p_instructor_profile_id::text,
      0
    )
  );

  for application in
    select candidate.*
    from public.membership_credit_applications candidate
    where candidate.instructor_profile_id = p_instructor_profile_id
      and candidate.stripe_subscription_id = p_stripe_subscription_id
      and candidate.status in ('applying', 'applied')
    order by candidate.created_at, candidate.id
    for update
  loop
    update public.membership_credit_applications
    set status = 'abandoned',
        deferred_reason = 'subscription_canceled',
        completed_at = now()
    where id = application.id;

    update public.membership_credit_entitlements
    set status = 'pending',
        applied_at = null,
        last_deferred_reason = 'subscription_canceled',
        last_evaluated_at = now()
    where id = application.entitlement_id
      and status in ('applying', 'applied');

    insert into public.membership_admin_events (
      instructor_profile_id,
      membership_credit_entitlement_id,
      membership_credit_application_id,
      event_type,
      detail
    ) values (
      application.instructor_profile_id,
      application.entitlement_id,
      application.id,
      'credit_requeued',
      jsonb_build_object(
        'reason', 'subscription_canceled',
        'stripe_subscription_id', p_stripe_subscription_id
      )
    );

    requeued_count := requeued_count + 1;
  end loop;

  return requeued_count;
end;
$$;

revoke all on public.membership_credit_entitlements
  from public, anon, authenticated;
revoke all on public.membership_credit_applications
  from public, anon, authenticated;

grant select on public.membership_credit_entitlements to authenticated;
grant select on public.membership_credit_applications to authenticated;
grant select, insert, update on public.membership_credit_entitlements
  to service_role;
grant select, insert, update on public.membership_credit_applications
  to service_role;

revoke execute on function public.admin_list_membership_credit_entitlements(uuid)
  from public, anon, service_role;
revoke execute on function public.issue_membership_credit_entitlement(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.claim_membership_credit_application(
  uuid, uuid, text, boolean
) from public, anon, authenticated;
revoke execute on function public.defer_membership_credit_application(
  uuid, text, text, boolean
) from public, anon, authenticated;
revoke execute on function public.mark_membership_credit_applied(
  uuid, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke execute on function public.consume_membership_credit_application(
  text, uuid, text, text, text, text, text, text, integer, text, boolean,
  timestamptz
) from public, anon, authenticated;
revoke execute on function public.requeue_canceled_membership_credits(uuid, text)
  from public, anon, authenticated;

grant execute on function public.admin_list_membership_credit_entitlements(uuid)
  to authenticated;
grant execute on function public.issue_membership_credit_entitlement(
  uuid, text, text, uuid, uuid, text
) to service_role;
grant execute on function public.claim_membership_credit_application(
  uuid, uuid, text, boolean
) to service_role;
grant execute on function public.defer_membership_credit_application(
  uuid, text, text, boolean
) to service_role;
grant execute on function public.mark_membership_credit_applied(
  uuid, text, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.consume_membership_credit_application(
  text, uuid, text, text, text, text, text, text, integer, text, boolean,
  timestamptz
) to service_role;
grant execute on function public.requeue_canceled_membership_credits(uuid, text)
  to service_role;
