-- Personal matching requests: organizers in cities with no published
-- instructors ask Hire Line Dancers to find someone. No account is required.
-- Each request creates one durable owner alert through the existing
-- administrator notification queue.
create table public.matching_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','in_progress','matched','closed')),
  search_query text check (char_length(search_query) <= 200),
  event_type text not null check (char_length(event_type) <= 100),
  event_date date not null,
  event_start_time time,
  time_zone text check (char_length(time_zone) <= 100),
  venue_name text check (char_length(venue_name) <= 200),
  event_city text not null check (char_length(event_city) between 1 and 120),
  event_region text not null check (char_length(event_region) between 1 and 100),
  event_postal_code text check (char_length(event_postal_code) <= 20),
  guest_count integer check (guest_count between 1 and 10000),
  budget_range text check (char_length(budget_range) <= 100),
  music_requests text check (char_length(music_requests) <= 1000),
  venue_has_speakers boolean,
  venue_has_microphone boolean,
  message text check (char_length(message) <= 3000),
  contact_name text not null check (char_length(contact_name) between 1 and 200),
  contact_email text not null check (char_length(contact_email) between 3 and 320),
  contact_phone text check (char_length(contact_phone) <= 40)
);
create index matching_requests_email_created_idx on public.matching_requests (lower(contact_email), created_at desc);
create index matching_requests_created_idx on public.matching_requests (created_at desc);
alter table public.matching_requests enable row level security;
revoke all on public.matching_requests from anon, authenticated;
grant select, update on public.matching_requests to authenticated;
grant all on public.matching_requests to service_role;
create policy "admins read matching requests" on public.matching_requests
  for select to authenticated using (public.is_marketplace_admin());
create policy "admins update matching requests" on public.matching_requests
  for update to authenticated using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());

-- The owner alert queue now carries either an inquiry or a matching request.
alter table public.admin_inquiry_notification_jobs alter column inquiry_id drop not null;
alter table public.admin_inquiry_notification_jobs
  add column matching_request_id uuid unique references public.matching_requests(id) on delete cascade;
alter table public.admin_inquiry_notification_jobs
  add constraint admin_inquiry_notification_jobs_one_subject
  check (num_nonnulls(inquiry_id, matching_request_id) = 1);

create function private.enqueue_admin_matching_request_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_inquiry_notification_jobs(matching_request_id,inquiry)
  values (new.id, jsonb_build_object(
    'kind','matching_request','id',new.id,'created_at',new.created_at,
    'search_query',new.search_query,
    'contact_name',new.contact_name,'contact_email',new.contact_email,'contact_phone',new.contact_phone,
    'event_type',new.event_type,'event_date',new.event_date,'event_start_time',new.event_start_time,
    'time_zone',new.time_zone,'venue_name',new.venue_name,
    'event_city',new.event_city,'event_region',new.event_region,'event_postal_code',new.event_postal_code,
    'guest_count',new.guest_count,'budget_range',new.budget_range,'music_requests',new.music_requests,
    'venue_has_speakers',new.venue_has_speakers,'venue_has_microphone',new.venue_has_microphone,
    'message',new.message
  )) on conflict(matching_request_id) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_admin_matching_request_notification() from public,anon,authenticated;
create trigger enqueue_admin_matching_request_notification after insert on public.matching_requests
  for each row execute function private.enqueue_admin_matching_request_notification();

create function public.submit_matching_request(
  p_event_type text,
  p_event_date date,
  p_event_city text,
  p_event_region text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text default null,
  p_event_start_time time default null,
  p_time_zone text default null,
  p_venue_name text default null,
  p_event_postal_code text default null,
  p_guest_count integer default null,
  p_budget_range text default null,
  p_music_requests text default null,
  p_venue_has_speakers boolean default null,
  p_venue_has_microphone boolean default null,
  p_message text default null,
  p_search_query text default null,
  p_website text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_id uuid;
  clean_email text := lower(trim(coalesce(p_contact_email,'')));
begin
  -- Hidden form field: people never fill it, simple bots do. Pretend success.
  if nullif(trim(coalesce(p_website,'')),'') is not null then
    return gen_random_uuid();
  end if;
  if nullif(trim(p_event_type),'') is null or trim(p_event_type) not in (
    'weddings','corporate-events','bachelorette-parties','bar-bat-mitzvahs','private-parties',
    'fundraisers','summer-camps','after-school-programs','fitness-classes','venues','schools-community'
  ) then raise exception 'Choose a supported event type'; end if;
  if p_event_date is null then raise exception 'Event date is required'; end if;
  if p_event_date < current_date then raise exception 'Event date cannot be in the past'; end if;
  if nullif(trim(p_event_city),'') is null or nullif(trim(p_event_region),'') is null then
    raise exception 'Event city and state are required';
  end if;
  if nullif(trim(p_contact_name),'') is null then raise exception 'Your name is required'; end if;
  if clean_email !~ '^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_guest_count is not null and (p_guest_count < 1 or p_guest_count > 10000) then
    raise exception 'Guest count must be between 1 and 10000';
  end if;
  if char_length(trim(p_contact_name)) > 200 or char_length(clean_email) > 320
    or char_length(coalesce(p_contact_phone,'')) > 40
    or char_length(coalesce(p_time_zone,'')) > 100 or char_length(coalesce(p_venue_name,'')) > 200
    or char_length(trim(p_event_city)) > 120 or char_length(trim(p_event_region)) > 100
    or char_length(coalesce(p_event_postal_code,'')) > 20 or char_length(coalesce(p_budget_range,'')) > 100
    or char_length(coalesce(p_music_requests,'')) > 1000 or char_length(coalesce(p_message,'')) > 3000
    or char_length(coalesce(p_search_query,'')) > 200 then
    raise exception 'One or more fields are too long';
  end if;
  if (select count(*) from public.matching_requests
      where lower(contact_email) = clean_email and created_at > now() - interval '1 hour') >= 5
    or (select count(*) from public.matching_requests where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many requests. Please try again later';
  end if;

  insert into public.matching_requests (
    search_query,event_type,event_date,event_start_time,time_zone,venue_name,event_city,event_region,
    event_postal_code,guest_count,budget_range,music_requests,venue_has_speakers,venue_has_microphone,
    message,contact_name,contact_email,contact_phone
  ) values (
    nullif(trim(p_search_query),''),trim(p_event_type),p_event_date,p_event_start_time,nullif(trim(p_time_zone),''),
    nullif(trim(p_venue_name),''),trim(p_event_city),upper(trim(p_event_region)),nullif(trim(p_event_postal_code),''),
    p_guest_count,nullif(trim(p_budget_range),''),nullif(trim(p_music_requests),''),p_venue_has_speakers,
    p_venue_has_microphone,nullif(trim(p_message),''),trim(p_contact_name),clean_email,nullif(trim(p_contact_phone),'')
  ) returning id into request_id;
  return request_id;
end $$;
revoke all on function public.submit_matching_request(text,date,text,text,text,text,text,time,text,text,text,integer,text,text,boolean,boolean,text,text,text) from public;
grant execute on function public.submit_matching_request(text,date,text,text,text,text,text,time,text,text,text,integer,text,text,boolean,boolean,text,text,text) to anon, authenticated;
