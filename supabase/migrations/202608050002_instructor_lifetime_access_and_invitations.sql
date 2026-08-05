-- Permanent instructor access and administrator-sent instructor invitations.
-- Apply after 202608050001_add_tessa_inquiry_target.sql.

create table if not exists public.instructor_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  request_key text not null unique,
  grants_lifetime_access boolean not null default false,
  status text not null default 'pending',
  invited_by uuid not null references public.accounts(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '30 days'),
  sent_at timestamptz,
  email_provider_message_id text,
  delivery_error text,
  accepted_at timestamptz,
  accepted_by uuid references public.accounts(id) on delete set null,
  accepted_profile_id uuid references public.instructor_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_invitations_email_check check (
    email = lower(trim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and char_length(email) <= 320
  ),
  constraint instructor_invitations_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint instructor_invitations_status_check check (
    status in ('pending', 'sending', 'sent', 'delivery_failed', 'accepted', 'revoked')
  ),
  constraint instructor_invitations_request_key_check check (request_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  constraint instructor_invitations_expiry_check check (expires_at > created_at),
  constraint instructor_invitations_acceptance_check check (
    (status = 'accepted' and accepted_at is not null)
    or (status <> 'accepted' and accepted_at is null and accepted_by is null and accepted_profile_id is null)
  )
);

create index if not exists instructor_invitations_recent_idx
  on public.instructor_invitations (created_at desc);

create unique index if not exists instructor_invitations_one_open_email
  on public.instructor_invitations (email)
  where status in ('pending', 'sending', 'sent');

create table if not exists public.instructor_lifetime_access (
  instructor_profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  source text not null,
  invitation_id uuid unique references public.instructor_invitations(id) on delete restrict,
  granted_by uuid not null references public.accounts(id) on delete restrict,
  granted_at timestamptz not null default now(),
  note text,
  constraint instructor_lifetime_access_source_check check (source in ('admin', 'invitation')),
  constraint instructor_lifetime_access_source_invitation_check check (
    (source = 'invitation' and invitation_id is not null)
    or (source = 'admin' and invitation_id is null)
  ),
  constraint instructor_lifetime_access_note_check check (note is null or char_length(note) <= 1000)
);

drop trigger if exists set_instructor_invitations_updated_at on public.instructor_invitations;
create trigger set_instructor_invitations_updated_at
  before update on public.instructor_invitations
  for each row execute function public.set_updated_at();

create or replace function public.current_instructor_lifetime_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.instructor_lifetime_access access
    join public.instructor_profiles profile
      on profile.id = access.instructor_profile_id
    where profile.account_id = auth.uid()
  );
$$;

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

  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));

  select account.id, account.role
  into existing_account_id, existing_account_role
  from public.accounts account
  where lower(trim(account.email)) = lower(trim(p_email))
  limit 1;

  if existing_account_role is not null and existing_account_role <> 'instructor' then
    raise exception 'That email already belongs to a non-instructor account';
  end if;

  if existing_account_id is not null and p_grants_lifetime_access then
    select profile.id into existing_profile_id
    from public.instructor_profiles profile
    where profile.account_id = existing_account_id;

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

  update public.instructor_invitations
  set status = 'revoked',
      updated_at = now()
  where email = lower(trim(p_email))
    and status in ('pending', 'sending', 'sent');

  insert into public.instructor_invitations (
    email,
    token_hash,
    request_key,
    grants_lifetime_access,
    invited_by,
    expires_at
  ) values (
    lower(trim(p_email)),
    lower(trim(p_token_hash)),
    p_request_key,
    p_grants_lifetime_access,
    p_invited_by,
    p_expires_at
  )
  returning * into result;

  return result;
end;
$$;

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
  if invitation.status not in ('pending', 'sending', 'sent') then
    raise exception 'This instructor invitation is no longer active';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'This instructor invitation has expired';
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

  select id into profile_id
  from public.instructor_profiles
  where account_id = auth.uid();

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

    select coalesce(membership.status, settings.subscription_status, 'inactive')
    into membership_status
    from public.instructor_private_settings settings
    left join public.instructor_memberships membership
      on membership.instructor_profile_id = settings.instructor_profile_id
    where settings.instructor_profile_id = profile_id;

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
      accepted_at = now(),
      accepted_by = auth.uid(),
      accepted_profile_id = profile_id,
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

