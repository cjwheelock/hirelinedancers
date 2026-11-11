-- Opt-in automatic sharing applies only to newly submitted inquiries.
-- Existing private conversations and historic consent remain unchanged.
begin;
alter table public.inquiries add column automatic_sharing boolean not null default false,
  add column automatic_sharing_started_at timestamptz;
alter table public.inquiry_threads add column availability_status text not null default 'awaiting'
  check (availability_status in ('awaiting','available','unavailable'));

create function private.enable_new_inquiry_sharing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.automatic_sharing := coalesce(new.fallback_consent,false);
 return new;
end; $$;
revoke all on function private.enable_new_inquiry_sharing() from public,anon,authenticated;
create trigger enable_new_inquiry_sharing before insert on public.inquiries
 for each row execute function private.enable_new_inquiry_sharing();

create function private.inquiry_finalizing(p_inquiry_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.bookings where inquiry_id=p_inquiry_id
   and (status='payment_processing' or (status='awaiting_payment' and expires_at>now())));
$$;
revoke all on function private.inquiry_finalizing(uuid) from public,anon,authenticated;

create function private.invite_inquiry_matches(p_thread_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare source public.inquiry_threads%rowtype; event public.inquiries%rowtype;
 candidate record; recipient_id uuid; thread_id uuid; assigned smallint; invited integer:=0; initial_message_id bigint;
begin
 select * into source from public.inquiry_threads where id=p_thread_id;
 if source.id is null then return 0; end if;
 -- Every fan-out for an event serializes on its parent row, including retries.
 select * into event from public.inquiries where id=source.inquiry_id for update;
 if not event.automatic_sharing or event.automatic_sharing_started_at is not null
   or not private.inquiry_event_open(event.id) or private.inquiry_finalizing(event.id)
   or source.status not in ('timed_out','declined') then return 0; end if;
 update public.inquiries set automatic_sharing_started_at=now() where id=event.id;
 select coalesce(max(assignment_order),0) into assigned from public.inquiry_threads where inquiry_id=event.id;
 for candidate in
   select p.id,p.account_id,coalesce(s.inquiry_email,a.email) as delivery_email
   from public.instructor_profiles p join public.accounts a on a.id=p.account_id
   left join public.instructor_private_settings s on s.instructor_profile_id=p.id
   where private.inquiry_candidate_matches(event.id,p.id) order by p.id
 loop
   assigned:=assigned+1;
   insert into public.inquiry_recipients(inquiry_id,instructor_profile_id,delivered_to_email,sms_delivery_status)
     values(event.id,candidate.id,candidate.delivery_email,'not_requested') returning id into recipient_id;
   insert into public.inquiry_threads(inquiry_id,inquiry_recipient_id,instructor_profile_id,instructor_account_id,
     assignment_order,assignment_source,previous_thread_id,status,created_by,inquiry_snapshot)
     values(event.id,recipient_id,candidate.id,candidate.account_id,assigned,'fallback',source.id,'awaiting_response',
       event.organizer_account_id,jsonb_build_object('message','')) returning id into thread_id;
   insert into public.inquiry_thread_participants(thread_id,account_id,participant_role) values
     (thread_id,event.organizer_account_id,'organizer'),(thread_id,candidate.account_id,'instructor');
   -- The event brief is read from the inquiry. No opening message or private conversation is copied.
   insert into public.inquiry_messages(thread_id,message_kind,body)
     values(thread_id,'system','You have been invited to respond to this event. Review the event details and let the organizer know if you are available.') returning id into initial_message_id;
   update public.inquiry_threads set last_message_id=initial_message_id,last_message_at=now() where id=thread_id;
   insert into public.inquiry_thread_notification_jobs(thread_id,inquiry_recipient_id,recipient_account_id,
     recipient_email,notification_type,dedupe_key)
     values(thread_id,recipient_id,candidate.account_id,candidate.delivery_email,'new_thread',
       'thread:'||thread_id::text||':new-thread') on conflict(dedupe_key) do nothing;
   invited:=invited+1;
 end loop;
 if invited=0 then
   insert into public.inquiry_attention_items(thread_id,reason) values(source.id,'no_matches') on conflict do nothing;
 end if;
 return invited;
end; $$;
revoke all on function private.invite_inquiry_matches(uuid) from public,anon,authenticated;

create or replace function private.inquiry_status_followup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.response_policy_version=2 and new.status in ('timed_out','declined') and old.status is distinct from new.status then
   if exists(select 1 from public.inquiries where id=new.inquiry_id and automatic_sharing) then
     perform private.invite_inquiry_matches(new.id);
   else perform private.prepare_inquiry_recommendations(new.id); end if;
 end if;
 return new;
end; $$;
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
  perform private.invite_inquiry_matches(t.id)
  from public.inquiry_threads t join public.inquiries i on i.id=t.inquiry_id
  where i.automatic_sharing and i.automatic_sharing_started_at is null
    and t.status in ('timed_out','declined') and not private.inquiry_finalizing(i.id);
  return transitioned_count;
end;
$$;
CREATE OR REPLACE FUNCTION public.send_inquiry_message(p_thread_id uuid, p_body text, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and not ((thread.status='timed_out' or (thread.status='declined' and exists(select 1 from public.inquiries where id=thread.inquiry_id and automatic_sharing))) and thread.response_policy_version=2 and private.inquiry_event_open(thread.inquiry_id)))
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
        when status='declined' then 'declined'
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
$function$;

CREATE OR REPLACE FUNCTION public.decline_inquiry_thread(p_thread_id uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if thread.status not in ('awaiting_response', 'active') and not (thread.status='timed_out' and exists(select 1 from public.inquiries where id=thread.inquiry_id and automatic_sharing)) then
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
      availability_status = 'unavailable',
      first_instructor_message_at = coalesce(first_instructor_message_at, now()),
      closed_at = now(),
      updated_at = now()
  where id = thread.id;

  if not exists(select 1 from public.inquiries where id=thread.inquiry_id and automatic_sharing) then
  update public.inquiries
  set first_responded_at = coalesce(first_responded_at, now()),
      status = 'declined',
      closed_at = now(),
      updated_at = now()
  where id = thread.inquiry_id;
  end if;

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

  if clean_message is null or exists(select 1 from public.inquiries where id=thread.inquiry_id and automatic_sharing) then
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
$function$;

CREATE OR REPLACE FUNCTION public.get_inquiry_thread(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        ((thread.status='timed_out' or (thread.status='declined' and inquiry.automatic_sharing)) and thread.response_policy_version=2 and private.inquiry_event_open(thread.inquiry_id)),
      'finalization_blocked', inquiry.automatic_sharing and exists(select 1 from public.bookings b where b.inquiry_id=inquiry.id and b.thread_id<>thread.id and (b.status='payment_processing' or (b.status='awaiting_payment' and b.expires_at>now()))),
      'can_recommend', not inquiry.automatic_sharing and thread.response_policy_version=2 and private.inquiry_event_open(thread.inquiry_id) and
        (thread.status in ('timed_out','declined') or thread.timed_out_at is not null),
      'is_current_assignment',
      is_admin or caller_role = 'organizer' or is_current_assignment
    ),
    'inquiry', case
      when is_admin or caller_role = 'organizer' then
        ((to_jsonb(inquiry) || coalesce(thread.inquiry_snapshot,'{}'::jsonb)) || jsonb_build_object('message', coalesce((select original.original_body from public.inquiry_message_originals original join public.inquiry_messages initial on initial.id=original.message_id where initial.thread_id=thread.id and initial.message_kind='inquiry' order by initial.id limit 1), thread.inquiry_snapshot->>'message', inquiry.message))) - 'messaging_search_vector'
      when inquiry.automatic_sharing and caller_role='instructor' then
        jsonb_build_object('id',inquiry.id,'automatic_sharing',true,'event_type',inquiry.event_type,
          'event_date',inquiry.event_date,'event_start_time',inquiry.event_start_time,'time_zone',inquiry.time_zone,
          'venue_name',inquiry.venue_name,'event_city',inquiry.event_city,'event_region',inquiry.event_region,
          'event_postal_code',inquiry.event_postal_code,'guest_count',inquiry.guest_count,
          'budget_range',inquiry.budget_range,'music_requests',inquiry.music_requests,
          'venue_has_speakers',inquiry.venue_has_speakers,'venue_has_microphone',inquiry.venue_has_microphone,
          'contact_name',inquiry.contact_name,'contact_email',inquiry.contact_email,'contact_phone_e164',inquiry.contact_phone_e164,
          'company_name',inquiry.company_name,'message',coalesce(thread.inquiry_snapshot->>'message',''),
          'status',inquiry.status,'booking_outcome',case when private.thread_has_paid_booking(thread.id) then 'booked' else 'unknown' end)
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
$function$;


create function public.set_inquiry_availability(p_thread_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.inquiry_threads%rowtype;
begin
 select * into t from public.inquiry_threads where id=p_thread_id for update;
 if t.id is null or t.instructor_account_id is distinct from auth.uid() then raise exception 'Inquiry not found or access denied'; end if;
 if not exists(select 1 from public.inquiries where id=t.inquiry_id and automatic_sharing)
   or not private.inquiry_event_open(t.inquiry_id) or private.inquiry_finalizing(t.inquiry_id)
   or t.status not in ('awaiting_response','active','timed_out') then raise exception 'This opportunity is not accepting availability responses'; end if;
 if t.availability_status='available' then return; end if;
 update public.inquiry_threads set availability_status='available' where id=t.id;
 perform public.send_inquiry_message(t.id,'Available for this event.',gen_random_uuid());
end; $$;
revoke all on function public.set_inquiry_availability(uuid) from public,anon;
grant execute on function public.set_inquiry_availability(uuid) to authenticated;

create function public.get_inquiry_opportunity(p_thread_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.inquiry_threads%rowtype; i public.inquiries%rowtype; b public.bookings%rowtype;
 result jsonb; organizer boolean;
begin
 select * into t from public.inquiry_threads where id=p_thread_id;
 if auth.uid() is null or t.id is null or not (private.is_inquiry_thread_participant(t.id) or public.is_marketplace_admin()) then
   raise exception 'Inquiry not found or access denied'; end if;
 select * into i from public.inquiries where id=t.inquiry_id;
 if not i.automatic_sharing then return jsonb_build_object('enabled',false); end if;
 organizer:=i.organizer_account_id=auth.uid() or public.is_marketplace_admin();
 select * into b from public.bookings where inquiry_id=i.id
   and (status in ('payment_processing','confirmed','completed','paid_out') or (status='awaiting_payment' and expires_at>now()))
   order by paid_at desc nulls last,created_at desc limit 1;
 result:=jsonb_build_object('enabled',true,'phase',case
   when i.booking_outcome='booked' or b.paid_at is not null then 'confirmed'
   when not private.inquiry_event_open(i.id) then 'closed'
   when b.id is not null then 'finalizing'
   when i.automatic_sharing_started_at is not null or t.first_instructor_message_at is not null then 'open' else 'waiting' end,
   'shared_at',i.automatic_sharing_started_at,'response_due_at',t.response_due_at,
   'expires_at',case when organizer or b.thread_id=t.id then b.expires_at else null end,
   'payment_processing',b.status='payment_processing','own_selected',b.thread_id=t.id,'own_availability',t.availability_status);
 if organizer then
   result:=result||jsonb_build_object('candidates',(select coalesce(jsonb_agg(jsonb_build_object(
     'thread_id',it.id,'display_name',p.display_name,'slug',p.slug,'city',p.city,'region',p.region,
     'availability',it.availability_status,'responded',it.first_instructor_message_at is not null,
     'quote_total',q.total_cents,'selected',b.thread_id=it.id)
     order by (it.availability_status='available') desc,it.assignment_order),'[]'::jsonb)
     from public.inquiry_threads it join public.instructor_profiles p on p.id=it.instructor_profile_id
     left join lateral(select total_cents from public.bookings where thread_id=it.id
       and (status in ('awaiting_payment','payment_processing','confirmed','completed','paid_out') or (status='quote_sent' and expires_at>now()))
       order by created_at desc limit 1) q on true where it.inquiry_id=i.id));
 end if;
 return result;
end; $$;
revoke all on function public.get_inquiry_opportunity(uuid) from public,anon;
grant execute on function public.get_inquiry_opportunity(uuid) to authenticated;

create function private.inquiry_booking_opportunity_update() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.inquiry_threads%rowtype; m bigint; delivery text;
begin
 if not exists(select 1 from public.inquiries where id=new.inquiry_id and automatic_sharing) then return new; end if;
 if new.status='quote_sent' then
   update public.inquiry_threads set availability_status='available',status='active',first_instructor_message_at=coalesce(first_instructor_message_at,now()) where id=new.thread_id;
   perform private.cancel_inquiry_thread_response_jobs(new.thread_id,'Instructor sent a quote');
 end if;
 if new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from new.status) then
   for t in select * from public.inquiry_threads where inquiry_id=new.inquiry_id and id<>new.thread_id
     and (availability_status='available' or (first_instructor_message_at is not null and status<>'declined'))
   loop
     insert into public.inquiry_messages(thread_id,message_kind,body) values(t.id,'system',
       'The organizer has booked an instructor for this event. This opportunity is now closed. Thank you for your interest.') returning id into m;
     update public.inquiry_threads set last_message_id=m,last_message_at=now() where id=t.id;
     select coalesce(s.inquiry_email,a.email) into delivery from public.accounts a
       left join public.instructor_private_settings s on s.instructor_profile_id=t.instructor_profile_id where a.id=t.instructor_account_id;
     if delivery is not null then
       insert into public.inquiry_thread_notification_jobs(thread_id,inquiry_recipient_id,message_id,recipient_account_id,
         recipient_email,notification_type,dedupe_key) values(t.id,t.inquiry_recipient_id,m,t.instructor_account_id,
           delivery,'booking_update','opportunity-closed:'||new.inquiry_id::text||':'||t.id::text) on conflict(dedupe_key) do nothing;
     end if;
   end loop;
 end if;
 return new;
end; $$;
revoke all on function private.inquiry_booking_opportunity_update() from public,anon,authenticated;
create trigger inquiry_booking_opportunity_update after insert or update of status on public.bookings
 for each row execute function private.inquiry_booking_opportunity_update();

create function public.get_inquiry_notification_context(p_job_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.inquiry_thread_notification_jobs%rowtype; t public.inquiry_threads%rowtype; i public.inquiries%rowtype; result jsonb;
begin
 perform private.require_service_role();
 select * into j from public.inquiry_thread_notification_jobs where id=p_job_id;
 select * into t from public.inquiry_threads where id=j.thread_id;
 select * into i from public.inquiries where id=t.inquiry_id;
 if not coalesce(i.automatic_sharing,false) then return jsonb_build_object('automatic',false); end if;
 result:=jsonb_build_object('automatic',true,'opportunity_closed',j.notification_type='booking_update' and j.dedupe_key like 'opportunity-closed:%','invited_count',(select count(*) from public.inquiry_threads where inquiry_id=i.id and assignment_source='fallback'));
 if j.recipient_account_id=t.instructor_account_id and j.notification_type='new_thread' then
   result:=result||jsonb_build_object('brief',jsonb_strip_nulls(jsonb_build_object(
     'Organizer',i.contact_name,'Email',i.contact_email,'Phone',i.contact_phone_e164,'Company',i.company_name,
     'Start time',i.event_start_time,'Time zone',i.time_zone,'Venue',i.venue_name,'ZIP code',i.event_postal_code,
     'Attendees',i.guest_count,'Budget',i.budget_range,'Music requests',i.music_requests,
     'Venue speakers',case when i.venue_has_speakers then 'Yes' when i.venue_has_speakers=false then 'No' else 'Not sure' end,
     'Venue microphone',case when i.venue_has_microphone then 'Yes' when i.venue_has_microphone=false then 'No' else 'Not sure' end)));
 end if;
 return result;
end; $$;
revoke all on function public.get_inquiry_notification_context(bigint) from public,anon,authenticated;
grant execute on function public.get_inquiry_notification_context(bigint) to service_role;
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

create function private.require_paid_opportunity_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.automatic_sharing and new.booking_outcome='booked' and old.booking_outcome is distinct from 'booked'
   and not exists(select 1 from public.bookings where inquiry_id=new.id and status in ('confirmed','completed','paid_out') and paid_at is not null) then
   raise exception 'Complete the signed booking and full payment to confirm this event';
 end if;
 return new;
end; $$;
revoke all on function private.require_paid_opportunity_booking() from public,anon,authenticated;
create trigger require_paid_opportunity_booking before update of booking_outcome on public.inquiries
 for each row execute function private.require_paid_opportunity_booking();
commit;
