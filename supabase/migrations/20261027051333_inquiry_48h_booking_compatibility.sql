-- Reconciled after the live booking and profile migrations.
-- Existing inquiries keep their original policy and data.
begin;
-- New inquiries use 48 elapsed hours. Existing threads retain their deadlines.
-- No existing inquiry, message, consent, or delivery job is rewritten.

alter table public.inquiry_threads
  add column response_policy_version smallint not null default 1,
  add column inquiry_snapshot jsonb,
  add column booking_outcome text not null default 'unknown'
    check (booking_outcome in ('unknown','booked','not_booked','still_deciding'));
alter table public.inquiry_threads alter column response_policy_version set default 2;
-- A single event can now have independent private conversations.
drop index public.inquiry_threads_one_current_idx;
create index inquiry_threads_open_event_idx on public.inquiry_threads(inquiry_id)
  where status in ('awaiting_response','active');
alter table public.inquiry_thread_notification_jobs
  add column recipient_phone_e164 text,
  add column delivery_status text,
  add column delivery_updated_at timestamptz,
  add column delivery_error text;
alter table public.inquiry_thread_notification_jobs drop constraint inquiry_thread_notification_channel_check;
alter table public.inquiry_thread_notification_jobs add constraint inquiry_thread_notification_channel_check
  check (channel in ('email','sms'));
alter table public.inquiry_thread_notification_jobs drop constraint inquiry_thread_notification_type_check;
alter table public.inquiry_thread_notification_jobs add constraint inquiry_thread_notification_type_check
  check (notification_type in ('new_thread','new_message','response_reminder_24','response_reminder_47','response_reminder_48',
    'response_timeout_instructor','response_timeout_organizer','thread_declined','fallback_routed_organizer','booking_update'));

create table public.inquiry_recommendations (
  source_thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  instructor_profile_id uuid not null references public.instructor_profiles(id) on delete cascade,
  position smallint not null check (position between 1 and 2),
  created_at timestamptz not null default now(),
  primary key(source_thread_id,instructor_profile_id), unique(source_thread_id,position)
);
alter table public.inquiry_recommendations enable row level security;
revoke all on public.inquiry_recommendations from public,anon,authenticated;
grant all on public.inquiry_recommendations to service_role;

create table public.inquiry_attention_items (
  thread_id uuid not null references public.inquiry_threads(id) on delete cascade,
  reason text not null check (reason in ('no_matches','urgent_event','delivery_failed','static_listing')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key(thread_id,reason)
);
alter table public.inquiry_attention_items enable row level security;
revoke all on public.inquiry_attention_items from public,anon,authenticated;
grant select,update on public.inquiry_attention_items to authenticated;
grant all on public.inquiry_attention_items to service_role;
create policy "admins read inquiry attention" on public.inquiry_attention_items for select to authenticated
  using ((select public.is_marketplace_admin()));
create policy "admins resolve inquiry attention" on public.inquiry_attention_items for update to authenticated
  using ((select public.is_marketplace_admin())) with check ((select public.is_marketplace_admin()));

create or replace function private.inquiry_event_open(p_inquiry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.inquiries i where i.id=p_inquiry_id
   and i.status not in ('withdrawn','closed','not_booked')
   and i.booking_outcome not in ('booked','not_booked','disputed')
   and (i.event_date + coalesce(i.event_start_time,time '23:59:59')) at time zone
     coalesce((select name from pg_catalog.pg_timezone_names where name=i.time_zone),'America/New_York') > now());
$$;
revoke all on function private.inquiry_event_open(uuid) from public,anon,authenticated;


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
  response_hours integer;
  final_reminder integer;
begin
  select * into thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;

  if thread.id is null
    or thread.status <> 'awaiting_response'
    or thread.first_instructor_message_at is not null then
    return;
  end if;

  response_hours := case when thread.response_policy_version=1 then 72 else 48 end;
  final_reminder := case when thread.response_policy_version=1 then 48 else 47 end;
  if thread.response_policy_version=2 then started_at := thread.assigned_at; end if;

  if thread.response_clock_started_at is null then
    update public.inquiry_threads
    set response_clock_started_at = started_at,
        response_due_at = started_at + response_hours * interval '1 hour',
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

  if thread.assignment_source='static_support' then instructor_email := 'hello@hirelinedancers.com'; end if;
  if (reminders_enabled or thread.response_policy_version=2) and instructor_email is not null then
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
        'response_reminder_' || final_reminder::text,
        started_at + final_reminder * interval '1 hour',
        'thread:' || thread.id::text || ':response-reminder-' || final_reminder::text
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
      started_at + response_hours * interval '1 hour',
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
      started_at + response_hours * interval '1 hour',
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
      'response_reminder_47',
      'response_reminder_48',
      'response_timeout_instructor',
      'response_timeout_organizer'
    );
  get diagnostics canceled_count = row_count;
  return canceled_count;
end;
$$;

create or replace function private.start_new_inquiry_clock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.response_policy_version=2 then
   perform private.start_inquiry_thread_response_clock(new.id,new.assigned_at);
   if new.assignment_source='static_support' then
     insert into public.inquiry_attention_items(thread_id,reason) values(new.id,'static_listing') on conflict do nothing;
   end if;
   if exists(select 1 from public.inquiries i where i.id=new.inquiry_id and i.event_date<=current_date+2) then
     insert into public.inquiry_attention_items(thread_id,reason) values(new.id,'urgent_event') on conflict do nothing;
   end if;
 end if;
 return new;
end; $$;
revoke all on function private.start_new_inquiry_clock() from public,anon,authenticated;
create trigger start_new_inquiry_clock after insert on public.inquiry_threads
 for each row execute function private.start_new_inquiry_clock();

create or replace function private.inquiry_candidate_matches(p_inquiry_id uuid,p_profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from public.inquiries i
 join public.instructor_profiles p on p.id=p_profile_id and p.status='published' and i.event_type=any(p.event_types)
 join public.instructor_service_markets m on m.instructor_profile_id=p.id and m.accepting_inquiries and m.fallback_eligible
 join public.service_markets market on market.slug=m.service_market_slug and market.active
 join public.service_market_localities l on l.service_market_slug=m.service_market_slug
 where i.id=p_inquiry_id and l.city_normalized=private.normalize_market_value(i.event_city)
 and l.region_normalized=private.normalize_market_value(i.event_region)
 and (i.guest_count is null or p.max_group_size is null or i.guest_count<=p.max_group_size)
 and (select count(*) from public.inquiry_threads t where t.instructor_profile_id=p.id
      and t.status in ('awaiting_response','active')) < m.max_active_thread_count
 and exists(select 1 from public.instructor_private_settings s where s.instructor_profile_id=p.id and s.inquiry_email is not null)
 and not exists(select 1 from public.inquiry_threads t where t.inquiry_id=i.id and t.instructor_profile_id=p.id));
$$;
revoke all on function private.inquiry_candidate_matches(uuid,uuid) from public,anon,authenticated;

