-- Marketplace accounts, instructor profiles, authenticated inquiries, and follow-up tracking.
-- This migration is safe to run after the original application and favorite-song migrations.

create table if not exists public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text,
  company_name text,
  phone_e164 text,
  sms_opt_in boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_role_check check (role is null or role in ('organizer', 'instructor', 'admin')),
  constraint accounts_phone_check check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create table if not exists public.instructor_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  slug text unique,
  status text not null default 'draft',
  display_name text not null,
  business_name text,
  headline text,
  bio text,
  city text,
  region text,
  postal_code text,
  country_code text not null default 'US',
  travel_radius_miles integer,
  years_teaching integer,
  max_group_size integer,
  styles text[] not null default '{}',
  event_types text[] not null default '{}',
  age_groups text[] not null default '{}',
  languages text[] not null default array['English']::text[],
  favorite_song_name text,
  favorite_song_spotify_url text,
  provides_speakers boolean,
  provides_microphone boolean,
  provides_music_playback boolean,
  liability_insurance_status text not null default 'not_provided',
  preferred_response_hours integer not null default 48,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_profiles_status_check check (status in ('draft', 'pending_review', 'approved', 'published', 'suspended')),
  constraint instructor_profiles_slug_check check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint instructor_profiles_travel_check check (travel_radius_miles is null or travel_radius_miles between 0 and 1000),
  constraint instructor_profiles_years_check check (years_teaching is null or years_teaching between 0 and 80),
  constraint instructor_profiles_group_check check (max_group_size is null or max_group_size between 1 and 10000),
  constraint instructor_profiles_response_check check (preferred_response_hours between 1 and 168),
  constraint instructor_profiles_insurance_check check (liability_insurance_status in ('not_provided', 'available', 'required_per_event')),
  constraint instructor_profiles_spotify_check check (
    favorite_song_spotify_url is null
    or favorite_song_spotify_url ~ '^https://open[.]spotify[.]com/track/[A-Za-z0-9]{22}(?:[?].*)?$'
  )
);