create or replace function public.admin_grant_instructor_lifetime_access(
  p_instructor_profile_id uuid,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  membership_status text;
  inserted_count integer;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_note is not null and char_length(trim(p_note)) > 1000 then
    raise exception 'The lifetime access note must be 1,000 characters or fewer';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_instructor_profile_id::text, 0));

  select * into profile
  from public.instructor_profiles
  where id = p_instructor_profile_id
  for update;

  if profile.id is null then
    raise exception 'Instructor profile not found';
  end if;

  if exists (
    select 1 from public.instructor_lifetime_access access
    where access.instructor_profile_id = profile.id
  ) then
    if profile.status = 'approved' then
      update public.instructor_profiles
      set status = 'published',
          published_at = coalesce(published_at, now()),
          updated_at = now()
      where id = profile.id;
    end if;
    return false;
  end if;

  select coalesce(membership.status, settings.subscription_status, 'inactive')
  into membership_status
  from public.instructor_private_settings settings
  left join public.instructor_memberships membership
    on membership.instructor_profile_id = settings.instructor_profile_id
  where settings.instructor_profile_id = profile.id;

  if membership_status in ('trialing', 'active', 'past_due', 'unpaid', 'paused') then
    raise exception 'Cancel the existing Stripe membership before granting lifetime access';
  end if;

  if exists (
    select 1
    from public.stripe_checkout_attempts attempt
    where attempt.instructor_profile_id = profile.id
      and attempt.status = 'open'
      and attempt.expires_at > now()
  ) then
    raise exception 'An open Stripe checkout must expire before granting lifetime access';
  end if;

  insert into public.instructor_lifetime_access (
    instructor_profile_id,
    source,
    granted_by,
    note
  ) values (
    profile.id,
    'admin',
    auth.uid(),
    nullif(trim(p_note), '')
  )
  on conflict (instructor_profile_id) do nothing;

  get diagnostics inserted_count = row_count;

  if profile.status = 'approved' then
    update public.instructor_profiles
    set status = 'published',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = profile.id;
  end if;

  return inserted_count = 1;
end;
$$;

