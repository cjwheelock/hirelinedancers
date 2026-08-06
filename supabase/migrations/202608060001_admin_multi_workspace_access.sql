-- Let a separately granted marketplace administrator act as an organizer
-- without changing the account's primary instructor or organizer role.

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
  if account.id is null
    or (account.role is distinct from 'organizer' and not public.is_marketplace_admin()) then
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
