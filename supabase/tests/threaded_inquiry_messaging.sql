\set ON_ERROR_STOP on

begin;

-- Existing inquiries keep their original policy while new submissions use V2.
alter table public.inquiry_threads alter column response_policy_version set default 1;

create or replace function pg_temp.messaging_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'Messaging assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.messaging_expect_error(
  p_statement text,
  p_message_fragment text,
  p_label text
)
returns void
language plpgsql
as $$
begin
  begin
    execute p_statement;
  exception when others then
    if position(p_message_fragment in sqlerrm) = 0 then
      raise exception 'Expected error for %, got: %', p_label, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected an error for %, but the statement succeeded', p_label;
end;
$$;

create or replace function pg_temp.messaging_set_request(
  p_account_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claim.sub',
    coalesce(p_account_id::text, ''),
    true
  );
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_account_id,
      'email', p_email,
      'role', p_role
    )::text,
    true
  );
end;
$$;

select pg_temp.messaging_assert(
  has_function_privilege(
    'authenticated',
    'public.submit_inquiry(uuid,text,date,time without time zone,text,text,text,text,text,integer,text,text,boolean,boolean,text,text,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_inquiry_threads(text,text,text,integer,timestamp with time zone,uuid,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.send_inquiry_message(uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_inquiry_thread_notification_jobs(integer,interval)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_inquiry_thread_notification_jobs(integer,interval)',
    'execute'
  ),
  'browser and worker RPC grants must use least privilege'
);

select pg_temp.messaging_assert(
  not has_table_privilege('authenticated', 'public.inquiry_messages', 'insert')
  and not has_table_privilege('authenticated', 'public.inquiry_messages', 'update')
  and not has_table_privilege('authenticated', 'public.inquiry_messages', 'delete')
  and has_table_privilege('authenticated', 'public.inquiry_messages', 'select'),
  'participant messages must be read-only outside constrained RPCs'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'messaging-admin@example.test',
    '{"full_name":"Messaging Admin"}'
  ),
  (
    '10000000-0000-0000-0000-000000000010',
    'messaging-organizer@example.test',
    '{"full_name":"Messaging Organizer"}'
  ),
  (
    '10000000-0000-0000-0000-000000000020',
    'messaging-instructor-one@example.test',
    '{"full_name":"Instructor One"}'
  ),
  (
    '10000000-0000-0000-0000-000000000021',
    'messaging-instructor-two@example.test',
    '{"full_name":"Instructor Two"}'
  ),
  (
    '10000000-0000-0000-0000-000000000030',
    'messaging-outsider@example.test',
    '{"full_name":"Messaging Outsider"}'
  );

update public.accounts
set role = case
      when id = '10000000-0000-0000-0000-000000000001' then 'admin'
      when id = '10000000-0000-0000-0000-000000000010' then 'organizer'
      when id in (
        '10000000-0000-0000-0000-000000000020',
        '10000000-0000-0000-0000-000000000021'
      ) then 'instructor'
      else 'organizer'
    end,
    company_name = case
      when id = '10000000-0000-0000-0000-000000000010'
        then 'Messaging Events'
    end,
    onboarding_completed_at = now()
where id::text like '10000000-%';

insert into public.marketplace_admins (
  account_id,
  is_owner,
  granted_by
)
values (
  '10000000-0000-0000-0000-000000000001',
  true,
  '10000000-0000-0000-0000-000000000001'
);

insert into public.instructor_profiles (
  id,
  account_id,
  slug,
  status,
  display_name,
  city,
  region,
  event_types,
  published_at
)
values
  (
    '20000000-0000-0000-0000-000000000020',
    '10000000-0000-0000-0000-000000000020',
    'messaging-instructor-one-austin-tx',
    'published',
    'Instructor One',
    'Austin',
    'TX',
    array['corporate-events', 'private-parties'],
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000021',
    '10000000-0000-0000-0000-000000000021',
    'messaging-instructor-two-austin-tx',
    'published',
    'Instructor Two',
    'Austin',
    'TX',
    array['corporate-events', 'private-parties'],
    now()
  );

