-- Add a deliberate claim step and a durable earned-offer record to private
-- instructor invitations. Opening an invitation is read-only. A user must
-- explicitly claim it before authentication and profile onboarding.

alter table public.instructor_invitations
  alter column expires_at set default (now() + interval '14 days'),
  add column if not exists offer_code text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid references public.accounts(id) on delete set null,
  add column if not exists profile_submission_deadline_at timestamptz,
  add column if not exists account_created_at timestamptz,
  add column if not exists profile_submitted_at timestamptz,
  add column if not exists offer_eligible boolean not null default false,
  add column if not exists offer_earned_at timestamptz;

alter table public.instructor_invitations
  drop constraint if exists instructor_invitations_status_check;

alter table public.instructor_invitations
  add constraint instructor_invitations_status_check check (
    status in ('pending', 'sending', 'sent', 'delivery_failed', 'claimed', 'accepted', 'revoked')
  ),
  add constraint instructor_invitations_offer_code_check check (
    offer_code is null or offer_code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
  ),
  add constraint instructor_invitations_claim_dates_check check (
    (claimed_at is null and profile_submission_deadline_at is null)
    or (
      claimed_at is not null
      and profile_submission_deadline_at is not null
      and profile_submission_deadline_at > claimed_at
    )
  ),
  add constraint instructor_invitations_account_created_check check (
    account_created_at is null
    or (
      claimed_at is not null
      and profile_submission_deadline_at is not null
      and account_created_at >= claimed_at
    )
  ),
  add constraint instructor_invitations_offer_earned_check check (
    (
      not offer_eligible
      and offer_earned_at is null
    )
    or (
      offer_eligible
      and offer_code is not null
      and offer_earned_at is not null
      and profile_submitted_at is not null
      and accepted_profile_id is not null
    )
  );

-- Existing open invitations keep the expiry and benefits they were issued
-- with. Only invitations created through the function below receive the new
-- 14-day claim window and acquisition offer.

-- The previous index excluded delivery failures, so historical data may hold
-- more than one bearer link for an email. Keep the active non-failed link when
-- one exists, otherwise keep only the newest failed delivery.
with ranked_open_invitations as (
  select
    invitation.id,
    row_number() over (
      partition by invitation.email
      order by
        case when invitation.status = 'delivery_failed' then 1 else 0 end,
        invitation.created_at desc,
        invitation.id desc
    ) as open_rank
  from public.instructor_invitations invitation
  where invitation.status in ('pending', 'sending', 'sent', 'delivery_failed', 'claimed')
)
update public.instructor_invitations invitation
set status = 'revoked',
    updated_at = now()
from ranked_open_invitations ranked
where invitation.id = ranked.id
  and ranked.open_rank > 1;

drop index if exists public.instructor_invitations_one_open_email;
create unique index instructor_invitations_one_open_email
  on public.instructor_invitations (email)
  where status in ('pending', 'sending', 'sent', 'delivery_failed', 'claimed');

create unique index if not exists instructor_invitations_one_earned_offer_per_profile
  on public.instructor_invitations (accepted_profile_id)
  where offer_eligible;

