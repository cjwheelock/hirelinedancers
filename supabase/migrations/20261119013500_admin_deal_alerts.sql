-- Owner alerts to cjwheelock1@gmail.com for deal milestones:
-- quote sent, quote signed by the organizer, client payment received,
-- and instructor payout sent. Future events only, no backfill.
-- Sent by the admin-deal-alerts Edge Function (cron, every minute).
create table public.admin_deal_notification_jobs (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  inquiry_id uuid references public.inquiries(id) on delete set null,
  notification_type text not null
    check (notification_type in ('quote_sent','quote_signed','payment_received','payout_sent')),
  delivered_to_email text not null default 'cjwheelock1@gmail.com'
    check (delivered_to_email = 'cjwheelock1@gmail.com'),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  first_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  unique (booking_id, notification_type)
);
create index admin_deal_notification_pending_idx
  on public.admin_deal_notification_jobs (available_at,id)
  where status in ('pending','processing');
alter table public.admin_deal_notification_jobs enable row level security;
revoke all on public.admin_deal_notification_jobs from anon, authenticated;
grant select on public.admin_deal_notification_jobs to authenticated;
grant all on public.admin_deal_notification_jobs to service_role;
create policy "admins read owner deal alerts" on public.admin_deal_notification_jobs
  for select to authenticated using (public.is_marketplace_admin());