insert into public.instructor_private_settings (
  instructor_profile_id,
  inquiry_email,
  response_reminders_enabled
)
values
  (
    '20000000-0000-0000-0000-000000000020',
    'messaging-instructor-one@example.test',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000021',
    'messaging-instructor-two@example.test',
    true
  );

insert into public.instructor_guarantees (
  instructor_profile_id,
  guarantee_status,
  guarantee_terms_version
)
values (
  '20000000-0000-0000-0000-000000000021',
  'covered',
  '2026-08-04'
);

select pg_temp.messaging_assert(
  (
    select count(*) = 2
    from public.instructor_service_markets mapping
    where mapping.service_market_slug = 'austin-tx'
      and mapping.instructor_profile_id in (
        '20000000-0000-0000-0000-000000000020',
        '20000000-0000-0000-0000-000000000021'
      )
      and mapping.accepting_inquiries
      and mapping.fallback_eligible
  ),
  'profile locations must normalize into database service markets'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000010',
  'messaging-organizer@example.test',
  'authenticated'
);

select public.submit_inquiry(
  '20000000-0000-0000-0000-000000000020',
  'corporate-events',
  current_date + 30,
  time '18:00',
  'America/Chicago',
  'Messaging Hall',
  'Austin',
  'TX',
  '78701',
  80,
  '$1,000-$2,000',
  'Beginner songs',
  true,
  true,
  'Please teach our team.',
  null,
  true
) as first_inquiry_id \gset

select public.get_inquiry_primary_thread(
  :'first_inquiry_id'::uuid
) as first_thread_id \gset

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');

select pg_temp.messaging_assert(
  (
    select inquiry.fallback_consent
      and inquiry.fallback_consent_at is not null
    from public.inquiries inquiry
    where inquiry.id = :'first_inquiry_id'::uuid
  ),
  'submit_inquiry must record explicit organizer fallback consent'
);

select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.inquiry_threads thread
    where thread.inquiry_id = :'first_inquiry_id'::uuid
      and thread.id = :'first_thread_id'::uuid
      and thread.assignment_order = 1
      and thread.assignment_source = 'organizer_selected'
      and thread.status = 'awaiting_response'
  )
  and (
    select count(*) = 2
    from public.inquiry_thread_participants participant
    where participant.thread_id = :'first_thread_id'::uuid
  )
  and (
    select count(*) = 1
    from public.inquiry_messages message
    where message.thread_id = :'first_thread_id'::uuid
      and message.message_kind = 'inquiry'
      and message.body = 'Please teach our team.'
  ),
  'submission must atomically create one thread, two participants, and the inquiry message'
);

select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'first_thread_id'::uuid
      and job.notification_type = 'new_thread'
      and job.status = 'pending'
  )
  and not exists (
    select 1
    from public.inquiry_notification_jobs job
    join public.inquiry_recipients recipient
      on recipient.id = job.inquiry_recipient_id
    where recipient.inquiry_id = :'first_inquiry_id'::uuid
      and job.notification_type = 'new_inquiry'
  ),
  'new submissions must use only the thread notification queue'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000030',
  'messaging-outsider@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  (select count(*) = 0 from public.inquiry_threads)
  and (select count(*) = 0 from public.inquiry_messages),
  'RLS must hide threads and messages from unrelated accounts'
);
select pg_temp.messaging_expect_error(
  format(
    'select public.get_inquiry_thread(%L::uuid)',
    :'first_thread_id'
  ),
  'access denied',
  'outsider thread RPC access'
);

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000020',
  'messaging-instructor-one@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.list_inquiry_threads(
      'Messaging Hall',
      'needs_reply',
      'oldest_waiting',
      50,
      null,
      null,
      false
    )
    where thread_id = :'first_thread_id'::uuid
  ),
  'instructor inbox must support search, needs-reply filtering, and oldest_waiting alias'
);
select public.mark_inquiry_thread_read(:'first_thread_id'::uuid);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select thread.first_viewed_at is not null
    from public.inquiry_threads thread
    where thread.id = :'first_thread_id'::uuid
  ),
  'instructor read state must record the first view'
);

