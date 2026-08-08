-- Collect and verify an instructor payment method before profile review.
-- A verified Setup Checkout submission remains private until an administrator
-- approves it. The first 100 verified submissions receive the public founding
-- offer; a timely private invitation remains a fallback after those slots fill.

alter table public.instructor_private_settings
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_payment_setup_intent_id text,
  add column if not exists stripe_payment_setup_checkout_session_id text,
  add column if not exists payment_setup_completed_at timestamptz;

alter table public.instructor_private_settings
  drop constraint if exists instructor_private_payment_setup_check;

alter table public.instructor_private_settings
  add constraint instructor_private_payment_setup_check check (
    (
      stripe_payment_method_id is null
      and stripe_payment_setup_intent_id is null
      and stripe_payment_setup_checkout_session_id is null
      and payment_setup_completed_at is null
    )
    or (
      stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
      and stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'
      and stripe_payment_setup_intent_id ~ '^seti_[A-Za-z0-9]+$'
      and stripe_payment_setup_checkout_session_id ~
        '^cs_(live|test)_[A-Za-z0-9]+$'
      and payment_setup_completed_at is not null
    )
  );

create table if not exists public.instructor_payment_setups (
  id uuid primary key default gen_random_uuid(),
  instructor_profile_id uuid not null
    references public.instructor_profiles(id) on delete cascade,
  request_key text not null,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text not null,
  checkout_url text not null,
  status text not null default 'open',
  expires_at timestamptz not null,
  stripe_setup_intent_id text unique,
  stripe_payment_method_id text,
  livemode boolean not null,
  setup_terms_version text not null,
  completion_event_id text unique,
  completed_at timestamptz,
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instructor_profile_id, request_key),
  constraint instructor_payment_setups_request_key_check check (
    request_key ~ '^[A-Za-z0-9_-]{8,64}$'
  ),
  constraint instructor_payment_setups_session_check check (
    stripe_checkout_session_id ~ '^cs_(live|test)_[A-Za-z0-9]+$'
  ),
  constraint instructor_payment_setups_customer_check check (
    stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  ),
  constraint instructor_payment_setups_url_check check (
    checkout_url ~ '^https://[^[:space:]]+$'
  ),
  constraint instructor_payment_setups_status_check check (
    status in ('open', 'completed', 'superseded', 'expired', 'failed')
  ),
  constraint instructor_payment_setups_expiry_check check (
    expires_at > created_at
  ),
  constraint instructor_payment_setups_terms_check check (
    setup_terms_version = '2026-08-08-payment-setup-v1'
  ),
  constraint instructor_payment_setups_completion_check check (
    (
      status in ('completed', 'superseded')
      and stripe_setup_intent_id ~ '^seti_[A-Za-z0-9]+$'
      and stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'
      and nullif(trim(completion_event_id), '') is not null
      and completed_at is not null
      and observed_at is not null
    )
    or (
      status not in ('completed', 'superseded')
      and stripe_setup_intent_id is null
      and stripe_payment_method_id is null
      and completion_event_id is null
      and completed_at is null
      and observed_at is null
    )
  )
);

create unique index if not exists instructor_payment_setups_one_open
  on public.instructor_payment_setups (instructor_profile_id)
  where status = 'open';

create index if not exists instructor_payment_setups_expiry_idx
  on public.instructor_payment_setups (status, expires_at)
  where status = 'open';

create table if not exists public.instructor_offer_entitlements (
  id uuid primary key default gen_random_uuid(),
  instructor_profile_id uuid unique
    references public.instructor_profiles(id) on delete set null,
  source text not null,
  offer_code text not null,
  founding_position smallint unique,
  instructor_invitation_id uuid unique
    references public.instructor_invitations(id) on delete restrict,
  earned_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_checkout_session_id text unique,
  redeemed_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_offer_entitlements_source_check check (
    source in ('founding_first_100', 'private_invitation')
  ),
  constraint instructor_offer_entitlements_source_fields_check check (
    (
      source = 'founding_first_100'
      and offer_code = 'founding_two_months_90_day_v1'
      and founding_position between 1 and 100
      and instructor_invitation_id is null
    )
    or (
      source = 'private_invitation'
      and offer_code = 'outreach_two_months_90_day_v1'
      and founding_position is null
      and instructor_invitation_id is not null
    )
  ),
  constraint instructor_offer_entitlements_redemption_check check (
    (
      redeemed_at is null
      and redeemed_checkout_session_id is null
      and redeemed_subscription_id is null
    )
    or (
      redeemed_at is not null
      and redeemed_checkout_session_id ~ '^cs_(live|test)_[A-Za-z0-9]+$'
      and redeemed_subscription_id ~ '^sub_[A-Za-z0-9]+$'
    )
  )
);

drop trigger if exists set_instructor_payment_setups_updated_at
  on public.instructor_payment_setups;
create trigger set_instructor_payment_setups_updated_at
  before update on public.instructor_payment_setups
  for each row execute function public.set_updated_at();

drop trigger if exists set_instructor_offer_entitlements_updated_at
  on public.instructor_offer_entitlements;
create trigger set_instructor_offer_entitlements_updated_at
  before update on public.instructor_offer_entitlements
  for each row execute function public.set_updated_at();

alter table public.instructor_payment_setups enable row level security;
alter table public.instructor_offer_entitlements enable row level security;

drop policy if exists "admins read instructor payment setups"
  on public.instructor_payment_setups;

drop policy if exists "admins read instructor offer entitlements"
  on public.instructor_offer_entitlements;
create policy "admins read instructor offer entitlements"
  on public.instructor_offer_entitlements
  for select to authenticated using (public.is_marketplace_admin());

-- Owners may maintain contact preferences, but no authenticated browser may
-- delete the row that anchors verified billing identity.
drop policy if exists "instructors manage private settings"
  on public.instructor_private_settings;
drop policy if exists "instructors read private settings"
  on public.instructor_private_settings;