create function private.enqueue_admin_deal_notification(p_booking_id uuid, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; q public.inquiries; instructor text; organizer_signed timestamptz;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null then return; end if;
  select * into q from public.inquiries where id = b.inquiry_id;
  select display_name into instructor from public.instructor_profiles where id = b.instructor_profile_id;
  select signed_at into organizer_signed from public.booking_signatures
    where booking_id = b.id and party_role = 'organizer';
  insert into public.admin_deal_notification_jobs(booking_id, inquiry_id, notification_type, payload)
  values (b.id, b.inquiry_id, p_type, jsonb_build_object(
    'kind', p_type, 'booking_id', b.id, 'inquiry_id', b.inquiry_id, 'thread_id', b.thread_id,
    'status', b.status, 'version', b.version,
    'instructor_name', coalesce(instructor, q.instructor_name, q.instructor_slug),
    'organizer_name', coalesce(q.contact_name, q.name),
    'organizer_email', coalesce(q.contact_email, q.email),
    'event_type', q.event_type, 'event_date', b.event_date,
    'start_time', b.start_time, 'end_time', b.end_time, 'time_zone', b.time_zone,
    'venue_name', b.venue_name, 'venue_address', b.venue_address,
    'city', nullif(concat_ws(', ', q.event_city, q.event_region), ''),
    'price_cents', b.price_cents, 'client_fee_cents', b.client_fee_cents,
    'total_cents', b.total_cents, 'platform_fee_cents', b.platform_fee_cents,
    'instructor_payout_cents', b.instructor_payout_cents, 'payout_cents', b.payout_cents,
    'quote_created_at', b.created_at, 'expires_at', b.expires_at,
    'organizer_signed_at', organizer_signed, 'paid_at', b.paid_at,
    'payment_method_type', b.payment_method_type,
    'payout_due_at', b.payout_due_at, 'paid_out_at', b.paid_out_at
  )) on conflict (booking_id, notification_type) do nothing;
exception when others then
  -- An alert must never block a quote, signature or payment.
  raise warning 'Owner deal alert not queued for booking %: %', p_booking_id, sqlerrm;
end $$;
revoke all on function private.enqueue_admin_deal_notification(uuid,text) from public,anon,authenticated;

create function private.admin_deal_alert_on_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.enqueue_admin_deal_notification(new.id, 'quote_sent');
  else
    if old.paid_at is null and new.paid_at is not null then
      perform private.enqueue_admin_deal_notification(new.id, 'payment_received');
    end if;
    if old.paid_out_at is null and new.paid_out_at is not null then
      perform private.enqueue_admin_deal_notification(new.id, 'payout_sent');
    end if;
  end if;
  return new;
end $$;
revoke all on function private.admin_deal_alert_on_booking() from public,anon,authenticated;
create trigger admin_deal_alert_on_booking_insert after insert on public.bookings
  for each row execute function private.admin_deal_alert_on_booking();
create trigger admin_deal_alert_on_booking_update after update of paid_at, paid_out_at on public.bookings
  for each row execute function private.admin_deal_alert_on_booking();

create function private.admin_deal_alert_on_signature()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.party_role = 'organizer' then
    perform private.enqueue_admin_deal_notification(new.booking_id, 'quote_signed');
  end if;
  return new;
end $$;
revoke all on function private.admin_deal_alert_on_signature() from public,anon,authenticated;
create trigger admin_deal_alert_on_signature after insert on public.booking_signatures
  for each row execute function private.admin_deal_alert_on_signature();

create function public.claim_admin_deal_notification_jobs(
  p_limit integer default 10, p_lock_timeout interval default interval '10 minutes'
) returns table(job_id bigint, attempt_number integer, delivered_to_email text, booking_id uuid, payload jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  -- Resend idempotency lasts 24h; never retry an uncertain send past 23h.
  update public.admin_deal_notification_jobs j
  set status='failed', completed_at=now(), locked_at=null,
      last_error=coalesce(j.last_error,'Delivery requires provider reconciliation before retry')
  where j.status in ('pending','processing') and j.attempts>0 and (
    j.first_attempt_at < now()-interval '23 hours'
    or (j.attempts>=6 and coalesce(j.locked_at,'-infinity'::timestamptz)
      < now()-greatest(p_lock_timeout,interval '1 minute'))
  );
  return query with candidates as (
    select j.id from public.admin_deal_notification_jobs j
    where j.attempts<6 and (
      (j.status='pending' and j.available_at<=now()) or
      (j.status='processing' and j.locked_at<now()-greatest(p_lock_timeout,interval '1 minute'))
    ) order by j.available_at, j.id for update skip locked
    limit greatest(1, least(coalesce(p_limit,10),25))
  ), claimed as (
    update public.admin_deal_notification_jobs j
    set status='processing', attempts=j.attempts+1, locked_at=now(),
        first_attempt_at=coalesce(j.first_attempt_at,now()), last_error=null
    from candidates c where j.id=c.id returning j.*
  ) select c.id, c.attempts, c.delivered_to_email, c.booking_id, c.payload from claimed c;
end $$;

create function public.complete_admin_deal_notification_job(
  p_job_id bigint, p_success boolean, p_attempt_number integer,
  p_provider_message_id text default null, p_error text default null, p_retryable boolean default false
) returns text language plpgsql security definer set search_path = '' as $$
declare j public.admin_deal_notification_jobs; next_status text;
begin
  select * into j from public.admin_deal_notification_jobs where id=p_job_id for update;
  if j.id is null then raise exception 'Owner deal alert not found'; end if;
  if j.status='sent' then return 'sent'; end if;
  if j.status<>'processing' or j.attempts<>p_attempt_number then
    raise exception 'Stale owner deal alert attempt';
  end if;
  if p_success then
    if nullif(trim(p_provider_message_id),'') is null then raise exception 'Provider acceptance id required'; end if;
    next_status:='sent';
  elsif p_retryable and j.attempts<6 and j.first_attempt_at>now()-interval '23 hours' then
    next_status:='pending';
  else next_status:='failed'; end if;
  update public.admin_deal_notification_jobs set status=next_status, locked_at=null,
    provider_message_id=case when p_success then p_provider_message_id else provider_message_id end,
    sent_at=case when p_success then now() else sent_at end,
    completed_at=case when next_status in ('sent','failed') then now() else null end,
    last_error=case when p_success then null else left(coalesce(p_error,'Delivery failed'),2000) end,
    available_at=case when next_status='pending' then now()+least(1800,30*power(2,j.attempts-1))*interval '1 second' else available_at end
  where id=j.id;
  return next_status;
end $$;
revoke all on function public.claim_admin_deal_notification_jobs(integer,interval) from public,anon,authenticated;
revoke all on function public.complete_admin_deal_notification_job(bigint,boolean,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_admin_deal_notification_jobs(integer,interval) to service_role;
grant execute on function public.complete_admin_deal_notification_job(bigint,boolean,integer,text,text,boolean) to service_role;

select cron.schedule('process-hld-admin-deal-alerts', '* * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'hld_project_url') || '/functions/v1/admin-deal-alerts',
    headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name = 'hld_notification_worker_key')),
    body := '{"limit":10}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
