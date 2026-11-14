-- Second routing round. After automatic sharing invites matching instructors,
-- the organizer hears nothing until an invited instructor responds, except one
-- "still looking" update if nobody has responded 48 hours after the fan-out.
-- Invited instructors' individual timeouts and declines never email the
-- organizer, because the organizer never chose them. The owner gets a personal
-- email when every invited instructor declines, when nobody could be invited,
-- and at the 48-hour no-response point, so manual outreach can start.

alter table public.inquiries add column if not exists still_looking_notified_at timestamptz;

alter table public.inquiry_attention_items drop constraint inquiry_attention_items_reason_check;
alter table public.inquiry_attention_items add constraint inquiry_attention_items_reason_check
  check (reason = any (array['no_matches','urgent_event','delivery_failed','static_listing','no_response_after_sharing']));

alter table public.inquiry_thread_notification_jobs drop constraint if exists inquiry_thread_notification_type_check;
alter table public.inquiry_thread_notification_jobs add constraint inquiry_thread_notification_type_check
  check (notification_type = any (array['new_thread','new_message','response_reminder_24','response_reminder_47',
    'response_reminder_48','response_timeout_instructor','response_timeout_organizer','thread_declined',
    'fallback_routed_organizer','booking_update','still_looking_organizer']));

-- True while an automatically shared event is still open and no instructor on
-- it (original or invited) has replied, marked available, or quoted.
create or replace function private.inquiry_sharing_unanswered(p_inquiry_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.inquiries i
   where i.id=p_inquiry_id and i.automatic_sharing and i.automatic_sharing_started_at is not null
     and coalesce(i.status,'') not in ('withdrawn','closed')
     and coalesce(i.booking_outcome,'unknown') <> 'booked'
     and private.inquiry_event_open(i.id) and not private.inquiry_finalizing(i.id)
     and exists(select 1 from public.inquiry_threads f where f.inquiry_id=i.id and f.assignment_source='fallback')
     and not exists(select 1 from public.inquiry_threads t where t.inquiry_id=i.id
       and t.first_instructor_message_at is not null and t.status<>'declined')
     and not exists(select 1 from public.bookings b where b.inquiry_id=i.id
       and b.status in ('quote_sent','awaiting_payment','payment_processing','confirmed','completed','paid_out')));
$$;