create policy "instructors read private settings"
  on public.instructor_private_settings
  for select to authenticated using (
    exists (
      select 1
      from public.instructor_profiles profile
      where profile.id = instructor_profile_id
        and profile.account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );
drop policy if exists "instructors create private settings"
  on public.instructor_private_settings;
create policy "instructors create private settings"
  on public.instructor_private_settings
  for insert to authenticated with check (
    exists (
      select 1
      from public.instructor_profiles profile
      where profile.id = instructor_profile_id
        and profile.account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );
drop policy if exists "instructors update private settings"
  on public.instructor_private_settings;
create policy "instructors update private settings"
  on public.instructor_private_settings
  for update to authenticated
  using (
    exists (
      select 1
      from public.instructor_profiles profile
      where profile.id = instructor_profile_id
        and profile.account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  )
  with check (
    exists (
      select 1
      from public.instructor_profiles profile
      where profile.id = instructor_profile_id
        and profile.account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

-- Payment identifiers are owned by verified Stripe workflows. Preserve the
-- existing protection for membership fields and extend it to Setup Checkout.
create or replace function public.protect_membership_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if not public.is_marketplace_admin() then
      new.inquiry_email := coalesce(auth.jwt() ->> 'email', new.inquiry_email);
    end if;
    if tg_op = 'INSERT' then
      new.stripe_customer_id := null;
      new.stripe_subscription_id := null;
      new.subscription_status := 'inactive';
      new.stripe_payment_method_id := null;
      new.stripe_payment_setup_intent_id := null;
      new.stripe_payment_setup_checkout_session_id := null;
      new.payment_setup_completed_at := null;
    else
      new.stripe_customer_id := old.stripe_customer_id;
      new.stripe_subscription_id := old.stripe_subscription_id;
      new.subscription_status := old.subscription_status;
      new.stripe_payment_method_id := old.stripe_payment_method_id;
      new.stripe_payment_setup_intent_id :=
        old.stripe_payment_setup_intent_id;
      new.stripe_payment_setup_checkout_session_id :=
        old.stripe_payment_setup_checkout_session_id;
      new.payment_setup_completed_at := old.payment_setup_completed_at;
    end if;
  end if;
  return new;
end;
$$;

-- Direct browser updates may save a draft or withdraw a pending submission,
-- but they cannot submit a profile without a verified payment setup or the
-- authenticated lifetime-access workflow below.
create or replace function public.protect_instructor_review_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved', 'published') then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;

    if auth.role() = 'authenticated' then
      if new.status <> 'draft' then
        raise exception 'New profiles must begin as drafts';
      end if;
      if new.approved_at is not null or new.approved_by is not null then
        raise exception 'Review fields require an administrator';
      end if;
    end if;
    return new;
  end if;

  if auth.role() = 'authenticated'
    and new.status in ('approved', 'published')
    and (
      old.status in ('draft', 'pending_review')
      or (old.status = 'suspended' and old.approved_at is null)
    ) then
    raise exception 'Initial instructor approval requires the verified server workflow';
  end if;

  if auth.role() = 'authenticated'
    and (
      new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by
    ) then
    raise exception 'Review fields require the verified server workflow';
  end if;

  -- Once approval is durable, keep it stable until the exact canonical Setup
  -- Checkout has a synchronized membership and its one non-stackable offer,
  -- is durably redeemed. The idempotent server workflow can safely retry.
  if auth.role() = 'authenticated'
    and old.status in ('approved', 'published')
    and new.status is distinct from old.status
    and exists (
      select 1
      from public.instructor_private_settings settings
      join public.instructor_payment_setups payment_setup
        on payment_setup.instructor_profile_id = settings.instructor_profile_id
       and payment_setup.stripe_checkout_session_id =
         settings.stripe_payment_setup_checkout_session_id
       and payment_setup.stripe_customer_id = settings.stripe_customer_id
       and payment_setup.stripe_setup_intent_id =
         settings.stripe_payment_setup_intent_id
       and payment_setup.stripe_payment_method_id =
         settings.stripe_payment_method_id
      where settings.instructor_profile_id = old.id
        and payment_setup.status = 'completed'
        and (
          not exists (
            select 1
            from public.instructor_memberships membership
            where membership.instructor_profile_id = old.id
              and membership.stripe_customer_id =
                settings.stripe_customer_id
              and membership.stripe_subscription_id =
                settings.stripe_subscription_id
              and membership.latest_checkout_session_id =
                payment_setup.stripe_checkout_session_id
          )
          or exists (
            select 1
            from public.instructor_offer_entitlements entitlement
            where entitlement.instructor_profile_id = old.id
              and entitlement.redeemed_at is null
          )
        )
    ) then
    raise exception 'Membership activation is in progress';
  end if;

  if new.status in ('approved', 'published')
    and old.status not in ('approved', 'published') then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, auth.uid());
  end if;

  if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
    if new.id is distinct from old.id
      or new.account_id is distinct from old.account_id
      or new.slug is distinct from old.slug
      or new.created_at is distinct from old.created_at then
      raise exception 'Profile identity fields require an administrator';
    end if;
    if new.published_at is distinct from old.published_at
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by then
      raise exception 'Review fields require an administrator';
    end if;
    if old.status not in ('draft', 'approved', 'published') then
      if not (
        old.status = 'pending_review'
        and new.status = 'draft'
        and (to_jsonb(new) - 'status' - 'updated_at')
          is not distinct from (to_jsonb(old) - 'status' - 'updated_at')
      ) then
        raise exception 'Profile content is locked in its current review state';
      end if;
    end if;
    if new.status is distinct from old.status then
      if old.status = 'draft' and new.status = 'pending_review' then
        if coalesce(
          current_setting(
            'hire_line_dancers.allow_profile_submission',
            true
          ),
          ''
        ) <> 'on' then
          raise exception 'Complete the payment setup before submitting for review';
        end if;
      elsif not (
        old.status = 'pending_review' and new.status = 'draft'
      ) then
        raise exception 'That profile status change requires an administrator';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Lifetime access and paid activation are mutually exclusive once the
-- canonical payment setup completes or an offer is allocated. The shared
-- profile lock makes a racing lifetime grant win before completion or fail
-- before Stripe billing begins, regardless of later status changes.
create or replace function public.block_lifetime_access_during_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.instructor_profile_id::text, 0)
  );

  if exists (
    select 1
    from public.instructor_offer_entitlements entitlement
    where entitlement.instructor_profile_id = new.instructor_profile_id
      and entitlement.redeemed_at is null
  ) or exists (
    select 1
    from public.instructor_profiles profile
    join public.instructor_private_settings settings
      on settings.instructor_profile_id = profile.id
    join public.instructor_payment_setups payment_setup
      on payment_setup.instructor_profile_id = profile.id
     and payment_setup.stripe_checkout_session_id =
       settings.stripe_payment_setup_checkout_session_id
     and payment_setup.stripe_customer_id = settings.stripe_customer_id
     and payment_setup.stripe_setup_intent_id =
       settings.stripe_payment_setup_intent_id
     and payment_setup.stripe_payment_method_id =
       settings.stripe_payment_method_id
    where profile.id = new.instructor_profile_id
      and payment_setup.status = 'completed'
      and not exists (
        select 1
        from public.instructor_memberships membership
        where membership.instructor_profile_id = profile.id
          and membership.stripe_customer_id = settings.stripe_customer_id
          and membership.stripe_subscription_id =
            settings.stripe_subscription_id
          and membership.latest_checkout_session_id =
            payment_setup.stripe_checkout_session_id
      )
  ) then
    raise exception 'Membership activation must finish before lifetime access';
  end if;

  return new;
end;
$$;

drop trigger if exists block_lifetime_access_during_activation
  on public.instructor_lifetime_access;
create trigger block_lifetime_access_during_activation
  before insert on public.instructor_lifetime_access
  for each row execute function public.block_lifetime_access_during_activation();

create or replace function public.instructor_profile_is_payment_ready(
  p_instructor_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.instructor_profiles profile
    join public.instructor_private_settings settings
      on settings.instructor_profile_id = profile.id
    where profile.id = p_instructor_profile_id
      and nullif(trim(profile.display_name), '') is not null
      and nullif(trim(profile.bio), '') is not null
      and nullif(trim(profile.city), '') is not null
      and nullif(trim(profile.region), '') is not null
      and coalesce(cardinality(profile.event_types), 0) > 0
      and settings.inquiry_email ~
        '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and exists (
        select 1
        from public.profile_media media
        where media.instructor_profile_id = profile.id
          and media.media_type = 'headshot'
          and media.status = 'ready'
      )
  );
$$;

create or replace function public.register_instructor_payment_setup(
  p_instructor_profile_id uuid,
  p_request_key text,
  p_stripe_checkout_session_id text,
  p_stripe_customer_id text,
  p_checkout_url text,
  p_expires_at timestamptz,
  p_livemode boolean,
  p_setup_terms_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  settings public.instructor_private_settings;
  existing public.instructor_payment_setups;
  result public.instructor_payment_setups;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_instructor_profile_id is null
    or p_request_key is null
    or p_request_key !~ '^[A-Za-z0-9_-]{8,64}$'
    or p_stripe_checkout_session_id is null
    or p_stripe_checkout_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$'
    or p_stripe_customer_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_checkout_url is null
    or p_checkout_url !~ '^https://[^[:space:]]+$'
    or p_expires_at is null
    or p_expires_at <= now()
    or p_livemode is null
    or p_setup_terms_version is distinct from
      '2026-08-08-payment-setup-v1' then
    raise exception 'Payment setup registration is invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.id = p_instructor_profile_id
  for update;

  if profile.id is null then
    raise exception 'Instructor profile not found';
  end if;
  if profile.status <> 'draft' then
    raise exception 'A draft instructor profile is required for payment setup';
  end if;
  if exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile.id
  ) then
    raise exception 'This instructor has lifetime access and does not need payment setup';
  end if;
  if exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = profile.id
      and membership.status in (
        'trialing', 'active', 'past_due', 'unpaid', 'paused'
      )
  ) then
    raise exception 'This instructor already has a live membership';
  end if;

  select private_settings.* into settings
  from public.instructor_private_settings private_settings
  where private_settings.instructor_profile_id = profile.id
  for update;

  if settings.instructor_profile_id is null then
    raise exception 'Complete instructor contact settings before payment setup';
  end if;
  if settings.stripe_customer_id is not null
    and settings.stripe_customer_id <> p_stripe_customer_id then
    raise exception 'Payment setup customer does not match this instructor';
  end if;

  update public.instructor_payment_setups payment_setup
  set status = 'expired',
      updated_at = now()
  where payment_setup.instructor_profile_id = profile.id
    and payment_setup.status = 'open'
    and payment_setup.expires_at <= now();

  select payment_setup.* into existing
  from public.instructor_payment_setups payment_setup
  where payment_setup.instructor_profile_id = profile.id
    and payment_setup.request_key = p_request_key;

  if existing.id is not null then
    if existing.stripe_checkout_session_id is distinct from
        p_stripe_checkout_session_id
      or existing.stripe_customer_id is distinct from p_stripe_customer_id
      or existing.checkout_url is distinct from p_checkout_url
      or existing.livemode is distinct from p_livemode
      or existing.setup_terms_version is distinct from
        p_setup_terms_version then
      raise exception 'Payment setup request key was already used for different details';
    end if;
    return jsonb_build_object(
      'registered', false,
      'reused', true,
      'url', existing.checkout_url,
      'sessionId', existing.stripe_checkout_session_id,
      'requestKey', existing.request_key,
      'expiresAt', existing.expires_at
    );
  end if;

  select payment_setup.* into existing
  from public.instructor_payment_setups payment_setup
  where payment_setup.instructor_profile_id = profile.id
    and payment_setup.status = 'open'
    and payment_setup.expires_at > now()
  limit 1;

  if existing.id is not null then
    return jsonb_build_object(
      'registered', false,
      'reused', true,
      'url', existing.checkout_url,
      'sessionId', existing.stripe_checkout_session_id,
      'requestKey', existing.request_key,
      'expiresAt', existing.expires_at
    );
  end if;

  update public.instructor_private_settings
  set stripe_customer_id = p_stripe_customer_id,
      updated_at = now()
  where instructor_profile_id = profile.id;

  insert into public.instructor_payment_setups (
    instructor_profile_id,
    request_key,
    stripe_checkout_session_id,
    stripe_customer_id,
    checkout_url,
    status,
    expires_at,
    livemode,
    setup_terms_version
  ) values (
    profile.id,
    p_request_key,
    p_stripe_checkout_session_id,
    p_stripe_customer_id,
    p_checkout_url,
    'open',
    p_expires_at,
    p_livemode,
    p_setup_terms_version
  ) returning * into result;

  return jsonb_build_object(
    'registered', true,
    'reused', false,
    'url', result.checkout_url,
    'sessionId', result.stripe_checkout_session_id,
    'requestKey', result.request_key,
    'expiresAt', result.expires_at
  );