create or replace function private.prepare_inquiry_recommendations(p_thread_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.inquiry_threads%rowtype;
begin
 select * into t from public.inquiry_threads where id=p_thread_id for update;
 if t.id is null or not private.inquiry_event_open(t.inquiry_id)
   or not (t.status in ('timed_out','declined') or t.timed_out_at is not null) then return; end if;
 if not exists(select 1 from public.inquiry_recommendations where source_thread_id=t.id) then
   insert into public.inquiry_recommendations(source_thread_id,instructor_profile_id,position)
   select t.id,candidate.id,row_number() over() from (
     select p.id from public.instructor_profiles p
     where private.inquiry_candidate_matches(t.inquiry_id,p.id)
     order by (select count(*) from public.inquiry_threads open_thread where open_thread.instructor_profile_id=p.id
       and open_thread.status in ('awaiting_response','active')),p.id limit 2
   ) candidate on conflict do nothing;
 end if;
 if not exists(select 1 from public.inquiry_recommendations r where r.source_thread_id=t.id
     and private.inquiry_candidate_matches(t.inquiry_id,r.instructor_profile_id)) then
   insert into public.inquiry_attention_items(thread_id,reason) values(t.id,'no_matches') on conflict do nothing;
 end if;
end; $$;
revoke all on function private.prepare_inquiry_recommendations(uuid) from public,anon,authenticated;

create or replace function public.get_inquiry_recommendations(p_thread_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.inquiry_threads%rowtype; result jsonb;
begin
 select * into t from public.inquiry_threads where id=p_thread_id;
 if t.id is null or ((select auth.role()) is distinct from 'service_role'
    and not private.is_inquiry_organizer(t.inquiry_id) and not public.is_marketplace_admin()) then
   raise exception 'Inquiry not found or access denied'; end if;
 perform private.prepare_inquiry_recommendations(t.id);
 if not private.inquiry_event_open(t.inquiry_id) then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'instructor_profile_id',p.id,'display_name',p.display_name,'slug',p.slug,
   'bio',left(p.bio,300),'city',p.city,'region',p.region,
   'headshot_path',photo.storage_path,'headshot_url',photo.external_url) order by r.position),'[]'::jsonb)
 into result from public.inquiry_recommendations r
 join public.instructor_profiles p on p.id=r.instructor_profile_id
 left join lateral(select storage_path,external_url from public.profile_media where instructor_profile_id=p.id
   and media_type='headshot' and status='ready' order by sort_order,id limit 1) photo on true
 where r.source_thread_id=t.id and private.inquiry_candidate_matches(t.inquiry_id,p.id);
 return result;
end; $$;
revoke all on function public.get_inquiry_recommendations(uuid) from public,anon,authenticated;
grant execute on function public.get_inquiry_recommendations(uuid) to authenticated,service_role;


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
      and private.inquiry_event_open(thread.inquiry_id)
      and thread.response_due_at is not null
      and thread.response_due_at <= now()
    order by thread.response_due_at, thread.id
    for update skip locked
  ), transitioned as (
    update public.inquiry_threads thread
    set status = 'timed_out',
        timed_out_at = now(),
        fallback_review_requested_at = now(),
        closed_at = case when thread.response_policy_version=1 then now() else null end,
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

create or replace function private.inquiry_status_followup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.response_policy_version=2 and new.status in ('timed_out','declined') and old.status is distinct from new.status then
   perform private.prepare_inquiry_recommendations(new.id);
 end if;
 return new;
end; $$;
revoke all on function private.inquiry_status_followup() from public,anon,authenticated;
create trigger inquiry_status_followup after update of status on public.inquiry_threads
 for each row execute function private.inquiry_status_followup();


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
    if existing.thread_id <> p_thread_id or not private.inquiry_message_matches_submission(existing, clean_body) then
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
  if (thread.status not in ('awaiting_response', 'active')
    and not (thread.status='timed_out' and thread.response_policy_version=2 and private.inquiry_event_open(thread.inquiry_id)))
    or (thread.response_policy_version=2 and not private.inquiry_event_open(thread.inquiry_id)
      and not private.thread_has_paid_booking(thread.id)) then
    raise exception 'This inquiry thread is closed for replies';
  end if;

  if thread.status='timed_out' and not private.inquiry_event_open(thread.inquiry_id) then
    raise exception 'This event is no longer open'; end if;

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
        when (participant.participant_role = 'instructor' or admin_static_reply) then 'active'
        else status
      end,
      first_instructor_message_at = case
        when (participant.participant_role = 'instructor' or admin_static_reply)
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

  if (participant.participant_role = 'instructor' or admin_static_reply)
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
      case when thread.response_policy_version=2 then
        exists(select 1 from public.inquiries i where i.id=thread.inquiry_id
          and (i.booked_instructor_profile_id=thread.instructor_profile_id
            or (i.booked_instructor_profile_id is null and thread.status in ('awaiting_response','active','timed_out'))))
      else not exists (
        select 1 from public.inquiry_threads newer_thread
        where newer_thread.inquiry_id=thread.inquiry_id and newer_thread.assignment_order>thread.assignment_order
      ) end
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
      'can_reply', (thread.status in ('awaiting_response','active') and
          (thread.response_policy_version=1 or private.inquiry_event_open(thread.inquiry_id) or private.thread_has_paid_booking(thread.id))) or
        (thread.status='timed_out' and thread.response_policy_version=2 and private.inquiry_event_open(thread.inquiry_id)),
      'can_recommend', thread.response_policy_version=2 and private.inquiry_event_open(thread.inquiry_id) and
        (thread.status in ('timed_out','declined') or thread.timed_out_at is not null),
      'is_current_assignment',
      is_admin or caller_role = 'organizer' or is_current_assignment
    ),
    'inquiry', case
      when is_admin or caller_role = 'organizer' then
        ((to_jsonb(inquiry) || coalesce(thread.inquiry_snapshot,'{}'::jsonb)) || jsonb_build_object('message', coalesce((select original.original_body from public.inquiry_message_originals original join public.inquiry_messages initial on initial.id=original.message_id where initial.thread_id=thread.id and initial.message_kind='inquiry' order by initial.id limit 1), thread.inquiry_snapshot->>'message', inquiry.message))) - 'messaging_search_vector'
      when is_current_assignment and private.thread_has_paid_booking(thread.id) then
        ((to_jsonb(inquiry) || coalesce(thread.inquiry_snapshot,'{}'::jsonb)) || jsonb_build_object('message', coalesce((select original.original_body from public.inquiry_message_originals original join public.inquiry_messages initial on initial.id=original.message_id where initial.thread_id=thread.id and initial.message_kind='inquiry' order by initial.id limit 1), thread.inquiry_snapshot->>'message', inquiry.message))) - 'messaging_search_vector'
      when is_current_assignment then
        ((to_jsonb(inquiry) || coalesce(thread.inquiry_snapshot,'{}'::jsonb)) - array[
          'messaging_search_vector',
          'email',
          'contact_email',
          'contact_phone_e164'
        ]::text[]) || jsonb_build_object(
          'message', private.mask_contact_details(coalesce(thread.inquiry_snapshot->>'message', inquiry.message))
        )
      else
        (to_jsonb(inquiry) || coalesce(thread.inquiry_snapshot,'{}'::jsonb)) - array[
          'messaging_search_vector',
          'email',
          'contact_email',
          'contact_phone_e164',
          'message',
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
    current_date + 2,
    p_event_date + 2,
    coalesce(p_fallback_consent, false),
    case when coalesce(p_fallback_consent, false) then now() end
  ) returning id into inquiry_id;

  return inquiry_id;