set local role service_role;
select pg_temp.messaging_set_request(null, null, 'service_role');
select claimed.job_id as first_job_id
from public.claim_inquiry_thread_notification_jobs(10, interval '10 minutes') claimed
where claimed.thread_id = :'first_thread_id'::uuid
  and claimed.notification_type = 'new_thread'
\gset
select pg_temp.messaging_assert(
  public.complete_inquiry_thread_notification_job(
    :'first_job_id'::bigint,
    true,
    'resend-first-thread',
    null,
    false
  ) = 'sent',
  'worker must complete the initial thread email'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select thread.response_clock_started_at is not null
      and thread.response_due_at = thread.response_clock_started_at + interval '72 hours'
    from public.inquiry_threads thread
    where thread.id = :'first_thread_id'::uuid
  )
  and (
    select count(*) = 4
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'first_thread_id'::uuid
      and job.notification_type in (
        'response_reminder_24',
        'response_reminder_48',
        'response_timeout_instructor',
        'response_timeout_organizer'
      )
      and job.status = 'pending'
  )
  and (
    select recipient.email_delivery_status = 'sent'
      and recipient.email_provider_message_id = 'resend-first-thread'
    from public.inquiry_recipients recipient
    join public.inquiry_threads thread
      on thread.inquiry_recipient_id = recipient.id
    where thread.id = :'first_thread_id'::uuid
  ),
  'provider acceptance must update delivery state and start the 72-hour milestones'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000020',
  'messaging-instructor-one@example.test',
  'authenticated'
);
select public.send_inquiry_message(
  :'first_thread_id'::uuid,
  'I am available and will follow up here.',
  '30000000-0000-0000-0000-000000000001'
);
select public.send_inquiry_message(
  :'first_thread_id'::uuid,
  'I am available and will follow up here.',
  '30000000-0000-0000-0000-000000000001'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.inquiry_messages message
    where message.sender_account_id = '10000000-0000-0000-0000-000000000020'
      and message.client_request_id = '30000000-0000-0000-0000-000000000001'
  )
  and (
    select thread.status = 'active'
      and thread.first_instructor_message_at is not null
    from public.inquiry_threads thread
    where thread.id = :'first_thread_id'::uuid
  )
  and (
    select count(*) = 4
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'first_thread_id'::uuid
      and job.notification_type like 'response_%'
      and job.status = 'canceled'
  ),
  'first instructor reply must be idempotent and cancel every response milestone'
);

select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'first_thread_id'::uuid
      and job.notification_type = 'new_message'
      and job.status = 'pending'
  )
  and (
    select count(*) = 1
    from public.inquiry_thread_participants participant
    where participant.thread_id = :'first_thread_id'::uuid
      and participant.account_id = '10000000-0000-0000-0000-000000000010'
      and participant.last_read_message_id < (
        select max(message.id)
        from public.inquiry_messages message
        where message.thread_id = :'first_thread_id'::uuid
      )
  ),
  'reply must queue one organizer email and leave organizer unread state'
);

select pg_temp.messaging_expect_error(
  format(
    'update public.inquiry_messages set body = %L where thread_id = %L::uuid',
    'Changed message',
    :'first_thread_id'
  ),
  'immutable',
  'direct message update'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000010',
  'messaging-organizer@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  (
    select (thread_json -> 'messages' -> 1) ?& array[
      'id',
      'thread_id',
      'sender_account_id',
      'sender_role',
      'body',
      'message_type',
      'created_at',
      'redacted_at'
    ]
    from (
      select public.get_inquiry_thread(:'first_thread_id'::uuid) as thread_json
    ) loaded
  )
  and (
    select jsonb_array_length(thread_json -> 'admin_notes') = 0
    from (
      select public.get_inquiry_thread(:'first_thread_id'::uuid) as thread_json
    ) loaded
  ),
  'participant thread JSON must honor the message contract and hide admin notes'
);
select public.mark_inquiry_thread_read(:'first_thread_id'::uuid);