create table if not exists public.instructor_private_settings (
  instructor_profile_id uuid primary key references public.instructor_profiles(id) on delete cascade,
  inquiry_email text not null,
  inquiry_phone_e164 text,
  sms_notifications_enabled boolean not null default false,
  sms_consent_at timestamptz,
  sms_consent_source text,
  sms_opted_out_at timestamptz,
  minimum_rate_cents integer,
  minimum_hours numeric(4, 2),
  payment_methods text[] not null default '{}',
  contract_template_url text,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text not null default 'inactive',
  response_reminders_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_private_phone_check check (
    inquiry_phone_e164 is null or inquiry_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint instructor_private_email_check check (
    inquiry_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint instructor_private_sms_consent_check check (
    not sms_notifications_enabled
    or (inquiry_phone_e164 is not null and sms_consent_at is not null)
  ),
  constraint instructor_private_rate_check check (minimum_rate_cents is null or minimum_rate_cents >= 0),
  constraint instructor_private_hours_check check (minimum_hours is null or minimum_hours between 0.5 and 24),
  constraint instructor_private_subscription_check check (
    subscription_status in ('inactive', 'trialing', 'active', 'past_due', 'paused', 'canceled', 'refunded')
  )
);

alter table public.instructor_private_settings
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text,
  add column if not exists sms_opted_out_at timestamptz;

create table if not exists public.profile_media (
  id uuid primary key default gen_random_uuid(),
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  media_type text not null,
  storage_path text,
  external_url text,
  mime_type text,
  caption text,
  alt_text text,
  sort_order integer not null default 0,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_media_type_check check (media_type in ('headshot', 'image', 'welcome_video', 'video')),
  constraint profile_media_source_check check (num_nonnulls(storage_path, external_url) = 1),
  constraint profile_media_status_check check (status in ('processing', 'ready', 'rejected')),
  constraint profile_media_sort_check check (sort_order between 0 and 99)
);

-- Static launch profiles remain visible while their instructors claim accounts.
-- Inquiries for an unclaimed listing go to the central concierge queue.
create table if not exists public.directory_instructor_targets (
  slug text primary key,
  display_name text not null,
  business_name text,
  city text,
  region text,
  active boolean not null default true,
  claimed_profile_id uuid unique references public.instructor_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.directory_instructor_targets (slug, display_name, business_name, city, region)
values
  ('avery-cole-nashville-tn', 'Avery Cole', 'Music City Line Dance Co.', 'Nashville', 'TN'),
  ('morgan-rivera-austin-tx', 'Morgan Rivera', 'Austin Boot Step', 'Austin', 'TX'),
  ('jordan-wells-dallas-tx', 'Jordan Wells', 'Dallas Social Line Dance', 'Dallas', 'TX'),
  ('camille-price-atlanta-ga', 'Camille Price', 'Peachtree Line Dance Collective', 'Atlanta', 'GA'),
  ('riley-stone-phoenix-az', 'Riley Stone', 'Desert Step Events', 'Phoenix', 'AZ')
on conflict (slug) do update set
  display_name = excluded.display_name,
  business_name = excluded.business_name,
  city = excluded.city,
  region = excluded.region,
  updated_at = now();

create unique index if not exists profile_media_one_headshot
  on public.profile_media (instructor_profile_id)
  where media_type = 'headshot' and status <> 'rejected';

create unique index if not exists profile_media_one_welcome_video
  on public.profile_media (instructor_profile_id)
  where media_type = 'welcome_video' and status <> 'rejected';

-- Create a full inquiry table on a new project. The ALTER statements below also
-- upgrade the smaller table described in earlier setup documentation.
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  instructor_slug text,
  instructor_name text,
  name text not null,
  email text not null,
  event_date date,
  location text,
  guest_count integer,
  message text,
  status text not null default 'new'
);

alter table public.inquiries
  add column if not exists organizer_account_id uuid references public.accounts(id) on delete restrict,
  add column if not exists instructor_profile_id uuid references public.instructor_profiles(id) on delete restrict,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists company_name text,
  add column if not exists contact_phone_e164 text,
  add column if not exists event_type text,
  add column if not exists event_start_time time,
  add column if not exists time_zone text,
  add column if not exists venue_name text,
  add column if not exists event_city text,
  add column if not exists event_region text,
  add column if not exists event_postal_code text,
  add column if not exists budget_range text,
  add column if not exists music_requests text,
  add column if not exists venue_has_speakers boolean,
  add column if not exists venue_has_microphone boolean,
  add column if not exists reply_by_date date,
  add column if not exists first_viewed_at timestamptz,
  add column if not exists first_responded_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists booking_outcome text not null default 'unknown',
  add column if not exists booking_value_cents integer,
  add column if not exists booking_event_date date,
  add column if not exists outcome_note text,
  add column if not exists outcome_reported_by uuid references public.accounts(id) on delete set null,
  add column if not exists outcome_reported_at timestamptz,
  add column if not exists outcome_followup_count integer not null default 0,
  add column if not exists outcome_last_asked_at timestamptz,
  add column if not exists outcome_next_ask_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.inquiry_recipients (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  instructor_profile_id uuid references public.instructor_profiles(id) on delete restrict,
  delivered_to_email text not null,
  delivered_to_phone_e164 text,
  email_delivery_status text not null default 'queued',
  sms_delivery_status text not null default 'not_requested',
  email_provider_message_id text,
  sms_provider_message_id text,
  email_delivered_at timestamptz,
  sms_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inquiry_id, instructor_profile_id),
  constraint inquiry_recipients_email_status_check check (email_delivery_status in ('queued', 'sent', 'delivered', 'failed')),
  constraint inquiry_recipients_sms_status_check check (sms_delivery_status in ('not_requested', 'queued', 'sent', 'delivered', 'failed'))
);

create table if not exists public.inquiry_status_events (
  id bigint generated by default as identity primary key,
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  actor_account_id uuid references public.accounts(id) on delete set null,
  previous_status text,
  new_status text not null,
  note text,
  created_at timestamptz not null default now()
);

-- Keep each participant's answer so one party cannot silently erase the other.
create table if not exists public.inquiry_outcome_reports (
  id bigint generated by default as identity primary key,
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  reporter_account_id uuid not null references public.accounts(id) on delete cascade,
  outcome text not null,
  booking_value_cents integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inquiry_id, reporter_account_id),
  constraint inquiry_outcome_reports_outcome_check check (
    outcome in ('booked', 'not_booked', 'still_deciding', 'no_response')
  ),
  constraint inquiry_outcome_reports_value_check check (
    booking_value_cents is null or booking_value_cents >= 0
  )
);

create table if not exists public.inquiry_notification_jobs (
  id bigint generated by default as identity primary key,
  inquiry_recipient_id uuid not null references public.inquiry_recipients(id) on delete cascade,
  channel text not null,
  notification_type text not null default 'new_inquiry',
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  constraint inquiry_notification_channel_check check (channel in ('email', 'sms')),
  constraint inquiry_notification_status_check check (status in ('pending', 'processing', 'sent', 'failed'))
);

