-- Resolve a PL/pgSQL variable and notification column name ambiguity found by production schema lint.

create or replace function public.begin_instructor_billing_recovery(
  p_event_id text,
  p_instructor_profile_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_failed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recovery public.instructor_billing_recoveries;
  has_paid boolean;
  recipient_email text;
  next_status text;
  next_grace_ends_at timestamptz;
  email_notification_type text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if nullif(trim(p_event_id), '') is null
    or p_instructor_profile_id is null
    or p_stripe_customer_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_stripe_subscription_id is null
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_stripe_invoice_id is null
    or p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$'
    or p_failed_at is null then
    raise exception 'Billing recovery facts are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  if exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = p_instructor_profile_id
  ) then
    return jsonb_build_object('result', 'lifetime_access_ignored');
  end if;

  if not exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = p_instructor_profile_id
      and membership.stripe_customer_id = p_stripe_customer_id
      and membership.stripe_subscription_id = p_stripe_subscription_id
  ) then
    raise exception 'Billing recovery does not match the instructor membership';
  end if;

  select recovery_record.* into recovery
  from public.instructor_billing_recoveries recovery_record
  where recovery_record.initial_stripe_invoice_id = p_stripe_invoice_id
     or (
       recovery_record.instructor_profile_id = p_instructor_profile_id
       and recovery_record.status in ('grace_period', 'access_paused')
     )
  order by
    (recovery_record.initial_stripe_invoice_id = p_stripe_invoice_id) desc,
    recovery_record.created_at desc
  limit 1
  for update;

  if recovery.id is not null then
    if recovery.stripe_customer_id is distinct from p_stripe_customer_id
      or recovery.stripe_subscription_id is distinct from
        p_stripe_subscription_id then
      raise exception 'Billing recovery was recorded with different Stripe facts';
    end if;

    if recovery.status not in ('grace_period', 'access_paused') then
      return jsonb_build_object(
        'result', 'closed_event_ignored',
        'recoveryId', recovery.id,
        'status', recovery.status
      );
    end if;

    if recovery.last_stripe_event_id = trim(p_event_id) then
      return jsonb_build_object(
        'result', 'duplicate',
        'recoveryId', recovery.id,
        'status', recovery.status,
        'graceEndsAt', recovery.grace_ends_at,
        'hasPriorSuccessfulPayment', recovery.has_prior_successful_payment
      );
    end if;

    update public.instructor_billing_recoveries
    set latest_stripe_invoice_id = p_stripe_invoice_id,
        last_failed_at = greatest(last_failed_at, p_failed_at),
        failure_count = failure_count + 1,
        last_stripe_event_id = trim(p_event_id),
        updated_at = now()
    where id = recovery.id
    returning * into recovery;

    return jsonb_build_object(
      'result', 'existing',
      'recoveryId', recovery.id,
      'status', recovery.status,
      'graceEndsAt', recovery.grace_ends_at,
      'hasPriorSuccessfulPayment', recovery.has_prior_successful_payment
    );
  end if;

  select exists (
    select 1
    from public.membership_paid_invoices invoice
    where invoice.instructor_profile_id = p_instructor_profile_id
  ) into has_paid;

  next_status := case when has_paid then 'grace_period' else 'access_paused' end;
  next_grace_ends_at := case
    when has_paid then p_failed_at + interval '14 days'
    else null
  end;

  insert into public.instructor_billing_recoveries (
    instructor_profile_id,
    stripe_customer_id,
    stripe_subscription_id,
    initial_stripe_invoice_id,
    latest_stripe_invoice_id,
    status,
    has_prior_successful_payment,
    first_failed_at,
    last_failed_at,
    grace_ends_at,
    access_paused_at,
    last_stripe_event_id
  ) values (
    p_instructor_profile_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_invoice_id,
    p_stripe_invoice_id,
    next_status,
    has_paid,
    p_failed_at,
    p_failed_at,
    next_grace_ends_at,
    case when has_paid then null else p_failed_at end,
    trim(p_event_id)
  ) returning * into recovery;

  if has_paid then
    update public.instructor_profiles
    set status = 'published',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = p_instructor_profile_id
      and approved_at is not null
      and status = 'approved';
    email_notification_type := 'billing_grace_started';
  else
    update public.instructor_profiles
    set status = 'approved',
        updated_at = now()
    where id = p_instructor_profile_id
      and status = 'published';
    email_notification_type := 'billing_access_paused';
  end if;

  insert into public.membership_admin_events (
    instructor_profile_id,
    event_type,
    detail
  ) values (
    p_instructor_profile_id,
    case when has_paid
      then 'billing_grace_started'
      else 'first_payment_failed'
    end,
    jsonb_build_object(
      'recovery_id', recovery.id,
      'stripe_invoice_id', p_stripe_invoice_id,
      'grace_ends_at', next_grace_ends_at,
      'has_prior_successful_payment', has_paid
    )
  );

  select lower(trim(account.email)) into recipient_email
  from public.instructor_profiles profile
  join public.accounts account on account.id = profile.account_id
  where profile.id = p_instructor_profile_id;

  if recipient_email is not null
    and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    insert into public.instructor_service_notification_jobs (
      instructor_profile_id,
      billing_recovery_id,
      notification_type,
      dedupe_key,
      delivered_to_email,
      login_email
    ) values (
      p_instructor_profile_id,
      recovery.id,
      email_notification_type,
      recovery.id::text,
      recipient_email,
      recipient_email
    ) on conflict (notification_type, dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'result', 'created',
    'recoveryId', recovery.id,
    'status', recovery.status,
    'graceEndsAt', recovery.grace_ends_at,
    'hasPriorSuccessfulPayment', recovery.has_prior_successful_payment
  );
end;
$$;