-- Create a second inquiry, let its delivered thread reach 72 hours, and route
-- it manually to the next eligible instructor.
select public.submit_inquiry(
  '20000000-0000-0000-0000-000000000020',
  'corporate-events',
  current_date + 40,
  null,
  'America/Chicago',
  'Fallback Hall',
  'Austin',
  'TX',
  null,
  60,
  null,
  null,
  true,
  false,
  'Fallback routing request.',
  null,
  true
) as fallback_inquiry_id \gset
select public.get_inquiry_primary_thread(
  :'fallback_inquiry_id'::uuid
) as source_thread_id \gset

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
update public.inquiry_thread_notification_jobs
set status = 'processing',
    attempts = 1,
    locked_at = now()
where thread_id = :'source_thread_id'::uuid
  and notification_type = 'new_thread'
returning id as source_job_id
\gset

set local role service_role;
select pg_temp.messaging_set_request(null, null, 'service_role');
select public.complete_inquiry_thread_notification_job(
  :'source_job_id'::bigint,
  true,
  'resend-fallback-source',
  null,
  false
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
update public.inquiry_threads
set response_clock_started_at = now() - interval '72 hours 1 minute',
    response_due_at = now() - interval '1 minute'
where id = :'source_thread_id'::uuid;
update public.inquiry_thread_notification_jobs
set available_at = now() - interval '1 minute'
where thread_id = :'source_thread_id'::uuid
  and notification_type in (
    'response_timeout_instructor',
    'response_timeout_organizer'
  );

set local role service_role;
select pg_temp.messaging_set_request(null, null, 'service_role');
select pg_temp.messaging_assert(
  public.enqueue_due_inquiry_response_actions() = 1,
  '72-hour worker action must transition the due thread exactly once'
);
select pg_temp.messaging_assert(
  public.enqueue_due_inquiry_response_actions() = 0,
  '72-hour transition retries must be idempotent'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select thread.status = 'timed_out'
      and thread.timed_out_at is not null
      and thread.fallback_review_requested_at is not null
    from public.inquiry_threads thread
    where thread.id = :'source_thread_id'::uuid
  )
  and (
    select count(*) = 1
    from public.inquiry_routing_events event
    where event.thread_id = :'source_thread_id'::uuid
      and event.event_type = 'fallback_review_requested'
  ),
  'timeout must create one auditable admin fallback review'
);
select pg_temp.messaging_assert(not exists (select 1 from public.inquiry_recommendations where source_thread_id=:'source_thread_id'),
  'legacy timeout must not create new-policy recommendations');

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000001',
  'messaging-admin@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.admin_list_fallback_candidates(
      :'source_thread_id'::uuid
    ) candidate
    where candidate.instructor_profile_id =
      '20000000-0000-0000-0000-000000000021'
      and candidate.service_market_name = 'Austin'
      and candidate.active_thread_count = 0
      and candidate.match_reasons @> array['service_market', 'event_type']
  ),
  'admin fallback candidates must enforce market, event, load, and prior-contact rules'
);

select public.admin_route_inquiry(
  :'source_thread_id'::uuid,
  '20000000-0000-0000-0000-000000000021',
  'Manual fallback test'
) as fallback_thread_id \gset