-- The organizer's update waits the full 48 hours, even when every invited
-- instructor declined sooner. Early declines only alert the owner.
create or replace function private.inquiry_still_looking_due(p_inquiry_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.inquiry_sharing_unanswered(i.id)
   and i.automatic_sharing_started_at <= now() - interval '48 hours'
   -- When the selected instructor timed out and nobody could be invited, the
   -- organizer's timeout email already carried the network message.
   and (exists(select 1 from public.inquiry_threads f where f.inquiry_id=i.id and f.assignment_source='fallback')
     or not exists(select 1 from public.inquiry_threads s where s.inquiry_id=i.id
       and s.assignment_source<>'fallback' and s.status='timed_out'))
 from public.inquiries i where i.id=p_inquiry_id;
$$;

-- True when every instructor invited by automatic sharing has declined (or
-- dropped out) and nobody on the event has responded.
create or replace function private.inquiry_all_invited_declined(p_inquiry_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.inquiry_sharing_unanswered(p_inquiry_id)
   and not exists(select 1 from public.inquiry_threads f where f.inquiry_id=p_inquiry_id
     and f.assignment_source='fallback' and f.status not in ('declined','withdrawn','closed'));
$$;

-- Owner alerts share the existing owner inquiry email queue. One row per
-- inquiry and alert kind, so each alert is sent at most once.
alter table public.admin_inquiry_notification_jobs
  add column if not exists alert_kind text not null default 'new_inquiry';
alter table public.admin_inquiry_notification_jobs
  add constraint admin_inquiry_notification_jobs_alert_kind_check
  check (alert_kind = any (array['new_inquiry','sharing_all_declined','sharing_no_response','sharing_no_matches']));
alter table public.admin_inquiry_notification_jobs drop constraint if exists admin_inquiry_notification_jobs_inquiry_id_key;
alter table public.admin_inquiry_notification_jobs
  add constraint admin_inquiry_notification_jobs_inquiry_alert_key unique (inquiry_id, alert_kind);

create or replace function private.enqueue_admin_inquiry_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_inquiry_notification_jobs(inquiry_id,alert_kind,inquiry)
  values (new.id, 'new_inquiry', jsonb_build_object(
    'id',new.id,'created_at',new.created_at,
    'instructor_name',new.instructor_name,'instructor_slug',new.instructor_slug,
    'name',new.name,'email',new.email,'contact_name',new.contact_name,
    'contact_email',new.contact_email,'contact_phone_e164',new.contact_phone_e164,
    'company_name',new.company_name,'event_type',new.event_type,
    'event_date',new.event_date,'event_start_time',new.event_start_time,
    'time_zone',new.time_zone,'location',new.location,'venue_name',new.venue_name,
    'event_city',new.event_city,'event_region',new.event_region,
    'event_postal_code',new.event_postal_code,'guest_count',new.guest_count,
    'budget_range',new.budget_range,'music_requests',new.music_requests,
    'venue_has_speakers',new.venue_has_speakers,'venue_has_microphone',new.venue_has_microphone,
    'reply_by_date',new.reply_by_date,'message',new.message,'status',new.status
  )) on conflict(inquiry_id, alert_kind) do nothing;
  return new;
end $$;

create or replace function private.notify_owner_sharing_alert(p_inquiry_id uuid, p_kind text)
returns boolean language plpgsql security definer set search_path='' as $$
declare i public.inquiries%rowtype; source_thread uuid; organizer_label text; first_name text; last_name text; inserted integer;
begin
 if p_kind not in ('sharing_all_declined','sharing_no_response','sharing_no_matches') then
   raise exception 'Unknown owner alert';
 end if;
 select * into i from public.inquiries where id=p_inquiry_id;
 if i.id is null then return false; end if;
 select t.id into source_thread from public.inquiry_threads t where t.inquiry_id=i.id and t.assignment_source<>'fallback'
   order by t.assignment_order, t.created_at limit 1;
 select coalesce(nullif(trim(a.first_name),''), split_part(trim(coalesce(i.contact_name,i.name,a.full_name,'')),' ',1)),
        coalesce(nullif(trim(a.last_name),''),
          nullif(regexp_replace(trim(coalesce(i.contact_name,i.name,a.full_name,'')),'^\S+\s*',''),''))
   into first_name, last_name
 from (select 1) one left join public.accounts a on a.id=i.organizer_account_id;
 organizer_label := nullif(trim(concat_ws(' ', nullif(first_name,''),
   case when nullif(last_name,'') is not null then upper(left(last_name,1))||'.' end)),'');
 insert into public.admin_inquiry_notification_jobs(inquiry_id, alert_kind, inquiry)
 values (i.id, p_kind, jsonb_build_object(
   'kind', p_kind, 'id', i.id, 'thread_id', source_thread,
   'event_type', i.event_type, 'event_date', i.event_date,
   'event_city', i.event_city, 'event_region', i.event_region,
   'organizer', organizer_label,
   'invited_count', (select count(*) from public.inquiry_threads f where f.inquiry_id=i.id and f.assignment_source='fallback')
 )) on conflict (inquiry_id, alert_kind) do nothing;
 get diagnostics inserted = row_count;
 return inserted > 0;
end $$;

create or replace function private.notify_inquiry_still_looking(p_inquiry_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare i public.inquiries%rowtype; source public.inquiry_threads%rowtype; organizer_email text;
begin
 select * into i from public.inquiries where id=p_inquiry_id for update;
 if i.id is null or i.still_looking_notified_at is not null or not private.inquiry_still_looking_due(i.id) then return false; end if;
 select * into source from public.inquiry_threads where inquiry_id=i.id and assignment_source<>'fallback'
   order by assignment_order, created_at limit 1;
 if source.id is null then return false; end if;
 update public.inquiries set still_looking_notified_at=now() where id=i.id;
 insert into public.inquiry_attention_items(thread_id,reason) values(source.id,'no_response_after_sharing')
   on conflict do nothing;
 perform private.notify_owner_sharing_alert(i.id, 'sharing_no_response');
 select coalesce(a.email,i.contact_email,i.email) into organizer_email from public.accounts a where a.id=i.organizer_account_id;
 organizer_email:=coalesce(organizer_email,i.contact_email,i.email);
 if i.organizer_account_id is not null and organizer_email is not null then
   insert into public.inquiry_thread_notification_jobs(thread_id,inquiry_recipient_id,recipient_account_id,recipient_email,
     notification_type,dedupe_key)
   values(source.id,source.inquiry_recipient_id,i.organizer_account_id,organizer_email,'still_looking_organizer',
     'inquiry:'||i.id::text||':still-looking') on conflict(dedupe_key) do nothing;
 end if;
 return true;
end $$;

revoke all on function private.inquiry_sharing_unanswered(uuid), private.inquiry_still_looking_due(uuid),
  private.notify_inquiry_still_looking(uuid), private.inquiry_all_invited_declined(uuid),
  private.notify_owner_sharing_alert(uuid,text), private.enqueue_admin_inquiry_notification()
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_due_inquiry_response_actions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Every invited instructor declined, or nobody could be invited: alert the
  -- owner right away. The organizer is not told until the 48-hour update.
  perform private.notify_owner_sharing_alert(i.id, 'sharing_all_declined')
  from public.inquiries i
  where i.automatic_sharing and i.automatic_sharing_started_at is not null
    and i.still_looking_notified_at is null
    and exists(select 1 from public.inquiry_threads f where f.inquiry_id=i.id and f.assignment_source='fallback')
    and private.inquiry_all_invited_declined(i.id)
    and not exists(select 1 from public.admin_inquiry_notification_jobs aj
      where aj.inquiry_id=i.id and aj.alert_kind='sharing_all_declined');
  perform private.notify_owner_sharing_alert(i.id, 'sharing_no_matches')
  from public.inquiries i
  where i.automatic_sharing and i.automatic_sharing_started_at is not null
    and coalesce(i.status,'') not in ('withdrawn','closed')
    and private.inquiry_event_open(i.id)
    and not exists(select 1 from public.inquiry_threads f where f.inquiry_id=i.id and f.assignment_source='fallback')
    and not exists(select 1 from public.admin_inquiry_notification_jobs aj
      where aj.inquiry_id=i.id and aj.alert_kind='sharing_no_matches');
  -- Second round: 48 hours after sharing and nobody invited has responded.
  -- Tell the organizer once, flag the team, and alert the owner.
  perform private.notify_inquiry_still_looking(i.id)
  from public.inquiries i
  where i.automatic_sharing and i.automatic_sharing_started_at is not null
    and i.still_looking_notified_at is null
    and private.inquiry_still_looking_due(i.id);
  return transitioned_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.inquiry_notification_needed(p_job_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 when j.notification_type='response_timeout_instructor' then
   t.status='timed_out' and t.first_instructor_message_at is null
 -- Instructors invited by automatic sharing were never chosen by the organizer.
 -- Their silence or decline is summarized once by the still-looking notice.
 when j.notification_type='response_timeout_organizer' then
   t.status='timed_out' and t.first_instructor_message_at is null and t.assignment_source<>'fallback'
 when j.notification_type='thread_declined' then t.status='declined' and t.assignment_source<>'fallback'
 when j.notification_type='still_looking_organizer' then private.inquiry_sharing_unanswered(t.inquiry_id)
 -- Automatic sharing keeps the organizer quiet until an instructor responds.
 when j.notification_type='fallback_routed_organizer' then t.status in ('awaiting_response','active','declined','timed_out')
   and not coalesce(i.automatic_sharing,false)
 else false end;
end; $function$;
