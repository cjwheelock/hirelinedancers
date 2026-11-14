-- Organizers can send an inquiry with only an email address. The inquiry is
-- held until the organizer clicks a confirmation link emailed to that address,
-- which proves they own it. Nothing reaches any instructor before then, and
-- held inquiries expire after 7 days. Confirmation finds or creates the
-- sign-in, submits through the normal submit_inquiry path as that account (so
-- the 48-hour response clock starts at confirmation), and signs them in.

create table if not exists private.guest_inquiry_attempts (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(trim(email))),
  ip_hash text,
  account_id uuid,
  inquiry_id uuid,
  outcome text not null default 'held' check (outcome in ('held','submitted')),
  created_at timestamptz not null default now()
);
create index if not exists guest_inquiry_attempts_email_idx on private.guest_inquiry_attempts(email, created_at);
create index if not exists guest_inquiry_attempts_ip_idx on private.guest_inquiry_attempts(ip_hash, created_at);
alter table private.guest_inquiry_attempts enable row level security;
revoke all on private.guest_inquiry_attempts from public, anon, authenticated;
grant all on private.guest_inquiry_attempts to service_role;

-- Returns the existing sign-in for an email, if any, with its account type.
create or replace function public.guest_inquiry_account(p_email text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare clean_email text := lower(trim(coalesce(p_email,''))); found record;
begin
 perform private.require_service_role();
 select u.id, a.role into found from auth.users u left join public.accounts a on a.id=u.id
 where lower(u.email)=clean_email and u.deleted_at is null order by u.created_at limit 1;
 if found.id is null then return null; end if;
 return jsonb_build_object('account_id', found.id, 'role', found.role);
end $$;

create table if not exists private.held_guest_inquiries (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (email = lower(trim(email))),
  first_name text not null,
  last_name text,
  ip_hash text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  confirmed_at timestamptz,
  account_id uuid,
  inquiry_id uuid
);
create index if not exists held_guest_inquiries_email_idx on private.held_guest_inquiries(email, created_at);
alter table private.held_guest_inquiries enable row level security;
revoke all on private.held_guest_inquiries from public, anon, authenticated;
grant all on private.held_guest_inquiries to service_role;

-- Saves a guest inquiry without sending it anywhere. Applies the per-email,
-- per-network and overall limits. Returns what the confirmation email needs.
create or replace function public.hold_guest_inquiry(
  p_token_hash text,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_ip_hash text,
  p_instructor_profile_id uuid,
  p_instructor_slug text,
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
  p_message text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  clean_email text := lower(trim(coalesce(p_email,'')));
  v_first text := nullif(trim(coalesce(p_first_name,'')),'');
  v_last text := nullif(trim(coalesce(p_last_name,'')),'');
  existing_role text;
  instructor record;
  held_id uuid;
begin
  perform private.require_service_role();
  if clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if v_first is null then raise exception 'Your name is required'; end if;
  if char_length(v_first) > 80 or char_length(coalesce(v_last,'')) > 80 then raise exception 'One or more fields are too long'; end if;
  if p_event_date is null then raise exception 'Event date is required'; end if;

  if (select count(*) from private.guest_inquiry_attempts where email=clean_email and created_at > now() - interval '24 hours') >= 3
     or (p_ip_hash is not null and (select count(*) from private.guest_inquiry_attempts
           where ip_hash=p_ip_hash and created_at > now() - interval '1 hour') >= 10)
     or (select count(*) from private.guest_inquiry_attempts where created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many requests. Please try again later';
  end if;

  select a.role into existing_role from auth.users u join public.accounts a on a.id=u.id
  where lower(u.email)=clean_email and u.deleted_at is null order by u.created_at limit 1;
  if existing_role is not null and existing_role <> 'organizer' then raise exception 'Sign in to send this inquiry'; end if;

  select p.id, p.display_name into instructor from public.instructor_profiles p
  where (p_instructor_profile_id is not null and p.id=p_instructor_profile_id)
     or (p_instructor_profile_id is null and p.slug=p_instructor_slug)
  limit 1;

  insert into private.held_guest_inquiries(token_hash, email, first_name, last_name, ip_hash, payload)
  values (p_token_hash, clean_email, v_first, v_last, p_ip_hash, jsonb_build_object(
    'instructor_profile_id', p_instructor_profile_id, 'instructor_slug', p_instructor_slug,
    'event_type', p_event_type, 'event_date', p_event_date, 'event_start_time', p_event_start_time,
    'time_zone', p_time_zone, 'venue_name', p_venue_name, 'event_city', p_event_city,
    'event_region', p_event_region, 'event_postal_code', p_event_postal_code, 'guest_count', p_guest_count,
    'budget_range', p_budget_range, 'music_requests', p_music_requests,
    'venue_has_speakers', p_venue_has_speakers, 'venue_has_microphone', p_venue_has_microphone,
    'message', p_message))
  returning id into held_id;

  insert into private.guest_inquiry_attempts(email, ip_hash, outcome) values (clean_email, p_ip_hash, 'held');
  return jsonb_build_object('held_id', held_id, 'email', clean_email, 'first_name', v_first,
    'instructor_name', instructor.display_name, 'event_date', p_event_date, 'event_type', p_event_type);
end $$;

-- Reports a confirmation link's state without changing anything.
create or replace function public.guest_inquiry_hold_status(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h private.held_guest_inquiries%rowtype;
begin
  perform private.require_service_role();
  select * into h from private.held_guest_inquiries where token_hash=p_token_hash;
  if h.id is null then return jsonb_build_object('status','invalid'); end if;
  if h.confirmed_at is not null then return jsonb_build_object('status','confirmed','email',h.email); end if;
  if h.expires_at <= now() then return jsonb_build_object('status','expired'); end if;
  return jsonb_build_object('status','pending','email',h.email,'first_name',h.first_name,'last_name',h.last_name);
end $$;

-- Sends a held inquiry after the organizer confirmed the email address. The
-- 48-hour response clock starts now, through the normal submit_inquiry path.
create or replace function public.confirm_guest_inquiry(p_token_hash text, p_account_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  h private.held_guest_inquiries%rowtype;
  account public.accounts%rowtype;
  previous_claims text := current_setting('request.jwt.claims', true);
  new_inquiry_id uuid;
  new_thread_id uuid;
begin
  perform private.require_service_role();
  select * into h from private.held_guest_inquiries where token_hash=p_token_hash for update;
  if h.id is null then return jsonb_build_object('status','invalid'); end if;
  if h.confirmed_at is not null then return jsonb_build_object('status','confirmed','email',h.email); end if;
  if h.expires_at <= now() then return jsonb_build_object('status','expired'); end if;

  select * into account from public.accounts where id=p_account_id for update;
  if account.id is null or lower(trim(account.email)) is distinct from h.email then raise exception 'Account not found'; end if;
  if account.role is not null and account.role <> 'organizer' then raise exception 'Sign in to send this inquiry'; end if;
  if account.role is null or nullif(trim(account.full_name),'') is null then
    update public.accounts set role='organizer',
      full_name=coalesce(nullif(trim(account.full_name),''), concat_ws(' ', h.first_name, h.last_name)),
      first_name=coalesce(nullif(trim(account.first_name),''), h.first_name),
      last_name=coalesce(nullif(trim(account.last_name),''), h.last_name),
      onboarding_completed_at=coalesce(account.onboarding_completed_at, now())
    where id=account.id;
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', account.id, 'role', 'authenticated', 'email', h.email)::text, true);
  new_inquiry_id := public.submit_inquiry(
    p_instructor_profile_id => nullif(h.payload->>'instructor_profile_id','')::uuid,
    p_event_type => h.payload->>'event_type', p_event_date => (h.payload->>'event_date')::date,
    p_event_start_time => nullif(h.payload->>'event_start_time','')::time, p_time_zone => h.payload->>'time_zone',
    p_venue_name => h.payload->>'venue_name', p_event_city => h.payload->>'event_city',
    p_event_region => h.payload->>'event_region', p_event_postal_code => h.payload->>'event_postal_code',
    p_guest_count => nullif(h.payload->>'guest_count','')::integer, p_budget_range => h.payload->>'budget_range',
    p_music_requests => h.payload->>'music_requests',
    p_venue_has_speakers => (h.payload->>'venue_has_speakers')::boolean,
    p_venue_has_microphone => (h.payload->>'venue_has_microphone')::boolean,
    p_message => h.payload->>'message', p_instructor_slug => h.payload->>'instructor_slug', p_fallback_consent => true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);

  select t.id into new_thread_id from public.inquiry_threads t where t.inquiry_id=new_inquiry_id
  order by t.assignment_order, t.created_at limit 1;
  update private.held_guest_inquiries set confirmed_at=now(), account_id=account.id, inquiry_id=new_inquiry_id where id=h.id;
  -- The limits count holds; confirming one is not a new attempt.
  return jsonb_build_object('status','sent','inquiry_id',new_inquiry_id,'thread_id',new_thread_id,'email',h.email);
end $$;

revoke all on function public.guest_inquiry_account(text) from public, anon, authenticated;
revoke all on function public.hold_guest_inquiry(text,text,text,text,text,uuid,text,text,date,time,text,text,text,text,text,integer,text,text,boolean,boolean,text) from public, anon, authenticated;
revoke all on function public.guest_inquiry_hold_status(text) from public, anon, authenticated;
revoke all on function public.confirm_guest_inquiry(text,uuid) from public, anon, authenticated;
grant execute on function public.guest_inquiry_account(text) to service_role;
grant execute on function public.hold_guest_inquiry(text,text,text,text,text,uuid,text,text,date,time,text,text,text,text,text,integer,text,text,boolean,boolean,text) to service_role;
grant execute on function public.guest_inquiry_hold_status(text) to service_role;
grant execute on function public.confirm_guest_inquiry(text,uuid) to service_role;