create table if not exists public.profile_review_events (
  id bigint generated by default as identity primary key,
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  reviewer_account_id uuid references public.accounts(id) on delete set null,
  previous_status text not null,
  new_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists inquiry_notification_jobs_unique
  on public.inquiry_notification_jobs (inquiry_recipient_id, channel, notification_type);

create index if not exists inquiries_organizer_idx on public.inquiries (organizer_account_id, created_at desc);
create index if not exists inquiries_instructor_idx on public.inquiries (instructor_profile_id, created_at desc);
create index if not exists inquiry_status_events_inquiry_idx on public.inquiry_status_events (inquiry_id, created_at);
create index if not exists inquiry_notification_jobs_pending_idx
  on public.inquiry_notification_jobs (status, available_at)
  where status in ('pending', 'failed');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts',
    'instructor_profiles',
    'instructor_private_settings',
    'profile_media',
    'directory_instructor_targets',
    'inquiries',
    'inquiry_recipients',
    'inquiry_outcome_reports'
  ] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create or replace function public.handle_new_marketplace_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.accounts.full_name, excluded.full_name),
    updated_at = now();

  update public.instructor_private_settings settings
  set inquiry_email = new.email,
      updated_at = now()
  from public.instructor_profiles profile
  where profile.id = settings.instructor_profile_id
    and profile.account_id = new.id
    and new.email is not null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_marketplace on auth.users;
create trigger on_auth_user_created_marketplace
  after insert or update of email on auth.users
  for each row execute function public.handle_new_marketplace_user();

-- Backfill accounts if Auth already contains users.
insert into public.accounts (id, email, full_name)
select
  id,
  email,
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
from auth.users
on conflict (id) do nothing;

create or replace function public.is_marketplace_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.accounts
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.protect_account_authority()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
    if new.id is distinct from old.id or new.email is distinct from old.email then
      raise exception 'Account identity fields cannot be changed here';
    end if;
    if new.role is distinct from old.role
      and coalesce(current_setting('hire_line_dancers.allow_role_change', true), '') <> 'on' then
      raise exception 'Account type changes must use the onboarding workflow';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_account_authority on public.accounts;
create trigger protect_account_authority
  before update on public.accounts
  for each row execute function public.protect_account_authority();

create or replace function public.protect_instructor_review_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
    if tg_op = 'INSERT' and new.status <> 'draft' then
      raise exception 'New profiles must begin as drafts';
    end if;
    if tg_op = 'UPDATE' then
    if new.published_at is distinct from old.published_at then
      raise exception 'Published date is managed by Hire Line Dancers';
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
  end if;
  return new;
end;
$$;

drop trigger if exists protect_instructor_review_fields on public.instructor_profiles;
create trigger protect_instructor_review_fields
  before insert or update on public.instructor_profiles
  for each row execute function public.protect_instructor_review_fields();

create or replace function public.protect_membership_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' and not public.is_marketplace_admin() then
    new.inquiry_email := coalesce(auth.jwt() ->> 'email', new.inquiry_email);
    if tg_op = 'INSERT' then
      new.stripe_customer_id := null;
      new.stripe_subscription_id := null;
      new.subscription_status := 'inactive';
    else
      new.stripe_customer_id := old.stripe_customer_id;
      new.stripe_subscription_id := old.stripe_subscription_id;
      new.subscription_status := old.subscription_status;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.manage_instructor_sms_consent()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.sms_notifications_enabled then
    new.sms_consent_at := now();
    new.sms_consent_source := 'instructor_account_settings';
    new.sms_opted_out_at := null;
  elsif tg_op = 'UPDATE'
    and new.sms_notifications_enabled
    and (
      not old.sms_notifications_enabled
      or new.inquiry_phone_e164 is distinct from old.inquiry_phone_e164
    ) then
    new.sms_consent_at := now();
    new.sms_consent_source := 'instructor_account_settings';
    new.sms_opted_out_at := null;
  elsif tg_op = 'UPDATE'
    and not new.sms_notifications_enabled
    and old.sms_notifications_enabled then
    new.sms_opted_out_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists manage_instructor_sms_consent on public.instructor_private_settings;
create trigger manage_instructor_sms_consent
  before insert or update of sms_notifications_enabled, inquiry_phone_e164
  on public.instructor_private_settings
  for each row execute function public.manage_instructor_sms_consent();

drop trigger if exists protect_membership_fields on public.instructor_private_settings;
create trigger protect_membership_fields
  before insert or update on public.instructor_private_settings
  for each row execute function public.protect_membership_fields();