-- Standard invitations receive the outreach offer unless the existing
-- instructor has lifetime access, has ever had a Stripe membership, or has
-- already accepted an outreach offer. Claimed invitations cannot be silently
-- replaced by a later send.
create or replace function public.create_instructor_invitation(
  p_email text,
  p_token_hash text,
  p_request_key text,
  p_grants_lifetime_access boolean,
  p_invited_by uuid,
  p_expires_at timestamptz
)
returns public.instructor_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.instructor_invitations;
  result public.instructor_invitations;
  existing_account_id uuid;
  existing_account_role text;
  existing_profile_id uuid;
  membership_status text;
  has_prior_benefit boolean := false;
  expected_offer_code text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if not exists (
    select 1
    from public.accounts account
    where account.id = p_invited_by
      and (
        account.role = 'admin'
        or exists (
          select 1 from public.marketplace_admins admin_access
          where admin_access.account_id = account.id
        )
      )
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '14 days 5 minutes' then
    raise exception 'Instructor invitations must use a 14-day claim window';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));

  -- Idempotent retries return the original benefit snapshot. Recipient state
  -- may have changed since the first request, so dynamic eligibility checks
  -- belong only to a genuinely new invitation.
  select * into existing
  from public.instructor_invitations
  where request_key = p_request_key;

  if existing.id is not null then
    if existing.email is distinct from lower(trim(p_email))
      or existing.token_hash is distinct from lower(trim(p_token_hash))
      or existing.grants_lifetime_access is distinct from p_grants_lifetime_access
      or existing.invited_by is distinct from p_invited_by then
      raise exception 'Invitation request key was already used for different details';
    end if;
    return existing;
  end if;

  select account.id, account.role
  into existing_account_id, existing_account_role
  from public.accounts account
  where lower(trim(account.email)) = lower(trim(p_email))
  limit 1;

  if existing_account_role is not null and existing_account_role <> 'instructor' then
    raise exception 'That email already belongs to a non-instructor account';
  end if;

  if existing_account_id is not null then
    select profile.id into existing_profile_id
    from public.instructor_profiles profile
    where profile.account_id = existing_account_id;
  end if;

  if existing_profile_id is not null then
    select (
      exists (
        select 1
        from public.instructor_lifetime_access access
        where access.instructor_profile_id = existing_profile_id
      )
      or exists (
        select 1
        from public.instructor_memberships membership
        where membership.instructor_profile_id = existing_profile_id
          and membership.stripe_subscription_id is not null
      )
      or exists (
        select 1
        from public.instructor_private_settings settings
        where settings.instructor_profile_id = existing_profile_id
          and settings.stripe_subscription_id is not null
      )
      or exists (
        select 1
        from public.instructor_invitations prior_invitation
        where prior_invitation.accepted_profile_id = existing_profile_id
          and prior_invitation.offer_code = 'outreach_two_months_90_day_v1'
      )
    ) into has_prior_benefit;
  end if;

  expected_offer_code := case
    when p_grants_lifetime_access or existing_account_id is not null or has_prior_benefit then null
    else 'outreach_two_months_90_day_v1'
  end;

  if existing_account_id is not null and p_grants_lifetime_access then
    if existing_profile_id is not null and not exists (
      select 1 from public.instructor_lifetime_access access
      where access.instructor_profile_id = existing_profile_id
    ) then
      select coalesce(membership.status, settings.subscription_status, 'inactive')
      into membership_status
      from public.instructor_private_settings settings
      left join public.instructor_memberships membership
        on membership.instructor_profile_id = settings.instructor_profile_id
      where settings.instructor_profile_id = existing_profile_id;

      if membership_status in ('trialing', 'active', 'past_due', 'unpaid', 'paused') then
        raise exception 'Cancel the existing Stripe membership before sending lifetime access';
      end if;
      if exists (
        select 1 from public.stripe_checkout_attempts attempt
        where attempt.instructor_profile_id = existing_profile_id
          and attempt.status = 'open'
          and attempt.expires_at > now()
      ) then
        raise exception 'Wait for the open Stripe checkout to expire before sending lifetime access';
      end if;
    end if;
  end if;

  if exists (
    select 1
    from public.instructor_invitations invitation
    where invitation.email = lower(trim(p_email))
      and invitation.status = 'claimed'
  ) then
    raise exception 'That instructor has already claimed an active invitation';
  end if;

  update public.instructor_invitations
  set status = 'revoked',
      updated_at = now()
  where email = lower(trim(p_email))
    and status in ('pending', 'sending', 'sent', 'delivery_failed');

  insert into public.instructor_invitations (
    email,
    token_hash,
    request_key,
    grants_lifetime_access,
    offer_code,
    invited_by,
    expires_at
  ) values (
    lower(trim(p_email)),
    lower(trim(p_token_hash)),
    p_request_key,
    p_grants_lifetime_access,
    expected_offer_code,
    p_invited_by,
    p_expires_at
  )
  returning * into result;

  return result;
end;
$$;

