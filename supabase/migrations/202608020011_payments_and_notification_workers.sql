-- Stripe membership state and durable inquiry notification workers.
-- Apply after 202608020010_marketplace_accounts_and_inquiries.sql.

alter table public.instructor_profiles
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.accounts(id) on delete set null;

update public.instructor_profiles
set approved_at = coalesce(approved_at, published_at, updated_at, created_at)
where status in ('approved', 'published')
  and approved_at is null;

alter table public.instructor_profiles
  drop constraint if exists instructor_profiles_status_check;

alter table public.instructor_profiles
  add constraint instructor_profiles_status_check
  check (status in ('draft', 'pending_review', 'approved', 'published', 'suspended'));

alter table public.instructor_private_settings
  drop constraint if exists instructor_private_subscription_check;

alter table public.instructor_private_settings
  add constraint instructor_private_subscription_check check (
    subscription_status in ('inactive', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'refunded')
  );

create or replace function public.protect_instructor_review_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved', 'published') then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;

    if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
      if new.status <> 'draft' then
        raise exception 'New profiles must begin as drafts';
      end if;
      if new.approved_at is not null or new.approved_by is not null then
        raise exception 'Review fields require an administrator';
      end if;
    end if;
    return new;
  end if;

  if new.status in ('approved', 'published') and old.status not in ('approved', 'published') then
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, auth.uid());
  end if;

  if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
    if new.published_at is distinct from old.published_at
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by then
      raise exception 'Review fields require an administrator';
    end if;
    if old.status not in ('draft', 'published') then
      if not (
        old.status = 'pending_review'
        and new.status = 'draft'
        and (to_jsonb(new) - 'status' - 'updated_at')
          is not distinct from (to_jsonb(old) - 'status' - 'updated_at')
      ) then
        raise exception 'Profile content is locked in its current review state';
      end if;
    end if;
    if new.status is distinct from old.status
      and not (old.status = 'draft' and new.status = 'pending_review')
      and not (old.status = 'pending_review' and new.status = 'draft') then
      raise exception 'That profile status change requires an administrator';
    end if;
  end if;

  return new;
end;
$$;

create table if not exists public.instructor_memberships (
  instructor_profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  latest_invoice_id text,
  latest_checkout_session_id text,
  stripe_created_at timestamptz,
  last_stripe_event_id text,
  last_stripe_event_created_at timestamptz,
  last_observed_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_memberships_status_check check (
    status in ('inactive', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'refunded')
  )
);

create or replace function public.publish_approved_profile_with_active_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = new.id
      and membership.status in ('active', 'trialing')
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

drop trigger if exists publish_approved_profile_with_active_membership on public.instructor_profiles;
create trigger publish_approved_profile_with_active_membership
  after update of status on public.instructor_profiles
  for each row execute function public.publish_approved_profile_with_active_membership();

create table if not exists public.stripe_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  request_key text not null,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  checkout_url text not null,
  status text not null default 'open',
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instructor_profile_id, request_key),
  constraint stripe_checkout_attempts_status_check check (status in ('open', 'completed', 'expired', 'failed')),
  constraint stripe_checkout_attempts_request_key_check check (request_key ~ '^[A-Za-z0-9_-]{8,64}$')
);

create unique index if not exists stripe_checkout_attempts_one_open
  on public.stripe_checkout_attempts (instructor_profile_id)
  where status = 'open';

create index if not exists stripe_checkout_attempts_expiry_idx
  on public.stripe_checkout_attempts (status, expires_at)
  where status = 'open';

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_object_id text,
  api_version text,
  livemode boolean not null,
  stripe_created_at timestamptz not null,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.inquiry_notification_jobs
  add column if not exists completed_at timestamptz;

create index if not exists inquiries_static_target_created_idx
  on public.inquiries (instructor_slug, created_at desc)
  where instructor_profile_id is null;

create or replace function public.enforce_inquiry_submission_limits()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_key text;
  recent_count integer;