end;
$$;

create or replace function public.contact_recommended_instructor(
  p_thread_id uuid,
  p_instructor_profile_id uuid,
  p_message text default null
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
  clean_note text := nullif(trim(coalesce(p_message, '')), '');
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if p_instructor_profile_id is null then
    raise exception 'Instructor profile is required';
  end if;
  if char_length(coalesce(clean_note, '')) > 4000 then
    raise exception 'Message must be 4,000 characters or fewer';
  end if;

  select * into source_thread
  from public.inquiry_threads
  where id = p_thread_id
  for update;
  if source_thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if source_thread.status not in ('timed_out', 'declined') and source_thread.timed_out_at is null then
    raise exception 'Fallback routing requires a timed-out or declined thread';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(source_thread.inquiry_id::text, 77)
  );

  select * into inquiry
  from public.inquiries
  where id = source_thread.inquiry_id
  for update;
  if inquiry.organizer_account_id is distinct from caller_id then raise exception 'Inquiry not found or access denied'; end if;
  if not private.inquiry_event_open(inquiry.id) then raise exception 'This event is no longer open'; end if;
  select id into created_thread_id from public.inquiry_threads where inquiry_id=inquiry.id and instructor_profile_id=p_instructor_profile_id;
  if created_thread_id is not null then return created_thread_id; end if;
  if inquiry.event_date is null or inquiry.event_date < current_date then
    raise exception 'The event date has passed';
  end if;

  if not exists (
    select 1
    from public.inquiry_recommendations candidate
    where candidate.source_thread_id=source_thread.id and candidate.instructor_profile_id=p_instructor_profile_id
      and private.inquiry_candidate_matches(inquiry.id,p_instructor_profile_id)
  ) then
    raise exception 'Instructor is not eligible for this fallback';
  end if;

  if (select count(*) from public.inquiry_threads where created_by=caller_id and assigned_at>now()-interval '1 hour')>=5 then
    raise exception 'Please wait before sending more inquiries'; end if;
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
    'organizer_selected',
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
    coalesce(clean_note,inquiry.message, '')
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

  -- Thread rows are readable by participants, so retain only a masked snapshot.
  -- The message trigger stores any original contact details for authorized access.
  update public.inquiry_threads set inquiry_snapshot=jsonb_build_object('message',private.mask_contact_details(coalesce(clean_note,inquiry.message,''))) where id=created_thread_id;

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

  return created_thread_id;
end;
$$;