-- This inspection is safe for an untrusted client holding the private token.
-- It intentionally omits the recipient email, token hash, account IDs, notes,
-- and provider identifiers.
create or replace function public.get_instructor_invitation_lifecycle(
  p_token_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invitation public.instructor_invitations;
begin
  if p_token_hash is null or lower(trim(p_token_hash)) !~ '^[a-f0-9]{64}$' then
    raise exception 'The instructor invitation link is invalid';
  end if;

  select * into invitation
  from public.instructor_invitations
  where token_hash = lower(trim(p_token_hash));

  if invitation.id is null or invitation.status = 'revoked' then
    raise exception 'The instructor invitation link is invalid';
  end if;

  return jsonb_build_object(
    'status', case
      when invitation.status in ('pending', 'sending', 'sent', 'delivery_failed')
        and invitation.expires_at <= now() then 'expired'
      when invitation.status in ('claimed', 'accepted')
        and invitation.profile_submission_deadline_at <= now()
        and (
          invitation.profile_submitted_at is null
          or invitation.profile_submitted_at > invitation.profile_submission_deadline_at
        ) then 'claim_expired'
      else invitation.status
    end,
    'initialClaimDeadlineAt', invitation.expires_at,
    'claimedAt', invitation.claimed_at,
    'profileSubmissionDeadlineAt', invitation.profile_submission_deadline_at,
    'accountCreatedAt', invitation.account_created_at,
    'profileSubmittedAt', invitation.profile_submitted_at,
    'offerCode', invitation.offer_code,
    'offerEligible', invitation.offer_eligible,
    'offerEarnedAt', invitation.offer_earned_at,
    'grantsLifetimeAccess', invitation.grants_lifetime_access
  );
end;
$$;

-- Claim is an explicit POST initiated by the user. The private token is the
-- capability at this stage. Email ownership is enforced later, when the
-- authenticated account accepts the claimed invitation.
create or replace function public.claim_instructor_invitation(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.instructor_invitations;
begin
  if p_token_hash is null or lower(trim(p_token_hash)) !~ '^[a-f0-9]{64}$' then
    raise exception 'The instructor invitation link is invalid';
  end if;

  select * into invitation
  from public.instructor_invitations
  where token_hash = lower(trim(p_token_hash))
  for update;

  if invitation.id is null or invitation.status = 'revoked' then
    raise exception 'The instructor invitation link is invalid';
  end if;

  if invitation.status = 'accepted' then
    return jsonb_build_object(
      'status', case
        when invitation.profile_submission_deadline_at <= now()
          and (
            invitation.profile_submitted_at is null
            or invitation.profile_submitted_at > invitation.profile_submission_deadline_at
          ) then 'claim_expired'
        else invitation.status
      end,
      'initialClaimDeadlineAt', invitation.expires_at,
      'claimedAt', invitation.claimed_at,
      'profileSubmissionDeadlineAt', invitation.profile_submission_deadline_at,
      'accountCreatedAt', invitation.account_created_at,
      'profileSubmittedAt', invitation.profile_submitted_at,
      'offerCode', invitation.offer_code,
      'offerEligible', invitation.offer_eligible,
      'offerEarnedAt', invitation.offer_earned_at,
      'grantsLifetimeAccess', invitation.grants_lifetime_access
    );
  end if;

  if invitation.status = 'claimed' then
    return jsonb_build_object(
      'status', case
        when invitation.profile_submission_deadline_at <= now()
          and (
            invitation.profile_submitted_at is null
            or invitation.profile_submitted_at > invitation.profile_submission_deadline_at
          ) then 'claim_expired'
        else invitation.status
      end,
      'initialClaimDeadlineAt', invitation.expires_at,
      'claimedAt', invitation.claimed_at,
      'profileSubmissionDeadlineAt', invitation.profile_submission_deadline_at,
      'accountCreatedAt', invitation.account_created_at,
      'profileSubmittedAt', invitation.profile_submitted_at,
      'offerCode', invitation.offer_code,
      'offerEligible', invitation.offer_eligible,
      'offerEarnedAt', invitation.offer_earned_at,
      'grantsLifetimeAccess', invitation.grants_lifetime_access
    );
  end if;

  if invitation.status not in ('pending', 'sending', 'sent', 'delivery_failed') then
    raise exception 'This instructor invitation is no longer active';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'This instructor invitation has expired';
  end if;

  update public.instructor_invitations
  set status = 'claimed',
      claimed_at = now(),
      profile_submission_deadline_at = now() + interval '7 days',
      delivery_error = null,
      updated_at = now()
  where id = invitation.id
  returning * into invitation;

  return jsonb_build_object(
    'status', case
      when invitation.profile_submission_deadline_at <= now()
        and (
          invitation.profile_submitted_at is null
          or invitation.profile_submitted_at > invitation.profile_submission_deadline_at
        ) then 'claim_expired'
      else invitation.status
    end,
    'initialClaimDeadlineAt', invitation.expires_at,
    'claimedAt', invitation.claimed_at,
    'profileSubmissionDeadlineAt', invitation.profile_submission_deadline_at,
    'accountCreatedAt', invitation.account_created_at,
    'profileSubmittedAt', invitation.profile_submitted_at,
    'offerCode', invitation.offer_code,
    'offerEligible', invitation.offer_eligible,
    'offerEarnedAt', invitation.offer_earned_at,
    'grantsLifetimeAccess', invitation.grants_lifetime_access
  );
end;
$$;

-- Offer eligibility is based on the same complete profile an instructor sends
-- for review. Keeping this check in SQL prevents a direct RLS update from
-- earning the offer with an incomplete profile.
create or replace function public.instructor_invitation_profile_is_complete(
  p_profile_id uuid
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
    where profile.id = p_profile_id
      and nullif(trim(profile.display_name), '') is not null
      and nullif(trim(profile.bio), '') is not null
      and nullif(trim(profile.city), '') is not null
      and nullif(trim(profile.region), '') is not null
      and coalesce(cardinality(profile.event_types), 0) > 0
      and settings.inquiry_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and exists (
        select 1
        from public.profile_media media
        where media.instructor_profile_id = profile.id
          and media.media_type = 'headshot'
          and media.status = 'ready'
      )
  );
$$;

-- An accepted offer invitation must not enter review unless the submission can
-- actually earn the offer. This is a BEFORE trigger so a direct RLS update
-- fails clearly instead of locking an incomplete profile in pending review.
create or replace function public.enforce_invitation_offer_submission_completeness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'pending_review' or old.status = 'pending_review' then
    return new;
  end if;

  if not exists (
    select 1
    from public.instructor_invitations invitation
    where invitation.accepted_profile_id = new.id
      and invitation.status = 'accepted'
      and invitation.offer_code = 'outreach_two_months_90_day_v1'
  ) then
    return new;
  end if;

  if nullif(trim(new.display_name), '') is null
    or nullif(trim(new.bio), '') is null
    or nullif(trim(new.city), '') is null
    or nullif(trim(new.region), '') is null
    or coalesce(cardinality(new.event_types), 0) = 0 then
    raise exception 'Complete your public name, bio, location, and at least one event type before submitting for review';
  end if;

  if not exists (
    select 1
    from public.instructor_private_settings settings
    where settings.instructor_profile_id = new.id
      and settings.inquiry_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'A valid inquiry email is required before submitting for review';
  end if;

  if not exists (
    select 1
    from public.profile_media media
    where media.instructor_profile_id = new.id
      and media.media_type = 'headshot'
      and media.status = 'ready'
  ) then
    raise exception 'Upload a ready main headshot before submitting for review';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_invitation_offer_submission_completeness
  on public.instructor_profiles;
create trigger enforce_invitation_offer_submission_completeness
  before update of status on public.instructor_profiles
  for each row execute function public.enforce_invitation_offer_submission_completeness();

-- Acceptance binds the claimed capability to the exact authenticated email.
-- Account creation must occur before the original seven-day deadline.
create or replace function public.accept_instructor_invitation(
  p_token_hash text,
  p_full_name text default null,
  p_company_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.instructor_invitations;
  account_record public.accounts;
  profile_record public.instructor_profiles;
  profile_id uuid;
  jwt_email text;
  authenticated_email text;
  clean_name text;
  membership_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_token_hash is null or lower(trim(p_token_hash)) !~ '^[a-f0-9]{64}$' then
    raise exception 'The instructor invitation link is invalid';
  end if;

  jwt_email := trim(coalesce(auth.jwt() ->> 'email', ''));
  authenticated_email := lower(jwt_email);
  if authenticated_email = '' then
    raise exception 'A verified account email is required';
  end if;
  if not exists (
    select 1
    from auth.users auth_user
    where auth_user.id = auth.uid()
      and lower(trim(auth_user.email)) = authenticated_email
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception 'Confirm the invited email address before accepting this instructor invitation';
  end if;

  select * into invitation
  from public.instructor_invitations
  where token_hash = lower(trim(p_token_hash))
  for update;

  if invitation.id is null then
    raise exception 'The instructor invitation link is invalid';
  end if;
  if invitation.status = 'accepted' then
    if invitation.accepted_by is distinct from auth.uid() then
      raise exception 'This instructor invitation has already been used';
    end if;
    return exists (
      select 1 from public.instructor_lifetime_access access
      where access.instructor_profile_id = invitation.accepted_profile_id
    );
  end if;
  if invitation.status <> 'claimed' or invitation.claimed_at is null then
    raise exception 'Claim this instructor invitation before creating the account';
  end if;
  if invitation.profile_submission_deadline_at is null
    or invitation.profile_submission_deadline_at <= now() then
    raise exception 'The account creation and profile submission window has expired';
  end if;
  if invitation.email <> authenticated_email then
    raise exception 'Sign in with the email address that received this instructor invitation';
  end if;

  insert into public.accounts (id, email, full_name)
  values (auth.uid(), jwt_email, nullif(trim(p_full_name), ''))
  on conflict (id) do update set
    full_name = coalesce(public.accounts.full_name, excluded.full_name),
    updated_at = now();

  select * into account_record
  from public.accounts
  where id = auth.uid()
  for update;

  if account_record.role is not null and account_record.role <> 'instructor' then
    raise exception 'This invitation requires an instructor account. Contact support to change your account type';
  end if;

  clean_name := coalesce(nullif(trim(p_full_name), ''), nullif(trim(account_record.full_name), ''));
  if clean_name is null then
    raise exception 'Full name is required';
  end if;

  perform set_config('hire_line_dancers.allow_role_change', 'on', true);

  update public.accounts
  set full_name = clean_name,
      role = 'instructor',
      company_name = coalesce(nullif(trim(p_company_name), ''), company_name),
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      updated_at = now()
  where id = auth.uid();

  insert into public.instructor_profiles (account_id, display_name, business_name)
  values (auth.uid(), clean_name, nullif(trim(p_company_name), ''))
  on conflict (account_id) do nothing;

  select * into profile_record
  from public.instructor_profiles
  where account_id = auth.uid();
  profile_id := profile_record.id;

  insert into public.instructor_private_settings (
    instructor_profile_id,
    inquiry_email,
    sms_notifications_enabled
  ) values (
    profile_id,
    jwt_email,
    false
  )
  on conflict (instructor_profile_id) do nothing;

  select coalesce(membership.status, settings.subscription_status, 'inactive')
  into membership_status
  from public.instructor_private_settings settings
  left join public.instructor_memberships membership
    on membership.instructor_profile_id = settings.instructor_profile_id
  where settings.instructor_profile_id = profile_id;

  if invitation.grants_lifetime_access and not exists (
    select 1 from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile_id
  ) then
    perform pg_advisory_xact_lock(hashtextextended(profile_id::text, 0));

    if exists (
      select 1
      from public.stripe_checkout_attempts attempt
      where attempt.instructor_profile_id = profile_id
        and attempt.status = 'open'
        and attempt.expires_at > now()
    ) then
      raise exception 'An open Stripe checkout must expire before accepting lifetime access';
    end if;

    if membership_status in ('trialing', 'active', 'past_due', 'unpaid', 'paused') then
      raise exception 'Cancel the existing Stripe membership before accepting lifetime access';
    end if;

    insert into public.instructor_lifetime_access (
      instructor_profile_id,
      source,
      invitation_id,
      granted_by,
      note
    ) values (
      profile_id,
      'invitation',
      invitation.id,
      invitation.invited_by,
      'Granted with instructor invitation'
    );
  end if;

  update public.instructor_invitations
  set status = 'accepted',
      claimed_by = auth.uid(),
      accepted_at = now(),
      accepted_by = auth.uid(),
      accepted_profile_id = profile_id,
      account_created_at = coalesce(account_created_at, now()),
      delivery_error = null,
      updated_at = now()
  where id = invitation.id;

  if exists (
    select 1 from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile_id
  ) then
    update public.instructor_profiles
    set status = 'published',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = profile_id
      and status = 'approved';
  end if;

  return exists (
    select 1 from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile_id
  );
end;
$$;

-- First submission within the original seven-day window permanently earns the
-- offer. Later review, approval, or return-to-draft timing cannot revoke it.
create or replace function public.lock_instructor_invitation_offer_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_prior_benefit boolean;
begin
  if new.status <> 'pending_review' or old.status = 'pending_review' then
    return new;
  end if;

  if not public.instructor_invitation_profile_is_complete(new.id) then
    return new;
  end if;

  select (
    exists (
      select 1
      from public.instructor_lifetime_access access
      where access.instructor_profile_id = new.id
    )
    or exists (
      select 1
      from public.instructor_memberships membership
      where membership.instructor_profile_id = new.id
        and membership.stripe_subscription_id is not null
    )
    or exists (
      select 1
      from public.instructor_private_settings settings
      where settings.instructor_profile_id = new.id
        and settings.stripe_subscription_id is not null
    )
  ) into has_prior_benefit;

  update public.instructor_invitations invitation
  set profile_submitted_at = coalesce(invitation.profile_submitted_at, now()),
      offer_eligible = case
        when invitation.offer_eligible then true
        when not has_prior_benefit
          and invitation.account_created_at is not null
          and now() <= invitation.profile_submission_deadline_at then true
        else false
      end,
      offer_earned_at = case
        when invitation.offer_earned_at is not null then invitation.offer_earned_at
        when not has_prior_benefit
          and invitation.account_created_at is not null
          and now() <= invitation.profile_submission_deadline_at then now()
        else null
      end,
      updated_at = now()
  where invitation.accepted_profile_id = new.id
    and invitation.status = 'accepted'
    and invitation.offer_code is not null
    and invitation.claimed_at <= now()
    and invitation.profile_submitted_at is null;

  return new;
end;
$$;

drop trigger if exists lock_instructor_invitation_offer_on_submission
  on public.instructor_profiles;
create trigger lock_instructor_invitation_offer_on_submission
  after update of status on public.instructor_profiles
  for each row execute function public.lock_instructor_invitation_offer_on_submission();

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
  order by invitation_record.accepted_at desc nulls last, invitation_record.created_at desc
  limit 1;

  if invitation.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'status', case
      when invitation.profile_submission_deadline_at <= now()
        and (
          invitation.profile_submitted_at is null
          or invitation.profile_submitted_at > invitation.profile_submission_deadline_at
        ) then 'claim_expired'
      else invitation.status
    end,
    'claimedAt', invitation.claimed_at,
    'profileSubmissionDeadlineAt', invitation.profile_submission_deadline_at,
    'accountCreatedAt', invitation.account_created_at,
    'profileSubmittedAt', invitation.profile_submitted_at,
    'offerCode', invitation.offer_code,
    'offerEligible', invitation.offer_eligible,
    'offerEarnedAt', invitation.offer_earned_at
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
      when invitation.status in ('pending', 'sending', 'sent', 'delivery_failed')
        and invitation.expires_at <= now() then 'expired'
      when invitation.status in ('claimed', 'accepted')
        and invitation.profile_submission_deadline_at <= now()
        and (
          invitation.profile_submitted_at is null
          or invitation.profile_submitted_at > invitation.profile_submission_deadline_at
        ) then 'claim_expired'
      else invitation.status
    end,
    invitation.offer_code,
    case
      when invitation.offer_code is null then null
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

revoke execute on function public.create_instructor_invitation(text, text, text, boolean, uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.get_instructor_invitation_lifecycle(text)
  from public;
revoke execute on function public.claim_instructor_invitation(text)
  from public;
revoke execute on function public.accept_instructor_invitation(text, text, text)
  from public, anon;
revoke execute on function public.current_instructor_invitation_offer()
  from public, anon;
revoke execute on function public.lock_instructor_invitation_offer_on_submission()
  from public, anon, authenticated, service_role;
revoke execute on function public.instructor_invitation_profile_is_complete(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_invitation_offer_submission_completeness()
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_list_instructor_invitations()
  from public, anon;

grant execute on function public.create_instructor_invitation(text, text, text, boolean, uuid, timestamptz)
  to service_role;
grant execute on function public.get_instructor_invitation_lifecycle(text)
  to anon, authenticated;
grant execute on function public.claim_instructor_invitation(text)
  to anon, authenticated;
grant execute on function public.accept_instructor_invitation(text, text, text)
  to authenticated;
grant execute on function public.current_instructor_invitation_offer()
  to authenticated;
grant execute on function public.admin_list_instructor_invitations()
  to authenticated;