begin
  if new.organizer_account_id is null or auth.role() = 'service_role' then
    return new;
  end if;

  target_key := case
    when new.instructor_profile_id is not null then 'profile:' || new.instructor_profile_id::text
    else 'slug:' || coalesce(nullif(trim(new.instructor_slug), ''), 'concierge')
  end;

  perform pg_advisory_xact_lock(hashtextextended('inquiry-organizer:' || new.organizer_account_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('inquiry-target:' || target_key, 0));

  if exists (
    select 1
    from public.inquiries inquiry
    where inquiry.organizer_account_id = new.organizer_account_id
      and inquiry.created_at >= now() - interval '10 minutes'
      and inquiry.event_date = new.event_date
      and case
        when inquiry.instructor_profile_id is not null then 'profile:' || inquiry.instructor_profile_id::text
        else 'slug:' || coalesce(nullif(trim(inquiry.instructor_slug), ''), 'concierge')
      end = target_key
  ) then
    raise exception 'A matching inquiry was already submitted recently';
  end if;

  select count(*) into recent_count
  from public.inquiries inquiry
  where inquiry.organizer_account_id = new.organizer_account_id
    and inquiry.created_at >= now() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'Inquiry limit reached. Please try again later';
  end if;

  select count(*) into recent_count
  from public.inquiries inquiry
  where inquiry.organizer_account_id = new.organizer_account_id
    and inquiry.created_at >= now() - interval '1 day';

  if recent_count >= 20 then
    raise exception 'Daily inquiry limit reached. Please try again tomorrow';
  end if;

  select count(*) into recent_count
  from public.inquiries inquiry
  where inquiry.created_at >= now() - interval '1 hour'
    and case
      when inquiry.instructor_profile_id is not null then 'profile:' || inquiry.instructor_profile_id::text
      else 'slug:' || coalesce(nullif(trim(inquiry.instructor_slug), ''), 'concierge')
    end = target_key;

  if recent_count >= 30 then
    raise exception 'This instructor is receiving many inquiries. Please try again later';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_inquiry_submission_limits on public.inquiries;
create trigger enforce_inquiry_submission_limits
  before insert on public.inquiries
  for each row execute function public.enforce_inquiry_submission_limits();

drop trigger if exists set_instructor_memberships_updated_at on public.instructor_memberships;
create trigger set_instructor_memberships_updated_at
  before update on public.instructor_memberships
  for each row execute function public.set_updated_at();

drop trigger if exists set_stripe_checkout_attempts_updated_at on public.stripe_checkout_attempts;
create trigger set_stripe_checkout_attempts_updated_at
  before update on public.stripe_checkout_attempts
  for each row execute function public.set_updated_at();

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
  resolved_profile_id uuid;
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

  if p_instructor_profile_id is not null then
    select profile.id into resolved_profile_id
    from public.instructor_profiles profile
    where profile.id = p_instructor_profile_id
      and profile.approved_at is not null
      and profile.status in ('approved', 'published', 'suspended');
  end if;

  if resolved_profile_id is null then
    select membership.instructor_profile_id into resolved_profile_id
    from public.instructor_memberships membership
    where membership.stripe_subscription_id = p_subscription_id
       or membership.stripe_customer_id = p_customer_id
    limit 1;
  end if;

  if resolved_profile_id is null then
    select settings.instructor_profile_id into resolved_profile_id
    from public.instructor_private_settings settings
    join public.instructor_profiles profile on profile.id = settings.instructor_profile_id
    where (settings.stripe_subscription_id = p_subscription_id
       or settings.stripe_customer_id = p_customer_id)
      and profile.approved_at is not null
    limit 1;
  end if;

  if resolved_profile_id is null then
    raise exception 'No approved instructor matches this Stripe subscription';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(resolved_profile_id::text, 0));

  if exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = resolved_profile_id
      and membership.last_observed_at is not null
      and (
        membership.last_observed_at > p_observed_at
        or (
          membership.last_observed_at = p_observed_at
          and coalesce(membership.last_stripe_event_id, '') >= p_event_id
        )
      )
  ) then
    return 'stale_observation';
  end if;

  if exists (
    select 1
    from public.instructor_memberships membership
    where membership.instructor_profile_id = resolved_profile_id
      and membership.stripe_subscription_id <> p_subscription_id
      and membership.stripe_created_at is not null
      and (
        p_subscription_created_at is null
        or membership.stripe_created_at > p_subscription_created_at
      )
  ) then
    if p_checkout_session_id is not null then
      update public.stripe_checkout_attempts
      set status = 'completed',
          completed_at = coalesce(completed_at, now()),
          updated_at = now()
      where stripe_checkout_session_id = p_checkout_session_id;
    end if;
    return 'stale_subscription';
  end if;

  insert into public.instructor_memberships (
    instructor_profile_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    latest_invoice_id,
    latest_checkout_session_id,
    stripe_created_at,
    last_stripe_event_id,
    last_stripe_event_created_at,
    last_observed_at,
    synced_at
  ) values (
    resolved_profile_id,
    p_customer_id,
    p_subscription_id,
    p_price_id,
    p_status,
    p_current_period_start,
    p_current_period_end,
    coalesce(p_cancel_at_period_end, false),
    p_latest_invoice_id,
    p_checkout_session_id,
    p_subscription_created_at,
    p_event_id,
    p_event_created_at,
    p_observed_at,
    now()
  )
  on conflict (instructor_profile_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    latest_invoice_id = coalesce(excluded.latest_invoice_id, public.instructor_memberships.latest_invoice_id),
    latest_checkout_session_id = coalesce(excluded.latest_checkout_session_id, public.instructor_memberships.latest_checkout_session_id),
    stripe_created_at = coalesce(excluded.stripe_created_at, public.instructor_memberships.stripe_created_at),
    last_stripe_event_id = excluded.last_stripe_event_id,
    last_stripe_event_created_at = excluded.last_stripe_event_created_at,
    last_observed_at = excluded.last_observed_at,
    synced_at = now();

  update public.instructor_private_settings
  set stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id,
      subscription_status = p_status,
      updated_at = now()
  where instructor_profile_id = resolved_profile_id;

  if p_status in ('active', 'trialing') then
    update public.instructor_profiles
    set status = 'published',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = resolved_profile_id
      and status = 'approved';
  elsif p_status in ('inactive', 'unpaid', 'paused', 'canceled', 'refunded') then
    update public.instructor_profiles
    set status = 'approved',
        updated_at = now()
    where id = resolved_profile_id
      and status = 'published';
  end if;

  if p_checkout_session_id is not null then
    update public.stripe_checkout_attempts
    set status = 'completed',
        completed_at = coalesce(completed_at, now()),
        updated_at = now()
    where stripe_checkout_session_id = p_checkout_session_id;
  end if;

  return 'processed';
end;
$$;

create or replace function public.claim_inquiry_notification_jobs(
  p_limit integer default 10,
  p_lock_timeout interval default interval '10 minutes'
)
returns table (
  job_id bigint,
  channel text,
  attempt_number integer,
  inquiry_recipient_id uuid,
  delivered_to_email text,
  delivered_to_phone_e164 text,
  inquiry_id uuid,
  instructor_name text,
  organizer_name text,
  organizer_email text,
  company_name text,
  event_type text,
  event_date date,
  event_start_time time,
  time_zone text,
  venue_name text,
  event_location text,
  guest_count integer,
  budget_range text,
  music_requests text,
  venue_has_speakers boolean,
  venue_has_microphone boolean,
  inquiry_message text
)
language sql
security definer
set search_path = public
as $$
  with exhausted as (
    update public.inquiry_notification_jobs job
    set status = 'failed',
        completed_at = now(),
        locked_at = null,
        last_error = coalesce(job.last_error, 'Worker stopped before the final attempt completed')
    where job.status = 'processing'
      and job.attempts >= 6
      and coalesce(job.locked_at, '-infinity'::timestamptz)
        < now() - greatest(p_lock_timeout, interval '1 minute')
    returning job.inquiry_recipient_id, job.channel
  ), exhausted_recipients as (
    update public.inquiry_recipients recipient
    set email_delivery_status = case
          when exists (
            select 1 from exhausted
            where exhausted.inquiry_recipient_id = recipient.id
              and exhausted.channel = 'email'
          ) then 'failed'
          else recipient.email_delivery_status
        end,
        sms_delivery_status = case
          when exists (
            select 1 from exhausted
            where exhausted.inquiry_recipient_id = recipient.id
              and exhausted.channel = 'sms'
          ) then 'failed'
          else recipient.sms_delivery_status
        end,
        updated_at = now()
    where exists (
      select 1 from exhausted
      where exhausted.inquiry_recipient_id = recipient.id
    )
    returning recipient.id
  ), candidates as (
    select job.id
    from public.inquiry_notification_jobs job
    where job.attempts < 6
      and (
        (job.status = 'pending' and job.available_at <= now())
        or (
          job.status = 'processing'
          and coalesce(job.locked_at, '-infinity'::timestamptz)
            < now() - greatest(p_lock_timeout, interval '1 minute')
        )
      )
    order by job.available_at, job.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 25))
  ), claimed as (
    update public.inquiry_notification_jobs job
    set status = 'processing',
        attempts = job.attempts + 1,
        locked_at = now(),
        last_error = null
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.channel,
    claimed.attempts,
    recipient.id,
    recipient.delivered_to_email,
    recipient.delivered_to_phone_e164,
    inquiry.id,
    coalesce(profile.display_name, inquiry.instructor_name, 'Line dance instructor'),
    coalesce(inquiry.contact_name, inquiry.name),
    coalesce(inquiry.contact_email, inquiry.email),
    inquiry.company_name,
    inquiry.event_type,
    inquiry.event_date,
    inquiry.event_start_time,
    inquiry.time_zone,
    inquiry.venue_name,
    coalesce(inquiry.location, concat_ws(', ', inquiry.event_city, inquiry.event_region)),
    inquiry.guest_count,
    inquiry.budget_range,
    inquiry.music_requests,
    inquiry.venue_has_speakers,
    inquiry.venue_has_microphone,
    inquiry.message
  from claimed
  join public.inquiry_recipients recipient on recipient.id = claimed.inquiry_recipient_id
  join public.inquiries inquiry on inquiry.id = recipient.inquiry_id
  left join public.instructor_profiles profile on profile.id = recipient.instructor_profile_id;
$$;

create or replace function public.complete_inquiry_notification_job(
  p_job_id bigint,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retryable boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.inquiry_notification_jobs;
  next_status text;
  retry_seconds integer;
begin
  select * into job
  from public.inquiry_notification_jobs
  where id = p_job_id
  for update;

  if job.id is null then
    raise exception 'Notification job not found';
  end if;
  if job.status = 'sent' then
    return 'sent';
  end if;
  if job.status <> 'processing' then
    raise exception 'Notification job is not processing';
  end if;

  if p_success then
    next_status := 'sent';
    update public.inquiry_notification_jobs
    set status = 'sent',
        provider_message_id = nullif(trim(p_provider_message_id), ''),
        sent_at = now(),
        completed_at = now(),
        locked_at = null,
        last_error = null
    where id = job.id;

    if job.channel = 'email' then
      update public.inquiry_recipients
      set email_delivery_status = 'sent',
          email_provider_message_id = nullif(trim(p_provider_message_id), ''),
          updated_at = now()
      where id = job.inquiry_recipient_id;
    else
      update public.inquiry_recipients
      set sms_delivery_status = 'sent',
          sms_provider_message_id = nullif(trim(p_provider_message_id), ''),
          updated_at = now()
      where id = job.inquiry_recipient_id;
    end if;
  elsif p_retryable and job.attempts < 6 then
    next_status := 'pending';
    retry_seconds := least(1800, (30 * power(2, greatest(job.attempts - 1, 0)))::integer);

    update public.inquiry_notification_jobs
    set status = 'pending',
        available_at = now() + retry_seconds * interval '1 second',
        locked_at = null,
        last_error = left(coalesce(p_error, 'Provider request failed'), 2000)
    where id = job.id;

    if job.channel = 'email' then
      update public.inquiry_recipients
      set email_delivery_status = 'queued', updated_at = now()
      where id = job.inquiry_recipient_id;
    else
      update public.inquiry_recipients
      set sms_delivery_status = 'queued', updated_at = now()
      where id = job.inquiry_recipient_id;
    end if;
  else
    next_status := 'failed';
    update public.inquiry_notification_jobs
    set status = 'failed',
        completed_at = now(),
        locked_at = null,
        last_error = left(coalesce(p_error, 'Provider request failed'), 2000)
    where id = job.id;

    if job.channel = 'email' then
      update public.inquiry_recipients
      set email_delivery_status = 'failed', updated_at = now()
      where id = job.inquiry_recipient_id;
    else
      update public.inquiry_recipients
      set sms_delivery_status = 'failed', updated_at = now()
      where id = job.inquiry_recipient_id;
    end if;
  end if;

  return next_status;
end;
$$;

create or replace function public.defer_inquiry_notification_job(
  p_job_id bigint,
  p_error text,
  p_delay interval default interval '15 minutes'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.inquiry_notification_jobs;
begin
  select * into job
  from public.inquiry_notification_jobs
  where id = p_job_id
  for update;

  if job.id is null then
    raise exception 'Notification job not found';
  end if;
  if job.status = 'sent' then
    return 'sent';
  end if;
  if job.status <> 'processing' then
    raise exception 'Notification job is not processing';
  end if;

  update public.inquiry_notification_jobs
  set status = 'pending',
      attempts = greatest(attempts - 1, 0),
      available_at = now() + greatest(p_delay, interval '1 minute'),
      locked_at = null,
      last_error = left(coalesce(p_error, 'Notification provider is not configured'), 2000)
  where id = job.id;

  if job.channel = 'email' then
    update public.inquiry_recipients
    set email_delivery_status = 'queued', updated_at = now()
    where id = job.inquiry_recipient_id;
  else
    update public.inquiry_recipients
    set sms_delivery_status = 'queued', updated_at = now()
    where id = job.inquiry_recipient_id;
  end if;

  return 'pending';
end;
$$;

alter table public.instructor_memberships enable row level security;
alter table public.stripe_checkout_attempts enable row level security;
alter table public.stripe_webhook_events enable row level security;

drop policy if exists "instructors read their membership" on public.instructor_memberships;
create policy "instructors read their membership" on public.instructor_memberships
  for select to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles profile
      where profile.id = instructor_profile_id and profile.account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "instructors read their checkout attempts" on public.stripe_checkout_attempts;
create policy "instructors read their checkout attempts" on public.stripe_checkout_attempts
  for select to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles profile
      where profile.id = instructor_profile_id and profile.account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "admins read Stripe webhook events" on public.stripe_webhook_events;
create policy "admins read Stripe webhook events" on public.stripe_webhook_events
  for select to authenticated using (public.is_marketplace_admin());

revoke all on public.instructor_memberships from anon, authenticated;
revoke all on public.stripe_checkout_attempts from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;

grant select on public.instructor_memberships to authenticated;
grant select on public.stripe_checkout_attempts to authenticated;
grant select on public.stripe_webhook_events to authenticated;

revoke execute on function public.apply_stripe_subscription_event(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_inquiry_notification_jobs(integer, interval) from public, anon, authenticated;
revoke execute on function public.complete_inquiry_notification_job(bigint, boolean, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.defer_inquiry_notification_job(bigint, text, interval) from public, anon, authenticated;

grant execute on function public.apply_stripe_subscription_event(text, text, timestamptz, text, boolean, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_inquiry_notification_jobs(integer, interval) to service_role;
grant execute on function public.complete_inquiry_notification_job(bigint, boolean, text, text, boolean) to service_role;
grant execute on function public.defer_inquiry_notification_job(bigint, text, interval) to service_role;