create or replace function public.register_instructor_checkout_attempt(
  p_instructor_profile_id uuid,
  p_request_key text,
  p_stripe_checkout_session_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_checkout_url text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_instructor_profile_id::text, 0));

  if exists (
    select 1 from public.instructor_lifetime_access access
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

  insert into public.stripe_checkout_attempts (
    instructor_profile_id,
    request_key,
    stripe_checkout_session_id,
    stripe_customer_id,
    stripe_price_id,
    checkout_url,
    status,
    expires_at
  ) values (
    p_instructor_profile_id,
    p_request_key,
    p_stripe_checkout_session_id,
    p_stripe_customer_id,
    p_stripe_price_id,
    p_checkout_url,
    'open',
    p_expires_at
  );

  return true;
end;
$$;

create or replace function public.admin_list_instructor_lifetime_access()
returns table (
  instructor_profile_id uuid,
  account_id uuid,
  display_name text,
  account_email text,
  profile_status text,
  has_lifetime_access boolean,
  access_source text,
  granted_at timestamptz,
  granted_by_email text
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
    account.email,
    profile.status,
    access.instructor_profile_id is not null,
    access.source,
    access.granted_at,
    granting_account.email
  from public.instructor_profiles profile
  join public.accounts account on account.id = profile.account_id
  left join public.instructor_lifetime_access access
    on access.instructor_profile_id = profile.id
  left join public.accounts granting_account
    on granting_account.id = access.granted_by
  order by access.granted_at desc nulls last, lower(profile.display_name), profile.created_at;
end;
$$;

create or replace function public.admin_list_instructor_invitations()
returns table (
  invitation_id uuid,
  email text,
  grants_lifetime_access boolean,
  invitation_status text,
  expires_at timestamptz,
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
      when invitation.status in ('pending', 'sent') and invitation.expires_at <= now() then 'expired'
      else invitation.status
    end,
    invitation.expires_at,
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

-- Approval and Stripe status updates both pass through this trigger. Lifetime
-- access keeps an approved profile published even when no Stripe membership exists.
create or replace function public.publish_approved_profile_with_active_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and (
    exists (
      select 1
      from public.instructor_memberships membership
      where membership.instructor_profile_id = new.id
        and membership.status in ('active', 'trialing')
    )
    or exists (
      select 1
      from public.instructor_lifetime_access access
      where access.instructor_profile_id = new.id
    )
  ) then
    update public.instructor_profiles
    set status = 'published',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = new.id
      and status = 'approved';
  end if;
  return new;
end;
$$;

-- Keep Stripe event processing for standard memberships intact, but short-circuit
-- every billing mutation once a profile has permanent access. The event ID is
-- still recorded so Stripe retries remain idempotent.
alter function public.apply_stripe_subscription_event(
  text, text, timestamptz, text, boolean, uuid, text, text, text, text,
  timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz
) rename to apply_stripe_subscription_event_without_lifetime_access;

create or replace function public.apply_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_api_version text,
  p_livemode boolean,
  p_instructor_profile_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_checkout_session_id text,
  p_latest_invoice_id text,
  p_subscription_created_at timestamptz,
  p_observed_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
  candidate_profile_id uuid;
  lifetime_profile_id uuid;
begin
  if nullif(trim(p_event_id), '') is null
    or nullif(trim(p_event_type), '') is null
    or nullif(trim(p_customer_id), '') is null
    or nullif(trim(p_subscription_id), '') is null
    or nullif(trim(p_price_id), '') is null
    or p_observed_at is null then
    raise exception 'Stripe event is missing required identifiers';
  end if;
  if p_status not in ('inactive', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'refunded') then
    raise exception 'Unsupported membership status';
  end if;

  if p_instructor_profile_id is not null then
    select profile.id into candidate_profile_id
    from public.instructor_profiles profile
    where profile.id = p_instructor_profile_id
      and profile.approved_at is not null
      and profile.status in ('approved', 'published', 'suspended');
  end if;
  if candidate_profile_id is null then
    select membership.instructor_profile_id into candidate_profile_id
    from public.instructor_memberships membership
    where membership.stripe_subscription_id = p_subscription_id
       or membership.stripe_customer_id = p_customer_id
    limit 1;
  end if;
  if candidate_profile_id is null then
    select settings.instructor_profile_id into candidate_profile_id
    from public.instructor_private_settings settings
    join public.instructor_profiles profile
      on profile.id = settings.instructor_profile_id
    where (
        settings.stripe_subscription_id = p_subscription_id
        or settings.stripe_customer_id = p_customer_id
      )
      and profile.approved_at is not null
    limit 1;
  end if;

  if candidate_profile_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(candidate_profile_id::text, 0));
    select access.instructor_profile_id into lifetime_profile_id
    from public.instructor_lifetime_access access
    where access.instructor_profile_id = candidate_profile_id;
  end if;

  if lifetime_profile_id is not null then
    insert into public.stripe_webhook_events (
      stripe_event_id,
      event_type,
      stripe_object_id,
      api_version,
      livemode,
      stripe_created_at
    ) values (
      p_event_id,
      p_event_type,
      p_subscription_id,
      p_api_version,
      p_livemode,
      p_event_created_at
    )
    on conflict (stripe_event_id) do nothing;

    get diagnostics inserted_count = row_count;
    if inserted_count = 0 then
      return 'duplicate';
    end if;

    if p_checkout_session_id is not null then
      update public.stripe_checkout_attempts
      set status = 'expired',
          updated_at = now()
      where instructor_profile_id = lifetime_profile_id
        and stripe_checkout_session_id = p_checkout_session_id;
    end if;

    return 'lifetime_access_ignored';
  end if;

  return public.apply_stripe_subscription_event_without_lifetime_access(
    p_event_id,
    p_event_type,
    p_event_created_at,
    p_api_version,
    p_livemode,
    candidate_profile_id,
    p_customer_id,
    p_subscription_id,
    p_price_id,
    p_status,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end,
    p_checkout_session_id,
    p_latest_invoice_id,
    p_subscription_created_at,
    p_observed_at
  );
end;
$$;

alter table public.instructor_invitations enable row level security;
alter table public.instructor_lifetime_access enable row level security;

drop policy if exists "admins read instructor invitations" on public.instructor_invitations;
create policy "admins read instructor invitations" on public.instructor_invitations
  for select to authenticated using (public.is_marketplace_admin());

drop policy if exists "admins read lifetime access" on public.instructor_lifetime_access;
create policy "admins read lifetime access" on public.instructor_lifetime_access
  for select to authenticated using (public.is_marketplace_admin());

revoke all on public.instructor_invitations from anon, authenticated;
revoke all on public.instructor_lifetime_access from anon, authenticated;

revoke execute on function public.current_instructor_lifetime_access() from public, anon;
revoke execute on function public.create_instructor_invitation(text, text, text, boolean, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.accept_instructor_invitation(text, text, text) from public, anon;
revoke execute on function public.admin_grant_instructor_lifetime_access(uuid, text) from public, anon;
revoke execute on function public.admin_list_instructor_lifetime_access() from public, anon;
revoke execute on function public.admin_list_instructor_invitations() from public, anon;
revoke execute on function public.register_instructor_checkout_attempt(uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_stripe_subscription_event_without_lifetime_access(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.apply_stripe_subscription_event(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.current_instructor_lifetime_access() to authenticated;
grant execute on function public.create_instructor_invitation(text, text, text, boolean, uuid, timestamptz) to service_role;
grant execute on function public.accept_instructor_invitation(text, text, text) to authenticated;
grant execute on function public.admin_grant_instructor_lifetime_access(uuid, text) to authenticated;
grant execute on function public.admin_list_instructor_lifetime_access() to authenticated;
grant execute on function public.admin_list_instructor_invitations() to authenticated;
grant execute on function public.register_instructor_checkout_attempt(uuid, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.apply_stripe_subscription_event(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz) to service_role;