end;
$$;

create or replace function public.complete_instructor_payment_setup(
  p_event_id text,
  p_instructor_profile_id uuid,
  p_account_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_setup_intent_id text,
  p_stripe_customer_id text,
  p_stripe_payment_method_id text,
  p_livemode boolean,
  p_setup_terms_version text,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  payment_setup public.instructor_payment_setups;
  entitlement public.instructor_offer_entitlements;
  invitation public.instructor_invitations;
  next_founding_position smallint;
  has_prior_activation boolean;
  completion_time timestamptz := now();
  result_label text := 'completed';
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if nullif(trim(p_event_id), '') is null
    or p_instructor_profile_id is null
    or p_account_id is null
    or p_stripe_checkout_session_id is null
    or p_stripe_checkout_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$'
    or p_stripe_setup_intent_id is null
    or p_stripe_setup_intent_id !~ '^seti_[A-Za-z0-9]+$'
    or p_stripe_customer_id is null
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_stripe_payment_method_id is null
    or p_stripe_payment_method_id !~ '^pm_[A-Za-z0-9]+$'
    or p_livemode is null
    or p_setup_terms_version is distinct from
      '2026-08-08-payment-setup-v1'
    or p_observed_at is null then
    raise exception 'Verified payment setup facts are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.id = p_instructor_profile_id
  for update;

  if profile.id is null or profile.account_id is distinct from p_account_id then
    raise exception 'Payment setup does not match this instructor account';
  end if;

  select setup_record.* into payment_setup
  from public.instructor_payment_setups setup_record
  where setup_record.instructor_profile_id = profile.id
    and setup_record.stripe_checkout_session_id =
      p_stripe_checkout_session_id
  for update;

  if payment_setup.id is null
    or payment_setup.stripe_customer_id is distinct from p_stripe_customer_id
    or payment_setup.livemode is distinct from p_livemode
    or payment_setup.setup_terms_version is distinct from
      p_setup_terms_version then
    raise exception 'Registered payment setup does not match Stripe';
  end if;

  if payment_setup.status in ('completed', 'superseded') then
    if payment_setup.stripe_setup_intent_id is distinct from
        p_stripe_setup_intent_id
      or payment_setup.stripe_payment_method_id is distinct from
        p_stripe_payment_method_id then
      raise exception 'Payment setup was already completed with different facts';
    end if;
    result_label := 'duplicate';
  elsif payment_setup.status not in ('open', 'expired') then
    raise exception 'Payment setup is not available for completion';
  end if;

  if payment_setup.status = 'superseded'
    or (
      payment_setup.status = 'completed'
      and profile.status = 'draft'
    ) then
    select entitlement_record.* into entitlement
    from public.instructor_offer_entitlements entitlement_record
    where entitlement_record.instructor_profile_id = profile.id;

    return jsonb_build_object(
      'result', 'duplicate',
      'profileStatus', profile.status,
      'entitlementId', entitlement.id,
      'entitlementSource', entitlement.source,
      'offerCode', entitlement.offer_code,
      'foundingPosition', entitlement.founding_position
    );
  end if;

  if profile.status <> 'draft' then
    if payment_setup.status = 'completed'
      and profile.status in (
        'pending_review', 'approved', 'published', 'suspended'
      ) then
      select entitlement_record.* into entitlement
      from public.instructor_offer_entitlements entitlement_record
      where entitlement_record.instructor_profile_id = profile.id;

      return jsonb_build_object(
        'result', result_label,
        'profileStatus', profile.status,
        'entitlementId', entitlement.id,
        'entitlementSource', entitlement.source,
        'offerCode', entitlement.offer_code,
        'foundingPosition', entitlement.founding_position
      );
    end if;
    raise exception 'A draft instructor profile is required for payment completion';
  end if;

  if not public.instructor_profile_is_payment_ready(profile.id) then
    raise exception 'Complete the profile, inquiry email, and ready headshot before continuing';
  end if;
  if exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile.id
  ) then
    raise exception 'This instructor has lifetime access and does not need payment setup';
  end if;

  if payment_setup.status <> 'completed' then
    update public.instructor_payment_setups prior_setup
    set status = 'superseded',
        updated_at = now()
    where prior_setup.instructor_profile_id = profile.id
      and prior_setup.status = 'completed'
      and prior_setup.id <> payment_setup.id;

    update public.instructor_payment_setups
    set status = 'completed',
        stripe_setup_intent_id = p_stripe_setup_intent_id,
        stripe_payment_method_id = p_stripe_payment_method_id,
        completion_event_id = trim(p_event_id),
        completed_at = completion_time,
        observed_at = p_observed_at,
        updated_at = now()
    where id = payment_setup.id;
  end if;

  update public.instructor_private_settings
  set stripe_customer_id = p_stripe_customer_id,
      stripe_payment_method_id = p_stripe_payment_method_id,
      stripe_payment_setup_intent_id = p_stripe_setup_intent_id,
      stripe_payment_setup_checkout_session_id =
        p_stripe_checkout_session_id,
      payment_setup_completed_at = coalesce(
        payment_setup.completed_at,
        completion_time
      ),
      updated_at = now()
  where instructor_profile_id = profile.id;

  if not found then
    raise exception 'Instructor payment settings were not found';
  end if;

  perform set_config(
    'hire_line_dancers.allow_profile_submission',
    'on',
    true
  );
  update public.instructor_profiles
  set status = 'pending_review',
      updated_at = now()
  where id = profile.id
    and status = 'draft';

  -- Serialize the finite public offer. Profile locking happens first in every
  -- payment completion, then this one global lock assigns the next free slot.
  perform pg_advisory_xact_lock(
    hashtextextended('hire-line-dancers-founding-payment-setups-v1', 0)
  );

  select entitlement_record.* into entitlement
  from public.instructor_offer_entitlements entitlement_record
  where entitlement_record.instructor_profile_id = profile.id;

  if entitlement.id is null then
    -- The public founding offer is for genuinely new paid instructors. A
    -- returned or recreated profile cannot earn it after any prior billing,
    -- activation, guarantee, paid invoice, or redeemed invitation benefit.
    select
      exists (
        select 1
        from public.instructor_memberships membership
        where membership.instructor_profile_id = profile.id
      )
      or exists (
        select 1
        from public.instructor_private_settings private_settings
        where private_settings.instructor_profile_id = profile.id
          and private_settings.stripe_subscription_id is not null
      )
      or exists (
        select 1
        from public.stripe_checkout_attempts checkout_attempt
        where checkout_attempt.instructor_profile_id = profile.id
          and checkout_attempt.status = 'completed'
      )
      or exists (
        select 1
        from public.instructor_invitations redeemed_invitation
        where redeemed_invitation.accepted_profile_id = profile.id
          and redeemed_invitation.offer_redeemed_at is not null
      )
      or exists (
        select 1
        from public.membership_paid_invoices paid_invoice
        where paid_invoice.instructor_profile_id = profile.id
      )
      or exists (
        select 1
        from public.instructor_guarantees guarantee_record
        where guarantee_record.instructor_profile_id = profile.id
          and (
            guarantee_record.founding_member_number is not null
            or guarantee_record.founding_status in ('reserved', 'active')
            or guarantee_record.activation_checkout_session_id is not null
            or guarantee_record.first_stripe_customer_id is not null
            or guarantee_record.first_stripe_subscription_id is not null
            or guarantee_record.first_paid_invoice_id is not null
            or guarantee_record.guarantee_started_at is not null
            or guarantee_record.guarantee_ends_at is not null
            or guarantee_record.claim_deadline_at is not null
            or guarantee_record.guarantee_status <> 'not_started'
          )
      )
      or exists (
        select 1
        from public.guarantee_claims guarantee_claim
        where guarantee_claim.instructor_profile_id = profile.id
      )
    into has_prior_activation;

    if not has_prior_activation then
      select slot::smallint into next_founding_position
      from generate_series(1, 100) slot
      where not exists (
        select 1
        from public.instructor_offer_entitlements existing_entitlement
        where existing_entitlement.founding_position = slot
      )
      order by slot
      limit 1;
    end if;

    if next_founding_position is not null then
      insert into public.instructor_offer_entitlements (
        instructor_profile_id,
        source,
        offer_code,
        founding_position,
        earned_at
      ) values (
        profile.id,
        'founding_first_100',
        'founding_two_months_90_day_v1',
        next_founding_position,
        completion_time
      )
      returning * into entitlement;
    elsif not has_prior_activation then
      select invitation_record.* into invitation
      from public.instructor_invitations invitation_record
      where invitation_record.accepted_profile_id = profile.id
        and invitation_record.status = 'accepted'
        and invitation_record.offer_code =
          'outreach_two_months_90_day_v1'
        and invitation_record.offer_eligible
        and invitation_record.offer_earned_at is not null
        and invitation_record.offer_redeemed_at is null
      order by invitation_record.offer_earned_at,
        invitation_record.created_at
      limit 1
      for update;

      if invitation.id is not null then
        insert into public.instructor_offer_entitlements (
          instructor_profile_id,
          source,
          offer_code,
          instructor_invitation_id,
          earned_at
        ) values (
          profile.id,
          'private_invitation',
          invitation.offer_code,
          invitation.id,
          invitation.offer_earned_at
        )
        returning * into entitlement;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'result', result_label,
    'profileStatus', 'pending_review',
    'entitlementId', entitlement.id,
    'entitlementSource', entitlement.source,
    'offerCode', entitlement.offer_code,
    'foundingPosition', entitlement.founding_position
  );
