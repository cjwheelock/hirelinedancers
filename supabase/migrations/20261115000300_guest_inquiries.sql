-- Organizers can send an inquiry with only an email address. The guest-inquiry
-- edge function (service role) finds or creates the sign-in for that address,
-- then calls submit_guest_inquiry, which applies per-email and per-network
-- limits and submits through the normal submit_inquiry path as that account.
-- Replies arrive by email; reading them requires signing in with that address.

create table if not exists private.guest_inquiry_attempts (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(trim(email))),
  ip_hash text,
  account_id uuid,
  inquiry_id uuid,
  outcome text not null default 'submitted' check (outcome = 'submitted'),
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

create or replace function public.submit_guest_inquiry(
  p_account_id uuid,
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
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  clean_email text := lower(trim(coalesce(p_email,'')));
  v_first text := nullif(trim(coalesce(p_first_name,'')),'');
  v_last text := nullif(trim(coalesce(p_last_name,'')),'');
  account public.accounts%rowtype;
  previous_claims text := current_setting('request.jwt.claims', true);
  new_inquiry_id uuid;
begin
  perform private.require_service_role();
  if clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if v_first is null then raise exception 'Your name is required'; end if;
  if char_length(v_first) > 80 or char_length(coalesce(v_last,'')) > 80 then raise exception 'One or more fields are too long'; end if;

  if (select count(*) from private.guest_inquiry_attempts where email=clean_email and created_at > now() - interval '24 hours') >= 3
     or (p_ip_hash is not null and (select count(*) from private.guest_inquiry_attempts
           where ip_hash=p_ip_hash and created_at > now() - interval '1 hour') >= 10)
     or (select count(*) from private.guest_inquiry_attempts where created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many requests. Please try again later';
  end if;

  select * into account from public.accounts where id=p_account_id for update;
  if account.id is null or lower(trim(account.email)) is distinct from clean_email then
    raise exception 'Account not found';
  end if;
  if account.role is not null and account.role <> 'organizer' then
    raise exception 'Sign in to send this inquiry';
  end if;
  if account.role is null or nullif(trim(account.full_name),'') is null then
    update public.accounts set role='organizer',
      full_name=coalesce(nullif(trim(account.full_name),''), concat_ws(' ', v_first, v_last)),
      first_name=coalesce(nullif(trim(account.first_name),''), v_first),
      last_name=coalesce(nullif(trim(account.last_name),''), v_last),
      onboarding_completed_at=coalesce(account.onboarding_completed_at, now())
    where id=account.id;
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', account.id, 'role', 'authenticated', 'email', clean_email)::text, true);
  new_inquiry_id := public.submit_inquiry(
    p_instructor_profile_id => p_instructor_profile_id, p_event_type => p_event_type, p_event_date => p_event_date,
    p_event_start_time => p_event_start_time, p_time_zone => p_time_zone, p_venue_name => p_venue_name,
    p_event_city => p_event_city, p_event_region => p_event_region, p_event_postal_code => p_event_postal_code,
    p_guest_count => p_guest_count, p_budget_range => p_budget_range, p_music_requests => p_music_requests,
    p_venue_has_speakers => p_venue_has_speakers, p_venue_has_microphone => p_venue_has_microphone,
    p_message => p_message, p_instructor_slug => p_instructor_slug, p_fallback_consent => true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);

  insert into private.guest_inquiry_attempts(email, ip_hash, account_id, inquiry_id, outcome)
  values (clean_email, p_ip_hash, account.id, new_inquiry_id, 'submitted');
  return new_inquiry_id;
end $$;

revoke all on function public.guest_inquiry_account(text) from public, anon, authenticated;
revoke all on function public.submit_guest_inquiry(uuid,text,text,text,text,uuid,text,text,date,time,text,text,text,text,text,integer,text,text,boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.guest_inquiry_account(text) to service_role;
grant execute on function public.submit_guest_inquiry(uuid,text,text,text,text,uuid,text,text,date,time,text,text,text,text,text,integer,text,text,boolean,boolean,text) to service_role;
