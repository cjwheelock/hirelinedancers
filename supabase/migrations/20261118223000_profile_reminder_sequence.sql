-- Profile completion reminders become a three-step sequence (CJ, Nov 18, 2026):
-- step 1 at 24 hours, step 2 at day 4, step 3 at day 10. Each step is sent at
-- most once per profile, and consecutive steps are spaced at least 3 days
-- (1 -> 2) and 6 days (2 -> 3) apart so backlogged drafts get the full spacing.
alter table public.profile_completion_reminder_jobs
  add column step smallint not null default 1 check (step in (1,2,3)),
  add column first_name text;
alter table public.profile_completion_reminder_jobs
  drop constraint profile_completion_reminder_jobs_profile_id_key,
  drop constraint profile_completion_reminder_jobs_account_id_key,
  drop constraint profile_completion_reminder_jobs_recipient_email_key;
alter table public.profile_completion_reminder_jobs
  add constraint profile_completion_reminder_jobs_profile_step_key unique (profile_id, step),
  add constraint profile_completion_reminder_jobs_account_step_key unique (account_id, step),
  add constraint profile_completion_reminder_jobs_email_step_key unique (recipient_email, step);

-- Plus-addressed variants of internal addresses (cj.wheelock1+anything@gmail.com) are test accounts.
create function private.profile_reminder_base_email(p_email text)
returns text language sql immutable set search_path='' as $$
 select regexp_replace(split_part(p_email,'@',1),'[+].*$','')||'@'||split_part(p_email,'@',2);
$$;

drop function public.profile_completion_reminder_is_sendable(bigint);
drop function public.claim_profile_completion_reminders(integer);
drop function private.profile_reminder_eligible(uuid,text);

create function private.profile_reminder_eligible(p_profile_id uuid,p_email text,p_step smallint)
returns boolean language sql stable security definer set search_path='' as $$
 select p_step in (1,2,3) and exists(
 select 1 from public.instructor_profiles p
 join public.accounts a on a.id=p.account_id
 join auth.users u on u.id=a.id
 where p.id=p_profile_id and p.status='draft'
 and case p_step
   when 1 then p.created_at<=now()-interval '24 hours'
   when 2 then p.created_at<=now()-interval '4 days' and exists(
     select 1 from public.profile_completion_reminder_jobs j where j.profile_id=p.id and j.step=1
     and j.status='sent' and j.completed_at<=now()-interval '3 days')
   else p.created_at<=now()-interval '10 days' and exists(
     select 1 from public.profile_completion_reminder_jobs j where j.profile_id=p.id and j.step=2
     and j.status='sent' and j.completed_at<=now()-interval '6 days')
 end
 and a.role is distinct from 'admin' and u.email_confirmed_at is not null
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and lower(trim(a.email))=p_email and lower(trim(u.email))=p_email
 and p_email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$'
 and private.profile_reminder_base_email(p_email) not in ('cjwheelock1@gmail.com','cj.wheelock1@gmail.com','cj@hirelinedancers.com','cj@cjwheelock.com','cj@tinysidequest.com')
 and coalesce(u.raw_app_meta_data->>'is_test','false')<>'true'
 and coalesce(u.raw_user_meta_data->>'is_test','false')<>'true'
 and not exists(select 1 from private.profile_reminder_suppressions s where s.email=p_email)
 and not exists(select 1 from public.inquiry_thread_notification_jobs j where j.channel='email' and lower(trim(j.recipient_email))=p_email and j.delivery_status in ('bounced','complained'))
 );
$$;

create function public.claim_profile_completion_reminder_sequence(p_limit integer default 10)
returns setof public.profile_completion_reminder_jobs language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.profile_reminder_config where singleton and enabled) then return; end if;
 -- A timed-out worker might have delivered. Never automatically retry it.
 update public.profile_completion_reminder_jobs set status='uncertain',completed_at=now(),last_error='Worker lease expired; reconcile provider before any retry'
 where status='processing' and locked_at<now()-interval '10 minutes';
 insert into public.profile_completion_reminder_jobs(profile_id,account_id,recipient_email,display_name,city,step,first_name)
 select p.id,p.account_id,lower(trim(a.email)),p.display_name,p.city,s.step,nullif(trim(a.first_name),'')
 from public.instructor_profiles p join public.accounts a on a.id=p.account_id
 cross join (values (1::smallint),(2::smallint),(3::smallint)) s(step)
 where private.profile_reminder_eligible(p.id,lower(trim(a.email)),s.step)
 order by p.created_at,p.id,s.step on conflict do nothing;
 update public.profile_completion_reminder_jobs j set status='cancelled',completed_at=now(),last_error='No longer eligible'
 where j.status='pending' and not private.profile_reminder_eligible(j.profile_id,j.recipient_email,j.step);
 return query with candidates as (
 select j.id from public.profile_completion_reminder_jobs j where j.status='pending'
 order by j.created_at,j.id for update skip locked limit greatest(1,least(coalesce(p_limit,10),25))
 ) update public.profile_completion_reminder_jobs j set status='processing',locked_at=now()
 from candidates c where j.id=c.id returning j.*;
end $$;

create function public.profile_completion_reminder_is_sendable(p_job_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profile_completion_reminder_jobs j
 where j.id=p_job_id and j.status='processing' and j.locked_at>now()-interval '10 minutes'
 and exists(select 1 from private.profile_reminder_config where singleton and enabled)
 and private.profile_reminder_eligible(j.profile_id,j.recipient_email,j.step));
$$;

revoke all on function private.profile_reminder_eligible(uuid,text,smallint),private.profile_reminder_base_email(text) from public,anon,authenticated;
-- The general notification worker still calls the old claim; it now hands nothing out so only
-- the dedicated profile-reminder-worker function sends the sequence.
create function public.claim_profile_completion_reminders(p_limit integer default 10)
returns setof public.profile_completion_reminder_jobs language sql stable security definer set search_path='' as $$
 select * from public.profile_completion_reminder_jobs where false;
$$;
revoke all on function public.claim_profile_completion_reminder_sequence(integer),public.claim_profile_completion_reminders(integer),public.profile_completion_reminder_is_sendable(bigint) from public,anon,authenticated;
grant execute on function public.claim_profile_completion_reminder_sequence(integer),public.claim_profile_completion_reminders(integer),public.profile_completion_reminder_is_sendable(bigint) to service_role;

