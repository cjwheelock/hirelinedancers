\set ON_ERROR_STOP on

begin;

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



select pg_temp.messaging_assert(not has_table_privilege('authenticated','public.instructor_sms_preferences','insert')
 and not has_table_privilege('authenticated','public.instructor_sms_preferences','update'), 'clients cannot forge verified SMS preferences');
set local role service_role;
select pg_temp.messaging_set_request(null,null,'service_role');
select public.reserve_instructor_sms_verification('10000000-0000-0000-0000-000000000020','+15555550100') as verification_id \gset
select pg_temp.messaging_expect_error($q$select public.reserve_instructor_sms_verification('10000000-0000-0000-0000-000000000020','+15555550100')$q$,
 'Please wait','verification is rate limited');
select pg_temp.messaging_assert(public.check_instructor_sms_verification('10000000-0000-0000-0000-000000000020',:'verification_id')='+15555550100',
 'verification challenge bound to phone');
select pg_temp.messaging_expect_error(format($q$select public.enable_verified_instructor_sms('10000000-0000-0000-0000-000000000021',%L,'+15555550100')$q$,:'verification_id'),
 'expired','verification cannot be used by another account');
select public.enable_verified_instructor_sms('10000000-0000-0000-0000-000000000020',:'verification_id','+15555550100');
set local role authenticated;
select pg_temp.messaging_set_request('10000000-0000-0000-0000-000000000010','messaging-organizer@example.test','authenticated');
select public.submit_inquiry('20000000-0000-0000-0000-000000000020','corporate-events',current_date+30,'18:00','America/Chicago',
 'Messaging Hall','Austin','TX','78701',80,null,null,true,true,'Our team event',null,false) as inquiry_id \gset
select public.get_inquiry_primary_thread(:'inquiry_id') as thread_id \gset
select pg_temp.messaging_assert((select count(*)=0 from public.instructor_sms_preferences),'organizer cannot read an instructor phone');
reset role;
select pg_temp.messaging_assert((select count(*)=4 from public.inquiry_thread_notification_jobs where thread_id=:'thread_id' and channel='sms'),
 'only opted-in instructor gets initial, 24-hour, 47-hour, and timeout texts');
select id as sms_job_id from public.inquiry_thread_notification_jobs where thread_id=:'thread_id' and channel='sms' and notification_type='new_thread' \gset
select id as email_job_id from public.inquiry_thread_notification_jobs where thread_id=:'thread_id' and channel='email' and notification_type='new_thread' \gset
set local role service_role;
select pg_temp.messaging_set_request(null,null,'service_role');
select pg_temp.messaging_assert(public.get_inquiry_sms_destination(:'sms_job_id')='+15555550100','worker rechecks current consent');
select public.record_inquiry_notification_delivery('resend','early-email','delivered',now());
reset role;
update public.inquiry_thread_notification_jobs set status='sent',provider_message_id='early-email' where id=:'email_job_id';
select pg_temp.messaging_assert((select delivery_status='delivered' from public.inquiry_thread_notification_jobs where id=:'email_job_id'),
 'callback before send receipt is retained and reconciled');
set local role service_role;
select public.record_inquiry_notification_delivery('resend','early-email','failed',now()-interval '1 hour');
reset role;
select pg_temp.messaging_assert((select delivery_status='delivered' from public.inquiry_thread_notification_jobs where id=:'email_job_id'),
 'old callbacks cannot replace newer delivery status');
update public.inquiry_thread_notification_jobs set status='processing',attempts=1,locked_at=now()-interval '11 minutes'
 where id=:'sms_job_id';
set local role service_role;
select count(*) from public.claim_inquiry_thread_notification_jobs_v2();
reset role;
select pg_temp.messaging_assert((select status='failed' from public.inquiry_thread_notification_jobs where id=:'sms_job_id'),
 'an interrupted SMS send is flagged instead of blindly resent');
set local role service_role;
select public.disable_instructor_sms(null,'+15555550100');
select pg_temp.messaging_assert(public.get_inquiry_sms_destination(:'sms_job_id') is null,'opt-out suppresses even a claimed text');
reset role;
select pg_temp.messaging_assert(not exists(select 1 from public.inquiry_thread_notification_jobs where thread_id=:'thread_id' and channel='sms' and status='pending'),
 'opt-out cancels future texts');
select pg_temp.messaging_assert((select count(*)=4 from public.inquiry_thread_notification_jobs where thread_id=:'thread_id' and channel='email' and status='pending'),
 'opt-out preserves email reminders');
update public.inquiry_thread_notification_jobs set status='failed',last_error='Provider rejected destination' where id=:'email_job_id';
select pg_temp.messaging_assert(exists(select 1 from public.inquiry_attention_items where thread_id=:'thread_id' and reason='delivery_failed'),
 'failed delivery is visible to administrators');
rollback;
