-- One durable owner alert for each NEW inquiry. Historical inquiries remain
-- accessible in the admin UI; this migration intentionally does not email them.
create table public.admin_inquiry_notification_jobs (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null unique references public.inquiries(id) on delete cascade,
  delivered_to_email text not null default 'cjwheelock1@gmail.com'
    check (delivered_to_email = 'cjwheelock1@gmail.com'),
  inquiry jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  first_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz
);
create index admin_inquiry_notification_pending_idx
  on public.admin_inquiry_notification_jobs (available_at,id)
  where status in ('pending','processing');
alter table public.admin_inquiry_notification_jobs enable row level security;
revoke all on public.admin_inquiry_notification_jobs from anon, authenticated;
grant select on public.admin_inquiry_notification_jobs to authenticated;
grant all on public.admin_inquiry_notification_jobs to service_role;
grant usage, select on sequence public.admin_inquiry_notification_jobs_id_seq to service_role;
create policy "admins read owner inquiry alerts" on public.admin_inquiry_notification_jobs
  for select to authenticated using (public.is_marketplace_admin());

create function private.enqueue_admin_inquiry_notification()
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
  )) on conflict(inquiry_id) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_admin_inquiry_notification() from public,anon,authenticated;
create trigger enqueue_admin_inquiry_notification after insert on public.inquiries
  for each row execute function private.enqueue_admin_inquiry_notification();

create function public.claim_admin_inquiry_notification_jobs(
  p_limit integer default 10, p_lock_timeout interval default interval '10 minutes'
) returns table(job_id bigint,attempt_number integer,delivered_to_email text,inquiry_id uuid,inquiry jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  -- Resend idempotency expires after24h. Never retry an uncertain delivery beyond
  --23h; leave a visible failed record for manual provider reconciliation instead.
  update public.admin_inquiry_notification_jobs j
  set status='failed',completed_at=now(),locked_at=null,
      last_error=coalesce(j.last_error,'Delivery requires provider reconciliation before retry')
  where j.status in ('pending','processing') and j.attempts>0 and (
    j.first_attempt_at < now()-interval '23 hours'
    or (j.attempts>=6 and coalesce(j.locked_at,'-infinity'::timestamptz)
      < now()-greatest(p_lock_timeout,interval '1 minute'))
  );
  return query with candidates as (
    select j.id from public.admin_inquiry_notification_jobs j
    where j.attempts<6 and (
      (j.status='pending' and j.available_at<=now()) or
      (j.status='processing' and j.locked_at<now()-greatest(p_lock_timeout,interval '1 minute'))
    ) order by j.available_at,j.id for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),25))
  ), claimed as (
    update public.admin_inquiry_notification_jobs j
    set status='processing',attempts=j.attempts+1,locked_at=now(),
        first_attempt_at=coalesce(j.first_attempt_at,now()),last_error=null
    from candidates c where j.id=c.id returning j.*
  ) select c.id,c.attempts,c.delivered_to_email,c.inquiry_id,c.inquiry from claimed c;
end $$;

create function public.complete_admin_inquiry_notification_job(
  p_job_id bigint,p_success boolean,p_attempt_number integer,
  p_provider_message_id text default null,p_error text default null,p_retryable boolean default false
) returns text language plpgsql security definer set search_path = '' as $$
declare j public.admin_inquiry_notification_jobs; next_status text;
begin
  select * into j from public.admin_inquiry_notification_jobs where id=p_job_id for update;
  if j.id is null then raise exception 'Owner inquiry notification not found'; end if;
  if j.status='sent' then return 'sent'; end if;
  if j.status<>'processing' or j.attempts<>p_attempt_number then
    raise exception 'Stale owner inquiry notification attempt';
  end if;
  if p_success then
    if nullif(trim(p_provider_message_id),'') is null then
      raise exception 'Provider acceptance id required';
    end if;
    next_status:='sent';
  elsif p_retryable and j.attempts<6 and j.first_attempt_at>now()-interval '23 hours' then
    next_status:='pending';
  else next_status:='failed'; end if;
  update public.admin_inquiry_notification_jobs set status=next_status,locked_at=null,
    provider_message_id=case when p_success then p_provider_message_id else provider_message_id end,
    sent_at=case when p_success then now() else sent_at end,
    completed_at=case when next_status in ('sent','failed') then now() else null end,
    last_error=case when p_success then null else left(coalesce(p_error,'Delivery failed'),2000) end,
    available_at=case when next_status='pending' then now()+least(1800,30*power(2,j.attempts-1)) * interval '1 second' else available_at end
  where id=j.id;
  return next_status;
end $$;
revoke all on function public.claim_admin_inquiry_notification_jobs(integer,interval) from public,anon,authenticated;
revoke all on function public.complete_admin_inquiry_notification_job(bigint,boolean,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_admin_inquiry_notification_jobs(integer,interval) to service_role;
grant execute on function public.complete_admin_inquiry_notification_job(bigint,boolean,integer,text,text,boolean) to service_role;