create or replace function public.complete_account_onboarding(
  p_role text,
  p_full_name text,
  p_company_name text default null,
  p_phone_e164 text default null,
  p_sms_opt_in boolean default false
)
returns public.accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.accounts;
  existing_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_role not in ('organizer', 'instructor') then
    raise exception 'Choose organizer or instructor';
  end if;
  if nullif(trim(p_full_name), '') is null then
    raise exception 'Full name is required';
  end if;

  select role into existing_role
  from public.accounts
  where id = auth.uid()
  for update;
  if existing_role is not null and existing_role <> p_role then
    raise exception 'Contact support to change your account type';
  end if;

  perform set_config('hire_line_dancers.allow_role_change', 'on', true);

  insert into public.accounts (
    id, email, full_name, role, company_name, phone_e164, sms_opt_in, onboarding_completed_at
  )
  values (
    auth.uid(), auth.jwt() ->> 'email', trim(p_full_name), p_role,
    nullif(trim(p_company_name), ''), nullif(trim(p_phone_e164), ''), p_sms_opt_in, now()
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    role = coalesce(public.accounts.role, excluded.role),
    company_name = excluded.company_name,
    phone_e164 = excluded.phone_e164,
    sms_opt_in = excluded.sms_opt_in,
    onboarding_completed_at = coalesce(public.accounts.onboarding_completed_at, now()),
    updated_at = now()
  returning * into result;

  if p_role = 'instructor' then
    insert into public.instructor_profiles (account_id, display_name)
    values (auth.uid(), trim(p_full_name))
    on conflict (account_id) do nothing;

    insert into public.instructor_private_settings (
      instructor_profile_id,
      inquiry_email,
      inquiry_phone_e164,
      sms_notifications_enabled
    )
    select id, auth.jwt() ->> 'email', nullif(trim(p_phone_e164), ''), p_sms_opt_in
    from public.instructor_profiles
    where account_id = auth.uid()
    on conflict (instructor_profile_id) do nothing;
  end if;

  return result;
end;
$$;

create or replace function public.enforce_profile_media_limits()
returns trigger
language plpgsql
as $$
declare
  existing_count integer;
begin
  if new.status = 'rejected' then
    return new;
  end if;

  select count(*) into existing_count
  from public.profile_media
  where instructor_profile_id = new.instructor_profile_id
    and media_type = new.media_type
    and status <> 'rejected'
    and id <> new.id;

  if new.media_type = 'image' and existing_count >= 3 then
    raise exception 'A profile can have at most three gallery images';
  end if;
  if new.media_type = 'video' and existing_count >= 3 then
    raise exception 'A profile can have at most three gallery videos';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_profile_media_limits on public.profile_media;
create trigger enforce_profile_media_limits
  before insert or update on public.profile_media
  for each row execute function public.enforce_profile_media_limits();

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
  delivery_phone text;
  send_sms boolean := false;
begin
  if new.instructor_profile_id is null then
    delivery_email := 'hello@hirelinedancers.com';
  else
    select * into settings
    from public.instructor_private_settings
    where instructor_profile_id = new.instructor_profile_id;
    delivery_email := settings.inquiry_email;
    delivery_phone := case when settings.sms_notifications_enabled then settings.inquiry_phone_e164 end;
    send_sms := settings.sms_notifications_enabled and settings.inquiry_phone_e164 is not null;
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
    delivery_phone,
    case
      when send_sms then 'queued'
      else 'not_requested'
    end
  ) returning id into recipient_id;

  insert into public.inquiry_notification_jobs (inquiry_recipient_id, channel)
  values (recipient_id, 'email');

  if send_sms then
    insert into public.inquiry_notification_jobs (inquiry_recipient_id, channel)
    values (recipient_id, 'sms');
  end if;

  return new;
end;
$$;

drop trigger if exists create_inquiry_delivery on public.inquiries;
create trigger create_inquiry_delivery
  after insert on public.inquiries
  for each row
  execute function public.create_inquiry_delivery();