select public.admin_add_inquiry_note(
  :'fallback_thread_id'::uuid,
  'Private routing note'
);
select pg_temp.messaging_assert(
  (
    select jsonb_array_length(
      public.get_inquiry_thread(:'fallback_thread_id'::uuid) -> 'admin_notes'
    ) = 2
  ),
  'admins must see both routing and explicitly added private notes'
);
select pg_temp.messaging_assert(
  not exists (
    select 1
    from public.list_inquiry_threads(
      null,
      'all',
      'recent',
      100,
      null,
      null,
      true
    ) thread
    where thread.unread_count <> 0
  ),
  'admin inbox rows must not label participant messages as unread'
);
select pg_temp.messaging_assert(
  exists (
    select 1
    from public.list_inquiry_threads(
      'Instructor Two',
      'all',
      'recent',
      100,
      null,
      null,
      true
    ) thread
    where thread.thread_id = :'fallback_thread_id'::uuid
  ),
  'fallback threads must be searchable by the currently assigned instructor name'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select thread.assignment_order = 2
      and thread.assignment_source = 'fallback'
      and thread.previous_thread_id = :'source_thread_id'::uuid
      and thread.status = 'awaiting_response'
    from public.inquiry_threads thread
    where thread.id = :'fallback_thread_id'::uuid
  )
  and (
    select count(*) = 2
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'fallback_thread_id'::uuid
      and (
        (
          job.notification_type = 'new_thread'
          and job.recipient_account_id =
            '10000000-0000-0000-0000-000000000021'
        )
        or (
          job.notification_type = 'fallback_routed_organizer'
          and job.recipient_account_id =
            '10000000-0000-0000-0000-000000000010'
        )
      )
  ),
  'admin routing must notify both the new instructor and organizer on the new thread'
);

update public.inquiries
set outcome_next_ask_at = now() - interval '1 minute'
where id = :'fallback_inquiry_id'::uuid;
set local role service_role;
select pg_temp.messaging_set_request(null, null, 'service_role');
select public.enqueue_due_inquiry_followups();
reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.inquiry_notification_jobs job
    join public.inquiry_recipients recipient
      on recipient.id = job.inquiry_recipient_id
    where recipient.inquiry_id = :'fallback_inquiry_id'::uuid
      and job.notification_type = 'booking_followup'
      and job.status = 'pending'
      and recipient.instructor_profile_id =
        '20000000-0000-0000-0000-000000000021'
  ),
  'booking follow-up must target only the currently routed instructor'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000020',
  'messaging-instructor-one@example.test',
  'authenticated'
);
select pg_temp.messaging_expect_error(
  format(
    'select public.get_inquiry_thread(%L::uuid)',
    :'fallback_thread_id'
  ),
  'access denied',
  'prior instructor fallback thread access'
);
select pg_temp.messaging_assert(
  (
    public.get_inquiry_thread(:'source_thread_id'::uuid)
      -> 'thread' ->> 'is_current_assignment'
  )::boolean is false
  and not (
    public.get_inquiry_thread(:'source_thread_id'::uuid)
      -> 'inquiry' ? 'booking_outcome'
  )
  and not exists (
    select 1 from public.inquiries where id = :'fallback_inquiry_id'::uuid
  ),
  'a prior instructor must retain only their own thread and not shared downstream inquiry state'
);

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000021',
  'messaging-instructor-two@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  public.get_inquiry_primary_thread(:'fallback_inquiry_id'::uuid)
    = :'fallback_thread_id'::uuid,
  'fallback instructor primary-thread resolution must return their own thread'
);
select public.send_inquiry_message(
  :'fallback_thread_id'::uuid,
  'I can teach this event.',
  '30000000-0000-0000-0000-000000000002'
);
select public.submit_instructor_inquiry_feedback(
  :'fallback_inquiry_id'::uuid,
  'booking',
  'booked',
  'Fallback instructor booking',
  current_date + 40
);
select pg_temp.messaging_assert(
  (
    public.get_inquiry_thread(:'fallback_thread_id'::uuid)
      -> 'thread' ->> 'is_current_assignment'
  )::boolean is true,
  'the routed instructor thread must be marked as the current assignment'
);

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000020',
  'messaging-instructor-one@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  not exists (
    select 1
    from public.inquiry_outcome_reports report
    where report.inquiry_id = :'fallback_inquiry_id'::uuid
  )
  and not exists (
    select 1 from public.inquiry_status_events
    where inquiry_id = :'fallback_inquiry_id'::uuid
      and actor_account_id = '10000000-0000-0000-0000-000000000021'
  ),
  'a prior instructor must not read a fallback instructor outcome or status events'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  exists (
    select 1
    from public.inquiry_outcome_reports report
    where report.inquiry_id = :'fallback_inquiry_id'::uuid
      and report.reporter_account_id =
        '10000000-0000-0000-0000-000000000021'
      and report.outcome = 'booked'
  )
  and (
    select inquiry.booked_instructor_profile_id =
      '20000000-0000-0000-0000-000000000021'
    from public.inquiries inquiry
    where inquiry.id = :'fallback_inquiry_id'::uuid
  )
  and (
    select guarantee_record.guarantee_status = 'fulfilled'
    from public.instructor_guarantees guarantee_record
    where guarantee_record.instructor_profile_id =
      '20000000-0000-0000-0000-000000000021'
  )
  and public.guarantee_qualifying_booking_count(
    '20000000-0000-0000-0000-000000000021'
  ) = 1,
  'fallback booking feedback must be attributed to and fulfill the routed instructor guarantee'
);
update public.inquiries
set completion_next_ask_at = now() - interval '1 minute'
where id = :'fallback_inquiry_id'::uuid;
set local role service_role;
select pg_temp.messaging_set_request(null, null, 'service_role');
select public.enqueue_due_inquiry_followups();
reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select count(*) = 1
    from public.inquiry_notification_jobs job
    join public.inquiry_recipients recipient
      on recipient.id = job.inquiry_recipient_id
    where recipient.inquiry_id = :'fallback_inquiry_id'::uuid
      and job.notification_type = 'completion_followup'
      and job.status = 'pending'
      and recipient.instructor_profile_id =
        '20000000-0000-0000-0000-000000000021'
  ),
  'completion follow-up must target only the instructor credited with the booking'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000001',
  'messaging-admin@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_marketplace_admin_analytics() -> 'instructors'
    ) row
    where row ->> 'instructor_key' =
      '20000000-0000-0000-0000-000000000021'
      and (row ->> 'booked')::integer = 1
  ),
  'admin analytics must attribute a fallback booking to the routed instructor'
);

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000020',
  'messaging-instructor-one@example.test',
  'authenticated'
);
select pg_temp.messaging_assert(
  not (
    public.get_inquiry_thread(:'source_thread_id'::uuid)
      -> 'inquiry' ? 'booked_instructor_profile_id'
  )
  and not (
    public.get_inquiry_thread(:'source_thread_id'::uuid)
      -> 'inquiry' ? 'booking_outcome'
  ),
  'a prior instructor API response must not reveal fallback booking attribution or outcome'
);