revoke all on function public.contact_recommended_instructor(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.contact_recommended_instructor(uuid,uuid,text) to authenticated;


create or replace function private.inquiry_notification_needed(p_job_id bigint)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare j public.inquiry_thread_notification_jobs%rowtype; t public.inquiry_threads%rowtype; i public.inquiries%rowtype;
begin
 select * into j from public.inquiry_thread_notification_jobs where id=p_job_id;
 select * into t from public.inquiry_threads where id=j.thread_id;
 select * into i from public.inquiries where id=t.inquiry_id;
 if j.id is null then return false; end if;
 if j.notification_type='booking_update' then return t.id is not null; end if;
 if i.status='withdrawn' then return false; end if;
 if j.notification_type='new_message' then return t.status in ('awaiting_response','active','declined','timed_out'); end if;
 if not private.inquiry_event_open(t.inquiry_id) then return false; end if;
 return case
 when j.notification_type='new_thread' then t.status='awaiting_response'
 when j.notification_type in ('response_reminder_24','response_reminder_47','response_reminder_48') then
   t.status='awaiting_response' and t.first_instructor_message_at is null and t.response_due_at>now()
   and (j.notification_type<>'response_reminder_24' or now()<t.response_clock_started_at+
     case when t.response_policy_version=1 then interval '48 hours' else interval '47 hours' end)
 when j.notification_type in ('response_timeout_instructor','response_timeout_organizer') then
   t.status='timed_out' and t.first_instructor_message_at is null
 when j.notification_type='thread_declined' then t.status='declined'
 when j.notification_type='fallback_routed_organizer' then t.status in ('awaiting_response','active','declined','timed_out')
 else false end;
end; $$;
revoke all on function private.inquiry_notification_needed(bigint) from public,anon,authenticated;
create or replace function public.inquiry_thread_notification_job_is_sendable(p_job_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.role())='service_role' and exists(
 select 1 from public.inquiry_thread_notification_jobs j where j.id=p_job_id and j.status='processing'
 and private.inquiry_notification_needed(j.id));
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
  set status='canceled',completed_at=now(),locked_at=null,last_error='Notification is no longer needed'
  where job.status='pending' and job.available_at<=now()
    and not private.inquiry_notification_needed(job.id);

  -- A crashed worker might have sent a text. Do not blindly resend an
  -- ambiguous Twilio request; delivery callbacks and attention items reconcile it.
  update public.inquiry_thread_notification_jobs stale set status='failed',completed_at=now(),locked_at=null,
    last_error='SMS acceptance is uncertain; review delivery before retrying'
  where stale.channel='sms' and stale.status='processing' and stale.locked_at<now()-greatest(p_lock_timeout,interval '1 minute');

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
        and failed_job.channel='email'
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

create or replace function public.claim_inquiry_thread_notification_jobs_v2(p_limit integer default 10,p_lock_timeout interval default interval '10 minutes')
returns setof jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 return query select to_jsonb(j) || jsonb_build_object('response_policy_version',t.response_policy_version,
   'delivered_to_phone_e164',q.recipient_phone_e164,'inquiry_recipient_id',q.inquiry_recipient_id,
   'provider_message_id',q.provider_message_id)
 from public.claim_inquiry_thread_notification_jobs(p_limit,p_lock_timeout) j
 join public.inquiry_threads t on t.id=j.thread_id join public.inquiry_thread_notification_jobs q on q.id=j.job_id;
end; $$;
revoke all on function public.claim_inquiry_thread_notification_jobs_v2(integer,interval) from public,anon,authenticated;
grant execute on function public.claim_inquiry_thread_notification_jobs_v2(integer,interval) to service_role;


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
    if job.channel='email' and job.notification_type = 'new_thread'
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
    if job.channel='email' and job.notification_type = 'new_thread'
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
  if job.channel='email' and job.notification_type = 'new_thread'
    and job.inquiry_recipient_id is not null then
    update public.inquiry_recipients
    set email_delivery_status = 'failed',
        updated_at = now()
    where id = job.inquiry_recipient_id;
  end if;
  return 'failed';
end;
$$;

create or replace function public.set_inquiry_booked_instructor_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.booking_outcome='booked' then
   if new.booked_instructor_profile_id is null then
     if not exists(select 1 from public.inquiry_threads where inquiry_id=new.id and response_policy_version=2) then
       select instructor_profile_id into new.booked_instructor_profile_id from public.inquiry_threads where inquiry_id=new.id and instructor_profile_id is not null order by assignment_order desc limit 1;
     elsif (select count(*) from public.inquiry_threads where inquiry_id=new.id and instructor_profile_id is not null)>1 then
       raise exception 'Choose the instructor conversation before recording a booking'; end if;
     new.booked_instructor_profile_id:=coalesce(new.booked_instructor_profile_id,new.instructor_profile_id);
   end if;
 else new.booked_instructor_profile_id:=null; end if;
 return new;
end; $$;

create or replace function public.report_thread_booking_outcome(p_thread_id uuid,p_outcome text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.inquiry_threads%rowtype; i public.inquiries%rowtype; caller uuid:=(select auth.uid());
begin
 select * into t from public.inquiry_threads where id=p_thread_id;
 select * into i from public.inquiries where id=t.inquiry_id for update;
 if caller is null or not private.is_inquiry_thread_participant(t.id) then raise exception 'Inquiry not found or access denied'; end if;
 if not exists(select 1 from public.inquiry_threads where inquiry_id=i.id and response_policy_version=2) then
   perform public.report_booking_outcome(i.id,p_outcome);
   return;
 end if;
 if p_outcome not in ('booked','not_booked','still_deciding') then raise exception 'Invalid booking outcome'; end if;
 if i.status='withdrawn' or i.completion_status<>'unknown' then raise exception 'This event is closed'; end if;
 if i.booking_outcome='booked' and p_outcome<>'booked' then raise exception 'This event is already marked as booked'; end if;
 if i.booked_instructor_profile_id is not null and i.booked_instructor_profile_id is distinct from t.instructor_profile_id then
   raise exception 'Another instructor is already recorded for this booking'; end if;
 update public.inquiry_threads set booking_outcome=p_outcome where id=t.id;
 insert into public.inquiry_outcome_reports(inquiry_id,reporter_account_id,outcome)
 values(i.id,caller,p_outcome) on conflict(inquiry_id,reporter_account_id) do update set outcome=excluded.outcome,updated_at=now();
 if p_outcome='booked' then
   if t.instructor_profile_id is null then raise exception 'An instructor must be connected before recording a booking'; end if;
   update public.inquiries set booked_instructor_profile_id=t.instructor_profile_id,booking_outcome='booked',status='booked',
     outcome_reported_by=caller,outcome_reported_at=now(),booking_event_date=coalesce(booking_event_date,event_date),outcome_next_ask_at=null where id=i.id;
   update public.inquiry_threads set status='closed',closed_at=now() where inquiry_id=i.id and id<>t.id
     and status in ('awaiting_response','active','timed_out');
   update public.inquiry_threads set status='active',closed_at=null where id=t.id;
   update public.inquiry_notification_jobs j set status='canceled',completed_at=now(),last_error='Event booked'
     from public.inquiry_recipients r where r.inquiry_id=i.id and j.inquiry_recipient_id=r.id
       and j.notification_type='booking_followup' and j.status='pending';
   update public.inquiry_thread_notification_jobs j set status='canceled',completed_at=now(),last_error='Event booked'
     from public.inquiry_threads x where x.inquiry_id=i.id and j.thread_id=x.id and j.status='pending'
     and j.notification_type not in ('new_message','booking_update');
 elsif p_outcome='not_booked' then
   update public.inquiry_threads set status='closed',closed_at=now() where id=t.id;
   perform private.cancel_inquiry_thread_response_jobs(t.id,'Conversation closed');
 end if;
end; $$;
revoke all on function public.report_thread_booking_outcome(uuid,text) from public,anon,authenticated;
grant execute on function public.report_thread_booking_outcome(uuid,text) to authenticated;


create or replace function public.report_booking_outcome(
  p_inquiry_id uuid,
  p_outcome text,
  p_booking_value_cents integer default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
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

  select * into inquiry
  from public.inquiries
  where id = p_inquiry_id
  for update;
  if inquiry.id is null then
    raise exception 'Inquiry not found';
  end if;

  select exists (
    select 1
    from public.inquiry_recipients recipient
    join public.instructor_profiles profile on profile.id = recipient.instructor_profile_id
    where recipient.inquiry_id = p_inquiry_id
      and profile.account_id = auth.uid()
  ) into is_recipient;

  if inquiry.organizer_account_id <> auth.uid()
    and not is_recipient
    and not public.is_marketplace_admin() then
    raise exception 'Not allowed to report this outcome';
  end if;

  if (select count(*) from public.inquiry_threads where inquiry_id=p_inquiry_id)>1
    and exists(select 1 from public.inquiry_threads where inquiry_id=p_inquiry_id and response_policy_version=2) then
    raise exception 'Use the instructor conversation to report this outcome'; end if;
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
    booking_value_cents = case
      when resolved_outcome = 'booked' then p_booking_value_cents
      else booking_value_cents
    end,
    outcome_note = nullif(trim(p_note), ''),
    outcome_reported_by = auth.uid(),
    outcome_reported_at = now(),
    outcome_next_ask_at = case
      when is_recipient then null
      else outcome_next_ask_at
    end,
    status = case
      when resolved_outcome = 'booked' then 'booked'
      when resolved_outcome = 'not_booked' then 'not_booked'
      when status in ('booked', 'not_booked') and first_responded_at is not null then 'responded'
      when status in ('booked', 'not_booked') then 'submitted'
      else status
    end,
    closed_at = case
      when resolved_outcome in ('booked', 'not_booked') then now()
      else null
    end
  where id = p_inquiry_id;
end;
$$;

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
    and (inquiry.booked_instructor_profile_id is null or inquiry.booked_instructor_profile_id=thread.instructor_profile_id)
  order by thread.assignment_order desc
  limit 1;

  if profile.id is null then
    raise exception 'Only the currently contacted instructor can submit this feedback';
  end if;

  if p_stage='booking' and exists(select 1 from public.inquiry_threads where inquiry_id=inquiry.id and response_policy_version=2) then
    perform public.report_thread_booking_outcome((select id from public.inquiry_threads where inquiry_id=inquiry.id and instructor_profile_id=profile.id),p_response);
    resolved_event_date := coalesce(p_confirmed_event_date,inquiry.booking_event_date,inquiry.event_date);
    insert into public.inquiry_followup_responses(inquiry_id,instructor_account_id,stage,response,confirmed_event_date,private_comment)
    values(inquiry.id,(select auth.uid()),'booking',p_response,
      case when p_response='booked' then resolved_event_date end,nullif(trim(p_private_comment),''))
    on conflict(inquiry_id,instructor_account_id,stage) do update set response=excluded.response,
      confirmed_event_date=excluded.confirmed_event_date,private_comment=excluded.private_comment,submitted_at=now(),updated_at=now();
    if p_response='booked' then
      update public.inquiries set booking_event_date=resolved_event_date where id=inquiry.id;
    end if;
    update public.inquiry_notification_jobs job set status='canceled',completed_at=now(),locked_at=null,
      last_error='Follow-up answered before delivery'
    from public.inquiry_recipients recipient where recipient.inquiry_id=inquiry.id
      and recipient.instructor_profile_id=profile.id and job.inquiry_recipient_id=recipient.id
      and job.notification_type='booking_followup' and job.status='pending';
    return;
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

-- Verified, explicitly enabled instructor texts. Historical SMS consent is not reused.

create table public.instructor_sms_preferences (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at timestamptz,
  consent_at timestamptz,
  consent_version text,
  enabled boolean not null default false,
  opted_out_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not enabled or (phone_e164 is not null and verified_at is not null and consent_at is not null and opted_out_at is null))
);
alter table public.instructor_sms_preferences enable row level security;
revoke all on public.instructor_sms_preferences from public,anon,authenticated;
grant select on public.instructor_sms_preferences to authenticated;
grant all on public.instructor_sms_preferences to service_role;
create policy "instructors read own text preferences" on public.instructor_sms_preferences for select to authenticated
 using (account_id=(select auth.uid()) or (select public.is_marketplace_admin()));

create table private.instructor_sms_verifications (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
 phone_e164 text not null, created_at timestamptz not null default now(), attempts smallint not null default 0,
 completed_at timestamptz
);
create index instructor_sms_verifications_account_time_idx on private.instructor_sms_verifications(account_id,created_at desc);
create index instructor_sms_verifications_phone_time_idx on private.instructor_sms_verifications(phone_e164,created_at desc);
alter table private.instructor_sms_verifications enable row level security;
revoke all on private.instructor_sms_verifications from public,anon,authenticated;
grant all on private.instructor_sms_verifications to service_role;

create or replace function public.reserve_instructor_sms_verification(p_account_id uuid,p_phone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Enter a phone number with country code'; end if;
 if not exists(select 1 from public.instructor_profiles where account_id=p_account_id) then raise exception 'Instructor account required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text,91));
 perform pg_advisory_xact_lock(hashtextextended(p_phone,92));
 if exists(select 1 from private.instructor_sms_verifications where account_id=p_account_id and created_at>now()-interval '1 minute')
 or (select count(*) from private.instructor_sms_verifications where account_id=p_account_id and created_at>now()-interval '1 hour')>=5
 or (select count(*) from private.instructor_sms_verifications where account_id=p_account_id and created_at>now()-interval '1 day')>=10
 or (select count(*) from private.instructor_sms_verifications where phone_e164=p_phone and created_at>now()-interval '1 day')>=10 then
   raise exception 'Please wait before requesting another verification code'; end if;
 insert into private.instructor_sms_verifications(account_id,phone_e164) values(p_account_id,p_phone) returning id into result;
 return result;
end; $$;

create or replace function public.check_instructor_sms_verification(p_account_id uuid,p_verification_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare phone text;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 update private.instructor_sms_verifications set attempts=attempts+1
 where id=p_verification_id and account_id=p_account_id and completed_at is null
   and created_at>now()-interval '10 minutes' and attempts<5 returning phone_e164 into phone;
 if phone is null then raise exception 'Request a new verification code'; end if;
 return phone;
end; $$;

create or replace function public.enable_verified_instructor_sms(p_account_id uuid,p_verification_id uuid,p_phone text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 update private.instructor_sms_verifications set completed_at=now()
 where id=p_verification_id and account_id=p_account_id and phone_e164=p_phone
   and completed_at is null and created_at>now()-interval '10 minutes';
 if not found then raise exception 'Verification expired'; end if;
 insert into public.instructor_sms_preferences(account_id,phone_e164,verified_at,consent_at,consent_version,enabled)
 values(p_account_id,p_phone,now(),now(),'2026-09-16-inquiry-alerts-v1',true)
 on conflict(account_id) do update set phone_e164=excluded.phone_e164,verified_at=now(),consent_at=now(),
   consent_version=excluded.consent_version,enabled=true,opted_out_at=null,updated_at=now();
end; $$;

create or replace function public.disable_instructor_sms(p_account_id uuid default null,p_phone text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 update public.instructor_sms_preferences set enabled=false,opted_out_at=now(),updated_at=now()
 where (p_account_id is not null and account_id=p_account_id) or (p_phone is not null and phone_e164=p_phone);
 update public.inquiry_thread_notification_jobs j set status='canceled',completed_at=now(),last_error='SMS disabled'
 where channel='sms' and status='pending' and ((p_account_id is not null and j.recipient_account_id=p_account_id)
   or (p_phone is not null and j.recipient_phone_e164=p_phone));
end; $$;

create or replace function private.enqueue_instructor_thread_sms()
returns trigger language plpgsql security definer set search_path='' as $$
declare phone text;
begin
 if new.channel<>'email' or new.notification_type not in ('new_thread','new_message','response_reminder_24','response_reminder_47','response_timeout_instructor') then return new; end if;
 select s.phone_e164 into phone from public.instructor_sms_preferences s
 join public.inquiry_threads t on t.id=new.thread_id and t.instructor_account_id=s.account_id
 where s.account_id=new.recipient_account_id and s.enabled and s.verified_at is not null and s.opted_out_at is null
   and t.response_policy_version=2;
 if phone is not null then
   insert into public.inquiry_thread_notification_jobs(thread_id,inquiry_recipient_id,message_id,recipient_account_id,recipient_email,
     recipient_phone_e164,channel,notification_type,available_at,dedupe_key)
   values(new.thread_id,new.inquiry_recipient_id,new.message_id,new.recipient_account_id,new.recipient_email,
     phone,'sms',new.notification_type,new.available_at,new.dedupe_key||':sms') on conflict(dedupe_key) do nothing;
 end if;
 return new;
end; $$;
create trigger enqueue_instructor_thread_sms after insert on public.inquiry_thread_notification_jobs
 for each row execute function private.enqueue_instructor_thread_sms();

create or replace function public.get_inquiry_sms_destination(p_job_id bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare phone text;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 select s.phone_e164 into phone from public.inquiry_thread_notification_jobs j
 join public.instructor_sms_preferences s on s.account_id=j.recipient_account_id and s.phone_e164=j.recipient_phone_e164
 where j.id=p_job_id and j.channel='sms' and s.enabled and s.verified_at is not null and s.opted_out_at is null;
 return phone;
end; $$;

create table private.inquiry_delivery_receipts (
 provider text not null, provider_message_id text not null, status text not null, occurred_at timestamptz not null,
 error text, primary key(provider,provider_message_id)
);
alter table private.inquiry_delivery_receipts enable row level security;
revoke all on private.inquiry_delivery_receipts from public,anon,authenticated;
grant all on private.inquiry_delivery_receipts to service_role;

create or replace function public.record_inquiry_notification_delivery(
 p_provider text,p_provider_message_id text,p_status text,p_occurred_at timestamptz,
 p_job_id bigint default null,p_phone text default null,p_error text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare j public.inquiry_thread_notification_jobs%rowtype;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Service role required'; end if;
 if p_provider not in ('resend','twilio') or p_status not in ('sent','delivered','failed','bounced','complained')
   or p_provider_message_id is null or p_occurred_at is null then return; end if;
 insert into private.inquiry_delivery_receipts(provider,provider_message_id,status,occurred_at,error)
 values(p_provider,p_provider_message_id,p_status,p_occurred_at,left(p_error,500))
 on conflict(provider,provider_message_id) do update set status=excluded.status,occurred_at=excluded.occurred_at,error=excluded.error
 where private.inquiry_delivery_receipts.occurred_at<=excluded.occurred_at
   and not(private.inquiry_delivery_receipts.status='delivered' and excluded.status='sent');
 select * into j from public.inquiry_thread_notification_jobs
 where (p_provider='resend' and channel='email' and provider_message_id=p_provider_message_id)
    or (p_provider='twilio' and channel='sms' and id=p_job_id and recipient_phone_e164=p_phone
       and (provider_message_id is null or provider_message_id=p_provider_message_id))
 for update;
 if j.id is null then return; end if;
 if j.delivery_updated_at is not null and j.delivery_updated_at>p_occurred_at then return; end if;
 if j.delivery_status='delivered' and p_status='sent' then return; end if;
 update public.inquiry_thread_notification_jobs set provider_message_id=p_provider_message_id,
   delivery_status=p_status,delivery_updated_at=p_occurred_at,delivery_error=left(p_error,500)
 where id=j.id;
 if p_status in ('failed','bounced','complained') then
   insert into public.inquiry_attention_items(thread_id,reason) values(j.thread_id,'delivery_failed')
   on conflict(thread_id,reason) do update set resolved_at=null;
 end if;
end; $$;

create or replace function private.flag_inquiry_delivery_failure()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.status='failed' and old.status is distinct from new.status)
    or (new.notification_type='new_thread' and new.last_error is not null and old.last_error is distinct from new.last_error) then
   insert into public.inquiry_attention_items(thread_id,reason) values(new.thread_id,'delivery_failed')
   on conflict(thread_id,reason) do update set resolved_at=null;
 end if;
 return new;
end; $$;
create trigger flag_inquiry_delivery_failure after update of status,last_error on public.inquiry_thread_notification_jobs
 for each row execute function private.flag_inquiry_delivery_failure();

create or replace function private.reconcile_early_delivery_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare receipt private.inquiry_delivery_receipts%rowtype;
begin
 if new.provider_message_id is not null and old.provider_message_id is distinct from new.provider_message_id then
   select * into receipt from private.inquiry_delivery_receipts where provider=case when new.channel='email' then 'resend' else 'twilio' end
     and provider_message_id=new.provider_message_id;
   if receipt.provider_message_id is not null then
     update public.inquiry_thread_notification_jobs set delivery_status=receipt.status,delivery_updated_at=receipt.occurred_at,delivery_error=receipt.error where id=new.id;
     if receipt.status in ('failed','bounced','complained') then
       insert into public.inquiry_attention_items(thread_id,reason) values(new.thread_id,'delivery_failed') on conflict(thread_id,reason) do update set resolved_at=null;
     end if;
   end if;
 end if;
 return new;
end; $$;
create trigger reconcile_early_delivery_receipt after update of provider_message_id on public.inquiry_thread_notification_jobs
 for each row execute function private.reconcile_early_delivery_receipt();
revoke all on function private.reconcile_early_delivery_receipt() from public,anon,authenticated;

revoke all on function private.enqueue_instructor_thread_sms() from public,anon,authenticated;
revoke all on function private.flag_inquiry_delivery_failure() from public,anon,authenticated;
revoke all on function public.reserve_instructor_sms_verification(uuid,text) from public,anon,authenticated;
revoke all on function public.check_instructor_sms_verification(uuid,uuid) from public,anon,authenticated;
revoke all on function public.enable_verified_instructor_sms(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.disable_instructor_sms(uuid,text) from public,anon,authenticated;
revoke all on function public.get_inquiry_sms_destination(bigint) from public,anon,authenticated;
revoke all on function public.record_inquiry_notification_delivery(text,text,text,timestamptz,bigint,text,text) from public,anon,authenticated;
grant execute on function public.reserve_instructor_sms_verification(uuid,text) to service_role;
grant execute on function public.check_instructor_sms_verification(uuid,uuid) to service_role;
grant execute on function public.enable_verified_instructor_sms(uuid,uuid,text) to service_role;
grant execute on function public.disable_instructor_sms(uuid,text) to service_role;
grant execute on function public.get_inquiry_sms_destination(bigint) to service_role;
grant execute on function public.record_inquiry_notification_delivery(text,text,text,timestamptz,bigint,text,text) to service_role;


-- A paid booking exposes an inquiry only to the instructor paid for that booking.
drop policy if exists "participants read inquiries" on public.inquiries;
create policy "participants read inquiries" on public.inquiries for select to authenticated
  using (organizer_account_id=(select auth.uid()) or public.is_marketplace_admin()
    or exists (select 1 from public.bookings booking where booking.inquiry_id=inquiries.id
      and booking.instructor_account_id=(select auth.uid()) and booking.paid_at is not null));

-- Several quotes can exist, but only one can be signed for payment per event.
create unique index bookings_one_payable_per_inquiry_idx on public.bookings(inquiry_id)
  where status in ('awaiting_payment','payment_processing','confirmed','completed');

create or replace function public.get_thread_booking(p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role text;
  thread public.inquiry_threads%rowtype;
  latest public.bookings%rowtype;
  inquiry public.inquiries%rowtype;
  defaults jsonb := null;
  payouts_ready boolean := null;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  select * into thread from public.inquiry_threads where id = p_thread_id;
  if thread.id is null then
    raise exception 'Inquiry thread not found or access denied';
  end if;

  select participant.participant_role into caller_role
  from public.inquiry_thread_participants participant
  where participant.thread_id = thread.id
    and participant.account_id = caller_id
    and participant.left_at is null;
  if caller_role is null then
    if public.is_marketplace_admin() then
      caller_role := 'admin';
    else
      raise exception 'Inquiry thread not found or access denied';
    end if;
  end if;

  select * into latest
  from public.bookings booking
  where booking.thread_id = thread.id
  order by booking.created_at desc, booking.version desc
  limit 1;

  select * into inquiry from public.inquiries where id = thread.inquiry_id;

  if caller_role = 'instructor' then
    payouts_ready := private.instructor_payouts_ready(thread.instructor_profile_id);
    select jsonb_build_object(
      'hourly_rate_cents', settings.hourly_rate_cents,
      'minimum_hours', settings.minimum_hours,
      'cancellation_policy', coalesce(settings.default_cancellation_policy, 'standard'),
      'custom_cancellation_windows', settings.custom_cancellation_windows,
      'standard_cancellation_windows', private.standard_cancellation_windows(),
      'liability_insurance_status', profile.liability_insurance_status,
      'provides_speakers', coalesce(profile.provides_speakers, false),
      'provides_microphone', coalesce(profile.provides_microphone, false),
      'event_date', inquiry.event_date,
      'start_time', inquiry.event_start_time,
      'time_zone', coalesce(nullif(inquiry.time_zone, ''), 'America/New_York'),
      'venue_name', inquiry.venue_name,
      'event_city', inquiry.event_city,
      'event_region', inquiry.event_region
    ) into defaults
    from public.instructor_profiles profile
    left join public.instructor_private_settings settings
      on settings.instructor_profile_id = profile.id
    where profile.id = thread.instructor_profile_id;
  end if;

  return jsonb_build_object(
    'role', caller_role,
    'thread_status', thread.status,
    'is_current_assignment', case when thread.response_policy_version=2 then
      private.inquiry_event_open(thread.inquiry_id) or private.thread_has_paid_booking(thread.id)
    else not exists (
      select 1 from public.inquiry_threads newer_thread
      where newer_thread.inquiry_id=thread.inquiry_id and newer_thread.assignment_order>thread.assignment_order
    ) end,
    'booking', private.booking_json(latest, caller_role),
    'booking_count', (select count(*) from public.bookings where thread_id = thread.id),
    'payouts_ready', payouts_ready,
    'defaults', defaults,
    'terms', jsonb_build_object(
      'instructor_fee_bps', 1500,
      'client_fee_bps', 500,
      'payout_delay_hours', 24,
      'problem_report_window_hours', 24,
      'quote_expiry_days', 7,
      'ach_minimum_business_days', 5
    )
  );
end;
$$;

create or replace function public.booking_create_quote(p_quote jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread public.inquiry_threads%rowtype;
  organizer_id uuid;
  previous public.bookings%rowtype;
  created public.bookings%rowtype;
  names record;
  starts_at timestamptz;
  ends_at timestamptz;
  tz text := p_quote ->> 'time_zone';
  event_day date := (p_quote ->> 'event_date')::date;
  start_at time := (p_quote ->> 'start_time')::time;
  end_at time := (p_quote ->> 'end_time')::time;
  next_version smallint := 1;
begin
  perform private.require_service_role();

  select * into thread
  from public.inquiry_threads
  where id = (p_quote ->> 'thread_id')::uuid
  for update;
  if thread.id is null then
    raise exception 'Inquiry thread not found';
  end if;
  if thread.instructor_account_id is distinct from (p_quote ->> 'instructor_account_id')::uuid then
    raise exception 'Only the instructor in this conversation can send a quote';
  end if;
  if thread.status not in ('awaiting_response', 'active') then
    raise exception 'This conversation is closed';
  end if;
  if thread.response_policy_version=2 and not private.inquiry_event_open(thread.inquiry_id)
    and not private.thread_has_paid_booking(thread.id) then
    raise exception 'This event is no longer open';
  end if;
  if thread.response_policy_version=1 and exists (
    select 1 from public.inquiry_threads newer_thread
    where newer_thread.inquiry_id=thread.inquiry_id and newer_thread.assignment_order>thread.assignment_order
  ) then
    raise exception 'This inquiry was routed to another instructor';
  end if;
  if not private.instructor_payouts_ready(thread.instructor_profile_id) then
    raise exception 'Finish payout setup before sending a quote';
  end if;

  select participant.account_id into organizer_id
  from public.inquiry_thread_participants participant
  where participant.thread_id = thread.id
    and participant.participant_role = 'organizer'
    and participant.left_at is null
  limit 1;
  if organizer_id is null then
    raise exception 'This conversation has no organizer account';
  end if;

  begin
    starts_at := (event_day + start_at) at time zone tz;
    ends_at := (
      event_day + case when end_at <= start_at then 1 else 0 end + end_at
    ) at time zone tz;
  exception when others then
    raise exception 'The event date, times, or time zone are invalid';
  end;
  if starts_at <= now() + interval '2 hours' then
    raise exception 'The event must start at least 2 hours from now';
  end if;
  if starts_at > now() + interval '2 years' then
    raise exception 'The event must be within the next 2 years';
  end if;

  select * into previous
  from public.bookings booking
  where booking.thread_id = thread.id
    and booking.status in ('quote_sent', 'awaiting_payment', 'payment_processing', 'confirmed', 'completed')
  for update;
  if previous.id is not null then
    if previous.status in ('payment_processing', 'confirmed', 'completed') then
      raise exception 'This conversation already has a paid booking';
    end if;
    update public.bookings
    set status = 'withdrawn',
        closed_at = now(),
        closed_by_account_id = thread.instructor_account_id,
        close_reason = 'Replaced by an updated quote',
        updated_at = now()
    where id = previous.id;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.bookings
  where thread_id = thread.id;

  insert into public.bookings (
    thread_id,
    inquiry_id,
    instructor_profile_id,
    instructor_account_id,
    organizer_account_id,
    status,
    version,
    replaces_booking_id,
    event_date,
    start_time,
    end_time,
    time_zone,
    event_starts_at,
    event_ends_at,
    venue_name,
    venue_address,
    service_description,
    pricing_mode,
    hourly_rate_cents,
    hours,
    flat_price_cents,
    travel_fee_cents,
    provides_speakers,
    provides_microphone,
    cancellation_policy,
    cancellation_windows,
    insurance_choice,
    instructor_fee_bps,
    client_fee_bps,
    price_cents,
    client_fee_cents,
    total_cents,
    platform_fee_cents,
    instructor_payout_cents,
    agreement_version,
    agreement_text,
    agreement_sha256,
    expires_at,
    payout_due_at
  ) values (
    thread.id,
    thread.inquiry_id,
    thread.instructor_profile_id,
    thread.instructor_account_id,
    organizer_id,
    'quote_sent',
    next_version,
    previous.id,
    event_day,
    start_at,
    end_at,
    tz,
    starts_at,
    ends_at,
    nullif(trim(coalesce(p_quote ->> 'venue_name', '')), ''),
    trim(p_quote ->> 'venue_address'),
    trim(p_quote ->> 'service_description'),
    p_quote ->> 'pricing_mode',
    (p_quote ->> 'hourly_rate_cents')::integer,
    (p_quote ->> 'hours')::numeric,
    (p_quote ->> 'flat_price_cents')::integer,
    coalesce((p_quote ->> 'travel_fee_cents')::integer, 0),
    coalesce((p_quote ->> 'provides_speakers')::boolean, false),
    coalesce((p_quote ->> 'provides_microphone')::boolean, false),
    p_quote ->> 'cancellation_policy',
    p_quote -> 'cancellation_windows',
    p_quote ->> 'insurance_choice',
    (p_quote ->> 'instructor_fee_bps')::integer,
    (p_quote ->> 'client_fee_bps')::integer,
    (p_quote ->> 'price_cents')::integer,
    (p_quote ->> 'client_fee_cents')::integer,
    (p_quote ->> 'total_cents')::integer,
    (p_quote ->> 'platform_fee_cents')::integer,
    (p_quote ->> 'instructor_payout_cents')::integer,
    p_quote ->> 'agreement_version',
    p_quote ->> 'agreement_text',
    p_quote ->> 'agreement_sha256',
    least(now() + interval '7 days', starts_at),
    ends_at + interval '24 hours'
  ) returning * into created;

  insert into public.booking_signatures (
    booking_id,
    party_role,
    account_id,
    typed_name,
    email,
    agreement_sha256,
    ip_address,
    user_agent
  ) values (
    created.id,
    'instructor',
    created.instructor_account_id,
    trim(p_quote ->> 'signature_name'),
    p_quote ->> 'signature_email',
    created.agreement_sha256,
    left(p_quote ->> 'signature_ip', 100),
    left(p_quote ->> 'signature_user_agent', 500)
  );

  select * into names from private.booking_names(created);
  perform private.post_booking_milestone(
    created.id,
    case when previous.id is null then 'quote_sent' else 'quote_updated' end,
    case
      when previous.id is null then names.instructor_name || ' sent a signed quote'
      else names.instructor_name || ' sent an updated quote. The previous version is withdrawn. New total'
    end ||
      ': ' || private.booking_money(created.total_cents) || ' (' ||
      private.booking_money(created.price_cents) || ' plus a ' ||
      private.booking_money(created.client_fee_cents) || ' service fee) for ' ||
      private.booking_local_date(created.event_starts_at, created.time_zone) ||
      '. Expires ' || private.booking_local_date(created.expires_at, created.time_zone) ||
      '. Next: ' || names.organizer_name || ' reviews, signs, and pays.'
  );

  return jsonb_build_object(
    'bookingId', created.id,
    'version', created.version,
    'expiresAt', created.expires_at,
    'totalCents', created.total_cents
  );
end;
$$;

create or replace function public.booking_record_organizer_signature(
  p_booking_id uuid,
  p_account_id uuid,
  p_typed_name text,
  p_email text,
  p_agreement_sha256 text,
  p_ip_address text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
begin
  perform private.require_service_role();
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null or booking.organizer_account_id <> p_account_id then
    raise exception 'Booking not found or access denied';
  end if;
  if booking.status = 'awaiting_payment' then
    return jsonb_build_object('bookingId', booking.id, 'status', booking.status, 'alreadySigned', true);
  end if;
  if booking.status <> 'quote_sent' then
    raise exception 'This quote is no longer open';
  end if;
  if booking.expires_at <= now() then
    raise exception 'This quote has expired. Ask the instructor to send a new one';
  end if;
  if p_agreement_sha256 is distinct from booking.agreement_sha256 then
    raise exception 'The agreement changed after you opened it. Review the latest version before signing';
  end if;

  insert into public.booking_signatures (
    booking_id,
    party_role,
    account_id,
    typed_name,
    email,
    agreement_sha256,
    ip_address,
    user_agent
  ) values (
    booking.id,
    'organizer',
    p_account_id,
    trim(p_typed_name),
    p_email,
    booking.agreement_sha256,
    left(p_ip_address, 100),
    left(p_user_agent, 500)
  );

  begin
    update public.bookings
    set status = 'awaiting_payment', updated_at = now()
    where id = booking.id;
  exception when unique_violation then
    raise exception 'Another booking for this inquiry is already being paid or has been paid';
  end;

  select * into names from private.booking_names(booking);
  perform private.post_booking_milestone(
    booking.id,
    'organizer_signed',
    names.organizer_name || ' signed the agreement. Payment of ' ||
      private.booking_money(booking.total_cents) ||
      ' is pending, and the agreement takes effect once it is paid. Next: ' ||
      names.organizer_name || ' completes payment.'
  );
  return jsonb_build_object('bookingId', booking.id, 'status', 'awaiting_payment', 'alreadySigned', false);
end;
$$;

create or replace function public.booking_apply_payment(
  p_booking_id uuid,
  p_outcome text,
  p_session_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_payment_method_type text,
  p_amount_cents integer,
  p_failure_message text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  names record;
  inquiry_warning text;
begin
  perform private.require_service_role();
  if p_outcome not in ('paid', 'processing', 'failed') then
    raise exception 'Invalid payment outcome';
  end if;
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'Booking not found';
  end if;
  if p_outcome in ('paid', 'processing') and p_amount_cents is distinct from booking.total_cents then
    raise exception 'Stripe amount does not match the booking total';
  end if;
  select * into names from private.booking_names(booking);

  if p_outcome = 'processing' then
    if booking.status <> 'awaiting_payment' then
      return case when booking.status = 'payment_processing' then 'ignored' else 'refund_required' end;
    end if;
    update public.bookings
    set status = 'payment_processing',
        stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
        payment_method_type = coalesce(p_payment_method_type, payment_method_type),
        payment_started_at = now(),
        updated_at = now()
    where id = booking.id;
    perform private.post_booking_milestone(
      booking.id,
      'payment_processing',
      'Bank payment of ' || private.booking_money(booking.total_cents) ||
        ' started. Bank payments usually clear in about 4 business days. The booking is confirmed when it clears. Next: nobody needs to act.'
    );
    return 'applied';
  end if;

  if p_outcome = 'failed' then
    if booking.status not in ('awaiting_payment', 'payment_processing') then
      return 'ignored';
    end if;
    update public.bookings
    set status = case when expires_at <= now() then 'expired' else 'awaiting_payment' end,
        closed_at = case when expires_at <= now() then now() else null end,
        close_reason = case when expires_at <= now() then 'Payment failed after the quote expired' else null end,
        payment_failed_at = now(),
        payment_failure_message = left(p_failure_message, 500),
        payment_started_at = null,
        updated_at = now()
    where id = booking.id;
    perform private.post_booking_milestone(
      booking.id,
      'payment_failed_' || to_char(now(), 'YYYYMMDDHH24MISS'),
      'Payment did not go through. Next: ' || names.organizer_name ||
        ' can try again with another payment method' ||
        case when booking.expires_at <= now() then ' after ' || names.instructor_name || ' sends a new quote.' else '.' end
    );
    return 'applied';
  end if;

  -- p_outcome = 'paid'
  if booking.status in ('confirmed', 'completed', 'paid_out') then
    return 'ignored';
  end if;
  if booking.status not in ('awaiting_payment', 'payment_processing') then
    return 'refund_required';
  end if;
  if p_charge_id is null or p_charge_id !~ '^(ch|py)_[A-Za-z0-9]+$' then
    raise exception 'A Stripe charge identifier is required to confirm payment';
  end if;

  update public.bookings
  set status = 'confirmed',
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
      stripe_charge_id = p_charge_id,
      payment_method_type = coalesce(p_payment_method_type, payment_method_type),
      payment_started_at = coalesce(payment_started_at, now()),
      paid_at = now(),
      updated_at = now()
  where id = booking.id;

  begin
    update public.inquiries
    set booking_outcome = 'booked',
        booked_instructor_profile_id = booking.instructor_profile_id,
        booking_value_cents = booking.price_cents,
        booking_event_date = booking.event_date,
        outcome_note = 'Paid through Hire Line Dancers',
        outcome_reported_by = booking.organizer_account_id,
        outcome_reported_at = now(),
        outcome_next_ask_at = null,
        updated_at = now()
    where id = booking.inquiry_id;

    -- A paid V2 booking chooses this conversation and closes competing ones.
    if exists (select 1 from public.inquiry_threads where id=booking.thread_id and response_policy_version=2) then
      update public.inquiry_threads set status='closed', closed_at=now(), updated_at=now()
      where inquiry_id=booking.inquiry_id and id<>booking.thread_id
        and status in ('awaiting_response','active','timed_out');
      update public.inquiry_thread_notification_jobs job
      set status='canceled',completed_at=now(),last_error='Event booked'
      from public.inquiry_threads thread
      where thread.inquiry_id=booking.inquiry_id and job.thread_id=thread.id
        and job.status='pending' and job.notification_type not in ('new_message','booking_update');
    end if;
  exception when others then
    get stacked diagnostics inquiry_warning = message_text;
    raise warning 'Booking % paid but inquiry outcome was not updated: %', booking.id, inquiry_warning;
  end;

  perform private.post_booking_milestone(
    booking.id,
    'confirmed',
    'Booking confirmed. ' || private.booking_money(booking.total_cents) ||
      ' paid. The signed agreement and both contacts are in Booking details. Next: nobody needs to act until the event on ' ||
      private.booking_local_date(booking.event_starts_at, booking.time_zone) || '.'
  );
  return 'applied';
end;
$$;
commit;