end;
$$;

create or replace function public.submit_lifetime_instructor_profile_for_review()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  submitted_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.account_id = auth.uid();

  if profile.id is null then
    raise exception 'Instructor profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(profile.id::text, 0));
  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.id = profile.id
  for update;

  if not exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile.id
  ) then
    raise exception 'Lifetime instructor access is required';
  end if;
  if profile.status = 'pending_review' then
    return jsonb_build_object(
      'profileStatus', profile.status,
      'submittedAt', profile.updated_at
    );
  end if;
  if profile.status <> 'draft' then
    raise exception 'A draft instructor profile is required for submission';
  end if;
  if not public.instructor_profile_is_payment_ready(profile.id) then
    raise exception 'Complete the profile, inquiry email, and ready headshot before continuing';
  end if;

  perform set_config(
    'hire_line_dancers.allow_profile_submission',
    'on',
    true
  );
  update public.instructor_profiles
  set status = 'pending_review',
      updated_at = submitted_at
  where id = profile.id;

  return jsonb_build_object(
    'profileStatus', 'pending_review',
    'submittedAt', submitted_at
  );
end;
$$;

create or replace function public.resubmit_instructor_profile_after_payment_setup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  settings public.instructor_private_settings;
  entitlement_id uuid;
  submitted_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.account_id = auth.uid();

  if profile.id is null then
    raise exception 'Instructor profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(profile.id::text, 0));
  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.id = profile.id
  for update;

  select private_settings.* into settings
  from public.instructor_private_settings private_settings
  where private_settings.instructor_profile_id = profile.id
  for update;

  select offer.id into entitlement_id
  from public.instructor_offer_entitlements offer
  where offer.instructor_profile_id = profile.id;

  if profile.status = 'pending_review' then
    return jsonb_build_object(
      'profileStatus', profile.status,
      'submittedAt', profile.updated_at,
      'entitlementId', entitlement_id
    );
  end if;
  if profile.status <> 'draft' then
    raise exception 'A draft instructor profile is required for resubmission';
  end if;
  if settings.instructor_profile_id is null
    or settings.stripe_customer_id is null
    or settings.stripe_payment_method_id is null
    or settings.stripe_payment_setup_intent_id is null
    or settings.stripe_payment_setup_checkout_session_id is null
    or settings.payment_setup_completed_at is null
    or not exists (
      select 1
      from public.instructor_payment_setups payment_setup
      where payment_setup.instructor_profile_id = profile.id
        and payment_setup.status = 'completed'
        and payment_setup.stripe_checkout_session_id =
          settings.stripe_payment_setup_checkout_session_id
        and payment_setup.stripe_customer_id = settings.stripe_customer_id
        and payment_setup.stripe_setup_intent_id =
          settings.stripe_payment_setup_intent_id
        and payment_setup.stripe_payment_method_id =
          settings.stripe_payment_method_id
    ) then
    raise exception 'A verified payment setup is required before resubmitting';
  end if;
  if not public.instructor_profile_is_payment_ready(profile.id) then
    raise exception 'Complete the profile, inquiry email, and ready headshot before continuing';
  end if;

  perform set_config(
    'hire_line_dancers.allow_profile_submission',
    'on',
    true
  );
  update public.instructor_profiles
  set status = 'pending_review',
      updated_at = submitted_at
  where id = profile.id;

  return jsonb_build_object(
    'profileStatus', 'pending_review',
    'submittedAt', submitted_at,
    'entitlementId', entitlement_id
  );