-- A separate declined inquiry without consent cannot be routed by an admin.
set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000010',
  'messaging-organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  '20000000-0000-0000-0000-000000000020',
  'private-parties',
  current_date + 50,
  p_event_city => 'Austin',
  p_event_region => 'TX',
  p_message => 'No fallback consent.',
  p_fallback_consent => false
) as no_consent_inquiry_id \gset
select public.get_inquiry_primary_thread(
  :'no_consent_inquiry_id'::uuid
) as no_consent_thread_id \gset

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000020',
  'messaging-instructor-one@example.test',
  'authenticated'
);
select public.decline_inquiry_thread(:'no_consent_thread_id'::uuid, null);

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000001',
  'messaging-admin@example.test',
  'authenticated'
);
select pg_temp.messaging_expect_error(
  format(
    'select public.admin_route_inquiry(%L::uuid, %L::uuid, null)',
    :'no_consent_thread_id',
    '20000000-0000-0000-0000-000000000021'
  ),
  'fallback consent is required',
  'admin route without organizer consent'
);

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000010',
  'messaging-organizer@example.test',
  'authenticated'
);
select public.withdraw_inquiry(:'first_inquiry_id'::uuid);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select inquiry.status = 'withdrawn'
    from public.inquiries inquiry
    where inquiry.id = :'first_inquiry_id'::uuid
  )
  and (
    select thread.status = 'withdrawn'
    from public.inquiry_threads thread
    where thread.id = :'first_thread_id'::uuid
  )
  and not exists (
    select 1
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'first_thread_id'::uuid
      and job.status = 'pending'
  ),
  'organizer withdrawal must close the inquiry and cancel pending thread email'
);

