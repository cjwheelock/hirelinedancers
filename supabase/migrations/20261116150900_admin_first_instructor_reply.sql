-- Future first instructor messages only. No backfill.
alter table public.admin_inquiry_notification_jobs
  add column notification_type text not null default 'new_inquiry'
    check (notification_type in ('new_inquiry','first_instructor_reply')),
  drop constraint admin_inquiry_notification_jobs_inquiry_id_key,
  add constraint admin_inquiry_notification_jobs_inquiry_type_key unique(inquiry_id,notification_type);
create or replace function private.enqueue_admin_inquiry_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_inquiry_notification_jobs(inquiry_id,inquiry)
  values (new.id, jsonb_build_object(
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
  )) on conflict(inquiry_id,notification_type) do nothing;
  return new;
end $$;

create function private.enqueue_admin_first_instructor_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.inquiry_threads; q public.inquiries; responder_name text;
begin
  if new.message_kind <> 'participant' then return new; end if;
  select * into t from public.inquiry_threads where id=new.thread_id;
  if t.instructor_account_id is null or new.sender_account_id <> t.instructor_account_id
     or not exists (select 1 from public.inquiry_thread_participants p where p.thread_id=t.id
       and p.account_id=new.sender_account_id and p.participant_role='instructor' and p.left_at is null)
  then return new; end if;
  -- Serialize fallback threads: one reply alert per inquiry.
  select * into q from public.inquiries where id=t.inquiry_id for update;
  if exists (select 1 from public.inquiry_messages m join public.inquiry_threads other on other.id=m.thread_id
    where other.inquiry_id=t.inquiry_id and m.id<>new.id and m.message_kind='participant'
      and m.sender_account_id=other.instructor_account_id) then return new; end if;
  select display_name into responder_name from public.instructor_profiles where id=t.instructor_profile_id;
  insert into public.admin_inquiry_notification_jobs(inquiry_id,notification_type,inquiry)
  values(t.inquiry_id,'first_instructor_reply',jsonb_build_object(
    'kind','first_instructor_reply','created_at',q.created_at,
    'contact_name',coalesce(q.contact_name,q.name),'contact_email',coalesce(q.contact_email,q.email),
    'instructor_name',coalesce(responder_name,q.instructor_name,q.instructor_slug),
    'thread_id',t.id,'message_id',new.id,'reply_at',new.created_at,'reply_body',new.body,
    'response_seconds',greatest(0,extract(epoch from (new.created_at-coalesce(t.response_clock_started_at,t.created_at)))),
    'event_type',q.event_type,'event_date',q.event_date,'location',q.location
  )) on conflict(inquiry_id,notification_type) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_admin_first_instructor_reply() from public,anon,authenticated;
create trigger enqueue_admin_first_instructor_reply after insert on public.inquiry_messages
  for each row execute function private.enqueue_admin_first_instructor_reply();
