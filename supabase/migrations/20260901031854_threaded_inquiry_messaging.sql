-- Threaded inquiry messaging, response reminders, and admin-assisted fallback.
-- Existing inquiries remain the organizer-level request. Each instructor contact
-- attempt receives a separate private thread so instructors never share a
-- conversation with one another.

alter table public.inquiries
  add column if not exists fallback_consent boolean not null default false,
  add column if not exists fallback_consent_at timestamptz,
  add column if not exists booked_instructor_profile_id uuid
    references public.instructor_profiles(id) on delete restrict,
  add column if not exists messaging_search_vector tsvector
    generated always as (
      to_tsvector(
        'simple'::regconfig,
        coalesce(contact_name, name, '') || ' ' ||
        coalesce(contact_email, email, '') || ' ' ||
        coalesce(company_name, '') || ' ' ||
        coalesce(instructor_name, '') || ' ' ||
        coalesce(event_type, '') || ' ' ||
        coalesce(event_city, '') || ' ' ||
        coalesce(event_region, '') || ' ' ||
        coalesce(venue_name, '') || ' ' ||
        coalesce(message, '')
      )
    ) stored;

update public.inquiries
set booked_instructor_profile_id = instructor_profile_id
where booking_outcome = 'booked'
  and booked_instructor_profile_id is null;

create table public.service_markets (
  slug text primary key,
  name text not null,
  region text not null,
  country_code text not null default 'US',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_markets_slug_check check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint service_markets_name_check check (
    char_length(trim(name)) between 1 and 120
  ),
  constraint service_markets_region_check check (
    char_length(trim(region)) between 1 and 100
  ),
  constraint service_markets_country_check check (
    country_code ~ '^[A-Z]{2}$'
  )
);

create table public.service_market_localities (
  id bigint generated always as identity primary key,
  service_market_slug text not null
    references public.service_markets(slug) on update cascade on delete cascade,
  city text not null,
  region text not null,
  city_normalized text generated always as (
    lower(regexp_replace(trim(city), '[[:space:]]+', ' ', 'g'))
  ) stored,
  region_normalized text generated always as (
    lower(regexp_replace(trim(region), '[[:space:]]+', ' ', 'g'))
  ) stored,
  created_at timestamptz not null default now(),
  constraint service_market_localities_city_check check (
    char_length(trim(city)) between 1 and 120
  ),
  constraint service_market_localities_region_check check (
    char_length(trim(region)) between 1 and 100
  ),
  unique (service_market_slug, city_normalized, region_normalized)
);

create table public.instructor_service_markets (
  instructor_profile_id uuid not null
    references public.instructor_profiles(id) on delete cascade,
  service_market_slug text not null
    references public.service_markets(slug) on update cascade on delete cascade,
  accepting_inquiries boolean not null default true,
  fallback_eligible boolean not null default true,
  max_active_thread_count smallint not null default 10,
  source text not null default 'profile_city',
  last_fallback_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (instructor_profile_id, service_market_slug),
  constraint instructor_service_markets_cap_check check (
    max_active_thread_count between 1 and 50
  ),
  constraint instructor_service_markets_source_check check (
    source in ('profile_city', 'admin')
  )
);

create table public.inquiry_threads (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  inquiry_recipient_id uuid unique
    references public.inquiry_recipients(id) on delete set null,
  instructor_profile_id uuid
    references public.instructor_profiles(id) on delete restrict,
  instructor_account_id uuid
    references public.accounts(id) on delete restrict,
  assignment_order smallint not null default 1,
  assignment_source text not null default 'organizer_selected',
  previous_thread_id uuid references public.inquiry_threads(id) on delete set null,
  status text not null default 'awaiting_response',
  assigned_at timestamptz not null default now(),
  response_clock_started_at timestamptz,
  response_due_at timestamptz,
  first_viewed_at timestamptz,
  first_instructor_message_at timestamptz,
  last_message_id bigint,
  last_message_at timestamptz,
  timed_out_at timestamptz,
  fallback_review_requested_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inquiry_threads_assignment_order_check check (
    assignment_order between 1 and 100
  ),
  constraint inquiry_threads_assignment_source_check check (
    assignment_source in ('organizer_selected', 'fallback', 'admin', 'legacy', 'static_support')
  ),
  constraint inquiry_threads_status_check check (
    status in ('awaiting_response', 'active', 'declined', 'timed_out', 'withdrawn', 'closed')
  ),
  constraint inquiry_threads_profile_account_check check (
    (instructor_profile_id is null and instructor_account_id is null)
    or instructor_profile_id is not null
  ),
  constraint inquiry_threads_response_clock_check check (
    (response_clock_started_at is null and response_due_at is null)
    or (
      response_clock_started_at is not null
      and response_due_at is not null
      and response_due_at >= response_clock_started_at
    )
  ),
  unique (inquiry_id, assignment_order)
);

create table public.inquiry_thread_participants (
  thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  participant_role text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_message_id bigint,
  last_read_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (thread_id, account_id),
  constraint inquiry_thread_participants_role_check check (
    participant_role in ('organizer', 'instructor')
  )
);

create table public.inquiry_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  sender_account_id uuid references public.accounts(id) on delete restrict,
  message_kind text not null default 'participant',
  body text not null,
  client_request_id uuid,
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(body, ''))
  ) stored,
  constraint inquiry_messages_kind_check check (
    message_kind in ('participant', 'inquiry', 'system')
  ),
  constraint inquiry_messages_sender_check check (
    (message_kind = 'system' and sender_account_id is null)
    or (message_kind in ('participant', 'inquiry') and sender_account_id is not null)
  ),
  constraint inquiry_messages_body_check check (
    (message_kind = 'inquiry' and char_length(body) between 0 and 4000)
    or (message_kind <> 'inquiry' and char_length(body) between 1 and 4000)
  )
);

alter table public.inquiry_threads
  add constraint inquiry_threads_last_message_fkey
  foreign key (last_message_id) references public.inquiry_messages(id)
  deferrable initially deferred;

alter table public.inquiry_thread_participants
  add constraint inquiry_thread_participants_last_read_fkey
  foreign key (last_read_message_id) references public.inquiry_messages(id)
  on delete set null;