-- Static listings still notify the controlled support inbox when an organizer
-- sends a later message in the same conversation.
set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000010',
  'messaging-organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  null,
  'corporate-events',
  current_date + 60,
  p_event_city => 'Nashville',
  p_event_region => 'TN',
  p_message => 'Static support inquiry.',
  p_instructor_slug => 'avery-cole-nashville-tn'
) as static_inquiry_id \gset
select public.get_inquiry_primary_thread(
  :'static_inquiry_id'::uuid
) as static_thread_id \gset
select public.send_inquiry_message(
  :'static_thread_id'::uuid,
  'Static support follow-up.',
  '30000000-0000-0000-0000-000000000003'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  (
    select thread.assignment_source = 'static_support'
      and thread.instructor_account_id is null
    from public.inquiry_threads thread
    where thread.id = :'static_thread_id'::uuid
  )
  and (
    select count(*) = 1
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'static_thread_id'::uuid
      and job.notification_type = 'new_message'
      and job.recipient_account_id is null
      and job.recipient_email = 'hello@hirelinedancers.com'
  ),
  'static support follow-up messages must notify the controlled support inbox'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000001',
  'messaging-admin@example.test',
  'authenticated'
);
select (
  public.send_inquiry_message(
    :'static_thread_id'::uuid,
    'Support response in the conversation.',
    '30000000-0000-0000-0000-000000000004'
  ) ->> 'id'
) as static_admin_message_id \gset
select pg_temp.messaging_assert(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_inquiry_thread(:'static_thread_id'::uuid) -> 'messages'
    ) message
    where message ->> 'body' = 'Support response in the conversation.'
      and message ->> 'sender_role' = 'admin'
  ),
  'static support admin replies must be labeled as admin messages'
);

reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  exists (
    select 1
    from public.inquiry_admin_access_events access_event
    where access_event.thread_id = :'static_thread_id'::uuid
      and access_event.admin_account_id =
        '10000000-0000-0000-0000-000000000001'
      and access_event.action = 'sent'
  )
  and exists (
    select 1
    from public.inquiry_thread_notification_jobs job
    where job.thread_id = :'static_thread_id'::uuid
      and job.notification_type = 'new_message'
      and job.recipient_account_id =
        '10000000-0000-0000-0000-000000000010'
      and job.recipient_email = 'messaging-organizer@example.test'
  ),
  'admin static support replies must be audited and notify the organizer'
);

update public.inquiry_thread_notification_jobs
set available_at = now() + interval '1 day'
where status = 'pending'
  and message_id is distinct from :'static_admin_message_id'::bigint;

set local role service_role;
select pg_temp.messaging_set_request(null, null, 'service_role');
select claimed.sender_name as static_admin_sender_name
from public.claim_inquiry_thread_notification_jobs(
  10,
  interval '10 minutes'
) claimed
where claimed.message_id = :'static_admin_message_id'::bigint
\gset
reset role;
select pg_temp.messaging_set_request(null, null, 'postgres');
select pg_temp.messaging_assert(
  :'static_admin_sender_name' = 'Hire Line Dancers',
  'static support email must not expose the administrator account name'
);

set local role authenticated;
select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000010',
  'messaging-organizer@example.test',
  'authenticated'
);
select public.submit_inquiry(
  '20000000-0000-0000-0000-000000000020',
  'corporate-events',
  current_date + 61,
  p_event_city => 'Austin',
  p_event_region => 'TX',
  p_message => 'Admin isolation inquiry.'
) as admin_isolation_inquiry_id \gset
select public.get_inquiry_primary_thread(
  :'admin_isolation_inquiry_id'::uuid
) as admin_isolation_thread_id \gset

select pg_temp.messaging_set_request(
  '10000000-0000-0000-0000-000000000001',
  'messaging-admin@example.test',
  'authenticated'
);
select pg_temp.messaging_expect_error(
  format(
    'select public.send_inquiry_message(%L::uuid, %L, %L::uuid)',
    :'admin_isolation_thread_id',
    'Admin must not join a private instructor conversation.',
    '30000000-0000-0000-0000-000000000005'
  ),
  'access denied',
  'admin reply to a normal instructor thread'
);

select 'threaded inquiry messaging passed' as result;
rollback;