create or replace function public.log_inquiry_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.inquiry_status_events (
      inquiry_id, actor_account_id, previous_status, new_status
    ) values (
      new.id,
      auth.uid(),
      case when tg_op = 'INSERT' then null else old.status end,
      new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_inquiry_status_event on public.inquiries;
create trigger log_inquiry_status_event
  after insert or update of status on public.inquiries
  for each row execute function public.log_inquiry_status_event();

create or replace function public.submit_inquiry(
  p_instructor_profile_id uuid,
  p_event_type text,
  p_event_date date,
  p_event_start_time time default null,
  p_time_zone text default null,
  p_venue_name text default null,
  p_event_city text default null,
  p_event_region text default null,
  p_event_postal_code text default null,
  p_guest_count integer default null,
  p_budget_range text default null,
  p_music_requests text default null,
  p_venue_has_speakers boolean default null,
  p_venue_has_microphone boolean default null,
  p_message text default null,
  p_instructor_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.accounts;
  instructor public.instructor_profiles;
  static_instructor public.directory_instructor_targets;
  inquiry_id uuid;
  location_label text;
  target_profile_id uuid;
  target_slug text;
  target_name text;
  response_hours integer := 48;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into account
  from public.accounts
  where id = auth.uid()
  for update;
  if account.role <> 'organizer' then
    raise exception 'Complete organizer onboarding before contacting an instructor';
  end if;
  if nullif(trim(account.full_name), '') is null or nullif(trim(account.email), '') is null then
    raise exception 'Complete your organizer contact information first';
  end if;

  if p_instructor_profile_id is not null then
    select * into instructor
    from public.instructor_profiles
    where id = p_instructor_profile_id and status = 'published';
    if instructor.id is null then
      raise exception 'Instructor is not available for inquiries';
    end if;
    target_profile_id := instructor.id;
    target_slug := instructor.slug;
    target_name := instructor.display_name;
    response_hours := instructor.preferred_response_hours;
  else
    select * into static_instructor
    from public.directory_instructor_targets
    where slug = p_instructor_slug and active;
    if static_instructor.slug is null then
      raise exception 'Instructor is not available for inquiries';
    end if;
    if static_instructor.claimed_profile_id is not null then
      select * into instructor
      from public.instructor_profiles
      where id = static_instructor.claimed_profile_id and status = 'published';
      if instructor.id is not null then
        target_profile_id := instructor.id;
        response_hours := instructor.preferred_response_hours;
      end if;
    end if;
    target_slug := static_instructor.slug;
    target_name := static_instructor.display_name;
  end if;
  if p_event_type is null or trim(p_event_type) = '' then
    raise exception 'Event type is required';
  end if;
  if trim(p_event_type) not in (
    'weddings',
    'corporate-events',
    'bachelorette-parties',
    'bar-bat-mitzvahs',
    'private-parties',
    'fundraisers',
    'summer-camps',
    'after-school-programs',
    'fitness-classes',
    'venues',
    'schools-community'
  ) then
    raise exception 'Choose a supported event type';
  end if;
  if p_event_date is null then
    raise exception 'Event date is required';
  end if;
  if p_event_date < current_date then
    raise exception 'Event date cannot be in the past';
  end if;
  if nullif(trim(p_event_city), '') is null or nullif(trim(p_event_region), '') is null then
    raise exception 'Event city and state are required';
  end if;
  if p_guest_count is not null and (p_guest_count < 1 or p_guest_count > 10000) then
    raise exception 'Guest count must be between 1 and 10000';
  end if;
  if char_length(trim(p_event_type)) > 100
    or char_length(coalesce(p_time_zone, '')) > 100
    or char_length(coalesce(p_venue_name, '')) > 200
    or char_length(coalesce(p_event_city, '')) > 120
    or char_length(coalesce(p_event_region, '')) > 100
    or char_length(coalesce(p_event_postal_code, '')) > 20
    or char_length(coalesce(p_budget_range, '')) > 100
    or char_length(coalesce(p_music_requests, '')) > 1000
    or char_length(coalesce(p_message, '')) > 3000 then
    raise exception 'One or more inquiry fields are too long';
  end if;

  location_label := concat_ws(', ', nullif(trim(p_event_city), ''), nullif(trim(p_event_region), ''));

  insert into public.inquiries (
    organizer_account_id,
    instructor_profile_id,
    instructor_slug,
    instructor_name,
    name,
    email,
    contact_name,
    contact_email,
    company_name,
    event_type,
    event_date,
    event_start_time,
    time_zone,
    venue_name,
    location,
    event_city,
    event_region,
    event_postal_code,
    guest_count,
    budget_range,
    music_requests,
    venue_has_speakers,
    venue_has_microphone,
    message,
    status,
    reply_by_date,
    outcome_next_ask_at
  ) values (
    auth.uid(),
    target_profile_id,
    target_slug,
    target_name,
    account.full_name,
    account.email,
    account.full_name,
    account.email,
    account.company_name,
    trim(p_event_type),
    p_event_date,
    p_event_start_time,
    nullif(trim(p_time_zone), ''),
    nullif(trim(p_venue_name), ''),
    nullif(location_label, ''),
    nullif(trim(p_event_city), ''),
    nullif(trim(p_event_region), ''),
    nullif(trim(p_event_postal_code), ''),
    p_guest_count,
    nullif(trim(p_budget_range), ''),
    nullif(trim(p_music_requests), ''),
    p_venue_has_speakers,
    p_venue_has_microphone,
    nullif(trim(p_message), ''),
    'submitted',
    current_date + greatest(1, least(7, ceil(response_hours / 24.0)::integer)),
    p_event_date + 2
  ) returning id into inquiry_id;

  return inquiry_id;
end;
$$;

create or replace function public.set_inquiry_status(
  p_inquiry_id uuid,
  p_status text,
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
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_status not in ('submitted', 'viewed', 'responded', 'declined', 'withdrawn', 'closed') then
    raise exception 'Invalid inquiry status';
  end if;

  select * into inquiry from public.inquiries where id = p_inquiry_id;
  if inquiry.id is null then
    raise exception 'Inquiry not found';
  end if;
  select exists (
    select 1
    from public.inquiry_recipients recipient
    join public.instructor_profiles profile on profile.id = recipient.instructor_profile_id
    where recipient.inquiry_id = p_inquiry_id and profile.account_id = auth.uid()
  ) into is_recipient;

  if inquiry.organizer_account_id <> auth.uid() and not is_recipient and not public.is_marketplace_admin() then
    raise exception 'Not allowed to update this inquiry';
  end if;
  if inquiry.organizer_account_id = auth.uid() and p_status not in ('withdrawn', 'closed') then
    raise exception 'Organizer cannot set that status';
  end if;
  if is_recipient and p_status not in ('viewed', 'responded', 'declined', 'closed') then
    raise exception 'Instructor cannot set that status';
  end if;

  update public.inquiries set
    status = p_status,
    first_viewed_at = case when p_status = 'viewed' then coalesce(first_viewed_at, now()) else first_viewed_at end,
    first_responded_at = case when p_status = 'responded' then coalesce(first_responded_at, now()) else first_responded_at end,
    closed_at = case when p_status in ('declined', 'withdrawn', 'closed') then now() else closed_at end
  where id = p_inquiry_id;

  if nullif(trim(p_note), '') is not null then
    insert into public.inquiry_status_events (
      inquiry_id, actor_account_id, previous_status, new_status, note
    ) values (
      p_inquiry_id, auth.uid(), inquiry.status, p_status, trim(p_note)
    );
  end if;
end;
$$;

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

  select * into inquiry from public.inquiries where id = p_inquiry_id;
  if inquiry.id is null then
    raise exception 'Inquiry not found';
  end if;
  select exists (
    select 1
    from public.inquiry_recipients recipient
    join public.instructor_profiles profile on profile.id = recipient.instructor_profile_id
    where recipient.inquiry_id = p_inquiry_id and profile.account_id = auth.uid()
  ) into is_recipient;

  if inquiry.organizer_account_id <> auth.uid() and not is_recipient and not public.is_marketplace_admin() then
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
    booking_value_cents = case when resolved_outcome = 'booked' then p_booking_value_cents else booking_value_cents end,
    outcome_note = nullif(trim(p_note), ''),
    outcome_reported_by = auth.uid(),
    outcome_reported_at = now(),
    outcome_next_ask_at = null,
    status = case
      when resolved_outcome = 'booked' then 'booked'
      when resolved_outcome = 'not_booked' then 'not_booked'
      when status in ('booked', 'not_booked') and first_responded_at is not null then 'responded'
      when status in ('booked', 'not_booked') then 'submitted'
      else status
    end,
    closed_at = case when resolved_outcome in ('booked', 'not_booked') then now() else null end
  where id = p_inquiry_id;
end;
$$;

create or replace function public.review_instructor_profile(
  p_instructor_profile_id uuid,
  p_decision text,
  p_slug text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  profile public.instructor_profiles;
  next_status text;
  clean_slug text;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_decision not in ('approve', 'return_to_draft', 'suspend') then
    raise exception 'Invalid review decision';
  end if;

  select * into profile
  from public.instructor_profiles
  where id = p_instructor_profile_id
  for update;
  if profile.id is null then
    raise exception 'Instructor profile not found';
  end if;

  if p_decision = 'approve' then
    clean_slug := lower(trim(coalesce(p_slug, profile.slug)));
    if clean_slug is null or clean_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
      raise exception 'A valid profile slug is required for approval';
    end if;
    next_status := 'approved';
    update public.instructor_profiles set
      status = next_status,
      slug = clean_slug,
      published_at = null
    where id = profile.id;

    update public.directory_instructor_targets set claimed_profile_id = profile.id
    where slug = clean_slug;
  elsif p_decision = 'return_to_draft' then
    next_status := 'draft';
    update public.instructor_profiles set status = next_status, published_at = null
    where id = profile.id;
  else
    next_status := 'suspended';
    update public.instructor_profiles set status = next_status, published_at = null
    where id = profile.id;
  end if;

  insert into public.profile_review_events (
    instructor_profile_id, reviewer_account_id, previous_status, new_status, note
  ) values (
    profile.id, auth.uid(), profile.status, next_status, nullif(trim(p_note), '')
  );
end;
$$;

-- Public browsing uses this narrow view. Account IDs, exact postal codes,
-- private contact settings, rates, and billing data stay out of the public API.
create or replace view public.instructor_directory_profiles
with (security_barrier = true)
as
select
  id,
  slug,
  status,
  display_name,
  business_name,
  headline,
  bio,
  city,
  region,
  country_code,
  travel_radius_miles,
  years_teaching,
  max_group_size,
  styles,
  event_types,
  age_groups,
  languages,
  favorite_song_name,
  favorite_song_spotify_url,
  provides_speakers,
  provides_microphone,
  provides_music_playback,
  liability_insurance_status,
  preferred_response_hours,
  published_at,
  created_at,
  updated_at
from public.instructor_profiles
where status = 'published';

alter table public.accounts enable row level security;
alter table public.instructor_profiles enable row level security;
alter table public.instructor_private_settings enable row level security;
alter table public.profile_media enable row level security;
alter table public.directory_instructor_targets enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_recipients enable row level security;
alter table public.inquiry_status_events enable row level security;
alter table public.inquiry_outcome_reports enable row level security;
alter table public.inquiry_notification_jobs enable row level security;
alter table public.profile_review_events enable row level security;

drop policy if exists "account owners can read" on public.accounts;
create policy "account owners can read" on public.accounts
  for select to authenticated
  using (id = auth.uid() or public.is_marketplace_admin());

drop policy if exists "account owners can update" on public.accounts;
create policy "account owners can update" on public.accounts
  for update to authenticated
  using (id = auth.uid() or public.is_marketplace_admin())
  with check (id = auth.uid() or public.is_marketplace_admin());

drop policy if exists "published instructor profiles are public" on public.instructor_profiles;
drop policy if exists "profile owners and admins read profiles" on public.instructor_profiles;
create policy "profile owners and admins read profiles" on public.instructor_profiles
  for select to authenticated
  using (account_id = auth.uid() or public.is_marketplace_admin());

drop policy if exists "instructors create their profile" on public.instructor_profiles;
create policy "instructors create their profile" on public.instructor_profiles
  for insert to authenticated
  with check (
    (
      account_id = auth.uid()
      and status = 'draft'
      and exists (
        select 1 from public.accounts
        where id = auth.uid() and role = 'instructor'
      )
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "instructors update their profile" on public.instructor_profiles;
create policy "instructors update their profile" on public.instructor_profiles
  for update to authenticated
  using (
    (account_id = auth.uid() and status in ('draft', 'pending_review', 'published'))
    or public.is_marketplace_admin()
  )
  with check (
    (account_id = auth.uid() and status in ('draft', 'pending_review', 'published'))
    or public.is_marketplace_admin()
  );

drop policy if exists "instructors manage private settings" on public.instructor_private_settings;
create policy "instructors manage private settings" on public.instructor_private_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    ) or public.is_marketplace_admin()
  )
  with check (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    ) or public.is_marketplace_admin()
  );

drop policy if exists "ready profile media is public" on public.profile_media;
create policy "ready profile media is public" on public.profile_media
  for select to anon, authenticated
  using (
    status = 'ready' and exists (
      select 1 from public.instructor_directory_profiles
      where id = instructor_profile_id
    )
    or exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "instructors manage profile media" on public.profile_media;
create policy "instructors manage profile media" on public.profile_media
  for all to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id
        and account_id = auth.uid()
        and status in ('draft', 'published')
    ) or public.is_marketplace_admin()
  )
  with check (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id
        and account_id = auth.uid()
        and status in ('draft', 'published')
    ) or public.is_marketplace_admin()
  );

drop policy if exists "active static instructor targets are public" on public.directory_instructor_targets;
create policy "active static instructor targets are public" on public.directory_instructor_targets
  for select to anon, authenticated using (active or public.is_marketplace_admin());

drop policy if exists "admins manage static instructor targets" on public.directory_instructor_targets;
create policy "admins manage static instructor targets" on public.directory_instructor_targets
  for all to authenticated
  using (public.is_marketplace_admin())
  with check (public.is_marketplace_admin());

-- Remove the earlier anonymous inquiry policy. Browsing remains public, contact requires login.
drop policy if exists "anon can submit inquiries" on public.inquiries;
drop policy if exists "authenticated users submit inquiries" on public.inquiries;

drop policy if exists "participants read inquiries" on public.inquiries;
create policy "participants read inquiries" on public.inquiries
  for select to authenticated
  using (
    organizer_account_id = auth.uid()
    or exists (
      select 1
      from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "participants read inquiry recipients" on public.inquiry_recipients;
create policy "participants read inquiry recipients" on public.inquiry_recipients
  for select to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "participants read outcome reports" on public.inquiry_outcome_reports;
create policy "participants read outcome reports" on public.inquiry_outcome_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.inquiries inquiry
      where inquiry.id = inquiry_id
        and (
          inquiry.organizer_account_id = auth.uid()
          or exists (
            select 1 from public.instructor_profiles profile
            where profile.id = inquiry.instructor_profile_id
              and profile.account_id = auth.uid()
          )
        )
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "participants read inquiry events" on public.inquiry_status_events;
create policy "participants read inquiry events" on public.inquiry_status_events
  for select to authenticated
  using (
    exists (
      select 1 from public.inquiries inquiry
      where inquiry.id = inquiry_id
        and (
          inquiry.organizer_account_id = auth.uid()
          or exists (
            select 1 from public.instructor_profiles profile
            where profile.id = inquiry.instructor_profile_id and profile.account_id = auth.uid()
          )
        )
    )
    or public.is_marketplace_admin()
  );

drop policy if exists "admins read notification jobs" on public.inquiry_notification_jobs;
create policy "admins read notification jobs" on public.inquiry_notification_jobs
  for select to authenticated using (public.is_marketplace_admin());

drop policy if exists "profile owners and admins read reviews" on public.profile_review_events;
create policy "profile owners and admins read reviews" on public.profile_review_events
  for select to authenticated
  using (
    exists (
      select 1 from public.instructor_profiles
      where id = instructor_profile_id and account_id = auth.uid()
    )
    or public.is_marketplace_admin()
  );

-- Authenticated instructors upload only to their own folder: <auth.uid()>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'instructor-media',
  'instructor-media',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anon can upload instructor media" on storage.objects;
drop policy if exists "instructors upload their media" on storage.objects;
create policy "instructors upload their media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'instructor-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.instructor_profiles profile
      join public.accounts account on account.id = profile.account_id
      where profile.account_id = auth.uid()
        and account.role = 'instructor'
        and profile.status in ('draft', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  );

drop policy if exists "instructors update their media" on storage.objects;
create policy "instructors update their media" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'instructor-media'
    and owner_id = auth.uid()::text
    and exists (
      select 1 from public.instructor_profiles profile
      where profile.account_id = auth.uid()
        and profile.status in ('draft', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  )
  with check (
    bucket_id = 'instructor-media'
    and owner_id = auth.uid()::text
    and exists (
      select 1 from public.instructor_profiles profile
      where profile.account_id = auth.uid()
        and profile.status in ('draft', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  );

drop policy if exists "instructors delete their media" on storage.objects;
create policy "instructors delete their media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'instructor-media'
    and owner_id = auth.uid()::text
    and exists (
      select 1 from public.instructor_profiles profile
      where profile.account_id = auth.uid()
        and profile.status in ('draft', 'published')
        and (storage.foldername(name))[2] = profile.id::text
    )
  );

revoke select on public.instructor_profiles from anon;
revoke all on public.instructor_directory_profiles from anon, authenticated;
grant select on public.instructor_directory_profiles to anon, authenticated;

grant execute on function public.complete_account_onboarding(text, text, text, text, boolean) to authenticated;
grant execute on function public.submit_inquiry(uuid, text, date, time, text, text, text, text, text, integer, text, text, boolean, boolean, text, text) to authenticated;
grant execute on function public.set_inquiry_status(uuid, text, text) to authenticated;
grant execute on function public.report_booking_outcome(uuid, text, integer, text) to authenticated;
grant execute on function public.review_instructor_profile(uuid, text, text, text) to authenticated;

revoke execute on function public.complete_account_onboarding(text, text, text, text, boolean) from public, anon;
revoke execute on function public.submit_inquiry(uuid, text, date, time, text, text, text, text, text, integer, text, text, boolean, boolean, text, text) from public, anon;
revoke execute on function public.set_inquiry_status(uuid, text, text) from public, anon;
revoke execute on function public.report_booking_outcome(uuid, text, integer, text) from public, anon;
revoke execute on function public.review_instructor_profile(uuid, text, text, text) from public, anon;

revoke all on public.inquiry_notification_jobs from anon, authenticated;
grant select on public.inquiry_notification_jobs to authenticated;
revoke all on public.instructor_private_settings from anon;
revoke all on public.inquiry_outcome_reports from anon, authenticated;
grant select on public.inquiry_outcome_reports to authenticated;