create table public.inquiry_admin_notes (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  author_account_id uuid references public.accounts(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now(),
  constraint inquiry_admin_notes_note_check check (
    char_length(trim(note)) between 1 and 4000
  )
);

create table public.inquiry_admin_access_events (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  admin_account_id uuid references public.accounts(id) on delete set null,
  action text not null default 'opened',
  created_at timestamptz not null default now(),
  constraint inquiry_admin_access_events_action_check check (
    action in ('opened', 'searched', 'noted', 'routed', 'sent')
  )
);

create table public.inquiry_routing_events (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  thread_id uuid references public.inquiry_threads(id) on delete cascade,
  actor_account_id uuid references public.accounts(id) on delete set null,
  candidate_instructor_profile_id uuid
    references public.instructor_profiles(id) on delete set null,
  event_type text not null,
  note text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  constraint inquiry_routing_events_type_check check (
    event_type in (
      'fallback_review_requested',
      'fallback_routed',
      'instructor_declined',
      'no_eligible_candidate',
      'inquiry_withdrawn'
    )
  ),
  constraint inquiry_routing_events_note_check check (
    note is null or char_length(note) <= 2000
  )
);

create table public.inquiry_thread_notification_jobs (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  inquiry_recipient_id uuid
    references public.inquiry_recipients(id) on delete cascade,
  message_id bigint references public.inquiry_messages(id) on delete cascade,
  recipient_account_id uuid references public.accounts(id) on delete cascade,
  recipient_email text not null,
  channel text not null default 'email',
  notification_type text not null,
  status text not null default 'pending',
  attempts smallint not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  last_error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  constraint inquiry_thread_notification_channel_check check (channel = 'email'),
  constraint inquiry_thread_notification_type_check check (
    notification_type in (
      'new_thread',
      'new_message',
      'response_reminder_24',
      'response_reminder_48',
      'response_timeout_instructor',
      'response_timeout_organizer',
      'thread_declined',
      'fallback_routed_organizer'
    )
  ),
  constraint inquiry_thread_notification_status_check check (
    status in ('pending', 'processing', 'sent', 'failed', 'canceled')
  ),
  constraint inquiry_thread_notification_attempts_check check (
    attempts between 0 and 6
  ),
  constraint inquiry_thread_notification_email_check check (
    recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  )
);

create unique index inquiry_threads_instructor_once_idx
  on public.inquiry_threads (inquiry_id, instructor_profile_id)
  where instructor_profile_id is not null;

create unique index inquiry_threads_one_current_idx
  on public.inquiry_threads (inquiry_id)
  where status in ('awaiting_response', 'active');

create index inquiry_threads_instructor_inbox_idx
  on public.inquiry_threads (instructor_account_id, status, response_due_at, id);
create index inquiry_threads_instructor_profile_idx
  on public.inquiry_threads (instructor_profile_id, status, updated_at desc);
create index inquiry_threads_inquiry_idx
  on public.inquiry_threads (inquiry_id, assignment_order);
create index inquiry_threads_previous_idx
  on public.inquiry_threads (previous_thread_id)
  where previous_thread_id is not null;
create index inquiry_threads_last_message_idx
  on public.inquiry_threads (last_message_id)
  where last_message_id is not null;
create index inquiry_threads_created_by_idx
  on public.inquiry_threads (created_by)
  where created_by is not null;
create index inquiry_threads_recent_idx
  on public.inquiry_threads (last_message_at desc, id desc);
create index inquiry_threads_due_idx
  on public.inquiry_threads (response_due_at, id)
  where status = 'awaiting_response' and response_due_at is not null;
create index inquiry_thread_participants_account_idx
  on public.inquiry_thread_participants (account_id, archived_at, thread_id);
create index inquiry_thread_participants_last_read_idx
  on public.inquiry_thread_participants (last_read_message_id)
  where last_read_message_id is not null;
create index inquiry_messages_thread_idx
  on public.inquiry_messages (thread_id, id desc);
create index inquiry_messages_sender_idx
  on public.inquiry_messages (sender_account_id, id desc)
  where sender_account_id is not null;
create unique index inquiry_messages_client_request_idx
  on public.inquiry_messages (sender_account_id, client_request_id)
  where client_request_id is not null;
create index inquiry_messages_search_idx
  on public.inquiry_messages using gin (search_vector);
create index inquiries_messaging_search_idx
  on public.inquiries using gin (messaging_search_vector);
create index inquiries_booked_instructor_idx
  on public.inquiries (booked_instructor_profile_id, outcome_reported_at desc)
  where booked_instructor_profile_id is not null;
create index inquiry_admin_notes_thread_idx
  on public.inquiry_admin_notes (thread_id, created_at, id);
create index inquiry_admin_notes_author_idx
  on public.inquiry_admin_notes (author_account_id)
  where author_account_id is not null;
create index inquiry_admin_access_thread_idx
  on public.inquiry_admin_access_events (thread_id, created_at desc);
create index inquiry_admin_access_admin_idx
  on public.inquiry_admin_access_events (admin_account_id, created_at desc)
  where admin_account_id is not null;
create index inquiry_routing_events_inquiry_idx
  on public.inquiry_routing_events (inquiry_id, created_at, id);
create index inquiry_routing_events_thread_idx
  on public.inquiry_routing_events (thread_id, created_at, id)
  where thread_id is not null;
create index inquiry_routing_events_actor_idx
  on public.inquiry_routing_events (actor_account_id, created_at desc)
  where actor_account_id is not null;
create index inquiry_routing_events_candidate_idx
  on public.inquiry_routing_events (candidate_instructor_profile_id, created_at desc)
  where candidate_instructor_profile_id is not null;
create index inquiry_thread_notification_pending_idx
  on public.inquiry_thread_notification_jobs (available_at, id)
  where status = 'pending';
create index inquiry_thread_notification_thread_idx
  on public.inquiry_thread_notification_jobs (thread_id, notification_type, status);
create index inquiry_thread_notification_recipient_idx
  on public.inquiry_thread_notification_jobs (inquiry_recipient_id)
  where inquiry_recipient_id is not null;
create index inquiry_thread_notification_message_idx
  on public.inquiry_thread_notification_jobs (message_id)
  where message_id is not null;
create index inquiry_thread_notification_account_idx
  on public.inquiry_thread_notification_jobs (recipient_account_id, created_at desc)
  where recipient_account_id is not null;
create index service_market_localities_lookup_idx
  on public.service_market_localities (city_normalized, region_normalized, service_market_slug);
create index instructor_service_markets_routing_idx
  on public.instructor_service_markets (
    service_market_slug,
    accepting_inquiries,
    fallback_eligible,
    last_fallback_assigned_at,
    instructor_profile_id
  );

create index inquiry_recipients_inquiry_profile_idx
  on public.inquiry_recipients (inquiry_id, instructor_profile_id);

insert into public.service_markets (slug, name, region)
values
  ('nashville-tn', 'Nashville', 'TN'),
  ('fort-worth-tx', 'Fort Worth', 'TX'),
  ('austin-tx', 'Austin', 'TX'),
  ('dallas-tx', 'Dallas', 'TX'),
  ('houston-tx', 'Houston', 'TX'),
  ('san-francisco-ca', 'San Francisco Bay Area', 'CA'),
  ('new-york-ny', 'New York City metro', 'NY'),
  ('phoenix-az', 'Phoenix and Scottsdale', 'AZ'),
  ('atlanta-ga', 'Atlanta', 'GA'),
  ('charlotte-nc', 'Charlotte', 'NC'),
  ('las-vegas-nv', 'Las Vegas', 'NV'),
  ('los-angeles-ca', 'Los Angeles', 'CA'),
  ('san-diego-ca', 'San Diego', 'CA')
on conflict (slug) do update set
  name = excluded.name,
  region = excluded.region,
  active = true,
  updated_at = now();

insert into public.service_market_localities (service_market_slug, city, region)
values
  ('nashville-tn', 'Nashville', 'TN'),
  ('fort-worth-tx', 'Fort Worth', 'TX'),
  ('austin-tx', 'Austin', 'TX'),
  ('dallas-tx', 'Dallas', 'TX'),
  ('houston-tx', 'Houston', 'TX'),
  ('san-francisco-ca', 'San Francisco', 'CA'),
  ('san-francisco-ca', 'Oakland', 'CA'),
  ('san-francisco-ca', 'Berkeley', 'CA'),
  ('san-francisco-ca', 'San Jose', 'CA'),
  ('new-york-ny', 'New York', 'NY'),
  ('new-york-ny', 'New York City', 'NY'),
  ('new-york-ny', 'Brooklyn', 'NY'),
  ('new-york-ny', 'Queens', 'NY'),
  ('new-york-ny', 'Bronx', 'NY'),
  ('new-york-ny', 'Staten Island', 'NY'),
  ('new-york-ny', 'Jersey City', 'NJ'),
  ('new-york-ny', 'Hoboken', 'NJ'),
  ('new-york-ny', 'White Plains', 'NY'),
  ('phoenix-az', 'Phoenix', 'AZ'),
  ('phoenix-az', 'Scottsdale', 'AZ'),
  ('phoenix-az', 'Tempe', 'AZ'),
  ('phoenix-az', 'Mesa', 'AZ'),
  ('atlanta-ga', 'Atlanta', 'GA'),
  ('charlotte-nc', 'Charlotte', 'NC'),
  ('las-vegas-nv', 'Las Vegas', 'NV'),
  ('los-angeles-ca', 'Los Angeles', 'CA'),
  ('san-diego-ca', 'San Diego', 'CA')
on conflict (service_market_slug, city_normalized, region_normalized) do nothing;

insert into public.instructor_service_markets (
  instructor_profile_id,
  service_market_slug,
  accepting_inquiries,
  fallback_eligible,
  source
)
select distinct
  profile.id,
  locality.service_market_slug,
  true,
  true,
  'profile_city'
from public.instructor_profiles profile
join public.service_market_localities locality
  on locality.city_normalized = lower(
    regexp_replace(trim(coalesce(profile.city, '')), '[[:space:]]+', ' ', 'g')
  )
 and locality.region_normalized = lower(
    regexp_replace(trim(coalesce(profile.region, '')), '[[:space:]]+', ' ', 'g')
  )
where nullif(trim(profile.city), '') is not null
  and nullif(trim(profile.region), '') is not null
on conflict (instructor_profile_id, service_market_slug) do nothing;

insert into public.inquiry_threads (
  inquiry_id,
  inquiry_recipient_id,
  instructor_profile_id,
  instructor_account_id,
  assignment_order,
  assignment_source,
  status,
  assigned_at,
  first_viewed_at,
  first_instructor_message_at,
  last_message_at,
  timed_out_at,
  closed_at,
  created_by,
  created_at,
  updated_at
)
select
  inquiry.id,
  recipient.id,
  inquiry.instructor_profile_id,
  profile.account_id,
  1,
  case
    when inquiry.instructor_profile_id is null then 'static_support'
    else 'legacy'
  end,
  case
    when inquiry.status = 'declined' then 'declined'
    when inquiry.status = 'withdrawn' then 'withdrawn'
    when inquiry.status in ('closed', 'booked', 'not_booked') then 'closed'
    when inquiry.first_responded_at is not null or inquiry.status = 'responded' then 'active'
    else 'awaiting_response'
  end,
  inquiry.created_at,
  inquiry.first_viewed_at,
  inquiry.first_responded_at,
  inquiry.created_at,
  null,
  case
    when inquiry.status in ('declined', 'withdrawn', 'closed', 'booked', 'not_booked')
      then coalesce(inquiry.closed_at, inquiry.updated_at, inquiry.created_at)
    else null
  end,
  inquiry.organizer_account_id,
  inquiry.created_at,
  inquiry.updated_at
from public.inquiries inquiry
left join public.instructor_profiles profile
  on profile.id = inquiry.instructor_profile_id
left join public.inquiry_recipients recipient
  on recipient.inquiry_id = inquiry.id
 and recipient.instructor_profile_id is not distinct from inquiry.instructor_profile_id
on conflict (inquiry_id, assignment_order) do nothing;

insert into public.inquiry_thread_participants (
  thread_id,
  account_id,
  participant_role,
  joined_at,
  last_read_at
)
select
  thread.id,
  inquiry.organizer_account_id,
  'organizer',
  thread.assigned_at,
  thread.assigned_at
from public.inquiry_threads thread
join public.inquiries inquiry on inquiry.id = thread.inquiry_id
where inquiry.organizer_account_id is not null
on conflict (thread_id, account_id) do nothing;

insert into public.inquiry_thread_participants (
  thread_id,
  account_id,
  participant_role,
  joined_at,
  last_read_at
)
select
  thread.id,
  thread.instructor_account_id,
  'instructor',
  thread.assigned_at,
  case when thread.first_viewed_at is not null then thread.first_viewed_at end
from public.inquiry_threads thread
where thread.instructor_account_id is not null
on conflict (thread_id, account_id) do nothing;

insert into public.inquiry_messages (
  thread_id,
  sender_account_id,
  message_kind,
  body,
  created_at
)
select
  thread.id,
  inquiry.organizer_account_id,
  'inquiry',
  coalesce(inquiry.message, ''),
  inquiry.created_at
from public.inquiry_threads thread
join public.inquiries inquiry on inquiry.id = thread.inquiry_id
where thread.assignment_order = 1
  and inquiry.organizer_account_id is not null
  and not exists (
    select 1
    from public.inquiry_messages message
    where message.thread_id = thread.id
      and message.message_kind = 'inquiry'
  );

with latest as (
  select distinct on (message.thread_id)
    message.thread_id,
    message.id,
    message.created_at
  from public.inquiry_messages message
  order by message.thread_id, message.id desc
)
update public.inquiry_threads thread
set last_message_id = latest.id,
    last_message_at = latest.created_at
from latest
where latest.thread_id = thread.id
  and thread.last_message_id is null;

update public.inquiry_thread_participants participant
set last_read_message_id = thread.last_message_id,
    updated_at = now()
from public.inquiry_threads thread
where thread.id = participant.thread_id
  and participant.participant_role = 'organizer'
  and participant.last_read_message_id is null;

create or replace function public.set_inquiry_booked_instructor_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_outcome = 'booked' then
    select thread.instructor_profile_id
    into new.booked_instructor_profile_id
    from public.inquiry_threads thread
    where thread.inquiry_id = new.id
      and thread.instructor_profile_id is not null
    order by thread.assignment_order desc
    limit 1;
    new.booked_instructor_profile_id := coalesce(
      new.booked_instructor_profile_id,
      new.instructor_profile_id
    );
  else
    new.booked_instructor_profile_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_inquiry_booked_instructor_assignment
  on public.inquiries;
create trigger set_inquiry_booked_instructor_assignment
  before insert or update of booking_outcome on public.inquiries
  for each row execute function public.set_inquiry_booked_instructor_assignment();

create or replace function private.is_inquiry_thread_participant(
  p_thread_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.inquiry_thread_participants participant
      where participant.thread_id = p_thread_id
        and participant.account_id = (select auth.uid())
        and participant.left_at is null
    );
$$;

create or replace function private.is_current_inquiry_assignment_participant(
  p_inquiry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.inquiry_threads thread
      join public.inquiry_thread_participants participant
        on participant.thread_id = thread.id
      where thread.inquiry_id = p_inquiry_id
        and participant.account_id = (select auth.uid())
        and participant.left_at is null
        and not exists (
          select 1
          from public.inquiry_threads newer_thread
          where newer_thread.inquiry_id = thread.inquiry_id
            and newer_thread.assignment_order > thread.assignment_order
        )
    );
$$;

create or replace function private.is_inquiry_organizer(p_inquiry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.inquiries inquiry
      where inquiry.id = p_inquiry_id
        and inquiry.organizer_account_id = (select auth.uid())
    );
$$;

create or replace function private.normalize_market_value(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
    regexp_replace(trim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g')
  );
$$;

create or replace function public.sync_instructor_profile_service_market()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.city is distinct from old.city
      or new.region is distinct from old.region
    ) then
    delete from public.instructor_service_markets mapping
    where mapping.instructor_profile_id = new.id
      and mapping.source = 'profile_city';
  end if;

  if nullif(trim(new.city), '') is not null
    and nullif(trim(new.region), '') is not null then
    insert into public.instructor_service_markets (
      instructor_profile_id,
      service_market_slug,
      source
    )
    select
      new.id,
      locality.service_market_slug,
      'profile_city'
    from public.service_market_localities locality
    where locality.city_normalized = private.normalize_market_value(new.city)
      and locality.region_normalized = private.normalize_market_value(new.region)
    on conflict (instructor_profile_id, service_market_slug) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_instructor_profile_service_market
  on public.instructor_profiles;
create trigger sync_instructor_profile_service_market
  after insert or update of city, region on public.instructor_profiles
  for each row execute function public.sync_instructor_profile_service_market();

create or replace function public.protect_inquiry_message_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Allow a parent inquiry/thread cascade to satisfy the platform's account and
  -- retention deletion paths. Direct message mutation remains prohibited.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Inquiry messages are immutable';
end;
$$;

drop trigger if exists protect_inquiry_message_immutability
  on public.inquiry_messages;
create trigger protect_inquiry_message_immutability
  before update or delete on public.inquiry_messages
  for each row execute function public.protect_inquiry_message_immutability();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_markets',
    'instructor_service_markets',
    'inquiry_threads',
    'inquiry_thread_participants'
  ] loop
    execute format(
      'create trigger set_%I_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

-- Preserve the existing feedback RPC while authorizing the instructor on the
-- current contact-attempt thread. The organizer-level inquiry continues to
-- retain its originally selected instructor for compatibility.
create or replace function public.submit_instructor_inquiry_feedback(
  p_inquiry_id uuid,
  p_stage text,
  p_response text,
  p_private_comment text default null,
  p_confirmed_event_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inquiry public.inquiries%rowtype;
  profile public.instructor_profiles%rowtype;
  resolved_outcome text;
  resolved_event_date date;
  resolved_time_zone text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_stage not in ('booking', 'completion') then
    raise exception 'Invalid feedback stage';
  end if;
  if char_length(coalesce(p_private_comment, '')) > 2000 then
    raise exception 'Comments must be 2,000 characters or fewer';
  end if;

  select * into inquiry
  from public.inquiries
  where id = p_inquiry_id
  for update;
  if inquiry.id is null then
    raise exception 'Inquiry not found';
  end if;

  select instructor_profile.* into profile
  from public.inquiry_threads thread
  join public.inquiry_thread_participants participant
    on participant.thread_id = thread.id
   and participant.participant_role = 'instructor'
   and participant.left_at is null
  join public.instructor_profiles instructor_profile
    on instructor_profile.id = thread.instructor_profile_id
  where thread.inquiry_id = inquiry.id
    and participant.account_id = (select auth.uid())
    and thread.status in ('awaiting_response', 'active', 'closed')
    and not exists (
      select 1
      from public.inquiry_threads newer_thread
      where newer_thread.inquiry_id = inquiry.id
        and newer_thread.assignment_order > thread.assignment_order
        and newer_thread.status in ('awaiting_response', 'active', 'closed')
    )
  order by thread.assignment_order desc
  limit 1;

  if profile.id is null then
    raise exception 'Only the currently contacted instructor can submit this feedback';
  end if;

  if p_stage = 'booking' then
    if inquiry.completion_status <> 'unknown' then
      raise exception 'Booking details cannot be changed after event completion is recorded';
    end if;
    if p_response not in ('booked', 'not_booked', 'still_deciding') then
      raise exception 'Choose Yes, No, or In progress';
    end if;
    resolved_event_date := coalesce(
      p_confirmed_event_date,
      inquiry.booking_event_date,
      inquiry.event_date
    );
    if p_response = 'booked' and resolved_event_date is null then
      raise exception 'Confirm the event date for this booking';
    end if;

    insert into public.inquiry_followup_responses (
      inquiry_id,
      instructor_account_id,
      stage,
      response,
      confirmed_event_date,
      private_comment
    ) values (
      inquiry.id,
      (select auth.uid()),
      'booking',
      p_response,
      case when p_response = 'booked' then resolved_event_date end,
      nullif(trim(p_private_comment), '')
    )
    on conflict (inquiry_id, instructor_account_id, stage) do update set
      response = excluded.response,
      confirmed_event_date = excluded.confirmed_event_date,
      private_comment = excluded.private_comment,
      submitted_at = now(),
      updated_at = now();

    insert into public.inquiry_outcome_reports (
      inquiry_id,
      reporter_account_id,
      outcome,
      booking_value_cents,
      note
    ) values (
      inquiry.id,
      (select auth.uid()),
      p_response,
      null,
      null
    )
    on conflict (inquiry_id, reporter_account_id) do update set
      outcome = excluded.outcome,
      note = null,
      updated_at = now();

    select case
      when bool_or(outcome = 'booked') and bool_or(outcome = 'not_booked')
        then 'disputed'
      when bool_or(outcome = 'booked') then 'booked'
      when bool_or(outcome = 'not_booked') then 'not_booked'
      when bool_or(outcome = 'still_deciding') then 'still_deciding'
      else 'no_response'
    end
    into resolved_outcome
    from public.inquiry_outcome_reports
    where inquiry_id = inquiry.id;

    update public.inquiries
    set booking_outcome = resolved_outcome,
        booking_event_date = case
          when p_response = 'booked' then resolved_event_date
          else booking_event_date
        end,
        outcome_reported_by = (select auth.uid()),
        outcome_reported_at = now(),
        outcome_next_ask_at = null,
        status = case
          when resolved_outcome = 'booked' then 'booked'
          when resolved_outcome = 'not_booked' then 'not_booked'
          when status in ('booked', 'not_booked') and first_responded_at is not null
            then 'responded'
          when status in ('booked', 'not_booked') then 'submitted'
          else status
        end,
        closed_at = case
          when resolved_outcome in ('booked', 'not_booked') then now()
          else null
        end,
        updated_at = now()
    where id = inquiry.id;

    update public.inquiry_notification_jobs job
    set status = 'canceled',
        completed_at = now(),
        locked_at = null,
        last_error = 'Follow-up answered before delivery'
    from public.inquiry_recipients recipient
    where job.inquiry_recipient_id = recipient.id
      and recipient.inquiry_id = inquiry.id
      and job.notification_type = 'booking_followup'
      and job.status = 'pending';
  else
    if p_response not in ('completed', 'did_not_happen') then
      raise exception 'Choose Yes or No';
    end if;
    if inquiry.booking_outcome <> 'booked' then
      raise exception 'Record this inquiry as booked before reporting whether the event happened';
    end if;
    resolved_event_date := coalesce(inquiry.booking_event_date, inquiry.event_date);
    select timezone.name into resolved_time_zone
    from pg_catalog.pg_timezone_names timezone
    where timezone.name = inquiry.time_zone
    limit 1;
    resolved_time_zone := coalesce(resolved_time_zone, 'America/New_York');
    if resolved_event_date is not null
      and resolved_event_date > (now() at time zone resolved_time_zone)::date then
      raise exception 'The event date has not arrived yet';
    end if;

    insert into public.inquiry_followup_responses (
      inquiry_id,
      instructor_account_id,
      stage,
      response,
      confirmed_event_date,
      private_comment
    ) values (
      inquiry.id,
      (select auth.uid()),
      'completion',
      p_response,
      resolved_event_date,
      nullif(trim(p_private_comment), '')
    )
    on conflict (inquiry_id, instructor_account_id, stage) do update set
      response = excluded.response,
      confirmed_event_date = excluded.confirmed_event_date,
      private_comment = excluded.private_comment,
      submitted_at = now(),
      updated_at = now();

    update public.inquiries
    set completion_status = p_response,
        completion_reported_at = now(),
        completion_reported_by = (select auth.uid()),
        completion_next_ask_at = null,
        updated_at = now()
    where id = inquiry.id;

    update public.inquiry_notification_jobs job
    set status = 'canceled',
        completed_at = now(),
        locked_at = null,
        last_error = 'Follow-up answered before delivery'
    from public.inquiry_recipients recipient
    where job.inquiry_recipient_id = recipient.id
      and recipient.inquiry_id = inquiry.id
      and job.notification_type = 'completion_followup'
      and job.status = 'pending';
  end if;
end;
$$;

create or replace function public.guarantee_qualifying_booking_count(
  p_instructor_profile_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct inquiry.id)::integer
  from public.inquiries inquiry
  join public.instructor_profiles profile
    on profile.id = coalesce(
      inquiry.booked_instructor_profile_id,
      inquiry.instructor_profile_id
    )
  join public.instructor_guarantees guarantee_record
    on guarantee_record.instructor_profile_id = profile.id
  join public.inquiry_outcome_reports report
    on report.inquiry_id = inquiry.id
   and report.reporter_account_id = profile.account_id
   and report.outcome = 'booked'
  where profile.id = p_instructor_profile_id
    and (
      guarantee_record.guarantee_terms_version <>
        '2026-08-07-90-day-paid-invoice-v1'
      or (
        guarantee_record.guarantee_started_at is not null
        and guarantee_record.guarantee_ends_at is not null
        and report.booked_first_reported_at >=
          guarantee_record.guarantee_started_at
        and report.booked_first_reported_at <
          guarantee_record.guarantee_ends_at
      )
    );
$$;

create or replace function public.mark_guarantee_fulfilled_by_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  evidence_at timestamptz;
  booked_profile_id uuid := coalesce(
    new.booked_instructor_profile_id,
    new.instructor_profile_id
  );
begin
  if booked_profile_id is null or new.booking_outcome <> 'booked' then
    return new;
  end if;

  select min(report.booked_first_reported_at) into evidence_at
  from public.inquiry_outcome_reports report
  join public.instructor_profiles profile
    on profile.account_id = report.reporter_account_id
  join public.instructor_guarantees guarantee_record
    on guarantee_record.instructor_profile_id = profile.id
  where report.inquiry_id = new.id
    and profile.id = booked_profile_id
    and report.outcome = 'booked'
    and (
      guarantee_record.guarantee_terms_version <>
        '2026-08-07-90-day-paid-invoice-v1'
      or (
        guarantee_record.guarantee_started_at is not null
        and guarantee_record.guarantee_ends_at is not null
        and report.booked_first_reported_at >=
          guarantee_record.guarantee_started_at
        and report.booked_first_reported_at <
          guarantee_record.guarantee_ends_at
      )
    );

  if evidence_at is null then
    return new;
  end if;

  update public.instructor_guarantees
  set guarantee_status = 'fulfilled',
      coverage_issue_at = evidence_at,
      coverage_issue_reason =
        'Hire Line Dancers inquiry reported as booked'
  where instructor_profile_id = booked_profile_id
    and guarantee_status in (
      'covered', 'claim_eligible', 'claim_received', 'under_review'
    );

  if found then
    insert into public.membership_admin_events (
      instructor_profile_id,
      event_type,
      detail
    ) values (
      booked_profile_id,
      'guarantee_fulfilled',
      jsonb_build_object(
        'inquiry_id', new.id,
        'qualifying_evidence_at', evidence_at
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.enqueue_due_inquiry_followups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking_count integer := 0;
  completion_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;

  with expected as (
    select
      inquiry.id as inquiry_id,
      current_thread.inquiry_recipient_id as booking_recipient_id,
      booked_thread.inquiry_recipient_id as completion_recipient_id,
      inquiry.booking_outcome,
      inquiry.completion_status,
      inquiry.completion_next_ask_at
    from public.inquiries inquiry
    left join lateral (
      select thread.inquiry_recipient_id
      from public.inquiry_threads thread
      where thread.inquiry_id = inquiry.id
        and thread.instructor_profile_id is not null
        and thread.status in ('awaiting_response', 'active', 'closed')
      order by thread.assignment_order desc
      limit 1
    ) current_thread on true
    left join lateral (
      select thread.inquiry_recipient_id
      from public.inquiry_threads thread
      where thread.inquiry_id = inquiry.id
        and thread.instructor_profile_id = coalesce(
          inquiry.booked_instructor_profile_id,
          inquiry.instructor_profile_id
        )
        and thread.status in ('awaiting_response', 'active', 'closed')
      order by thread.assignment_order desc
      limit 1
    ) booked_thread on true
  )
  update public.inquiry_notification_jobs job
  set status = 'canceled',
      completed_at = now(),
      locked_at = null,
      last_error = 'Follow-up is no longer needed'
  from public.inquiry_recipients recipient
  join expected on expected.inquiry_id = recipient.inquiry_id
  where job.inquiry_recipient_id = recipient.id
    and job.status = 'pending'
    and (
      (
        job.notification_type = 'booking_followup'
        and (
          recipient.id is distinct from expected.booking_recipient_id
          or exists (
            select 1
            from public.inquiry_outcome_reports report
            join public.instructor_profiles profile
              on profile.account_id = report.reporter_account_id
            where report.inquiry_id = expected.inquiry_id
              and profile.id = recipient.instructor_profile_id
          )
        )
      )
      or (
        job.notification_type = 'completion_followup'
        and (
          recipient.id is distinct from expected.completion_recipient_id
          or expected.booking_outcome <> 'booked'
          or expected.completion_status <> 'unknown'
          or expected.completion_next_ask_at is null
          or expected.completion_next_ask_at > now()
        )
      )
    );

  insert into public.inquiry_notification_jobs (
    inquiry_recipient_id,
    channel,
    notification_type,
    available_at
  )
  select recipient.id, 'email', 'booking_followup', now()
  from public.inquiries inquiry
  join lateral (
    select thread.inquiry_recipient_id
    from public.inquiry_threads thread
    where thread.inquiry_id = inquiry.id
      and thread.instructor_profile_id is not null
      and thread.status in ('awaiting_response', 'active', 'closed')
    order by thread.assignment_order desc
    limit 1
  ) current_thread on true
  join public.inquiry_recipients recipient
    on recipient.id = current_thread.inquiry_recipient_id
  join public.instructor_profiles profile
    on profile.id = recipient.instructor_profile_id
  where inquiry.outcome_next_ask_at is not null
    and inquiry.outcome_next_ask_at <= now()
    and not exists (
      select 1
      from public.inquiry_outcome_reports report
      where report.inquiry_id = inquiry.id
        and report.reporter_account_id = profile.account_id
    )
  on conflict (inquiry_recipient_id, channel, notification_type) do update set
    status = 'pending',
    available_at = excluded.available_at,
    attempts = 0,
    locked_at = null,
    completed_at = null,
    last_error = null
  where public.inquiry_notification_jobs.status = 'canceled';
  get diagnostics booking_count = row_count;

  insert into public.inquiry_notification_jobs (
    inquiry_recipient_id,
    channel,
    notification_type,
    available_at
  )
  select recipient.id, 'email', 'completion_followup', now()
  from public.inquiries inquiry
  join lateral (
    select thread.inquiry_recipient_id
    from public.inquiry_threads thread
    where thread.inquiry_id = inquiry.id
      and thread.instructor_profile_id = coalesce(
        inquiry.booked_instructor_profile_id,
        inquiry.instructor_profile_id
      )
      and thread.status in ('awaiting_response', 'active', 'closed')
    order by thread.assignment_order desc
    limit 1
  ) booked_thread on true
  join public.inquiry_recipients recipient
    on recipient.id = booked_thread.inquiry_recipient_id
  where inquiry.booking_outcome = 'booked'
    and inquiry.completion_status = 'unknown'
    and inquiry.completion_next_ask_at is not null
    and inquiry.completion_next_ask_at <= now()
  on conflict (inquiry_recipient_id, channel, notification_type) do update set
    status = 'pending',
    available_at = excluded.available_at,
    attempts = 0,
    locked_at = null,
    completed_at = null,
    last_error = null
  where public.inquiry_notification_jobs.status = 'canceled';
  get diagnostics completion_count = row_count;

  return booking_count + completion_count;
end;
$$;

alter function public.get_marketplace_admin_analytics(
  timestamptz, timestamptz, text, text
) rename to get_marketplace_admin_analytics_before_threading;

revoke all on function public.get_marketplace_admin_analytics_before_threading(
  timestamptz, timestamptz, text, text
) from public, anon, authenticated, service_role;

create function public.get_marketplace_admin_analytics(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_bucket text default 'day',
  p_time_zone text default 'America/New_York'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  instructor_result jsonb;
  instructor_company_result jsonb;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;

  base_result := public.get_marketplace_admin_analytics_before_threading(
    p_start,
    p_end,
    p_bucket,
    p_time_zone
  );

  with effective as (
    select
      inquiry.*,
      case
        when inquiry.booking_outcome = 'booked'
          or inquiry.completion_status <> 'unknown' then coalesce(
            inquiry.booked_instructor_profile_id,
            inquiry.instructor_profile_id
          )
        else inquiry.instructor_profile_id
      end as effective_instructor_profile_id
    from public.inquiries inquiry
    where (p_start is null or inquiry.created_at >= p_start)
      and (p_end is null or inquiry.created_at < p_end)
  ), instructor_rows as (
    select
      coalesce(
        effective.effective_instructor_profile_id::text,
        effective.instructor_slug,
        'unknown'
      ) as instructor_key,
      coalesce(
        profile.display_name,
        max(effective.instructor_name),
        'Unknown instructor'
      ) as instructor_name,
      count(*)::integer as inquiries,
      count(distinct coalesce(
        'company:' || lower(nullif(trim(effective.company_name), '')),
        'account:' || effective.organizer_account_id::text
      ))::integer as companies,
      count(*) filter (where effective.booking_outcome = 'booked')::integer as booked,
      count(*) filter (where effective.completion_status = 'completed')::integer as completed,
      max(effective.created_at) as latest_inquiry_at
    from effective
    left join public.instructor_profiles profile
      on profile.id = effective.effective_instructor_profile_id
    group by
      coalesce(
        effective.effective_instructor_profile_id::text,
        effective.instructor_slug,
        'unknown'
      ),
      profile.display_name
  )
  select coalesce(
    jsonb_agg(
      to_jsonb(instructor_rows)
      order by inquiries desc, instructor_name
    ),
    '[]'::jsonb
  ) into instructor_result
  from instructor_rows;

  with effective as (
    select
      inquiry.*,
      case
        when inquiry.booking_outcome = 'booked'
          or inquiry.completion_status <> 'unknown' then coalesce(
            inquiry.booked_instructor_profile_id,
            inquiry.instructor_profile_id
          )
        else inquiry.instructor_profile_id
      end as effective_instructor_profile_id
    from public.inquiries inquiry
    where (p_start is null or inquiry.created_at >= p_start)
      and (p_end is null or inquiry.created_at < p_end)
  ), instructor_company_rows as (
    select
      coalesce(
        effective.effective_instructor_profile_id::text,
        effective.instructor_slug,
        'unknown'
      ) as instructor_key,
      coalesce(
        profile.display_name,
        max(effective.instructor_name),
        'Unknown instructor'
      ) as instructor_name,
      coalesce(
        'company:' || lower(nullif(trim(effective.company_name), '')),
        'account:' || effective.organizer_account_id::text
      ) as company_key,
      coalesce(
        max(nullif(trim(effective.company_name), '')),
        max(nullif(trim(effective.contact_name), '')),
        'Individual organizer'
      ) as company_name,
      max(effective.contact_email) as contact_email,
      count(*)::integer as inquiries,
      count(*) filter (where effective.booking_outcome = 'booked')::integer as booked,
      count(*) filter (where effective.completion_status = 'completed')::integer as completed,
      max(effective.created_at) as latest_inquiry_at
    from effective
    left join public.instructor_profiles profile
      on profile.id = effective.effective_instructor_profile_id
    group by
      coalesce(
        effective.effective_instructor_profile_id::text,
        effective.instructor_slug,
        'unknown'
      ),
      profile.display_name,
      coalesce(
        'company:' || lower(nullif(trim(effective.company_name), '')),
        'account:' || effective.organizer_account_id::text
      )
  )
  select coalesce(
    jsonb_agg(
      to_jsonb(instructor_company_rows)
      order by inquiries desc, instructor_name, company_name
    ),
    '[]'::jsonb
  ) into instructor_company_result
  from instructor_company_rows;

  return base_result || jsonb_build_object(
    'instructors', instructor_result,
    'instructor_companies', instructor_company_result
  );
end;
$$;

revoke all on function public.get_marketplace_admin_analytics(
  timestamptz, timestamptz, text, text
) from public, anon, service_role;
grant execute on function public.get_marketplace_admin_analytics(
  timestamptz, timestamptz, text, text
) to authenticated;

create or replace function private.start_inquiry_thread_response_clock(
  p_thread_id uuid,
  p_started_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread public.inquiry_threads%rowtype;
  instructor_email text;
  organizer_email text;
  reminders_enabled boolean := true;
  started_at timestamptz := coalesce(p_started_at, now());
begin
  select * into thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;

  if thread.id is null
    or thread.instructor_account_id is null
    or thread.status <> 'awaiting_response'
    or thread.first_instructor_message_at is not null then
    return;
  end if;

  if thread.response_clock_started_at is null then
    update public.inquiry_threads
    set response_clock_started_at = started_at,
        response_due_at = started_at + interval '72 hours',
        updated_at = now()
    where id = thread.id;
  else
    started_at := thread.response_clock_started_at;
  end if;

  select
    coalesce(settings.inquiry_email, account.email),
    coalesce(settings.response_reminders_enabled, true)
  into instructor_email, reminders_enabled
  from public.accounts account
  left join public.instructor_private_settings settings
    on settings.instructor_profile_id = thread.instructor_profile_id
  where account.id = thread.instructor_account_id;

  select coalesce(account.email, inquiry.contact_email, inquiry.email)
  into organizer_email
  from public.inquiries inquiry
  left join public.accounts account on account.id = inquiry.organizer_account_id
  where inquiry.id = thread.inquiry_id;

  if reminders_enabled and instructor_email is not null then
    insert into public.inquiry_thread_notification_jobs (
      thread_id,
      inquiry_recipient_id,
      recipient_account_id,
      recipient_email,
      notification_type,
      available_at,
      dedupe_key
    ) values
      (
        thread.id,
        thread.inquiry_recipient_id,
        thread.instructor_account_id,
        instructor_email,
        'response_reminder_24',
        started_at + interval '24 hours',
        'thread:' || thread.id::text || ':response-reminder-24'
      ),
      (
        thread.id,
        thread.inquiry_recipient_id,
        thread.instructor_account_id,
        instructor_email,
        'response_reminder_48',
        started_at + interval '48 hours',
        'thread:' || thread.id::text || ':response-reminder-48'
      )
    on conflict (dedupe_key) do nothing;
  end if;

  if instructor_email is not null then
    insert into public.inquiry_thread_notification_jobs (
      thread_id,
      inquiry_recipient_id,
      recipient_account_id,
      recipient_email,
      notification_type,
      available_at,
      dedupe_key
    ) values (
      thread.id,
      thread.inquiry_recipient_id,
      thread.instructor_account_id,
      instructor_email,
      'response_timeout_instructor',
      started_at + interval '72 hours',
      'thread:' || thread.id::text || ':response-timeout-instructor'
    )
    on conflict (dedupe_key) do nothing;
  end if;

  if organizer_email is not null then
    insert into public.inquiry_thread_notification_jobs (
      thread_id,
      inquiry_recipient_id,
      recipient_account_id,
      recipient_email,
      notification_type,
      available_at,
      dedupe_key
    )
    select
      thread.id,
      thread.inquiry_recipient_id,
      inquiry.organizer_account_id,
      organizer_email,
      'response_timeout_organizer',
      started_at + interval '72 hours',
      'thread:' || thread.id::text || ':response-timeout-organizer'
    from public.inquiries inquiry
    where inquiry.id = thread.inquiry_id
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;

create or replace function private.cancel_inquiry_thread_response_jobs(
  p_thread_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  canceled_count integer;
begin
  update public.inquiry_thread_notification_jobs
  set status = 'canceled',
      completed_at = now(),
      locked_at = null,
      last_error = left(coalesce(p_reason, 'Instructor responded'), 2000)
  where thread_id = p_thread_id
    and status = 'pending'
    and notification_type in (
      'response_reminder_24',
      'response_reminder_48',
      'response_timeout_instructor',
      'response_timeout_organizer'
    );
  get diagnostics canceled_count = row_count;
  return canceled_count;
end;
$$;

-- Continue response tracking for pre-migration inquiries only when their
-- original email delivery is known. Recent deliveries keep their original
-- 72-hour deadline, but missed 24/48-hour milestones are not sent in a burst.
do $$
declare
  existing_delivery record;
begin
  for existing_delivery in
    select
      thread.id as thread_id,
      max(job.sent_at) as sent_at
    from public.inquiry_threads thread
    join public.inquiry_notification_jobs job
      on job.inquiry_recipient_id = thread.inquiry_recipient_id
    where thread.assignment_source = 'legacy'
      and thread.status = 'awaiting_response'
      and thread.first_instructor_message_at is null
      and job.channel = 'email'
      and job.notification_type = 'new_inquiry'
      and job.status = 'sent'
      and job.sent_at > now() - interval '72 hours'
    group by thread.id
  loop
    perform private.start_inquiry_thread_response_clock(
      existing_delivery.thread_id,
      existing_delivery.sent_at
    );
  end loop;
end;
$$;

update public.inquiry_thread_notification_jobs job
set status = 'canceled',
    completed_at = now(),
    locked_at = null,
    last_error = 'Past reminder was not replayed during messaging migration'
from public.inquiry_threads thread
where thread.id = job.thread_id
  and thread.assignment_source = 'legacy'
  and job.status = 'pending'
  and job.notification_type in ('response_reminder_24', 'response_reminder_48')
  and job.available_at <= now();

-- Stale delivered inquiries become visible as timed out without sending
-- retroactive reminder or timeout emails. Pending legacy delivery jobs remain
-- clockless until their existing delivery worker confirms the first email.
with sent_deliveries as (
  select
    thread.id as thread_id,
    thread.inquiry_id,
    thread.instructor_profile_id,
    max(job.sent_at) as sent_at
  from public.inquiry_threads thread
  join public.inquiry_notification_jobs job
    on job.inquiry_recipient_id = thread.inquiry_recipient_id
  where thread.assignment_source = 'legacy'
    and thread.status = 'awaiting_response'
    and thread.first_instructor_message_at is null
    and job.channel = 'email'
    and job.notification_type = 'new_inquiry'
    and job.status = 'sent'
    and job.sent_at <= now() - interval '72 hours'
  group by thread.id, thread.inquiry_id, thread.instructor_profile_id
), transitioned as (
  update public.inquiry_threads thread
  set status = 'timed_out',
      response_clock_started_at = delivery.sent_at,
      response_due_at = delivery.sent_at + interval '72 hours',
      timed_out_at = now(),
      fallback_review_requested_at = now(),
      closed_at = coalesce(thread.closed_at, now()),
      updated_at = now()
  from sent_deliveries delivery
  where thread.id = delivery.thread_id
  returning thread.id, thread.inquiry_id, thread.instructor_profile_id
)
insert into public.inquiry_routing_events (
  inquiry_id,
  thread_id,
  candidate_instructor_profile_id,
  event_type,
  dedupe_key
)
select
  transitioned.inquiry_id,
  transitioned.id,
  transitioned.instructor_profile_id,
  'fallback_review_requested',
  'thread:' || transitioned.id::text || ':fallback-review-requested'
from transitioned
on conflict (dedupe_key) do nothing;

create or replace function public.create_inquiry_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_id uuid;
  created_thread_id uuid;
  initial_message_id bigint;
  delivery_email text;
  instructor_account_id uuid;
  assignment_source text;
begin
  if new.instructor_profile_id is null then
    delivery_email := 'hello@hirelinedancers.com';
    assignment_source := 'static_support';
  else
    select
      coalesce(settings.inquiry_email, account.email),
      profile.account_id
    into delivery_email, instructor_account_id
    from public.instructor_profiles profile
    join public.accounts account on account.id = profile.account_id
    left join public.instructor_private_settings settings
      on settings.instructor_profile_id = profile.id
    where profile.id = new.instructor_profile_id;
    assignment_source := 'organizer_selected';
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
    null,
    'not_requested'
  ) returning id into recipient_id;

  insert into public.inquiry_threads (
    inquiry_id,
    inquiry_recipient_id,
    instructor_profile_id,
    instructor_account_id,
    assignment_order,
    assignment_source,
    status,
    assigned_at,
    last_message_at,
    created_by
  ) values (
    new.id,
    recipient_id,
    new.instructor_profile_id,
    instructor_account_id,
    1,
    assignment_source,
    'awaiting_response',
    now(),
    now(),
    new.organizer_account_id
  ) returning id into created_thread_id;

  insert into public.inquiry_thread_participants (
    thread_id,
    account_id,
    participant_role,
    last_read_at
  ) values (
    created_thread_id,
    new.organizer_account_id,
    'organizer',
    now()
  );

  if instructor_account_id is not null then
    insert into public.inquiry_thread_participants (
      thread_id,
      account_id,
      participant_role
    ) values (
      created_thread_id,
      instructor_account_id,
      'instructor'
    );
  end if;

  insert into public.inquiry_messages (
    thread_id,
    sender_account_id,
    message_kind,
    body
  ) values (
    created_thread_id,
    new.organizer_account_id,
    'inquiry',
    coalesce(new.message, '')
  ) returning id into initial_message_id;

  update public.inquiry_threads
  set last_message_id = initial_message_id,
      last_message_at = now(),
      updated_at = now()
  where id = created_thread_id;

  update public.inquiry_thread_participants
  set last_read_message_id = initial_message_id,
      updated_at = now()
  where inquiry_thread_participants.thread_id = created_thread_id
    and account_id = new.organizer_account_id;

  insert into public.inquiry_thread_notification_jobs (
    thread_id,
    inquiry_recipient_id,
    message_id,
    recipient_account_id,
    recipient_email,
    notification_type,
    dedupe_key
  ) values (
    created_thread_id,
    recipient_id,
    initial_message_id,
    instructor_account_id,
    delivery_email,
    'new_thread',
    'thread:' || created_thread_id::text || ':new-thread'
  );

  return new;
end;
$$;

drop trigger if exists create_inquiry_delivery on public.inquiries;
create trigger create_inquiry_delivery
  after insert on public.inquiries
  for each row execute function public.create_inquiry_delivery();

drop function if exists public.submit_inquiry(
  uuid, text, date, time, text, text, text, text, text, integer,
  text, text, boolean, boolean, text, text
);

create function public.submit_inquiry(
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
  p_instructor_slug text default null,
  p_fallback_consent boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.accounts%rowtype;
  instructor public.instructor_profiles%rowtype;
  static_instructor public.directory_instructor_targets%rowtype;
  inquiry_id uuid;
  location_label text;
  target_profile_id uuid;
  target_slug text;
  target_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select * into account
  from public.accounts
  where id = (select auth.uid())
  for update;

  if account.id is null
    or (
      account.role is distinct from 'organizer'
      and not public.is_marketplace_admin()
    ) then
    raise exception 'Complete organizer onboarding before contacting an instructor';
  end if;
  if nullif(trim(account.full_name), '') is null
    or nullif(trim(account.email), '') is null then
    raise exception 'Complete your organizer contact information first';
  end if;

  if p_instructor_profile_id is not null then
    select * into instructor
    from public.instructor_profiles
    where id = p_instructor_profile_id
      and status = 'published';
    if instructor.id is null then
      raise exception 'Instructor is not available for inquiries';
    end if;
    target_profile_id := instructor.id;
    target_slug := instructor.slug;
    target_name := instructor.display_name;
  else
    select * into static_instructor
    from public.directory_instructor_targets
    where slug = p_instructor_slug
      and active;
    if static_instructor.slug is null then
      raise exception 'Instructor is not available for inquiries';
    end if;
    if static_instructor.claimed_profile_id is not null then
      select * into instructor
      from public.instructor_profiles
      where id = static_instructor.claimed_profile_id
        and status = 'published';
      if instructor.id is not null then
        target_profile_id := instructor.id;
      end if;
    end if;
    target_slug := static_instructor.slug;
    target_name := static_instructor.display_name;
  end if;

  if nullif(trim(p_event_type), '') is null then
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
  if nullif(trim(p_event_city), '') is null
    or nullif(trim(p_event_region), '') is null then
    raise exception 'Event city and state are required';
  end if;
  if p_guest_count is not null
    and (p_guest_count < 1 or p_guest_count > 10000) then
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

  location_label := concat_ws(
    ', ',
    nullif(trim(p_event_city), ''),
    nullif(trim(p_event_region), '')
  );

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
    outcome_next_ask_at,
    fallback_consent,
    fallback_consent_at
  ) values (
    (select auth.uid()),
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
    current_date + 3,
    p_event_date + 2,
    coalesce(p_fallback_consent, false),
    case when coalesce(p_fallback_consent, false) then now() end
  ) returning id into inquiry_id;

  return inquiry_id;
end;
$$;

create or replace function public.get_inquiry_primary_thread(p_inquiry_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_marketplace_admin()
    and not exists (
      select 1
      from public.inquiry_threads thread
      join public.inquiry_thread_participants participant
        on participant.thread_id = thread.id
      where thread.inquiry_id = p_inquiry_id
        and participant.account_id = (select auth.uid())
        and participant.left_at is null
    ) then
    raise exception 'Inquiry not found or access denied';
  end if;

  select thread.id into result
  from public.inquiry_threads thread
  where thread.inquiry_id = p_inquiry_id
    and (
      public.is_marketplace_admin()
      or exists (
        select 1
        from public.inquiry_thread_participants participant
        where participant.thread_id = thread.id
          and participant.account_id = (select auth.uid())
          and participant.left_at is null
      )
    )
  order by thread.assignment_order
  limit 1;

  if result is null then
    raise exception 'Inquiry thread not found';
  end if;
  return result;
end;
$$;

create or replace function public.list_inquiry_threads(
  p_search text default null,
  p_filter text default 'all',
  p_sort text default 'recent',
  p_limit integer default 50,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_admin boolean default false
)
returns table (
  thread_id uuid,
  inquiry_id uuid,
  thread_status text,
  assignment_order smallint,
  counterparty_name text,
  counterparty_profile_slug text,
  event_type text,
  event_date date,
  event_city text,
  event_region text,
  unread_count bigint,
  response_due_at timestamptz,
  last_message_id bigint,
  last_message_body text,
  last_message_at timestamptz,
  last_message_sender_account_id uuid,
  next_cursor_at timestamptz,
  next_cursor_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  include_admin boolean;
  clean_search text := nullif(trim(coalesce(p_search, '')), '');
  resolved_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_filter not in ('all', 'unread', 'needs_reply', 'active', 'closed') then
    raise exception 'Invalid inquiry filter';
  end if;
  if p_sort not in ('recent', 'oldest', 'oldest_waiting', 'event_date') then
    raise exception 'Invalid inquiry sort';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Both cursor values are required';
  end if;

  include_admin := coalesce(p_admin, false) and public.is_marketplace_admin();

  return query
  with search_input as (
    select case
      when clean_search is null then null::tsquery
      else websearch_to_tsquery('simple'::regconfig, clean_search)
    end as query
  ), visible as (
    select
      thread.*,
      inquiry.event_type,
      inquiry.event_date,
      inquiry.event_city,
      inquiry.event_region,
      inquiry.contact_name,
      inquiry.name as legacy_contact_name,
      inquiry.instructor_name,
      inquiry.messaging_search_vector,
      profile.display_name as profile_display_name,
      profile.slug as profile_slug,
      participant.participant_role as caller_role,
      last_message.body as last_body,
      last_message.sender_account_id as last_sender,
      coalesce(last_message.created_at, thread.last_message_at, thread.assigned_at) as activity_at,
      case
        when p_sort in ('oldest', 'oldest_waiting') then coalesce(
          thread.response_due_at,
          thread.assigned_at + interval '72 hours'
        )
        when p_sort = 'event_date' then inquiry.event_date::timestamp at time zone 'UTC'
        else coalesce(last_message.created_at, thread.last_message_at, thread.assigned_at)
      end as sort_at,
      case
        when include_admin then 0::bigint
        else (
          select count(*)
          from public.inquiry_messages unread_message
          where unread_message.thread_id = thread.id
            and unread_message.id > coalesce(participant.last_read_message_id, 0)
            and unread_message.sender_account_id is distinct from caller_id
        )
      end as unread_total
    from public.inquiry_threads thread
    join public.inquiries inquiry on inquiry.id = thread.inquiry_id
    left join public.instructor_profiles profile
      on profile.id = thread.instructor_profile_id
    left join public.inquiry_thread_participants participant
      on participant.thread_id = thread.id
     and participant.account_id = caller_id
     and participant.left_at is null
    left join lateral (
      select message.id, message.body, message.sender_account_id, message.created_at
      from public.inquiry_messages message
      where message.thread_id = thread.id
      order by message.id desc
      limit 1
    ) last_message on true
    cross join search_input
    where (include_admin or participant.account_id is not null)
      and (
        clean_search is null
        or inquiry.messaging_search_vector @@ search_input.query
        or to_tsvector(
          'simple'::regconfig,
          coalesce(profile.display_name, '') || ' ' || coalesce(profile.slug, '')
        ) @@ search_input.query
        or exists (
          select 1
          from public.inquiry_messages matching_message
          where matching_message.thread_id = thread.id
            and matching_message.search_vector @@ search_input.query
        )
      )
  ), filtered as (
    select visible.*
    from visible
    where case p_filter
      when 'unread' then visible.unread_total > 0
      when 'needs_reply' then
        visible.status = 'awaiting_response'
        and (include_admin or visible.caller_role = 'instructor')
      when 'active' then visible.status in ('awaiting_response', 'active')
      when 'closed' then visible.status in ('declined', 'timed_out', 'withdrawn', 'closed')
      else true
    end
      and (
        p_cursor_at is null
        or (
          p_sort = 'recent'
          and (visible.sort_at, visible.id) < (p_cursor_at, p_cursor_id)
        )
        or (
          p_sort in ('oldest', 'oldest_waiting', 'event_date')
          and (visible.sort_at, visible.id) > (p_cursor_at, p_cursor_id)
        )
      )
  )
  select
    filtered.id,
    filtered.inquiry_id,
    filtered.status,
    filtered.assignment_order,
    case
      when filtered.caller_role = 'instructor' then
        coalesce(filtered.contact_name, filtered.legacy_contact_name, 'Organizer')
      else coalesce(
        filtered.profile_display_name,
        filtered.instructor_name,
        'Hire Line Dancers'
      )
    end,
    filtered.profile_slug,
    filtered.event_type,
    filtered.event_date,
    filtered.event_city,
    filtered.event_region,
    filtered.unread_total,
    filtered.response_due_at,
    filtered.last_message_id,
    filtered.last_body,
    filtered.activity_at,
    filtered.last_sender,
    filtered.sort_at,
    filtered.id
  from filtered
  order by
    case when p_sort = 'recent' then filtered.sort_at end desc nulls last,
    case when p_sort in ('oldest', 'oldest_waiting') then filtered.sort_at end asc nulls last,
    case when p_sort = 'event_date' then filtered.sort_at end asc nulls last,
    case when p_sort = 'recent' then filtered.id end desc,
    filtered.id asc
  limit resolved_limit;
end;
$$;

create or replace function public.get_inquiry_thread(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  is_admin boolean;
  caller_role text;
  is_current_assignment boolean := true;
  result jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  is_admin := public.is_marketplace_admin();
  if not is_admin and not private.is_inquiry_thread_participant(p_thread_id) then
    raise exception 'Inquiry thread not found or access denied';
  end if;

  if not is_admin then
    select
      participant.participant_role,
      not exists (
        select 1
        from public.inquiry_threads newer_thread
        where newer_thread.inquiry_id = thread.inquiry_id
          and newer_thread.assignment_order > thread.assignment_order
      )
    into caller_role, is_current_assignment
    from public.inquiry_threads thread
    join public.inquiry_thread_participants participant
      on participant.thread_id = thread.id
     and participant.account_id = caller_id
     and participant.left_at is null
    where thread.id = p_thread_id;
  end if;

  if is_admin then
    insert into public.inquiry_admin_access_events (
      thread_id,
      admin_account_id,
      action
    ) values (
      p_thread_id,
      caller_id,
      'opened'
    );
  end if;

  select jsonb_build_object(
    'thread', to_jsonb(thread) || jsonb_build_object(
      'is_current_assignment',
      is_admin or caller_role = 'organizer' or is_current_assignment
    ),
    'inquiry', case
      when is_admin or caller_role = 'organizer' or is_current_assignment then
        to_jsonb(inquiry) - 'messaging_search_vector'
      else
        to_jsonb(inquiry) - array[
          'messaging_search_vector',
          'status',
          'first_viewed_at',
          'first_responded_at',
          'closed_at',
          'updated_at',
          'booking_outcome',
          'booked_instructor_profile_id',
          'booking_value_cents',
          'booking_event_date',
          'outcome_note',
          'outcome_reported_by',
          'outcome_reported_at',
          'outcome_followup_count',
          'outcome_last_asked_at',
          'outcome_next_ask_at',
          'completion_status',
          'completion_reported_at',
          'completion_reported_by',
          'completion_followup_count',
          'completion_last_asked_at',
          'completion_next_ask_at',
          'fallback_consent',
          'fallback_consent_at'
        ]::text[]
    end,
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'account_id', participant.account_id,
          'participant_role', participant.participant_role,
          'display_name', account.full_name,
          'joined_at', participant.joined_at,
          'last_read_message_id', participant.last_read_message_id,
          'last_read_at', participant.last_read_at,
          'archived_at', participant.archived_at
        ) order by participant.participant_role
      )
      from public.inquiry_thread_participants participant
      join public.accounts account on account.id = participant.account_id
      where participant.thread_id = thread.id
        and participant.left_at is null
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'thread_id', recent.thread_id,
          'sender_account_id', recent.sender_account_id,
          'sender_role', recent.sender_role,
          'body', recent.body,
          'message_type', recent.message_kind,
          'created_at', recent.created_at,
          'redacted_at', recent.redacted_at,
          'sender_name', recent.sender_name,
          'client_request_id', recent.client_request_id
        ) order by recent.id
      )
      from (
        select
          message.id,
          message.thread_id,
          message.sender_account_id,
          account.full_name as sender_name,
          coalesce(
            participant.participant_role,
            case
              when message.message_kind = 'system' then 'system'
              when exists (
                select 1
                from public.inquiry_admin_access_events access_event
                where access_event.thread_id = message.thread_id
                  and access_event.admin_account_id = message.sender_account_id
                  and access_event.action = 'sent'
              ) then 'admin'
            end
          ) as sender_role,
          message.message_kind,
          message.body,
          message.client_request_id,
          message.created_at,
          message.redacted_at
        from public.inquiry_messages message
        left join public.accounts account on account.id = message.sender_account_id
        left join public.inquiry_thread_participants participant
          on participant.thread_id = message.thread_id
         and participant.account_id = message.sender_account_id
        where message.thread_id = thread.id
        order by message.id desc
        limit 500
      ) recent
    ), '[]'::jsonb),
    'message_count', (
      select count(*) from public.inquiry_messages where thread_id = thread.id
    ),
    'admin_notes', case when is_admin then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', note.id,
          'author_account_id', note.author_account_id,
          'author_name', account.full_name,
          'note', note.note,
          'created_at', note.created_at
        ) order by note.id
      )
      from public.inquiry_admin_notes note
      left join public.accounts account on account.id = note.author_account_id
      where note.thread_id = thread.id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result
  from public.inquiry_threads thread
  join public.inquiries inquiry on inquiry.id = thread.inquiry_id
  where thread.id = p_thread_id;

  if result is null then
    raise exception 'Inquiry thread not found';
  end if;
  return result;
end;
$$;

create or replace function public.mark_inquiry_thread_read(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  thread public.inquiry_threads%rowtype;
  participant public.inquiry_thread_participants%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  select * into thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;
  if thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;

  select * into participant
  from public.inquiry_thread_participants
  where thread_id = thread.id
    and account_id = caller_id
    and left_at is null
  for update;
  if participant.account_id is null then
    raise exception 'Inquiry thread not found or access denied';
  end if;

  update public.inquiry_thread_participants
  set last_read_message_id = thread.last_message_id,
      last_read_at = now(),
      updated_at = now()
  where thread_id = thread.id
    and account_id = caller_id;

  if participant.participant_role = 'instructor'
    and thread.first_viewed_at is null then
    update public.inquiry_threads
    set first_viewed_at = now(),
        updated_at = now()
    where id = thread.id;

    update public.inquiries
    set first_viewed_at = coalesce(first_viewed_at, now()),
        status = case when status = 'submitted' then 'viewed' else status end,
        updated_at = now()
    where id = thread.inquiry_id;
  end if;

  return jsonb_build_object(
    'thread_id', thread.id,
    'last_read_message_id', thread.last_message_id,
    'last_read_at', now()
  );
end;
$$;

create or replace function public.send_inquiry_message(
  p_thread_id uuid,
  p_body text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_body text := nullif(trim(coalesce(p_body, '')), '');
  thread public.inquiry_threads%rowtype;
  participant public.inquiry_thread_participants%rowtype;
  existing public.inquiry_messages%rowtype;
  created_message public.inquiry_messages%rowtype;
  recipient_account_id uuid;
  recipient_email text;
  is_admin boolean := false;
  admin_static_reply boolean := false;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if clean_body is null then
    raise exception 'Message is required';
  end if;
  if char_length(clean_body) > 4000 then
    raise exception 'Message must be 4,000 characters or fewer';
  end if;
  if p_client_request_id is null then
    raise exception 'A client request ID is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 41));

  select * into existing
  from public.inquiry_messages
  where sender_account_id = caller_id
    and client_request_id = p_client_request_id;
  if existing.id is not null then
    if existing.thread_id <> p_thread_id or existing.body <> clean_body then
      raise exception 'Client request ID was already used for another message';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'thread_id', existing.thread_id,
      'sender_account_id', existing.sender_account_id,
      'message_kind', existing.message_kind,
      'body', existing.body,
      'client_request_id', existing.client_request_id,
      'created_at', existing.created_at
    );
  end if;

  select * into thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;
  if thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if thread.status not in ('awaiting_response', 'active') then
    raise exception 'This inquiry thread is closed for replies';
  end if;

  select * into participant
  from public.inquiry_thread_participants
  where thread_id = thread.id
    and account_id = caller_id
    and left_at is null;
  if participant.account_id is null then
    is_admin := public.is_marketplace_admin();
    if is_admin and thread.assignment_source = 'static_support' then
      admin_static_reply := true;
    else
      raise exception 'Inquiry thread not found or access denied';
    end if;
  end if;

  if (
    select count(*)
    from public.inquiry_messages message
    where message.sender_account_id = caller_id
      and message.created_at >= now() - interval '1 minute'
  ) >= 20 then
    raise exception 'Message limit reached. Please try again shortly';
  end if;
  if (
    select count(*)
    from public.inquiry_messages message
    where message.sender_account_id = caller_id
      and message.created_at >= now() - interval '1 day'
  ) >= 500 then
    raise exception 'Daily message limit reached';
  end if;

  insert into public.inquiry_messages (
    thread_id,
    sender_account_id,
    message_kind,
    body,
    client_request_id
  ) values (
    thread.id,
    caller_id,
    'participant',
    clean_body,
    p_client_request_id
  ) returning * into created_message;

  if admin_static_reply then
    insert into public.inquiry_admin_access_events (
      thread_id,
      admin_account_id,
      action
    ) values (
      thread.id,
      caller_id,
      'sent'
    );
  end if;

  update public.inquiry_threads
  set status = case
        when participant.participant_role = 'instructor' then 'active'
        else status
      end,
      first_instructor_message_at = case
        when participant.participant_role = 'instructor'
          then coalesce(first_instructor_message_at, created_message.created_at)
        else first_instructor_message_at
      end,
      last_message_id = created_message.id,
      last_message_at = created_message.created_at,
      updated_at = now()
  where id = thread.id;

  update public.inquiry_thread_participants
  set last_read_message_id = created_message.id,
      last_read_at = created_message.created_at,
      updated_at = now()
  where thread_id = thread.id
    and account_id = caller_id;

  if participant.participant_role = 'instructor'
    and thread.first_instructor_message_at is null then
    update public.inquiries
    set first_responded_at = coalesce(first_responded_at, created_message.created_at),
        status = case
          when status in ('submitted', 'viewed') then 'responded'
          else status
        end,
        updated_at = now()
    where id = thread.inquiry_id;
    perform private.cancel_inquiry_thread_response_jobs(
      thread.id,
      'Instructor responded before the reminder was sent'
    );
  end if;

  select
    other.account_id,
    case
      when other.participant_role = 'instructor' then
        coalesce(settings.inquiry_email, account.email)
      else account.email
    end
  into recipient_account_id, recipient_email
  from public.inquiry_thread_participants other
  join public.accounts account on account.id = other.account_id
  left join public.instructor_profiles profile
    on profile.account_id = other.account_id
   and profile.id = thread.instructor_profile_id
  left join public.instructor_private_settings settings
    on settings.instructor_profile_id = profile.id
  where other.thread_id = thread.id
    and other.account_id <> caller_id
    and other.left_at is null
  limit 1;

  if recipient_email is null
    and thread.assignment_source = 'static_support'
    and participant.participant_role = 'organizer' then
    select recipient.delivered_to_email
    into recipient_email
    from public.inquiry_recipients recipient
    where recipient.id = thread.inquiry_recipient_id;
    recipient_account_id := null;
  end if;

  if recipient_email is not null then
    insert into public.inquiry_thread_notification_jobs (
      thread_id,
      inquiry_recipient_id,
      message_id,
      recipient_account_id,
      recipient_email,
      notification_type,
      dedupe_key
    ) values (
      thread.id,
      thread.inquiry_recipient_id,
      created_message.id,
      recipient_account_id,
      recipient_email,
      'new_message',
      'thread:' || thread.id::text || ':message:' || created_message.id::text ||
        ':recipient:' || coalesce(recipient_account_id::text, 'static-support')
    ) on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'id', created_message.id,
    'thread_id', created_message.thread_id,
    'sender_account_id', created_message.sender_account_id,
    'message_kind', created_message.message_kind,
    'body', created_message.body,
    'client_request_id', created_message.client_request_id,
    'created_at', created_message.created_at
  );
end;
$$;

create or replace function public.decline_inquiry_thread(
  p_thread_id uuid,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  thread public.inquiry_threads%rowtype;
  organizer_account_id uuid;
  organizer_email text;
  clean_message text := nullif(trim(coalesce(p_message, '')), '');
  decline_message jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if char_length(coalesce(clean_message, '')) > 4000 then
    raise exception 'Message must be 4,000 characters or fewer';
  end if;

  select * into thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;
  if thread.id is null
    or thread.instructor_account_id is distinct from caller_id then
    raise exception 'Inquiry thread not found or access denied';
  end if;
  if thread.status not in ('awaiting_response', 'active') then
    raise exception 'This inquiry thread is already closed';
  end if;

  if clean_message is not null then
    decline_message := public.send_inquiry_message(
      thread.id,
      clean_message,
      gen_random_uuid()
    );
  end if;

  update public.inquiry_threads
  set status = 'declined',
      first_instructor_message_at = coalesce(first_instructor_message_at, now()),
      closed_at = now(),
      updated_at = now()
  where id = thread.id;

  update public.inquiries
  set first_responded_at = coalesce(first_responded_at, now()),
      status = 'declined',
      closed_at = now(),
      updated_at = now()
  where id = thread.inquiry_id;

  perform private.cancel_inquiry_thread_response_jobs(
    thread.id,
    'Instructor declined before the reminder was sent'
  );

  insert into public.inquiry_routing_events (
    inquiry_id,
    thread_id,
    actor_account_id,
    candidate_instructor_profile_id,
    event_type,
    dedupe_key
  ) values (
    thread.inquiry_id,
    thread.id,
    caller_id,
    thread.instructor_profile_id,
    'instructor_declined',
    'thread:' || thread.id::text || ':instructor-declined'
  ) on conflict (dedupe_key) do nothing;

  if clean_message is null then
    select
      inquiry.organizer_account_id,
      coalesce(account.email, inquiry.contact_email, inquiry.email)
    into organizer_account_id, organizer_email
    from public.inquiries inquiry
    left join public.accounts account on account.id = inquiry.organizer_account_id
    where inquiry.id = thread.inquiry_id;

    if organizer_account_id is not null and organizer_email is not null then
      insert into public.inquiry_thread_notification_jobs (
        thread_id,
        inquiry_recipient_id,
        recipient_account_id,
        recipient_email,
        notification_type,
        dedupe_key
      ) values (
        thread.id,
        thread.inquiry_recipient_id,
        organizer_account_id,
        organizer_email,
        'thread_declined',
        'thread:' || thread.id::text || ':thread-declined'
      ) on conflict (dedupe_key) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'thread_id', thread.id,
    'status', 'declined',
    'message', decline_message
  );
end;
$$;

create or replace function public.withdraw_inquiry(p_inquiry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  inquiry public.inquiries%rowtype;
  closed_threads integer;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  select * into inquiry
  from public.inquiries
  where id = p_inquiry_id
  for update;
  if inquiry.id is null or inquiry.organizer_account_id is distinct from caller_id then
    raise exception 'Inquiry not found or access denied';
  end if;

  update public.inquiry_threads
  set status = 'withdrawn',
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  where inquiry_id = inquiry.id
    and status in ('awaiting_response', 'active', 'timed_out');
  get diagnostics closed_threads = row_count;

  update public.inquiries
  set status = 'withdrawn',
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  where id = inquiry.id;

  update public.inquiry_thread_notification_jobs job
  set status = 'canceled',
      completed_at = now(),
      locked_at = null,
      last_error = 'Inquiry was withdrawn'
  from public.inquiry_threads thread
  where thread.inquiry_id = inquiry.id
    and job.thread_id = thread.id
    and job.status = 'pending';

  insert into public.inquiry_routing_events (
    inquiry_id,
    actor_account_id,
    event_type,
    dedupe_key
  ) values (
    inquiry.id,
    caller_id,
    'inquiry_withdrawn',
    'inquiry:' || inquiry.id::text || ':withdrawn'
  ) on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'inquiry_id', inquiry.id,
    'status', 'withdrawn',
    'closed_thread_count', closed_threads
  );
end;
$$;

create or replace function public.admin_add_inquiry_note(
  p_thread_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
  created_note public.inquiry_admin_notes%rowtype;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;
  if clean_note is null then
    raise exception 'Note is required';
  end if;
  if char_length(clean_note) > 4000 then
    raise exception 'Note must be 4,000 characters or fewer';
  end if;
  if not exists (
    select 1 from public.inquiry_threads where id = p_thread_id
  ) then
    raise exception 'Inquiry thread not found';
  end if;

  insert into public.inquiry_admin_notes (
    thread_id,
    author_account_id,
    note
  ) values (
    p_thread_id,
    (select auth.uid()),
    clean_note
  ) returning * into created_note;

  insert into public.inquiry_admin_access_events (
    thread_id,
    admin_account_id,
    action
  ) values (
    p_thread_id,
    (select auth.uid()),
    'noted'
  );

  return jsonb_build_object(
    'id', created_note.id,
    'thread_id', created_note.thread_id,
    'author_account_id', created_note.author_account_id,
    'note', created_note.note,
    'created_at', created_note.created_at
  );
end;
$$;

create or replace function public.admin_list_fallback_candidates(
  p_thread_id uuid
)
returns table (
  instructor_profile_id uuid,
  display_name text,
  service_market_name text,
  active_thread_count bigint,
  last_fallback_assigned_at timestamptz,
  match_reasons text[],
  match_score integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_thread public.inquiry_threads%rowtype;
  inquiry public.inquiries%rowtype;
  market_slug text;
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;

  select * into source_thread
  from public.inquiry_threads
  where id = p_thread_id;
  if source_thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if source_thread.status not in ('timed_out', 'declined') then
    raise exception 'Fallback review requires a timed-out or declined thread';
  end if;

  select * into inquiry
  from public.inquiries
  where id = source_thread.inquiry_id;
  if not inquiry.fallback_consent then
    raise exception 'Organizer fallback consent is required';
  end if;
  if inquiry.event_date is null or inquiry.event_date < current_date then
    return;
  end if;

  select locality.service_market_slug into market_slug
  from public.service_market_localities locality
  join public.service_markets market
    on market.slug = locality.service_market_slug
   and market.active
  where locality.city_normalized = private.normalize_market_value(inquiry.event_city)
    and locality.region_normalized = private.normalize_market_value(inquiry.event_region)
  order by locality.service_market_slug
  limit 1;

  if market_slug is null then
    return;
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    market.name,
    active_threads.active_count,
    mapping.last_fallback_assigned_at,
    array['service_market', 'event_type', 'accepting_inquiries']::text[],
    greatest(0, 100 - least(active_threads.active_count, 20)::integer * 5)
  from public.instructor_service_markets mapping
  join public.service_markets market
    on market.slug = mapping.service_market_slug
   and market.active
  join public.instructor_profiles profile
    on profile.id = mapping.instructor_profile_id
   and profile.status = 'published'
  cross join lateral (
    select count(*) as active_count
    from public.inquiry_threads open_thread
    where open_thread.instructor_profile_id = profile.id
      and open_thread.status in ('awaiting_response', 'active')
  ) active_threads
  where mapping.service_market_slug = market_slug
    and mapping.accepting_inquiries
    and mapping.fallback_eligible
    and inquiry.event_type = any(profile.event_types)
    and active_threads.active_count < mapping.max_active_thread_count
    and not exists (
      select 1
      from public.inquiry_threads prior_thread
      where prior_thread.inquiry_id = inquiry.id
        and prior_thread.instructor_profile_id = profile.id
    )
  order by
    active_threads.active_count,
    mapping.last_fallback_assigned_at asc nulls first,
    lower(profile.display_name),
    profile.id;
end;
$$;

create or replace function public.admin_route_inquiry(
  p_thread_id uuid,
  p_instructor_profile_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  source_thread public.inquiry_threads%rowtype;
  inquiry public.inquiries%rowtype;
  instructor public.instructor_profiles%rowtype;
  delivery_email text;
  organizer_email text;
  recipient_id uuid;
  created_thread_id uuid;
  initial_message_id bigint;
  next_assignment_order smallint;
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_marketplace_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_instructor_profile_id is null then
    raise exception 'Instructor profile is required';
  end if;
  if char_length(coalesce(clean_note, '')) > 2000 then
    raise exception 'Routing note must be 2,000 characters or fewer';
  end if;

  select * into source_thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;
  if source_thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if source_thread.status not in ('timed_out', 'declined') then
    raise exception 'Fallback routing requires a timed-out or declined thread';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(source_thread.inquiry_id::text, 77)
  );

  select * into inquiry
  from public.inquiries
  where id = source_thread.inquiry_id
  for update;
  if not inquiry.fallback_consent then
    raise exception 'Organizer fallback consent is required';
  end if;
  if inquiry.event_date is null or inquiry.event_date < current_date then
    raise exception 'The event date has passed';
  end if;
  if exists (
    select 1
    from public.inquiry_threads open_thread
    where open_thread.inquiry_id = inquiry.id
      and open_thread.status in ('awaiting_response', 'active')
  ) then
    raise exception 'This inquiry already has an open instructor thread';
  end if;

  if not exists (
    select 1
    from public.admin_list_fallback_candidates(source_thread.id) candidate
    where candidate.instructor_profile_id = p_instructor_profile_id
  ) then
    raise exception 'Instructor is not eligible for this fallback';
  end if;

  select * into instructor
  from public.instructor_profiles
  where id = p_instructor_profile_id
  for update;

  select coalesce(settings.inquiry_email, account.email)
  into delivery_email
  from public.accounts account
  left join public.instructor_private_settings settings
    on settings.instructor_profile_id = instructor.id
  where account.id = instructor.account_id;
  if delivery_email is null then
    raise exception 'This instructor has not configured inquiry delivery';
  end if;

  select (coalesce(max(thread.assignment_order), 0) + 1)::smallint
  into next_assignment_order
  from public.inquiry_threads thread
  where thread.inquiry_id = inquiry.id;

  insert into public.inquiry_recipients (
    inquiry_id,
    instructor_profile_id,
    delivered_to_email,
    delivered_to_phone_e164,
    sms_delivery_status
  ) values (
    inquiry.id,
    instructor.id,
    delivery_email,
    null,
    'not_requested'
  ) returning id into recipient_id;

  insert into public.inquiry_threads (
    inquiry_id,
    inquiry_recipient_id,
    instructor_profile_id,
    instructor_account_id,
    assignment_order,
    assignment_source,
    previous_thread_id,
    status,
    assigned_at,
    last_message_at,
    created_by
  ) values (
    inquiry.id,
    recipient_id,
    instructor.id,
    instructor.account_id,
    next_assignment_order,
    'fallback',
    source_thread.id,
    'awaiting_response',
    now(),
    now(),
    caller_id
  ) returning id into created_thread_id;

  insert into public.inquiry_thread_participants (
    thread_id,
    account_id,
    participant_role,
    last_read_at
  ) values (
    created_thread_id,
    inquiry.organizer_account_id,
    'organizer',
    now()
  );

  insert into public.inquiry_thread_participants (
    thread_id,
    account_id,
    participant_role
  ) values (
    created_thread_id,
    instructor.account_id,
    'instructor'
  );

  insert into public.inquiry_messages (
    thread_id,
    sender_account_id,
    message_kind,
    body
  ) values (
    created_thread_id,
    inquiry.organizer_account_id,
    'inquiry',
    coalesce(inquiry.message, '')
  ) returning id into initial_message_id;

  update public.inquiry_threads
  set last_message_id = initial_message_id,
      last_message_at = now(),
      updated_at = now()
  where id = created_thread_id;

  update public.inquiry_thread_participants
  set last_read_message_id = initial_message_id,
      updated_at = now()
  where thread_id = created_thread_id
    and account_id = inquiry.organizer_account_id;

  update public.inquiries
  set status = 'submitted',
      closed_at = null,
      updated_at = now()
  where id = inquiry.id;

  update public.instructor_service_markets mapping
  set last_fallback_assigned_at = now(),
      updated_at = now()
  where mapping.instructor_profile_id = instructor.id
    and mapping.service_market_slug in (
      select locality.service_market_slug
      from public.service_market_localities locality
      where locality.city_normalized = private.normalize_market_value(inquiry.event_city)
        and locality.region_normalized = private.normalize_market_value(inquiry.event_region)
    );

  insert into public.inquiry_thread_notification_jobs (
    thread_id,
    inquiry_recipient_id,
    message_id,
    recipient_account_id,
    recipient_email,
    notification_type,
    dedupe_key
  ) values (
    created_thread_id,
    recipient_id,
    initial_message_id,
    instructor.account_id,
    delivery_email,
    'new_thread',
    'thread:' || created_thread_id::text || ':new-thread'
  );

  select coalesce(account.email, inquiry.contact_email, inquiry.email)
  into organizer_email
  from public.accounts account
  where account.id = inquiry.organizer_account_id;

  if organizer_email is not null then
    insert into public.inquiry_thread_notification_jobs (
      thread_id,
      inquiry_recipient_id,
      recipient_account_id,
      recipient_email,
      notification_type,
      dedupe_key
    ) values (
      created_thread_id,
      recipient_id,
      inquiry.organizer_account_id,
      organizer_email,
      'fallback_routed_organizer',
      'thread:' || created_thread_id::text || ':fallback-routed-organizer'
    ) on conflict (dedupe_key) do nothing;
  end if;

  update public.inquiry_notification_jobs job
  set status = 'canceled',
      completed_at = now(),
      locked_at = null,
      last_error = 'Follow-up recipient changed after fallback routing'
  from public.inquiry_recipients old_recipient
  where old_recipient.inquiry_id = inquiry.id
    and job.inquiry_recipient_id = old_recipient.id
    and old_recipient.id <> recipient_id
    and job.notification_type in ('booking_followup', 'completion_followup')
    and job.status = 'pending';

  insert into public.inquiry_routing_events (
    inquiry_id,
    thread_id,
    actor_account_id,
    candidate_instructor_profile_id,
    event_type,
    note,
    dedupe_key
  ) values (
    inquiry.id,
    created_thread_id,
    caller_id,
    instructor.id,
    'fallback_routed',
    clean_note,
    'thread:' || created_thread_id::text || ':fallback-routed'
  );

  insert into public.inquiry_admin_access_events (
    thread_id,
    admin_account_id,
    action
  ) values (
    created_thread_id,
    caller_id,
    'routed'
  );

  if clean_note is not null then
    insert into public.inquiry_admin_notes (
      thread_id,
      author_account_id,
      note
    ) values (
      created_thread_id,
      caller_id,
      clean_note
    );
  end if;

  return created_thread_id;
end;
$$;

create or replace function public.enqueue_due_inquiry_response_actions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  transitioned_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;

  with due as (
    select thread.id
    from public.inquiry_threads thread
    where thread.status = 'awaiting_response'
      and thread.first_instructor_message_at is null
      and thread.response_due_at is not null
      and thread.response_due_at <= now()
    order by thread.response_due_at, thread.id
    for update skip locked
  ), transitioned as (
    update public.inquiry_threads thread
    set status = 'timed_out',
        timed_out_at = now(),
        fallback_review_requested_at = now(),
        closed_at = now(),
        updated_at = now()
    from due
    where thread.id = due.id
    returning thread.id, thread.inquiry_id, thread.instructor_profile_id
  )
  insert into public.inquiry_routing_events (
    inquiry_id,
    thread_id,
    candidate_instructor_profile_id,
    event_type,
    dedupe_key
  )
  select
    transitioned.inquiry_id,
    transitioned.id,
    transitioned.instructor_profile_id,
    'fallback_review_requested',
    'thread:' || transitioned.id::text || ':fallback-review-requested'
  from transitioned
  on conflict (dedupe_key) do nothing;

  get diagnostics transitioned_count = row_count;
  return transitioned_count;
end;
$$;

create or replace function public.inquiry_thread_notification_job_is_sendable(
  p_job_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job public.inquiry_thread_notification_jobs%rowtype;
  thread_status text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select * into job
  from public.inquiry_thread_notification_jobs
  where id = p_job_id;
  if job.id is null or job.status <> 'processing' then
    return false;
  end if;
  select status into thread_status
  from public.inquiry_threads
  where id = job.thread_id;

  return case
    when job.notification_type = 'new_thread'
      then thread_status = 'awaiting_response'
    when job.notification_type = 'new_message'
      then thread_status in ('awaiting_response', 'active', 'declined')
    when job.notification_type in ('response_reminder_24', 'response_reminder_48')
      then thread_status = 'awaiting_response'
    when job.notification_type in (
      'response_timeout_instructor',
      'response_timeout_organizer'
    ) then thread_status = 'timed_out'
    when job.notification_type = 'thread_declined'
      then thread_status = 'declined'
    when job.notification_type = 'fallback_routed_organizer'
      then thread_status in ('awaiting_response', 'active', 'declined', 'timed_out')
    else false
  end;
end;
$$;

create or replace function public.claim_inquiry_thread_notification_jobs(
  p_limit integer default 10,
  p_lock_timeout interval default interval '10 minutes'
)
returns table (
  job_id bigint,
  notification_type text,
  channel text,
  attempt_number smallint,
  recipient_account_id uuid,
  delivered_to_email text,
  recipient_login_email text,
  thread_id uuid,
  inquiry_id uuid,
  assignment_order smallint,
  instructor_name text,
  organizer_name text,
  company_name text,
  event_type text,
  event_date date,
  event_start_time time,
  time_zone text,
  venue_name text,
  event_location text,
  guest_count integer,
  message_id bigint,
  message_body text,
  sender_name text,
  response_due_at timestamptz,
  fallback_consent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.inquiry_thread_notification_jobs job
  set status = 'canceled',
      completed_at = now(),
      locked_at = null,
      last_error = 'Notification is no longer needed'
  from public.inquiry_threads thread
  where thread.id = job.thread_id
    and job.status = 'pending'
    and (
      (job.notification_type = 'new_thread' and thread.status <> 'awaiting_response')
      or (
        job.notification_type = 'new_message'
        and thread.status not in ('awaiting_response', 'active', 'declined')
      )
      or (
        job.notification_type in ('response_reminder_24', 'response_reminder_48')
        and thread.status <> 'awaiting_response'
      )
      or (
        job.notification_type in (
          'response_timeout_instructor',
          'response_timeout_organizer'
        )
        and thread.status <> 'timed_out'
      )
      or (job.notification_type = 'thread_declined' and thread.status <> 'declined')
      or (
        job.notification_type = 'fallback_routed_organizer'
        and thread.status not in ('awaiting_response', 'active', 'declined', 'timed_out')
      )
    );

  update public.inquiry_thread_notification_jobs
  set status = 'failed',
      completed_at = now(),
      locked_at = null,
      last_error = coalesce(
        last_error,
        'Worker stopped before the final attempt completed'
      )
  where status = 'processing'
    and attempts >= 6
    and coalesce(locked_at, '-infinity'::timestamptz)
      < now() - greatest(p_lock_timeout, interval '1 minute');

  update public.inquiry_recipients recipient
  set email_delivery_status = 'failed',
      updated_at = now()
  where recipient.email_delivery_status = 'queued'
    and exists (
      select 1
      from public.inquiry_thread_notification_jobs failed_job
      where failed_job.inquiry_recipient_id = recipient.id
        and failed_job.notification_type = 'new_thread'
        and failed_job.status = 'failed'
    );

  return query
  with candidates as (
    select job.id
    from public.inquiry_thread_notification_jobs job
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
    update public.inquiry_thread_notification_jobs job
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
    claimed.notification_type,
    claimed.channel,
    claimed.attempts,
    claimed.recipient_account_id,
    claimed.recipient_email,
    recipient_account.email,
    thread.id,
    inquiry.id,
    thread.assignment_order,
    coalesce(profile.display_name, inquiry.instructor_name, 'Line dance instructor'),
    coalesce(inquiry.contact_name, inquiry.name, 'Organizer'),
    inquiry.company_name,
    inquiry.event_type,
    inquiry.event_date,
    inquiry.event_start_time,
    inquiry.time_zone,
    inquiry.venue_name,
    coalesce(
      inquiry.location,
      concat_ws(', ', inquiry.event_city, inquiry.event_region)
    ),
    inquiry.guest_count,
    claimed.message_id,
    message.body,
    case
      when thread.assignment_source = 'static_support'
        and exists (
          select 1
          from public.inquiry_admin_access_events access_event
          where access_event.thread_id = thread.id
            and access_event.admin_account_id = message.sender_account_id
            and access_event.action = 'sent'
        ) then 'Hire Line Dancers'
      else sender.full_name
    end,
    thread.response_due_at,
    inquiry.fallback_consent
  from claimed
  join public.inquiry_threads thread on thread.id = claimed.thread_id
  join public.inquiries inquiry on inquiry.id = thread.inquiry_id
  left join public.instructor_profiles profile
    on profile.id = thread.instructor_profile_id
  left join public.accounts recipient_account
    on recipient_account.id = claimed.recipient_account_id
  left join public.inquiry_messages message on message.id = claimed.message_id
  left join public.accounts sender on sender.id = message.sender_account_id;
end;
$$;

create or replace function public.complete_inquiry_thread_notification_job(
  p_job_id bigint,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retryable boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.inquiry_thread_notification_jobs%rowtype;
  retry_seconds integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select * into job
  from public.inquiry_thread_notification_jobs
  where id = p_job_id
  for update;
  if job.id is null then
    raise exception 'Thread notification job not found';
  end if;
  if job.status in ('sent', 'canceled') then
    return job.status;
  end if;
  if job.status <> 'processing' then
    raise exception 'Thread notification job is not processing';
  end if;

  if p_success then
    update public.inquiry_thread_notification_jobs
    set status = 'sent',
        provider_message_id = nullif(trim(p_provider_message_id), ''),
        sent_at = now(),
        completed_at = now(),
        locked_at = null,
        last_error = null
    where id = job.id;
    if job.notification_type = 'new_thread'
      and job.inquiry_recipient_id is not null then
      update public.inquiry_recipients
      set email_delivery_status = 'sent',
          email_provider_message_id = nullif(trim(p_provider_message_id), ''),
          updated_at = now()
      where id = job.inquiry_recipient_id;
    end if;
    return 'sent';
  end if;

  if p_retryable and job.attempts < 6 then
    retry_seconds := least(
      1800,
      (30 * power(2, greatest(job.attempts - 1, 0)))::integer
    );
    update public.inquiry_thread_notification_jobs
    set status = 'pending',
        available_at = now() + retry_seconds * interval '1 second',
        locked_at = null,
        last_error = left(coalesce(p_error, 'Provider request failed'), 2000)
    where id = job.id;
    if job.notification_type = 'new_thread'
      and job.inquiry_recipient_id is not null then
      update public.inquiry_recipients
      set email_delivery_status = 'queued',
          updated_at = now()
      where id = job.inquiry_recipient_id;
    end if;
    return 'pending';
  end if;

  update public.inquiry_thread_notification_jobs
  set status = 'failed',
      completed_at = now(),
      locked_at = null,
      last_error = left(coalesce(p_error, 'Provider request failed'), 2000)
  where id = job.id;
  if job.notification_type = 'new_thread'
    and job.inquiry_recipient_id is not null then
    update public.inquiry_recipients
    set email_delivery_status = 'failed',
        updated_at = now()
    where id = job.inquiry_recipient_id;
  end if;
  return 'failed';
end;
$$;

create or replace function public.defer_inquiry_thread_notification_job(
  p_job_id bigint,
  p_error text,
  p_delay interval default interval '15 minutes'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.inquiry_thread_notification_jobs%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select * into job
  from public.inquiry_thread_notification_jobs
  where id = p_job_id
  for update;
  if job.id is null then
    raise exception 'Thread notification job not found';
  end if;
  if job.status in ('sent', 'canceled') then
    return job.status;
  end if;
  if job.status <> 'processing' then
    raise exception 'Thread notification job is not processing';
  end if;

  update public.inquiry_thread_notification_jobs
  set status = 'pending',
      attempts = greatest(attempts - 1, 0),
      available_at = now() + greatest(p_delay, interval '1 minute'),
      locked_at = null,
      last_error = left(
        coalesce(p_error, 'Notification provider is not configured'),
        2000
      )
  where id = job.id;
  return 'pending';
end;
$$;

create or replace function public.cancel_inquiry_thread_notification_job(
  p_job_id bigint,
  p_reason text default 'Notification is no longer needed'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  update public.inquiry_thread_notification_jobs
  set status = 'canceled',
      completed_at = now(),
      locked_at = null,
      last_error = left(coalesce(p_reason, 'Notification is no longer needed'), 2000)
  where id = p_job_id
    and status in ('pending', 'processing');
  if not found then
    return coalesce((
      select status
      from public.inquiry_thread_notification_jobs
      where id = p_job_id
    ), 'missing');
  end if;
  return 'canceled';
end;
$$;

create or replace function public.start_thread_clock_after_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'sent'
    and old.status is distinct from 'sent'
    and new.notification_type = 'new_thread' then
    perform private.start_inquiry_thread_response_clock(
      new.thread_id,
      coalesce(new.sent_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists start_thread_clock_after_notification
  on public.inquiry_thread_notification_jobs;
create trigger start_thread_clock_after_notification
  after update of status on public.inquiry_thread_notification_jobs
  for each row execute function public.start_thread_clock_after_notification();

create or replace function public.start_thread_clock_after_legacy_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  related_thread_id uuid;
begin
  if new.status = 'sent'
    and old.status is distinct from 'sent'
    and new.notification_type = 'new_inquiry' then
    select thread.id into related_thread_id
    from public.inquiry_threads thread
    where thread.inquiry_recipient_id = new.inquiry_recipient_id
    order by thread.assignment_order
    limit 1;
    if related_thread_id is not null then
      perform private.start_inquiry_thread_response_clock(
        related_thread_id,
        coalesce(new.sent_at, now())
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists start_thread_clock_after_legacy_notification
  on public.inquiry_notification_jobs;
create trigger start_thread_clock_after_legacy_notification
  after update of status on public.inquiry_notification_jobs
  for each row execute function public.start_thread_clock_after_legacy_notification();

create or replace function public.claim_inquiry_notification_jobs_v3(
  p_limit integer default 10,
  p_lock_timeout interval default interval '10 minutes'
)
returns table (
  job_id bigint,
  notification_type text,
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
  inquiry_message text,
  thread_id uuid,
  recipient_login_email text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required';
  end if;
  return query
  select
    claimed.job_id,
    claimed.notification_type,
    claimed.channel,
    claimed.attempt_number,
    claimed.inquiry_recipient_id,
    claimed.delivered_to_email,
    claimed.delivered_to_phone_e164,
    claimed.inquiry_id,
    claimed.instructor_name,
    claimed.organizer_name,
    claimed.organizer_email,
    claimed.company_name,
    claimed.event_type,
    claimed.event_date,
    claimed.event_start_time,
    claimed.time_zone,
    claimed.venue_name,
    claimed.event_location,
    claimed.guest_count,
    claimed.budget_range,
    claimed.music_requests,
    claimed.venue_has_speakers,
    claimed.venue_has_microphone,
    claimed.inquiry_message,
    thread.id,
    account.email
  from public.claim_inquiry_notification_jobs_v2(
    p_limit,
    p_lock_timeout
  ) claimed
  left join public.inquiry_threads thread
    on thread.inquiry_recipient_id = claimed.inquiry_recipient_id
  left join public.instructor_profiles profile
    on profile.id = thread.instructor_profile_id
  left join public.accounts account on account.id = profile.account_id;
end;
$$;

set constraints inquiry_threads_last_message_fkey immediate;

alter table public.service_markets enable row level security;
alter table public.service_market_localities enable row level security;
alter table public.instructor_service_markets enable row level security;
alter table public.inquiry_threads enable row level security;
alter table public.inquiry_thread_participants enable row level security;
alter table public.inquiry_messages enable row level security;
alter table public.inquiry_admin_notes enable row level security;
alter table public.inquiry_admin_access_events enable row level security;
alter table public.inquiry_routing_events enable row level security;
alter table public.inquiry_thread_notification_jobs enable row level security;

create policy "active service markets are public"
  on public.service_markets
  for select to anon, authenticated
  using (active);

create policy "admins read all service markets"
  on public.service_markets
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "active service market localities are public"
  on public.service_market_localities
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.service_markets market
      where market.slug = service_market_slug
        and market.active
    )
  );

create policy "profile owners and admins read instructor service markets"
  on public.instructor_service_markets
  for select to authenticated
  using (
    exists (
      select 1
      from public.instructor_profiles profile
      where profile.id = instructor_profile_id
        and profile.account_id = (select auth.uid())
    )
    or public.is_marketplace_admin()
  );

create policy "participants and admins read inquiry threads"
  on public.inquiry_threads
  for select to authenticated
  using (
    (select private.is_inquiry_thread_participant(id))
    or public.is_marketplace_admin()
  );

create policy "participants and admins read thread participants"
  on public.inquiry_thread_participants
  for select to authenticated
  using (
    (select private.is_inquiry_thread_participant(thread_id))
    or public.is_marketplace_admin()
  );

create policy "participants and admins read inquiry messages"
  on public.inquiry_messages
  for select to authenticated
  using (
    (select private.is_inquiry_thread_participant(thread_id))
    or public.is_marketplace_admin()
  );

create policy "admins read inquiry notes"
  on public.inquiry_admin_notes
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read inquiry access audit"
  on public.inquiry_admin_access_events
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read inquiry routing audit"
  on public.inquiry_routing_events
  for select to authenticated
  using (public.is_marketplace_admin());

create policy "admins read thread notification jobs"
  on public.inquiry_thread_notification_jobs
  for select to authenticated
  using (public.is_marketplace_admin());

drop policy if exists "participants read inquiries" on public.inquiries;
create policy "participants read inquiries"
  on public.inquiries
  for select to authenticated
  using (
    organizer_account_id = (select auth.uid())
    or private.is_current_inquiry_assignment_participant(id)
    or public.is_marketplace_admin()
  );

drop policy if exists "participants read outcome reports"
  on public.inquiry_outcome_reports;
create policy "participants read outcome reports"
  on public.inquiry_outcome_reports
  for select to authenticated
  using (
    reporter_account_id = (select auth.uid())
    or private.is_current_inquiry_assignment_participant(inquiry_id)
    or private.is_inquiry_organizer(inquiry_id)
    or public.is_marketplace_admin()
  );

drop policy if exists "participants read inquiry events"
  on public.inquiry_status_events;
create policy "participants read inquiry events"
  on public.inquiry_status_events
  for select to authenticated
  using (
    actor_account_id = (select auth.uid())
    or private.is_current_inquiry_assignment_participant(inquiry_id)
    or private.is_inquiry_organizer(inquiry_id)
    or public.is_marketplace_admin()
  );

revoke all on public.service_markets from public, anon, authenticated;
revoke all on public.service_market_localities from public, anon, authenticated;
revoke all on public.instructor_service_markets from public, anon, authenticated;
revoke all on public.inquiry_threads from public, anon, authenticated;
revoke all on public.inquiry_thread_participants from public, anon, authenticated;
revoke all on public.inquiry_messages from public, anon, authenticated;
revoke all on public.inquiry_admin_notes from public, anon, authenticated;
revoke all on public.inquiry_admin_access_events from public, anon, authenticated;
revoke all on public.inquiry_routing_events from public, anon, authenticated;
revoke all on public.inquiry_thread_notification_jobs from public, anon, authenticated;

grant select on public.service_markets to anon, authenticated;
grant select on public.service_market_localities to anon, authenticated;
grant select on public.instructor_service_markets to authenticated;
grant select on public.inquiry_threads to authenticated;
grant select on public.inquiry_thread_participants to authenticated;
grant select on public.inquiry_messages to authenticated;
grant select on public.inquiry_admin_notes to authenticated;
grant select on public.inquiry_admin_access_events to authenticated;
grant select on public.inquiry_routing_events to authenticated;
grant select on public.inquiry_thread_notification_jobs to authenticated;

grant all on public.service_markets to service_role;
grant all on public.service_market_localities to service_role;
grant all on public.instructor_service_markets to service_role;
grant all on public.inquiry_threads to service_role;
grant all on public.inquiry_thread_participants to service_role;
grant all on public.inquiry_messages to service_role;
grant all on public.inquiry_admin_notes to service_role;
grant all on public.inquiry_admin_access_events to service_role;
grant all on public.inquiry_routing_events to service_role;
grant all on public.inquiry_thread_notification_jobs to service_role;

grant usage, select on sequence public.service_market_localities_id_seq
  to service_role;
grant usage, select on sequence public.inquiry_messages_id_seq
  to service_role;
grant usage, select on sequence public.inquiry_admin_notes_id_seq
  to service_role;
grant usage, select on sequence public.inquiry_admin_access_events_id_seq
  to service_role;
grant usage, select on sequence public.inquiry_routing_events_id_seq
  to service_role;
grant usage, select on sequence public.inquiry_thread_notification_jobs_id_seq
  to service_role;

revoke all on function private.is_inquiry_thread_participant(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_inquiry_thread_participant(uuid)
  to authenticated, service_role;
revoke all on function private.is_current_inquiry_assignment_participant(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_current_inquiry_assignment_participant(uuid)
  to authenticated, service_role;
revoke all on function private.is_inquiry_organizer(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_inquiry_organizer(uuid)
  to authenticated, service_role;
revoke all on function private.normalize_market_value(text)
  from public, anon, authenticated, service_role;
revoke all on function private.start_inquiry_thread_response_clock(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.cancel_inquiry_thread_response_jobs(uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_inquiry_delivery()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_instructor_profile_service_market()
  from public, anon, authenticated, service_role;
revoke all on function public.set_inquiry_booked_instructor_assignment()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_inquiry_message_immutability()
  from public, anon, authenticated, service_role;
revoke all on function public.start_thread_clock_after_notification()
  from public, anon, authenticated, service_role;
revoke all on function public.start_thread_clock_after_legacy_notification()
  from public, anon, authenticated, service_role;

revoke all on function public.submit_inquiry(
  uuid, text, date, time, text, text, text, text, text, integer,
  text, text, boolean, boolean, text, text, boolean
) from public, anon, service_role;
grant execute on function public.submit_inquiry(
  uuid, text, date, time, text, text, text, text, text, integer,
  text, text, boolean, boolean, text, text, boolean
) to authenticated;

revoke all on function public.get_inquiry_primary_thread(uuid)
  from public, anon, service_role;
grant execute on function public.get_inquiry_primary_thread(uuid)
  to authenticated;
revoke all on function public.list_inquiry_threads(
  text, text, text, integer, timestamptz, uuid, boolean
) from public, anon, service_role;
grant execute on function public.list_inquiry_threads(
  text, text, text, integer, timestamptz, uuid, boolean
) to authenticated;
revoke all on function public.get_inquiry_thread(uuid)
  from public, anon, service_role;
grant execute on function public.get_inquiry_thread(uuid)
  to authenticated;
revoke all on function public.mark_inquiry_thread_read(uuid)
  from public, anon, service_role;
grant execute on function public.mark_inquiry_thread_read(uuid)
  to authenticated;
revoke all on function public.send_inquiry_message(uuid, text, uuid)
  from public, anon, service_role;
grant execute on function public.send_inquiry_message(uuid, text, uuid)
  to authenticated;
revoke all on function public.decline_inquiry_thread(uuid, text)
  from public, anon, service_role;
grant execute on function public.decline_inquiry_thread(uuid, text)
  to authenticated;
revoke all on function public.withdraw_inquiry(uuid)
  from public, anon, service_role;
grant execute on function public.withdraw_inquiry(uuid)
  to authenticated;
revoke all on function public.admin_add_inquiry_note(uuid, text)
  from public, anon, service_role;
grant execute on function public.admin_add_inquiry_note(uuid, text)
  to authenticated;
revoke all on function public.admin_list_fallback_candidates(uuid)
  from public, anon, service_role;
grant execute on function public.admin_list_fallback_candidates(uuid)
  to authenticated;
revoke all on function public.admin_route_inquiry(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.admin_route_inquiry(uuid, uuid, text)
  to authenticated;

revoke all on function public.enqueue_due_inquiry_response_actions()
  from public, anon, authenticated;
grant execute on function public.enqueue_due_inquiry_response_actions()
  to service_role;
revoke all on function public.inquiry_thread_notification_job_is_sendable(bigint)
  from public, anon, authenticated;
grant execute on function public.inquiry_thread_notification_job_is_sendable(bigint)
  to service_role;
revoke all on function public.claim_inquiry_thread_notification_jobs(integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_inquiry_thread_notification_jobs(integer, interval)
  to service_role;
revoke all on function public.complete_inquiry_thread_notification_job(
  bigint, boolean, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.complete_inquiry_thread_notification_job(
  bigint, boolean, text, text, boolean
) to service_role;
revoke all on function public.defer_inquiry_thread_notification_job(
  bigint, text, interval
) from public, anon, authenticated;
grant execute on function public.defer_inquiry_thread_notification_job(
  bigint, text, interval
) to service_role;
revoke all on function public.cancel_inquiry_thread_notification_job(bigint, text)
  from public, anon, authenticated;
grant execute on function public.cancel_inquiry_thread_notification_job(bigint, text)
  to service_role;
revoke all on function public.claim_inquiry_notification_jobs_v3(integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_inquiry_notification_jobs_v3(integer, interval)
  to service_role;

do $$
declare
  relation_name text;
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach relation_name in array array['inquiry_threads', 'inquiry_messages'] loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = relation_name
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          relation_name
        );
      end if;
    end loop;
  end if;
end;
$$;