end;
$$;

create or replace function public.current_instructor_offer_entitlement()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  entitlement public.instructor_offer_entitlements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select offer.* into entitlement
  from public.instructor_offer_entitlements offer
  join public.instructor_profiles profile
    on profile.id = offer.instructor_profile_id
  where profile.account_id = auth.uid()
  limit 1;

  if entitlement.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'entitlementId', entitlement.id,
    'source', entitlement.source,
    'offerCode', entitlement.offer_code,
    'foundingPosition', entitlement.founding_position,
    'earnedAt', entitlement.earned_at,
    'redeemedAt', entitlement.redeemed_at,
    'redeemedCheckoutSessionId',
      entitlement.redeemed_checkout_session_id,
    'redeemedSubscriptionId', entitlement.redeemed_subscription_id,
    'freeMonths', 2
  );
end;
$$;

create or replace function public.admin_approve_instructor_after_payment_setup(
  p_instructor_profile_id uuid,
  p_admin_account_id uuid,
  p_slug text,
  p_note text default null,
  p_expected_stripe_checkout_session_id text default null,
  p_expected_stripe_customer_id text default null,
  p_expected_stripe_setup_intent_id text default null,
  p_expected_stripe_payment_method_id text default null,
  p_expected_entitlement_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  settings public.instructor_private_settings;
  completed_setup public.instructor_payment_setups;
  entitlement public.instructor_offer_entitlements;
  clean_slug text := lower(trim(coalesce(p_slug, '')));
  final_profile public.instructor_profiles;
  has_lifetime_access boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_admin_account_id is null or not exists (
    select 1
    from public.accounts admin_account
    where admin_account.id = p_admin_account_id
      and (
        admin_account.role = 'admin'
        or exists (
          select 1
          from public.marketplace_admins delegated_admin
          where delegated_admin.account_id = admin_account.id
        )
      )
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_instructor_profile_id is null then
    raise exception 'Instructor profile is required';
  end if;
  if clean_slug = ''
    or clean_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'A valid profile slug is required for approval';
  end if;
  if p_note is not null and char_length(trim(p_note)) > 4000 then
    raise exception 'Review notes must be 4,000 characters or fewer';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.id = p_instructor_profile_id
  for update;

  if profile.id is null then
    raise exception 'Instructor profile not found';
  end if;

  has_lifetime_access := exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile.id
  );

  if not has_lifetime_access then
    if p_expected_stripe_checkout_session_id is null
      or p_expected_stripe_checkout_session_id !~
        '^cs_(live|test)_[A-Za-z0-9]+$'
      or p_expected_stripe_customer_id is null
      or p_expected_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
      or p_expected_stripe_setup_intent_id is null
      or p_expected_stripe_setup_intent_id !~ '^seti_[A-Za-z0-9]+$'
      or p_expected_stripe_payment_method_id is null
      or p_expected_stripe_payment_method_id !~ '^pm_[A-Za-z0-9]+$' then
      raise exception 'Expected verified payment setup facts are required';
    end if;

    select private_settings.* into settings
    from public.instructor_private_settings private_settings
    where private_settings.instructor_profile_id = profile.id
    for update;

    select setup_record.* into completed_setup
    from public.instructor_payment_setups setup_record
    where setup_record.instructor_profile_id = profile.id
      and setup_record.status = 'completed'
      and setup_record.stripe_checkout_session_id =
        settings.stripe_payment_setup_checkout_session_id
      and setup_record.stripe_customer_id = settings.stripe_customer_id
      and setup_record.stripe_setup_intent_id =
        settings.stripe_payment_setup_intent_id
      and setup_record.stripe_payment_method_id =
        settings.stripe_payment_method_id
    limit 1
    for update;

    if completed_setup.id is null
      or settings.payment_setup_completed_at is null then
      raise exception 'A verified payment setup is required before approval';
    end if;

    select offer.* into entitlement
    from public.instructor_offer_entitlements offer
    where offer.instructor_profile_id = profile.id
    for update;

    if completed_setup.stripe_checkout_session_id is distinct from
        p_expected_stripe_checkout_session_id
      or completed_setup.stripe_customer_id is distinct from
        p_expected_stripe_customer_id
      or completed_setup.stripe_setup_intent_id is distinct from
        p_expected_stripe_setup_intent_id
      or completed_setup.stripe_payment_method_id is distinct from
        p_expected_stripe_payment_method_id
      or entitlement.id is distinct from p_expected_entitlement_id then
      raise exception 'Verified approval facts changed before durable approval';
    end if;
  end if;

  if profile.status in ('approved', 'published') then
    if profile.slug is distinct from clean_slug then
      raise exception 'Instructor profile was already approved with another slug';
    end if;
    return jsonb_build_object(
      'profileStatus', profile.status,
      'approvedAt', profile.approved_at,
      'approvedBy', profile.approved_by,
      'hasLifetimeAccess', has_lifetime_access,
      'activationId', completed_setup.id,
      'setupSessionId', completed_setup.stripe_checkout_session_id,
      'stripeCustomerId', completed_setup.stripe_customer_id,
      'stripeSetupIntentId', completed_setup.stripe_setup_intent_id,
      'stripePaymentMethodId', completed_setup.stripe_payment_method_id,
      'livemode', completed_setup.livemode,
      'setupTermsVersion', completed_setup.setup_terms_version,
      'entitlementId', entitlement.id,
      'entitlementSource', entitlement.source,
      'offerCode', entitlement.offer_code
    );
  end if;
  if profile.status <> 'pending_review' then
    raise exception 'A pending instructor profile is required for approval';
  end if;
  if not public.instructor_profile_is_payment_ready(profile.id) then
    raise exception 'The instructor profile is no longer complete';
  end if;

  update public.instructor_profiles
  set status = 'approved',
      slug = clean_slug,
      approved_at = coalesce(approved_at, now()),
      approved_by = coalesce(approved_by, p_admin_account_id),
      published_at = null,
      updated_at = now()
  where id = profile.id;

  update public.directory_instructor_targets
  set claimed_profile_id = profile.id,
      updated_at = now()
  where slug = clean_slug;

  insert into public.profile_review_events (
    instructor_profile_id,
    reviewer_account_id,
    previous_status,
    new_status,
    note
  ) values (
    profile.id,
    p_admin_account_id,
    profile.status,
    'approved',
    nullif(trim(p_note), '')
  );

  select profile_record.* into final_profile
  from public.instructor_profiles profile_record
  where profile_record.id = profile.id;

  return jsonb_build_object(
    'profileStatus', final_profile.status,
    'approvedAt', final_profile.approved_at,
    'approvedBy', final_profile.approved_by,
    'hasLifetimeAccess', has_lifetime_access,
    'activationId', completed_setup.id,
    'setupSessionId', completed_setup.stripe_checkout_session_id,
    'stripeCustomerId', completed_setup.stripe_customer_id,
    'stripeSetupIntentId', completed_setup.stripe_setup_intent_id,
    'stripePaymentMethodId', completed_setup.stripe_payment_method_id,
    'livemode', completed_setup.livemode,
    'setupTermsVersion', completed_setup.setup_terms_version,
    'entitlementId', entitlement.id,
    'entitlementSource', entitlement.source,
    'offerCode', entitlement.offer_code
  );
end;
$$;

create or replace function public.reset_instructor_activation_after_payment_failure(
  p_instructor_profile_id uuid,
  p_admin_account_id uuid,
  p_expected_stripe_checkout_session_id text,
  p_expected_stripe_customer_id text,
  p_expected_stripe_setup_intent_id text,
  p_expected_stripe_payment_method_id text,
  p_expected_entitlement_id uuid,
  p_stripe_error_code text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  settings public.instructor_private_settings;
  payment_setup public.instructor_payment_setups;
  entitlement public.instructor_offer_entitlements;
  audit_note text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_admin_account_id is null or not exists (
    select 1
    from public.accounts admin_account
    where admin_account.id = p_admin_account_id
      and (
        admin_account.role = 'admin'
        or exists (
          select 1
          from public.marketplace_admins delegated_admin
          where delegated_admin.account_id = admin_account.id
        )
      )
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_instructor_profile_id is null
    or p_expected_stripe_checkout_session_id is null
    or p_expected_stripe_checkout_session_id !~
      '^cs_(live|test)_[A-Za-z0-9]+$'
    or p_expected_stripe_customer_id is null
    or p_expected_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_expected_stripe_setup_intent_id is null
    or p_expected_stripe_setup_intent_id !~ '^seti_[A-Za-z0-9]+$'
    or p_expected_stripe_payment_method_id is null
    or p_expected_stripe_payment_method_id !~ '^pm_[A-Za-z0-9]+$'
    or nullif(trim(p_stripe_error_code), '') is null
    or trim(p_stripe_error_code) !~ '^[A-Za-z0-9_.-]{1,120}$'
    or trim(p_stripe_error_code) not in (
      'card_declined',
      'expired_card',
      'incorrect_cvc',
      'incorrect_number',
      'invalid_cvc',
      'invalid_expiry_month',
      'invalid_expiry_year',
      'invalid_number',
      'payment_intent_authentication_failure',
      'payment_method_not_available',
      'payment_method_provider_decline',
      'processing_error'
    )
    or (p_note is not null and char_length(trim(p_note)) > 3000) then
    raise exception 'Payment activation reset facts are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select profile_record.* into profile
  from public.instructor_profiles profile_record
  where profile_record.id = p_instructor_profile_id
  for update;

  select private_settings.* into settings
  from public.instructor_private_settings private_settings
  where private_settings.instructor_profile_id = p_instructor_profile_id
  for update;

  select setup_record.* into payment_setup
  from public.instructor_payment_setups setup_record
  where setup_record.instructor_profile_id = p_instructor_profile_id
    and setup_record.stripe_checkout_session_id =
      p_expected_stripe_checkout_session_id
  for update;

  select offer.* into entitlement
  from public.instructor_offer_entitlements offer
  where offer.instructor_profile_id = p_instructor_profile_id
  for update;

  if profile.id is null or settings.instructor_profile_id is null
    or payment_setup.id is null
    or payment_setup.stripe_customer_id is distinct from
      p_expected_stripe_customer_id
    or payment_setup.stripe_setup_intent_id is distinct from
      p_expected_stripe_setup_intent_id
    or payment_setup.stripe_payment_method_id is distinct from
      p_expected_stripe_payment_method_id
    or entitlement.id is distinct from p_expected_entitlement_id then
    raise exception 'Verified activation reset facts changed';
  end if;

  if profile.status = 'draft'
    and payment_setup.status = 'superseded'
    and settings.stripe_payment_method_id is null
    and settings.stripe_payment_setup_intent_id is null
    and settings.stripe_payment_setup_checkout_session_id is null
    and settings.payment_setup_completed_at is null then
    return jsonb_build_object(
      'reset', false,
      'profileStatus', profile.status,
      'supersededSetupId', payment_setup.id,
      'retainedStripeCustomerId', settings.stripe_customer_id,
      'entitlementId', entitlement.id
    );
  end if;

  if profile.status <> 'approved'
    or payment_setup.status <> 'completed'
    or settings.stripe_customer_id is distinct from
      p_expected_stripe_customer_id
    or settings.stripe_payment_method_id is distinct from
      p_expected_stripe_payment_method_id
    or settings.stripe_payment_setup_intent_id is distinct from
      p_expected_stripe_setup_intent_id
    or settings.stripe_payment_setup_checkout_session_id is distinct from
      p_expected_stripe_checkout_session_id
    or settings.payment_setup_completed_at is null then
    raise exception 'An approved canonical payment activation is required';
  end if;
  if exists (
    select 1
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile.id
  ) then
    raise exception 'Lifetime access cannot be reset through Stripe activation';
  end if;
  if entitlement.id is not null and entitlement.redeemed_at is not null then
    raise exception 'A redeemed instructor offer cannot be reset';
  end if;
  if exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = profile.id
      and (
        membership.status in (
          'trialing', 'active', 'past_due', 'unpaid', 'paused'
        )
        or membership.latest_checkout_session_id =
          p_expected_stripe_checkout_session_id
      )
  ) then
    raise exception 'A Stripe membership already exists for this activation';
  end if;

  update public.instructor_payment_setups
  set status = 'superseded',
      updated_at = now()
  where id = payment_setup.id;

  update public.instructor_private_settings
  set stripe_payment_method_id = null,
      stripe_payment_setup_intent_id = null,
      stripe_payment_setup_checkout_session_id = null,
      payment_setup_completed_at = null,
      updated_at = now()
  where instructor_profile_id = profile.id;

  update public.directory_instructor_targets
  set claimed_profile_id = null,
      updated_at = now()
  where claimed_profile_id = profile.id;

  update public.instructor_profiles
  set status = 'draft',
      slug = null,
      approved_at = null,
      approved_by = null,
      published_at = null,
      updated_at = now()
  where id = profile.id;

  audit_note := 'Stripe activation reset (' || trim(p_stripe_error_code) || ')';
  if nullif(trim(p_note), '') is not null then
    audit_note := audit_note || ': ' || trim(p_note);
  end if;

  insert into public.profile_review_events (
    instructor_profile_id,
    reviewer_account_id,
    previous_status,
    new_status,
    note
  ) values (
    profile.id,
    p_admin_account_id,
    profile.status,
    'draft',
    audit_note
  );

  return jsonb_build_object(
    'reset', true,
    'profileStatus', 'draft',
    'supersededSetupId', payment_setup.id,
    'retainedStripeCustomerId', settings.stripe_customer_id,
    'entitlementId', entitlement.id
  );
end;
$$;

create or replace function public.redeem_instructor_offer_entitlement(
  p_instructor_profile_id uuid,
  p_entitlement_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_subscription_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement public.instructor_offer_entitlements;
  payment_setup public.instructor_payment_setups;
  membership public.instructor_memberships;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_instructor_profile_id is null
    or p_entitlement_id is null
    or p_stripe_checkout_session_id is null
    or p_stripe_checkout_session_id !~ '^cs_(live|test)_[A-Za-z0-9]+$'
    or p_stripe_subscription_id is null
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' then
    raise exception 'Offer redemption identifiers are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_instructor_profile_id::text, 0)
  );

  select offer.* into entitlement
  from public.instructor_offer_entitlements offer
  where offer.id = p_entitlement_id
    and offer.instructor_profile_id = p_instructor_profile_id
  for update;

  if entitlement.id is null then
    raise exception 'Instructor offer entitlement not found';
  end if;
  if entitlement.redeemed_at is not null then
    if entitlement.redeemed_checkout_session_id =
        p_stripe_checkout_session_id
      and entitlement.redeemed_subscription_id =
        p_stripe_subscription_id then
      return 'duplicate';
    end if;
    raise exception 'Instructor offer entitlement was already redeemed';
  end if;

  select setup_record.* into payment_setup
  from public.instructor_payment_setups setup_record
  join public.instructor_private_settings settings
    on settings.instructor_profile_id = setup_record.instructor_profile_id
   and settings.stripe_payment_setup_checkout_session_id =
     setup_record.stripe_checkout_session_id
   and settings.stripe_customer_id = setup_record.stripe_customer_id
   and settings.stripe_payment_setup_intent_id =
     setup_record.stripe_setup_intent_id
   and settings.stripe_payment_method_id =
     setup_record.stripe_payment_method_id
  where setup_record.instructor_profile_id = p_instructor_profile_id
    and setup_record.status = 'completed'
    and setup_record.stripe_checkout_session_id =
      p_stripe_checkout_session_id
  limit 1;

  if payment_setup.id is null then
    raise exception 'Completed payment setup for offer redemption not found';
  end if;

  select membership_record.* into membership
  from public.instructor_memberships membership_record
  where membership_record.instructor_profile_id = p_instructor_profile_id
    and membership_record.stripe_customer_id =
      payment_setup.stripe_customer_id
    and membership_record.stripe_subscription_id =
      p_stripe_subscription_id
    and membership_record.status in ('trialing', 'active')
  for update;

  if membership.instructor_profile_id is null then
    raise exception 'Active instructor membership for offer redemption not found';
  end if;

  update public.instructor_offer_entitlements
  set redeemed_at = now(),
      redeemed_checkout_session_id = p_stripe_checkout_session_id,
      redeemed_subscription_id = p_stripe_subscription_id,
      updated_at = now()
  where id = entitlement.id;

  -- A founding slot and a timely private invitation represent one benefit, not
  -- stackable benefits. Keep the legacy invitation lifecycle in sync even when
  -- the founding entitlement won precedence.
  update public.instructor_invitations invitation
  set offer_redeemed_at = now(),
      offer_redeemed_checkout_session_id = p_stripe_checkout_session_id,
      offer_redeemed_subscription_id = p_stripe_subscription_id,
      updated_at = now()
  where invitation.accepted_profile_id = p_instructor_profile_id
    and invitation.offer_code = 'outreach_two_months_90_day_v1'
    and invitation.offer_eligible
    and invitation.offer_earned_at is not null
    and invitation.offer_redeemed_at is null;

  insert into public.membership_admin_events (
    instructor_profile_id,
    event_type,
    detail
  ) values (
    p_instructor_profile_id,
    'offer_redeemed',
    jsonb_build_object(
      'entitlement_id', entitlement.id,
      'source', entitlement.source,
      'offer_code', entitlement.offer_code,
      'stripe_setup_checkout_session_id', p_stripe_checkout_session_id,
      'stripe_subscription_id', p_stripe_subscription_id
    )
  );

  return 'redeemed';
end;
$$;

-- Preserve the existing subscription-Checkout guarantee path and add Setup
-- Checkout as an equally verified activation source. Coverage still starts only
-- when the paid-invoice ledger records the first positive membership invoice.
create or replace function public.assign_founding_guarantee_from_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_activation public.stripe_checkout_attempts;
  setup_activation public.instructor_payment_setups;
  existing_guarantee public.instructor_guarantees;
  activation_session_id text;
  has_historical_obligation boolean := false;
begin
  if new.status not in ('trialing', 'active') then
    return new;
  end if;

  if new.latest_checkout_session_id is not null then
    select attempt.* into legacy_activation
    from public.stripe_checkout_attempts attempt
    where attempt.instructor_profile_id = new.instructor_profile_id
      and attempt.stripe_checkout_session_id =
        new.latest_checkout_session_id
      and attempt.stripe_customer_id = new.stripe_customer_id
      and attempt.stripe_price_id = new.stripe_price_id
      and attempt.status in ('open', 'completed')
      and attempt.checkout_terms_version = '2026-08-07-membership-v2'
      and attempt.guarantee_terms_version =
        '2026-08-07-90-day-paid-invoice-v1'
    limit 1;
  end if;

  if legacy_activation.id is not null then
    activation_session_id := legacy_activation.stripe_checkout_session_id;
  else
    select payment_setup.* into setup_activation
    from public.instructor_payment_setups payment_setup
    join public.instructor_private_settings settings
      on settings.instructor_profile_id = payment_setup.instructor_profile_id
     and settings.stripe_payment_setup_checkout_session_id =
       payment_setup.stripe_checkout_session_id
     and settings.stripe_customer_id = payment_setup.stripe_customer_id
     and settings.stripe_payment_setup_intent_id =
       payment_setup.stripe_setup_intent_id
     and settings.stripe_payment_method_id =
       payment_setup.stripe_payment_method_id
    where payment_setup.instructor_profile_id = new.instructor_profile_id
      and payment_setup.status = 'completed'
      and new.latest_checkout_session_id is not null
      and payment_setup.stripe_checkout_session_id =
        new.latest_checkout_session_id
      and payment_setup.stripe_customer_id = new.stripe_customer_id
      and payment_setup.setup_terms_version =
        '2026-08-08-payment-setup-v1'
    order by payment_setup.completed_at desc, payment_setup.id desc
    limit 1;

    if setup_activation.id is not null then
      activation_session_id := setup_activation.stripe_checkout_session_id;
    end if;
  end if;

  if activation_session_id is null then
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
      activation_session_id,
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
          activation_session_id
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

revoke all on public.instructor_payment_setups from anon, authenticated;
revoke all on public.instructor_offer_entitlements from anon, authenticated;
revoke delete on public.instructor_private_settings from authenticated;
grant select on public.instructor_offer_entitlements to authenticated;

revoke execute on function public.instructor_profile_is_payment_ready(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.block_lifetime_access_during_activation()
  from public, anon, authenticated, service_role;
revoke execute on function public.register_instructor_payment_setup(
  uuid, text, text, text, text, timestamptz, boolean, text
) from public, anon, authenticated;
revoke execute on function public.complete_instructor_payment_setup(
  text, uuid, uuid, text, text, text, text, boolean, text, timestamptz
) from public, anon, authenticated;
revoke execute on function public.admin_approve_instructor_after_payment_setup(
  uuid, uuid, text, text, text, text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.reset_instructor_activation_after_payment_failure(
  uuid, uuid, text, text, text, text, uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.redeem_instructor_offer_entitlement(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.submit_lifetime_instructor_profile_for_review()
  from public, anon;
revoke execute on function public.resubmit_instructor_profile_after_payment_setup()
  from public, anon;
revoke execute on function public.current_instructor_offer_entitlement()
  from public, anon;
revoke execute on function public.assign_founding_guarantee_from_membership()
  from public, anon, authenticated, service_role;

grant execute on function public.register_instructor_payment_setup(
  uuid, text, text, text, text, timestamptz, boolean, text
) to service_role;
grant execute on function public.complete_instructor_payment_setup(
  text, uuid, uuid, text, text, text, text, boolean, text, timestamptz
) to service_role;
grant execute on function public.admin_approve_instructor_after_payment_setup(
  uuid, uuid, text, text, text, text, text, text, uuid
) to service_role;
grant execute on function public.reset_instructor_activation_after_payment_failure(
  uuid, uuid, text, text, text, text, uuid, text, text
) to service_role;
grant execute on function public.redeem_instructor_offer_entitlement(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.submit_lifetime_instructor_profile_for_review()
  to authenticated;
grant execute on function public.resubmit_instructor_profile_after_payment_setup()
  to authenticated;
grant execute on function public.current_instructor_offer_entitlement()
  to authenticated;
